// Multi-instance guarantees of the Vercel runtime (cloud/platform/vercel), with real processes:
// a local redis-server, one libSQL database (file: URL) and four function instances on their own
// ports. Clients speak the room protocol of web/cloud-panel.js (client ids, numbered batches,
// `acked` on reconnect, resend of unacknowledged batches).
//
// 1. Concurrent edits to one room through different instances converge, every socket sees every
//    revision exactly once and in order, and no batch is applied twice.
// 2. A lease holder frozen mid-turn (SIGSTOP after running the batch, before committing) is
//    taken over by another instance; when it resumes its commit is fenced, nothing it computed
//    is acknowledged; its interrupted batch is retained/rejected and a fresh retry applies once.
// 3. A lease holder killed mid-turn (SIGKILL): takeover, interrupted batch retained, its sockets leave
//    the registry once its heartbeat lapses.
// 4. A socket cut at the function's maximum duration reconnects without duplicates.
// 5. Revoking a link on one instance disconnects its socket on another.
// 6. A restart of every instance and of Redis (fence counters lost) keeps state and writes.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import "../web/cloud-ops.js";
import { cloudOptions } from "./cloud-harness.mjs";
import { nodeBindings } from "./helpers/node-cloud.mjs";
import { startInstance, startRedis } from "./helpers/vercel-cloud.mjs";

const Ops = globalThis.VerynizeOps;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const node = (id, extra = {}) => ({
  id,
  type: "rectangle",
  parentId: null,
  name: id,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  text: "",
  ...extra,
});
const NAMES = ["alice", "bob", "carol", "dave", "erin", "frank", "george", "henry", "ivy"];
const start = {
  version: 2,
  name: "Board",
  activePage: "p1",
  pages: [{ id: "p1", name: "Page 1", nodes: [node("shared"), ...NAMES.map((n) => node(n))] }],
};

async function until(predicate, what, ms = 15000) {
  const deadline = Date.now() + ms;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${what}`);
    await sleep(20);
  }
}
const once = (emitter, event, ms = 15000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No ${event} event`)), ms);
    emitter.once(event, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });

async function http(origin, route, { method = "GET", body, token } = {}) {
  const init = {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-host": "local",
      "x-forwarded-proto": "http",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(origin + route, init);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** A room client with web/cloud-panel.js's delivery rules. */
class Client {
  constructor(room, name, token = room.token) {
    this.room = room;
    this.name = name;
    this.token = token;
    this.clock = Ops.createClock(name);
    this.batch = 0;
    this.pending = [];
    this.connections = []; // per connection: {origin, messages, closed}
    this.ops = []; // every `ops` message with operations, across connections
    this.reconnectTo = null; // () => origin for automatic reconnects
  }
  get current() {
    return this.connections.at(-1);
  }
  connect(origin) {
    const url = new URL(`/api/rooms/${this.room.id}/socket`, origin.replace(/^http/, "ws"));
    url.searchParams.set("token", this.token);
    url.searchParams.set("client", this.name);
    const ws = new WebSocket(url, { headers: { "x-forwarded-host": "local" } });
    const connection = { origin, ws, messages: [], closed: null, open: false };
    this.connections.push(connection);
    ws.on("open", () => (connection.open = true));
    ws.on("message", (data) => {
      const message = JSON.parse(/** @type {Buffer} */ (data).toString());
      connection.messages.push(message);
      if (message.type === "snapshot") {
        this.pending = this.pending.filter((b) => b.n > (message.acked || 0));
        for (const b of this.pending) this.#send(connection, b);
      } else if (message.type === "ops") {
        if (message.ops?.length) this.ops.push(message);
        if (message.client === this.name)
          this.pending = this.pending.filter((b) => b.n > message.batch);
      }
    });
    ws.on("close", (code, reason) => {
      connection.closed = { code, reason: reason.toString() };
      if (this.reconnectTo && connection === this.current)
        setTimeout(() => this.reconnectTo && this.connect(this.reconnectTo()), 100);
    });
    ws.on("error", () => {});
    return until(
      () => connection.messages.some((m) => m.type === "snapshot"),
      `${this.name} snapshot`,
    ).then(() => connection);
  }
  #send(connection, b) {
    if (connection.ws.readyState === 1)
      connection.ws.send(JSON.stringify({ type: "ops", batch: b.n, ops: b.ops }));
  }
  /** A batch setting this client's node x (and the shared node's name, contended). */
  edit(value, shared = false) {
    const ops = [{ t: "node", page: "p1", id: this.name, key: "x", value, s: this.clock.next() }];
    if (shared)
      ops.push({
        t: "node",
        page: "p1",
        id: "shared",
        key: "name",
        value: `${this.name}-${value}`,
        s: this.clock.next(),
      });
    const b = { n: ++this.batch, ops };
    this.pending.push(b);
    if (this.current) this.#send(this.current, b);
    return b.n;
  }
  settled(what = `${this.name} acknowledged`) {
    return until(() => !this.pending.length, what);
  }
  close() {
    this.reconnectTo = null;
    for (const { ws } of this.connections) ws.terminate();
  }
}

/** The presence list a new socket on `origin` receives. */
async function peersVia(room, origin) {
  const probe = new Client(room, "probe");
  const connection = await probe.connect(origin);
  await until(() => connection.messages.some((m) => m.type === "presence"), "presence");
  probe.close();
  return connection.messages.filter((m) => m.type === "presence").at(-1).peers;
}

/** Revisions of the ops messages a client saw: strictly increasing by one, no duplicates. */
function assertOrdered(client, from, to) {
  const revisions = client.ops.map((m) => m.revision);
  const expected = Array.from({ length: to - from }, (_, i) => from + i + 1);
  assert.deepEqual(revisions, expected, `${client.name} saw revisions in commit order`);
}
/** How many times a batch of a client was applied, according to a full ops stream. */
const applications = (stream, name, batch) =>
  stream.filter((m) => m.client === name && m.batch === batch).length;

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-vercel-instances-"));
const persistence = path.join(dir, "state");
const pauseFile = path.join(dir, "pause");
const options = await cloudOptions(persistence);
await fs.mkdir(path.join(persistence, "libsql"), { recursive: true });
let redis = await startRedis();
let instances = [];
const clients = [];
const base = () => ({
  module: path.resolve("cloud/worker.js"),
  fixture: false,
  dataDir: persistence,
  bindings: nodeBindings(options.workers[0].config.env),
  redisUrl: redis.url,
  databaseUrl: `file:${path.join(persistence, "libsql", "verynize.db")}`,
  leaseMs: 1500,
  aliveMs: 3000,
});
async function startAll() {
  // A can be paused mid-turn; D cuts sockets after 2 s like a function's maximum duration.
  const A = await startInstance({ ...base(), pauseFile });
  const [B, C, D] = await Promise.all([
    startInstance(base()),
    startInstance(base()),
    startInstance({ ...base(), maxDurationMs: 2000 }),
  ]);
  instances = [A, B, C, D];
  return instances;
}
const client = (...args) => {
  const value = new Client(...args);
  clients.push(value);
  return value;
};

try {
  let [A, B, C, D] = await startAll();
  const created = await http(A.origin, "/api/rooms", { method: "POST", body: { document: start } });
  assert.equal(created.status, 201);
  const room = created.body;
  const actor = `DesignRoom/${room.id}`;
  const roomState = async (origin) =>
    (await http(origin, `/api/rooms/${room.id}`, { token: room.token })).body;

  // 1. Concurrent edits through four instances: sockets on A, B and C, HTTP /ops through D.
  const alice = client(room, "alice"),
    bob = client(room, "bob"),
    carol = client(room, "carol");
  await Promise.all([alice.connect(A.origin), bob.connect(B.origin), carol.connect(C.origin)]);
  const ROUNDS = 25;
  const daveClock = Ops.createClock("dave");
  const daveBatches = [];
  for (let n = 1; n <= ROUNDS; n++) {
    alice.edit(n, true);
    bob.edit(n, true);
    carol.edit(n, n % 2 === 0);
    if (n <= 10)
      daveBatches.push(
        http(D.origin, `/api/rooms/${room.id}/ops`, {
          method: "POST",
          token: room.token,
          body: {
            client: "dave",
            batch: n,
            ops: [{ t: "node", page: "p1", id: "dave", key: "x", value: n, s: daveClock.next() }],
          },
        }),
      );
  }
  for (const response of await Promise.all(daveBatches)) assert.equal(response.status, 200);
  await Promise.all([alice.settled(), bob.settled(), carol.settled()]);
  const total = ROUNDS * 3 + 10;
  await until(
    () => [alice, bob, carol].every((c) => c.ops.length === total),
    "every socket received every revision",
  );
  for (const c of [alice, bob, carol]) assertOrdered(c, 0, total);
  for (const c of [alice, bob, carol])
    for (let n = 1; n <= ROUNDS; n++) assert.equal(applications(alice.ops, c.name, n), 1);
  for (let n = 1; n <= 10; n++) assert.equal(applications(alice.ops, "dave", n), 1);
  const states = await Promise.all(instances.map((i) => roomState(i.origin)));
  for (const state of states) {
    assert.equal(state.revision, total);
    assert.deepEqual(state.document, states[0].document);
  }
  // Replaying the broadcast stream in order reproduces the stored document.
  let replay = start;
  for (const message of alice.ops) replay = Ops.apply(replay, message.ops).doc;
  assert.deepEqual(replay, states[0].document);
  const byId = (state, id) => state.document.pages[0].nodes.find((n) => n.id === id);
  for (const name of ["alice", "bob", "carol"]) assert.equal(byId(states[0], name).x, ROUNDS);
  assert.equal(byId(states[0], "dave").x, 10);
  console.log(`ok 1: ${total} concurrent batches via 4 instances converged in commit order`);

  // 2. Freeze the lease holder after it ran a batch and before it committed.
  let revision = total;
  const erin = client(room, "erin"),
    frank = client(room, "frank");
  await Promise.all([erin.connect(A.origin), frank.connect(B.origin)]);
  const erinFirst = erin.current;
  await fs.writeFile(pauseFile, actor);
  const paused = once(A.events, "paused");
  erin.edit(1);
  assert.equal(await paused, actor);
  frank.edit(1); // B waits for A's lease to expire, then takes over with a newer fence
  await frank.settled("frank acknowledged while A is frozen");
  revision++;
  let state = await roomState(C.origin);
  assert.equal(state.revision, revision);
  assert.equal(byId(state, "erin").x, 0, "the frozen holder's batch is not committed");
  erin.reconnectTo = () => C.origin;
  const fenced = once(A.events, "fenced");
  A.child.kill("SIGCONT");
  assert.equal(await fenced, actor);
  await erin.settled("erin's interrupted batch rejected after takeover");
  const rejectedErin = erin.current.messages.find(
    (m) => m.type === "ops" && m.client === "erin" && m.batch === 1,
  );
  assert.equal(rejectedErin?.retained, true);
  assert.equal(rejectedErin?.tooLarge, true);
  assert.match(rejectedErin.error, /interrupted room processing/);
  assert.equal(byId(await roomState(C.origin), "erin").x, 0);
  erin.edit(1); // Explicit fresh retry of retained intent, with a new batch number.
  await erin.settled("erin's fresh retry acknowledged");
  revision++;
  assert.equal(
    erinFirst.messages.filter((m) => m.type === "ops" && m.client === "erin").length,
    0,
    "nothing was acknowledged by the fenced holder",
  );
  assert.equal(erinFirst.closed?.code, 1012);
  await until(() => frank.ops.length >= 2, "frank saw both batches");
  state = await roomState(B.origin);
  assert.equal(state.revision, revision);
  assert.equal(byId(state, "erin").x, 1);
  assert.equal(byId(state, "frank").x, 1);
  assert.equal(applications(frank.ops, "erin", 1), 0);
  assert.equal(applications(frank.ops, "erin", 2), 1);
  console.log(
    "ok 2: frozen lease holder fenced; interrupted batch retained; fresh retry applied once",
  );

  // 3. Kill the lease holder mid-turn.
  erin.reconnectTo = null;
  erin.close();
  const george = client(room, "george");
  await george.connect(B.origin);
  const erin2 = client(room, "erin");
  erin2.batch = 2; // same device: continues its batch numbers
  await erin2.connect(A.origin);
  const doomedId = erin2.current.messages.find((m) => m.type === "welcome").id;
  await fs.writeFile(pauseFile, actor);
  const pausedAgain = once(A.events, "paused");
  erin2.edit(2);
  await pausedAgain;
  erin2.reconnectTo = () => C.origin;
  await A.stop("SIGKILL");
  george.edit(1);
  await george.settled("george acknowledged after the crash");
  await erin2.settled("erin's interrupted batch rejected after the crash");
  const rejectedAgain = erin2.current.messages.find(
    (m) => m.type === "ops" && m.client === "erin" && m.batch === 3,
  );
  assert.equal(rejectedAgain?.retained, true);
  assert.equal(rejectedAgain?.tooLarge, true);
  assert.equal(byId(await roomState(C.origin), "erin").x, 1);
  erin2.edit(2);
  await erin2.settled("erin's fresh retry after the crash");
  revision += 2;
  state = await roomState(C.origin);
  assert.equal(state.revision, revision);
  assert.equal(byId(state, "erin").x, 2);
  assert.equal(byId(state, "george").x, 1);
  await until(() => george.ops.some((m) => m.client === "erin" && m.batch === 4), "erin batch");
  assert.equal(applications(george.ops, "erin", 3), 0);
  assert.equal(applications(george.ops, "erin", 4), 1);
  // The dead instance's sockets leave the registry once its heartbeat lapses.
  await sleep(3200);
  const peers = await peersVia(room, B.origin);
  assert.equal(
    peers.some((peer) => peer.id === doomedId),
    false,
  );
  console.log("ok 3: killed lease holder taken over; acked batches kept; dead sockets pruned");

  // 4. D closes sockets after 2 s (maximum duration): reconnect, no duplicate, no loss.
  const henry = client(room, "henry");
  henry.reconnectTo = () => D.origin;
  const first = await henry.connect(D.origin);
  henry.edit(1);
  await henry.settled();
  await until(() => first.closed, "maximum duration close", 5000);
  await until(() => henry.connections.length === 2 && henry.current.open, "reconnected");
  await until(() => henry.current.messages.some((m) => m.type === "snapshot"), "snapshot");
  assert.equal(henry.current.messages.find((m) => m.type === "snapshot").acked, 1);
  henry.edit(2);
  await henry.settled();
  revision += 2;
  state = await roomState(B.origin);
  assert.equal(state.revision, revision);
  assert.equal(byId(state, "henry").x, 2);
  assert.equal(applications(george.ops, "henry", 1), 1);
  const firstId = first.messages.find((m) => m.type === "welcome").id;
  await until(
    async () => !(await peersVia(room, B.origin)).some((peer) => peer.id === firstId),
    "closed socket left presence",
  );
  henry.close();
  console.log("ok 4: socket cut at maximum duration reconnected without duplicates");

  // 5. A link created on B, used by a socket on C, revoked on D.
  const link = await http(B.origin, `/api/rooms/${room.id}/tokens`, {
    method: "POST",
    token: room.token,
    body: { role: "editor", label: "temporary" },
  });
  assert.equal(link.status, 201);
  const ivy = client(room, "ivy", link.body.token);
  const ivyConnection = await ivy.connect(C.origin);
  const revoked = await http(D.origin, `/api/rooms/${room.id}/tokens/${link.body.id}`, {
    method: "DELETE",
    token: room.token,
  });
  assert.equal(revoked.status, 200);
  await until(() => ivyConnection.closed, "revoked socket closed");
  assert.equal(ivyConnection.closed.code, 4401);
  assert.ok(ivyConnection.messages.some((m) => m.type === "revoked"));
  console.log("ok 5: revocation on one instance disconnected a socket on another");

  // 6. Restart everything, Redis included (its fence counters start over).
  for (const c of clients) c.close();
  await Promise.all(instances.map((instance) => instance.stop()));
  await redis.stop();
  redis = await startRedis();
  [A, B, C, D] = await startAll();
  state = await roomState(C.origin);
  assert.equal(state.revision, revision);
  const alice2 = client(room, "alice");
  alice2.batch = ROUNDS;
  const welcome = await alice2.connect(B.origin);
  assert.equal(welcome.messages.find((m) => m.type === "snapshot").acked, ROUNDS);
  alice2.edit(ROUNDS + 1);
  await alice2.settled("write after a Redis restart");
  assert.equal((await roomState(D.origin)).revision, revision + 1);
  console.log("ok 6: restart of instances and Redis kept state; fences continued above stored");

  console.log(
    "PASS vercel runtime across instances: concurrent convergence and ordering, fenced takeover of a frozen holder, crash takeover, maximum-duration reconnect, cross-instance revocation, restart with Redis loss",
  );
} finally {
  for (const c of clients) c.close();
  await Promise.all(instances.map((instance) => instance.stop("SIGKILL").catch(() => {})));
  await redis.stop();
  await fs.rm(dir, { recursive: true, force: true });
}
