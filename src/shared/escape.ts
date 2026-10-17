// Escaping for the three selector languages the extension writes: CSS
// identifiers, CSS attribute values and XPath string literals.

/** XPath's normalize-space: collapse runs of space, tab, CR and LF, and trim. */
export function normalizeSpace(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(/[ \t\r\n]+/g, " ")
    .replace(/^ | $/g, "");
}

/** `CSS.escape`, for pages and test DOMs that lack it (CSSOM serialize an identifier). */
export function cssEscape(value: string): string {
  const text = String(value);
  const first = text.charCodeAt(0);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0) {
      out += "�";
    } else if (
      (c >= 0x1 && c <= 0x1f) ||
      c === 0x7f ||
      (i === 0 && c >= 0x30 && c <= 0x39) ||
      (i === 1 && c >= 0x30 && c <= 0x39 && first === 0x2d)
    ) {
      out += `\\${c.toString(16)} `;
    } else if (i === 0 && text.length === 1 && c === 0x2d) {
      out += `\\${text.charAt(i)}`;
    } else if (
      c >= 0x80 ||
      c === 0x2d ||
      c === 0x5f ||
      (c >= 0x30 && c <= 0x39) ||
      (c >= 0x41 && c <= 0x5a) ||
      (c >= 0x61 && c <= 0x7a)
    ) {
      out += text.charAt(i);
    } else {
      out += `\\${text.charAt(i)}`;
    }
  }
  return out;
}

/** A double-quoted CSS string, for `[attr="value"]`. */
export function cssString(value: string): string {
  const body = String(value)
    .replace(/[\\"]/g, "\\$&")
    .replace(/\n/g, "\\a ")
    .replace(/\r/g, "\\d ")
    .replace(/\f/g, "\\c ")
    .replace(/\0/g, "�");
  return `"${body}"`;
}

/**
 * An XPath 1.0 string literal. XPath has no escapes, so a value holding both
 * quote kinds becomes a `concat()` of pieces.
 */
export function xpathLiteral(value: string): string {
  const text = String(value);
  if (!text.includes('"')) return `"${text}"`;
  if (!text.includes("'")) return `'${text}'`;
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    const at = rest.indexOf('"');
    if (at === -1) {
      pieces.push(`"${rest}"`);
      break;
    }
    if (at > 0) pieces.push(`"${rest.slice(0, at)}"`);
    pieces.push(`'"'`);
    rest = rest.slice(at + 1);
  }
  return `concat(${pieces.join(", ")})`;
}
