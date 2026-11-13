// Large changes in shared rooms, on the real room actor (workerd) where a room is involved:
// - VerynizeOps.apply copies only what a batch writes (frozen input, shared untouched pages and
//   nodes) and stays within its heap budget for 4,900 nodes of 4 KB;
// - VerynizeRoomLimits.batchOps keeps one change in one batch when it fits, and otherwise splits
//   it into whole artboards (parents before children) under the batch byte limit, so a peer
//   applying the broadcasts one by one never holds half an artboard or an orphaned node;
// - the room refuses a batch of several operations above BATCH_BYTES (`code: batch_too_large`)
//   and accepts one large operation alone;
// - nodes are stored one per row: a page stored as one node text (the format before node rows,
//   ROOM_NODE_STORAGE=page) converts on open and back, an edit rewrites only its rows;
// - presence version 2 sends one peer per change, `peerLeft`, heartbeats without broadcasts and
//   closes silent sockets, while older clients keep receiving the whole list.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import v8 from "node:v8";
import vm from "node:vm";
import "../web/cloud-ops.js";
import "../web/room-limits.js";
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";

v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc");
const Ops = globalThis.VerynizeOps;
const Limits = globalThis.VerynizeRoomLimits;
const MB = 1024 * 1024;

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
const heavy = (id, parentId, bytes = 4096) =>
  node(id, { type: "text", parentId, text: "x".repeat(bytes) });
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) freeze(value[key]);
  }
  return value;
}
const heapAfter = (run) => {
  gc();
  gc();
  const before = process.memoryUsage().heapUsed;
  const kept = run();
  gc();
  gc();
  const used = process.memoryUsage().heapUsed - before;
  return { kept, mb: Math.round((used / MB) * 10) / 10 };
};
/** An import of `boards` artboards, each a frame holding a group of `per` heavy nodes. */
function importOps(page, boards, per, bytes = 4096) {
  const ops = [];
  for (let b = 0; b < boards; b++) {
    const board = `b${b}`,
      group = `g${b}`;
    ops.push({ t: "add", page, id: board, value: node(board, { type: "frame" }) });
    ops.push({ t: "add", page, id: group, value: node(group, { type: "frame", parentId: board }) });
    for (let i = 0; i < per; i++) {
      const id = `n${b}_${i}`;
      ops.push({ t: "add", page, id, value: heavy(id, group, bytes) });
    }
  }
  return ops;
}
/** Every node's parent exists, and each artboard present holds all of its nodes. */
function assertWhole(doc, per, label) {
  for (const page of doc.pages) {
    const ids = new Set(page.nodes.map((item) => item.id));
    for (const item of page.nodes)
      assert.ok(item.parentId == null || ids.has(item.parentId), `${label}: ${item.id} orphaned`);
    for (const item of page.nodes)
      if (item.type === "frame" && item.parentId == null) {
        const b = item.id.slice(1);
        const count = page.nodes.filter((n) => n.id.startsWith(`n${b}_`)).length;
        assert.equal(count, per, `${label}: artboard ${item.id} complete`);
      }
  }
}

// ---- Ops.apply: copy on write, atomic, bounded heap ------------------------------------------
{
  const doc = freeze({
    version: 2,
    pages: [
      { id: "p1", nodes: [node("a"), node("b", { parentId: "a" }), node("c")] },
      { id: "p2", nodes: [node("d")] },
    ],
  });
  const ops = freeze([
    { t: "node", page: "p1", id: "b", key: "x", value: 5 },
    { t: "add", page: "p1", id: "e", value: node("e", { parentId: "a" }) },
    { t: "node", page: "p1", id: "e", key: "x", value: 7 },
    { t: "remove", page: "p1", id: "c" },
    { t: "node", page: "p1", id: "missing", key: "x", value: 1 },
  ]);
  for (const owned of [false, true]) {
    const result = Ops.apply(doc, ops, { owned, normalize: true });
    assert.deepEqual(
      result.rejected.map((item) => item.reason),
      ["Missing node"],
    );
    assert.deepEqual(
      result.doc.pages[0].nodes.map((item) => [item.id, item.x]),
      [
        ["a", 0],
        ["b", 5],
        ["e", 7],
      ],
    );
    assert.equal(result.doc.pages[1], doc.pages[1], "an untouched page is shared");
    assert.equal(
      result.doc.pages[0].nodes[0],
      doc.pages[0].nodes[0],
      "an untouched node is shared",
    );
    assert.equal(doc.pages[0].nodes.length, 3, "the input document is unchanged");
    assert.equal(ops[1].value.x, 0, "operation values are never changed in place");
  }
  // Atomic: a batch is applied to a copy; its rejected operations leave the result untouched.
  const none = Ops.apply(doc, [{ t: "remove", page: "p1", id: "zzz" }]);
  assert.equal(none.doc, doc);

  const N = 4900;
  const message = JSON.stringify({
    type: "ops",
    batch: 1,
    ops: importOps("p", 49, N / 49 - 2),
  });
  const empty = { version: 2, pages: [{ id: "p", nodes: [] }] };
  const parsed = JSON.parse(message).ops;
  const copied = heapAfter(() => Ops.apply(empty, parsed, { normalize: true }));
  const owned = heapAfter(() => Ops.apply(empty, parsed, { owned: true, normalize: true }));
  assert.equal(owned.kept.doc.pages[0].nodes.length, 4900);
  const big = owned.kept.doc;
  const edit = heapAfter(() =>
    Ops.apply(big, [{ t: "node", page: "p", id: "n0_0", key: "x", value: 1 }], { normalize: true }),
  );
  assert.equal(edit.kept.doc.pages[0].nodes[1], big.pages[0].nodes[1]);
  console.log(
    `Ops.apply heap, ${N} nodes × 4 KB (${Math.round(message.length / MB)} MB): copied ${copied.mb} MB, handed over ${owned.mb} MB; one edit on that page ${edit.mb} MB`,
  );
  assert.ok(copied.mb < 40, `copying apply stays under 40 MB (${copied.mb})`);
  assert.ok(owned.mb < 10, `server apply (owned values) allocates almost nothing (${owned.mb})`);
  assert.ok(edit.mb < 5, `one edit does not copy the page (${edit.mb})`);
}

// ---- batchOps: one change, one batch; larger changes as whole artboards ----------------------
const emptyDoc = { version: 2, pages: [{ id: "p", nodes: [] }] };
{
  // 4,901 small operations fit one batch: a peer never sees the first 4,000 alone.
  const small = Array.from({ length: 4901 }, (_, i) => ({
    t: "node",
    page: "p",
    id: "n" + i,
    key: "x",
    value: i,
  }));
  assert.deepEqual(
    Limits.batchOps(small).map((batch) => batch.length),
    [4901],
  );
  // More operations than a batch holds still split.
  assert.deepEqual(
    Limits.batchOps(
      Array.from({ length: Limits.BATCH_OPS + 1 }, () => ({ t: "remove", page: "p", id: "a" })),
    ).map((batch) => batch.length),
    [Limits.BATCH_OPS, 1],
  );

  const ops = importOps("p", 49, 98);
  const after = Ops.apply(emptyDoc, ops).doc;
  const batches = Limits.batchOps(ops, { documents: () => ({ before: emptyDoc, after }) });
  assert.ok(batches.length > 4, "a 20 MB import is split");
  let replica = emptyDoc;
  const seen = new Map();
  batches.forEach((batch, index) => {
    const bytes = Limits.bytes({ type: "ops", batch: Number.MAX_SAFE_INTEGER, ops: batch });
    assert.ok(bytes <= Limits.BATCH_BYTES, `batch ${index} is ${bytes} bytes`);
    for (const op of batch) {
      const board = op.id.startsWith("n")
        ? "b" + op.id.slice(1).split("_")[0]
        : "b" + op.id.slice(1);
      assert.ok(!seen.has(board) || seen.get(board) === index, `${board} stays in one batch`);
      seen.set(board, index);
    }
    const result = Ops.apply(replica, batch);
    assert.equal(result.rejected.length, 0);
    replica = result.doc;
    assertWhole(replica, 98, `after batch ${index}`);
  });
  assert.equal(JSON.stringify(replica), JSON.stringify(after), "the batches add up to the change");

  // A new page too large for one batch arrives empty, then artboard by artboard.
  const page = { id: "q", name: "Imported", nodes: after.pages[0].nodes };
  const pageBatches = Limits.batchOps([{ t: "addPage", id: "q", value: page }], {
    documents: () => ({ before: emptyDoc, after: { pages: [emptyDoc.pages[0], page] } }),
  });
  assert.equal(pageBatches[0][0].t, "addPage");
  assert.equal(pageBatches[0][0].value.nodes.length, 0);
  replica = emptyDoc;
  for (const batch of pageBatches) {
    replica = Ops.apply(replica, batch).doc;
    assertWhole(replica, 98, "new page");
  }
  assert.deepEqual(replica.pages[1], page);

  // Removing artboards: children leave before (or with) their parents.
  const removal = after.pages[0].nodes.map((item) => ({ t: "remove", page: "p", id: item.id }));
  replica = after;
  for (const batch of Limits.batchOps(removal, {
    documents: () => ({ before: after, after: emptyDoc }),
  })) {
    replica = Ops.apply(replica, batch).doc;
    assertWhole(replica, 98, "removal");
  }
  assert.equal(replica.pages[0].nodes.length, 0);

  // One operation larger than a batch travels alone; beyond the message limit nothing is sent.
  const huge = { t: "node", page: "p", id: "n0_0", key: "text", value: "y".repeat(5 * MB) };
  assert.deepEqual(Limits.batchOps([ops[0], ops[1], huge]), [[ops[0], ops[1]], [huge]]);
  const small2 = { ...huge, id: "n0_1", value: "small" };
  assert.deepEqual(Limits.batchOps([huge, small2]), [[huge], [small2]]);
  assert.equal(Limits.batchOps([{ ...huge, value: "y".repeat(Limits.MESSAGE_BYTES) }]), null);
}

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-room-scale-"));
const state = path.join(dir, "state");
let mf;
const call = (route, { method = "GET", body, token } = {}) =>
  mf.dispatchFetch("http://local" + route, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
const data = async (response, status = 200) => {
  const text = await response.text();
  assert.equal(response.status, status, text.slice(0, 300));
  return JSON.parse(text);
};
async function socket(route) {
  const upgrade = await mf.dispatchFetch("http://local" + route, {
    headers: { Upgrade: "websocket" },
  });
  assert.equal(upgrade.status, 101);
  const ws = upgrade.webSocket;
  const seen = [];
  let closed = null;
  ws.addEventListener("message", (event) => seen.push(JSON.parse(event.data)));
  ws.addEventListener("close", (event) => (closed = event.code));
  ws.accept();
  const next = (predicate, label = "message", ms = 15000) =>
    new Promise((resolve, reject) => {
      const take = () => {
        const found = seen.findIndex(predicate);
        if (found < 0) return false;
        clearInterval(poll);
        clearTimeout(timer);
        resolve(seen.splice(found, 1)[0]);
        return true;
      };
      const poll = setInterval(take, 5);
      const timer = setTimeout(() => {
        clearInterval(poll);
        reject(Error("Missing " + label));
      }, ms);
      take();
    });
  return {
    ws,
    seen,
    next,
    closed: () => closed,
    send: (value) => ws.send(JSON.stringify(value)),
  };
}
const byText = (a, b) => a.localeCompare(b);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** The SQLite file of a room, found by one of its page ids. */
function roomDb(pageId) {
  return fs.readdir(state, { recursive: true }).then((files) => {
    for (const file of files) {
      if (!file.endsWith(".sqlite")) continue;
      const db = new DatabaseSync(path.join(state, file), { readOnly: true });
      try {
        if (
          db.prepare("SELECT name FROM sqlite_master WHERE name='pages'").get() &&
          db.prepare("SELECT 1 AS found FROM pages WHERE id=?").get(pageId)
        )
          return path.join(state, file);
      } finally {
        db.close();
      }
    }
    return null;
  });
}
const inspect = async (pageId, query, ...bindings) => {
  const db = new DatabaseSync(await roomDb(pageId), { readOnly: true });
  try {
    return db.prepare(query).all(...bindings);
  } finally {
    db.close();
  }
};
const options = async (env = {}) => {
  const fixture = await cloudOptions(state);
  for (const [key, value] of Object.entries(env))
    fixture.workers[0].config.env[key] = { type: "text", value };
  return fixture;
};

try {
  // ---- a large import reaches a peer as whole artboards ---------------------------------------
  mf = new Miniflare(await options());
  const room = await data(
    await call("/api/rooms", { method: "POST", body: { document: emptyDoc } }),
    201,
  );
  const url = "/api/rooms/" + room.id;
  const sender = await socket(`${url}/socket?token=${room.token}&client=importer&presence=2`);
  const peer = await socket(`${url}/socket?token=${room.token}&client=watcher&presence=2`);
  await sender.next((m) => m.type === "snapshot", "sender snapshot");
  await peer.next((m) => m.type === "snapshot", "peer snapshot");
  await peer.next((m) => m.type === "presence", "peer list on join");
  // About 10 MB: several batches, and room for one more large operation under the page limit.
  const ops = importOps("p", 49, 98, 2048);
  const after = Ops.apply(emptyDoc, ops).doc;
  const clock = Ops.createClock("importer");
  const batches = Limits.batchOps(
    ops.map((op) => ({ ...op, s: clock.next() })),
    { documents: () => ({ before: emptyDoc, after }) },
  );
  batches.forEach((batch, index) => sender.send({ type: "ops", batch: index + 1, ops: batch }));
  let replica = emptyDoc;
  for (let index = 0; index < batches.length; index++) {
    const message = await peer.next((m) => m.type === "ops", `broadcast ${index + 1}`);
    assert.equal(message.ops.length, batches[index].length, "one batch, one broadcast");
    replica = Ops.apply(replica, message.ops).doc;
    assertWhole(replica, 98, `peer after broadcast ${index + 1}`);
  }
  assert.equal(replica.pages[0].nodes.length, after.pages[0].nodes.length);
  const stored = (await data(await call(url, { token: room.token }))).document;
  assert.deepEqual(
    stored.pages[0].nodes.map((item) => item.id),
    after.pages[0].nodes.map((item) => item.id),
  );

  // ---- the room refuses several operations above BATCH_BYTES ---------------------------------
  const revision = (await data(await call(url, { token: room.token }))).revision;
  const oversized = {
    client: "rogue",
    batch: 1,
    ops: [
      { t: "node", page: "p", id: "n0_0", key: "text", value: "z".repeat(2.5 * MB) },
      { t: "node", page: "p", id: "n0_1", key: "text", value: "z".repeat(2.5 * MB) },
    ],
  };
  const refused = await data(
    await call(`${url}/ops`, { method: "POST", token: room.token, body: oversized }),
    413,
  );
  assert.equal(refused.code, Limits.BATCH_TOO_LARGE);
  assert.equal(refused.rejected, 2);
  sender.send({ type: "ops", ...oversized, batch: batches.length + 1 });
  const socketRefusal = await sender.next((m) => m.type === "ops" && m.code, "socket refusal");
  assert.equal(socketRefusal.code, Limits.BATCH_TOO_LARGE);
  assert.equal((await data(await call(url, { token: room.token }))).revision, revision);
  assert.equal(
    peer.seen.filter((m) => m.type === "ops").length,
    0,
    "a refused batch reaches nobody",
  );
  // One large operation alone is accepted.
  const alone = await data(
    await call(`${url}/ops`, {
      method: "POST",
      token: room.token,
      body: {
        client: "rogue",
        batch: 2,
        ops: [{ ...oversized.ops[0], value: "w".repeat(5 * MB) }],
      },
    }),
  );
  assert.equal(alone.ops.length, 1);
  assert.equal(alone.revision, revision + 1);
  await peer.next((m) => m.type === "ops", "large single operation");

  // ---- presence version 2 --------------------------------------------------------------------
  const legacy = await socket(`${url}/socket?token=${room.token}&client=legacy`);
  const legacyWelcome = await legacy.next((m) => m.type === "welcome");
  assert.equal(legacyWelcome.presence, 2, "the room announces presence version 2");
  const joined = await legacy.next((m) => m.type === "presence", "legacy list on join");
  assert.equal(joined.peers.length, 3);
  // Peers already here learn about the newcomer as one peer, not the whole list.
  const newcomer = await peer.next((m) => m.type === "peer", "newcomer delta");
  assert.equal(newcomer.peer.id, legacyWelcome.id);
  assert.equal(peer.seen.filter((m) => m.type === "presence").length, 0);

  const senderId = (await sender.next((m) => m.type === "welcome")).id;
  sender.send({ type: "presence", name: "Ada", pageId: "p", cursor: { x: 1, y: 2 } });
  const moved = await peer.next((m) => m.type === "peer" && m.peer.name === "Ada", "cursor delta");
  assert.deepEqual(moved.peer, {
    id: senderId,
    name: "Ada",
    role: "owner",
    pageId: "p",
    cursor: { x: 1, y: 2 },
    handle: null,
  });
  const legacyList = await legacy.next(
    (m) => m.type === "presence" && m.peers.some((item) => item.name === "Ada"),
    "legacy list on change",
  );
  assert.equal(legacyList.peers.length, 3);
  // A heartbeat is not broadcast.
  const before = legacy.seen.length + peer.seen.length;
  sender.send({ type: "heartbeat" });
  sender.send({ type: "presence", name: "Ada", pageId: "p", cursor: { x: 3, y: 4 } });
  await peer.next((m) => m.type === "peer" && m.peer.cursor?.x === 3, "after heartbeat");
  await legacy.next((m) => m.type === "presence", "legacy after heartbeat");
  assert.equal(legacy.seen.length + peer.seen.length, before, "only the presence was sent");
  // Leaving: version 2 gets `peerLeft`, older clients the list without the peer.
  legacy.ws.close(1000);
  const left = await peer.next((m) => m.type === "peerLeft", "peerLeft");
  assert.deepEqual(left.ids, [legacyWelcome.id]);
  sender.ws.close(1000);
  await peer.next((m) => m.type === "peerLeft" && m.ids[0] === senderId, "sender left");
  peer.ws.close(1000);
  await mf.dispose();

  // A silent presence-2 socket is closed (on a heartbeat, or when a socket joins); an older
  // client is never timed out.
  mf = new Miniflare(await options({ PRESENCE_TIMEOUT_MS: "1500" }));
  const live = await socket(`${url}/socket?token=${room.token}&client=live&presence=2`);
  const silent = await socket(`${url}/socket?token=${room.token}&client=silent&presence=2`);
  const old = await socket(`${url}/socket?token=${room.token}&client=old`);
  const silentId = (await silent.next((m) => m.type === "welcome")).id;
  // Clients send their presence on open; the socket is silent afterwards.
  silent.send({ type: "presence", name: "Silent", pageId: "p", cursor: null });
  const oldId = (await old.next((m) => m.type === "welcome")).id;
  const beat = async (ms) => {
    for (let at = 0; at < ms; at += 500) {
      await pause(500);
      live.send({ type: "heartbeat" });
    }
  };
  await beat(1000);
  await pause(800);
  // A socket joining prunes too, before it gets the list.
  const late = await socket(`${url}/socket?token=${room.token}&client=late`);
  const lateList = await late.next((m) => m.type === "presence", "late list");
  assert.deepEqual(
    lateList.peers.map((item) => item.id).sort(byText),
    [
      (await live.next((m) => m.type === "welcome")).id,
      oldId,
      (await late.next((m) => m.type === "welcome")).id,
    ].sort(byText),
  );
  for (let i = 0; i < 250 && silent.closed() === null; i++) await pause(20);
  assert.equal(silent.closed(), 4408);
  const pruned = await live.next((m) => m.type === "peerLeft", "silent socket dropped");
  assert.deepEqual(pruned.ids, [silentId]);
  const oldList = await old.next(
    (m) => m.type === "presence" && !m.peers.some((item) => item.id === silentId),
    "old client list",
  );
  assert.ok(
    oldList.peers.some((item) => item.id === oldId),
    "the older client stays",
  );
  // Heartbeats prune too: a second silent socket leaves while `live` keeps beating.
  const quiet = await socket(`${url}/socket?token=${room.token}&client=quiet&presence=2`);
  const quietId = (await quiet.next((m) => m.type === "welcome")).id;
  await beat(2500);
  assert.deepEqual((await live.next((m) => m.type === "peerLeft", "quiet dropped")).ids, [quietId]);
  // A dropped socket's late messages reach nobody.
  quiet.send({ type: "presence", name: "Ghost", pageId: "p", cursor: null });
  await pause(300);
  assert.ok(!live.seen.some((m) => m.type === "peer" && m.peer.name === "Ghost"));
  for (const client of [live, old, late, quiet]) client.ws.close(1000);
  await mf.dispose();

  // ---- node rows: conversion from page texts, row-level writes, conversion back ---------------
  const big = "😀".repeat(200_000); // above one row: stored in parts
  const doc = {
    version: 2,
    name: "Rows",
    activePage: "r1",
    pages: [
      {
        id: "r1",
        name: "One",
        nodes: [
          node("ra"),
          node("rb", { parentId: "ra" }),
          node("rc", { text: big, type: "text" }),
        ],
      },
      { id: "r2", name: "Two", nodes: [node("rd")] },
    ],
  };
  mf = new Miniflare(await options({ ROOM_NODE_STORAGE: "page" }));
  const rows = await data(
    await call("/api/rooms", { method: "POST", body: { document: doc } }),
    201,
  );
  const rowsUrl = "/api/rooms/" + rows.id;
  await data(
    await call(`${rowsUrl}/ops`, {
      method: "POST",
      token: rows.token,
      body: {
        client: "rows",
        batch: 1,
        ops: [{ t: "node", page: "r2", id: "rd", key: "x", value: 3 }],
      },
    }),
  );
  doc.pages[1].nodes[0].x = 3;
  await mf.dispose();
  // The format before node rows: one node text per page, no rows.
  assert.equal((await inspect("r1", "SELECT count(*) AS n FROM node_rows"))[0].n, 0);
  assert.deepEqual(
    (
      await inspect("r1", "SELECT key FROM parts WHERE key LIKE 'n:%' GROUP BY key ORDER BY key")
    ).map((row) => row.key),
    ["n:r1", "n:r2"],
  );
  assert.equal((await inspect("r1", "SELECT value FROM meta WHERE key='nodes'")).length, 0);

  mf = new Miniflare(await options());
  assert.deepEqual((await data(await call(rowsUrl, { token: rows.token }))).document, doc);
  await mf.dispose();
  const converted = await inspect(
    "r1",
    "SELECT slot,page_id,node_id,data FROM node_rows ORDER BY page_id,position",
  );
  assert.deepEqual(
    converted.map((row) => row.node_id),
    ["ra", "rb", "rc", "rd"],
  );
  assert.equal(converted[2].data, null, "a node above one row keeps its JSON in parts");
  assert.equal(
    (await inspect("r1", "SELECT count(*) AS n FROM parts WHERE key LIKE 'n:%'"))[0].n,
    0,
  );
  assert.equal((await inspect("r1", "SELECT value FROM meta WHERE key='nodes'"))[0].value, "rows");

  // Edits rewrite their rows only: other rows keep their slot and text.
  mf = new Miniflare(await options());
  const editOps = [
    { t: "node", page: "r1", id: "rb", key: "x", value: 9 },
    { t: "add", page: "r1", id: "re", value: node("re") },
    { t: "remove", page: "r2", id: "rd" },
    { t: "nodeOrder", page: "r1", value: ["re", "ra", "rb", "rc"] },
  ];
  await data(
    await call(`${rowsUrl}/ops`, {
      method: "POST",
      token: rows.token,
      body: { client: "rows", batch: 2, ops: editOps },
    }),
  );
  const edited = Ops.apply(doc, editOps).doc;
  assert.deepEqual((await data(await call(rowsUrl, { token: rows.token }))).document, edited);
  await mf.dispose();
  const after2 = await inspect(
    "r1",
    "SELECT slot,node_id,data FROM node_rows ORDER BY page_id,position",
  );
  assert.deepEqual(
    after2.map((row) => row.node_id),
    ["re", "ra", "rb", "rc"],
  );
  const bySlot = new Map(converted.map((row) => [row.node_id, row]));
  for (const id of ["ra", "rc"]) {
    const row = after2.find((item) => item.node_id === id);
    assert.equal(row.slot, bySlot.get(id).slot, `${id} keeps its row`);
    assert.equal(row.data, bySlot.get(id).data, `${id} is not rewritten`);
  }
  assert.equal(after2.find((row) => row.node_id === "rb").slot, bySlot.get("rb").slot);
  assert.equal(JSON.parse(after2.find((row) => row.node_id === "rb").data).x, 9);
  assert.deepEqual(
    (await inspect("r1", "SELECT node_id FROM node_pages ORDER BY node_id")).map(
      (row) => row.node_id,
    ),
    ["ra", "rb", "rc", "re"],
  );

  // Rolling back: ROOM_NODE_STORAGE=page converts the rows into page texts again.
  mf = new Miniflare(await options({ ROOM_NODE_STORAGE: "page" }));
  assert.deepEqual((await data(await call(rowsUrl, { token: rows.token }))).document, edited);
  await mf.dispose();
  assert.equal((await inspect("r1", "SELECT count(*) AS n FROM node_rows"))[0].n, 0);
  assert.equal(
    (await inspect("r1", "SELECT count(*) AS n FROM parts WHERE key LIKE 'r:%'"))[0].n,
    0,
  );
  mf = new Miniflare(await options());
  assert.deepEqual((await data(await call(rowsUrl, { token: rows.token }))).document, edited);

  console.log(
    "PASS room scale: copy-on-write Ops.apply under its heap budget, byte-limited batches of whole artboards seen whole by a peer, batch_too_large refusal, node rows with conversion both ways, presence deltas with heartbeat",
  );
} finally {
  await mf?.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
