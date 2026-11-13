// SDK options every browser-side Sentry client uses (desktop renderer: web/src/telemetry.ts; web client:
// web-start/src/telemetry.ts). The scrubber itself is web/telemetry-scrub.js, shared with the main process and the
// servers; see its header for what an event may contain.
import "../../../telemetry-scrub.js";
import type { Breadcrumb, DataCollection, ErrorEvent, Event, StreamedSpanJSON } from "@sentry/core";

export type TelemetryScrub = {
  scrubString(value: unknown): string;
  scrubUrl(value: string): string;
  scrubEvent<T extends Event>(event: T): T | null;
  scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null;
  scrubStreamedSpan(span: StreamedSpanJSON): StreamedSpanJSON;
  setLiterals(values: string[]): void;
  readonly DATA_COLLECTION: DataCollection;
};

declare global {
  var verynizeTelemetryScrub: TelemetryScrub;
}

export const scrub: TelemetryScrub = globalThis.verynizeTelemetryScrub;

/** Default browser integrations left out: console breadcrumbs (agent logs carry prompts and paths), locale/timezone. */
export const BROWSER_DROPPED: ReadonlySet<string> = new Set(["Console", "CultureContext"]);

/** Privacy options for Sentry.init; `allowed()` is the live consent check (false → nothing is sent). */
export function privacyOptions(allowed: () => boolean) {
  return {
    sendDefaultPii: false,
    dataCollection: scrub.DATA_COLLECTION,
    maxBreadcrumbs: 50,
    beforeBreadcrumb: (breadcrumb: Breadcrumb) => scrub.scrubBreadcrumb(breadcrumb),
    beforeSend: (event: ErrorEvent) => (allowed() ? scrub.scrubEvent(event) : null),
    // Traces are streamed spans (the SDK's default lifecycle; beforeSendTransaction is ignored). A span cannot be
    // dropped here, so consent is enforced by not starting the SDK, and by closing it on opt-out.
    beforeSendSpan: (span: StreamedSpanJSON) => scrub.scrubStreamedSpan(span),
  };
}

/** `^origin(/|$)` patterns for tracePropagationTargets: a plain string would also match https://host.evil.example. */
export const originPatterns = (origins: readonly string[]) =>
  origins
    .filter((origin) => /^https?:\/\/[^/]+$/.test(origin))
    .map((origin) => new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/|$)`));

/** A sample rate between 0 and 1, or the fallback. */
export const sampleRate = (value: unknown, fallback: number) => {
  if (value === undefined || value === null || value === "") return fallback;
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : fallback;
};
