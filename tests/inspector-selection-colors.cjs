// Inspector section inventory (design/wonder/properties-audit A8, A9, WP-6): no Layer section (its actions live in
// the layer tree, canvas context menu and shortcuts), Selection colors between Mask and Export (every distinct
// colour of the selection and its descendants, recolour-all in one undo step, target button, variable chips),
// the multi-selection view ("N nodes selected", Mixed values, "Click to replace …" wells, Selection filters) and
// Clip content on text layers. Real Electron, edits through the inspector UI.
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");

const svg = (markup) => "data:image/svg+xml;base64," + Buffer.from(markup).toString("base64");
const MONO = svg(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" fill="#000000"/></svg>',
);
const MULTI = svg(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="10" height="10" fill="#ff0000"/><rect x="10" width="10" height="10" fill="#0000ff"/></svg>',
);
const shots = process.env.VERYNIZE_EVIDENCE_DIR;

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inspector-selection-colors-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${path.join(dir, "profile")}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await page.waitForSelector("#canvas .layer");
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const nodes = () => page.evaluate(() => window.design.getDocument().pages[0].nodes);
    const node = async (id) => (await nodes()).find((n) => n.id === id);
    const setup = (list, selection) =>
      page.evaluate(
        ({ list, selection }) => {
          const d = window.design.getDocument();
          d.tokens = { brand: "#7c3aed", ink: "#111111" };
          delete d.variables;
          d.pages[0].nodes = list;
          window.design.setDocument(d);
          window.design.setSelection(selection);
        },
        { list, selection },
      );
    const sectionOrder = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("#properties section[id]")]
          .filter((s) => !s.hidden && s.offsetParent)
          .map((s) => s.id),
      );
    const colors = page.locator("#selection-colors-section");
    const rows = () =>
      colors
        .locator("[data-selection-color]")
        .evaluateAll((els) => els.map((e) => e.dataset.selectionColor));
    const base = { x: 0, y: 0, w: 100, h: 40, rotation: 0, opacity: 100 };
    const frame = (id, extra = {}) => ({
      ...base,
      id,
      name: id,
      type: "frame",
      parentId: null,
      color: "#ffffff",
      layout: "free",
      clipContent: true,
      ...extra,
    });
    const text = (id, extra = {}) => ({
      ...base,
      id,
      name: id,
      type: "text",
      text: id,
      color: "#000000",
      fontSize: 12,
      ...extra,
    });

    // --- A8: no Layer section; its actions remain reachable -------------------------------------------------
    await setup([frame("card", { x: 40, y: 40, w: 200, h: 120 })], ["card"]);
    await page.locator("#position-section").waitFor();
    assert.equal(await page.locator("#layer-section").count(), 0, "Wonder has no Layer section");
    assert.equal(
      await colors.count(),
      0,
      "a layer without children shows no Selection colors (wonder A8-layer-frame-bottom)",
    );
    const order = await sectionOrder();
    assert.equal(order.at(-1), "export-section", "Export is the last section: " + order);
    // Scale ½× / 2× (formerly in the Layer section) are commands; Wonder's context menu has no scale items.
    const commandIds = await page.evaluate(() => window.design.commands().map((c) => c.id));
    for (const id of ["edit.duplicate", "edit.delete", "transform.scaleDown", "transform.scaleUp"])
      assert.ok(commandIds.includes(id), id + " is a command");
    await page.evaluate(() => window.design.setSelection(["card"]));
    await page.evaluate(() => window.design.runCommand("transform.scaleUp"));
    assert.deepEqual([(await node("card")).w, (await node("card")).h], [400, 240], "Scale 2×");
    await page.evaluate(() => window.design.runCommand("transform.scaleDown"));
    assert.deepEqual([(await node("card")).w, (await node("card")).h], [200, 120], "Scale ½×");
    await page.evaluate(() => window.design.runCommand("edit.duplicate"));
    assert.equal((await nodes()).length, 2, "Duplicate (⌘D) still works without the Layer section");
    await page.evaluate(() => window.design.runCommand("edit.delete"));
    assert.equal((await nodes()).length, 1, "Delete still works without the Layer section");
    console.log("PASS no Layer section; scale, duplicate and delete reachable as commands");

    // --- A9: Selection colors for a parent frame -------------------------------------------------------------
    await setup(
      [
        frame("card", {
          x: 40,
          y: 40,
          w: 240,
          h: 160,
          fills: [
            { type: "solid", color: "#ffffff" },
            {
              type: "linear",
              angle: 90,
              stops: [
                { position: 0, color: "#00000033" },
                { position: 100, color: "#66666633" },
              ],
            },
          ],
          shadows: [{ type: "box", x: 0, y: 4, blur: 4, spread: 0, color: "#00000040" }],
        }),
        text("title", { parentId: "card", x: 10, y: 10 }),
        text("body", { parentId: "card", x: 10, y: 60 }),
        text("tag", { parentId: "card", x: 10, y: 100, color: "#7c3aed", token: "brand" }),
      ],
      ["card"],
    );
    await colors.waitFor();
    const after = await sectionOrder();
    assert.equal(
      after.indexOf("selection-colors-section"),
      after.indexOf("export-section") - 1,
      "Selection colors sits right before Export: " + after,
    );
    assert.ok(
      after.indexOf("mask-section") < after.indexOf("selection-colors-section"),
      "after Mask",
    );
    assert.equal(await colors.locator("h3").innerText(), "Selection colors");
    assert.equal(
      await colors.locator(".insp-add, [data-section-remove]").count(),
      0,
      "no header +/−",
    );
    // Children first, then the frame's own paints (wonder A9-parent-colors, diagnostics/28-bottom).
    assert.deepEqual(await rows(), [
      "#000000",
      "token:brand",
      "#ffffff",
      "#00000033",
      "#66666633",
      "#00000040",
    ]);
    assert.equal(
      await page.getByRole("textbox", { name: "Selection color 4 hex" }).inputValue(),
      "000000",
    );
    assert.equal(
      await page.getByRole("textbox", { name: "Selection color 4 opacity" }).inputValue(),
      "20",
    );
    assert.equal(
      await page.getByRole("textbox", { name: "Selection color 6 opacity" }).inputValue(),
      "25",
    );
    assert.equal(
      await colors.locator('[data-selection-color="token:brand"] [data-variable-chip]').innerText(),
      "brand",
      "a variable shows a chip",
    );
    assert.equal(
      await colors.locator('[data-selection-color="token:brand"]').getByRole("textbox").count(),
      0,
      "a variable row has no hex or %",
    );
    // Geometry (wonder A9-parent-colors): field x 12–236, target centred at 256, first row 40 below the divider.
    const geometry = await page.evaluate(() => {
      const panel = document.querySelector("#properties").getBoundingClientRect();
      const section = document.querySelector("#selection-colors-section");
      const row = section.querySelector("[data-selection-color]");
      const field = row.querySelector("[data-color-anchor]").getBoundingClientRect();
      const target = row.querySelector("[data-selection-color-target]").getBoundingClientRect();
      const prev = section.previousElementSibling.getBoundingClientRect();
      const left = panel.left + (panel.width - 280);
      return {
        field: [field.left - left, field.right - left, field.height],
        target: target.left + target.width / 2 - left,
        top: field.top - prev.bottom,
      };
    });
    assert.deepEqual(geometry.field, [12, 236, 24], "row field x 12–236");
    assert.equal(geometry.target, 256, "target button centre 256");
    assert.equal(Math.round(geometry.top), 40, "first row 40 below the divider");
    if (shots) await colors.screenshot({ path: path.join(shots, "selection-colors-parent.png") });

    // Recolour every use of black (two text children) in one undo step.
    const hex = page.getByRole("textbox", { name: "Selection color 1 hex" });
    await hex.fill("ff0000");
    await hex.press("Enter");
    assert.deepEqual(
      [(await node("title")).color, (await node("body")).color, (await node("tag")).color],
      ["#ff0000", "#ff0000", "#7c3aed"],
      "every use recoloured, others untouched",
    );
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    assert.deepEqual(
      [(await node("title")).color, (await node("body")).color],
      ["#000000", "#000000"],
      "one undo step restores every use",
    );
    // Alpha of a gradient stop (only that stop changes; the other 20% stop is a different colour).
    const alpha = page.getByRole("textbox", { name: "Selection color 5 opacity" });
    await alpha.fill("50");
    await alpha.press("Enter");
    assert.equal((await node("card")).fills[1].stops[1].color, "#66666680");
    assert.equal((await node("card")).fills[1].stops[0].color, "#00000033");
    // Shadow colour through the picker's variables: binds every use.
    await page.getByRole("button", { name: "Selection color 6", exact: true }).click();
    await page
      .locator("#color-dialog")
      .getByRole("tab", { name: "Variables", exact: true })
      .click();
    await page.locator("#color-dialog").getByRole("option", { name: /ink/ }).click();
    if (await page.locator("#color-dialog").count())
      await page.getByRole("button", { name: "Close colour picker", exact: true }).click();
    assert.deepEqual(
      {
        color: (await node("card")).shadows[0].color,
        token: (await node("card")).shadows[0].token,
      },
      { color: "#111111", token: "ink" },
    );
    await colors.locator('[data-selection-color="token:ink"]').waitFor();
    // Detach a variable row (hover-only unlink): keeps the resolved colour.
    const brandRow = colors.locator('[data-selection-color="token:brand"]');
    await brandRow.hover();
    await brandRow.getByRole("button", { name: /^Detach selection color \d+ variable$/ }).click();
    assert.deepEqual([(await node("tag")).color, (await node("tag")).token], ["#7c3aed", ""]);
    // Target: selects the layers that use the colour.
    await colors.locator('[data-selection-color="#000000"] [data-selection-color-target]').click();
    assert.deepEqual((await page.evaluate(() => window.design.getSelection())).sort(), [
      "body",
      "title",
    ]);
    console.log(
      "PASS Selection colors: aggregate, order, geometry, recolour-all + undo, alpha, bind, detach, target",
    );

    // --- Folded SVG colours: rows plus restore / detach -----------------------------------------------------
    await setup(
      [
        {
          ...base,
          id: "logo",
          name: "Logo",
          type: "image",
          parentId: null,
          color: "transparent",
          src: MULTI,
        },
      ],
      ["logo"],
    );
    await colors.waitFor();
    assert.equal(
      await page.locator("#svg-colors-section").count(),
      0,
      "no separate Colors section",
    );
    assert.deepEqual(await rows(), ["#ff0000", "#0000ff"]);
    await page.getByRole("textbox", { name: "Selection color 1 hex" }).fill("00ff00");
    await page.getByRole("textbox", { name: "Selection color 1 hex" }).press("Enter");
    assert.deepEqual((await node("logo")).svgPaints, { "#ff0000": "#00ff00" });
    await page.getByRole("button", { name: "Restore original SVG colors", exact: true }).click();
    assert.equal((await node("logo")).svgPaints, undefined);
    await setup(
      [
        {
          ...base,
          id: "icon",
          name: "Icon",
          type: "image",
          parentId: null,
          color: "#eeeeee",
          src: MONO,
          svgColor: "#000000",
          svgColorToken: "brand",
        },
      ],
      ["icon"],
    );
    await colors.locator('[data-selection-color="token:brand"]').waitFor();
    await page.getByRole("button", { name: "Detach SVG color variable", exact: true }).click();
    assert.deepEqual(
      [(await node("icon")).svgColor, (await node("icon")).svgColorToken],
      ["#7c3aed", undefined],
    );
    console.log("PASS SVG colours folded into Selection colors (replace, restore, detach)");

    // --- Multi-selection of siblings -------------------------------------------------------------------------
    await setup(
      [
        frame("a", {
          x: 20,
          y: 20,
          fills: [
            { type: "solid", color: "#ffffff" },
            { type: "solid", color: "#00000033" },
          ],
          filters: [{ type: "blur", value: 2 }],
          shadows: [{ type: "box", x: 0, y: 4, blur: 4, spread: 0, color: "#00000040" }],
        }),
        frame("b", { x: 140, y: 60, color: "#000000" }),
        text("c", { x: 260, y: 100 }),
      ],
      ["a", "b", "c"],
    );
    const position = page.locator("#position-section");
    await position.locator("h3", { hasText: "3 nodes selected" }).waitFor();
    assert.equal(await page.locator('#position-section [name="x"]').inputValue(), "");
    assert.equal(
      await page.locator('#position-section [name="x"]').getAttribute("placeholder"),
      "Mixed",
    );
    assert.equal(await page.locator('[name="opacity"]').inputValue(), "100", "shared values stay");
    for (const label of [
      "Click to replace background fills",
      "Click to replace box shadows",
      "Click to replace filters",
    ])
      assert.ok(await page.locator(`[data-replace="${label}"]`).isVisible(), label);
    const filters = page.locator("[data-selection-filters]");
    assert.equal(await filters.getAttribute("data-selection-filters"), "1");
    assert.match(await filters.innerText(), /Selection filters[\s\S]*Blur/);
    assert.deepEqual(await rows(), ["#ffffff", "#00000033", "#00000040", "#000000"]);
    if (shots) {
      await page.locator("#properties").screenshot({ path: path.join(shots, "multi-top.png") });
      await colors.scrollIntoViewIfNeeded();
      await page.locator("#properties").screenshot({ path: path.join(shots, "multi-bottom.png") });
    }
    await page
      .locator('[data-selection-filter="layer:blur"] [data-selection-filter-target]')
      .click();
    assert.deepEqual(await page.evaluate(() => window.design.getSelection()), ["a"]);
    await page.evaluate(() => window.design.setSelection(["a", "b", "c"]));
    await page.locator('[data-replace="Click to replace box shadows"]').click();
    const all = await nodes();
    assert.deepEqual(
      all.map((n) => n.shadows?.length ?? 0),
      [1, 1, 1],
      "every layer gets the primary's shadows",
    );
    assert.equal(await page.locator('[data-replace="Click to replace box shadows"]').count(), 0);
    assert.ok(await page.locator("#shadow-section").isVisible(), "the shadow rows show again");
    await page.locator('[data-replace="Click to replace background fills"]').click();
    assert.deepEqual(
      (await nodes()).map((n) => n.color),
      ["#ffffff", "#ffffff", "#ffffff"],
    );
    assert.ok(await page.locator("#fill-section").isVisible());
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    assert.deepEqual(
      (await nodes()).map((n) => n.color),
      ["#ffffff", "#000000", "#000000"],
      "one undo step",
    );
    // Same-shaped paint stacks (one solid each, different colours) keep their rows: edits apply per layer.
    await page.evaluate(() => window.design.setSelection(["b", "c"]));
    await page.locator("#position-section h3", { hasText: "2 nodes selected" }).waitFor();
    assert.equal(
      await page.locator('[data-replace="Click to replace background fills"]').count(),
      0,
    );
    assert.ok(await page.locator("#fill-section").isVisible());
    console.log(
      "PASS multi-selection: N nodes selected, Mixed, Click to replace wells, Selection filters, targets",
    );

    // --- Multi-selection W/H (wonder A9-selection-colors-multiple): "Mixed" with no unit when the layers differ ----
    await setup([frame("p", { w: 100, h: 40 }), frame("q", { x: 140, w: 100, h: 80 })], ["p", "q"]);
    await page.locator("#position-section h3", { hasText: "2 nodes selected" }).waitFor();
    const wField = page.locator('#layout-section [name="w"]'),
      hField = page.locator('#layout-section [name="h"]');
    assert.equal(await wField.inputValue(), "100", "a shared width stays a value");
    assert.equal(await page.locator('[data-size-menu="w"]').innerText(), "px");
    assert.equal(await hField.inputValue(), "", "differing heights");
    assert.equal(await hField.getAttribute("placeholder"), "Mixed");
    assert.equal(await page.locator('[data-size-menu="h"]').getAttribute("data-mixed"), "true");
    assert.equal(
      await page.locator('[data-size-menu="h"]').innerText(),
      "",
      "Mixed shows the chevron only",
    );
    assert.equal(
      await hField.evaluate((e) => getComputedStyle(e, "::placeholder").color),
      await wField.evaluate((e) => getComputedStyle(e).color),
      "Mixed reads in the value colour",
    );
    await hField.fill("50");
    await hField.press("Enter");
    assert.deepEqual(
      (await nodes()).map((n) => n.h),
      [50, 50],
      "typing over Mixed sets every layer",
    );
    assert.equal(await hField.inputValue(), "50");
    assert.equal(await page.locator('[data-size-menu="h"]').getAttribute("data-mixed"), null);
    console.log(
      "PASS multi-selection W/H: shared value, Mixed without unit, typing applies to all",
    );

    // --- No focus ring after pointer clicks (properties-audit bug 7, WP-13); keyboard focus keeps it -------------
    await setup([frame("ring", { x: 40, y: 40 })], ["ring"]);
    const ringOf = () => page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
    await page.locator('#shadow-section button[aria-label="Add shadow"]').click();
    await page.locator("#shadow-section [data-shadow-row]").first().waitFor();
    await page.keyboard.press("Escape");
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
      "Add shadow",
      "focus returns to the + after the editor closes",
    );
    assert.doesNotMatch(await ringOf(), /162, 69, 211/, "no purple ring after a pointer click");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    assert.match(await ringOf(), /162, 69, 211/, "keyboard focus still shows the ring");
    console.log("PASS focus ring: none after pointer clicks, kept for keyboard focus");

    // --- Clip content on a text layer -----------------------------------------------------------------------
    await setup([text("label", { x: 40, y: 40 })], ["label"]);
    await page.getByRole("checkbox", { name: "Clip content" }).click();
    assert.equal(
      (await node("label")).clipContent,
      true,
      "text layers offer Clip content (wonder A8/A10)",
    );
    console.log("PASS Clip content on text layers");

    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
