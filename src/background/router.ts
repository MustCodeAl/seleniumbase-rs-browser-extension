// Routes messages (see shared/protocol.ts) to handlers that features register.
//
//     import { registerHandler } from "../background/router.ts";
//     registerHandler("bridge/connect", async (message, sender) => ({ connected: true }), "ui");
//
// A handler returns an object (merged into `{ ok: true, ... }`) or throws (the
// reply becomes `{ ok: false, error }`). A message from the wrong kind of sender
// is refused, so a content script cannot ask for what only the panel may.

import { ext } from "../shared/api.ts";
import { errorText } from "../shared/guards.ts";
import { type Message, isMessage, message } from "../shared/protocol.ts";

/** Who may send a message type: an extension page, a content script, or either. */
export type Origin = "ui" | "content" | "any";

/** What a handler returns: the fields of the reply, or nothing. */
export type HandlerResult = object | undefined;

export type Handler = (message: Message, sender: chrome.runtime.MessageSender) => HandlerResult | Promise<HandlerResult>;

const handlers = new Map<string, { handler: Handler; from: Origin }>();

/** Handles messages of `type` from `from` (an extension page unless said otherwise). */
export function registerHandler(type: string, handler: Handler, from: Origin = "ui"): void {
  if (handlers.has(type)) throw new Error(`message type ${type} is already handled`);
  handlers.set(type, { handler, from });
}

/** Tell every open extension page that something changed. Nobody listening is fine. */
export async function broadcast(type: string, payload: Record<string, unknown> = {}): Promise<void> {
  try {
    await ext.runtime.sendMessage(message(type, payload));
  } catch {
    // no panel is open
  }
}

function senderKind(sender: chrome.runtime.MessageSender): "ui" | "content" {
  const base = ext.runtime.getURL("");
  return typeof sender.url === "string" && sender.url.startsWith(base) ? "ui" : "content";
}

export function installRouter(): void {
  ext.runtime.onMessage.addListener((incoming: unknown, sender, sendResponse) => {
    if (!isMessage(incoming)) return false;
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
        (error: unknown) => sendResponse({ ok: false, error: errorText(error) }),
      );
    return true;
  });
}
