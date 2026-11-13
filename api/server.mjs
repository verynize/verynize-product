// The Vercel Function behind every backend path (vercel.json rewrites /api/*, /u/*, /apps/*,
// /account/*, /passkey and room WebSockets here). The same Worker code as Cloudflare
// (cloud/worker.js) with the Vercel implementations of its bindings (cloud/platform/vercel):
// libSQL (Turso), Redis and S3-compatible storage. Configuration: docs/deployment-vercel.md.
import { upgradeWebSocket, waitUntil } from "@vercel/functions";
import worker, * as objects from "../cloud/worker.js";
import { createVercelEnv, optionsFromEnvironment } from "../cloud/platform/vercel/env.js";
import { createHandler } from "../cloud/platform/vercel/handler.js";
import { startServerTelemetry } from "../server/telemetry.mjs";

// Crash reports when SENTRY_DSN_SERVER is set (server/telemetry.mjs).
await startServerTelemetry("vercel");

const { env, ready } = createVercelEnv({
  classes: objects,
  ...optionsFromEnvironment(process.env),
});

export default createHandler({
  worker,
  env,
  ready,
  upgradeWebSocket,
  waitUntil,
  publicUrl: process.env.PUBLIC_URL,
});
