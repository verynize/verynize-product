// Real inspector interactions: detached colours retain their appearance and scalar variable
// bindings replace conflicting imported per-side values without changing independent axes.
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "inspector-binding-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${profile}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await page.waitForSelector("#canvas .layer");
    const proof = async (name) => {
      if (!process.env.BD_WONDER_EVIDENCE_DIR) return;
      await fs.mkdir(process.env.BD_WONDER_EVIDENCE_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.BD_WONDER_EVIDENCE_DIR, name) });
    };
    const node = (id) =>
      page.evaluate(
        (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id),
        id,
      );
    const styles = (id) =>
      page.locator(`#canvas [data-id="${id}"]`).evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          color: s.backgroundColor,
          radius: s.borderRadius,
          border: s.borderWidth,
          padding: s.padding,
          x: s.columnGap,
          y: s.rowGap,
        };
      });
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens = { brand: "#22558880", accent: "#cc4400" };
      d.variables = { space: { type: "dimension", value: 24 } };
      d.pages = [
        {
          id: "p",
          name: "Binding checks",
          nodes: [
            {
              id: "card",
              name: "Card",
              type: "frame",
              x: 20,
              y: 20,
              w: 320,
              h: 220,
              color: "#ff0000",
              token: "brand",
              layout: "flex",
              direction: "row",
              flexWrap: true,
              radius: 0,
              cornerRadii: [4, 8, 12, 16],
              strokeWidth: 1,
              strokeWidths: [1, 2, 3, 4],
              padding: 0,
              paddingTop: 5,
              paddingRight: 5,
              paddingBottom: 5,
              paddingLeft: 5,
              gap: 0,
              gapX: 7,
              gapY: 9,
            },
            {
              id: "other",
              name: "Other",
              type: "rectangle",
              x: 400,
              y: 20,
              w: 120,
              h: 120,
              color: "#00ff00",
              token: "accent",
            },
            {
              id: "fallback",
              name: "Fallback",
              type: "rectangle",
              x: 550,
              y: 20,
              w: 120,
              h: 120,
              color: "#778899",
              token: "missing",
            },
          ],
        },
      ];
      d.activePage = "p";
      window.design.setDocument(d);
      window.design.setSelection(["card", "other", "fallback"]);
    });

    const colorsBefore = await Promise.all(["card", "other", "fallback"].map(styles));
    // Wonder A1/B3: the unlink sits inside the bound fill row (shown on hover) and detaches every selected layer.
    await page.locator("#fill-section [data-paint='0']").hover();
    await page
      .locator("#fill-section")
      .getByRole("button", { name: "Detach variable", exact: true })
      .click();
    for (const [i, id] of ["card", "other", "fallback"].entries()) {
      assert.equal((await node(id)).token, "");
      assert.equal(
        (await styles(id)).color,
        colorsBefore[i].color,
        `${id}: detach retains rendered colour`,
      );
    }
    assert.equal((await node("card")).color, "#22558880", "fill alpha is preserved");
    assert.equal(
      (await node("other")).color,
      "#cc4400",
      "each selected layer retains its own token value",
    );
    assert.equal(
      (await node("fallback")).color,
      "#778899",
      "missing tokens retain the local fallback",
    );
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    assert.equal(
      (await node("card")).token,
      "brand",
      "one undo restores the complete detach operation",
    );
    await page.evaluate(() => window.design.runCommand("edit.redo"));
    assert.equal((await node("card")).color, "#22558880");

    await page.evaluate(() => window.design.setSelection(["card"]));
    // Direct scalar edits must have the same visible effect as binding a variable.
    // Per-side borders are four side entries (Wonder A2): "All" in a side selector collapses them to one
    // uniform border (one undo step), whose width field then sets every side.
    await page.locator('[name="strokeSide-0"]').selectOption("all");
    assert.equal((await node("card")).strokeWidths, undefined, "All collapses the side entries");
    assert.equal((await styles("card")).border, "1px");
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    assert.deepEqual(
      (await node("card")).strokeWidths,
      [1, 2, 3, 4],
      "one undo restores the sides",
    );
    await page.locator('[name="strokeSide-0"]').selectOption("all");
    for (const [field, value, override, initial, cssKey] of [
      ["radius", "18", "cornerRadii", [4, 8, 12, 16], "radius"],
      ["strokeWidth", "6", "strokeWidths", undefined, "border"],
    ]) {
      await page.locator(`[name="${String(field)}"]`).fill(value);
      await page.locator(`[name="${String(field)}"]`).press("Enter");
      assert.equal(
        (await node("card"))[override],
        undefined,
        `${String(field)}: uniform input clears overrides`,
      );
      assert.equal((await styles("card"))[cssKey], `${String(value)}px`);
      await page.evaluate(() => window.design.runCommand("edit.undo"));
      assert.deepEqual(
        (await node("card"))[override],
        initial,
        `${String(field)}: one undo restores individual values`,
      );
    }
    const bind = async (field) => {
      await page.locator(`[data-bind="${field}"]`).scrollIntoViewIfNeeded();
      await page.locator(`[data-bind="${field}"]`).focus();
      await page.locator(`[data-bind="${field}"]`).click();
      await page.locator('[role="menuitem"][data-variable="space"]').click();
      await page.waitForFunction(
        (field) => window.design.getDocument().pages[0].nodes[0].bindings?.[field] === "space",
        field,
      );
    };
    await bind("radius");
    assert.equal((await node("card")).cornerRadii, undefined);
    assert.equal((await styles("card")).radius, "24px");
    await page.getByRole("button", { name: "Independent corner radii", exact: true }).click();
    assert.equal(
      (await node("card")).bindings?.radius,
      undefined,
      "expanding individual corners detaches the uniform binding",
    );
    assert.deepEqual(
      (await node("card")).cornerRadii,
      [24, 24, 24, 24],
      "expanding retains all resolved corner values",
    );
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    assert.equal(
      (await node("card")).bindings.radius,
      "space",
      "undo expansion restores uniform binding",
    );
    await page.getByRole("button", { name: "Independent corner radii", exact: true }).click();
    for (const [index, value] of [8, 32, 48, 32].entries()) {
      await page.locator(`[name="cornerRadii-${index}"]`).fill(String(value));
      await page.locator(`[name="cornerRadii-${index}"]`).press("Enter");
    }
    assert.deepEqual((await node("card")).cornerRadii, [8, 32, 48, 32]);
    assert.equal((await styles("card")).radius, "8px 32px 48px");
    await proof("01-individual-corners.png");
    assert.equal(await page.locator('[name="radius"]').getAttribute("placeholder"), "Mixed");
    assert.equal(await page.locator('[name="radius"]').inputValue(), "");
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    assert.deepEqual(
      (await node("card")).cornerRadii,
      [8, 32, 48, 24],
      "one undo reverts only the last corner edit",
    );
    await page.evaluate(() => window.design.runCommand("edit.redo"));
    await page.getByRole("button", { name: "Independent corner radii", exact: true }).click();
    assert.deepEqual(
      (await node("card")).cornerRadii,
      [8, 32, 48, 32],
      "collapsing controls preserves geometry",
    );
    await bind("radius");
    assert.equal(
      (await node("card")).cornerRadii,
      undefined,
      "rebinding uniform radius replaces individual corners",
    );
    await bind("strokeWidth");
    assert.equal((await node("card")).strokeWidths, undefined);
    assert.equal((await styles("card")).border, "24px");
    await page.getByRole("button", { name: "Independent border sides", exact: true }).click();
    assert.equal((await node("card")).bindings?.strokeWidth, undefined);
    assert.equal(
      (await node("card")).bindings.radius,
      "space",
      "changing borders keeps the radius binding",
    );
    for (const [index, value] of [2, 4, 6, 8].entries()) {
      await page.locator(`[name="strokeWidths-${index}"]`).fill(String(value));
      await page.locator(`[name="strokeWidths-${index}"]`).press("Enter");
    }
    assert.deepEqual((await node("card")).strokeWidths, [2, 4, 6, 8]);
    assert.equal((await styles("card")).border, "2px 4px 6px 8px");
    await proof("02-individual-border-widths.png");
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    assert.deepEqual((await node("card")).strokeWidths, [2, 4, 6, 24]);
    await page.locator('[name="strokeSide-0"]').selectOption("all");
    await page.locator('[name="strokeWidth"]').fill("3");
    await page.locator('[name="strokeWidth"]').press("Enter");
    assert.equal((await node("card")).strokeWidths, undefined);
    assert.equal(
      (await styles("card")).border,
      "3px",
      "typing a uniform width replaces individual sides",
    );
    await bind("strokeWidth");
    // Horizontal and vertical padding bind separately (Wonder 06) and replace imported per-side values.
    await bind("paddingX");
    await bind("paddingY");
    for (const side of ["Top", "Right", "Bottom", "Left"])
      assert.equal((await node("card"))[`padding${side}`], 24);
    assert.equal((await styles("card")).padding, "24px");
    // Detaching vertical padding keeps its value and leaves the horizontal binding in place.
    await page.locator('[data-bound="paddingY"]').click();
    await page.getByRole("menuitem", { name: "Detach variable", exact: true }).click();
    assert.equal((await node("card")).bindings.paddingY, undefined);
    assert.equal((await styles("card")).padding, "24px");
    await page.locator('[name="paddingY"]').fill("10");
    await page.locator('[name="paddingY"]').press("Enter");
    assert.equal((await node("card")).bindings.paddingX, "space");
    assert.equal((await styles("card")).padding, "10px 24px");
    await bind("gap");
    assert.equal((await styles("card")).x, "24px");
    assert.equal(
      (await styles("card")).y,
      "9px",
      "binding the main-axis gap preserves the independent cross-axis gap",
    );
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    assert.equal((await node("card")).gapX, 7, "undo restores the original override");
    assert.equal((await node("card")).bindings.gap, undefined);

    // Vertical flex binds row-gap; grid binds column-gap even when carrying an old flex direction.
    for (const [layout, direction, expected] of [
      ["flex", "column", { x: "7px", y: "24px" }],
      ["grid", "column", { x: "24px", y: "9px" }],
    ]) {
      await page.evaluate(
        ([layout, direction]) => {
          window.design.updateNodes(["card"], { layout, direction, gap: 0, gapX: 7, gapY: 9 });
        },
        [layout, direction],
      );
      await bind("gap");
      const actual = await styles("card");
      assert.deepEqual({ x: actual.x, y: actual.y }, expected);
      await page.locator('[data-bound="gap"]').click();
      await page.getByRole("menuitem", { name: "Detach variable", exact: true }).click();
      assert.equal((await node("card")).bindings.gap, undefined);
      const detached = await styles("card");
      assert.deepEqual(
        { x: detached.x, y: detached.y },
        expected,
        "numeric detach keeps its resolved spacing",
      );
    }
    await page.reload();
    await page.waitForSelector('#canvas [data-id="card"]');
    assert.equal((await node("card")).color, "#22558880", "detached colour persists across reload");
    assert.equal((await styles("card")).radius, "24px", "bound scalar survives persistence");
    console.log(
      "PASS fill detach: alpha, mixed selection, missing token, undo/redo, reload; numeric bindings: override removal, individual corners/borders, independent gaps, undo and detach",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
