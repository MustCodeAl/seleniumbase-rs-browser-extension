// The Inspect view: start the picker on the page, live selector uniqueness testing,
// PageArena DOM pruner preview, and show the last pick.

import { thirtyfourBy } from "../../shared/calls.ts";
import { h } from "../../shared/dom.ts";
import { errorText } from "../../shared/guards.ts";
import { MSG } from "../../shared/protocol.ts";
import { type PickResult, copyButton, renderPick } from "../../shared/pickview.ts";
import { rustStr } from "../../shared/rust.ts";
import { registerView } from "../registry.ts";

registerView({
  id: "inspect",
  title: "Inspect",
  order: 20,
  render(root, ctx) {
    let last: PickResult | null = null;
    let customSelector = "";
    let evalResult: { count: number; sample: string; error: string | null } | null = null;
    let evalTimeout: ReturnType<typeof setTimeout> | null = null;

    async function pick(): Promise<void> {
      try {
        const tab = await ctx.activeTab();
        await ctx.call(MSG.INSPECTOR_PICK, { tabId: tab.id });
        ctx.notify("Click an element on the page. Escape cancels.");
      } catch (error) {
        ctx.notify(errorText(error));
      }
    }

    async function refresh(): Promise<void> {
      try {
        last = (await ctx.call(MSG.INSPECTOR_LAST)).last;
      } catch (error) {
        ctx.notify(errorText(error));
      }
      draw();
    }

    async function testSelector(sel: string): Promise<void> {
      if (!sel.trim()) {
        evalResult = null;
        draw();
        return;
      }
      try {
        const tab = await ctx.activeTab();
        const res = await ctx.call(MSG.INSPECTOR_EVAL_SELECTOR, { tabId: tab.id, selector: sel.trim() });
        evalResult = { count: res.count, sample: res.sample, error: res.error };
      } catch (err) {
        evalResult = { count: 0, sample: "", error: errorText(err) };
      }
      draw();
    }

    function onSelectorInput(e: Event): void {
      const val = (e.target as HTMLInputElement).value;
      customSelector = val;
      if (evalTimeout) clearTimeout(evalTimeout);
      evalTimeout = setTimeout(() => {
        void testSelector(val);
      }, 250);
    }

    function renderSelectorTester(): HTMLElement {
      const input = h("input", {
        type: "text",
        value: customSelector,
        placeholder: "Live test selector: #id, [data-testid='...'], link=..., css=...",
        style: "width: 100%; min-width: 0; padding: 6px 10px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px;",
      }) as HTMLInputElement;
      input.addEventListener("input", onSelectorInput);

      const statusChildren: (Node | null)[] = [];
      if (evalResult) {
        if (evalResult.error) {
          statusChildren.push(
            h("div", { class: "problems", style: "margin: 6px 0;" }, h("span", { text: `Invalid selector: ${evalResult.error}` })),
          );
        } else if (evalResult.count === 1) {
          statusChildren.push(
            h(
              "div",
              { style: "margin: 6px 0; color: var(--ok-fg); display: flex; align-items: center; gap: 6px;" },
              h("span", { class: "badge one", text: "✅ 1 match (Unique)" }),
              h("span", { class: "sub", text: "Idiomatic and safe for robust automation." }),
            ),
          );
        } else if (evalResult.count > 1) {
          statusChildren.push(
            h(
              "div",
              { style: "margin: 6px 0; color: var(--warn-fg);" },
              h("span", { class: "badge", text: `⚠️ ${evalResult.count} matches (Non-Unique)` }),
              h("div", { class: "sub", style: "color: var(--warn-fg); font-size: 11px; margin-top: 2px;", text: "Warning: Non-unique selector will match multiple elements and may cause brittle tests." }),
            ),
          );
        } else {
          statusChildren.push(
            h("div", { style: "margin: 6px 0; color: var(--bad-fg);" }, h("span", { class: "badge", style: "background: var(--bad-bg); color: var(--bad-fg);", text: "0 matches in current DOM" })),
          );
        }

        if (evalResult.count > 0 && !evalResult.error) {
          const s = customSelector.trim();
          const selStr = rustStr(s);
          const by = thirtyfourBy(s);
          const cdpSnippet = `page.locator(${selStr}).click().await?;`;
          const basecaseSnippet = `sb.click(${selStr}).await?;`;
          const thirtyfourSnippet = `driver.find(${by}).await?.click().await?;`;

          statusChildren.push(
            h(
              "div",
              { style: "margin-top: 8px;" },
              h("div", { class: "row" }, h("span", { class: "label", text: "CDP" }), h("code", { text: cdpSnippet }), copyButton(cdpSnippet, "CDP snippet")),
              h("div", { class: "row" }, h("span", { class: "label", text: "BaseCase" }), h("code", { text: basecaseSnippet }), copyButton(basecaseSnippet, "BaseCase snippet")),
              h("div", { class: "row" }, h("span", { class: "label", text: "thirtyfour" }), h("code", { text: thirtyfourSnippet }), copyButton(thirtyfourSnippet, "thirtyfour snippet")),
            ),
          );
        }
      }

      return h(
        "div",
        {
          class: "card",
          style: "margin-bottom: 14px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card);",
        },
        h("h3", { style: "margin-top: 0;", text: "Rust Selector Generator & Live Uniqueness Testing" }),
        h("div", { style: "margin: 6px 0;" }, input),
        ...statusChildren,
      );
    }

    function draw(): void {
      const parts: (Node | null)[] = [
        h(
          "div",
          { class: "bar" },
          h("button", { type: "button", class: "primary", text: "Pick an element", onclick: pick }),
          last ? copyButton(JSON.stringify(last, null, 2), "the last pick as JSON") : null,
        ),
        renderSelectorTester(),
      ];

      if (last) {
        parts.push(h("div", {}, renderPick(last)));
      } else {
        parts.push(
          h("p", {
            class: "empty",
            text: "Press 'Pick an element' to inspect elements on the active page, preview PageArena clean Markdown and LLM tokens, generate thirtyfour / seleniumbase-rs selectors, and test selector uniqueness live.",
          }),
        );
      }

      root.replaceChildren(...parts.filter((p): p is Node => p !== null));
    }

    ctx.onChange("inspector", () => void refresh());
    draw();
    void refresh();
  },
});
