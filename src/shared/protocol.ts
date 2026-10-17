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

import type { Fingerprint, PageProbe } from "./fingerprint.ts";
import type { PickResult } from "./pickview.ts";
import type { Step } from "./steps.ts";

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
} as const;

/** A message: the version, the type, and the payload's fields, which the receiver checks. */
export interface Message {
  v: typeof PROTOCOL_VERSION;
  type: string;
  [field: string]: unknown;
}

/** A message with the protocol version. */
export function message(type: string, payload: Record<string, unknown> = {}): Message {
  return { v: PROTOCOL_VERSION, type, ...payload };
}

/** The recorder's settings, kept in extension storage. */
export interface RecorderSettings {
  recordScroll: boolean;
  entry: "test" | "main";
}

/** What the recorder tells the panel about itself. */
export interface RecorderSnapshot {
  active: boolean;
  tabId: number | null;
  warning: string | null;
  steps: Step[];
  settings: RecorderSettings;
  name: string;
  title: string;
}

/** A generated file: what the recorder answers to an export, and `generate` returns. */
export interface ExportedFile {
  filename: string;
  mime: string;
  text: string;
}

/** The fields of the `ok: true` answer to each message the panel sends. */
export interface Replies {
  [MSG.PING]: { name: string; version: string; browser: string };
  [MSG.RECORDER_START]: RecorderSnapshot;
  [MSG.RECORDER_STOP]: RecorderSnapshot;
  [MSG.RECORDER_STATE]: RecorderSnapshot;
  [MSG.RECORDER_CLEAR]: RecorderSnapshot;
  [MSG.RECORDER_EDIT_STEP]: RecorderSnapshot;
  [MSG.RECORDER_DELETE_STEP]: RecorderSnapshot;
  [MSG.RECORDER_MOVE_STEP]: RecorderSnapshot;
  [MSG.RECORDER_SETTINGS]: RecorderSnapshot;
  [MSG.RECORDER_EXPORT]: ExportedFile;
  [MSG.INSPECTOR_PICK]: Record<string, never>;
  [MSG.INSPECTOR_LAST]: { last: PickResult | null };
  [MSG.INSPECTOR_PROBE]: { probe: PageProbe; fingerprint: Fingerprint };
}
