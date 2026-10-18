// A Fingerprint file as seleniumbase-rs 0.5 reads it (fingerprint API v2), and how it
// compares with what a page sees. Nothing here touches the browser: the Page tab
// reads a file the person picked, and this module checks it and lines it up with the
// page's own report.
//
// The format (src/stealth/fingerprint.rs and settings.rs of seleniumbase-rs): one JSON
// object, one entry per setting. An entry is the setting's value, or one of the words
// "natural", "random" and "off" (any case); a missing entry, a null and "natural" all
// mean the browser's own value. "off" means something only for the settings listed
// in `OFF_SETTINGS`, and the Rust side refuses it elsewhere. Version 1 was flat
// (`screen_width`, `webgl_vendor`, a `flags` object); 0.5 refuses it and names the
// field, and so does this module, because a file it would read as "nothing to say"
// would be a silent loss. The checks follow the Rust side's serde shapes, so a file
// that passes here is one `Fingerprint` accepts (the e2e crate holds both to the
// same files in tests/golden/fingerprints).

import type { ClientHints, ProbeBrand, ScreenSize } from "./fingerprint.ts";
import { errorText, isRecord } from "./guards.ts";

// ---------------------------------------------------------------- the results

/** How a setting of the file stands against the page. */
export type Verdict = "match" | "differs" | "not observable";

/** What a file says about one setting; a setting it leaves natural has no claim. */
export type Claim = { kind: "value"; value: unknown } | { kind: "random" } | { kind: "off" };

/** One setting a file claims. */
export interface Setting {
  key: string;
  label: string;
  claim: Claim;
}

/** A fingerprint file that passed the checks. */
export interface FingerprintFile {
  /** The settings it claims, in the order of seleniumbase-rs's `Fingerprint`. */
  settings: Setting[];
  /** The other fields it holds (`seed`, `policy`, ...), which say nothing a page could show. */
  other: string[];
}

/** The outcome of reading a file: the fingerprint, or what is wrong with it (the first problem names the field). */
export type Reading = { ok: true; fingerprint: FingerprintFile } | { ok: false; problems: string[] };

/** One line of the comparison table. `note` is "" when there is nothing to add. */
export interface Row {
  key: string;
  label: string;
  file: string;
  page: string;
  verdict: Verdict;
  note: string;
}

export interface Comparison {
  rows: Row[];
  counts: Record<Verdict, number>;
  /** Fields of the file that are not settings and so are not compared. */
  other: string[];
}

/** The largest file the Page tab reads: a fingerprint is a few kilobytes. */
export const MAX_FILE_BYTES = 1_000_000;

// ---------------------------------------------------------------- readers

type Read<T> = { ok: true; value: T } | { ok: false; why: string };
type Reader<T> = (value: unknown) => Read<T>;

const ok = <T>(value: T): Read<T> => ({ ok: true, value });
const fail = (why: string): Read<never> => ({ ok: false, why });

/** What a JSON value is, for a message: "text", "a number", ... */
function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  switch (typeof value) {
    case "string":
      return "text";
    case "number":
      return "a number";
    case "boolean":
      return "true or false";
    case "object":
      return "an object";
    default:
      return typeof value;
  }
}

const text: Reader<string> = (v) => (typeof v === "string" ? ok(v) : fail(`expected text, found ${kindOf(v)}`));
const flag: Reader<boolean> = (v) => (typeof v === "boolean" ? ok(v) : fail(`expected true or false, found ${kindOf(v)}`));
const real: Reader<number> = (v) => (typeof v === "number" && Number.isFinite(v) ? ok(v) : fail(`expected a number, found ${kindOf(v)}`));

function whole(max: number): Reader<number> {
  return (v) =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max
      ? ok(v)
      : fail(`expected a whole number from 0 to ${max}, found ${typeof v === "number" ? String(v) : kindOf(v)}`);
}
const u32 = whole(4_294_967_295);
const u16 = whole(65_535);
const u64: Reader<number> = (v) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 18_446_744_073_709_551_615
    ? ok(v)
    : fail(`expected a whole number of 0 or more, found ${typeof v === "number" ? String(v) : kindOf(v)}`);

function oneOf(names: readonly string[]): Reader<string> {
  return (v) => (typeof v === "string" && names.includes(v) ? ok(v) : fail(`expected one of ${names.map((n) => `"${n}"`).join(", ")}`));
}

function list<T>(item: Reader<T>): Reader<T[]> {
  return (v) => {
    if (!Array.isArray(v)) return fail(`expected a list, found ${kindOf(v)}`);
    const out: T[] = [];
    for (const [index, element] of v.entries()) {
      const read = item(element);
      if (!read.ok) return fail(`item ${index + 1}: ${read.why}`);
      out.push(read.value);
    }
    return ok(out);
  };
}

function objectOf(what: string): Reader<Record<string, unknown>> {
  return (v) => (isRecord(v) ? ok(v) : fail(`expected ${what}, found ${kindOf(v)}`));
}

/** A required member of an object. */
function member<T>(rec: Record<string, unknown>, name: string, read: Reader<T>): Read<T> {
  if (!Object.hasOwn(rec, name)) return fail(`\`${name}\` is missing`);
  const got = read(rec[name]);
  return got.ok ? got : fail(`\`${name}\`: ${got.why}`);
}

/** An optional member: missing and null are both "not given". */
function maybe<T>(rec: Record<string, unknown>, name: string, read: Reader<T>): Read<T | undefined> {
  const raw = Object.hasOwn(rec, name) ? rec[name] : undefined;
  if (raw === undefined || raw === null) return ok(undefined);
  const got = read(raw);
  return got.ok ? got : fail(`\`${name}\`: ${got.why}`);
}

/** Several required text members at once. */
function texts<K extends string>(rec: Record<string, unknown>, names: readonly K[]): Read<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const name of names) {
    const got = member(rec, name, text);
    if (!got.ok) return got;
    out[name] = got.value;
  }
  return ok(out);
}

const size: Reader<ScreenSize> = (v) => {
  const rec = objectOf('{ "width": ..., "height": ... }')(v);
  if (!rec.ok) return rec;
  const width = member(rec.value, "width", u32);
  if (!width.ok) return width;
  const height = member(rec.value, "height", u32);
  if (!height.ok) return height;
  return ok({ width: width.value, height: height.value });
};

/** The two WebGL strings; a half the file leaves out is the browser's own. */
interface GlStrings {
  vendor: string | undefined;
  renderer: string | undefined;
}

const glStrings: Reader<GlStrings> = (v) => {
  const rec = objectOf('{ "vendor": ..., "renderer": ... }')(v);
  if (!rec.ok) return rec;
  const parts: Record<string, string | undefined> = {};
  for (const name of ["vendor", "renderer", "vendor_id", "renderer_id"]) {
    const got = maybe(rec.value, name, text);
    if (!got.ok) return got;
    parts[name] = got.value;
  }
  return ok({ vendor: parts.vendor, renderer: parts.renderer });
};

/** The device counts of `enumerateDevices()`. A file may list devices with labels instead; their kinds are counted. */
interface DeviceCounts {
  audio_inputs: number;
  audio_outputs: number;
  video_inputs: number;
}

const deviceKind: Reader<string> = (v) => {
  const rec = objectOf('{ "kind", "device_id", "group_id", "label" }')(v);
  if (!rec.ok) return rec;
  const got = texts(rec.value, ["kind", "device_id", "group_id", "label"]);
  return got.ok ? ok(got.value.kind) : got;
};

const devices: Reader<DeviceCounts> = (v) => {
  const rec = objectOf('{ "audio_inputs": ..., "audio_outputs": ..., "video_inputs": ... }')(v);
  if (!rec.ok) return rec;
  const counts = { audio_inputs: 0, audio_outputs: 0, video_inputs: 0 };
  for (const name of ["audio_inputs", "audio_outputs", "video_inputs"] as const) {
    const got = maybe(rec.value, name, u32);
    if (!got.ok) return got;
    counts[name] = got.value ?? 0;
  }
  const labelled = maybe(rec.value, "labelled", list(deviceKind));
  if (!labelled.ok) return labelled;
  if (labelled.value === undefined || labelled.value.length === 0) return ok(counts);
  // When devices are listed, they are the whole list and the counts are not used.
  const kinds = labelled.value;
  const count = (kind: string): number => kinds.filter((k) => k === kind).length;
  return ok({ audio_inputs: count("audioinput"), audio_outputs: count("audiooutput"), video_inputs: count("videoinput") });
};

const brand: Reader<ProbeBrand> = (v) => {
  const rec = objectOf('{ "brand": ..., "version": ... }')(v);
  if (!rec.ok) return rec;
  const got = texts(rec.value, ["brand", "version"]);
  return got.ok ? ok({ brand: got.value.brand, version: got.value.version }) : got;
};

const hints: Reader<ClientHints> = (v) => {
  const rec = objectOf("the Client Hints object")(v);
  if (!rec.ok) return rec;
  const r = rec.value;
  const brands = member(r, "brands", list(brand));
  if (!brands.ok) return brands;
  const full = member(r, "full_version_list", list(brand));
  if (!full.ok) return full;
  const strings = texts(r, ["platform", "platform_version", "architecture", "bitness", "model", "ua_full_version"]);
  if (!strings.ok) return strings;
  const mobile = member(r, "mobile", flag);
  if (!mobile.ok) return mobile;
  const wow64 = maybe(r, "wow64", flag);
  if (!wow64.ok) return wow64;
  const forms = maybe(r, "form_factors", list(text));
  if (!forms.ok) return forms;
  return ok({
    brands: brands.value,
    full_version_list: full.value,
    ...strings.value,
    mobile: mobile.value,
    wow64: wow64.value ?? false,
    form_factors: forms.value ?? [],
  });
};

const geolocation: Reader<Record<string, unknown>> = (v) => {
  const rec = objectOf('{ "latitude": ..., "longitude": ... }')(v);
  if (!rec.ok) return rec;
  for (const name of ["latitude", "longitude"]) {
    const got = member(rec.value, name, real);
    if (!got.ok) return got;
  }
  for (const name of ["altitude", "accuracy"]) {
    const got = maybe(rec.value, name, real);
    if (!got.ok) return got;
  }
  return rec;
};

const proxy: Reader<Record<string, unknown>> = (v) => {
  const rec = objectOf('{ "type", "host", "port", "save_traffic" }')(v);
  if (!rec.ok) return rec;
  const strings = texts(rec.value, ["type", "host"]);
  if (!strings.ok) return strings;
  if (strings.value.host === "") return fail("`host`: the proxy has no host");
  const port = member(rec.value, "port", u16);
  if (!port.ok) return port;
  const save = member(rec.value, "save_traffic", flag);
  if (!save.ok) return save;
  for (const name of ["username", "password"]) {
    const got = maybe(rec.value, name, text);
    if (!got.ok) return got;
  }
  return rec;
};

const webrtc: Reader<Record<string, unknown>> = (v) => {
  const rec = objectOf('{ "public_ip", "local_ip" }')(v);
  if (!rec.ok) return rec;
  for (const name of ["public_ip", "local_ip"]) {
    const got = maybe(rec.value, name, text);
    if (!got.ok) return got;
  }
  return rec;
};

const battery: Reader<Record<string, unknown>> = (v) => {
  const rec = objectOf('{ "charging", "level", "charging_time", "discharging_time" }')(v);
  if (!rec.ok) return rec;
  const charging = member(rec.value, "charging", flag);
  if (!charging.ok) return charging;
  const level = member(rec.value, "level", real);
  if (!level.ok) return level;
  for (const name of ["charging_time", "discharging_time"]) {
    const got = maybe(rec.value, name, real); // null is an infinite time
    if (!got.ok) return got;
  }
  return rec;
};

const connection: Reader<Record<string, unknown>> = (v) => {
  const rec = objectOf('{ "effective_type", "rtt", "downlink", "save_data" }')(v);
  if (!rec.ok) return rec;
  const type = member(rec.value, "effective_type", text);
  if (!type.ok) return type;
  const rtt = member(rec.value, "rtt", u32);
  if (!rtt.ok) return rtt;
  const downlink = member(rec.value, "downlink", real);
  if (!downlink.ok) return downlink;
  const save = member(rec.value, "save_data", flag);
  return save.ok ? rec : save;
};

const voice: Reader<Record<string, unknown>> = (v) => {
  const rec = objectOf('{ "name", "lang", "default", "local_service", "voice_uri" }')(v);
  if (!rec.ok) return rec;
  const strings = texts(rec.value, ["name", "lang", "voice_uri"]);
  if (!strings.ok) return strings;
  for (const name of ["default", "local_service"]) {
    const got = member(rec.value, name, flag);
    if (!got.ok) return got;
  }
  return rec;
};

const humanize: Reader<Record<string, unknown>> = (v) => {
  const rec = objectOf('{ "enabled", "min_keystroke_delay_ms", "max_keystroke_delay_ms", "mouse_steps" }')(v);
  if (!rec.ok) return rec;
  const enabled = member(rec.value, "enabled", flag);
  if (!enabled.ok) return enabled;
  for (const name of ["min_keystroke_delay_ms", "max_keystroke_delay_ms"]) {
    const got = member(rec.value, name, u64);
    if (!got.ok) return got;
  }
  const steps = member(rec.value, "mouse_steps", u32);
  return steps.ok ? rec : steps;
};

const mapOfText: Reader<Record<string, unknown>> = (v) => {
  const rec = objectOf("an object of text values")(v);
  if (!rec.ok) return rec;
  for (const name of Object.keys(rec.value)) {
    const got = member(rec.value, name, text);
    if (!got.ok) return got;
  }
  return rec;
};

// ---------------------------------------------------------------- what is compared, and how

/** How two values of one setting compare; `same` is false for a difference, and `note` says where. */
interface Outcome {
  same: boolean;
  note?: string;
}

const same = (isSame: boolean, note?: string): Outcome => (note === undefined ? { same: isSame } : { same: isSame, note });

/** A setting in the table of settings. `read` checks the shape and gives the value back typed. */
interface Entry {
  key: string;
  label: string;
  /** A plain field of the Rust `Fingerprint`, not a `Spoof`: a value only, never a word. */
  plain: boolean;
  /** "off" means something for it. */
  off: boolean;
  /** No random value exists for it. */
  noRandom: boolean;
  /** A null is refused (the Rust field is not optional). */
  strict: boolean;
  read: Reader<unknown>;
  show(value: unknown): string;
  /** Null for what a page cannot read. Returns null when the page's value is too partial to judge. */
  compare: ((file: unknown, page: unknown) => Outcome | null) | null;
}

interface Options<T> {
  plain?: boolean;
  off?: boolean;
  noRandom?: boolean;
  strict?: boolean;
  show?: (value: T) => string;
  compare?: (file: T, page: T) => Outcome | null;
}

/** A value as one short line of text. */
function plainShow(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const json = JSON.stringify(value) ?? String(value);
  return json.length > 90 ? `${json.slice(0, 87)}...` : json;
}

function entry<T>(key: string, label: string, read: Reader<T>, options: Options<T> = {}): Entry {
  const show = options.show ?? plainShow;
  const compare = options.compare;
  return {
    key,
    label,
    plain: options.plain ?? false,
    off: options.off ?? false,
    noRandom: options.noRandom ?? false,
    strict: options.strict ?? false,
    read,
    show: (value) => {
      const got = read(value);
      return got.ok ? show(got.value) : plainShow(value);
    },
    compare: compare
      ? (file, page) => {
          const a = read(file);
          const b = read(page);
          return a.ok && b.ok ? compare(a.value, b.value) : null;
        }
      : null,
  };
}

const equal = <T>(a: T, b: T): Outcome => same(a === b);

/** `en-US,en;q=0.9` and `en-US,en` name the same list: the weights are not part of it. */
function tags(value: string): string[] {
  return value
    .split(",")
    .map((part) => (part.split(";")[0] ?? "").trim())
    .filter((tag) => tag !== "");
}
const sameLanguages = (a: string, b: string): Outcome => same(tags(a).join(",") === tags(b).join(","));

const aliases: Record<string, string> = { safari: "mobile_safari", ipados: "ios" };
const named = (a: string, b: string): Outcome => same((aliases[a] ?? a) === (aliases[b] ?? b));

const sameSize = (a: ScreenSize, b: ScreenSize): Outcome => same(a.width === b.width && a.height === b.height);
const showSize = (s: ScreenSize): string => `${s.width} x ${s.height}`;
const close = (a: number, b: number): Outcome => same(Math.abs(a - b) < 1e-6);

function compareGl(file: GlStrings, page: GlStrings): Outcome | null {
  const differing: string[] = [];
  let compared = 0;
  let unseen = 0;
  for (const part of ["vendor", "renderer"] as const) {
    const wanted = file[part];
    if (wanted === undefined) continue; // the file leaves this half to the browser
    const seen = page[part];
    if (seen === undefined) {
      unseen += 1;
      continue;
    }
    compared += 1;
    if (wanted !== seen) differing.push(part);
  }
  if (differing.length > 0) return same(false, `differs in ${differing.join(" and ")}`);
  return unseen > 0 || compared === 0 ? null : same(true);
}
const showGl = (g: GlStrings): string => `vendor ${g.vendor ?? "(the browser's own)"}; renderer ${g.renderer ?? "(the browser's own)"}`;

function compareDevices(file: DeviceCounts, page: DeviceCounts): Outcome {
  const differing = (["audio_inputs", "audio_outputs", "video_inputs"] as const).filter((name) => file[name] !== page[name]);
  return differing.length === 0 ? same(true) : same(false, `differs in ${differing.map((name) => name.replace("_", " ")).join(", ")}`);
}
const showDevices = (d: DeviceCounts): string => `audio in ${d.audio_inputs}, audio out ${d.audio_outputs}, video in ${d.video_inputs}`;

function compareHints(file: ClientHints, page: ClientHints): Outcome {
  const brands = (list: ProbeBrand[]): string => JSON.stringify([...new Set(list.map((b) => `${b.brand} ${b.version}`))].sort());
  const forms = (list: string[]): string => JSON.stringify([...list].sort());
  const parts: [string, string | boolean, string | boolean][] = [
    ["brands", brands(file.brands), brands(page.brands)],
    ["full_version_list", brands(file.full_version_list), brands(page.full_version_list)],
    ["platform", file.platform, page.platform],
    ["platform_version", file.platform_version, page.platform_version],
    ["architecture", file.architecture, page.architecture],
    ["bitness", file.bitness, page.bitness],
    ["model", file.model, page.model],
    ["ua_full_version", file.ua_full_version, page.ua_full_version],
    ["mobile", file.mobile, page.mobile],
    ["wow64", file.wow64, page.wow64],
    ["form_factors", forms(file.form_factors), forms(page.form_factors)],
  ];
  const differing = parts.filter(([, a, b]) => a !== b).map(([name]) => name);
  return differing.length === 0 ? same(true) : same(false, `differs in ${differing.join(", ")}`);
}
const showHints = (h: ClientHints): string =>
  `${h.brands.map((b) => `${b.brand} ${b.version}`).join(", ") || "no brands"}; ${h.platform} ${h.platform_version}; ${h.architecture} ${h.bitness}-bit; ${h.mobile ? "mobile" : "not mobile"}`;

const showProxy = (p: Record<string, unknown>): string => `${plainShow(p.type)}://${plainShow(p.host)}:${plainShow(p.port)} (credentials hidden)`;

const BROWSERS = ["chromium", "firefox", "mobile_safari", "safari"] as const;
const SYSTEMS = ["Windows", "Macos", "Linux", "Android", "ios", "ipados"] as const;

/**
 * The settings, in the order of seleniumbase-rs's `Fingerprint`. A setting with no `compare` is one a page
 * cannot read: the position needs a permission, the fonts need measuring, the proxy and WebRTC addresses are
 * network facts, and the Page tab does not read battery, network information or speech voices.
 */
const ENTRIES: readonly Entry[] = [
  entry("browser_type", "Browser", oneOf(BROWSERS), { plain: true, strict: true, compare: named }),
  entry("os_type", "Operating system", oneOf(SYSTEMS), { plain: true, compare: named }),
  entry("core_version", "Chromium major", u32, { plain: true, compare: equal }),
  entry("user_agent", "User agent", text, { compare: equal }),
  entry("platform", "navigator.platform", text, { compare: equal }),
  entry("hardware_concurrency", "Hardware concurrency", u32, { compare: equal }),
  entry("device_memory", "Device memory (GB)", real, { compare: equal }),
  entry("max_touch_points", "Touch points", u32, { compare: equal }),
  entry("vendor", "navigator.vendor", text, { compare: equal }),
  entry("oscpu", "navigator.oscpu", text, { noRandom: true, compare: equal }),
  entry("product_sub", "navigator.productSub", text, { compare: equal }),
  entry("build_id", "navigator.buildID", text, { noRandom: true, compare: equal }),
  entry("app_version", "navigator.appVersion", text, { compare: equal }),
  entry("locale", "Locale", text, { compare: equal }),
  entry("languages", "navigator.languages", text, { compare: sameLanguages }),
  entry("accept_languages", "Accept-Language", text, { compare: sameLanguages }),
  entry("timezone", "Time zone", text, { compare: equal }),
  entry("screen", "Screen", size, { show: showSize, compare: sameSize }),
  entry("avail_screen", "Available screen", size, { show: showSize, compare: sameSize }),
  entry("pixel_ratio", "Pixel ratio", real, { compare: close }),
  entry("color_depth", "Color depth", u32, { compare: equal }),
  entry("webgl", "WebGL", glStrings, { show: showGl, compare: compareGl }),
  entry("media_devices", "Media devices", devices, { off: true, show: showDevices, compare: compareDevices }),
  entry("geolocation", "Geolocation", geolocation, { off: true }),
  entry("fonts", "Fonts", list(text)),
  entry("proxy", "Proxy", proxy, { noRandom: true, show: showProxy }),
  entry("webrtc", "WebRTC addresses", webrtc, { off: true }),
  entry("battery", "Battery", battery, { off: true }),
  entry("connection", "Network information", connection, { off: true }),
  entry("speech_voices", "Speech voices", list(voice), { off: true }),
  entry("bluetooth", "Web Bluetooth", flag, { off: true }),
  entry("client_hints", "Client Hints", hints, { off: true, show: showHints, compare: compareHints }),
];

/** The fields that are not settings: how the claims are delivered, and the profile's housekeeping. */
const OTHER: ReadonlyMap<string, { read: Reader<unknown>; nullable: boolean }> = new Map([
  ["seed", { read: u64, nullable: true }],
  // The members of the policy all have defaults on the Rust side; they are not checked here.
  ["policy", { read: objectOf("the policy object"), nullable: false }],
  ["humanize", { read: humanize, nullable: false }],
  ["local_storage", { read: flag, nullable: false }],
  ["save_service_worker", { read: flag, nullable: false }],
  ["custom_start_urls", { read: list(text), nullable: false }],
  ["cmd_params", { read: mapOfText, nullable: false }],
]);

/** The flat names of version 1 that a version 2 file does not have, and what replaced each. */
const V1: ReadonlyMap<string, string> = new Map([
  ["flags", "the masking flags are gone: a setting is its value, \"random\" or \"off\", and the delivery is `policy`"],
  ["screen_width", "is now `screen`: { \"width\": ..., \"height\": ... }"],
  ["screen_height", "is now `screen`: { \"width\": ..., \"height\": ... }"],
  ["webgl_vendor", "is now `webgl`: { \"vendor\": ..., \"renderer\": ... }"],
  ["webgl_renderer", "is now `webgl`: { \"vendor\": ..., \"renderer\": ... }"],
  ["audio_inputs", "is now `media_devices`: { \"audio_inputs\": ..., \"audio_outputs\": ..., \"video_inputs\": ... }"],
  ["audio_outputs", "is now `media_devices`: { \"audio_inputs\": ..., \"audio_outputs\": ..., \"video_inputs\": ... }"],
  ["video_inputs", "is now `media_devices`: { \"audio_inputs\": ..., \"audio_outputs\": ..., \"video_inputs\": ... }"],
  ["os_cpu", "is now `oscpu`"],
]);

const BY_KEY: ReadonlyMap<string, Entry> = new Map(ENTRIES.map((e): [string, Entry] => [e.key, e]));

/** The settings that have an off state, for the message that refuses an "off" anywhere else. */
const OFF_SETTINGS = ENTRIES.filter((e) => e.off).map((e) => e.key);

/** How many problems are listed before the rest are counted. */
const MAX_PROBLEMS = 8;

// ---------------------------------------------------------------- reading

function readClaim(e: Entry, raw: unknown): Read<Claim | null> {
  if (raw === null || raw === undefined) return e.strict ? fail("null is refused") : ok(null);
  if (!e.plain && typeof raw === "string") {
    switch (raw.toLowerCase()) {
      case "natural":
        return ok(null);
      case "random":
        return e.noRandom ? fail('"random" is refused: it has no random value') : ok({ kind: "random" });
      case "off":
        return e.off ? ok({ kind: "off" }) : fail(`"off" is refused: only ${OFF_SETTINGS.join(", ")} have an off state`);
      default:
        break;
    }
  }
  const got = e.read(raw);
  return got.ok ? ok({ kind: "value", value: got.value }) : got;
}

/** Reads a parsed JSON value as a version 2 fingerprint. */
export function readFingerprint(json: unknown): Reading {
  if (!isRecord(json)) {
    return { ok: false, problems: [`A fingerprint is one JSON object with an entry per setting, not ${kindOf(json)}.`] };
  }
  const problems: string[] = [];
  const keys = Object.keys(json);

  const old = keys.filter((key) => V1.has(key));
  if (old.length > 0) {
    problems.push(
      `This is the old flat shape of seleniumbase-rs 0.4 and earlier, which 0.5 refuses: ${old
        .map((key) => `\`${key}\` ${V1.get(key) ?? ""}`)
        .join("; ")}.`,
    );
  }
  for (const key of keys) {
    if (!V1.has(key) && !BY_KEY.has(key) && !OTHER.has(key)) {
      problems.push(`Unknown field \`${key}\`: it is not a setting of a seleniumbase-rs 0.5 Fingerprint.`);
    }
  }

  const settings: Setting[] = [];
  for (const e of ENTRIES) {
    if (!Object.hasOwn(json, e.key)) continue;
    const claim = readClaim(e, json[e.key]);
    if (!claim.ok) problems.push(`\`${e.key}\`: ${claim.why}`);
    else if (claim.value !== null) settings.push({ key: e.key, label: e.label, claim: claim.value });
  }

  const other: string[] = [];
  for (const [key, spec] of OTHER) {
    if (!Object.hasOwn(json, key)) continue;
    const raw = json[key];
    if (raw === null && spec.nullable) continue;
    const got = spec.read(raw);
    if (!got.ok) problems.push(`\`${key}\`: ${got.why}`);
    else other.push(key);
  }

  // "random" for the app version is the user agent without its prefix, so it needs a user agent.
  const claims = new Map(settings.map((s): [string, Claim] => [s.key, s.claim]));
  if (claims.get("app_version")?.kind === "random") {
    const agent = claims.get("user_agent");
    if (agent === undefined || (agent.kind !== "value" && agent.kind !== "random")) {
      problems.push('`app_version`: "random" is the user agent without its prefix, and `user_agent` is not set');
    }
  }

  if (problems.length > 0) {
    const shown = problems.slice(0, MAX_PROBLEMS);
    if (problems.length > MAX_PROBLEMS) shown.push(`...and ${problems.length - MAX_PROBLEMS} more.`);
    return { ok: false, problems: shown };
  }
  return { ok: true, fingerprint: { settings, other } };
}

/** Reads the text of a file as a version 2 fingerprint. */
export function readFingerprintText(content: string): Reading {
  const body = content.replace(/^﻿/, "");
  if (body.trim() === "") return { ok: false, problems: ["The file is empty."] };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (error) {
    return { ok: false, problems: [`The file is not valid JSON (${errorText(error)}).`] };
  }
  return readFingerprint(json);
}

/** Reads a file the person picked. It stays in the browser: nothing is sent anywhere. */
export async function readFingerprintFile(file: Blob): Promise<Reading> {
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, problems: [`The file is ${file.size} bytes. A fingerprint is a few kilobytes; the limit here is ${MAX_FILE_BYTES}.`] };
  }
  let content: string;
  try {
    content = await file.text();
  } catch (error) {
    return { ok: false, problems: [`The file could not be read (${errorText(error)}).`] };
  }
  return readFingerprintText(content);
}

// ---------------------------------------------------------------- comparing

function claimText(e: Entry, claim: Claim | undefined): string {
  if (claim === undefined) return "n/a";
  return claim.kind === "value" ? e.show(claim.value) : claim.kind;
}

function judge(e: Entry, file: Claim, page: Claim | undefined): { verdict: Verdict; note: string } {
  const undecided = (note: string) => ({ verdict: "not observable" as const, note });
  if (file.kind === "random") return undecided("random: a value is drawn when the fingerprint is built");
  if (page === undefined) return undecided(e.compare === null ? "a page cannot read this" : "this page does not tell");
  if (file.kind === "off") {
    if (page.kind === "off") return { verdict: "match", note: "" };
    return page.kind === "value" ? { verdict: "differs", note: "the file turns it off; the page has it" } : undecided("");
  }
  if (page.kind === "off") return { verdict: "differs", note: "the page does not have it" };
  if (page.kind !== "value" || e.compare === null) return undecided("");
  const outcome = e.compare(file.value, page.value);
  if (outcome === null) return undecided("the page did not give all of it");
  return { verdict: outcome.same ? "match" : "differs", note: outcome.note ?? "" };
}

/**
 * Lines up the settings a file claims with what the page reported (both read by `readFingerprint`). A setting
 * the file leaves natural is not a row: the file says nothing about it.
 */
export function compareFingerprints(file: FingerprintFile, page: FingerprintFile): Comparison {
  const pageClaims = new Map(page.settings.map((s): [string, Claim] => [s.key, s.claim]));
  const counts: Record<Verdict, number> = { match: 0, differs: 0, "not observable": 0 };
  const rows: Row[] = [];
  for (const setting of file.settings) {
    const e = BY_KEY.get(setting.key);
    if (!e) continue;
    const pageClaim = pageClaims.get(setting.key);
    const { verdict, note } = judge(e, setting.claim, pageClaim);
    counts[verdict] += 1;
    rows.push({
      key: setting.key,
      label: setting.label,
      file: claimText(e, setting.claim),
      page: claimText(e, pageClaim),
      verdict,
      note,
    });
  }
  return { rows, counts, other: file.other };
}
