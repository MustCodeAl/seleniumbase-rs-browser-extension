// The Inspect view: start the picker on the page, and show the last pick.

import { h } from "../../shared/dom.ts";
import { errorText } from "../../shared/guards.ts";
import { MSG } from "../../shared/protocol.ts";
import { type PickResult, copyButton, renderPick } from "../../shared/pickview.ts";
import { registerView } from "../registry.ts";

registerView({
  id: "inspect",
  title: "Inspect",
  order: 20,
  render(root, ctx) {
    let last: PickResult | null = null;

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

    function draw(): void {
      root.replaceChildren(
        h(
          "div",
          { class: "bar" },
          h("button", { type: "button", class: "primary", text: "Pick an element", onclick: pick }),
          last ? copyButton(JSON.stringify(last, null, 2), "the last pick as JSON") : null,
        ),
        last
          ? h("div", {}, renderPick(last))
          : h("p", { class: "empty", text: "Press Pick an element, then hover over the page and click what you want. Its selectors appear here, each with the number of elements it matches, with calls to copy for both engines." }),
      );
    }

    ctx.onChange("inspector", () => void refresh());
    draw();
    void refresh();
  },
});
