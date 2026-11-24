// Ready-to-copy calls for a selector, for both seleniumbase-rs engines. The
// inspector shows these next to each selector; they follow the conventions of
// the code generators in codegen/.

import { rustStr } from "./rust.ts";

const TEXT_INPUTS = new Set<string | undefined>(["text", "search", "email", "tel", "url", "password", "number", "", undefined]);

/** One ready-to-copy call, written for pure CDP, BaseCase and thirtyfour. */
export interface Call {
  label: string;
  cdp: string;
  basecase: string;
  thirtyfour?: string;
}

/** Formats selector as an idiomatic thirtyfour `By` expression. */
export function thirtyfourBy(selector: string): string {
  if (selector.startsWith("#") && !/[ .>+~:[\]]/.test(selector.slice(1))) {
    return `By::Id(${rustStr(selector.slice(1))})`;
  }
  if (selector.startsWith("link=")) {
    return `By::LinkText(${rustStr(selector.slice(5))})`;
  }
  if (selector.startsWith("/") || selector.startsWith("./") || selector.startsWith("(")) {
    return `By::XPath(${rustStr(selector)})`;
  }
  return `By::Css(${rustStr(selector)})`;
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
  const by = thirtyfourBy(selector);

  const calls: Call[] = [
    {
      label: "click",
      cdp: `${loc}.click().await?;`,
      basecase: `sb.click(${sel}).await?;`,
      thirtyfour: `driver.find(${by}).await?.click().await?;`,
    },
  ];
  const tag = info.tag;
  const type = info.inputType;
  if (tag === "textarea" || (tag === "input" && TEXT_INPUTS.has(type))) {
    calls.push({
      label: "type",
      cdp: `${loc}.type_text("").await?;`,
      basecase: `sb.type_text(${sel}, "").await?;`,
      thirtyfour: `driver.find(${by}).await?.send_keys("").await?;`,
    });
  }
  if (tag === "select") {
    calls.push({
      label: "select",
      cdp: `${loc}.select_option(SelectBy::Text("")).await?;`,
      basecase: `sb.select_option_by_text(${sel}, "").await?;`,
      thirtyfour: `driver.find(${by}).await?.click().await?;`,
    });
  }
  if (tag === "input" && (type === "checkbox" || type === "radio")) {
    calls.push({
      label: "check",
      cdp: `${loc}.check().await?;`,
      basecase: `sb.check_if_unchecked(${sel}).await?;`,
      thirtyfour: `driver.find(${by}).await?.click().await?;`,
    });
    calls.push({
      label: "uncheck",
      cdp: `${loc}.uncheck().await?;`,
      basecase: `sb.uncheck_if_checked(${sel}).await?;`,
      thirtyfour: `driver.find(${by}).await?.click().await?;`,
    });
  }
  calls.push({
    label: "hover",
    cdp: `${loc}.hover().await?;`,
    basecase: `sb.hover(${sel}).await?;`,
    thirtyfour: `driver.action_chain().move_to_element_center(&driver.find(${by}).await?).perform().await?;`,
  });
  calls.push({
    label: "wait visible",
    cdp: `${loc}.wait_for(State::Visible).await?;`,
    basecase: `sb.wait_for_element_visible(${sel}, 10).await?;`,
    thirtyfour: `driver.find(${by}).await?.wait_until().displayed().await?;`,
  });
  if (typeof info.text === "string" && info.text !== "") {
    const text = rustStr(info.text);
    calls.push({
      label: "assert text",
      cdp: `${loc}.expect().to_contain_text(${text}).await?;`,
      basecase: `sb.assert_text(${text}, ${sel}).await?;`,
      thirtyfour: `assert!(driver.find(${by}).await?.text().await?.contains(${text}));`,
    });
  }
  return calls;
}
