// The Diagnostics view: Anti-Bot & Fingerprint Leak Inspector, and one-click
// "Export Browser Profile / Fingerprint as Rust ContextOptions".

import { h } from "../../shared/dom.ts";
import { downloadFile } from "../../shared/download.ts";
import { errorText } from "../../shared/guards.ts";
import { MSG, type Replies } from "../../shared/protocol.ts";
import { copyButton } from "../../shared/pickview.ts";
import { evaluateAntiBot, type AntiBotSummary } from "../../shared/diagnostics.ts";
import { generateRustContextOptions, generateRustAntibotDetectorCode } from "../../shared/rust-context.ts";
import { registerView } from "../registry.ts";

const STATUS_CLASS: Record<string, string> = {
  pass: "match",
  warn: "unknown",
  fail: "differs",
  info: "match",
};

registerView({
  id: "diagnostics",
  title: "Diagnostics",
  order: 25,
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

    function exportRustCode(): void {
      if (!report) return;
      try {
        const generated = generateRustContextOptions(report.probe);
        downloadFile({
          filename: generated.filename,
          mime: "text/x-rust",
          text: generated.code,
        });
      } catch (error) {
        ctx.notify(`Could not export Rust file: ${errorText(error)}`);
      }
    }

    function renderSummary(summary: AntiBotSummary): HTMLElement {
      const scoreClass = summary.score >= 80 ? "match" : summary.score >= 50 ? "unknown" : "differs";
      return h(
        "div",
        { class: "bar", style: "justify-content: space-between; align-items: center; margin-bottom: 12px;" },
        h(
          "div",
          {},
          h("strong", { text: "Anti-Bot Stealth Score: " }),
          h("span", { class: `verdict ${scoreClass}`, text: `${summary.score} / 100` }),
        ),
        h(
          "div",
          { class: "sub" },
          h("span", { text: `${summary.passedChecks} passed, ${summary.leaksDetected} issue(s)` }),
        ),
      );
    }

    function renderItem(item: AntiBotSummary["items"][number]): HTMLElement {
      return h(
        "div",
        { class: "card", style: "margin: 8px 0; padding: 10px; border: 1px solid var(--line); border-radius: 8px;" },
        h(
          "div",
          { style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;" },
          h("strong", { text: item.name }),
          h("span", { class: `verdict ${STATUS_CLASS[item.status] ?? "unknown"}`, text: item.status.toUpperCase() }),
        ),
        h("div", { style: "font-weight: 500; margin: 4px 0;" }, h("span", { text: item.headline })),
        h("div", { class: "sub", style: "font-size: 12px;" }, h("span", { text: item.detail })),
        item.recommendation
          ? h(
              "div",
              { style: "margin-top: 6px; padding: 4px 8px; border-radius: 4px; background: var(--code-bg); font-size: 11px;" },
              h("strong", { text: "Mitigation: " }),
              h("span", { text: item.recommendation }),
            )
          : null,
      );
    }

    function renderRustSection(reportData: Replies[typeof MSG.INSPECTOR_PROBE]): HTMLElement {
      const generated = generateRustContextOptions(reportData.probe);
      const copyBtn = copyButton(generated.code, "Rust ContextOptions");
      const exportBtn = h("button", {
        type: "button",
        text: "Export .rs File",
        title: "Download context_options.rs",
        "aria-label": "Download context_options.rs",
        onclick: exportRustCode,
      });

      return h(
        "section",
        { style: "margin-top: 18px;" },
        h("h3", { text: "Rust ContextOptions & Fingerprint" }),
        h(
          "p",
          { class: "sub", text: "Ready-to-run Rust code using seleniumbase_rs::evasion::Fingerprint and ContextOptions." },
        ),
        h("div", { class: "bar" }, copyBtn, exportBtn),
        h("pre", { style: "max-height: 200px; font-size: 11px;" }, h("code", { text: generated.code })),
      );
    }

    function renderAntibotDetectorSection(reportData: Replies[typeof MSG.INSPECTOR_PROBE]): HTMLElement {
      const code = generateRustAntibotDetectorCode(reportData.probe.url ?? "https://example.com");
      const copyBtn = copyButton(code, "Rust AntibotDetector Script");
      const exportBtn = h("button", {
        type: "button",
        text: "Export detect_bot.rs",
        title: "Download detect_bot.rs",
        "aria-label": "Download detect_bot.rs",
        onclick: () => {
          downloadFile({
            filename: "detect_bot.rs",
            mime: "text/x-rust",
            text: code,
          });
        },
      });

      return h(
        "section",
        { style: "margin-top: 18px;" },
        h("h3", { text: "Rust antibot-detector Plugin Script" }),
        h(
          "p",
          { class: "sub", text: "Ready-to-run Rust script using the `antibot-detector` plugin crate (Cloudflare, DataDome, Akamai, Kasada, PerimeterX, etc.)." },
        ),
        h("div", { class: "bar" }, copyBtn, exportBtn),
        h("pre", { style: "max-height: 200px; font-size: 11px;" }, h("code", { text: code })),
      );
    }

    function draw(): void {
      const runBtn = h("button", {
        type: "button",
        class: "primary",
        text: running ? "Inspecting..." : report ? "Run Diagnostics Again" : "Inspect Anti-Bot & Leaks",
        disabled: running,
        onclick: () => void run(),
      });

      const parts: (Node | null)[] = [
        h("div", { class: "bar" }, runBtn),
      ];

      if (report) {
        const antiBotData = report.probe.antiBot ?? {
          webdriver: { flag: report.probe.navigator?.webdriver ?? null, overridden: false, nativeGetter: true },
          cdpFlags: { windowFlags: [], documentFlags: [], runtimeArtifacts: [] },
          webgl: {
            vendor: report.probe.webgl?.vendor ?? null,
            renderer: report.probe.webgl?.renderer ?? null,
            unmaskedVendor: report.probe.webgl?.unmaskedVendor ?? null,
            unmaskedRenderer: report.probe.webgl?.unmaskedRenderer ?? null,
            isSoftware: false,
            isTampered: false,
          },
          canvas: { noiseDetected: false, isTampered: false },
          turnstile: { detected: false, iframes: 0, widgetSelectors: [], apiPresent: false },
        };

        const summary = evaluateAntiBot(antiBotData);
        parts.push(renderSummary(summary));
        parts.push(h("div", {}, summary.items.map(renderItem)));
        parts.push(renderRustSection(report));
        parts.push(renderAntibotDetectorSection(report));
      } else {
        parts.push(
          h("p", {
            class: "empty",
            text: running
              ? "Running Anti-Bot and leak diagnostics..."
              : "Press 'Inspect Anti-Bot & Leaks' to evaluate navigator.webdriver, CDP cdc_* flags, WebGL spoofing, canvas noise, Turnstile presence, and generate Rust ContextOptions.",
          }),
        );
      }

      root.replaceChildren(...parts.filter((part): part is Node => part !== null));
    }

    draw();
    root.addEventListener("sbrs-run-diagnostics", () => void run());
  },
  show(root) {
    root.dispatchEvent(new Event("sbrs-run-diagnostics"));
  },
});
