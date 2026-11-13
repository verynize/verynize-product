// Cloudflare Worker entry for the browser deployment (`entrypoint` in cloudflare.config.ts).
//
// It composes the existing cloud Worker with Start without touching cloud/ internals: it depends
// only on cloud/worker.js's default `{ fetch }` and its named Durable Object classes.
// - Backend paths (web-start/worker-paths.mjs) and every WebSocket upgrade go to the cloud Worker,
//   so room sockets (`/api/rooms/<id>/socket`) still reach the DesignRoom Durable Object.
// - Everything else is rendered by Start (the editor routes send a client-only shell).
// - The Durable Object classes are re-exported because the bindings in cloudflare.config.ts name
//   this Worker's exports.
// - Crash reports (./server-telemetry.ts): the handler and every Durable Object are wrapped with
//   @sentry/cloudflare, which continues incoming sentry-trace/baggage headers and reports thrown errors.
//   Without SENTRY_DSN_SERVER the SDK stays disabled.
import * as Sentry from "@sentry/cloudflare";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
// @ts-expect-error cloud/worker.js is untyped JavaScript.
import worker, * as cloud from "../../cloud/worker.js";
import { isWorkerPath } from "../worker-paths.mjs";
import { serverOptions } from "./server-telemetry";

type CloudWorker = { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> };
// The cloud/ Durable Object classes (cloudflare:workers DurableObject subclasses).
type DurableObjectClass = Parameters<typeof Sentry.instrumentDurableObjectWithSentry>[1];

const options = (env: unknown) => serverOptions(env, "cloudflare");
const instrument = (objectClass: unknown) =>
  Sentry.instrumentDurableObjectWithSentry(options, objectClass as DurableObjectClass);

export const DesignRoom = instrument(cloud.DesignRoom);
export const AccountDirectory = instrument(cloud.AccountDirectory);
export const PublishedApp = instrument(cloud.PublishedApp);
export const AiRun = instrument(cloud.AiRun);

const start = createServerEntry({ fetch: (request: Request) => handler.fetch(request) });

export default Sentry.withSentry(options, {
  fetch(request: Request, env: unknown, ctx: unknown) {
    const { pathname } = new URL(request.url);
    if (isWorkerPath(pathname) || request.headers.get("upgrade"))
      return (worker as CloudWorker).fetch(request, env, ctx);
    return start.fetch(request);
  },
});
