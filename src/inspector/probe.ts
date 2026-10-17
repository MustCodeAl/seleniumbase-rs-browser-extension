// "What this page sees." `probePage` runs in the PAGE's own world (the
// background passes it to scripting.executeScript with world: "MAIN"), because
// the point is what the page's scripts see, including anything a stealth layer or
// an automation framework changed. It is serialised as source text, so it must
// be one self-contained function: no imports, no helpers outside it.
//
// It never throws: each probe is wrapped, and a failed one is null. It reads
// only values a page can read without asking the person (no camera, microphone
// or location prompt, no device labels).

import type {
  PageProbe,
  ProbeHeadless,
  ProbeHighEntropy,
  ProbeNavigator,
  ProbeUserAgentData,
  ProbeWebGl,
} from "../shared/fingerprint.ts";

/** Members of `navigator` that only some browsers have, and lib.dom does not declare. */
interface NavigatorExtras {
  deviceMemory?: number;
  oscpu?: string;
  buildID?: string;
  userAgentData?: {
    brands: readonly { brand: string; version: string }[];
    mobile: boolean;
    platform: string;
    getHighEntropyValues(hints: string[]): Promise<ProbeHighEntropy>;
  };
}

/** What `probePage` returns: a page probe that always has the navigator and the headless verdict. */
export type ProbeReport = PageProbe & { navigator: ProbeNavigator; headless: ProbeHeadless };

export async function probePage(): Promise<ProbeReport> {
  function safe<T>(read: () => T): Exclude<T, undefined> | null;
  function safe<T>(read: () => T, fallback: Exclude<T, undefined>): Exclude<T, undefined>;
  function safe<T>(read: () => T, fallback: Exclude<T, undefined> | null = null): Exclude<T, undefined> | null {
    try {
      const value = read();
      return value === undefined ? fallback : (value as Exclude<T, undefined>);
    } catch {
      return fallback;
    }
  }
  const asafe = async <T>(read: () => Promise<T>): Promise<Exclude<T, undefined> | null> => {
    try {
      const value = await read();
      return value === undefined ? null : (value as Exclude<T, undefined>);
    } catch {
      return null;
    }
  };
  const within = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

  const nav = navigator as Navigator & NavigatorExtras;

  const navigatorInfo: ProbeNavigator = {
    webdriver: safe(() => nav.webdriver),
    userAgent: safe(() => nav.userAgent),
    language: safe(() => nav.language),
    languages: safe(() => Array.from(nav.languages)),
    platform: safe(() => nav.platform),
    vendor: safe(() => nav.vendor),
    productSub: safe(() => nav.productSub),
    appVersion: safe(() => nav.appVersion),
    hardwareConcurrency: safe(() => nav.hardwareConcurrency),
    deviceMemory: safe(() => nav.deviceMemory),
    maxTouchPoints: safe(() => nav.maxTouchPoints),
    cookieEnabled: safe(() => nav.cookieEnabled),
    doNotTrack: safe(() => nav.doNotTrack),
    pdfViewerEnabled: safe(() => nav.pdfViewerEnabled),
    pluginsCount: safe(() => nav.plugins.length),
    pluginNames: safe(() => Array.from(nav.plugins, (p) => p.name).slice(0, 8)),
    mimeTypesCount: safe(() => nav.mimeTypes.length),
    oscpu: safe(() => nav.oscpu),
    buildID: safe(() => nav.buildID),
  };

  const userAgentData = await asafe(async () => {
    const data = nav.userAgentData;
    if (!data) return null;
    const out: ProbeUserAgentData = {
      brands: Array.from(data.brands, (b) => ({ brand: b.brand, version: b.version })),
      mobile: data.mobile,
      platform: data.platform,
      high: null,
    };
    const high = await within(
      data.getHighEntropyValues([
        "architecture",
        "bitness",
        "model",
        "platformVersion",
        "uaFullVersion",
        "fullVersionList",
        "wow64",
        "formFactors",
      ]),
      1500,
    );
    if (high) {
      out.high = {
        architecture: high.architecture,
        bitness: high.bitness,
        model: high.model,
        platformVersion: high.platformVersion,
        uaFullVersion: high.uaFullVersion,
        fullVersionList: Array.isArray(high.fullVersionList)
          ? high.fullVersionList.map((b) => ({ brand: b.brand, version: b.version }))
          : undefined,
        wow64: high.wow64,
        formFactors: high.formFactors,
      };
    }
    return out;
  });

  const screenInfo = safe(() => ({
    width: screen.width,
    height: screen.height,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
    colorDepth: screen.colorDepth,
    pixelDepth: screen.pixelDepth,
  }));
  const devicePixelRatio = safe(() => window.devicePixelRatio);
  const windowInfo = safe(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    screenX: window.screenX,
    screenY: window.screenY,
  }));
  const timezone = safe(() => ({
    name: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offsetMinutes: new Date().getTimezoneOffset(),
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
  }));

  const webgl = safe((): ProbeWebGl | null => {
    const canvas = document.createElement("canvas");
    // The legacy context name answers with the same kind of context.
    const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      webgl2: Boolean(document.createElement("canvas").getContext("webgl2")),
    };
  });

  const canvasInfo = await asafe(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.textBaseline = "top";
    ctx.font = "16px Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(10, 8, 90, 30);
    ctx.fillStyle = "#069";
    ctx.fillText("seleniumbase-rs, éè ☃", 4, 14);
    ctx.strokeStyle = "rgba(102, 204, 0, 0.7)";
    ctx.beginPath();
    ctx.arc(180, 30, 20, 0, Math.PI * 2);
    ctx.stroke();
    const data = canvas.toDataURL();
    if (globalThis.crypto && crypto.subtle && typeof crypto.subtle.digest === "function") {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
      const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      return { hash: hex.slice(0, 32), algorithm: "sha-256" };
    }
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      hash ^= data.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return { hash: hash.toString(16).padStart(8, "0"), algorithm: "fnv1a" };
  });

  const permissionNames = ["notifications", "geolocation", "camera", "microphone", "clipboard-read", "persistent-storage"];
  const states: Record<string, string | null> = {};
  if (nav.permissions && typeof nav.permissions.query === "function") {
    for (const name of permissionNames) {
      states[name] = await asafe(async () => {
        // Browsers answer for more names than lib.dom lists.
        const status = await within(nav.permissions.query({ name } as PermissionDescriptor), 800);
        return status ? status.state : null;
      });
    }
  }
  const notificationPermission = safe(() => Notification.permission);

  const counts = { audioinput: 0, audiooutput: 0, videoinput: 0 };
  const devices = await asafe(async () =>
    nav.mediaDevices ? await within(nav.mediaDevices.enumerateDevices(), 1500) : null,
  );
  if (devices) {
    for (const device of devices) if (device.kind in counts) counts[device.kind] += 1;
  }
  const media = devices ? counts : null;

  const ua = navigatorInfo.userAgent || "";
  const markers = [];
  if (/HeadlessChrome/.test(ua)) markers.push("ua_headless");
  if (navigatorInfo.webdriver === true) markers.push("webdriver_true");
  if (/Chrome\//.test(ua) && !safe(() => window.chrome)) markers.push("no_window_chrome");
  if (/Chrome\//.test(ua) && navigatorInfo.pluginsCount === 0) markers.push("no_plugins");
  if (Array.isArray(navigatorInfo.languages) && navigatorInfo.languages.length === 0) markers.push("no_languages");
  if (windowInfo && windowInfo.outerWidth === 0 && windowInfo.outerHeight === 0) markers.push("zero_outer_size");
  if (notificationPermission === "denied" && states.notifications === "prompt") {
    markers.push("notification_permission_mismatch");
  }
  const renderer = (webgl && (webgl.unmaskedRenderer || webgl.renderer)) || "";
  if (/SwiftShader|llvmpipe|Software Renderer/i.test(renderer)) markers.push("software_webgl");
  const globals = safe(() =>
    Object.keys(window).filter((k) => /^\$?cdc_|^__(webdriver|selenium|driver)|^_Selenium_IDE_Recorder$|^callPhantom$|^__nightmare$/i.test(k)),
    [],
  );
  if (globals.length > 0) markers.push("automation_globals");
  const strong = ["ua_headless", "webdriver_true", "zero_outer_size", "notification_permission_mismatch", "automation_globals"];
  return {
    navigator: navigatorInfo,
    userAgentData,
    screen: screenInfo,
    devicePixelRatio,
    window: windowInfo,
    timezone,
    webgl,
    canvas: canvasInfo,
    permissions: states,
    notificationPermission,
    media,
    headless: { markers, likely: markers.some((m) => strong.includes(m)) },
    url: safe(() => location.href),
  };
}
