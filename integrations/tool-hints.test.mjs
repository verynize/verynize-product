import { NODE_LIMITS } from "./document-core.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { toolHints } from "./tool-hints.mjs";
const receipt = {
  documentRevision: "r",
  screenshot: { sha256: "hash", source: "live" },
  lint: { counts: { critical: 0 } },
};
const state = (extra) => ({
  page: { id: "p", nodes: [] },
  artboards: ["abc"],
  revision: "r",
  receiptFor: () => receipt,
  ...extra,
});
test("screenshot hint on for absent/stale/estimated receipts, off for current real screenshot", () => {
  assert.equal(toolHints(state()), "");
  for (const r of [
    null,
    { ...receipt, documentRevision: "old" },
    { ...receipt, screenshot: { source: "estimated" } },
  ])
    assert.match(toolHints(state({ receiptFor: () => r })), /take_screenshot/);
});
test("critical lint only uses current receipt, zero is silent", () => {
  const r = { ...receipt, lint: { counts: { critical: 2 } } };
  assert.match(toolHints(state({ receiptFor: () => r })), /2 critical/);
  assert.doesNotMatch(
    toolHints(state({ receiptFor: () => ({ ...r, documentRevision: "old" }) })),
    /critical/,
  );
  assert.equal(toolHints(state()), "");
});
test("pending/missing assets on, loaded assets off", () => {
  const page = {
    id: "p",
    nodes: [{ assetStatus: "pending" }, { assetStatus: "missing" }, { assetStatus: "ready" }],
  };
  assert.match(toolHints(state({ page })), /2 image/);
  assert.equal(toolHints(state({ page: { ...page, nodes: [{ assetStatus: "ready" }] } })), "");
});
test("node capacity threshold on/off and two-line deterministic cap", () => {
  const L = NODE_LIMITS.perPage,
    near = Math.ceil(L * 0.96),
    fmt = (n) => n.toLocaleString("en-US");
  assert.equal(
    toolHints(state({ page: { id: "p", nodes: Array(Math.floor(L * 0.9) - 1).fill({}) } })),
    "",
  );
  const s = state({
    page: { id: "p", nodes: Array(near).fill({ assetStatus: "pending" }) },
    receiptFor: () => null,
  });
  assert.match(toolHints(s), new RegExp(`${fmt(near)}/${fmt(L)}`));
  assert.equal(toolHints(s).split("\n").length, 2);
  assert.equal(toolHints(s), toolHints(s));
  assert.equal(toolHints(state({ receiptFor: () => null, omit: new Set(["screenshot"]) })), "");
});
test("far-origin advice follows the page bounds threshold", () => {
  const page = { id: "p", nodes: [{ id: "a", x: 99900, y: 0, w: 100, h: 100 }] };
  assert.equal(toolHints(state({ page })), "");
  page.nodes[0].x++;
  assert.match(toolHints(state({ page })), /Recenter page/);
});
