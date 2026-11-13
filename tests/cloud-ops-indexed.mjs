import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import "../web/cloud-ops.js";
const Ops = globalThis.VerynizeOps;
// Frozen pre-index implementation: compare serialized documents, resolved ops, rejects and stamps.
const context = vm.createContext({});
vm.runInContext(
  await fs.readFile(new URL("./fixtures/cloud-ops-before-index.js", import.meta.url), "utf8"),
  context,
);
const before = context.VerynizeOps;
const board = () => ({
  pages: [
    {
      id: "p",
      nodes: [
        { id: "a", parentId: null },
        { id: "b", parentId: "a" },
        { id: "c", parentId: "b", text: "hello" },
        { id: "d", parentId: null },
      ],
    },
    { id: "q", nodes: [{ id: "other" }] },
  ],
});
function compare(doc, ops) {
  for (const normalize of [false, true])
    for (const authoritative of [false, true]) {
      const run = (engine) => {
        const stamps = engine.memoryStamps();
        const result = engine.apply(doc, ops, {
          normalize,
          stamps: authoritative ? stamps : null,
          stamp: "0000000002.000000.server",
          external: (id) => id === "external",
        });
        return JSON.stringify({ ...result, stamps: stamps.data });
      };
      assert.equal(run(Ops), run(before), JSON.stringify({ doc, ops, normalize, authoritative }));
    }
}
test("indexed apply preserves moves, cycles, subtree removals, reorders and re-adds byte for byte", () => {
  compare(board(), [
    { t: "node", page: "p", id: "a", key: "parentId", value: "c" },
    { t: "node", page: "p", id: "c", key: "parentId", value: "d" },
    { t: "remove", page: "p", id: "a" },
    { t: "remove", page: "p", id: "b" },
    { t: "nodeOrder", page: "p", value: ["d", "c"] },
    { t: "remove", page: "p", id: "d" },
    { t: "add", page: "q", id: "a", value: { id: "a" } },
    { t: "text", page: "p", id: "c", key: "text", base: "hello", value: "hello world" },
    { t: "pageOrder", value: ["q", "p"] },
    { t: "removePage", id: "p" },
    { t: "addPage", id: "p", value: { id: "p", nodes: [{ id: "c" }] } },
    { t: "add", page: "p", id: "external", value: { id: "external" } },
  ]);
  compare(
    {
      pages: [
        {
          id: "p",
          nodes: [
            { id: "lead", parentId: "a" },
            { id: "a", parentId: "b" },
            { id: "b", parentId: "a" },
            { id: "tail", parentId: "lead" },
          ],
        },
      ],
    },
    [],
  );
  compare({ pages: [{ id: "p", nodes: [{ id: "a" }, { id: "a", parentId: "a" }] }] }, [
    { t: "remove", page: "p", id: "a" },
    { t: "add", page: "p", id: "b", value: { id: "b" } },
  ]);
});
test("normalization preserves repair order for every small parent graph", () => {
  const ids = ["a", "b", "c", "d"];
  for (let code = 0; code < 625; code++) {
    let rest = code;
    const nodes = ids.map((id) => {
      const parentId = [null, ...ids][rest % 5];
      rest = Math.floor(rest / 5);
      return { id, parentId };
    });
    compare({ pages: [{ id: "p", nodes }] }, []);
  }
});
test("deterministic mixed operation streams match the pre-index semantics", () => {
  let seed = 719;
  const random = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let trial = 0; trial < 100; trial++) {
    const ops = [];
    for (let i = 0; i < 60; i++) {
      const id = ["a", "b", "c", "d", "other"][random(5)],
        page = random(3) ? "p" : "q";
      const value = [null, "a", "b", "c", "missing"][random(5)];
      const op = [
        { t: "add", page, id, value: { id, parentId: value } },
        { t: "remove", page, id },
        { t: "node", page, id, key: "parentId", value },
        { t: "nodeOrder", page, value: [id, "b", "a"] },
        { t: "text", page, id, key: "text", base: "hello", value: "hi" },
        { t: "pageOrder", value: ["q", "p"] },
        { t: "root", value: board() },
        { t: "doc", key: "name", value: "changed" },
      ][random(8)];
      op.s = `0000000001.${String(random(100)).padStart(6, "0")}.test`;
      ops.push(op);
    }
    compare(board(), ops);
  }
});
test("9000-node page plus 4000 import operations applies under 2 seconds", () => {
  const doc = {
    pages: [
      {
        id: "p",
        nodes: Array.from({ length: 9000 }, (_, i) => ({
          id: `n${i}`,
          parentId: i ? "n0" : null,
          x: i,
          type: i ? "rectangle" : "frame",
        })),
      },
    ],
  };
  const ops = Array.from({ length: 4000 }, (_, i) =>
    i < 1000
      ? { t: "add", page: "p", id: `new${i}`, value: { id: `new${i}`, parentId: "n0" } }
      : { t: "node", page: "p", id: `n${i}`, key: "parentId", value: "n1" },
  );
  const measure = (engine) => {
    const start = performance.now();
    const result = engine.apply(doc, ops, { normalize: true });
    return { result, ms: performance.now() - start };
  };
  const old = measure(before),
    current = measure(Ops);
  assert.equal(JSON.stringify(current.result), JSON.stringify(old.result));
  assert.equal(current.result.doc.pages[0].nodes.length, 10000);
  console.log(`BIG_BATCH before=${old.ms.toFixed(1)}ms after=${current.ms.toFixed(1)}ms`);
  assert.ok(current.ms < 2000, `indexed apply took ${current.ms}ms`);
});
