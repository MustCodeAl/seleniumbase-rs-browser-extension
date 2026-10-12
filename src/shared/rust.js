// Turning recorded text into Rust source. Everything a person or a web page
// can influence goes through `rustStr` (string literals), `commentText` (the
// body of a `//` comment), `fnIdent`/`testIdent` (names) or `envName`.
// `rustStr` mirrors `rust_str` in seleniumbase-rs
// (src/utilities/importer/emit.rs): quotes, backslashes, line breaks, NUL and
// every control, invisible or bidirectional character are escaped, so a literal
// always ends where it should. It escapes a few characters more than Rust's own
// debug escaping, which is harmless: a `\u{..}` escape is always valid.

// Cc controls, Cf format characters (bidi controls, zero-width, BOM), lone
// surrogates, private use, unassigned, line and paragraph separators, spaces
// other than U+0020, and combining marks (Rust's debug output escapes those).
const NEEDS_ESCAPE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}\p{Grapheme_Extend}]/u;

function needsUnicodeEscape(ch) {
  return ch !== " " && NEEDS_ESCAPE.test(ch);
}

function escapeChar(ch) {
  const code = ch.codePointAt(0);
  // Rust source cannot hold a surrogate, even as an escape.
  if (code >= 0xd800 && code <= 0xdfff) return "\\u{fffd}";
  return `\\u{${code.toString(16)}}`;
}

/** `text` as a Rust string literal. */
export function rustStr(text) {
  let out = '"';
  for (const ch of String(text)) {
    switch (ch) {
      case '"':
        out += '\\"';
        break;
      case "\\":
        out += "\\\\";
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\t":
        out += "\\t";
        break;
      case "\0":
        out += "\\0";
        break;
      default:
        out += needsUnicodeEscape(ch) ? escapeChar(ch) : ch;
    }
  }
  return `${out}"`;
}

/** `text` as the body of one `//` comment: one line, nothing that could end it. */
export function commentText(text) {
  let out = "";
  for (const ch of String(text)) {
    if (ch === "\n" || ch === "\r" || ch === "\t") out += " ";
    else out += needsUnicodeEscape(ch) ? escapeChar(ch) : ch;
  }
  return out.split(/\s+/).filter(Boolean).join(" ");
}

const KEYWORDS = new Set([
  "Self", "abstract", "as", "async", "await", "become", "box", "break", "const", "continue",
  "crate", "do", "dyn", "else", "enum", "extern", "false", "final", "fn", "for", "gen", "if",
  "impl", "in", "let", "loop", "macro", "match", "mod", "move", "mut", "override", "priv", "pub",
  "ref", "return", "self", "static", "struct", "super", "trait", "true", "try", "type", "typeof",
  "unsafe", "unsized", "use", "virtual", "where", "while", "yield",
]);

/** A name made safe as a Rust function name (`rust_identifier` in recorder.rs). */
export function fnIdent(name) {
  let ident = "";
  for (const ch of String(name)) ident += /^[A-Za-z0-9_]$/.test(ch) ? ch : "_";
  if (ident === "" || ident === "_") return "recorded_test";
  if (/^[0-9]/.test(ident)) ident = `_${ident}`;
  if (KEYWORDS.has(ident)) ident += "_";
  return ident;
}

function snakeWords(text) {
  let out = "";
  let previousLower = false;
  for (const ch of String(text)) {
    if (/^[A-Za-z0-9]$/.test(ch)) {
      if (/[A-Z]/.test(ch) && previousLower) out += "_";
      out += ch.toLowerCase();
      previousLower = /[a-z0-9]/.test(ch);
    } else {
      if (!out.endsWith("_") && out !== "") out += "_";
      previousLower = false;
    }
  }
  return out.replace(/^_+|_+$/g, "");
}

/** A title as a snake_case test name (`test_ident` in emit.rs). */
export function testIdent(title, fallback) {
  let name = snakeWords(title);
  if (name.length > 80) name = name.slice(0, 80).replace(/_+$/, "");
  if (name === "") return fallback;
  if (/^[0-9]/.test(name)) name = `test_${name}`;
  if (KEYWORDS.has(name)) name += "_test";
  return name;
}

/** The environment variable that supplies a field whose value was not recorded. */
export function envName(label) {
  const words = snakeWords(label);
  return `RECORDED_${words === "" ? "SECRET" : words.toUpperCase()}`;
}
