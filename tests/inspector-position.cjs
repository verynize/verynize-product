// Position section tools (properties-audit C1/B4): the header absolute toggle, single-child align to parent,
// flip in the third tool group (distribute only for 3+ layers), the constraint menu, the diagram and Z "Auto".
const { _electron } = require("@playwright/test");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const { mod } = require("./helpers/keys.cjs");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inspector-position-")),
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
    await waitForUiReady(page);
    const node = (id) =>
      page.evaluate(
        (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id),
        id,
      );
    const near = (a, b, label, t = 0.6) =>
      assert.ok(Math.abs(a - b) <= t, `${label}: ${a} ~= ${b}`);
    // Rendered box relative to the parent's border box, in world units.
    const box = (id) =>
      page.evaluate((id) => {
        const el = document.querySelector(`#canvas [data-id="${id}"]`),
          p = el.parentElement.closest(".layer"),
          z = window.design.getCamera().zoom;
        const r = el.getBoundingClientRect(),
          q = p.getBoundingClientRect();
        return {
          x: (r.left - q.left) / z,
          y: (r.top - q.top) / z,
          w: r.width / z,
          h: r.height / z,
        };
      }, id);
    async function seed(nodes, select) {
      await page.evaluate(
        ([nodes, select]) => {
          const d = window.design.getDocument();
          d.pages = [{ id: d.pages[0].id, name: "Desktop", nodes }];
          d.activePage = d.pages[0].id;
          window.design.setDocument(d);
          window.design.setSelection(select);
          window.design.setTool("move");
          window.design.setCamera(80, 80, 1);
        },
        [nodes, select],
      );
    }
    // A computed colour as 'rgb(r, g, b)' (color-mix() tokens compute to color(srgb …)).
    const rgb = (locator, prop = "backgroundColor", pseudo = null) =>
      locator.evaluate(
        (el, [prop, pseudo]) => {
          const c = document.createElement("canvas").getContext("2d");
          c.fillStyle = getComputedStyle(el, pseudo)[prop];
          c.fillRect(0, 0, 1, 1);
          const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
          return `rgb(${r}, ${g}, ${b})`;
        },
        [prop, pseudo],
      );
    const section = page.locator("#position-section");
    const toggle = section.locator("#position-absolute");
    const selectH = section.locator("select[name=constraintH]");

    // A flex stack with a 2px border and two in-flow children.
    const stack = {
      id: "s",
      name: "Stack",
      type: "frame",
      x: 0,
      y: 0,
      w: 300,
      h: 200,
      color: "#ffffff",
      layout: "flex",
      direction: "column",
      gap: 8,
      padding: 10,
      strokeWidth: 2,
      strokeColor: "#000000",
    };
    const a = {
      id: "a",
      name: "a",
      type: "rectangle",
      parentId: "s",
      x: 0,
      y: 0,
      w: 100,
      h: 40,
      color: "#8844cc",
    };
    const b = {
      id: "b",
      name: "b",
      type: "rectangle",
      parentId: "s",
      x: 0,
      y: 0,
      w: 60,
      h: 30,
      color: "#44aa88",
    };
    await seed([stack, a, b], ["s"]);

    // Top-level: no absolute toggle, alignment dimmed, flip enabled in place of distribute, Z reads Auto.
    assert.equal(await toggle.count(), 0, "top-level layers have no absolute toggle");
    assert.equal(
      await section.locator("#position-fit-content").count(),
      1,
      "the expand tool is in the header",
    );
    assert.equal(
      await section.locator("#precision-left").isDisabled(),
      true,
      "top-level alignment is dimmed",
    );
    assert.equal(
      await section.locator("#position-flip-h").isEnabled(),
      true,
      "flip horizontal is in the third group",
    );
    assert.equal(
      await section.locator("#precision-horizontal").count(),
      0,
      "distribute is hidden below 3 layers",
    );
    assert.equal(await section.locator("[name=zIndex]").getAttribute("placeholder"), "Auto");
    assert.equal(
      await section.locator("[name=zIndex]").isDisabled(),
      false,
      "top-level Z is editable",
    );
    const zColor = await rgb(section.locator("[name=zIndex]"), "color", "::placeholder");
    assert.equal(zColor, "rgb(232, 232, 232)", 'Z "Auto" reads as a value, not a dim placeholder');

    // In-flow child: toggle off, constraints and alignment disabled, Z dimmed.
    await page.evaluate(() => window.design.setSelection(["b"]));
    assert.equal(
      await toggle.getAttribute("aria-pressed"),
      "false",
      "in-flow child: absolute toggle off",
    );
    assert.equal(await selectH.isDisabled(), true, "in-flow child: constraints disabled");
    assert.equal(
      await section.locator("#precision-left").isDisabled(),
      true,
      "in-flow child: the flow places it, so no align",
    );
    assert.equal(
      await section.locator("[name=zIndex]").isDisabled(),
      true,
      "in-flow child: Z dimmed",
    );
    assert.equal(
      await rgb(section.locator("[data-constraint-menu=h]")),
      "rgb(36, 36, 36)",
      "disabled constraint field is #242424",
    );
    assert.equal(
      await rgb(section.locator("[role=group][aria-label=Constraints]")),
      "rgb(54, 54, 54)",
      "disabled diagram well is #363636",
    );
    assert.equal(
      await rgb(section.locator('[data-constraint="h-start"] span')),
      "rgb(83, 83, 83)",
      "disabled ticks are flat grey #535353",
    );
    assert.equal(
      await section
        .locator("[data-constraint-menu=h]")
        .evaluate((el) => getComputedStyle(el).opacity),
      "1",
      "no extra dimming on top of the disabled colours",
    );

    // Absolute toggle: writes position absolute without moving the layer, and enables the constraints.
    const before = await box("b");
    await toggle.click();
    let n = await node("b");
    assert.equal(n.position, "absolute", "the toggle writes position: absolute");
    const after = await box("b");
    near(after.x, before.x, "turning absolute keeps x");
    near(after.y, before.y, "and y");
    near(n.x, before.x, "x reads the offset from the border box");
    near(n.y, before.y, "y too");
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    assert.equal(await selectH.isDisabled(), false, "absolute children have constraints");
    assert.equal(
      await rgb(section.locator("[role=group][aria-label=Constraints]")),
      "rgb(43, 43, 43)",
      "enabled diagram well is #2b2b2b",
    );
    const tickEl = section.locator('[data-constraint="h-start"] span');
    const tick = await tickEl.evaluate((el) => ({
      h: el.getBoundingClientRect().height,
      w: el.getBoundingClientRect().width,
    }));
    assert.deepEqual(
      { ...tick, c: await rgb(tickEl) },
      { c: "rgb(162, 69, 211)", h: 2, w: 12 },
      "active tick: 2×12 purple",
    );
    // The flow re-flows without it: 'a' is alone now, so its position does not change, and b no longer counts.
    assert.equal(
      await section.locator("[name=zIndex]").isDisabled(),
      false,
      "absolute child: Z editable",
    );

    // Constraint menu: Wonder lists Left / Right with a check on the current one.
    await section.locator("[data-constraint-menu=h]").click();
    const items = page.locator("[data-constraint-option]");
    assert.deepEqual(
      await items.allTextContents(),
      ["Left", "Right"],
      "menu offers Left and Right",
    );
    await page.locator("[data-constraint-option=end]").click();
    assert.equal(await selectH.inputValue(), "end", "choosing Right pins the right edge");
    near((await box("b")).x, after.x, "without moving the layer");

    // Single child align to its parent (border box 300 wide with a 2px border: right edge at 300 - 2 - 60).
    assert.equal(
      await section.locator("#precision-left").isEnabled(),
      true,
      "one positioned child: align enabled",
    );
    await section.locator("#precision-right").click();
    near(
      (await box("b")).x,
      300 - 2 - 60,
      "align right puts it against the inside of the right border",
    );
    assert.equal((await node("b")).inset?.[1], 0, "and keeps its Right constraint at a 0 inset");
    await section.locator("#precision-middle").click();
    near((await box("b")).y, (200 - 30) / 2, "align middle centres it vertically");
    await section.locator("#precision-left").click();
    near((await box("b")).x, 2, "align left puts it inside the left border");
    await page.keyboard.press(mod("z"));
    near((await box("b")).x, 300 - 2 - 60, "one undo step per align");

    // Flip toggles flipX / flipY on the selection.
    await section.locator("#position-flip-h").click();
    assert.equal((await node("b")).flipX, true, "flip horizontal sets flipX");
    await section.locator("#position-flip-v").click();
    assert.equal((await node("b")).flipY, true, "flip vertical sets flipY");
    await section.locator("#position-flip-h").click();
    assert.equal((await node("b")).flipX, undefined, "flipping again clears it");

    // Toggle back into the flow: position and insets are removed, constraints disabled again.
    await toggle.click();
    n = await node("b");
    assert.equal(n.position, undefined, "toggling off removes position");
    assert.equal(n.inset, undefined, "and the insets");
    assert.equal(await selectH.isDisabled(), true);
    near((await box("b")).y, 2 + 10 + 40 + 8, "b is back in the flow under a");

    // Child of a free frame: always positioned, so the toggle shows on and is disabled; align targets the parent.
    await seed(
      [
        {
          id: "p",
          name: "Parent",
          type: "frame",
          x: 0,
          y: 0,
          w: 400,
          h: 300,
          color: "#ffffff",
          layout: "free",
        },
        {
          id: "c",
          name: "Child",
          type: "rectangle",
          parentId: "p",
          x: 30,
          y: 40,
          w: 80,
          h: 60,
          color: "#8844cc",
        },
      ],
      ["c"],
    );
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    assert.equal(await toggle.isDisabled(), true, "free-frame children are always absolute");
    await section.locator("#precision-center").click();
    near((await node("c")).x, (400 - 80) / 2, "align horizontal centre to parent");
    await section.locator("#precision-bottom").click();
    near((await node("c")).y, 300 - 60, "align bottom to parent");

    // Expand (resize to fit content): the free frame takes its children's bounds; they stay put on the canvas.
    await page.evaluate(() => window.design.setSelection(["p"]));
    const world = await page.evaluate(() =>
      window.design.getDocument().pages[0].nodes.find((n) => n.id === "c"),
    );
    await section.locator("#position-fit-content").click();
    const p = await node("p"),
      c = await node("c");
    assert.deepEqual([p.x, p.y, p.w, p.h], [world.x, world.y, 80, 60], "frame hugs its only child");
    assert.deepEqual([c.x, c.y], [0, 0], "child moved to the frame origin, same canvas position");

    // Wonder H1-tooltip: the tool is "Resize to fill ⌘⇧⌥F" (custom tooltip, no native title) and the shortcut runs it.
    const fitTool = section.locator("#position-fit-content");
    assert.equal(await fitTool.getAttribute("aria-label"), "Resize to fill");
    assert.equal(await fitTool.getAttribute("title"), null, "no native title tooltip");
    await seed(
      [
        {
          id: "p",
          name: "Parent",
          type: "frame",
          x: 0,
          y: 0,
          w: 400,
          h: 300,
          color: "#ffffff",
          layout: "free",
        },
        {
          id: "c",
          name: "Child",
          type: "rectangle",
          parentId: "p",
          x: 30,
          y: 40,
          w: 80,
          h: 60,
          color: "#8844cc",
        },
      ],
      ["p"],
    );
    await page.mouse.move(5, 5); // the click above closed the tooltip until the pointer leaves
    await fitTool.hover();
    const tip = page.getByRole("tooltip", { name: /Resize to fill/ });
    await tip.waitFor();
    assert.match(await tip.textContent(), /Resize to fill\s*⌘⇧⌥F/);
    await page.mouse.move(5, 5);
    await page
      .locator("#canvas-wrap")
      .focus()
      .catch(() => {});
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press(mod("Shift+Alt+KeyF"));
    const p2 = await node("p");
    assert.deepEqual(
      [p2.x, p2.y, p2.w, p2.h],
      [30, 40, 80, 60],
      "⌘⇧⌥F resizes the frame to fill around its child",
    );
    assert.equal(
      (
        await page.evaluate(() =>
          window.design.getDocument().pages[0].nodes.find((n) => n.id === "c"),
        )
      ).x,
      0,
    );

    // Three layers: distribute replaces flip.
    await seed(
      [
        { id: "r1", name: "r1", type: "rectangle", x: 0, y: 0, w: 20, h: 20, color: "#ff0000" },
        { id: "r2", name: "r2", type: "rectangle", x: 30, y: 0, w: 20, h: 20, color: "#00ff00" },
        { id: "r3", name: "r3", type: "rectangle", x: 200, y: 0, w: 20, h: 20, color: "#0000ff" },
      ],
      ["r1", "r2", "r3"],
    );
    assert.equal(await section.locator("#position-flip-h").count(), 0, "no flip with 3+ layers");
    await section.locator("#precision-horizontal").click();
    assert.equal((await node("r2")).x, 100, "distribute horizontally");

    assert.deepEqual(errors, []);
    console.log(
      'PASS inspector position: absolute toggle (in place, enables constraints, back to flow), Left/Right menu, diagram + disabled colours, single-child align to parent, flip H/V, distribute for 3+, expand fits content ("Resize to fill ⌘⇧⌥F" tooltip + shortcut), Z Auto',
    );
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
