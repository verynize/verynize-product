// Provider isolation and Chat Completions through the real room backend on all three hosts.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AUTH_SECRET, Miniflare, cloudOptions, passwordUser, RUNTIME } from "./cloud-harness.mjs";
import { openSecret } from "../cloud/ai-credentials.js";
import { aiConfig } from "../cloud/ai.js";
import { startFakeChatCompletions, toolMessages } from "./helpers/fake-chat-completions.mjs";

const fake = await startFakeChatCompletions({
  default: [[{ text: "Hello gateway." }]],
  write: (body) =>
    toolMessages(body).length
      ? [{ text: "Finished." }]
      : [
          { text: "Creating." },
          {
            tool: "create_artboard",
            args: {
              code: '<div data-node-label="Gateway card" className="w-[320px] h-[100px] bg-white"></div>',
            },
          },
        ],
  slow: [[{ text: "Streaming." }, { hang: true }]],
  rotate: [
    [{ text: "Checking." }, { delay: 1000 }, { tool: "get_artboards", args: {} }],
    [{ text: "Done." }],
  ],
});
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-ai-providers-"));
const options = await cloudOptions(path.join(dir, "state"));
Object.assign(options.workers[0].config.env, {
  OPENROUTER_BASE_URL: { type: "text", value: fake.baseUrl },
  VERCEL_AI_GATEWAY_BASE_URL: { type: "text", value: fake.baseUrl },
  VERYNIZE_AI_SERVER_KEY: { type: "text", value: "1" },
  OPENROUTER_API_KEY: { type: "text", value: "test-server-only-openrouter" },
});
const mf = new Miniflare(options);
const ORIGIN = "http://local";
const local = (url, init) => mf.dispatchFetch(url, init);
const request = (route, token, method = "GET", body) =>
  local(ORIGIN + route, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const data = async (response, status = 200) => {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return JSON.parse(text);
};
async function reader(response) {
  assert.equal(response.status, 200, response.status === 200 ? "" : await response.text());
  const stream = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  let done = false;
  async function pump() {
    const part = await stream.read();
    done = part.done;
    if (done) return;
    buffer += decoder.decode(part.value, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const line = block.split("\n").find((line) => line.startsWith("data: "));
      if (line) events.push(JSON.parse(line.slice(6)));
    }
  }
  return {
    events,
    async next(type) {
      while (!events.some((event) => event.type === type)) {
        assert.equal(done, false, `ended before ${type}: ${JSON.stringify(events)}`);
        await pump();
      }
      return events.find((event) => event.type === type);
    },
    async all() {
      while (!done) await pump();
      return events;
    },
  };
}
let checks = 0;
const passed = (name) => {
  checks++;
  console.log(`PASS ${name}`);
};
try {
  assert.equal(
    aiConfig({ VERYNIZE_AI_MODELS: "?" }).enabled,
    true,
    "an empty OpenRouter allowlist must not disable other providers",
  );
  assert.equal(aiConfig({ VERYNIZE_AI: "off" }).enabled, false);
  const ana = await passwordUser(ORIGIN, "provider-ana@example.test", "Ana", local, "192.0.2.1");
  const dodi = await passwordUser(ORIGIN, "provider-dodi@example.test", "Dodi", local, "192.0.2.2");
  const accountId = (await data(await request("/api/me", ana))).account.id;
  const room = await data(
    await request("/api/rooms", ana, "POST", {
      document: {
        version: 2,
        name: "Providers",
        pages: [{ id: "p", name: "Page", nodes: [] }],
        tokens: {},
      },
    }),
    201,
  );
  const run = (fields = {}, token = ana) =>
    request("/api/ai/runs", token, "POST", {
      chatId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      roomId: room.id,
      prompt: "Hello",
      provider: "vercel",
      ...fields,
    });
  const put = (token, apiKey, provider = "vercel") =>
    request(`/api/ai/credentials/${provider}`, token, "PUT", { apiKey });
  const KEY = "test-gateway-ana-1234";
  const OTHER = "test-gateway-dodi-5678";
  const ORKEY = "test-openrouter-ana-9012";
  for (const key of [KEY, OTHER, ORKEY]) fake.keys.add(key);
  const config = await data(await request("/api/ai/config", ana));
  assert.equal(config.defaultProvider, "openrouter");
  assert.deepEqual(
    config.providers
      .filter((provider) => ["openrouter", "vercel"].includes(provider.id))
      .map((provider) => [provider.id, provider.connected]),
    [
      ["openrouter", "server"],
      ["vercel", "missing"],
    ],
  );
  const fallbackModels = await data(await request("/api/ai/models?provider=vercel", ana));
  assert.deepEqual(
    fallbackModels.models,
    config.providers.find((provider) => provider.id === "vercel").models,
  );
  const missing = await data(await run(), 409);
  assert.match(missing.error, /Vercel AI Gateway/);
  assert.equal(missing.code, "credentials_required");
  passed("server opt-in stays OpenRouter-only");
  assert.equal((await data(await put(ana, "bad key"), 400)).field, "apiKey");
  await data(await put(ana, "unknown-test-key"), 400);
  assert.equal((await data(await request("/api/ai/credentials", ana))).vercel.connected, false);
  const saved = await data(await put(ana, KEY));
  assert.equal(saved.vercel.last4, "1234");
  assert.equal(saved.vercel.source, "manual");
  assert.equal((await data(await request("/api/ai/credentials", dodi))).vercel.connected, false);
  await data(await put(dodi, OTHER));
  await data(await put(ana, ORKEY, "openrouter"));
  const db = await mf.getD1Database("DB");
  const stored = await db
    .prepare("SELECT * FROM ai_credential WHERE accountId = ? AND provider = ?")
    .bind(accountId, "vercel")
    .first();
  assert.notEqual(stored.ciphertext, KEY);
  assert.deepEqual(JSON.parse(await openSecret(AUTH_SECRET, stored, `${accountId}:vercel`)), {
    v: 1,
    apiKey: KEY,
  });
  await assert.rejects(openSecret(AUTH_SECRET, stored, `${accountId}:openrouter`));
  await assert.rejects(openSecret(AUTH_SECRET, stored, "another-account:vercel"));
  passed("verified credentials and account/provider encryption isolation");
  const models = await data(await request("/api/ai/models?provider=vercel", ana));
  assert.equal(
    models.models.find((model) => model.id === "unknown/no-tool-capability").tools,
    false,
  );
  assert.equal(models.models.find((model) => model.id === "openai/gpt-5").tools, true);
  await data(await run({ model: "unknown/no-tool-capability" }), 400);
  await data(await run({ model: "openrouter/auto" }), 400);
  for (const [route, method, body] of [
    ["/api/ai/models?provider=unknown", "GET"],
    ["/api/ai/credentials/unknown", "PUT", { apiKey: KEY }],
    ["/api/ai/credentials/unknown", "DELETE"],
  ])
    await data(await request(route, ana, method, body), 404);
  await data(await run({ provider: "unknown" }), 404);
  passed("model capability curation, provider allowlists and unknown-provider 404s");
  const first = await reader(await run());
  const firstEvents = await first.all();
  assert.equal(firstEvents.at(-1).code, "ok", JSON.stringify(firstEvents));
  assert.ok(
    firstEvents.some(
      (event) => event.type === "assistant-text" && event.text.includes("Hello gateway"),
    ),
  );
  assert.equal(fake.requests.at(-1).headers.authorization, `Bearer ${KEY}`);
  const firstRun = await db
    .prepare("SELECT * FROM ai_run WHERE id = ?")
    .bind(firstEvents[0].id)
    .first();
  assert.equal(firstRun.provider, "vercel");
  assert.equal(firstEvents.find((event) => event.type === "session").agent, "vercel");
  // Old insert statements omit provider; the migration supplies the OpenRouter default.
  const legacyId = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO ai_run
    (id, accountId, roomId, chatId, model, access, idempotencyKey, status, code, cancelRequested, leaseUntil, createdAt, updatedAt)
    SELECT ?, accountId, roomId, chatId, model, access, ?, 'done', 'ok', 0, leaseUntil, createdAt, updatedAt
    FROM ai_run WHERE id = ?`)
    .bind(legacyId, crypto.randomUUID(), firstRun.id)
    .run();
  assert.equal(
    (await db.prepare("SELECT provider FROM ai_run WHERE id = ?").bind(legacyId).first()).provider,
    "openrouter",
  );
  const replay = await reader(
    await run({ provider: "openrouter", idempotencyKey: firstRun.idempotencyKey }),
  );
  assert.deepEqual(await replay.all(), firstEvents);
  const legacy = await reader(await run({ provider: undefined }));
  const legacyEvents = await legacy.all();
  assert.equal(legacyEvents.at(-1).code, "ok");
  assert.equal(fake.requests.at(-1).headers.authorization, `Bearer ${ORKEY}`);
  assert.equal(
    (await db.prepare("SELECT provider FROM ai_run WHERE id = ?").bind(legacyEvents[0].id).first())
      .provider,
    "openrouter",
  );
  passed("streaming, persisted provider, replay and legacy OpenRouter default");
  const dodiRoom = await data(
    await request("/api/rooms", dodi, "POST", {
      document: {
        version: 2,
        name: "Other",
        pages: [{ id: "p", name: "Page", nodes: [] }],
        tokens: {},
      },
    }),
    201,
  );
  const otherRun = await reader(await run({ roomId: dodiRoom.id }, dodi));
  assert.equal((await otherRun.all()).at(-1).code, "ok");
  assert.equal(fake.requests.at(-1).headers.authorization, `Bearer ${OTHER}`);
  passed("each account uses its own provider credential");
  for (const allow of [true, false]) {
    const stream = await reader(await run({ prompt: "[scenario:write]" }));
    const approval = await stream.next("permission-request");
    await data(
      await request(`/api/ai/runs/${approval.id}/approvals`, ana, "POST", {
        requestId: approval.requestId,
        argsHash: approval.argsHash,
        allow,
      }),
    );
    const events = await stream.all();
    assert.equal(events.at(-1).code, "ok", JSON.stringify(events));
    const document = (await data(await request(`/api/rooms/${room.id}`, ana))).document;
    assert.equal(
      document.pages.flatMap((page) => page.nodes).filter((node) => node.name === "Gateway card")
        .length,
      1,
    );
    if (!allow)
      assert.match(toolMessages(fake.requests.at(-1).body)[0].content, /not approved|denied/i);
  }
  passed("streaming tool calls with approve and deny against a real room");
  const slow = await reader(await run({ prompt: "[scenario:slow]" }));
  const running = await slow.next("assistant-text-delta");
  const cancelledAt = Date.now();
  await data(await request(`/api/ai/runs/${running.id}/cancel`, ana, "POST", {}));
  assert.equal((await slow.all()).at(-1).code, "cancelled");
  assert.ok(Date.now() - cancelledAt < 5000, "cancel must abort a hanging upstream");
  passed("cancel mid-stream");
  for (const action of ["replace", "delete"]) {
    const stream = await reader(await run({ prompt: "[scenario:rotate]" }));
    await stream.next("assistant-text-delta");
    if (action === "replace") await data(await put(ana, OTHER));
    else
      assert.equal(
        (await data(await request("/api/ai/credentials/vercel", ana, "DELETE"))).removed,
        true,
      );
    const events = await stream.all();
    assert.equal(events.at(-1).code, action === "replace" ? "ok" : "error", JSON.stringify(events));
    if (action === "replace")
      assert.equal(fake.requests.at(-1).headers.authorization, `Bearer ${OTHER}`);
    else
      assert.match(
        events.find((event) => event.type === "error").message,
        /Vercel AI Gateway.*disconnected/,
      );
  }
  assert.equal((await data(await request("/api/ai/credentials", ana))).openrouter.connected, true);
  assert.equal((await data(await request("/api/ai/credentials", dodi))).vercel.connected, true);
  assert.equal(
    (await data(await request("/api/ai/credentials/vercel", ana, "DELETE"))).removed,
    false,
  );
  passed("key rotation and deletion mid-run with independent provider/account credentials");
  await data(await put(ana, KEY));
  for (const [set, phrase] of [
    [fake.rejected, /rejected/],
    [fake.noCredits, /out of credits/],
    [fake.rateLimited, /rate limit/],
  ]) {
    set.add(KEY);
    const stream = await reader(await run());
    const events = await stream.all();
    assert.equal(events.at(-1).code, "error");
    const message = events.find((event) => event.type === "error").message;
    assert.match(message, phrase);
    assert.match(message, /Vercel AI Gateway/);
    assert.doesNotMatch(message, /OpenRouter/);
    assert.ok(!JSON.stringify(events).includes(KEY), "no secret in events");
    set.delete(KEY);
  }
  passed("401/402/429 provider-specific errors without secrets");
  console.log(`cloud AI providers OK (${RUNTIME}): ${checks} passed`);
} finally {
  await mf.dispose();
  await fake.close();
  await fs.rm(dir, { recursive: true, force: true });
}
