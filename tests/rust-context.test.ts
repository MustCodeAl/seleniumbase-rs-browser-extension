import { describe, expect, test } from "bun:test";
import { generateRustContextOptions, generateRustAntibotDetectorCode } from "../src/shared/rust-context.ts";
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
    expect(res.code).toContain("pub fn my_custom_context() -> Result<(ContextOptions, Fingerprint)>");
    expect(res.code).toContain("use seleniumbase_rs_stealth::identity::fingerprint::Fingerprint;");
    expect(res.code).toContain("use seleniumbase_rs_stealth::sb_cdp::ContextOptions;");
    expect(res.code).toContain('.user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")');
    expect(res.code).toContain('.locale("en-US")');
    expect(res.code).toContain('.screen(1920, 1080)');
    expect(res.code).toContain('.timezone("America/New_York")');
    expect(res.code).toContain(".hardware_concurrency(8)");
    expect(res.code).toContain(".device_memory(8.0)");
    expect(res.code).toContain("ContextOptions::builder().build()?;");
    expect(res.code).toContain("page.apply_fingerprint(&fingerprint).await?;");
    expect(res.code).toContain("browser.new_context_with(options).await?;");
    expect(res.code).not.toContain("new_context_with_options");
  });

  test("formats fractional device_memory values without trailing .0", () => {
    const probe: PageProbe = {
      url: "https://example.com",
      navigator: {
        deviceMemory: 0.5,
      },
    };

    const res = generateRustContextOptions(probe);
    expect(res.code).toContain(".device_memory(0.5)");
    expect(res.code).not.toContain(".device_memory(0.5.0)");
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

  test("generates ready-to-run Rust script with antibot-detector plugin", () => {
    const code = generateRustAntibotDetectorCode("https://example.com/protected");
    expect(code).toContain("use antibot_detector::{AntibotDetector, Cookie, Page as DetectorPage};");
    expect(code).toContain("let browser = Browser::launch(LaunchOptions::default()).await?;");
    expect(code).toContain("let html = page.content().await?;");
    expect(code).toContain("let detector_page = DetectorPage::new(html)");
    expect(code).toContain("let detector = AntibotDetector::new();");
    expect(code).toContain("let detections = detector.detect(&detector_page)?;");
    expect(code).toContain("https://example.com/protected");
  });
});
