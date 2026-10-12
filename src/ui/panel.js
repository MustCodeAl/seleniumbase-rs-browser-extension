// The panel shell: tabs, a notice line, and the context each view gets. It is the
// popup, the Chrome side panel and the Firefox sidebar (all load panel.html).
// `?tabId=N` makes it about one particular tab instead of the active one, which
// is how a test drives it from an ordinary tab.

import { ext } from "../shared/api.js";
import { h } from "../shared/dom.js";
import { MSG, message } from "../shared/protocol.js";
import { views } from "./registry.js";
import "./views/record.js";
import "./views/inspect.js";
import "./views/page.js";

const params = new URLSearchParams(location.search);
const listeners = new Map(); // area -> Set<fn>

async function call(type, payload = {}) {
  const reply = await ext.runtime.sendMessage(message(type, payload));
  if (!reply) throw new Error("The extension did not answer. Reload it from the extensions page.");
  if (!reply.ok) throw new Error(reply.error || "Something went wrong.");
  return reply;
}

async function activeTab() {
  const forced = Number(params.get("tabId"));
  if (forced) return ext.tabs.get(forced);
  const [tab] = await ext.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error("There is no active tab.");
  return tab;
}

const notice = document.getElementById("notice");
function notify(text) {
  if (!text) {
    notice.hidden = true;
    notice.textContent = "";
  } else {
    notice.hidden = false;
    notice.textContent = text;
  }
}

const ctx = {
  call,
  activeTab,
  notify,
  params,
  onChange(area, fn) {
    if (!listeners.has(area)) listeners.set(area, new Set());
    listeners.get(area).add(fn);
  },
};

ext.runtime.onMessage.addListener((incoming) => {
  if (incoming && incoming.v === 1 && incoming.type === MSG.STATE_CHANGED) {
    for (const fn of listeners.get(incoming.area) ?? []) fn();
  }
  return false;
});

const tabs = document.getElementById("tabs");
const main = document.getElementById("views");
const sections = new Map();

function select(id) {
  for (const view of views) {
    const on = view.id === id;
    document.getElementById(`tab-${view.id}`).setAttribute("aria-selected", String(on));
    sections.get(view.id).hidden = !on;
    if (on && typeof view.show === "function") void view.show(sections.get(view.id), ctx);
  }
  notify(null);
  try {
    localStorage.setItem("sbrs.view", id);
  } catch {
    // storage may be blocked; the view is simply not remembered
  }
}

views.sort((a, b) => a.order - b.order);
for (const view of views) {
  tabs.append(
    h("button", {
      role: "tab",
      id: `tab-${view.id}`,
      "aria-controls": `view-${view.id}`,
      "aria-selected": "false",
      text: view.title,
      onclick: () => select(view.id),
    }),
  );
  const section = h("section", { id: `view-${view.id}`, role: "tabpanel", "aria-labelledby": `tab-${view.id}`, hidden: true });
  sections.set(view.id, section);
  main.append(section);
  view.render(section, ctx);
}

let initial = views[0]?.id;
try {
  const saved = localStorage.getItem("sbrs.view");
  if (saved && views.some((v) => v.id === saved)) initial = saved;
} catch {
  // not remembered
}
if (params.get("view") && views.some((v) => v.id === params.get("view"))) initial = params.get("view");
if (initial) select(initial);
