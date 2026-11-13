// Types shared by the crash-report code (desktop/telemetry.cjs, desktop/preload.cjs, web/src/telemetry.ts, the
// settings toggle). Types only: web/src/lib/desktop-api.ts imports them under Node's type stripping.

/** Renderer SDK settings that main passes to the editor window (no DSN: renderer events travel through main). */
export type TelemetryRendererConfig = {
  enabled: boolean;
  environment?: string;
  release?: string;
  tracesSampleRate?: number;
  /** Origins (scheme://host[:port]) that receive sentry-trace/baggage headers. */
  tracePropagationOrigins?: string[];
};

/** The opt-in state behind Settings › Preferences › Privacy. */
export type TelemetryStatus = {
  /** The user's choice (off by default). */
  enabled: boolean;
  /** Reports are being sent in this session. */
  active: boolean;
  /** This build has a reporting destination (a DSN). */
  available: boolean;
  /** On, but takes effect after a restart (desktop) or a reload (web). */
  restartRequired: boolean;
  /** Desktop: the user answered at least once (the first-launch question or the setting). */
  asked?: boolean;
};

/** window.desktop.telemetry (desktop/preload.cjs). */
export type TelemetryIpc = {
  config(): TelemetryRendererConfig;
  get(): Promise<TelemetryStatus>;
  set(enabled: boolean): Promise<TelemetryStatus>;
};
