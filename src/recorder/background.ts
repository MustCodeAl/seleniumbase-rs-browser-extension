// The recorder's side of the background: it owns the recording (the steps, which
// tab is being recorded) and answers the panel and the content script.
//
// State lives in extension storage, not in memory, because the service worker is
// stopped and started by the browser at will. Steps are in `storage.local` so a
// recording survives a restart; "which tab is being recorded" is in
// `storage.session`, which is cleared when the browser closes. All reads and
// writes go through one lock.

import { ext } from "../shared/api.ts";
import { generate, isExportFormat } from "../shared/codegen/index.ts";
import { isRecord } from "../shared/guards.ts";
import { MSG, type Message, type RecorderSettings, type RecorderSnapshot, message } from "../shared/protocol.ts";
import {
  type Step,
  appendStep,
  deleteStep,
  editStep,
  markNavigation,
  moveStep,
  sanitizeStep,
  shouldRecordNavigation,
  step,
} from "../shared/steps.ts";
import { broadcast, registerHandler } from "../background/router.ts";
import { RECORDABLE, accessError, get, injectFiles, local, makeLock, remove, session, set } from "../background/store.ts";

const K_STEPS = "recorder.steps";
const K_ACTIVE = "recorder.active";
const K_SETTINGS = "recorder.settings";
const K_META = "recorder.meta";
const CONTENT_FILE = "recorder/content.js";

const DEFAULT_SETTINGS: RecorderSettings = { recordScroll: false, entry: "test" };

/** Which tab is being recorded, kept in `storage.session`. */
interface Active {
  tabId: number;
  startedAt?: number;
  /** The document of the tab that last said hello, so the same one asking again is not a new page. */
  doc?: number | null;
  warning?: string | null;
}

/** What the recording is called, kept with the steps. */
interface Meta {
  name?: string;
  title?: string;
}

interface State {
  steps: Step[];
  active: Active | null;
  settings: RecorderSettings;
  meta: Meta;
}

const locked = makeLock();

async function load(): Promise<State> {
  const [steps, active, settings, meta] = await Promise.all([
    get<Step[]>(local, K_STEPS, []),
    get<Active | null>(session, K_ACTIVE, null),
    get<Partial<RecorderSettings>>(local, K_SETTINGS, DEFAULT_SETTINGS),
    get<Meta>(local, K_META, {}),
  ]);
  return { steps, active, settings: { ...DEFAULT_SETTINGS, ...settings }, meta };
}

function snapshot(state: State): RecorderSnapshot {
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

async function saveSteps(steps: Step[]): Promise<void> {
  await set(local, K_STEPS, steps);
}

async function changed(): Promise<void> {
  await broadcast(MSG.STATE_CHANGED, { area: "recorder" });
}

async function start({ tabId, append }: Message): Promise<RecorderSnapshot> {
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

async function stop(): Promise<RecorderSnapshot> {
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
    if (typeof id !== "string") throw new Error("recorder/edit-step needs an id");
    const state = await load();
    await saveSteps(editStep(state.steps, id, isRecord(patch) ? patch : {}));
    await changed();
    return snapshot(await load());
  }),
);

registerHandler(MSG.RECORDER_DELETE_STEP, ({ id }) =>
  locked(async () => {
    if (typeof id !== "string") throw new Error("recorder/delete-step needs an id");
    const state = await load();
    await saveSteps(deleteStep(state.steps, id));
    await changed();
    return snapshot(await load());
  }),
);

registerHandler(MSG.RECORDER_MOVE_STEP, ({ id, delta }) =>
  locked(async () => {
    if (typeof id !== "string") throw new Error("recorder/move-step needs an id");
    const state = await load();
    await saveSteps(moveStep(state.steps, id, delta === -1 ? -1 : 1));
    await changed();
    return snapshot(await load());
  }),
);

registerHandler(MSG.RECORDER_SETTINGS, ({ patch }) =>
  locked(async () => {
    const state = await load();
    const changes: Record<string, unknown> = isRecord(patch) ? patch : {};
    const next: RecorderSettings = { ...state.settings };
    if (typeof changes.recordScroll === "boolean") next.recordScroll = changes.recordScroll;
    if (changes.entry === "test" || changes.entry === "main") next.entry = changes.entry;
    await set(local, K_SETTINGS, next);
    let meta = state.meta;
    if (typeof changes.name === "string") {
      meta = { ...meta, name: changes.name.slice(0, 120) };
      await set(local, K_META, meta);
    }
    return snapshot(await load());
  }),
);

registerHandler(MSG.RECORDER_EXPORT, ({ format, name, entry }) =>
  locked(async () => {
    const state = await load();
    if (!isExportFormat(format)) throw new Error(`unknown export format ${JSON.stringify(format)}`);
    const file = generate(format, state.steps, {
      name: typeof name === "string" && name !== "" ? name : (state.meta.name || ""),
      entry: entry === "main" ? "main" : "test",
    });
    return file;
  }),
);

// From the content script ----------------------------------------------------

/** The recording, if `sender` is the top frame of the tab being recorded. */
function recordedTab(state: State, sender: chrome.runtime.MessageSender): Active | null {
  const { active } = state;
  return active && sender.tab?.id === active.tabId && (sender.frameId ?? 0) === 0 ? active : null;
}

registerHandler(
  MSG.RECORDER_HELLO,
  ({ url, title, nav, doc }, sender) =>
    locked(async () => {
      const state = await load();
      const active = recordedTab(state, sender);
      if (!active) return { active: false };
      // The same document asking again (the script is injected on `loading` and on
      // `complete`) is not a new page.
      const sameDocument = typeof doc === "number" && active.doc === doc;
      if (!sameDocument) {
        await set(session, K_ACTIVE, { ...active, doc: typeof doc === "number" ? doc : null, warning: null });
        const now = Date.now();
        let steps = state.steps;
        const navigation = typeof nav === "string" ? nav : undefined;
        if (typeof url === "string" && RECORDABLE.test(url) && shouldRecordNavigation(steps, { url, nav: navigation, now })) {
          steps = appendStep(steps, step("navigate", { url }));
          await saveSteps(steps);
          await changed();
        } else {
          const marked = markNavigation(steps, { nav: navigation, now });
          if (marked !== steps) {
            await saveSteps(marked);
            await changed();
          }
        }
        if (!state.meta.title && typeof title === "string") {
          await set(local, K_META, { ...state.meta, title: title.slice(0, 200) });
        }
      }
      return { active: true, settings: state.settings };
    }),
  "content",
);

registerHandler(
  MSG.RECORDER_STEP,
  ({ step: raw }, sender) =>
    locked(async () => {
      const state = await load();
      if (!recordedTab(state, sender)) return { accepted: false };
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
