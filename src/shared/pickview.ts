// How a picked element is shown: its selectors with match counts, and the calls
// for both engines. The picker overlay and the panel draw the same thing; each
// supplies its own CSS for the classes used here (row, badge, label, sub).

import type { Call } from "./calls.ts";
import { copyText } from "./clipboard.ts";
import { type Child, h } from "./dom.ts";
import type { PageArenaResult } from "./pagearena.ts";
import type { GeneratedCandidate } from "./selectors.ts";

/** What the picker found: the element, its selectors with match counts, and the calls for both engines. */
export interface PickResult {
  at?: number;
  url: string;
  title?: string;
  tag: string;
  role: string | null;
  name: string;
  text: string;
  inputType?: string | undefined;
  candidates: GeneratedCandidate[];
  best: string | null;
  calls: Call[];
  pageArena?: PageArenaResult | undefined;
}

function copyButton(text: string, what: string): HTMLButtonElement {
  // The visible word is "Copy"; the name says what is copied, and still starts with the word.
  const button = h("button", { type: "button", text: "Copy", title: `Copy ${what}`, "aria-label": `Copy ${what}` });
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

/** The picked element as DOM: see inspector/content.ts for where a pick comes from. */
export function renderPick(result: PickResult): Child[] {
  const hasMultiple = result.candidates.some((c) => c.count > 1);
  const selectors = result.candidates.map((c) => {
    const isUnique = c.count === 1;
    const badgeClass = isUnique ? "badge one" : "badge";
    const badgeText = isUnique ? "1 match (unique)" : `${c.count} matches (⚠️ non-unique)`;
    return h(
      "div",
      { class: "row" },
      h("span", { class: badgeClass, text: badgeText }),
      h("code", { text: c.syntax === "aria" ? `aria/${c.value}` : c.value }),
      copyButton(c.value, "selector"),
    );
  });

  const engine = (key: "cdp" | "basecase" | "thirtyfour", title: string) => {
    const availableCalls = result.calls.filter((c) => c[key] !== undefined);
    if (availableCalls.length === 0) return null;
    return h(
      "div",
      {},
      h("h3", { text: title }),
      availableCalls.map((c) =>
        h(
          "div",
          { class: "row" },
          h("span", { class: "label", text: c.label }),
          h("code", { text: c[key] as string }),
          copyButton(c[key] as string, `${title} call`),
        ),
      ),
    );
  };

  const pa = result.pageArena;
  const pageArenaCard = pa
    ? h(
        "div",
        {
          class: "card",
          style: "margin-top: 14px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card);",
        },
        h("h3", { style: "margin-top: 0;", text: "PageArena DOM Pruner & Token Counter" }),
        h(
          "div",
          { style: "display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 8px 0; text-align: center;" },
          h(
            "div",
            { style: "padding: 6px; border-radius: 6px; background: var(--code-bg);" },
            h("div", { class: "sub", style: "font-size: 11px;", text: "Raw HTML" }),
            h("strong", { text: `${pa.rawBytes} B` }),
            h("div", { class: "sub", style: "font-size: 10px;", text: `~${pa.rawTokens} tok` }),
          ),
          h(
            "div",
            { style: "padding: 6px; border-radius: 6px; background: var(--code-bg);" },
            h("div", { class: "sub", style: "font-size: 11px;", text: "Clean Markdown" }),
            h("strong", { text: `${pa.markdownBytes} B` }),
            h("div", { class: "sub", style: "font-size: 10px;", text: `~${pa.markdownTokens} tok` }),
          ),
          h(
            "div",
            { style: "padding: 6px; border-radius: 6px; background: var(--ok-bg); color: var(--ok-fg);" },
            h("div", { style: "font-size: 11px; font-weight: 500;", text: "Token Savings" }),
            h("strong", { text: `-${pa.savingsPercent}%` }),
            h("div", { style: "font-size: 10px;", text: `-${pa.savedTokens} tok` }),
          ),
        ),
        h(
          "div",
          { class: "bar" },
          copyButton(pa.markdown, "Clean Markdown"),
          copyButton(pa.rawHtml, "Raw HTML"),
        ),
        h("pre", { style: "max-height: 140px; font-size: 11px; white-space: pre-wrap;" }, h("code", { text: pa.markdown || "(empty)" })),
      )
    : null;

  return [
    h("h2", { text: `<${result.tag}>${result.role ? `  ${result.role}` : ""}${result.name ? `  "${result.name}"` : ""}` }),
    h("div", { class: "sub", text: result.url }),
    pageArenaCard,
    h("h3", { text: "Selectors" }),
    hasMultiple
      ? h("div", { class: "sub", style: "color: var(--warn-fg); font-size: 11px;", text: "⚠️ Some generated selectors match multiple elements. Prefer 1-match (unique) selectors to avoid brittle tests." })
      : null,
    selectors,
    result.calls.length > 0
      ? [engine("cdp", "Pure CDP (sb_cdp)"), engine("basecase", "BaseCase"), engine("thirtyfour", "thirtyfour (WebDriver)")]
      : h("div", { class: "sub", text: "No selector matches only this element." }),
  ];
}
