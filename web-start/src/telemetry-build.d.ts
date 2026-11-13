// Build-time crash-report settings, defined by web-start/build/telemetry.mjs.
type VerynizeSentryBuild = {
  dsn: string;
  release: string;
  environment: string;
  sampleRate?: number;
  tracesSampleRate?: number;
};
declare const __VERYNIZE_SENTRY_WEB__: VerynizeSentryBuild;
declare const __VERYNIZE_SENTRY_SERVER__: VerynizeSentryBuild;
