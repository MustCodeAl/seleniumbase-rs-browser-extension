// The recorder's content script. It is injected into the recorded tab (never
// declared in the manifest) and stays dormant unless the background says this
// tab is being recorded.
//
// It sees real user events only (`isTrusted`), turns them into steps with
// selectors checked against the page, and sends each step to the background.
// Typing is held back until the person pauses, so a field becomes one step.
// The value of a password or payment field is never read: `isSensitiveField`
// decides before `.value` is touched.

import { ext } from "../shared/api.js";
import { MSG, message } from "../shared/protocol.js";
import { INTERACTIVE_SELECTOR, generateSelectors } from "../shared/selectors.js";
import { isSensitiveField } from "../shared/steps.js";

const TYPING_PAUSE_MS = 500;
const SCROLL_PAUSE_MS = 250;
const SCROLL_MIN_PX = 100;

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "tel", "url", "password", "number", ""]);
const NON_TEXT_VALUE_TYPES = new Set(["range", "color", "date", "time", "datetime-local", "month", "week"]);
const NAVIGATION_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
const CLICKABLE = INTERACTIVE_SELECTOR;

function create() {
  let enabled = false;
  let settings = { recordScroll: false };
  let pending = null; // { el, timer }
  let lastScrollY = window.scrollY;
  let lastScrollX = window.scrollX;
  let scrollTimer = 0;
  let installed = false;
  let implicitSubmitUntil = 0; // Enter in a field was pressed: a submit-button click that follows is its effect

  const send = (type, payload) => {
    try {
      return ext.runtime.sendMessage(message(type, payload)).catch(() => null);
    } catch {
      return Promise.resolve(null); // the extension was reloaded under this page
    }
  };

  function navigationType() {
    try {
      return performance.getEntriesByType("navigation")[0]?.type ?? "navigate";
    } catch {
      return "navigate";
    }
  }

  // ---- targets

  function retarget(node) {
    let el = node && node.nodeType === 1 ? node : (node?.parentElement ?? null);
    while (el) {
      const root = el.getRootNode();
      if (root && root.host && root !== document) el = root.host;
      else break;
    }
    return el;
  }

  function eventElement(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    return retarget(path[0] ?? event.target);
  }

  function isTextEntry(el) {
    if (!el) return false;
    const tag = el.localName;
    if (tag === "textarea") return true;
    if (tag === "input") return TEXT_INPUT_TYPES.has((el.getAttribute("type") || "").toLowerCase());
    return Boolean(el.isContentEditable);
  }

  function describe(el) {
    const generated = generateSelectors(el);
    const field = ["input", "select", "textarea"].includes(el.localName);
    return {
      tag: generated.tag,
      role: generated.role ?? undefined,
      name: generated.name,
      text: field ? "" : generated.text,
      selectors: generated.candidates.filter((c) => c.unique).slice(0, 6),
    };
  }

  function sensitivity(el) {
    return isSensitiveField({
      type: el.getAttribute("type") ?? "",
      autocomplete: el.getAttribute("autocomplete") ?? "",
      name: el.getAttribute("name") ?? "",
      id: el.getAttribute("id") ?? "",
      placeholder: el.getAttribute("placeholder") ?? "",
      ariaLabel: el.getAttribute("aria-label") ?? "",
    });
  }

  function emit(raw) {
    void send(MSG.RECORDER_STEP, { step: { ...raw, url: location.href } });
  }

  // ---- typing

  function flushTyping() {
    if (!pending) return;
    const { el, timer } = pending;
    pending = null;
    clearTimeout(timer);
    if (!el.isConnected) return;
    const secret = sensitivity(el);
    const target = describe(el);
    if (secret.sensitive) {
      emit({ type: "change", target, value: "", sensitive: true, secret: secret.label });
    } else {
      emit({ type: "change", target, value: String(el.value ?? el.textContent ?? "") });
    }
  }

  function noteTyping(el) {
    if (pending && pending.el !== el) flushTyping();
    if (pending) clearTimeout(pending.timer);
    pending = { el, timer: setTimeout(flushTyping, TYPING_PAUSE_MS) };
  }

  // ---- event handlers

  function onClick(event) {
    if (!enabled || !event.isTrusted || event.button !== 0) return;
    // Enter in a text field submits its form by "clicking" the submit button. The
    // Enter key press is the step; the click it causes is not another one.
    if (event.detail === 0 && Date.now() < implicitSubmitUntil) {
      const control = eventElement(event);
      const type = control ? (control.getAttribute("type") || "").toLowerCase() : "";
      if (control && control.form && ((control.localName === "button" && (type === "" || type === "submit")) || (control.localName === "input" && (type === "submit" || type === "image")))) {
        return;
      }
    }
    flushTyping();
    const raw = eventElement(event);
    if (!raw) return;
    const el = raw.closest ? (retarget(raw.closest(CLICKABLE)) ?? raw) : raw;
    const tag = el.localName;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (isTextEntry(el) && !el.isContentEditable) return; // focusing a field; the typing is the step
    if (tag === "select" || tag === "option") return;
    if (tag === "input" && (type === "checkbox" || type === "radio" || type === "file")) return;
    if (tag === "label" && el.control && ["checkbox", "radio", "file"].includes((el.control.getAttribute("type") || "").toLowerCase())) return;
    const rect = el.getBoundingClientRect();
    emit({
      type: "click",
      target: describe(el),
      offsetX: Math.max(0, Math.round(event.clientX - rect.left)),
      offsetY: Math.max(0, Math.round(event.clientY - rect.top)),
    });
  }

  function onDoubleClick(event) {
    if (!enabled || !event.isTrusted) return;
    const raw = eventElement(event);
    if (!raw) return;
    const el = raw.closest ? (retarget(raw.closest(CLICKABLE)) ?? raw) : raw;
    if (isTextEntry(el)) return; // a double click in a field selects a word
    const rect = el.getBoundingClientRect();
    emit({
      type: "doubleClick",
      target: describe(el),
      offsetX: Math.max(0, Math.round(event.clientX - rect.left)),
      offsetY: Math.max(0, Math.round(event.clientY - rect.top)),
    });
  }

  function onContextMenu(event) {
    if (!enabled || !event.isTrusted) return;
    flushTyping();
    const el = eventElement(event);
    if (el) emit({ type: "rightClick", target: describe(el) });
  }

  function onInput(event) {
    if (!enabled || !event.isTrusted) return;
    const el = eventElement(event);
    if (el && isTextEntry(el) && !el.isContentEditable) noteTyping(el);
  }

  function onChange(event) {
    if (!enabled || !event.isTrusted) return;
    const el = eventElement(event);
    if (!el) return;
    const tag = el.localName;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "select") {
      flushTyping();
      const option = el.selectedOptions && el.selectedOptions[0];
      emit({
        type: "select",
        target: describe(el),
        value: String(el.value ?? ""),
        text: option ? String(option.textContent ?? "").trim() : "",
        index: el.selectedIndex,
      });
    } else if (tag === "input" && (type === "checkbox" || type === "radio")) {
      flushTyping();
      emit({ type: el.checked ? "check" : "uncheck", target: describe(el) });
    } else if (tag === "input" && type === "file") {
      flushTyping();
      emit({ type: "setFiles", target: describe(el), names: Array.from(el.files ?? []).map((f) => f.name) });
    } else if (tag === "input" && NON_TEXT_VALUE_TYPES.has(type)) {
      flushTyping();
      emit({ type: "setValue", target: describe(el), value: String(el.value ?? "") });
    } else if (isTextEntry(el)) {
      flushTyping();
    }
  }

  function onKeyDown(event) {
    if (!enabled || !event.isTrusted || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    const el = eventElement(event);
    const textEntry = isTextEntry(el);
    if (key === "Enter") {
      if (el && (el.localName === "textarea" || ["button", "a", "summary", "select"].includes(el.localName))) return;
      if (el && el.localName === "input" && ["button", "submit", "reset", "checkbox", "radio", "file"].includes((el.getAttribute("type") || "").toLowerCase())) return;
    } else if (key === "Escape") {
      // always recorded
    } else if (NAVIGATION_KEYS.has(key)) {
      // Arrows move a caret in a field and change the value of a select, a radio
      // group, a slider; the field's own change event records those.
      const type = el && el.localName === "input" ? (el.getAttribute("type") || "").toLowerCase() : "";
      if (textEntry || (el && el.localName === "select") || ["radio", "range", "number"].includes(type)) return;
    } else {
      return;
    }
    flushTyping();
    if (key === "Enter" && textEntry) implicitSubmitUntil = Date.now() + 300;
    const body = el && el !== document.body && el !== document.documentElement ? describe(el) : undefined;
    emit({ type: "keyPress", key, ...(body ? { target: body } : {}) });
  }

  function onScroll() {
    if (!enabled || !settings.recordScroll) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const dx = Math.abs(window.scrollX - lastScrollX);
      const dy = Math.abs(window.scrollY - lastScrollY);
      if (dx < SCROLL_MIN_PX && dy < SCROLL_MIN_PX) return;
      lastScrollX = window.scrollX;
      lastScrollY = window.scrollY;
      emit({ type: "scroll", x: Math.round(window.scrollX), y: Math.round(window.scrollY) });
    }, SCROLL_PAUSE_MS);
  }

  function onPageHide() {
    if (enabled) flushTyping();
  }

  function install() {
    if (installed) return;
    installed = true;
    const capture = { capture: true, passive: true };
    document.addEventListener("click", onClick, capture);
    document.addEventListener("dblclick", onDoubleClick, capture);
    document.addEventListener("contextmenu", onContextMenu, capture);
    document.addEventListener("input", onInput, capture);
    document.addEventListener("change", onChange, capture);
    document.addEventListener("keydown", onKeyDown, capture);
    window.addEventListener("scroll", onScroll, capture);
    window.addEventListener("pagehide", onPageHide, capture);
    ext.runtime.onMessage.addListener((incoming) => {
      if (incoming && incoming.v === 1 && incoming.type === MSG.RECORDER_DETACH) detach();
      return false;
    });
  }

  async function attach() {
    const reply = await send(MSG.RECORDER_HELLO, {
      url: location.href,
      title: document.title,
      nav: navigationType(),
      doc: performance.timeOrigin, // one value per loaded document
    });
    if (reply && reply.ok && reply.active) {
      settings = { ...settings, ...(reply.settings ?? {}) };
      enabled = true;
      install();
    } else {
      enabled = false;
    }
  }

  function detach() {
    flushTyping();
    enabled = false;
  }

  return { attach, detach };
}

if (window.__sbrsRecorder) {
  void window.__sbrsRecorder.attach();
} else {
  window.__sbrsRecorder = create();
  void window.__sbrsRecorder.attach();
}
