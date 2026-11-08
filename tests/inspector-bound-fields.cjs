// Bound-field presentation (Wonder 2026-10-30/05, 06, 07, 13, 23, 35, 37, 38): a field bound to a variable keeps
// its prefix and shows the variable as a chip (leaf name, no unit or opacity), colour fields add the swatch, and the
// chip follows rename, disappears on delete (keeping the resolved value) and comes back with undo.
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "inspector-bound-fields-"));
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
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForSelector("#canvas .layer");
    const node = (id) =>
      page.evaluate(
        (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id),
        id,
      );
    const undo = () => page.evaluate(() => window.design.runCommand("edit.undo"));
    const chip = (scope) => page.locator(`${scope} [data-variable-chip]`);
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens = { "surface/base": "#172033", accent: "#5eead4" };
      d.variables = {
        spacing: { type: "dimension", value: 24 },
        strength: { type: "number", value: 60 },
        family: { type: "fontFamily", value: "Inter" },
        weight: { type: "fontWeight", value: "600" },
      };
      d.pages = [
        {
          id: "p",
          name: "Bound fields",
          nodes: [
            {
              id: "card",
              name: "Card",
              type: "frame",
              x: 20,
              y: 20,
              w: 320,
              h: 220,
              color: "#172033",
              token: "surface/base",
              layout: "flex",
              direction: "row",
              radius: 24,
              gap: 24,
              opacity: 60,
              strokeWidth: 2,
              strokeColor: "#5eead4",
              strokeToken: "accent",
              bindings: { radius: "spacing", gap: "spacing", opacity: "strength" },
            },
            {
              id: "title",
              name: "Title",
              type: "text",
              x: 400,
              y: 20,
              w: 200,
              h: 60,
              text: "Hello",
              color: "#ffffff",
              fontSize: 24,
              fontFamily: "Inter",
              fontWeight: "600",
              bindings: { fontFamily: "family", fontWeight: "weight", fontSize: "spacing" },
            },
            {
              id: "box",
              name: "Box",
              type: "rectangle",
              x: 400,
              y: 200,
              w: 64,
              h: 64,
              color: "#ff0000",
            },
          ],
        },
      ];
      d.activePage = "p";
      window.design.setDocument(d);
      window.design.setSelection(["card"]);
    });

    // Numeric fields: prefix kept, chip instead of the value, no unit suffix, no apply button.
    for (const field of ["radius", "gap", "opacity"]) {
      const bound = page.locator(`[data-bound="${field}"]`);
      await bound.waitFor();
      assert.equal(
        await page.locator(`[name="${field}"]`).count(),
        0,
        `${field}: no editable input`,
      );
      assert.equal(await bound.locator("svg").count(), 1, `${field}: keeps its prefix icon only`);
      const text = await bound.innerText();
      assert.ok(!/%|px/.test(text), `${field}: bound field has no unit suffix (${text})`);
    }
    assert.equal(await chip('[data-bound="radius"]').innerText(), "spacing");
    const geometry = await page.locator('[data-bound="radius"]').evaluate((field) => {
      const c = field.querySelector("[data-variable-chip]").getBoundingClientRect();
      const f = field.getBoundingClientRect();
      const s = getComputedStyle(field.querySelector("[data-variable-chip]"));
      return {
        height: c.height,
        left: c.left - f.left,
        radius: s.borderRadius,
        background: s.backgroundColor,
        field: getComputedStyle(field).backgroundColor,
      };
    });
    assert.equal(geometry.height, 16, "chip is 16px tall");
    assert.equal(geometry.radius, "4px");
    assert.ok(
      geometry.left >= 27 && geometry.left <= 28.5,
      `chip sits after the prefix (${geometry.left})`,
    );
    assert.notEqual(geometry.background, geometry.field, "chip fill differs from the field");
    // Properties audit B5: a plain value after a prefix starts 24px into the field (Wonder x 36.5 with the field at 12),
    // 4px before the chip box, and a long variable name truncates at about 56px ("dimen…").
    const plain = await page.locator('[name="x"]').evaluate((input) => {
      const shell = input.closest("[data-field-shell]").getBoundingClientRect();
      return input.getBoundingClientRect().left - shell.left;
    });
    assert.ok(plain >= 23.5 && plain <= 24.5, `plain value starts 24px in (${plain})`);
    assert.equal(
      await chip('[data-bound="radius"]').evaluate((e) => getComputedStyle(e).maxWidth),
      "56px",
      "numeric chips truncate at 56px",
    );

    // Colour fields: swatch + chip with the leaf of a folder name, no hex/opacity.
    const fill = page.locator("#fill-section [data-paint='0']");
    assert.equal(await chip("#fill-section [data-paint='0']").innerText(), "base");
    assert.equal(
      await chip("#fill-section [data-paint='0']").getAttribute("data-variable-chip"),
      "surface/base",
    );
    assert.equal(
      await fill.getByRole("textbox").count(),
      0,
      "bound fill shows no hex or opacity field",
    );
    assert.equal(
      await fill.getByRole("button", { name: "Fill colour" }).count(),
      1,
      "swatch stays",
    );
    assert.equal(await chip("#border-section").innerText(), "accent");
    assert.equal(await page.locator("#border-section [name=strokeColor]").count(), 0);
    // The fill chip opens the colour picker on its Variables tab.
    await page.getByRole("button", { name: "Fill variable surface/base" }).click();
    await page
      .locator("#color-dialog")
      .getByRole("tab", { name: "Variables", selected: true })
      .waitFor();
    await page.keyboard.press("Escape");

    // Typography: family/weight pickers show chips (no chevron), size keeps its prefix.
    await page.evaluate(() => window.design.setSelection(["title"]));
    assert.equal(await chip('[data-bound="fontFamily"]').innerText(), "family");
    assert.equal(await chip('[data-bound="fontWeight"]').innerText(), "weight");
    assert.equal(
      await page.locator('[data-bound="fontFamily"] svg').count(),
      0,
      "no chevron when bound",
    );
    assert.equal(await chip('[data-bound="fontSize"]').innerText(), "spacing");
    // Switching to a non-text layer drops the Typography section and its chips (React key collision regression).
    await page.evaluate(() => window.design.setSelection(["box"]));
    await page.locator("#typography-section").waitFor({ state: "detached" });
    assert.equal(
      await page.locator("[data-bound]").count(),
      0,
      "no stale bound chips after selection change",
    );
    await page.evaluate(() => window.design.setSelection(["card"]));

    // Rename (35): every chip follows the new name.
    const renamed = await page.evaluate(() => {
      const d = window.design.getDocument();
      d.variables = { gap: d.variables.spacing, ...d.variables };
      delete d.variables.spacing;
      for (const n of d.pages[0].nodes)
        for (const [k, v] of Object.entries(n.bindings ?? {}))
          if (v === "spacing") n.bindings[k] = "gap";
      window.design.setDocument(d);
      window.design.setSelection(["card"]);
      return d.pages[0].nodes[0].bindings.radius;
    });
    assert.equal(renamed, "gap");
    assert.equal(await chip('[data-bound="radius"]').innerText(), "gap");
    await undo();
    assert.equal(await chip('[data-bound="radius"]').innerText(), "spacing");

    // Missing variable (edited outside the app): the chip stays and is flagged.
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.pages[0].nodes[0].token = "ghost";
      window.design.setDocument(d);
      window.design.setSelection(["card"]);
    });
    assert.equal(await chip("#fill-section [data-paint='0']").getAttribute("data-missing"), "true");
    await undo();

    // Delete (37): the field returns to its resolved value; undo (38) restores the chip.
    const header = page.locator("#insp-variables button[aria-expanded]").first();
    if ((await header.getAttribute("aria-expanded")) === "false") await header.click();
    await page.locator('#insp-variables [data-variable="spacing"]').hover();
    await page.getByRole("button", { name: "Delete variable spacing" }).click();
    await page.waitForFunction(() => !window.design.getDocument().variables.spacing);
    assert.equal(await page.locator('[data-bound="radius"]').count(), 0);
    assert.equal(
      await page.locator('[name="radius"]').inputValue(),
      "24",
      "deleted variable keeps the value",
    );
    assert.equal((await node("card")).radius, 24);
    await undo();
    await page.locator('[data-bound="radius"]').waitFor();
    assert.equal(
      await chip('[data-bound="radius"]').innerText(),
      "spacing",
      "undo restores the binding chip",
    );

    // Detach (23): colour keeps its value and the hex field replaces the chip.
    // Wonder A1/B3: the unlink is inside the bound row, on hover.
    await page.locator("#fill-section [data-paint='0']").hover();
    await page
      .locator("#fill-section")
      .getByRole("button", { name: "Detach variable", exact: true })
      .click();
    assert.equal(
      await chip("#fill-section [data-paint='0']").count(),
      0,
      "no stale chip after detach",
    );
    assert.equal(
      await page.getByRole("textbox", { name: "Fill hex colour" }).inputValue(),
      "172033",
      "detached fill shows the resolved colour",
    );
    assert.equal(await page.getByRole("textbox", { name: "Fill opacity" }).inputValue(), "100");

    // Light theme keeps a distinct chip.
    await page.evaluate(() => document.documentElement.setAttribute("data-ui-theme", "light"));
    const light = await page
      .locator('[data-bound="radius"]')
      .evaluate((field) => [
        getComputedStyle(field.querySelector("[data-variable-chip]")).backgroundColor,
        getComputedStyle(field).backgroundColor,
      ]);
    assert.notEqual(light[0], light[1], "light theme chip differs from its field");
    assert.deepEqual(errors, [], "no renderer errors");
    console.log(
      "PASS bound fields: chips with prefix/swatch, leaf names, no units, typography chips, no stale Typography section, rename, missing, delete + undo, detach, light theme",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
