# bridge (placeholder)

The live bridge between the extension and a running seleniumbase-rs process. Nothing here yet.

To build it:

1. Change `feature.json` to describe the feature (remove `"enabled": false`), for example

   ```json
   {
     "background": "background.ts",
     "panelViews": "view.ts",
     "manifest": { "optional_permissions": ["nativeMessaging"] }
   }
   ```

2. `background.ts` registers its message types with `registerHandler` (`../background/router.ts`); message type
   names start with `bridge/` and are added to `src/shared/protocol.ts`.
3. `view.ts` calls `registerView` (`../ui/registry.ts`) to add a tab to the panel.
4. Any permission is added to the allow list in `scripts/lint.ts` on purpose, and explained in the README.

See "Layout and extension points" in the top-level README for what the build does with each field.
