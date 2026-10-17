// Ready-to-copy calls for a selector, for both seleniumbase-rs engines. The
// inspector shows these next to each selector; they follow the conventions of
// the code generators in codegen/.

import { rustStr } from "./rust.ts";

const TEXT_INPUTS = new Set<string | undefined>(["text", "search", "email", "tel", "url", "password", "number", "", undefined]);

/** One ready-to-copy call, written for both engines. */
export interface Call {
  label: string;
  cdp: string;
  basecase: string;
}

/** What is known of the element a call is for. */
export interface CallInfo {
  tag?: string | undefined;
  inputType?: string | undefined;
  text?: string | undefined;
}

/** The calls for `selector`, a selector string seleniumbase-rs reads (CSS, XPath, link=). */
export function callsFor(selector: string, info: CallInfo = {}): Call[] {
  const sel = rustStr(selector);
  const loc = `page.locator(${sel})`;
  const calls: Call[] = [
    { label: "click", cdp: `${loc}.click().await?;`, basecase: `sb.click(${sel}).await?;` },
  ];
  const tag = info.tag;
  const type = info.inputType;
  if (tag === "textarea" || (tag === "input" && TEXT_INPUTS.has(type))) {
    calls.push({
      label: "type",
      cdp: `${loc}.type_text("").await?;`,
      basecase: `sb.type_text(${sel}, "").await?;`,
    });
  }
  if (tag === "select") {
    calls.push({
      label: "select",
      cdp: `${loc}.select_option(SelectBy::Text("")).await?;`,
      basecase: `sb.select_option_by_text(${sel}, "").await?;`,
    });
  }
  if (tag === "input" && (type === "checkbox" || type === "radio")) {
    calls.push({ label: "check", cdp: `${loc}.check().await?;`, basecase: `sb.check_if_unchecked(${sel}).await?;` });
    calls.push({ label: "uncheck", cdp: `${loc}.uncheck().await?;`, basecase: `sb.uncheck_if_checked(${sel}).await?;` });
  }
  calls.push({ label: "hover", cdp: `${loc}.hover().await?;`, basecase: `sb.hover(${sel}).await?;` });
  calls.push({
    label: "wait visible",
    cdp: `${loc}.wait_for(State::Visible).await?;`,
    basecase: `sb.wait_for_element_visible(${sel}, 10).await?;`,
  });
  if (typeof info.text === "string" && info.text !== "") {
    const text = rustStr(info.text);
    calls.push({
      label: "assert text",
      cdp: `${loc}.expect().to_contain_text(${text}).await?;`,
      basecase: `sb.assert_text(${text}, ${sel}).await?;`,
    });
  }
  return calls;
}
