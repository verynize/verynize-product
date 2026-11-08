// "Use as mask" (Wonder canvas audit P5, CM5-multi-verified): offered for two or more sibling layers; the bottom-most
// sibling becomes a shape mask (inset() of each other layer's box) on every other selected sibling and disappears,
// without a wrapper, in one undo step.
// The mask clips the canvas pixels; the inspector shows it as an inset() row; "Detach mask as shape" recreates the
// geometry as a white Frame below the layer and "Remove mask" only clears it (menu and inspector, each undoable).
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "use-as-mask-"));
  const env = { ...process.env };
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
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForSelector("#canvas .layer");
    await page.waitForSelector("#bd-layer-tree");
    const nodes = () =>
      page.evaluate(() => {
        const d = window.design.getDocument();
        return d.pages.find((p) => p.id === d.activePage).nodes;
      });
    const node = async (id) => (await nodes()).find((n) => n.id === id);
    const selection = () => page.evaluate(() => window.design.getSelection());
    const select = (ids) => page.evaluate((ids) => window.design.setSelection(ids), ids);
    const undo = () => page.evaluate(() => window.design.runCommand("edit.undo"));
    const frame = (id, x, y, w, h, color, extra = {}) => ({
      id,
      name: id,
      type: "frame",
      x,
      y,
      w,
      h,
      color,
      layout: "free",
      ...extra,
    });
    async function seed(list) {
      await page.keyboard.press("Escape");
      await page.evaluate((list) => {
        const d = window.design.getDocument();
        d.pages = [{ id: "p1", name: "Page 1", nodes: list }];
        d.activePage = "p1";
        window.design.setDocument(d);
        window.design.setSelection([]);
        window.design.setTool("move");
        window.design.setCamera(80, 80, 1);
      }, list);
      await page.waitForTimeout(150);
    }
    const items = () =>
      page
        .locator("#canvas-menu")
        .evaluate((menu) =>
          [...menu.querySelectorAll("[role=menuitem], [role=separator]")].map((el) =>
            el.getAttribute("role") === "separator"
              ? "|"
              : el.querySelector("span").textContent.trim(),
          ),
        );
    const item = (command) =>
      page.locator(`[data-bd-context-menu] [data-command="${command}"]`).first();
    const box = (id) => page.locator(`#canvas [data-id="${id}"]`).boundingBox();
    const rightClick = async (id, fx = 0.5, fy = 0.5) => {
      const r = await box(id);
      await page.mouse.click(r.x + r.width * fx, r.y + r.height * fy, { button: "right" });
      await page.waitForSelector("#canvas-menu");
    };
    const close = async () => {
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-bd-context-menu]", { state: "detached" });
    };
    const menuAfterLayout = async () => {
      const list = await items();
      // Up to the closing group ("|", Set as file thumbnail).
      const rest = list.slice(list.lastIndexOf("Layout") + 1);
      return rest.includes("|") ? rest.slice(0, rest.indexOf("|")) : rest;
    };
    // One rendered pixel at a window point (CSS px), as [r, g, b].
    const pixel = async (x, y) => {
      await page.waitForTimeout(120);
      return app.evaluate(
        async ({ BrowserWindow }, [x, y]) => {
          const win = BrowserWindow.getAllWindows()[0];
          const img = await win.webContents.capturePage({
            x: Math.round(x),
            y: Math.round(y),
            width: 1,
            height: 1,
          });
          const b = img.toBitmap();
          return [b[2], b[1], b[0]];
        },
        [x, y],
      );
    };
    const near = (actual, expected, label) =>
      assert.ok(
        actual.every((v, i) => Math.abs(v - expected[i]) <= 16),
        `${label}: got ${actual}, want ${expected}`,
      );
    // Display colour management shifts channels, so reference colours are sampled from the screen.

    // Wonder's fixture: a 200×200 coloured frame under a centred 100×100 white frame, plus unrelated layers.
    const FIXTURE = [
      frame("source", 100, 100, 200, 200, "#f3df84"),
      frame("target", 150, 150, 100, 100, "#ffffff"),
      frame("art", 400, 0, 300, 300, "#333333"),
      {
        id: "kid",
        name: "kid",
        type: "rectangle",
        parentId: "art",
        x: 20,
        y: 20,
        w: 50,
        h: 50,
        color: "#8844cc",
      },
    ];
    await seed(FIXTURE);
    const page0 = await box("source");
    const outside = [page0.x + 20, page0.y + 20]; // inside the source, outside the target
    const YELLOW = await pixel(...outside);
    assert.ok(YELLOW[2] < YELLOW[0] - 60, `the source paints before the conversion (${YELLOW})`);

    // The item needs two or more siblings.
    for (const [ids, label] of [
      [["target"], "a single layer"],
      [["target", "kid"], "layers with different parents"],
      [["source", "target", "kid"], "three layers, one with another parent"],
    ]) {
      await select(ids);
      await rightClick(ids[0] === "kid" ? "kid" : "target");
      if ((await selection()).length !== ids.length) await select(ids);
      assert.ok(!(await items()).includes("Use as mask"), `no Use as mask for ${label}`);
      await close();
    }
    await select(["source", "target"]);
    await rightClick("target");
    assert.deepEqual((await selection()).toSorted(), ["source", "target"]);
    assert.deepEqual(
      await menuAfterLayout(),
      ["Use as mask"],
      "Use as mask follows Layout in the same group",
    );
    const list = await items();
    assert.equal(list[list.indexOf("Layout") - 1], "|");
    const before = (await nodes()).length;
    await item("menu.useAsMask").click();

    // The bottom sibling is consumed; no wrapper; the top sibling carries the mask and stays selected.
    let all = await nodes();
    assert.equal(all.length, before - 1);
    assert.equal(
      all.find((n) => n.id === "source"),
      undefined,
      "the bottom sibling is removed",
    );
    const target = all.find((n) => n.id === "target");
    assert.deepEqual(target.masks, [{ type: "shape", shape: "inset(-50% -50% -50% -50%)" }]);
    assert.equal(target.parentId ?? null, null, "no wrapper or group");
    assert.deepEqual([target.x, target.y, target.w, target.h], [150, 150, 100, 100]);
    assert.deepEqual(await selection(), ["target"]);
    assert.equal(
      await page
        .locator('#bd-layer-tree [data-layer-id="source"], #bd-layer-tree [data-id="source"]')
        .count(),
      0,
    );
    await page.waitForSelector("#mask-section [name=mask-0-shape]");
    assert.equal(
      await page.locator("#mask-section [name=mask-0-shape]").inputValue(),
      "inset(-50% -50% -50% -50%)",
    );
    assert.equal(
      await page.locator("#mask-section [data-mask-detach='0']").getAttribute("aria-label"),
      "Detach mask as shape",
    );
    assert.equal(
      await page
        .locator("#mask-section [data-mask-row='0'] [data-effect-tool=remove]")
        .getAttribute("aria-label"),
      "Remove mask",
    );
    const t = await box("target");
    near(
      await pixel(t.x + t.width / 2, t.y + t.height / 2),
      [255, 255, 255],
      "the target still paints inside a larger mask",
    );
    assert.notDeepEqual(await pixel(...outside), YELLOW, "the consumed source no longer paints");

    // One undo step brings the sibling back and clears the mask.
    await undo();
    all = await nodes();
    assert.equal(all.length, before);
    assert.ok(all.some((n) => n.id === "source"));
    assert.equal(all.find((n) => n.id === "target").masks, undefined);
    near(await pixel(...outside), YELLOW, "undo restores the source");

    // Three siblings (Wonder CM5-multi-verified offers the item for four): the bottom-most selected one masks each of
    // the others, relative to each one's own box, and is consumed; one undo step restores everything.
    await select(["art", "target", "source"]);
    await rightClick("target");
    if ((await selection()).length !== 3) await select(["art", "target", "source"]);
    assert.deepEqual(await menuAfterLayout(), ["Use as mask"], "Use as mask for three siblings");
    await item("menu.useAsMask").click();
    all = await nodes();
    assert.equal(all.length, before - 1, "only the bottom-most sibling is removed");
    assert.equal(
      all.find((n) => n.id === "source"),
      undefined,
    );
    assert.deepEqual(all.find((n) => n.id === "target").masks, [
      { type: "shape", shape: "inset(-50% -50% -50% -50%)" },
    ]);
    // art: 300×300 at (400, 0); source 200×200 at (100, 100).
    assert.deepEqual(all.find((n) => n.id === "art").masks, [
      { type: "shape", shape: "inset(33.333% 133.333% 0% -100%)" },
    ]);
    assert.ok(
      all.some((n) => n.id === "kid"),
      "children of a masked layer stay",
    );
    assert.deepEqual((await selection()).toSorted(), ["art", "target"]);
    await undo();
    all = await nodes();
    assert.equal(all.length, before, "one undo step");
    assert.ok(["target", "art"].every((id) => all.find((n) => n.id === id).masks === undefined));
    near(await pixel(...outside), YELLOW, "undo restores the source");

    // A smaller bottom sibling clips the top one: only the mask's rectangle paints.
    await seed([
      frame("big", 100, 100, 200, 200, "#e0457b"),
      frame("hole", 150, 150, 100, 50, "#000000"),
    ]);
    // Put the small one underneath.
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.pages[0].nodes.reverse();
      window.design.setDocument(d);
      window.design.setSelection(["hole", "big"]);
    });
    const PINK = await pixel((await box("big")).x + 190, (await box("big")).y + 190);
    await rightClick("big", 0.1, 0.1);
    await item("menu.useAsMask").click();
    assert.deepEqual((await node("big")).masks, [
      { type: "shape", shape: "inset(25% 25% 50% 25%)" },
    ]);
    assert.equal(await node("hole"), undefined);
    const b = await box("big");
    near(await pixel(b.x + b.width / 2, b.y + b.height * 0.4), PINK, "inside the mask paints");
    const bg = await pixel(b.x - 20, b.y - 20);
    for (const [fx, fy] of [
      [0.1, 0.1],
      [0.9, 0.9],
      [0.5, 0.8],
      [0.1, 0.4],
    ])
      near(
        await pixel(b.x + b.width * fx, b.y + b.height * fy),
        bg,
        `outside the mask is clipped (${fx}, ${fy})`,
      );
    // The inset() field edits the mask.
    const field = page.locator("#mask-section [name=mask-0-shape]");
    await field.fill("inset(0%)");
    await field.press("Enter");
    assert.equal((await node("big")).masks[0].shape, "inset(0%)");
    near(
      await pixel(b.x + b.width * 0.1, b.y + b.height * 0.1),
      PINK,
      "inset(0%) shows the whole layer",
    );
    await field.fill("circle(50%)");
    await field.press("Enter");
    assert.equal((await node("big")).masks[0].shape, "inset(0%)", "a non-inset shape is refused");
    await undo();
    assert.equal((await node("big")).masks[0].shape, "inset(25% 25% 50% 25%)");

    // Back to Wonder's fixture for Detach and Remove.
    await seed(FIXTURE);
    await select(["source", "target"]);
    await rightClick("target");
    await item("menu.useAsMask").click();
    const masked = (await nodes()).length;

    // The masked layer's menu offers Detach mask as shape and Remove mask after Layout (P5-mask-result-menu).
    await rightClick("target");
    assert.deepEqual(await selection(), ["target"]);
    assert.deepEqual(await menuAfterLayout(), ["Detach mask as shape", "Remove mask"]);
    assert.ok(!(await items()).includes("Use as mask"));
    await item("menu.detachMask").click();
    all = await nodes();
    assert.equal(all.length, masked + 1);
    const at = all.findIndex((n) => n.id === "target");
    const shape = all[at - 1];
    assert.equal(shape.type, "frame");
    assert.equal(shape.name, "Frame");
    assert.equal(
      shape.color,
      "#ffffff",
      "the source's fill is not restored (P5-detached-layer-inspector)",
    );
    assert.deepEqual([shape.x, shape.y, shape.w, shape.h], [100, 100, 200, 200]);
    assert.equal(shape.parentId ?? null, null, "same level as the layer");
    assert.equal(all[at].masks, undefined);
    assert.deepEqual(await selection(), [shape.id]);
    assert.equal(shape.radius, 0);
    assert.equal(
      shape.clipContent,
      true,
      "the detached Frame clips its content (P5-detached-layer-inspector)",
    );
    assert.equal(await page.getByRole("checkbox", { name: "Clip content" }).isChecked(), true);
    const detached = await box(shape.id);
    near(
      await pixel(detached.x + 20, detached.y + 20),
      [255, 255, 255],
      "the detached shape paints below the layer",
    );
    await undo();
    all = await nodes();
    assert.equal(all.length, masked);
    assert.equal(all.find((n) => n.id === "target").masks[0].type, "shape");

    // Inspector Detach does the same.
    await select(["target"]);
    await page.locator("#mask-section [data-mask-detach='0']").click();
    assert.equal((await nodes()).length, masked + 1);
    assert.equal((await node("target")).masks, undefined);
    await undo();

    // Remove mask (menu): clears the property; the consumed source is not restored.
    await rightClick("target");
    await item("menu.removeMask").click();
    all = await nodes();
    assert.equal(all.length, masked);
    assert.equal(all.find((n) => n.id === "target").masks, undefined);
    await page.waitForSelector("#mask-section [name=mask-0-shape]", { state: "detached" });
    await rightClick("target");
    assert.deepEqual(await menuAfterLayout(), [], "no mask items once the mask is gone");
    await close();
    await undo();
    assert.equal((await node("target")).masks[0].type, "shape");

    // Remove mask (inspector).
    await select(["target"]);
    await page.locator("#mask-section [data-mask-row='0'] [data-effect-tool=remove]").click();
    assert.equal((await node("target")).masks, undefined);
    await undo();

    // The mask survives a reload.
    await page.waitForTimeout(600);
    await page.reload();
    await page.waitForSelector("#canvas .layer");
    assert.deepEqual((await node("target")).masks, [
      { type: "shape", shape: "inset(-50% -50% -50% -50%)" },
    ]);

    // Validation (shared with design-store validateDocument).
    const rejected = await page.evaluate(() =>
      [
        { masks: [{ type: "shape" }] },
        { masks: [{ type: "shape", shape: "inset(10px)" }] },
        { masks: [{ type: "shape", shape: "circle(50%)" }] },
        { masks: [{ type: "linear", shape: "inset(0%)" }] },
      ].map((patch) => {
        try {
          window.design.updateNodes(["target"], patch);
          return false;
        } catch {
          return true;
        }
      }),
    );
    assert.deepEqual(rejected, [true, true, true, true]);
    assert.deepEqual(errors, []);
    console.log(
      "PASS use as mask: two- and three-sibling menu item, conversion without wrapper, clipped pixels, inset field, undo, detach (menu + inspector), remove (menu + inspector), reload, validation",
    );
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
