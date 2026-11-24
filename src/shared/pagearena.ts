// Visual PageArena DOM Pruner & Token Counter.
// Prunes bloated HTML into clean, semantic Markdown for LLM consumption,
// and calculates exact token savings compared to raw HTML.

export interface PageArenaResult {
  rawHtml: string;
  rawBytes: number;
  rawTokens: number;
  markdown: string;
  markdownBytes: number;
  markdownTokens: number;
  savedBytes: number;
  savedTokens: number;
  savingsPercent: number;
}

const STRIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "canvas",
  "template",
  "link",
  "meta",
  "iframe",
]);

/**
 * Estimates token count using standard LLM token ratio (~4 characters/bytes per token).
 */
export function estimateTokens(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / 4));
}

/**
 * Recursively converts a DOM node to clean Markdown.
 */
function nodeToMarkdown(node: Node): string {
  if (node.nodeType === 3) {
    // Text node
    const text = node.textContent ?? "";
    return text.replace(/\s+/g, " ");
  }

  if (node.nodeType !== 1) {
    return "";
  }

  const el = node as Element;
  const tag = el.localName.toLowerCase();

  if (STRIP_TAGS.has(tag)) {
    return "";
  }

  // Check hidden elements
  if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") {
    return "";
  }

  const inner = Array.from(el.childNodes).map(nodeToMarkdown).join("").trim();

  switch (tag) {
    case "h1":
      return `\n\n# ${inner}\n\n`;
    case "h2":
      return `\n\n## ${inner}\n\n`;
    case "h3":
      return `\n\n### ${inner}\n\n`;
    case "h4":
      return `\n\n#### ${inner}\n\n`;
    case "h5":
      return `\n\n##### ${inner}\n\n`;
    case "h6":
      return `\n\n###### ${inner}\n\n`;
    case "p":
      return `\n\n${inner}\n\n`;
    case "br":
      return "\n";
    case "hr":
      return "\n\n---\n\n";
    case "strong":
    case "b":
      return inner ? `**${inner}**` : "";
    case "em":
    case "i":
      return inner ? `*${inner}*` : "";
    case "code":
      if (el.parentElement?.localName.toLowerCase() === "pre") {
        return inner;
      }
      return inner ? `\`${inner}\`` : "";
    case "pre":
      return `\n\n\`\`\`\n${el.textContent?.trim() ?? ""}\n\`\`\`\n\n`;
    case "blockquote":
      return `\n\n> ${inner}\n\n`;
    case "a": {
      const href = el.getAttribute("href");
      if (!href || href.startsWith("javascript:")) {
        return inner;
      }
      return `[${inner || href}](${href})`;
    }
    case "img": {
      const alt = el.getAttribute("alt") || "";
      const src = el.getAttribute("src") || "";
      return src ? `![${alt}](${src})` : "";
    }
    case "ul":
      return `\n\n${inner}\n\n`;
    case "ol":
      return `\n\n${inner}\n\n`;
    case "li": {
      const isOrdered = el.parentElement?.localName.toLowerCase() === "ol";
      const index = Array.from(el.parentElement?.children ?? []).indexOf(el) + 1;
      const prefix = isOrdered ? `${index}. ` : "- ";
      return `\n${prefix}${inner}`;
    }
    case "button": {
      const btnText = inner || el.getAttribute("aria-label") || el.getAttribute("value") || "Button";
      return ` [Button: ${btnText}] `;
    }
    case "input": {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "hidden") return "";
      if (type === "checkbox") {
        const checked = (el as HTMLInputElement).checked || el.hasAttribute("checked");
        return checked ? " [x] " : " [ ] ";
      }
      if (type === "radio") {
        const checked = (el as HTMLInputElement).checked || el.hasAttribute("checked");
        return checked ? " (x) " : " ( ) ";
      }
      if (type === "submit" || type === "button") {
        const val = el.getAttribute("value") || "Submit";
        return ` [Button: ${val}] `;
      }
      const val = el.getAttribute("placeholder") || el.getAttribute("value") || el.getAttribute("name") || "";
      return ` [Input (${type}): ${val}] `;
    }
    case "textarea": {
      const ph = el.getAttribute("placeholder") || el.textContent || "";
      return ` [Textarea: ${ph.trim()}] `;
    }
    case "select": {
      const sel = el as HTMLSelectElement;
      const selected = sel.selectedOptions?.[0]?.textContent || el.querySelector("option[selected]")?.textContent || "Select";
      return ` [Select: ${selected.trim()}] `;
    }
    case "table": {
      return formatTable(el);
    }
    default:
      return inner;
  }
}

function formatTable(table: Element): string {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (rows.length === 0) return "";

  const lines: string[] = [];
  let headerFormatted = false;

  for (const tr of rows) {
    const ths = Array.from(tr.querySelectorAll("th"));
    const tds = Array.from(tr.querySelectorAll("td"));
    const cells = ths.length > 0 ? ths : tds;
    const textCells = cells.map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim());
    lines.push(`| ${textCells.join(" | ")} |`);

    if (ths.length > 0 && !headerFormatted) {
      lines.push(`| ${textCells.map(() => "---").join(" | ")} |`);
      headerFormatted = true;
    }
  }

  return `\n\n${lines.join("\n")}\n\n`;
}

/**
 * Normalizes Markdown text, trimming excess line breaks and spaces.
 */
export function cleanMarkdown(rawMarkdown: string): string {
  return rawMarkdown
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * Prunes a DOM element into PageArena clean Markdown and calculates exact LLM token savings.
 */
export function pruneAndCountTokens(el: Element): PageArenaResult {
  const rawHtml = el.outerHTML ?? "";
  const rawBytes = new TextEncoder().encode(rawHtml).length;
  const rawTokens = estimateTokens(rawBytes);

  const mdRaw = nodeToMarkdown(el);
  const markdown = cleanMarkdown(mdRaw);
  const markdownBytes = new TextEncoder().encode(markdown).length;
  const markdownTokens = estimateTokens(markdownBytes);

  const savedBytes = Math.max(0, rawBytes - markdownBytes);
  const savedTokens = Math.max(0, rawTokens - markdownTokens);
  const savingsPercent = rawBytes > 0 ? Math.round((savedBytes / rawBytes) * 100) : 0;

  return {
    rawHtml,
    rawBytes,
    rawTokens,
    markdown,
    markdownBytes,
    markdownTokens,
    savedBytes,
    savedTokens,
    savingsPercent,
  };
}
