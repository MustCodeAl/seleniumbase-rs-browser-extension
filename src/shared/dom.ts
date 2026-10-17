// A tiny element builder. Text is always set as text, never parsed as HTML, so
// a selector, a page title or a recorded value cannot inject markup into an
// extension page or into the overlay on someone else's page.

/** Whether `value` is a DOM node. Checked by shape, so a node of any document or realm counts. */
export function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "nodeType" in value;
}

/** Whether `value` is a DOM element (a node of type 1), by shape as `isNode` is. */
export function isElement(value: unknown): value is Element {
  return isNode(value) && value.nodeType === 1;
}

/** The element with this id; a page that lacks it is broken, so this throws. */
export function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from the page`);
  return el;
}

/** A child of `h`: a node, text, a number, a list of these, or something falsy to skip. */
export type Child = Node | string | number | false | null | undefined | Child[];

/** The properties of `h`: `class`, `text`, `dataset`, `on...` handlers, other attributes. */
export interface Props {
  class?: string;
  text?: string;
  dataset?: Record<string, string>;
  [attribute: string]: unknown;
}

function append(parent: Element, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const item of child) append(parent, item);
  } else {
    parent.append(typeof child === "object" ? child : document.createTextNode(String(child)));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (key === "text") el.textContent = String(value);
    else if (key === "dataset" && typeof value === "object") Object.assign(el.dataset, value);
    // A function given as an `on...` property is the listener itself.
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) append(el, child);
  return el;
}
