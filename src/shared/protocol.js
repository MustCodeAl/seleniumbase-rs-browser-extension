// The message protocol between the panel (popup, side panel, sidebar), the
// content scripts and the background. A message is a plain object
//
//     { v: 1, type: "<feature>/<name>", ...payload }
//
// and the reply is `{ ok: true, ...data }` or `{ ok: false, error: "..." }`.
// The background routes by `type` (src/background/router.js); a feature adds
// types by calling `registerHandler(type, handler, from)` from its background
// module, where `from` says who may send it: "ui" (an extension page), "content"
// (a content script) or "any".
//
// Types are written here so the sender and the receiver cannot drift apart.

export const PROTOCOL_VERSION = 1;

export const MSG = {
  // Any context.
  PING: "core/ping",

  // Panel to background.
  RECORDER_START: "recorder/start",
  RECORDER_STOP: "recorder/stop",
  RECORDER_STATE: "recorder/state",
  RECORDER_CLEAR: "recorder/clear",
  RECORDER_EDIT_STEP: "recorder/edit-step",
  RECORDER_DELETE_STEP: "recorder/delete-step",
  RECORDER_MOVE_STEP: "recorder/move-step",
  RECORDER_SETTINGS: "recorder/settings",
  RECORDER_EXPORT: "recorder/export",
  INSPECTOR_PICK: "inspector/pick",
  INSPECTOR_LAST: "inspector/last",
  INSPECTOR_PROBE: "inspector/probe",

  // Content script to background.
  RECORDER_HELLO: "recorder/hello",
  RECORDER_STEP: "recorder/step",
  INSPECTOR_PICKED: "inspector/picked",
  INSPECTOR_CANCELLED: "inspector/cancelled",

  // Background to a content script (runtime.tabs.sendMessage).
  RECORDER_DETACH: "recorder/detach",
  INSPECTOR_STOP: "inspector/stop",

  // Background to the panel: something changed, ask again.
  STATE_CHANGED: "core/state-changed",
};

/** A message with the protocol version. */
export function message(type, payload = {}) {
  return { v: PROTOCOL_VERSION, type, ...payload };
}
