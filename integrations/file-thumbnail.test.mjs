// "Set as file thumbnail" (Wonder P4): `document.thumbnailNodeId` is validated by the headless store (with
// the shared schema in web/document-core.js), may dangle after its layer is deleted, and syncs through cloud rooms as a doc-level key.
import test from "node:test";
import assert from "node:assert/strict";
import { validateDocument, applyOperations } from "./design-store.mjs";
import "../web/cloud-ops.js";

const Ops = globalThis.VerynizeOps;
const doc = (extra = {}) => ({
  version: 2,
  name: "Thumb",
  tokens: {},
  activePage: "p1",
  pages: [
    {
      id: "p1",
      name: "Page 1",
      nodes: [
        { id: "card", type: "frame", name: "Card", x: 0, y: 0, w: 420, h: 391, parentId: null },
        {
          id: "label",
          type: "text",
          name: "Label",
          x: 59,
          y: 160,
          w: 60,
          h: 15,
          text: "Canvas au",
          parentId: "card",
        },
      ],
    },
  ],
  ...extra,
});

test("thumbnailNodeId is an optional non-empty string", () => {
  assert.equal(validateDocument(doc()).thumbnailNodeId, undefined);
  assert.equal(validateDocument(doc({ thumbnailNodeId: "card" })).thumbnailNodeId, "card");
  for (const bad of [5, "", null, {}, "x".repeat(201)])
    assert.throws(
      () => validateDocument(doc({ thumbnailNodeId: bad })),
      /file thumbnail/,
      JSON.stringify(bad),
    );
});

test("deleting the thumbnail layer keeps a valid (dangling) reference", () => {
  const after = applyOperations(doc({ thumbnailNodeId: "card" }), [
    { type: "delete_node", pageId: "p1", nodeId: "card" },
  ]);
  assert.equal(after.pages[0].nodes.length, 0);
  assert.equal(after.thumbnailNodeId, "card");
});

test("cloud rooms carry thumbnailNodeId as a doc-level operation", () => {
  const base = doc(),
    edited = doc({ thumbnailNodeId: "card" });
  const ops = Ops.diff(base, edited, { ignore: ["activePage"] });
  assert.deepEqual(ops, [{ t: "doc", key: "thumbnailNodeId", value: "card" }]);
  assert.equal(Ops.apply(base, ops).doc.thumbnailNodeId, "card");
  const cleared = Ops.diff(edited, base, { ignore: ["activePage"] });
  assert.equal(Ops.apply(edited, cleared).doc.thumbnailNodeId, undefined);
});
