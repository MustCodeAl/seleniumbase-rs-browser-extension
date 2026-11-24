import { describe, expect, test } from "bun:test";
import { generateRustContextOptions } from "../src/shared/rust-context.ts";
import type { PageProbe } from "../src/shared/fingerprint.ts";

describe("generateRustContextOptions", () => {
  test("generates ready-to-run Rust code with Fingerprint and ContextOptions", () => {
    const probe: PageProbe = {
      url: "https://example.com/login",
      navigator: {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        language: "en-US",
        platform: "MacIntel",
        hardwareConcurrency: 8,
        deviceMemory: 8,
      },
      screen: {
        width: 1920,
        height: 1080,
      },
      timezone: {
        name: "America/New_York",
      },
      webgl: {
        unmaskedVendor: "Apple",
        unmaskedRenderer: "Apple M3",
      },
    };

    const res = generateRustContextOptions(probe, { fnName: "my_custom_context" });
    expect(res.filename).toBe("context_options.rs");
    expect(res.code).toContain("pub fn my_custom_context() -> Result<ContextOptions>");
    expect(res.code).toContain("use seleniumbase_rs::evasion::Fingerprint;");
    expect(res.code).toContain("use seleniumbase_rs::sb_cdp::ContextOptions;");
    expect(res.code).toContain('.user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")');
    expect(res.code).toContain('.locale("en-US")');
    expect(res.code).toContain('.screen(1920, 1080)');
    expect(res.code).toContain('.timezone("America/New_York")');
    expect(res.code).toContain(".hardware_concurrency(8)");
    expect(res.code).toContain(".device_memory(8.0)");
    expect(res.code).toContain("ContextOptions::builder()");
    expect(res.code).toContain(".fingerprint(&fingerprint)");
  });

  test("escapes quotes and control characters safely", () => {
    const probe: PageProbe = {
      url: "https://example.com",
      navigator: {
        userAgent: 'Mozilla/5.0 "Custom\nAgent"',
        language: "fr-FR",
      },
    };

    const res = generateRustContextOptions(probe);
    expect(res.code).toContain('\\"Custom\\nAgent\\"');
  });
});
