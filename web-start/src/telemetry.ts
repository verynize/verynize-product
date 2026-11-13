// Web client half of crash reports (verynize-web). Imported first by client.tsx (the browser entry), so it runs
// before hydration and before the legacy editor boots; never part of the server bundle. Opt-in: the SDK starts only when this build has a DSN (SENTRY_DSN_WEB at build time,
// web-start/build/telemetry.mjs) AND the visitor turned on Settings › Preferences › Privacy (localStorage, off by
// default). Turning it off closes the client at once; turning it on takes effect on the next page load.
// Events pass the shared allowlist scrubber (web/telemetry-scrub.js); console breadcrumbs, replays and feedback are
// off. Traces propagate only to this origin (the backend paths of the same deployment).
import * as Sentry from "@sentry/tanstackstart-react";
import {
  BROWSER_DROPPED,
  originPatterns,
  privacyOptions,
  sampleRate,
} from "@/lib/telemetry/privacy";
import {
  readWebConsent,
  registerTelemetryRuntime,
  WEB_CONSENT_KEY,
  type TelemetryRuntime,
} from "@/lib/telemetry/runtime";
import { onRouterCreated } from "./router-created";

function startWebTelemetry() {
  const build = __VERYNIZE_SENTRY_WEB__;
  const available = !!build.dsn;
  let active = available && readWebConsent();
  if (active) {
    Sentry.init({
      dsn: build.dsn,
      release: build.release || undefined,
      environment: build.environment || "production",
      sampleRate: sampleRate(build.sampleRate, 1),
      tracesSampleRate: sampleRate(build.tracesSampleRate, 0.05),
      // Same-origin requests only: relative URLs and this origin.
      tracePropagationTargets: [/^\/(?!\/)/, ...originPatterns([location.origin])],
      integrations: (defaults) =>
        defaults.filter((integration) => !BROWSER_DROPPED.has(integration.name)),
      initialScope: { tags: { surface: "web" } },
      // The stored choice is re-read per event: another tab may have turned reports off.
      ...privacyOptions(() => active && readWebConsent()),
    });
    // Route-based pageload and navigation spans, once getRouter() created the router.
    onRouterCreated((router) =>
      Sentry.addIntegration(Sentry.tanstackRouterBrowserTracingIntegration(router)),
    );
  }
  const runtime: TelemetryRuntime = {
    available,
    get active() {
      return active;
    },
    captureException(error, context) {
      if (!active) return;
      Sentry.captureException(error, {
        mechanism: { type: context?.mechanism ?? "generic", handled: true },
        captureContext: context?.componentStack
          ? { contexts: { react: { componentStack: context.componentStack } } }
          : undefined,
      });
    },
    async stop() {
      if (!active) return;
      active = false;
      await Sentry.close(2000);
    },
  };
  registerTelemetryRuntime(runtime);
  // Opting out in another tab (or clearing site data) closes this tab's client too.
  if (active)
    addEventListener("storage", (event) => {
      if ((event.key === WEB_CONSENT_KEY || event.key === null) && !readWebConsent())
        void runtime.stop();
    });
}

startWebTelemetry();
