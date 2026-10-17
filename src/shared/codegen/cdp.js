// The pure CDP generator: a recording as a seleniumbase-rs `sb_cdp` program.
// The program has the shape of `ActionRecorder::to_cdp_script` (src/api/recorder/cdp.rs
// in seleniumbase-rs): the imports, an entry function, a Browser launched with
// default options, its first Page, then one Page or Locator call per step.
//
// Every selector and value goes in through `rustStr`, so recorded text cannot
// become code.

import { fnIdent, rustStr } from "../rust.js";
import { pickSelector } from "../steps.js";
import { CDP_KEYS, entryAttribute, filesTodo, intLiteral, secretNote, skipped } from "./common.js";

/**
 * The statements for one step, without indentation, and the `sb_cdp` names they use.
 * @returns {{lines: string[], imports: string[]}}
 */
export function cdpStatements(s) {
  const lines = [];
  const imports = [];
  const out = () => ({ lines, imports });
  const selector = pickSelector(s);
  const loc = selector === null ? null : `page.locator(${rustStr(selector)})`;
  const needTarget = () => {
    if (loc !== null) return true;
    lines.push(skipped(`${s.type} has no selector`));
    return false;
  };

  switch (s.type) {
    case "navigate":
      if (typeof s.url !== "string" || s.url === "") lines.push(skipped("navigate has no url"));
      else lines.push(`page.goto(${rustStr(s.url)}).await?;`);
      break;
    case "click":
      if (needTarget()) lines.push(`${loc}.click().await?;`);
      break;
    case "doubleClick":
      if (needTarget()) lines.push(`${loc}.double_click().await?;`);
      break;
    case "rightClick":
      if (needTarget()) lines.push(`${loc}.right_click().await?;`);
      break;
    case "hover":
      if (needTarget()) lines.push(`${loc}.hover().await?;`);
      break;
    case "scrollIntoView":
      if (needTarget()) lines.push(`${loc}.scroll_into_view().await?;`);
      break;
    case "change":
      if (needTarget()) {
        // `Locator::type_text` empties the field and then types, as `BaseCase::type_text`
        // does (ActionRecorder::to_cdp_script writes it alone), so nothing clears it first.
        if (s.sensitive) {
          const { variable, comment } = secretNote(s);
          lines.push(comment);
          lines.push(`${loc}.type_text(std::env::var(${rustStr(variable)}).unwrap_or_default()).await?;`);
        } else {
          lines.push(`${loc}.type_text(${rustStr(s.value ?? "")}).await?;`);
        }
      }
      break;
    case "setValue":
      if (needTarget()) lines.push(`${loc}.set_value(${rustStr(s.value ?? "")}).await?;`);
      break;
    case "select":
      if (needTarget()) {
        imports.push("SelectBy");
        const index = intLiteral(s.index);
        let by;
        if (typeof s.text === "string" && s.text !== "") by = `SelectBy::Text(${rustStr(s.text)})`;
        else if (typeof s.value === "string" && s.value !== "") by = `SelectBy::Value(${rustStr(s.value)})`;
        else if (index !== null && Number(index) >= 0) by = `SelectBy::Index(${index})`;
        else by = `SelectBy::Text("")`;
        lines.push(`${loc}.select_option(${by}).await?;`);
      }
      break;
    case "check":
      if (needTarget()) lines.push(`${loc}.check().await?;`);
      break;
    case "uncheck":
      if (needTarget()) lines.push(`${loc}.uncheck().await?;`);
      break;
    case "keyPress":
      if (!CDP_KEYS.has(s.key)) {
        lines.push(skipped(`key ${rustStr(String(s.key ?? ""))} has no sb_cdp Key`));
      } else {
        imports.push("Key");
        lines.push(`${loc ?? "page.keyboard()"}.press(Key::${s.key}).await?;`);
      }
      break;
    case "setFiles":
      lines.push(
        ...filesTodo(s.names, `${loc ?? "page.locator(...)"}: set the file input to the file's path`),
      );
      break;
    case "scroll": {
      const x = intLiteral(s.x);
      const y = intLiteral(s.y);
      if (x === null || y === null) lines.push(skipped("scroll has no numeric position"));
      else lines.push(`page.evaluate(${rustStr(`window.scrollTo(${x}, ${y})`)}).await?;`);
      break;
    }
    case "viewport": {
      const w = intLiteral(s.width);
      const h = intLiteral(s.height);
      if (w === null || h === null || Number(w) <= 0 || Number(h) <= 0) lines.push(skipped("viewport has no size"));
      else lines.push(`page.window().set_bounds(0, 0, ${w}, ${h}).await?;`);
      break;
    }
    case "waitFor":
      if (needTarget()) {
        imports.push("State");
        lines.push(`${loc}.wait_for(State::${s.visible === false ? "Present" : "Visible"}).await?;`);
      }
      break;
    case "unsupported":
      lines.push(skipped(s.description ?? "a step with no equivalent"));
      break;
    default:
      lines.push(skipped(`unknown step ${rustStr(String(s.type))}`));
  }
  // The step loaded a page as its effect: wait for it before the next step.
  if (s.navigates === true && s.type !== "navigate") lines.push("page.wait_for_load().await?;");
  return out();
}

/**
 * The whole program.
 * @param {object[]} steps
 * @param {{entry?: "test"|"main", name?: string}} [options]
 */
export function cdpProgram(steps, options = {}) {
  const entry = options.entry === "main" ? "main" : "test";
  const imports = new Set(["Browser", "LaunchOptions"]);
  let body = "";
  for (const s of steps) {
    const { lines, imports: used } = cdpStatements(s);
    for (const name of used) imports.add(name);
    for (const line of lines) body += `    ${line}\n`;
  }
  const names = [...imports].sort().join(", ");
  const head = entryAttribute(entry, fnIdent(options.name ?? "recorded_test"));
  return (
    `use seleniumbase_rs::sb_cdp::{${names}};\n\n` +
    `${head} -> Result<(), Box<dyn std::error::Error>> {\n` +
    `    let browser = Browser::launch(LaunchOptions::builder().build()?).await?;\n` +
    `    let page = browser.default_page().await?;\n` +
    `${body}    browser.close().await?;\n    Ok(())\n}\n`
  );
}
