// Error reports from the collaboration backend. A no-op unless the entry point started a Sentry SDK
// (web-start/src/server.cloudflare.ts on Cloudflare, server/telemetry.mjs on Node and Vercel); the
// event then passes that SDK's allowlist scrubber (web/telemetry-scrub.js).
import { errorStatus } from "./http.js";
import { captureException } from "@sentry/core";

/** Report server failures; expected 4xx responses are not Sentry errors. */
export function reportError(error, area) {
  if (errorStatus(error) < 500) return;
  try {
    captureException(error, {
      mechanism: { type: "verynize.cloud", handled: true },
      captureContext: { tags: { area } },
    });
  } catch {}
}
