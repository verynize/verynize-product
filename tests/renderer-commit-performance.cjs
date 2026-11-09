// oxlint-disable typescript/unbound-method -- instrumentation restores originals and invokes methods with their receiver
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { synthetic } = require("../eval/canvas-perf/bench-verynize.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
(async () => {
  const profile = await fs.mkdtemp(`${os.tmpdir()}/verynize-commit-perf-`);
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1", VERYNIZE_LAUNCH_EDITOR: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await waitForUiReady(page);
    await page.evaluate(() => window.fileLibrary.ready());
    await page.evaluate((doc) => window.design.loadDocument(doc), synthetic(5000));
    const result = await page.evaluate(async () => {
      const api = window.design;
      let clones = 0,
        rects = 0,
        writes = 0;
      const clone = window.structuredClone,
        rect = Element.prototype.getBoundingClientRect;
      const put = Storage.prototype.setItem;
      window.structuredClone = (v, ...args) => {
        if (v?.pages) clones++;
        return clone(v, ...args);
      };
      Storage.prototype.setItem = function (k, v) {
        if (k === "verynize-library-v1") writes++;
        return put.call(this, k, v);
      };
      const seen = [];
      const off = [api.subscribe((doc) => seen.push(doc)), api.subscribe((doc) => seen.push(doc))];
      api.updateNodes(["n1"], { color: "#ab3456" });
      const commitClones = clones;
      let rejected = 0;
      for (const patch of [{ opacity: 101 }, { parentId: "missing" }, { x: 1000001 }]) {
        try {
          api.updateNodes(["n1"], patch);
        } catch {
          rejected++;
        }
      }
      const shared = seen[0] === seen[1] && Object.isFrozen(seen[0].pages[0].nodes[0]);
      off.forEach((fn) => fn());
      Element.prototype.getBoundingClientRect = function () {
        rects++;
        return rect.call(this);
      };
      const originalLayer = document.querySelector('#canvas [data-id="n1"]');
      const start = performance.now();
      api.setSelection(api.getSnapshot().pages[0].nodes.map((n) => n.id));
      const syncMs = performance.now() - start;
      const selectionRects = rects;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rows = document.querySelectorAll("#bd-layer-tree .layer-row").length;
      api.setSelection([]);
      const retained = originalLayer === document.querySelector('#canvas [data-id="n1"]');
      window.structuredClone = clone;
      Element.prototype.getBoundingClientRect = rect;
      Storage.prototype.setItem = put;
      await window.fileLibrary.flush();
      return { commitClones, shared, syncMs, selectionRects, rows, retained, writes, rejected };
    });
    assert.equal(result.commitClones, 1);
    assert.ok(result.shared);
    assert.equal(result.rejected, 3);
    assert.ok(result.selectionRects <= 4, JSON.stringify(result));
    assert.ok(result.syncMs < 1500, JSON.stringify(result)); // tolerates slow CI, catches multi-second layout thrash
    assert.ok(result.rows <= 60);
    assert.ok(result.retained);
    assert.equal(result.writes, 0);
    const migration = await page.evaluate(async () => {
      const legacy = {
        files: [
          { id: "good", name: "Good", document: window.design.getSnapshot() },
          { id: "broken", name: "Broken", document: { original: "must be retained" } },
        ],
        folders: [],
        active: "good",
      };
      const name = "migration-" + crypto.randomUUID();
      const errors = [];
      const storage = window.VerynizeLibraryStorage.create((e) => errors.push(String(e)), name);
      await storage.load(legacy);
      const updated = {
        ...legacy,
        files: legacy.files.map((f) => (f.id === "good" ? { ...f, name: "Renamed" } : f)),
      };
      const original = IDBObjectStore.prototype.put;
      const keys = [];
      IDBObjectStore.prototype.put = function (value, key) {
        keys.push(key);
        return original.call(this, value, key);
      };
      storage.schedule(updated);
      await storage.flush();
      IDBObjectStore.prototype.put = original;
      const reopened = window.VerynizeLibraryStorage.create((e) => errors.push(String(e)), name);
      const stored = await reopened.load({ files: [], folders: [] });
      return {
        keys,
        errors,
        names: stored.files.map((f) => f.name),
        broken: stored.files[1].document,
      };
    });
    assert.deepEqual(migration.errors, []);
    assert.deepEqual(migration.keys, ["file:good", "meta"]);
    assert.deepEqual(migration.names, ["Renamed", "Broken"]);
    assert.deepEqual(migration.broken, { original: "must be retained" });
    // A full render in the middle of a drag must not finalize its undo patch early.
    await page.evaluate((doc) => {
      window.design.loadDocument(doc);
      window.design.setCamera(40, 60, 1);
      window.design.setSelection(["n0"]);
    }, synthetic(1));
    const beforeDrag = await page.evaluate(() => window.design.getDocument().pages[0].nodes[0]);
    const layer = await page.locator('#canvas [data-id="n0"]').boundingBox();
    assert.ok(layer);
    const center = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 50, center.y + 20, { steps: 4 });
    await page.evaluate(() => window.render());
    await page.mouse.move(center.x + 90, center.y + 40, { steps: 4 });
    await page.mouse.up();
    const moved = await page.evaluate(() => window.design.getDocument().pages[0].nodes[0]);
    assert.notEqual(moved.x, beforeDrag.x);
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    assert.deepEqual(
      await page.evaluate(() => window.design.getDocument().pages[0].nodes[0]),
      beforeDrag,
    );
    console.log("PASS renderer commit, selection and IndexedDB migration", JSON.stringify(result));
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
