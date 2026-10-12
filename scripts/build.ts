// Builds the extension from one source tree into dist/chrome and dist/firefox,
// and a zip of each. Run with `bun run scripts/build.ts`.
//
//   --e2e          also build dist/chrome-e2e and dist/firefox-e2e: the same plus
//                  host access to loopback pages, because a headless browser
//                  cannot answer the permission prompt (see e2e/README.md)
//   --no-zip       skip the zips
//   --only <name>  build one target (chrome, firefox)
//
// How the tree becomes an extension:
//
//   src/manifest/base.json     keys every browser shares; base.<browser> keys are
//                              merged on top for that browser
//   src/<feature>/feature.json one folder per feature, found by this file. Fields:
//        enabled     false to leave the folder out (the placeholders)
//        browsers    ["chrome", "firefox"] by default; list fewer to limit it
//        background  a module imported by the one background bundle
//        scripts     files bundled one by one (content scripts, page scripts)
//        panelEntry  (ui only) the panel shell, bundled with every panelViews module
//        panelViews  a module that registers a tab in the panel (ui/registry.js)
//        manifest    manifest keys merged into every browser's manifest, and
//        chrome / firefox   the same for one browser
//   every other file of a feature (html, css, images) is copied as it is, to
//   dist/<target>/<feature>/<file>. Files starting with "_", *.md and
//   feature.json are not copied.
//
// Arrays in manifest fragments are joined without repeats; objects are merged;
// two different values for one key are an error, so features cannot silently
// override each other.

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { deflateRawSync, deflateSync } from "node:zlib";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "src");
const NOT_FEATURES = new Set(["shared", "manifest", "background"]);
const BROWSERS = ["chrome", "firefox"] as const;
type Browser = (typeof BROWSERS)[number];

export interface Feature {
  name: string;
  dir: string;
  browsers: string[];
  background?: string;
  panelEntry?: string;
  panelViews?: string;
  scripts: string[];
  manifest: Record<string, unknown>;
  chrome: Record<string, unknown>;
  firefox: Record<string, unknown>;
}

export interface BuildOptions {
  outRoot?: string;
  e2e?: boolean;
  zip?: boolean;
  only?: string;
  quiet?: boolean;
}

export interface BuildResult {
  targets: { name: string; dir: string; zip?: string; manifest: Record<string, any> }[];
  features: string[];
}

type Json = Record<string, any>;

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The features of the tree: every src/<name>/feature.json that is not disabled. */
export function discoverFeatures(): Feature[] {
  const features: Feature[] = [];
  for (const name of readdirSync(SRC).sort()) {
    const dir = join(SRC, name);
    if (NOT_FEATURES.has(name) || !statSync(dir).isDirectory()) continue;
    const file = join(dir, "feature.json");
    if (!existsSync(file)) continue;
    const spec = readJson(file);
    if (spec.enabled === false) continue;
    features.push({
      name,
      dir,
      browsers: spec.browsers ?? [...BROWSERS],
      background: spec.background,
      panelEntry: spec.panelEntry,
      panelViews: spec.panelViews,
      scripts: spec.scripts ?? [],
      manifest: spec.manifest ?? {},
      chrome: spec.chrome ?? {},
      firefox: spec.firefox ?? {},
    });
  }
  return features;
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Merges `extra` into `base`: arrays join without repeats, objects merge, other values must agree. */
export function mergeManifest(base: Json, extra: Json, where = "manifest"): Json {
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const path = `${where}.${key}`;
    if (!(key in out)) {
      out[key] = value;
    } else if (Array.isArray(out[key]) && Array.isArray(value)) {
      out[key] = [...out[key], ...value.filter((v) => !out[key].some((o: unknown) => JSON.stringify(o) === JSON.stringify(v)))];
    } else if (isObject(out[key]) && isObject(value)) {
      out[key] = mergeManifest(out[key], value, path);
    } else if (JSON.stringify(out[key]) !== JSON.stringify(value)) {
      throw new Error(`${path}: two features set different values (${JSON.stringify(out[key])} and ${JSON.stringify(value)})`);
    }
  }
  return out;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function copyable(feature: Feature, file: string): boolean {
  const rel = relative(feature.dir, file).split(sep).join("/");
  const base = rel.split("/").pop() as string;
  if (base === "feature.json" || base.startsWith("_") || base.endsWith(".md")) return false;
  if (base.endsWith(".js") || base.endsWith(".ts")) return false; // modules are bundled, never copied
  if (rel.startsWith("tests/") || base.endsWith(".test.js")) return false;
  return true;
}

// ------------------------------------------------------------------ icons

function png(size: number): Uint8Array {
  const rows: number[] = [];
  const radius = size * 0.22;
  const dot = size * 0.27;
  const c = (size - 1) / 2;
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  for (let y = 0; y < size; y++) {
    rows.push(0);
    for (let x = 0; x < size; x++) {
      // rounded-square coverage
      const dx = Math.max(Math.abs(x - c) - (size / 2 - radius), 0);
      const dy = Math.max(Math.abs(y - c) - (size / 2 - radius), 0);
      const square = Math.min(Math.max(radius - Math.hypot(dx, dy) + 0.5, 0), 1);
      const circle = Math.min(Math.max(dot - Math.hypot(x - c, y - c) + 0.5, 0), 1);
      const ring = Math.min(Math.max(dot + size * 0.09 - Math.hypot(x - c, y - c) + 0.5, 0), 1) - circle;
      let color = [17, 24, 39];
      color = mix(color, [250, 250, 250], Math.max(ring, 0));
      color = mix(color, [239, 68, 68], circle);
      rows.push(color[0], color[1], color[2], Math.round(255 * square));
    }
  }
  const raw = Buffer.from(rows);
  const chunk = (type: string, data: Uint8Array) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const body = Buffer.concat([head.subarray(4), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(Bun.hash.crc32(body) >>> 0, 0);
    return Buffer.concat([head.subarray(0, 4), body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const ICON_SIZES = [16, 32, 48, 128];

// ------------------------------------------------------------------ zip

function zipFiles(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.from(file.data);
    const packed = deflateRawSync(data);
    const crc = Bun.hash.crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01, so the zip is reproducible
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

// ------------------------------------------------------------------ build

async function bundle(entry: string, outdir: string, browser: string, naming = "[name].[ext]") {
  const result = await Bun.build({
    entrypoints: [entry],
    outdir,
    target: "browser",
    format: "iife",
    minify: false,
    sourcemap: "none",
    naming,
    define: { __BROWSER__: JSON.stringify(browser.startsWith("firefox") ? "firefox" : "chrome") },
  });
  if (!result.success) {
    throw new Error(`bundling ${entry} failed:\n${result.logs.map((l) => String(l)).join("\n")}`);
  }
}

function manifestFor(target: string, browser: Browser, features: Feature[], e2e: boolean): Json {
  const base = readJson(join(SRC, "manifest", "base.json"));
  const pkg = readJson(join(ROOT, "package.json"));
  let manifest: Json = { ...base };
  delete manifest.chrome;
  delete manifest.firefox;
  manifest = mergeManifest(manifest, base[browser] ?? {});
  for (const feature of features) {
    manifest = mergeManifest(manifest, feature.manifest, `${feature.name}.manifest`);
    manifest = mergeManifest(manifest, feature[browser], `${feature.name}.${browser}`);
  }
  manifest.version = pkg.version;
  if (e2e) {
    manifest = mergeManifest(manifest, { host_permissions: ["http://127.0.0.1/*", "http://localhost/*"] });
    manifest.name = `${manifest.name} (e2e)`;
  }
  void target;
  return manifest;
}

async function buildTarget(name: string, browser: Browser, features: Feature[], outRoot: string, e2e: boolean, zip: boolean) {
  const dir = join(outRoot, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const mine = features.filter((f) => f.browsers.includes(browser));

  // One background bundle: the router, then every feature's background module.
  const gen = join(outRoot, ".gen");
  mkdirSync(gen, { recursive: true });
  const imports = [join(SRC, "background", "index.js"), ...mine.filter((f) => f.background).map((f) => join(f.dir, f.background as string))];
  const entry = join(gen, `background-${name}.js`);
  writeFileSync(entry, imports.map((p) => `import ${JSON.stringify(p)};`).join("\n") + "\n");
  await bundle(entry, dir, name, "background.js");

  for (const feature of mine) {
    for (const script of feature.scripts) {
      await bundle(join(feature.dir, script), join(dir, feature.name, dirname(script)), name);
    }
    for (const file of walk(feature.dir)) {
      if (!copyable(feature, file)) continue;
      const out = join(dir, feature.name, relative(feature.dir, file));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, readFileSync(file));
    }
  }

  // The panel: every feature's views first (they register themselves), then the shell.
  const shell = mine.find((f) => f.panelEntry);
  if (shell) {
    const views = mine.filter((f) => f.panelViews).map((f) => join(f.dir, f.panelViews as string));
    const panelEntry = join(gen, `panel-${name}.js`);
    const lines = [...views, join(shell.dir, shell.panelEntry as string)].map((p) => `import ${JSON.stringify(p)};`);
    writeFileSync(panelEntry, `${lines.join("\n")}\n`);
    await bundle(panelEntry, join(dir, shell.name), name, shell.panelEntry as string);
  }

  mkdirSync(join(dir, "icons"), { recursive: true });
  for (const size of ICON_SIZES) writeFileSync(join(dir, "icons", `${size}.png`), png(size));

  const manifest = manifestFor(name, browser, mine, e2e);
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  let zipPath: string | undefined;
  if (zip) {
    const files = walk(dir).map((path) => ({
      name: relative(dir, path).split(sep).join("/"),
      data: readFileSync(path),
    }));
    zipPath = join(outRoot, `seleniumbase-rs-companion-${browser}-${manifest.version}.zip`);
    writeFileSync(zipPath, zipFiles(files));
  }
  return { name, dir, zip: zipPath, manifest };
}

export async function build(options: BuildOptions = {}): Promise<BuildResult> {
  const outRoot = options.outRoot ?? join(ROOT, "dist");
  const features = discoverFeatures();
  mkdirSync(outRoot, { recursive: true });
  const targets: BuildResult["targets"] = [];
  const wanted = (name: string) => !options.only || options.only === name;
  for (const browser of BROWSERS) {
    if (wanted(browser)) {
      targets.push(await buildTarget(browser, browser, features, outRoot, false, options.zip !== false));
    }
  }
  if (options.e2e) {
    targets.push(await buildTarget("chrome-e2e", "chrome", features, outRoot, true, false));
    targets.push(await buildTarget("firefox-e2e", "firefox", features, outRoot, true, false));
  }
  rmSync(join(outRoot, ".gen"), { recursive: true, force: true });
  if (!options.quiet) {
    for (const t of targets) console.log(`built ${relative(ROOT, t.dir)}${t.zip ? ` and ${relative(ROOT, t.zip)}` : ""}`);
    console.log(`features: ${features.map((f) => f.name).join(", ")}`);
  }
  return { targets, features: features.map((f) => f.name) };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
  await build({ e2e: args.includes("--e2e"), zip: !args.includes("--no-zip"), only });
}
