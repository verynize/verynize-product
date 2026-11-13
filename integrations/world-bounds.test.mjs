import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pageWorldBounds,
  validateDocument,
  prepareDocument,
  validateWorldBoundsChange,
} from "./document-core.mjs";
import { DesignStore, applyOperations } from "./design-store.mjs";
const node = (id, props = {}) => ({
  id,
  type: "frame",
  name: id,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  ...props,
});
const doc = (nodes) => ({
  version: 2,
  name: "Bounds",
  tokens: {},
  activePage: "p",
  pages: [{ id: "p", name: "Page", nodes }],
});
test("world rectangles accumulate parents independent of order; include hidden overflow and edges", () => {
  const d = doc([
    node("c", { parentId: "b", x: 80, hidden: true }),
    node("b", { parentId: "a", x: 300000 }),
    node("a", { x: 700000, clipContent: true }),
  ]);
  const result = pageWorldBounds(d.pages[0]);
  assert.deepEqual(result.rects.get("c"), { x: 1000080, y: 0, w: 100, h: 100 });
  assert.equal(result.outOfRange, true);
  assert.doesNotThrow(() => validateDocument(d));
  assert.deepEqual(pageWorldBounds({ nodes: [] }).bounds, null);
  assert.equal(pageWorldBounds({ nodes: [node("a", { x: 999900 })] }).outOfRange, false);
  assert.equal(pageWorldBounds({ nodes: [node("a", { x: -1000000 })] }).outOfRange, false);
  assert.equal(pageWorldBounds({ nodes: [node("a", { x: 99900 })] }).advisory, false);
  assert.equal(pageWorldBounds({ nodes: [node("a", { x: 99901 })] }).advisory, true);
});
test("rotations include corners and parent transforms; cycles fail deterministically", () => {
  const p = {
    nodes: [node("a", { x: 999900, rotation: 45 }), node("b", { parentId: "a", x: 100 })],
  };
  assert.equal(pageWorldBounds(p).outOfRange, true);
  assert.throws(
    () => pageWorldBounds({ nodes: [node("a", { parentId: "b" }), node("b", { parentId: "a" })] }),
    /cycle/,
  );
});
test("loading nested overflow preserves geometry without failing", () => {
  const d = doc([node("a", { x: 700000 }), node("b", { parentId: "a", x: 400000 })]);
  const before = structuredClone(d),
    repairs = [];
  assert.doesNotThrow(() => prepareDocument(d, {}, repairs));
  assert.equal(d.pages[0].nodes[1].x, before.pages[0].nodes[1].x);
  assert.equal(
    repairs.some((r) => /\.(x|y|w|h)$/.test(r.path)),
    false,
  );
});
test("store transactions reject ancestor moves atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "bounds-"));
  try {
    const store = await DesignStore.open(root);
    const d = doc([node("a", { x: 600000 }), node("b", { parentId: "a", x: 300000 })]);
    const saved = await store.mutate("bounds", () => d);
    const bytes = await readFile(store.file("bounds"), "utf8");
    const operations = [
      { type: "update_node", pageId: "p", nodeId: "a", properties: { x: 800000 } },
    ];
    assert.throws(() => applyOperations(d, operations), /world bounds/);
    await assert.rejects(store.update("bounds", saved.revision, operations), /world bounds/);
    assert.equal(await readFile(store.file("bounds"), "utf8"), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MCP updates and flow layout cannot commit overflowing geometry", async () => {
  const { createStoreBackend, runTool } = await import("./design-tools.mjs");
  const root = await mkdtemp(join(tmpdir(), "bounds-tools-"));
  try {
    const store = await DesignStore.open(root);
    await store.mutate("bounds", () =>
      doc([
        node("a", {
          shortId: "a",
          x: 999000,
          w: 500,
          layout: "flex",
          direction: "row",
          padding: 0,
          gap: 0,
        }),
      ]),
    );
    const backend = createStoreBackend(store);
    const bytes = await readFile(store.file("bounds"), "utf8");
    const result = await runTool(backend, "update_elements", {
      document: "bounds",
      pageId: "p",
      edit: '{/* edit a */}\n<div className="w-[2000px]" />',
    });
    assert.equal(result.isError, true, JSON.stringify(result));
    assert.match(result.content[0].text, /world bounds/);
    assert.equal(await readFile(store.file("bounds"), "utf8"), bytes);
    const flow = await runTool(backend, "update_elements", {
      document: "bounds",
      pageId: "p",
      edit: '{/* insert as last child of a */}\n<div className="w-[2000px] h-[100px] shrink-0" />',
    });
    assert.equal(flow.isError, true, JSON.stringify(flow));
    assert.match(flow.content[0].text, /world bounds/);
    assert.equal(await readFile(store.file("bounds"), "utf8"), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("free children start inside borders; flow coordinates already include borders", () => {
  const nodes = [
    node("a", { layout: "free", strokeWidth: 10 }),
    node("b", { parentId: "a", x: 20 }),
  ];
  assert.equal(pageWorldBounds({ nodes }).rects.get("b").x, 30);
  nodes[0].layout = "flex";
  assert.equal(pageWorldBounds({ nodes }).rects.get("b").x, 20);
});

test("out-of-range documents load, save and accept only non-worsening transactions", async () => {
  const { createStoreBackend } = await import("./design-tools.mjs");
  const root = await mkdtemp(join(tmpdir(), "bounds-legacy-"));
  try {
    const store = await DesignStore.open(root);
    const original = doc([node("a", { x: 700000 }), node("b", { parentId: "a", x: 400000 })]);
    await store.mutate("bounds", () => original);
    assert.deepEqual((await store.read("bounds")).document, original);
    const backend = createStoreBackend(store);
    const edit = (patch) =>
      backend.transact("bounds", (d) => {
        Object.assign(d.pages[0].nodes[0], patch);
        return { document: d };
      });
    await edit({ name: "Renamed" });
    await edit({ x: 650000 });
    const before = await readFile(store.file("bounds"), "utf8");
    await assert.rejects(edit({ x: 650001 }), /world bounds/);
    assert.equal(await readFile(store.file("bounds"), "utf8"), before);
    const current = await store.read("bounds");
    await store.update("bounds", current.revision, [
      { type: "update_node", pageId: "p", nodeId: "b", properties: { name: "Unrelated" } },
    ]);
    const next = await store.read("bounds");
    await assert.rejects(
      store.update("bounds", next.revision, [
        { type: "update_node", pageId: "p", nodeId: "b", properties: { x: 400001 } },
      ]),
      /world bounds/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("negative overflow and rotated corners follow the same edit policy", () => {
  const before = doc([
    node("a", { x: -900000, w: 1000000 }),
    node("b", { parentId: "a", x: -900000 }),
  ]);
  const after = structuredClone(before);
  after.pages[0].nodes[0].x += 100;
  assert.doesNotThrow(() => validateWorldBoundsChange(before, after));
  after.pages[0].nodes[0].x = -900001;
  assert.throws(() => validateWorldBoundsChange(before, after), /world bounds/);
  const within = doc([node("a", { x: 999900 })]);
  const rotated = structuredClone(within);
  rotated.pages[0].nodes[0].rotation = 45;
  assert.throws(() => validateWorldBoundsChange(within, rotated), /world bounds/);
});
