// Frame labels and large selections (docs/canvas-performance/fix-2-labels-selection.md): artboard name labels are placed
// from document geometry, keyed by frame id and culled to the viewport, yet sit exactly where the frame's laid-out box
// puts them after pans, zooms, edits, renames, rotation, hiding and deletion; all-node selection of 2,000 nodes stays
// fast and resolves to the right top-level set.
const { _electron } = require("@playwright/test");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-frame-labels-")),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${dir}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await moveOffCursor(app);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForSelector("#canvas .layer");
    const rect = (id, x, y, w = 100, h = 80, extra = {}) => ({
      id,
      name: id,
      type: "rectangle",
      x,
      y,
      w,
      h,
      color: "#8844cc",
      ...extra,
    });
    const frame = (id, x, y, w, h, extra = {}) => ({
      id,
      name: id,
      type: "frame",
      x,
      y,
      w,
      h,
      color: "#ffffff",
      layout: "free",
      ...extra,
    });
    async function seed(nodes) {
      await page.evaluate((nodes) => {
        const d = window.design.getDocument();
        d.pages = [{ id: d.pages[0].id, name: "Page 1", nodes }];
        d.activePage = d.pages[0].id;
        window.design.setDocument(d);
        window.design.setSelection([]);
        window.design.setTool("move");
        window.design.setCamera(40, 60, 1);
      }, nodes);
    }
    const camera = (x, y, zoom) =>
      page.evaluate(([x, y, zoom]) => window.design.setCamera(x, y, zoom), [x, y, zoom]);
    const update = (ids, patch) =>
      page.evaluate(([ids, patch]) => window.design.updateNodes(ids, patch), [ids, patch]);
    // Every label against the old layout-measured rule: a label sits 18px above the top-left of its frame's laid-out
    // (axis-aligned) box, for each visible, unhidden top-level frame (not the single selected one) whose label box
    // reaches into the viewport. Returns {id: [left, top]} of the labels drawn.
    async function checkLabels(message) {
      const result = await page.evaluate(() => {
        const wrap = document.querySelector("#canvas-wrap").getBoundingClientRect(),
          sel = new Set(window.design.getSelection());
        const doc = window.design.getDocument(),
          nodes = doc.pages.find((p) => p.id === doc.activePage).nodes,
          expected = {};
        for (const n of nodes) {
          if (
            n.parentId ||
            n.type !== "frame" ||
            n.hidden ||
            n.preview ||
            n.labelHidden ||
            (sel.size === 1 && sel.has(n.id))
          )
            continue;
          const r = document
            .querySelector(`#canvas [data-id="${CSS.escape(n.id)}"]`)
            ?.getBoundingClientRect();
          if (!r || (!r.width && !r.height)) continue;
          const left = r.left - wrap.left,
            top = r.top - wrap.top - 18;
          if (left >= wrap.width || left + 240 <= 0 || top >= wrap.height || top + 16 <= 0)
            continue;
          expected[n.id] = { left, top, name: n.name, selected: sel.has(n.id) };
        }
        const drawn = {};
        for (const label of document.querySelectorAll("#canvas-overlay .frame-labels > *")) {
          const r = label.getBoundingClientRect();
          drawn[label.dataset.id] = {
            left: r.left - wrap.left,
            top: r.top - wrap.top,
            name: label.textContent,
            selected: label.classList.contains("selected"),
            isLabel: label.classList.contains("frame-label"),
          };
        }
        return { expected, drawn };
      });
      assert.deepEqual(
        Object.keys(result.drawn).sort(),
        Object.keys(result.expected).sort(),
        `${message}: labelled frames`,
      );
      for (const [id, want] of Object.entries(result.expected)) {
        const got = result.drawn[id];
        assert.ok(got.isLabel, `${message}: ${id} is a .frame-label`);
        assert.equal(got.name, want.name, `${message}: ${id} name`);
        assert.equal(got.selected, want.selected, `${message}: ${id} selected mark`);
        assert.ok(
          Math.abs(got.left - want.left) <= 0.5 && Math.abs(got.top - want.top) <= 0.5,
          `${message}: ${id} at ${got.left},${got.top}, expected ${want.left},${want.top}`,
        );
      }
      return result.drawn;
    }

    // ---- Placement, culling and reuse across camera moves ----
    await seed([
      frame("home", 0, 0, 400, 300),
      rect("card", 20, 20, 100, 80, { parentId: "home" }),
      frame("tilt", 500, 40, 200, 120, { rotation: -30 }),
      frame("stack", 0, 400, 100, 100, {
        layout: "flex",
        direction: "row",
        wMode: "hug",
        rotation: 15,
        padding: 10,
      }),
      rect("item", 0, 0, 160, 40, { parentId: "stack" }),
      frame("bordered", 800, 0, 200, 150, { strokeWidth: 6, strokeColor: "#000000" }),
      frame("far", 6000, 4000, 300, 200),
      frame("quiet", 0, 700, 300, 200, { labelHidden: true }),
      frame("ghost", 400, 700, 300, 200, { hidden: true }),
    ]);
    let drawn = await checkLabels("initial view");
    assert.ok(
      drawn.home && drawn.tilt && drawn.stack && drawn.bordered,
      "frames in view are labelled",
    );
    assert.equal(drawn.far, undefined, "a frame far outside the view has no label");
    const tilt = await page.evaluate(
      () => document.querySelector("#canvas [data-id=tilt]").getBoundingClientRect().width,
    );
    assert.ok(tilt > 200, "the rotated frame is measured by its turned bounds");
    await page.evaluate(() => {
      window.__homeLabel = document.querySelector("#canvas-overlay .frame-label[data-id=home]");
    });
    for (const [x, y, zoom] of [
      [-120, 35, 1],
      [300, 200, 0.5],
      [-500, -260, 2],
      [10.5, 7.25, 1.37],
      [-5700, -3800, 1],
    ]) {
      await camera(x, y, zoom);
      await checkLabels(`camera ${x},${y} @${zoom}`);
    }
    drawn = await checkLabels("panned to the far frame");
    assert.ok(drawn.far, "panning a frame into view labels it");
    assert.equal(drawn.home, undefined, "and culls the ones that left");
    await camera(40, 60, 1);
    await checkLabels("back home");
    assert.equal(
      await page.evaluate(
        () =>
          document.querySelector("#canvas-overlay .frame-label[data-id=home]") ===
          window.__homeLabel,
      ),
      true,
      "labels are reused, not rebuilt",
    );

    // Wheel pans go through the same path as the camera API.
    const box = await page.locator("#canvas-wrap").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(37, 23);
    await page.waitForTimeout(50);
    await checkLabels("after a wheel pan");

    // ---- Edits, renames, selection, hiding and deletion ----
    await page.evaluate(() => window.design.setCamera(40, 60, 1));
    await update(["home"], { x: 33, y: -12 });
    await checkLabels("after moving a frame");
    await update(["tilt"], { rotation: 45, w: 260 });
    await checkLabels("after rotating and resizing");
    await update(["item"], { w: 260 });
    await checkLabels("after a hug frame grows with its child");
    await update(["home"], { name: "Home screen" });
    assert.equal(
      await page.locator("#canvas-overlay .frame-label[data-id=home]").textContent(),
      "Home screen",
      "a rename relabels the frame",
    );
    await checkLabels("after a rename");
    await page.evaluate(() => window.design.setSelection(["home"]));
    assert.equal(
      await page.locator("#canvas-overlay .frame-label[data-id=home]").count(),
      0,
      "a single selected frame shows the selection name instead",
    );
    await checkLabels("one frame selected");
    await page.evaluate(() => window.design.setSelection(["home", "tilt"]));
    drawn = await checkLabels("two frames selected");
    assert.ok(
      drawn.home.selected && drawn.tilt.selected && !drawn.bordered.selected,
      "selected frames mark their labels",
    );
    await update(["bordered"], { labelHidden: true });
    await checkLabels("after hiding a label");
    await update(["bordered"], { labelHidden: undefined, hidden: true });
    await checkLabels("after hiding a frame");
    await page.evaluate(() => {
      window.design.setSelection(["tilt"]);
      window.design.runCommand("edit.delete");
    });
    assert.equal(
      await page.evaluate(() =>
        window.design.getDocument().pages[0].nodes.some((n) => n.id === "tilt"),
      ),
      false,
      "the frame is deleted",
    );
    drawn = await checkLabels("after deleting a frame");
    assert.equal(drawn.tilt, undefined, "its label is gone");
    await page.locator("#undo").evaluate((b) => b.click());
    await checkLabels("after undoing the delete");

    // A label still selects and drags its frame.
    await page.evaluate(() => window.design.setSelection([]));
    const label = await page.locator("#canvas-overlay .frame-label[data-id=stack]").boundingBox();
    const before = await page.evaluate(
      () => window.design.getDocument().pages[0].nodes.find((n) => n.id === "stack").x,
    );
    await page.mouse.move(label.x + 4, label.y + label.height / 2);
    await page.mouse.down();
    await page.mouse.move(label.x + 34, label.y + label.height / 2, { steps: 4 });
    await page.mouse.up();
    assert.deepEqual(
      await page.evaluate(() => window.design.getSelection()),
      ["stack"],
      "the label selects its frame",
    );
    assert.ok(
      Math.abs(
        (await page.evaluate(
          () => window.design.getDocument().pages[0].nodes.find((n) => n.id === "stack").x,
        )) -
          before -
          30,
      ) <= 1,
      "dragging the label moves the frame",
    );
    await page.evaluate(() => window.design.setSelection([]));
    await checkLabels("after dragging by the label");

    // ---- All-node selection: 2,000 nodes, 100 artboards with nested frames ----
    const big = [];
    for (let f = 0; f < 100; f++) {
      const id = "f" + f;
      big.push(frame(id, (f % 10) * 700, Math.floor(f / 10) * 600, 600, 500));
      big.push(frame(id + "-g", 20, 20, 300, 300, { parentId: id }));
      big.push(frame(id + "-g-g", 10, 10, 200, 200, { parentId: id + "-g" }));
      for (let k = 0; k < 17; k++)
        big.push(
          rect(`${id}-r${k}`, 5 + k * 3, 5 + k * 2, 40, 30, {
            parentId: k < 6 ? id : k < 12 ? id + "-g" : id + "-g-g",
          }),
        );
    }
    assert.equal(big.length, 2000);
    await seed(big);
    const timing = await page.evaluate(() => {
      const ids = window.design
          .getDocument()
          .pages[0].nodes.map((n) => n.id)
          .reverse(),
        t = performance.now();
      window.design.setSelection(ids);
      return { ms: performance.now() - t, selected: window.design.getSelection().length };
    });
    console.log(`all-node selection of 2,000 nodes: ${timing.ms.toFixed(1)} ms`);
    assert.equal(timing.selected, 2000, "every node is selected");
    assert.ok(
      timing.ms < 2000,
      `selecting 2,000 nodes takes ${timing.ms.toFixed(1)} ms (budget 2,000 ms)`,
    );
    // The top-level set: the multi-selection box spans exactly the 100 artboards, and a move of the whole selection moves
    // only them (descendants travel with their parents).
    const union = await page.evaluate(() => {
      const wrap = document.querySelector("#canvas-wrap").getBoundingClientRect(),
        u = document.querySelector("#canvas-overlay .selection-union").getBoundingClientRect(),
        c = window.design.getCamera();
      return {
        x: (u.left - wrap.left - c.x) / c.zoom,
        y: (u.top - wrap.top - c.y) / c.zoom,
        w: u.width / c.zoom,
        h: u.height / c.zoom,
      };
    });
    for (const [k, v] of Object.entries({ x: 0, y: 0, w: 9 * 700 + 600, h: 9 * 600 + 500 }))
      assert.ok(Math.abs(union[k] - v) <= 1, `selection box ${k} ${union[k]} ~= ${v}`);
    const moved = await page.evaluate(() =>
      window.design.moveNodes(window.design.getSelection(), null, "inside"),
    );
    assert.deepEqual(
      [...moved].sort(),
      big
        .filter((n) => !n.parentId)
        .map((n) => n.id)
        .sort(),
      "the top-level selection is the 100 artboards",
    );
    const parents = await page.evaluate(() =>
      Object.fromEntries(
        window.design.getDocument().pages[0].nodes.map((n) => [n.id, n.parentId || null]),
      ),
    );
    for (const n of big)
      assert.equal(parents[n.id], n.parentId || null, `${n.id} keeps its parent`);
    // Selection API: unknown ids are dropped, the given order is kept.
    assert.deepEqual(
      await page.evaluate(() => {
        window.design.setSelection(["nope", "f1-r3", "f0"]);
        return window.design.getSelection();
      }),
      ["f1-r3", "f0"],
    );
    await checkLabels("large document");

    assert.deepEqual(errors, [], "no page errors");
    console.log("canvas frame labels and indexed selection ok");
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
