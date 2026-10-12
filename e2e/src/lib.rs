//! Helpers for the end-to-end tests of the companion extension: a loopback
//! web server with fixture pages, a Chrome with the extension loaded, a way to
//! talk to the extension through one of its own pages, and a scratch crate that
//! compiles the Rust the extension exports.

pub mod fixtures;
pub mod lab;
pub mod scratch;
