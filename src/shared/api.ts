// The WebExtension namespace: `browser` in Firefox, `chrome` elsewhere. Both
// return promises in Manifest V3, so the code is written once against `ext`.
//
// It is typed as Chrome's namespace: the calls this extension makes have the same
// shape in Firefox's, whose own declarations (`typeof browser`) are a different
// type, so the one cast is here and nowhere else.

export const ext: typeof chrome = (globalThis.browser as unknown as typeof chrome | undefined) ?? globalThis.chrome;
