import { describe, expect, test } from "bun:test";
import { createStreamEvent, formatTime } from "../src/shared/streamer.ts";

describe("BiDi / CDP Event Streamer", () => {
  test("formatTime formats milliseconds into HH:MM:SS.mmm", () => {
    const ts = new Date("2026-11-20T14:30:15.123Z").getTime();
    const formatted = formatTime(ts);
    expect(formatted).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  test("createStreamEvent sets id, timestamp, method, category, and severity", () => {
    const event = createStreamEvent(42, "network", "Network.responseReceived", "GET /api/data 200", {
      status: 200,
      statusText: "OK",
      url: "https://example.com/api/data",
      durationMs: 45,
    });

    expect(event.tabId).toBe(42);
    expect(event.category).toBe("network");
    expect(event.method).toBe("Network.responseReceived");
    expect(event.summary).toBe("GET /api/data 200");
    expect(event.status).toBe(200);
    expect(event.durationMs).toBe(45);
    expect(event.severity).toBe("info");
    expect(typeof event.id).toBe("string");
    expect(event.id.startsWith("ev_")).toBe(true);
  });

  test("createStreamEvent handles console errors with error severity", () => {
    const event = createStreamEvent(7, "console", "Log.entryAdded", "Uncaught ReferenceError: x is not defined", {
      severity: "error",
      details: { stack: "ReferenceError at main.js:10:4" },
    });

    expect(event.tabId).toBe(7);
    expect(event.category).toBe("console");
    expect(event.severity).toBe("error");
    expect(event.details?.stack).toBe("ReferenceError at main.js:10:4");
  });
});
