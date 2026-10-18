# End-to-end tests

A Rust crate (`sbrs-companion-e2e`, built against seleniumbase-rs `v0.5.0`, in `Cargo.toml` and in the scratch crate
of `src/scratch.rs`) that loads the built extension into a real Chrome (and Edge) through seleniumbase-rs's pure CDP
engine, and a shell check that loads it into a real Firefox in Docker.

```sh
bun run build:e2e                   # dist/chrome, dist/firefox, dist/chrome-e2e, dist/firefox-e2e
cd e2e
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
cargo test --test e2e                                       # parity with ActionRecorder; no browser
cargo test --test e2e -- --ignored --test-threads=1         # the browser tests, one at a time
```

Run the browser tests one at a time: each starts its own browser and takes a minute or two.

## Why `dist/chrome-e2e`

The extension asks for host access to all sites as an *optional* permission, at the moment you press
**Start recording**, and otherwise relies on `activeTab`, which is granted by clicking the toolbar button.
A headless browser has no toolbar and cannot answer the permission prompt. `dist/chrome-e2e` and
`dist/firefox-e2e` are the same build plus `host_permissions` for `http://127.0.0.1/*` and
`http://localhost/*`; the build test checks that this is the only difference. The tests also load
`dist/chrome` (without it) and check that it says plainly that it has no access to the page.

## How the extension is driven

* The extension is loaded with `Extensions.loadUnpacked` (branded Chrome ignores `--load-extension` since 137;
  the browser is started with `--enable-unsafe-extension-debugging`).
* A headless browser has no popup. The popup's page, `ui/panel.html`, is opened as an ordinary tab, and the
  messages the popup's buttons send are sent from it with `chrome.runtime.sendMessage`: the same background
  code answers them. What is *not* exercised this way is the popup chrome itself (the toolbar button, the
  permission prompt, the side panel's opening).
* The page being recorded gets real input events from `Input.dispatchMouseEvent` / `dispatchKeyEvent`
  (`Locator::click`, `type_text`, `press`), which the page sees as trusted events, as a person's input is.

## What each test checks

| Test | Browser | Checks |
| --- | --- | --- |
| `parity_with_the_action_recorder` | none | `tests/golden/*.rs.txt` equal what `ActionRecorder` writes; the bun tests hold the extension's generators to the same files |
| `the_json_the_page_tab_writes_is_a_seleniumbase_rs_fingerprint` | none | the files in `tests/golden/fingerprints/page` (the JSON the Page tab writes for three recorded probes; the bun tests pin their text) deserialise into seleniumbase-rs 0.5.0's `Fingerprint`, every setting survives a round trip through it, and it reads what the probes saw |
| `the_extension_and_seleniumbase_rs_agree_on_which_fingerprint_files_are_valid` | none | every case of `tests/golden/fingerprints/accepted.json` deserialises and every case of `refused.json` (the flat 0.4 shape, an `off` for a time zone, a bad type, ...) does not; the bun tests hold the extension's own file checks to the same cases |
| `records_exports_and_replays_in_chrome` | Chrome | records a flow with real input (typing, a password, a select, a checkbox, a button, a form submit across two pages, a link); the steps; the password never recorded; the three exports; the exported pure CDP test and the BaseCase test **compile** in a scratch crate; the pure CDP test **runs** against the same pages (headless) and the pages log the same events as during the recording |
| `inspector_selectors_match_one_element_each` | Chrome | picks 21 awkward elements with the real picker (real clicks); every selector it calls unique matches exactly that element in the page; no generated-looking class or id is used; the page report, parsed into seleniumbase-rs's `Fingerprint`; the Page tab's Export (the file name, and a file seleniumbase-rs reads) and Import (the flat 0.4 shape refused in the panel, the page's own file matching on every row); the build without host access; the DevTools Recorder plugin's `stringify` on a Recorder JSON; hostile text through the bundled generators, and the results **compile** |
| `edge_loads_the_extension_and_records` | Edge | Edge accepts `Extensions.loadUnpacked`, the background answers, a click is recorded |
| `firefox/check.sh` | Firefox ESR (Docker) | geckodriver installs `dist/firefox-e2e` as a temporary add-on; the background runs; the recorder starts and records typing and a click made through WebDriver; the export. WebDriver may not open a `moz-extension:` address, so the panel page is shown in an iframe of a loopback page (the e2e build lists it as web-accessible for `127.0.0.1`), and the fixture tab is found by trying small tab ids |

## Firefox

```sh
docker build -t sbrs-firefox-check /path/to/seleniumbase-rs/docker/firefox-check
docker run --rm --shm-size 512m \
  -v "$PWD/dist/firefox-e2e:/ext:ro" -v "$PWD/e2e/firefox/check.sh:/check.sh:ro" \
  sbrs-firefox-check /bin/sh /check.sh
docker rmi sbrs-firefox-check
```

## What a headless run cannot show

The side panel, the Firefox sidebar, the toolbar popup as a popup, the permission prompt, and the DevTools
Recorder panel's **Export** menu (the plugin is registered only inside a real DevTools window; the tests call
the registered plugin object). Safari: no converter is installed here; the route is
`xcrun safari-web-extension-converter dist/chrome` followed by a build in Xcode.
