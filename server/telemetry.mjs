// Crash reports (verynize-server) for the Node backends: server/node.mjs ("node") and api/server.mjs
// ("vercel"). The Cloudflare Worker uses web-start/src/server-telemetry.ts instead. `environment`
// defaults to the target, so one project tells the deployments apart.
//
//   SENTRY_DSN_SERVER          verynize-server DSN; unset → nothing is loaded or sent
//   SENTRY_ENVIRONMENT         default: the target name
//   SENTRY_RELEASE             default: the deploy commit (VERCEL_GIT_COMMIT_SHA, GITHUB_SHA)
//   SENTRY_SAMPLE_RATE         errors, default 1
//   SENTRY_TRACES_SAMPLE_RATE  transactions, default 0.05
//
// Events pass the shared allowlist scrubber (web/telemetry-scrub.js): no user, IP, headers, bodies,
// cookies, query strings, local variables or source lines. cloud/telemetry.js reports the errors the
// Worker code catches.
import "../web/telemetry-scrub.js";

const scrub = globalThis.verynizeTelemetryScrub;
const DROPPED = new Set(["LocalVariables", "ContextLines", "Console", "Modules"]);

const rate = (value, fallback) => {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback;
};

/** Starts @sentry/node when SENTRY_DSN_SERVER is set. Resolves to whether it started. */
export async function startServerTelemetry(target, env = process.env) {
  const dsn = env.SENTRY_DSN_SERVER;
  if (!dsn) return false;
  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn,
    release: env.SENTRY_RELEASE || env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || undefined,
    environment: env.SENTRY_ENVIRONMENT || target,
    sampleRate: rate(env.SENTRY_SAMPLE_RATE, 1),
    tracesSampleRate: rate(env.SENTRY_TRACES_SAMPLE_RATE, 0.05),
    sendDefaultPii: false,
    dataCollection: scrub.DATA_COLLECTION,
    includeLocalVariables: false,
    maxBreadcrumbs: 50,
    integrations: (defaults) => defaults.filter((integration) => !DROPPED.has(integration.name)),
    initialScope: { tags: { surface: "server", runtime_target: target } },
    beforeBreadcrumb: (breadcrumb) => scrub.scrubBreadcrumb(breadcrumb),
    beforeSend: (event) => scrub.scrubEvent(event),
    beforeSendSpan: (span) => scrub.scrubStreamedSpan(span),
  });
  return true;
}
