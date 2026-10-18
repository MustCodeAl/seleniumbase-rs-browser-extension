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

/** A test document that is also the global one, for code that reaches for `document` itself. */
export interface InstalledDom extends TestDom {
  /** Puts the globals back as they were; call it in `afterEach` or `afterAll`. */
  restore(): void;
}

/**
 * Makes a happy-dom document the global `document` (and its window the global `window`,
 * and its `Event` class the global one, because happy-dom dispatches only its own events)
 * until `restore()`. The other test files assume there is none (probe.test.ts runs
 * `probePage` without a document on purpose), so a test that installs one restores it.
 */
export function installDom(html = ""): InstalledDom {
  const made = dom(html);
  const installed = { document: made.document, window: made.window, Event: made.window.Event } as const;
  const before = Object.keys(installed).map((name) => ({ name, had: name in globalThis, value: Reflect.get(globalThis, name) as unknown }));
  for (const [name, value] of Object.entries(installed)) Reflect.set(globalThis, name, value);
  return {
    ...made,
    restore() {
      for (const { name, had, value } of before) {
        if (had) Reflect.set(globalThis, name, value);
        else Reflect.deleteProperty(globalThis, name);
      }
      void made.window.happyDOM.close();
    },
  };
}

/** The `index`th element of the document that matches `selector`; a test that finds none fails. */
export function nth(document: Document, selector: string, index: number): Element {
  return must([...document.querySelectorAll(selector)][index], `element ${index} of ${selector}`);
}
