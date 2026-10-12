// Routes messages (see shared/protocol.js) to handlers that features register.
//
//     import { registerHandler } from "../background/router.js";
//     registerHandler("bridge/connect", async (message, sender) => ({ connected: true }), "ui");
//
// A handler returns an object (merged into `{ ok: true, ... }`) or throws (the
// reply becomes `{ ok: false, error }`). A message from the wrong kind of sender
// is refused, so a content script cannot ask for what only the panel may.

import { ext } from "../shared/api.js";
import { PROTOCOL_VERSION, message } from "../shared/protocol.js";

const handlers = new Map();

/**
 * @param {string} type
 * @param {(message: object, sender: object) => object | Promise<object | void> | void} handler
 * @param {"ui" | "content" | "any"} [from]
 */
export function registerHandler(type, handler, from = "ui") {
  if (handlers.has(type)) throw new Error(`message type ${type} is already handled`);
  handlers.set(type, { handler, from });
}

/** Tell every open extension page that something changed. Nobody listening is fine. */
export async function broadcast(type, payload = {}) {
  try {
    await ext.runtime.sendMessage(message(type, payload));
  } catch {
    // no panel is open
  }
}

function senderKind(sender) {
  const base = ext.runtime.getURL("");
  return typeof sender.url === "string" && sender.url.startsWith(base) ? "ui" : "content";
}

export function installRouter() {
  ext.runtime.onMessage.addListener((incoming, sender, sendResponse) => {
    if (!incoming || incoming.v !== PROTOCOL_VERSION || typeof incoming.type !== "string") return false;
    const entry = handlers.get(incoming.type);
    if (!entry) return false;
    const kind = senderKind(sender);
    if (entry.from !== "any" && entry.from !== kind) {
      sendResponse({ ok: false, error: `${incoming.type} is not accepted from a ${kind}` });
      return false;
    }
    Promise.resolve()
      .then(() => entry.handler(incoming, sender))
      .then(
        (result) => sendResponse({ ok: true, ...(result ?? {}) }),
        (error) => sendResponse({ ok: false, error: String(error?.message ?? error) }),
      );
    return true;
  });
}

/** For tests: forget every handler. */
export function resetHandlers() {
  handlers.clear();
}
