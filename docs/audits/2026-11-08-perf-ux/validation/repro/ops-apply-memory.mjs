// Validation repro (claim 8): whole-document clone in Ops.apply and the double clone of added
// nodes, measured in plain Node with the real web/cloud-ops.js. Not a workerd memory measurement:
// V8 heap numbers here approximate what one DO invocation allocates in Ops.apply alone.
// Usage: node --expose-gc docs/audits/2026-11-08-perf-ux/validation/repro/ops-apply-memory.mjs
import fs from "node:fs/promises";
import vm from "node:vm";
const root = new URL("../../../../../", import.meta.url);
const ctx = { console, structuredClone, TextEncoder, Date };
ctx.globalThis = ctx;
vm.createContext(ctx);
// Count JSON.stringify calls inside cloud-ops (clone = JSON.parse(JSON.stringify(v))).
const realJSON = JSON;
const stats = { stringify: 0, bytes: 0 };
ctx.JSON = {
  parse: realJSON.parse,
  stringify: (v, ...rest) => {
    const s = realJSON.stringify(v, ...rest);
    stats.stringify++;
    stats.bytes += s ? s.length : 0;
    return s;
  },
};
vm.runInContext(await fs.readFile(new URL("web/cloud-ops.js", root), "utf8"), ctx);
const Ops = ctx.VerynizeOps;
const gc = globalThis.gc || (() => {});
const mb = (n) => Math.round((n / 1048576) * 10) / 10;
const node = (id, bytes) => ({
  id,
  type: "image",
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  src: "data:image/png;base64," + "A".repeat(bytes),
});

function run(label, doc, ops) {
  const clock = Ops.createClock("srv");
  const stampMap = new Map();
  const stamps = {
    get: (p) => stampMap.get(p),
    set: (p, s) => stampMap.set(p, s),
    clear: () => stampMap.clear(),
  };
  const message = realJSON.stringify({ type: "ops", batch: 1, ops }); // what arrives on the socket
  gc();
  gc();
  const before = process.memoryUsage().heapUsed;
  stats.stringify = 0;
  stats.bytes = 0;
  const parsed = realJSON.parse(message).ops;
  const stamped = parsed.map((op) => ({ ...op, s: clock.next() })); // rooms.js:432-438
  const t = performance.now();
  const result = Ops.apply(doc, stamped, { stamps, normalize: true, stamp: clock.next() });
  const ms = performance.now() - t;
  const broadcast = realJSON.stringify({ type: "ops", revision: 1, ops: result.applied }); // rooms.js:222
  const after = process.memoryUsage().heapUsed;
  const keep = [parsed, stamped, result, broadcast];
  console.log(
    JSON.stringify({
      label,
      messageMB: mb(message.length),
      docMB: mb(realJSON.stringify(doc).length),
      applyMs: Math.round(ms),
      applied: result.applied.length,
      cloneStringifyCalls: stats.stringify,
      cloneStringifiedMB: mb(stats.bytes),
      retainedHeapDeltaMB: mb(after - before),
    }),
  );
  return keep.length;
}

const N = 4900,
  B = 4096;
// (a) large add batch into an empty page (import): message ~ N*B
run(
  "add 4900 x 4KB into empty page",
  { pages: [{ id: "p", nodes: [] }] },
  Array.from({ length: N }, (_, i) => ({
    t: "add",
    page: "p",
    id: "n" + i,
    value: node("n" + i, B),
  })),
);
// (b) one-property edit on a page that already holds 4900 x 4KB nodes
const big = { pages: [{ id: "p", nodes: Array.from({ length: N }, (_, i) => node("n" + i, B)) }] };
run("1 node op on page with 4900 x 4KB", big, [
  { t: "node", page: "p", id: "n0", key: "x", value: 5 },
]);
