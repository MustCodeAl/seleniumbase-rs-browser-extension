//! End to end: the companion extension in a real Chrome, driven from Rust through
//! seleniumbase-rs's pure CDP engine.
//!
//! Run with `mise run e2e` (it builds `dist/chrome-e2e` first), or
//!
//! ```text
//! bun run scripts/build.ts --e2e
//! cd e2e && cargo test --test e2e -- --ignored --test-threads=1
//! ```
//!
//! Each browser test starts its own Chrome and takes a minute or two. Run one at
//! a time. `parity_with_the_action_recorder` needs no browser and runs always.

use std::path::PathBuf;
use std::time::Duration;

use sbrs_companion_e2e::fixtures::Server;
use sbrs_companion_e2e::lab::{
    dist, eventually, launch, load_extension, repo_root, step_types, Ext, EDGE,
};
use sbrs_companion_e2e::scratch::{headless, Scratch};
use seleniumbase_rs::api::recorder::ActionRecorder;
use seleniumbase_rs::sb_cdp::Key;
use seleniumbase_rs::Fingerprint;
use serde_json::{json, Value};

fn golden(name: &str) -> PathBuf {
    repo_root().join("tests").join("golden").join(name)
}

// ---------------------------------------------------------------------------
// The code generators against seleniumbase-rs's own.

/// The extension's generators write the same programs as `ActionRecorder` for the
/// actions both know. `tests/golden/` holds what `ActionRecorder` writes; the
/// bun tests hold the extension's generators to the same files. Set
/// `UPDATE_GOLDEN=1` to rewrite them from `ActionRecorder` (after a change to it).
#[test]
fn parity_with_the_action_recorder() {
    let actions: Vec<Value> = serde_json::from_str(
        &std::fs::read_to_string(golden("parity-actions.json")).expect("the actions file"),
    )
    .expect("valid JSON");
    let mut recorder = ActionRecorder::default();
    for action in &actions {
        recorder.record(
            action["name"].as_str().expect("a name"),
            action["target"].as_str(),
            action["value"].as_str(),
        );
    }
    let cases = [
        (
            "parity-cdp-test.rs.txt",
            recorder.to_cdp_test("recorded_test"),
        ),
        ("parity-cdp-main.rs.txt", recorder.to_cdp_script()),
        (
            "parity-basecase-test.rs.txt",
            recorder.to_rust_test("recorded_test"),
        ),
        ("parity-basecase-main.rs.txt", recorder.to_rust_script()),
    ];
    for (file, produced) in cases {
        if std::env::var_os("UPDATE_GOLDEN").is_some() {
            std::fs::write(golden(file), &produced).expect("writes the golden file");
        }
        let expected = std::fs::read_to_string(golden(file)).expect("the golden file");
        assert_eq!(
            produced, expected,
            "{file} no longer matches ActionRecorder"
        );
    }
}

// ---------------------------------------------------------------------------
// Record, export, replay.

fn require_dist(name: &str) {
    assert!(
        dist(name).join("manifest.json").exists(),
        "dist/{name} is not built; run `bun run scripts/build.ts --e2e`"
    );
}

#[tokio::test]
#[ignore = "launches a real Chrome and loads the extension into it"]
async fn records_exports_and_replays_in_chrome() {
    require_dist("chrome-e2e");
    let server = Server::start();
    let browser = launch(None).await;
    let id = load_extension(&browser, &dist("chrome-e2e"))
        .await
        .expect("Chrome loads the extension");
    let page = browser
        .default_page()
        .await
        .expect("a tab")
        .with_timeout(Duration::from_secs(20));
    page.goto(server.url("/")).await.expect("the fixture loads");
    let ext = Ext::open(&browser, &id, "ui/panel.html").await;
    let tab = ext.tab_id_for(&server.base()).await;
    let _ = server.take_log();

    // The extension answers, and says which browser it was built for.
    let ping = ext.ok("core/ping", json!({})).await;
    assert_eq!(ping["browser"], json!("chrome"));

    // Record: the same messages the popup's buttons send, and real input events.
    let started = ext.ok("recorder/start", json!({ "tabId": tab })).await;
    assert_eq!(started["active"], json!(true));

    page.locator("#email")
        .click()
        .await
        .expect("focus the email");
    page.locator("#email")
        .type_text("alice@example.com")
        .await
        .expect("type the email");
    page.locator("#pw")
        .click()
        .await
        .expect("focus the password");
    page.locator("#pw")
        .type_text("hunter2")
        .await
        .expect("type the password");
    // A real click on an option of a list box (a headless browser has no popup
    // for a drop-down, so the fixture's select is a list box); the browser fires
    // a trusted change event, as it does for a person.
    page.locator("#color option[value=g]")
        .click()
        .await
        .expect("choose Green");
    page.locator("#agree").click().await.expect("tick the box");
    page.locator("[data-test=go]")
        .click()
        .await
        .expect("press Go");
    page.locator("[name=q]")
        .type_text("rust")
        .await
        .expect("type the query");
    page.locator("[name=q]")
        .press(Key::Enter)
        .await
        .expect("press Enter");
    eventually("the second page", Duration::from_secs(15), || async {
        let href = page.evaluate("location.href").await.ok()?;
        href.as_str()?.contains("/next?q=rust").then_some(())
    })
    .await;
    // The recorder follows the tab onto the new page: wait until it is attached.
    eventually(
        "the content script on the second page",
        Duration::from_secs(10),
        || async {
            let state = ext.recorder().await;
            state["warning"].is_null().then_some(())
        },
    )
    .await;
    tokio::time::sleep(Duration::from_millis(1200)).await;
    page.locator("#back").click().await.expect("follow Back");
    eventually("the first page again", Duration::from_secs(15), || async {
        let href = page
            .evaluate("location.pathname + location.search")
            .await
            .ok()?;
        (href == json!("/")).then_some(())
    })
    .await;
    tokio::time::sleep(Duration::from_millis(800)).await;

    let stopped = ext.ok("recorder/stop", json!({})).await;
    assert_eq!(stopped["active"], json!(false));
    let state = ext.recorder().await;
    let types = step_types(&state);
    println!("recorded steps: {types:?}");
    assert_eq!(
        types,
        [
            "navigate", "change", "change", "select", "check", "click", "change", "keyPress",
            "click"
        ],
        "{state:#}"
    );
    let steps = state["steps"].as_array().expect("steps");
    assert_eq!(steps[1]["value"], json!("alice@example.com"));
    // The password: a step with no value, flagged, and the secret nowhere.
    assert_eq!(steps[2]["sensitive"], json!(true));
    assert_eq!(steps[2]["value"], json!(""));
    assert!(
        !state.to_string().contains("hunter2"),
        "the password was recorded"
    );
    assert_eq!(steps[3]["text"], json!("Green"));
    assert_eq!(steps[7]["key"], json!("Enter"));

    // The panel as a person sees it, once there are steps to show.
    let panel = Ext::open(
        &browser,
        &id,
        &format!("ui/panel.html?tabId={tab}&view=record"),
    )
    .await;
    eventually(
        "the steps in the panel",
        Duration::from_secs(10),
        || async {
            let count = panel
                .run_script("document.querySelectorAll('#view-record ol.steps li').length")
                .await;
            (count == json!(9)).then_some(())
        },
    )
    .await;
    assert_eq!(
        panel
            .run_script("[...document.querySelectorAll('[role=tab]')].map(t => t.textContent)")
            .await,
        json!(["Record", "Inspect", "Page"])
    );
    panel.snapshot("panel-record").await;

    // The record phase, as the page saw it.
    let recorded_log = server.take_log();
    println!("page saw while recording: {recorded_log:?}");
    assert_eq!(
        recorded_log,
        [
            "go {\"email\":\"alice@example.com\",\"pwlen\":7,\"color\":\"g\",\"agree\":true}",
            "submit q=rust",
            "load /next?q=rust",
            "back clicked",
            "load /",
        ]
    );

    // Export in every format.
    let cdp = ext
        .ok(
            "recorder/export",
            json!({ "format": "cdp", "name": "e2e flow", "entry": "test" }),
        )
        .await;
    let cdp_text = cdp["text"].as_str().expect("text").to_owned();
    println!("--- exported (pure CDP) ---\n{cdp_text}");
    assert_eq!(cdp["filename"], json!("e2e_flow.rs"));
    for expected in [
        &format!("page.goto(\"{}\").await?;", server.url("/")),
        "page.locator(\"#email\").type_text(\"alice@example.com\").await?;",
        "// the value of this field was not recorded: set RECORDED_PASSWORD",
        "page.locator(\"#pw\").type_text(std::env::var(\"RECORDED_PASSWORD\").unwrap_or_default()).await?;",
        "page.locator(\"#color\").select_option(SelectBy::Text(\"Green\")).await?;",
        "page.locator(\"#agree\").check().await?;",
        "page.locator(\"[data-test=\\\"go\\\"]\").click().await?;",
        "page.locator(\"[data-testid=\\\"query\\\"]\").type_text(\"rust\").await?;",
        "page.locator(\"[data-testid=\\\"query\\\"]\").press(Key::Enter).await?;",
        "page.locator(\"#back\").click().await?;",
    ] {
        assert!(cdp_text.contains(expected), "missing {expected}\n{cdp_text}");
    }
    assert!(!cdp_text.contains("hunter2"));
    // `Locator::type_text` empties the field first, so the export does not clear it as well.
    assert!(
        !cdp_text.contains(".clear()"),
        "a field is cleared before type_text\n{cdp_text}"
    );
    let basecase = ext
        .ok(
            "recorder/export",
            json!({ "format": "basecase", "name": "e2e flow", "entry": "test" }),
        )
        .await;
    let basecase_text = basecase["text"].as_str().expect("text").to_owned();
    println!("--- exported (BaseCase) ---\n{basecase_text}");
    assert!(basecase_text.contains("sb.select_option_by_text(\"#color\", \"Green\").await?;"));
    assert!(basecase_text
        .contains("sb.send_keys(\"[data-testid=\\\"query\\\"]\", \"\\u{e007}\").await?;"));
    let replay = ext
        .ok(
            "recorder/export",
            json!({ "format": "devtools", "name": "e2e flow" }),
        )
        .await;
    let replay_json: Value =
        serde_json::from_str(replay["text"].as_str().expect("text")).expect("JSON");
    assert_eq!(replay_json["title"], json!("e2e flow"));
    assert_eq!(replay_json["steps"][0]["type"], json!("setViewport"));
    assert_eq!(replay_json["steps"][1]["type"], json!("navigate"));
    assert!(!replay.to_string().contains("hunter2"));

    browser.close().await.expect("Chrome closes");

    // Compile the exported test and run it against the same pages. The only edit
    // is that its Chrome is headless, so it opens no window on this desktop.
    let scratch = Scratch::new();
    scratch.add_test("recorded", &headless(&cdp_text));
    scratch.add_test("recorded_basecase", &basecase_text);
    let (built, output) = scratch.cargo(&["test", "--no-run"], &[]).await;
    assert!(built, "the exported tests do not compile:\n{output}");
    println!("the exported pure CDP test and BaseCase test compile");

    let (passed, output) = scratch
        .cargo(
            &["test", "--test", "recorded", "--", "--nocapture"],
            &[("RECORDED_PASSWORD", "hunter2")],
        )
        .await;
    assert!(passed, "the exported test failed:\n{output}");
    println!("the exported pure CDP test passed against the fixture");
    let mut replayed_log = server.take_log();
    println!("page saw while replaying: {replayed_log:?}");
    if replayed_log.first().map(String::as_str) == Some("load /") {
        replayed_log.remove(0);
    }
    assert_eq!(
        replayed_log, recorded_log,
        "the replay did not do what the recording did"
    );
}

// ---------------------------------------------------------------------------
// The inspector, the page report, the DevTools plugin page, hostile text.

const PROBES: &[&str] = &[
    "deep-1",
    "deep-2",
    "named",
    "dup-1",
    "dup-2",
    "dotted",
    "digit",
    "spaced",
    "quoted",
    "backslash",
    "link-text",
    "twice-1",
    "twice-2",
    "item-1",
    "item-2",
    "icon-button",
    "generated",
    "react-id",
    "href-link",
    "inside-odd-id",
    "aria",
];

#[tokio::test]
#[ignore = "launches a real Chrome and loads the extension into it"]
async fn inspector_selectors_match_one_element_each() {
    require_dist("chrome-e2e");
    require_dist("chrome");
    let server = Server::start();
    let browser = launch(None).await;
    let id = load_extension(&browser, &dist("chrome-e2e"))
        .await
        .expect("loads e2e");
    let store_id = load_extension(&browser, &dist("chrome"))
        .await
        .expect("loads the store build");
    let page = browser
        .default_page()
        .await
        .expect("a tab")
        .with_timeout(Duration::from_secs(20));
    page.goto(server.url("/messy")).await.expect("loads");
    let ext = Ext::open(&browser, &id, "ui/panel.html").await;
    let tab = ext.tab_id_for(&server.base()).await;

    let mut checked = 0;
    let mut unique = 0;
    let mut previous = 0_u64;
    for probe in PROBES {
        ext.ok("inspector/pick", json!({ "tabId": tab })).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        page.locator(format!("[data-probe=\"{probe}\"]"))
            .click()
            .await
            .unwrap_or_else(|error| panic!("clicking {probe}: {error}"));
        let last = eventually(
            &format!("the pick of {probe}"),
            Duration::from_secs(10),
            || async {
                let reply = ext.ok("inspector/last", json!({})).await;
                let last = reply["last"].clone();
                (last["at"].as_u64()? > previous).then_some(last)
            },
        )
        .await;
        previous = last["at"].as_u64().expect("a time");
        let candidates = last["candidates"].as_array().expect("candidates");
        assert!(!candidates.is_empty(), "{probe}: no selectors");
        assert!(
            last["best"].is_string(),
            "{probe}: no selector matches only this element: {last}"
        );
        for candidate in candidates {
            let value = candidate["value"].as_str().expect("value");
            for generated in ["css-1x2y3z", "sc-bdfBwQ", ":r1:", "css-9z8y7x"] {
                assert!(
                    !value.contains(generated),
                    "{probe}: {value} uses {generated}"
                );
            }
            if candidate["unique"] != json!(true) {
                continue;
            }
            let syntax = candidate["syntax"].as_str().expect("syntax");
            if syntax == "aria" {
                continue;
            }
            let script = format!(
                "(() => {{ const v = {value}; const s = {syntax}; let found = [];
                   if (s === 'css') found = [...document.querySelectorAll(v)];
                   else if (s === 'xpath') {{ const r = document.evaluate(v, document, null, 7, null); for (let i = 0; i < r.snapshotLength; i++) found.push(r.snapshotItem(i)); }}
                   else if (s === 'link') {{ const t = v.slice(v.indexOf('=') + 1); found = [...document.querySelectorAll('a')].filter(a => a.textContent.replace(/[ \\t\\r\\n]+/g, ' ').trim() === t); }}
                   return {{ count: found.length, probe: found[0] ? (found[0].closest('[data-probe]') || found[0]).getAttribute('data-probe') : null }};
                 }})()",
                value = serde_json::to_string(value).expect("a string"),
                syntax = serde_json::to_string(syntax).expect("a string"),
            );
            let seen = page
                .evaluate(&script)
                .await
                .unwrap_or_else(|error| panic!("the check runs: {error}\n{script}"));
            assert_eq!(
                seen["count"],
                json!(1),
                "{probe}: {syntax} {value} matches {seen}"
            );
            assert_eq!(
                seen["probe"],
                json!(probe),
                "{probe}: {syntax} {value} found another element"
            );
            unique += 1;
        }
        checked += 1;
        // The picker leaves its panel on the page; close it with Escape before the next pick.
        page.locator("body").press(Key::Escape).await.ok();
    }
    println!("{checked} elements picked; {unique} selectors checked to match exactly that element");
    assert_eq!(checked, PROBES.len());
    assert!(unique >= PROBES.len() * 2);

    // What this page sees, from the page's own world, as a seleniumbase-rs Fingerprint.
    let report = ext.ok("inspector/probe", json!({ "tabId": tab })).await;
    let probe = &report["probe"];
    println!("page report: {probe:#}");
    assert!(probe["navigator"]["userAgent"]
        .as_str()
        .expect("ua")
        .contains("Chrome/155"));
    assert!(probe["headless"]["markers"]
        .as_array()
        .expect("markers")
        .iter()
        .any(|m| m == "ua_headless"));
    assert!(probe["navigator"]["hardwareConcurrency"].is_number());
    assert!(probe["timezone"]["name"].is_string());
    assert!(probe["canvas"]["hash"].is_string());
    let fingerprint: Fingerprint = serde_json::from_value(report["fingerprint"].clone())
        .expect("the Fingerprint JSON deserialises into seleniumbase-rs's Fingerprint");
    println!("fingerprint JSON: {}", report["fingerprint"]);
    assert_eq!(
        fingerprint.user_agent().as_str(),
        probe["navigator"]["userAgent"].as_str()
    );
    assert_eq!(fingerprint.core_version(), Some(155));
    // The screen is one setting in 0.5.0 (a width and a height), not two numbers.
    let screen = fingerprint.screen().value().expect("the screen");
    assert_eq!(
        probe["screen"]["width"].as_u64(),
        Some(u64::from(screen.width))
    );
    assert_eq!(
        probe["screen"]["height"].as_u64(),
        Some(u64::from(screen.height))
    );
    assert_eq!(report["fingerprint"]["browser_type"], json!("chromium"));
    assert_eq!(report["fingerprint"]["os_type"], json!("Macos"));

    // The build without host access (what a store would ship): it works, and it
    // says plainly that it has no access to the page instead of failing quietly.
    let store = Ext::open(&browser, &store_id, "ui/panel.html").await;
    let ping = store.ok("core/ping", json!({})).await;
    assert!(ping["name"]
        .as_str()
        .expect("name")
        .starts_with("seleniumbase-rs Companion"));
    let denied = store
        .call(json!({ "type": "inspector/probe", "tabId": tab }))
        .await;
    println!("store build, no access: {denied}");
    assert_eq!(denied["ok"], json!(false));
    assert!(denied["error"]
        .as_str()
        .expect("error")
        .contains("no access"));

    // The panel's other two views, with a pick and a report to show.
    for view in ["inspect", "page"] {
        let panel = Ext::open(
            &browser,
            &id,
            &format!("ui/panel.html?tabId={tab}&view={view}"),
        )
        .await;
        tokio::time::sleep(Duration::from_secs(6)).await;
        let shown = panel
            .run_script(&format!(
                "document.querySelector('#notice').textContent + ' | ' + document.querySelector('#view-{view}').innerText.slice(0, 300)"
            ))
            .await;
        println!("the {view} view shows: {shown}");
        eventually(
            &format!("the {view} view"),
            Duration::from_secs(15),
            || async {
                let shown = panel
                    .run_script(&format!(
                        "document.querySelectorAll('#view-{view} .row, #view-{view} table tr').length"
                    ))
                    .await;
                (shown.as_i64()? > 3).then_some(())
            },
        )
        .await;
        panel.snapshot(&format!("panel-{view}")).await;
    }

    // The DevTools Recorder plugin page, outside DevTools: the registration needs
    // a real DevTools, but the plugin it registers can be called.
    let plugin = Ext::open(&browser, &id, "devtools-recorder/devtools.html").await;
    let recording = json!({
        "title": "From DevTools",
        "steps": [
            { "type": "setViewport", "width": 1100, "height": 800, "deviceScaleFactor": 1, "isMobile": false, "hasTouch": false, "isLandscape": false },
            { "type": "navigate", "url": server.url("/"), "assertedEvents": [{ "type": "navigation", "url": server.url("/"), "title": "x" }] },
            { "type": "click", "target": "main", "selectors": [["aria/Go[role=\"button\"]"], ["#go"], ["xpath///*[@id=\"go\"]"]], "offsetX": 3, "offsetY": 4 },
            { "type": "change", "value": "alice", "selectors": [["#email"]], "target": "main" },
            { "type": "keyDown", "target": "main", "key": "Enter" },
            { "type": "keyUp", "target": "main", "key": "Enter" }
        ]
    });
    let exported_cdp = plugin
        .run_script(&format!("__sbrsRecorderPlugins.cdp.stringify({recording})"))
        .await;
    let exported_cdp = exported_cdp.as_str().expect("a string").to_owned();
    println!("--- DevTools Recorder export (pure CDP) ---\n{exported_cdp}");
    assert!(exported_cdp.contains("page.locator(\"#go\").click().await?;"));
    assert!(exported_cdp.contains("page.locator(\"#email\").set_value(\"alice\").await?;"));
    assert!(exported_cdp.contains("async fn from_dev_tools()"));
    let exported_base = plugin
        .run_script(&format!(
            "__sbrsRecorderPlugins.basecase.stringify({recording})"
        ))
        .await;
    let exported_base = exported_base.as_str().expect("a string").to_owned();
    let one_step = plugin
        .run_script("__sbrsRecorderPlugins.cdp.stringifyStep({ type: 'click', target: 'main', selectors: [['#go']], offsetX: 1, offsetY: 1 })")
        .await;
    assert_eq!(one_step, json!("page.locator(\"#go\").click().await?;"));

    // Hostile text through the real, bundled generators: put steps with quotes,
    // backslashes, line breaks, NUL, bidirectional controls and a closing brace
    // in storage, export, and compile what comes out.
    let hostile = "\"; } fn pwned() { loop {} } //\n\\\u{0}\u{202e}\u{2066}\u{200b}\u{e007}'`${x}";
    let steps = json!([
        { "id": "h1", "type": "navigate", "url": format!("https://x.test/?q={hostile}") },
        { "id": "h2", "type": "click", "target": { "selectors": [{ "kind": "css", "syntax": "css", "value": format!("a[title=\"{hostile}\"]"), "count": 1, "unique": true }] } },
        { "id": "h3", "type": "change", "value": hostile, "target": { "selectors": [{ "kind": "css", "syntax": "css", "value": "#q", "count": 1, "unique": true }] } },
        { "id": "h4", "type": "select", "text": hostile, "value": hostile, "target": { "selectors": [{ "kind": "css", "syntax": "css", "value": "#c", "count": 1, "unique": true }] } },
        { "id": "h5", "type": "setFiles", "names": [hostile], "target": { "selectors": [{ "kind": "css", "syntax": "css", "value": "#up", "count": 1, "unique": true }] } },
        { "id": "h6", "type": "change", "value": "", "sensitive": true, "secret": hostile, "target": { "selectors": [{ "kind": "css", "syntax": "css", "value": "#pw", "count": 1, "unique": true }] } },
        { "id": "h7", "type": "keyPress", "key": hostile }
    ]);
    ext.run_script(&format!(
        "chrome.storage.local.set({{ 'recorder.steps': {steps} }})"
    ))
    .await;
    let hostile_cdp = ext
        .ok(
            "recorder/export",
            json!({ "format": "cdp", "name": hostile, "entry": "test" }),
        )
        .await;
    let hostile_base = ext
        .ok(
            "recorder/export",
            json!({ "format": "basecase", "name": hostile, "entry": "main" }),
        )
        .await;
    let hostile_json = ext
        .ok(
            "recorder/export",
            json!({ "format": "devtools", "name": hostile }),
        )
        .await;
    serde_json::from_str::<Value>(hostile_json["text"].as_str().expect("text"))
        .expect("the JSON export is JSON");
    let hostile_cdp = hostile_cdp["text"].as_str().expect("text").to_owned();
    let hostile_base = hostile_base["text"].as_str().expect("text").to_owned();
    for line in hostile_cdp.lines().chain(hostile_base.lines()) {
        assert!(
            !line.trim_start().starts_with("fn pwned"),
            "text escaped its literal: {line}"
        );
    }

    browser.close().await.expect("Chrome closes");

    let scratch = Scratch::new();
    scratch.add_test("devtools_cdp", &exported_cdp);
    scratch.add_test("devtools_basecase", &exported_base);
    scratch.add_test("hostile_cdp", &hostile_cdp);
    scratch.add_test("hostile_basecase", &hostile_base);
    let (built, output) = scratch.cargo(&["test", "--no-run"], &[]).await;
    assert!(built, "an export does not compile:\n{output}");
    println!("DevTools Recorder exports and hostile-text exports compile");
    // Keep the hostile exports where a person can read them.
    drop(server);
}

// ---------------------------------------------------------------------------
// Edge.

#[tokio::test]
#[ignore = "launches Microsoft Edge and loads the extension into it"]
async fn edge_loads_the_extension_and_records() {
    require_dist("chrome-e2e");
    if !std::path::Path::new(EDGE).exists() {
        eprintln!("Microsoft Edge is not installed; nothing to check");
        return;
    }
    let server = Server::start();
    let browser = launch(Some(EDGE)).await;
    let id = match load_extension(&browser, &dist("chrome-e2e")).await {
        Ok(id) => id,
        Err(error) => panic!("Edge did not accept the extension: {error}"),
    };
    let page = browser
        .default_page()
        .await
        .expect("a tab")
        .with_timeout(Duration::from_secs(20));
    page.goto(server.url("/")).await.expect("loads");
    let ext = Ext::open(&browser, &id, "ui/panel.html").await;
    let ping = ext.ok("core/ping", json!({})).await;
    println!("Edge: {ping}");
    let tab = ext.tab_id_for(&server.base()).await;
    ext.ok("recorder/start", json!({ "tabId": tab })).await;
    page.locator("[data-test=go]")
        .click()
        .await
        .expect("press Go");
    let types = eventually("a click step in Edge", Duration::from_secs(10), || async {
        let types = step_types(&ext.recorder().await);
        types.contains(&"click".to_owned()).then_some(types)
    })
    .await;
    println!("Edge recorded steps: {types:?}");
    assert_eq!(types, ["navigate", "click"]);
    browser.close().await.expect("Edge closes");
}
