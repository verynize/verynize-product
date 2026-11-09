// Validation repro (server side, local workerd via tests/cloud-harness.mjs). No production, no Electron.
// Checks: duplicate receipt shape (claim 2), `same: true` decided by revision only (claim 3),
// server revision on "Missing node" (claim 4), split batches visible to peers (claim 5).
// Usage: CLOUD_WORKER_BUNDLE=$PWD/.cloudflare/output/v0/workers/default/bundle \
//          node docs/audits/2026-11-08-perf-ux/validation/repro/server-protocol.mjs
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
const root = new URL("../../../../../", import.meta.url);
const { Miniflare, cloudOptions } = await import(new URL("tests/cloud-harness.mjs", root).href);
vm.runInThisContext(await fs.readFile(new URL("web/room-limits.js", root), "utf8"));
const Limits = globalThis.VerynizeRoomLimits;

const persistence = await fs.mkdtemp(path.join(os.tmpdir(), "validate-collab-"));
const mf = new Miniflare(await cloudOptions(persistence));
const out = {};
const request = async (route, method = "GET", data, token) => {
  const res = await mf.dispatchFetch("http://local" + route, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  return { status: res.status, body: await res.json() };
};
async function connect(url, token, client) {
  const res = await mf.dispatchFetch(`http://local${url}/socket?token=${token}&client=${client}`, {
    headers: { Upgrade: "websocket" },
  });
  const ws = res.webSocket;
  const messages = [];
  const waiters = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    messages.push(m);
    for (const w of waiters.splice(0)) w();
  });
  ws.accept();
  const next = async (pred, ms = 10000) => {
    const until = Date.now() + ms;
    for (;;) {
      const i = messages.findIndex(pred);
      if (i >= 0) return messages.splice(i, 1)[0];
      if (Date.now() > until) throw Error("timeout waiting for message");
      await new Promise((r) => {
        waiters.push(r);
        setTimeout(r, 50);
      });
    }
  };
  return { ws, messages, next };
}
const nodes = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: "n" + i, type: "rectangle", x: i }));
const countNodes = (doc) => doc.pages.reduce((s, p) => s + (p.nodes?.length || 0), 0);

try {
  // ---- claim 2: duplicate receipt ------------------------------------------------------------
  {
    const room = (
      await request("/api/rooms", "POST", { document: { pages: [{ id: "p", nodes: nodes(3) }] } })
    ).body;
    const url = `/api/rooms/${room.id}`;
    const batch = {
      client: "dupclient01",
      batch: 1,
      ops: [{ t: "add", page: "p", id: "added", value: { id: "added", type: "rectangle", x: 1 } }],
    };
    const first = await request(url + "/ops", "POST", batch, room.token);
    const second = await request(url + "/ops", "POST", batch, room.token);
    const stored = (await request(url, "GET", null, room.token)).body;
    out.claim2_duplicate = {
      first: { status: first.status, revision: first.body.revision, ops: first.body.ops.length },
      second: second.body,
      serverNodes: countNodes(stored.document),
      serverRevision: stored.revision,
    };
  }

  // ---- claim 3: sync answers same:true from revision alone -------------------------------------
  {
    const room = (
      await request("/api/rooms", "POST", { document: { pages: [{ id: "p", nodes: nodes(3) }] } })
    ).body;
    const url = `/api/rooms/${room.id}`;
    await request(
      url + "/ops",
      "POST",
      {
        client: "writer0001",
        batch: 1,
        ops: Array.from({ length: 500 }, (_, i) => ({
          t: "add",
          page: "p",
          id: "m" + i,
          value: { id: "m" + i, type: "rectangle", x: i },
        })),
      },
      room.token,
    );
    // A client that (per claims 1/2) holds 3 nodes but revision 1 asks to sync.
    const c = await connect(url, room.token, "stale00001");
    await new Promise((r) => setTimeout(r, 200));
    c.messages.length = 0;
    c.ws.send(JSON.stringify({ type: "sync", revision: 1, pages: ["p"] }));
    const snap = await c.next((m) => m.type === "snapshot");
    c.ws.send(JSON.stringify({ type: "sync", revision: 0, pages: ["p"] }));
    const snap0 = await c.next((m) => m.type === "snapshot");
    out.claim3_sync = {
      sameRevision: {
        same: snap.same,
        revision: snap.revision,
        hasDocument: !!snap.document,
        keys: Object.keys(snap),
      },
      olderRevision: {
        same: !!snap0.same,
        revision: snap0.revision,
        nodes: snap0.document ? countNodes(snap0.document) : null,
      },
    };
    c.ws.close();
  }

  // ---- claim 4: server revision on Missing node --------------------------------------------------
  {
    const room = (
      await request("/api/rooms", "POST", { document: { pages: [{ id: "p", nodes: nodes(3) }] } })
    ).body;
    const url = `/api/rooms/${room.id}`;
    const onlyMissing = await request(
      url + "/ops",
      "POST",
      {
        client: "missing001",
        batch: 1,
        ops: [{ t: "node", page: "p", id: "ghost", key: "x", value: 5 }],
      },
      room.token,
    );
    const r1 = (await request(url, "GET", null, room.token)).body.revision;
    const mixed = await request(
      url + "/ops",
      "POST",
      {
        client: "missing001",
        batch: 2,
        ops: [
          { t: "node", page: "p", id: "n0", key: "x", value: 5 },
          { t: "node", page: "p", id: "ghost", key: "x", value: 5 },
        ],
      },
      room.token,
    );
    const r2 = (await request(url, "GET", null, room.token)).body.revision;
    out.claim4_server = {
      onlyMissing: {
        status: onlyMissing.status,
        revision: onlyMissing.body.revision,
        rejected: onlyMissing.body.rejected,
        reasons: onlyMissing.body.reasons,
        storedRevision: r1,
      },
      mixed: {
        revision: mixed.body.revision,
        applied: mixed.body.ops.length,
        rejected: mixed.body.rejected,
        reasons: mixed.body.reasons,
        storedRevision: r2,
      },
    };
  }

  // ---- claim 5: one logical change split per 4000 ops, peer sees half --------------------------
  {
    const N = 4903;
    const room = (
      await request("/api/rooms", "POST", { document: { pages: [{ id: "p", nodes: nodes(N) }] } })
    ).body;
    const url = `/api/rooms/${room.id}`;
    // Diff "load a 3-node copy with another name": 4900 removes + a doc:name op, like the audit.
    const ops = [{ t: "doc", key: "name", value: "copy" }].concat(
      Array.from({ length: N - 3 }, (_, i) => ({ t: "remove", page: "p", id: "n" + (i + 3) })),
    );
    const groups = Limits.batchOps(ops);
    const sender = await connect(url, room.token, "splitsend1");
    const peer = await connect(url, room.token, "splitpeer1");
    await new Promise((r) => setTimeout(r, 300));
    peer.messages.length = 0;
    sender.ws.send(JSON.stringify({ type: "ops", batch: 1, ops: groups[0] }));
    const b1 = await peer.next((m) => m.type === "ops");
    const mid = (await request(url, "GET", null, room.token)).body;
    sender.ws.send(JSON.stringify({ type: "ops", batch: 2, ops: groups[1] }));
    const b2 = await peer.next((m) => m.type === "ops");
    const end = (await request(url, "GET", null, room.token)).body;
    out.claim5_split = {
      groupSizes: groups.map((g) => g.length),
      peerSaw: [
        { revision: b1.revision, ops: b1.ops.length },
        { revision: b2.revision, ops: b2.ops.length },
      ],
      serverAfterFirst: {
        revision: mid.revision,
        nodes: countNodes(mid.document),
        name: mid.document.name ?? null,
      },
      serverAfterSecond: {
        revision: end.revision,
        nodes: countNodes(end.document),
        name: end.document.name ?? null,
      },
    };
    sender.ws.close();
    peer.ws.close();
  }
  console.log(JSON.stringify(out, null, 2));
} finally {
  await mf.dispose();
  await fs.rm(persistence, { recursive: true, force: true });
}
