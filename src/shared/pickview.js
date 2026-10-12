// How a picked element is shown: its selectors with match counts, and the calls
// for both engines. The picker overlay and the panel draw the same thing; each
// supplies its own CSS for the classes used here (row, badge, label, sub).

import { copyText } from "./clipboard.js";
import { h } from "./dom.js";

function copyButton(text, what) {
  const button = h("button", { type: "button", text: "Copy", title: `Copy ${what}` });
  button.addEventListener("click", async () => {
    const done = await copyText(text);
    button.textContent = done ? "Copied" : "Press Ctrl+C";
    setTimeout(() => {
      button.textContent = "Copy";
    }, 1200);
  });
  return button;
}

export { copyButton };

/** @param {object} result  a pick result (see inspector/content.js) */
export function renderPick(result) {
  const selectors = result.candidates.map((c) =>
    h(
      "div",
      { class: "row" },
      h("span", { class: `badge${c.count === 1 ? " one" : ""}`, text: `${c.count} ${c.count === 1 ? "match" : "matches"}` }),
      h("code", { text: c.syntax === "aria" ? `aria/${c.value}` : c.value }),
      copyButton(c.value, "selector"),
    ),
  );
  const engine = (key, title) =>
    h(
      "div",
      {},
      h("h3", { text: title }),
      result.calls.map((c) =>
        h(
          "div",
          { class: "row" },
          h("span", { class: "label", text: c.label }),
          h("code", { text: c[key] }),
          copyButton(c[key], `${title} call`),
        ),
      ),
    );
  return [
    h("h2", { text: `<${result.tag}>${result.role ? `  ${result.role}` : ""}${result.name ? `  "${result.name}"` : ""}` }),
    h("div", { class: "sub", text: result.url }),
    h("h3", { text: "Selectors" }),
    selectors,
    result.calls.length > 0
      ? [engine("cdp", "Pure CDP (sb_cdp)"), engine("basecase", "BaseCase")]
      : h("div", { class: "sub", text: "No selector matches only this element." }),
  ];
}
