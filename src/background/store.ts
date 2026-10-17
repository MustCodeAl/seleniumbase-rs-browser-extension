// Small helpers over extension storage.
//
// `local` survives a browser restart and stays on this machine. `session` is
// cleared when the browser closes (it falls back to `local` where the browser
// has no session area). Nothing is ever sent anywhere.

import { ext } from "../shared/api.ts";
import { errorText } from "../shared/guards.ts";

/** An extension storage area: `local` or `session`. */
export type Area = chrome.storage.StorageArea;

export const local: Area = ext.storage.local;
export const session: Area = ext.storage.session ?? ext.storage.local;

/** The value stored under `key`, or `fallback`. The caller names the type it stored there with `set`. */
export async function get<T>(area: Area, key: string, fallback: T): Promise<T> {
  const found: Record<string, unknown> = await area.get(key);
  const value = found[key];
  return value === undefined ? fallback : (value as T);
}

export function set(area: Area, key: string, value: unknown): Promise<void> {
  return area.set({ [key]: value });
}

export function remove(area: Area, key: string): Promise<void> {
  return area.remove(key);
}

/** A queue: runs `task`s one after another, so read-modify-write cycles cannot interleave. */
export function makeLock(): <T>(task: () => Promise<T> | T) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T> | T): Promise<T> => {
    const run = chain.then(task);
    chain = run.catch(() => {});
    return run;
  };
}

export const RESTRICTED = /^(chrome|chrome-extension|edge|about|moz-extension|view-source|devtools|chrome-search|chrome-untrusted):/i;
export const RECORDABLE = /^(https?|file):/i;

/** A message for a person when the extension may not touch a page. */
export function accessError(error: unknown, url: string | undefined): string {
  const text = errorText(error);
  if (url && RESTRICTED.test(url)) {
    return "Browsers do not let extensions run on their own pages. Open an ordinary web page and try again.";
  }
  if (/Cannot access|Missing host permission|permission|cannot be scripted|extensions gallery/i.test(text)) {
    return "The extension has no access to this page yet. Click the toolbar button while the page is open, or allow access to all sites when asked.";
  }
  return text;
}

/** Run content-script files in a tab. */
export async function injectFiles(tabId: number, files: string[], url: string | undefined): Promise<void> {
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
