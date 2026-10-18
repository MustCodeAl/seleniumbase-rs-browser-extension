// The Page view: what this page sees, from the page's own world. The page's
// fingerprint (seleniumbase-rs's Fingerprint JSON, API v2) can be copied, saved as a
// file, and compared with a file the person picks. Everything happens in the panel:
// the file is read here and nothing is sent anywhere.

import { h } from "../../shared/dom.ts";
import { downloadFile } from "../../shared/download.ts";
import { type PageProbe, fingerprintFile, fingerprintFilename, fingerprintText } from "../../shared/fingerprint.ts";
import { type Reading, type Verdict, compareFingerprints, readFingerprint, readFingerprintFile } from "../../shared/fingerprint-file.ts";
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

const VERDICT_CLASS: Record<Verdict, string> = { match: "match", differs: "differs", "not observable": "unknown" };

/** What the comparison of an imported file says, as the Page tab shows it. */
function comparisonView(name: string, imported: Reading, report: Replies[typeof MSG.INSPECTOR_PROBE] | null, forget: () => void): HTMLElement {
  const clear = h("button", { type: "button", text: "Clear", "aria-label": "Clear the comparison", onclick: forget });
  const problems = (title: string, list: string[]): HTMLElement =>
    h(
      "section",
      { class: "compare", "aria-label": "Imported fingerprint" },
      h("div", { class: "problems", role: "alert" }, h("strong", { text: title }), h("ul", {}, list.map((text) => h("li", { text })))),
      h("div", { class: "bar" }, clear),
    );
  if (!imported.ok) return problems(`${name} is not a seleniumbase-rs 0.5 fingerprint.`, imported.problems);
  if (!report) {
    return h("section", { class: "compare", "aria-label": "Imported fingerprint" }, h("p", { class: "empty", text: `${name} is a version 2 fingerprint. Read the page to compare it.` }), h("div", { class: "bar" }, clear));
  }
  const page = readFingerprint(report.fingerprint);
  if (!page.ok) return problems("The page's own report could not be read as a fingerprint.", page.problems);
  const result = compareFingerprints(imported.fingerprint, page.fingerprint);
  const { match, differs } = result.counts;
  const undecided = result.counts["not observable"];
  const summary =
    result.rows.length === 0
      ? `${name} leaves every setting to the browser, so there is nothing to compare.`
      : `${match} match, ${differs} differ, ${undecided} not observable.${result.other.length > 0 ? ` Not compared: ${result.other.join(", ")}.` : ""}`;
  return h(
    "section",
    { class: "compare", "aria-labelledby": "fp-compare-title" },
    h("h3", { id: "fp-compare-title", tabindex: "-1", dataset: { id: "result" }, text: `${name} compared with this page` }),
    h("p", { role: "status", text: summary }),
    result.rows.length === 0
      ? null
      : h(
          "table",
          { class: "compare" },
          h(
            "thead",
            {},
            h("tr", {}, ["Setting", "File", "This page", "Result"].map((title) => h("th", { scope: "col", text: title }))),
          ),
          h(
            "tbody",
            {},
            result.rows.map((row) =>
              h(
                "tr",
                {},
                h("th", { scope: "row", text: row.label }),
                h("td", {}, h("code", { text: row.file })),
                h("td", {}, h("code", { text: row.page })),
                h("td", {}, h("span", { class: `verdict ${VERDICT_CLASS[row.verdict]}`, text: row.verdict }), row.note ? h("div", { class: "sub", text: row.note }) : null),
              ),
            ),
          ),
        ),
    h("div", { class: "bar" }, clear),
  );
}

registerView({
  id: "page",
  title: "Page",
  order: 30,
  render(root, ctx) {
    let report: Replies[typeof MSG.INSPECTOR_PROBE] | null = null;
    let running = false;
    /** The file the person imported, read and checked. */
    let imported: { name: string; reading: Reading } | null = null;

    // One file input for the life of the view; the Import button opens it. It stays in the
    // panel: the file is read here and compared here.
    const picker = h("input", { type: "file", accept: ".json,application/json", hidden: true, tabindex: "-1", "aria-label": "Fingerprint JSON file to import" });
    picker.addEventListener("change", () => {
      const file = picker.files?.[0];
      picker.value = ""; // so that the same file can be picked again
      if (file) void load(file);
    });

    /** Reads the page. `focus` names the control to put the keyboard back on, since the view is drawn anew. */
    async function run(focus?: string): Promise<void> {
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
        draw(focus);
      }
    }

    async function load(file: File): Promise<void> {
      const reading = await readFingerprintFile(file);
      imported = { name: file.name, reading };
      draw(reading.ok ? "result" : "import");
      // The comparison needs the page's report: read the page if that has not happened yet.
      if (reading.ok && report === null && !running) await run("result");
    }

    /** Saves the page's fingerprint as `fingerprint-<host>-<date>.json`; false when it could not. */
    function saveFile(): boolean {
      if (!report) return false;
      try {
        downloadFile({
          filename: fingerprintFilename(report.probe.url, new Date()),
          mime: "application/json",
          text: fingerprintFile(report.fingerprint),
        });
        return true;
      } catch (error) {
        ctx.notify(`The file could not be saved: ${errorText(error)}`);
        return false;
      }
    }

    function exportButton(): HTMLButtonElement {
      const button = h("button", { type: "button", text: "Export", title: "Save the Fingerprint JSON as a .json file", "aria-label": "Export Fingerprint JSON as a file" });
      button.addEventListener("click", () => {
        if (!saveFile()) return;
        button.textContent = "Exported";
        setTimeout(() => {
          button.textContent = "Export";
        }, 1200);
      });
      return button;
    }

    function draw(focus?: string): void {
      const parts: (Node | null)[] = [
        h(
          "div",
          { class: "bar" },
          h("button", {
            type: "button",
            class: "primary",
            text: running ? "Reading..." : report ? "Capture again" : "Read this page",
            title: "Read what the page sees now",
            disabled: running,
            dataset: { id: "capture" },
            onclick: () => void run("capture"),
          }),
        ),
        h(
          "div",
          { class: "group", role: "group", "aria-labelledby": "fp-json-label" },
          h("span", { class: "sub", id: "fp-json-label", text: "Fingerprint JSON" }),
          report ? copyButton(fingerprintText(report.fingerprint), "Fingerprint JSON") : null,
          report ? exportButton() : null,
          h("button", {
            type: "button",
            text: "Import",
            title: "Pick a Fingerprint JSON file and compare it with this page",
            "aria-label": "Import a Fingerprint JSON file and compare it with this page",
            dataset: { id: "import" },
            onclick: () => picker.click(),
          }),
          picker,
        ),
        report
          ? h("div", { class: "group", role: "group", "aria-labelledby": "fp-report-label" }, h("span", { class: "sub", id: "fp-report-label", text: "Full report" }), copyButton(JSON.stringify(report.probe, null, 2), "the full report"))
          : null,
        imported
          ? comparisonView(imported.name, imported.reading, report, () => {
              imported = null;
              draw("import");
            })
          : null,
        ...(report
          ? [
              h("p", { text: `What ${report.probe.url ?? "the page"} sees. The Fingerprint JSON has every setting of seleniumbase-rs's Fingerprint (API v2) that this browser answers, each as its value; a setting the page cannot tell is left out.` }),
              h("table", {}, facts(report.probe)),
            ]
          : [h("p", { class: "empty", text: running ? "Reading the page..." : "Press Read this page to see what the page's scripts see: navigator, client hints, screen, time zone, WebGL, canvas, permissions and headless markers." })]),
      ];
      root.replaceChildren(...parts.filter((part): part is Node => part !== null));
      if (focus) root.querySelector<HTMLElement>(`[data-id="${focus}"]`)?.focus();
    }

    draw();
    root.dataset.run = "";
    root.addEventListener("sbrs-run", () => void run());
  },
  show(root) {
    root.dispatchEvent(new Event("sbrs-run"));
  },
});
