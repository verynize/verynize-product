// Model API runtime HTTP endpoints (/api/ai/*; contract in docs/ai-runtime.md). The cloud backend
// owns these paths on every target (Cloudflare, Node, Vercel). A run is one chat turn executed by
// cloud/ai-executor.js with TanStack AI against OpenRouter and the hosted design tools of one room
// (cloud/design-backend.js); its state lives in the database (cloud/ai-store.js).
//
// Hosting: where the AI_RUNS binding exists (Cloudflare Durable Object, Node in-process actor), a
// run executes in its own AiRun object (cloud/ai-run.js, cloud/ai-host.js), not in the request
// that started it: it outlives the client, cancel and approvals notify it, and every stream of a
// running run subscribes to it. Without the binding (Vercel) the run executes inside the request
// that started it (`ctx.waitUntil`), as documented in docs/ai-runtime.md.
//
//   GET  /api/ai/config                       {enabled, provider, models, defaultModel, limits,
//                                              credentials: {openrouter}}
//   GET  /api/ai/credentials                  {openrouter: {connected, source, last4, label, …}}
//   PUT  /api/ai/credentials/openrouter       {apiKey} → checked with OpenRouter, stored encrypted
//   DELETE /api/ai/credentials/openrouter     {ok, removed}
//   POST /api/ai/credentials/openrouter/oauth/start     {returnTo?} → {authorizeUrl} + cookie
//   GET  /api/ai/credentials/openrouter/oauth/callback  ?code=&state= → redirect to returnTo
//   POST /api/ai/runs                         start (or replay, by idempotencyKey) → SSE
//   GET  /api/ai/runs/:id/events?after=<seq>  stored events after seq, then live → SSE
//   POST /api/ai/runs/:id/cancel              {ok: true}
//   POST /api/ai/runs/:id/approvals           {requestId, allow, argsHash} → {ok} | 404 | 403 | 409
//
// Every endpoint needs a signed-in account (the router's accountOf); the account never comes from
// the request body or the model. The OAuth callback is the exception: it is a top-level navigation
// back from openrouter.ai and authenticates through its pending state (cloud/ai-credentials.js).
import { PROVIDERS, getProvider } from "./ai-providers/index.js";
import { corsHeaders, readJson, json, fail } from "./http.js";
import { createRoomBackend, ROOM_ID } from "./design-backend.js";
import {
  activeRuns,
  claimExpired,
  claimUnstarted,
  createRun,
  decideApproval,
  denyPending,
  eventsAfter,
  finishRun,
  getApproval,
  getRun,
  lastSeq,
  appendEvent,
  requestCancel,
  runByKey,
} from "./ai-store.js";
import { APPROVAL_TIMEOUT_MS, DESIGN_STYLE, createEventLog, executeRun } from "./ai-executor.js";
import {
  DEFAULT_RETURN,
  OAUTH_COOKIE,
  OAUTH_PATH,
  OAUTH_TTL_MS,
  checkOpenRouterKey,
  claimOAuth,
  credentialRow,
  deleteCredential,
  exchangeOAuthCode,
  openRouterBase,
  readCredential,
  saveCredential,
  startOAuth,
} from "./ai-credentials.js";

export const AI_PREFIX = "/api/ai/";
const RUN_ROUTE = /^\/api\/ai\/runs\/([0-9a-f-]{36})\/(events|cancel|approvals)$/;
const ACCESS = ["ask", "edit", "auto", "full"];
const DEFAULT_MODELS = "openrouter/auto=Auto (OpenRouter)";
const DEFAULT_LIMITS = { maxTurns: 12, maxToolCalls: 40 };
const MAX_BODY = 1024 * 1024;
const MAX_PROMPT = 50_000;
const MAX_HISTORY = 50;
const MAX_HISTORY_TEXT = 20_000;
const MAX_ACTIVE_RUNS = 3;
const POLL_MS = 400;
export const HEARTBEAT_MS = 15_000;
const encoder = new TextEncoder();

const positive = (value, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

/** How long a write waits for its approval (`VERYNIZE_AI_APPROVAL_TIMEOUT_MS`, default 10 min). */
export const approvalTimeout = (env) =>
  positive(env.VERYNIZE_AI_APPROVAL_TIMEOUT_MS, APPROVAL_TIMEOUT_MS);

/** The runtime configuration from the bindings: `VERYNIZE_AI_MODELS` is "id[=Label],…". */
export function aiConfig(env) {
  const models = String(env.VERYNIZE_AI_MODELS || DEFAULT_MODELS)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, ...label] = entry.split("=");
      return { id: id.trim(), label: label.join("=").trim() || id.trim() };
    })
    .filter((model) => /^[\w.:/-]{1,120}$/.test(model.id));
  return {
    // Available unless the operator turned it off (`VERYNIZE_AI=off`); each account brings its key.
    enabled:
      env.VERYNIZE_AI !== "off" &&
      (models.length > 0 ||
        PROVIDERS.some(
          (provider) =>
            provider.id !== "openrouter" && provider.curatedModels.some((model) => model.tools),
        )),
    provider: "openrouter",
    models,
    defaultModel: models[0]?.id || null,
    limits: {
      maxTurns: positive(env.VERYNIZE_AI_MAX_TURNS, DEFAULT_LIMITS.maxTurns),
      maxToolCalls: positive(env.VERYNIZE_AI_MAX_TOOL_CALLS, DEFAULT_LIMITS.maxToolCalls),
    },
  };
}

export const sseHeaders = {
  ...corsHeaders,
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store, no-transform",
  "x-accel-buffering": "no",
};
export const frame = (event) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
export const heartbeat = encoder.encode(": keep-alive\n\n");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The SSE stream of a run that this request executes: events arrive from the executor in order
 * (after they are stored). A client that goes away does not stop the run; it reconnects with
 * GET /events?after=.
 */
function liveStream() {
  let controller;
  let open = true;
  let timer;
  const close = () => {
    if (!open) return;
    open = false;
    clearInterval(timer);
    try {
      controller.close();
    } catch {}
  };
  const stream = new ReadableStream({
    start(c) {
      controller = c;
      timer = setInterval(() => {
        try {
          if (open) controller.enqueue(heartbeat);
        } catch {
          close();
        }
      }, HEARTBEAT_MS);
    },
    cancel() {
      open = false;
      clearInterval(timer);
    },
  });
  return {
    stream,
    send: (event) => {
      if (!open) return;
      try {
        controller.enqueue(frame(event));
      } catch {
        open = false;
        clearInterval(timer);
      }
      if (event.type === "done") close();
    },
    close,
  };
}

/**
 * Finish a run whose executing instance stopped renewing its lease: it is marked done and gets
 * `error` + `done {code: "error"}` events, once, by whichever reader claims it first.
 */
export async function closeExpired(
  env,
  run,
  message = "The run stopped: the server running it went away.",
) {
  if (!(await claimExpired(env, run.id))) return;
  await closeClaimed(env, run, message);
}

/** End a running run that never got an executor (its host could not start it). */
async function closeRun(env, run, message) {
  if (!(await claimUnstarted(env, run.id))) return;
  await closeClaimed(env, run, message);
}

async function closeClaimed(env, run, message) {
  let seq = await lastSeq(env, run.id);
  const base = { id: run.id, chatId: run.chatId };
  // Approvals the dead executor was waiting for are denied, as when a run ends.
  for (const requestId of await denyPending(env, run.id, "cancelled"))
    await appendEvent(env, run.id, {
      ...base,
      seq: ++seq,
      type: "permission-resolved",
      requestId,
      allow: false,
      reason: "cancelled",
    });
  await appendEvent(env, run.id, {
    ...base,
    seq: ++seq,
    type: "error",
    message,
  });
  await appendEvent(env, run.id, {
    ...base,
    seq: ++seq,
    type: "done",
    code: "error",
    stopped: false,
    sessionId: run.id,
  });
}

/**
 * The SSE stream of a stored run: events after `after`, then new ones as they are stored (polled
 * from the database, so the run may execute on another instance) until `done`.
 */
export function followStream(env, runId, after) {
  let open = true;
  return new ReadableStream({
    async start(controller) {
      let last = after;
      let quietSince = Date.now();
      try {
        while (open) {
          const events = await eventsAfter(env, runId, last);
          for (const event of events) {
            controller.enqueue(frame(event));
            last = event.seq;
            if (event.type === "done") {
              open = false;
              break;
            }
          }
          if (!open) break;
          if (events.length) {
            quietSince = Date.now();
            continue;
          }
          const run = await getRun(env, runId);
          if (!run) break;
          if (run.status === "running" && run.leaseUntil < Date.now()) await closeExpired(env, run);
          else if (run.status === "done" && !(await eventsAfter(env, runId, last, 1)).length) break;
          if (Date.now() - quietSince >= HEARTBEAT_MS) {
            controller.enqueue(heartbeat);
            quietSince = Date.now();
          }
          await sleep(POLL_MS);
        }
        controller.close();
      } catch {
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      open = false;
    },
  });
}

function validRunRequest(body, config, env) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "Body must be an object");
  const { chatId, roomId, prompt, model, access, history, designStyle, idempotencyKey } = body;
  for (const flag of ["plan", "helper"])
    if (body[flag] !== undefined && typeof body[flag] !== "boolean")
      fail(400, `${flag} must be true or false`);
  if (typeof chatId !== "string" || !/^[\w.:-]{1,128}$/.test(chatId))
    fail(400, "chatId must be 1-128 letters, digits, _ . : or -");
  if (typeof roomId !== "string" || !ROOM_ID.test(roomId)) fail(400, "roomId must be a room id");
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT)
    fail(400, `prompt must be text of at most ${MAX_PROMPT} characters`);
  if (typeof idempotencyKey !== "string" || !/^[\w.:-]{8,128}$/.test(idempotencyKey))
    fail(400, "idempotencyKey must be 8-128 letters, digits, _ . : or -");
  const provider = requireProvider(body.provider === undefined ? "openrouter" : body.provider);
  const models = providerModels(env, provider).filter((model) => model.tools);
  config = { ...config, models, defaultModel: models[0]?.id || null };
  const chosen = model === undefined || model === null ? config.defaultModel : model;
  if (!config.models.some((entry) => entry.id === chosen))
    fail(400, `model must be one of: ${config.models.map((entry) => entry.id).join(", ")}`);
  if (access !== undefined && !ACCESS.includes(access))
    fail(400, `access must be one of: ${ACCESS.join(", ")}`);
  if (designStyle !== undefined && designStyle !== null && !DESIGN_STYLE.test(String(designStyle)))
    fail(400, "designStyle must be a style slug");
  if (history !== undefined && !Array.isArray(history)) fail(400, "history must be an array");
  const turns = (history || []).slice(-MAX_HISTORY).map((item) => {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.text !== "string")
      fail(400, 'history items are {role: "user"|"assistant", text}');
    return { role: item.role, text: item.text.slice(0, MAX_HISTORY_TEXT) };
  });
  return {
    chatId,
    roomId,
    prompt,
    model: chosen,
    provider: provider.id,
    access: access || "ask",
    history: turns.filter((item) => item.text.trim()),
    designStyle: designStyle || undefined,
    plan: body.plan === true,
    helper: body.helper === true,
    idempotencyKey,
  };
}

async function ownedRun(env, runId, account) {
  const run = await getRun(env, runId);
  if (!run) fail(404, "Run not found");
  if (run.accountId !== account.id) fail(403, "This run belongs to another account");
  return run;
}

/**
 * An SSE response. `X-Verynize-AI-Stream` says where its events come from: `object` (pushed by the
 * run's AiRun object), `request` (the request-scoped executor of this request) or `database`
 * (stored events, polled). Diagnostics only; clients do not depend on it.
 */
const sse = ({ body, source }) =>
  new Response(body, {
    status: 200,
    headers: { ...sseHeaders, "x-verynize-ai-stream": source },
  });

/** The operator opted in to the server-wide key as a fallback (`VERYNIZE_AI_SERVER_KEY=1`). */
const serverKey = (env) =>
  env.VERYNIZE_AI_SERVER_KEY === "1" && env.OPENROUTER_API_KEY ? env.OPENROUTER_API_KEY : null;

/**
 * Whether the account can start a run: `connected` (its own key), `server` (no key of its own, the
 * operator's opted-in fallback) or `missing`. Reads the row only; nothing is decrypted.
 */
export async function credentialState(env, account, providerId = "openrouter") {
  requireProvider(providerId);
  if (account?.id && (await credentialRow(env, account.id, providerId))) return "connected";
  return providerId === "openrouter" && serverKey(env) ? "server" : "missing";
}

/**
 * The provider credential and endpoint of a run, for the account that owns it. This is the only
 * place a run obtains its credential (cloud/ai-host.js and the request-scoped path both go through
 * launchRun): the account's own OpenRouter key (cloud/ai-credentials.js), else the server key only
 * when the operator opted in (`VERYNIZE_AI_SERVER_KEY=1`). Nothing it returns is stored.
 * `current()` re-reads the credential before every model request, so a key deleted mid-run fails
 * the next call and a reconnected key is used from then on.
 * OpenRouter current() keeps its legacy raw key; other providers return parsed field objects.
 * endpointFor is an internal helper to retain env overrides when credentials rotate.
 */
export async function resolveProvider(env, account, origin, providerId = "openrouter") {
  const definition = requireProvider(providerId);
  if (!account?.id) return null;
  const own = await readCredential(env, account.id, providerId);
  const shared = providerId === "openrouter" ? serverKey(env) : null;
  if (!own && !shared) return null;
  const credential = providerId === "openrouter" ? { apiKey: own || shared } : own;
  return {
    id: providerId,
    credential,
    apiKey: credential.apiKey,
    endpoint: definition.endpoint(credential, env),
    endpointFor: (value) => definition.endpoint(value, env),
    ...(providerId === "openrouter"
      ? { baseUrl: env.OPENROUTER_BASE_URL ? openRouterBase(env) : undefined, origin }
      : {}),
    source: own ? "account" : "server",
    current: own ? () => readCredential(env, account.id, providerId) : async () => serverKey(env),
  };
}

/** The account a run acts for, rebuilt from ids (all the room backend reads of it). */
export function runAccount({ accountId, authUserId }) {
  const account = { id: accountId };
  // Like accountOf: the Better Auth user (organization roles), not serialized.
  if (authUserId)
    Object.defineProperty(account, "authUser", { value: { id: authUserId }, enumerable: false });
  return account;
}

/**
 * Execute a stored run to completion (never throws). Shared by the AiRun object and the
 * request-scoped path, so both resolve the room role and the provider the same way.
 * @param {object} env
 * @param {object} options
 * @param {object} options.run the ai_run row
 * @param {object} options.account runAccount(...) or the router's account
 * @param {Request} options.request the starting request, or a synthetic one with its origin
 * @param {{prompt: string, history: Array<object>, designStyle?: string, plan: boolean, helper: boolean}} options.input
 * @param {{role: string, title: string|null}} [options.room] already resolved by the caller
 * @param {(event: object) => void} [options.onEvent] live delivery after each event is stored
 * @param {AbortSignal} [options.signal] cancel notification
 * @param {boolean} [options.heartbeat] see executeRun
 * @param {(ms: number) => Promise<unknown>} [options.waitForChange] see createRunPolicy
 */
export async function launchRun(env, options) {
  const { run, account, request, input, onEvent, signal, heartbeat, waitForChange } = options;
  const url = new URL(request.url);
  const log = createEventLog(env, run, { onEvent });
  try {
    const backend = createRoomBackend(env, request, url, account, { roomId: run.roomId });
    const { role, title } = options.room || (await backend.role(run.roomId));
    const provider = role
      ? await resolveProvider(env, account, url.origin, run.provider || "openrouter")
      : null;
    if (!role || !provider) {
      await log.emit("error", {
        message: role
          ? credentialsMessage(run.provider || "openrouter")
          : "You have no access to this room",
      });
      await log.emit("done", { code: "error", stopped: false, sessionId: run.id });
      await finishRun(env, run.id, "error");
      return "error";
    }
    return await executeRun({
      env,
      run,
      backend,
      room: { id: run.roomId, title },
      role,
      prompt: input.prompt,
      history: input.history,
      designStyle: input.designStyle,
      plan: input.plan,
      helper: input.helper,
      approvalTimeoutMs: approvalTimeout(env),
      limits: aiConfig(env).limits,
      provider,
      log,
      signal,
      heartbeat,
      waitForChange,
    });
  } catch (error) {
    console.error("ai run failed", run.id, error?.message);
    return "error";
  }
}

/**
 * The SSE body of a run from `after`: a running run hosted by an AiRun object streams from it
 * (stored events, then live ones pushed as they are stored); otherwise the database is followed.
 */
async function runStream(env, run, after) {
  if (env.AI_RUNS && run?.status === "running") {
    try {
      const response = await env.AI_RUNS.getByName(run.id).fetch(
        new Request(`https://ai-run.internal/events?run=${run.id}&after=${after}`),
      );
      if (response.ok && response.body)
        return {
          body: response.body,
          source: response.headers.get("x-verynize-ai-stream") || "object",
        };
      await response.body?.cancel();
    } catch (error) {
      console.error("ai run stream unavailable", run.id, error?.message);
    }
  }
  return { body: followStream(env, run.id, after), source: "database" };
}

/** Tell the run's AiRun object that its cancel flag or an approval changed (best effort). */
async function notifyRun(env, runId) {
  if (!env.AI_RUNS) return;
  try {
    await env.AI_RUNS.getByName(runId).wake();
  } catch (error) {
    // The object re-reads the database on its alarm and before every tool call.
    console.error("ai run notify failed", runId, error?.message);
  }
}

const requireProvider = (id) => {
  const provider = getProvider(id);
  if (!provider) fail(404, "Unknown AI provider");
  return provider;
};
const credentialsMessage = (id) =>
  `Connect your ${requireProvider(id).label} account in Settings to use the model API.`;
const providerModels = (env, provider) =>
  provider.id === "openrouter"
    ? aiConfig(env).models.map((model) => ({ ...model, tools: true }))
    : provider.curatedModels;
async function credentialsMap(env, account) {
  return Object.fromEntries(
    await Promise.all(
      PROVIDERS.map(async (provider) => [
        provider.id,
        await credentialStatus(env, account, provider.id),
      ]),
    ),
  );
}
const MAX_KEY = 512;

const tooMany = () =>
  new Response(JSON.stringify({ error: "Too many requests. Try again in a minute." }), {
    status: 429,
    headers: { ...corsHeaders, "content-type": "application/json", "retry-after": "60" },
  });

/** The OAuth browser-binding cookie (HttpOnly, only sent to the OAuth paths, ten minutes). */
const oauthCookie = (url, value, maxAge) =>
  `${OAUTH_COOKIE}=${value}; Path=${OAUTH_PATH}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${
    url.protocol === "https:" ? "; Secure" : ""
  }`;
const cookieValue = (request, name) => {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
};

/** What GET /api/ai/credentials reports for the account (never the key). */
async function credentialStatus(env, account, providerId = "openrouter") {
  const row = await credentialRow(env, account.id, providerId);
  if (!row)
    return {
      connected: false,
      source: providerId === "openrouter" && serverKey(env) ? "server" : null,
      last4: null,
      label: null,
      updatedAt: null,
      ...(providerId === "openrouter" && serverKey(env) ? { serverFallback: true } : {}),
    };
  const status = {
    connected: true,
    source: row.source,
    last4: row.last4,
    label: row.label || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  // Live key details from OpenRouter (limit and usage), best effort.
  const apiKey = await readCredential(env, account.id, providerId);
  if (!apiKey) return { ...status, state: "unreadable" };
  if (providerId !== "openrouter") return { ...status, state: "ok" };
  try {
    const check = await checkOpenRouterKey(env, apiKey, AbortSignal.timeout(4000));
    if (!check.ok) return { ...status, state: "rejected" };
    const { limit, usage, limit_remaining: limitRemaining, is_free_tier: freeTier } = check.info;
    return {
      ...status,
      state: "ok",
      ...(typeof limit === "number" || limit === null ? { limit } : {}),
      ...(typeof usage === "number" ? { usage } : {}),
      ...(typeof limitRemaining === "number" || limitRemaining === null ? { limitRemaining } : {}),
      ...(typeof freeTier === "boolean" ? { freeTier } : {}),
    };
  } catch {
    return { ...status, state: "unknown" };
  }
}

/**
 * /api/ai/credentials[/openrouter[/oauth/start]] for the signed-in account. The key is accepted
 * from the account's own browser once (PUT, or the OAuth callback), checked with OpenRouter,
 * stored encrypted, and never returned.
 */
async function handleCredentials(request, env, url, account, limited) {
  const path = url.pathname;
  if (path === "/api/ai/credentials") {
    if (request.method !== "GET") fail(405, "Use GET");
    return json(await credentialsMap(env, account));
  }
  const credentialRoute = /^\/api\/ai\/credentials\/([^/]+)$/.exec(path);
  if (credentialRoute) {
    const provider = requireProvider(credentialRoute[1]);
    if (request.method === "DELETE")
      return json({ ok: true, removed: await deleteCredential(env, account.id, provider.id) });
    if (request.method !== "PUT") fail(405, "Use PUT or DELETE");
    if (await limited(env.AI_LIMIT, `credentials:${account.id}`)) return tooMany();
    const body = await readJson(request, 4 * 1024);
    let credential;
    try {
      credential = provider.parseCredential(body);
    } catch (error) {
      if (error.status !== 400) throw error;
      return json({ error: error.message, ...(error.field ? { field: error.field } : {}) }, 400);
    }
    const check = await provider.verify(credential, { fetch, env });
    if (!check.ok) {
      if (check.reason === "unreachable")
        fail(502, `${provider.label} could not be reached to check this key. Try again.`);
      return json(
        {
          error:
            check.message || `${provider.label} rejected this credential. Check it and try again.`,
          code: "invalid_key",
        },
        400,
      );
    }
    const description = provider.describe(credential);
    await saveCredential(env, account.id, {
      provider: provider.id,
      credential,
      apiKey: credential.apiKey,
      source: "manual",
      ...description,
      label: check.info?.label || description.label,
    });
    return json(await credentialsMap(env, account));
  }
  if (path === `${OAUTH_PATH}/start`) {
    if (request.method !== "POST") fail(405, "Use POST");
    if (await limited(env.AI_LIMIT, `credentials:${account.id}`)) return tooMany();
    const body = request.body ? await readJson(request, 4 * 1024).catch(() => ({})) : {};
    const { authorizeUrl, browser } = await startOAuth(env, {
      accountId: account.id,
      origin: url.origin,
      returnTo: body?.returnTo,
    });
    return new Response(JSON.stringify({ authorizeUrl }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": "application/json",
        "cache-control": "no-store",
        "set-cookie": oauthCookie(url, browser, OAUTH_TTL_MS / 1000),
      },
    });
  }
  fail(404, "Not found");
}

/**
 * GET …/oauth/callback?code=&state=: claims the pending sign-in of `state` (once), checks the
 * browser cookie, exchanges the code with the stored PKCE verifier and stores the key for the
 * account that started the flow. Always answers with a redirect to a same-origin path, carrying
 * `openrouter=connected` or `openrouter=error&openrouter_error=<code>`.
 */
async function oauthCallback(request, env, url) {
  const redirect = (returnTo, outcome) => {
    const target = new URL(returnTo || DEFAULT_RETURN, url.origin);
    if (outcome === "connected") target.searchParams.set("openrouter", "connected");
    else {
      target.searchParams.set("openrouter", "error");
      target.searchParams.set("openrouter_error", outcome);
    }
    return new Response(null, {
      status: 303,
      headers: {
        location: target.pathname + target.search,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "set-cookie": oauthCookie(url, "", 0),
      },
    });
  };
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const claim = await claimOAuth(env, { state, browser: cookieValue(request, OAUTH_COOKIE) });
  if (claim.error) return redirect(claim.returnTo, claim.error);
  if (!code || code.length > 2048) return redirect(claim.returnTo, "denied");
  let apiKey;
  try {
    apiKey = await exchangeOAuthCode(env, { code, verifier: claim.verifier });
  } catch (error) {
    console.error("openrouter oauth exchange failed", error?.message);
    return redirect(claim.returnTo, "exchange_failed");
  }
  if (!apiKey || apiKey.length > MAX_KEY) return redirect(claim.returnTo, "exchange_failed");
  let label = null;
  try {
    const check = await checkOpenRouterKey(env, apiKey, AbortSignal.timeout(5000));
    if (check.ok) label = check.info?.label || null;
  } catch {}
  await saveCredential(env, claim.accountId, { apiKey, source: "oauth", label });
  return redirect(claim.returnTo, "connected");
}

/**
 * /api/ai/*. `accountOf(env, request, url)` and `limited(binding, key)` come from the router
 * (cloud/worker.js). Without AI_RUNS, `ctx.waitUntil` (when the platform offers it) keeps a
 * request-scoped run going after its client disconnects.
 */
export async function handleAi(request, env, url, { accountOf, limited, ctx }) {
  const path = url.pathname;
  const config = aiConfig(env);
  // A top-level navigation back from openrouter.ai: no session header, its state authenticates it.
  if (path === `${OAUTH_PATH}/callback`) {
    if (request.method !== "GET") fail(405, "Use GET");
    return oauthCallback(request, env, url);
  }
  // Browsers send Origin: only the server's own pages may call it from a browser.
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) fail(403, "Cross-origin requests are not allowed");
  const account = await accountOf(env, request, url).catch(() => null);
  if (!account) fail(401, "Sign in first");

  if (path === "/api/ai/config") {
    if (request.method !== "GET") fail(405, "Use GET");
    const providers = await Promise.all(
      PROVIDERS.map(async (provider) => {
        const models = providerModels(env, provider);
        return {
          id: provider.id,
          label: provider.label,
          oauth: provider.oauth === true,
          fields: provider.fields,
          ...(provider.capabilities ? { capabilities: provider.capabilities } : {}),
          connected: await credentialState(env, account, provider.id),
          models,
          defaultModel: models.find((model) => model.tools)?.id || null,
        };
      }),
    );
    return json({
      ...config,
      credentials: { openrouter: providers[0].connected },
      providers,
      defaultProvider: "openrouter",
    });
  }

  if (path === "/api/ai/credentials" || path.startsWith("/api/ai/credentials/"))
    return handleCredentials(request, env, url, account, limited);

  if (path === "/api/ai/models") {
    if (request.method !== "GET") fail(405, "Use GET");
    const definition = requireProvider(url.searchParams.get("provider") ?? "openrouter");
    const resolved = await resolveProvider(env, account, url.origin, definition.id);
    const live = resolved
      ? await definition.listModels(resolved.credential, { fetch, env }).catch(() => null)
      : null;
    return json({ provider: definition.id, models: live || providerModels(env, definition) });
  }

  if (path === "/api/ai/runs") {
    if (request.method !== "POST") fail(405, "Use POST");
    if (!config.enabled) fail(503, "The model API runtime is not configured on this server");
    if (await limited(env.AI_LIMIT, `account:${account.id}`)) return tooMany();
    const input = validRunRequest(await readJson(request, MAX_BODY), config, env);
    // A retried request: replay the existing run's events, then follow it.
    const existing = await runByKey(env, account.id, input.idempotencyKey);
    if (existing) return sse(await runStream(env, existing, 0));
    if ((await credentialState(env, account, input.provider)) === "missing")
      return json({ error: credentialsMessage(input.provider), code: "credentials_required" }, 409);

    const backend = createRoomBackend(env, request, url, account, { roomId: input.roomId });
    const { role, title } = await backend.role(input.roomId);
    if (!role) fail(403, "You have no access to this room");
    const active = await activeRuns(env, account.id);
    if (active.some((run) => run.chatId === input.chatId))
      fail(409, "This chat already has a running turn; cancel it or wait for it to finish");
    if (active.length >= MAX_ACTIVE_RUNS) fail(429, "Too many running turns for this account");

    const { run, created } = await createRun(env, {
      accountId: account.id,
      roomId: input.roomId,
      chatId: input.chatId,
      model: input.model,
      provider: input.provider,
      access: input.access,
      idempotencyKey: input.idempotencyKey,
    });
    if (!created) return sse(await runStream(env, run, 0));

    const runInput = {
      prompt: input.prompt,
      history: input.history,
      designStyle: input.designStyle,
      plan: input.plan,
      helper: input.helper,
    };
    if (env.AI_RUNS) {
      // Durable: the run executes in its own AiRun object; this request only subscribes to it.
      try {
        await env.AI_RUNS.getByName(run.id).start({
          runId: run.id,
          accountId: account.id,
          authUserId: account.authUser?.id || null,
          origin: url.origin,
          input: runInput,
        });
      } catch (error) {
        console.error("ai run could not start", run.id, error?.message);
        await closeRun(env, run, "The run could not be started.");
      }
      return sse(await runStream(env, await getRun(env, run.id), 0));
    }

    // Request-scoped (no AI_RUNS binding: Vercel): the run executes in this request.
    const live = liveStream();
    const execution = launchRun(env, {
      run,
      account,
      request,
      input: runInput,
      room: { role, title },
      onEvent: live.send,
    }).finally(() => live.close());
    ctx?.waitUntil?.(execution);
    return sse({ body: live.stream, source: "request" });
  }

  const match = path.match(RUN_ROUTE);
  if (!match) fail(404, "Not found");
  const [, runId, action] = match;
  if (action === "events") {
    if (request.method !== "GET") fail(405, "Use GET");
    const run = await ownedRun(env, runId, account);
    const after = Number(url.searchParams.get("after") ?? 0);
    if (!Number.isInteger(after) || after < 0) fail(400, "after must be a sequence number");
    return sse(await runStream(env, run, after));
  }
  if (request.method !== "POST") fail(405, "Use POST");
  const run = await ownedRun(env, runId, account);
  if (action === "cancel") {
    if (run.status === "running") {
      await requestCancel(env, runId);
      await notifyRun(env, runId);
    }
    return json({ ok: true });
  }
  // Approvals: the decision is stored once, here; the executor (in the run's AiRun object, or on
  // whichever instance runs a request-scoped run) is notified or polls it, re-checks the hash
  // against the call it is about to run, and the room role.
  const body = await readJson(request, 16 * 1024);
  if (typeof body?.requestId !== "string" || typeof body.allow !== "boolean")
    fail(400, "Body must be {requestId, allow, argsHash}");
  if (body.argsHash !== undefined && typeof body.argsHash !== "string")
    fail(400, "argsHash must be the argsHash of the permission request");
  if (body.allow && body.argsHash === undefined)
    fail(400, "Approving needs the argsHash of the permission request");
  const approval = await getApproval(env, runId, body.requestId);
  if (!approval) fail(404, "Approval request not found");
  if (approval.accountId !== account.id) fail(403, "This request belongs to another account");
  if (approval.decision) fail(409, "This request was already decided");
  if (run.status !== "running" || run.leaseUntil < Date.now()) fail(409, "This run has ended");
  if (body.argsHash !== undefined && body.argsHash !== approval.argsHash)
    fail(409, "The arguments of this tool call do not match the approval request");
  if (!(await decideApproval(env, runId, body.requestId, body.allow, "user")))
    fail(409, "This request was already decided");
  await notifyRun(env, runId);
  return json({ ok: true });
}
