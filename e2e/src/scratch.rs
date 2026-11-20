//! A scratch crate that compiles, and runs, the Rust the extension exports.
//!
//! It depends on seleniumbase-rs from GitHub and on nothing else (the exports take Tokio from
//! `seleniumbase_rs::tokio`), as a person's own project would, and
//! shares this crate's `Cargo.lock` and target directory so it builds offline and
//! only the exported file itself needs compiling.

use std::path::{Path, PathBuf};

use tempfile::TempDir;
use tokio::process::Command;

const SEPARATE_TARGET: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/target");

/// A throwaway crate with a `tests/` folder.
#[derive(Debug)]
pub struct Scratch {
    dir: TempDir,
}

impl Scratch {
    /// Creates the crate.
    ///
    /// # Errors
    ///
    /// [`std::io::Error`] when the temporary folder or its files cannot be written.
    pub fn new() -> Result<Self, std::io::Error> {
        let dir = tempfile::tempdir()?;
        let manifest = r#"[package]
name = "scratch"
version = "0.0.0"
edition = "2024"
rust-version = "1.99"
publish = false

[workspace]

[dependencies]
seleniumbase-rs = { git = "https://github.com/MustCodeAl/seleniumbase-rs", tag = "v0.8.5", features = ["test-util"] }
# No tokio line: the exports import it with `use seleniumbase_rs::tokio;`.
"#;
        std::fs::write(dir.path().join("Cargo.toml"), manifest)?;
        std::fs::create_dir_all(dir.path().join("src"))?;
        std::fs::write(dir.path().join("src/lib.rs"), "")?;
        std::fs::create_dir_all(dir.path().join("tests"))?;
        let lock = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.lock");
        if lock.exists() {
            std::fs::copy(lock, dir.path().join("Cargo.lock"))?;
        }
        Ok(Self { dir })
    }

    /// Writes `tests/<name>.rs`.
    ///
    /// # Errors
    ///
    /// [`std::io::Error`] when the test file cannot be written.
    pub fn add_test(&self, name: &str, source: &str) -> Result<PathBuf, std::io::Error> {
        let path = self.dir.path().join("tests").join(format!("{name}.rs"));
        std::fs::write(&path, source)?;
        Ok(path)
    }

    /// Runs `cargo <args>` in the crate, offline, with the settings every build
    /// here uses. Returns whether it succeeded and what it printed.
    ///
    /// # Errors
    ///
    /// [`std::io::Error`] when `cargo` cannot be started.
    pub async fn cargo(
        &self,
        args: &[&str],
        env: &[(&str, &str)],
    ) -> Result<(bool, String), std::io::Error> {
        let target =
            std::env::var("CARGO_TARGET_DIR").unwrap_or_else(|_| SEPARATE_TARGET.to_owned());
        let mut command = Command::new("cargo");
        // `--offline` goes right after the subcommand, before any `--` that
        // separates the test harness's own arguments.
        command
            .args(args.iter().take(1))
            .arg("--offline")
            .args(args.iter().skip(1))
            .current_dir(self.dir.path())
            .env("CARGO_BUILD_JOBS", "1")
            .env("CARGO_INCREMENTAL", "0")
            .env("CARGO_PROFILE_DEV_DEBUG", "0")
            .env("CARGO_TARGET_DIR", target)
            .env("CARGO_TERM_COLOR", "never");
        for (key, value) in env {
            command.env(key, value);
        }
        let output = command.output().await?;
        let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
        text.push_str(&String::from_utf8_lossy(&output.stderr));
        Ok((output.status.success(), text))
    }
}

/// The exported program with its browser made headless, so a replay on a
/// person's desktop does not open a window. This is the only edit.
#[must_use]
pub fn headless(source: &str) -> String {
    source.replace(
        "LaunchOptions::builder().build()?",
        "LaunchOptions::builder().headless(true).build()?",
    )
}
