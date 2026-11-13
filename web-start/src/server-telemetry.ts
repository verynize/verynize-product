// Server half of crash reports (verynize-server) for the Cloudflare Worker (server.cloudflare.ts). The Node and
// Vercel backends use server/telemetry.mjs with the same scrubber; `environment` tells the targets apart.
//
// DSN: the Worker's SENTRY_DSN_SERVER (a secret or var, read per request), else the one built in from
// SENTRY_DSN_SERVER at build time (web-start/build/telemetry.mjs). Neither → the SDK stays disabled.
// These are the operator's own server errors: no visitor consent applies, so events are scrubbed by the same
// allowlist (no user, IP, headers, bodies, cookies or query strings) and never carry document content.
import type { CloudflareOptions } from "@sentry/cloudflare";
import { privacyOptions, sampleRate } from "@/lib/telemetry/privacy";

type SentryEnv = {
  SENTRY_DSN_SERVER?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_RELEASE?: string;
  SENTRY_SAMPLE_RATE?: string;
  SENTRY_TRACES_SAMPLE_RATE?: string;
};

export function serverOptions(env: unknown, target: string): CloudflareOptions {
  const vars = (env && typeof env === "object" ? env : {}) as SentryEnv;
  const build = __VERYNIZE_SENTRY_SERVER__;
  const dsn = vars.SENTRY_DSN_SERVER || build.dsn;
  if (!dsn) return { enabled: false };
  return {
    dsn,
    release: vars.SENTRY_RELEASE || build.release || undefined,
    environment: vars.SENTRY_ENVIRONMENT || build.environment || target,
    sampleRate: sampleRate(vars.SENTRY_SAMPLE_RATE ?? build.sampleRate, 1),
    tracesSampleRate: sampleRate(vars.SENTRY_TRACES_SAMPLE_RATE ?? build.tracesSampleRate, 0.05),
    initialScope: { tags: { surface: "server", runtime_target: target } },
    ...privacyOptions(() => true),
  };
}
