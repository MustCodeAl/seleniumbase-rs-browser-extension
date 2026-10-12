// The Chrome DevTools Recorder plugin. The DevTools page loads this script when
// DevTools opens; it registers two export targets with the Recorder panel, which
// then offers "Export as seleniumbase-rs (pure CDP)" and "(BaseCase)". The
// Recorder hands over a recording in the @puppeteer/replay format;
// `fromReplay` reads it and the same generators the popup uses write the Rust.
//
// This is a Chromium feature (Chrome, Edge): Firefox has no Recorder.

import { basecaseStatements } from "../shared/codegen/basecase.js";
import { cdpStatements } from "../shared/codegen/cdp.js";
import { generate } from "../shared/codegen/index.js";
import { fromReplay } from "../shared/codegen/replay.js";

const MEDIA_TYPE = "text/x-rust";

function makePlugin(format) {
  const statements = format === "cdp" ? cdpStatements : basecaseStatements;
  return {
    /** The whole recording, as a test. */
    async stringify(recording) {
      const name = typeof recording?.title === "string" ? recording.title : "recorded_test";
      return generate(format, fromReplay(recording), { name, entry: "test" }).text;
    },
    /** One step, as the statements it becomes. */
    async stringifyStep(step) {
      return fromReplay({ steps: [step] })
        .flatMap((s) => statements(s).lines)
        .join("\n");
    },
  };
}

export const plugins = {
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
