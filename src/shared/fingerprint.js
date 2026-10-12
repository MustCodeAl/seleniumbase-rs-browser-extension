// "What this page sees" as a seleniumbase-rs `Fingerprint`
// (src/stealth/fingerprint.rs). Only fields that match a Fingerprint field are
// written, under the Rust field names; a value the browser did not give is left
// out, never null, so the JSON deserialises into a Fingerprint as it is.

/** `["fr-FR", "fr", "en"]` as `fr-FR,fr;q=0.9,en;q=0.8`. */
export function acceptLanguages(languages) {
  if (!Array.isArray(languages) || languages.length === 0) return undefined;
  return languages
    .map((tag, index) => (index === 0 ? tag : `${tag};q=${(1 - index / 10).toFixed(1)}`))
    .join(",");
}

function put(target, key, value) {
  if (value === undefined || value === null) return;
  if (typeof value === "number" && Number.isNaN(value)) return;
  if (typeof value === "string" && value === "" && key !== "model") return;
  target[key] = value;
}

function browserType(ua) {
  if (/Firefox\//.test(ua)) return "firefox";
  if (/(iPhone|iPad)/.test(ua) && /Safari\//.test(ua) && !/(CriOS|FxiOS|EdgiOS)/.test(ua)) return "mobile_safari";
  return "chromium";
}

function osType(probe) {
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

function coreVersion(ua) {
  const match = /(?:Chrome|Firefox|Version)\/(\d+)/.exec(ua);
  return match ? Number(match[1]) : undefined;
}

function brandList(list) {
  if (!Array.isArray(list)) return undefined;
  return list.map((b) => ({ brand: String(b.brand), version: String(b.version) }));
}

function clientHints(data) {
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

/**
 * A `Fingerprint`-shaped object from a page probe (see inspector/probe.js).
 * @param {object} probe
 */
export function toFingerprint(probe) {
  const nav = probe.navigator ?? {};
  const ua = nav.userAgent ?? "";
  const fp = {};
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
