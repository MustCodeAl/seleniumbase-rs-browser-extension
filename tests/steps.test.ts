import { describe, expect, test } from "bun:test";
import {
  type FieldInfo,
  type Step,
  type Target,
  appendStep,
  editStep,
  isSensitiveField,
  markNavigation,
  pickSelector,
  sanitizeStep,
  shouldRecordNavigation,
  step,
  targetOf,
} from "../src/shared/steps.ts";
import { must } from "./support.ts";

const click = (selector: string) => step("click", { target: targetOf(selector) });
const change = (selector: string, value: string) => step("change", { target: targetOf(selector), value });

describe("targetOf", () => {
  test("infers the syntax", () => {
    expect(targetOf("#go").selectors[0]?.syntax).toBe("css");
    expect(targetOf("//a").selectors[0]?.syntax).toBe("xpath");
    expect(targetOf("link=Home").selectors[0]?.syntax).toBe("link");
  });
});

describe("pickSelector", () => {
  test("first engine-usable candidate", () => {
    const target: Target = {
      selectors: [
        { kind: "role-name", syntax: "aria", value: 'Go[role="button"]', unique: true },
        { kind: "id", syntax: "css", value: "#go", unique: true },
      ],
    };
    expect(pickSelector({ target })).toBe("#go");
  });

  test("an edited selector wins", () => {
    expect(pickSelector({ target: targetOf("#a"), selector: ".edited" })).toBe(".edited");
  });

  test("no selector is null", () => {
    expect(pickSelector({ type: "keyPress", key: "Enter" })).toBeNull();
  });
});

describe("appendStep", () => {
  test("adds ids and keeps order", () => {
    let steps: Step[] = [];
    steps = appendStep(steps, click("#a"));
    steps = appendStep(steps, click("#b"));
    expect(steps.map((s) => s.target?.selectors[0]?.value)).toEqual(["#a", "#b"]);
    expect(new Set(steps.map((s) => s.id)).size).toBe(2);
  });

  test("typing in one field becomes one step", () => {
    let steps: Step[] = [];
    steps = appendStep(steps, change("#q", "he"));
    steps = appendStep(steps, change("#q", "hello"));
    expect(steps).toHaveLength(1);
    expect(steps[0]?.value).toBe("hello");
  });

  test("typing in two fields stays two steps", () => {
    let steps: Step[] = [];
    steps = appendStep(steps, change("#a", "1"));
    steps = appendStep(steps, change("#b", "2"));
    expect(steps).toHaveLength(2);
  });

  test("a double click replaces its two clicks", () => {
    let steps: Step[] = [];
    steps = appendStep(steps, click("#other"));
    steps = appendStep(steps, click("#row"));
    steps = appendStep(steps, click("#row"));
    steps = appendStep(steps, step("doubleClick", { target: targetOf("#row") }));
    expect(steps.map((s) => s.type)).toEqual(["click", "doubleClick"]);
  });

  test("scrolls collapse", () => {
    let steps: Step[] = [];
    steps = appendStep(steps, step("scroll", { x: 0, y: 100 }));
    steps = appendStep(steps, step("scroll", { x: 0, y: 400 }));
    expect(steps).toHaveLength(1);
    expect(steps[0]?.y).toBe(400);
  });

  test("the same navigation twice is one step", () => {
    let steps: Step[] = [];
    steps = appendStep(steps, step("navigate", { url: "https://a.test/" }));
    steps = appendStep(steps, step("navigate", { url: "https://a.test/" }));
    expect(steps).toHaveLength(1);
  });

  test("does not change its input", () => {
    const before = [click("#a")];
    const frozen = JSON.stringify(before);
    appendStep(before, click("#b"));
    expect(JSON.stringify(before)).toBe(frozen);
  });
});

describe("editStep", () => {
  test("patches a step by id", () => {
    let steps = appendStep([], change("#q", "a"));
    steps = editStep(steps, must(steps[0]?.id), { value: "b" });
    expect(steps[0]?.value).toBe("b");
  });

  test("takes text for the text fields and numbers for the numbers, and ignores the rest", () => {
    let steps = appendStep([], change("#q", "a"));
    steps = editStep(steps, must(steps[0]?.id), { value: 5, x: "7", offsetY: 3, selector: ".ok", type: "eval" });
    expect(steps[0]?.value).toBe("a");
    expect(steps[0]?.x).toBeUndefined();
    expect(steps[0]?.offsetY).toBe(3);
    expect(steps[0]?.selector).toBe(".ok");
    expect(steps[0]?.type).toBe("change");
  });

  test("never turns a sensitive step into one with a value", () => {
    let steps = appendStep([], step("change", { target: targetOf("#pw"), value: "", sensitive: true, secret: "password" }));
    steps = editStep(steps, must(steps[0]?.id), { value: "hunter2" });
    expect(steps[0]?.value).toBe("");
  });
});

describe("shouldRecordNavigation", () => {
  const nav = (url: string, at: number) => step("navigate", { url, t: at });
  test("the first page", () => {
    expect(shouldRecordNavigation([], { url: "https://a.test/", now: 1000 })).toBe(true);
  });
  test("not the page already recorded", () => {
    expect(shouldRecordNavigation([nav("https://a.test/", 0)], { url: "https://a.test/", now: 5000 })).toBe(false);
  });
  test("not right after a click, which caused it", () => {
    const steps = [nav("https://a.test/", 0), { ...click("#go"), t: 4000 }];
    expect(shouldRecordNavigation(steps, { url: "https://a.test/next", now: 5000 })).toBe(false);
  });
  test("yes after a long pause", () => {
    const steps = [nav("https://a.test/", 0), { ...click("#go"), t: 1000 }];
    expect(shouldRecordNavigation(steps, { url: "https://a.test/next", now: 9000 })).toBe(true);
  });
  test("not a reload", () => {
    const steps = [nav("https://a.test/", 0)];
    expect(shouldRecordNavigation(steps, { url: "https://a.test/", nav: "reload", now: 9000 })).toBe(false);
  });
  test("a typed address counts", () => {
    const steps = [nav("https://a.test/", 0)];
    expect(shouldRecordNavigation(steps, { url: "https://b.test/", nav: "navigate", now: 9000 })).toBe(true);
  });
});

describe("isSensitiveField", () => {
  test.each<[FieldInfo, string]>([
    [{ type: "password" }, "password"],
    [{ type: "text", autocomplete: "cc-number" }, "card_number"],
    [{ type: "text", autocomplete: "cc-csc" }, "card_cvc"],
    [{ type: "text", autocomplete: "one-time-code" }, "one_time_code"],
    [{ type: "text", name: "card_number" }, "card_number"],
    [{ type: "text", id: "cvv" }, "cvv"],
    [{ type: "text", placeholder: "Social security number" }, "ssn"],
    [{ type: "text", name: "iban" }, "iban"],
  ])("%j is sensitive as %s", (info, label) => {
    const result = isSensitiveField(info);
    expect(result.sensitive).toBe(true);
    expect(result.label).toBe(label);
  });

  test.each<[FieldInfo]>([
    [{ type: "text", name: "email" }],
    [{ type: "search", name: "q" }],
    [{ type: "text", name: "username", autocomplete: "username" }],
    [{ type: "text", name: "first_name" }],
    // A property of every object is not an autocomplete token.
    [{ type: "text", autocomplete: "constructor" }],
  ])("%j is not", (info) => {
    expect(isSensitiveField(info).sensitive).toBe(false);
  });
});

describe("sanitizeStep", () => {
  test("keeps known fields and drops the rest", () => {
    const clean = must(
      sanitizeStep({ type: "click", target: { tag: "a", selectors: [{ kind: "id", syntax: "css", value: "#x", count: 1 }], evil: 1 }, offsetX: 3, __proto__: { bad: 1 }, extra: "no" }),
    );
    expect(clean.type).toBe("click");
    expect(clean.target?.selectors[0]?.value).toBe("#x");
    expect(clean.offsetX).toBe(3);
    expect("extra" in clean).toBe(false);
    expect("evil" in must(clean.target)).toBe(false);
  });
  test("rejects unknown types and non-objects", () => {
    expect(sanitizeStep({ type: "eval" })).toBeNull();
    expect(sanitizeStep(null)).toBeNull();
    expect(sanitizeStep("click")).toBeNull();
  });
  test("a sensitive step has no value", () => {
    const clean = must(sanitizeStep({ type: "change", value: "hunter2", sensitive: true, secret: "password" }));
    expect(clean.value).toBe("");
    expect(clean.sensitive).toBe(true);
  });
  test("bounds the size of text and lists", () => {
    const clean = must(sanitizeStep({ type: "setFiles", names: Array.from({ length: 50 }, () => "x".repeat(1000)), value: "v".repeat(50000) }));
    expect(clean.names).toHaveLength(20);
    expect(clean.names?.[0]).toHaveLength(255);
    expect(clean.value).toHaveLength(10000);
  });
  test("ignores selectors with an unknown syntax", () => {
    const clean = must(sanitizeStep({ type: "click", target: { selectors: [{ syntax: "js", value: "alert(1)" }, { syntax: "css", value: "#ok" }] } }));
    expect(must(clean.target).selectors.map((c) => c.value)).toEqual(["#ok"]);
  });
  test("numbers must be numbers", () => {
    const clean = must(sanitizeStep({ type: "scroll", x: "0); evil(", y: 5 }));
    expect("x" in clean).toBe(false);
    expect(clean.y).toBe(5);
  });
});

describe("markNavigation", () => {
  test("flags the step that caused the page", () => {
    const steps = [{ ...click("#go"), t: 4000 }];
    const marked = markNavigation(steps, { nav: "navigate", now: 5000 });
    expect(marked[0]?.navigates).toBe(true);
    expect(steps[0]?.navigates).toBeUndefined();
  });
  test("not a step long before", () => {
    const steps = [{ ...click("#go"), t: 1000 }];
    expect(markNavigation(steps, { now: 9000 })).toBe(steps);
  });
  test("not a reload, not a navigate step, not twice", () => {
    const steps = [{ ...click("#go"), t: 4000 }];
    expect(markNavigation(steps, { nav: "reload", now: 5000 })).toBe(steps);
    const nav = [step("navigate", { url: "https://a.test/", t: 4000 })];
    expect(markNavigation(nav, { now: 5000 })).toBe(nav);
    const once = markNavigation(steps, { now: 5000 });
    expect(markNavigation(once, { now: 5100 })).toBe(once);
  });
  test("sanitizeStep keeps the flag", () => {
    expect(must(sanitizeStep({ type: "click", navigates: true })).navigates).toBe(true);
    expect(must(sanitizeStep({ type: "click", navigates: "yes" })).navigates).toBeUndefined();
  });
});
