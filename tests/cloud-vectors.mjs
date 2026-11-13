// Vector layers in a shared room (docs/vector-nodes.md): their fields are ordinary node properties, so two clients
// editing one vector at once (paths and viewBox from an anchor edit, the stroke from the inspector) merge per property
// on the room Durable Object (web/cloud-ops.js), a third client's new vector arrives whole, every replica that replays
// the broadcasts converges on the stored document, and that document passes the shared schema.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import "../web/cloud-ops.js";
import { validateDocument } from "../integrations/document-core.mjs";
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";

const Ops = globalThis.VerynizeOps;
const vector = (id, extra = {}) => ({
  id,
  type: "vector",
  parentId: null,
  name: id,
  x: 0,
  y: 0,
  w: 24,
  h: 24,
  text: "",
  viewBox: [0, 0, 24, 24],
  paths: [{ d: "M5 12L19 12" }, { d: "M12 5L19 12L12 19" }],
  fills: [],
  strokeWidth: 2,
  strokeColor: "#000000",
  ...extra,
});
const start = {
  version: 2,
  name: "Icons",
  tokens: {},
  activePage: "p1",
  pages: [{ id: "p1", name: "Page 1", nodes: [vector("arrow")] }],
};

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-vectors-room-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
async function connect(room, client) {
  const upgrade = await mf.dispatchFetch(
    `http://local/api/rooms/${room.id}/socket?token=${room.token}&client=${client}`,
    { headers: { Upgrade: "websocket" } },
  );
  assert.equal(upgrade.status, 101);
  const socket = upgrade.webSocket,
    seen = [],
    waiters = [];
  socket.addEventListener("message", (event) => {
    const value = JSON.parse(event.data);
    seen.push(value);
    for (const waiter of waiters.slice())
      if (waiter.predicate(value)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        seen.splice(seen.indexOf(value), 1);
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
      const timer = setTimeout(() => reject(Error("Timed out")), 5000);
      waiters.push({
        predicate,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
      });
    });
  return { socket, next, send: (value) => socket.send(JSON.stringify(value)) };
}

try {
  const room = await (
    await mf.dispatchFetch("http://local/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: start }),
    })
  ).json();
  const alice = await connect(room, "alice"),
    bob = await connect(room, "bob");
  await alice.next((m) => m.type === "snapshot");
  await bob.next((m) => m.type === "snapshot");

  // Each client diffs its own edit against the same base, as web/cloud-panel.js does.
  const aliceDoc = structuredClone(start),
    bobDoc = structuredClone(start);
  Object.assign(aliceDoc.pages[0].nodes[0], {
    paths: [{ d: "M0 12L19 12" }, { d: "M12 5L19 12L12 19" }],
    viewBox: [0, 5, 19, 14],
    x: 0,
    y: 5,
    w: 19,
    h: 14,
  });
  Object.assign(bobDoc.pages[0].nodes[0], {
    strokeWidth: 3,
    strokeCap: "round",
    strokeDash: [4, 2],
  });
  bobDoc.pages[0].nodes.push(
    vector("star", {
      x: 40,
      paths: [{ d: "M12 2L15 9L22 9L16 14L18 21L12 17L6 21L8 14L2 9L9 9Z", fillRule: "evenodd" }],
      fills: undefined,
      color: "#f59e0b",
    }),
  );
  delete bobDoc.pages[0].nodes[1].fills;
  const ca = Ops.createClock("alice"),
    cb = Ops.createClock("bob");
  const aliceOps = Ops.diff(start, aliceDoc, { ignore: ["activePage"] }).map((op) => ({
    ...op,
    s: ca.next(),
  }));
  const bobOps = Ops.diff(start, bobDoc, { ignore: ["activePage"] }).map((op) => ({
    ...op,
    s: cb.next(),
  }));
  assert.ok(
    aliceOps.every((op) => op.t === "node"),
    "an anchor edit is per-property node operations",
  );
  assert.deepEqual(aliceOps.map((op) => op.key).sort(), ["h", "paths", "viewBox", "w", "y"]);
  assert.deepEqual(bobOps.map((op) => op.t + ":" + (op.key || op.id)).sort(), [
    "add:star",
    "node:strokeCap",
    "node:strokeDash",
    "node:strokeWidth",
  ]);
  alice.send({ type: "ops", batch: 1, ops: aliceOps });
  bob.send({ type: "ops", batch: 1, ops: bobOps });

  const broadcasts = [
    await alice.next((m) => m.type === "ops"),
    await alice.next((m) => m.type === "ops"),
  ];
  const bobSaw = [await bob.next((m) => m.type === "ops"), await bob.next((m) => m.type === "ops")];
  assert.deepEqual(
    broadcasts.map((m) => m.rejected || 0),
    [0, 0],
    "nothing conflicts",
  );
  let aliceReplica = start,
    bobReplica = start;
  for (const m of broadcasts) aliceReplica = Ops.apply(aliceReplica, m.ops).doc;
  for (const m of bobSaw) bobReplica = Ops.apply(bobReplica, m.ops).doc;
  const stored = (
    await (
      await mf.dispatchFetch(`http://local/api/rooms/${room.id}`, {
        headers: { authorization: "Bearer " + room.token },
      })
    ).json()
  ).document;
  assert.deepEqual(aliceReplica, stored, "alice converges on the stored document");
  assert.deepEqual(bobReplica, stored, "bob converges on the stored document");
  validateDocument(stored);
  const [arrow, star] = stored.pages[0].nodes;
  assert.deepEqual(arrow.paths, [{ d: "M0 12L19 12" }, { d: "M12 5L19 12L12 19" }]);
  assert.deepEqual(arrow.viewBox, [0, 5, 19, 14]);
  assert.deepEqual(
    [arrow.strokeWidth, arrow.strokeCap, arrow.strokeDash],
    [3, "round", [4, 2]],
    "both edits of one vector survive",
  );
  assert.equal(star.type, "vector");
  assert.equal(star.paths[0].fillRule, "evenodd");

  // A later concurrent rewrite of the same paths: the newer stamp wins on every replica.
  const older = Ops.createClock("bob", () => Date.now() - 10000).next();
  alice.send({
    type: "ops",
    batch: 2,
    ops: [
      {
        t: "node",
        page: "p1",
        id: "star",
        key: "paths",
        value: [{ d: "M0 0L24 24" }],
        s: ca.next(),
      },
    ],
  });
  const accepted = await bob.next(
    (m) => m.type === "ops" && m.ops.some((op) => op.key === "paths"),
  );
  bob.send({
    type: "ops",
    batch: 2,
    ops: [
      { t: "node", page: "p1", id: "star", key: "paths", value: [{ d: "M24 0L0 24" }], s: older },
    ],
  });
  const lost = await bob.next((m) => m.type === "ops" && m.batch === 2);
  assert.equal(lost.rejected, 1, "the older paths write loses");
  bobReplica = Ops.apply(bobReplica, accepted.ops).doc;
  assert.deepEqual(bobReplica.pages[0].nodes[1].paths, [{ d: "M0 0L24 24" }]);
  alice.socket.close();
  bob.socket.close();
  console.log("PASS vector layers merge per property between two room clients and converge");
} finally {
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
