import { describe, expect, test } from "bun:test";
import { acceptLanguages, toFingerprint } from "../src/shared/fingerprint.js";

const probe = {
  navigator: {
    webdriver: false,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
    language: "en-US",
    languages: ["en-US", "en"],
    platform: "MacIntel",
    vendor: "Google Inc.",
    productSub: "20030107",
    appVersion: "5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    pluginsCount: 5,
    mimeTypesCount: 2,
  },
  userAgentData: {
    brands: [
      { brand: "Chromium", version: "155" },
      { brand: "Google Chrome", version: "155" },
    ],
    mobile: false,
    platform: "macOS",
    high: {
      architecture: "arm",
      bitness: "64",
      model: "",
      platformVersion: "15.0.0",
      uaFullVersion: "155.0.8059.40",
      fullVersionList: [{ brand: "Chromium", version: "155.0.8059.40" }],
      wow64: false,
      formFactors: ["Desktop"],
    },
  },
  screen: { width: 1512, height: 982, availWidth: 1512, availHeight: 944, colorDepth: 30, pixelDepth: 30 },
  devicePixelRatio: 2,
  window: { innerWidth: 1000, innerHeight: 800, outerWidth: 1000, outerHeight: 880 },
  timezone: { name: "Europe/Paris", offsetMinutes: -120 },
  webgl: { vendor: "WebKit", renderer: "WebKit WebGL", unmaskedVendor: "Google Inc. (Apple)", unmaskedRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)" },
  media: { audioinput: 1, audiooutput: 1, videoinput: 1 },
};

describe("Accept-Language", () => {
  test("weights fall by a tenth", () => {
    expect(acceptLanguages(["en-US", "en"])).toBe("en-US,en;q=0.9");
    expect(acceptLanguages(["fr-FR", "fr", "en"])).toBe("fr-FR,fr;q=0.9,en;q=0.8");
    expect(acceptLanguages([])).toBeUndefined();
  });
});

describe("toFingerprint", () => {
  const fp = toFingerprint(probe);

  test("browser and operating system", () => {
    expect(fp.browser_type).toBe("chromium");
    expect(fp.os_type).toBe("Macos");
    expect(fp.core_version).toBe(155);
  });

  test("navigator fields", () => {
    expect(fp.user_agent).toBe(probe.navigator.userAgent);
    expect(fp.platform).toBe("MacIntel");
    expect(fp.hardware_concurrency).toBe(8);
    expect(fp.device_memory).toBe(8);
    expect(fp.max_touch_points).toBe(0);
    expect(fp.vendor).toBe("Google Inc.");
    expect(fp.product_sub).toBe("20030107");
  });

  test("locale, languages, timezone, screen", () => {
    expect(fp.locale).toBe("en-US");
    expect(fp.languages).toBe("en-US,en;q=0.9");
    expect(fp.timezone).toBe("Europe/Paris");
    expect(fp.screen_width).toBe(1512);
    expect(fp.screen_height).toBe(982);
    expect(fp.pixel_ratio).toBe(2);
    expect(fp.color_depth).toBe(30);
  });

  test("webgl prefers the unmasked values", () => {
    expect(fp.webgl_vendor).toBe("Google Inc. (Apple)");
    expect(fp.webgl_renderer).toContain("Apple M1");
  });

  test("client hints", () => {
    expect(fp.client_hints.platform).toBe("macOS");
    expect(fp.client_hints.brands[0]).toEqual({ brand: "Chromium", version: "155" });
    expect(fp.client_hints.full_version_list[0].version).toBe("155.0.8059.40");
    expect(fp.client_hints.platform_version).toBe("15.0.0");
    expect(fp.client_hints.architecture).toBe("arm");
    expect(fp.client_hints.bitness).toBe("64");
    expect(fp.client_hints.ua_full_version).toBe("155.0.8059.40");
    expect(fp.client_hints.mobile).toBe(false);
    expect(fp.client_hints.wow64).toBe(false);
    expect(fp.client_hints.form_factors).toEqual(["Desktop"]);
    expect(fp.client_hints.model).toBe("");
  });

  test("media devices", () => {
    expect(fp.audio_inputs).toBe(1);
    expect(fp.audio_outputs).toBe(1);
    expect(fp.video_inputs).toBe(1);
  });

  test("a missing value is left out, not null", () => {
    const sparse = toFingerprint({ navigator: { userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0" } });
    expect(sparse.browser_type).toBe("firefox");
    expect(sparse.os_type).toBe("Linux");
    expect(sparse.core_version).toBe(130);
    expect("device_memory" in sparse).toBe(false);
    expect("client_hints" in sparse).toBe(false);
    for (const value of Object.values(sparse)) {
      expect(value).not.toBeNull();
      expect(value).not.toBeUndefined();
    }
  });

  test("only keys the Rust Fingerprint knows", () => {
    const known = new Set([
      "browser_type", "os_type", "core_version", "user_agent", "platform", "hardware_concurrency", "device_memory",
      "max_touch_points", "vendor", "oscpu", "product_sub", "build_id", "app_version", "locale", "languages",
      "accept_languages", "timezone", "screen_width", "screen_height", "pixel_ratio", "color_depth", "webgl_vendor",
      "webgl_renderer", "audio_inputs", "audio_outputs", "video_inputs", "client_hints",
    ]);
    for (const key of Object.keys(fp)) {
      expect(known.has(key)).toBe(true);
    }
  });
});
