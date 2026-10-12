// The BaseCase generator: a recording as a seleniumbase-rs WebDriver test.
// The program has the shape of `ActionRecorder::to_rust_test` (src/api/recorder.rs
// in seleniumbase-rs): a `BaseCase` made from the default `BrowserConfig`, one
// `sb.<method>` call per step, then `quit`.

import { fnIdent, rustStr } from "../rust.js";
import { pickSelector } from "../steps.js";
import { SELENIUM_KEYS, entryAttribute, filesTodo, intLiteral, secretNote, skipped } from "./common.js";

/**
 * The statements for one step, without indentation.
 * @returns {{lines: string[]}}
 */
export function basecaseStatements(s) {
  const lines = [];
  const selector = pickSelector(s);
  const sel = selector === null ? null : rustStr(selector);
  const needTarget = () => {
    if (sel !== null) return true;
    lines.push(skipped(`${s.type} has no selector`));
    return false;
  };

  switch (s.type) {
    case "navigate":
      if (typeof s.url !== "string" || s.url === "") lines.push(skipped("navigate has no url"));
      else lines.push(`sb.open(${rustStr(s.url)}).await?;`);
      break;
    case "click":
      if (needTarget()) lines.push(`sb.click(${sel}).await?;`);
      break;
    case "doubleClick":
      if (needTarget()) lines.push(`sb.double_click(${sel}).await?;`);
      break;
    case "rightClick":
      if (needTarget()) lines.push(`sb.context_click(${sel}).await?;`);
      break;
    case "hover":
      if (needTarget()) lines.push(`sb.hover(${sel}).await?;`);
      break;
    case "scrollIntoView":
      if (needTarget()) lines.push(`sb.scroll_into_view(${sel}).await?;`);
      break;
    case "change":
    case "setValue":
      if (needTarget()) {
        if (s.type === "change" && s.sensitive) {
          const { variable, comment } = secretNote(s);
          lines.push(comment);
          lines.push(`sb.type_text(${sel}, &std::env::var(${rustStr(variable)}).unwrap_or_default()).await?;`);
        } else {
          lines.push(`sb.type_text(${sel}, ${rustStr(s.value ?? "")}).await?;`);
        }
      }
      break;
    case "select":
      if (needTarget()) {
        if (typeof s.text === "string" && s.text !== "") {
          lines.push(`sb.select_option_by_text(${sel}, ${rustStr(s.text)}).await?;`);
        } else if (typeof s.value === "string" && s.value !== "") {
          lines.push(`sb.select_option_by_value(${sel}, ${rustStr(s.value)}).await?;`);
        } else {
          const index = intLiteral(s.index);
          if (index !== null && Number(index) >= 0) lines.push(`sb.select_option_by_index(${sel}, ${index}).await?;`);
          else lines.push(skipped("select has no option"));
        }
      }
      break;
    case "check":
      if (needTarget()) lines.push(`sb.check_if_unchecked(${sel}).await?;`);
      break;
    case "uncheck":
      if (needTarget()) lines.push(`sb.uncheck_if_checked(${sel}).await?;`);
      break;
    case "keyPress": {
      const key = typeof s.key === "string" ? (SELENIUM_KEYS[s.key] ?? (Array.from(s.key).length === 1 ? s.key : null)) : null;
      if (key === null) lines.push(skipped(`key ${rustStr(String(s.key ?? ""))} cannot be sent`));
      else lines.push(`sb.send_keys(${sel ?? '"body"'}, ${rustStr(key)}).await?;`);
      break;
    }
    case "setFiles":
      lines.push(
        ...filesTodo(s.names, `sb.choose_file(${sel ?? '"..."'}, "path/to/the/file").await?;`),
      );
      break;
    case "scroll": {
      const x = intLiteral(s.x);
      const y = intLiteral(s.y);
      if (x === null || y === null) lines.push(skipped("scroll has no numeric position"));
      else lines.push(`sb.execute_script(${rustStr(`window.scrollTo(${x}, ${y})`)}).await?;`);
      break;
    }
    case "viewport": {
      const w = intLiteral(s.width);
      const h = intLiteral(s.height);
      if (w === null || h === null || Number(w) <= 0 || Number(h) <= 0) lines.push(skipped("viewport has no size"));
      else lines.push(`sb.set_window_size(${w}, ${h}).await?;`);
      break;
    }
    case "waitFor":
      if (needTarget()) {
        const method = s.visible === false ? "wait_for_element_present" : "wait_for_element_visible";
        lines.push(`sb.${method}(${sel}, 10).await?;`);
      }
      break;
    case "unsupported":
      lines.push(skipped(s.description ?? "a step with no equivalent"));
      break;
    default:
      lines.push(skipped(`unknown step ${rustStr(String(s.type))}`));
  }
  return { lines };
}

/**
 * The whole program.
 * @param {object[]} steps
 * @param {{entry?: "test"|"main", name?: string}} [options]
 */
export function basecaseProgram(steps, options = {}) {
  const entry = options.entry === "main" ? "main" : "test";
  let body = "";
  for (const s of steps) {
    for (const line of basecaseStatements(s).lines) body += `    ${line}\n`;
  }
  const head = entryAttribute(entry, fnIdent(options.name ?? "recorded_test"));
  return (
    "use seleniumbase_rs::{BaseCase, BrowserConfig};\n\n" +
    `${head} -> Result<(), Box<dyn std::error::Error>> {\n` +
    "    let mut sb = BaseCase::new(BrowserConfig::default()).await?;\n" +
    `${body}    sb.quit().await?;\n    Ok(())\n}\n`
  );
}
