//! The browser under test, and a way to talk to the extension in it.
//!
//! A headless Chrome has no toolbar button, so the popup cannot be clicked.
//! The extension's panel page (`ui/panel.html`) is the popup's page, though, and
//! an extension page can be opened as an ordinary tab. A test opens it, and the
//! messages it sends through `chrome.runtime.sendMessage` are exactly the ones
//! the popup's buttons send: the same background code answers them.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use seleniumbase_rs::sb_cdp::{Browser, LaunchOptions, Page};
use serde_json::{json, Value};

/// Microsoft Edge on macOS.
pub const EDGE: &str = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";

/// The repository root (the folder above `e2e`).
///
/// # Panics
///
/// If the crate is not inside the repository.
#[must_use]
pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("e2e is inside the repository")
        .to_path_buf()
}

/// A built extension, `dist/<name>`.
#[must_use]
pub fn dist(name: &str) -> PathBuf {
    repo_root().join("dist").join(name)
}

/// Starts a headless browser that lets the protocol load unpacked extensions.
/// Chrome 137 and later ignore `--load-extension` in branded builds, so the
/// extension is loaded over the protocol, which this flag allows.
///
/// # Errors
///
/// [`SeleniumBaseError`](seleniumbase_rs::SeleniumBaseError) when the
/// options are refused or the browser does not start.
pub async fn launch(
    executable: Option<&str>,
) -> Result<Browser, seleniumbase_rs::SeleniumBaseError> {
    let mut options = LaunchOptions::builder()
        .headless(true)
        .no_sandbox(std::env::var_os("CI").is_some())
        .window_size(1100, 800)
        .arg("--enable-unsafe-extension-debugging");
    if let Some(path) = executable {
        options = options.executable_path(path);
    }
    Browser::launch(options.build()?).await
}

/// Loads an unpacked extension and returns its id.
///
/// # Errors
///
/// What the browser answered, if it refused.
pub async fn load_extension(browser: &Browser, dir: &Path) -> Result<String, String> {
    let reply = browser
        .execute(
            "Extensions.loadUnpacked",
            json!({ "path": dir.to_string_lossy() }),
        )
        .await
        .map_err(|error| error.to_string())?;
    reply["id"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("Extensions.loadUnpacked answered {reply}"))
}

/// Polls `check` until it returns `Some`, or panics after `timeout`.
///
/// # Panics
///
/// If `check` never returns a value in time.
pub async fn eventually<T, F, Fut>(what: &str, timeout: Duration, mut check: F) -> T
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Option<T>>,
{
    let start = Instant::now();
    loop {
        if let Some(found) = check().await {
            return found;
        }
        assert!(start.elapsed() < timeout, "timed out waiting for {what}");
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

/// Why a call through the extension page failed.
#[derive(Debug)]
pub enum HarnessError {
    /// The browser or the page refused the call.
    Browser(seleniumbase_rs::SeleniumBaseError),
    /// A file or a folder could not be written.
    Io(std::io::Error),
    /// The page answered something this harness cannot use.
    Protocol(String),
}

impl std::fmt::Display for HarnessError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Browser(error) => write!(formatter, "{error}"),
            Self::Io(error) => write!(formatter, "{error}"),
            Self::Protocol(message) => write!(formatter, "{message}"),
        }
    }
}

impl std::error::Error for HarnessError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Browser(error) => Some(error),
            Self::Io(error) => Some(error),
            Self::Protocol(_) => None,
        }
    }
}

impl From<seleniumbase_rs::SeleniumBaseError> for HarnessError {
    fn from(error: seleniumbase_rs::SeleniumBaseError) -> Self {
        Self::Browser(error)
    }
}

impl From<std::io::Error> for HarnessError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl HarnessError {
    fn protocol(message: impl std::fmt::Display) -> Self {
        Self::Protocol(message.to_string())
    }
}

/// An extension page opened as a tab, and the extension's id.
pub struct Ext {
    pub id: String,
    pub page: Page,
}

impl std::fmt::Debug for Ext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Ext")
            .field("id", &self.id)
            .finish_non_exhaustive()
    }
}

impl Ext {
    /// Opens `path` of the extension (for example `ui/panel.html`) in a new tab.
    ///
    /// # Errors
    ///
    /// [`HarnessError::Browser`] when the tab cannot be created or attached.
    /// [`HarnessError::Protocol`] when the browser answers with no target id.
    pub async fn open(browser: &Browser, id: &str, path: &str) -> Result<Self, HarnessError> {
        // sb_cdp's `goto` and `new_page` refuse the chrome-extension: scheme, so the
        // tab is created at that address through the protocol and then attached to.
        let url = format!("chrome-extension://{id}/{path}");
        let created = browser
            .execute("Target.createTarget", json!({ "url": url }))
            .await?;
        let target = created["targetId"]
            .as_str()
            .ok_or_else(|| HarnessError::protocol("Target.createTarget answered no target id"))?;
        let page = browser
            .page(target)
            .await?
            .with_timeout(Duration::from_secs(20));
        eventually("the extension page", Duration::from_secs(15), || async {
            let state = page.evaluate("document.readyState").await.ok()?;
            (state == json!("complete")).then_some(())
        })
        .await;
        Ok(Self {
            id: id.to_owned(),
            page,
        })
    }

    /// Sends a message to the background, as the panel does, and returns the reply.
    ///
    /// # Errors
    ///
    /// [`HarnessError::Browser`] when the page cannot run the script.
    pub async fn call(&self, mut message: Value) -> Result<Value, HarnessError> {
        if message.get("v").is_none() {
            message["v"] = json!(1);
        }
        Ok(self
            .page
            .evaluate(format!("chrome.runtime.sendMessage({message})"))
            .await?)
    }

    /// Like [`call`](Self::call) for a message of `kind` with `extra` fields,
    /// and checks the reply says `ok`.
    ///
    /// # Errors
    ///
    /// [`HarnessError`] when the page cannot run the message, or the reply is not ok.
    pub async fn ok(&self, kind: &str, extra: Value) -> Result<Value, HarnessError> {
        let mut message = json!({ "type": kind });
        if let (Some(into), Some(from)) = (message.as_object_mut(), extra.as_object()) {
            for (key, value) in from {
                into.insert(key.clone(), value.clone());
            }
        }
        let reply = self.call(message).await?;
        if reply["ok"] != json!(true) {
            return Err(HarnessError::protocol(format!(
                "{kind} was refused: {reply}"
            )));
        }
        Ok(reply)
    }

    /// The browser's id of the tab whose address starts with `prefix`.
    ///
    /// # Errors
    ///
    /// [`HarnessError`] when the tabs cannot be listed, the prefix is not JSON, or none match.
    pub async fn tab_id_for(&self, prefix: &str) -> Result<i64, HarnessError> {
        let quoted = serde_json::to_string(prefix).map_err(|error| {
            HarnessError::protocol(format!("the tab prefix is not JSON: {error}"))
        })?;
        let script = format!(
            "chrome.tabs.query({{}}).then(tabs => {{ const t = tabs.find(t => (t.url || '').startsWith({quoted})); return t ? t.id : null; }})"
        );
        let value = self.page.evaluate(script).await?;
        value
            .as_i64()
            .ok_or_else(|| HarnessError::protocol(format!("no tab starts with {prefix}")))
    }

    /// Saves a screenshot of this page as `<name>.png` in the folder named by
    /// `E2E_SCREENSHOTS`, if that variable is set.
    ///
    /// # Errors
    ///
    /// [`HarnessError`] when the screenshot cannot be taken or written.
    pub async fn snapshot(&self, name: &str) -> Result<(), HarnessError> {
        let Some(dir) = std::env::var_os("E2E_SCREENSHOTS") else {
            return Ok(());
        };
        let dir = PathBuf::from(dir);
        std::fs::create_dir_all(&dir)?;
        let png = self.page.screenshot().await?;
        std::fs::write(dir.join(format!("{name}.png")), png)?;
        Ok(())
    }

    /// The recorder's state.
    ///
    /// # Errors
    ///
    /// [`HarnessError`] when the background refuses the state message.
    pub async fn recorder(&self) -> Result<Value, HarnessError> {
        self.ok("recorder/state", json!({})).await
    }

    /// Runs a script in the extension page and returns its value.
    ///
    /// # Errors
    ///
    /// [`HarnessError::Browser`] when the script fails.
    pub async fn run_script(&self, script: &str) -> Result<Value, HarnessError> {
        Ok(self.page.evaluate(script).await?)
    }
}

/// The `type` of every step in a recorder state.
#[must_use]
pub fn step_types(state: &Value) -> Vec<String> {
    state["steps"]
        .as_array()
        .map(|steps| {
            steps
                .iter()
                .map(|s| s["type"].as_str().unwrap_or("?").to_owned())
                .collect()
        })
        .unwrap_or_default()
}
