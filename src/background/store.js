// Small helpers over extension storage.
//
// `local` survives a browser restart and stays on this machine. `session` is
// cleared when the browser closes (it falls back to `local` where the browser
// has no session area). Nothing is ever sent anywhere.

import { ext } from "../shared/api.js";

export const local = ext.storage.local;
export const session = ext.storage.session ?? ext.storage.local;

export async function get(area, key, fallback) {
  const found = await area.get(key);
  return found[key] === undefined ? fallback : found[key];
}

export function set(area, key, value) {
  return area.set({ [key]: value });
}

export function remove(area, key) {
  return area.remove(key);
}

/** One queue per name: runs `task`s one after another, so read-modify-write cycles cannot interleave. */
export function makeLock() {
  let chain = Promise.resolve();
  return (task) => {
    const run = chain.then(task);
    chain = run.catch(() => {});
    return run;
  };
}

export const RESTRICTED = /^(chrome|chrome-extension|edge|about|moz-extension|view-source|devtools|chrome-search|chrome-untrusted):/i;
export const RECORDABLE = /^(https?|file):/i;

/** A message for a person when the extension may not touch a page. */
export function accessError(error, url) {
  const text = String(error?.message ?? error);
  if (url && RESTRICTED.test(url)) {
    return "Browsers do not let extensions run on their own pages. Open an ordinary web page and try again.";
  }
  if (/Cannot access|Missing host permission|permission|cannot be scripted|extensions gallery/i.test(text)) {
    return "The extension has no access to this page yet. Click the toolbar button while the page is open, or allow access to all sites when asked.";
  }
  return text;
}

/** Run content-script files in a tab. */
export async function injectFiles(tabId, files, url) {
  try {
    await ext.scripting.executeScript({
      target: { tabId, allFrames: false },
      files,
      injectImmediately: true,
    });
  } catch (error) {
    throw new Error(accessError(error, url));
  }
}
