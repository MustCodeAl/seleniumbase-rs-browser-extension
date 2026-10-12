// What the Rust generators share.

import { commentText, envName, rustStr } from "../rust.js";

/** The Selenium `Keys` code points (private use area) the WebDriver engine takes in `send_keys`. */
export const SELENIUM_KEYS = {
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
export const CDP_KEYS = new Set(Object.keys(SELENIUM_KEYS));

/** A finite number as an integer literal, or null. Numbers only: text never becomes code. */
export function intLiteral(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e9) return null;
  return String(Math.trunc(n));
}

export function skipped(reason) {
  return `// skipped: ${commentText(reason)}`;
}

/** The comment that says a field's value was not recorded, and the variable that supplies it. */
export function secretNote(step) {
  const variable = envName(step.secret ?? "");
  return { variable, comment: `// the value of this field was not recorded: set ${variable}` };
}

/** The comment lines for a file input: the recording keeps the name, not the path. */
export function filesTodo(names, callText) {
  const list = (names ?? []).map((n) => rustStr(n)).join(", ");
  return [
    `// TODO: choose the file${(names ?? []).length === 1 ? "" : "s"} ${commentText(list)}; the recording keeps the name, not the path`,
    `// ${commentText(callText)}`,
  ];
}

export function entryAttribute(entry, ident) {
  return entry === "main" ? "#[tokio::main]\nasync fn main()" : `#[tokio::test]\nasync fn ${ident}()`;
}
