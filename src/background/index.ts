// The background entry: the one bundle every feature's background module joins
// (scripts/build.ts imports this file first, then each feature's `background`).

import { ext } from "../shared/api.ts";
import { MSG } from "../shared/protocol.ts";
import { installRouter, registerHandler } from "./router.ts";

registerHandler(
  MSG.PING,
  () => ({
    name: ext.runtime.getManifest().name,
    version: ext.runtime.getManifest().version,
    browser: typeof __BROWSER__ === "undefined" ? "unknown" : __BROWSER__,
  }),
  "any",
);

installRouter();
