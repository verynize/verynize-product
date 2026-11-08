// Selection chrome and transform gestures (Wonder S4, TR1, TR2, T4): size badge text, the add-to-chat chip, the
// multi-selection union box, rotate zones outside the corners, edge resize with Shift / Alt, and the Scale tool's
// proportional factor.
const { _electron } = require("@playwright/test");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const assert = require("node:assert/strict");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-transform-")),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1"; env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${dir}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 }); await moveOffCursor(app);
    const installTrace = () => {
      window.__inputTrace = [];
      for (const type of [
        "pointerdown",
        "pointermove",
        "pointerup",
        "pointercancel",
        "lostpointercapture",
        "focus",
        "blur",
      ]) {
        window.addEventListener(
          type,
          (e) => {
            const event = {
              type,
              target: e.target === window ? "window" : e.target.tagName,
              id: e.target.id,
              classes: typeof e.target.className === "string" ? e.target.className : "",
              x: e.clientX,
              y: e.clientY,
              buttons: e.buttons,
              focused: document.hasFocus(),
              camera: window.design?.getCamera(),
              transforming: document
                .querySelector("#workspace")
                ?.classList.contains("transforming"),
              at: performance.now(),
            };
            (window.__inputTrace ||= []).push(event);
          },
          true,
        );
      }
    };
    if (process.env.TRANSFORM_TRACE) {
      await page.addInitScript(installTrace);
      await page.evaluate(installTrace);
    }
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await waitForUiReady(page);
    await page.waitForSelector("#canvas .layer");
    const near = (actual, expected, tolerance = 1.5, label = "") =>
      assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} ~= ${expected}`);
    const node = (id) =>
      page.evaluate(
        (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id),
        id,
      );
    const rect = (id, x, y, w, h, extra = {}) => ({
      id,
      name: "Card " + id,
      type: "rectangle",
      x,
      y,
      w,
      h,
      color: "#8844cc",
      ...extra,
    });
    async function seed(nodes, selection) {
      await page.evaluate(
        ([nodes, selection]) => {
          const d = window.design.getDocument();
          d.pages = [{ id: d.pages[0].id, name: "Desktop", nodes }];
          d.activePage = d.pages[0].id;
          window.design.setDocument(d);
          window.design.setTool("move");
          window.design.setCamera(100, 100, 1);
          window.design.setSelection(selection);
        },
        [nodes, selection],
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
    const center = async (selector) => {
      const b = await page.locator(selector).boundingBox();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    // Native/CDP input can interleave with capture-loss events from other Electron windows.
    // Exercise the real hit testing and canvas handlers in one renderer task so OS focus does
    // not truncate this geometry test. Other canvas suites retain native Playwright mouse input.
    // Synthetic pointers do not acquire native capture; track() already handles that case.
    async function dragFrom(from, dx, dy, { modifier, measureGuides = false, cancel } = {}) {
      if (process.env.TRANSFORM_STEAL_FOCUS) {
        await app.evaluate(({ BrowserWindow }) => {
          const thief = new BrowserWindow({ width: 200, height: 100 });
          thief.focus();
          global.__transformThief?.destroy();
          global.__transformThief = thief;
        });
      }
      return page.evaluate(
        ({ from, dx, dy, modifier, measureGuides, cancel }) => {
          const send = (type, x, y, buttons) => {
            const target =
              document.elementFromPoint(x, y) || document.querySelector("#canvas-wrap");
            target.dispatchEvent(
              new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
                button: type === "pointermove" ? -1 : 0,
                buttons,
                clientX: x,
                clientY: y,
                shiftKey: modifier === "Shift",
                altKey: modifier === "Alt",
              }),
            );
          };
          send("pointermove", from.x, from.y, 0);
          send("pointerdown", from.x, from.y, 1);
          for (let step = 1; step <= 8; step++) {
            send("pointermove", from.x + (dx * step) / 8, from.y + (dy * step) / 8, 1);
            if (step === 4 && cancel === "blur") window.dispatchEvent(new Event("blur"));
            if (step === 4 && cancel === "lostpointercapture")
              document
                .querySelector("#canvas-wrap")
                .dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 1 }));
          }
          const seen = measureGuides
            ? document.querySelectorAll("#canvas-overlay .guide").length
            : undefined;
          send("pointerup", from.x + dx, from.y + dy, 0);
          return seen;
        },
        { from, dx, dy, modifier, measureGuides, cancel },
      );
    }

    // ---------- S4: badge text, size and gap; the ⊕ chip ----------
    await seed(
      [
        rect("a", 200, 200, 100, 70),
        {
          id: "hug",
          name: "Hug text",
          type: "text",
          x: 400,
          y: 200,
          w: 80,
          h: 20,
          text: "Canvas",
          fontSize: 12,
          color: "#ffffff",
          wMode: "hug",
          hMode: "hug",
        },
      ],
      ["a"],
    );
    assert.equal(
      await page.locator("#selection-measure").textContent(),
      "100 x 70",
      "W x H with a lowercase x and no Fixed",
    );
    const badge = await page.locator("#selection-measure").boundingBox(),
      box = await page.locator("#canvas [data-id=a]").boundingBox();
    near(badge.height, 22, 1, "badge height");
    near(badge.y - (box.y + box.height), 10, 1.5, "badge gap below the box");
    near(badge.x + badge.width / 2, box.x + box.width / 2, 1, "badge centred");
    const chip = page.locator("#selection-chat-chip");
    assert.ok(await chip.isVisible(), "the add-to-chat chip shows on a selection");
    assert.equal(await chip.getAttribute("aria-label"), "Add selection to chat");
    const cb = await chip.boundingBox();
    assert.ok(
      cb.y + cb.height < box.y &&
        cb.x + cb.width <= box.x + box.width + 1 &&
        cb.x > box.x + box.width - 24,
      `chip sits above the top-right corner (${JSON.stringify(cb)} vs ${JSON.stringify(box)})`,
    );
    await page.evaluate(() => window.design.setSelection(["hug"]));
    assert.match(
      await page.locator("#selection-measure").textContent(),
      /^[\d.]+ Hug x [\d.]+ Hug$/,
      "Hug reads on both axes",
    );
    // The chip runs the add-to-chat action: the chat opens with the selection as a mention.
    await page.evaluate(() => window.design.setSelection(["a"]));
    await chip.click();
    await page.waitForFunction(() => document.body.classList.contains("agent-chat-open"));
    assert.deepEqual(
      await page.evaluate(() => window.design.getSelection()),
      ["a"],
      "clicking the chip keeps the selection",
    );
    await page.evaluate(() => window.agentWorkspace.closeChat());

    // ---------- Multi-selection: one union box with handles and a combined badge ----------
    await seed([rect("a", 200, 200, 100, 70), rect("b", 400, 300, 50, 40)], ["a", "b"]);
    const union = page.locator("#canvas-overlay .selection-union");
    assert.ok(await union.isVisible(), "a union box surrounds the multi-selection");
    const ub = await union.boundingBox(),
      tl = await screen(200, 200),
      br = await screen(450, 340);
    near(ub.x, tl.x, 1);
    near(ub.y, tl.y, 1);
    near(ub.width, br.x - tl.x, 1);
    near(ub.height, br.y - tl.y, 1);
    assert.equal(await union.locator(".union-handle").count(), 4);
    assert.equal(
      await page.locator("#selection-measure").textContent(),
      "250 x 140",
      "one badge for the union",
    );
    assert.equal(
      await page.locator("#canvas .layer > .handle:visible").count(),
      0,
      "no per-node handles in a multi-selection",
    );
    assert.ok(
      await page.locator(".selection-union #selection-chat-chip").isVisible(),
      "the chip sits on the union box",
    );

    // ---------- TR2: dragging just outside a corner rotates around the centre ----------
    await seed([rect("a", 200, 200, 100, 70)], ["a"]);
    const c = await screen(250, 235),
      se = await screen(300, 270);
    const start = { x: se.x + 8, y: se.y + 8 };
    assert.ok(
      await page.evaluate(
        ([x, y]) => !!document.elementFromPoint(x, y)?.closest(".rotate-zone"),
        [start.x, start.y],
      ),
      "a rotate zone sits just outside the corner",
    );
    const target = { x: c.x + 60, y: c.y - 50 }; // pointer swings counter-clockwise around the centre
    await dragFrom(start, target.x - start.x, target.y - start.y);
    const expected =
      ((Math.atan2(target.y - c.y, target.x - c.x) - Math.atan2(start.y - c.y, start.x - c.x)) *
        180) /
      Math.PI;
    let a = await node("a");
    near(a.rotation, expected, 0.5, "rotation follows the pointer angle");
    assert.deepEqual([a.w, a.h], [100, 70], "rotation keeps the size");
    near(a.x, 200, 0.01);
    near(a.y, 200, 0.01);
    near(
      Number(await page.locator("[name=rotation]").inputValue()),
      a.rotation,
      0.01,
      "inspector shows the rotation",
    );
    // The label, chip and badge turn with the node (by a multiple of 90°, within ±45°).
    const turn = await page
      .locator("#canvas-overlay .sel-text-box")
      .evaluate((el) => el.style.transform);
    assert.match(turn, /rotate\(-?[\d.]+deg\)/);
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    assert.equal((await node("a")).rotation || 0, 0, "one undo step");
    // Shift snaps to 15°.
    await dragFrom(start, target.x - start.x, target.y - start.y, { modifier: "Shift" });
    a = await node("a");
    assert.equal(Math.abs(a.rotation % 15), 0, `Shift snaps to 15° (${a.rotation})`);
    assert.ok(a.rotation > -180 && a.rotation <= 180);

    // ---------- TR1: edge resize, Shift aspect, Alt from the centre, no distance guides ----------
    await seed([rect("a", 200, 200, 100, 70), rect("far", 600, 200, 40, 40)], ["a"]);
    await dragFrom(await center("#canvas-overlay .resize-edge[data-edge=e]"), 40, 25);
    a = await node("a");
    assert.deepEqual(
      [a.x, a.y, a.w, a.h],
      [200, 200, 140, 70],
      "right edge changes only the width",
    );
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    await dragFrom(await center("#canvas-overlay .resize-edge[data-edge=n]"), 0, -30);
    a = await node("a");
    assert.deepEqual(
      [a.x, a.y, a.w, a.h],
      [200, 170, 100, 100],
      "top edge keeps the bottom edge in place",
    );
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    await dragFrom(await center("#canvas-overlay .resize-edge[data-edge=e]"), 50, 0, {
      modifier: "Shift",
    });
    a = await node("a");
    near(a.w, 150, 0.01);
    near(a.h, 105, 0.01, "Shift keeps the aspect ratio");
    near(a.x, 200, 0.01);
    near(a.y, 182.5, 0.01, "the other axis grows around the centre");
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    await page.mouse.move((await screen(620, 220)).x, (await screen(620, 220)).y); // hover a sibling: Alt would measure to it
    const guides = await dragFrom(
      await center("#canvas-overlay .resize-edge[data-edge=e]"),
      20,
      0,
      { modifier: "Alt", measureGuides: true },
    );
    a = await node("a");
    assert.deepEqual([a.x, a.w, a.h], [180, 140, 70], "Alt resizes from the centre");
    assert.equal(guides, 0, "no distance guides during a resize");
    await page.evaluate(() => window.design.runCommand("edit.undo"));

    // Interrupting a real gesture must still finish at the last applied position, with one undo.
    // The harness isolates native focus; it does not remove the product's cancellation policy.
    for (const cancel of ["blur", "lostpointercapture"]) {
      await seed([rect("cancel", 200, 200, 100, 70)], ["cancel"]);
      await dragFrom(await center("#canvas-overlay .resize-edge[data-edge=e]"), 40, 0, { cancel });
      assert.equal((await node("cancel")).w, 120, `${cancel} ends at the halfway point`);
      await page.evaluate(() => window.design.runCommand("edit.undo"));
      assert.equal((await node("cancel")).w, 100, `${cancel} keeps a single undo step`);
    }

    // ---------- T4: the Scale tool scales by the drag projected on the diagonal ----------
    await seed(
      [
        { id: "f", name: "Frame", type: "frame", x: 200, y: 200, w: 100, h: 70, color: "#ffffff" },
        {
          id: "t",
          name: "Label",
          type: "text",
          parentId: "f",
          x: 10,
          y: 10,
          w: 60,
          h: 20,
          text: "Hi",
          fontSize: 10,
          color: "#000000",
        },
      ],
      ["f"],
    );
    await page.evaluate(() => window.design.runCommand("tool.scale"));
    // Wonder: 100×70 → 150×105 (150 %) on a diagonal drag.
    await dragFrom(await center("#canvas [data-id=f] > .handle[data-corner=se]"), 50, 35);
    let f = await node("f");
    near(f.w, 150, 0.05);
    near(f.h, 105, 0.05, "Wonder 100×70 → 150×105");
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    // A mostly horizontal drag uses the projected factor, not the larger axis factor (which would give 150).
    await dragFrom(await center("#canvas [data-id=f] > .handle[data-corner=se]"), 50, 5);
    f = await node("f");
    const k = (150 * 100 + 75 * 70) / (100 * 100 + 70 * 70);
    near(f.w, 100 * k, 0.05);
    near(f.h, 70 * k, 0.05, "diagonal-projected factor");
    const t = await node("t");
    near(t.fontSize, 10 * k, 0.05, "child type scales with the factor");
    near(t.w, 60 * k, 0.05);
    await page.evaluate(() => window.design.runCommand("tool.move"));

    // ---------- T4: the Scale section (Wonder T4-scale-retry: Scale ✕, W 150 | H 105, 150 %) ----------
    await seed(
      [
        { id: "f", name: "Frame", type: "frame", x: 200, y: 200, w: 100, h: 70, color: "#ffffff" },
        {
          id: "t",
          name: "Label",
          type: "text",
          parentId: "f",
          x: 10,
          y: 10,
          w: 60,
          h: 20,
          text: "Hi",
          fontSize: 10,
          color: "#000000",
        },
      ],
      ["f"],
    );
    assert.equal(
      await page.locator("#scale-section").count(),
      0,
      "no Scale section with the Move tool",
    );
    await page.evaluate(() => window.design.runCommand("tool.scale"));
    await page.locator("#scale-section").waitFor();
    assert.equal(
      await page.locator("#insp-properties [name=x]").isVisible(),
      false,
      "the Scale section replaces the other sections",
    );
    const scaleField = (name) => page.locator(`#scale-section [name=${name}]`);
    assert.deepEqual(
      [
        await scaleField("scaleW").inputValue(),
        await scaleField("scaleH").inputValue(),
        await scaleField("scalePercent").inputValue(),
      ],
      ["100", "70", "100"],
    );
    const sw = await scaleField("scaleW")
      .locator("xpath=ancestor::*[@data-field-shell][1]")
      .boundingBox();
    const sp = await scaleField("scalePercent")
      .locator("xpath=ancestor::*[@data-field-shell][1]")
      .boundingBox();
    near(sw.width, 124, 1, "W field width");
    near(sp.width, 256, 1, "% field spans both columns");
    near(sp.y - sw.y, 32, 0.5, "rows 8px apart");
    // A Scale-tool drag reads 150 % against the size the section opened with.
    await dragFrom(await center("#canvas [data-id=f] > .handle[data-corner=se]"), 50, 35);
    await page
      .waitForFunction(
        () => document.querySelector("#scale-section [name=scaleW]")?.value === "150",
        null,
        { timeout: 3000 },
      )
      .catch(() => {});
    assert.deepEqual(
      [
        await scaleField("scaleW").inputValue(),
        await scaleField("scaleH").inputValue(),
        await scaleField("scalePercent").inputValue(),
      ],
      ["150", "105", "150"],
    );
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    // Typing a percentage scales the layer and its content like the tool, in one undo step.
    await scaleField("scalePercent").fill("200");
    await scaleField("scalePercent").press("Enter");
    f = await node("f");
    assert.deepEqual([f.x, f.y, f.w, f.h], [200, 200, 200, 140], "200 % keeps the top-left corner");
    let label = await node("t");
    assert.deepEqual(
      [label.x, label.y, label.w, label.h, label.fontSize],
      [20, 20, 120, 40, 20],
      "children and type scale too",
    );
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    f = await node("f");
    label = await node("t");
    assert.deepEqual(
      [f.w, f.h, label.fontSize],
      [100, 70, 10],
      "one undo step restores the layer and its content",
    );
    // W (or H) scales proportionally.
    await scaleField("scaleW").fill("150");
    await scaleField("scaleW").press("Enter");
    f = await node("f");
    assert.deepEqual([f.w, f.h], [150, 105]);
    assert.equal(await scaleField("scalePercent").inputValue(), "150");
    await scaleField("scaleH").fill("35");
    await scaleField("scaleH").press("Enter");
    f = await node("f");
    assert.deepEqual([f.w, f.h], [50, 35]);
    assert.equal(await scaleField("scalePercent").inputValue(), "50");
    // Wonder R2-single-presets: the chevron menu lists nine multipliers of the reference size.
    await page.locator('#scale-section [aria-label="Scale presets"]').click();
    const presetMenu = page.locator("[role=menu]:has([data-scale-preset])");
    await presetMenu.waitFor();
    await page.waitForTimeout(300); // open animation (zoom-in-95)
    assert.deepEqual(
      (await presetMenu.locator("[data-scale-preset]").allTextContents()).map((s) => s.trim()),
      ["0.25×", "0.5×", "0.75×", "1×", "2×", "3×", "4×", "5×", "10×"],
    );
    const pm = await presetMenu.boundingBox(),
      row = await presetMenu.locator("[data-scale-preset]").first().boundingBox();
    near(pm.width, 152, 1, "preset menu width");
    near(row.height, 25, 0.5, "preset row pitch");
    near(pm.x + pm.width, sp.x + sp.width, 2, "menu right-aligned with the % field");
    await presetMenu.locator('[data-scale-preset="2"]').click();
    f = await node("f");
    assert.deepEqual([f.w, f.h], [200, 140], "2× scales to twice the reference size");
    assert.equal(await scaleField("scalePercent").inputValue(), "200");
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    // ✕ leaves the Scale tool and restores the regular inspector.
    await page.locator("#scale-close").click();
    await page.locator("#scale-section").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => window.design.getTool()), "move");
    assert.equal(await page.locator("#insp-properties [name=x]").isVisible(), true);

    // ---------- R2: Scale with several layers scales the union (Wonder R2-multi-scale-before/after) ----------
    // 100×60 and 100×120 frames 40 apart: union 240×120 → 360×180, frames 150×90 and 150×180, gap 60, all content too.
    await seed(
      [
        { id: "m1", name: "Frame", type: "frame", x: 0, y: 0, w: 100, h: 60, color: "#ffffff" },
        { id: "m2", name: "Frame", type: "frame", x: 140, y: 0, w: 100, h: 120, color: "#ffffff" },
        {
          id: "mt",
          name: "Label",
          type: "text",
          parentId: "m2",
          x: 10,
          y: 10,
          w: 60,
          h: 20,
          text: "Hi",
          fontSize: 12,
          color: "#000000",
        },
      ],
      ["m1", "m2"],
    );
    await page.evaluate(() => window.design.runCommand("tool.scale"));
    await page.locator("#scale-section").waitFor();
    assert.deepEqual(
      [
        await scaleField("scaleW").inputValue(),
        await scaleField("scaleH").inputValue(),
        await scaleField("scalePercent").inputValue(),
      ],
      ["100", "60", "100"],
      "W/H read the primary layer",
    );
    assert.equal(await page.locator("#selection-measure").textContent(), "240 x 120");
    await dragFrom(
      await center("#canvas-overlay .selection-union > .union-handle[data-corner=se]"),
      120,
      60,
    );
    const [m1, m2, mt] = [await node("m1"), await node("m2"), await node("mt")];
    assert.deepEqual([m1.x, m1.y, m1.w, m1.h], [0, 0, 150, 90], "first frame 150×90 at the anchor");
    assert.deepEqual(
      [m2.x, m2.y, m2.w, m2.h],
      [210, 0, 150, 180],
      "second frame 150×180, gap 40 → 60",
    );
    assert.deepEqual(
      [mt.x, mt.y, mt.w, mt.fontSize],
      [15, 15, 90, 18],
      "children and type scale too",
    );
    assert.equal(await page.locator("#selection-measure").textContent(), "360 x 180");
    await page
      .waitForFunction(
        () => document.querySelector("#scale-section [name=scaleW]")?.value === "150",
        null,
        { timeout: 3000 },
      )
      .catch(() => {});
    assert.deepEqual(
      [
        await scaleField("scaleW").inputValue(),
        await scaleField("scaleH").inputValue(),
        await scaleField("scalePercent").inputValue(),
      ],
      ["150", "90", "150"],
    );
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    assert.deepEqual(
      [(await node("m2")).x, (await node("m2")).w, (await node("mt")).fontSize],
      [140, 100, 12],
      "one undo step",
    );
    // The top-left corner handle scales about the bottom-right; the inspector scales about the union's top-left.
    await dragFrom(
      await center("#canvas-overlay .selection-union > .union-handle[data-corner=nw]"),
      120,
      60,
    );
    let n1 = await node("m1"),
      n2 = await node("m2");
    assert.deepEqual(
      [n1.x, n1.y, n1.w, n1.h, n2.x, n2.y, n2.w, n2.h],
      [120, 60, 50, 30, 190, 60, 50, 60],
      "nw drag keeps the bottom-right corner",
    );
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    await scaleField("scalePercent").fill("200");
    await scaleField("scalePercent").press("Enter");
    n1 = await node("m1");
    n2 = await node("m2");
    assert.deepEqual(
      [n1.x, n1.w, n2.x, n2.w, n2.h],
      [0, 200, 280, 200, 240],
      "200 % scales every layer about the union top-left",
    );
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    // With the Move tool the union corners stay marks only.
    await page.evaluate(() => window.design.runCommand("tool.move"));
    await page.locator("#scale-section").waitFor({ state: "detached" });
    assert.equal(
      await page
        .locator("#canvas-overlay .selection-union > .union-handle[data-corner=se]")
        .evaluate((e) => getComputedStyle(e).pointerEvents),
      "none",
    );

    // ---------- TR2: the rotation field shows "-47.19" in full (Wonder TR2-rotate-verified) ----------
    await seed([rect("r", 150, 300, 100, 70, { rotation: -47.19 })], ["r"]);
    const rotation = await page
      .locator("[name=rotation]")
      .evaluate((el) => ({ value: el.value, fits: el.scrollWidth <= el.clientWidth }));
    assert.deepEqual(rotation, { value: "-47.19", fits: true }, "rotation value is not truncated");

    // ---------- V3: zoom to selection leaves Wonder's margins (V3-selection: 120×120 → 538 % in an 880×830 view) ----------
    await seed([rect("z", 515, -133, 120, 120)], ["z"]);
    await page.evaluate(() => window.design.runCommand("view.selection"));
    const view = await page.evaluate(() => {
      const r = document.querySelector("#canvas-wrap").getBoundingClientRect();
      return { w: r.width, h: r.height, zoom: window.design.getCamera().zoom };
    });
    near(
      view.zoom,
      Math.min((view.w - 58) / 120, (view.h - 184) / 120),
      0.001,
      "zoom to selection: 29px sides, 64px top, 120px bottom",
    );
    const zr = await page.locator("#canvas [data-id=z]").boundingBox(),
      wrapBox = await page.locator("#canvas-wrap").boundingBox();
    near(zr.y - wrapBox.y, 64, 1, "selection sits 64px below the top edge");

    assert.deepEqual(errors, []);
    if (process.env.TRANSFORM_TRACE)
      console.log(JSON.stringify(await page.evaluate(() => window.__inputTrace || [])));
    console.log(
      "canvas transform: PASS badge text and gap, chat chip, multi-selection box, rotate zones with Shift snap, edge resize with Shift/Alt and no guides, proportional Scale tool, Scale section and presets, multi-selection Scale, rotation field width, zoom-to-selection margins",
    );
  } catch (error) {
    if (process.env.TRANSFORM_TRACE)
      console.error(
        JSON.stringify(await (await app.firstWindow()).evaluate(() => window.__inputTrace || [])),
      );
    throw error;
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
