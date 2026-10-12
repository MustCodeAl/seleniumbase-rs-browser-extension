//! Fixture pages and the loopback server that serves them.
//!
//! The pages log what happens in them to `/log`, so a test can compare what the
//! page saw while a person (here, a script sending real input events) used it
//! with what it saw while the exported test replayed the same flow.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

const HOME: &str = r##"<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Companion fixture</title></head><body>
<h1>Fixture</h1>
<form id="search" action="/next" method="get">
  <input name="q" type="search" aria-label="Search the site" data-testid="query">
  <button type="submit" id="find">Find</button>
</form>
<form id="login" onsubmit="return false">
  <label for="email">Email</label><input id="email" name="email" type="text">
  <input id="pw" name="password" type="password" placeholder="Password">
  <select id="color" name="color"><option value="r">Red</option><option value="g">Green</option><option value="b">Blue</option></select>
  <label><input id="agree" type="checkbox" name="agree"> I agree</label>
  <button type="button" id="go" data-test="go">Go</button>
  <input type="file" id="upload" name="upload">
</form>
<a id="to-next" href="/next">Next page</a>
<script>
  const log = (e) => fetch('/log?e=' + encodeURIComponent(e), { keepalive: true });
  const $ = (id) => document.getElementById(id);
  $('go').addEventListener('click', () => log('go ' + JSON.stringify({
    email: $('email').value, pwlen: $('pw').value.length, color: $('color').value, agree: $('agree').checked })));
  $('search').addEventListener('submit', () => log('submit q=' + document.querySelector('[name=q]').value));
  log('load ' + location.pathname + location.search);
</script></body></html>"##;

const NEXT: &str = r##"<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Next</title></head><body>
<h1>Next</h1><a id="back" href="/">Back</a>
<script>
  const log = (e) => fetch('/log?e=' + encodeURIComponent(e), { keepalive: true });
  document.getElementById('back').addEventListener('click', () => log('back clicked'));
  log('load ' + location.pathname + location.search);
</script></body></html>"##;

/// Elements whose selectors are awkward: no ids, repeated ids, ids and
/// attribute values that need escaping, repeated text, generated-looking classes.
const MESSY: &str = r##"<!doctype html><html><head><meta charset="utf-8"><title>Messy</title></head><body>
<div class="wrap"><div><div>
  <p tabindex="0" data-probe="deep-1">first</p>
  <p tabindex="0" data-probe="deep-2">second</p>
</div></div></div>
<input data-probe="named" name="q">
<input data-probe="dup-1" id="dup"><input data-probe="dup-2" id="dup">
<input data-probe="dotted" id="a.b">
<input data-probe="digit" id="1st">
<input data-probe="spaced" id="has space">
<input data-probe="quoted" name="say &quot;hi&quot; it's">
<input data-probe="backslash" name="c:\temp">
<a data-probe="link-text" tabindex="0" href="/p">Pricing</a>
<a data-probe="twice-1" tabindex="0" href="/d1">Docs</a><a data-probe="twice-2" tabindex="0" href="/d2">Docs</a>
<ul><li data-probe="item-1" tabindex="0">One</li><li data-probe="item-2" tabindex="0">Two</li></ul>
<button data-probe="icon-button"><span>Save</span></button>
<button data-probe="generated" class="css-1x2y3z sc-bdfBwQ">Pay</button><button class="css-9z8y7x sc-bdfBwQ">Back</button>
<div id=":r1:"><span data-probe="react-id" tabindex="0">under a generated id</span></div>
<a data-probe="href-link" href="/one">Sign in</a>
<div id="outer.x"><span data-probe="inside-odd-id" tabindex="0">x</span></div>
<button data-probe="aria" aria-label="Close dialog"><svg width="8" height="8"><path d="M0 0L8 8"/></svg></button>
</body></html>"##;

/// A running loopback server.
pub struct Server {
    port: u16,
    log: Arc<Mutex<Vec<String>>>,
}

fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte);
                    i += 3;
                    continue;
                }
                out.push(b'%');
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            other => {
                out.push(other);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn respond(stream: &mut std::net::TcpStream, status: &str, content_type: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

impl Server {
    /// Starts serving on a free loopback port.
    ///
    /// # Panics
    ///
    /// If no loopback port can be bound.
    #[must_use]
    pub fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind a loopback port");
        let port = listener.local_addr().expect("bound address").port();
        let log: Arc<Mutex<Vec<String>>> = Arc::default();
        let shared = Arc::clone(&log);
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let log = Arc::clone(&shared);
                // One thread per connection: Chrome opens speculative connections
                // that never send a request.
                thread::spawn(move || {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                    let mut buffer = [0_u8; 4096];
                    let read = stream.read(&mut buffer).unwrap_or(0);
                    if read == 0 {
                        return;
                    }
                    let request = String::from_utf8_lossy(&buffer[..read]).into_owned();
                    let target = request.split_whitespace().nth(1).unwrap_or("/").to_owned();
                    let (path, query) = target.split_once('?').unwrap_or((target.as_str(), ""));
                    match path {
                        "/" => respond(&mut stream, "200 OK", "text/html; charset=utf-8", HOME),
                        "/next" => respond(&mut stream, "200 OK", "text/html; charset=utf-8", NEXT),
                        "/messy" => respond(&mut stream, "200 OK", "text/html; charset=utf-8", MESSY),
                        "/log" => {
                            if let Some(event) = query.strip_prefix("e=") {
                                log.lock().expect("log lock").push(decode(event));
                            }
                            respond(&mut stream, "204 No Content", "text/plain", "");
                        }
                        _ => respond(&mut stream, "404 Not Found", "text/plain", "not found"),
                    }
                });
            }
        });
        Self { port, log }
    }

    /// The server's address for `path`.
    #[must_use]
    pub fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    /// The base address, with no trailing slash.
    #[must_use]
    pub fn base(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// Takes the events the pages have logged since the last call.
    ///
    /// # Panics
    ///
    /// If the log lock is poisoned.
    #[must_use]
    pub fn take_log(&self) -> Vec<String> {
        std::mem::take(&mut *self.log.lock().expect("log lock"))
    }
}
