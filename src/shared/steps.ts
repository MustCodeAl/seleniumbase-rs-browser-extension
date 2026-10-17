// The recording model: steps, how they merge as they arrive, and which fields
// are never recorded.
//
// A step is a plain, JSON-serialisable object:
//
//   { id, t, type, ...fields }
//
//   type        fields
//   navigate    url
//   click       target, offsetX, offsetY
//   doubleClick target, offsetX, offsetY
//   change      target, value, sensitive?, secret?      typing into a field
//   select      target, value, text, index              a <select> choice
//   check       target                                  a checkbox or radio ticked
//   uncheck     target
//   keyPress    key, target?                            Enter, Escape, arrows ...
//   setFiles    target, names                           file names only, never paths
//   scroll      x, y                                    the window
//   viewport    width, height                           (from a DevTools recording)
//   setValue    target, value                           (from a DevTools recording)
//   waitFor     target, visible
//   unsupported description                             a step with no equivalent
//
// Any step may also carry `navigates: true`: the page it was recorded on loaded
// another page as its effect, so the generated code waits for it.
//
// `target` is { tag, role?, name?, text?, selectors: [candidate] } where a
// candidate is { kind, syntax, value, count, unique, aria? } (see selectors.ts).
// A step may also carry `selector`, a string the person typed over the
// generated one.

import { isRecord } from "./guards.ts";
import { type Candidate, type SelectorSyntax, selectorSyntax } from "./selectors.ts";

export { selectorSyntax };

/** Every type of step, in the order the model above lists them. */
const STEP_TYPE_LIST = [
  "navigate", "click", "doubleClick", "rightClick", "hover", "change", "setValue", "select", "check",
  "uncheck", "keyPress", "setFiles", "scroll", "scrollIntoView", "viewport", "waitFor", "unsupported",
] as const;

export type StepType = (typeof STEP_TYPE_LIST)[number];

const STEP_TYPES: ReadonlySet<string> = new Set(STEP_TYPE_LIST);

function isStepType(value: unknown): value is StepType {
  return typeof value === "string" && STEP_TYPES.has(value);
}

/** The element a step is about: what it is, and the selectors that find it. */
export interface Target {
  tag?: string | undefined;
  role?: string | undefined;
  name?: string | undefined;
  text?: string | undefined;
  selectors: Candidate[];
}

/**
 * One recorded step. `type` says which of the other fields it has (see the model
 * at the top of this file); a step the background stores also has an `id`.
 */
export interface Step {
  type: StepType;
  id?: string | undefined;
  t?: number | undefined;
  target?: Target | undefined;
  /** A selector the person typed over the generated ones. */
  selector?: string | undefined;
  url?: string | undefined;
  value?: string | undefined;
  text?: string | undefined;
  key?: string | undefined;
  description?: string | undefined;
  /** What a sensitive field is ("password", "card_number"...), so the generated code can name its variable. */
  secret?: string | undefined;
  sensitive?: boolean | undefined;
  names?: string[] | undefined;
  x?: number | undefined;
  y?: number | undefined;
  offsetX?: number | undefined;
  offsetY?: number | undefined;
  index?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  visible?: boolean | undefined;
  /** The step loaded a page as its effect. */
  navigates?: boolean | undefined;
}

let counter = 0;

/** A fresh step id. */
export function newId(): string {
  counter += 1;
  return `s${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A step of `type` with `fields`, stamped with the time. */
export function step(type: StepType, fields: Partial<Omit<Step, "type">> = {}): Step {
  return { type, t: Date.now(), ...fields };
}

/** A target that holds one hand-written selector. */
export function targetOf(selector: string, extra: Omit<Target, "selectors"> = {}): Target {
  return {
    ...extra,
    selectors: [{ kind: "custom", syntax: selectorSyntax(selector), value: selector, count: 1, unique: true }],
  };
}

/** The selector a code generator should use for `s`, or null. */
export function pickSelector(s: Partial<Step>): string | null {
  if (typeof s.selector === "string" && s.selector.trim() !== "") return s.selector;
  const candidates = s.target?.selectors ?? [];
  const usable = candidates.find((c) => c.syntax !== "aria" && c.unique !== false);
  return usable ? usable.value : null;
}

function targetKey(s: Step): string {
  return pickSelector(s) ?? "";
}

const FOLDS_TO_DOUBLE_CLICK = 2;

/** `steps` with `incoming` added, merging typing, double clicks and scrolls. Returns a new array. */
export function appendStep(steps: Step[], incoming: Step): Step[] {
  const added: Step = incoming.id ? { ...incoming } : { ...incoming, id: newId() };
  if (added.t === undefined) added.t = Date.now();
  const out = steps.slice();
  const last = out[out.length - 1];

  if (added.type === "change" && last && last.type === "change" && targetKey(last) === targetKey(added) && targetKey(added) !== "") {
    out[out.length - 1] = { ...added, id: last.id };
    return out;
  }
  if (added.type === "scroll" && last && last.type === "scroll") {
    out[out.length - 1] = { ...added, id: last.id };
    return out;
  }
  if (added.type === "navigate" && last && last.type === "navigate" && last.url === added.url) {
    return out;
  }
  if (added.type === "doubleClick") {
    const key = targetKey(added);
    let removed = 0;
    while (removed < FOLDS_TO_DOUBLE_CLICK && out.length > 0) {
      const tail = out[out.length - 1];
      if (tail && tail.type === "click" && targetKey(tail) === key) {
        out.pop();
        removed += 1;
      } else {
        break;
      }
    }
  }
  out.push(added);
  return out;
}

const MAX_TEXT = 4000;
const SYNTAXES: ReadonlySet<string> = new Set(["css", "xpath", "link", "aria"]);

function isSyntax(value: unknown): value is SelectorSyntax {
  return typeof value === "string" && SYNTAXES.has(value);
}

function str(value: unknown, max = MAX_TEXT): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sanitizeTarget(raw: unknown): Target | undefined {
  if (!isRecord(raw)) return undefined;
  const list: unknown[] = Array.isArray(raw.selectors) ? raw.selectors : [];
  const selectors: Candidate[] = [];
  for (const c of list) {
    if (selectors.length >= 8) break;
    if (!isRecord(c) || typeof c.value !== "string" || !isSyntax(c.syntax)) continue;
    selectors.push({
      kind: str(c.kind, 40) ?? "custom",
      syntax: c.syntax,
      value: c.value.slice(0, 2000),
      count: num(c.count) ?? 1,
      unique: c.unique !== false,
      ...(typeof c.aria === "string" ? { aria: c.aria.slice(0, 2000) } : {}),
    });
  }
  return {
    tag: str(raw.tag, 40),
    role: str(raw.role, 40),
    name: str(raw.name, 200),
    text: str(raw.text, 200),
    selectors,
  };
}

/**
 * A step as received from another context, reduced to the fields it may have
 * and bounded in size; null when it is not a step. A sensitive step has no value.
 */
export function sanitizeStep(raw: unknown): Step | null {
  if (!isRecord(raw) || !isStepType(raw.type)) return null;
  const out: Step = { type: raw.type };
  const target = sanitizeTarget(raw.target);
  if (target) out.target = target;
  for (const field of ["url", "value", "text", "key", "selector", "description", "secret"] as const) {
    const value = str(raw[field], field === "value" ? 10000 : MAX_TEXT);
    if (value !== undefined) out[field] = value;
  }
  for (const field of ["x", "y", "offsetX", "offsetY", "index", "width", "height"] as const) {
    const value = num(raw[field]);
    if (value !== undefined) out[field] = value;
  }
  if (typeof raw.visible === "boolean") out.visible = raw.visible;
  if (typeof raw.navigates === "boolean") out.navigates = raw.navigates;
  if (Array.isArray(raw.names)) {
    const names: unknown[] = raw.names;
    out.names = names
      .slice(0, 20)
      .filter((n): n is string => typeof n === "string")
      .map((n) => n.slice(0, 255));
  }
  if (raw.sensitive === true) {
    out.sensitive = true;
    out.value = "";
  }
  return out;
}

const EDITABLE_TEXT = ["selector", "value", "text", "url", "key"] as const;
const EDITABLE_NUMBERS = ["x", "y", "offsetX", "offsetY"] as const;

/**
 * `steps` with the step `id` patched: the editable text fields that `patch` holds
 * as text and the editable numbers that it holds as numbers; anything else in it
 * is ignored. A sensitive step never gains a value.
 */
export function editStep(steps: Step[], id: string, patch: Record<string, unknown>): Step[] {
  return steps.map((s) => {
    if (s.id !== id) return s;
    const next: Step = { ...s };
    for (const field of EDITABLE_TEXT) {
      const value = patch[field];
      if (typeof value === "string") next[field] = value;
    }
    for (const field of EDITABLE_NUMBERS) {
      const value = patch[field];
      if (typeof value === "number") next[field] = value;
    }
    if (next.sensitive) next.value = "";
    return next;
  });
}

/** `steps` without the step `id`. */
export function deleteStep(steps: Step[], id: string): Step[] {
  return steps.filter((s) => s.id !== id);
}

/** `steps` with the step `id` moved by `delta` places. */
export function moveStep(steps: Step[], id: string, delta: number): Step[] {
  const from = steps.findIndex((s) => s.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= steps.length) return steps;
  const out = steps.slice();
  const [moved] = out.splice(from, 1);
  if (moved === undefined) return steps;
  out.splice(to, 0, moved);
  return out;
}

const CAUSES_NAVIGATION: ReadonlySet<StepType> = new Set<StepType>(["click", "doubleClick", "keyPress", "check", "uncheck", "select", "change", "setValue"]);
const CAUSE_WINDOW_MS = 3000;

/**
 * Whether a page that just started loading is a navigation of its own, or the
 * effect of the last recorded step (a click that followed a link, an Enter that
 * submitted a form), a redirect, or a reload.
 */
export function shouldRecordNavigation(steps: Step[], { url, nav, now }: { url: string; nav?: string | undefined; now: number }): boolean {
  if (steps.length === 0) return true;
  if (nav === "reload") return false;
  const lastNavigate = [...steps].reverse().find((s) => s.type === "navigate");
  if (lastNavigate && lastNavigate.url === url) return false;
  const last = steps[steps.length - 1];
  if (last === undefined) return true;
  const age = now - (last.t ?? 0);
  if (CAUSES_NAVIGATION.has(last.type) && age < CAUSE_WINDOW_MS) return false;
  if (last.type === "navigate" && age < CAUSE_WINDOW_MS) return false;
  return true;
}

/**
 * `steps` with the last step flagged `navigates` when the page that just loaded
 * is its effect: a click that followed a link, an Enter that submitted a form.
 * The generators wait for the page after such a step, so the next step does not
 * start on the old one. Returns `steps` itself when nothing changes.
 */
export function markNavigation(steps: Step[], { nav, now }: { nav?: string | undefined; now: number }): Step[] {
  if (steps.length === 0 || nav === "reload") return steps;
  const last = steps[steps.length - 1];
  if (last === undefined || !CAUSES_NAVIGATION.has(last.type) || last.navigates) return steps;
  if (now - (last.t ?? 0) >= CAUSE_WINDOW_MS) return steps;
  return [...steps.slice(0, -1), { ...last, navigates: true }];
}

const AUTOCOMPLETE_LABELS: ReadonlyMap<string, string> = new Map([
  ["cc-number", "card_number"],
  ["cc-csc", "card_cvc"],
  ["cc-exp", "card_expiry"],
  ["cc-exp-month", "card_expiry"],
  ["cc-exp-year", "card_expiry"],
  ["cc-name", "card_name"],
  ["cc-type", "card_type"],
  ["one-time-code", "one_time_code"],
  ["new-password", "password"],
  ["current-password", "password"],
]);

const NAME_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/(card|cc)[-_ ]?(number|num|no)\b|ccnum/i, "card_number"],
  [/cvv/i, "cvv"],
  [/cvc|\bcsc\b|security[-_ ]?code/i, "card_cvc"],
  [/ssn|social[-_ ]?security/i, "ssn"],
  [/iban/i, "iban"],
  [/pass(word|wd)?\b|pwd/i, "password"],
  [/(^|[^a-z])otp([^a-z]|$)|one[-_ ]?time[-_ ]?(code|pass)/i, "one_time_code"],
  [/secret|api[-_ ]?key|token/i, "secret"],
];

/** What is known of a form field, from its attributes. */
export interface FieldInfo {
  type?: string;
  autocomplete?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
}

/** Whether a field holds a secret whose value must never be recorded. */
export function isSensitiveField(info: FieldInfo): { sensitive: boolean; label: string } {
  const type = (info.type ?? "").toLowerCase();
  if (type === "password") return { sensitive: true, label: "password" };
  for (const token of (info.autocomplete ?? "").toLowerCase().split(/\s+/)) {
    const label = AUTOCOMPLETE_LABELS.get(token);
    if (label !== undefined) return { sensitive: true, label };
  }
  const hint = [info.name, info.id, info.placeholder, info.ariaLabel].filter(Boolean).join(" ");
  for (const [pattern, label] of NAME_PATTERNS) {
    if (pattern.test(hint)) return { sensitive: true, label };
  }
  return { sensitive: false, label: "" };
}
