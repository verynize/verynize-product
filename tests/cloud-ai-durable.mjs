// Durable model API runs (docs/ai-runtime.md, "Hosting"): a run executes in its AiRun object
// (Cloudflare Durable Object; in-process actor on Node), not in the request that started it.
// Covered: the client disconnects mid-run and the run still completes, a reconnect replays every
// event and `done`; an approval left pending with no client connected is approved from a new
// request seconds later and the write lands; an approval times out with no client connected; a
// cancel from another request ends a streaming run at once; two concurrent subscribers (and a
// late one) see identical event sequences. On Vercel (no AI_RUNS binding) runs stay
// request-scoped; the same scenarios run there to check the contract still holds, with the host
// assertions skipped. The LLM provider is the only fake (tests/helpers/fake-openrouter.mjs).
//
// Note: Miniflare does not enforce the ~30 s `waitUntil` cut-off of a deployed Worker, so these
// tests prove where the run executes (the `X-Verynize-AI-Stream: object` streams, and runs that
// finish with no request open) rather than the platform's time limit itself.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, cloudOptions, passwordUser, RUNTIME } from "./cloud-harness.mjs";
import { startFakeOpenRouter, toolMessages } from "./helpers/fake-openrouter.mjs";
import { sseReader } from "./helpers/sse-reader.mjs";

const ORIGIN = "http://local";
const DURABLE = RUNTIME !== "vercel";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const card = (label) =>
  `<div data-node-label="${label}" className="w-[320px] bg-white p-6 flex flex-col gap-2"><p className="text-base text-slate-900">${label}</p></div>`;

const fake = await startFakeOpenRouter({
  // Text spread over ~2.4 s, so a client can leave in the middle.
  long: [
    [
      { text: "First part." },
      { delay: 800 },
      { text: " Second part." },
      { delay: 800 },
      { text: " Third part." },
      { delay: 800 },
      { text: " The end." },
    ],
  ],
  write: (body) =>
    toolMessages(body).length
      ? [{ text: "Done." }]
      : [
          { text: "Adding a card." },
          { tool: "create_artboard", args: { code: card("Durable card") } },
        ],
  late: (body) =>
    toolMessages(body).length
      ? [{ text: "Understood." }]
      : [{ tool: "create_artboard", args: { code: card("Timed out card") } }],
  slow: [[{ text: "Working on it" }, { hang: true }]],
  default: [[{ text: "default" }]],
});

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-ai-durable-"));
const options = await cloudOptions(path.join(dir, "state"));
const config = options.workers[0].config;
const enabledEnv = {
  ...config.env,
  // The operator-opted-in server key (docs/ai-runtime.md "Credentials"); per-account keys are
  // covered by tests/cloud-ai.mjs.
  VERYNIZE_AI_SERVER_KEY: { type: "text", value: "1" },
  OPENROUTER_API_KEY: { type: "text", value: "test-openrouter-key" },
  OPENROUTER_BASE_URL: { type: "text", value: fake.baseUrl },
  VERCEL_AI_GATEWAY_BASE_URL: { type: "text", value: fake.baseUrl },
  VERYNIZE_AI_MODELS: { type: "text", value: "fake/model-a" },
};
config.env = enabledEnv;
const mf = new Miniflare(options);
const local = (url, init) => mf.dispatchFetch(url, init);

const request = (route, { method = "GET", body, token } = {}) =>
  mf.dispatchFetch(ORIGIN + route, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
let keys = 0;
const startRun = (token, fields) =>
  request("/api/ai/runs", {
    method: "POST",
    token,
    body: { idempotencyKey: `durable-${++keys}-${Date.now()}`, ...fields },
  });
const events = (token, runId, after = 0) =>
  request(`/api/ai/runs/${runId}/events?after=${after}`, { token });
const textOf = (list) =>
  list
    .filter((e) => e.type === "assistant-text-delta")
    .map((e) => e.text)
    .join("");
function assertSequence(list, runId) {
  list.forEach((event, i) => {
    assert.equal(event.seq, i + 1, `seq of ${event.type}`);
    assert.equal(event.id, runId);
  });
}
/** Where a stream's events come from (X-Verynize-AI-Stream). */
const source = (response) => response.headers.get("x-verynize-ai-stream");
const assertHosted = (response, what) => {
  if (DURABLE) assert.equal(source(response), "object", `${what} streams from the AiRun object`);
};
const labels = (doc) =>
  doc.pages.flatMap((page) => page.nodes.filter((n) => !n.parentId)).map((n) => n.name);
const roomDoc = async (id, token) =>
  (await (await request(`/api/rooms/${id}`, { token })).json()).document;
const blank = (name) => ({
  version: 2,
  name,
  pages: [{ id: "page-1", name: "Page 1", nodes: [] }],
  tokens: {},
});

try {
  const ana = await passwordUser(ORIGIN, "ana@example.test", "Ana", local, "192.0.2.1");
  const roomResponse = await request("/api/rooms", {
    method: "POST",
    token: ana,
    body: { document: blank("Durable board") },
  });
  assert.equal(roomResponse.status, 201);
  const room = await roomResponse.json();

  // 1. The client disconnects mid-run: the run completes; a reconnect replays everything + done.
  const firstResponse = await startRun(ana, {
    chatId: "chat-leave",
    roomId: room.id,
    prompt: "[scenario:long]",
  });
  assertHosted(firstResponse, "POST /runs");
  const first = sseReader(firstResponse);
  await first.next((e) => e.type === "assistant-text-delta");
  const leaveId = first.events[0].id;
  await first.cancel();
  // No request is open while the rest of the run (about 2.4 s of model output) executes.
  await sleep(3500);
  const replayResponse = await events(ana, leaveId, 0);
  const replay = await sseReader(replayResponse).all();
  assertSequence(replay, leaveId);
  assert.equal(textOf(replay), "First part.Second part.Third part.The end.");
  assert.equal(replay.at(-1).type, "done");
  assert.equal(replay.at(-1).code, "ok");
  // The run had finished before the reconnect: its events come from the database.
  assert.equal(source(replayResponse), "database");

  // 2. Two concurrent subscribers from the start, and a late one, get identical sequences.
  const ownerResponse = await startRun(ana, {
    chatId: "chat-many",
    roomId: room.id,
    prompt: "[scenario:long]",
  });
  const owner = sseReader(ownerResponse);
  const firstEvent = await owner.next(() => true);
  const manyId = firstEvent.id;
  const secondResponse = await events(ana, manyId, 0);
  assertHosted(secondResponse, "events?after=0 of a running run");
  const second = sseReader(secondResponse);
  await sleep(1000);
  const lateResponse = await events(ana, manyId, 3);
  assertHosted(lateResponse, "events?after=3 of a running run");
  const late = sseReader(lateResponse);
  const [ownerEvents, secondEvents, lateEvents] = await Promise.all([
    owner.all(),
    second.all(),
    late.all(),
  ]);
  assertSequence(ownerEvents, manyId);
  assert.equal(ownerEvents.at(-1).type, "done");
  assert.deepEqual(secondEvents, ownerEvents, "both subscribers see the same events");
  assert.deepEqual(lateEvents, ownerEvents.slice(3), "a late subscriber sees the same rest");

  // 3. Cancel from another request while streaming: done {cancelled} arrives at once.
  const slowResponse = await startRun(ana, {
    chatId: "chat-cancel",
    roomId: room.id,
    prompt: "[scenario:slow]",
  });
  const slow = sseReader(slowResponse);
  await slow.next((e) => e.type === "assistant-text-delta");
  const slowId = slow.events[0].id;
  // A second stream of the same run, opened by "another tab", also ends with the cancel.
  const watcher = sseReader(await events(ana, slowId, 0));
  const cancelledAt = Date.now();
  const cancel = await request(`/api/ai/runs/${slowId}/cancel`, { method: "POST", token: ana });
  assert.equal(cancel.status, 200);
  const done = await slow.next((e) => e.type === "done");
  const latency = Date.now() - cancelledAt;
  assert.equal(done.code, "cancelled");
  assert.equal(done.stopped, true);
  // The object is notified (no polling); request-scoped runs poll the flag every second.
  assert.ok(latency < (DURABLE ? 1000 : 3000), `cancel took ${latency} ms`);
  assert.deepEqual(await watcher.all(), await slow.all());

  // 4. An approval pending with no client connected, approved from a new request later.
  const writeResponse = await startRun(ana, {
    chatId: "chat-approve",
    roomId: room.id,
    prompt: "[scenario:write]",
    access: "ask",
  });
  assertHosted(writeResponse, "an ask run");
  const write = sseReader(writeResponse);
  const asked = await write.next((e) => e.type === "permission-request");
  const writeId = asked.id;
  await write.cancel();
  // Longer than any request involved so far stays open: nothing holds the run but its host.
  await sleep(4000);
  const approved = await request(`/api/ai/runs/${writeId}/approvals`, {
    method: "POST",
    token: ana,
    body: { requestId: asked.requestId, allow: true, argsHash: asked.argsHash },
  });
  assert.equal(approved.status, 200, await approved.text());
  const resumedResponse = await events(ana, writeId, asked.seq);
  const resumed = await sseReader(resumedResponse).all();
  const resolved = resumed.find((e) => e.type === "permission-resolved");
  assert.deepEqual([resolved.allow, resolved.reason], [true, "user"]);
  const result = resumed.find((e) => e.type === "tool-result");
  assert.equal(result.isError, false, result.output);
  assert.equal(resumed.at(-1).type, "done");
  assert.equal(resumed.at(-1).code, "ok");
  assert.ok(labels(await roomDoc(room.id, ana)).includes("Durable card"), "the write landed");

  // A non-default provider survives disconnect/reconnect through the same durable host.
  fake.keys.add("durable-vercel-key");
  const connected = await request("/api/ai/credentials/vercel", {
    method: "PUT",
    token: ana,
    body: { apiKey: "durable-vercel-key" },
  });
  assert.equal(connected.status, 200, await connected.text());
  const gatewayResponse = await startRun(ana, {
    provider: "vercel",
    chatId: "gateway-leave",
    roomId: room.id,
    prompt: "[scenario:long]",
  });
  assertHosted(gatewayResponse, "Vercel gateway run");
  const gateway = sseReader(gatewayResponse);
  await gateway.next((event) => event.type === "assistant-text-delta");
  const gatewayId = gateway.events[0].id;
  await gateway.cancel();
  await sleep(3500);
  const gatewayReplay = await sseReader(await events(ana, gatewayId)).all();
  assertSequence(gatewayReplay, gatewayId);
  assert.equal(gatewayReplay.at(-1).code, "ok");
  assert.equal(textOf(gatewayReplay), "First part.Second part.Third part.The end.");
  assert.equal(fake.requests.at(-1).headers.authorization, "Bearer durable-vercel-key");

  // 5. Approval timeout with no client connected (VERYNIZE_AI_APPROVAL_TIMEOUT_MS).
  config.env = {
    ...enabledEnv,
    VERYNIZE_AI_APPROVAL_TIMEOUT_MS: { type: "text", value: "2500" },
  };
  await mf.setOptions(options);
  const timeoutResponse = await startRun(ana, {
    chatId: "chat-timeout",
    roomId: room.id,
    prompt: "[scenario:late]",
    access: "ask",
  });
  const waiting = sseReader(timeoutResponse);
  const pending = await waiting.next((e) => e.type === "permission-request");
  await waiting.cancel();
  await sleep(4500);
  const timedOut = await sseReader(await events(ana, pending.id, 0)).all();
  assertSequence(timedOut, pending.id);
  const denied = timedOut.find((e) => e.type === "permission-resolved");
  assert.deepEqual(
    [denied.requestId, denied.allow, denied.reason],
    [pending.requestId, false, "timeout"],
  );
  assert.match(timedOut.find((e) => e.type === "tool-result").output, /timed out after 3 s/);
  assert.equal(timedOut.at(-1).code, "ok");
  assert.ok(!labels(await roomDoc(room.id, ana)).includes("Timed out card"));

  console.log(
    `PASS durable model API runs (${RUNTIME}${DURABLE ? ", AiRun host" : ", request-scoped"})`,
  );
} finally {
  await mf.dispose();
  await fake.close();
  await fs.rm(dir, { recursive: true, force: true });
}
