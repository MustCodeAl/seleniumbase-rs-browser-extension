// "What this page sees" as a seleniumbase-rs `Fingerprint`
// (src/stealth/fingerprint.rs). Only fields that match a Fingerprint field are
// written, under the Rust field names; a value the browser did not give is left
// out, never null, so the JSON deserialises into a Fingerprint as it is.

// ---------------------------------------------------------------- what a page gives

// `probePage` (inspector/probe.ts) reads these in the page. A value the page could
// not give is null; the fields are optional so that a report from another
// browser, or a test, may leave some out.

export interface ProbeNavigator {
  webdriver?: boolean | null;
  userAgent?: string | null;
  language?: string | null;
  languages?: string[] | null;
  platform?: string | null;
  vendor?: string | null;
  productSub?: string | null;
  appVersion?: string | null;
  hardwareConcurrency?: number | null;
  deviceMemory?: number | null;
  maxTouchPoints?: number | null;
  cookieEnabled?: boolean | null;
  doNotTrack?: string | null;
  pdfViewerEnabled?: boolean | null;
  pluginsCount?: number | null;
  pluginNames?: string[] | null;
  mimeTypesCount?: number | null;
  oscpu?: string | null;
  buildID?: string | null;
}

export interface ProbeBrand {
  brand: string;
  version: string;
}

export interface ProbeHighEntropy {
  architecture?: string | undefined;
  bitness?: string | undefined;
  model?: string | undefined;
  platformVersion?: string | undefined;
  uaFullVersion?: string | undefined;
  fullVersionList?: ProbeBrand[] | undefined;
  wow64?: boolean | undefined;
  formFactors?: string[] | undefined;
}

export interface ProbeUserAgentData {
  brands?: ProbeBrand[];
  mobile?: boolean;
  platform?: string;
  high?: ProbeHighEntropy | null;
}

export interface ProbeScreen {
  width?: number;
  height?: number;
  availWidth?: number;
  availHeight?: number;
  colorDepth?: number;
  pixelDepth?: number;
}

export interface ProbeWindow {
  innerWidth?: number;
  innerHeight?: number;
  outerWidth?: number;
  outerHeight?: number;
  screenX?: number;
  screenY?: number;
}

export interface ProbeTimezone {
  name?: string;
  offsetMinutes?: number;
  locale?: string;
}

export interface ProbeWebGl {
  vendor?: string | null;
  renderer?: string | null;
  version?: string | null;
  unmaskedVendor?: string | null;
  unmaskedRenderer?: string | null;
  webgl2?: boolean;
}

export interface ProbeCanvas {
  hash: string;
  algorithm: string;
}

export interface ProbeMedia {
  audioinput?: number;
  audiooutput?: number;
  videoinput?: number;
}

export interface ProbeHeadless {
  markers: string[];
  likely: boolean;
}

/** What a page sees of itself: the report of `probePage`. */
export interface PageProbe {
  navigator?: ProbeNavigator | null;
  userAgentData?: ProbeUserAgentData | null;
  screen?: ProbeScreen | null;
  devicePixelRatio?: number | null;
  window?: ProbeWindow | null;
  timezone?: ProbeTimezone | null;
  webgl?: ProbeWebGl | null;
  canvas?: ProbeCanvas | null;
  permissions?: Record<string, string | null>;
  notificationPermission?: string | null;
  media?: ProbeMedia | null;
  headless?: ProbeHeadless;
  url?: string | null;
}

// ---------------------------------------------------------------- what Rust reads

export interface ClientHints {
  brands: ProbeBrand[];
  full_version_list: ProbeBrand[];
  platform: string;
  platform_version: string;
  architecture: string;
  bitness: string;
  model: string;
  ua_full_version: string;
  mobile: boolean;
  wow64: boolean;
  form_factors: string[];
}

/** The fields of seleniumbase-rs's `Fingerprint` that a browser can answer, under the Rust names. */
export interface Fingerprint {
  browser_type?: string;
  os_type?: string;
  core_version?: number;
  user_agent?: string;
  platform?: string;
  hardware_concurrency?: number;
  device_memory?: number;
  max_touch_points?: number;
  vendor?: string;
  oscpu?: string;
  product_sub?: string;
  build_id?: string;
  app_version?: string;
  locale?: string;
  languages?: string;
  accept_languages?: string;
  timezone?: string;
  screen_width?: number;
  screen_height?: number;
  pixel_ratio?: number;
  color_depth?: number;
  webgl_vendor?: string;
  webgl_renderer?: string;
  audio_inputs?: number;
  audio_outputs?: number;
  video_inputs?: number;
  client_hints?: ClientHints;
}

/** `["fr-FR", "fr", "en"]` as `fr-FR,fr;q=0.9,en;q=0.8`. */
export function acceptLanguages(languages: string[] | null | undefined): string | undefined {
  if (!Array.isArray(languages) || languages.length === 0) return undefined;
  return languages
    .map((tag, index) => (index === 0 ? tag : `${tag};q=${(1 - index / 10).toFixed(1)}`))
    .join(",");
}

/** Sets `target[key]` unless the browser gave nothing: no null, no NaN, no empty text. */
function put<K extends keyof Fingerprint>(target: Fingerprint, key: K, value: Fingerprint[K] | null): void {
  if (value === undefined || value === null) return;
  if (typeof value === "number" && Number.isNaN(value)) return;
  if (typeof value === "string" && value === "") return;
  target[key] = value;
}

function browserType(ua: string): string {
  if (/Firefox\//.test(ua)) return "firefox";
  if (/(iPhone|iPad)/.test(ua) && /Safari\//.test(ua) && !/(CriOS|FxiOS|EdgiOS)/.test(ua)) return "mobile_safari";
  return "chromium";
}

function osType(probe: PageProbe): string | undefined {
  const ua = probe.navigator?.userAgent ?? "";
  const hint = probe.userAgentData?.platform ?? "";
  const platform = probe.navigator?.platform ?? "";
  const text = `${hint} ${platform} ${ua}`;
  if (/(iPhone|iPad|iPod)/.test(text)) return "ios";
  if (/Android/.test(text)) return "Android";
  if (/(Mac|macOS)/i.test(text)) return "Macos";
  if (/Win/i.test(text)) return "Windows";
  if (/(Linux|X11|CrOS|Chrome OS)/i.test(text)) return "Linux";
  return undefined;
}

function coreVersion(ua: string): number | undefined {
  const match = /(?:Chrome|Firefox|Version)\/(\d+)/.exec(ua);
  return match ? Number(match[1]) : undefined;
}

function brandList(list: ProbeBrand[] | undefined): ProbeBrand[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return list.map((b) => ({ brand: String(b.brand), version: String(b.version) }));
}

function clientHints(data: ProbeUserAgentData | null | undefined): ClientHints | undefined {
  if (!data) return undefined;
  const high = data.high ?? {};
  const hints = {
    brands: brandList(data.brands) ?? [],
    full_version_list: brandList(high.fullVersionList) ?? [],
    platform: data.platform ?? "",
    platform_version: high.platformVersion ?? "",
    architecture: high.architecture ?? "",
    bitness: high.bitness ?? "",
    model: high.model ?? "",
    ua_full_version: high.uaFullVersion ?? "",
    mobile: Boolean(data.mobile),
    wow64: Boolean(high.wow64),
    form_factors: Array.isArray(high.formFactors) ? high.formFactors : [],
  };
  return hints;
}

/** A `Fingerprint`-shaped object from a page probe (see inspector/probe.ts). */
export function toFingerprint(probe: PageProbe): Fingerprint {
  const nav: ProbeNavigator = probe.navigator ?? {};
  const ua = nav.userAgent ?? "";
  const fp: Fingerprint = {};
  if (ua !== "") {
    put(fp, "browser_type", browserType(ua));
  }
  put(fp, "os_type", osType(probe));
  put(fp, "core_version", coreVersion(ua));
  put(fp, "user_agent", ua);
  put(fp, "platform", nav.platform);
  put(fp, "hardware_concurrency", nav.hardwareConcurrency);
  put(fp, "device_memory", nav.deviceMemory);
  put(fp, "max_touch_points", nav.maxTouchPoints);
  put(fp, "vendor", nav.vendor);
  put(fp, "oscpu", nav.oscpu);
  put(fp, "product_sub", nav.productSub);
  put(fp, "build_id", nav.buildID);
  put(fp, "app_version", nav.appVersion);
  put(fp, "locale", nav.language);
  const languages = acceptLanguages(nav.languages);
  put(fp, "languages", languages);
  put(fp, "accept_languages", languages);
  put(fp, "timezone", probe.timezone?.name);
  put(fp, "screen_width", probe.screen?.width);
  put(fp, "screen_height", probe.screen?.height);
  put(fp, "pixel_ratio", probe.devicePixelRatio);
  put(fp, "color_depth", probe.screen?.colorDepth);
  const gl = probe.webgl;
  put(fp, "webgl_vendor", gl?.unmaskedVendor ?? gl?.vendor);
  put(fp, "webgl_renderer", gl?.unmaskedRenderer ?? gl?.renderer);
  put(fp, "audio_inputs", probe.media?.audioinput);
  put(fp, "audio_outputs", probe.media?.audiooutput);
  put(fp, "video_inputs", probe.media?.videoinput);
  const hints = clientHints(probe.userAgentData);
  if (hints) fp.client_hints = hints;
  return fp;
}
