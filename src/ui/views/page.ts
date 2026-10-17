// The Page view: what this page sees, from the page's own world.

import { h } from "../../shared/dom.ts";
import type { PageProbe } from "../../shared/fingerprint.ts";
import { errorText } from "../../shared/guards.ts";
import { MSG, type Replies } from "../../shared/protocol.ts";
import { copyButton } from "../../shared/pickview.ts";
import { registerView } from "../registry.ts";

function fact(label: string, value: unknown) {
  const text = value === null || value === undefined ? "n/a" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return h("tr", {}, h("th", { text: label }), h("td", {}, h("code", { text })));
}

function facts(probe: PageProbe) {
  const nav = probe.navigator ?? {};
  const gl = probe.webgl;
  const hints = probe.userAgentData;
  return [
    fact("navigator.webdriver", nav.webdriver),
    fact("User agent", nav.userAgent),
    fact("Client hints", hints ? { brands: hints.brands, mobile: hints.mobile, platform: hints.platform, ...hints.high } : null),
    fact("Languages", nav.languages),
    fact("Platform", nav.platform),
    fact("Hardware concurrency", nav.hardwareConcurrency),
    fact("Device memory", nav.deviceMemory),
    fact("Screen", probe.screen),
    fact("Window", probe.window),
    fact("Pixel ratio", probe.devicePixelRatio),
    fact("Time zone", probe.timezone),
    fact("WebGL vendor", gl ? (gl.unmaskedVendor ?? gl.vendor) : null),
    fact("WebGL renderer", gl ? (gl.unmaskedRenderer ?? gl.renderer) : null),
    fact("Canvas hash", probe.canvas ? `${probe.canvas.hash} (${probe.canvas.algorithm})` : null),
    fact("Plugins / mime types", `${nav.pluginsCount} / ${nav.mimeTypesCount}`),
    fact("Permissions", probe.permissions),
    fact("Headless markers", probe.headless ? (probe.headless.markers.length > 0 ? probe.headless.markers.join(", ") : "none") : null),
  ];
}

registerView({
  id: "page",
  title: "Page",
  order: 30,
  render(root, ctx) {
    let report: Replies[typeof MSG.INSPECTOR_PROBE] | null = null;
    let running = false;

    async function run(): Promise<void> {
      if (running) return;
      running = true;
      ctx.notify(null);
      draw();
      try {
        const tab = await ctx.activeTab();
        report = await ctx.call(MSG.INSPECTOR_PROBE, { tabId: tab.id });
      } catch (error) {
        report = null;
        ctx.notify(errorText(error));
      } finally {
        running = false;
        draw();
      }
    }

    function draw(): void {
      root.replaceChildren(
        h(
          "div",
          { class: "bar" },
          h("button", { type: "button", class: "primary", text: running ? "Reading..." : "Read this page", disabled: running, onclick: run }),
          report ? copyButton(JSON.stringify(report.fingerprint, null, 2), "Fingerprint JSON") : null,
          report ? h("span", { class: "sub", text: "Fingerprint JSON" }) : null,
          report ? copyButton(JSON.stringify(report.probe, null, 2), "the full report") : null,
          report ? h("span", { class: "sub", text: "full report" }) : null,
        ),
        ...(report
          ? [
              h("p", { text: `What ${report.probe.url ?? "the page"} sees. The Fingerprint JSON has the fields of seleniumbase-rs's Fingerprint that this browser answers.` }),
              h("table", {}, facts(report.probe)),
            ]
          : [h("p", { class: "empty", text: running ? "Reading the page..." : "Press Read this page to see what the page's scripts see: navigator, client hints, screen, time zone, WebGL, canvas, permissions and headless markers." })]),
      );
    }

    draw();
    root.dataset.run = "";
    root.addEventListener("sbrs-run", run);
  },
  show(root) {
    root.dispatchEvent(new Event("sbrs-run"));
  },
});
