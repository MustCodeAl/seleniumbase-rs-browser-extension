// Globals the build defines for the extension code (scripts/build.ts, `define`).

/** The browser a bundle was built for. */
declare const __BROWSER__: "chrome" | "firefox";

/** What the content scripts leave on the page's `window` (in their own world) so a second injection finds the first. */
interface Window {
  /** The recorder (recorder/content.ts). */
  __sbrsRecorder?: { attach(): Promise<void>; detach(): void };
  /** The element picker (inspector/content.ts). */
  __sbrsInspector?: { start(): void; stop(): void };
}
