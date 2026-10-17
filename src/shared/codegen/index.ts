// One entry point for every export format.

import type { ExportedFile } from "../protocol.ts";
import { testIdent } from "../rust.ts";
import type { Step } from "../steps.ts";
import { basecaseProgram } from "./basecase.ts";
import { cdpProgram } from "./cdp.ts";
import type { Entry } from "./common.ts";
import { type Viewport, toReplay } from "./replay.ts";

export type ExportFormat = "cdp" | "basecase" | "devtools";

export interface FormatSpec {
  id: ExportFormat;
  label: string;
  extension: string;
  mime: string;
}

/** The export formats, in the order a person sees them. */
export const FORMATS: readonly FormatSpec[] = [
  { id: "cdp", label: "seleniumbase-rs pure CDP (Rust)", extension: "rs", mime: "text/x-rust" },
  { id: "basecase", label: "seleniumbase-rs BaseCase (Rust)", extension: "rs", mime: "text/x-rust" },
  { id: "devtools", label: "Chrome DevTools Recorder (JSON)", extension: "json", mime: "application/json" },
];

/** Whether `value` names an export format. */
export function isExportFormat(value: unknown): value is ExportFormat {
  return FORMATS.some((f) => f.id === value);
}

/** What `generate` takes besides the steps. */
export interface GenerateOptions {
  name?: string | undefined;
  entry?: Entry | undefined;
  viewport?: Viewport | undefined;
}

/** Export `steps` in a format. */
export function generate(format: ExportFormat, steps: Step[], options: GenerateOptions = {}): ExportedFile {
  const spec = FORMATS.find((f) => f.id === format);
  if (!spec) throw new Error(`unknown export format ${JSON.stringify(format)}`);
  const ident = testIdent(options.name ?? "", "recorded_test");
  let text: string;
  if (format === "cdp") {
    text = cdpProgram(steps, { entry: options.entry, name: ident });
  } else if (format === "basecase") {
    text = basecaseProgram(steps, { entry: options.entry, name: ident });
  } else {
    text = `${JSON.stringify(toReplay(steps, { title: options.name || "Recording", viewport: options.viewport }), null, 2)}\n`;
  }
  return { filename: `${ident}.${spec.extension}`, mime: spec.mime, text };
}
