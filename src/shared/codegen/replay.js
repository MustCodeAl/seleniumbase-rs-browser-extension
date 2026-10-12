// The Chrome DevTools Recorder format (the @puppeteer/replay user flow):
// `toReplay` writes a recording in it, which `sbase import-puppeteer` reads, and
// `fromReplay` reads one that the DevTools Recorder hands to an extension plugin.

import { normalizeSpace, xpathLiteral } from "../escape.js";
import { selectorSyntax, step, targetOf } from "../steps.js";

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

function viewportStep(width, height) {
  return {
    type: "setViewport",
    width,
    height,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    isLandscape: false,
  };
}

/** The `selectors` array of a Recorder step: aria first, then the rest in order of preference. */
function replaySelectors(s) {
  const out = [];
  const seen = new Set();
  const push = (text) => {
    if (!seen.has(text)) {
      seen.add(text);
      out.push([text]);
    }
  };
  if (typeof s.selector === "string" && s.selector.trim() !== "") {
    const syntax = selectorSyntax(s.selector);
    if (syntax === "xpath") push(`xpath/${s.selector}`);
    else if (syntax === "link") push(`text/${s.selector.replace(/^[a-z_]+=/, "")}`);
    else push(s.selector);
    return out;
  }
  const candidates = (s.target?.selectors ?? []).filter((c) => c.unique !== false);
  for (const c of candidates) if (c.aria) push(`aria/${c.aria}`);
  for (const c of candidates) {
    if (c.syntax === "css") push(c.value);
    else if (c.syntax === "xpath") push(`xpath/${c.value}`);
    else if (c.syntax === "link") push(`text/${c.value.replace(/^[a-z_]+=/, "")}`);
  }
  return out;
}

/**
 * A recording as a DevTools Recorder user flow.
 * @param {object[]} steps
 * @param {{title?: string, viewport?: {width: number, height: number}}} [options]
 */
export function toReplay(steps, options = {}) {
  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  const out = [];
  if (!steps.some((s) => s.type === "viewport")) out.push(viewportStep(viewport.width, viewport.height));
  for (const s of steps) {
    const selectors = replaySelectors(s);
    const hasTarget = selectors.length > 0;
    switch (s.type) {
      case "viewport":
        out.push(viewportStep(s.width, s.height));
        break;
      case "navigate":
        out.push({
          type: "navigate",
          url: s.url,
          assertedEvents: [{ type: "navigation", url: s.url, title: "" }],
        });
        break;
      case "click":
      case "doubleClick":
      case "check":
      case "uncheck":
        if (hasTarget) {
          out.push({
            type: s.type === "doubleClick" ? "doubleClick" : "click",
            target: "main",
            selectors,
            offsetX: s.offsetX ?? 1,
            offsetY: s.offsetY ?? 1,
            ...(s.navigates ? { assertedEvents: [{ type: "navigation" }] } : {}),
          });
        }
        break;
      case "rightClick":
        if (hasTarget) {
          out.push({ type: "click", target: "main", selectors, button: "secondary", offsetX: s.offsetX ?? 1, offsetY: s.offsetY ?? 1 });
        }
        break;
      case "hover":
        if (hasTarget) out.push({ type: "hover", target: "main", selectors });
        break;
      case "change":
      case "setValue":
        if (hasTarget) out.push({ type: "change", value: s.sensitive ? "" : (s.value ?? ""), selectors, target: "main" });
        break;
      case "select":
        if (hasTarget) out.push({ type: "change", value: s.value ?? s.text ?? "", selectors, target: "main" });
        break;
      case "setFiles":
        if (hasTarget) out.push({ type: "change", value: (s.names ?? [])[0] ?? "", selectors, target: "main" });
        break;
      case "keyPress":
        out.push({
          type: "keyDown",
          target: "main",
          key: s.key,
          ...(s.navigates ? { assertedEvents: [{ type: "navigation" }] } : {}),
        });
        out.push({ type: "keyUp", key: s.key, target: "main" });
        break;
      case "scroll":
        out.push({ type: "scroll", target: "main", x: s.x ?? 0, y: s.y ?? 0 });
        break;
      case "scrollIntoView":
        if (hasTarget) out.push({ type: "scroll", target: "main", selectors });
        break;
      case "waitFor":
        if (hasTarget) out.push({ type: "waitForElement", selectors, visible: s.visible !== false });
        break;
      default:
        break;
    }
  }
  return { title: options.title ?? "Recording", steps: out };
}

// ---------------------------------------------------------------- reading a recording

function ariaToXPath(text) {
  const match = /^([\s\S]*?)(?:\[role="([^"]+)"\])?$/.exec(text);
  const name = match ? match[1] : text;
  const role = match ? match[2] : undefined;
  const lit = xpathLiteral(name);
  const nameTest = `(@aria-label=${lit} or normalize-space(.)=${lit})`;
  return role ? `//*[@role=${xpathLiteral(role)} and ${nameTest}]` : `//*[${nameTest}]`;
}

function candidate(kind, syntax, value) {
  return { kind, syntax, value, count: 1, unique: true };
}

/** A target from the `selectors` of a Recorder step, or null when none can be used. */
function targetFromSelectors(selectors) {
  const css = [];
  const xpath = [];
  const text = [];
  const aria = [];
  for (const entry of selectors ?? []) {
    if (!Array.isArray(entry) || entry.length !== 1 || typeof entry[0] !== "string") continue;
    const value = entry[0];
    if (value.startsWith("pierce/")) continue;
    if (value.startsWith("xpath/")) xpath.push(candidate("xpath", "xpath", value.slice(6)));
    else if (value.startsWith("aria/")) {
      aria.push(candidate("role-name", "xpath", ariaToXPath(value.slice(5))));
    } else if (value.startsWith("text/")) {
      text.push(candidate("text", "xpath", `//*[normalize-space(text())=${xpathLiteral(normalizeSpace(value.slice(5)))}]`));
    } else css.push(candidate("css", "css", value));
  }
  const all = [...css, ...xpath, ...text, ...aria];
  return all.length === 0 ? null : { selectors: all };
}

function unsupported(type, why) {
  return step("unsupported", { description: `the Recorder step ${type} ${why}` });
}

/** The steps of a DevTools Recorder user flow. */
export function fromReplay(recording) {
  const out = [];
  for (const raw of recording?.steps ?? []) {
    const type = String(raw?.type ?? "");
    if (type === "keyUp" || type === "close") continue;
    if (raw.target !== undefined && raw.target !== "main") {
      out.push(unsupported(type, "is in another tab or window and has no equivalent"));
      continue;
    }
    if (Array.isArray(raw.frame) && raw.frame.length > 0) {
      out.push(unsupported(type, "is inside a frame and has no equivalent"));
      continue;
    }
    const target = () => targetFromSelectors(raw.selectors);
    // The Recorder notes a step that caused a navigation; the generators wait after it.
    const loads = Array.isArray(raw.assertedEvents) && raw.assertedEvents.some((e) => e && e.type === "navigation");
    const effect = loads && type !== "navigate" ? { navigates: true } : {};
    switch (type) {
      case "setViewport":
        if (raw.isMobile === true) out.push(unsupported(type, "is a mobile viewport and has no equivalent"));
        else out.push(step("viewport", { width: raw.width, height: raw.height }));
        break;
      case "navigate":
        out.push(step("navigate", { url: raw.url }));
        break;
      case "click":
      case "doubleClick":
      case "hover": {
        const t = target();
        if (!t) {
          out.push(unsupported(type, "has no selector the generator can use"));
        } else if (type === "click" && raw.button === "secondary") {
          out.push(step("rightClick", { target: t, offsetX: raw.offsetX, offsetY: raw.offsetY }));
        } else if (type === "click" && raw.button !== undefined && raw.button !== "primary") {
          out.push(unsupported(type, `uses the ${raw.button} button and has no equivalent`));
        } else {
          out.push(step(type, { target: t, offsetX: raw.offsetX, offsetY: raw.offsetY, ...effect }));
        }
        break;
      }
      case "change": {
        const t = target();
        if (!t) out.push(unsupported(type, "has no selector the generator can use"));
        else out.push(step("setValue", { target: t, value: String(raw.value ?? "") }));
        break;
      }
      case "keyDown":
        out.push(step("keyPress", { key: String(raw.key ?? ""), ...effect }));
        break;
      case "scroll": {
        if (raw.selectors) {
          const t = target();
          if (t) out.push(step("scrollIntoView", { target: t }));
          else out.push(unsupported(type, "has no selector the generator can use"));
        } else {
          out.push(step("scroll", { x: raw.x ?? 0, y: raw.y ?? 0 }));
        }
        break;
      }
      case "waitForElement": {
        const t = target();
        const plain = (raw.count === undefined || raw.count === 1) && (raw.operator === undefined || raw.operator === ">=");
        if (!t || !plain) out.push(unsupported(type, "waits for a count of elements and has no equivalent"));
        else out.push(step("waitFor", { target: t, visible: raw.visible !== false }));
        break;
      }
      default:
        out.push(unsupported(type || "(unnamed)", "has no equivalent"));
    }
  }
  return out;
}

export { targetOf };
