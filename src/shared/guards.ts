// Narrowing for data that crosses a boundary: a message from another context, a
// stored value, a recording another tool wrote. Nothing there is trusted to have
// the shape its type claims, so the code checks, and these are the checks.

/** A plain object (not null, not an array) whose fields are still unknown. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The text of an error of any kind, for a message shown to a person or sent back to a sender. */
export function errorText(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error && error.message !== undefined && error.message !== null) {
    return String(error.message);
  }
  return String(error);
}
