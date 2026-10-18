import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Comparison,
  type FingerprintFile,
  MAX_FILE_BYTES,
  type Reading,
  compareFingerprints,
  readFingerprint,
  readFingerprintFile,
  readFingerprintText,
} from "../src/shared/fingerprint-file.ts";
import { type PageProbe, toFingerprint } from "../src/shared/fingerprint.ts";
import { must } from "./support.ts";

const GOLDEN = join(import.meta.dir, "golden", "fingerprints");

/** A file or a page report that is expected to pass the checks. */
function accepted(reading: Reading): FingerprintFile {
  if (!reading.ok) throw new Error(`expected a fingerprint, found: ${reading.problems.join(" | ")}`);
  return reading.fingerprint;
}

function problemsOf(reading: Reading): string[] {
  if (reading.ok) throw new Error("expected the checks to refuse it");
  return reading.problems;
}

/** What the extension wrote for a recorded probe (tests/fingerprint.test.ts pins it). */
function pageFile(name: string): FingerprintFile {
  return accepted(readFingerprintText(readFileSync(join(GOLDEN, "page", `${name}.json`), "utf8")));
}

/** `claims` compared with the page of `name`, as the Page tab does. */
function compare(claims: unknown, name = "chrome-macos"): Comparison {
  return compareFingerprints(accepted(readFingerprint(claims)), pageFile(name));
}

function row(comparison: Comparison, key: string) {
  return must(
    comparison.rows.find((r) => r.key === key),
    `a row for ${key}`,
  );
}

interface Case {
  name: string;
  fingerprint: unknown;
  problem?: string;
}
// JSON.parse is untyped; these files are lists of cases.
const cases = (file: string) => JSON.parse(readFileSync(join(GOLDEN, file), "utf8")) as Case[];

describe("the shared fixtures (the e2e crate holds seleniumbase-rs to the same files)", () => {
  test.each(cases("accepted.json").map((c) => [c.name, c.fingerprint] as const))("accepted: %s", (_name, fingerprint) => {
    accepted(readFingerprint(fingerprint));
  });

  test.each(cases("refused.json").map((c) => [c.name, c.fingerprint, c.problem] as const))("refused: %s", (_name, fingerprint, problem) => {
    const problems = problemsOf(readFingerprint(fingerprint));
    expect(problems.join("\n")).toContain(must(problem));
  });
});

describe("what the extension writes", () => {
  const names = ["chrome-macos", "firefox-linux", "chrome-android"];

  test.each(names)("%s: every setting is one the reader accepts, and every key is read", (name) => {
    // JSON.parse is untyped; the files are a probe report and the JSON written for it.
    const probe = JSON.parse(readFileSync(join(GOLDEN, "probes", `${name}.json`), "utf8")) as PageProbe;
    const written = toFingerprint(probe);
    const file = pageFile(name);
    const keys = new Set([...file.settings.map((s) => s.key), "browser_type", "os_type", "core_version"]);
    for (const key of Object.keys(written)) expect(keys.has(key)).toBe(true);
    expect(file.other).toEqual([]);
    // Everything but a missing value is a value; the one word it writes is "off" for Client Hints.
    const words = file.settings.filter((s) => s.claim.kind !== "value");
    expect(words.map((s) => [s.key, s.claim.kind])).toEqual(name === "firefox-linux" ? [["client_hints", "off"]] : []);
  });
});

describe("reading a file", () => {
  test("text that is not JSON is refused with the parser's words", () => {
    const problems = problemsOf(readFingerprintText("{ not json"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toStartWith("The file is not valid JSON");
  });

  test("an empty file, and one that is only a byte order mark", () => {
    expect(problemsOf(readFingerprintText(""))).toEqual(["The file is empty."]);
    expect(problemsOf(readFingerprintText("﻿ \n"))).toEqual(["The file is empty."]);
  });

  test("a byte order mark before the JSON is ignored", () => {
    expect(accepted(readFingerprintText('﻿{"timezone":"Asia/Tokyo"}')).settings).toHaveLength(1);
  });

  test("JSON that is not an object is refused", () => {
    for (const text of ["[]", "7", '"x"', "null", "true"]) {
      expect(problemsOf(readFingerprintText(text))[0]).toContain("one JSON object");
    }
  });

  test("the old flat shape is refused with a message that names each old field and what replaced it", () => {
    const problems = problemsOf(
      readFingerprintText('{ "os_type": "Windows", "screen_width": 1920, "screen_height": 1080, "webgl_vendor": "V", "flags": {} }'),
    );
    expect(problems).toHaveLength(1);
    const message = must(problems[0]);
    expect(message).toContain("old flat shape");
    expect(message).toContain("0.5 refuses");
    for (const field of ["`screen_width`", "`screen_height`", "`webgl_vendor`", "`flags`"]) {
      expect(message).toContain(field);
    }
    expect(message).toContain("`screen`");
    expect(message).toContain("`webgl`");
  });

  test("a field that no version has is named", () => {
    expect(problemsOf(readFingerprint({ speed: 9 }))).toEqual(["Unknown field `speed`: it is not a setting of a seleniumbase-rs 0.5 Fingerprint."]);
  });

  test("prototype names are unknown fields, not settings", () => {
    const problems = problemsOf(readFingerprintText('{ "__proto__": 1, "constructor": 2, "toString": 3 }'));
    expect(problems.join("\n")).toContain("`constructor`");
    expect(problems.join("\n")).toContain("`toString`");
  });

  test("off is refused where the Rust side refuses it, and the message lists where it is allowed", () => {
    const [message] = problemsOf(readFingerprint({ timezone: "off" }));
    expect(message).toContain("`timezone`");
    expect(message).toContain('"off" is refused');
    for (const allowed of ["media_devices", "geolocation", "webrtc", "battery", "connection", "speech_voices", "bluetooth", "client_hints"]) {
      expect(message).toContain(allowed);
    }
    for (const setting of ["user_agent", "screen", "webgl", "proxy", "fonts", "pixel_ratio"]) {
      expect(problemsOf(readFingerprint({ [setting]: "OFF" }))[0]).toContain(`\`${setting}\``);
    }
  });

  test("off is accepted where it means something, in any case", () => {
    const file = accepted(readFingerprint({ geolocation: "off", webrtc: "Off", media_devices: "OFF", client_hints: "off", bluetooth: "off" }));
    expect(file.settings.map((s) => s.claim.kind)).toEqual(["off", "off", "off", "off", "off"]);
  });

  test("random is refused for the three settings that have no random value", () => {
    for (const setting of ["proxy", "oscpu", "build_id"]) {
      expect(problemsOf(readFingerprint({ [setting]: "random" }))[0]).toContain("no random value");
    }
    expect(accepted(readFingerprint({ timezone: "random", screen: "Random" })).settings.map((s) => s.claim.kind)).toEqual(["random", "random"]);
  });

  test("the plain fields are not settings: they take a value only", () => {
    expect(problemsOf(readFingerprint({ browser_type: "random" }))[0]).toContain("`browser_type`");
    expect(problemsOf(readFingerprint({ os_type: "off" }))[0]).toContain("`os_type`");
    expect(problemsOf(readFingerprint({ os_type: "windows" }))[0]).toContain("expected one of");
    expect(problemsOf(readFingerprint({ core_version: 155.5 }))[0]).toContain("`core_version`");
  });

  test("null and natural both mean the browser's own value, so they are no claim", () => {
    const file = accepted(readFingerprint({ timezone: null, locale: "natural", vendor: "Natural", os_type: null, core_version: null, seed: null }));
    expect(file.settings).toEqual([]);
    expect(file.other).toEqual([]);
  });

  test("a value of the wrong kind names the setting and says what it found", () => {
    expect(problemsOf(readFingerprint({ hardware_concurrency: "8" }))).toEqual(["`hardware_concurrency`: expected a whole number from 0 to 4294967295, found text"]);
    expect(problemsOf(readFingerprint({ screen: { width: 1920 } }))).toEqual(["`screen`: `height` is missing"]);
    expect(problemsOf(readFingerprint({ screen: { width: 1920, height: -1 } }))[0]).toContain("`screen`: `height`");
    expect(problemsOf(readFingerprint({ webgl: { vendor: 3 } }))[0]).toContain("`webgl`: `vendor`");
    expect(problemsOf(readFingerprint({ fonts: ["Arial", 7] }))[0]).toContain("item 2");
  });

  test("every problem is reported, up to eight and a count of the rest", () => {
    const wrong = Object.fromEntries(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((key) => [`bad_${key}`, 1]));
    const problems = problemsOf(readFingerprint(wrong));
    expect(problems).toHaveLength(9);
    expect(problems[8]).toBe("...and 2 more.");
  });

  test("the other fields are kept apart from the settings", () => {
    const file = accepted(readFingerprint({ seed: 3, policy: {}, timezone: "Asia/Tokyo", local_storage: true }));
    expect(file.settings.map((s) => s.key)).toEqual(["timezone"]);
    expect(file.other).toEqual(["seed", "policy", "local_storage"]);
  });

  test("settings come out in the order of the Rust Fingerprint, whatever the order in the file", () => {
    const file = accepted(readFingerprint({ client_hints: "off", timezone: "Asia/Tokyo", user_agent: "Mozilla/5.0 X" }));
    expect(file.settings.map((s) => s.key)).toEqual(["user_agent", "timezone", "client_hints"]);
  });

  test("a file that is too big is refused without being read", async () => {
    let read = false;
    const big = new Blob(["x".repeat(MAX_FILE_BYTES + 1)]);
    const spy = Object.assign(big, {
      text: () => {
        read = true;
        return Promise.resolve("");
      },
    });
    const problems = problemsOf(await readFingerprintFile(spy));
    expect(problems[0]).toContain("limit");
    expect(read).toBe(false);
  });

  test("a file that cannot be read says so", async () => {
    const broken = Object.assign(new Blob(["{}"]), { text: () => Promise.reject(new Error("disk went away")) });
    expect(problemsOf(await readFingerprintFile(broken))).toEqual(["The file could not be read (disk went away)."]);
  });

  test("a file that is read goes through the same checks", async () => {
    const file = new File(['{"timezone":"Asia/Tokyo"}'], "fingerprint.json", { type: "application/json" });
    expect(accepted(await readFingerprintFile(file)).settings).toHaveLength(1);
    expect(problemsOf(await readFingerprintFile(new File(['{"screen_width":1}'], "old.json")))[0]).toContain("`screen_width`");
  });
});

describe("comparing a file with the page", () => {
  test("the page's own report matches itself on every setting", () => {
    const own = pageFile("chrome-macos");
    const comparison = compareFingerprints(own, own);
    expect(comparison.rows.length).toBeGreaterThan(15);
    expect(comparison.rows.every((r) => r.verdict === "match")).toBe(true);
    expect(comparison.counts).toEqual({ match: comparison.rows.length, differs: 0, "not observable": 0 });
  });

  test("a value that is not the page's differs, and both are shown", () => {
    const comparison = compare({ hardware_concurrency: 16, timezone: "Asia/Tokyo", user_agent: "Mozilla/5.0 Other" });
    expect(row(comparison, "hardware_concurrency")).toMatchObject({ file: "16", page: "8", verdict: "differs" });
    expect(row(comparison, "timezone")).toMatchObject({ file: "Asia/Tokyo", page: "Europe/Paris", verdict: "differs" });
    expect(row(comparison, "user_agent").verdict).toBe("differs");
    expect(comparison.counts).toEqual({ match: 0, differs: 3, "not observable": 0 });
  });

  test("the rows follow the file's settings only: what it leaves natural is not a row", () => {
    const comparison = compare({ timezone: "Europe/Paris", locale: "natural", vendor: null });
    expect(comparison.rows.map((r) => r.key)).toEqual(["timezone"]);
    expect(compare({}).rows).toEqual([]);
  });

  test("a screen is compared as a whole", () => {
    const comparison = compare({ screen: { width: 1512, height: 982 }, avail_screen: { width: 1512, height: 900 } });
    expect(row(comparison, "screen")).toMatchObject({ file: "1512 x 982", page: "1512 x 982", verdict: "match" });
    expect(row(comparison, "avail_screen")).toMatchObject({ file: "1512 x 900", page: "1512 x 944", verdict: "differs" });
  });

  test("the language lists are compared without their weights", () => {
    const comparison = compare({ languages: "en-US,en;q=0.9", accept_languages: "en-US,en" });
    expect(row(comparison, "languages").verdict).toBe("match");
    expect(row(comparison, "accept_languages").verdict).toBe("match");
    expect(row(compare({ languages: "en,en-US" }), "languages").verdict).toBe("differs");
  });

  test("a WebGL half the file leaves out is not compared, and the half that differs is named", () => {
    const vendorOnly = compare({ webgl: { vendor: "Google Inc. (Apple)" } });
    expect(row(vendorOnly, "webgl").verdict).toBe("match");
    const wrong = compare({ webgl: { vendor: "Google Inc. (Apple)", renderer: "Something else" } });
    expect(row(wrong, "webgl")).toMatchObject({ verdict: "differs", note: "differs in renderer" });
    expect(row(wrong, "webgl").page).toContain("Apple M1");
  });

  test("device counts are compared, and labelled devices are counted by kind", () => {
    expect(row(compare({ media_devices: { audio_inputs: 1, audio_outputs: 1, video_inputs: 1 } }), "media_devices").verdict).toBe("match");
    const wrong = compare({ media_devices: { audio_inputs: 2, audio_outputs: 1, video_inputs: 0 } });
    expect(row(wrong, "media_devices")).toMatchObject({ verdict: "differs", note: "differs in audio inputs, video inputs" });
    const labelled = {
      media_devices: {
        labelled: [
          { kind: "audioinput", device_id: "a", group_id: "g", label: "Mic" },
          { kind: "audiooutput", device_id: "b", group_id: "g", label: "Speaker" },
          { kind: "videoinput", device_id: "c", group_id: "h", label: "Camera" },
        ],
      },
    };
    expect(row(compare(labelled), "media_devices").verdict).toBe("match");
  });

  test("Client Hints are compared part by part, and the parts that differ are listed", () => {
    const page = pageFile("chrome-macos");
    const ownHints = must(page.settings.find((s) => s.key === "client_hints"));
    if (ownHints.claim.kind !== "value") throw new Error("expected hints");
    const same = compare({ client_hints: ownHints.claim.value });
    expect(row(same, "client_hints").verdict).toBe("match");
    const changed = compare({ client_hints: { ...(ownHints.claim.value as object), platform_version: "14.0.0", mobile: true } });
    expect(row(changed, "client_hints")).toMatchObject({ verdict: "differs", note: "differs in platform_version, mobile" });
    expect(row(same, "client_hints").file).toContain("macOS 15.0.0");
  });

  test("random is not a value to compare", () => {
    const comparison = compare({ timezone: "random", screen: "random" });
    expect(row(comparison, "timezone")).toMatchObject({ file: "random", page: "Europe/Paris", verdict: "not observable" });
    expect(row(comparison, "timezone").note).toContain("drawn");
  });

  test("off matches a page that has none, and differs from one that has the thing", () => {
    expect(row(compare({ client_hints: "off" }, "firefox-linux"), "client_hints")).toMatchObject({ file: "off", page: "off", verdict: "match" });
    expect(row(compare({ client_hints: "off" }), "client_hints")).toMatchObject({ verdict: "differs", note: "the file turns it off; the page has it" });
    expect(row(compare({ media_devices: "off" }), "media_devices").verdict).toBe("differs");
    // A file with Client Hints against a page that has none.
    const hints = { brands: [], full_version_list: [], platform: "macOS", platform_version: "15.0.0", architecture: "arm", bitness: "64", model: "", ua_full_version: "155.0.0.0", mobile: false };
    expect(row(compare({ client_hints: hints }, "firefox-linux"), "client_hints")).toMatchObject({ verdict: "differs", note: "the page does not have it" });
  });

  test("what the page does not give is not observable", () => {
    // Firefox has no deviceMemory; a page cannot read the position, the fonts, a proxy or the WebRTC addresses.
    const comparison = compare(
      {
        device_memory: 8,
        geolocation: { latitude: 1, longitude: 2 },
        fonts: ["Arial"],
        proxy: { type: "http", host: "p.example", port: 1, save_traffic: false },
        webrtc: "off",
        bluetooth: true,
      },
      "firefox-linux",
    );
    expect(comparison.rows.map((r) => r.verdict)).toEqual(Array(6).fill("not observable"));
    expect(row(comparison, "device_memory").note).toBe("this page does not tell");
    expect(row(comparison, "geolocation").note).toBe("a page cannot read this");
  });

  test("a proxy is shown without its credentials", () => {
    const comparison = compare({ proxy: { type: "http", host: "p.example", port: 8080, username: "me", password: "hunter2", save_traffic: false } });
    const shown = row(comparison, "proxy").file;
    expect(shown).toBe("http://p.example:8080 (credentials hidden)");
    expect(JSON.stringify(comparison)).not.toContain("hunter2");
  });

  test("the browser and system names match through their aliases", () => {
    expect(row(compare({ browser_type: "chromium", os_type: "Macos", core_version: 155 }), "os_type").verdict).toBe("match");
    expect(row(compare({ browser_type: "firefox" }), "browser_type").verdict).toBe("differs");
    const phone = compare({ browser_type: "safari", os_type: "ipados" }, "chrome-android");
    expect(row(phone, "browser_type").verdict).toBe("differs");
    expect(row(phone, "os_type").verdict).toBe("differs");
    expect(row(compare({ os_type: "ipados" }, "chrome-android"), "os_type").page).toBe("Android");
  });

  test("the pixel ratio is compared as a number", () => {
    expect(row(compare({ pixel_ratio: 2 }), "pixel_ratio").verdict).toBe("match");
    expect(row(compare({ pixel_ratio: 2.625 }, "chrome-android"), "pixel_ratio").verdict).toBe("match");
    expect(row(compare({ pixel_ratio: 1 }), "pixel_ratio").verdict).toBe("differs");
  });

  test("the fields that are not settings are listed, not compared", () => {
    const comparison = compare({ seed: 5, policy: { grant_permissions: true }, timezone: "Europe/Paris" });
    expect(comparison.other).toEqual(["seed", "policy"]);
    expect(comparison.rows.map((r) => r.key)).toEqual(["timezone"]);
  });
});
