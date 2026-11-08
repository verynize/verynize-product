// The Node composition root: builds the `env` the Worker code reads, binding by binding, from a
// description shaped like cloudflare.config.ts (the same types Miniflare takes). server/node.mjs
// derives that description from process.env; the cloud tests pass the one they give Miniflare.
import path from "node:path";
import { ActorNamespace } from "./actors.js";
import { FileBlobStore, S3BlobStore } from "./blob-store.js";
import { applyMigrations, openD1 } from "./d1.js";
import { createSmtpMailer } from "./mailer.js";
import { MemoryRateLimiter } from "./rate-limit.js";
import { createStaticAssets } from "./static-assets.js";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);

/**
 * @param {object} options
 * @param {Record<string, Function>} options.classes Durable Object classes by export name
 * @param {string} options.dataDir where databases, actors and files are kept
 * @param {Record<string, object>} options.bindings name -> {type, ...}
 * @returns {{env: object, close: () => void}}
 */
export function createNodeEnv({ classes, dataDir, bindings }) {
  const env = {};
  const closers = [];
  const namespaces = [];
  for (const [name, binding] of Object.entries(bindings)) {
    switch (binding.type) {
      case "text":
      case "secret":
        if (binding.value !== undefined && binding.value !== "") env[name] = String(binding.value);
        break;
      case "rate-limit":
        env[name] = new MemoryRateLimiter(binding.simple);
        break;
      case "durable-object": {
        const Class = classes[binding.exportName];
        if (!Class) throw new Error(`${name}: no Durable Object class named ${binding.exportName}`);
        const namespace = new ActorNamespace({
          Class,
          directory: path.join(dataDir, "objects", binding.exportName),
        });
        namespaces.push(namespace);
        closers.push(() => namespace.close());
        env[name] = namespace;
        break;
      }
      case "d1": {
        const database = openD1(path.join(dataDir, "d1", `${binding.name || name}.sqlite`));
        if (binding.migrate !== false)
          applyMigrations(database.db, binding.migrations || MIGRATIONS);
        closers.push(() => database.close());
        env[name] = database.binding;
        break;
      }
      case "r2":
        env[name] = new FileBlobStore(path.join(dataDir, "blobs", binding.name || name));
        break;
      case "s3":
        env[name] = new S3BlobStore(binding);
        break;
      case "smtp":
        env[name] = createSmtpMailer(binding);
        break;
      case "assets":
        env[name] = createStaticAssets(binding.directory);
        break;
      default:
        throw new Error(`${name}: the ${binding.type} binding has no Node implementation`);
    }
  }
  for (const namespace of namespaces) namespace.bind(env);
  return {
    env,
    // Actors first (they commit and close their sockets), then the shared database.
    close: () => {
      for (const close of closers) close();
    },
  };
}

/**
 * The bindings of cloudflare.config.ts for a Node deployment, from environment variables
 * (documented in docs/self-hosting.md). Secrets are passed through, never printed.
 */
export function bindingsFromEnvironment(vars, { webRoot }) {
  const text = (value) => ({ type: "text", value });
  const bindings = {
    ROOM_CREATION: { type: "rate-limit", simple: { limit: 10, period: 60 } },
    AUTH_LIMIT: { type: "rate-limit", simple: { limit: 10, period: 60 } },
    MCP_LIMIT: { type: "rate-limit", simple: { limit: 240, period: 60 } },
    AI_LIMIT: { type: "rate-limit", simple: { limit: 20, period: 60 } },
    ROOMS: { type: "durable-object", exportName: "DesignRoom" },
    ACCOUNTS: { type: "durable-object", exportName: "AccountDirectory" },
    APPS: { type: "durable-object", exportName: "PublishedApp" },
    AI_RUNS: { type: "durable-object", exportName: "AiRun" },
    DB: { type: "d1", name: "verynize" },
    ASSETS: { type: "assets", directory: vars.WEB_ROOT || webRoot },
  };
  for (const name of [
    "BETTER_AUTH_SECRET",
    "ASSET_SIGNING_SECRET",
    "AUTH_URL",
    "PASSKEY_RP_ID",
    "EMAIL_PROVIDER",
    "EMAIL_FROM",
    "EMAIL_WEBHOOK_URL",
    "EMAIL_WEBHOOK_TOKEN",
    // Web sign-in (cloud/web-access.js): web (default), all or off.
    "ROOM_ACCOUNT_REQUIRED",
    // Model API runtime (cloud/ai.js): each account brings its own OpenRouter key; the server key
    // is a fallback only with VERYNIZE_AI_SERVER_KEY=1. VERYNIZE_AI=off turns the runtime off.
    "VERYNIZE_AI",
    "VERYNIZE_AI_SERVER_KEY",
    "OPENROUTER_API_KEY",
    "OPENROUTER_BASE_URL",
    "VERYNIZE_AI_MODELS",
    "VERYNIZE_AI_MAX_TURNS",
    "VERYNIZE_AI_MAX_TOOL_CALLS",
    "VERYNIZE_AI_APPROVAL_TIMEOUT_MS",
  ])
    if (vars[name]) bindings[name] = text(vars[name]);
  const blobs = (vars.BLOB_STORE || "file").toLowerCase();
  if (blobs === "s3")
    bindings.ASSETS_BUCKET = {
      type: "s3",
      endpoint: vars.S3_ENDPOINT,
      bucket: vars.S3_BUCKET,
      region: vars.S3_REGION,
      accessKeyId: vars.S3_ACCESS_KEY_ID,
      secretAccessKey: vars.S3_SECRET_ACCESS_KEY,
    };
  else if (blobs === "file") bindings.ASSETS_BUCKET = { type: "r2", name: "verynize-assets" };
  else throw new Error("BLOB_STORE must be file or s3");
  if (vars.SMTP_HOST) bindings.SMTP_MAILER = smtpBinding(vars);
  return bindings;
}

export const smtpBinding = (vars) => ({
  type: "smtp",
  host: vars.SMTP_HOST,
  port: vars.SMTP_PORT,
  secure: /^(1|true|yes)$/i.test(vars.SMTP_SECURE || ""),
  requireTls: /^(1|true|yes)$/i.test(vars.SMTP_REQUIRE_TLS || ""),
  user: vars.SMTP_USER,
  pass: vars.SMTP_PASS,
});
