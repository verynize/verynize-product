const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
(async () => {
  const profile = await fs.mkdtemp(os.tmpdir() + "/switch-cache-");
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await waitForUiReady(page);
    const result = await page.evaluate(async () => {
      const events = [];
      window.addEventListener("switch-loading-change", (e) => events.push(e.detail.phase));
      const doc = window.design.getDocument();
      doc.pages.push({ id: "second", name: "Second", nodes: [] });
      const a = await window.fileLibrary.createFromDocument({ ...doc, name: "A" });
      const b = await window.fileLibrary.createFromDocument({ ...doc, name: "B" });
      window.switchCache.clear();
      const timings = [];
      for (const id of [a, b, a, b]) {
        const start = performance.now();
        await window.fileLibrary.open(id);
        timings.push(performance.now() - start);
      }
      events.length = 0;
      const stringify = JSON.stringify;
      let targetSerializations = 0;
      JSON.stringify = function (value, ...args) {
        if (value?.name === "A" && Array.isArray(value.pages)) {
          if (new Error().stack.split("\n")[2].includes("/wonder-shell.js:"))
            targetSerializations++;
        }
        return stringify.call(JSON, value, ...args);
      };
      try {
        await window.fileLibrary.open(a);
      } finally {
        JSON.stringify = stringify;
      }
      const fileEvents = events.splice(0);
      await window.fileLibrary.open(b);
      events.length = 0;
      window.design.setActivePage("second");
      const pageEvents = events.splice(0);
      await window.fileLibrary.open(b);
      const noop = events.splice(0);
      const before = JSON.stringify(window.design.getDocument()),
        undo = window.design.canUndo();
      let notifications = 0;
      const off = window.design.subscribe(() => notifications++);
      const restore = window.design.presentDocument({ ...doc, name: "Provisional" });
      restore();
      off();
      const unchanged =
        before === JSON.stringify(window.design.getDocument()) && undo === window.design.canUndo();
      for (let i = 0; i < 12; i++) window.switchCache.put("test-" + i, doc);
      const stats = window.switchCache.stats();
      const first = window.switchCoordinator.begin({ kind: "file" }),
        second = window.switchCoordinator.begin({ kind: "file" });
      window.switchCoordinator.finish(first);
      const superseded =
        window.switchCoordinator.getState().token === second &&
        window.switchCoordinator.getState().phase === "begin";
      window.switchCoordinator.cancel(second);
      return {
        fileEvents,
        targetSerializations,
        pageEvents,
        noop,
        unchanged,
        notifications,
        stats,
        superseded,
        timings,
      };
    });
    assert.equal(
      result.targetSerializations,
      0,
      "warm incoming document is not reserialized by library synchronization",
    );
    assert.deepEqual(result.fileEvents, ["begin", "ready", "end"]);
    assert.deepEqual(result.pageEvents, ["begin", "ready", "end"]);
    assert.deepEqual(result.noop, []);
    assert.equal(result.unchanged, true);
    assert.equal(result.notifications, 0);
    assert.equal(result.superseded, true);
    assert.ok(result.stats.localHits > 0);
    assert.equal(result.stats.entries, 8);
    assert.ok(result.stats.evictions >= 4);
    assert.ok(result.stats.bytes <= result.stats.maxBytes);
    console.log("Local switch milliseconds (cold A/B, warm A/B):", result.timings);
    console.log("switch-cache passed");
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
