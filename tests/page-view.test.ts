import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type PageProbe, toFingerprint } from "../src/shared/fingerprint.ts";
import { isElement } from "../src/shared/dom.ts";
import { MSG, type Replies } from "../src/shared/protocol.ts";
import { type ViewContext, views } from "../src/ui/registry.ts";
import "../src/ui/views/page.ts"; // registers the view
import { type InstalledDom, installDom } from "./dom.ts";
import { must } from "./support.ts";

const GOLDEN = join(import.meta.dir, "golden", "fingerprints");
const probeText = (name: string) => readFileSync(join(GOLDEN, "probes", `${name}.json`), "utf8");
// JSON.parse is untyped; the file is a probe report.
const probeOf = (name: string) => JSON.parse(probeText(name)) as PageProbe;

let page: InstalledDom;
const realFetch = globalThis.fetch;
let fetched: unknown[];

beforeEach(() => {
  page = installDom("");
  fetched = [];
  // The panel sends nothing anywhere: a request would be recorded here.
  globalThis.fetch = ((...args: unknown[]) => {
    fetched.push(args);
    return Promise.reject(new Error("the Page tab must not use the network"));
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  page.restore();
});

/** Lets the promises the view started (a probe, a file read) finish. */
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

interface Mounted {
  root: HTMLElement;
  notices: (string | null)[];
  probes: unknown[];
  /** Shows the tab, as the panel does when it is selected. */
  show(): Promise<void>;
  button(name: string): HTMLButtonElement;
  buttons(): string[];
  /** Picks `file` in the view's file input, as a person does in the browser's file dialog. */
  pick(file: File): Promise<void>;
  picker: HTMLInputElement;
}

function mount(probeName = "chrome-macos"): Mounted {
  const view = must(
    views.find((v) => v.id === "page"),
    "the page view",
  );
  const root = page.document.createElement("section");
  page.document.body.append(root);
  const probe = probeOf(probeName);
  const reply: Replies[typeof MSG.INSPECTOR_PROBE] = { probe, fingerprint: toFingerprint(probe) };
  const notices: (string | null)[] = [];
  const probes: unknown[] = [];
  const ctx: ViewContext = {
    call: async <K extends keyof Replies>(type: K, payload?: Record<string, unknown>): Promise<Replies[K]> => {
      if (type !== MSG.INSPECTOR_PROBE) throw new Error(`the Page tab sent ${type}`);
      probes.push(payload);
      // The reply table types each message; this one is the probe's.
      return reply as unknown as Replies[K];
    },
    activeTab: () => Promise.resolve({ id: 7 } as chrome.tabs.Tab),
    notify: (text) => notices.push(text ?? null),
    params: new URLSearchParams(),
    onChange: () => undefined,
  };
  view.render(root, ctx);

  const all = () => [...root.querySelectorAll("button")];
  const nameOf = (b: Element) => b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "";
  const picker = must(root.querySelector<HTMLInputElement>('input[type="file"]'), "the file input");
  return {
    root,
    notices,
    probes,
    show: async () => {
      await view.show?.(root, ctx);
      await settle();
    },
    button: (name) => must(all().find((b) => nameOf(b) === name || b.textContent?.trim() === name), `a button named ${name}`),
    buttons: () => all().map(nameOf),
    picker,
    pick: async (file) => {
      Object.defineProperty(picker, "files", { value: [file], configurable: true });
      // happy-dom's Event is declared apart from lib.dom's; it is the one its elements dispatch.
      picker.dispatchEvent(new page.window.Event("change") as unknown as Event);
      await settle();
    },
  };
}

const jsonFile = (text: string, name = "fingerprint.json") => new File([text], name, { type: "application/json" });
const text = (el: Element) => el.textContent ?? "";

describe("the Page tab before a page is read", () => {
  test("offers to read the page, and to import a file", () => {
    const view = mount();
    expect(view.buttons()).toEqual(["Read this page", "Import a Fingerprint JSON file and compare it with this page"]);
    expect(text(view.root)).toContain("Press Read this page");
  });
});

describe("the Page tab with a page read", () => {
  test("shows Capture again, Copy, Export and Import, each with a name that says what it does", async () => {
    const view = mount();
    await view.show();
    expect(view.buttons()).toEqual([
      "Capture again",
      "Copy Fingerprint JSON",
      "Export Fingerprint JSON as a file",
      "Import a Fingerprint JSON file and compare it with this page",
      "Copy the full report",
    ]);
    // Every control is a real button, so Tab and Enter or Space work; none jumps the tab order.
    for (const b of view.root.querySelectorAll("button")) {
      expect(b.getAttribute("type")).toBe("button");
      expect(b.hasAttribute("tabindex")).toBe(false);
      // The accessible name (the label, else the text) contains the visible word.
      const visible = (b.textContent ?? "").trim();
      const name = b.getAttribute("aria-label") ?? visible;
      expect(name.toLowerCase()).toContain(visible.toLowerCase());
    }
    expect(view.root.querySelectorAll('[role="group"][aria-labelledby]')).toHaveLength(2);
    expect(view.picker.hasAttribute("hidden")).toBe(true);
    expect(view.picker.getAttribute("accept")).toBe(".json,application/json");
    expect(view.picker.getAttribute("aria-label")).toBeTruthy();
  });

  test("Capture again reads the page again and keeps the keyboard on the button", async () => {
    const view = mount();
    await view.show();
    expect(view.probes).toEqual([{ tabId: 7 }]);
    view.button("Capture again").click();
    await settle();
    expect(view.probes).toHaveLength(2);
    const active = page.document.activeElement;
    expect(active && text(active)).toBe("Capture again");
  });

  test("Import opens the file dialog from the keyboard-reachable button", async () => {
    const view = mount();
    await view.show();
    let opened = 0;
    view.picker.addEventListener("click", () => {
      opened += 1;
    });
    view.button("Import a Fingerprint JSON file and compare it with this page").click();
    expect(opened).toBe(1);
  });

  test("Export saves fingerprint-<host>-<date>.json holding exactly the JSON that Copy gives", async () => {
    const view = mount();
    await view.show();
    const saved: { name: string | null; href: string | null }[] = [];
    page.document.addEventListener("click", (event) => {
      const target = event.target;
      if (isElement(target) && target.tagName === "A") {
        saved.push({ name: target.getAttribute("download"), href: target.getAttribute("href") });
        event.preventDefault();
      }
    });
    const blobs: Blob[] = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob) blobs.push(object);
      return create.call(URL, object);
    };
    try {
      view.button("Export Fingerprint JSON as a file").click();
    } finally {
      URL.createObjectURL = create;
    }
    expect(saved).toHaveLength(1);
    expect(saved[0]?.name).toBe(`fingerprint-example.com-${new Date().toLocaleDateString("sv-SE")}.json`);
    expect(saved[0]?.href).toMatch(/^blob:/);
    expect(await blobs[0]?.text()).toBe(readFileSync(join(GOLDEN, "page", "chrome-macos.json"), "utf8"));
    expect(view.button("Exported")).toBeTruthy();
    expect(view.notices.filter((n) => n !== null)).toEqual([]);
  });

  test("Export is not offered before there is a fingerprint to save", () => {
    const view = mount();
    expect(view.buttons().some((b) => b.startsWith("Export"))).toBe(false);
  });
});

describe("importing a file", () => {
  test("a fingerprint the page itself would write matches on every row", async () => {
    const view = mount();
    await view.show();
    await view.pick(jsonFile(readFileSync(join(GOLDEN, "page", "chrome-macos.json"), "utf8"), "mine.json"));
    const section = must(view.root.querySelector("section.compare"));
    expect(text(must(section.querySelector("h3")))).toBe("mine.json compared with this page");
    const rows = [...section.querySelectorAll("tbody tr")];
    expect(rows.length).toBeGreaterThan(15);
    for (const r of rows) expect(text(must(r.querySelector(".verdict")))).toBe("match");
    expect(text(must(section.querySelector('[role="status"]')))).toMatch(/^\d+ match, 0 differ, 0 not observable\.$/);
    // The table reads as a table: columns have headings, rows have a heading.
    expect([...section.querySelectorAll("thead th")].map((th) => [text(th), th.getAttribute("scope")])).toEqual([
      ["Setting", "col"],
      ["File", "col"],
      ["This page", "col"],
      ["Result", "col"],
    ]);
    expect(rows.every((r) => r.querySelector('th[scope="row"]'))).toBe(true);
    // The table is named by the heading above it.
    const labelledby = must(section.querySelector("table")).getAttribute("aria-labelledby");
    expect(page.document.getElementById(must(labelledby))?.tagName).toBe("H3");
    // The keyboard lands on the result.
    expect(page.document.activeElement?.getAttribute("id")).toBe("fp-compare-title");
  });

  test("shows the setting, the file's value, the page's value and the verdict", async () => {
    const view = mount();
    await view.show();
    await view.pick(
      jsonFile(
        JSON.stringify({ hardware_concurrency: 16, timezone: "random", geolocation: { latitude: 1, longitude: 2 }, client_hints: "off" }),
      ),
    );
    const rows = [...view.root.querySelectorAll("section.compare tbody tr")].map((r) => [...r.children].map((c) => text(c)));
    expect(rows).toEqual([
      ["Hardware concurrency", "16", "8", "differs"],
      ["Time zone", "random", "Europe/Paris", "not observablerandom: a value is drawn when the fingerprint is built"],
      ["Geolocation", '{"latitude":1,"longitude":2}', "n/a", "not observablea page cannot read this"],
      ["Client Hints", "off", expect.stringContaining("Chromium 155"), "differsthe file turns it off; the page has it"],
    ]);
    expect(text(must(view.root.querySelector('section.compare [role="status"]')))).toBe("0 match, 2 differ, 2 not observable.");
  });

  test("a file in the old flat shape is refused in the panel, naming the field", async () => {
    const view = mount();
    await view.show();
    await view.pick(jsonFile('{ "screen_width": 1920, "screen_height": 1080, "flags": {} }', "old.json"));
    const alert = must(view.root.querySelector('[role="alert"]'));
    expect(text(alert)).toContain("old.json is not a seleniumbase-rs 0.5 fingerprint.");
    expect(text(alert)).toContain("`screen_width`");
    expect(text(alert)).toContain("old flat shape");
    expect(view.root.querySelector("section.compare table")).toBeNull();
    // The keyboard goes back to Import so another file can be tried.
    expect(page.document.activeElement?.getAttribute("aria-label")).toStartWith("Import");
  });

  test("a file that is not JSON is refused in the panel", async () => {
    const view = mount();
    await view.show();
    await view.pick(jsonFile("this is not json", "notes.json"));
    expect(text(must(view.root.querySelector('[role="alert"]')))).toContain("not valid JSON");
  });

  test("an off where it means nothing is refused with the setting named", async () => {
    const view = mount();
    await view.show();
    await view.pick(jsonFile('{ "timezone": "off" }'));
    expect(text(must(view.root.querySelector('[role="alert"]')))).toContain('`timezone`: "off" is refused');
  });

  test("a file picked before the page was read starts the read, then compares", async () => {
    const view = mount();
    await view.pick(jsonFile('{ "timezone": "Europe/Paris" }', "early.json"));
    expect(view.probes).toHaveLength(1);
    const row = must(view.root.querySelector("section.compare tbody tr"));
    expect([...row.children].map(text)).toEqual(["Time zone", "Europe/Paris", "Europe/Paris", "match"]);
  });

  test("the comparison follows the page when it is captured again", async () => {
    const view = mount();
    await view.show();
    await view.pick(jsonFile('{ "timezone": "Europe/Paris" }'));
    view.button("Capture again").click();
    await settle();
    expect(view.root.querySelectorAll("section.compare tbody tr")).toHaveLength(1);
  });

  test("Clear removes the comparison", async () => {
    const view = mount();
    await view.show();
    await view.pick(jsonFile('{ "timezone": "Europe/Paris" }'));
    view.button("Clear the comparison").click();
    expect(view.root.querySelector("section.compare")).toBeNull();
  });

  test("a file with nothing set says there is nothing to compare", async () => {
    const view = mount();
    await view.show();
    await view.pick(jsonFile("{}", "empty.json"));
    expect(text(must(view.root.querySelector('section.compare [role="status"]')))).toBe("empty.json leaves every setting to the browser, so there is nothing to compare.");
    expect(view.root.querySelector("section.compare table")).toBeNull();
  });

  test("the file's text is shown as text, never as markup", async () => {
    const view = mount();
    await view.show();
    await view.pick(jsonFile(JSON.stringify({ user_agent: '<img src=x onerror="alert(1)">' }), "<b>x</b>.json"));
    expect(view.root.querySelector("img")).toBeNull();
    expect(view.root.querySelector("b")).toBeNull();
    expect(text(view.root)).toContain('<img src=x onerror="alert(1)">');
  });
});

describe("what the Page tab never does", () => {
  test("it sends nothing but the probe request, and uses no network", async () => {
    const view = mount();
    await view.show();
    await view.pick(jsonFile('{ "timezone": "Europe/Paris" }'));
    view.button("Capture again").click();
    await settle();
    expect(view.probes.every((p) => JSON.stringify(p) === '{"tabId":7}')).toBe(true);
    expect(fetched).toEqual([]);
  });
});
