// Room version history (cloud/room-history.js, docs/version-history.md) on the real room actor:
// captures on editor switches (person ↔ agent ↔ another collaborator), the API with role checks
// (viewers list and preview, editors capture), restore as ordinary operations that two clients
// converge on (restore stores the replaced state first), restoring a deleted artboard, the idle
// alarm, snapshots split across SQLite rows, and the hosted MCP list_versions / restore_version.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import "../web/cloud-ops.js";
import "../web/version-history-core.js";

process.env.VERSION_IDLE_MS ||= "1500";
const { Miniflare, cloudOptions, passwordUser } = await import("./cloud-harness.mjs");

const Ops = globalThis.VerynizeOps;
const Versions = globalThis.VerynizeVersions;
const ORIGIN = "http://localhost";
const node = (id, extra = {}) => ({
  id,
  type: "rectangle",
  name: id,
  parentId: null,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  ...extra,
});
const designDocument = () => ({
  version: 2,
  name: "History",
  activePage: "p1",
  tokens: {},
  pages: [
    {
      id: "p1",
      name: "Page 1",
      nodes: [
        node("A", { type: "frame", name: "Hero", w: 400, h: 300 }),
        node("a1", { type: "text", parentId: "A", text: "Start" }),
        node("a2", { parentId: "A" }),
        node("B", { type: "frame", name: "Pricing", x: 600, w: 400, h: 300 }),
        node("b1", { type: "text", parentId: "B", text: "Plans" }),
      ],
    },
  ],
});

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-room-history-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
const send = (route, { method = "GET", body, session, token } = {}) =>
  mf.dispatchFetch(ORIGIN + route, {
    method,
    headers: {
      "content-type": "application/json",
      ...(session ? { "x-verynize-session": session } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const data = async (response, status = 200) => {
  const text = await response.text();
  assert.equal(response.status, status, text.slice(0, 400));
  return text ? JSON.parse(text) : null;
};
async function socket(roomId, query) {
  const upgrade = await mf.dispatchFetch(`${ORIGIN}/api/rooms/${roomId}/socket?${query}`, {
    headers: { Upgrade: "websocket" },
  });
  assert.equal(upgrade.status, 101);
  const ws = upgrade.webSocket;
  const seen = [];
  const waiters = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    seen.push(message);
    for (const waiter of waiters.slice())
      if (waiter.predicate(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        seen.splice(seen.indexOf(message), 1);
        waiter.resolve(message);
      }
  });
  ws.accept();
  const next = (predicate, label = "message") =>
    new Promise((resolve, reject) => {
      const found = seen.find(predicate);
      if (found) {
        seen.splice(seen.indexOf(found), 1);
        return resolve(found);
      }
      const timer = setTimeout(() => reject(Error("Missing " + label)), 8000);
      waiters.push({
        predicate,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      });
    });
  return { ws, seen, next, send: (value) => ws.send(JSON.stringify(value)) };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const textOf = (doc, id) => doc.pages[0].nodes.find((n) => n.id === id)?.text;

try {
  const ana = await passwordUser(ORIGIN, "ana@example.test", "Ana", (u, i) =>
    mf.dispatchFetch(u, i),
  );
  const room = await data(
    await send("/api/rooms", {
      method: "POST",
      session: ana,
      body: { document: designDocument() },
    }),
    201,
  );
  const viewer = await data(
    await send(`/api/rooms/${room.id}/tokens`, {
      method: "POST",
      token: room.token,
      body: { role: "viewer", label: "Viewer" },
    }),
    201,
  );
  const read = async () =>
    (await data(await send(`/api/rooms/${room.id}`, { token: room.token }))).document;

  // Two clients: Ana (account session) and Bob (owner link, presence name).
  const c1 = await socket(room.id, `session=${encodeURIComponent(ana)}&client=history-c1`);
  const c2 = await socket(room.id, `token=${room.token}&client=history-c2`);
  await c1.next((m) => m.type === "snapshot", "c1 snapshot");
  const start = (await c2.next((m) => m.type === "snapshot", "c2 snapshot")).document;
  c2.send({ type: "presence", name: "Bob" });
  await c2.next((m) => m.type === "presence" && m.peers.some((p) => p.name === "Bob"), "presence");
  const clocks = { c1: Ops.createClock("history-c1"), c2: Ops.createClock("history-c2") };
  const batches = { c1: 0, c2: 0 };
  let c2doc = start;
  // c2 replays every accepted batch, like the desktop panel does.
  const replay = async (batch) => {
    const message = await c2.next(
      (m) => m.type === "ops" && m.batch === batch.n && m.client === batch.client,
      "ops",
    );
    c2doc = Ops.apply(c2doc, message.ops).doc;
    return message;
  };
  async function edit(who, ops, actor) {
    const n = ++batches[who];
    const sock = who === "c1" ? c1 : c2;
    sock.send({
      type: "ops",
      batch: n,
      ops: ops.map((op) => ({ ...op, s: clocks[who].next() })),
      ...(actor ? { actor } : {}),
    });
    return replay({ n, client: `history-${who}` });
  }
  const setText = (id, text) => [{ t: "node", page: "p1", id, key: "text", value: text }];

  // Editor switches capture the previous editor's work in their name.
  await edit("c1", setText("a1", "Ana one"));
  await edit("c1", setText("a1", "Ana two"));
  assert.deepEqual(
    (await data(await send(`/api/rooms/${room.id}/versions?artboard=A`, { token: room.token })))
      .versions,
    [],
  );
  await edit("c1", setText("a1", "Agent"), { kind: "agent", name: "Claude" });
  await edit("c2", setText("a1", "Bob"));
  const listed = await data(
    await send(`/api/rooms/${room.id}/versions?artboard=A`, { token: viewer.token }),
  );
  assert.equal(listed.versions.length, 2, JSON.stringify(listed));
  const [agentVersion, anaVersion] = listed.versions;
  assert.equal(agentVersion.author.kind, "agent");
  assert.equal(agentVersion.author.name, "Claude");
  assert.equal(anaVersion.author.kind, "user");
  assert.equal(anaVersion.author.name, "Ana");
  assert.equal(anaVersion.reason, "switch");
  assert.match(anaVersion.summary, /3 layers/);
  // B was never edited: no versions. The summary lists only A.
  const boards = await data(await send(`/api/rooms/${room.id}/versions`, { token: viewer.token }));
  assert.deepEqual(
    boards.artboards.map((b) => b.artboardId),
    ["A"],
  );

  // Viewers preview but cannot capture; editors can.
  const preview = await data(
    await send(`/api/rooms/${room.id}/versions/${anaVersion.id}`, { token: viewer.token }),
  );
  assert.equal(preview.snapshot.nodes.find((n) => n.id === "a1").text, "Ana two");
  await data(await send(`/api/rooms/${room.id}/versions/vmissing`, { token: viewer.token }), 404);
  await data(
    await send(`/api/rooms/${room.id}/versions`, {
      method: "POST",
      token: viewer.token,
      body: { artboard: "A" },
    }),
    403,
  );
  await data(await send(`/api/rooms/${room.id}/versions?artboard=A`), 401);

  // Restore as ordinary operations from c1: c2 converges on the server's document, and the
  // replaced state ("Bob") is stored first, so the restore can be undone from the history.
  const current = await read();
  const restored = Versions.restore(current, preview.snapshot).document;
  const ops = Ops.diff(current, restored);
  assert.ok(ops.length > 0 && ops.every((op) => op.t !== "root"));
  await edit("c1", ops, { kind: "user", restore: anaVersion.id });
  const after = await read();
  assert.equal(textOf(after, "a1"), "Ana two");
  assert.equal(JSON.stringify(c2doc.pages), JSON.stringify(after.pages));
  const afterList = await data(
    await send(`/api/rooms/${room.id}/versions?artboard=A`, { token: room.token }),
  );
  assert.equal(afterList.versions[0].reason, "restore");
  const bobVersion = await data(
    await send(`/api/rooms/${room.id}/versions/${afterList.versions[0].id}`, { token: room.token }),
  );
  assert.equal(bobVersion.snapshot.nodes.find((n) => n.id === "a1").text, "Bob");

  // A deleted artboard is re-created by restoring one of its versions.
  await edit(
    "c2",
    ["a1", "a2", "A"].map((id) => ({ t: "remove", page: "p1", id })),
  );
  assert.ok(!(await read()).pages[0].nodes.some((n) => n.id === "A"));
  const gone = await read();
  const back = Versions.restore(gone, bobVersion.snapshot).document;
  await edit("c1", Ops.diff(gone, back), { kind: "user", restore: bobVersion.version.id });
  const recreated = await read();
  assert.equal(textOf(recreated, "a1"), "Bob");
  assert.equal(recreated.pages[0].nodes.filter((n) => n.parentId === "A").length, 2);
  assert.equal(JSON.stringify(c2doc.pages), JSON.stringify(recreated.pages));

  // Idle: after VERSION_IDLE_MS without edits the room's alarm stores B's last state. B holds a
  // text larger than one SQLite row part (256 Ki UTF-16 units), so the snapshot is split.
  const big = "x".repeat(600 * 1024);
  await edit("c2", setText("b1", big));
  let idle = null;
  for (let i = 0; i < 40 && !idle; i++) {
    await sleep(250);
    const list = await data(
      await send(`/api/rooms/${room.id}/versions?artboard=B`, { token: room.token }),
    );
    idle = list.versions.find((v) => v.reason === "idle");
  }
  assert.ok(idle, "idle version stored by the alarm");
  assert.equal(idle.author.name, "Bob");
  const idleSnapshot = await data(
    await send(`/api/rooms/${room.id}/versions/${idle.id}`, { token: room.token }),
  );
  assert.equal(idleSnapshot.snapshot.nodes.find((n) => n.id === "b1").text.length, big.length);

  // Hosted MCP: list_versions and restore_version through the room (agent author, restore marker).
  let rpc = 1;
  const mcp = async (name, args) => {
    const response = await mf.dispatchFetch(ORIGIN + "/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${ana}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpc++,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const { result } = await data(response);
    assert.ok(!result.isError, result.content?.[0]?.text);
    return JSON.parse(result.content[0].text);
  };
  const artboards = await mcp("get_artboards", { document: room.id });
  const hero = artboards.artboards.find((a) => a.label === "Hero").id;
  const versions = await mcp("list_versions", { document: room.id, artboard: hero });
  // The re-created state was also stored by the idle alarm (it differed from the newest version).
  assert.ok(versions.versions.some((v) => v.reason === "restore"));
  const target = versions.versions.find((v) => v.author.startsWith("Claude"));
  assert.ok(target, JSON.stringify(versions));
  const result = await mcp("restore_version", {
    document: room.id,
    artboard: hero,
    version: target.version,
  });
  assert.equal(result.restored, target.version);
  const mcpDoc = await read();
  assert.equal(textOf(mcpDoc, "a1"), "Agent");
  // The hosted edit reached c2 as operations too.
  await c2
    .next((m) => m.type === "ops" && m.client?.startsWith("mcp-"), "hosted ops")
    .then((m) => {
      c2doc = Ops.apply(c2doc, m.ops).doc;
    });
  assert.equal(JSON.stringify(c2doc.pages), JSON.stringify(mcpDoc.pages));
  // The replaced state ("Bob") is in the history, so the restore can be undone the same way.
  const final = await mcp("list_versions", { document: room.id, artboard: hero });
  const texts = [];
  for (const row of final.versions.slice(0, 3)) {
    const found = await data(
      await send(`/api/rooms/${room.id}/versions/${row.version}`, { token: room.token }),
    );
    texts.push(found.snapshot.nodes.find((n) => n.id === "a1").text);
  }
  assert.ok(texts.includes("Bob"), JSON.stringify(texts));

  // Visitors of a public room read the current document, never its history.
  await data(
    await send(`/api/rooms/${room.id}/visibility`, {
      method: "PUT",
      token: room.token,
      body: { visibility: "public" },
    }),
  );
  await data(await send(`/api/rooms/${room.id}`));
  await data(await send(`/api/rooms/${room.id}/versions?artboard=A`), 403);
  await data(await send(`/api/rooms/${room.id}/versions/${anaVersion.id}`), 403);
  await data(await send(`/api/rooms/${room.id}/versions?artboard=A`, { token: viewer.token }));

  console.log(
    "PASS room version history: editor-switch captures with authors, viewer list/preview, editor-only capture, restore as ops with two-client convergence, deleted artboard re-created, idle alarm, chunked snapshots, hosted MCP list/restore, no history for public visitors",
  );
} finally {
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
