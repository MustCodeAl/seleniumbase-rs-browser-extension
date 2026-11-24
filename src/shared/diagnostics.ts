// Anti-bot and fingerprint leak diagnostics.
// Evaluates navigator.webdriver, CDP automation flags (window.cdc_*),
// WebGL spoofing/tampering, canvas noise/determinism, and Cloudflare Turnstile presence.

export type DiagnosticStatus = "pass" | "warn" | "fail" | "info";

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
}

export interface AntiBotSummary {
  score: number; // 0 to 100 (100 is completely clean / stealthy)
  totalChecks: number;
  passedChecks: number;
  leaksDetected: number;
  items: DiagnosticItem[];
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

  // 5. Cloudflare Turnstile Presence
  if (data.turnstile.detected) {
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
  } else {
    items.push({
      id: "turnstile",
      name: "Cloudflare Turnstile",
      category: "challenge",
      status: "pass",
      headline: "Not detected",
      detail: "No Cloudflare Turnstile iframes, widget containers, or API objects found on the page.",
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
    items,
  };
}
