// Selector generation. Pure functions over standard DOM, so they run in a
// content script, in the page, and in a test DOM.
//
// `generateSelectors(element)` returns every selector it can think of, in the
// order a person would prefer them, each with the number of elements it matches
// in the document. A candidate is `unique` only when it matches exactly the
// element it was made for. Order of preference:
//
//   1. data-testid / data-test-id / data-test / data-qa / data-cy / data-e2e
//   2. id
//   3. name
//   4. aria-label
//   5. role plus accessible name
//   6. short, stable CSS
//   7. fallbacks: link text, element text, an XPath path (always unique)
//
// Ids and classes that look generated (CSS-in-JS hashes, React ids, numbered
// ids) are never used.

import { cssEscape, cssString, normalizeSpace, xpathLiteral } from "./escape.js";

export const TESTID_ATTRIBUTES = [
  "data-testid",
  "data-test-id",
  "data-test",
  "data-qa",
  "data-cy",
  "data-e2e",
];

const KIND_ORDER = [
  "testid",
  "id",
  "name",
  "aria-label",
  "role-name",
  "css",
  "link-text",
  "text",
  "xpath",
];

/** How a selector string is read by seleniumbase-rs: `css`, `xpath` or `link`. */
export function selectorSyntax(text) {
  const s = String(text);
  if (/^(link|link_text|text|partial_link|partial_link_text|partial_text|p_link|p_link_text|p_text)=/.test(s)) {
    return "link";
  }
  if (/^(\/|\.\/|\.\.\/|\()/.test(s)) return "xpath";
  return "css";
}

function caseTransitions(segment) {
  let count = 0;
  let previous = null;
  for (const ch of segment) {
    const kind = /[a-z]/.test(ch) ? "l" : /[A-Z]/.test(ch) ? "u" : null;
    if (kind === null) continue;
    if (previous !== null && previous !== kind) count++;
    previous = kind;
  }
  return count;
}

/** Whether a class name or id looks machine-made, and so will not stay put. */
export function looksGenerated(token) {
  const text = String(token);
  if (text.length > 32) return true;
  if (text.includes(":")) return true;
  if (/\d{3,}/.test(text)) return true;
  if (text.length >= 6 && /^[0-9a-f]+$/i.test(text) && /\d/.test(text)) return true;
  for (const segment of text.split(/[-_.]/)) {
    if (segment.length >= 5 && /[A-Za-z]/.test(segment) && /\d/.test(segment)) return true;
    if (segment.length >= 5 && segment.length <= 12 && caseTransitions(segment) >= 3) return true;
  }
  return false;
}

const STATE_CLASS = /^(is|has)-|^(active|selected|open|opened|show|shown|hide|hidden|disabled|focus|focused|hover|hovered|loading|loaded|checked|current|collapsed|expanded|visible|invalid|valid|error|pressed|ng-.*)$/i;

function stableClasses(el) {
  const raw = el.getAttribute ? el.getAttribute("class") : "";
  if (!raw) return [];
  return raw
    .split(/\s+/)
    .filter((c) => c && !looksGenerated(c) && !STATE_CLASS.test(c));
}

function stableId(el) {
  const id = el.getAttribute ? el.getAttribute("id") : null;
  if (!id || id.trim() === "" || looksGenerated(id)) return null;
  return id;
}

function idSelector(id) {
  return /^[A-Za-z_][\w-]*$/.test(id) ? `#${id}` : `[id=${cssString(id)}]`;
}

function testIdOf(el) {
  for (const attr of TESTID_ATTRIBUTES) {
    const value = el.getAttribute(attr);
    if (value && value.trim() !== "") return { attr, value };
  }
  return null;
}

// ---------------------------------------------------------------- roles and names

const INPUT_ROLES = {
  button: "button",
  submit: "button",
  reset: "button",
  image: "button",
  checkbox: "checkbox",
  radio: "radio",
  range: "slider",
  number: "spinbutton",
  search: "searchbox",
  email: "textbox",
  tel: "textbox",
  url: "textbox",
  text: "textbox",
  password: "textbox",
  "": "textbox",
};

/** The element's explicit or implicit ARIA role, or null. */
export function roleOf(el) {
  const explicit = el.getAttribute("role");
  if (explicit && explicit.trim() !== "") return explicit.trim().split(/\s+/)[0].toLowerCase();
  const tag = el.localName;
  switch (tag) {
    case "a":
    case "area":
      return el.hasAttribute("href") ? "link" : null;
    case "button":
    case "summary":
      return "button";
    case "select":
      return el.hasAttribute("multiple") || Number(el.getAttribute("size")) > 1 ? "listbox" : "combobox";
    case "textarea":
      return "textbox";
    case "img":
      return el.getAttribute("alt") === "" ? "presentation" : "img";
    case "nav":
      return "navigation";
    case "main":
      return "main";
    case "ul":
    case "ol":
      return "list";
    case "li":
      return "listitem";
    case "table":
      return "table";
    case "tr":
      return "row";
    case "td":
      return "cell";
    case "th":
      return "columnheader";
    case "form":
      return "form";
    case "option":
      return "option";
    case "dialog":
      return "dialog";
    case "input": {
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "hidden" || type === "file" || type === "color") return null;
      return INPUT_ROLES[type] ?? "textbox";
    }
    default:
      return /^h[1-6]$/.test(tag) ? "heading" : null;
  }
}

const NAME_FROM_CONTENT = new Set([
  "link", "button", "heading", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option",
  "treeitem", "switch", "columnheader", "rowheader", "cell", "gridcell", "listitem",
]);

function textOf(el) {
  return normalizeSpace(el.textContent ?? "");
}

function labelFor(el) {
  const doc = el.ownerDocument;
  const id = el.getAttribute("id");
  if (id) {
    for (const label of doc.querySelectorAll("label")) {
      if (label.getAttribute("for") === id) {
        const text = textOf(label);
        if (text) return text;
      }
    }
  }
  const wrapping = el.closest ? el.closest("label") : null;
  if (wrapping) {
    const text = textOf(wrapping);
    if (text) return text;
  }
  return "";
}

/** The accessible name and where it came from (a simplified computation). */
export function accessibleName(el) {
  const doc = el.ownerDocument;
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const text = normalizeSpace(
      labelledby
        .split(/\s+/)
        .map((id) => {
          const target = id ? doc.getElementById(id) : null;
          return target ? target.textContent : "";
        })
        .join(" "),
    );
    if (text) return { name: text, source: "labelledby" };
  }
  const aria = normalizeSpace(el.getAttribute("aria-label") ?? "");
  if (aria) return { name: aria, source: "aria-label" };

  const tag = el.localName;
  if (tag === "input") {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "button" || type === "submit" || type === "reset") {
      const value = normalizeSpace(el.getAttribute("value") ?? "");
      if (value) return { name: value, source: "value" };
      if (type === "submit") return { name: "Submit", source: "default" };
      if (type === "reset") return { name: "Reset", source: "default" };
    }
    if (type === "image") {
      const alt = normalizeSpace(el.getAttribute("alt") ?? "");
      if (alt) return { name: alt, source: "alt" };
    }
  }
  if (tag === "img" || tag === "area") {
    const alt = normalizeSpace(el.getAttribute("alt") ?? "");
    if (alt) return { name: alt, source: "alt" };
  }
  if (tag === "input" || tag === "select" || tag === "textarea") {
    const label = labelFor(el);
    if (label) return { name: label, source: "label" };
    const placeholder = normalizeSpace(el.getAttribute("placeholder") ?? "");
    if (placeholder) return { name: placeholder, source: "placeholder" };
  }
  const role = roleOf(el);
  if (role && NAME_FROM_CONTENT.has(role)) {
    const text = textOf(el);
    if (text) return { name: text, source: "content" };
  }
  const title = normalizeSpace(el.getAttribute("title") ?? "");
  if (title) return { name: title, source: "title" };
  return { name: "", source: "" };
}

// ---------------------------------------------------------------- counting

function countCss(doc, selector) {
  try {
    return doc.querySelectorAll(selector).length;
  } catch {
    return -1;
  }
}

function uniqueCss(doc, selector, el) {
  try {
    const found = doc.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

function countXPath(doc, xpath) {
  if (typeof doc.evaluate !== "function") return null;
  try {
    const result = doc.evaluate(xpath, doc, null, 7 /* ORDERED_NODE_SNAPSHOT_TYPE */, null);
    return result.snapshotLength;
  } catch {
    return null;
  }
}

function tagTest(el) {
  const ns = el.namespaceURI;
  if (ns && ns !== "http://www.w3.org/1999/xhtml") return `*[local-name()=${xpathLiteral(el.localName)}]`;
  return el.localName;
}

// ---------------------------------------------------------------- CSS

const LEAF_ATTRIBUTES = ["type", "placeholder", "title", "alt", "role", "for", "action", "href"];

function attributeVariants(el) {
  const out = [];
  for (const attr of LEAF_ATTRIBUTES) {
    const value = el.getAttribute(attr);
    if (value === null || value === "" || value.length > 60) continue;
    if (attr === "href" && (/\d{4,}/.test(value) || value.includes("?"))) continue;
    out.push(`[${attr}=${cssString(value)}]`);
  }
  return out;
}

function classSuffixes(el) {
  const classes = stableClasses(el).slice(0, 3);
  const out = [];
  if (classes.length > 0) out.push(`.${cssEscape(classes[0])}`);
  if (classes.length > 1) out.push(`.${cssEscape(classes[0])}.${cssEscape(classes[1])}`);
  return out;
}

function nthOfType(el) {
  let index = 1;
  let ambiguous = false;
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
    if (s.localName === el.localName) {
      index++;
      ambiguous = true;
    }
  }
  for (let s = el.nextElementSibling; s && !ambiguous; s = s.nextElementSibling) {
    if (s.localName === el.localName) ambiguous = true;
  }
  return ambiguous ? `:nth-of-type(${index})` : "";
}

function ancestorSegment(el) {
  const tid = testIdOf(el);
  if (tid) return { text: `[${tid.attr}=${cssString(tid.value)}]`, anchored: true };
  const id = stableId(el);
  if (id) return { text: idSelector(id), anchored: true };
  const classes = stableClasses(el);
  const base = el.localName + (classes.length > 0 ? `.${cssEscape(classes[0])}` : "");
  return { text: base, anchored: false };
}

function shortCss(el, doc) {
  const tag = el.localName;
  const plain = [tag, ...classSuffixes(el).map((c) => tag + c)];
  for (const attr of attributeVariants(el)) {
    plain.push(tag + attr);
    for (const c of classSuffixes(el).slice(0, 1)) plain.push(tag + c + attr);
  }
  const nth = tag + nthOfType(el);
  const nthVariant = nth !== tag ? nth : null;

  for (const variant of plain) {
    if (uniqueCss(doc, variant, el)) return variant;
  }
  const chain = [];
  let current = el.parentElement;
  const stages = [];
  for (let depth = 1; depth <= 4 && current && current !== doc.documentElement; depth++) {
    const segment = ancestorSegment(current);
    chain.unshift(segment.text);
    stages.push([...chain]);
    if (segment.anchored) break;
    current = current.parentElement;
  }
  for (const ancestors of stages) {
    for (const variant of plain) {
      const selector = [...ancestors, variant].join(" > ");
      if (uniqueCss(doc, selector, el)) return selector;
    }
  }
  if (nthVariant) {
    for (const ancestors of stages) {
      const selector = [...ancestors, nthVariant].join(" > ");
      if (uniqueCss(doc, selector, el)) return selector;
    }
    if (uniqueCss(doc, nthVariant, el)) return nthVariant;
  }
  return null;
}

// ---------------------------------------------------------------- XPath

function anchorXPath(el, doc) {
  const tid = testIdOf(el);
  if (tid) {
    const xp = `//*[@${tid.attr}=${xpathLiteral(tid.value)}]`;
    if (uniqueCss(doc, `[${tid.attr}=${cssString(tid.value)}]`, el)) return xp;
  }
  const id = stableId(el);
  if (id && uniqueCss(doc, idSelector(id), el)) return `//*[@id=${xpathLiteral(id)}]`;
  return null;
}

/** A positional XPath that always names exactly this element. */
export function pathXPath(el, doc = el.ownerDocument) {
  const parts = [];
  let current = el;
  while (current && current.nodeType === 1) {
    if (current !== el) {
      const anchor = anchorXPath(current, doc);
      if (anchor) return anchor + (parts.length > 0 ? `/${parts.join("/")}` : "");
    }
    let index = 1;
    for (let s = current.previousElementSibling; s; s = s.previousElementSibling) {
      if (s.localName === current.localName && s.namespaceURI === current.namespaceURI) index++;
    }
    parts.unshift(`${tagTest(current)}[${index}]`);
    if (current === doc.documentElement) break;
    current = current.parentElement;
  }
  return `/${parts.join("/")}`;
}

// ---------------------------------------------------------------- the generator

/**
 * Every selector for `el`, best first, each with its match count.
 *
 * @param {Element} el
 * @param {{document?: Document}} [options]
 */
export function generateSelectors(el, options = {}) {
  const doc = options.document ?? el.ownerDocument;
  const candidates = [];
  const seen = new Set();
  const add = (kind, syntax, value, count, extra = {}) => {
    if (count === null || count < 0 || seen.has(`${syntax}:${value}`)) return;
    seen.add(`${syntax}:${value}`);
    candidates.push({ kind, syntax, value, count, unique: count === 1, ...extra });
  };
  const addCss = (kind, value) => {
    const count = countCss(doc, value);
    // A selector built from this element's own attribute always matches it; the
    // count is what says whether it is the only one.
    add(kind, "css", value, count);
  };

  const tag = el.localName;
  const tid = testIdOf(el);
  if (tid) addCss("testid", `[${tid.attr}=${cssString(tid.value)}]`);
  const id = stableId(el);
  if (id) addCss("id", idSelector(id));
  const name = el.getAttribute("name");
  if (name && name.trim() !== "" && !looksGenerated(name)) addCss("name", `${tag}[name=${cssString(name)}]`);
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim() !== "") addCss("aria-label", `${tag}[aria-label=${cssString(ariaLabel)}]`);

  const role = roleOf(el);
  const accessible = accessibleName(el);
  const text = textOf(el);
  if (role && accessible.name) {
    const roleCount = countRoleName(doc, el, role, accessible.name);
    const aria = `${accessible.name}[role="${role}"]`;
    const explicit = el.getAttribute("role");
    const xpath = roleNameXPath(el, explicit ? role : null, accessible);
    if (xpath) {
      const count = countXPath(doc, xpath) ?? roleCount;
      add("role-name", "xpath", xpath, count, { aria, role, name: accessible.name });
    } else {
      add("role-name", "aria", aria, roleCount, { aria, role, name: accessible.name });
    }
  }

  const css = shortCss(el, doc);
  if (css) addCss("css", css);

  if (tag === "a" && el.hasAttribute("href") && text && text.length <= 80) {
    let count = 0;
    for (const a of doc.querySelectorAll("a")) if (textOf(a) === text) count++;
    add("link-text", "link", `link=${text}`, count);
  }
  if (text && text.length <= 60 && !text.includes(" ")) {
    const xp = `//${tagTest(el)}[normalize-space(.)=${xpathLiteral(text)}]`;
    let count = countXPath(doc, xp);
    if (count === null) {
      count = 0;
      for (const candidate of doc.getElementsByTagName(tag)) if (textOf(candidate) === text) count++;
    }
    add("text", "xpath", xp, count);
  }

  const path = pathXPath(el, doc);
  add("xpath", "xpath", path, 1);

  candidates.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  // A CSS candidate only counts as unique when it finds this very element.
  for (const candidate of candidates) {
    if (candidate.syntax === "css" && candidate.unique && !uniqueCss(doc, candidate.value, el)) {
      candidate.unique = false;
    }
  }
  const best = candidates.find((c) => c.unique && c.syntax !== "aria") ?? null;
  return {
    tag,
    role,
    name: accessible.name,
    nameSource: accessible.source,
    text: text.length > 80 ? text.slice(0, 80) : text,
    inputType: tag === "input" ? (el.getAttribute("type") || "text").toLowerCase() : undefined,
    candidates,
    best,
  };
}

function roleNameXPath(el, explicitRole, accessible) {
  const test = tagTest(el);
  const lit = xpathLiteral(accessible.name);
  const roleClause = explicitRole ? `@role=${xpathLiteral(explicitRole)} and ` : "";
  switch (accessible.source) {
    case "content":
      return `//${test}[${roleClause}normalize-space(.)=${lit}]`;
    case "aria-label":
      return `//${test}[${roleClause}@aria-label=${lit}]`;
    case "placeholder":
    case "title":
    case "alt":
    case "value":
      return `//${test}[${roleClause}@${accessible.source}=${lit}]`;
    default:
      return null;
  }
}

function countRoleName(doc, el, role, name) {
  let count = 0;
  const tag = el.localName;
  const same = doc.getElementsByTagName(tag);
  for (const other of same) {
    if (roleOf(other) === role && accessibleName(other).name === name) count++;
  }
  return count;
}
