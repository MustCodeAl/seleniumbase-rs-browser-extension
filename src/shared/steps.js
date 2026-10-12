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
// `target` is { tag, role?, name?, text?, selectors: [candidate] } where a
// candidate is { kind, syntax, value, count, unique, aria? } (see selectors.js).
// A step may also carry `selector`, a string the person typed over the
// generated one.

import { selectorSyntax } from "./selectors.js";

export { selectorSyntax };

let counter = 0;

/** A fresh step id. */
export function newId() {
  counter += 1;
  return `s${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A step of `type` with `fields`, stamped with the time. */
export function step(type, fields = {}) {
  return { type, t: Date.now(), ...fields };
}

/** A target that holds one hand-written selector. */
export function targetOf(selector, extra = {}) {
  return {
    ...extra,
    selectors: [{ kind: "custom", syntax: selectorSyntax(selector), value: selector, count: 1, unique: true }],
  };
}

/** The selector a code generator should use for `s`, or null. */
export function pickSelector(s) {
  if (typeof s.selector === "string" && s.selector.trim() !== "") return s.selector;
  const candidates = s.target?.selectors ?? [];
  const usable = candidates.find((c) => c.syntax !== "aria" && c.unique !== false);
  return usable ? usable.value : null;
}

function targetKey(s) {
  return pickSelector(s) ?? "";
}

const FOLDS_TO_DOUBLE_CLICK = 2;

/** `steps` with `incoming` added, merging typing, double clicks and scrolls. Returns a new array. */
export function appendStep(steps, incoming) {
  const added = incoming.id ? { ...incoming } : { ...incoming, id: newId() };
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
      if (tail.type === "click" && targetKey(tail) === key) {
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

const STEP_TYPES = new Set([
  "navigate", "click", "doubleClick", "rightClick", "hover", "change", "setValue", "select", "check",
  "uncheck", "keyPress", "setFiles", "scroll", "scrollIntoView", "viewport", "waitFor", "unsupported",
]);
const MAX_TEXT = 4000;
const SYNTAXES = new Set(["css", "xpath", "link", "aria"]);

function str(value, max = MAX_TEXT) {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sanitizeTarget(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const selectors = (Array.isArray(raw.selectors) ? raw.selectors : [])
    .filter((c) => c && typeof c.value === "string" && SYNTAXES.has(c.syntax))
    .slice(0, 8)
    .map((c) => ({
      kind: str(c.kind, 40) ?? "custom",
      syntax: c.syntax,
      value: c.value.slice(0, 2000),
      count: num(c.count) ?? 1,
      unique: c.unique !== false,
      ...(typeof c.aria === "string" ? { aria: c.aria.slice(0, 2000) } : {}),
    }));
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
export function sanitizeStep(raw) {
  if (!raw || typeof raw !== "object" || !STEP_TYPES.has(raw.type)) return null;
  const out = { type: raw.type };
  const target = sanitizeTarget(raw.target);
  if (target) out.target = target;
  for (const field of ["url", "value", "text", "key", "selector", "description", "secret"]) {
    const value = str(raw[field], field === "value" ? 10000 : MAX_TEXT);
    if (value !== undefined) out[field] = value;
  }
  for (const field of ["x", "y", "offsetX", "offsetY", "index", "width", "height"]) {
    const value = num(raw[field]);
    if (value !== undefined) out[field] = value;
  }
  if (typeof raw.visible === "boolean") out.visible = raw.visible;
  if (Array.isArray(raw.names)) out.names = raw.names.slice(0, 20).filter((n) => typeof n === "string").map((n) => n.slice(0, 255));
  if (raw.sensitive === true) {
    out.sensitive = true;
    out.value = "";
  }
  return out;
}

const EDITABLE = ["selector", "value", "text", "url", "key", "x", "y", "offsetX", "offsetY"];

/** `steps` with the step `id` patched. A sensitive step never gains a value. */
export function editStep(steps, id, patch) {
  return steps.map((s) => {
    if (s.id !== id) return s;
    const next = { ...s };
    for (const field of EDITABLE) {
      if (field in patch) next[field] = patch[field];
    }
    if (next.sensitive) next.value = "";
    return next;
  });
}

/** `steps` without the step `id`. */
export function deleteStep(steps, id) {
  return steps.filter((s) => s.id !== id);
}

/** `steps` with the step `id` moved by `delta` places. */
export function moveStep(steps, id, delta) {
  const from = steps.findIndex((s) => s.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= steps.length) return steps;
  const out = steps.slice();
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}

const CAUSES_NAVIGATION = new Set(["click", "doubleClick", "keyPress", "check", "uncheck", "select", "change", "setValue"]);
const CAUSE_WINDOW_MS = 3000;

/**
 * Whether a page that just started loading is a navigation of its own, or the
 * effect of the last recorded step (a click that followed a link, an Enter that
 * submitted a form), a redirect, or a reload.
 */
export function shouldRecordNavigation(steps, { url, nav, now }) {
  if (steps.length === 0) return true;
  if (nav === "reload") return false;
  const lastNavigate = [...steps].reverse().find((s) => s.type === "navigate");
  if (lastNavigate && lastNavigate.url === url) return false;
  const last = steps[steps.length - 1];
  const age = now - (last.t ?? 0);
  if (CAUSES_NAVIGATION.has(last.type) && age < CAUSE_WINDOW_MS) return false;
  if (last.type === "navigate" && age < CAUSE_WINDOW_MS) return false;
  return true;
}

const AUTOCOMPLETE_LABELS = {
  "cc-number": "card_number",
  "cc-csc": "card_cvc",
  "cc-exp": "card_expiry",
  "cc-exp-month": "card_expiry",
  "cc-exp-year": "card_expiry",
  "cc-name": "card_name",
  "cc-type": "card_type",
  "one-time-code": "one_time_code",
  "new-password": "password",
  "current-password": "password",
};

const NAME_PATTERNS = [
  [/(card|cc)[-_ ]?(number|num|no)\b|ccnum/i, "card_number"],
  [/cvv/i, "cvv"],
  [/cvc|\bcsc\b|security[-_ ]?code/i, "card_cvc"],
  [/ssn|social[-_ ]?security/i, "ssn"],
  [/iban/i, "iban"],
  [/pass(word|wd)?\b|pwd/i, "password"],
  [/(^|[^a-z])otp([^a-z]|$)|one[-_ ]?time[-_ ]?(code|pass)/i, "one_time_code"],
  [/secret|api[-_ ]?key|token/i, "secret"],
];

/**
 * Whether a field holds a secret whose value must never be recorded.
 * @param {{type?: string, autocomplete?: string, name?: string, id?: string, placeholder?: string, ariaLabel?: string}} info
 * @returns {{sensitive: boolean, label: string}}
 */
export function isSensitiveField(info) {
  const type = (info.type ?? "").toLowerCase();
  if (type === "password") return { sensitive: true, label: "password" };
  for (const token of (info.autocomplete ?? "").toLowerCase().split(/\s+/)) {
    if (token in AUTOCOMPLETE_LABELS) return { sensitive: true, label: AUTOCOMPLETE_LABELS[token] };
  }
  const hint = [info.name, info.id, info.placeholder, info.ariaLabel].filter(Boolean).join(" ");
  for (const [pattern, label] of NAME_PATTERNS) {
    if (pattern.test(hint)) return { sensitive: true, label };
  }
  return { sensitive: false, label: "" };
}
