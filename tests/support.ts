// Small helpers for tests that read indexed or optional values. With
// noUncheckedIndexedAccess `steps[0]` may be undefined; a test that needs the value
// asks for it here and fails with a message when it is not there.

/** `value`, or a failed test when it is null or undefined. */
export function must<T>(value: T | null | undefined, what = "a value"): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}, found ${String(value)}`);
  return value;
}
