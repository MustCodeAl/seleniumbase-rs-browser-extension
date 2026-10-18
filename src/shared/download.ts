// Save text as a file from a click: a Blob behind an `<a download>` that is clicked
// and removed. It needs no extension permission (the `downloads` API would), works
// in an extension page of Chrome and of Firefox, and leaves the browser to name the
// place the file goes. The recorder's export and the Page tab's fingerprint export
// both use it.

import { h } from "./dom.ts";
import type { ExportedFile } from "./protocol.ts";

/** Offers `file` to the person as a download. */
export function downloadFile(file: ExportedFile): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.mime }));
  try {
    const link = h("a", { href: url, download: file.filename });
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // The click has started the download; the address can go once the browser has read it.
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
