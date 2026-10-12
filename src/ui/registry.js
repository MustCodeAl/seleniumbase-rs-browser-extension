// The panel's views (the tabs). A feature adds one without touching the panel:
// give its feature.json `"panelViews": "view.js"` and, in that module,
//
//     import { registerView } from "../ui/registry.js";
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

export const views = [];

export function registerView(view) {
  if (views.some((v) => v.id === view.id)) throw new Error(`view ${view.id} is already registered`);
  views.push({ order: 100, ...view });
}
