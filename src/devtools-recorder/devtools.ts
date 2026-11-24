// The Chrome DevTools Recorder plugin. The DevTools page loads this script when
// DevTools opens; it registers two export targets with the Recorder panel, which
// then offers "Export as seleniumbase-rs (pure CDP)" and "(BaseCase)". The
// Recorder hands over a recording in the @puppeteer/replay format;
// `fromReplay` reads it and the same generators the popup uses write the Rust.
//
// This is a Chromium feature (Chrome, Edge): Firefox has no Recorder.

import { basecaseStatements } from "../shared/codegen/basecase.ts";
import { cdpStatements } from "../shared/codegen/cdp.ts";
import { generate } from "../shared/codegen/index.ts";
import { fromReplay } from "../shared/codegen/replay.ts";
import { isRecord } from "../shared/guards.ts";

const MEDIA_TYPE = "text/x-rust";

/** What the Recorder panel calls on an export plugin: a recording or a step in, Rust out. */
export interface ExportPlugin {
  stringify(recording: unknown): Promise<string>;
  stringifyStep(step: unknown): Promise<string>;
  replay?(recording: unknown): Promise<void>;
}

function makePlugin(format: "cdp" | "basecase"): ExportPlugin {
  const statements = format === "cdp" ? cdpStatements : basecaseStatements;
  return {
    /** The whole recording, as a test. */
    async stringify(recording) {
      const name = isRecord(recording) && typeof recording.title === "string" ? recording.title : "recorded_test";
      return generate(format, fromReplay(recording), { name, entry: "test" }).text;
    },
    /** One step, as the statements it becomes. */
    async stringifyStep(step) {
      return fromReplay({ steps: [step] })
        .flatMap((s) => statements(s).lines)
        .join("\n");
    },
    /** Replay the recording directly inside Chrome with simulated stealth delays. */
    async replay(recording) {
      const steps = fromReplay(recording);
      const win = globalThis.chrome?.devtools?.inspectedWindow;
      for (const step of steps) {
        if (step.type === "navigate" && typeof step.url === "string") {
          win?.["eval"](`window.location.href = ${JSON.stringify(step.url)}`);
          await new Promise((resolve) => setTimeout(resolve, 1500));
        } else if (step.type === "click" || step.type === "doubleClick") {
          const sel = step.target?.selectors?.[0]?.value ?? "";
          if (sel) {
            win?.["eval"](`(() => {
              const el = document.querySelector(${JSON.stringify(sel)});
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                el.click();
              }
            })()`);
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
        } else if (step.type === "setValue") {
          const sel = step.target?.selectors?.[0]?.value ?? "";
          const val = String(step.value ?? "");
          if (sel) {
            win?.["eval"](`(() => {
              const el = document.querySelector(${JSON.stringify(sel)});
              if (el) {
                el.focus();
                el.value = ${JSON.stringify(val)};
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
            })()`);
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
    },
  };
}

export const plugins: Record<"cdp" | "basecase", ExportPlugin> = {
  cdp: makePlugin("cdp"),
  basecase: makePlugin("basecase"),
};

// Reachable from a page that loads this script outside DevTools (a test does).
globalThis.__sbrsRecorderPlugins = plugins;

const recorder = globalThis.chrome?.devtools?.recorder;
if (recorder && typeof recorder.registerRecorderExtensionPlugin === "function") {
  recorder.registerRecorderExtensionPlugin(plugins.cdp, "seleniumbase-rs (pure CDP)", MEDIA_TYPE);
  recorder.registerRecorderExtensionPlugin(plugins.basecase, "seleniumbase-rs (BaseCase)", MEDIA_TYPE);
}
