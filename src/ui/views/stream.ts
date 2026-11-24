// The Stream view: Real-time BiDi / CDP Event Streamer.
// Streams network requests and console errors in a compact side panel.

import { h } from "../../shared/dom.ts";
import { downloadFile } from "../../shared/download.ts";
import { errorText } from "../../shared/guards.ts";
import { MSG, isMessage, type Message } from "../../shared/protocol.ts";
import type { StreamEvent } from "../../shared/streamer.ts";
import { copyButton } from "../../shared/pickview.ts";
import { registerView } from "../registry.ts";
import { ext } from "../../shared/api.ts";

registerView({
  id: "stream",
  title: "Stream",
  order: 40,
  render(root, ctx) {
    let events: StreamEvent[] = [];
    let filterCategory: "all" | "error" | "network" = "all";
    let searchText = "";
    let paused = false;
    let activeTabId: number | null = null;
    let expandedId: string | null = null;

    async function initStream(): Promise<void> {
      try {
        const tab = await ctx.activeTab();
        activeTabId = tab.id ?? null;
        if (activeTabId) {
          const res = await ctx.call(MSG.STREAM_START, { tabId: activeTabId });
          if (res.active) {
            const pollRes = await ctx.call(MSG.STREAM_POLL, { tabId: activeTabId });
            events = pollRes.events;
            draw();
          }
        }
      } catch (err) {
        ctx.notify(`Stream error: ${errorText(err)}`);
      }
    }

    ext.runtime.onMessage.addListener((incoming: unknown) => {
      if (isMessage(incoming) && incoming.type === MSG.STREAM_EVENT) {
        const ev = (incoming as Message).event as StreamEvent | undefined;
        if (ev && !paused && (activeTabId === null || ev.tabId === activeTabId)) {
          events.push(ev);
          if (events.length > 200) events.shift();
          draw();
        }
      }
      return false;
    });

    function clearEvents(): void {
      events = [];
      if (activeTabId) void ctx.call(MSG.STREAM_CLEAR, { tabId: activeTabId });
      draw();
    }

    function togglePause(): void {
      paused = !paused;
      draw();
    }

    function exportNdjson(): void {
      if (events.length === 0) return;
      const text = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
      downloadFile({
        filename: `bidi_events_${Date.now()}.jsonl`,
        mime: "application/x-ndjson",
        text,
      });
    }

    function filteredEvents(): StreamEvent[] {
      return events.filter((e) => {
        if (filterCategory === "error" && e.severity !== "error") return false;
        if (filterCategory === "network" && e.category !== "network") return false;
        if (searchText) {
          const q = searchText.toLowerCase();
          const match =
            e.summary.toLowerCase().includes(q) ||
            e.method.toLowerCase().includes(q) ||
            (e.url && e.url.toLowerCase().includes(q));
          if (!match) return false;
        }
        return true;
      });
    }

    function renderEventRow(e: StreamEvent): HTMLElement {
      const isExpanded = expandedId === e.id;
      const row = h(
        "div",
        {
          class: "stream-row",
          style: `padding: 4px 6px; border-bottom: 1px solid var(--line); font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; cursor: pointer; background: ${e.severity === "error" ? "rgba(239, 68, 68, 0.08)" : "transparent"};`,
          onclick: () => {
            expandedId = isExpanded ? null : e.id;
            draw();
          },
        },
        h(
          "div",
          { style: "display: flex; gap: 6px; align-items: baseline;" },
          h("span", { style: "color: var(--muted); flex: none;", text: e.timeStr }),
          h(
            "span",
            {
              class: `verdict ${e.severity === "error" ? "differs" : e.category === "network" ? "match" : "unknown"}`,
              style: "font-size: 10px; padding: 0 4px;",
              text: e.method,
            },
          ),
          e.status !== undefined
            ? h(
                "span",
                {
                  class: `badge ${e.status < 400 ? "one" : ""}`,
                  style: `font-size: 10px; padding: 0 4px; ${e.status >= 400 ? "background: var(--bad-bg); color: var(--bad-fg);" : ""}`,
                  text: String(e.status),
                },
              )
            : null,
          h("span", { style: "flex: 1; min-width: 0; word-break: break-all; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;", text: e.summary }),
        ),
      );

      if (isExpanded) {
        row.append(
          h(
            "div",
            { style: "margin-top: 6px; padding: 6px; border-radius: 4px; background: var(--code-bg); cursor: default;", onclick: (ev: MouseEvent) => ev.stopPropagation() },
            h("div", { class: "bar", style: "margin: 0 0 4px 0;" }, copyButton(JSON.stringify(e, null, 2), "event JSON")),
            h("pre", { style: "margin: 0; font-size: 11px; max-height: 120px; white-space: pre-wrap;" }, h("code", { text: JSON.stringify(e, null, 2) })),
          ),
        );
      }

      return row;
    }

    function draw(): void {
      const errCount = events.filter((e) => e.severity === "error").length;
      const netCount = events.filter((e) => e.category === "network").length;

      const liveBadge = h(
        "span",
        {
          class: `verdict ${paused ? "unknown" : "match"}`,
          style: "display: inline-flex; align-items: center; gap: 4px;",
        },
        h("span", { text: paused ? "⏸️ Paused" : "🟢 Live" }),
      );

      const filterAll = h("button", {
        type: "button",
        class: filterCategory === "all" ? "primary" : "",
        text: `All (${events.length})`,
        onclick: () => {
          filterCategory = "all";
          draw();
        },
      });

      const filterErr = h("button", {
        type: "button",
        class: filterCategory === "error" ? "primary" : "",
        text: `Errors (${errCount})`,
        onclick: () => {
          filterCategory = "error";
          draw();
        },
      });

      const filterNet = h("button", {
        type: "button",
        class: filterCategory === "network" ? "primary" : "",
        text: `Network (${netCount})`,
        onclick: () => {
          filterCategory = "network";
          draw();
        },
      });

      const searchInput = h("input", {
        type: "text",
        value: searchText,
        placeholder: "Filter URL or method...",
        style: "flex: 1; min-width: 100px; font-size: 11px; padding: 2px 6px;",
      }) as HTMLInputElement;
      searchInput.addEventListener("input", (e) => {
        searchText = (e.target as HTMLInputElement).value;
        draw();
      });

      const pauseBtn = h("button", {
        type: "button",
        text: paused ? "Resume" : "Pause",
        onclick: togglePause,
      });

      const clearBtn = h("button", {
        type: "button",
        text: "Clear",
        onclick: clearEvents,
      });

      const exportBtn = h("button", {
        type: "button",
        text: "Export JSONL",
        title: "Export events as NDJSON / JSONL",
        onclick: exportNdjson,
      });

      const list = filteredEvents();
      const listContainer = h(
        "div",
        {
          style: "margin-top: 8px; border: 1px solid var(--line); border-radius: 6px; max-height: 380px; overflow-y: auto; background: var(--bg);",
        },
        list.length > 0
          ? list.map(renderEventRow)
          : h("p", { class: "empty", style: "padding: 12px; text-align: center;", text: events.length === 0 ? "Listening for network requests and console errors..." : "No events match current filter." }),
      );

      root.replaceChildren(
        h(
          "div",
          { class: "bar", style: "justify-content: space-between; align-items: center;" },
          h("div", { style: "display: flex; gap: 8px; align-items: center;" }, h("h3", { style: "margin: 0;", text: "Event Stream" }), liveBadge),
          h("div", { style: "display: flex; gap: 4px;" }, pauseBtn, clearBtn, exportBtn),
        ),
        h("div", { class: "bar", style: "margin: 6px 0;" }, filterAll, filterErr, filterNet, searchInput),
        listContainer,
      );
    }

    draw();
    void initStream();
  },
  show(_root, ctx) {
    void (async () => {
      try {
        const tab = await ctx.activeTab();
        if (tab.id) void ctx.call(MSG.STREAM_START, { tabId: tab.id });
      } catch {
        // Tab not active
      }
    })();
  },
});
