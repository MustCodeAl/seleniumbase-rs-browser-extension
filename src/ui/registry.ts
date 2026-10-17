// The panel's views (the tabs). A feature adds one without touching the panel:
// give its feature.json `"panelViews": "view.ts"` and, in that module,
//
//     import { registerView } from "../ui/registry.ts";
//     registerView({
//       id: "bridge",
//       title: "Bridge",
//       order: 40,
//       // Called once. `root` is the view's element. `ctx` has:
//       //   call(type, payload)  send a message to the background; resolves to the reply or throws
//       //   activeTab()          the tab the panel is about (the active one, or ?tabId=N)
//       //   notify(text)         show a notice under the tabs (null clears it)
//       //   onChange(area, fn)   run fn when the background broadcasts a change of `area`
//       render(root, ctx) {},
//       // Optional: called each time the tab is shown.
//       show(root, ctx) {},
//     });
//
// The build bundles the module into the panel (scripts/build.ts).

import type { Replies } from "../shared/protocol.ts";

/** What a view is given: the panel's side of the extension. */
export interface ViewContext {
  /** Sends a message to the background; resolves to the reply's fields or throws. */
  call<K extends keyof Replies>(type: K, payload?: Record<string, unknown>): Promise<Replies[K]>;
  /** The tab the panel is about: the active one, or the one in `?tabId=N`. */
  activeTab(): Promise<chrome.tabs.Tab>;
  /** Shows a notice under the tabs; null clears it. */
  notify(text: string | null | undefined): void;
  params: URLSearchParams;
  /** Runs `fn` when the background broadcasts a change of `area`. */
  onChange(area: string, fn: () => void): void;
}

/** A tab of the panel. */
export interface View {
  id: string;
  title: string;
  /** Where the tab goes among the others (lowest first); 100 if omitted. */
  order?: number;
  /** Called once. `root` is the view's element. */
  render(root: HTMLElement, ctx: ViewContext): void;
  /** Optional: called each time the tab is shown. */
  show?(root: HTMLElement, ctx: ViewContext): void | Promise<void>;
}

export type RegisteredView = View & { order: number };

export const views: RegisteredView[] = [];

export function registerView(view: View): void {
  if (views.some((v) => v.id === view.id)) throw new Error(`view ${view.id} is already registered`);
  views.push({ order: 100, ...view });
}
