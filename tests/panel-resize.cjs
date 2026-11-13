// Drag-to-resize panel edges (web/src/islands/chrome/panel-resize.tsx, Wonder sidebar-resize recording): dragging
// the inner edge of the layers panel, the left edge of the properties panel and the right edge of the chat dock
// resizes them within their limits, the canvas reflows without moving the artwork and still hit-tests, a double-click
// restores the default width, collapsing still works and the widths survive a reload.
const { _electron: electron } = require("@playwright/test");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "panel-resize-"));
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1", VERYNIZE_LAUNCH_EDITOR: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    env,
    args: [".", `--user-data-dir=${profile}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await moveOffCursor(app);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: 1440, height: 870 });
    await waitForUiReady(page);
    await page.waitForSelector("#canvas-toolbar");
    await page.waitForFunction(() => window.fileLibrary?.currentId);

    // Two frames: the canvas' ResizeObserver (camera compensation) has run after a layout change.
    const settle = () =>
      page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
    const near = (actual, expected, label, tolerance = 1) =>
      assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} ~= ${expected}`);
    const seed = () =>
      page.evaluate(() => {
        const d = window.design.getDocument();
        const nodes = [
          {
            id: "box",
            name: "box",
            type: "rectangle",
            x: 200,
            y: 160,
            w: 120,
            h: 90,
            color: "#8844cc",
          },
        ];
        d.pages = [{ id: d.pages[0].id, name: "Page 1", nodes }];
        d.activePage = d.pages[0].id;
        window.design.setDocument(d);
        window.design.setSelection([]);
        window.design.setTool("move");
        window.design.setCamera(80, 60, 1);
      });
    const layout = () =>
      page.evaluate(() => {
        const box = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            width: r.width,
            visible: el.checkVisibility() && r.width > 0,
          };
        };
        const node = document.querySelector("#canvas [data-id=box]")?.getBoundingClientRect();
        return {
          layers: box("#layer-panel"),
          properties: box("#properties"),
          wrap: box("#canvas-wrap"),
          dock: box("#agent-chat-dock"),
          left: box('[data-panel-resize="left"]'),
          right: box('[data-panel-resize="right"]'),
          chat: box('[data-panel-resize="chat"]'),
          node: node && { x: node.left + node.width / 2, y: node.top + node.height / 2 },
          saved: localStorage.getItem("verynize.panelWidths"),
        };
      });
    const handleCentre = async (side) => {
      const r = await page.locator(`[data-panel-resize="${side}"]`).boundingBox();
      assert.ok(r, `${side} handle is rendered`);
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    // Drags stay inside the 1440px window (a pointerup outside it is not delivered to synthetic input).
    async function drag(side, dx) {
      const start = await handleCentre(side);
      const end = Math.min(1438, Math.max(2, start.x + dx));
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move((start.x + end) / 2, start.y, { steps: 4 });
      await page.mouse.move(end, start.y, { steps: 4 });
      await page.mouse.up();
      await settle();
    }
    // Clicking the layer's centre selects it (hit-testing follows the moved viewport), and the size badge is centred
    // under it (overlays follow the camera).
    async function assertHitTest(label) {
      await settle();
      const { node } = await layout();
      await page.evaluate(() => window.design.setSelection([]));
      await page.mouse.click(node.x, node.y);
      assert.deepEqual(
        await page.evaluate(() => window.design.getSelection()),
        ["box"],
        `${label}: click selects the layer`,
      );
      const badge = await page.evaluate(() => {
        const el = document.getElementById("selection-measure");
        const r = el?.getBoundingClientRect();
        return r && r.width ? r.left + r.width / 2 : null;
      });
      if (badge !== null)
        near(badge, node.x, `${label}: size badge stays centred under the layer`, 2);
      await page.keyboard.press("Escape");
    }

    await seed();
    const initial = await layout();
    near(initial.layers.width, 281, "layers panel default width");
    near(initial.properties.width, 281, "properties panel default width");
    assert.equal(
      initial.left.visible && initial.right.visible,
      true,
      "side panel edges are draggable",
    );
    assert.equal(initial.chat.visible, false, "no chat edge while the chat is closed");
    near(
      initial.left.left + initial.left.width / 2,
      initial.layers.right - 0.5,
      "left strip is centred on the layers edge",
    );
    near(
      initial.right.left + initial.right.width / 2,
      initial.properties.left + 0.5,
      "right strip is centred on the properties edge",
    );
    const cursor = await page
      .locator('[data-panel-resize="left"]')
      .evaluate((el) => getComputedStyle(el).cursor);
    assert.equal(cursor, "col-resize", "the edge shows a column-resize cursor");
    const line = await page
      .locator('[data-panel-resize="left"] [data-panel-resize-line]')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(line, "rgba(0, 0, 0, 0)", "no visible handle bar at rest");
    await assertHitTest("default layout");

    // ---- Layers panel: wider, the canvas reflows, the artwork stays put on screen ----
    const start = await handleCentre("left");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 120, start.y, { steps: 6 });
    const during = await page.evaluate(() => ({
      resizing: document.documentElement.dataset.panelResizing,
      line: getComputedStyle(
        document.querySelector('[data-panel-resize="left"] [data-panel-resize-line]'),
      ).backgroundColor,
      cursor: getComputedStyle(document.body).cursor,
    }));
    assert.equal(during.resizing, "left");
    assert.equal(during.line, "rgb(162, 69, 211)", "the edge turns accent-coloured while dragging");
    assert.equal(
      during.cursor,
      "col-resize",
      "the resize cursor holds while dragging over other elements",
    );
    await page.mouse.up();
    await settle();
    let now = await layout();
    near(now.layers.width, 401, "layers panel widened by the drag");
    near(now.wrap.left, initial.wrap.left + 120, "canvas viewport starts at the new edge");
    near(now.wrap.width, initial.wrap.width - 120, "canvas viewport narrowed by the same amount");
    near(now.node.x, initial.node.x, "artwork stays put while the layers panel grows");
    near(now.node.y, initial.node.y, "artwork does not move vertically");
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.panelResizing),
      undefined,
    );
    assert.deepEqual(JSON.parse(now.saved), { left: 401 }, "the width is saved");
    await assertHitTest("wider layers panel");

    // Clamps: never wider than twice the default, never narrower than the default.
    await drag("left", 2000);
    near((await layout()).layers.width, 561, "layers panel max width");
    await drag("left", -2000);
    near((await layout()).layers.width, 281, "layers panel min width");
    await drag("left", 80);
    near((await layout()).layers.width, 361, "layers panel resized again");

    // ---- Properties panel: dragging its left edge left widens it; the canvas' left edge does not move ----
    const beforeRight = await layout();
    await drag("right", -100);
    now = await layout();
    near(now.properties.width, 381, "properties panel widened by dragging its left edge");
    near(now.wrap.left, beforeRight.wrap.left, "canvas left edge unchanged");
    near(now.wrap.right, now.properties.left, "canvas viewport ends at the properties edge");
    near(now.node.x, beforeRight.node.x, "artwork stays put while the properties panel grows");
    await assertHitTest("wider properties panel");
    await drag("right", 2000);
    near((await layout()).properties.width, 281, "properties panel min width");
    await drag("right", -2000);
    near((await layout()).properties.width, 561, "properties panel max width");
    await page.locator('[data-panel-resize="right"]').dblclick();
    near((await layout()).properties.width, 281, "double-click restores the default width");
    await drag("right", -100);
    near((await layout()).properties.width, 381, "properties panel resized again");

    // Keyboard: the edge is a focusable separator.
    await page.locator('[data-panel-resize="left"]').focus();
    await page.keyboard.press("ArrowRight");
    near((await layout()).layers.width, 369, "ArrowRight widens the layers panel by 8px");
    await page.keyboard.press("ArrowLeft");
    near((await layout()).layers.width, 361, "ArrowLeft narrows it back");
    assert.equal(
      await page.locator('[data-panel-resize="left"]').getAttribute("aria-valuenow"),
      "361",
    );

    // ---- Collapse still works and restores the custom width ----
    await page.evaluate(() => document.body.classList.add("left-collapsed", "right-collapsed"));
    await settle();
    now = await layout();
    assert.equal(
      now.left.visible || now.right.visible,
      false,
      "collapsed panels have no draggable edge",
    );
    near(now.wrap.left, 0, "canvas takes the collapsed layers column");
    near(now.wrap.right, 1440, "canvas takes the collapsed properties column");
    await page.evaluate(() => document.body.classList.remove("left-collapsed", "right-collapsed"));
    await settle();
    now = await layout();
    near(now.layers.width, 361, "layers panel reopens at its custom width");
    near(now.properties.width, 381, "properties panel reopens at its custom width");
    await assertHitTest("after collapse and expand");

    // ---- Widths survive a reload ----
    await page.reload();
    await waitForUiReady(page);
    await page.waitForSelector("#canvas-toolbar");
    await seed();
    await settle();
    now = await layout();
    near(now.layers.width, 361, "layers width persisted across reload");
    near(now.properties.width, 381, "properties width persisted across reload");
    assert.deepEqual(JSON.parse(now.saved), { left: 361, right: 381 });
    await assertHitTest("after reload");

    // ---- Chat dock: its right edge resizes it; the editor grid follows ----
    await page.locator("#shell-chat").click();
    await page.waitForFunction(() => document.body.classList.contains("agent-chat-open"));
    // Opening the chat hides the layers (chrome.tsx useChatLayers); show them again beside the dock.
    await page.waitForFunction(() => document.body.classList.contains("left-collapsed"));
    await page.evaluate(() => document.body.classList.remove("left-collapsed"));
    await settle();
    // The canvas is narrow now (dock + layers + properties): bring the layer into view at its left edge.
    await page.evaluate(() => window.design.setCamera(20 - 200, 60, 1));
    await settle();
    const chatStart = await layout();
    assert.ok(
      chatStart.node.x - 60 >= chatStart.wrap.left && chatStart.node.x + 60 <= chatStart.wrap.right,
      "layer visible",
    );
    near(chatStart.dock.width, 499, "chat dock default width");
    assert.equal(chatStart.chat.visible, true, "the chat dock edge is draggable");
    near(
      chatStart.chat.left + chatStart.chat.width / 2,
      chatStart.dock.right - 0.5,
      "chat strip is centred on the dock edge",
    );
    near(chatStart.layers.left, chatStart.dock.right, "layers panel sits right of the dock");
    await drag("chat", -100);
    now = await layout();
    near(now.dock.width, 399, "chat dock narrowed by the drag");
    near(now.layers.left, 399, "the editor grid follows the dock edge");
    near(now.node.x, chatStart.node.x, "artwork stays put while the chat dock narrows");
    const titleInset = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('[data-chrome-bar][role="banner"]')).paddingLeft,
    );
    assert.equal(titleInset, "399px", "the title bar leaves the dock's new width free");
    await assertHitTest("narrower chat dock");
    await drag("chat", -1000);
    near((await layout()).dock.width, 360, "chat dock min width");
    await page.locator('[data-panel-resize="chat"]').dblclick();
    near((await layout()).dock.width, 499, "double-click restores the chat dock width");
    // The canvas keeps at least 320px: with dock 499 + layers 361 + properties 381 it is already narrower, so no growth.
    await drag("chat", 200);
    near((await layout()).dock.width, 499, "chat dock cannot squeeze the canvas below its minimum");
    await page.evaluate(() => document.body.classList.add("right-collapsed"));
    await settle();
    await drag("chat", 60);
    near((await layout()).dock.width, 559, "chat dock widened");
    await page.evaluate(() => document.body.classList.remove("right-collapsed"));
    assert.deepEqual(JSON.parse((await layout()).saved), { left: 361, right: 381, chat: 559 });

    // Closing the chat hides its edge; the panels keep their widths.
    await page.evaluate(() => window.agentWorkspace.closeChat());
    await page.waitForFunction(() => !document.body.classList.contains("agent-chat-open"));
    now = await layout();
    assert.equal(now.chat.visible, false, "no chat edge once the chat closes");
    near(now.properties.width, 381, "properties panel keeps its width");

    assert.deepEqual(errors, []);
    console.log(
      "PASS panel resize: drag/clamp/double-click reset/keyboard for layers, properties and chat dock; canvas reflow keeps artwork and hit-testing aligned; collapse; persistence across reload",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
