// Operation-based merging: the shared engine (web/cloud-ops.js) and the room Durable Object on
// local workerd, including concurrent clients over WebSockets, duplicate batches and restarts.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import "../web/cloud-ops.js";
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";

const Ops = globalThis.VerynizeOps;
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
const doc = (nodes, extra = {}) => ({
  version: 2,
  name: "Board",
  activePage: "p1",
  pages: [{ id: "p1", name: "Page 1", nodes }],
  ...extra,
});
const stampAt = (wall, replica) => Ops.createClock(replica, () => wall).next();

// --- engine ---------------------------------------------------------------------------------
{
  const base = doc([
    node("a"),
    node("b", { type: "frame" }),
    node("c", { type: "text", text: "Hello world" }),
  ]);
  // diff → apply reproduces the edited document, including adds, removes, order and pages.
  const edited = structuredClone(base);
  edited.pages[0].nodes[0].x = 50;
  delete edited.pages[0].nodes[0].name;
  edited.pages[0].nodes.splice(1, 1);
  edited.pages[0].nodes.unshift(node("d"));
  edited.pages.push({ id: "p2", name: "Second", nodes: [node("e")] });
  edited.name = "Renamed";
  const ops = Ops.diff(base, edited, { ignore: ["activePage"] });
  assert.equal(ops[0].t, "remove", "removals are emitted first so ids can be reused across pages");
  assert.deepEqual(Ops.apply(base, ops).doc, edited);
  assert.deepEqual(
    Ops.diff(base, { ...base, activePage: "p9" }, { ignore: ["activePage"] }),
    [],
    "local-only keys are not synchronised",
  );
  assert.deepEqual(
    Ops.diff({ nodes: [1] }, { nodes: [2] }),
    [{ t: "doc", key: "nodes", value: [2] }],
    "generic JSON documents fall back to top-level keys",
  );
  assert.deepEqual(Ops.diff([1], [2]), [{ t: "root", value: [2] }]);
  // Per-page rooms load only the pages a batch names (touchedPages) and check node ids on the
  // other pages through `external`.
  const touched = Ops.touchedPages(ops);
  assert.equal(touched.all, false);
  assert.deepEqual(
    [...touched.pages].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ["p1", "p2"],
  );
  assert.equal(
    Ops.touchedPages([
      { t: "doc", key: "name", value: "x" },
      { t: "pageOrder", value: [] },
    ]).pages.size,
    0,
  );
  assert.equal(Ops.touchedPages([{ t: "root", value: {} }, null]).all, true);
  assert.equal(Ops.isNodeOp({ t: "text" }), true);
  assert.equal(Ops.isNodeOp({ t: "page" }), false);
  const stub = { ...base, pages: [base.pages[0], { id: "p9", name: "Unloaded", nodes: [] }] };
  const elsewhere = Ops.apply(
    stub,
    [
      { t: "add", page: "p1", id: "far", value: node("far") },
      { t: "addPage", id: "p8", value: { id: "p8", nodes: [node("far2")] } },
      { t: "add", page: "p1", id: "near", value: node("near") },
    ],
    { external: (id) => id === "far" || id === "far2" },
  );
  assert.deepEqual(
    elsewhere.rejected.map((r) => r.reason),
    ["Node exists", "Node id already used"],
  );
  assert.equal(elsewhere.applied.length, 1);

  // Concurrent edits of different properties of the same node both survive.
  const stamps = Ops.memoryStamps();
  const a = Ops.apply(
    base,
    [{ t: "node", page: "p1", id: "a", key: "x", value: 5, s: stampAt(1000, "alice") }],
    { stamps },
  );
  const b = Ops.apply(
    a.doc,
    [{ t: "node", page: "p1", id: "a", key: "y", value: 7, s: stampAt(999, "bob") }],
    { stamps },
  );
  assert.deepEqual([b.doc.pages[0].nodes[0].x, b.doc.pages[0].nodes[0].y], [5, 7]);
  // Same property: the newer stamp wins even when it arrives first.
  const late = Ops.apply(
    b.doc,
    [{ t: "node", page: "p1", id: "a", key: "x", value: 99, s: stampAt(900, "carol") }],
    { stamps },
  );
  assert.equal(late.doc.pages[0].nodes[0].x, 5);
  assert.deepEqual(
    late.rejected.map((r) => r.reason),
    ["Superseded"],
  );
  // Equal wall clocks are ordered by counter, then replica id.
  assert.ok(stampAt(5, "bob") > stampAt(5, "alice"));

  // Text: disjoint range edits merge; overlapping edits fall back to last writer wins.
  assert.equal(
    Ops.mergeText("Hello world", "Hello brave world", "Hello world!"),
    "Hello brave world!",
  );
  assert.equal(Ops.mergeText("abc", "aXc", "aYc"), null);
  assert.equal(
    Ops.mergeText("ab", "aXb", "aYb"),
    "aYXb",
    "same-point inserts keep both, server-applied first",
  );
  const text = Ops.apply(
    base,
    [
      {
        t: "text",
        page: "p1",
        id: "c",
        key: "text",
        base: "Hello world",
        value: "Hello world!",
        s: stampAt(10, "alice"),
      },
    ],
    { stamps: Ops.memoryStamps() },
  );
  const merged = Ops.apply(
    text.doc,
    [
      {
        t: "text",
        page: "p1",
        id: "c",
        key: "text",
        base: "Hello world",
        value: "Hey world",
        s: stampAt(9, "bob"),
      },
    ],
    { stamps: Ops.memoryStamps() },
  );
  assert.equal(merged.doc.pages[0].nodes[2].text, "Hey world!");
  assert.deepEqual(
    merged.applied[0],
    { t: "node", page: "p1", id: "c", key: "text", value: "Hey world!", s: stampAt(9, "bob") },
    "resolved text is broadcast as a plain set",
  );

  // Tree moves: cycles are rejected, missing parents too.
  const tree = doc([node("f1", { type: "frame" }), node("f2", { type: "frame", parentId: "f1" })]);
  const move = Ops.apply(tree, [
    { t: "node", page: "p1", id: "f1", key: "parentId", value: "f2" },
    { t: "node", page: "p1", id: "f2", key: "parentId", value: "ghost" },
  ]);
  assert.deepEqual(
    move.rejected.map((r) => r.reason),
    ["Move would create a cycle", "Missing parent"],
  );
  // Deleting a frame while someone adds a child to it reattaches the orphan to the page.
  const orphan = Ops.apply(
    tree,
    [
      { t: "remove", page: "p1", id: "f1" },
      { t: "add", page: "p1", id: "k", value: node("k", { parentId: "f1" }) },
    ],
    { normalize: true },
  );
  assert.deepEqual(
    orphan.doc.pages[0].nodes.map((n) => [n.id, n.parentId]),
    [
      ["f2", null],
      ["k", null],
    ],
  );
  // Delete wins over concurrent property edits; a later re-add (undo) restores the node.
  const removed = Ops.apply(base, [{ t: "remove", page: "p1", id: "a", s: stampAt(20, "alice") }], {
    stamps: stamps,
  });
  assert.deepEqual(
    Ops.apply(
      removed.doc,
      [{ t: "node", page: "p1", id: "a", key: "x", value: 1, s: stampAt(21, "bob") }],
      { stamps },
    ).rejected.map((r) => r.reason),
    ["Missing node"],
  );
  assert.deepEqual(
    Ops.apply(
      removed.doc,
      [{ t: "add", page: "p1", id: "a", value: node("a"), s: stampAt(19, "bob") }],
      { stamps },
    ).rejected.map((r) => r.reason),
    ["Superseded"],
    "a stale add cannot resurrect a newer delete",
  );
  assert.equal(
    Ops.apply(
      removed.doc,
      [{ t: "add", page: "p1", id: "a", value: node("a"), s: stampAt(30, "alice") }],
      { stamps },
    ).doc.pages[0].nodes.at(-1).id,
    "a",
  );
  // Malformed and hostile operations are rejected.
  const hostile = Ops.apply(base, [
    { t: "doc", key: "__proto__", value: { polluted: true } },
    { t: "node", page: "p1", id: "a", key: "id", value: "z" },
    { t: "evil" },
    { t: "removePage", id: "p1" },
  ]);
  assert.equal(hostile.applied.length, 0);
  assert.equal({}.polluted, undefined);

  // Randomised convergence: two replicas editing concurrently converge on the server state.
  let seed = 7;
  const random = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let round = 0; round < 60; round++) {
    const start = doc(
      Array.from({ length: 6 }, (_, i) =>
        node("n" + i, { type: i % 2 ? "frame" : "text", text: "item " + i }),
      ),
    );
    const replicas = ["alice", "bob"].map((name) => {
      const local = structuredClone(start);
      const nodes = local.pages[0].nodes;
      for (let step = 0; step < 4; step++) {
        const choice = random(5),
          target = nodes[random(nodes.length)];
        if (!target) continue;
        if (choice === 0) target.x = random(500);
        else if (choice === 1 && target.type === "text") target.text = target.text + " " + name;
        else if (choice === 2) nodes.splice(nodes.indexOf(target), 1);
        else if (choice === 3)
          nodes.push(
            node(`${name}${round}-${step}`, {
              parentId: nodes.find((n) => n.type === "frame")?.id ?? null,
            }),
          );
        else {
          const frame = nodes.find((n) => n.type === "frame" && n.id !== target.id);
          if (frame) target.parentId = frame.id;
        }
      }
      const clock = Ops.createClock(name, () => 1000 + round);
      return Ops.diff(start, local, { ignore: ["activePage"] }).map((op) => ({
        ...op,
        s: clock.next(),
      }));
    });
    const serverStamps = Ops.memoryStamps();
    const first = Ops.apply(start, replicas[0], { stamps: serverStamps, normalize: true });
    const second = Ops.apply(first.doc, replicas[1], { stamps: serverStamps, normalize: true });
    // A replica that only sees the broadcast (resolved) operations reaches the same document.
    const replay = Ops.apply(Ops.apply(start, first.applied).doc, second.applied).doc;
    assert.deepEqual(replay, second.doc, `round ${round} converges`);
    const nodes = second.doc.pages[0].nodes,
      ids = new Set(nodes.map((n) => n.id));
    assert.equal(ids.size, nodes.length, "node ids stay unique");
    for (const n of nodes)
      assert.ok(n.parentId === null || ids.has(n.parentId), "no dangling parents");
  }
}

// --- room Durable Object -----------------------------------------------------------------------
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-merge-"));
const options = await cloudOptions(path.join(dir, "state"));
let mf = new Miniflare(options);
async function connect(room, client) {
  const upgrade = await mf.dispatchFetch(
    `http://local/api/rooms/${room.id}/socket?token=${room.token}&client=${client}`,
    { headers: { Upgrade: "websocket" } },
  );
  assert.equal(upgrade.status, 101);
  const socket = upgrade.webSocket,
    seen = [];
  const waiters = [];
  socket.addEventListener("message", (event) => {
    const value = JSON.parse(event.data);
    seen.push(value);
    for (const waiter of waiters.slice())
      if (waiter.predicate(value)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(value);
      }
  });
  socket.accept();
  const next = (predicate) =>
    new Promise((resolve, reject) => {
      const found = seen.find(predicate);
      if (found) {
        seen.splice(seen.indexOf(found), 1);
        return resolve(found);
      }
      const waiter = {
        predicate,
        resolve: (v) => {
          clearTimeout(timer);
          seen.splice(seen.indexOf(v), 1);
          resolve(v);
        },
      };
      const timer = setTimeout(() => reject(Error("Timed out")), 4000);
      waiters.push(waiter);
    });
  return { socket, next, send: (value) => socket.send(JSON.stringify(value)) };
}
try {
  const start = doc([node("a"), node("t", { type: "text", text: "Shared title" })]);
  const room = await (
    await mf.dispatchFetch("http://local/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: start }),
    })
  ).json();
  const alice = await connect(room, "alice"),
    bob = await connect(room, "bob");
  const welcome = await alice.next((m) => m.type === "welcome");
  assert.deepEqual([welcome.protocol, welcome.role, welcome.acked], [2, "owner", 0]);
  await alice.next((m) => m.type === "snapshot");
  await bob.next((m) => m.type === "snapshot");

  // Both clients edit from revision 0 at the same time; nothing conflicts, everything merges.
  const ca = Ops.createClock("alice"),
    cb = Ops.createClock("bob");
  alice.send({
    type: "ops",
    batch: 1,
    ops: [
      { t: "add", page: "p1", id: "from-alice", value: node("from-alice"), s: ca.next() },
      {
        t: "text",
        page: "p1",
        id: "t",
        key: "text",
        base: "Shared title",
        value: "Shared title!",
        s: ca.next(),
      },
    ],
  });
  bob.send({
    type: "ops",
    batch: 1,
    ops: [
      { t: "add", page: "p1", id: "from-bob", value: node("from-bob"), s: cb.next() },
      {
        t: "text",
        page: "p1",
        id: "t",
        key: "text",
        base: "Shared title",
        value: "Our shared title",
        s: cb.next(),
      },
      { t: "node", page: "p1", id: "a", key: "x", value: 42, s: cb.next() },
    ],
  });
  const seenByAlice = [
    await alice.next((m) => m.type === "ops"),
    await alice.next((m) => m.type === "ops"),
  ];
  assert.deepEqual(
    seenByAlice.map((m) => m.revision),
    [1, 2],
  );
  let replica = start;
  for (const message of seenByAlice) replica = Ops.apply(replica, message.ops).doc;
  const stored = await (
    await mf.dispatchFetch(`http://local/api/rooms/${room.id}`, {
      headers: { authorization: "Bearer " + room.token },
    })
  ).json();
  assert.deepEqual(replica, stored.document, "replaying broadcasts reproduces the stored document");
  assert.deepEqual(stored.document.pages[0].nodes.map((n) => n.id).sort(), [
    "a",
    "from-alice",
    "from-bob",
    "t",
  ]);
  assert.equal(stored.document.pages[0].nodes.find((n) => n.id === "t").text, "Our shared title!");
  assert.equal(stored.document.pages[0].nodes.find((n) => n.id === "a").x, 42);

  // A resent batch (lost acknowledgement) is not applied twice; the reconnect snapshot reports it.
  alice.send({
    type: "ops",
    batch: 1,
    ops: [{ t: "add", page: "p1", id: "from-alice", value: node("from-alice"), s: ca.next() }],
  });
  assert.equal((await alice.next((m) => m.type === "ops" && m.duplicate)).revision, 2);
  alice.socket.close();
  const again = await connect(room, "alice");
  assert.equal((await again.next((m) => m.type === "snapshot")).acked, 1);

  // Stale property writes lose to newer ones even across a runtime restart.
  const old = Ops.createClock("zed", () => Date.now() - 60000);
  bob.socket.close();
  again.socket.close();
  await mf.dispose();
  mf = new Miniflare(options);
  const carol = await connect(room, "carol");
  await carol.next((m) => m.type === "snapshot");
  carol.send({
    type: "ops",
    batch: 1,
    ops: [{ t: "node", page: "p1", id: "a", key: "x", value: -1, s: old.next() }],
  });
  const stale = await carol.next((m) => m.type === "ops");
  assert.deepEqual([stale.ops.length, stale.rejected, stale.revision], [0, 1, 2]);
  // Far-future stamps are restamped by the server instead of winning forever.
  const future = Ops.createClock("mallory", () => Date.now() + 365 * 86400000);
  carol.send({
    type: "ops",
    batch: 2,
    ops: [{ t: "node", page: "p1", id: "a", key: "y", value: 3, s: future.next() }],
  });
  const restamped = await carol.next((m) => m.type === "ops" && m.batch === 2);
  assert.ok(Ops.decode(restamped.ops[0].s).wall < Date.now() + 60000);
  await new Promise((resolve) => setTimeout(resolve, 20)); // a later wall-clock write
  carol.send({
    type: "ops",
    batch: 3,
    ops: [
      { t: "node", page: "p1", id: "a", key: "y", value: 4, s: Ops.createClock("carol").next() },
    ],
  });
  assert.equal((await carol.next((m) => m.type === "ops" && m.batch === 3)).ops[0].value, 4);

  // Legacy snapshot writers still work beside operation clients and keep 409 on stale revisions.
  const current = await (
    await mf.dispatchFetch(`http://local/api/rooms/${room.id}`, {
      headers: { authorization: "Bearer " + room.token },
    })
  ).json();
  const put = (document, baseRevision) =>
    mf.dispatchFetch(`http://local/api/rooms/${room.id}`, {
      method: "PUT",
      headers: { authorization: "Bearer " + room.token, "content-type": "application/json" },
      body: JSON.stringify({ document, baseRevision }),
    });
  const snapshotDoc = structuredClone(current.document);
  snapshotDoc.pages[0].nodes.find((n) => n.id === "a").w = 77;
  assert.equal((await put(snapshotDoc, current.revision - 1)).status, 409);
  assert.equal((await put(snapshotDoc, current.revision)).status, 200);
  const snap = await carol.next(
    (m) => m.type === "snapshot" && m.revision === current.revision + 1,
  );
  assert.equal(snap.document.pages[0].nodes.find((n) => n.id === "a").w, 77);
  // The snapshot stamped its changes: an older concurrent op on the same property loses.
  carol.send({
    type: "ops",
    batch: 4,
    ops: [{ t: "node", page: "p1", id: "a", key: "w", value: 1, s: old.next() }],
  });
  assert.equal((await carol.next((m) => m.type === "ops" && m.batch === 4)).rejected, 1);
  carol.socket.close();
  console.log(
    "PASS operation merging: diff/apply round trip, per-property LWW with HLC, text range merge, cycle-safe moves, orphan repair, delete/undo, hostile ops, randomized convergence, concurrent socket edits, duplicate batches, restart-persistent stamps, future-stamp clamp, legacy snapshot coexistence",
  );
} finally {
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
