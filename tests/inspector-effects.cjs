// Effects inspector (Wonder 16–21, 27–28): blend menu, border style, a real outline, the shadow list
// (box / inner / drop / text, colour bound to a Colors variable), layer + backdrop filters and gradient
// masks. Every edit goes through the real inspector, is one undo step, renders on the canvas and in
// the exported HTML.
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "inspector-effects-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = '1'; env.VERYNIZE_LAUNCH_EDITOR = '1';
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${profile}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await page.waitForSelector("#canvas .layer");
    const node = (id) =>
      page.evaluate(
        (id) => {
          const d = window.design.getDocument();
          return (d.pages.find((p) => p.id === d.activePage) ?? d.pages[0]).nodes.find((n) => n.id === id);
        },
        id,
      );
    const css = (id, prop) =>
      page
        .locator(`#canvas [data-id="${id}"]`)
        .evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), prop);
    const undo = async () => {
      await page.evaluate(() => window.design.runCommand("edit.undo"));
    };
    const commit = async (selector, value) => {
      const field = page.locator(selector);
      await field.fill(value);
      await field.press("Enter");
    };
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens = { ...d.tokens, accent: "#ff0000" };
      d.pages = [
        {
          id: "p",
          name: "Effects",
          nodes: [
            { id: "back", name: "Back", type: "rectangle", x: 20, y: 20, w: 200, h: 120, color: "#3366ff" },
            { id: "card", name: "Card", type: "rectangle", x: 60, y: 40, w: 200, h: 120, color: "#ffcc00", radius: 16 },
            { id: "label", name: "Label", type: "text", x: 20, y: 200, w: 200, h: 40, text: "Hello", color: "#111111", fontSize: 24 },
          ],
        },
      ];
      d.activePage = "p";
      window.design.setDocument(d);
      window.design.setSelection(["card"]);
    });
    await page.waitForSelector("#appearance-section");

    // Blend: all 18 modes are offered; Multiply applies mix-blend-mode, undo restores Normal.
    await page.locator("#blend-mode").click();
    assert.equal(await page.locator("[data-blend]").count(), 18);
    for (const mode of ["plus-darker", "plus-lighter", "difference", "exclusion", "hue", "saturation", "color", "luminosity"])
      assert.equal(await page.locator(`[data-blend="${mode}"]`).count(), 1, mode);
    await page.locator('[data-blend="multiply"]').click();
    assert.equal((await node("card")).blendMode, "multiply");
    assert.equal(await css("card", "mix-blend-mode"), "multiply");
    await undo();
    assert.equal((await node("card")).blendMode, undefined);
    assert.equal(await css("card", "mix-blend-mode"), "normal");
    // plus-darker keeps a standard fallback when the engine lacks it.
    await page.waitForTimeout(400);
    await page.locator("#blend-mode").click();
    await page.locator('[data-blend="plus-darker"]').click();
    assert.ok(["plus-darker", "color-burn"].includes(await css("card", "mix-blend-mode")));
    await undo();

    // Border (Wonder A2, properties-audit): add / hide / remove are real document edits. `+` writes a 1px
    // #000000 border at once; the active header keeps [Sliders, Sides, +]; Solid / Dashed / Dotted live in the
    // sliders menu; the colour row is one field with the alpha inside ("NN %"). The eye hides a border without
    // losing it, `−` clears every border field in one undo step, and a re-added border starts from the defaults.
    const borderGone = async () => {
      const b = await node("card");
      assert.deepEqual(
        [b.strokeWidth, b.strokeColor, b.strokeWidths, b.strokeColors, b.strokeToken, b.strokeStyle, b.strokeHidden, b.strokeHiddenSides],
        [0, "#000000", undefined, undefined, undefined, undefined, undefined, undefined],
      );
      assert.equal(await css("card", "border-top-width"), "0px");
      assert.equal(await page.locator("#border-section .insp-add").isVisible(), true);
      assert.equal(await page.locator("[name=strokeWidth]").isVisible(), false);
      assert.equal(await page.locator("#border-section [data-line-style-menu]").count(), 0);
    };
    const headerTools = (section) =>
      page
        .locator(`${section} > div:first-child button`)
        .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    const height = async (selector) => Math.round((await page.locator(selector).boundingBox()).height);
    const borderDefault = async () => {
      const b = await node("card");
      assert.deepEqual(
        [b.strokeWidth, b.strokeColor, b.strokeWidths, b.strokeColors, b.strokeStyle, b.strokeHidden],
        [1, "#000000", undefined, undefined, undefined, undefined],
      );
      assert.equal(await css("card", "border-top-width"), "1px");
      assert.equal(await css("card", "border-top-style"), "solid");
      assert.equal(await css("card", "border-top-color"), "rgb(0, 0, 0)");
      // Wonder keeps `+` while a border exists (to add sides), after Sliders and Sides.
      assert.deepEqual(await headerTools("#border-section"), [
        "Border settings",
        "Independent border sides",
        "Add border side",
      ]);
      assert.equal(await page.locator("#border-section .insp-add").isEnabled(), true);
      // One "All" entry: `≡ 1 | All ▾ | eye | −` and one colour field `■ 000000 100 %`, no "px", no style select.
      assert.equal(await page.locator("[name=strokeSide]").inputValue(), "all");
      assert.equal(await page.locator("[name=strokeStyle]").count(), 0);
      assert.equal(await page.locator("[name=strokeColorAlpha]").inputValue(), "100");
      const suffixes = await page.locator("#border-section [data-field-suffix]").allInnerTexts();
      assert.deepEqual(suffixes.map((t) => t.trim()).filter(Boolean), ["%"]);
      assert.equal(await height("#border-section"), 105);
    };
    const pickLineStyle = async (menu, value) => {
      await page.getByRole("button", { name: menu, exact: true }).click();
      await page.getByRole("menu", { name: menu }).locator(`[data-line-style-option="${value}"]`).click();
      // The menu closes on pick.
      await page.getByRole("menu", { name: menu }).waitFor({ state: "detached" });
    };
    assert.equal(await css("card", "border-top-width"), "0px");
    await page.locator("#border-section .insp-add").click();
    await borderDefault();
    await commit("[name=strokeWidth]", "2");
    await pickLineStyle("Border settings", "dashed");
    assert.equal((await node("card")).strokeStyle, "dashed");
    assert.equal(await css("card", "border-top-style"), "dashed");
    await commit("[name=strokeColor]", "FF0000");
    // The alpha inside the colour field edits the colour's alpha (one undo step).
    await commit("[name=strokeColorAlpha]", "50");
    assert.equal((await node("card")).strokeColor, "#ff000080");
    await undo();
    assert.equal((await node("card")).strokeColor, "#ff0000");
    // Eye: hidden borders draw nothing and keep every value.
    await page.locator('#border-section [data-border-tool="visibility"]').click();
    assert.equal((await node("card")).strokeHidden, true);
    assert.equal(await css("card", "border-top-width"), "0px");
    assert.equal(await css("card", "border-left-width"), "0px");
    await page.locator('#border-section [data-border-tool="visibility"]').click();
    assert.equal((await node("card")).strokeHidden, undefined);
    assert.equal(await css("card", "border-top-width"), "2px");
    // Remove clears the border from the document and the canvas; one undo brings all of it back.
    await page.locator('#border-section [data-border-tool="remove"]').click();
    await borderGone();
    await undo();
    let b = await node("card");
    assert.deepEqual([b.strokeWidth, b.strokeStyle, b.strokeColor], [2, "dashed", "#ff0000"]);
    assert.equal(await css("card", "border-top-width"), "2px");

    const sides = () =>
      page.locator("#border-section [data-border-side]").evaluateAll((els) => els.map((el) => el.dataset.borderSide));
    // Wonder H4: in All mode `+` splits into Top and Right (both keep the All values; Bottom and Left draw
    // nothing), the next `+` adds Bottom, then Left, and with four sides `+` is disabled. One undo step each.
    const sidesGlyph = () =>
      page
        .getByRole("button", { name: "Independent border sides", exact: true })
        .locator("svg")
        .getAttribute("data-sides");
    await page.locator("#border-section .insp-add").click();
    b = await node("card");
    assert.deepEqual([b.strokeWidths, b.strokeWidth], [[2, 2, 0, 0], 2]);
    assert.deepEqual(b.strokeColors, Array(4).fill({ color: "#ff0000" }));
    assert.deepEqual(await sides(), ["top", "right"]);
    assert.deepEqual(
      await Promise.all(["top", "right", "bottom", "left"].map((s) => css("card", `border-${s}-width`))),
      ["2px", "2px", "0px", "0px"],
    );
    assert.equal(await sidesGlyph(), "1100", "the Sides glyph draws Top and Right solid");
    assert.equal(await page.locator("#border-section .insp-add").isEnabled(), true);
    await page.locator("#border-section .insp-add").click();
    assert.deepEqual((await node("card")).strokeWidths, [2, 2, 2, 0]);
    assert.deepEqual(await sides(), ["top", "right", "bottom"]);
    await page.locator("#border-section .insp-add").click();
    assert.deepEqual((await node("card")).strokeWidths, [2, 2, 2, 2]);
    assert.deepEqual(await sides(), ["top", "right", "bottom", "left"]);
    assert.equal(await page.locator("#border-section .insp-add").isDisabled(), true);
    assert.equal(await sidesGlyph(), null, "four sides show the full Sides glyph");
    for (let i = 0; i < 3; i++) await undo();
    b = await node("card");
    assert.deepEqual([b.strokeWidths, b.strokeWidth], [undefined, 2]);

    // Individual sides (Wonder A2): the Sides tool splits "All" into four complete entries (width, side, eye,
    // `−`, colour); with all four the header `+` is disabled. Each side hides and removes on its own.
    await page.getByRole("button", { name: "Independent border sides", exact: true }).click();
    b = await node("card");
    assert.deepEqual([b.strokeWidths, b.strokeColors], [[2, 2, 2, 2], Array(4).fill({ color: "#ff0000" })]);
    assert.deepEqual(await sides(), ["top", "right", "bottom", "left"]);
    assert.equal(await page.locator("[name=strokeWidth]").count(), 0);
    assert.equal(await page.locator("#border-section .insp-add").isDisabled(), true);
    await commit("[name=strokeWidths-0]", "5");
    assert.deepEqual((await node("card")).strokeWidths, [5, 2, 2, 2]);
    assert.equal(await css("card", "border-top-width"), "5px");
    await page.locator('[data-border-side="top"] [data-border-tool="visibility"]').click();
    b = await node("card");
    assert.deepEqual([b.strokeHiddenSides, b.strokeWidths], [[true, false, false, false], [5, 2, 2, 2]]);
    assert.equal(await css("card", "border-top-width"), "0px");
    assert.equal(await css("card", "border-left-width"), "2px");
    await page.locator('[data-border-side="top"] [data-border-tool="visibility"]').click();
    assert.equal((await node("card")).strokeHiddenSides, undefined);
    assert.equal(await css("card", "border-top-width"), "5px");
    await page.locator('[data-border-side="right"] [data-border-tool="remove"]').click();
    assert.deepEqual((await node("card")).strokeWidths, [5, 0, 2, 2]);
    assert.equal(await css("card", "border-right-width"), "0px");
    assert.deepEqual(await sides(), ["top", "bottom", "left"]);
    assert.equal(await page.locator("#border-section .insp-add").isEnabled(), true);
    // `+` adds the missing side like the first entry; one undo removes it again.
    await page.locator("#border-section .insp-add").click();
    assert.deepEqual((await node("card")).strokeWidths, [5, 5, 2, 2]);
    await undo();
    // The side selector moves an entry to a free side; sides already drawn are disabled.
    assert.equal(await page.locator('[name="strokeSide-3"] option[value="top"]').isDisabled(), true);
    await page.locator('[name="strokeSide-3"]').selectOption("right");
    assert.deepEqual((await node("card")).strokeWidths, [5, 2, 2, 0]);
    await undo();
    // Sides tool again (or "All" in a selector) collapses to one border with that entry's values.
    await page.locator('[name="strokeSide-2"]').selectOption("all");
    b = await node("card");
    assert.deepEqual([b.strokeWidths, b.strokeColors, b.strokeWidth], [undefined, undefined, 2]);
    await undo();
    await page.getByRole("button", { name: "Independent border sides", exact: true }).click();
    b = await node("card");
    assert.deepEqual([b.strokeWidths, b.strokeColors, b.strokeWidth, b.strokeColor], [undefined, undefined, 5, "#ff0000"]);
    await undo();
    // Removing the last side removes the border.
    for (const side of ["top", "bottom", "left"])
      await page.locator(`[data-border-side="${side}"] [data-border-tool="remove"]`).click();
    await borderGone();
    // Reselecting does not resurrect the old border; re-adding starts from the defaults.
    await page.evaluate(() => window.design.setSelection(["back"]));
    await page.evaluate(() => window.design.setSelection(["card"]));
    await borderGone();
    await page.locator("#border-section .insp-add").click();
    await borderDefault();
    assert.equal(await page.locator('[name="strokeWidths-0"]').count(), 0);
    // "All ▾" is the side selector: picking one side keeps only that side.
    await page.locator("[name=strokeSide]").selectOption("top");
    assert.deepEqual((await node("card")).strokeWidths, [1, 0, 0, 0]);
    assert.deepEqual(await sides(), ["top"]);
    await undo();
    await commit("[name=strokeWidth]", "2");
    await pickLineStyle("Border settings", "dashed");
    assert.equal(await css("card", "border-top-style"), "dashed");

    // Outline (Wonder A3): a real CSS outline. Header: Sliders (line style); one row `≡ width | offset | eye | −`
    // and one colour row; no captions and no style row (105px, like Border).
    await page.locator("#outline-section .insp-add").click();
    assert.equal((await node("card")).outlineWidth, 1);
    assert.deepEqual(await headerTools("#outline-section"), ["Outline settings"]);
    assert.equal(await page.locator("[name=outlineStyle]").count(), 0);
    assert.equal(await height("#outline-section"), 105);
    await pickLineStyle("Outline settings", "dotted");
    assert.equal((await node("card")).outlineStyle, "dotted");
    assert.equal(await css("card", "outline-style"), "dotted");
    await undo();
    await commit("[name=outlineWidth]", "3");
    await commit("[name=outlineOffset]", "4");
    await commit("[name=outlineColor]", "5EEAD4");
    let n = await node("card");
    assert.deepEqual([n.outlineWidth, n.outlineOffset, n.outlineColor], [3, 4, "#5eead4"]);
    // The canvas keeps the user's outline while the layer is selected.
    assert.equal(await css("card", "outline-width"), "3px");
    assert.equal(await css("card", "outline-offset"), "4px");
    assert.equal(await css("card", "outline-color"), "rgb(94, 234, 212)");
    assert.equal(await css("card", "box-shadow"), "none");
    await undo();
    assert.equal((await node("card")).outlineColor, "#000000");
    // Outline eye / remove / re-add write the document the same way.
    await page.locator('#outline-section [data-effect-tool="visibility"]').click();
    assert.equal((await node("card")).outlineHidden, true);
    assert.notEqual(await css("card", "outline-width"), "3px");
    await page.locator('#outline-section [data-effect-tool="visibility"]').click();
    assert.equal(await css("card", "outline-width"), "3px");
    await page.locator('#outline-section [data-effect-tool="remove"]').click();
    n = await node("card");
    assert.deepEqual(
      [n.outlineWidth, n.outlineOffset, n.outlineColor, n.outlineHidden],
      [undefined, undefined, undefined, undefined],
    );
    assert.notEqual(await css("card", "outline-width"), "3px");
    await page.locator("#outline-section .insp-add").click();
    n = await node("card");
    assert.deepEqual([n.outlineWidth, n.outlineOffset, n.outlineColor], [1, 0, "#000000"]);
    await commit("[name=outlineWidth]", "3");
    await commit("[name=outlineOffset]", "4");

    // Shadows: add box, edit geometry, make inner, add drop, bind colour to a variable, hide, remove.
    // Wonder A4: a new shadow is Box, X 0, Y 4, blur 4, spread 0, #000000 at 25 %, labelled "Box Shadow".
    await page.locator("#shadow-section .insp-add").click();
    await page.waitForSelector("#shadow-editor");
    assert.deepEqual((await node("card")).shadows, [{ type: "box", x: 0, y: 4, blur: 4, spread: 0, color: "#00000040" }]);
    assert.equal((await page.locator('[data-shadow-edit="0"]').textContent()).trim(), "Box Shadow");
    assert.equal(await page.locator('[data-shadow-row="0"]').getAttribute("data-open"), "true");
    // The editor: title + close, labelled Box / Drop segments, X / Y / blur / spread on one row, 288 px wide.
    const editor = page.locator('[data-shadow-editor="0"]');
    await editor.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    assert.equal(await editor.evaluate((el) => el.offsetWidth), 288); // layout width (ignores the open zoom-in)
    assert.deepEqual(
      (await editor.locator("[data-shadow-type]").allTextContents()).map((t) => t.trim()),
      ["Box", "Drop"],
    );
    const fieldTops = await Promise.all(
      ["x", "y", "blur", "spread"].map(async (k) => Math.round((await page.locator(`[name=shadow-0-${k}]`).boundingBox()).y)),
    );
    assert.equal(new Set(fieldTops).size, 1, "X / Y / blur / spread share one row");
    await commit("[name=shadow-0-x]", "0");
    await commit("[name=shadow-0-y]", "12");
    await commit("[name=shadow-0-blur]", "4");
    await commit("[name=shadow-0-spread]", "-4");
    await commit("[name=shadow-0-colorAlpha]", "25");
    assert.deepEqual((await node("card")).shadows, [{ type: "box", x: 0, y: 12, blur: 4, spread: -4, color: "#00000040" }]);
    assert.equal(await css("card", "box-shadow"), "rgba(0, 0, 0, 0.25) 0px 12px 4px -4px");
    // "Inner shadow" is a drawn 16 px box (not a native input stripped by the global reset) that toggles.
    const inner = page.getByRole("checkbox", { name: "Inner shadow" });
    const innerBox = await inner.boundingBox();
    assert.deepEqual([Math.round(innerBox.width), Math.round(innerBox.height)], [16, 16]);
    assert.notEqual(await inner.evaluate((el) => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
    assert.equal(await inner.getAttribute("aria-checked"), "false");
    await inner.click();
    assert.equal(await inner.getAttribute("aria-checked"), "true");
    assert.equal((await node("card")).shadows[0].inset, true);
    assert.ok((await css("card", "box-shadow")).includes("inset"));
    await undo();
    assert.ok(!(await css("card", "box-shadow")).includes("inset"));
    assert.equal(await inner.getAttribute("aria-checked"), "false");
    // The close button dismisses the editor and the row leaves its open state.
    await page.locator("[data-shadow-close]").click();
    await page.waitForSelector("#shadow-editor", { state: "detached" });
    assert.equal(await page.locator('[data-shadow-row="0"]').getAttribute("data-open"), "false");
    await page.locator("#shadow-section .insp-add").click();
    await page.locator('[data-shadow-editor="1"] [data-shadow-type="drop"]').click();
    assert.equal((await node("card")).shadows[1].type, "drop");
    assert.match(await css("card", "filter"), /drop-shadow/);
    // Bind the drop shadow colour to the "accent" Colors variable and follow the variable.
    await page.evaluate(() =>
      window.design.updateNodes(["card"], (c) => ({
        shadows: c.shadows.map((s, i) => (i === 1 ? { ...s, token: "accent", color: "#ff0000" } : s)),
      })),
    );
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens.accent = "#00ff00";
      window.design.setDocument(d);
      window.design.setSelection(["card"]);
    });
    assert.match(await css("card", "filter"), /rgb\(0, 255, 0\)/);
    await page.keyboard.press("Escape");
    await page.locator('[data-shadow-row="1"] [data-effect-tool="visibility"]').click();
    assert.equal((await node("card")).shadows[1].hidden, true);
    assert.equal(await css("card", "filter"), "none");
    await page.locator('[data-shadow-row="1"] [data-effect-tool="remove"]').click();
    assert.equal((await node("card")).shadows.length, 1);

    // Text shadow is offered on text layers only and renders as text-shadow.
    await page.evaluate(() => window.design.setSelection(["label"]));
    await page.locator("#shadow-section .insp-add").click();
    assert.equal(await page.locator('[data-shadow-editor="0"] [data-shadow-type="text"]').count(), 1);
    await page.locator('[data-shadow-editor="0"] [data-shadow-type="text"]').click();
    assert.match(await css("label", "text-shadow"), /rgba\(0, 0, 0, 0\.25\) 0px 4px 4px/);
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.design.setSelection(["card"]));

    // Filters: Blur 2 default (Wonder A5), change to Brightness 1.1, add a backdrop blur, hide, remove.
    // The type is a menu with Layer and Backdrop groups of the same eight filters, ✓ on the current one.
    const pickFilter = async (index, value) => {
      await page.locator(`[name=filter-${index}-type]`).click();
      await page.locator(`[data-filter-menu="${index}"] [data-filter-option="${value}"]`).click();
      await page.waitForSelector(`[data-filter-menu="${index}"]`, { state: "detached" });
    };
    await page.locator("#filter-section .insp-add").click();
    assert.deepEqual((await node("card")).filters, [{ type: "blur", value: 2 }]);
    assert.equal(await css("card", "filter"), "blur(2px)");
    await page.locator("[name=filter-0-type]").click();
    const menu = page.locator('[data-filter-menu="0"]');
    assert.deepEqual(await menu.locator('[role="group"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))), ["Layer", "Backdrop"]);
    for (const group of ["layer", "backdrop"])
      assert.deepEqual(
        (await menu.locator(`[data-filter-option^="${group}:"]`).allTextContents()).map((t) => t.trim()),
        ["Blur", "Brightness", "Contrast", "Grayscale", "Hue rotation", "Invert", "Saturate", "Sepia"],
      );
    assert.equal(await menu.locator('[data-filter-option="layer:blur"] svg').count(), 1, "current item is checked");
    assert.equal(await menu.locator('[data-filter-option="backdrop:blur"] svg').count(), 0);
    await page.keyboard.press("Escape");
    await page.waitForSelector('[data-filter-menu="0"]', { state: "detached" });
    assert.deepEqual((await node("card")).filters, [{ type: "blur", value: 2 }], "Escape keeps the filter");
    // Amount field: no unit suffix.
    assert.equal(await page.locator('[data-filter-row="0"] [data-field-suffix]').count(), 0);
    await pickFilter(0, "layer:brightness");
    await commit("[name=filter-0-value]", "1.1");
    assert.deepEqual((await node("card")).filters, [{ type: "brightness", value: 1.1 }]);
    assert.match(await css("card", "filter"), /^brightness\(1\.1\)/);
    await commit("[name=filter-0-value]", "9");
    assert.equal((await node("card")).filters[0].value, 3, "brightness clamps to 0–3");
    await undo();
    await page.locator("#filter-section .insp-add").click();
    await pickFilter(1, "backdrop:blur");
    assert.deepEqual((await node("card")).filters[1], { type: "blur", value: 2, backdrop: true });
    assert.equal(await css("card", "backdrop-filter"), "blur(2px)");
    for (const type of ["contrast", "grayscale", "hueRotate", "invert", "saturate", "sepia"]) {
      await pickFilter(1, "layer:" + type);
      assert.notEqual(await css("card", "filter"), "none", type);
    }
    await page.locator('[data-filter-row="1"] [data-effect-tool="visibility"]').click();
    assert.equal(await css("card", "filter"), "brightness(1.1)");
    await page.locator('[data-filter-row="1"] [data-effect-tool="remove"]').click();
    assert.equal((await node("card")).filters.length, 1);

    // Masks: Linear 180° → Conic 45°, alpha, invert, visibility.
    await page.locator("#mask-section .insp-add").click();
    await page.waitForSelector("#mask-editor");
    assert.deepEqual((await node("card")).masks, [{ type: "linear", rotation: 180, alpha: 100 }]);
    // 180deg is the CSS default direction, so the computed value omits it.
    assert.equal(await css("card", "mask-image"), "linear-gradient(rgb(0, 0, 0), rgba(0, 0, 0, 0))");
    await page.locator('[data-mask-editor="0"] [data-mask-type="conic"]').click();
    await commit("[name=mask-0-rotation]", "45");
    await commit("[name=mask-0-alpha]", "80");
    const invert = page.getByRole("checkbox", { name: "Invert" });
    const invertBox = await invert.boundingBox();
    assert.deepEqual([Math.round(invertBox.width), Math.round(invertBox.height)], [16, 16]);
    await invert.click();
    assert.equal(await invert.getAttribute("aria-checked"), "true");
    assert.deepEqual((await node("card")).masks, [{ type: "conic", rotation: 45, alpha: 80, invert: true }]);
    assert.match(await css("card", "mask-image"), /conic-gradient\(from 45deg/);
    await page.keyboard.press("Escape");
    await page.locator('[data-mask-row="0"] [data-effect-tool="visibility"]').click();
    assert.equal(await css("card", "mask-image"), "none");
    await page.locator('[data-mask-row="0"] [data-effect-tool="visibility"]').click();

    // Export: the same declarations reach the headless HTML.
    const html = await page.evaluate(() => window.design.exportHTML());
    for (const part of ["box-shadow: rgba(0, 0, 0, 0.25) 0px 12px 4px -4px", "filter: brightness(1.1)", "2px dashed", "outline-offset: 4px", "mask-image: conic-gradient(from 45deg", "text-shadow:"])
      assert.ok(html.includes(part), part);

    // Removing the last mask collapses Mask back to its 31 px header + divider (no sticky CSS field).
    const maskHeight = async () => Math.round((await page.locator("#mask-section").boundingBox()).height);
    assert.equal(await page.locator("[name=mask]").count(), 0, "no legacy CSS field for structured masks");
    assert.equal(await maskHeight(), 81, "one mask row: 40 above, 16 below (Wonder A6)");
    await page.locator('[data-mask-row="0"] [data-effect-tool="remove"]').click();
    assert.equal((await node("card")).masks, undefined);
    assert.equal(await maskHeight(), 32);
    assert.equal(await page.locator("#mask-section .insp-add").isVisible(), true);
    await undo();
    assert.equal(await maskHeight(), 81);

    // Validation rejects malformed effects (shared with design-store validateDocument).
    const rejected = await page.evaluate(() => {
      const out = [];
      for (const patch of [{ blendMode: "burn" }, { shadows: [{ type: "text", x: 0, y: 0, blur: 0, spread: 0, color: "#000000" }] }, { filters: [{ type: "brightness", value: 9 }] }, { masks: [{ type: "diamond" }] }]) {
        try { window.design.updateNodes(["card"], patch); out.push(false); } catch { out.push(true); }
      }
      return out;
    });
    assert.deepEqual(rejected, [true, true, true, true]);
    // Backdrop filters render behind a see-through layer, on the canvas and in exported HTML.
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.pages.push({
        id: "glass-page",
        name: "Glass",
        nodes: [
          { id: "under", name: "Under", type: "rectangle", x: 0, y: 0, w: 100, h: 100, color: "#3366ff", radius: 0 },
          { id: "glass", name: "Glass", type: "rectangle", x: 0, y: 0, w: 100, h: 100, color: "transparent", radius: 0 },
        ],
      });
      d.activePage = "glass-page";
      window.design.setDocument(d);
      window.design.setSelection(["glass"]);
    });
    await page.waitForSelector("#filter-section .insp-add");
    await page.locator("#filter-section .insp-add").click();
    await pickFilter(0, "backdrop:invert");
    assert.deepEqual((await node("glass")).filters, [{ type: "invert", value: 1, backdrop: true }]);
    assert.equal(await css("glass", "backdrop-filter"), "invert(1)");
    await page.evaluate(() => window.design.setSelection([]));
    await page.waitForTimeout(200);
    const centre = async (png) =>
      page.evaluate(async (src) => {
        const image = new Image();
        await new Promise((ok, fail) => { image.onload = ok; image.onerror = fail; image.src = src; });
        const c = document.createElement("canvas");
        c.width = image.naturalWidth;
        c.height = image.naturalHeight;
        const ctx = c.getContext("2d");
        ctx.drawImage(image, 0, 0);
        return [...ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data];
      }, png);
    const near = (px, want, what) =>
      assert.ok(px.slice(0, 3).every((v, i) => Math.abs(v - want[i]) <= 24), `${what}: ${px} ≉ ${want}`);
    const onCanvas = await page.locator('#canvas [data-id="glass"]').screenshot();
    // #3366ff inverted is #cc9900.
    near(await centre("data:image/png;base64," + onCanvas.toString("base64")), [204, 153, 0], "canvas backdrop invert");
    const glassHtml = await page.evaluate(() => window.design.exportHTML());
    assert.ok(glassHtml.includes("backdrop-filter: invert(1)"), "exported HTML keeps the backdrop filter");
    const rendered = await page.evaluate(
      (html) => window.desktop.renderDesign({ html, width: 100, height: 100, scale: 1 }).then((r) => r.dataURL),
      glassHtml,
    );
    near(await centre(rendered), [204, 153, 0], "exported HTML renders the backdrop invert");

    // Export (Wonder A7): full-width name, then size and format in two equal columns; the scope and suffix
    // wait in the Export options popover, and the open header shows only `−`.
    await page.evaluate(() => window.design.setSelection(["glass"]));
    await page.locator("#export-section .insp-add").click();
    const exportName = await page.getByRole("textbox", { name: "Export file name" }).locator("..").boundingBox();
    const scaleBox = await page.locator("#artwork-scale").locator("..").boundingBox();
    const formatBox = await page.locator("#artwork-format").locator("..").boundingBox();
    assert.equal(Math.round(exportName.width), 256);
    assert.equal(Math.round(scaleBox.width), Math.round(formatBox.width));
    assert.equal(Math.round(scaleBox.y), Math.round(formatBox.y));
    assert.equal(Math.round(formatBox.x + formatBox.width - scaleBox.x), 256);
    assert.equal(await page.locator("#artwork-scope").isVisible(), false);
    assert.equal(await page.locator("#export-section h3 ~ div button").count(), 1);
    await page.getByRole("button", { name: "Export options" }).click();
    assert.equal(await page.locator("#artwork-scope").isVisible(), true);
    await page.keyboard.press("Escape");

    console.log("PASS inspector effects: 18 blend modes, border style, real outline, box/inner/drop/text shadows with variable colour, layer/backdrop filters (menu, backdrop render + export), gradient masks (collapse on removal), visible checkboxes, undo, canvas CSS, export, validation");
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
