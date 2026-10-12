// One entry point for every export format.

import { testIdent } from "../rust.js";
import { basecaseProgram } from "./basecase.js";
import { cdpProgram } from "./cdp.js";
import { toReplay } from "./replay.js";

/** The export formats, in the order a person sees them. */
export const FORMATS = [
  { id: "cdp", label: "seleniumbase-rs pure CDP (Rust)", extension: "rs", mime: "text/x-rust" },
  { id: "basecase", label: "seleniumbase-rs BaseCase (Rust)", extension: "rs", mime: "text/x-rust" },
  { id: "devtools", label: "Chrome DevTools Recorder (JSON)", extension: "json", mime: "application/json" },
];

/**
 * Export `steps` in a format.
 * @param {"cdp"|"basecase"|"devtools"} format
 * @param {object[]} steps
 * @param {{name?: string, entry?: "test"|"main", viewport?: {width: number, height: number}}} [options]
 * @returns {{filename: string, mime: string, text: string}}
 */
export function generate(format, steps, options = {}) {
  const spec = FORMATS.find((f) => f.id === format);
  if (!spec) throw new Error(`unknown export format ${JSON.stringify(format)}`);
  const ident = testIdent(options.name ?? "", "recorded_test");
  let text;
  if (format === "cdp") {
    text = cdpProgram(steps, { entry: options.entry, name: ident });
  } else if (format === "basecase") {
    text = basecaseProgram(steps, { entry: options.entry, name: ident });
  } else {
    text = `${JSON.stringify(toReplay(steps, { title: options.name || "Recording", viewport: options.viewport }), null, 2)}\n`;
  }
  return { filename: `${ident}.${spec.extension}`, mime: spec.mime, text };
}
