// The page's crash-report runtime, whichever SDK started it (desktop renderer: web/src/telemetry.ts; web client:
// web-start/src/telemetry.ts): React root error hooks (lib/mount.tsx) report through it, and the settings toggle
// reads and changes the opt-in through telemetryStatus / setTelemetryEnabled. Nothing here starts an SDK.
import { platform } from "@/lib/platform";
import type { TelemetryStatus } from "./types";

export type { TelemetryStatus } from "./types";

export type TelemetryRuntime = {
  /** This page has a reporting destination (desktop: main said reporting is on; web: a DSN was built in). */
  readonly available: boolean;
  /** Reports are being sent now. */
  readonly active: boolean;
  captureException(error: unknown, context?: { mechanism?: string; componentStack?: string }): void;
  /** Opt-out: stop sending at once. */
  stop(): Promise<void>;
};

declare global {
  var verynizeTelemetry: TelemetryRuntime | undefined;
}

/** Web opt-in (localStorage); the desktop keeps it in userData/telemetry.json (desktop/telemetry.cjs). */
export const WEB_CONSENT_KEY = "verynize:telemetry";

export function readWebConsent(): boolean {
  try {
    return globalThis.localStorage?.getItem(WEB_CONSENT_KEY) === "on";
  } catch {
    return false;
  }
}

export function registerTelemetryRuntime(runtime: TelemetryRuntime) {
  globalThis.verynizeTelemetry = runtime;
}

/** Report an error when crash reports are on; a no-op otherwise. */
export function reportError(
  error: unknown,
  context?: { mechanism?: string; componentStack?: string },
) {
  try {
    globalThis.verynizeTelemetry?.captureException(error, context);
  } catch {}
}

const webStatus = (): TelemetryStatus => {
  const runtime = globalThis.verynizeTelemetry;
  const enabled = readWebConsent();
  const available = !!runtime?.available;
  const active = !!runtime?.active;
  return { enabled, active, available, restartRequired: enabled && available && !active };
};

/** The opt-in state, or null where this runtime cannot report at all. */
export async function telemetryStatus(): Promise<TelemetryStatus | null> {
  const ipc = platform.desktop?.telemetry;
  if (ipc) return ipc.get();
  return webStatus();
}

export async function setTelemetryEnabled(enabled: boolean): Promise<TelemetryStatus> {
  const ipc = platform.desktop?.telemetry;
  if (!enabled) await globalThis.verynizeTelemetry?.stop();
  if (ipc) return ipc.set(enabled);
  try {
    globalThis.localStorage?.setItem(WEB_CONSENT_KEY, enabled ? "on" : "off");
  } catch {}
  return webStatus();
}
