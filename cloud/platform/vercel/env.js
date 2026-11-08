// The Vercel composition root: builds the `env` the Worker code reads from a description shaped
// like cloudflare.config.ts (as cloud/platform/node/env.js does), with shared services instead of
// local files: libSQL for the accounts database and the actors' storage, Redis for leases,
// fan-out and rate limits, S3-compatible storage for blobs. Environment variables:
// docs/deployment-vercel.md.
import path from "node:path";
import { ActorStore } from "./actor-store.js";
import { Coordinator } from "./actors.js";
import { applyMigrations, libsqlD1, openLibsql, prepareLocal } from "./libsql-d1.js";
import { RedisConnection, RedisRateLimiter } from "./redis.js";
import { FileBlobStore, S3BlobStore } from "../node/blob-store.js";
import { createSmtpMailer } from "../node/mailer.js";
import { smtpBinding } from "../node/env.js";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);

/**
 * @param {object} options
 * @param {Record<string, Function>} options.classes Durable Object classes by export name
 * @param {Record<string, object>} options.bindings name -> {type, ...}
 * @param {string} options.redisUrl
 * @param {{url: string, authToken?: string}} options.database libSQL for env.DB and actor storage
 * @param {string} [options.dataDir] local directory for `r2` file blobs (development only)
 * @param {object} [options.coordinator] lease and liveness timings, test hooks (actors.js)
 * @returns {{env: object, coordinator: Coordinator, ready: Promise<void>, close: () => Promise<void>}}
 */
export function createVercelEnv({ classes, bindings, redisUrl, database, dataDir, coordinator }) {
  const redis = new RedisConnection(redisUrl);
  const client = openLibsql(database);
  const actors = new Coordinator({ redis, store: new ActorStore(client), ...coordinator });
  const env = {};
  const namespaces = [];
  const migrations = [];
  for (const [name, binding] of Object.entries(bindings)) {
    switch (binding.type) {
      case "text":
      case "secret":
        if (binding.value !== undefined && binding.value !== "") env[name] = String(binding.value);
        break;
      case "rate-limit":
        env[name] = new RedisRateLimiter(redis, name, binding.simple);
        break;
      case "durable-object": {
        const Class = classes[binding.exportName];
        if (!Class) throw new Error(`${name}: no Durable Object class named ${binding.exportName}`);
        // A class that needs an instance to stay in memory for minutes (AiRun) cannot run as a
        // turn under a lease on any instance: the binding is left out and the code falls back
        // (model API runs stay request-scoped on Vercel; docs/ai-runtime.md, "Hosting").
        if (Class.longLived) break;
        const namespace = actors.namespace(Class, binding.exportName);
        namespaces.push(namespace);
        env[name] = namespace;
        break;
      }
      case "d1":
        if (binding.migrate !== false)
          migrations.push(() => applyMigrations(client, binding.migrations || MIGRATIONS));
        env[name] = libsqlD1(client);
        break;
      case "r2":
        if (!dataDir)
          throw new Error(`${name}: file blobs need a data directory; use BLOB_STORE=s3`);
        env[name] = new FileBlobStore(path.join(dataDir, "blobs", binding.name || name));
        break;
      case "s3":
        env[name] = new S3BlobStore(binding);
        break;
      case "smtp":
        env[name] = createSmtpMailer(binding);
        break;
      default:
        throw new Error(`${name}: the ${binding.type} binding has no Vercel implementation`);
    }
  }
  for (const namespace of namespaces) namespace.bind(env);
  const ready = actors.start(async () => {
    await prepareLocal(client, database.url);
    for (const migrate of migrations) await migrate();
  });
  return {
    env,
    coordinator: actors,
    ready,
    close: async () => {
      await actors.close();
      client.close();
    },
  };
}

/** The bindings of cloudflare.config.ts for a Vercel deployment, from environment variables. */
export function bindingsFromEnvironment(vars) {
  const text = (value) => ({ type: "text", value });
  const limit = (name, fallback) => ({
    type: "rate-limit",
    simple: { limit: Number(vars[name]) || fallback, period: 60 },
  });
  const bindings = {
    ROOM_CREATION: limit("ROOM_CREATION_LIMIT", 10),
    AUTH_LIMIT: limit("AUTH_LIMIT", 10),
    MCP_LIMIT: limit("MCP_LIMIT", 240),
    AI_LIMIT: limit("AI_LIMIT", 20),
    ROOMS: { type: "durable-object", exportName: "DesignRoom" },
    ACCOUNTS: { type: "durable-object", exportName: "AccountDirectory" },
    APPS: { type: "durable-object", exportName: "PublishedApp" },
    DB: { type: "d1", name: "verynize" },
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
  // Function instances share no disk: blobs live in S3-compatible storage (R2, S3, B2, MinIO).
  if (vars.S3_BUCKET)
    bindings.ASSETS_BUCKET = {
      type: "s3",
      endpoint: vars.S3_ENDPOINT,
      bucket: vars.S3_BUCKET,
      region: vars.S3_REGION,
      accessKeyId: vars.S3_ACCESS_KEY_ID,
      secretAccessKey: vars.S3_SECRET_ACCESS_KEY,
    };
  if (vars.SMTP_HOST) bindings.SMTP_MAILER = smtpBinding(vars);
  return bindings;
}

/** createVercelEnv options from process.env (the function entry, api/server.mjs). */
export function optionsFromEnvironment(vars) {
  const number = (name) => (vars[name] ? Number(vars[name]) : undefined);
  return {
    bindings: bindingsFromEnvironment(vars),
    redisUrl: vars.REDIS_URL || vars.KV_URL,
    database: {
      url: vars.DATABASE_URL || vars.TURSO_DATABASE_URL,
      authToken: vars.DATABASE_AUTH_TOKEN || vars.TURSO_AUTH_TOKEN,
    },
    coordinator: {
      leaseMs: number("ROOM_LEASE_MS"),
      aliveMs: number("INSTANCE_ALIVE_MS"),
    },
  };
}
