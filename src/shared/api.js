// The WebExtension namespace: `browser` in Firefox, `chrome` elsewhere. Both
// return promises in Manifest V3, so the code is written once against `ext`.

export const ext = globalThis.browser ?? globalThis.chrome;

/** True in Firefox (the build also defines `__BROWSER__`; this works unbundled too). */
export function isFirefox() {
  return typeof globalThis.browser !== "undefined" && typeof globalThis.chrome?.runtime !== "undefined"
    ? /Firefox\//.test(globalThis.navigator?.userAgent ?? "")
    : false;
}
