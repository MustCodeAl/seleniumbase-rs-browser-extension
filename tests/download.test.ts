import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isElement } from "../src/shared/dom.ts";
import { downloadFile } from "../src/shared/download.ts";
import { type InstalledDom, installDom } from "./dom.ts";

let page: InstalledDom;
beforeEach(() => {
  page = installDom("");
});
afterEach(() => {
  page.restore();
});

describe("downloadFile", () => {
  test("clicks a link that carries the file name and the Blob's address, then removes it", async () => {
    const clicked: { download: string | null; href: string | null }[] = [];
    page.document.addEventListener("click", (event) => {
      const target = event.target;
      if (isElement(target) && target.tagName === "A") {
        clicked.push({ download: target.getAttribute("download"), href: target.getAttribute("href") });
        event.preventDefault();
      }
    });

    downloadFile({ filename: "fingerprint-example.com-2026-10-18.json", mime: "application/json", text: "{}\n" });

    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe("fingerprint-example.com-2026-10-18.json");
    expect(clicked[0]?.href).toMatch(/^blob:/);
    // Nothing is left behind in the page.
    expect(page.document.querySelectorAll("a")).toHaveLength(0);
  });

  test("the Blob holds the text and the type it was given", async () => {
    const blobs: Blob[] = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob) blobs.push(object);
      return create.call(URL, object);
    };
    try {
      downloadFile({ filename: "a.json", mime: "application/json", text: '{"a":1}\n' });
    } finally {
      URL.createObjectURL = create;
    }
    expect(blobs).toHaveLength(1);
    // Some runtimes append a charset to a text type.
    expect(blobs[0]?.type).toStartWith("application/json");
    expect(await blobs[0]?.text()).toBe('{"a":1}\n');
  });
});
