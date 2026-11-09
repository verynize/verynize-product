const { test } = require("node:test");
const assert = require("node:assert/strict");
global.window = {};
require("../web/commit-state.js");
const state = window.VerynizeCommitState;
const make = (n = 5000) => ({
  version: 2,
  activePage: "a",
  pages: [
    {
      id: "a",
      nodes: Array.from({ length: n }, (_, i) => ({
        id: String(i),
        x: i,
        text: "retained text".repeat(30),
      })),
    },
    { id: "b", nodes: [{ id: "other", x: 1 }] },
  ],
});
test("one frozen snapshot shared across subscribers and isolated from live mutations", () => {
  const store = state.store(),
    doc = make(10),
    snapshot = store.get(doc);
  assert.equal(snapshot, store.get(doc));
  assert.ok(Object.isFrozen(snapshot.pages[0].nodes[0]));
  doc.pages[0].nodes[0].x = 42;
  assert.equal(snapshot.pages[0].nodes[0].x, 0);
  store.invalidate();
  assert.equal(store.get(doc).pages[0].nodes[0].x, 42);
});
test("170 revisions retain changed properties rather than whole pages", () => {
  let doc = make();
  const baseline = structuredClone(doc),
    history = [];
  for (let i = 0; i < 170; i++) {
    const before = structuredClone(doc);
    doc.pages[i % 2].nodes[0].x++;
    history.push(state.compact(before, doc));
  }
  assert.ok(JSON.stringify(history).length < 30000);
  const redo = [];
  while (history.length) {
    const applied = state.apply(history.pop(), doc);
    doc = applied.document;
    redo.push(applied.inverse);
  }
  assert.deepEqual(doc, baseline);
  while (redo.length) doc = state.apply(redo.pop(), doc).document;
  assert.equal(doc.pages[0].nodes[0].x, 85);
  assert.equal(doc.pages[1].nodes[0].x, 86);
});
test("patches roundtrip insertion, deletion, reorder, optional properties, page metadata", () => {
  const before = make(3),
    after = structuredClone(before);
  after.pages[0].nodes.splice(1, 1);
  after.pages[0].nodes.reverse();
  after.pages[1].name = "Renamed";
  delete after.activePage;
  const applied = state.apply(state.compact(JSON.stringify(before), after), after);
  assert.deepEqual(applied.document, before);
  const redone = state.apply(applied.inverse, applied.document).document;
  assert.equal(redone.activePage, undefined);
  assert.deepEqual(
    redone.pages[0].nodes.map((n) => n.id),
    ["2", "0"],
  );
  assert.equal(redone.pages[1].name, "Renamed");
});

test("structural edits retain only inserted/deleted nodes, not unchanged payloads", () => {
  const before = make(),
    after = structuredClone(before);
  after.pages[0].nodes.push({ id: "new", x: 9, text: "new" });
  after.pages[0].nodes[2].x = 22;
  const patch = state.compact(before, after);
  assert.ok(JSON.stringify(patch).length < 40000);
  const applied = state.apply(patch, after);
  assert.deepEqual(applied.document, before);
  const redone = state.apply(applied.inverse, applied.document).document;
  assert.equal(redone.pages[0].nodes.at(-1).id, "new");
  assert.equal(redone.pages[0].nodes[2].x, 22);
});

test("validated inactive pages defer defaults, invalid pages keep the eager safety path", async () => {
  await import("../integrations/document-core.mjs");
  window.VerynizeDocument = globalThis.VerynizeDocument;
  require("../web/lazy-document.js");
  const node = (id) => ({ id, name: id, type: "rectangle", x: 0, y: 0, w: 10, h: 10 });
  const doc = {
    version: 2,
    name: "Lazy",
    activePage: "a",
    tokens: {},
    pages: [
      { id: "a", name: "A", nodes: [node("a1")] },
      { id: "b", name: "B", nodes: [node("b1")] },
    ],
  };
  const prepared = window.VerynizeLazyDocument.prepare(doc, { opacity: 100 }, []);
  assert.equal(prepared.pages[0].nodes[0].opacity, 100);
  assert.equal(prepared.pages[1].nodes[0].opacity, undefined);
  const restored = structuredClone(prepared);
  restored.activePage = "b";
  window.VerynizeLazyDocument.activate(restored);
  assert.equal(restored.pages[1].nodes[0].opacity, 100);
  prepared.activePage = "b";
  window.VerynizeLazyDocument.activate(prepared);
  assert.equal(prepared.pages[1].nodes[0].opacity, 100);
  const broken = structuredClone(doc);
  broken.pages[1].nodes[0].type = "unknown";
  assert.throws(() => window.VerynizeLazyDocument.prepare(broken, {}, []), /Unsupported node type/);
});

test("a remote patch into a prepared page keeps the editor defaults and changes only what changed", async () => {
  await import("../integrations/document-core.mjs");
  window.VerynizeDocument = globalThis.VerynizeDocument;
  require("../web/lazy-document.js");
  require("../web/remote-apply.js");
  const Lazy = window.VerynizeLazyDocument;
  const node = (id) => ({ id, name: id, type: "rectangle", x: 0, y: 0, w: 10, h: 10 });
  const doc = (nodesB) => ({
    version: 2,
    name: "Remote",
    activePage: "a",
    tokens: {},
    pages: [
      { id: "a", name: "A", nodes: [node("a1")] },
      { id: "b", name: "B", nodes: nodesB },
    ],
  });
  // The editor visited page B (prepared), then returned to A.
  const editor = Lazy.prepare(doc([node("b1"), node("b2")]), { opacity: 100 }, []);
  editor.activePage = "b";
  Lazy.activate(editor);
  editor.activePage = "a";
  const kept = editor.pages[1].nodes[0];
  // A collaborator moves b2 and adds b3 on the inactive page B (as app.js applyRemote does).
  const moved = doc([node("b1"), { ...node("b2"), x: 5 }, node("b3")]);
  const next = Lazy.prepare(moved, { opacity: 100 }, []);
  assert.equal(next.pages[1].nodes[2].opacity, undefined, "the remote page is not prepared");
  Lazy.match(next, editor);
  const changed = new Set();
  const live = window.remoteApply.patch(editor, next, new Set(), changed);
  assert.deepEqual(
    [...changed].sort((a, b) => a.localeCompare(b)),
    ["b2", "b3"],
    "only what the collaborator changed",
  );
  assert.equal(live.pages[1], editor.pages[1], "page objects stay in place");
  assert.equal(live.pages[1].nodes[0], kept, "unchanged nodes stay in place");
  assert.deepEqual(
    live.pages[1].nodes.map((n) => [n.id, n.x, n.opacity]),
    [
      ["b1", 0, 100],
      ["b2", 5, 100],
      ["b3", 0, 100],
    ],
  );
});

test("a document shared in a room is prepared whole, before and after it loads", async () => {
  await import("../integrations/document-core.mjs");
  window.VerynizeDocument = globalThis.VerynizeDocument;
  require("../web/lazy-document.js");
  const Lazy = window.VerynizeLazyDocument;
  const node = (id) => ({ id, name: id, type: "rectangle", x: 0, y: 0, w: 10, h: 10 });
  const doc = () => ({
    version: 2,
    name: "Room",
    activePage: "a",
    tokens: {},
    pages: [
      { id: "a", name: "A", nodes: [node("a1")] },
      { id: "b", name: "B", nodes: [node("b1")] },
    ],
  });
  const opacities = (d) => d.pages.map((p) => p.nodes[0].opacity);
  // Open before joining: page B waits for its first activation, until the room prepares it.
  const open = Lazy.prepare(doc(), { opacity: 100 }, []);
  assert.deepEqual(opacities(open), [100, undefined]);
  Lazy.prepareAll(open);
  assert.deepEqual(opacities(open), [100, 100]);
  // While connected, every document the room loads is prepared whole.
  window.cloudWorkspace = { isConnected: () => true };
  try {
    assert.deepEqual(opacities(Lazy.prepare(doc(), { opacity: 100 }, [])), [100, 100]);
  } finally {
    delete window.cloudWorkspace;
  }
});

test("local geometry guard preserves existing overflow and rejects worsening overflow", async () => {
  await import("../integrations/document-core.mjs");
  window.VerynizeDocument = globalThis.VerynizeDocument;
  window.VerynizeComponents = { hasComponents: () => false };
  require("../web/node-index.js");
  require("../web/commit-validation.js");
  const before = {
    activePage: "p",
    pages: [
      {
        id: "p",
        nodes: [
          { id: "root", type: "frame", layout: "free", x: 999900, y: 0, w: 100, h: 100 },
          { id: "child", parentId: "root", x: 0, y: 0, w: 90, h: 90 },
        ],
      },
    ],
  };
  const after = structuredClone(before),
    target = after.pages[0].nodes[1];
  target.x = 11;
  assert.throws(
    () =>
      window.VerynizeCommitValidation.world(before, after, [before.pages[0].nodes[1]], [target]),
    /world bounds/,
  );
  target.x = 9;
  assert.doesNotThrow(() =>
    window.VerynizeCommitValidation.world(before, after, [before.pages[0].nodes[1]], [target]),
  );
  before.pages[0].nodes[1].x = 50;
  target.x = 49;
  assert.doesNotThrow(() =>
    window.VerynizeCommitValidation.world(before, after, [before.pages[0].nodes[1]], [target]),
  );
});

test("targeted node patches also include CSS layout read-back and fall back on structural changes", () => {
  const before = make(10),
    after = structuredClone(before);
  after.pages[0].nodes[0].text = "Changed";
  after.pages[0].nodes[1].w = 200;
  const entry = { before, page: "a", nodeEdit: ["0"] };
  const applied = state.apply(state.compact(entry, after), after);
  assert.deepEqual(applied.document, before);
  const inserted = structuredClone(before);
  inserted.pages[0].nodes.unshift({ id: "inserted", x: 1 });
  assert.deepEqual(state.apply(state.compact(entry, inserted), inserted).document, before);
});
