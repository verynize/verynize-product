// Desktop renderer half of crash reports, built to web/dist/telemetry.js (ISLAND=telemetry, scripts/build-ui.cjs) and
// loaded by web/index.html BEFORE platform.js and every legacy script, so errors while the editor boots are caught.
// It starts @sentry/electron/renderer only when main says reporting is on (desktop/telemetry.cjs passes that through
// window.desktop.telemetry.config()); events then travel over Classic IPC to main, which applies consent and the
// allowlist scrubber again before anything leaves the machine. The web app does not load this file
// (web-start/src/legacy/boot.ts skips it); it starts its own SDK in web-start/src/telemetry.ts.
import { browserTracingIntegration, captureException, init } from "@sentry/electron/renderer";
import { platform } from "@/lib/platform";
import {
  BROWSER_DROPPED,
  originPatterns,
  privacyOptions,
  sampleRate,
} from "@/lib/telemetry/privacy";
import { registerTelemetryRuntime } from "@/lib/telemetry/runtime";
import type { TelemetryRendererConfig } from "@/lib/telemetry/types";

const config: TelemetryRendererConfig = (() => {
  try {
    return platform.desktop?.telemetry?.config() ?? { enabled: false };
  } catch {
    return { enabled: false };
  }
})();

let active = config.enabled === true;

if (active) {
  init({
    ...privacyOptions(() => active),
    release: config.release || undefined,
    environment: config.environment || undefined,
    tracesSampleRate: sampleRate(config.tracesSampleRate, 0),
    tracePropagationTargets: originPatterns(config.tracePropagationOrigins ?? []),
    // Console calls are never recorded (agent logs carry prompts and paths); no replay, no feedback widget.
    integrations: (defaults) => [
      ...defaults.filter((integration) => !BROWSER_DROPPED.has(integration.name)),
      browserTracingIntegration(),
    ],
  });
}

registerTelemetryRuntime({
  available: active,
  get active() {
    return active;
  },
  captureException(error, context) {
    if (!active) return;
    captureException(error, {
      mechanism: { type: context?.mechanism ?? "generic", handled: true },
      captureContext: context?.componentStack
        ? { contexts: { react: { componentStack: context.componentStack } } }
        : undefined,
    });
  },
  async stop() {
    active = false;
  },
});
