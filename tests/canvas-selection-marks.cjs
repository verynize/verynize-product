// Wonder selection marks: hidden-layer outline (CM6-hidden), constraint guides and no name label on nested layers
// (S2, CM3-text-menu), hover without child outlines (S1-hover-final), whole-number Alt distances (TR5), stack-child
// drags that follow the pointer with no drop column and no selection chrome but the name label, the parent left
// untouched until release (R1, TR7) and caret-only
// text editing (TX1-click, TX1-drag).
const { _electron } = require("@playwright/test");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-selection-marks-")),
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
    const PURPLE = "rgb(196, 104, 247)";
    const near = (actual, expected, tolerance = 1, label = "") =>
      assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} ~= ${expected}`);
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
        window.design.setCamera(100, 100, 1);
      }, nodes);
    }
    const select = (ids) => page.evaluate((ids) => window.design.setSelection(ids), ids);
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
    const boxOf = (sel) =>
      page.evaluate((sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }, sel);
    const shown = (sel) => page.locator(sel).first().isVisible();

    // ---- CM6-hidden: a selected hidden layer shows only its bounds as a 1px purple outline ----
    await seed([
      frame("board", 0, 0, 400, 300),
      rect("ghost", 500, 20, 120, 120, { hidden: true }),
    ]);
    await select(["ghost"]);
    assert.equal(await shown("#canvas-overlay .hidden-outline"), true, "hidden layer is outlined");
    const outline = await boxOf("#canvas-overlay .hidden-outline"),
      at = await screen(500, 20);
    near(outline.x, at.x, 1, "outline x");
    near(outline.y, at.y, 1, "outline y");
    near(outline.w, 120, 1, "outline w");
    near(outline.h, 120, 1, "outline h");
    assert.deepEqual(
      await page.locator("#canvas-overlay .hidden-outline").evaluate((e) => {
        const cs = getComputedStyle(e);
        return [cs.outlineWidth, cs.outlineOffset, cs.outlineColor, cs.backgroundColor];
      }),
      ["1px", "-0.5px", PURPLE, "rgba(0, 0, 0, 0)"],
      "empty 1px #c468f7 outline straddling the edge",
    );
    assert.equal(
      await page.locator("#canvas [data-id=ghost]").evaluate((e) => getComputedStyle(e).display),
      "none",
      "the layer itself stays hidden",
    );
    for (const sel of ["#selection-name", "#selection-measure", "#selection-chat-chip"])
      assert.equal(
        await shown("#canvas-overlay " + sel),
        false,
        sel + " is not drawn for a hidden layer",
      );
    await select(["board"]);
    assert.equal(
      await shown("#canvas-overlay .hidden-outline"),
      false,
      "the outline goes with the selection",
    );

    // ---- S2: a nested child gets dashed guides to the parent edges it is pinned to, and no name label ----
    await seed([
      frame("board", 0, 0, 400, 300, { clipContent: true }),
      frame("kid", 49, 40, 100, 80, { parentId: "board" }),
      rect("pinned", 0, 0, 50, 50, { parentId: "board", inset: [150, 30, null, null] }),
      {
        id: "stack",
        name: "stack",
        type: "frame",
        x: 0,
        y: 400,
        w: 300,
        h: 100,
        color: "#ffffff",
        layout: "flex",
        direction: "row",
      },
      rect("item", 0, 0, 50, 50, { parentId: "stack" }),
    ]);
    await select(["kid"]);
    const guides = () =>
      page.locator("#canvas-overlay .constraint-guide").evaluateAll((els) =>
        els.map((e) => {
          const cs = getComputedStyle(e);
          return {
            side: e.dataset.side,
            x1: +e.getAttribute("x1"),
            y1: +e.getAttribute("y1"),
            x2: +e.getAttribute("x2"),
            y2: +e.getAttribute("y2"),
            stroke: cs.stroke,
            opacity: cs.strokeOpacity,
            dash: cs.strokeDasharray,
            width: cs.strokeWidth,
          };
        }),
      );
    const wrap = await boxOf("#canvas-wrap"),
      local = async (x, y) => {
        const p = await screen(x, y);
        return { x: p.x - wrap.x, y: p.y - wrap.y };
      };
    let lines = await guides();
    assert.deepEqual(
      lines.map((l) => l.side).toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      ["left", "top"],
      "Left/Top constraints draw guides to the left and top edges",
    );
    const left = lines.find((l) => l.side === "left"),
      top = lines.find((l) => l.side === "top");
    const boardTL = await local(0, 0),
      kidTL = await local(49, 40),
      kidC = await local(99, 80);
    near(left.x1, boardTL.x, 1, "left guide starts at the parent edge");
    near(left.x2, kidTL.x, 1, "and ends at the child");
    near(left.y1, kidC.y, 1, "at the child centre line");
    near(top.y1, boardTL.y, 1, "top guide starts at the parent edge");
    near(top.y2, kidTL.y, 1, "and ends at the child");
    near(top.x1, kidC.x, 1, "at the child centre line");
    assert.ok(
      lines.every(
        (l) =>
          l.stroke === PURPLE &&
          l.opacity === "0.75" &&
          l.dash === "2.5px, 2px" &&
          l.width === "1px",
      ),
      "thin dashed purple guides: " + JSON.stringify(lines[0]),
    );
    assert.equal(
      await page.locator("#canvas-overlay .guide-label").count(),
      0,
      "no distance numbers",
    );
    assert.equal(
      await shown("#canvas-overlay #selection-name"),
      false,
      "no name label on a nested layer",
    );
    assert.equal(await shown("#canvas-overlay #selection-measure"), true, "the size badge stays");
    // Inside a clipping parent the overlay ring replaces the layer's own outline: one ring, not two.
    assert.equal(
      await page.locator("#canvas-overlay .clipped-selection .selection-ring").count(),
      1,
    );
    assert.equal(
      await page.locator("#canvas [data-id=kid]").evaluate((e) => getComputedStyle(e).outlineStyle),
      "none",
      "no second outline under the ring",
    );
    await select(["pinned"]);
    assert.deepEqual(
      (await guides()).map((l) => l.side).toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      ["right", "top"],
      "a Right constraint draws to the right edge",
    );
    await select(["item"]);
    assert.equal((await guides()).length, 0, "auto-layout children have no constraint guides");
    await select(["board"]);
    assert.equal((await guides()).length, 0, "top-level layers have none");
    assert.equal(
      await shown("#canvas-overlay #selection-name"),
      true,
      "a top-level frame keeps its name label",
    );
    // CM3-text-menu: a selected nested text has no name label either.
    await page.evaluate(() =>
      window.design.addNode("text", { text: "Canvas au", x: 82, y: 160, parentId: "board" }),
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.design
            .getDocument()
            .pages[0].nodes.find((n) => window.design.getSelection().includes(n.id))?.type,
      ),
      "text",
    );
    assert.equal(await shown("#canvas-overlay #selection-name"), false, "no name label on text");

    // ---- S1: hovering an unselected frame outlines it and tints its label, nothing else ----
    await seed([
      frame("board", 0, 0, 400, 300),
      rect("c1", 10, 10, 50, 50, { parentId: "board" }),
      rect("c2", 100, 10, 50, 50, { parentId: "board" }),
    ]);
    const over = await screen(300, 250);
    await page.mouse.move(over.x, over.y, { steps: 2 });
    await page.mouse.move(over.x + 1, over.y + 1);
    assert.equal(await page.locator("#canvas-overlay").getAttribute("data-hover"), "board");
    assert.equal(await shown("#canvas-overlay .hover-box"), true, "hovered frame is outlined");
    assert.equal(
      await page
        .locator(
          "#canvas-overlay .hover-box ~ *[class*=hover], #canvas-overlay .hover-children, #canvas-overlay .hover-child",
        )
        .count(),
      0,
      "its children are not outlined",
    );
    const label = page.locator("#canvas-overlay .frame-label[data-id=board]");
    assert.equal(
      await label.evaluate((e) => e.classList.contains("hovered")),
      true,
      "the frame label is marked hovered",
    );
    assert.equal(
      await label.evaluate((e) => getComputedStyle(e).color),
      await page
        .locator("#canvas-overlay .hover-box")
        .evaluate((e) => getComputedStyle(e).outlineColor),
      "label takes the outline purple",
    );
    // Wonder S1-hover-final / R4: 1px #c468f7 straddling the edge, axis-aligned for an unrotated frame.
    assert.deepEqual(
      await page.locator("#canvas-overlay .hover-box").evaluate((e) => {
        const cs = getComputedStyle(e);
        return [
          cs.outlineWidth,
          cs.outlineOffset,
          cs.outlineColor,
          cs.borderTopWidth,
          cs.transform,
        ];
      }),
      ["1px", "-0.5px", PURPLE, "0px", "none"],
      "hover outline is 1px #c468f7",
    );
    assert.equal(
      await label.evaluate((e) => getComputedStyle(e).color),
      PURPLE,
      "hovered label is #c468f7",
    );
    await page.mouse.move(5, 5);
    assert.equal(
      await label.evaluate((e) => e.classList.contains("hovered")),
      false,
      "the tint leaves with the pointer",
    );

    // ---- R4: hovering an unselected rotated frame turns the outline with it (not its axis-aligned bounds) ----
    await seed([frame("tilt", 100, 100, 150, 100, { rotation: -30 })]);
    const mid = await screen(175, 150);
    await page.mouse.move(mid.x, mid.y, { steps: 2 });
    await page.mouse.move(mid.x + 1, mid.y + 1);
    assert.equal(await page.locator("#canvas-overlay").getAttribute("data-hover"), "tilt");
    const tilt = await page.locator("#canvas-overlay .hover-box").evaluate((e) => ({
      transform: e.style.transform,
      w: e.offsetWidth,
      h: e.offsetHeight,
      r: e.getBoundingClientRect(),
    }));
    assert.equal(tilt.transform, "rotate(-30deg)", "hover outline rotates with the frame");
    assert.deepEqual(
      [tilt.w, tilt.h],
      [150, 100],
      "the outline keeps the frame size, not its rotated bounds",
    );
    near(tilt.r.x + tilt.r.width / 2, mid.x, 1, "rotated outline centre x");
    near(tilt.r.y + tilt.r.height / 2, mid.y, 1, "rotated outline centre y");
    await page.mouse.move(5, 5);

    // ---- R5 / S4: selection chrome on Wonder's pixels: 1px #c468f7 ring straddling the edge, 9px white handles with
    // a 1px #c468f7 border centred on the corners, badge #a245d3 ----
    await seed([frame("pick", 0, 0, 100, 60)]);
    await select(["pick"]);
    const chrome = await page.evaluate(() => {
      const el = document.querySelector("#canvas [data-id=pick]"),
        cs = getComputedStyle(el),
        h = el.querySelector(".handle[data-corner=nw]"),
        hs = getComputedStyle(h);
      const r = el.getBoundingClientRect(),
        hr = h.getBoundingClientRect(),
        badge = getComputedStyle(document.getElementById("selection-measure")),
        name = getComputedStyle(document.getElementById("selection-name"));
      return {
        ring: [cs.outlineStyle, cs.outlineWidth, cs.outlineOffset, cs.outlineColor],
        handle: [hr.width, hr.height, hs.borderTopWidth, hs.borderTopColor, hs.backgroundColor],
        centre: [hr.x + hr.width / 2 - r.x, hr.y + hr.height / 2 - r.y],
        badge: badge.backgroundColor,
        name: name.color,
      };
    });
    assert.deepEqual(chrome.ring, ["solid", "1px", "-0.5px", PURPLE], "selection ring");
    assert.deepEqual(
      chrome.handle,
      [9, 9, "1px", PURPLE, "rgb(255, 255, 255)"],
      "handle 9×9 white with a 1px purple border",
    );
    assert.deepEqual(chrome.centre, [0, 0], "handle centred on the corner");
    assert.equal(chrome.badge, "rgb(162, 69, 211)", "badge #a245d3");
    assert.equal(chrome.name, PURPLE, "name label #c468f7");
    await select([]);

    // ---- TR5: Alt distances are whole numbers ----
    await seed([rect("a", 0, 0, 100, 80), rect("b", 136.4, 0, 100, 80)]);
    await select(["a"]);
    const target = await screen(180, 40);
    await page.keyboard.down("Alt");
    await page.mouse.move(target.x, target.y);
    await page.mouse.move(target.x + 2, target.y + 2);
    const distances = await page.locator("#canvas-overlay .guide-label").allTextContents();
    await page.keyboard.up("Alt");
    assert.deepEqual(distances, ["36"], "a 36.4 px gap reads 36");
    await page.mouse.move(5, 5);

    // ---- R1 / TR7: a dragged auto-layout child follows the pointer; there is no drop column ----
    // Wonder R1 fixture: a row (padding 20, gap 20) of 100×60, 100×120 and 100×90 frames.
    const row = () => [
      frame("row", 0, 0, 380, 160, {
        layout: "flex",
        direction: "row",
        gap: 20,
        padding: 20,
        wMode: "hug",
        hMode: "hug",
      }),
      frame("k1", 0, 0, 100, 60, { parentId: "row" }),
      frame("k2", 0, 0, 100, 120, { parentId: "row" }),
      frame("k3", 0, 0, 100, 90, { parentId: "row" }),
    ];
    const kidsOf = () =>
      page.evaluate(() =>
        window.design
          .getDocument()
          .pages[0].nodes.filter((n) => n.parentId === "row")
          .map((n) => n.id),
      );
    const worldBox = (id) =>
      page.evaluate((id) => {
        const r = document.querySelector(`#canvas [data-id=${id}]`).getBoundingClientRect(),
          w = document.querySelector("#canvas-wrap").getBoundingClientRect(),
          c = window.design.getCamera();
        return {
          x: Math.round((r.x - w.x - c.x) / c.zoom),
          y: Math.round((r.y - w.y - c.y) / c.zoom),
          w: Math.round(r.width / c.zoom),
          h: Math.round(r.height / c.zoom),
        };
      }, id);
    async function held(from, to, during) {
      const a = await screen(...from),
        b = await screen(...to);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 8 });
      const seen = await during();
      await page.mouse.up();
      return seen;
    }
    // What the dragged layer shows while held: its own outline, corner handles, size badge, name label and ⊕ chip.
    const dragChrome = (id) =>
      page.evaluate((id) => {
        const el = document.querySelector(`#canvas [data-id=${id}]`),
          visible = (e) =>
            !!e && e.checkVisibility({ visibilityProperty: true }) && !e.closest("[hidden]");
        return {
          outline: getComputedStyle(el).outlineStyle,
          handles: [...el.querySelectorAll(":scope > .handle")].filter(visible).length,
          badge: visible(document.getElementById("selection-measure")),
          name: visible(document.getElementById("selection-name")),
          chip: visible(document.getElementById("selection-chat-chip")),
        };
      }, id);
    await seed(row());
    await select(["k2"]);
    // R1-row-drag-slot: dragged 120 right, the child is drawn over the last slot; its own slot stays open.
    const slot = await held([170, 80], [290, 80], async () => ({
      k1: await worldBox("k1"),
      k2: await worldBox("k2"),
      k3: await worldBox("k3"),
      kids: await kidsOf(),
      column: await page.locator("#canvas-overlay .drop-column").count(),
      parent: await shown("#canvas-overlay .drop-target"),
      chrome: await dragChrome("k2"),
      row: await worldBox("row"),
      drop: await page.evaluate(() => {
        const cs = getComputedStyle(document.querySelector("#canvas-overlay .drop-target"));
        return {
          outline: cs.outlineWidth,
          offset: cs.outlineOffset,
          color: cs.outlineColor,
          label: getComputedStyle(
            document.querySelector("#canvas-overlay .frame-label[data-id=row]"),
          ).color,
        };
      }),
    }));
    assert.deepEqual(slot.k2, { x: 260, y: 20, w: 100, h: 120 }, "the child follows the pointer");
    assert.deepEqual(
      slot.chrome,
      { outline: "none", handles: 0, badge: false, name: false, chip: false },
      "R1-row-drag-slot: the dragged child has no outline, handles, badge or label",
    );
    assert.deepEqual(
      slot.row,
      { x: 0, y: 0, w: 380, h: 160 },
      "the parent does not re-lay out while the child is held",
    );
    assert.deepEqual(
      slot.drop,
      { outline: "1px", offset: "-0.5px", color: PURPLE, label: PURPLE },
      "the parent is outlined 1px #c468f7 and its label tinted",
    );
    assert.deepEqual(
      [slot.k1, slot.k3],
      [
        { x: 20, y: 20, w: 100, h: 60 },
        { x: 260, y: 20, w: 100, h: 90 },
      ],
      "siblings keep their slots during the drag",
    );
    assert.deepEqual(slot.kids, ["k1", "k2", "k3"], "no live reorder");
    assert.equal(slot.column, 0, "no drop column");
    assert.equal(slot.parent, true, "the parent is outlined");
    assert.deepEqual(
      await kidsOf(),
      ["k1", "k2", "k3"],
      "released short of the last child's centre, it settles back into its slot",
    );
    await held([170, 80], [330, 80], async () => {});
    assert.deepEqual(
      await kidsOf(),
      ["k1", "k3", "k2"],
      "released past it, it settles into the last slot",
    );
    assert.equal(
      await page.locator("#canvas [data-id=k2]").evaluate((e) => e.style.translate),
      "",
      "the drag offset clears",
    );
    // R1-row-drag-far: dragged out below the row, the child follows the pointer and lands on the page there.
    await seed(row());
    await select(["k2"]);
    const farSeen = await held([170, 80], [220, 330], async () => ({
      k2: await worldBox("k2"),
      k1: await worldBox("k1"),
      k3: await worldBox("k3"),
      row: await worldBox("row"),
      chrome: await dragChrome("k2"),
      name: await boxOf("#canvas-overlay #selection-name"),
      ghost: await boxOf("#canvas [data-id=k2]"),
      drop: await shown("#canvas-overlay .drop-target"),
      label: await page
        .locator("#canvas-overlay .frame-label[data-id=row]")
        .evaluate((e) => e.classList.contains("hovered")),
    }));
    const far = farSeen.k2;
    assert.deepEqual(
      far,
      { x: 190, y: 270, w: 100, h: 120 },
      "the child follows the pointer out of the row",
    );
    // R1-row-drag-far: no outline, handles or badge; the purple name label rides above the dragged child.
    assert.deepEqual(
      farSeen.chrome,
      { outline: "none", handles: 0, badge: false, name: true, chip: false },
      "outside its row the dragged child shows only its name label",
    );
    near(farSeen.name.x, farSeen.ghost.x, 1, "label at the child left edge");
    near(farSeen.name.y + farSeen.name.h, farSeen.ghost.y, 4, "label just above the child");
    assert.deepEqual(
      [farSeen.k1, farSeen.k3, farSeen.row],
      [
        { x: 20, y: 20, w: 100, h: 60 },
        { x: 260, y: 20, w: 100, h: 90 },
        { x: 0, y: 0, w: 380, h: 160 },
      ],
      "the row keeps its layout and the empty slot until release",
    );
    assert.deepEqual(
      [farSeen.drop, farSeen.label],
      [false, false],
      "the row is not outlined once the child leaves it",
    );
    const out = await page.evaluate(() =>
      window.design.getDocument().pages[0].nodes.find((n) => n.id === "k2"),
    );
    assert.deepEqual(
      [out.parentId || null, out.x, out.y],
      [null, 190, 270],
      "released outside, it is a top-level layer where it was drawn",
    );
    // TR7-out-during's "column" is a marquee: a press in the gap between two children draws the marquee box.
    await seed(row());
    await select(["k2"]);
    const marquee = await held([130, 100], [190, 380], async () => ({
      box: await shown("#canvas-overlay .marquee"),
      k2: await worldBox("k2"),
    }));
    assert.equal(marquee.box, true, "dragging from the gap draws a marquee");
    assert.deepEqual(marquee.k2, { x: 140, y: 20, w: 100, h: 120 }, "no child moves");

    // ---- TX1: a text being typed shows only its caret (in its ink colour) ----
    await seed([frame("board", 0, 0, 400, 300)]);
    let p = await screen(59, 160);
    await page.evaluate(() => window.design.setTool("text"));
    await page.mouse.click(p.x, p.y);
    const editor = page.locator("#canvas [data-text-editing]");
    await editor.waitFor();
    assert.deepEqual(
      await editor.evaluate((e) => [
        getComputedStyle(e).outlineStyle,
        getComputedStyle(e).color,
        e.querySelectorAll(".handle").length,
      ]),
      ["none", "rgb(0, 0, 0)", 0],
      "no selection ring or handles; black ink (and caret, text-caret.js) on the white frame",
    );
    for (const sel of ["#selection-name", "#selection-measure", "#selection-chat-chip"])
      assert.equal(
        await shown("#canvas-overlay " + sel),
        false,
        sel + " hidden while typing a click text",
      );
    const clipChrome = () =>
      page
        .locator("#canvas-overlay .clipped-selection")
        .evaluate((e) => getComputedStyle(e).display);
    assert.equal(
      await clipChrome(),
      "none",
      "no clip-proof ring while typing (overlay attribute, not :has())",
    );
    await page.keyboard.press("Escape");
    await editor.waitFor({ state: "detached" });
    assert.notEqual(await clipChrome(), "none", "the clip-proof ring layer returns after typing");
    p = await screen(515, 47);
    await page.evaluate(() => window.design.setTool("text"));
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 150, p.y + 60, { steps: 6 });
    await page.mouse.up();
    await editor.waitFor();
    assert.deepEqual(
      await editor.evaluate((e) => [getComputedStyle(e).outlineStyle, getComputedStyle(e).color]),
      ["none", "rgb(255, 255, 255)"],
      "a drag box on the dark page: no ring, white ink",
    );
    assert.equal(await shown("#canvas-overlay #selection-name"), false, 'no "Text" label');
    assert.equal(await shown("#canvas-overlay #selection-measure"), false, "no size badge");
    assert.equal(
      await shown("#canvas-overlay #selection-chat-chip"),
      true,
      "the ⊕ chip stays for a fixed box (TX1-drag)",
    );
    await page.keyboard.type("Hi");
    await page.keyboard.press("Escape");
    await editor.waitFor({ state: "detached" });
    assert.equal(
      await shown("#canvas-overlay #selection-measure"),
      true,
      "the badge returns when editing ends",
    );
    assert.equal(
      await page
        .locator("#canvas .layer.selected")
        .evaluate((e) => getComputedStyle(e).outlineStyle),
      "solid",
      "and the selection ring",
    );

    assert.deepEqual(errors, []);
    // Wonder S4-frame-ready: a selected Clip content frame shows whole 9px corner handles straddling its corners; the
    // frame's own clip must not cut them to a quarter. The pixel just outside the top-left corner belongs to a handle.
    await seed([frame("clipper", 0, 0, 300, 270, { clipContent: true })]);
    await select(["clipper"]);
    await page.waitForTimeout(150);
    const corner = await screen(0, 0);
    const outside = await page.evaluate(
      ([x, y]) =>
        document
          .elementsFromPoint(x - 3, y - 3)
          .some((e) => e.classList.contains("handle") && e.getBoundingClientRect().width >= 8.5),
      [corner.x, corner.y],
    );
    assert.ok(outside, "a Clip content frame keeps whole corner handles outside its edge");
    console.log(
      "PASS canvas selection marks: hidden-layer outline, nested constraint guides without labels, single clipped ring, hover outline + label only, whole-number Alt distances, stack drag follows the pointer without a drop column, caret-only text editing, whole handles on a Clip content frame",
    );
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
