// Test helper: a happy-dom document from an HTML string.
import { Window } from "happy-dom";

export function dom(html) {
  const window = new Window({ url: "http://127.0.0.1/" });
  window.document.body.innerHTML = html;
  return { window, document: window.document, $: (sel) => window.document.querySelector(sel) };
}
