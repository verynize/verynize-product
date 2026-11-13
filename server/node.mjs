// Verynize collaboration server on Node (VPS or Docker): the same Worker code as Cloudflare
// (cloud/worker.js) with the Node implementations of its bindings (cloud/platform/node).
// Configuration is read from the environment; see docs/self-hosting.md.
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker, * as objects from "../cloud/worker.js";
import { bindingsFromEnvironment, createNodeEnv } from "../cloud/platform/node/env.js";
import { createServer } from "../cloud/platform/node/server.js";
import { startServerTelemetry } from "./telemetry.mjs";

// Crash reports when SENTRY_DSN_SERVER is set (server/telemetry.mjs).
await startServerTelemetry("node");

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const vars = process.env;
const dataDir = path.resolve(vars.DATA_DIR || path.join(root, "data"));
const port = Number(vars.PORT ?? 8787);
const host = vars.HOST || "0.0.0.0";
const truthy = (value) => /^(1|true|yes)$/i.test(value || "");

if (!vars.BETTER_AUTH_SECRET || vars.BETTER_AUTH_SECRET.length < 32)
  console.warn(
    "BETTER_AUTH_SECRET is missing or shorter than 32 characters; set it before going public",
  );
if (vars.EMAIL_PROVIDER === "outbox")
  console.warn("EMAIL_PROVIDER=outbox exposes sign-in links at /api/dev/outbox: development only");

const { env, close } = createNodeEnv({
  classes: objects,
  dataDir,
  bindings: bindingsFromEnvironment(vars, { webRoot: path.join(root, "web") }),
});
const server = createServer({
  worker,
  env,
  assets: env.ASSETS,
  publicUrl: vars.PUBLIC_URL,
  trustProxy: truthy(vars.TRUST_PROXY),
  clientIpHeader: vars.CLIENT_IP_HEADER,
});

server.listen(port, host, () => {
  const address = server.address();
  // One machine-readable line (the tests read it); no secrets or tokens are ever printed.
  console.log(
    JSON.stringify({
      listening: `http://127.0.0.1:${address.port}`,
      dataDir,
      publicUrl: vars.PUBLIC_URL || null,
    }),
  );
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  server.closeAllConnections?.();
  // Commits every actor, closes room sockets (1001) and the databases, then lets the close frames
  // flush.
  close();
  setTimeout(() => process.exit(0), 200);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
