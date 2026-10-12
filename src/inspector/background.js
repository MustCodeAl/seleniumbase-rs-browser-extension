// The inspector's side of the background: start the picker in a tab, keep the
// last pick for the panel, and run the "what this page sees" probe in the page's
// own world.

import { ext } from "../shared/api.js";
import { toFingerprint } from "../shared/fingerprint.js";
import { MSG } from "../shared/protocol.js";
import { broadcast, registerHandler } from "../background/router.js";
import { accessError, get, injectFiles, session, set } from "../background/store.js";
import { probePage } from "./probe.js";

const K_LAST = "inspector.last";
const MAX_RESULT_BYTES = 200_000;

registerHandler(MSG.INSPECTOR_PICK, async ({ tabId }) => {
  if (typeof tabId !== "number") throw new Error("inspector/pick needs a tabId");
  const tab = await ext.tabs.get(tabId);
  await injectFiles(tabId, ["inspector/content.js"], tab.url);
  return {};
});

registerHandler(MSG.INSPECTOR_LAST, async () => ({ last: await get(session, K_LAST, null) }));

registerHandler(
  MSG.INSPECTOR_PICKED,
  async ({ result }) => {
    if (!result || typeof result !== "object" || JSON.stringify(result).length > MAX_RESULT_BYTES) {
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
  let results;
  try {
    results = await ext.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: probePage,
    });
  } catch (error) {
    throw new Error(accessError(error, tab.url));
  }
  const probe = results && results[0] ? results[0].result : null;
  if (!probe) throw new Error("The page did not answer the probe.");
  return { probe, fingerprint: toFingerprint(probe) };
});
