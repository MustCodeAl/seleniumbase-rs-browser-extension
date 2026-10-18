import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type Fingerprint,
  type PageProbe,
  acceptLanguages,
  fingerprintFile,
  fingerprintFilename,
  fingerprintText,
  languageList,
  toFingerprint,
} from "../src/shared/fingerprint.ts";
import { must } from "./support.ts";

/** The recorded probe results, and the JSON the extension writes for each (API v2, pinned). */
const GOLDEN = join(import.meta.dir, "golden", "fingerprints");

/** The hints of a fingerprint that has them; a test that finds "off" or none fails. */
function hintsOf(fp: Fingerprint) {
  const hints = fp.client_hints;
  if (hints === undefined || hints === "off") throw new Error(`expected Client Hints, found ${String(hints)}`);
  return hints;
}

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
  secureContext: true,
  userAgentDataPresent: true,
};

describe("Accept-Language", () => {
  test("weights fall by a tenth", () => {
    expect(acceptLanguages(["en-US", "en"])).toBe("en-US,en;q=0.9");
    expect(acceptLanguages(["fr-FR", "fr", "en"])).toBe("fr-FR,fr;q=0.9,en;q=0.8");
    expect(acceptLanguages([])).toBeUndefined();
  });
  test("navigator.languages is the plain comma-separated list", () => {
    expect(languageList(["fr-FR", "fr", "en"])).toBe("fr-FR,fr,en");
    expect(languageList([])).toBeUndefined();
    expect(languageList(null)).toBeUndefined();
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
    // `languages` is navigator.languages; `accept_languages` is the request header, with weights.
    expect(fp.languages).toBe("en-US,en");
    expect(fp.accept_languages).toBe("en-US,en;q=0.9");
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
    const hints = hintsOf(fp);
    expect(hints.platform).toBe("macOS");
    expect(hints.brands[0]).toEqual({ brand: "Chromium", version: "155" });
    expect(hints.full_version_list[0]?.version).toBe("155.0.8059.40");
    expect(hints.platform_version).toBe("15.0.0");
    expect(hints.architecture).toBe("arm");
    expect(hints.bitness).toBe("64");
    expect(hints.ua_full_version).toBe("155.0.8059.40");
    expect(hints.mobile).toBe(false);
    expect(hints.wow64).toBe(false);
    expect(hints.form_factors).toEqual(["Desktop"]);
    expect(hints.model).toBe("");
  });

  test("a browser without Client Hints says off on a secure page, and nothing elsewhere", () => {
    const firefox = { navigator: { userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0" } };
    expect(toFingerprint({ ...firefox, secureContext: true, userAgentDataPresent: false }).client_hints).toBe("off");
    // An insecure page has no userAgentData in any browser, so its absence says nothing.
    expect("client_hints" in toFingerprint({ ...firefox, secureContext: false, userAgentDataPresent: false })).toBe(false);
    // The object exists but could not be read: that is not "off" either.
    expect("client_hints" in toFingerprint({ ...firefox, secureContext: true, userAgentDataPresent: true, userAgentData: null })).toBe(false);
    expect("client_hints" in toFingerprint(firefox)).toBe(false);
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
    // A device count left out would be read as 0, which is a claim: so none is written.
    expect("media_devices" in partial).toBe(false);
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

// The probe results in tests/golden/fingerprints/probes are what `probePage` returns in a page
// (one file per browser), and tests/golden/fingerprints/page holds the exact text the extension
// writes for each. `UPDATE_GOLDEN=1 bun test tests/fingerprint.test.ts` rewrites the pinned files
// after a deliberate change to the mapping; the e2e crate then reads them with seleniumbase-rs.
describe("the JSON written for each recorded probe (API v2, pinned)", () => {
  const names = readdirSync(join(GOLDEN, "probes"))
    .filter((file) => file.endsWith(".json"))
    .sort();

  test("there are probes to pin", () => {
    expect(names.length).toBeGreaterThanOrEqual(3);
  });

  test.each(names)("%s", (name) => {
    // JSON.parse is untyped; the file is a probe report.
    const probe = JSON.parse(readFileSync(join(GOLDEN, "probes", name), "utf8")) as PageProbe;
    const written = fingerprintFile(toFingerprint(probe));
    const pinned = join(GOLDEN, "page", name);
    if (process.env.UPDATE_GOLDEN) {
      mkdirSync(dirname(pinned), { recursive: true });
      writeFileSync(pinned, written);
    }
    expect(written).toBe(readFileSync(pinned, "utf8"));
  });

  test("a Mac Chrome: every setting is its plain value", () => {
    const fp: unknown = JSON.parse(readFileSync(join(GOLDEN, "page", "chrome-macos.json"), "utf8"));
    expect(fp).toMatchObject({
      browser_type: "chromium",
      os_type: "Macos",
      core_version: 155,
      platform: "MacIntel",
      languages: "en-US,en",
      accept_languages: "en-US,en;q=0.9",
      screen: { width: 1512, height: 982 },
      avail_screen: { width: 1512, height: 944 },
      webgl: { vendor: "Google Inc. (Apple)" },
      media_devices: { audio_inputs: 1, audio_outputs: 1, video_inputs: 1 },
    });
  });

  // chrome-headless-macos.json is a real report: it was printed by the Chrome end-to-end run
  // (`probePage` in a headless Chrome 155 on macOS, through the built extension).
  test("a headless Chrome recorded from the end-to-end run", () => {
    const fp: unknown = JSON.parse(readFileSync(join(GOLDEN, "page", "chrome-headless-macos.json"), "utf8"));
    expect(fp).toMatchObject({
      os_type: "Macos",
      core_version: 155,
      timezone: "America/Chicago",
      screen: { width: 800, height: 600 },
      media_devices: { audio_inputs: 1, audio_outputs: 1, video_inputs: 1 },
      client_hints: { platform: "macOS", platform_version: "27.0.1", ua_full_version: "155.0.8059.85" },
    });
  });

  test("a Firefox has no Client Hints and leaves what it lacks natural", () => {
    const fp: unknown = JSON.parse(readFileSync(join(GOLDEN, "page", "firefox-linux.json"), "utf8"));
    expect(fp).toMatchObject({ browser_type: "firefox", os_type: "Linux", client_hints: "off", oscpu: "Linux x86_64" });
    // Firefox has no deviceMemory, and an empty vendor says nothing: both are left out, not null.
    expect(fp).not.toHaveProperty("device_memory");
    expect(fp).not.toHaveProperty("vendor");
  });
});

describe("the exported file", () => {
  test("is the copied text and a newline", () => {
    const fp = toFingerprint(probe);
    expect(fingerprintFile(fp)).toBe(`${fingerprintText(fp)}\n`);
    expect(JSON.parse(fingerprintFile(fp))).toEqual(fp);
  });

  test("is named for the host and the local date", () => {
    const day = new Date(2026, 9, 8, 23, 59); // 8 October 2026, local time
    expect(fingerprintFilename("https://example.com/path?q=1", day)).toBe("fingerprint-example.com-2026-10-08.json");
    expect(fingerprintFilename("http://localhost:8080/", day)).toBe("fingerprint-localhost-8080-2026-10-08.json");
    expect(fingerprintFilename("https://Sub.Example.CO.UK:8443/", day)).toBe("fingerprint-sub.example.co.uk-8443-2026-10-08.json");
  });

  test("a page without a host is called page, and nothing odd gets into the name", () => {
    const day = new Date(2026, 0, 2);
    expect(fingerprintFilename("about:blank", day)).toBe("fingerprint-page-2026-01-02.json");
    expect(fingerprintFilename("file:///home/me/x.html", day)).toBe("fingerprint-page-2026-01-02.json");
    expect(fingerprintFilename(null, day)).toBe("fingerprint-page-2026-01-02.json");
    expect(fingerprintFilename("not a url", day)).toBe("fingerprint-page-2026-01-02.json");
    const name = fingerprintFilename("https://user:pw@evil.example/..%2F..", day);
    expect(name).toBe("fingerprint-evil.example-2026-01-02.json");
    expect(name).not.toMatch(/[\\/:*?"<>|\s]/);
  });
});
