// The inspector's side of the background: start the picker in a tab, keep the
// last pick for the panel, and run the "what this page sees" probe in the page's
// own world.

import { ext } from "../shared/api.ts";
import { toFingerprint } from "../shared/fingerprint.ts";
import { isRecord } from "../shared/guards.ts";
import { MSG } from "../shared/protocol.ts";
import type { PickResult } from "../shared/pickview.ts";
import { broadcast, registerHandler } from "../background/router.ts";
import { accessError, get, injectFiles, session, set } from "../background/store.ts";
import { probePage } from "./probe.ts";

const K_LAST = "inspector.last";
const MAX_RESULT_BYTES = 200_000;

registerHandler(MSG.INSPECTOR_PICK, async ({ tabId }) => {
  if (typeof tabId !== "number") throw new Error("inspector/pick needs a tabId");
  const tab = await ext.tabs.get(tabId);
  await injectFiles(tabId, ["inspector/content.js"], tab.url);
  return {};
});

registerHandler(MSG.INSPECTOR_LAST, async () => ({ last: await get<PickResult | null>(session, K_LAST, null) }));

registerHandler(
  MSG.INSPECTOR_PICKED,
  async ({ result }) => {
    if (!isRecord(result) || JSON.stringify(result).length > MAX_RESULT_BYTES) {
      return { stored: false };
    }
    await set(session, K_LAST, result);
    await broadcast(MSG.STATE_CHANGED, { area: "inspector" });
    return { stored: true };
  },
  "content",
);

registerHandler(MSG.INSPECTOR_CANCELLED, async () => ({}), "content");

registerHandler(MSG.INSPECTOR_PROBE, async ({ tabId }) => {
  if (typeof tabId !== "number") throw new Error("inspector/probe needs a tabId");
  const tab = await ext.tabs.get(tabId);
  let results: chrome.scripting.InjectionResult<Awaited<ReturnType<typeof probePage>>>[];
  try {
    results = await ext.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: probePage,
    });
  } catch (error) {
    throw new Error(accessError(error, tab.url));
  }
  const probe = results[0]?.result;
  if (!probe) throw new Error("The page did not answer the probe.");
  return { probe, fingerprint: toFingerprint(probe) };
});
