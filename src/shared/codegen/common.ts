// What the Rust generators share.

import { commentText, envName, rustStr } from "../rust.ts";
import type { Step } from "../steps.ts";

/** How a program starts: a `#[tokio::test]` function, or `#[tokio::main]`. */
export type Entry = "test" | "main";

/** What the program generators take besides the steps. */
export interface ProgramOptions {
  entry?: Entry | undefined;
  name?: string | undefined;
}

/** The Selenium `Keys` code points (private use area) the WebDriver engine takes in `send_keys`. */
export const SELENIUM_KEYS: Readonly<Record<string, string>> = {
  Enter: "",
  Tab: "",
  Escape: "",
  Backspace: "",
  Delete: "",
  ArrowUp: "",
  ArrowDown: "",
  ArrowLeft: "",
  ArrowRight: "",
  Home: "",
  End: "",
  PageUp: "",
  PageDown: "",
};

/** The `sb_cdp::Key` variants. */
export const CDP_KEYS: ReadonlySet<string> = new Set(Object.keys(SELENIUM_KEYS));

/** A finite number as an integer literal, or null. Numbers only: text never becomes code. */
export function intLiteral(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e9) return null;
  return String(Math.trunc(n));
}

export function skipped(reason: string): string {
  return `// skipped: ${commentText(reason)}`;
}

/** The comment that says a field's value was not recorded, and the variable that supplies it. */
export function secretNote(step: Step): { variable: string; comment: string } {
  const variable = envName(step.secret ?? "");
  return { variable, comment: `// the value of this field was not recorded: set ${variable}` };
}

/** The comment lines for a file input: the recording keeps the name, not the path. */
export function filesTodo(names: string[] | undefined, callText: string): string[] {
  const list = (names ?? []).map((n) => rustStr(n)).join(", ");
  return [
    `// TODO: choose the file${(names ?? []).length === 1 ? "" : "s"} ${commentText(list)}; the recording keeps the name, not the path`,
    `// ${commentText(callText)}`,
  ];
}

export function entryAttribute(entry: Entry, ident: string): string {
  return entry === "main" ? "#[tokio::main]\nasync fn main()" : `#[tokio::test]\nasync fn ${ident}()`;
}
