const { _electron } = require(process.cwd() + "/node_modules/@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
(async () => {
  const profile = await fs.mkdtemp(os.tmpdir() + "/bounds-");
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1", VERYNIZE_LAUNCH_EDITOR: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  try {
    const p = await app.firstWindow();
    await waitForUiReady(p);
    await p.evaluate(() => {
      window.design.loadDocument({
        version: 2,
        name: "Bounds",
        tokens: {},
        activePage: "p",
        pages: [
          {
            id: "p",
            name: "Page",
            nodes: [
              {
                id: "root",
                type: "frame",
                name: "Root",
                x: 200000,
                y: -200000,
                w: 200,
                h: 200,
                layout: "free",
                padding: 0,
              },
              {
                id: "child",
                type: "rectangle",
                name: "Child",
                parentId: "root",
                x: 20,
                y: 20,
                w: 40,
                h: 40,
              },
            ],
          },
        ],
      });
      window.design.setCamera(-199900, 200100, 1);
    });
    await p.evaluate(() => {
      const d = window.design.getDocument();
      d.pages.push({ id: "empty-page", name: "Empty", nodes: [] });
      window.design.loadDocument(d);
      window.design.setActivePage("empty-page");
    });
    await p.waitForTimeout(150);
    assert.equal(await p.getByRole("button", { name: "Recenter page", exact: true }).count(), 0);
    await p.evaluate(() => window.design.setActivePage("p"));
    await p.getByRole("button", { name: "Recenter page", exact: true }).waitFor();
    const before = await p.evaluate(() => ({
      d: window.design.getDocument(),
      cam: window.design.getCamera(),
    }));
    await p.getByRole("button", { name: "Recenter page", exact: true }).click();
    const after = await p.evaluate(() => ({
      d: window.design.getDocument(),
      cam: window.design.getCamera(),
    }));
    assert.equal(after.d.pages[0].nodes[0].x, -100);
    assert.equal(after.d.pages[0].nodes[0].y, -100);
    assert.equal(after.d.pages[0].nodes[1].x, 20);
    assert.equal(after.cam.x + after.d.pages[0].nodes[0].x * after.cam.zoom, before.cam.x + 200000);
    assert.equal(after.cam.y + after.d.pages[0].nodes[0].y * after.cam.zoom, before.cam.y - 200000);
    await p
      .getByRole("button", { name: "Recenter page", exact: true })
      .waitFor({ state: "detached" });
    await p.evaluate(() => window.design.runCommand("edit.undo"));
    assert.deepEqual(await p.evaluate(() => window.design.getDocument()), before.d);
    await p.getByRole("button", { name: "Recenter page", exact: true }).waitFor();
    const result = await p.evaluate(() => {
      const before = JSON.stringify(window.design.getDocument());
      let error;
      try {
        window.design.updateNodes(["root"], { x: 999999 });
      } catch (e) {
        error = e.message;
      }
      return { error, same: before === JSON.stringify(window.design.getDocument()) };
    });
    assert.match(result.error, /world bounds/);
    assert.equal(result.same, true);
    // Loading an existing overflowing page is allowed; unrelated and improving edits save.
    await p.evaluate(() => {
      const d = window.design.getDocument();
      d.pages[0].nodes[0].x = 700000;
      d.pages[0].nodes[1].x = 400000;
      window.design.loadDocument(d);
      window.design.updateNodes(["root"], { name: "Immediately previous", x: 650000 });
    });
    const legacy = await p.evaluate(() => window.design.getDocument());
    await p.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("verynize-v2"))?.pages[0].nodes[0].name ===
        "Immediately previous",
    );
    const rejected = await p.evaluate(() => {
      try {
        window.design.updateNodes(["root"], { x: 650001 });
      } catch (e) {
        return e.message;
      }
    });
    assert.match(rejected, /world bounds/);
    assert.deepEqual(await p.evaluate(() => window.design.getDocument()), legacy);
    await p.evaluate(() => {
      window.design.setSelection(["root"]);
      window.design.runCommand("edit.duplicate");
    });
    assert.deepEqual(
      await p.evaluate(() => window.design.getDocument()),
      legacy,
      "duplicate rolls back to the immediate checkpoint",
    );
    // The legacy inspector checkpoint restores this edit, including unrelated recent state.
    await p.evaluate(() => {
      window.design.setSelection(["root"]);
      const input =
        document.querySelector('#properties [name="x"]') ||
        document.querySelector('form [name="x"]');
      input.value = "650002";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.deepEqual(await p.evaluate(() => window.design.getDocument()), legacy);
    await p.getByRole("button", { name: "Recenter page", exact: true }).click();
    await p.evaluate(() => window.design.runCommand("edit.undo"));
    assert.deepEqual(await p.evaluate(() => window.design.getDocument()), legacy);
    const scans = await p.evaluate(() => {
      let count = 0;
      const api = window.VerynizeDocument;
      const check = api.validateWorldBoundsChange,
        bounds = api.pageWorldBounds;
      api.validateWorldBoundsChange = (...args) => {
        count++;
        return check(...args);
      };
      api.pageWorldBounds = (...args) => {
        count++;
        return bounds(...args);
      };
      try {
        render();
        render();
        render();
        return count;
      } finally {
        api.validateWorldBoundsChange = check;
        api.pageWorldBounds = bounds;
      }
    });
    assert.equal(scans, 0, "render never scans world bounds");
    // Scalar repairs still load and remain saveable.
    const repaired = await p.evaluate(() => {
      const d = window.design.getDocument();
      d.pages[0].nodes[0].x = 2000000;
      return window.documentSafety.load(d).pages[0].nodes[0].x;
    });
    assert.equal(repaired, 1000000);
    // A real drag may cross the limit transiently; validate once, on release.
    const dragBefore = await p.evaluate(() => {
      const d = window.design.getDocument();
      d.pages[0].nodes = [
        { id: "drag", type: "rectangle", name: "Drag", x: 999800, y: 0, w: 100, h: 100 },
      ];
      window.design.loadDocument(d);
      window.design.setTool("move");
      window.design.setSelection(["drag"]);
      window.design.setCamera(-999700, 100, 1);
      window.boundsChecks = 0;
      const check = window.VerynizeDocument.validateWorldBoundsChange;
      window.VerynizeDocument.validateWorldBoundsChange = (...args) => {
        window.boundsChecks++;
        return check(...args);
      };
      return window.design.getDocument();
    });
    const target = await p.locator('#canvas [data-id="drag"]').boundingBox();
    await p.mouse.move(target.x + 50, target.y + 50);
    await p.mouse.down();
    await p.mouse.move(target.x + 250, target.y + 50, { steps: 8 });
    assert.equal(
      await p.evaluate(() => window.boundsChecks),
      0,
      "drag does not validate mid-gesture",
    );
    await p.mouse.up();
    assert.equal(await p.evaluate(() => window.boundsChecks), 1, "release validates exactly once");
    assert.deepEqual(await p.evaluate(() => window.design.getDocument()), dragBefore);
    assert.deepEqual(await p.evaluate(() => window.design.getSelection()), ["drag"]);
    console.log("canvas world bounds: PASS");
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
