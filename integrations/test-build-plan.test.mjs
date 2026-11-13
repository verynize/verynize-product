import assert from "node:assert/strict";
import test from "node:test";
import { testBuildPlan } from "../scripts/test-build-plan.mjs";
import { tests } from "../scripts/test-manifest.mjs";

const select = (...files) => tests.filter((entry) => files.includes(entry.file));

test("each Node web scenario requests a fresh shared bundle, even with --skip-build", () => {
  for (const file of ["tests/web-node.mjs", "tests/web-ai-chat.mjs", "tests/ai-routing.mjs"]) {
    const selected = select(file);
    assert.equal(selected.length, 1, `${file} remains registered`);
    assert.deepEqual(testBuildPlan(selected), { ui: true, worker: false, node: true });
    assert.deepEqual(testBuildPlan(selected, { skipBuild: true }), {
      ui: false,
      worker: false,
      node: true,
    });
  }
});

test("combined Node web scenarios prepare one bundle without losing the Worker requirement", () => {
  const selected = select(
    "tests/web-node.mjs",
    "tests/web-ai-chat.mjs",
    "tests/ai-routing.mjs",
  ).map((entry) => ({ ...entry, usesWorker: entry.file === "tests/ai-routing.mjs" }));
  assert.equal(selected.length, 3);
  assert.deepEqual(testBuildPlan(selected), { ui: true, worker: true, node: true });
});

test("unrelated lanes and Cloudflare-only web selections do not build the Node app", () => {
  assert.deepEqual(testBuildPlan([]), { ui: false, worker: false, node: false });
  assert.deepEqual(testBuildPlan(select("tests/agent-options.cjs")), {
    ui: false,
    worker: false,
    node: false,
  });
  assert.deepEqual(testBuildPlan(select("tests/preview-tab.cjs", "tests/web-cloudflare.mjs")), {
    ui: true,
    worker: false,
    node: false,
  });
});
