// Wonder canvas-parity marks and panels: snap-guide and Alt-distance colours (TR4/TR5), layout tick marks (TR8),
// layer-row tooltips (L1), inline page rename and page drag reorder with undo (L2).
const { _electron } = require("@playwright/test");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-wonder-marks-")),
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
    await page.waitForSelector("#bd-page-list");
    const BLUE = "rgba(102, 160, 248, 0.9)",
      CHIP = "rgb(102, 160, 248)";
    const doc = () => page.evaluate(() => window.design.getDocument());
    const node = async (id) => {
      const d = await doc();
      return d.pages.find((p) => p.id === d.activePage).nodes.find((n) => n.id === id);
    };
    const undo = () =>
      page.evaluate(
        () =>
          document.getElementById("legacy-undo")?.click() ??
          document.getElementById("undo").click(),
      );
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
    async function seed(nodes, pages) {
      await page.evaluate(
        ([nodes, pages]) => {
          const d = window.design.getDocument();
          d.pages = [{ id: d.pages[0].id, name: "Page 1", nodes }, ...(pages || [])];
          d.activePage = d.pages[0].id;
          window.design.setDocument(d);
          window.design.setSelection([]);
          window.design.setTool("move");
          window.design.setCamera(100, 100, 1);
        },
        [nodes, pages],
      );
    }
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

    // ---- TR4: alignment guides are thin blue lines with end dots ----
    await seed([rect("s1", 0, 0), rect("mover", 300, 40)]);
    await page.evaluate(() => window.design.setSelection(["mover"]));
    const a = await screen(350, 80),
      b = await screen(350, 43);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    const guide = await page
      .locator("#canvas-overlay .guide-line")
      .first()
      .evaluate((e) => ({
        stroke: getComputedStyle(e).stroke,
        width: getComputedStyle(e).strokeWidth,
      }));
    const dot = await page
      .locator("#canvas-overlay .guide-dot")
      .first()
      .evaluate((e) => getComputedStyle(e).fill);
    await page.mouse.up();
    assert.equal(guide.stroke, BLUE, "alignment guide is Wonder blue");
    assert.equal(guide.width, "1px", "alignment guide is 1px");
    assert.equal(dot, BLUE, "guide end dots are blue");
    assert.equal((await node("mover")).y, 0, "the drag still snaps");

    // ---- TR5: Alt distances use blue chips, solid measure lines and dashed edge extensions ----
    await seed([rect("top", 0, 0, 400, 200), rect("sel", 90, 231, 100, 70)]);
    await page.evaluate(() => window.design.setSelection(["sel"]));
    const over = await screen(200, 100);
    await page.keyboard.down("Alt");
    await page.mouse.move(over.x, over.y);
    await page.mouse.move(over.x + 2, over.y + 2);
    const labels = await page.locator("#canvas-overlay .guide-label.measure").evaluateAll((els) =>
      els.map((e) => ({
        text: e.textContent,
        bg: getComputedStyle(e).backgroundColor,
        color: getComputedStyle(e).color,
      })),
    );
    const lines = await page
      .locator("#canvas-overlay .guide-measure")
      .evaluateAll((els) => els.map((e) => getComputedStyle(e).stroke));
    const dashes = await page
      .locator("#canvas-overlay .guide-extend")
      .evaluateAll((els) =>
        els.map((e) => [getComputedStyle(e).stroke, getComputedStyle(e).strokeDasharray]),
      );
    await page.keyboard.up("Alt");
    assert.deepEqual(
      labels.map((l) => l.text).toSorted(),
      ["210", "31", "90"],
      "node-to-node gap and both edge offsets: " + JSON.stringify(labels),
    );
    assert.ok(
      labels.every((l) => l.bg === CHIP && l.color === "rgb(255, 255, 255)"),
      "labels are blue chips with white text",
    );
    assert.ok(lines.length === 3 && lines.every((s) => s === BLUE), "measure lines are blue");
    assert.equal(dashes.length, 2, "both hovered edges are extended");
    assert.ok(
      dashes.every(([s, d]) => s === BLUE && d === "8px, 4px"),
      "extensions are dashed blue: " + JSON.stringify(dashes),
    );

    // ---- TR8: layout marks are short ticks (padding blue, gap orange), no hatching at rest ----
    await seed([
      {
        id: "stack",
        name: "stack",
        type: "frame",
        x: 0,
        y: 0,
        w: 300,
        h: 120,
        color: "#ffffff",
        layout: "flex",
        direction: "row",
        gap: 20,
        padding: 20,
      },
      rect("c1", 0, 0, 80, 80, { parentId: "stack" }),
      rect("c2", 0, 0, 80, 80, { parentId: "stack" }),
    ]);
    await page.evaluate(() => window.design.setSelection(["stack"]));
    const inStack = await screen(110, 10);
    await page.mouse.move(inStack.x, inStack.y);
    await page.mouse.move(inStack.x + 1, inStack.y + 1);
    await page.waitForSelector("#canvas-overlay .spacing-gap");
    const marks = await page.evaluate(() => {
      const style = (sel) => {
        const el = document.querySelector(sel);
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, w: cs.width, h: cs.height };
      };
      const band = document.querySelector("#canvas-overlay .spacing-gap");
      return {
        gap: style("#canvas-overlay .spacing-gap .spacing-bar"),
        pad: style('#canvas-overlay .spacing-padding[data-side="3"] .spacing-bar'),
        gapBandImage: getComputedStyle(band).backgroundImage,
      };
    });
    assert.deepEqual(
      marks.gap,
      { bg: "rgb(226, 87, 39)", w: "1.5px", h: "10px" },
      "gap tick is orange 1.5×10",
    );
    assert.deepEqual(marks.pad, { bg: CHIP, w: "1.5px", h: "10px" }, "padding tick is blue 1.5×10");
    assert.equal(marks.gapBandImage, "none", "gap band is not hatched at rest");
    await page.mouse.move(5, 5);

    // ---- L1: layer row actions use the app tooltip with Wonder's strings ----
    // Tooltips open on hover or keyboard focus; focus is used here because synthetic hovers race Radix's grace area.
    await seed([rect("one", 0, 0)]);
    const layerRow = page.locator('#bd-layer-tree .layer-row[data-id="one"]');
    const tooltipShows = (text) =>
      page.waitForFunction(
        (t) =>
          [...document.querySelectorAll('[data-slot="tooltip-content"]')].some(
            (e) => e.dataset.state !== "closed" && e.textContent.startsWith(t),
          ),
        text,
        { timeout: 5000 },
      );
    await layerRow.hover();
    assert.equal(
      await layerRow.locator('[data-toggle="locked"]').getAttribute("title"),
      null,
      "no native title",
    );
    await layerRow.locator('[data-toggle="locked"]').focus();
    await tooltipShows("Lock layer");
    await layerRow.locator('[data-toggle="hidden"]').focus();
    await tooltipShows("Hide layer");
    await layerRow.locator('button[aria-label^="Rename"]').focus();
    await tooltipShows("Rename layer");
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(700, 400);

    // ---- L2: inline page rename (double-click and the Rename command), Enter commits, Escape cancels ----
    await seed(
      [rect("p1", 0, 0)],
      [
        { id: "pg2", name: "Page 2", nodes: [] },
        { id: "pg3", name: "Page 3", nodes: [] },
      ],
    );
    const pageRow = (id) => page.locator(`#bd-page-list [data-page-id="${id}"]`);
    const field = page.locator('#bd-page-list input[aria-label="Page name"]');
    await pageRow("pg3").dblclick();
    await field.waitFor();
    assert.deepEqual(
      await field.evaluate((e) => [
        e.value,
        e.selectionStart,
        e.selectionEnd,
        document.activeElement === e,
      ]),
      ["Page 3", 0, 6, true],
      "field shows the name, all selected and focused",
    );
    assert.equal((await page.locator("#text-prompt").count()) > 0, false, "no modal prompt");
    await page.keyboard.type("Audit");
    await page.keyboard.press("Enter");
    await field.waitFor({ state: "detached" });
    assert.equal((await doc()).pages.find((p) => p.id === "pg3").name, "Audit", "Enter commits");
    await pageRow("pg2").dblclick();
    await field.waitFor();
    await page.keyboard.type("Nope");
    await page.keyboard.press("Escape");
    await field.waitFor({ state: "detached" });
    assert.equal((await doc()).pages.find((p) => p.id === "pg2").name, "Page 2", "Escape cancels");
    await undo();
    assert.equal(
      (await doc()).pages.find((p) => p.id === "pg3").name,
      "Page 3",
      "rename is one undo step",
    );
    // The row context menu's Rename opens the same inline field and keeps the current page active (Wonder
    // L2-rename-field / L2-renamed-confirmed: Page 1 stays active while Page 3 is renamed).
    const firstPage = (await doc()).pages[0].id;
    await page.evaluate((id) => window.design.setActivePage(id), firstPage);
    await pageRow("pg2").click({ button: "right" });
    await page.getByRole("menuitem", { name: /Rename/ }).click();
    await field.waitFor();
    await page.waitForTimeout(150);
    assert.equal(
      await field.evaluate((e) => document.activeElement === e),
      true,
      "field keeps focus after the menu closes",
    );
    await page.keyboard.type("Second");
    await page.keyboard.press("Enter");
    await field.waitFor({ state: "detached" });
    assert.equal(
      (await doc()).pages.find((p) => p.id === "pg2").name,
      "Second",
      "context-menu rename commits inline",
    );
    assert.equal(
      (await doc()).activePage,
      firstPage,
      "renaming another page from its menu does not switch pages",
    );
    assert.equal(await pageRow(firstPage).getAttribute("aria-current"), "page");
    await page.evaluate(() => window.design.runCommand("edit.undo")); // ⌘Z
    assert.deepEqual(
      [(await doc()).pages.find((p) => p.id === "pg2").name, (await doc()).activePage],
      ["Page 2", firstPage],
      "one undo step, same page",
    );
    await page.evaluate(() => window.design.runCommand("edit.redo"));
    assert.equal((await doc()).pages.find((p) => p.id === "pg2").name, "Second");

    // ---- L2: drag to reorder with a purple insertion line; persisted in pages[], one undo step ----
    const order = async () => (await doc()).pages.map((p) => p.id);
    const before = await order(),
      first = before[0];
    assert.deepEqual(before, [first, "pg2", "pg3"]);
    const from = await pageRow("pg3").boundingBox(),
      to = await pageRow(first).boundingBox();
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 40, to.y + 4, { steps: 10 });
    const line = await page.locator("#bd-page-drop-indicator").evaluate((e) => {
      const cs = getComputedStyle(e),
        r = e.getBoundingClientRect();
      return { bg: cs.backgroundColor, h: r.height, index: e.dataset.index };
    });
    assert.equal(
      await page.locator("#bd-page-drag-ghost").textContent(),
      "Page 3",
      "a drag chip follows the pointer",
    );
    await page.mouse.up();
    assert.deepEqual(
      line,
      { bg: "rgb(162, 69, 211)", h: 2, index: "0" },
      "insertion line is 2px primary above the first row",
    );
    assert.deepEqual(await order(), ["pg3", first, "pg2"], "pages reordered in the document");
    assert.deepEqual(
      await page
        .locator("#bd-page-list [data-page-id]")
        .evaluateAll((els) => els.map((e) => e.dataset.pageId)),
      ["pg3", first, "pg2"],
      "list follows the document",
    );
    assert.equal(await page.locator("#bd-page-drag-ghost").count(), 0, "drag chip removed");
    // Escape cancels a drag.
    const r2 = await pageRow("pg2").boundingBox(),
      r0 = await pageRow("pg3").boundingBox();
    await page.mouse.move(r2.x + 40, r2.y + r2.height / 2);
    await page.mouse.down();
    await page.mouse.move(r0.x + 40, r0.y + 4, { steps: 8 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.deepEqual(await order(), ["pg3", first, "pg2"], "Escape cancels the drag");
    await undo();
    assert.deepEqual(await order(), [first, "pg2", "pg3"], "reorder is one undo step");

    assert.deepEqual(errors, []);
    console.log(
      "PASS canvas wonder marks: blue guides and Alt chips, layout ticks, layer tooltips, inline page rename, page drag reorder + undo",
    );
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
