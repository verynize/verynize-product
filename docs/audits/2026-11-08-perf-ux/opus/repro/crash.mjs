// Fault-injection repro for "DO reset during a large batch": what does storage hold afterwards,
// what revision does the room report, and what does each client get on reconnect?
// Usage: FAULT=none|broadcast|midcommit|history|afterack node crash.mjs
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const H = new URL("../../../../../tests/cloud-harness.mjs", import.meta.url).href;
const { Miniflare, cloudOptions } = await import(H);
const FAULT = process.env.FAULT || "none";
const N = Number(process.env.N || 4900);
const persistence = await fs.mkdtemp(path.join(os.tmpdir(), "audit-crash-"));
const options = await cloudOptions(persistence);
const config = options.workers[0].config;
config.manifest.modules["fault.js"] = {
  type: "esm",
  contents: `
  import worker, { DesignRoom as Base } from "./index.js";
  export * from "./index.js";
  export default worker;
  const FAULT = ${JSON.stringify(FAULT)};
  export class DesignRoom extends Base {
    constructor(ctx, env) {
      super(ctx, env);
      const store = this.store, write = store.writeText.bind(store);
      let writes = 0;
      store.writeText = (key, text) => {
        write(key, text);
        if (FAULT === "midcommit" && text.length > 100000 && ++writes === 1) this.ctx.abort("fault midcommit");
      };
    }
    broadcast(value, except) {
      if (FAULT === "broadcast" && value.type === "ops" && value.ops.length > 1000) this.ctx.abort("fault broadcast");
      return super.broadcast(value, except);
    }
    recordHistory(...args) {
      if (FAULT === "history" && args[1].applied.length > 1000) this.ctx.abort("fault history");
      return super.recordHistory(...args);
    }
  }`,
};
config.manifest.mainModule = "fault.js";
let mf = new Miniflare(options);
const request = (route, method = "GET", data, token) =>
  mf.dispatchFetch("http://local" + route, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
async function open(room, client) {
  const up = await mf.dispatchFetch(
    `http://local/api/rooms/${room.id}/socket?token=${room.token}&client=${client}&lazy=1`,
    { headers: { Upgrade: "websocket" } },
  );
  const ws = up.webSocket;
  const inbox = [];
  const waiters = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    inbox.push(m);
    for (const w of waiters.splice(0)) w();
  });
  ws.addEventListener("close", () => (ws.closed = true));
  ws.accept();
  const next = async (type, ms = 8000) => {
    const until = Date.now() + ms;
    for (;;) {
      const i = inbox.findIndex((m) => m.type === type);
      if (i >= 0) return inbox.splice(i, 1)[0];
      if (Date.now() > until || ws.closed) return null;
      await new Promise((r) => {
        waiters.push(r);
        setTimeout(r, 100);
      });
    }
  };
  return { ws, inbox, next };
}
const summary = (s) =>
  s && {
    same: !!s.same,
    revision: s.revision,
    acked: s.acked,
    rejected: s.rejectedBatches,
    nodes: s.document?.pages?.[0]?.nodes?.length,
  };
try {
  const document = {
    pages: [
      {
        id: "p",
        nodes: [1, 2, 3].map((i) => ({
          id: "n" + i,
          type: "rectangle",
          x: i * 10,
          y: 0,
          width: 10,
          height: 10,
        })),
      },
    ],
    activePage: "p",
  };
  const room = await (await request("/api/rooms", "POST", { document })).json();
  // A small edit first, so the room is at revision 1.
  await request(
    `/api/rooms/${room.id}/ops`,
    "POST",
    { client: "warm", batch: 1, ops: [{ t: "node", page: "p", id: "n1", key: "x", value: 11 }] },
    room.token,
  );
  const A = await open(room, "sender"),
    B = await open(room, "receiver");
  for (const c of [A, B]) {
    await c.next("welcome");
    c.ws.send(JSON.stringify({ type: "sync", pages: ["p"] }));
  }
  const a0 = await A.next("snapshot"),
    b0 = await B.next("snapshot");
  console.log("before", summary(a0), summary(b0));
  const big = Array.from({ length: N }, (_, i) => ({
    t: "add",
    page: "p",
    id: "big" + i,
    s: undefined,
    value: {
      id: "big" + i,
      type: "rectangle",
      name: "Rectangle " + i,
      x: (i % 70) * 20,
      y: Math.floor(i / 70) * 20,
      width: 16,
      height: 16,
      fill: "#336699",
      opacity: 1,
      rotation: 0,
      cornerRadius: 2,
      stroke: "#000000",
      strokeWidth: 0,
      visible: true,
      locked: false,
      description: "x".repeat(600),
    },
  }));
  const bytes = JSON.stringify(big).length;
  A.ws.send(JSON.stringify({ type: "ops", batch: 1, ops: big }));
  const ackA = await A.next("ops", 30000),
    gotB = await B.next("ops", 3000);
  console.log(`FAULT=${FAULT} batch ${N} ops ${(bytes / 1e6).toFixed(2)} MB`);
  console.log(
    "sender ack",
    ackA && { rev: ackA.revision, ops: ackA.ops.length, err: ackA.error },
    "closed",
    !!A.ws.closed,
  );
  console.log(
    "receiver broadcast",
    gotB && { rev: gotB.revision, ops: gotB.ops.length },
    "closed",
    !!B.ws.closed,
  );
  // Restart the runtime from disk (a reset loses memory; storage is what counts).
  await mf.dispose();
  mf = new Miniflare(options);
  const stored = await (await request(`/api/rooms/${room.id}`, "GET", null, room.token)).json();
  console.log("stored after reset", {
    revision: stored.revision,
    nodes: stored.document?.pages?.[0]?.nodes?.length,
  });
  // Receiver reconnects, telling the room the revision it holds (rev of b0).
  const B2 = await open(room, "receiver");
  await B2.next("welcome");
  B2.ws.send(JSON.stringify({ type: "sync", pages: ["p"], revision: b0.revision }));
  console.log(
    "receiver resync (holds rev " + b0.revision + ")",
    summary(await B2.next("snapshot")),
  );
  // Sender reconnects with its own revision and resends batch 1 (cloud-panel does this).
  const A2 = await open(room, "sender");
  await A2.next("welcome");
  A2.ws.send(JSON.stringify({ type: "sync", pages: ["p"], revision: a0.revision }));
  console.log("sender resync", summary(await A2.next("snapshot")));
  A2.ws.send(JSON.stringify({ type: "ops", batch: 1, ops: big }));
  const re = await A2.next("ops", 30000);
  console.log(
    "sender resend",
    re && {
      rev: re.revision,
      ops: re.ops.length,
      dup: re.duplicate,
      tooLarge: re.tooLarge,
      err: re.error,
    },
  );
  const after = await (await request(`/api/rooms/${room.id}`, "GET", null, room.token)).json();
  console.log("final stored", {
    revision: after.revision,
    nodes: after.document?.pages?.[0]?.nodes?.length,
  });
} finally {
  await mf.dispose().catch(() => {});
  await fs.rm(persistence, { recursive: true, force: true });
}
