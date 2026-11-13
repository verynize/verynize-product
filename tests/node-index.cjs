// web/node-index.js: cached id/children index over a page's node array, revalidated against in-place mutations.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");

globalThis.window = {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../web/node-index.js"), "utf8"));
const { of, find } = globalThis.window.VerynizeNodeIndex;

// The previous implementations, kept as the reference behaviour.
function descendantsByScan(list, id) {
  const found = new Set([id]);
  let size;
  do {
    size = found.size;
    list.forEach((n) => {
      if (found.has(n.parentId)) found.add(n.id);
    });
  } while (size !== found.size);
  return found;
}
const topmostByScan = (all, list) =>
  list.filter((n) => !list.some((o) => o.id !== n.id && descendantsByScan(all, o.id).has(n.id)));

function tree() {
  return [
    { id: "a", parentId: null },
    { id: "a1", parentId: "a" },
    { id: "a2", parentId: "a" },
    { id: "a1x", parentId: "a1" },
    { id: "b" },
    { id: "b1", parentId: "b" },
    { id: "c", parentId: null },
  ];
}

test("lookups, children and descendants match whole-array scans", () => {
  const list = tree(),
    ix = of(list);
  for (const n of list) assert.equal(ix.get(n.id), n);
  assert.equal(ix.get("missing"), undefined);
  assert.deepEqual(
    ix.children(null).map((n) => n.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    ix.children("a").map((n) => n.id),
    ["a1", "a2"],
  );
  assert.deepEqual(ix.children("a2"), []);
  for (const n of list)
    assert.deepEqual(
      [...ix.descendants(n.id)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      [...descendantsByScan(list, n.id)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      n.id,
    );
  assert.deepEqual(
    [...ix.descendants("ghost")],
    ["ghost"],
    "an unknown id is its own subtree, as before",
  );
});

test("topmost keeps nodes without a selected ancestor, in the given order", () => {
  const list = tree(),
    ix = of(list),
    pick = (...ids) => list.filter((n) => ids.includes(n.id));
  for (const ids of [
    ["a", "a1", "a1x", "b1"],
    ["a1x", "a2"],
    ["a1", "a1x", "c"],
    list.map((n) => n.id),
    [],
  ]) {
    const chosen = pick(...ids);
    assert.deepEqual(
      ix.topmost(chosen).map((n) => n.id),
      topmostByScan(list, chosen).map((n) => n.id),
      ids.join(","),
    );
  }
  const reversed = pick("c", "b1", "a").reverse();
  assert.deepEqual(
    ix.topmost(reversed).map((n) => n.id),
    ["c", "b1", "a"],
  );
});

test("in-place mutations are seen on the next use", () => {
  const list = tree();
  assert.equal(find(list, "b1").parentId, "b");
  list.find((n) => n.id === "b1").parentId = "a2";
  assert.deepEqual(
    of(list)
      .children("a2")
      .map((n) => n.id),
    ["b1"],
    "reparenting",
  );
  assert.ok(of(list).descendants("a").has("b1"));
  list.push({ id: "d", parentId: "c" });
  assert.equal(find(list, "d").id, "d", "a pushed node is found");
  assert.deepEqual(
    of(list)
      .children("c")
      .map((n) => n.id),
    ["d"],
  );
  list.splice(
    list.findIndex((n) => n.id === "a1"),
    1,
  );
  assert.equal(find(list, "a1"), undefined, "a removed node is gone");
  assert.deepEqual(
    of(list)
      .children("a")
      .map((n) => n.id),
    ["a2"],
  );
  const replaced = { id: "c", parentId: null, name: "new" };
  list[list.findIndex((n) => n.id === "c")] = replaced;
  assert.equal(find(list, "c"), replaced, "a replaced object is returned");
  list.find((n) => n.id === "d").id = "e";
  assert.equal(find(list, "d"), undefined, "a renamed id is not found under its old id");
  assert.equal(find(list, "e").parentId, "c");
  assert.equal(find(list, null), undefined);
  assert.equal(find(list, undefined), undefined);
});

test("a parent cycle neither loops nor hides the node itself", () => {
  const list = [
      { id: "x", parentId: "y" },
      { id: "y", parentId: "x" },
      { id: "z", parentId: "x" },
    ],
    ix = of(list);
  assert.deepEqual(
    ix.topmost([list[0]]).map((n) => n.id),
    ["x"],
  );
  assert.deepEqual(
    ix.topmost([list[0], list[2]]).map((n) => n.id),
    ["x"],
  );
  assert.deepEqual(
    [...ix.descendants("x")].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ["x", "y", "z"],
  );
});

test("2,000 nodes: all-node topmost and per-node lookups are fast", () => {
  const list = [];
  for (let f = 0; f < 100; f++) {
    list.push({ id: "f" + f, parentId: null }, { id: `f${f}-g`, parentId: "f" + f });
    for (let k = 0; k < 18; k++)
      list.push({ id: `f${f}-${k}`, parentId: k % 2 ? "f" + f : `f${f}-g` });
  }
  const t = performance.now();
  const top = of(list).topmost(list);
  for (const n of list) find(list, n.parentId);
  for (const n of list.slice(0, 200)) of(list).descendants(n.id);
  const ms = performance.now() - t;
  assert.deepEqual(
    top.map((n) => n.id),
    list.filter((n) => !n.parentId).map((n) => n.id),
  );
  assert.ok(ms < 250, `${ms.toFixed(1)} ms`);
});
