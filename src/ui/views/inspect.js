// The Inspect view: start the picker on the page, and show the last pick.

import { h } from "../../shared/dom.js";
import { MSG } from "../../shared/protocol.js";
import { copyButton, renderPick } from "../../shared/pickview.js";
import { registerView } from "../registry.js";

registerView({
  id: "inspect",
  title: "Inspect",
  order: 20,
  render(root, ctx) {
    let last = null;

    async function pick() {
      try {
        const tab = await ctx.activeTab();
        await ctx.call(MSG.INSPECTOR_PICK, { tabId: tab.id });
        ctx.notify("Click an element on the page. Escape cancels.");
      } catch (error) {
        ctx.notify(error.message);
      }
    }

    async function refresh() {
      try {
        last = (await ctx.call(MSG.INSPECTOR_LAST)).last;
      } catch (error) {
        ctx.notify(error.message);
      }
      draw();
    }

    function draw() {
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
