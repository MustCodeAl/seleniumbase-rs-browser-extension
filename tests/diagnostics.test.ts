import { describe, expect, test } from "bun:test";
import { evaluateAntiBot, type AntiBotProbeData } from "../src/shared/diagnostics.ts";

describe("Anti-Bot & Fingerprint Diagnostics", () => {
  test("detects navigator.webdriver leak", () => {
    const data: AntiBotProbeData = {
      webdriver: { flag: true, overridden: false, nativeGetter: true },
      cdpFlags: { windowFlags: [], documentFlags: [], runtimeArtifacts: [] },
      webgl: { vendor: null, renderer: null, unmaskedVendor: null, unmaskedRenderer: null, isSoftware: false, isTampered: false },
      canvas: { noiseDetected: false, isTampered: false },
      turnstile: { detected: false, iframes: 0, widgetSelectors: [], apiPresent: false },
    };

    const summary = evaluateAntiBot(data);
    const item = summary.items.find((i) => i.id === "navigator_webdriver");
    expect(item).toBeDefined();
    expect(item?.status).toBe("fail");
    expect(item?.headline).toContain("Critical Leak");
    expect(summary.leaksDetected).toBeGreaterThan(0);
  });

  test("detects CDP automation flags (window.cdc_*)", () => {
    const data: AntiBotProbeData = {
      webdriver: { flag: false, overridden: false, nativeGetter: true },
      cdpFlags: { windowFlags: ["cdc_adoQpoasnfa76pfcZLmcfl_Array"], documentFlags: ["$cdc_test"], runtimeArtifacts: [] },
      webgl: { vendor: "Google Inc.", renderer: "ANGLE", unmaskedVendor: "Apple", unmaskedRenderer: "Apple M3", isSoftware: false, isTampered: false },
      canvas: { noiseDetected: false, isTampered: false },
      turnstile: { detected: false, iframes: 0, widgetSelectors: [], apiPresent: false },
    };

    const summary = evaluateAntiBot(data);
    const item = summary.items.find((i) => i.id === "cdp_flags");
    expect(item).toBeDefined();
    expect(item?.status).toBe("fail");
    expect(item?.detail).toContain("cdc_adoQpoasnfa76pfcZLmcfl_Array");
  });

  test("detects software WebGL renderer (SwiftShader / llvmpipe)", () => {
    const data: AntiBotProbeData = {
      webdriver: { flag: false, overridden: false, nativeGetter: true },
      cdpFlags: { windowFlags: [], documentFlags: [], runtimeArtifacts: [] },
      webgl: { vendor: "Google Inc.", renderer: "Google SwiftShader", unmaskedVendor: "Google", unmaskedRenderer: "Google SwiftShader", isSoftware: true, isTampered: false },
      canvas: { noiseDetected: false, isTampered: false },
      turnstile: { detected: false, iframes: 0, widgetSelectors: [], apiPresent: false },
    };

    const summary = evaluateAntiBot(data);
    const item = summary.items.find((i) => i.id === "webgl_renderer");
    expect(item).toBeDefined();
    expect(item?.status).toBe("fail");
    expect(item?.headline).toContain("Software renderer detected");
  });

  test("detects canvas noise injection and tampering", () => {
    const data: AntiBotProbeData = {
      webdriver: { flag: false, overridden: false, nativeGetter: true },
      cdpFlags: { windowFlags: [], documentFlags: [], runtimeArtifacts: [] },
      webgl: { vendor: "Apple", renderer: "Apple M2", unmaskedVendor: "Apple", unmaskedRenderer: "Apple M2", isSoftware: false, isTampered: false },
      canvas: { noiseDetected: true, isTampered: true },
      turnstile: { detected: false, iframes: 0, widgetSelectors: [], apiPresent: false },
    };

    const summary = evaluateAntiBot(data);
    const item = summary.items.find((i) => i.id === "canvas_noise");
    expect(item).toBeDefined();
    expect(item?.status).toBe("warn");
    expect(item?.headline).toContain("Canvas noise injection detected");
  });

  test("detects Cloudflare Turnstile presence", () => {
    const data: AntiBotProbeData = {
      webdriver: { flag: false, overridden: false, nativeGetter: true },
      cdpFlags: { windowFlags: [], documentFlags: [], runtimeArtifacts: [] },
      webgl: { vendor: "Apple", renderer: "Apple M3", unmaskedVendor: "Apple", unmaskedRenderer: "Apple M3", isSoftware: false, isTampered: false },
      canvas: { noiseDetected: false, isTampered: false },
      turnstile: { detected: true, iframes: 1, widgetSelectors: [".cf-turnstile"], apiPresent: true },
    };

    const summary = evaluateAntiBot(data);
    const item = summary.items.find((i) => i.id === "turnstile");
    expect(item).toBeDefined();
    expect(item?.status).toBe("info");
    expect(item?.headline).toContain("Turnstile challenge detected");
    expect(item?.detail).toContain("1 challenge iframe(s)");
  });

  test("scores 100 for clean stealth session", () => {
    const data: AntiBotProbeData = {
      webdriver: { flag: false, overridden: false, nativeGetter: true },
      cdpFlags: { windowFlags: [], documentFlags: [], runtimeArtifacts: [] },
      webgl: { vendor: "Apple", renderer: "Apple M3", unmaskedVendor: "Apple", unmaskedRenderer: "Apple M3", isSoftware: false, isTampered: false },
      canvas: { noiseDetected: false, isTampered: false },
      turnstile: { detected: false, iframes: 0, widgetSelectors: [], apiPresent: false },
    };

    const summary = evaluateAntiBot(data);
    expect(summary.score).toBe(100);
    expect(summary.leaksDetected).toBe(0);
    expect(summary.passedChecks).toBe(5);
  });

  test("detects DataDome, Akamai, Kasada, and PerimeterX matching antibot-detector rules", () => {
    const data: AntiBotProbeData = {
      webdriver: { flag: false, overridden: false, nativeGetter: true },
      cdpFlags: { windowFlags: [], documentFlags: [], runtimeArtifacts: [] },
      webgl: { vendor: "Apple", renderer: "Apple M3", unmaskedVendor: "Apple", unmaskedRenderer: "Apple M3", isSoftware: false, isTampered: false },
      canvas: { noiseDetected: false, isTampered: false },
      turnstile: { detected: false, iframes: 0, widgetSelectors: [], apiPresent: false },
      pageSignals: {
        cookies: "datadome=abc123; _abck=def456; _px3=ghi789",
        scripts: ["https://js.datadome.co/tags.js", "https://cdn.example.com/149e9513-kpsdk.js"],
        iframes: ["https://geo.captcha-delivery.com/captcha/"],
        htmlSnippet: "<div class=\"px-captcha\"></div>",
      },
    };

    const summary = evaluateAntiBot(data);
    const providers = summary.protectionsDetected.map((p) => p.provider);
    expect(providers).toContain("DataDome");
    expect(providers).toContain("Akamai");
    expect(providers).toContain("Kasada");
    expect(providers).toContain("PerimeterX");
    expect(summary.protectionsDetected.some((p) => p.isBlocked)).toBe(true);
  });
});
