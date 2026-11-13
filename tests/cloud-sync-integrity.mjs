// Room sync integrity on local workerd (cloud/rooms.js, web/room-sync.js): a batch sent again
// answers with its original outcome (or asks for a resync), rejections carry a `code`, a client
// at the room's revision gets node counts and page digests that expose a stale copy, and a socket
// that cannot take a broadcast is closed so its client reconnects instead of missing it.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import "../web/cloud-ops.js";
import "../web/room-sync.js";
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";

const Ops = globalThis.VerynizeOps;
const Sync = globalThis.VerynizeRoomSync;
const node = (id, extra = {}) => ({
  id,
  type: "rectangle",
  parentId: null,
  name: id,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  ...extra,
});
const doc = (nodes) => ({
  version: 2,
  name: "Board",
  activePage: "p1",
  pages: [
    { id: "p1", name: "Page 1", nodes },
    { id: "p2", name: "Page 2", nodes: [node("other")] },
  ],
});

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-sync-integrity-"));
const options = await cloudOptions(path.join(dir, "state"));
const config = options.workers[0].config;
// Faults with no production hook: a batch naming node "poison" resets the room, and a socket
// of client "victim" cannot take a message that names node "fail-send".
config.manifest.modules["sync-faults.js"] = {
  type: "esm",
  contents: `
  import worker, { DesignRoom as Base } from "./index.js";
  export * from "./index.js";
  export default worker;
  export class DesignRoom extends Base {
    applyBatchNow(data, role, who) {
      if (data.ops?.some((op) => op?.id === "poison")) this.ctx.abort("test interrupted batch");
      return super.applyBatchNow(data, role, who);
    }
    deliver(socket, message) {
      const text = typeof message === "string" ? message : JSON.stringify(message);
      if (socket.deserializeAttachment()?.client === "victim" && text.includes('"fail-send"'))
        return super.deliver(
          { send() { throw new Error("injected send failure"); }, close: (c, r) => socket.close(c, r) },
          text,
        );
      return super.deliver(socket, message);
    }
  }
`,
};
config.manifest.mainModule = "sync-faults.js";
let mf = new Miniflare(options);
const api = async (route, method = "GET", data, token) => {
  const response = await mf.dispatchFetch("http://local" + route, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  return { status: response.status, body: await response.json() };
};
async function connect(room, client) {
  const upgrade = await mf.dispatchFetch(
    `http://local/api/rooms/${room.id}/socket?token=${room.token}&client=${client}&lazy=1`,
    { headers: { Upgrade: "websocket" } },
  );
  assert.equal(upgrade.status, 101);
  const socket = upgrade.webSocket,
    seen = [],
    waiters = [];
  let closed = null;
  const closing = new Promise((resolve) =>
    socket.addEventListener("close", (event) => resolve((closed = event.code))),
  );
  socket.addEventListener("message", (event) => {
    const value = JSON.parse(event.data);
    const waiter = waiters.find((item) => item.predicate(value));
    if (waiter) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(value);
    } else seen.push(value);
  });
  socket.accept();
  const next = (predicate, label = "message") =>
    new Promise((resolve, reject) => {
      const found = seen.find(predicate);
      if (found) {
        seen.splice(seen.indexOf(found), 1);
        return resolve(found);
      }
      const timer = setTimeout(() => reject(Error(`Timed out waiting for ${label}`)), 5000);
      waiters.push({
        predicate,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      });
    });
  await next((m) => m.type === "welcome", "welcome");
  return {
    socket,
    next,
    seen,
    closing,
    closed: () => closed,
    send: (value) => socket.send(JSON.stringify(value)),
  };
}

try {
  const clock = Ops.createClock("tester");
  const add = (id, extra) => ({
    t: "add",
    page: "p1",
    id,
    value: node(id, extra),
    s: clock.next(),
  });

  // ---- a batch sent again answers with its original outcome --------------------------------
  {
    const room = (await api("/api/rooms", "POST", { document: doc([node("a")]) })).body;
    const url = `/api/rooms/${room.id}/ops`;
    const first = (
      await api(url, "POST", { client: "dup", batch: 1, ops: [add("mine")] }, room.token)
    ).body;
    assert.equal(first.revision, 1);
    assert.equal(first.ops.length, 1);
    // Another client moves the room on before the resend arrives.
    await api(url, "POST", { client: "peer", batch: 1, ops: [add("theirs")] }, room.token);
    const again = (
      await api(url, "POST", { client: "dup", batch: 1, ops: [add("mine")] }, room.token)
    ).body;
    assert.equal(again.duplicate, true);
    assert.equal(again.revision, 2, "the receipt names the current revision");
    assert.equal(again.appliedRevision, 1, "and the revision that carried the batch");
    assert.equal(again.applied, 1);
    assert.equal(again.resync, undefined);
    // Receipts are kept for the last 64 batches; an older resend asks the client to resync.
    for (let n = 2; n <= 66; n++)
      await api(url, "POST", { client: "dup", batch: n, ops: [add(`n${n}`)] }, room.token);
    const old = (
      await api(url, "POST", { client: "dup", batch: 1, ops: [add("mine")] }, room.token)
    ).body;
    assert.equal(old.duplicate, true);
    assert.equal(old.resync, true);
    assert.equal(old.appliedRevision, undefined);
    const stored = (await api(`/api/rooms/${room.id}`, "GET", null, room.token)).body;
    assert.equal(stored.document.pages[0].nodes.filter((n) => n.id === "mine").length, 1);
  }

  // ---- rejections carry a code -----------------------------------------------------------
  {
    const many = Array.from({ length: 9999 }, (_, i) => node(`m${i}`));
    const room = (await api("/api/rooms", "POST", { document: doc(many) })).body;
    const url = `/api/rooms/${room.id}/ops`;
    const big = await api(
      url,
      "POST",
      { client: "big", batch: 1, ops: [add("x1"), add("x2")] },
      room.token,
    );
    assert.equal(big.status, 413);
    assert.equal(big.body.code, "too_large");
    const repeat = (
      await api(url, "POST", { client: "big", batch: 1, ops: [add("x1"), add("x2")] }, room.token)
    ).body;
    assert.equal(repeat.duplicate, true);
    assert.equal(repeat.code, "too_large");
    // An interrupting batch: the room resets, the resend is refused as "interrupted", and a small
    // edit in the next batch (without the interrupting content) is stored.
    try {
      await api(url, "POST", { client: "poisoner", batch: 1, ops: [add("poison")] }, room.token);
    } catch {}
    const interrupted = await api(
      url,
      "POST",
      { client: "poisoner", batch: 1, ops: [add("poison")] },
      room.token,
    );
    assert.equal(interrupted.status, 413);
    assert.equal(interrupted.body.code, "interrupted");
    const peer = await connect(room, "poisoner");
    peer.send({ type: "sync", pages: ["p1"], revision: 0 });
    const same = await peer.next((m) => m.type === "snapshot", "snapshot");
    assert.deepEqual(same.rejectedBatches, [1]);
    assert.deepEqual(same.rejectedCodes, { 1: "interrupted" });
    const small = (
      await api(
        url,
        "POST",
        {
          client: "poisoner",
          batch: 2,
          ops: [{ t: "node", page: "p1", id: "m0", key: "x", value: 7, s: clock.next() }],
        },
        room.token,
      )
    ).body;
    assert.equal(small.revision, 1);
    assert.equal(small.ops.length, 1);
    peer.socket.close();
  }

  // ---- `same` exposes a stale copy at the room's revision -------------------------------------
  {
    const nodes = Array.from({ length: 4903 }, (_, i) => node(`n${i}`, { x: i }));
    const room = (await api("/api/rooms", "POST", { document: doc(nodes) })).body;
    const server = (await api(`/api/rooms/${room.id}`, "GET", null, room.token)).body;
    const client = await connect(room, "stale");
    client.send({ type: "sync", pages: ["p1"], revision: server.revision });
    const same = await client.next((m) => m.type === "snapshot", "same");
    assert.equal(same.same, true);
    assert.equal(same.document, undefined);
    assert.deepEqual(
      same.pages.map((page) => [page.id, page.nodes]),
      [
        ["p1", 4903],
        ["p2", 1],
      ],
    );
    assert.equal(typeof same.digests.p1, "string");
    assert.equal(same.digests.p2, undefined, "only the pages the client holds");
    // The Worker and this process compute the same digests.
    assert.equal(same.digests.p1, Sync.pageDigest(server.document.pages[0]));
    assert.equal(same.metaDigest, Sync.metaDigest(server.document));
    const unloaded = (id) => id === "p2";
    assert.equal(Sync.divergence(server.document, same, unloaded), null);
    // Three nodes at the same revision number: the node count shows it.
    const stale = structuredClone(server.document);
    stale.pages[0].nodes = stale.pages[0].nodes.slice(0, 3);
    assert.equal(Sync.divergence(stale, same, unloaded), "node count");
    // Same count, different content: the digest shows it.
    const edited = structuredClone(server.document);
    edited.pages[0].nodes[10].x = -1;
    assert.equal(Sync.divergence(edited, same, unloaded), "page content");
    // Key order is not content.
    const reordered = structuredClone(server.document);
    reordered.pages[0].nodes = reordered.pages[0].nodes.map((n) =>
      Object.fromEntries(Object.entries(n).reverse()),
    );
    assert.equal(Sync.divergence(reordered, same, unloaded), null);
    // The resync (no revision) answers with the pages themselves.
    client.send({ type: "sync", pages: ["p1"] });
    const full = await client.next((m) => m.type === "snapshot", "snapshot");
    assert.equal(full.same, undefined);
    assert.equal(full.document.pages[0].nodes.length, 4903);
    client.socket.close();
  }

  // ---- a socket that cannot take a broadcast is closed ----------------------------------------
  {
    const room = (await api("/api/rooms", "POST", { document: doc([node("a")]) })).body;
    const victim = await connect(room, "victim");
    const bystander = await connect(room, "bystander");
    await api(
      `/api/rooms/${room.id}/ops`,
      "POST",
      { client: "editor", batch: 1, ops: [add("fail-send")] },
      room.token,
    );
    const received = await bystander.next((m) => m.type === "ops", "broadcast");
    assert.equal(received.revision, 1);
    assert.equal(await victim.closing, 1011, "the victim's socket is closed, not left behind");
    assert.equal(bystander.closed(), null);
    // Reconnecting at its last revision, the victim gets the operation it missed.
    const back = await connect(room, "victim-2");
    back.send({ type: "sync", pages: ["p1"], revision: 0 });
    const snapshot = await back.next((m) => m.type === "snapshot", "snapshot");
    assert.ok(snapshot.document.pages[0].nodes.some((n) => n.id === "fail-send"));
    back.socket.close();
    bystander.socket.close();
  }

  console.log(
    "PASS sync integrity: duplicate receipts and resync, rejection codes, interrupting batch then small edit, stale copy detection (counts, digests), broadcast failure closes the socket",
  );
} finally {
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
