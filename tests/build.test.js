import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { build, discoverFeatures, mergeManifest } from "../scripts/build.ts";

let out;
let result;

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "sbrs-build-"));
  result = await build({ outRoot: out, e2e: true, quiet: true });
});

const manifestOf = (name) => JSON.parse(readFileSync(join(out, name, "manifest.json"), "utf8"));

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("features", () => {
  test("every enabled folder is found, the placeholders are not", () => {
    expect(discoverFeatures().map((f) => f.name)).toEqual(["devtools-recorder", "inspector", "recorder", "ui"]);
    expect(result.features).toEqual(["devtools-recorder", "inspector", "recorder", "ui"]);
  });
});

describe("mergeManifest", () => {
  test("arrays join without repeats, objects merge", () => {
    const merged = mergeManifest({ permissions: ["a"], x: { y: 1 } }, { permissions: ["a", "b"], x: { z: 2 } });
    expect(merged).toEqual({ permissions: ["a", "b"], x: { y: 1, z: 2 } });
  });
  test("two different values for one key are an error", () => {
    expect(() => mergeManifest({ name: "a" }, { name: "b" })).toThrow(/two features set different values/);
  });
  test("the same value twice is fine", () => {
    expect(mergeManifest({ name: "a" }, { name: "a" })).toEqual({ name: "a" });
  });
});

describe("chrome", () => {
  const m = () => manifestOf("chrome");
  test("Manifest V3 with a service worker, a side panel and the Recorder plugin page", () => {
    expect(m().manifest_version).toBe(3);
    expect(m().background).toEqual({ service_worker: "background.js" });
    expect(m().side_panel.default_path).toBe("ui/panel.html");
    expect(m().devtools_page).toBe("devtools-recorder/devtools.html");
    expect(m().action.default_popup).toBe("ui/panel.html");
  });
  test("the fewest permissions: activeTab, optional hosts, no static host access", () => {
    expect([...m().permissions].sort()).toEqual(["activeTab", "scripting", "sidePanel", "storage"]);
    expect(m().optional_host_permissions).toEqual(["<all_urls>"]);
    expect(m().host_permissions).toBeUndefined();
    expect(m().content_scripts).toBeUndefined();
  });
  test("a strict extension CSP", () => {
    const csp = m().content_security_policy.extension_pages;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toMatch(/https?:/);
  });
});

describe("firefox", () => {
  const m = () => manifestOf("firefox");
  test("background scripts, a gecko id and no Chromium-only keys", () => {
    expect(m().manifest_version).toBe(3);
    expect(m().background).toEqual({ scripts: ["background.js"] });
    expect(m().browser_specific_settings.gecko.id).toBe("seleniumbase-rs-companion@seleniumbase-rs");
    expect(m().browser_specific_settings.gecko.data_collection_permissions).toEqual({ required: ["none"] });
    expect(m().sidebar_action.default_panel).toBe("ui/panel.html");
    expect(m().devtools_page).toBeUndefined();
    expect(m().side_panel).toBeUndefined();
    expect(m().minimum_chrome_version).toBeUndefined();
    expect(m().permissions).not.toContain("sidePanel");
  });
  test("has no Recorder plugin files", () => {
    expect(existsSync(join(out, "firefox", "devtools-recorder"))).toBe(false);
  });
});

describe("the e2e variant", () => {
  test("is chrome plus loopback host access, and nothing else", () => {
    const e2e = manifestOf("chrome-e2e");
    expect(e2e.host_permissions).toEqual(["http://127.0.0.1/*", "http://localhost/*"]);
    const { host_permissions, name, ...rest } = e2e;
    const { name: chromeName, ...chrome } = manifestOf("chrome");
    expect(rest).toEqual(chrome);
    expect(host_permissions).toBeDefined();
    expect(name).toContain("e2e");
    expect(chromeName).not.toContain("e2e");
  });
});

describe("files", () => {
  const targets = ["chrome", "firefox", "chrome-e2e"];

  test.each(targets)("%s: every file the manifest names exists", (target) => {
    const m = manifestOf(target);
    const paths = [
      ...Object.values(m.icons),
      m.action.default_popup,
      ...Object.values(m.action.default_icon),
      m.background.service_worker,
      ...(m.background.scripts ?? []),
      m.side_panel?.default_path,
      m.sidebar_action?.default_panel,
      m.devtools_page,
    ].filter(Boolean);
    for (const path of paths) {
      expect(existsSync(join(out, target, path))).toBe(true);
    }
  });

  test.each(targets)("%s: every page loads only files that exist, from itself", (target) => {
    for (const file of walk(join(out, target)).filter((f) => f.endsWith(".html"))) {
      const html = readFileSync(file, "utf8");
      for (const [, attr] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
        expect(attr).not.toMatch(/^[a-z]+:/i);
        expect(existsSync(join(file, "..", attr))).toBe(true);
      }
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>\s*\S/); // no inline script
    }
  });

  test.each(targets)("%s: no eval, no Function constructor, no remote code", (target) => {
    for (const file of walk(join(out, target)).filter((f) => f.endsWith(".js"))) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/\beval\s*\(/);
      expect(source).not.toMatch(/new\s+Function\s*\(/);
      expect(source).not.toMatch(/importScripts\s*\(/);
      expect(source).not.toMatch(/<script[^>]*src=["']https?:/i);
    }
  });

  test.each(targets)("%s: bundles are classic scripts (no import or export left)", (target) => {
    for (const file of walk(join(out, target)).filter((f) => f.endsWith(".js"))) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/^\s*import\s.+from\s/m);
      expect(source).not.toMatch(/^\s*export\s/m);
    }
  });

  test("the build does not leave generated entries behind", () => {
    expect(existsSync(join(out, ".gen"))).toBe(false);
  });

  test("the chrome background carries the browser define", () => {
    expect(readFileSync(join(out, "chrome", "background.js"), "utf8")).toContain('"chrome"');
    expect(readFileSync(join(out, "firefox", "background.js"), "utf8")).toContain('"firefox"');
  });
});

describe("zips", () => {
  function entries(path) {
    const buf = readFileSync(path);
    let eocd = buf.length - 22;
    while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
    expect(eocd).toBeGreaterThan(0);
    const count = buf.readUInt16LE(eocd + 10);
    let at = buf.readUInt32LE(eocd + 16);
    const out = new Map();
    for (let i = 0; i < count; i++) {
      expect(buf.readUInt32LE(at)).toBe(0x02014b50);
      const crc = buf.readUInt32LE(at + 16);
      const csize = buf.readUInt32LE(at + 20);
      const usize = buf.readUInt32LE(at + 24);
      const nlen = buf.readUInt16LE(at + 28);
      const local = buf.readUInt32LE(at + 42);
      const name = buf.subarray(at + 46, at + 46 + nlen).toString("utf8");
      const lnlen = buf.readUInt16LE(local + 26);
      const start = local + 30 + lnlen;
      const data = inflateRawSync(buf.subarray(start, start + csize));
      expect(data.length).toBe(usize);
      expect(Bun.hash.crc32(data) >>> 0).toBe(crc);
      out.set(name, data);
      at += 46 + nlen;
    }
    return out;
  }

  test.each(["chrome", "firefox"])("%s zip holds the dist exactly", (browser) => {
    const zip = result.targets.find((t) => t.name === browser).zip;
    const files = entries(zip);
    const dist = walk(join(out, browser)).map((f) => f.slice(join(out, browser).length + 1));
    expect([...files.keys()].sort()).toEqual(dist.sort());
    expect(JSON.parse(files.get("manifest.json").toString()).manifest_version).toBe(3);
  });

  test("the e2e variant is not zipped", () => {
    expect(result.targets.find((t) => t.name === "chrome-e2e").zip).toBeUndefined();
  });
});
