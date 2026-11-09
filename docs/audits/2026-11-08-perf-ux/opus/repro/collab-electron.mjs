// One Electron client (B, temporary profile) + raw WebSocket peer (S) against local workerd with
// fault injection. Scenarios: SCEN=diverge,poison,gestures,timing,access,perf (comma list).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const require = createRequire(ROOT + "/package.json");
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require(ROOT + "/tests/helpers/ui-ready.cjs");
const { moveOffCursor } = require(ROOT + "/tests/helpers/off-cursor.cjs");
const { openSharedDesign } = require(ROOT + "/tests/helpers/shared-design.cjs");
const { synthetic } = require(ROOT + "/eval/canvas-perf/bench-verynize.cjs");
const { Miniflare, cloudOptions } = await import(ROOT + "/tests/cloud-harness.mjs");
const SCEN = new Set((process.env.SCEN || "diverge,poison,gestures,timing,access,perf").split(","));
const OUT = process.env.OUT || path.join(path.dirname(new URL(import.meta.url).pathname), "out");
await fs.mkdir(OUT, { recursive: true });
const results = {};
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-collab-"));
const options = await cloudOptions(path.join(dir, "state"));
const config = options.workers[0].config;
config.manifest.modules["fault.js"] = {
  type: "esm",
  contents: `
  import worker, { DesignRoom as Base } from "./index.js";
  export * from "./index.js";
  export default worker;
  const named = (ops, tag) => Array.isArray(ops) && ops.some((o) => typeof o?.value?.name === "string" && o.value.name.includes(tag));
  export class DesignRoom extends Base {
    applyBatchNow(data, role, who) {
      // Reset inside the batch: storage rolls back, the durable marker poisons the retry.
      if (named(data.ops, "CRASHROLL")) this.ctx.abort("audit: reset during batch");
      return super.applyBatchNow(data, role, who);
    }
    broadcast(value, except) {
      // Reset after the batch committed: every socket drops before the broadcast is sent.
      if (value?.type === "ops" && named(value.ops, "CRASHPOST")) {
        for (const ws of this.ctx.getWebSockets()) try { ws.close(1011, "audit reset"); } catch {}
        return;
      }
      // The broadcast is lost but every socket stays open (swallowed send / reset with kept sockets).
      if (value?.type === "ops" && named(value.ops, "DROPACK")) return;
      return super.broadcast(value, except);
    }
  }`,
};
config.manifest.mainModule = "fault.js";
const mf = new Miniflare(options);
const server = (await mf.ready).origin;
const api = async (route, method = "GET", data, token) => {
  const r = await fetch(server + route, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  return r.json();
};
const serverState = async (room) => {
  const s = await api(`/api/rooms/${room.id}`, "GET", null, room.token);
  return {
    revision: s.revision,
    nodes: s.document?.pages?.reduce((n, p) => n + p.nodes.length, 0),
  };
};
// Raw peer S: speaks the room protocol directly, records every message with its arrival time.
function peer(room, client) {
  const url = new URL(`/api/rooms/${room.id}/socket`, server);
  url.protocol = "ws:";
  url.searchParams.set("token", room.token);
  url.searchParams.set("client", client);
  url.searchParams.set("lazy", "1");
  const ws = new WebSocket(url);
  const inbox = [];
  let batch = 0;
  const p = {
    ws,
    inbox,
    opened: new Promise((resolve) => ws.addEventListener("open", resolve)),
    ready: null,
    send: (ops) => ws.send(JSON.stringify({ type: "ops", batch: ++batch, ops })),
    async next(pred, ms = 10000) {
      const until = Date.now() + ms;
      for (;;) {
        const i = inbox.findIndex(pred);
        if (i >= 0) return inbox.splice(i, 1)[0];
        if (Date.now() > until || ws.readyState > 1) return null;
        await sleep(20);
      }
    },
  };
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    m.at = performance.now();
    m.bytes = e.data.length;
    if (m.type === "welcome") ws.send(JSON.stringify({ type: "sync", pages: [] }));
    inbox.push(m);
  });
  p.ready = p.opened.then(() => p.next((m) => m.type === "snapshot"));
  return p;
}
const rect = (id, extra = {}) => ({
  id,
  name: id,
  type: "rectangle",
  parentId: null,
  x: 0,
  y: 0,
  w: 100,
  h: 80,
  color: "#97c3b1",
  ...extra,
});
const smallDoc = (name) => ({
  version: 2,
  name,
  activePage: "p",
  tokens: {},
  pages: [
    {
      id: "p",
      name: "Page 1",
      nodes: [
        rect("a", { x: 100, y: 100 }),
        rect("b", { x: 400, y: 100 }),
        {
          ...rect("t", { x: 100, y: 300, w: 300, h: 60 }),
          type: "text",
          text: "Hello",
          color: "#25252e",
          fontSize: 24,
          lineHeight: "auto",
        },
      ],
    },
  ],
});
const many = (n, prefix, tag = "") =>
  Array.from({ length: n }, (_, i) =>
    rect(`${prefix}${i}`, {
      name: `${tag}${prefix}${i}`,
      x: (i % 70) * 120,
      y: 600 + Math.floor(i / 70) * 100,
      w: 100,
      h: 80,
    }),
  );

const env = {
  ...process.env,
  VERYNIZE_SKIP_ONBOARDING: "1",
  VERYNIZE_LAUNCH_EDITOR: "1",
  VERYNIZE_CLOUD_SERVER: server,
};
delete env.ELECTRON_RUN_AS_NODE;
const profile = path.join(dir, "profile");
let app, page;
const requests = [];
async function launch() {
  app = await electron.launch({ cwd: ROOT, env, args: [ROOT, `--user-data-dir=${profile}`] });
  page = await app.firstWindow();
  await moveOffCursor(app);
  await waitForUiReady(page, { timeout: 60000 });
  page.on("request", (r) => requests.push({ at: Date.now(), method: r.method(), url: r.url() }));
  await inst();
}
async function inst() {
  await page.evaluate(() => {
    if (window.__statuses) return;
    const s = document.getElementById("cloud-status");
    window.__statuses = [];
    new MutationObserver(() =>
      window.__statuses.push([Math.round(performance.now()), s.textContent]),
    ).observe(s, { childList: true, characterData: true, subtree: true });
    window.__sends = [];
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      try {
        const m = JSON.parse(data);
        window.__sends.push({
          at: performance.now(),
          type: m.type,
          n: m.ops?.length || 0,
          bytes: data.length,
        });
      } catch {}
      return send.call(this, data);
    };
  });
}
const B = {
  nodes: () =>
    page.evaluate(() => window.design.getDocument().pages.reduce((n, p) => n + p.nodes.length, 0)),
  node: (id) =>
    page.evaluate(
      (id) =>
        window.design
          .getDocument()
          .pages.flatMap((p) => p.nodes)
          .find((n) => n.id === id) || null,
      id,
    ),
  status: () => page.evaluate(() => document.getElementById("cloud-status").textContent),
  statuses: () => page.evaluate(() => window.__statuses.map((s) => s[1])),
  async createRoom(doc) {
    await page.evaluate(
      () => window.cloudWorkspace.isConnected() && window.cloudWorkspace.disconnect(),
    );
    await page.evaluate((doc) => (window.fileLibrary.createFromDocument ? null : null), doc);
    await page.evaluate((doc) => window.design.loadDocument(doc), doc);
    await openSharedDesign(page);
    const prev = await page.evaluate(() => window.__lastRoom || null);
    await page.locator("#cloud-create").click();
    await page.waitForFunction(
      (prev) =>
        window.cloudWorkspace.isConnected() &&
        window.cloudWorkspace.room()?.id !== prev &&
        document.getElementById("cloud-invite").value.includes(window.cloudWorkspace.room().id),
      prev,
      { timeout: 60000 },
    );
    await page.evaluate(() => {
      window.__lastRoom = window.cloudWorkspace.room().id;
      document.getElementById("cloud-dialog").close();
    });
    const cloud = await page.evaluate(() =>
      window.fileLibrary.cloudOf(window.fileLibrary.currentId),
    );
    return { id: cloud.roomId, token: cloud.token };
  },
};
async function settle(ms = 1500) {
  await sleep(ms);
}

try {
  await launch();
  await page.evaluate(() => window.fileLibrary.showEditor?.());

  // ---------------- (a) divergence after a reset ----------------
  if (SCEN.has("diverge")) {
    const room = await B.createRoom(smallDoc("Diverge"));
    const S = peer(room, "sender1");
    await S.ready;
    await settle(800);
    const before = { b: await B.nodes(), server: await serverState(room) };
    // 1. S's large batch commits, then the room resets before broadcasting.
    S.send(
      many(4900, "post", "CRASHPOST ").map((value) => ({
        t: "add",
        page: "p",
        id: value.id,
        value,
      })),
    );
    await page
      .waitForFunction(
        () => /interrupted|Reconnecting/.test(window.__statuses.map((s) => s[1]).join("|")),
        null,
        { timeout: 30000 },
      )
      .catch(() => {});
    await page
      .waitForFunction(
        () => /Connected|Synced|Saved/.test(document.getElementById("cloud-status").textContent),
        null,
        { timeout: 30000 },
      )
      .catch(() => {});
    await settle(3000);
    const afterPost = {
      b: await B.nodes(),
      server: await serverState(room),
      status: await B.status(),
    };
    await page.reload();
    await waitForUiReady(page, { timeout: 60000 });
    await inst();
    await settle(5000);
    const afterReload = {
      b: await B.nodes(),
      server: await serverState(room),
      status: await B.status(),
    };
    results.divergePost = { before, afterPost, afterReload };
    log("divergePost", JSON.stringify(results.divergePost));
    S.ws.close();
  }

  // ---------------- (a2) a missed broadcast, then a later op: no gap detection ----------------
  if (SCEN.has("gap")) {
    const room = await B.createRoom(smallDoc("Gap"));
    const S = peer(room, "sender3");
    await S.ready;
    await settle(800);
    S.send(
      many(500, "gap", "DROPACK ").map((value) => ({ t: "add", page: "p", id: value.id, value })),
    );
    await settle(1500);
    const missed = {
      b: await B.nodes(),
      server: await serverState(room),
      status: await B.status(),
    };
    S.send([{ t: "node", page: "p", id: "b", key: "x", value: 444 }]);
    await settle(1500);
    const later = { b: await B.nodes(), server: await serverState(room), status: await B.status() };
    await page.reload();
    await waitForUiReady(page, { timeout: 60000 });
    await inst();
    await settle(5000);
    const reload = {
      b: await B.nodes(),
      server: await serverState(room),
      status: await B.status(),
    };
    await page.screenshot({ path: path.join(OUT, "gap-after-reload.png") });
    results.gap = { missed, later, reload };
    log("gap", JSON.stringify(results.gap));
    S.ws.close();
  }

  // ---------------- (a3) own ack lost, then flush over HTTP: duplicate receipt without ops ----------------
  if (SCEN.has("dupack")) {
    const room = await B.createRoom(smallDoc("Dupack"));
    await settle(800);
    await page.evaluate(
      (nodes) => {
        const d = window.design.getDocument();
        d.pages[0].nodes.push(...nodes);
        window.design.loadDocument(d);
      },
      many(500, "dup", "DROPACK "),
    );
    await settle(1500);
    const sent = { b: await B.nodes(), server: await serverState(room), status: await B.status() };
    // What Home / switching files / publishing do first (flushBeforeSwitch -> flushOps: 5 s wait, then POST /ops).
    const flushed = await page.evaluate(() =>
      window.cloudWorkspace.flush().then(
        () => "ok",
        (e) => e.message,
      ),
    );
    await settle(1000);
    const after = {
      flushed,
      b: await B.nodes(),
      server: await serverState(room),
      status: await B.status(),
    };
    await page.reload();
    await waitForUiReady(page, { timeout: 60000 });
    await inst();
    await settle(5000);
    const reload = {
      b: await B.nodes(),
      server: await serverState(room),
      status: await B.status(),
    };
    await page.screenshot({ path: path.join(OUT, "dupack-after-reload.png") });
    results.dupack = { sent, after, reload };
    log("dupack", JSON.stringify(results.dupack));
  }

  // ---------------- (b) one logical change split into non-atomic batches ----------------
  if (SCEN.has("split")) {
    const big = smallDoc("Split");
    big.pages[0].nodes.push(...many(4900, "s"));
    const room = await B.createRoom(big);
    await settle(3000);
    const S = peer(room, "observer");
    await S.ready;
    const start = { b: await B.nodes(), server: await serverState(room) };
    await page.evaluate(() => (window.__sends.length = 0));
    // Restore a 3-node document with another name (a restore, an undo of a big paste, a reload of an old copy).
    const small = smallDoc("Split restored");
    await page.evaluate((d) => window.design.loadDocument(d), small);
    const seen = [];
    const until = Date.now() + 20000;
    while (Date.now() < until && seen.reduce((n, m) => n + m.removes, 0) < 4900) {
      const m = await S.next((m) => m.type === "ops", 2000);
      if (m) {
        seen.push({
          rev: m.revision,
          ops: m.ops.length,
          removes: m.ops.filter((o) => o.t === "remove").length,
          other: m.ops.filter((o) => o.t !== "remove").map((o) => o.t + ":" + (o.key || "")),
        });
        seen[seen.length - 1].serverNodesNow = (await serverState(room)).nodes;
      }
    }
    const sends = await page.evaluate(() =>
      window.__sends.filter((s) => s.type === "ops").map((s) => ({ n: s.n, bytes: s.bytes })),
    );
    results.split = { start, sends, broadcasts: seen, end: await serverState(room) };
    log("split", JSON.stringify(results.split));
    S.ws.close();
  }

  // ---------------- (e) a rejected (poisoned) batch holds every later edit ----------------
  if (SCEN.has("poison")) {
    const room = await B.createRoom(smallDoc("Poison"));
    await settle(800);
    await page.evaluate(() => (window.__statuses.length = 0));
    // B's own edit crashes the room inside the batch (rollback); the retry is answered "interrupted".
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.pages[0].nodes.push({
        id: "boom",
        name: "CRASHROLL boom",
        type: "rectangle",
        parentId: null,
        x: 700,
        y: 100,
        w: 50,
        h: 50,
        color: "#ff0000",
      });
      window.design.loadDocument(d);
    });
    await page
      .waitForFunction(
        () => /interrupted/.test(window.__statuses.map((s) => s[1]).join("|")),
        null,
        { timeout: 30000 },
      )
      .catch(() => {});
    await settle(1500);
    const held = { server: await serverState(room), status: await B.status() };
    // A small, unrelated edit afterwards.
    await page.evaluate(() => window.design.updateNodes(["a"], { x: 555 }));
    await settle(4000);
    const serverA = (
      await api(`/api/rooms/${room.id}`, "GET", null, room.token)
    ).document.pages[0].nodes.find((n) => n.id === "a");
    const dialog = await page.evaluate(
      () => document.getElementById("storage-limit-dialog")?.textContent || null,
    );
    await openSharedDesign(page);
    await page.screenshot({ path: path.join(OUT, "poison-held.png") });
    await page.evaluate(() => document.getElementById("cloud-dialog").close());
    results.poison = {
      held,
      smallEditReachedServer: serverA.x === 555,
      serverA_x: serverA.x,
      status: await B.status(),
      statuses: await B.statuses(),
      limitDialog: dialog,
    };
    log("poison", JSON.stringify(results.poison));
    await page.keyboard.press("Escape");
  }

  // ---------------- (c) gestures while a remote edit arrives ----------------
  if (SCEN.has("gestures")) {
    const room = await B.createRoom(smallDoc("Gestures"));
    const S = peer(room, "sender2");
    await S.ready;
    await settle(800);
    await page.evaluate(() => window.design.setCamera(0, 0, 1));
    await settle(300);
    const center = (id) =>
      page.evaluate((id) => {
        const r = document.querySelector(`#canvas [data-id="${id}"].layer`).getBoundingClientRect();
        return {
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          r: { x: r.x, y: r.y, w: r.width, h: r.height },
        };
      }, id);
    let color = 0;
    const remote = () =>
      S.send([
        {
          t: "node",
          page: "p",
          id: "b",
          key: "color",
          value: ["#111111", "#222222", "#333333", "#444444"][color++ % 4],
        },
      ]);
    const drag = async (withRemote) => {
      const a0 = await B.node("a");
      const c = await center("a");
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      for (let i = 1; i <= 20; i++) {
        await page.mouse.move(c.x + i * 10, c.y + i * 5);
        if (withRemote && i === 10) {
          remote();
          await sleep(250);
        }
        await sleep(16);
      }
      await page.mouse.up();
      await settle(1200);
      const a1 = await B.node("a");
      const sa = (
        await api(`/api/rooms/${room.id}`, "GET", null, room.token)
      ).document.pages[0].nodes.find((n) => n.id === "a");
      const remoteSeen = await B.node("b");
      return {
        withRemote,
        before: [a0.x, a0.y],
        after: [a1.x, a1.y],
        server: [sa.x, sa.y],
        moved: a1.x !== a0.x,
        bColor: remoteSeen.color,
        status: await B.status(),
        sOps: S.inbox.filter((m) => m.type === "ops").length,
        room: await page.evaluate(() => window.cloudWorkspace.room()?.id),
        roomId: room.id,
      };
    };
    const resize = async (withRemote) => {
      await page.evaluate(() => window.design.setSelection(["a"]));
      await settle(300);
      const a0 = await B.node("a");
      const h = await page.evaluate(() => {
        const r = [
          ...document.querySelectorAll(
            '#canvas .handle[data-corner="se"], #canvas-overlay .handle[data-corner="se"]',
          ),
        ]
          .find((e) => e.getBoundingClientRect().width > 0)
          ?.getBoundingClientRect();
        return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      });
      if (!h)
        return {
          withRemote,
          error: "no se handle",
          handles: await page.evaluate(() =>
            [...document.querySelectorAll("#canvas .handle, #canvas-overlay .handle")]
              .map((e) => e.dataset.corner + ":" + e.parentElement.className)
              .slice(0, 8),
          ),
        };
      await page.mouse.move(h.x, h.y);
      await page.mouse.down();
      for (let i = 1; i <= 20; i++) {
        await page.mouse.move(h.x + i * 5, h.y + i * 4);
        if (withRemote && i === 10) {
          remote();
          await sleep(250);
        }
        await sleep(16);
      }
      await page.mouse.up();
      await settle(1200);
      const a1 = await B.node("a");
      return { withRemote, before: [a0.w, a0.h], after: [a1.w, a1.h], resized: a1.w !== a0.w };
    };
    const text = async (withRemote) => {
      await page.evaluate(() => window.design.setSelection([]));
      const c = await center("t");
      await page.mouse.click(c.x, c.y);
      await sleep(300);
      await page.mouse.dblclick(c.x, c.y);
      await page.waitForSelector("#canvas [data-text-editing]", { timeout: 5000 }).catch(() => {});
      const entered = await page.evaluate(
        () => !!document.querySelector("#canvas [data-text-editing]"),
      );
      if (!entered) await page.keyboard.press("Enter");
      await sleep(200);
      await page.keyboard.press("End");
      await page.keyboard.type(" one", { delay: 30 });
      if (withRemote) {
        remote();
        await sleep(400);
      }
      const editing = await page.evaluate(
        () => !!document.querySelector("#canvas [data-text-editing]"),
      );
      await page.keyboard.type(" two", { delay: 30 });
      await page.keyboard.press("Escape");
      await settle(1200);
      const t1 = await B.node("t");
      const st = (
        await api(`/api/rooms/${room.id}`, "GET", null, room.token)
      ).document.pages[0].nodes.find((n) => n.id === "t");
      return { withRemote, stillEditingAfterRemote: editing, text: t1.text, server: st.text };
    };
    results.gestures = [];
    for (const run of [false, true, false, true]) results.gestures.push({ drag: await drag(run) });
    for (const run of [false, true]) results.gestures.push({ resize: await resize(run) });
    for (const run of [false, true]) {
      await page.evaluate(() => window.design.updateNodes(["t"], { text: "Hello" }));
      await settle(600);
      results.gestures.push({ text: await text(run) });
    }
    log("gestures", JSON.stringify(results.gestures));
    S.ws.close();
  }

  // ---------------- (d) send timing during continuous edits ----------------
  if (SCEN.has("timing")) {
    const room = await B.createRoom(smallDoc("Timing"));
    const S = peer(room, "watch");
    await S.ready;
    await settle(800);
    S.inbox.length = 0;
    const t0 = performance.now();
    const edits = await page.evaluate(async () => {
      window.__sends.length = 0;
      const start = performance.now();
      let i = 0;
      while (performance.now() - start < 1500) {
        window.design.updateNodes(["a"], { x: 100 + ++i });
        await new Promise((r) => requestAnimationFrame(r));
      }
      return { count: i, ms: performance.now() - start };
    });
    await settle(3000);
    const arrivals = S.inbox
      .filter((m) => m.type === "ops")
      .map((m) => ({ ms: Math.round(m.at - t0), ops: m.ops.length, bytes: m.bytes }));
    const sends = await page.evaluate(() =>
      window.__sends
        .filter((s) => s.type === "ops")
        .map((s) => ({ n: s.n, bytes: s.bytes, at: Math.round(s.at) })),
    );
    // Latency: single edits, time from B's updateNodes to S's receipt (same machine, local workerd).
    const lat = [];
    for (let k = 0; k < 15; k++) {
      S.inbox.length = 0;
      const t = performance.now();
      await page.evaluate((k) => window.design.updateNodes(["b"], { y: 100 + k }), k);
      const m = await S.next((m) => m.type === "ops", 5000);
      lat.push(m ? Math.round(m.at - t) : null);
      await sleep(150);
    }
    results.timing = { edits, arrivals, sends, singleEditLatencyMs: lat };
    log("timing", JSON.stringify(results.timing));
    S.ws.close();
  }

  // ---------------- (f) requests per room open ----------------
  if (SCEN.has("access")) {
    const room = await B.createRoom(smallDoc("Access"));
    await settle(1000);
    await page.evaluate(() => window.cloudWorkspace.disconnect());
    await settle(500);
    const mark = Date.now();
    await page.evaluate(
      ([server, id, token]) => window.cloudWorkspace.openRoom({ server, id, token }),
      [server, room.id, room.token],
    );
    await settle(3000);
    const seen = requests
      .filter((r) => r.at >= mark && r.url.startsWith(server))
      .map((r) => r.method + " " + new URL(r.url).pathname.replace(room.id, ":id"));
    const counts = {};
    for (const s of seen) counts[s] = (counts[s] || 0) + 1;
    results.access = counts;
    log("access", JSON.stringify(counts));
  }

  // ---------------- (2) commit-path profile at 1K / 5K ----------------
  if (SCEN.has("perf")) {
    await page.evaluate(
      () => window.cloudWorkspace.isConnected() && window.cloudWorkspace.disconnect(),
    );
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    const instrument = () =>
      page.evaluate(() => {
        if (window.__costs) return;
        const costs = (window.__costs = {});
        const add = (k, ms) => ((costs[k] ||= { n: 0, ms: 0 }), costs[k].n++, (costs[k].ms += ms));
        const isDoc = (v) => !!v && typeof v === "object" && Array.isArray(v.pages);
        const clone = window.structuredClone;
        window.structuredClone = (v, ...r) => {
          const t = performance.now();
          try {
            return clone(v, ...r);
          } finally {
            if (isDoc(v)) add("structuredClone(document)", performance.now() - t);
          }
        };
        const { stringify } = JSON;
        JSON.stringify = function (v, ...r) {
          const t = performance.now();
          try {
            return stringify.call(this, v, ...r);
          } finally {
            if (isDoc(v)) add("JSON.stringify(document)", performance.now() - t);
          }
        };
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          const t = performance.now();
          try {
            return setItem.call(this, k, v);
          } finally {
            if (String(v).length > 10000) add("localStorage.setItem(>10KB)", performance.now() - t);
          }
        };
        const sl = window.storageLimits;
        for (const name of ["measure", "assertShareable"])
          if (typeof sl?.[name] === "function") {
            const f = sl[name];
            sl[name] = function (...a) {
              const t = performance.now();
              try {
                return f.apply(this, a);
              } finally {
                add("storageLimits." + name, performance.now() - t);
              }
            };
          }
      });
    const measureEdits = async (label, n = 12) => {
      await page.evaluate(() => {
        for (const k in window.__costs) delete window.__costs[k];
      });
      await cdp.send("Profiler.start");
      const times = await page.evaluate(async (n) => {
        const out = [];
        const ids = window.design
          .getDocument()
          .pages[0].nodes.filter((x) => x.type === "rectangle")
          .slice(0, n)
          .map((x) => x.id);
        for (let i = 0; i < n; i++) {
          await new Promise((r) => setTimeout(r, 120));
          const t = performance.now();
          window.design.updateNodes([ids[i]], { x: 300 + i });
          out.push(performance.now() - t);
        }
        await new Promise((r) => setTimeout(r, 1200)); // storage meter debounce (700 ms + idle)
        return out;
      }, n);
      const { profile } = await cdp.send("Profiler.stop");
      const costs = await page.evaluate(() => structuredClone(window.__costs));
      // Self time per function from samples.
      const byId = new Map(profile.nodes.map((x) => [x.id, x]));
      const self = new Map();
      const dt = profile.timeDeltas;
      profile.samples.forEach((id, i) => {
        const node = byId.get(id);
        const f = node.callFrame;
        const key = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber + 1}`;
        self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000);
      });
      const top = [...self]
        .filter(([k]) => !/^\((idle|program)\)/.test(k))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 18)
        .map(([k, v]) => [k, Math.round(v)]);
      const sorted = [...times].sort((a, b) => a - b);
      const r = {
        label,
        n,
        medianMs: +sorted[Math.floor(n / 2)].toFixed(1),
        maxMs: +sorted[n - 1].toFixed(1),
        costs: Object.fromEntries(
          Object.entries(costs).map(([k, v]) => [
            k,
            { n: v.n, totalMs: +v.ms.toFixed(1), perEditMs: +(v.ms / n).toFixed(1) },
          ]),
        ),
        topSelfMs: top,
      };
      await fs.writeFile(path.join(OUT, `profile-${label}.cpuprofile`), JSON.stringify(profile));
      return r;
    };
    results.perf = [];
    await instrument();
    for (const size of [1000, 5000]) {
      const doc = synthetic(size);
      doc.name = `Perf ${size}`;
      await page.evaluate((doc) => window.design.loadDocument(doc), doc);
      await settle(1500);
      const subs = await page.evaluate(() => {
        const t = performance.now();
        window.design.getDocument();
        return { getDocumentMs: +(performance.now() - t).toFixed(1) };
      });
      const local = await measureEdits(`local-${size}`);
      local.getDocument = subs;
      results.perf.push(local);
      log("perf", JSON.stringify(local));
      // Shared: the same document in a room.
      await openSharedDesign(page);
      await page.locator("#cloud-create").click();
      await page.waitForFunction(
        () => document.getElementById("cloud-invite").value.includes("token="),
        null,
        { timeout: 60000 },
      );
      await page.evaluate(() => document.getElementById("cloud-dialog").close());
      const cloud = await page.evaluate(() =>
        window.fileLibrary.cloudOf(window.fileLibrary.currentId),
      );
      const room = { id: cloud.roomId, token: cloud.token };
      await settle(2000);
      const shared = await measureEdits(`shared-${size}`);
      results.perf.push(shared);
      log("perf", JSON.stringify(shared));
      // Incoming remote batch: main-thread time in B for one remote property change.
      const S = peer(room, "remote" + size);
      await S.ready;
      await settle(1000);
      await page.evaluate(() => {
        window.__lt = [];
        new PerformanceObserver((l) =>
          window.__lt.push(...l.getEntries().map((e) => Math.round(e.duration))),
        ).observe({ type: "longtask" });
      });
      for (let k = 0; k < 5; k++) {
        S.send([{ t: "node", page: doc.pages[0].id, id: "n1", key: "x", value: 500 + k }]);
        await sleep(700);
      }
      await settle(1500);
      const remote = await page.evaluate(() => window.__lt.slice());
      // Presence path: what one pointermove costs while connected (getDocument for activePage).
      const pointer = await page.evaluate(async () => {
        const area = document.getElementById("workspace") || document.getElementById("canvas");
        const r = area.getBoundingClientRect();
        const out = [];
        for (let i = 0; i < 10; i++) {
          await new Promise((res) => setTimeout(res, 100));
          const t = performance.now();
          area.dispatchEvent(
            new PointerEvent("pointermove", {
              bubbles: true,
              clientX: r.x + 200 + i,
              clientY: r.y + 200,
            }),
          );
          out.push(+(performance.now() - t).toFixed(1));
        }
        return out;
      });
      results.perf.push({
        label: `remote-${size}`,
        longTasksMs: remote,
        pointerMoveHandlerMs: pointer,
      });
      log("perf", `remote-${size}`, JSON.stringify(remote), "pointer", JSON.stringify(pointer));
      S.ws.close();
      await page.evaluate(() => window.cloudWorkspace.disconnect());
    }
  }
  if (SCEN.has("perf3")) {
    await page.evaluate(() => {
      const desc = Object.getOwnPropertyDescriptor(WebSocket.prototype, "onmessage");
      window.__handler = [];
      Object.defineProperty(WebSocket.prototype, "onmessage", {
        configurable: true,
        get() {
          return desc.get.call(this);
        },
        set(fn) {
          desc.set.call(
            this,
            fn &&
              function (event) {
                const t = performance.now();
                try {
                  return fn.call(this, event);
                } finally {
                  let type = "?";
                  try {
                    type = JSON.parse(event.data).type;
                  } catch {}
                  if (type === "ops") window.__handler.push(+(performance.now() - t).toFixed(1));
                }
              },
          );
        },
      });
    });
    const out = {};
    for (const size of [1000, 5000]) {
      const doc = synthetic(size);
      doc.name = `Remote ${size}`;
      const room = await B.createRoom(doc);
      await settle(2500);
      const S = peer(room, "r" + size);
      await S.ready;
      await settle(800);
      await page.evaluate(() => (window.__handler.length = 0));
      for (let k = 0; k < 6; k++) {
        S.send([{ t: "node", page: doc.pages[0].id, id: "n1", key: "x", value: 700 + k }]);
        await sleep(900);
      }
      out[size] = {
        handlerMs: await page.evaluate(() => window.__handler.slice()),
        applied: (await B.node("n1")).x,
      };
      log("perf3", size, JSON.stringify(out[size]));
      S.ws.close();
    }
    results.perf3 = out;
  }
  if (SCEN.has("perf2")) {
    await page.evaluate(
      () => window.cloudWorkspace.isConnected() && window.cloudWorkspace.disconnect(),
    );
    const out = {};
    for (const size of [1000, 5000]) {
      const doc = synthetic(size);
      doc.name = `Attr ${size}`;
      await page.evaluate((doc) => window.design.loadDocument(doc), doc);
      await settle(1500);
      const attr = async () =>
        page.evaluate(async () => {
          const isDoc = (v) => !!v && typeof v === "object" && Array.isArray(v.pages);
          const clone = window.__origClone || (window.__origClone = window.structuredClone);
          const sites = {};
          let on = false;
          window.structuredClone = (v, ...r) => {
            if (!on || !isDoc(v)) return clone(v, ...r);
            const t = performance.now();
            const res = clone(v, ...r);
            const ms = performance.now() - t;
            const frames = new Error().stack
              .split("\n")
              .slice(2, 5)
              .map((l) =>
                l
                  .trim()
                  .replace(/^at /, "")
                  .replace(/\(?app:\/\/verynize\/(web\/)?/, "")
                  .replace(/\)$/, "")
                  .replace(/:\d+\)?$/, ""),
              );
            const key = frames.join(" < ");
            (sites[key] ||= { n: 0, ms: 0 }).n++;
            sites[key].ms += ms;
            return res;
          };
          const ids = window.design
            .getDocument()
            .pages[0].nodes.filter((x) => x.type === "rectangle")
            .slice(0, 6)
            .map((x) => x.id);
          const times = [];
          for (const id of ids) {
            await new Promise((r) => setTimeout(r, 150));
            on = true;
            const t = performance.now();
            window.design.updateNodes([id], { y: 77 });
            times.push(performance.now() - t);
            on = false;
          }
          window.structuredClone = clone;
          return {
            times: times.map((x) => +x.toFixed(1)),
            sites: Object.entries(sites)
              .map(([k, v]) => [k, v.n / 6, +(v.ms / 6).toFixed(1)])
              .sort((a, b) => b[2] - a[2]),
          };
        });
      const local = await attr();
      // Shared room + a remote op applied in B, timed around the socket message handler.
      await openSharedDesign(page);
      await page.locator("#cloud-create").click();
      await page.waitForFunction(
        () => document.getElementById("cloud-invite").value.includes("token="),
        null,
        { timeout: 60000 },
      );
      await page.evaluate(() => document.getElementById("cloud-dialog").close());
      const cloud = await page.evaluate(() =>
        window.fileLibrary.cloudOf(window.fileLibrary.currentId),
      );
      const room = { id: cloud.roomId, token: cloud.token };
      await settle(2500);
      const shared = await attr();
      const S = peer(room, "attr" + size);
      await S.ready;
      await settle(800);
      const pageId = doc.pages[0].id;
      await page.evaluate(() => {
        window.__lt = [];
        new PerformanceObserver((l) =>
          window.__lt.push(...l.getEntries().map((e) => Math.round(e.duration))),
        ).observe({ type: "longtask", buffered: false });
      });
      const remote = [];
      for (let k = 0; k < 5; k++) {
        await page.evaluate(() => (window.__lt.length = 0));
        S.send([{ t: "node", page: pageId, id: "n1", key: "x", value: 900 + k }]);
        await page
          .waitForFunction(
            (v) => window.design.getDocument().pages[0].nodes.find((n) => n.id === "n1").x === v,
            900 + k,
            { timeout: 10000 },
          )
          .catch(() => {});
        await sleep(400);
        remote.push(await page.evaluate(() => window.__lt.slice()));
      }
      const pointer = await page.evaluate(async () => {
        const area = document.getElementById("workspace") || document.getElementById("canvas");
        const r = area.getBoundingClientRect();
        const out = [];
        for (let i = 0; i < 10; i++) {
          await new Promise((res) => setTimeout(res, 100));
          const t = performance.now();
          area.dispatchEvent(
            new PointerEvent("pointermove", {
              bubbles: true,
              clientX: r.x + 200 + i,
              clientY: r.y + 200,
            }),
          );
          out.push(+(performance.now() - t).toFixed(1));
        }
        return out;
      });
      const getDoc = await page.evaluate(() => {
        const t = performance.now();
        window.design.getDocument();
        return +(performance.now() - t).toFixed(1);
      });
      out[size] = {
        local,
        shared,
        remoteLongTasks: remote,
        pointerMoveMs: pointer,
        getDocumentMs: getDoc,
      };
      log("perf2", size, JSON.stringify(out[size]));
      S.ws.close();
      await page.evaluate(() => window.cloudWorkspace.disconnect());
    }
    results.perf2 = out;
  }
} catch (e) {
  results.error = String(e?.stack || e);
  log("ERROR", e);
  try {
    await page?.screenshot({ path: path.join(OUT, "error.png") });
  } catch {}
} finally {
  await fs.writeFile(
    path.join(OUT, `results-${[...SCEN].join("_")}.json`),
    JSON.stringify(results, null, 2),
  );
  await app?.close().catch(() => {});
  await mf.dispose().catch(() => {});
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}
