// Options shared by the Cloudflare (vite.config.ts) and Node (vite.node.config.ts) builds of the
// TanStack Start web app in web-start/.
import { fileURLToPath } from "node:url";
import { legacyWeb } from "./legacy-web.mjs";
import { webTelemetry } from "./telemetry.mjs";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const webDir = fileURLToPath(new URL("../../web", import.meta.url));
export const srcDirectory = "web-start/src";

/**
 * Plugins common to both targets (Start itself is added by each config); crash-report build settings last.
 * `staticHeaders`: emit Cloudflare's `_headers` (the Node server sets cache headers itself).
 */
export const sharedPlugins = ({ staticHeaders = false } = {}) => [
  ...legacyWeb({ webDir, staticHeaders }),
  ...webTelemetry(),
];
