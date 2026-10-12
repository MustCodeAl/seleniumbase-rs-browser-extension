// The recorder's side of the background: it owns the recording (the steps, which
// tab is being recorded) and answers the panel and the content script.
//
// State lives in extension storage, not in memory, because the service worker is
// stopped and started by the browser at will. Steps are in `storage.local` so a
// recording survives a restart; "which tab is being recorded" is in
// `storage.session`, which is cleared when the browser closes. All reads and
// writes go through one lock.

import { ext } from "../shared/api.js";
import { generate } from "../shared/codegen/index.js";
import { MSG, message } from "../shared/protocol.js";
import {
  appendStep,
  deleteStep,
  editStep,
  moveStep,
  sanitizeStep,
  shouldRecordNavigation,
  step,
} from "../shared/steps.js";
import { broadcast, registerHandler } from "../background/router.js";
import { RECORDABLE, accessError, get, injectFiles, local, makeLock, remove, session, set } from "../background/store.js";

const K_STEPS = "recorder.steps";
const K_ACTIVE = "recorder.active";
const K_SETTINGS = "recorder.settings";
const K_META = "recorder.meta";
const CONTENT_FILE = "recorder/content.js";

const DEFAULT_SETTINGS = { recordScroll: false, entry: "test" };

const locked = makeLock();

async function load() {
  const [steps, active, settings, meta] = await Promise.all([
    get(local, K_STEPS, []),
    get(session, K_ACTIVE, null),
    get(local, K_SETTINGS, DEFAULT_SETTINGS),
    get(local, K_META, {}),
  ]);
  return { steps, active, settings: { ...DEFAULT_SETTINGS, ...settings }, meta };
}

function snapshot(state) {
  return {
    active: state.active !== null,
    tabId: state.active ? state.active.tabId : null,
    warning: state.active ? (state.active.warning ?? null) : null,
    steps: state.steps,
    settings: state.settings,
    name: state.meta.name ?? "",
    title: state.meta.title ?? "",
  };
}

async function saveSteps(steps) {
  await set(local, K_STEPS, steps);
}

async function changed() {
  await broadcast(MSG.STATE_CHANGED, { area: "recorder" });
}

async function start({ tabId, append }) {
  if (typeof tabId !== "number") throw new Error("recorder/start needs a tabId");
  const tab = await ext.tabs.get(tabId);
  const state = await load();
  let steps = append ? state.steps : [];
  if (typeof tab.url === "string" && RECORDABLE.test(tab.url)) {
    steps = appendStep(steps, step("navigate", { url: tab.url }));
  }
  // Active before injecting: the script asks "am I recording?" the moment it runs.
  await set(session, K_ACTIVE, { tabId, startedAt: Date.now() });
  await saveSteps(steps);
  await set(local, K_META, { ...state.meta, title: tab.title ?? "", name: state.meta.name ?? "" });
  try {
    await injectFiles(tabId, [CONTENT_FILE], tab.url);
  } catch (error) {
    await remove(session, K_ACTIVE);
    throw error;
  }
  await changed();
  return snapshot(await load());
}

async function stop() {
  const state = await load();
  if (state.active) {
    try {
      await ext.tabs.sendMessage(state.active.tabId, message(MSG.RECORDER_DETACH));
    } catch {
      // the tab is gone or has no script
    }
  }
  await remove(session, K_ACTIVE);
  await changed();
  return snapshot(await load());
}

registerHandler(MSG.RECORDER_START, (m) => locked(() => start(m)));
registerHandler(MSG.RECORDER_STOP, () => locked(stop));
registerHandler(MSG.RECORDER_STATE, () => locked(async () => snapshot(await load())));

registerHandler(MSG.RECORDER_CLEAR, () =>
  locked(async () => {
    await saveSteps([]);
    await changed();
    return snapshot(await load());
  }),
);

registerHandler(MSG.RECORDER_EDIT_STEP, ({ id, patch }) =>
  locked(async () => {
    const state = await load();
    await saveSteps(editStep(state.steps, id, patch ?? {}));
    await changed();
    return snapshot(await load());
  }),
);

registerHandler(MSG.RECORDER_DELETE_STEP, ({ id }) =>
  locked(async () => {
    const state = await load();
    await saveSteps(deleteStep(state.steps, id));
    await changed();
    return snapshot(await load());
  }),
);

registerHandler(MSG.RECORDER_MOVE_STEP, ({ id, delta }) =>
  locked(async () => {
    const state = await load();
    await saveSteps(moveStep(state.steps, id, delta === -1 ? -1 : 1));
    await changed();
    return snapshot(await load());
  }),
);

registerHandler(MSG.RECORDER_SETTINGS, ({ patch }) =>
  locked(async () => {
    const state = await load();
    const next = { ...state.settings };
    if (patch && typeof patch.recordScroll === "boolean") next.recordScroll = patch.recordScroll;
    if (patch && (patch.entry === "test" || patch.entry === "main")) next.entry = patch.entry;
    await set(local, K_SETTINGS, next);
    let meta = state.meta;
    if (patch && typeof patch.name === "string") {
      meta = { ...meta, name: patch.name.slice(0, 120) };
      await set(local, K_META, meta);
    }
    return snapshot(await load());
  }),
);

registerHandler(MSG.RECORDER_EXPORT, ({ format, name, entry }) =>
  locked(async () => {
    const state = await load();
    const file = generate(format, state.steps, {
      name: typeof name === "string" && name !== "" ? name : (state.meta.name || ""),
      entry: entry === "main" ? "main" : "test",
    });
    return file;
  }),
);

// From the content script ----------------------------------------------------

function fromRecordedTab(state, sender) {
  return Boolean(state.active) && sender.tab?.id === state.active.tabId && (sender.frameId ?? 0) === 0;
}

registerHandler(
  MSG.RECORDER_HELLO,
  ({ url, title, nav }, sender) =>
    locked(async () => {
      const state = await load();
      if (!fromRecordedTab(state, sender)) return { active: false };
      let steps = state.steps;
      if (typeof url === "string" && RECORDABLE.test(url) && shouldRecordNavigation(steps, { url, nav, now: Date.now() })) {
        steps = appendStep(steps, step("navigate", { url }));
        await saveSteps(steps);
        await changed();
      }
      if (!state.meta.title && typeof title === "string") {
        await set(local, K_META, { ...state.meta, title: title.slice(0, 200) });
      }
      if (state.active.warning) await set(session, K_ACTIVE, { ...state.active, warning: null });
      return { active: true, settings: state.settings };
    }),
  "content",
);

registerHandler(
  MSG.RECORDER_STEP,
  ({ step: raw }, sender) =>
    locked(async () => {
      const state = await load();
      if (!fromRecordedTab(state, sender)) return { accepted: false };
      const clean = sanitizeStep(raw);
      if (!clean) return { accepted: false };
      await saveSteps(appendStep(state.steps, { ...clean, t: Date.now() }));
      await changed();
      return { accepted: true };
    }),
  "content",
);

// Following the recorded tab ------------------------------------------------

ext.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== "loading" && info.status !== "complete") return;
  void locked(async () => {
    const state = await load();
    if (!state.active || state.active.tabId !== tabId) return;
    try {
      const tab = await ext.tabs.get(tabId);
      await injectFiles(tabId, [CONTENT_FILE], tab.url);
    } catch (error) {
      // Access to the new page ended with the last one (activeTab lasts for one page).
      const warning = accessError(error, undefined);
      await set(session, K_ACTIVE, { ...state.active, warning });
      await changed();
    }
  });
});

ext.tabs.onRemoved.addListener((tabId) => {
  void locked(async () => {
    const state = await load();
    if (state.active && state.active.tabId === tabId) {
      await remove(session, K_ACTIVE);
      await changed();
    }
  });
});
