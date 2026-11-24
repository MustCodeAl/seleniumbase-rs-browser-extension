// The inspector's side of the background: start the picker in a tab, keep the
// last pick for the panel, and run the "what this page sees" probe in the page's
// own world.

import { ext } from "../shared/api.ts";
import { toFingerprint } from "../shared/fingerprint.ts";
import { isRecord } from "../shared/guards.ts";
import { MSG } from "../shared/protocol.ts";
import type { PickResult } from "../shared/pickview.ts";
import { createStreamEvent, type StreamEvent } from "../shared/streamer.ts";
import { broadcast, registerHandler } from "../background/router.ts";
import { accessError, injectFiles, session, set, stored } from "../background/store.ts";
import { probePage } from "./probe.ts";

const K_LAST = "inspector.last";
const MAX_RESULT_BYTES = 200_000;
const MAX_STREAM_BUFFER = 200;

const streamBuffers = new Map<number, StreamEvent[]>();
const activeStreamTabs = new Set<number>();

/** The fields `renderPick` reads: a stored pick that lacks them would throw in the panel. */
function isPickResult(value: unknown): value is PickResult {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    typeof value.tag === "string" &&
    Array.isArray(value.candidates) &&
    Array.isArray(value.calls)
  );
}

registerHandler(MSG.INSPECTOR_PICK, async ({ tabId }) => {
  if (typeof tabId !== "number") throw new Error("inspector/pick needs a tabId");
  const tab = await ext.tabs.get(tabId);
  await injectFiles(tabId, ["inspector/content.js"], tab.url);
  return {};
});

registerHandler(MSG.INSPECTOR_LAST, async () => ({ last: await stored<PickResult | null>(session, K_LAST, null) }));

registerHandler(
  MSG.INSPECTOR_PICKED,
  async ({ result }) => {
    if (!isPickResult(result) || JSON.stringify(result).length > MAX_RESULT_BYTES) {
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

registerHandler(MSG.INSPECTOR_EVAL_SELECTOR, async ({ tabId, selector }) => {
  if (typeof tabId !== "number" || typeof selector !== "string") {
    throw new Error("inspector/eval-selector needs tabId and selector");
  }
  const tab = await ext.tabs.get(tabId);
  let results: chrome.scripting.InjectionResult<{ ok: boolean; count: number; sample: string; error: string | null }>[];
  try {
    results = await ext.scripting.executeScript({
      target: { tabId },
      func: (sel: string) => {
        try {
          let count = 0;
          let sample = "";
          if (sel.startsWith("link=")) {
            const text = sel.slice(5).trim();
            for (const a of document.querySelectorAll("a")) {
              if ((a.textContent ?? "").trim() === text) {
                count++;
                if (!sample) sample = a.outerHTML.slice(0, 100);
              }
            }
          } else if (sel.startsWith("/") || sel.startsWith("./") || sel.startsWith("(")) {
            const snapshot = document.evaluate(sel, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            count = snapshot.snapshotLength;
            if (count > 0) {
              const first = snapshot.snapshotItem(0) as Element | null;
              if (first) sample = first.outerHTML.slice(0, 100);
            }
          } else {
            const list = document.querySelectorAll(sel);
            count = list.length;
            if (count > 0) sample = list[0]?.outerHTML.slice(0, 100) ?? "";
          }
          return { ok: true, count, sample, error: null };
        } catch (e) {
          return { ok: false, count: 0, sample: "", error: String(e) };
        }
      },
      args: [selector],
    });
  } catch (error) {
    throw new Error(accessError(error, tab.url));
  }
  return results[0]?.result ?? { ok: false, count: 0, sample: "", error: "No response from tab" };
});

function inPageMonitor(): void {
  const win = window as unknown as Record<string, unknown>;
  if (win.__sbrsStreamInstalled) return;
  win.__sbrsStreamInstalled = true;

  function emit(data: Record<string, unknown>): void {
    window.postMessage({ source: "sbrs-stream", ...data }, "*");
  }

  window.addEventListener("error", (e) => {
    emit({
      category: "console",
      method: "Log.entryAdded",
      severity: "error",
      summary: `[Error] ${e.message || "Unknown error"}`,
      details: { filename: e.filename, lineno: e.lineno, colno: e.colno, stack: e.error ? String(e.error.stack) : "" },
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    emit({
      category: "console",
      method: "Log.entryAdded",
      severity: "error",
      summary: `[Unhandled Rejection] ${String(e.reason)}`,
      details: { reason: String(e.reason) },
    });
  });

  if (typeof console !== "undefined" && typeof console.error === "function") {
    const origError = console.error;
    console.error = function (...args: unknown[]) {
      origError.apply(console, args);
      emit({
        category: "console",
        method: "Runtime.consoleAPICalled",
        severity: "error",
        summary: `console.error: ${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}`,
        details: { args: args.map(String) },
      });
    };
  }

  if (typeof window.fetch === "function") {
    const origFetch = window.fetch;
    window.fetch = async function (...args: [RequestInfo | URL, RequestInit?]) {
      const start = performance.now();
      const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
      const method = (args[1]?.method || "GET").toUpperCase();
      emit({
        category: "network",
        method: "Network.requestWillBeSent",
        severity: "info",
        methodHttp: method,
        url,
        summary: `-> ${method} ${url}`,
      });
      try {
        const res = await origFetch.apply(this, args);
        const duration = Math.round(performance.now() - start);
        emit({
          category: "network",
          method: "Network.responseReceived",
          severity: res.status >= 400 ? "error" : "info",
          status: res.status,
          statusText: res.statusText,
          methodHttp: method,
          url,
          durationMs: duration,
          summary: `<- ${method} ${url} [${res.status} ${res.statusText}] (${duration}ms)`,
        });
        return res;
      } catch (err) {
        const duration = Math.round(performance.now() - start);
        emit({
          category: "network",
          method: "Network.loadingFailed",
          severity: "error",
          methodHttp: method,
          url,
          durationMs: duration,
          summary: `<- ${method} ${url} [FAILED] (${duration}ms)`,
        });
        throw err;
      }
    };
  }
}

function inPageBridge(tid: number): void {
  const win = window as unknown as Record<string, unknown>;
  if (win.__sbrsBridgeInstalled) return;
  win.__sbrsBridgeInstalled = true;

  window.addEventListener("message", (event) => {
    if (event.data && typeof event.data === "object" && (event.data as Record<string, unknown>).source === "sbrs-stream") {
      const raw = event.data as Record<string, unknown>;
      const { source: _source, ...eventData } = raw;
      try {
        chrome.runtime.sendMessage({
          v: 1,
          type: "stream/emit",
          tabId: tid,
          eventData,
        });
      } catch {
        // Disconnected
      }
    }
  });
}

registerHandler(MSG.STREAM_START, async ({ tabId }) => {
  if (typeof tabId !== "number") throw new Error("stream/start needs tabId");
  activeStreamTabs.add(tabId);
  const tab = await ext.tabs.get(tabId);
  try {
    await ext.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: inPageMonitor,
    });
    await ext.scripting.executeScript({
      target: { tabId },
      func: inPageBridge,
      args: [tabId],
    });
  } catch (err) {
    throw new Error(accessError(err, tab.url));
  }
  const events = streamBuffers.get(tabId) ?? [];
  return { active: true, count: events.length };
});

registerHandler(MSG.STREAM_STOP, async ({ tabId }) => {
  if (typeof tabId === "number") activeStreamTabs.delete(tabId);
  return { active: false };
});

registerHandler(MSG.STREAM_POLL, async ({ tabId }) => {
  const tid = typeof tabId === "number" ? tabId : 0;
  return { events: streamBuffers.get(tid) ?? [] };
});

registerHandler(MSG.STREAM_CLEAR, async ({ tabId }) => {
  if (typeof tabId === "number") {
    streamBuffers.set(tabId, []);
  }
  return { ok: true };
});

registerHandler(
  MSG.STREAM_EMIT,
  async ({ tabId, eventData }) => {
    if (typeof tabId !== "number" || !isRecord(eventData)) return { ok: false };
    const category = typeof eventData.category === "string" ? (eventData.category as StreamEvent["category"]) : "bidi";
    const method = typeof eventData.method === "string" ? eventData.method : "Event";
    const summary = typeof eventData.summary === "string" ? eventData.summary : "";

    const event = createStreamEvent(tabId, category, method, summary, eventData as Partial<StreamEvent>);
    let buf = streamBuffers.get(tabId);
    if (!buf) {
      buf = [];
      streamBuffers.set(tabId, buf);
    }
    buf.push(event);
    if (buf.length > MAX_STREAM_BUFFER) buf.shift();

    await broadcast(MSG.STREAM_EVENT, { event });
    return { ok: true };
  },
  "any",
);
