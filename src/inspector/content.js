// The inspector's picker. Injected on demand into the active tab. It draws a
// highlight under the pointer, swallows the click that picks an element (the page
// does not see it), and shows the element's selectors with how many elements each
// matches, and ready-to-copy calls for both seleniumbase-rs engines. Escape
// cancels. Everything is drawn in a closed shadow root, so the page's styles and
// scripts neither reach the panel nor are changed by it.

import { ext } from "../shared/api.js";
import { callsFor } from "../shared/calls.js";
import { h } from "../shared/dom.js";
import { MSG, message } from "../shared/protocol.js";
import { copyButton, renderPick } from "../shared/pickview.js";
import { INTERACTIVE_SELECTOR, generateSelectors } from "../shared/selectors.js";

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.hl { position: fixed; pointer-events: none; border: 2px solid #2563eb; background: rgba(37, 99, 235, .15); }
.tip { position: fixed; pointer-events: none; font: 12px/1.3 ui-monospace, Menlo, Consolas, monospace; background: #111827; color: #fff; padding: 2px 6px; border-radius: 4px; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panel { position: fixed; right: 12px; top: 12px; width: min(480px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow: auto; pointer-events: auto; background: #fff; color: #111827; border: 1px solid #d1d5db; border-radius: 10px; box-shadow: 0 8px 30px rgba(0, 0, 0, .25); font: 13px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; padding: 12px; }
@media (prefers-color-scheme: dark) { .panel { background: #111827; color: #f3f4f6; border-color: #374151; } .row { border-color: #374151; } code { background: #1f2937; } button { background: #1f2937; color: #f3f4f6; border-color: #4b5563; } }
h2 { margin: 0 0 4px; font-size: 14px; font-weight: 600; }
h3 { margin: 12px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; font-weight: 600; }
.sub { color: #6b7280; margin-bottom: 6px; word-break: break-word; }
.row { display: flex; gap: 8px; align-items: flex-start; padding: 5px 0; border-top: 1px solid #e5e7eb; }
.row code { flex: 1; min-width: 0; }
code { font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace; background: #f3f4f6; padding: 1px 4px; border-radius: 4px; word-break: break-all; white-space: pre-wrap; }
.badge { flex: none; font-size: 11px; padding: 1px 6px; border-radius: 999px; background: #fef3c7; color: #92400e; white-space: nowrap; }
.badge.one { background: #dcfce7; color: #166534; }
button { font: inherit; cursor: pointer; border: 1px solid #d1d5db; background: #f9fafb; color: #111827; border-radius: 6px; padding: 2px 8px; flex: none; }
button:hover { border-color: #2563eb; }
.bar { display: flex; gap: 8px; margin-top: 10px; }
.label { flex: none; width: 74px; color: #6b7280; font-size: 12px; }
`;

function create() {
  let host = null;
  let shadow = null;
  let highlight = null;
  let tip = null;
  let panel = null;
  let picking = false;
  let hovered = null;

  const send = (type, payload) => {
    try {
      return ext.runtime.sendMessage(message(type, payload)).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  };

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement("sbrs-inspector");
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    shadow = host.attachShadow({ mode: "closed" });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      shadow.append(h("style", { text: CSS }));
    }
    highlight = h("div", { class: "hl" });
    tip = h("div", { class: "tip" });
    highlight.hidden = true;
    tip.hidden = true;
    shadow.append(highlight, tip);
    document.documentElement.append(host);
  }

  function label(el) {
    const id = el.getAttribute("id");
    const classes = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 2);
    return el.localName + (id ? `#${id}` : "") + classes.map((c) => `.${c}`).join("");
  }

  // The element a pick lands on: the control under the pointer (the button, not the
  // icon inside it). Hold Alt to pick exactly what is under the pointer.
  function elementAt(x, y, exact) {
    const el = document.elementFromPoint(x, y);
    if (!el || el === host) return null;
    if (exact) return el;
    const control = el.closest ? el.closest(INTERACTIVE_SELECTOR) : null;
    return control ?? el;
  }

  function inside(event) {
    return typeof event.composedPath === "function" && event.composedPath().includes(host);
  }

  function onMove(event) {
    if (!picking) return;
    const el = elementAt(event.clientX, event.clientY, event.altKey);
    hovered = el;
    if (!el) {
      highlight.hidden = true;
      tip.hidden = true;
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(highlight.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    tip.textContent = label(el);
    Object.assign(tip.style, { left: `${Math.max(0, r.left)}px`, top: `${r.top > 24 ? r.top - 22 : r.bottom + 4}px` });
    highlight.hidden = false;
    tip.hidden = false;
  }

  // While picking, the page must not see the pointer or the click.
  function swallow(event) {
    if (!picking || inside(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onClick(event) {
    if (!picking || inside(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const el = elementAt(event.clientX, event.clientY, event.altKey) ?? hovered;
    if (el) pick(el);
  }

  function onKey(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const wasPicking = picking;
    stop();
    void send(MSG.INSPECTOR_CANCELLED, { picking: wasPicking });
  }

  const POINTER_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "contextmenu", "auxclick"];

  function listen() {
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    for (const type of POINTER_EVENTS) document.addEventListener(type, swallow, true);
  }

  function unlisten() {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    for (const type of POINTER_EVENTS) document.removeEventListener(type, swallow, true);
  }

  function describeElement(el) {
    const generated = generateSelectors(el);
    const best = generated.best;
    const info = { tag: generated.tag, inputType: generated.inputType, text: generated.text };
    return {
      at: Date.now(),
      url: location.href,
      title: document.title,
      tag: generated.tag,
      role: generated.role,
      name: generated.name,
      text: generated.text,
      inputType: generated.inputType,
      candidates: generated.candidates,
      best: best ? best.value : null,
      calls: best ? callsFor(best.value, info) : [],
    };
  }

  function showPanel(result) {
    if (panel) panel.remove();
    const again = h("button", { type: "button", text: "Pick another" });
    again.addEventListener("click", () => start());
    const close = h("button", { type: "button", text: "Close" });
    close.addEventListener("click", () => stop());
    panel = h(
      "div",
      { class: "panel" },
      renderPick(result),
      h("div", { class: "bar" }, again, copyButton(JSON.stringify(result, null, 2), "everything as JSON"), close),
    );
    shadow.append(panel);
  }

  function pick(el) {
    picking = false;
    highlight.hidden = true;
    tip.hidden = true;
    const result = describeElement(el);
    showPanel(result);
    void send(MSG.INSPECTOR_PICKED, { result });
  }

  function start() {
    ensureHost();
    if (panel) {
      panel.remove();
      panel = null;
    }
    if (!picking) {
      picking = true;
      listen();
    }
  }

  function stop() {
    picking = false;
    unlisten();
    if (host) host.remove();
    host = shadow = highlight = tip = panel = null;
  }

  ext.runtime.onMessage.addListener((incoming) => {
    if (incoming && incoming.v === 1 && incoming.type === MSG.INSPECTOR_STOP) stop();
    return false;
  });

  // `listen()` stays on after a pick so Escape closes the panel; the pointer
  // handlers ignore events while `picking` is false.
  return { start, stop };
}

if (window.__sbrsInspector) {
  window.__sbrsInspector.start();
} else {
  window.__sbrsInspector = create();
  window.__sbrsInspector.start();
}
