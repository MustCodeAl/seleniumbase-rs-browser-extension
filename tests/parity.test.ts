// The generators against seleniumbase-rs's own recorder. tests/golden/ holds what
// `ActionRecorder` writes for tests/golden/parity-actions.json; e2e/tests/e2e.rs
// (`parity_with_the_action_recorder`) regenerates and checks those files from the
// Rust side, and this file holds the extension's generators to the same text,
// byte for byte, for the actions both know.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { basecaseProgram } from "../src/shared/codegen/basecase.ts";
import { cdpProgram } from "../src/shared/codegen/cdp.ts";
import { type Step, step, targetOf } from "../src/shared/steps.ts";

/** One action of tests/golden/parity-actions.json, as `ActionRecorder::record` takes it. */
interface Action {
  name: string;
  target: string;
  value?: string;
}

const golden = (name: string) => readFileSync(join(import.meta.dir, "golden", name), "utf8");
const actions = JSON.parse(golden("parity-actions.json")) as Action[];

const on = (a: Action) => ({ target: targetOf(a.target) });
const TO_STEP: Record<string, (a: Action) => Step> = {
  open: (a) => step("navigate", { url: a.target }),
  click: (a) => step("click", on(a)),
  type_text: (a) => step("change", { ...on(a), value: a.value }),
  select_option_by_text: (a) => step("select", { ...on(a), text: a.value }),
  check_if_unchecked: (a) => step("check", on(a)),
  uncheck_if_checked: (a) => step("uncheck", on(a)),
  double_click: (a) => step("doubleClick", on(a)),
  hover: (a) => step("hover", on(a)),
};
const steps = actions.map((a) => {
  const make = TO_STEP[a.name];
  if (!make) throw new Error(`no step for the action ${a.name}`);
  return make(a);
});

describe("same text as ActionRecorder", () => {
  test("to_cdp_test", () => {
    expect(cdpProgram(steps, { entry: "test", name: "recorded_test" })).toBe(golden("parity-cdp-test.rs.txt"));
  });
  test("to_cdp_script", () => {
    expect(cdpProgram(steps, { entry: "main" })).toBe(golden("parity-cdp-main.rs.txt"));
  });
  test("to_rust_test", () => {
    expect(basecaseProgram(steps, { entry: "test", name: "recorded_test" })).toBe(golden("parity-basecase-test.rs.txt"));
  });
  test("to_rust_script", () => {
    expect(basecaseProgram(steps, { entry: "main" })).toBe(golden("parity-basecase-main.rs.txt"));
  });
});
