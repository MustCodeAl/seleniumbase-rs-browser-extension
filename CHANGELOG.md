# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- The source is strict TypeScript (`src/`, `scripts/`, `tests/`), bundled by Bun into the same `dist/` layout.
  `bun run typecheck` and `bun run lint` check it; `any` needs a `// any: <why>` comment.
- The exports are written for seleniumbase-rs 0.5.0: a pure CDP test types into a field with `type_text` alone (it
  empties the field first, so the `clear()` before it is gone), the assert text call takes the text first, and the
  e2e crate compiles the exports against 0.5.0.

### Added

- One Manifest V3 source tree built by `scripts/build.ts` into `dist/chrome` (Chrome, Edge) and `dist/firefox`,
  with a zip of each.
- Recorder: clicks, double clicks, typing, selects, checkboxes, key presses, file inputs (names only) and
  optional scrolls; edit, reorder and delete steps; export as a seleniumbase-rs pure CDP test, a BaseCase test
  or a Chrome DevTools Recorder JSON file.
- Inspector: an element picker with selectors and their match counts, calls for both engines, and a
  "what this page sees" report that copies as `Fingerprint`-shaped JSON.
- Chrome DevTools Recorder export plugin ("seleniumbase-rs (pure CDP)" and "(BaseCase)").
- Selector generation that prefers test ids, ids, names, aria labels, role plus name and short stable CSS, checks
  every candidate for uniqueness, and never uses generated-looking classes or ids.
- Placeholders for the live bridge (`src/bridge`) and the in-browser converter (`src/converter`).
