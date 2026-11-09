// Validation repro (client side, plain Node, no Electron). Extracts the real functions
// apply/rebuild/sendPending/retryRetained/queueOps/receiveOps from web/cloud-panel.js by source
// text and runs them in a VM with the real web/cloud-ops.js and web/room-limits.js. Only UI,
// network and storage hooks are stubbed.
// Usage: node docs/audits/2026-11-08-perf-ux/validation/repro/client-receive.mjs
import fs from "node:fs/promises";
import vm from "node:vm";
const root = new URL("../../../../../", import.meta.url);
const read = (p) => fs.readFile(new URL(p, root), "utf8");
const panel = await read("web/cloud-panel.js");

function extract(name) {
  let start = panel.indexOf(`  function ${name}(`);
  if (start < 0) start = panel.indexOf(`  async function ${name}(`);
  if (start < 0) throw Error("missing " + name);
  const open = panel.indexOf("{", panel.indexOf(")", start));
  let depth = 0;
  for (let i = open; i < panel.length; i++) {
    if (panel[i] === "{") depth++;
    else if (panel[i] === "}" && --depth === 0) return panel.slice(start, i + 1);
  }
  throw Error("unbalanced " + name);
}
const SIZE_ERROR =
  /exceeds|too large|larger than|over the .* limit|inline .*data|limit for shared/i; // web/storage-limits.js:329

function makeClient() {
  const ctx = { console, setTimeout, clearTimeout, structuredClone, TextEncoder, Date, JSON };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return { ctx };
}
const opsSrc = await read("web/cloud-ops.js");
const limitsSrc = await read("web/room-limits.js");
const fnSrc = ["apply", "rebuild", "sendPending", "retryRetained", "queueOps", "receiveOps"]
  .map(extract)
  .join("\n");

function client() {
  const { ctx } = makeClient();
  vm.runInContext(opsSrc, ctx);
  vm.runInContext(limitsSrc, ctx);
  ctx.sent = [];
  ctx.statusLog = [];
  ctx.editorDoc = null;
  vm.runInContext(
    `
    const window = {
      VerynizeOps: globalThis.VerynizeOps,
      VerynizeRoomLimits: globalThis.VerynizeRoomLimits,
      storageLimits: { isSizeError: (e) => e?.code === "storage_limit" || e?.status === 413 || ${SIZE_ERROR}.test(String(e?.message || e || "")) },
      design: {
        getDocument: () => structuredClone(globalThis.editorDoc),
        setDocument: (d) => { globalThis.editorDoc = structuredClone(d); globalThis.setDocumentCalls = (globalThis.setDocumentCalls || 0) + 1; },
        getSelection: () => [],
      },
    };
    const WebSocket = { OPEN: 1 };
    const Ops = window.VerynizeOps;
    const Pages = { deferredOps: () => [], filterRemote: (o) => o, splitLocal: (o) => o };
    const LOCAL_KEYS = ["activePage"];
    const shared = (doc) => { const c = { ...doc }; for (const k of LOCAL_KEYS) delete c[k]; return JSON.stringify(c); };
    let confirmed = null, pending = [], retained = [], revision = 0, clientId = "me", batchNumber = 0,
      sendTimer, generation = 1, pageGenerations = new Map(), lastLocalDoc = null, lastLocal = "", applying = false;
    let clock = Ops.createClock("me");
    let socket = { readyState: 1, send: (m) => globalThis.sent.push({ at: Date.now(), msg: JSON.parse(m) }) };
    function status(t) { globalThis.statusLog.push(t); }
    async function saveOutbox() { return true; }
    function markRemote() {}
    function canEdit() { return true; }
    function drawPeers() {}
    ${fnSrc}
    globalThis.api = {
      set(s) { if ("confirmed" in s) confirmed = s.confirmed; if ("pending" in s) pending = s.pending; if ("retained" in s) retained = s.retained; if ("revision" in s) revision = s.revision; if ("batchNumber" in s) batchNumber = s.batchNumber; },
      get: () => ({ confirmed, pending, retained, revision, batchNumber }),
      receiveOps, queueOps, sendPending, rebuild,
    };
    `,
    ctx,
  );
  return ctx;
}
const doc = (ids) => ({
  pages: [{ id: "p", nodes: ids.map((id, i) => ({ id, type: "rectangle", x: i })) }],
});
const ids = (d) => d.pages[0].nodes.map((n) => n.id);
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

// ---- claim 1 + 4 (client): missed revision 2, then revision 3 arrives -----------------------------
{
  const c = client();
  const base = doc(["a", "b", "c"]);
  c.editorDoc = structuredClone(base);
  c.api.set({ confirmed: base, revision: 1 });
  // Revision 2 (peer added node m0) is never delivered. Revision 3 edits m0.
  c.api.receiveOps({
    type: "ops",
    client: "peer",
    batch: 7,
    revision: 3,
    ops: [
      {
        t: "node",
        page: "p",
        id: "m0",
        key: "x",
        value: 5,
        s: c.VerynizeOps.createClock("peer").next(),
      },
    ],
  });
  await tick(60);
  const direct = c.VerynizeOps.apply(base, [
    { t: "node", page: "p", id: "m0", key: "x", value: 5 },
  ]);
  out.claim1_gap = {
    revisionAfter: c.api.get().revision,
    confirmedNodes: ids(c.api.get().confirmed),
    editorNodes: ids(c.editorDoc),
    status: c.statusLog.at(-1),
  };
  out.claim4_client = { applied: direct.applied.length, rejected: direct.rejected };
}

// ---- claim 2 (client): duplicate receipt with ops:[] drops own edit ---------------------------
{
  const c = client();
  const base = doc(["a", "b", "c"]);
  const add = {
    t: "add",
    page: "p",
    id: "mine",
    value: { id: "mine", type: "rectangle", x: 9 },
    s: c.VerynizeOps.createClock("me").next(),
  };
  c.editorDoc = c.VerynizeOps.apply(base, [add]).doc;
  c.api.set({
    confirmed: base,
    revision: 0,
    pending: [{ n: 1, ops: [add], sent: true }],
    batchNumber: 1,
  });
  const before = ids(c.editorDoc);
  // Exact server reply measured in server-protocol.mjs (claim2_duplicate.second).
  c.api.receiveOps({
    type: "ops",
    client: "me",
    batch: 1,
    revision: 1,
    ops: [],
    rejected: 0,
    duplicate: true,
  });
  await tick(60);
  out.claim2_dupack = {
    editorBefore: before,
    editorAfter: ids(c.editorDoc),
    pendingAfter: c.api.get().pending.length,
    confirmedNodes: ids(c.api.get().confirmed),
    revision: c.api.get().revision,
    status: c.statusLog.at(-1),
  };
}

// ---- claim 7: rejected ("interrupted") batch holds later edits and is re-sent as a new batch ----
const interrupted = (batch) => ({
  type: "ops",
  client: "me",
  batch,
  revision: 0,
  ops: [],
  rejected: 1,
  tooLarge: true,
  retained: true,
  error:
    "This batch interrupted room processing. Edits are retained on this device; retry a smaller import.",
});
for (const variant of ["onlyRejected", "withLaterBatch"]) {
  const c = client();
  const base = doc(["a", "b", "c"]);
  const poison = {
    t: "add",
    page: "p",
    id: "big",
    value: { id: "big", type: "rectangle", x: 1 },
    s: c.VerynizeOps.createClock("me").next(),
  };
  const later = {
    t: "node",
    page: "p",
    id: "a",
    key: "x",
    value: 555,
    s: c.VerynizeOps.createClock("me").next(),
  };
  const pending = [{ n: 1, ops: [poison], sent: true }];
  if (variant === "withLaterBatch") pending.push({ n: 2, ops: [later], sent: false });
  c.editorDoc = c.VerynizeOps.apply(
    base,
    pending.flatMap((b) => b.ops),
  ).doc;
  c.api.set({ confirmed: base, pending, batchNumber: pending.length });
  c.api.receiveOps(interrupted(1));
  await tick(80);
  const afterReject = {
    retained: c.api.get().retained.length,
    pending: c.api.get().pending.map((b) => b.n),
    sent: c.sent.map((s) => ({ batch: s.msg.batch, ids: s.msg.ops.map((o) => o.id + ":" + o.t) })),
  };
  let afterEdit = null;
  if (variant === "onlyRejected") {
    c.api.queueOps([{ t: "node", page: "p", id: "b", key: "x", value: 777 }]);
    await tick(120);
    afterEdit = {
      retained: c.api.get().retained.length,
      pending: c.api
        .get()
        .pending.map((b) => ({ n: b.n, ops: b.ops.map((o) => o.id + ":" + o.t) })),
      sent: c.sent.map((s) => ({
        batch: s.msg.batch,
        ids: s.msg.ops.map((o) => o.id + ":" + o.t),
      })),
    };
  }
  out["claim7_" + variant] = { afterReject, afterEdit, status: c.statusLog.at(-1) };
}
// ...and a real 413 size rejection where the desired document exceeds the limit stays held.
{
  const c = client();
  const base = doc(["a"]);
  const huge = {
    t: "add",
    page: "p",
    id: "huge",
    value: { id: "huge", type: "image", src: "x".repeat(21 * 1024 * 1024) },
    s: c.VerynizeOps.createClock("me").next(),
  };
  c.editorDoc = structuredClone(base);
  c.api.set({ confirmed: base, pending: [{ n: 1, ops: [huge], sent: true }], batchNumber: 1 });
  c.api.receiveOps({
    type: "ops",
    client: "me",
    batch: 1,
    revision: 0,
    ops: [],
    rejected: 1,
    tooLarge: true,
    retained: true,
    error: "Page exceeds the 20 MiB limit",
  });
  c.api.queueOps([{ t: "node", page: "p", id: "a", key: "x", value: 3 }]);
  await tick(120);
  out.claim7_sizeLimit = {
    retainedOps: c.api.get().retained.length,
    pending: c.api.get().pending.length,
    sentAfterReject: c.sent.length,
    status: c.statusLog.at(-1),
  };
}

// ---- claim 6b: send timer is restarted on every change ---------------------------------------
{
  const c = client();
  c.editorDoc = doc(["a"]);
  c.api.set({ confirmed: doc(["a"]) });
  const t0 = Date.now();
  let n = 0;
  while (Date.now() - t0 < 1000) {
    c.api.queueOps([{ t: "node", page: "p", id: "a", key: "x", value: n++ }]);
    await tick(16);
  }
  const lastEdit = Date.now() - t0;
  await tick(200);
  out.claim6_debounce = {
    edits: n,
    editWindowMs: lastEdit,
    sends: c.sent.length,
    firstSendAtMs: c.sent[0] ? c.sent[0].at - t0 : null,
    opsInFirstSend: c.sent[0]?.msg.ops.length,
  };
}

// ---- claim 6a: a remote op goes through setDocument (whole-document replace) -------------------
{
  const c = client();
  const base = doc(["a", "b"]);
  c.editorDoc = structuredClone(base);
  c.api.set({ confirmed: base, revision: 1 });
  c.setDocumentCalls = 0;
  c.api.receiveOps({
    type: "ops",
    client: "peer",
    batch: 1,
    revision: 2,
    ops: [
      {
        t: "node",
        page: "p",
        id: "b",
        key: "x",
        value: 50,
        s: c.VerynizeOps.createClock("peer").next(),
      },
    ],
  });
  await tick(60);
  out.claim6_remoteReplace = { setDocumentCalls: c.setDocumentCalls };
}
console.log(JSON.stringify(out, null, 2));
