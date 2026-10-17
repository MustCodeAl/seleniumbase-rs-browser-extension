# seleniumbase-rs companion

Browser extensions for [seleniumbase-rs](https://github.com/MustCodeAl/seleniumbase-rs), the Rust port of
SeleniumBase. One source tree builds Manifest V3 extensions for Chrome (also Edge and other Chromium
browsers) and Firefox. The source is strict TypeScript, bundled with Bun.

The full guide is part of the seleniumbase-rs documentation site:
[Browser extension](https://mustcodeal-seleniumbase-rs.docs7.io/ecosystem/browser-extension).

| Feature | What it does |
| --- | --- |
| **Recorder** | Start and stop recording from the toolbar popup (or the Chrome side panel, or the Firefox sidebar). Clicks, double clicks, typing (one step per field), selects, checkboxes, key presses (Enter, Escape, arrows), file inputs (the file name only) and, if you turn it on, scrolls become steps you can edit, reorder and delete. Export as a seleniumbase-rs **pure CDP** Rust test, a **BaseCase** Rust test, or a **Chrome DevTools Recorder** JSON file (the `@puppeteer/replay` format that `sbrs import-puppeteer` reads). |
| **Inspector** | Pick an element (hover, click; Escape cancels) and see its selectors, each with the number of elements it matches, and calls to copy for both engines (`page.locator(...).click()`, `sb.click(...)`, ...). The **Page** tab shows what the page sees: `navigator.webdriver`, user agent and client hints, languages, platform, hardware, screen and window sizes, time zone, WebGL vendor and renderer, a canvas hash, plugin counts, permission states and headless markers, and copies it as JSON shaped like seleniumbase-rs's `Fingerprint`. |
| **DevTools Recorder export** (Chrome, Edge) | Adds "seleniumbase-rs (pure CDP)" and "seleniumbase-rs (BaseCase)" to the Export menu of the DevTools Recorder panel. |

Nothing is sent anywhere. Recordings are kept in the extension's own storage and leave it only when you press
Download or Copy. The value of a password or payment field is never read, so it cannot be recorded; the
generated code reads it from an environment variable instead (`RECORDED_PASSWORD`, ...).

The Rust it writes is for seleniumbase-rs 0.5.0. `Locator::type_text` empties a field before it types, so a
recorded field is typed with that call alone; the text assertions take the text first; and the Page tab's JSON is
the `Fingerprint` that 0.5.0 reads (one object for the screen, the WebGL strings and the device counts). `e2e/`
compiles every export against tag `v0.5.0`, and `tests/golden/` holds what its `ActionRecorder` writes for the
actions both know.

## Install from source

You need [Bun](https://bun.sh) (`mise install` sets everything up). The `package.json` scripts run through
`$npm_execpath`, so start them with `bun run`; `npm run` and `pnpm run` do not work.

```sh
bun install
bun run build          # dist/chrome, dist/firefox, and a zip of each
bun run build:e2e      # the same, plus dist/chrome-e2e and dist/firefox-e2e for the end-to-end tests
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
bun run typecheck    # tsc over src/ (the extension) and over scripts/ and tests/ (the Bun side)
bun run lint         # typecheck, the source rules, the manifest rules, then web-ext lint on dist/firefox
bun test             # selectors, code generators, steps, manifests, build output
mise run e2e         # a real Chrome driven from Rust (see e2e/README.md)
```

`mise run build`, `test`, `typecheck` and `lint` run the same commands.

Every file under `src/`, `scripts/` and `tests/` is TypeScript with `strict`, `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes` (`tsconfig.json`; `src/tsconfig.json` checks the extension without Bun's globals).
`tsc` only checks: Bun runs and bundles the TypeScript itself, and the build writes plain `.js` files into
`dist/<browser>/`, where the manifests and the html pages name them. Imports name the `.ts` file
(`import { rustStr } from "./rust.ts"`), and so does a `feature.json` (`"background": "background.ts"`). The
WebExtension types are `@types/chrome` (the code is written against `ext` in `src/shared/api.ts`, typed as
Chrome's namespace, which Firefox's `browser` matches for the calls made here); there are no runtime
dependencies. `any` needs a `// any: <why>` comment, and `bun run lint` fails without one.

## Layout and extension points

```
src/
  manifest/base.json     manifest keys for every browser; base.json's "chrome" and "firefox" keys are per browser
  shared/                no browser APIs except api.ts: selector generation, code generation, the step model
    selectors.ts           generateSelectors(): candidates in order of preference, each with its match count
    steps.ts               the step model, merging typing, masking secrets, sanitising incoming steps
    codegen/               cdp.ts, basecase.ts, replay.ts (DevTools Recorder JSON, both ways), index.ts
    rust.ts                rustStr() and friends: everything recorded goes into Rust through these
    calls.ts, fingerprint.ts, protocol.ts, api.ts, dom.ts, clipboard.ts, pickview.ts, guards.ts
  background/            the router: registerHandler(type, handler, from); store.ts helpers
  recorder/  inspector/  devtools-recorder/    one folder per feature (see below)
  ui/                    the panel (popup, side panel, sidebar) and its views
  bridge/  converter/    placeholders: disabled features waiting for their code
scripts/build.ts         src/ to dist/<browser>/ and zips
scripts/lint.ts          the source rules (scripts/rules.ts), the manifest rules, web-ext lint
tests/                   bun test
src/env.d.ts             the globals the build defines (__BROWSER__) and the content scripts leave on window
e2e/                     a Rust crate that loads dist/chrome-e2e into Chrome
```

**A feature is a folder with a `feature.json`.** The build finds `src/*/feature.json` (a folder with
`"enabled": false` is skipped) and, for each browser it lists (`"browsers"`, both by default):

* bundles `background` (a module) into the one background bundle, after `src/background/index.ts`;
* bundles each file of `scripts` on its own, as a classic script, to `dist/<browser>/<feature>/<file>.js`
  (content scripts, page scripts, a DevTools page script);
* bundles `panelViews` (a module that calls `registerView` from `src/ui/registry.ts`) into the panel;
* copies every other file (html, css, images) as it is, except `feature.json`, `*.md`, files starting with `_`
  and source files (`.ts` and `.js` are bundled, never copied);
* merges `manifest` (and `chrome` / `firefox`) into that browser's manifest. Arrays are joined without
  repeats, objects are merged, and two different values for one key stop the build, so features cannot
  silently override one another.

So **to add a page**, put the `.html` and its script in the feature folder, list the script under `scripts`, and
open it with `ext.runtime.getURL("<feature>/page.html")`; to make it reachable from a web page, declare
`web_accessible_resources` in the feature's `manifest`. **To add a permission**, put it in the feature's
`manifest` (`permissions`, `optional_permissions`, `optional_host_permissions`, ...) and add it to the allow
list in `scripts/lint.ts` on purpose. Static `host_permissions` and `content_scripts` are not used: the extension
injects its scripts into the tab you point it at (`activeTab`), or into any tab once you allow all sites.

**Messages** (`src/shared/protocol.ts`): `{ v: 1, type: "<feature>/<name>", ...payload }`, answered with
`{ ok: true, ...data }` or `{ ok: false, error }`. The panel talks to the background with
`ext.runtime.sendMessage`; a content script does the same; the background talks to a content script with
`ext.tabs.sendMessage`. A feature adds a type from its background module:

```ts
import { registerHandler, broadcast } from "../background/router.ts";
registerHandler("bridge/connect", async (message, sender) => ({ connected: true }), "ui"); // "ui" | "content" | "any"
```

A handler gets the message with every field `unknown` (a message is data from another context, so the handler
checks the fields it reads), and the panel's `ctx.call(type, payload)` is typed by the reply table `Replies` in
`protocol.ts`. The router refuses a message from the wrong kind of sender. After a change,
`broadcast(MSG.STATE_CHANGED, { area })` makes the panel's `ctx.onChange(area, fn)` run. Anything a feature keeps
goes through `src/background/store.ts`
(`local` survives a restart, `session` does not), and the background must not hold state in memory: the browser
stops and starts it.

## Safari

Safari is not built or tested: no converter is installed here. The route is Apple's converter, then Xcode:

```sh
xcrun safari-web-extension-converter dist/chrome --app-name "seleniumbase-rs Companion" --project-location ../safari
```

Build the generated project and turn the extension on in Safari's settings. Expect to review the manifest it
reports: Safari has no `sidePanel` and no DevTools Recorder, and may treat optional host access differently.

## Security

No remote code, no `eval` or `new Function` (the build and the tests check the output), a strict extension
CSP (`script-src 'self'`), no static host permissions, no `content_scripts` in the manifest. Page-derived text
is only ever put in the DOM as text, and into Rust only through `rustStr`. A content script's messages are
validated and bounded (`sanitizeStep`) before they are stored.

## Limits

Steps inside iframes and shadow roots are not recorded (a shadow host is recorded as the target). The recorder
follows the tab you started in, not other tabs. Only Chrome 155, Edge 155 and Firefox ESR 153.4 were run; see
`e2e/README.md` for what was and was not exercised in a real browser (the toolbar popup, the permission prompt,
the side panel and the DevTools Recorder's Export menu were not).

## Licence

MIT.
