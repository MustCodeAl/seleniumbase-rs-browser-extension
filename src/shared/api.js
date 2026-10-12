// The WebExtension namespace: `browser` in Firefox, `chrome` elsewhere. Both
// return promises in Manifest V3, so the code is written once against `ext`.

export const ext = globalThis.browser ?? globalThis.chrome;
