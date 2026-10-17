// Test helper: a happy-dom document from an HTML string.
import { Window } from "happy-dom";
import { must } from "./support.ts";

/** A test document, and `$` (the first element that matches a selector; a test that finds none fails). */
export interface TestDom {
  window: Window;
  document: Document;
  $(selector: string): Element;
}

export function dom(html: string): TestDom {
  const window = new Window({ url: "http://127.0.0.1/" });
  window.document.body.innerHTML = html;
  // happy-dom implements the DOM interfaces the code under test uses; its classes are
  // declared separately from lib.dom's, so the one cast is here and nowhere else.
  const document = window.document as unknown as Document;
  return { window, document, $: (selector) => must(document.querySelector(selector), `an element that matches ${selector}`) };
}

/** The `index`th element of the document that matches `selector`; a test that finds none fails. */
export function nth(document: Document, selector: string, index: number): Element {
  return must([...document.querySelectorAll(selector)][index], `element ${index} of ${selector}`);
}
