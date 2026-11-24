// Anti-bot and fingerprint leak diagnostics.
// Aligns 1:1 with the `antibot-detector` standalone plugin crate (plugins/antibot-detector).
// Evaluates client-side leaks (navigator.webdriver, window.cdc_*, WebGL, Canvas noise)
// and detects 10+ anti-bot & challenge platforms:
// Cloudflare, DataDome, Akamai, Kasada, PerimeterX, Imperva, AWS WAF, FingerprintJS, reCAPTCHA, hCaptcha.

export type DiagnosticStatus = "pass" | "warn" | "fail" | "info";

export type BotProtectionKind =
  | "Cloudflare"
  | "DataDome"
  | "Akamai"
  | "Kasada"
  | "PerimeterX"
  | "Imperva"
  | "AwsWaf"
  | "FingerprintJs"
  | "ReCaptcha"
  | "HCaptcha";

export type ProtectionCategory =
  | "Bot Management"
  | "Captcha"
  | "WAF"
  | "Fingerprinting"
  | "Waiting Room";

export interface BotProtectionResult {
  provider: BotProtectionKind;
  category: ProtectionCategory;
  confidence: number;
  isBlocked: boolean;
  description: string;
  signals: string[];
  mitigation: string;
}

export interface DiagnosticItem {
  id: string;
  name: string;
  category: "automation" | "fingerprint" | "challenge" | "graphics";
  status: DiagnosticStatus;
  headline: string;
  detail: string;
  recommendation?: string;
}

export interface AntiBotProbeData {
  webdriver: {
    flag: boolean | null;
    overridden: boolean;
    nativeGetter: boolean;
  };
  cdpFlags: {
    windowFlags: string[];
    documentFlags: string[];
    runtimeArtifacts: string[];
  };
  webgl: {
    vendor: string | null;
    renderer: string | null;
    unmaskedVendor: string | null;
    unmaskedRenderer: string | null;
    isSoftware: boolean;
    isTampered: boolean;
  };
  canvas: {
    noiseDetected: boolean;
    isTampered: boolean;
    hash1?: string;
    hash2?: string;
  };
  turnstile: {
    detected: boolean;
    iframes: number;
    widgetSelectors: string[];
    apiPresent: boolean;
  };
  pageSignals?: {
    cookies: string;
    scripts: string[];
    iframes: string[];
    htmlSnippet: string;
  };
}

export interface AntiBotSummary {
  score: number; // 0 to 100 (100 is completely clean / stealthy)
  totalChecks: number;
  passedChecks: number;
  leaksDetected: number;
  protectionsDetected: BotProtectionResult[];
  items: DiagnosticItem[];
}

/**
 * Detects anti-bot protection systems matching the rules in `antibot-detector` plugin.
 */
export function detectProtections(page: {
  cookies: string;
  scripts: string[];
  iframes: string[];
  htmlSnippet: string;
}): BotProtectionResult[] {
  const results: BotProtectionResult[] = [];
  const cookiesLower = page.cookies.toLowerCase();
  const htmlLower = page.htmlSnippet.toLowerCase();
  const scriptsLower = page.scripts.map((s) => s.toLowerCase());
  const iframesLower = page.iframes.map((f) => f.toLowerCase());

  // 1. Cloudflare (Turnstile, Challenge, Waiting Room, WAF)
  const cfSignals: string[] = [];
  let cfBlocked = false;
  let cfCategory: ProtectionCategory = "Bot Management";

  if (cookiesLower.includes("cf_clearance")) cfSignals.push("cookie: cf_clearance");
  if (cookiesLower.includes("__cf_bm")) cfSignals.push("cookie: __cf_bm");
  if (cookiesLower.includes("__cfwaitingroom")) {
    cfSignals.push("cookie: __cfwaitingroom");
    cfBlocked = true;
    cfCategory = "Waiting Room";
  }
  if (iframesLower.some((f) => f.includes("challenges.cloudflare.com/turnstile") || f.includes("challenges.cloudflare.com/cdn-cgi/challenge-platform"))) {
    cfSignals.push("iframe: challenges.cloudflare.com/turnstile");
    cfBlocked = true;
    cfCategory = "Captcha";
  }
  if (htmlLower.includes("cf-turnstile") || htmlLower.includes("name=\"cf-turnstile-response\"")) {
    cfSignals.push("dom: .cf-turnstile container");
    cfCategory = "Captcha";
  }
  if (scriptsLower.some((s) => s.includes("turnstile/v0/api.js") || s.includes("challenges.cloudflare.com"))) {
    cfSignals.push("script: turnstile API script");
  }
  if (htmlLower.includes("cf-challenge-running") || htmlLower.includes("cf-browser-verification") || htmlLower.includes("checking your browser before accessing")) {
    cfSignals.push("marker: Cloudflare browser challenge page");
    cfBlocked = true;
  }
  if (cfSignals.length > 0) {
    results.push({
      provider: "Cloudflare",
      category: cfCategory,
      confidence: Math.min(100, 75 + cfSignals.length * 10),
      isBlocked: cfBlocked,
      description: `Cloudflare protection detected (${cfSignals.join(", ")}).`,
      signals: cfSignals,
      mitigation: "Use seleniumbase-rs stealth mode or `uc_gui_click_captcha()` / pure CDP `page.turnstile_solver()`.",
    });
  }

  // 2. DataDome
  const ddSignals: string[] = [];
  let ddBlocked = false;
  if (cookiesLower.includes("datadome=")) ddSignals.push("cookie: datadome");
  if (iframesLower.some((f) => f.includes("captcha-delivery.com") || f.includes("geo.captcha-delivery.com"))) {
    ddSignals.push("iframe: geo.captcha-delivery.com");
    ddBlocked = true;
  }
  if (scriptsLower.some((s) => s.includes("js.datadome.co") || s.includes("api-js.datadome.co"))) {
    ddSignals.push("script: js.datadome.co/tags.js");
  }
  if (ddSignals.length > 0) {
    results.push({
      provider: "DataDome",
      category: ddBlocked ? "Captcha" : "Bot Management",
      confidence: 95,
      isBlocked: ddBlocked,
      description: `DataDome bot protection detected (${ddSignals.join(", ")}).`,
      signals: ddSignals,
      mitigation: "Avoid repetitive IP bursts and emulate natural human pointer curves with `seleniumbase_rs::evasion::humanize`.",
    });
  }

  // 3. Akamai Bot Manager
  const akamaiSignals: string[] = [];
  if (cookiesLower.includes("_abck=")) akamaiSignals.push("cookie: _abck sensor");
  if (cookiesLower.includes("bm_sz=")) akamaiSignals.push("cookie: bm_sz telemetry");
  if (scriptsLower.some((s) => s.includes("/akam/13/") || s.includes("bazadebezolkohpepadr"))) {
    akamaiSignals.push("script: Akamai sensor script");
  }
  if (akamaiSignals.length > 0) {
    results.push({
      provider: "Akamai",
      category: "Bot Management",
      confidence: 95,
      isBlocked: false,
      description: `Akamai Bot Manager sensor detected (${akamaiSignals.join(", ")}).`,
      signals: akamaiSignals,
      mitigation: "Keep consistent TLS fingerprints and avoid rapid background navigations.",
    });
  }

  // 4. Kasada
  const kasadaSignals: string[] = [];
  if (htmlLower.includes("149e9513") || scriptsLower.some((s) => s.includes("ips.js") || s.includes("149e9513") || s.includes("kpsdk"))) {
    kasadaSignals.push("script: Kasada ips.js / 149e9513 signature hash");
  }
  if (cookiesLower.includes("kpsdk")) {
    kasadaSignals.push("cookie: KPSDK token");
  }
  if (kasadaSignals.length > 0) {
    results.push({
      provider: "Kasada",
      category: "Bot Management",
      confidence: 95,
      isBlocked: false,
      description: `Kasada Bot Protection detected (${kasadaSignals.join(", ")}).`,
      signals: kasadaSignals,
      mitigation: "Requires advanced CDP evasion and accurate hardware telemetry emulation.",
    });
  }

  // 5. PerimeterX / HUMAN Security
  const pxSignals: string[] = [];
  let pxBlocked = false;
  if (cookiesLower.includes("_px3=") || cookiesLower.includes("_px2=") || cookiesLower.includes("_px=")) {
    pxSignals.push("cookie: _px token");
  }
  if (scriptsLower.some((s) => s.includes("client.perimeterx.net") || s.includes("captcha.perimeterx.net"))) {
    pxSignals.push("script: PerimeterX sensor");
  }
  if (htmlLower.includes("px-captcha")) {
    pxSignals.push("dom: px-captcha container");
    pxBlocked = true;
  }
  if (pxSignals.length > 0) {
    results.push({
      provider: "PerimeterX",
      category: pxBlocked ? "Captcha" : "Bot Management",
      confidence: 95,
      isBlocked: pxBlocked,
      description: `PerimeterX / HUMAN Security detected (${pxSignals.join(", ")}).`,
      signals: pxSignals,
      mitigation: "Ensure realistic mouse micro-movements and disable Blink automation flags.",
    });
  }

  // 6. Imperva / Incapsula
  const impervaSignals: string[] = [];
  if (cookiesLower.includes("visid_incap") || cookiesLower.includes("incap_ses")) {
    impervaSignals.push("cookie: Incapsula session token");
  }
  if (scriptsLower.some((s) => s.includes("/_incapsula_resource"))) {
    impervaSignals.push("script: /_Incapsula_Resource loader");
  }
  if (impervaSignals.length > 0) {
    results.push({
      provider: "Imperva",
      category: "WAF",
      confidence: 95,
      isBlocked: false,
      description: `Imperva / Incapsula protection detected (${impervaSignals.join(", ")}).`,
      signals: impervaSignals,
      mitigation: "Maintain session cookie persistence across requests.",
    });
  }

  // 7. AWS WAF
  const awsSignals: string[] = [];
  if (cookiesLower.includes("aws-waf-token")) awsSignals.push("cookie: aws-waf-token");
  if (scriptsLower.some((s) => s.includes("token.awswaf.com"))) awsSignals.push("script: AWS WAF token script");
  if (awsSignals.length > 0) {
    results.push({
      provider: "AwsWaf",
      category: "WAF",
      confidence: 90,
      isBlocked: false,
      description: `AWS WAF integration detected (${awsSignals.join(", ")}).`,
      signals: awsSignals,
      mitigation: "Ensure AWS WAF challenge tokens are retrieved before issuing API calls.",
    });
  }

  // 8. FingerprintJS
  const fpjsSignals: string[] = [];
  if (scriptsLower.some((s) => s.includes("openfpcdn.io") || s.includes("api.fpjs.io") || s.includes("fingerprintjs"))) {
    fpjsSignals.push("script: FingerprintJS library");
  }
  if (fpjsSignals.length > 0) {
    results.push({
      provider: "FingerprintJs",
      category: "Fingerprinting",
      confidence: 90,
      isBlocked: false,
      description: `FingerprintJS browser identification library detected (${fpjsSignals.join(", ")}).`,
      signals: fpjsSignals,
      mitigation: "Use seleniumbase-rs evasion profile with fixed seed to ensure consistent visitor identifiers.",
    });
  }

  // 9. reCAPTCHA & hCaptcha
  if (scriptsLower.some((s) => s.includes("google.com/recaptcha") || s.includes("recaptcha/api.js")) || htmlLower.includes("g-recaptcha")) {
    results.push({
      provider: "ReCaptcha",
      category: "Captcha",
      confidence: 95,
      isBlocked: false,
      description: "Google reCAPTCHA widget/library detected on page.",
      signals: ["script: google.com/recaptcha"],
      mitigation: "Use seleniumbase-rs reCAPTCHA handler or audio solver helper.",
    });
  }

  if (scriptsLower.some((s) => s.includes("hcaptcha.com")) || htmlLower.includes("class=\"h-captcha\"")) {
    results.push({
      provider: "HCaptcha",
      category: "Captcha",
      confidence: 95,
      isBlocked: false,
      description: "hCaptcha verification widget detected on page.",
      signals: ["script: hcaptcha.com/1/api.js"],
      mitigation: "Use seleniumbase-rs hCaptcha solver helper.",
    });
  }

  return results;
}

/**
 * Analyzes probe data and produces an actionable diagnostics report.
 */
export function evaluateAntiBot(data: AntiBotProbeData): AntiBotSummary {
  const items: DiagnosticItem[] = [];

  // 1. navigator.webdriver
  if (data.webdriver.flag === true) {
    items.push({
      id: "navigator_webdriver",
      name: "navigator.webdriver",
      category: "automation",
      status: "fail",
      headline: "Automation flag is TRUE (Critical Leak)",
      detail: "navigator.webdriver is set to true. Anti-bot systems immediately flag this session as automated.",
      recommendation: "Enable stealth mode with seleniumbase-rs evasion or launch Chrome with --disable-blink-features=AutomationControlled.",
    });
  } else if (data.webdriver.overridden && !data.webdriver.nativeGetter) {
    items.push({
      id: "navigator_webdriver",
      name: "navigator.webdriver",
      category: "automation",
      status: "warn",
      headline: "Property overridden (Non-native getter)",
      detail: "navigator.webdriver is false, but the property getter appears modified or spoofed via Object.defineProperty.",
      recommendation: "Ensure evasion patches prototype getters cleanly to emulate native browser code.",
    });
  } else {
    items.push({
      id: "navigator_webdriver",
      name: "navigator.webdriver",
      category: "automation",
      status: "pass",
      headline: "Clean (No automation flag)",
      detail: "navigator.webdriver is false or undefined with native property semantics.",
    });
  }

  // 2. CDP Automation Flags (window.cdc_*, document.$cdc_*)
  const allCdp = [...data.cdpFlags.windowFlags, ...data.cdpFlags.documentFlags, ...data.cdpFlags.runtimeArtifacts];
  if (allCdp.length > 0) {
    items.push({
      id: "cdp_flags",
      name: "CDP Automation Flags",
      category: "automation",
      status: "fail",
      headline: `CDP artifacts detected (${allCdp.length} found)`,
      detail: `Found ChromeDriver/CDP cache signatures: ${allCdp.slice(0, 5).join(", ")}${allCdp.length > 5 ? "..." : ""}.`,
      recommendation: "Use seleniumbase-rs pure CDP mode or patch the ChromeDriver binary to replace the 'cdc_' string.",
    });
  } else {
    items.push({
      id: "cdp_flags",
      name: "CDP Automation Flags",
      category: "automation",
      status: "pass",
      headline: "Clean (No cdc_* flags)",
      detail: "No ChromeDriver or automation cache identifiers found on window or document.",
    });
  }

  // 3. WebGL Spoofing & Software Renderer
  if (data.webgl.isSoftware) {
    const ren = data.webgl.unmaskedRenderer || data.webgl.renderer || "Unknown";
    items.push({
      id: "webgl_renderer",
      name: "WebGL Renderer",
      category: "graphics",
      status: "fail",
      headline: "Software renderer detected",
      detail: `WebGL is using a software rasterizer: ${ren}. This is typical of headless virtual machines and cloud runners.`,
      recommendation: "Provide hardware acceleration flags or configure a realistic WebGL vendor/renderer spoof.",
    });
  } else if (data.webgl.isTampered) {
    items.push({
      id: "webgl_renderer",
      name: "WebGL Renderer",
      category: "graphics",
      status: "warn",
      headline: "WebGL getParameter tampered",
      detail: "WebGLRenderingContext.prototype.getParameter has been monkey-patched or wrapped in a non-native function.",
      recommendation: "Use native CDP protocol overrides rather than client-side JavaScript monkey patching.",
    });
  } else {
    const vendor = data.webgl.unmaskedVendor || data.webgl.vendor || "Hardware";
    const renderer = data.webgl.unmaskedRenderer || data.webgl.renderer || "Hardware";
    items.push({
      id: "webgl_renderer",
      name: "WebGL Renderer",
      category: "graphics",
      status: "pass",
      headline: "Hardware accelerated",
      detail: `${vendor} - ${renderer}`,
    });
  }

  // 4. Canvas Noise & Determinism
  if (data.canvas.noiseDetected) {
    items.push({
      id: "canvas_noise",
      name: "Canvas Fingerprinting",
      category: "fingerprint",
      status: "warn",
      headline: "Canvas noise injection detected",
      detail: "Repeated renders of identical 2D canvas operations produced differing pixel hashes. Anti-fingerprinting random noise is active.",
      recommendation: "Advanced anti-bots detect random canvas noise. Prefer stable, consistent hardware fingerprints over dynamic noise.",
    });
  } else if (data.canvas.isTampered) {
    items.push({
      id: "canvas_noise",
      name: "Canvas Fingerprinting",
      category: "fingerprint",
      status: "warn",
      headline: "Canvas API hooked",
      detail: "HTMLCanvasElement.prototype.toDataURL or CanvasRenderingContext2D.prototype.getImageData is non-native.",
      recommendation: "Ensure canvas spoofing preserves native function signatures and prototype chains.",
    });
  } else {
    items.push({
      id: "canvas_noise",
      name: "Canvas Fingerprinting",
      category: "fingerprint",
      status: "pass",
      headline: "Deterministic (Clean)",
      detail: "Canvas rendering operations are consistent and native across repeated drawing passes.",
    });
  }

  // 5. Multi-Vendor Anti-Bot Protection Evaluation (matching `antibot-detector`)
  const protections = data.pageSignals ? detectProtections(data.pageSignals) : [];

  // Fallback to turnstile probe if pageSignals was not provided
  if (protections.length === 0 && data.turnstile.detected) {
    const parts: string[] = [];
    if (data.turnstile.iframes > 0) parts.push(`${data.turnstile.iframes} challenge iframe(s)`);
    if (data.turnstile.widgetSelectors.length > 0) parts.push(`widgets: ${data.turnstile.widgetSelectors.join(", ")}`);
    if (data.turnstile.apiPresent) parts.push("window.turnstile API");
    items.push({
      id: "turnstile",
      name: "Cloudflare Turnstile",
      category: "challenge",
      status: "info",
      headline: "Turnstile challenge detected",
      detail: `Active Cloudflare Turnstile detected on this page (${parts.join("; ")}).`,
      recommendation: "Use seleniumbase-rs with uc_gui_click_captcha() or CDP page.turnstile_solver() to solve.",
    });
  } else if (protections.length > 0) {
    for (const p of protections) {
      items.push({
        id: `protection_${p.provider.toLowerCase()}`,
        name: `${p.provider} (${p.category})`,
        category: "challenge",
        status: p.isBlocked ? "warn" : "info",
        headline: `${p.provider} Detected (${p.confidence}% Confidence)`,
        detail: p.description,
        recommendation: p.mitigation,
      });
    }
  } else {
    items.push({
      id: "protections",
      name: "Bot Protections & WAF",
      category: "challenge",
      status: "pass",
      headline: "No active bot protections detected",
      detail: "Scanned for Cloudflare, DataDome, Akamai, Kasada, PerimeterX, Imperva, AWS WAF, FingerprintJS, reCAPTCHA, and hCaptcha.",
    });
  }

  const passed = items.filter((i) => i.status === "pass" || i.status === "info").length;
  const leaks = items.filter((i) => i.status === "fail" || i.status === "warn").length;
  const score = Math.max(0, Math.round((passed / items.length) * 100));

  return {
    score,
    totalChecks: items.length,
    passedChecks: passed,
    leaksDetected: leaks,
    protectionsDetected: protections,
    items,
  };
}
