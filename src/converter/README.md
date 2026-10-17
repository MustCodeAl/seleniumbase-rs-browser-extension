# converter (placeholder)

The in-browser converter (Selenium IDE, Playwright, Puppeteer and Python SeleniumBase recordings to
seleniumbase-rs Rust). Nothing here yet.

To build it: turn on `feature.json` (remove `"enabled": false`), put the conversion in a module under
`src/shared/` if the recorder or the DevTools Recorder export should use it too (they already share
`src/shared/codegen/`: a converter that produces steps — see `src/shared/steps.js` — gets all three export
formats for free), add a panel tab with `"panelViews"`, and register any message types with `registerHandler`.

See "Layout and extension points" in the top-level README.
