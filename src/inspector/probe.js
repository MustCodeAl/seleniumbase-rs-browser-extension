// "What this page sees." `probePage` runs in the PAGE's own world (the
// background passes it to scripting.executeScript with world: "MAIN"), because
// the point is what the page's scripts see, including anything a stealth layer or
// an automation framework changed. It is serialised as source text, so it must
// be one self-contained function: no imports, no helpers outside it.
//
// It never throws: each probe is wrapped, and a failed one is null. It reads
// only values a page can read without asking the person (no camera, microphone
// or location prompt, no device labels).

export async function probePage() {
  const safe = (read, fallback = null) => {
    try {
      const value = read();
      return value === undefined ? fallback : value;
    } catch {
      return fallback;
    }
  };
  const asafe = async (read, fallback = null) => {
    try {
      const value = await read();
      return value === undefined ? fallback : value;
    } catch {
      return fallback;
    }
  };
  const within = (promise, ms) =>
    Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

  const nav = navigator;
  const result = {};

  result.navigator = {
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

  result.userAgentData = await asafe(async () => {
    const data = nav.userAgentData;
    if (!data) return null;
    const out = {
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

  result.screen = safe(() => ({
    width: screen.width,
    height: screen.height,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
    colorDepth: screen.colorDepth,
    pixelDepth: screen.pixelDepth,
  }));
  result.devicePixelRatio = safe(() => window.devicePixelRatio);
  result.window = safe(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    screenX: window.screenX,
    screenY: window.screenY,
  }));
  result.timezone = safe(() => ({
    name: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offsetMinutes: new Date().getTimezoneOffset(),
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
  }));

  result.webgl = safe(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return null;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      webgl2: Boolean(canvas.getContext && document.createElement("canvas").getContext("webgl2")),
    };
  });

  result.canvas = await asafe(async () => {
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
  const states = {};
  if (nav.permissions && typeof nav.permissions.query === "function") {
    for (const name of permissionNames) {
      states[name] = await asafe(async () => {
        const status = await within(nav.permissions.query({ name }), 800);
        return status ? status.state : null;
      });
    }
  }
  result.permissions = states;
  result.notificationPermission = safe(() => Notification.permission);

  const media = { audioinput: 0, audiooutput: 0, videoinput: 0 };
  const devices = await asafe(async () =>
    nav.mediaDevices ? await within(nav.mediaDevices.enumerateDevices(), 1500) : null,
  );
  if (devices) {
    for (const device of devices) if (device.kind in media) media[device.kind] += 1;
    result.media = media;
  } else {
    result.media = null;
  }

  const ua = result.navigator.userAgent || "";
  const markers = [];
  if (/HeadlessChrome/.test(ua)) markers.push("ua_headless");
  if (result.navigator.webdriver === true) markers.push("webdriver_true");
  if (/Chrome\//.test(ua) && !safe(() => window.chrome)) markers.push("no_window_chrome");
  if (/Chrome\//.test(ua) && result.navigator.pluginsCount === 0) markers.push("no_plugins");
  if (Array.isArray(result.navigator.languages) && result.navigator.languages.length === 0) markers.push("no_languages");
  if (result.window && result.window.outerWidth === 0 && result.window.outerHeight === 0) markers.push("zero_outer_size");
  if (result.notificationPermission === "denied" && states.notifications === "prompt") {
    markers.push("notification_permission_mismatch");
  }
  const renderer = (result.webgl && (result.webgl.unmaskedRenderer || result.webgl.renderer)) || "";
  if (/SwiftShader|llvmpipe|Software Renderer/i.test(renderer)) markers.push("software_webgl");
  const globals = safe(() =>
    Object.keys(window).filter((k) => /^\$?cdc_|^__(webdriver|selenium|driver)|^_Selenium_IDE_Recorder$|^callPhantom$|^__nightmare$/i.test(k)),
    [],
  );
  if (globals.length > 0) markers.push("automation_globals");
  const strong = ["ua_headless", "webdriver_true", "zero_outer_size", "notification_permission_mismatch", "automation_globals"];
  result.headless = { markers, likely: markers.some((m) => strong.includes(m)) };
  result.url = safe(() => location.href);
  return result;
}
