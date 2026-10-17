import { describe, expect, test } from "bun:test";
import {
  type GeneratedSelectors,
  accessibleName,
  generateSelectors,
  looksGenerated,
  roleOf,
  selectorSyntax,
} from "../src/shared/selectors.ts";
import { cssEscape, cssString, normalizeSpace, xpathLiteral } from "../src/shared/escape.ts";
import { dom, nth } from "./dom.ts";
import { must } from "./support.ts";

const values = (result: GeneratedSelectors) => result.candidates.map((c) => c.value);
const first = (result: GeneratedSelectors) => must(result.best, "a best selector").value;

describe("generated-looking tokens", () => {
  test.each([
    "css-1x2y3z",
    "sc-bdfBwQ",
    "jss123",
    "_3xYz9Qa",
    ":r1:",
    "a1b2c3d4e5",
    "e8f9a0b1c2d3",
    "item-12345",
    "MuiButton-root-482",
    "x".repeat(40),
  ])("%s is generated", (token) => {
    expect(looksGenerated(token)).toBe(true);
  });

  test.each([
    "btn-primary",
    "login-form",
    "submitButton",
    "nav",
    "col-md-6",
    "h2",
    "search-input",
    "is-primary",
  ])("%s is stable", (token) => {
    expect(looksGenerated(token)).toBe(false);
  });
});

describe("escaping", () => {
  test("css identifiers", () => {
    expect(cssEscape("a.b")).toBe("a\\.b");
    expect(cssEscape("1st")).toBe("\\31 st");
    expect(cssEscape("has space")).toBe("has\\ space");
    expect(cssEscape("ok-id_1")).toBe("ok-id_1");
  });
  test("css strings", () => {
    expect(cssString('say "hi"')).toBe('"say \\"hi\\""');
    expect(cssString("c:\\temp")).toBe('"c:\\\\temp"');
    expect(cssString("a\nb")).toBe('"a\\a b"');
  });
  test("xpath literals", () => {
    expect(xpathLiteral("plain")).toBe('"plain"');
    expect(xpathLiteral('say "hi"')).toBe("'say \"hi\"'");
    expect(xpathLiteral(`it's "x"`)).toBe(`concat("it's ", '"', "x", '"')`);
  });
  test("normalize-space follows XPath", () => {
    expect(normalizeSpace("  a \n\t b  ")).toBe("a b");
    expect(normalizeSpace("a\u00a0b")).toBe("a\u00a0b");
  });
});

describe("selector syntax", () => {
  test.each<[string, "css" | "xpath" | "link"]>([
    ["#go", "css"],
    ["button[name='q']", "css"],
    ["//div[@id='b']", "xpath"],
    ["(//a)[2]", "xpath"],
    ["./span", "xpath"],
    ["link=Home", "link"],
    ["p_link=Hom", "link"],
  ])("%s is %s", (text, syntax) => {
    expect(selectorSyntax(text)).toBe(syntax);
  });
});

describe("preference order", () => {
  test("data-testid first", () => {
    const { $, document } = dom(`<button id="go" name="n" data-testid="submit-order">Order</button>`);
    const result = generateSelectors($("button"), { document });
    expect(first(result)).toBe('[data-testid="submit-order"]');
    expect(result.candidates[0]?.kind).toBe("testid");
    expect(result.candidates[0]?.count).toBe(1);
  });

  test("data-test and data-qa are also test ids", () => {
    const a = dom(`<button data-test="buy">Buy</button>`);
    expect(first(generateSelectors(a.$("button"), { document: a.document }))).toBe('[data-test="buy"]');
    const b = dom(`<button data-qa="buy">Buy</button>`);
    expect(first(generateSelectors(b.$("button"), { document: b.document }))).toBe('[data-qa="buy"]');
  });

  test("id comes next", () => {
    const { $, document } = dom(`<input id="email" name="email" type="text">`);
    const result = generateSelectors($("input"), { document });
    expect(first(result)).toBe("#email");
    expect(values(result)).toContain('input[name="email"]');
  });

  test("name is next when there is no id", () => {
    const { $, document } = dom(`<form><input name="q" type="search"></form>`);
    expect(first(generateSelectors($("input"), { document }))).toBe('input[name="q"]');
  });

  test("aria-label after name", () => {
    const { $, document } = dom(`<button aria-label="Close dialog"><svg></svg></button>`);
    expect(first(generateSelectors($("button"), { document }))).toBe('button[aria-label="Close dialog"]');
  });

  test("role and accessible name before css", () => {
    const { $, document } = dom(`<div><button class="btn btn-primary">Sign in</button><button class="btn">Cancel</button></div>`);
    const result = generateSelectors($("button"), { document });
    const kinds = result.candidates.map((c) => c.kind);
    expect(kinds.indexOf("role-name")).toBeGreaterThan(-1);
    expect(kinds.indexOf("role-name")).toBeLessThan(kinds.indexOf("css"));
    const role = result.candidates.find((c) => c.kind === "role-name");
    expect(role?.syntax).toBe("xpath");
    expect(role?.value).toBe('//button[normalize-space(.)="Sign in"]');
    expect(role?.count).toBe(1);
    expect(role?.aria).toBe('Sign in[role="button"]');
  });

  test("short stable css when nothing else is unique", () => {
    const { document } = dom(`<ul class="menu"><li class="item"><a href="#"> </a></li><li class="item"><a href="#"> </a></li></ul>`);
    const el = nth(document, "li", 1);
    const result = generateSelectors(el, { document });
    expect(result.best).not.toBeNull();
    const best = must(result.best);
    expect(best.count).toBe(1);
    expect(document.querySelectorAll(best.value)).toHaveLength(1);
    expect(document.querySelector(best.value)).toBe(el);
  });
});

describe("uniqueness", () => {
  test("a duplicated id is not used", () => {
    const { document } = dom(`<input id="dup"><input id="dup">`);
    const second = nth(document, "input", 1);
    const result = generateSelectors(second, { document });
    const id = result.candidates.find((c) => c.kind === "id");
    expect(id === undefined || id.unique === false).toBe(true);
    const best = must(result.best);
    expect(best.count).toBe(1);
    expect(best.value).not.toBe("#dup");
  });

  test("every candidate that claims to be unique matches exactly one element", () => {
    const { document } = dom(`
      <div class="wrap"><div><div>
        <p tabindex="0" data-probe="deep-1"></p>
        <p tabindex="0" data-probe="deep-2"></p>
      </div></div></div>
      <input data-probe="named" name="q">
      <a data-probe="link-text" tabindex="0">Pricing</a>
      <a data-probe="twice-1" tabindex="0">Docs</a><a data-probe="twice-2" tabindex="0">Docs</a>
      <ul><li data-probe="item-1" tabindex="0">One</li><li data-probe="item-2" tabindex="0">Two</li></ul>
      <button data-probe="icon-button"><span>Save</span></button>`);
    for (const el of document.querySelectorAll("[data-probe]")) {
      const result = generateSelectors(el, { document });
      expect(result.best).not.toBeNull();
      for (const candidate of result.candidates.filter((c) => c.unique && c.syntax === "css")) {
        const found = document.querySelectorAll(candidate.value);
        expect(found).toHaveLength(1);
        expect(found[0]).toBe(el);
      }
      const css = result.candidates.find((c) => c.kind === "css");
      if (css) {
        expect(document.querySelector(css.value)).toBe(el);
      }
    }
  });

  test("an absolute xpath is always available and unique", () => {
    const { document } = dom(`<div><span></span><span></span></div>`);
    const el = nth(document, "span", 1);
    const result = generateSelectors(el, { document });
    const xpath = result.candidates.find((c) => c.kind === "xpath");
    expect(xpath).toBeDefined();
    expect(xpath?.syntax).toBe("xpath");
    expect(xpath?.unique).toBe(true);
    expect(xpath?.value.startsWith("/")).toBe(true);
  });
});

describe("never generated-looking", () => {
  test("generated classes and ids are not used", () => {
    const { $, document } = dom(`<div id=":r1:"><button class="css-1x2y3z sc-bdfBwQ">Pay</button><button class="css-9z8y7x sc-bdfBwQ">Back</button></div>`);
    const result = generateSelectors($("button"), { document });
    for (const value of values(result)) {
      expect(value).not.toContain("css-1x2y3z");
      expect(value).not.toContain("sc-bdfBwQ");
      expect(value).not.toContain(":r1:");
    }
    expect(result.best).not.toBeNull();
  });

  test("a numbered id is skipped", () => {
    const { $, document } = dom(`<input id="field-48213" name="user"><input id="field-48214">`);
    const result = generateSelectors($("input"), { document });
    expect(values(result).every((v) => !v.includes("48213"))).toBe(true);
    expect(first(result)).toBe('input[name="user"]');
  });
});

describe("hostile values", () => {
  test("quotes and backslashes in attributes are escaped", () => {
    const { $, document } = dom(`<input name='say "hi" it&#39;s'><input name="c:\\temp">`);
    const quoted = generateSelectors($("input"), { document });
    expect(document.querySelector(first(quoted))).toBe($("input"));
    const slash = generateSelectors(nth(document, "input", 1), { document });
    expect(document.querySelector(first(slash))).toBe(nth(document, "input", 1));
  });

  test("an id with a dot is matched through an attribute or an escape", () => {
    const { $, document } = dom(`<input id="a.b">`);
    const result = generateSelectors($("input"), { document });
    expect(document.querySelector(first(result))).toBe($("input"));
  });
});

describe("accessible names and roles", () => {
  test("roles", () => {
    const { $, document } = dom(`<a href="/x">x</a><button>b</button><input type="checkbox"><select></select><h2>t</h2><div role="tab">t</div>`);
    expect(roleOf($("a"))).toBe("link");
    expect(roleOf($("button"))).toBe("button");
    expect(roleOf($("input"))).toBe("checkbox");
    expect(roleOf($("select"))).toBe("combobox");
    expect(roleOf($("h2"))).toBe("heading");
    expect(roleOf($("[role=tab]"))).toBe("tab");
    expect(document).toBeDefined();
  });

  test("names", () => {
    const { $ } = dom(`
      <label for="e">Email address</label><input id="e">
      <button aria-label="Close">x</button>
      <input type="submit" value="Go">
      <a href="/p">  Pricing   plans </a>
      <input placeholder="Search here">
      <img alt="Logo">`);
    expect(accessibleName($("#e")).name).toBe("Email address");
    expect(accessibleName($("button")).name).toBe("Close");
    expect(accessibleName($("input[type=submit]")).name).toBe("Go");
    expect(accessibleName($("a")).name).toBe("Pricing plans");
    expect(accessibleName($("input[placeholder]")).name).toBe("Search here");
    expect(accessibleName($("img")).name).toBe("Logo");
  });
});

describe("anchors", () => {
  test("link text is a candidate for a link with unique text", () => {
    const { $, document } = dom(`<a href="/pricing">Pricing</a><a href="/docs">Docs</a>`);
    const result = generateSelectors($("a"), { document });
    const link = result.candidates.find((c) => c.kind === "link-text");
    expect(link?.value).toBe("link=Pricing");
    expect(link?.syntax).toBe("link");
    expect(link?.count).toBe(1);
  });
});
