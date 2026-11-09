// web/remote-apply.js: collaborators' edits patched in node by node (unchanged nodes keep their objects, a gesture's
// nodes wait), the fixed send interval and the coalescing of repeated property edits.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");

globalThis.window = {};
for (const file of ["node-index.js", "cloud-ops.js", "remote-apply.js"])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../web", file), "utf8"));
const { patch, held, baseline, coalesce, throttle, nodeOps } = window.remoteApply;
const Ops = globalThis.VerynizeOps;

const doc = () => ({
  name: "Doc",
  tokens: {},
  activePage: "p2",
  pages: [
    {
      id: "p1",
      name: "One",
      nodes: [
        { id: "a", type: "rectangle", x: 0, y: 0, color: "#000" },
        { id: "b", type: "rectangle", x: 10, y: 0, color: "#111", fills: [{ color: "#111" }] },
        { id: "f", type: "frame", x: 0, y: 0 },
        { id: "c", type: "rectangle", parentId: "f", x: 1, y: 1 },
      ],
    },
    { id: "p2", name: "Two", nodes: [{ id: "t", type: "text", text: "Hello" }] },
  ],
});

test("unchanged nodes, pages and node lists keep their objects; changed nodes are updated in place", () => {
  const live = doc(),
    next = structuredClone(live);
  next.activePage = "p1";
  next.pages[0].nodes[1].color = "#222";
  delete next.pages[0].nodes[1].fills;
  next.pages[0].nodes[1].opacity = 50;
  const [a, b] = live.pages[0].nodes,
    list = live.pages[0].nodes,
    changed = new Set();
  const out = patch(live, next, undefined, changed);
  assert.notEqual(out, live, "a new root (component sync sees a fresh document)");
  assert.equal(out.activePage, "p2", "the local active page stays");
  assert.equal(out.pages[0], live.pages[0]);
  assert.equal(out.pages[0].nodes, list, "same nodes in the same order: the same array");
  assert.equal(out.pages[0].nodes[0], a);
  assert.equal(out.pages[0].nodes[1], b, "a changed node keeps its object");
  assert.deepEqual(b, { id: "b", type: "rectangle", x: 10, y: 0, color: "#222", opacity: 50 });
  assert.deepEqual([...changed], ["b"]);
  assert.deepEqual(out, { ...next, activePage: "p2" });
});

test("adds, removes, reorders and page changes follow the remote document", () => {
  const live = doc(),
    next = structuredClone(live);
  const p1 = next.pages[0];
  p1.nodes = [p1.nodes[2], p1.nodes[3], p1.nodes[0], { id: "n", type: "rectangle" }];
  p1.name = "Renamed";
  next.pages.push({ id: "p3", name: "Three", nodes: [] });
  next.pages[1].nodes = [];
  const [a] = live.pages[0].nodes;
  const changed = new Set();
  const out = patch(live, next, undefined, changed);
  assert.deepEqual(
    out.pages[0].nodes.map((n) => n.id),
    ["f", "c", "a", "n"],
  );
  assert.equal(out.pages[0].nodes[2], a);
  assert.equal(out.pages[0].name, "Renamed");
  assert.deepEqual(
    out.pages.map((p) => p.id),
    ["p1", "p2", "p3"],
  );
  assert.deepEqual(
    [...changed].sort((x, y) => x.localeCompare(y)),
    ["b", "n", "t"],
  );
  assert.deepEqual(out, { ...next, activePage: "p2" });
  // The active page removed remotely: the remote active page.
  const gone = structuredClone(next);
  gone.pages.splice(1, 1);
  gone.activePage = "p1";
  assert.equal(patch(out, gone).activePage, "p1");
});

test("held nodes keep their live state, even when a collaborator removed them", () => {
  const live = doc();
  live.activePage = "p1";
  const a = live.pages[0].nodes[0];
  a.x = 99; // a drag in progress
  const next = structuredClone(doc());
  next.pages[0].nodes[0].color = "#f00"; // remote edit to the dragged node: waits
  next.pages[0].nodes[1].color = "#0f0"; // remote edit to another node: applied
  const ids = held(live, new Set(["a"]), true);
  assert.deepEqual([...ids], ["a"]);
  let out = patch(live, next, ids);
  assert.equal(out.pages[0].nodes[0], a);
  assert.deepEqual([a.x, a.color], [99, "#000"]);
  assert.equal(out.pages[0].nodes[1].color, "#0f0");
  // Removed remotely while held: kept in place until the gesture ends.
  const removed = structuredClone(next);
  removed.pages[0].nodes.shift();
  removed.pages[0].nodes.splice(1, 0, { id: "z", type: "rectangle" });
  out = patch(out, removed, ids);
  assert.deepEqual(
    out.pages[0].nodes.map((n) => n.id),
    ["a", "b", "z", "f", "c"],
  );
  // A held frame holds its descendants; no gesture holds nothing.
  assert.deepEqual(
    [...held(live, new Set(["f"]), true)].sort((x, y) => x.localeCompare(y)),
    ["c", "f"],
  );
  assert.equal(held(live, new Set(["f"]), false).size, 0);
});

test("baseline: held nodes as before the gesture, nodes the gesture created dropped", () => {
  const prior = doc(),
    current = structuredClone(prior);
  current.pages[0].nodes[0].x = 50; // dragged
  current.pages[0].nodes[1].color = "#abc"; // remote
  current.pages[0].nodes.push({ id: "copy", type: "rectangle" }); // alt-drag copy
  const out = baseline(structuredClone(current), prior, new Set(["a", "copy"]));
  assert.equal(out.pages[0].nodes[0].x, 0);
  assert.notEqual(out.pages[0].nodes[0], prior.pages[0].nodes[0], "a copy, not the prior's object");
  assert.equal(out.pages[0].nodes[1].color, "#abc");
  assert.deepEqual(
    out.pages[0].nodes.map((n) => n.id),
    ["a", "b", "f", "c"],
  );
  // The gesture's edits are then found by the panel's diff.
  const ops = Ops.diff(out, current, { ignore: ["activePage"] });
  assert.deepEqual(
    ops.map((op) => [op.t, op.id, op.key]),
    [
      ["node", "a", "x"],
      ["add", "copy", undefined],
    ],
  );
});

test("nodeOps match the per-node part of VerynizeOps.diff", () => {
  const before = { id: "t", type: "text", text: "Hello", x: 1, fills: [1] },
    after = { id: "t", type: "text", text: "Hello you", x: 2, opacity: 3 };
  const mine = nodeOps("p", before, after);
  const theirs = Ops.diff(
    { pages: [{ id: "p", nodes: [before] }] },
    { pages: [{ id: "p", nodes: [after] }] },
  );
  assert.deepEqual(
    mine.map((op) => JSON.stringify(op)).sort(),
    theirs.map((op) => JSON.stringify(op)).sort(),
  );
});

test("coalesce keeps the newest value per property and stops at structural edits", () => {
  const set = (id, key, value, s) => ({ t: "node", page: "p", id, key, value, s });
  const tail = [set("a", "x", 1, "1"), set("a", "y", 1, "2"), set("b", "x", 1, "3")];
  const bytes = (op) => JSON.stringify(op).length;
  const dropped = coalesce(tail, [set("a", "x", 2, "4"), set("a", "x", 3, "5")], bytes);
  assert.deepEqual(
    tail.map((op) => op.s),
    ["2", "3", "5"],
  );
  assert.equal(dropped, bytes(set("a", "x", 1, "1")) + bytes(set("a", "x", 2, "4")));
  // Applying the coalesced tail gives what applying every edit gives.
  const start = { pages: [{ id: "p", nodes: [{ id: "a" }, { id: "b" }] }] };
  const all = [
    set("a", "x", 1, "1"),
    set("a", "y", 1, "2"),
    set("b", "x", 1, "3"),
    set("a", "x", 2, "4"),
    set("a", "x", 3, "5"),
  ];
  assert.deepEqual(Ops.apply(start, tail).doc, Ops.apply(start, all).doc);
  // A node removed and added again in between, a text edit or a root replacement end the run.
  const runs = [
    set("a", "x", 1, "1"),
    { t: "remove", page: "p", id: "a" },
    { t: "add", page: "p", id: "a", value: { id: "a" } },
  ];
  coalesce(runs, [set("a", "x", 2, "2")]);
  assert.equal(runs.length, 4);
  const text = [set("a", "text", "x", "1"), { t: "text", page: "p", id: "a", key: "text" }];
  coalesce(text, [set("a", "text", "y", "2")]);
  assert.equal(text.length, 3);
  assert.equal(coalesce([], []), 0);
});

test("throttle: a fixed interval that later calls never push back", async () => {
  globalThis.performance ??= require("node:perf_hooks").performance;
  const runs = [];
  const t0 = performance.now();
  const fn = throttle(() => runs.push(performance.now() - t0), 60);
  fn(); // the first call after idle runs on the next turn
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(runs.length, 1);
  assert.ok(runs[0] < 40, String(runs[0]));
  // A call every 10 ms for 400 ms: about one run per 60 ms while the burst lasts, not one after it.
  const start = performance.now();
  while (performance.now() - start < 400) {
    fn();
    await new Promise((r) => setTimeout(r, 10));
  }
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(runs.length >= 5 && runs.length <= 9, JSON.stringify(runs));
  for (let i = 1; i < runs.length; i++)
    assert.ok(runs[i] - runs[i - 1] >= 55, JSON.stringify(runs));
  fn();
  fn.cancel();
  const count = runs.length;
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(runs.length, count, "cancel drops the scheduled run");
});
