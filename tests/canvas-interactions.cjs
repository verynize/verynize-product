// Canvas parity: camera, tools, selection, smart guides, clipboard, structure commands, sizing modes.
const { _electron } = require("@playwright/test");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const { MOD, mod } = require("./helpers/keys.cjs");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-interactions-")),
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
    await waitForUiReady(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForSelector("#canvas .layer");
    const near = (actual, expected, tolerance = 1.5, label = "") =>
      assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} ~= ${expected}`);
    const doc = () => page.evaluate(() => window.design.getDocument());
    const nodesOf = async () => (await doc()).pages[0].nodes;
    const node = async (id) => (await nodesOf()).find((n) => n.id === id);
    const selection = () => page.evaluate(() => window.design.getSelection().toSorted());
    async function seed(nodes, camera = [100, 100, 1]) {
      await page.evaluate(
        ([nodes, camera]) => {
          const d = window.design.getDocument();
          d.pages = [{ id: d.pages[0].id, name: "Desktop", nodes }];
          d.activePage = d.pages[0].id;
          window.design.setDocument(d);
          window.design.setSelection([]);
          window.design.setTool("move");
          window.design.setCamera(...camera);
        },
        [nodes, camera],
      );
    }
    // World coordinates to client coordinates through the live camera.
    async function screen(x, y) {
      return page.evaluate(
        ([x, y]) => {
          const r = document.querySelector("#canvas-wrap").getBoundingClientRect(),
            c = window.design.getCamera();
          return { x: r.left + c.x + x * c.zoom, y: r.top + c.y + y * c.zoom };
        },
        [x, y],
      );
    }
    async function drag(from, to, { steps = 8, before, during } = {}) {
      const a = await screen(...from),
        b = await screen(...to);
      await page.mouse.move(a.x, a.y);
      if (before) await before();
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps });
      const seen = during ? await during() : undefined;
      await page.mouse.up();
      return seen;
    }
    const click = async (x, y, { modifiers = [], ...options } = {}) => {
      const p = await screen(x, y);
      for (const m of modifiers) await page.keyboard.down(m);
      await page.mouse.click(p.x, p.y, options);
      for (const m of modifiers) await page.keyboard.up(m);
    };
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

    // ---- 1. Infinite canvas camera ----
    await seed([rect("a", 0, 0), rect("far", 3000, -2000)]);
    assert.equal(
      await page.locator("#canvas [data-id=far]").evaluate((e) => e.style.left),
      "3000px",
      "existing coordinates are preserved",
    );
    const pivot = await screen(50, 40);
    await page.mouse.move(pivot.x, pivot.y);
    const before = await page.evaluate(
      ([x, y]) => window.design.screenToWorld(x, y),
      [pivot.x, pivot.y],
    );
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -120);
    await page.keyboard.up("Control");
    const afterZoom = await page.evaluate(
      ([x, y]) => window.design.screenToWorld(x, y),
      [pivot.x, pivot.y],
    );
    assert.ok(
      (await page.evaluate(() => window.design.getCamera().zoom)) > 1,
      "ctrl+wheel zooms in",
    );
    near(afterZoom.x, before.x, 0.5, "cursor-anchored x");
    near(afterZoom.y, before.y, 0.5, "cursor-anchored y");
    await page.evaluate(() => window.design.setCamera(100, 100, 1));
    await page.mouse.wheel(40, 60);
    const panned = await page.evaluate(() => window.design.getCamera());
    near(panned.x, 60, 0.5, "wheel pans x");
    near(panned.y, 40, 0.5, "wheel pans y");
    await page.evaluate(() => window.design.setCamera(100, 100, 0.8));
    await page.keyboard.press(mod("Equal"));
    assert.equal(
      await page.evaluate(() => window.design.getCamera().zoom),
      1,
      "⌘+ steps to the next zoom stop",
    );
    await page.keyboard.press(mod("Equal"));
    assert.equal(await page.evaluate(() => window.design.getCamera().zoom), 2);
    await page.keyboard.press(mod("Minus"));
    await page.keyboard.press(mod("Minus"));
    assert.equal(await page.evaluate(() => window.design.getCamera().zoom), 0.5);
    await page.evaluate(() => window.design.setCamera(100, 100, 0.05));
    await page.keyboard.press(mod("Minus"));
    assert.equal(await page.evaluate(() => window.design.getCamera().zoom), 0.02);
    await page.keyboard.press(mod("Minus"));
    assert.equal(
      await page.evaluate(() => window.design.getCamera().zoom),
      0.02,
      "keyboard lower clamp",
    );
    await page.locator("#zoom-menu-button").click();
    await page.locator("#zoom-out").click();
    assert.equal(
      await page.evaluate(() => window.design.getCamera().zoom),
      0.02,
      "menu lower clamp",
    );
    await page.locator("#bd-zoom-menu").waitFor({ state: "hidden" });
    // Return keyboard focus to the canvas before testing space-to-pan below. The closed menu hands focus
    // back to its trigger a frame or more later, so keep blurring until focus has settled on the body.
    await page.evaluate(async () => {
      for (let i = 0; i < 10; i++) {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    });
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
    await page.mouse.move(pivot.x, pivot.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 10000);
    await page.keyboard.up("Control");
    assert.equal(
      await page.evaluate(() => window.design.getCamera().zoom),
      0.02,
      "wheel/pinch lower clamp",
    );
    await page.evaluate(() => window.design.setCamera(100, 100, 0.001));
    assert.equal(
      await page.evaluate(() => window.design.getCamera().zoom),
      0.02,
      "API lower clamp",
    );
    await page.keyboard.press(mod("Digit0"));
    assert.equal(await page.evaluate(() => window.design.getCamera().zoom), 1);
    await page.keyboard.press("Shift+Digit1");
    const fitted = await page.evaluate(() => ({
      far: document.querySelector("#canvas [data-id=far]").getBoundingClientRect().toJSON(),
      a: document.querySelector("#canvas [data-id=a]").getBoundingClientRect().toJSON(),
      wrap: document.querySelector("#canvas-wrap").getBoundingClientRect().toJSON(),
    }));
    for (const r of [fitted.far, fitted.a])
      assert.ok(
        r.left >= fitted.wrap.left &&
          r.right <= fitted.wrap.right &&
          r.top >= fitted.wrap.top &&
          r.bottom <= fitted.wrap.bottom,
        "⇧1 fits all content",
      );
    await page.evaluate(() => {
      window.design.setCamera(-5000, -5000, 1);
      document.querySelector("#canvas [data-id=a]").scrollIntoView({ block: "center" });
    });
    const revealed = await page.evaluate(() => ({
      a: document.querySelector("#canvas [data-id=a]").getBoundingClientRect().toJSON(),
      wrap: document.querySelector("#canvas-wrap").getBoundingClientRect().toJSON(),
    }));
    assert.ok(
      revealed.a.left >= revealed.wrap.left &&
        revealed.a.right <= revealed.wrap.right &&
        revealed.a.top >= revealed.wrap.top,
      "scrollIntoView on a layer pans the camera to it",
    );
    // Space-drag and the H tool pan.
    await page.evaluate(() => window.design.setCamera(100, 100, 1));
    await page.keyboard.down("Space");
    await drag([400, 400], [450, 430]);
    await page.keyboard.up("Space");
    let cam = await page.evaluate(() => window.design.getCamera());
    near(cam.x, 150, 1, "space pan x");
    near(cam.y, 130, 1, "space pan y");
    assert.deepEqual((await node("a")).x, 0, "space-drag does not move layers");
    await page.keyboard.press("h");
    assert.equal(await page.evaluate(() => window.design.getTool()), "hand");
    await drag([10, 10], [-20, 0]);
    cam = await page.evaluate(() => window.design.getCamera());
    near(cam.x, 120, 1, "hand pan");
    assert.equal((await node("a")).x, 0);
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.design.getTool()), "move");

    await seed([rect("overview", 0, 0, 20000, 20000, { type: "frame", layout: "free" })]);
    await page.keyboard.press("Shift+Digit1");
    assert.ok(
      await page.evaluate(
        () => window.design.getCamera().zoom < 0.05 && window.design.getCamera().zoom >= 0.02,
      ),
      "fit uses the extended zoom range",
    );
    await page.evaluate(() => window.design.setCamera(100, 100, 0.02));
    const overviewLabel = page.locator("#canvas-overlay .frame-label[data-id=overview]");
    assert.ok(
      (await overviewLabel.boundingBox()).height >= 10,
      "frame label stays screen-sized at 2%",
    );
    await click(5000, 5000);
    assert.deepEqual(await selection(), ["overview"], "hit testing at 2%");
    const overviewHandle = await page
      .locator("#canvas [data-id=overview] .handle[data-corner=nw]")
      .boundingBox();
    near(overviewHandle.width, 9, 0.2, "handle width at 2%");
    near(overviewHandle.height, 9, 0.2, "handle height at 2%");
    // ---- 2. Tools: draw-to-create, parenting, presets ----
    await seed([
      {
        id: "board",
        name: "Board",
        type: "frame",
        x: 0,
        y: 0,
        w: 400,
        h: 300,
        color: "#ffffff",
        layout: "free",
      },
    ]);
    // D1: the toolbar Frame button arms the tool like F; neither creates a layer.
    await page.locator("#add-frame").click();
    assert.equal(
      await page.evaluate(() => window.design.getTool()),
      "frame",
      "toolbar Frame arms the tool",
    );
    assert.equal((await nodesOf()).length, 1, "arming the frame tool creates no layer");
    await page.locator("#add-frame").click();
    assert.equal(
      await page.evaluate(() => window.design.getTool()),
      "move",
      "toolbar Frame toggles the tool off",
    );
    await page.keyboard.press("f");
    assert.equal(await page.evaluate(() => window.design.getTool()), "frame");
    assert.equal((await nodesOf()).length, 1, "F creates no layer");
    // With nothing selected, Properties lists Wonder's seven preset categories (collapsed) instead of the Page section.
    assert.equal(
      await page.locator("#frame-presets-section").isVisible(),
      true,
      "frame presets are offered in Properties",
    );
    assert.equal(await page.locator("#frame-presets-section h3").textContent(), "Frame");
    assert.equal(
      await page.locator("#page-section").count(),
      0,
      "the Page section gives way to the presets",
    );
    assert.deepEqual(
      await page.locator("#frame-presets-section [data-frame-category]").allTextContents(),
      ["Phone", "Tablet", "Desktop", "Presentation", "Smartwatch", "Paper", "Social media"],
    );
    assert.equal(
      await page.locator("#frame-presets-section [data-preset]").count(),
      0,
      "categories start collapsed",
    );
    for (const category of [
      "Phone",
      "Tablet",
      "Desktop",
      "Presentation",
      "Smartwatch",
      "Paper",
      "Social media",
    ])
      await page.locator(`[data-frame-category="${category}"]`).click();
    assert.equal(
      await page.locator("#frame-presets-section [data-preset]").count(),
      26,
      "all 26 Wonder presets",
    );
    assert.equal(
      await page.locator('[data-preset="iPhone Duo Open"]').textContent(),
      "iPhone Duo Open626 × 890",
    );
    assert.equal(
      await page.locator('[data-preset="LinkedIn Banner"]').textContent(),
      "LinkedIn Banner1584 × 396",
    );
    assert.equal(
      await page.locator('[data-preset="Series 10 46mm"]').textContent(),
      "Series 10 46mm220 × 268",
    );
    assert.equal(await page.locator('[data-preset="A4"]').textContent(), "A4794 × 1123");
    await page.locator('[data-frame-category="Tablet"]').click();
    assert.equal(
      await page.locator('[data-preset^="iPad"]').count(),
      0,
      "a category collapses again",
    );
    assert.equal(await page.locator("#frame-presets").count(), 0, "no floating preset popover");
    assert.equal((await nodesOf()).length, 1, "browsing presets creates no layer");
    await drag([500, 20], [700, 170]);
    let list = await nodesOf(),
      drawn = list.at(-1);
    assert.equal(drawn.type, "frame");
    near(drawn.x, 500);
    near(drawn.y, 20);
    near(drawn.w, 200);
    near(drawn.h, 150);
    assert.equal(drawn.parentId, null);
    assert.equal(drawn.clipContent, true, "a drawn frame clips its content");
    assert.equal(drawn.radius, 0, "D2: a drawn frame has square corners");
    assert.equal(drawn.color, "#ffffff");
    assert.equal(
      await page.locator("#frame-presets-section").count(),
      0,
      "presets leave Properties once the tool is off",
    );
    assert.equal(
      await page.evaluate(() => window.design.getTool()),
      "move",
      "tool returns to move after drawing",
    );
    await page.keyboard.press("r");
    await drag([50, 60], [150, 120]);
    drawn = (await nodesOf()).at(-1);
    assert.equal(drawn.type, "rectangle");
    assert.equal(drawn.parentId, "board", "drawing inside a frame parents to it");
    near(drawn.x, 50);
    near(drawn.y, 60);
    near(drawn.w, 100);
    await page.keyboard.press("t");
    await click(520, 400);
    drawn = (await nodesOf()).at(-1);
    assert.equal(drawn.type, "text");
    near(drawn.x, 520);
    near(drawn.y, 400);
    await page.evaluate(() => document.activeElement?.blur());
    // A single click with the frame tool makes a 100×100 "Frame" at the click point (Wonder D1).
    await page.keyboard.press("Escape");
    await page.keyboard.press("f");
    await click(720, 220);
    drawn = (await nodesOf()).at(-1);
    assert.equal(drawn.type, "frame");
    assert.equal(drawn.name, "Frame");
    near(drawn.x, 720);
    near(drawn.y, 220);
    assert.equal(drawn.w, 100);
    assert.equal(drawn.h, 100);
    assert.equal(drawn.radius, 0, "D2: a clicked frame has square corners");
    assert.deepEqual(await selection(), [drawn.id]);
    assert.equal(await page.evaluate(() => window.design.getTool()), "move");
    // A preset row creates a selected, top-level frame named after the preset, centred in the viewport.
    await page.keyboard.press("Escape");
    await page.keyboard.press("f");
    await page.locator('[data-frame-category="Phone"]').click();
    await page.locator('[data-preset="iPhone 17"]').click();
    drawn = (await nodesOf()).at(-1);
    assert.equal(drawn.w, 402);
    assert.equal(drawn.h, 874);
    assert.equal(drawn.name, "iPhone 17");
    assert.equal(drawn.parentId, null);
    assert.equal(drawn.radius, 0, "D2: a preset frame has square corners");
    assert.equal(drawn.clipContent, true);
    assert.deepEqual(await selection(), [drawn.id]);
    assert.equal(await page.evaluate(() => window.design.getTool()), "move");
    const presetBox = await page.locator(`#canvas [data-id="${drawn.id}"]`).boundingBox(),
      wrapBox = await page.locator("#canvas-wrap").boundingBox();
    assert.ok(
      presetBox.x > wrapBox.x &&
        presetBox.x + presetBox.width < wrapBox.x + wrapBox.width &&
        presetBox.y >= wrapBox.y - 1 &&
        presetBox.y + presetBox.height <= wrapBox.y + wrapBox.height + 1,
      "the preset frame is zoomed into view",
    );
    // The one-step insert stays reachable as a command.
    const countBefore = (await nodesOf()).length;
    await page.evaluate(() => window.design.runCommand("insert.frame"));
    drawn = (await nodesOf()).at(-1);
    assert.equal((await nodesOf()).length, countBefore + 1);
    assert.equal(drawn.type, "frame");
    assert.equal(drawn.radius, 0);

    // ---- 3. Marquee, shift toggle, drill-in, keyboard navigation ----
    await seed([
      rect("m1", 0, 0),
      rect("m2", 150, 0),
      rect("m3", 300, 0),
      {
        id: "board",
        name: "Board",
        type: "frame",
        x: 0,
        y: 200,
        w: 400,
        h: 200,
        color: "#eeeeee",
        layout: "free",
      },
      {
        id: "group",
        name: "Group",
        type: "frame",
        parentId: "board",
        x: 0,
        y: 0,
        w: 300,
        h: 150,
        color: "#ffffff",
        layout: "free",
      },
      rect("c1", 10, 10, 50, 50, { parentId: "group" }),
      rect("c2", 100, 10, 50, 50, { parentId: "group" }),
    ]);
    await drag([-20, -20], [200, 50]);
    assert.deepEqual(
      await selection(),
      ["m1", "m2"],
      "marquee selects intersecting top-level layers",
    );
    await click(320, 20, { modifiers: ["Shift"] });
    assert.deepEqual(await selection(), ["m1", "m2", "m3"], "shift-click adds");
    await click(170, 20, { modifiers: ["Shift"] });
    assert.deepEqual(await selection(), ["m1", "m3"], "shift-click toggles off");
    await click(600, 600);
    assert.deepEqual(await selection(), [], "empty click clears");
    assert.equal(
      await page.evaluate(() => window.appPreferences.get().selection),
      "classic",
      "parent-first selection is the default",
    );
    assert.equal(
      await page.locator("#canvas [data-id=c1]").evaluate((e) => getComputedStyle(e).cursor),
      "default",
      "layers show the arrow cursor, not a move cursor",
    );
    // Hover outlines what a click would pick (the artboard's direct child), and only that (Wonder S1-hover-final).
    const hoverAt = async (x, y) => {
      const p = await screen(x, y);
      await page.mouse.move(p.x, p.y, { steps: 2 });
      return page.locator("#canvas-overlay").getAttribute("data-hover");
    };
    assert.equal(
      await hoverAt(30, 230),
      "group",
      "hover targets the outermost layer inside the artboard",
    );
    assert.equal(
      await page.locator("#canvas-overlay [class*=hover]:not(.hover-box)").count(),
      0,
      "hovering a frame does not outline its children",
    );
    await click(30, 230);
    assert.deepEqual(
      await selection(),
      ["group"],
      "a click inside an artboard picks its direct child, not the deep leaf",
    );
    assert.equal(
      await hoverAt(120, 230),
      "c2",
      "with the frame selected, hover shows the child a click would pick",
    );
    await click(30, 230);
    assert.deepEqual(
      await selection(),
      ["c1"],
      "clicking inside the selected frame drills one level in",
    );
    await click(120, 230);
    assert.deepEqual(
      await selection(),
      ["c2"],
      "siblings stay directly selectable inside the drilled frame",
    );
    await click(600, 600);
    await page.mouse.dblclick((await screen(30, 230)).x, (await screen(30, 230)).y);
    assert.deepEqual(await selection(), ["c1"], "double-click from nothing reaches the child");
    await page.keyboard.press("Shift+Enter");
    assert.deepEqual(await selection(), ["group"], "shift+enter selects parent");
    await page.keyboard.press("Enter");
    assert.deepEqual(await selection(), ["c1", "c2"], "enter selects children");
    await page.evaluate(() => window.design.setSelection(["c1"]));
    await page.keyboard.press("Tab");
    assert.deepEqual(await selection(), ["c2"], "tab cycles siblings");
    await page.keyboard.press("Escape");
    assert.deepEqual(await selection(), [], "escape deselects");
    await click(130, 230, { modifiers: [MOD] });
    assert.deepEqual(await selection(), ["c2"], "cmd-click deep-selects the leaf");
    await click(600, 600);
    await click(350, 380);
    assert.deepEqual(
      await selection(),
      ["board"],
      "clicking an artboard background selects the artboard",
    );
    await click(600, 600);
    await drag([350, 380], [200, 300]);
    assert.deepEqual(
      await selection(),
      ["group"],
      "dragging on an artboard background marquee-selects its children",
    );
    assert.equal((await node("board")).x, 0, "the unselected artboard does not move");
    await page.evaluate(() => window.appPreferences.set({ selection: "deep" }));
    await click(600, 600);
    await click(30, 230);
    assert.deepEqual(await selection(), ["c1"], "deep preference picks the leaf");
    await page.evaluate(() => window.appPreferences.set({ selection: "classic" }));

    // ---- 3b. Drag inside and out of auto layout ----
    await seed([
      {
        id: "stack",
        name: "Stack",
        type: "frame",
        x: 0,
        y: 0,
        w: 120,
        h: 160,
        color: "#ffffff",
        layout: "flex",
        direction: "column",
        gap: 10,
        padding: 10,
        wMode: "fixed",
        hMode: "hug",
      },
      rect("s-a", 0, 0, 100, 40, { parentId: "stack" }),
      rect("s-b", 0, 0, 100, 40, { parentId: "stack" }),
      rect("s-c", 0, 0, 100, 40, { parentId: "stack" }),
      {
        id: "side",
        name: "Side",
        type: "frame",
        x: 400,
        y: 0,
        w: 200,
        h: 200,
        color: "#eeeeee",
        layout: "free",
      },
    ]);
    const order = async () =>
      (await nodesOf()).filter((n) => n.parentId === "stack").map((n) => n.id);
    await click(50, 30);
    assert.deepEqual(await selection(), ["s-a"]);
    const during = await drag([50, 30], [50, 140], {
      steps: 10,
      during: () =>
        page.evaluate(() => {
          const top = (id) =>
            document.querySelector(`#canvas [data-id=${id}]`).getBoundingClientRect().top -
            document.querySelector("#canvas [data-id=stack]").getBoundingClientRect().top;
          return {
            a: top("s-a"),
            b: top("s-b"),
            c: top("s-c"),
            order: window.design
              .getDocument()
              .pages[0].nodes.filter((n) => n.parentId === "stack")
              .map((n) => n.id),
          };
        }),
    });
    // Wonder R1-row-drag-slot / R1-row-small-drag: the child follows the pointer, its siblings stay put until release.
    near(during.a, 120, 1, "the dragged stack child follows the pointer");
    near(during.b, 60, 1, "siblings keep their slots");
    near(during.c, 110, 1);
    assert.deepEqual(
      during.order,
      ["s-a", "s-b", "s-c"],
      "the stack is not reordered before release",
    );
    assert.deepEqual(
      await order(),
      ["s-b", "s-c", "s-a"],
      "releasing a stack child reorders it to the slot under the pointer",
    );
    assert.equal(
      await page.locator("#canvas [data-id=s-a]").evaluate((e) => e.style.translate),
      "",
      "the drag offset clears on drop",
    );
    await page.keyboard.press("ArrowUp");
    assert.deepEqual(
      await order(),
      ["s-b", "s-a", "s-c"],
      "arrow keys step a stack child through the stack",
    );
    await page.keyboard.press(mod("z"));
    assert.deepEqual(await order(), ["s-b", "s-c", "s-a"]);
    await page.keyboard.press(mod("z"));
    assert.deepEqual(await order(), ["s-a", "s-b", "s-c"], "a drag is one undo step");
    await click(50, 80);
    assert.deepEqual(await selection(), ["s-b"]);
    const landing = await drag([50, 80], [470, 90], {
      steps: 10,
      during: () =>
        page.evaluate(() => {
          const r = document.querySelector("#canvas [data-id=s-b]").getBoundingClientRect(),
            w = document.querySelector("#canvas-wrap").getBoundingClientRect(),
            c = window.design.getCamera();
          return { x: (r.x - w.x - c.x) / c.zoom, y: (r.y - w.y - c.y) / c.zoom };
        }),
    });
    near(landing.x, 430, 1, "a stack child dragged out follows the pointer x");
    near(landing.y, 70, 1, "and y");
    let moved = await node("s-b");
    assert.equal(moved.parentId, "side", "dropping on a frame re-parents into it");
    near(moved.x, 30, 1, "keeps its screen x");
    near(moved.y, 70, 1, "keeps its screen y");
    const indicator = await drag([470, 90], [50, 65], {
      steps: 10,
      during: () => page.locator("#canvas-overlay .drop-line").isVisible(),
    });
    assert.ok(indicator, "a slot indicator shows while dragging into a stack");
    assert.deepEqual(
      await order(),
      ["s-a", "s-b", "s-c"],
      "dropping into a stack takes the slot under the pointer",
    );
    assert.equal(
      await page.locator("#canvas-overlay .drop-target").isVisible(),
      false,
      "drop feedback clears on release",
    );

    // ---- 3c. Dragging onto a frame nests live, clips, and snaps to the frame ----
    await seed([
      {
        id: "F",
        name: "Frame 1",
        type: "frame",
        x: 0,
        y: 0,
        w: 400,
        h: 300,
        color: "#ffffff",
        layout: "free",
        clipContent: true,
      },
      rect("R", 500, 100, 150, 100),
    ]);
    const live = await drag([575, 150], [390, 150], {
      steps: 12,
      during: () =>
        page.evaluate(() => ({
          parent: window.design.getDocument().pages[0].nodes.find((n) => n.id === "R").parentId,
          dom: document.querySelector("#canvas [data-id=R]").parentElement.closest(".layer")
            ?.dataset.id,
        })),
    });
    assert.deepEqual(
      live,
      { parent: "F", dom: "F" },
      "the layer nests while the pointer is over the frame, before release",
    );
    let nested = await node("R");
    near(nested.x, 315, 1, "keeps its screen x");
    near(nested.y, 100);
    assert.equal(
      await page.locator("#canvas [data-id=F]").evaluate((e) => getComputedStyle(e).overflow),
      "hidden",
      "the frame clips the overhang",
    );
    assert.equal(
      await page.locator("#canvas-overlay .selection-ring > .handle").count(),
      4,
      "selection chrome is redrawn above the clip",
    );
    const guidesInFrame = await drag([390, 150], [278, 152], {
      steps: 12,
      during: () => page.locator("#canvas-overlay .guide").count(),
    });
    assert.ok(guidesInFrame > 0, "guides show for the new parent");
    near((await node("R")).x, 200, 0.5, "left edge snaps to the frame centre");
    near((await node("R")).y, 100, 0.5, "centre snaps to the frame middle");
    const se = await page
        .locator("#canvas-overlay .selection-ring > .handle[data-corner=se]")
        .boundingBox(),
      to = await screen(400, 250);
    await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    near((await node("R")).w, 200, 1, "the overlay handle resizes");
    near((await node("R")).h, 150, 1);
    for (let i = 0; i < 3; i++) await page.keyboard.press(mod("z")); // resize, snap drag, nesting drag
    nested = await node("R");
    assert.equal(nested.parentId, null, "the nesting drag is one undo step");
    near(nested.x, 500);

    // ---- 4. Smart guides, equal spacing and Alt distances ----
    await seed([
      rect("s1", 0, 0),
      rect("s2", 500, 200),
      rect("g1", 0, 400),
      rect("g2", 150, 400),
      rect("mover", 530, 520),
    ]);
    await click(580, 560);
    const guidesSeen = await drag([580, 560], [580 - 27, 560 - 117], {
      steps: 10,
      during: () => page.locator("#canvas-overlay").getAttribute("data-guides"),
    });
    let mover = await node("mover");
    assert.equal(mover.x, 500, "left edge snaps to sibling left edge");
    assert.equal(mover.y, 400, "top edge snaps to sibling top");
    assert.ok(Number(guidesSeen) > 0, "alignment guides are drawn while dragging");
    assert.equal(
      await page.locator("#canvas-overlay").getAttribute("data-guides"),
      "0",
      "guides clear on release",
    );
    // g1 [0,100] g2 [150,250]: gap 50 → mover snaps to x=300 at equal spacing.
    await page.evaluate(() => window.design.setCamera(100, 100, 1));
    await page.evaluate(() => {
      const d = window.design.getDocument();
      const m = d.pages[0].nodes.find((n) => n.id === "mover");
      m.x = 320;
      m.y = 600;
      window.design.setDocument(d);
      window.design.setSelection(["mover"]);
    });
    const spacingSeen = await drag([370, 640], [353, 440], {
      steps: 10,
      during: () => page.locator("#canvas-overlay .guide-label").allTextContents(),
    });
    mover = await node("mover");
    assert.equal(mover.x, 300, "equal-gap snapping");
    assert.ok(spacingSeen.includes("50"), "gap value is labeled");
    await page.evaluate(() => window.design.setSelection(["s1"]));
    const target = await screen(520, 220);
    await page.keyboard.down("Alt");
    await page.mouse.move(target.x, target.y);
    await page.mouse.move(target.x + 2, target.y + 2);
    const distances = await page.locator("#canvas-overlay .guide-label").allTextContents();
    await page.keyboard.up("Alt");
    assert.ok(
      distances.includes("400") && distances.includes("120"),
      "alt-hover shows horizontal and vertical distances: " + distances,
    );

    // ---- 5. Clipboard ----
    await seed([
      rect("p1", 0, 0, 100, 80, { color: "#ff0000", radius: 9 }),
      rect("p2", 200, 0, 100, 80, { color: "#00ff00" }),
    ]);
    await page.evaluate(() => window.design.setSelection(["p1"]));
    await page.keyboard.press(mod("KeyC"));
    await page.keyboard.press(mod("KeyV"));
    await page.waitForFunction(() => window.design.getDocument().pages[0].nodes.length === 3);
    let pasted = (await nodesOf()).at(-1);
    assert.notEqual(pasted.id, "p1");
    assert.equal(pasted.x, 0);
    assert.equal(pasted.color, "#ff0000");
    assert.deepEqual(await selection(), [pasted.id], "pasted layer is selected");
    await page.keyboard.press(mod("KeyX"));
    assert.equal((await nodesOf()).length, 2, "cut removes");
    await page.keyboard.press(mod("Shift+KeyV"));
    await page.waitForFunction(() => window.design.getDocument().pages[0].nodes.length === 3);
    pasted = (await nodesOf()).at(-1);
    assert.equal(pasted.x, 0);
    assert.equal(pasted.y, 0, "paste in place keeps position");
    await page.evaluate(() => window.design.setSelection(["p1"]));
    await page.keyboard.press(mod("Alt+KeyC"));
    await page.evaluate(() => window.design.setSelection(["p2"]));
    await page.keyboard.press(mod("Alt+KeyV"));
    const styled = await node("p2");
    assert.equal(styled.color, "#ff0000");
    assert.equal(styled.radius, 9);
    assert.equal(styled.x, 200, "paste style leaves geometry");
    await page.keyboard.press(mod("KeyD"));
    assert.equal((await nodesOf()).length, 4, "⌘D duplicates");
    await page.keyboard.press(mod("KeyZ"));
    assert.equal((await nodesOf()).length, 3, "undo reverts duplicate");

    // ---- 6. Frame/unframe, auto layout, lock/hide, z-order ----
    await seed([
      rect("f1", 100, 100, 100, 50),
      rect("f2", 260, 100, 100, 50),
      rect("f3", 420, 100, 100, 50),
    ]);
    await page.evaluate(() => window.design.setSelection(["f1", "f2"]));
    await page.keyboard.press(mod("KeyG"));
    list = await nodesOf();
    const frame = list.find((n) => n.type === "frame");
    assert.deepEqual([frame.x, frame.y, frame.w, frame.h], [100, 100, 260, 50]);
    assert.equal((await node("f1")).parentId, frame.id);
    assert.equal((await node("f2")).x, 160);
    assert.deepEqual(await selection(), [frame.id]);
    const f1Box = await page.locator("#canvas [data-id=f1]").boundingBox();
    await page.keyboard.press("Shift+KeyA");
    let auto = await node(frame.id);
    assert.equal(auto.layout, "flex");
    assert.equal(auto.direction, "row");
    assert.equal(auto.gap, 60);
    assert.equal(auto.wMode, "hug");
    assert.equal(auto.w, 260, "hugging frame measures its content");
    const autoBox = await page.locator("#canvas [data-id=f1]").boundingBox();
    near(autoBox.x, f1Box.x, 1, "auto layout keeps children in place");
    await page.keyboard.press(mod("Shift+KeyG"));
    list = await nodesOf();
    assert.equal(
      list.some((n) => n.type === "frame"),
      false,
      "unframe removes the frame",
    );
    assert.equal((await node("f2")).parentId, null);
    assert.equal((await node("f2")).x, 260, "unframe restores page coordinates");
    await page.evaluate(() => window.design.setSelection(["f1"]));
    await page.keyboard.press(mod("BracketRight"));
    assert.deepEqual(
      (await nodesOf()).map((n) => n.id),
      ["f2", "f1", "f3"],
      "bring forward",
    );
    await page.keyboard.press(mod("Alt+BracketRight"));
    assert.deepEqual(
      (await nodesOf()).map((n) => n.id),
      ["f2", "f3", "f1"],
      "bring to front",
    );
    await page.keyboard.press(mod("Alt+BracketLeft"));
    assert.deepEqual(
      (await nodesOf()).map((n) => n.id),
      ["f1", "f2", "f3"],
      "send to back",
    );
    await page.keyboard.press(mod("Shift+KeyL"));
    assert.equal((await node("f1")).locked, true);
    await drag([150, 125], [150, 300]);
    assert.equal((await node("f1")).y, 100, "locked layers do not move on canvas");
    await page.evaluate(() => window.design.setSelection(["f1"]));
    await page.keyboard.press(mod("Shift+KeyL"));
    assert.equal((await node("f1")).locked, undefined);
    await page.keyboard.press(mod("Shift+KeyH"));
    assert.equal((await node("f1")).hidden, true);
    assert.equal(
      await page.locator("#canvas [data-id=f1]").evaluate((e) => getComputedStyle(e).display),
      "none",
    );
    assert.equal(
      await page.locator(".layer-row.is-hidden").count(),
      1,
      "hidden layer is dimmed in the layer list",
    );
    await page.locator(".layer-row.is-hidden [data-toggle=hidden]").click();
    assert.equal((await node("f1")).hidden, undefined, "layer row eye toggles visibility");

    // ---- 7. Sizing modes ----
    await seed([
      {
        id: "stack",
        name: "Stack",
        type: "frame",
        x: 0,
        y: 0,
        w: 400,
        h: 200,
        color: "#ffffff",
        layout: "flex",
        direction: "row",
        padding: 10,
        gap: 10,
      },
      rect("fixed", 0, 0, 100, 50, { parentId: "stack" }),
      rect("grow", 0, 0, 100, 50, { parentId: "stack" }),
      {
        id: "label",
        name: "Label",
        type: "text",
        x: 0,
        y: 300,
        w: 400,
        h: 60,
        text: "Hug",
        fontSize: 20,
        color: "#222222",
      },
    ]);
    // The unit ("px ▾") opens the axis menu; modes that do not apply are omitted, not disabled (Wonder B2).
    // A Radix menu that is still closing ignores the next press on its trigger: wait until it is gone.
    const openMenu = async (trigger) => {
      await page.locator("[role=menu]").waitFor({ state: "detached" });
      await page.locator(trigger).click();
      await page.locator("[role=menu]").waitFor();
    };
    const sizeMenu = async (axis = "w") => {
      await openMenu(`#layout-section [data-size-menu=${axis}]`);
      const items = await page
        .locator("[role=menuitem]")
        .evaluateAll((list) => list.map((i) => i.textContent.trim()));
      const checked = await page
        .locator("[role=menuitem]:has(svg.lucide-check)")
        .evaluateAll((list) => list.map((i) => i.textContent.trim()));
      return { items, checked };
    };
    const pickSize = async (axis, mode) => {
      await openMenu(`#layout-section [data-size-menu=${axis}]`);
      await page.locator(`[role=menuitem][data-size-mode=${mode}]`).click();
    };
    const typeW = async (value) => {
      await page.locator("#layout-section [name=w]").fill(value);
      await page.locator("#layout-section [name=w]").press("Enter");
    };
    const widthOf = (id) =>
      page
        .locator(`#canvas [data-id=${id}]`)
        .evaluate((e) => e.getBoundingClientRect().width / window.design.getCamera().zoom);
    await page.evaluate(() => window.design.setSelection(["grow"]));
    assert.deepEqual(
      await sizeMenu(),
      {
        items: ["Fixed", "Relative", "Fill", "Calculate", "Add min width", "Add max width"],
        checked: ["Fixed"],
      },
      "a rectangle in a flex row: Relative and Fill, no Hug or Auto",
    );
    await page.locator("[role=menuitem][data-size-mode=fill]").click();
    assert.equal(
      (await node("grow")).w,
      400 - 20 - 10 - 100,
      "Fill takes the remaining main-axis space",
    );
    assert.match(await page.locator("#selection-measure").textContent(), /270 Fill x 50/);
    assert.equal(
      (await page.locator("#layout-section [data-size-menu=w]").textContent()).trim(),
      "Fill",
      "the unit names the mode",
    );
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.design.setSelection(["stack"]));
    assert.deepEqual(
      (await sizeMenu()).items,
      ["Fixed", "Calculate", "Add min width", "Add max width"],
      "a top-level frame: Fixed and Calculate only",
    );
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.design.setSelection(["label"]));
    assert.deepEqual(
      (await sizeMenu()).items,
      ["Fixed", "Hug", "Auto", "Calculate", "Add min width", "Add max width"],
      "top-level text: Hug and Auto, no Relative or Fill",
    );
    await page.locator("[role=menuitem][data-size-mode=hug]").click();
    assert.ok((await node("label")).w < 100, "hugging text shrinks to its content");
    assert.equal((await sizeMenu()).checked[0], "Hug", "the current mode carries the check");
    await page.keyboard.press("Escape");
    // Auto: CSS auto width (fits content on the canvas).
    await pickSize("w", "auto");
    assert.equal((await node("label")).wMode, "auto");
    assert.ok((await widthOf("label")) < 100, "auto text keeps its content width");
    assert.equal(
      (await page.locator("#layout-section [data-size-menu=w]").textContent()).trim(),
      "Auto",
    );
    // Relative: a percentage of the parent's content box (stack: 400 - 2 × 10 padding = 380).
    await page.evaluate(() => window.design.setSelection(["fixed"]));
    await pickSize("w", "relative");
    assert.equal((await node("fixed")).wPct, 26.32, "100px of 380px");
    assert.equal(
      (await page.locator("#layout-section [data-size-menu=w]").textContent()).trim(),
      "%",
    );
    await typeW("50");
    assert.deepEqual([(await node("fixed")).wMode, (await node("fixed")).wPct], ["fixed", 50]);
    near(await widthOf("fixed"), 190, 0.5, "relative width renders as a percentage");
    assert.match(await page.locator("#selection-measure").textContent(), /^190 50% x 50/);
    // Calculate: an expression of px and % terms; the unit becomes part of the value and the badge reads "Calc".
    await pickSize("w", "calc");
    assert.deepEqual(
      [(await node("fixed")).wMode, (await node("fixed")).wCalc, (await node("fixed")).wPct],
      ["calc", "190px", undefined],
    );
    assert.equal(await page.locator("#layout-section [name=w]").inputValue(), "190px");
    await typeW("100%-280px");
    assert.equal((await node("fixed")).wCalc, "100% - 280px");
    near(await widthOf("fixed"), 100, 0.5, "calc() resolves against the parent");
    assert.equal((await node("fixed")).w, 100, "the measured width is read back");
    assert.match(await page.locator("#selection-measure").textContent(), /^100 Calc x 50/);
    await typeW("12 apples");
    assert.equal((await node("fixed")).wCalc, "100% - 280px", "an invalid expression is refused");
    await pickSize("w", "fixed");
    assert.deepEqual(
      [(await node("fixed")).wMode, (await node("fixed")).wCalc, (await node("fixed")).w],
      ["fixed", undefined, 100],
      "Fixed keeps the current size",
    );
    // Min / max limits come from the axis menu as empty, focused rows (Wonder B2-min-width-added).
    await openMenu("#layout-section [data-size-menu=h]");
    assert.deepEqual(
      await page
        .locator("[role=menuitem]")
        .evaluateAll((list) => list.map((i) => i.textContent.trim()).slice(-2)),
      ["Add min height", "Add max height"],
      "the H menu adds height limits only",
    );
    await page.locator("[role=menuitem][data-limit=minH]").click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("name") === "minH");
    assert.equal(
      await page.locator("#layout-section [name=minH]").inputValue(),
      "",
      "the new limit row starts empty",
    );
    assert.equal(
      await page.locator("#layout-section [name=minH]").getAttribute("placeholder"),
      "Min H",
    );
    assert.equal(
      (await node("fixed")).minH,
      undefined,
      "nothing is written until a value is typed",
    );
    await page.keyboard.type("60");
    await page.keyboard.press("Enter");
    assert.equal((await node("fixed")).minH, 60);
    near(
      await page
        .locator("#canvas [data-id=fixed]")
        .evaluate((e) => e.getBoundingClientRect().height / window.design.getCamera().zoom),
      60,
      0.5,
      "min height renders",
    );
    await openMenu("#layout-section [data-limit-menu=minH]");
    await page.locator("[role=menuitem][data-limit-remove=minH]").click();
    assert.equal((await node("fixed")).minH, undefined, "Remove drops the limit");
    await page.evaluate(() => window.design.setSelection(["label"]));
    await page.locator("[name=w]").fill("300");
    await page.locator("[name=w]").press("Tab");
    assert.equal((await node("label")).wMode, "fixed", "typing a width returns to Fixed");

    // Command registry is exposed for tooling and context menus.
    const commands = await page.evaluate(() => window.design.commands());
    for (const id of ["edit.copy", "edit.pasteStyle", "transform.frame", "view.fit", "tool.frame"])
      assert.ok(
        commands.some((c) => c.id === id),
        id,
      );
    await page.evaluate(() => window.design.setSelection(["label"]));
    const labelBox = await page.locator("#canvas [data-id=label]").boundingBox();
    await page.mouse.click(labelBox.x + 5, labelBox.y + 5, { button: "right" });
    await page.locator('#canvas-menu [data-command="menu.layout"]').hover();
    await page
      .locator('[data-submenu="menu.layout"] [data-command="transform.frame"]')
      .waitFor({ timeout: 3000 }); // context menu lists commands
    await page.locator('[data-submenu="menu.layout"] [data-command="transform.frame"]').click();
    assert.equal((await node("label")).parentId !== null, true, "context menu runs commands");

    // Documents and saved views stay compatible after reload.
    await page.reload();
    await waitForUiReady(page);
    await page.waitForSelector("#canvas .layer");
    assert.ok((await nodesOf()).some((n) => n.id === "label"));
    assert.deepEqual(errors, []);
    console.log(
      "PASS canvas interactions: cursor-anchored zoom, stops, fit, space/H pan, draw tools + presets, marquee, shift toggle, parent-first selection, hover outlines, click/cmd drill-in, artboard marquee, auto-layout drag reorder + re-parent, live nesting into clipping frames with frame guides, Enter/Tab navigation, edge + equal-gap snapping with guides, Alt distances, clipboard + style, frame/unframe, auto layout, z-order, lock/hide, Fill/Hug sizing, context menu",
    );
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
