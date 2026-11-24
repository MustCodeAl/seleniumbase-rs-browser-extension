// Real-time BiDi / CDP Event Streamer data types and formatting utilities.

export interface StreamEvent {
  id: string;
  tabId: number;
  timestamp: number;
  timeStr: string;
  category: "network" | "console" | "bidi";
  method: string;
  severity: "info" | "warn" | "error";
  status?: number | undefined;
  statusText?: string | undefined;
  methodHttp?: string | undefined;
  url?: string | undefined;
  durationMs?: number | undefined;
  summary: string;
  details?: Record<string, unknown> | undefined;
}

/** Formats a timestamp into HH:MM:SS.mmm */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

/** Creates a new StreamEvent with generated id and timestamp. */
export function createStreamEvent(
  tabId: number,
  category: StreamEvent["category"],
  method: string,
  summary: string,
  extra: Partial<StreamEvent> = {},
): StreamEvent {
  const timestamp = Date.now();
  const id = `ev_${timestamp}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    tabId,
    timestamp,
    timeStr: formatTime(timestamp),
    category,
    method,
    severity: extra.severity ?? "info",
    summary,
    ...extra,
  };
}
