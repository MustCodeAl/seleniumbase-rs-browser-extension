---
title: "bridge (placeholder)"
---

# bridge (placeholder)

The live bridge between the extension and a running seleniumbase-rs process. Nothing here yet.

To build it:

1. Change `feature.json` to describe the feature (remove `"enabled": false`), for example

   ```json
   {
     "background": "background.js",
     "panelViews": "view.js",
     "manifest": { "optional_permissions": ["nativeMessaging"] }
   }
   ```

2. `background.js` registers its message types with `registerHandler` (`../background/router.js`); message type
   names start with `bridge/` and are added to `src/shared/protocol.js`.
3. `view.js` calls `registerView` (`../ui/registry.js`) to add a tab to the panel.
4. Any permission is added to the allow list in `scripts/lint.ts` on purpose, and explained in the README.

See "Layout and extension points" in the top-level README for what the build does with each field.
