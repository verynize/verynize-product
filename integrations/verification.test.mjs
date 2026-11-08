import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createReceipt,
  isReceiptValid,
  ReceiptStore,
  finishGate,
  MAX_REPAIRS,
} from "./verification.mjs";
import { lintArtboard } from "./design-lint.mjs";

const revisionOf = (document) =>
  createHash("sha256").update(JSON.stringify(document)).digest("hex");
const shot = (source = "live") => ({ sha256: "f".repeat(64), width: 400, height: 300, source });
const lintOf = (critical = 0) => ({
  problems: Array.from({ length: critical }, (_, i) => ({
    id: `contrast:art.t${i}`,
    severity: "critical",
    rule: "contrast",
  })),
  stats: { critical, major: 0, minor: 0, geometry: "measured" },
});
const receipt = (props = {}) =>
  createReceipt({
    documentRevision: "rev1",
    pageId: "p",
    artboardId: "art",
    screenshot: shot(),
    lint: lintOf(),
    reviewNote: "Hierarchy reads well; fixed contrast on footer.",
    ...props,
  });

test("createReceipt validates input, freezes and stores lint compactly", () => {
  assert.throws(() => createReceipt({ artboardId: "art" }), /documentRevision/);
  const r = receipt({ lint: lintOf(2) });
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.screenshot));
  assert.deepEqual(r.lint.critical, ["contrast:art.t0", "contrast:art.t1"]);
  assert.equal(r.lint.counts.critical, 2);
  assert.equal(r.reviewNote, "Hierarchy reads well; fixed contrast on footer.");
});

test("isReceiptValid binds to the revision and a real screenshot", () => {
  assert.equal(isReceiptValid(receipt(), "rev1"), true);
  assert.equal(isReceiptValid(receipt(), "rev2"), false);
  assert.equal(isReceiptValid(null, "rev1"), false);
  assert.equal(isReceiptValid(receipt({ screenshot: null }), "rev1"), false);
  assert.equal(isReceiptValid(receipt({ screenshot: shot("headless-estimate") }), "rev1"), false);
});

test("ReceiptStore records, invalidates and counts repairs per (document, artboard)", () => {
  const store = new ReceiptStore();
  const a = store.record("doc", receipt()),
    b = store.record("doc", receipt({ artboardId: "bok" })),
    c = store.record("other", receipt());
  assert.equal(store.latest("doc", "art"), a);
  assert.equal(store.latest(null, "art"), null);
  store.invalidate("doc", "art");
  assert.equal(store.latest("doc", "art"), null);
  assert.equal(store.latest("doc", "bok"), b);
  assert.deepEqual(store.repairBudget("doc", "art"), {
    used: 1,
    max: MAX_REPAIRS,
    remaining: 2,
    exhausted: false,
  });
  store.invalidate("doc", "art"); // no receipt to invalidate: not a review→repair iteration
  assert.equal(store.repairBudget("doc", "art").used, 1);
  store.invalidate("doc");
  assert.equal(store.latest("doc", "bok"), null);
  assert.equal(
    store.repairBudget("doc", "bok").used,
    0,
    "document-wide invalidation does not count repairs",
  );
  assert.equal(store.latest("other", "art"), c);
  store.recordRepair("doc", "art");
  store.recordRepair("doc", "art");
  assert.equal(store.repairBudget("doc", "art").exhausted, true);
  store.reset("doc", "art");
  assert.equal(store.repairBudget("doc", "art").used, 0);
});

test("finishGate: verified, unverified and blocked outcomes", () => {
  assert.deepEqual(finishGate({ receipt: receipt(), currentRevision: "rev1", lint: lintOf() }), {
    status: "verified",
    reasons: [],
    allowFinish: true,
    critical: [],
  });
  const none = finishGate({ receipt: null, currentRevision: "rev1", lint: lintOf() });
  assert.equal(none.status, "unverified");
  assert.match(none.reasons[0], /no verification receipt/);
  assert.match(
    finishGate({ receipt: receipt(), currentRevision: "rev2", lint: lintOf() }).reasons.join(),
    /stale receipt/,
  );
  assert.match(
    finishGate({ receipt: receipt({ screenshot: null }), currentRevision: "rev1" }).reasons.join(),
    /screenshot unavailable/,
  );
  assert.match(
    finishGate({
      receipt: receipt({ screenshot: shot("headless") }),
      currentRevision: "rev1",
    }).reasons.join(),
    /not a real render/,
  );
  assert.match(
    finishGate({ receipt: receipt({ reviewNote: "  " }), currentRevision: "rev1" }).reasons.join(),
    /no design-review note/,
  );
  assert.match(
    finishGate({ receipt: receipt(), currentRevision: "rev1", artboardId: "bok" }).reasons.join(),
    /belongs to artboard art/,
  );
  const blocked = finishGate({ receipt: receipt(), currentRevision: "rev1", lint: lintOf(2) });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.allowFinish, false);
  assert.match(blocked.reasons[0], /2 critical lint problems/);
  // Without a current lint the receipt's stored criticals still block.
  assert.equal(
    finishGate({ receipt: receipt({ lint: lintOf(1) }), currentRevision: "rev1" }).status,
    "blocked",
  );
  assert.equal(
    finishGate({ receipt: null, currentRevision: "rev1", lint: lintOf(1) }).status,
    "blocked",
  );
});

test("finishGate: exhausted repair budget allows an honest unverified finish", () => {
  const budget = { used: 3, max: 3, remaining: 0, exhausted: true };
  const r = finishGate({ receipt: receipt(), currentRevision: "rev1", lint: lintOf(1), budget });
  assert.equal(r.status, "unverified");
  assert.equal(r.allowFinish, true);
  assert.equal(r.reasons[0], "repair budget exhausted");
  assert.equal(r.critical.length, 1);
  assert.equal(
    finishGate({ receipt: receipt(), currentRevision: "rev1", lint: lintOf(), budget }).status,
    "verified",
  );
  assert.equal(
    finishGate({ receipt: null, currentRevision: "rev1", lint: lintOf(), budget }).reasons[0],
    "repair budget exhausted",
  );
});

test("end to end: edits make receipts stale and count against the repair budget", () => {
  const document = {
    version: 2,
    name: "d",
    activePage: "p",
    tokens: {},
    pages: [
      {
        id: "p",
        name: "P",
        nodes: [
          {
            id: "art",
            shortId: "art",
            type: "frame",
            parentId: null,
            x: 0,
            y: 0,
            w: 400,
            h: 300,
            color: "#ffffff",
            layout: "free",
          },
          {
            id: "txt",
            shortId: "txt",
            type: "text",
            parentId: "art",
            x: 20,
            y: 20,
            w: 300,
            h: 19,
            text: "Quarterly revenue",
            color: "#bbbbbb",
            fontSize: 16,
            lineHeight: 1.15,
          },
        ],
      },
    ],
  };
  const store = new ReceiptStore();
  const review = () => {
    const lint = lintArtboard(document, "p", "art");
    store.record(
      "d",
      createReceipt({
        documentRevision: revisionOf(document),
        pageId: "p",
        artboardId: "art",
        screenshot: shot(),
        lint,
        reviewNote: "Checked.",
      }),
    );
    return lint;
  };
  let lint = review();
  let gate = finishGate({
    receipt: store.latest("d", "art"),
    currentRevision: revisionOf(document),
    lint,
    budget: store.repairBudget("d", "art"),
  });
  assert.equal(gate.status, "blocked");
  assert.equal(gate.critical[0].rule, "contrast");
  for (let i = 0; i < MAX_REPAIRS; i++) {
    document.pages[0].nodes[1].color = ["#aaaaaa", "#a8a8a8", "#a0a0a0"][i];
    store.invalidate("d", "art");
    assert.match(
      finishGate({
        receipt: store.latest("d", "art"),
        currentRevision: revisionOf(document),
        lint: lintArtboard(document, "p", "art"),
        budget: store.repairBudget("d", "art"),
      }).reasons.join(),
      /no verification receipt/,
    );
    lint = review();
  }
  gate = finishGate({
    receipt: store.latest("d", "art"),
    currentRevision: revisionOf(document),
    lint,
    budget: store.repairBudget("d", "art"),
  });
  assert.equal(gate.status, "unverified");
  assert.equal(gate.reasons[0], "repair budget exhausted");
  const stale = store.latest("d", "art");
  document.pages[0].nodes[1].color = "#222222";
  assert.equal(isReceiptValid(stale, revisionOf(document)), false);
  gate = finishGate({
    receipt: stale,
    currentRevision: revisionOf(document),
    lint: lintArtboard(document, "p", "art"),
    budget: store.repairBudget("d", "art"),
  });
  assert.deepEqual(
    [gate.status, gate.reasons.slice(0, 2)],
    [
      "unverified",
      ["repair budget exhausted", "stale receipt: the document changed after the last screenshot"],
    ],
  );
  review();
  assert.equal(
    finishGate({
      receipt: store.latest("d", "art"),
      currentRevision: revisionOf(document),
      lint: lintArtboard(document, "p", "art"),
      budget: store.repairBudget("d", "art"),
    }).status,
    "verified",
  );
});
