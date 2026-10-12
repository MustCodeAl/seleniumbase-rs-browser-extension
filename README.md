# seleniumbase-rs companion

Browser extensions for [seleniumbase-rs](https://github.com/MustCodeAl/seleniumbase-rs), the Rust port of
SeleniumBase. One source tree builds Manifest V3 extensions for Chrome (also Edge and other Chromium
browsers) and Firefox.

| Feature | What it does |
| --- | --- |
| **Recorder** | Start and stop recording from the toolbar popup (or the Chrome side panel, or the Firefox sidebar). Clicks, double clicks, typing (one step per field), selects, checkboxes, key presses (Enter, Escape, arrows), file inputs (the file name only) and, if you turn it on, scrolls become steps you can edit, reorder and delete. Export as a seleniumbase-rs **pure CDP** Rust test, a **BaseCase** Rust test, or a **Chrome DevTools Recorder** JSON file (the `@puppeteer/replay` format that `sbase import-puppeteer` reads). |
| **Inspector** | Pick an element (hover, click; Escape cancels) and see its selectors, each with the number of elements it matches, and calls to copy for both engines (`page.locator(...).click()`, `sb.click(...)`, ...). The **Page** tab shows what the page sees: `navigator.webdriver`, user agent and client hints, languages, platform, hardware, screen and window sizes, time zone, WebGL vendor and renderer, a canvas hash, plugin counts, permission states and headless markers, and copies it as JSON shaped like seleniumbase-rs's `Fingerprint`. |
| **DevTools Recorder export** (Chrome, Edge) | Adds "seleniumbase-rs (pure CDP)" and "seleniumbase-rs (BaseCase)" to the Export menu of the DevTools Recorder panel. |

Nothing is sent anywhere. Recordings are kept in the extension's own storage and leave it only when you press
Download or Copy. The value of a password or payment field is never read, so it cannot be recorded; the
generated code reads it from an environment variable instead (`RECORDED_PASSWORD`, ...).

## Install from source

You need [Bun](https://bun.sh) (`mise install` sets everything up).

```sh
bun install
bun run build          # dist/chrome, dist/firefox, and a zip of each
```

* **Chrome / Edge**: open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, **Load
  unpacked**, choose `dist/chrome`.
* **Firefox**: open `about:debugging#/runtime/this-firefox`, **Load Temporary Add-on**, choose
  `dist/firefox/manifest.json` (or the zip).

Press the toolbar button, then **Start recording**. The first time, the browser asks to let the extension
"read and change your data on all websites". That is only so the recording can follow links from page to
page; say no and it still records the page you started on.

## Develop

```sh
mise run build       # or: bun run scripts/build.ts
mise run test        # bun test: selectors, code generators, steps, manifests, build output
mise run lint        # manifest rules, then web-ext lint on both dists
mise run e2e         # a real Chrome driven from Rust (see e2e/README.md)
```

## Layout and extension points

```
src/
  manifest/base.json     manifest keys for every browser; base.json's "chrome" and "firefox" keys are per browser
  shared/                no browser APIs except api.js: selector generation, code generation, the step model
    selectors.js           generateSelectors(): candidates in order of preference, each with its match count
    steps.js               the step model, merging typing, masking secrets, sanitising incoming steps
    codegen/               cdp.js, basecase.js, replay.js (DevTools Recorder JSON, both ways), index.js
    rust.js                rustStr() and friends: everything recorded goes into Rust through these
    calls.js, fingerprint.js, protocol.js, api.js, dom.js, clipboard.js, pickview.js
  background/            the router: registerHandler(type, handler, from); store.js helpers
  recorder/  inspector/  devtools-recorder/    one folder per feature (see below)
  ui/                    the panel (popup, side panel, sidebar) and its views
  bridge/  converter/    placeholders: disabled features waiting for their code
scripts/build.ts         src/ to dist/<browser>/ and zips
tests/                   bun test
e2e/                     a Rust crate that loads dist/chrome-e2e into Chrome
```

**A feature is a folder with a `feature.json`.** The build finds `src/*/feature.json` (a folder with
`"enabled": false` is skipped) and, for each browser it lists (`"browsers"`, both by default):

* bundles `background` (a module) into the one background bundle, after `src/background/index.js`;
* bundles each file of `scripts` on its own, as a classic script, to `dist/<browser>/<feature>/<file>`
  (content scripts, page scripts, a DevTools page script);
* bundles `panelViews` (a module that calls `registerView` from `src/ui/registry.js`) into the panel;
* copies every other file (html, css, images) as it is, except `feature.json`, `*.md`, files starting with `_`;
* merges `manifest` (and `chrome` / `firefox`) into that browser's manifest. Arrays are joined without
  repeats, objects are merged, and two different values for one key stop the build, so features cannot
  silently override one another.

So **to add a page**, put the `.html` and its script in the feature folder, list the script under `scripts`, and
open it with `ext.runtime.getURL("<feature>/page.html")`; to make it reachable from a web page, declare
`web_accessible_resources` in the feature's `manifest`. **To add a permission**, put it in the feature's
`manifest` (`permissions`, `optional_permissions`, `optional_host_permissions`, ...) and add it to the allow
list in `scripts/lint.ts` on purpose. Static `host_permissions` and `content_scripts` are not used: the extension
injects its scripts into the tab you point it at (`activeTab`), or into any tab once you allow all sites.

**Messages** (`src/shared/protocol.js`): `{ v: 1, type: "<feature>/<name>", ...payload }`, answered with
`{ ok: true, ...data }` or `{ ok: false, error }`. The panel talks to the background with
`ext.runtime.sendMessage`; a content script does the same; the background talks to a content script with
`ext.tabs.sendMessage`. A feature adds a type from its background module:

```js
import { registerHandler, broadcast } from "../background/router.js";
registerHandler("bridge/connect", async (message, sender) => ({ connected: true }), "ui"); // "ui" | "content" | "any"
```

The router refuses a message from the wrong kind of sender. After a change, `broadcast(MSG.STATE_CHANGED, { area })`
makes the panel's `ctx.onChange(area, fn)` run. Anything a feature keeps goes through `src/background/store.js`
(`local` survives a restart, `session` does not), and the background must not hold state in memory: the browser
stops and starts it.

## Security

No remote code, no `eval` or `new Function` (the build and the tests check the output), a strict extension
CSP (`script-src 'self'`), no static host permissions, no `content_scripts` in the manifest. Page-derived text
is only ever put in the DOM as text, and into Rust only through `rustStr`. A content script's messages are
validated and bounded (`sanitizeStep`) before they are stored.

## Limits

Steps inside iframes and shadow roots are not recorded (a shadow host is recorded as the target). The recorder
follows the tab you started in, not other tabs. Only Chrome 155 and Firefox ESR 153 were run; see `e2e/README.md`
for what was and was not exercised in a real browser.

## Licence

MIT.
