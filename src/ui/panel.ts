// The panel shell: tabs, a notice line, and the context each view gets. It is the
// popup, the Chrome side panel and the Firefox sidebar (all load panel.html).
// `?tabId=N` makes it about one particular tab instead of the active one, which
// is how a test drives it from an ordinary tab.

import { ext } from "../shared/api.ts";
import { byId, h } from "../shared/dom.ts";
import { MSG, type Message, type Replies, isMessage, message } from "../shared/protocol.ts";
import { isRecord } from "../shared/guards.ts";
import { type ViewContext, views } from "./registry.ts";
import "./views/record.ts";
import "./views/inspect.ts";
import "./views/page.ts";

const params = new URLSearchParams(location.search);
const listeners = new Map<string, Set<() => void>>(); // area -> the functions to run

async function call<K extends keyof Replies>(type: K, payload: Record<string, unknown> = {}): Promise<Replies[K]> {
  const reply: unknown = await ext.runtime.sendMessage<Message, unknown>(message(type, payload));
  if (!isRecord(reply)) throw new Error("The extension did not answer. Reload it from the extensions page.");
  if (reply.ok !== true) throw new Error(typeof reply.error === "string" && reply.error !== "" ? reply.error : "Something went wrong.");
  // The background answers each message type with the fields `Replies` lists for it.
  return reply as unknown as Replies[K];
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const forced = Number(params.get("tabId"));
  if (forced) return ext.tabs.get(forced);
  const [tab] = await ext.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error("There is no active tab.");
  return tab;
}

const notice = byId("notice");
function notify(text: string | null | undefined): void {
  if (!text) {
    notice.hidden = true;
    notice.textContent = "";
  } else {
    notice.hidden = false;
    notice.textContent = text;
  }
}

const ctx: ViewContext = {
  call,
  activeTab,
  notify,
  params,
  onChange(area, fn) {
    let functions = listeners.get(area);
    if (!functions) {
      functions = new Set();
      listeners.set(area, functions);
    }
    functions.add(fn);
  },
};

ext.runtime.onMessage.addListener((incoming: unknown) => {
  if (isMessage(incoming) && incoming.type === MSG.STATE_CHANGED && typeof incoming.area === "string") {
    for (const fn of listeners.get(incoming.area) ?? []) fn();
  }
  return false;
});

const tabs = byId("tabs");
const main = byId("views");
const sections = new Map<string, HTMLElement>();

function select(id: string): void {
  for (const view of views) {
    const section = sections.get(view.id);
    if (!section) continue;
    const on = view.id === id;
    byId(`tab-${view.id}`).setAttribute("aria-selected", String(on));
    section.hidden = !on;
    if (on && typeof view.show === "function") void view.show(section, ctx);
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
const wanted = params.get("view");
if (wanted && views.some((v) => v.id === wanted)) initial = wanted;
if (initial) select(initial);
