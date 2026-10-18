import { describe, expect, test } from "bun:test";
import { probePage } from "../src/inspector/probe.ts";
import { toFingerprint } from "../src/shared/fingerprint.ts";

// probePage runs in a page; here there is no document, window or screen at all,
// which is the worst case: every probe must fail soft.
describe("probePage", () => {
  test("never throws, whatever the environment lacks", async () => {
    const report = await probePage();
    expect(typeof report.navigator.userAgent).toBe("string");
    expect(report.screen).toBeNull();
    expect(report.webgl).toBeNull();
    expect(report.canvas).toBeNull();
    expect(Array.isArray(report.headless.markers)).toBe(true);
    expect(typeof report.headless.likely).toBe("boolean");
  });

  test("says whether the page is secure and whether navigator.userAgentData exists, so \"off\" is never a guess", async () => {
    const report = await probePage();
    // There is no window here, so it cannot say the page is secure; the navigator it does have shows no userAgentData.
    expect(report.secureContext).toBeNull();
    expect(typeof report.userAgentDataPresent).toBe("boolean");
    expect("client_hints" in toFingerprint(report)).toBe(false);
  });

  test("is one self-contained function (it is serialised as source text)", () => {
    const source = probePage.toString();
    expect(source.startsWith("async function probePage")).toBe(true);
    // Everything it calls is declared inside it: no imports, no module-level helpers.
    expect(source).not.toMatch(/\bimport\b/);
    expect(source).not.toMatch(/\brequire\(/);
  });

  test("its report becomes a Fingerprint-shaped object without nulls", async () => {
    const fingerprint = toFingerprint(await probePage());
    for (const value of Object.values(fingerprint)) {
      expect(value).not.toBeNull();
      expect(value).not.toBeUndefined();
    }
  });
});
