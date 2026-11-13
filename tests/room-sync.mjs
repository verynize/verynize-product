// web/room-sync.js: deterministic content digests, stale copy detection, rejection codes and the
// edits that wait with a held (rejected) batch.
import assert from "node:assert/strict";
import test from "node:test";
import "../web/room-sync.js";

const Sync = globalThis.VerynizeRoomSync;
const rect = (id, extra = {}) => ({ id, type: "rectangle", parentId: null, x: 0, y: 0, ...extra });

test("digests follow JSON values, not key order", () => {
  assert.equal(Sync.digest({ a: 1, b: [1, "x"] }), Sync.digest({ b: [1, "x"], a: 1 }));
  assert.equal(Sync.digest({ a: 1, b: undefined }), Sync.digest({ a: 1 }));
  assert.equal(Sync.digest([undefined]), Sync.digest([null]));
  assert.equal(Sync.digest(Number.NaN), Sync.digest(null));
  assert.notEqual(Sync.digest({ a: 1 }), Sync.digest({ a: "1" }));
  assert.notEqual(Sync.digest(["ab", "c"]), Sync.digest(["a", "bc"]));
  assert.notEqual(Sync.digest({ a: { b: 1 } }), Sync.digest({ a: { b: 2 } }));
  assert.match(Sync.digest({}), /^[0-9a-f]{16}$/);
  // JSON round trips keep the digest (what the room stores and sends).
  const page = { id: "p", name: "Page", nodes: [rect("a", { text: "héllo ✓" })] };
  assert.equal(Sync.pageDigest(page), Sync.pageDigest(JSON.parse(JSON.stringify(page))));
  // Settings leave out pages and the client's own keys.
  assert.equal(
    Sync.metaDigest({ name: "x", activePage: "p1", pages: [page] }),
    Sync.metaDigest({ name: "x", activePage: "p2", pages: null }),
  );
});

test("divergence: page list, node counts, digests and settings", () => {
  const doc = {
    name: "Board",
    pages: [
      { id: "p1", nodes: [rect("a"), rect("b"), rect("c")] },
      { id: "p2", nodes: [] },
    ],
  };
  const reply = {
    pages: [
      { id: "p1", nodes: 3 },
      { id: "p2", nodes: 4903 },
    ],
    digests: { p1: Sync.pageDigest(doc.pages[0]) },
    metaDigest: Sync.metaDigest(doc),
  };
  const unloaded = (id) => id === "p2";
  assert.equal(Sync.divergence(doc, reply, unloaded), null);
  assert.equal(Sync.divergence(doc, reply), "node count", "a loaded p2 would be stale");
  assert.equal(
    Sync.divergence(doc, { ...reply, pages: [...reply.pages, { id: "p3", nodes: 0 }] }, unloaded),
    "page list",
  );
  const moved = structuredClone(doc);
  moved.pages[0].nodes[1].x = 9;
  assert.equal(Sync.divergence(moved, reply, unloaded), "page content");
  assert.equal(Sync.divergence({ ...doc, name: "Other" }, reply, unloaded), "document settings");
  // Older servers send only the index: counts still apply, missing digests are not differences.
  assert.equal(Sync.divergence(moved, { pages: reply.pages }, unloaded), null);
  assert.equal(Sync.divergence(null, reply), "no document");
});

test("rejection codes decide, not the error text", () => {
  assert.equal(Sync.rejection({ code: "interrupted", tooLarge: true }), "interrupted");
  assert.equal(Sync.rejection({ code: "too_large", tooLarge: true }), "too_large");
  assert.equal(
    Sync.rejection({ reasons: [{ reason: "Embedded…", code: "too_large" }] }),
    "too_large",
  );
  assert.equal(Sync.rejection({ error: "This page exceeds the limit" }), null);
  assert.equal(Sync.rejection({ reasons: [{ reason: "Missing node" }] }), null);
  // Servers before codes: tooLarge alone.
  assert.equal(Sync.rejection({ tooLarge: true, error: "interrupted" }), "too_large");
  assert.equal(Sync.rejection({ code: null, tooLarge: true }), null);
});

test("only edits that build on a held batch wait with it", () => {
  const held = [
    { t: "add", page: "p1", id: "big", value: rect("big") },
    { t: "node", page: "p1", id: "a", key: "x", value: 5 },
  ];
  const ops = [
    { t: "node", page: "p1", id: "b", key: "y", value: 1 }, // unrelated
    { t: "node", page: "p1", id: "big", key: "x", value: 3 }, // edits held node
    { t: "add", page: "p1", id: "child", value: rect("child", { parentId: "big" }) }, // child of it
    { t: "node", page: "p1", id: "child", key: "w", value: 2 }, // chains
    { t: "node", page: "p1", id: "a", key: "x", value: 6 }, // later value of a held property
    { t: "node", page: "p1", id: "a", key: "y", value: 6 }, // other property: free
    { t: "nodeOrder", page: "p1", value: ["big", "a", "b"] }, // names held node
    { t: "remove", page: "p1", id: "b" },
  ];
  const { held: kept, free } = Sync.splitDependent(held, ops);
  assert.deepEqual(
    free.map((op) => `${op.t}:${op.id || ""}:${op.key || ""}`),
    ["node:b:y", "node:a:y", "remove:b:"],
  );
  assert.equal(kept.length, 5);
  const page = Sync.splitDependent(
    [{ t: "addPage", id: "p9", value: { id: "p9", nodes: [rect("q")] } }],
    [
      { t: "node", page: "p9", id: "q", key: "x", value: 1 },
      { t: "page", page: "p9", key: "name", value: "n" },
      { t: "pageOrder", value: ["p1", "p9"] },
      { t: "page", page: "p1", key: "name", value: "free" },
    ],
  );
  assert.equal(page.held.length, 3);
  assert.deepEqual(page.free, [{ t: "page", page: "p1", key: "name", value: "free" }]);
  const root = Sync.splitDependent(
    [{ t: "root", value: {} }],
    [{ t: "doc", key: "name", value: 1 }],
  );
  assert.equal(root.free.length, 0);
});
