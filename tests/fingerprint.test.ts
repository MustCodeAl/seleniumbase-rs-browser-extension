import { describe, expect, test } from "bun:test";
import { type PageProbe, acceptLanguages, toFingerprint } from "../src/shared/fingerprint.ts";
import { must } from "./support.ts";

const probe: PageProbe = {
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
    expect(fp.user_agent).toBe(must(probe.navigator?.userAgent));
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
    // seleniumbase-rs 0.5.0 reads a screen as one setting, not as two numbers.
    expect(fp.screen).toEqual({ width: 1512, height: 982 });
    expect(fp.avail_screen).toEqual({ width: 1512, height: 944 });
    expect(fp.pixel_ratio).toBe(2);
    expect(fp.color_depth).toBe(30);
  });

  test("webgl prefers the unmasked values", () => {
    expect(fp.webgl?.vendor).toBe("Google Inc. (Apple)");
    expect(fp.webgl?.renderer).toContain("Apple M1");
  });

  test("client hints", () => {
    expect(fp.client_hints?.platform).toBe("macOS");
    expect(fp.client_hints?.brands[0]).toEqual({ brand: "Chromium", version: "155" });
    expect(fp.client_hints?.full_version_list[0]?.version).toBe("155.0.8059.40");
    expect(fp.client_hints?.platform_version).toBe("15.0.0");
    expect(fp.client_hints?.architecture).toBe("arm");
    expect(fp.client_hints?.bitness).toBe("64");
    expect(fp.client_hints?.ua_full_version).toBe("155.0.8059.40");
    expect(fp.client_hints?.mobile).toBe(false);
    expect(fp.client_hints?.wow64).toBe(false);
    expect(fp.client_hints?.form_factors).toEqual(["Desktop"]);
    expect(fp.client_hints?.model).toBe("");
  });

  test("media devices", () => {
    expect(fp.media_devices).toEqual({ audio_inputs: 1, audio_outputs: 1, video_inputs: 1 });
  });

  test("a setting that needs several values is left out unless the browser gave them all", () => {
    const partial = toFingerprint({
      navigator: { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0" },
      screen: { width: 1000 },
      webgl: { renderer: "ANGLE" },
      media: { audiooutput: 2 },
    });
    expect("screen" in partial).toBe(false);
    expect("avail_screen" in partial).toBe(false);
    expect(partial.webgl).toEqual({ renderer: "ANGLE" });
    expect(partial.media_devices).toEqual({ audio_outputs: 2 });
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

  // seleniumbase-rs 0.5.0 refuses a field it does not know (deny_unknown_fields), and its
  // screen, WebGL strings and media devices are one setting each, not flat numbers.
  test("only keys the Rust Fingerprint knows", () => {
    const known = new Set([
      "browser_type", "os_type", "core_version", "user_agent", "platform", "hardware_concurrency", "device_memory",
      "max_touch_points", "vendor", "oscpu", "product_sub", "build_id", "app_version", "locale", "languages",
      "accept_languages", "timezone", "screen", "avail_screen", "pixel_ratio", "color_depth", "webgl",
      "media_devices", "client_hints",
    ]);
    for (const key of Object.keys(fp)) {
      expect(known.has(key)).toBe(true);
    }
  });
});
