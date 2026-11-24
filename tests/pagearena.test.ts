import { describe, expect, test } from "bun:test";
import { pruneAndCountTokens, cleanMarkdown, estimateTokens } from "../src/shared/pagearena.ts";
import { dom } from "./dom.ts";

describe("PageArena DOM Pruner & Token Counter", () => {
  test("estimateTokens calculates ~4 bytes per token", () => {
    expect(estimateTokens(400)).toBe(100);
    expect(estimateTokens(0)).toBe(1);
    expect(estimateTokens(15)).toBe(4);
  });

  test("cleanMarkdown normalizes excess whitespace and newlines", () => {
    const raw = "Hello   world\n\n\n\nHow are   you?";
    expect(cleanMarkdown(raw)).toBe("Hello world\n\nHow are you?");
  });

  test("prunes script, style, svg, and hidden elements", () => {
    const d = dom(`
      <article>
        <h1>Main Title</h1>
        <style>.test { color: red; }</style>
        <script>console.log("tracking");</script>
        <svg><path d="M0 0h10v10H0z"/></svg>
        <p>This is a paragraph with <a href="https://example.com">a link</a> and <strong>bold text</strong>.</p>
        <div hidden>Secret hidden content</div>
        <div aria-hidden="true">Accessibility hidden</div>
      </article>
    `);
    const el = d.$("article");
    const result = pruneAndCountTokens(el);

    expect(result.markdown).toContain("# Main Title");
    expect(result.markdown).toContain("[a link](https://example.com)");
    expect(result.markdown).toContain("**bold text**");
    expect(result.markdown).not.toContain("color: red");
    expect(result.markdown).not.toContain("tracking");
    expect(result.markdown).not.toContain("Secret hidden content");
    expect(result.markdown).not.toContain("Accessibility hidden");
    expect(result.rawBytes).toBeGreaterThan(result.markdownBytes);
    expect(result.savingsPercent).toBeGreaterThan(0);
    expect(result.savedTokens).toBeGreaterThan(0);
  });

  test("formats interactive controls cleanly in Markdown", () => {
    const d = dom(`
      <form>
        <h2>Login Form</h2>
        <input type="text" name="username" placeholder="Enter username" />
        <input type="password" name="password" placeholder="Password" />
        <input type="checkbox" checked />
        <button type="submit">Log in</button>
      </form>
    `);
    const el = d.$("form");
    const result = pruneAndCountTokens(el);

    expect(result.markdown).toContain("## Login Form");
    expect(result.markdown).toContain("[Input (text): Enter username]");
    expect(result.markdown).toContain("[Input (password): Password]");
    expect(result.markdown).toContain("[x]");
    expect(result.markdown).toContain("[Button: Log in]");
  });

  test("formats tables into Markdown tables", () => {
    const d = dom(`
      <table>
        <thead>
          <tr><th>Item</th><th>Price</th></tr>
        </thead>
        <tbody>
          <tr><td>Apple</td><td>$1.50</td></tr>
          <tr><td>Banana</td><td>$0.75</td></tr>
        </tbody>
      </table>
    `);
    const el = d.$("table");
    const result = pruneAndCountTokens(el);

    expect(result.markdown).toContain("| Item | Price |");
    expect(result.markdown).toContain("| --- | --- |");
    expect(result.markdown).toContain("| Apple | $1.50 |");
    expect(result.markdown).toContain("| Banana | $0.75 |");
  });
});
