// A tiny element builder. Text is always set as text, never parsed as HTML, so
// a selector, a page title or a recorded value cannot inject markup into an
// extension page or into the overlay on someone else's page.

/**
 * @param {string} tag
 * @param {Record<string, any>} [props]  class, text, dataset, onclick-style handlers, other attributes
 * @param {...any} children              nodes, strings, arrays, or falsy values to skip
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}
