// Variables panel library features in the real Electron UI: slash-name folders (collapse, rename, delete),
// colour rename, name-only search, references between variables (chain, cycle guard, detach), and the
// Dimension binding pickers for width, min width, corner radius and line height.
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "bd-variable-folders-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  let app;
  try {
    app = await _electron.launch({
      env,
      args: [".", `--user-data-dir=${profile}`],
      timeout: 20000,
    });
    const page = await app.firstWindow({ timeout: 20000 });
    await page.waitForSelector("#canvas .layer");
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const doc = () => page.evaluate(() => window.design.getDocument());
    const node = async (id) => (await doc()).pages[0].nodes.find((n) => n.id === id);
    const undo = () => page.evaluate(() => window.design.runCommand("edit.undo"));
    const panel = page.locator("#insp-variables");
    const openVariables = async () => {
      const header = panel.locator("button[aria-expanded]").first();
      if ((await header.getAttribute("aria-expanded")) === "false") await header.click();
    };
    const contextMenu = async (locator) => {
      // Let a previous menu finish its exit animation first.
      await page.locator("[role=menu]").first().waitFor({ state: "detached" });
      await locator.click({ button: "right" });
      await page.locator("[role=menu]").first().waitFor();
    };
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens = { "surface/base": "#111827", "surface/raised": "#1f2937", accent: "#5eead4" };
      d.variables = {
        spacing: { type: "dimension", value: 24 },
        "space/lg": { type: "dimension", value: 32 },
        strength: { type: "number", value: 60 },
      };
      delete d.aliases;
      d.pages[0].nodes = [
        {
          id: "card",
          name: "Card",
          type: "frame",
          layout: "flex",
          x: 20,
          y: 20,
          w: 200,
          h: 120,
          color: "#111827",
          token: "surface/base",
          gap: 24,
          bindings: { gap: "spacing" },
        },
        {
          id: "title",
          name: "Title",
          type: "text",
          parentId: "card",
          x: 0,
          y: 0,
          w: 120,
          h: 30,
          text: "Hi",
          color: "#5eead4",
          token: "accent",
          fontSize: 20,
          lineHeight: 1.2,
        },
        {
          id: "chip",
          name: "Chip",
          type: "rectangle",
          x: 240,
          y: 20,
          w: 80,
          h: 40,
          color: "#5eead4",
          fills: [
            { type: "solid", color: "#5eead4", token: "accent" },
            {
              type: "linear",
              angle: 90,
              stops: [
                { color: "#111827", token: "surface/base", position: 0 },
                { color: "#5eead4", token: "accent", position: 100 },
              ],
            },
          ],
        },
      ];
      window.design.setDocument(d);
      window.design.setSelection([]);
    });
    await openVariables();

    // Folders group slash names in every type group, collapse and expand.
    const folder = panel.locator('[role=group][aria-label=Colors] [data-folder="surface"]');
    await folder.waitFor();
    const base = panel.locator('[data-token="surface/base"]');
    await base.waitFor();
    assert.equal(
      (await base.locator("span[title]").first().textContent()).trim(),
      "base",
      "rows show the leaf name",
    );
    await panel.locator('[data-folder="space"] [data-variable="space/lg"]').waitFor();
    await page.getByRole("button", { name: "Collapse folder surface", exact: true }).click();
    await base.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Expand folder surface", exact: true }).click();
    await base.waitFor();

    // Search matches names (folder path included) and never values.
    await page.getByRole("button", { name: "Search variables", exact: true }).click();
    const search = panel.getByRole("textbox", { name: "Search variables" });
    await search.fill("surface/ra");
    await panel.locator('[data-token="surface/raised"]').waitFor();
    assert.equal(await panel.locator("[data-token], [data-variable]").count(), 1);
    await search.fill("#1118");
    await panel.getByText("No variable names contain “#1118”").waitFor();
    await search.press("Escape");
    await base.waitFor();

    // Colour variables rename inline; layer references follow; one undo restores.
    await panel.locator('[data-token="accent"] span[title]').first().dblclick();
    await page.getByRole("textbox", { name: "Rename variable accent" }).fill("brand/accent");
    await page.getByRole("textbox", { name: "Rename variable accent" }).press("Enter");
    await page.waitForFunction(
      () => window.design.getDocument().tokens["brand/accent"] === "#5eead4",
    );
    assert.equal((await node("title")).token, "brand/accent");
    const chip = await node("chip");
    assert.equal(chip.fills[0].token, "brand/accent", "solid paints follow a colour rename");
    assert.equal(
      chip.fills[1].stops[1].token,
      "brand/accent",
      "gradient stops follow a colour rename",
    );
    assert.equal((await doc()).tokens.accent, undefined);
    await panel.locator('[data-folder="brand"] [data-token="brand/accent"]').waitFor();
    await undo();
    assert.equal((await node("title")).token, "accent");

    // Folder rename moves every member and keeps bindings; undo restores.
    await contextMenu(folder.locator("button").first());
    await page.getByRole("menuitem", { name: "Rename folder", exact: true }).click();
    await page.getByRole("textbox", { name: "Rename folder surface" }).fill("bg");
    await page.getByRole("textbox", { name: "Rename folder surface" }).press("Enter");
    await page.waitForFunction(() => !!window.design.getDocument().tokens["bg/base"]);
    assert.deepEqual(Object.keys((await doc()).tokens).sort(), ["accent", "bg/base", "bg/raised"]);
    assert.equal((await node("card")).token, "bg/base");
    await undo();
    assert.equal((await node("card")).token, "surface/base");

    // References: spacing → space/lg; bound layers follow the source; no Duplicate entry.
    await openVariables();
    await contextMenu(panel.locator('[data-variable="spacing"]'));
    assert.equal(
      await page.getByRole("menuitem", { name: /Duplicate/ }).count(),
      0,
      "Wonder offers no Duplicate",
    );
    await page.locator('[data-reference-menu="spacing"]').click();
    await page.locator('[data-reference-target="space/lg"]').click();
    await page.waitForFunction(() => window.design.getDocument().aliases?.spacing === "space/lg");
    assert.equal((await doc()).variables.spacing.value, 32);
    assert.equal((await node("card")).gap, 32);
    await panel.locator('[data-variable="spacing"] [data-reference="space/lg"]').waitFor();
    const source = panel.getByRole("textbox", { name: "space/lg value" });
    await source.fill("40");
    await source.press("Enter");
    await page.waitForFunction(() => window.design.getDocument().pages[0].nodes[0].gap === 40);
    assert.equal((await doc()).variables.spacing.value, 40);
    // space/lg cannot reference spacing (it would form a cycle).
    await contextMenu(panel.locator('[data-variable="space/lg"]'));
    // Its only other Dimension is spacing, so the submenu is disabled.
    assert.equal(
      await page.locator('[data-reference-menu="space/lg"]').getAttribute("aria-disabled"),
      "true",
      "cycles are not offered",
    );
    await page.keyboard.press("Escape");
    await page.locator("[role=menu]").first().waitFor({ state: "detached" });
    // Colour references resolve too.
    await contextMenu(panel.locator('[data-token="accent"] span[title]').first());
    await page.locator('[data-reference-menu="accent"]').click();
    await page.locator('[data-reference-target="surface/raised"]').click();
    await page.waitForFunction(() => window.design.getDocument().tokens.accent === "#1f2937");
    assert.equal(
      await page.locator('#canvas [data-id="title"]').evaluate((el) => getComputedStyle(el).color),
      "rgb(31, 41, 55)",
    );
    // Detach keeps the resolved literal.
    await contextMenu(panel.locator('[data-variable="spacing"]'));
    await page.getByRole("menuitem", { name: "Detach reference", exact: true }).click();
    await page.waitForFunction(() => window.design.getDocument().aliases?.spacing === undefined);
    assert.equal((await doc()).variables.spacing.value, 40);
    assert.equal((await doc()).aliases?.accent, "surface/raised");

    // Folder delete removes all members; bound layers keep the resolved colour; references become literal.
    await contextMenu(folder.locator("button").first());
    await page.getByRole("menuitem", { name: "Delete folder (2)", exact: true }).click();
    await page.waitForFunction(() => !window.design.getDocument().tokens["surface/base"]);
    const afterDelete = await doc();
    assert.equal(afterDelete.pages[0].nodes[0].token, "");
    assert.equal(afterDelete.pages[0].nodes[0].color, "#111827");
    const chipStop = afterDelete.pages[0].nodes.find((n) => n.id === "chip").fills[1].stops[0];
    assert.deepEqual(
      [chipStop.token, chipStop.color],
      [undefined, "#111827"],
      "deleted variables detach from gradient stops with their value",
    );
    assert.equal(afterDelete.aliases, undefined);
    assert.equal(afterDelete.tokens.accent, "#1f2937");
    await undo();
    assert.equal((await node("card")).token, "surface/base");
    assert.equal((await doc()).aliases.accent, "surface/raised");

    // Dimension pickers: width, min width, a single corner, line height (px → multiplier).
    const bind = async (field, variable) => {
      const trigger = page.locator(`[data-bind="${field}"]`);
      await trigger.scrollIntoViewIfNeeded();
      await trigger.focus();
      await trigger.click();
      await page.locator(`[role="menuitem"][data-variable="${variable}"]`).click();
      await page.locator(`[data-bound="${field}"]`).waitFor();
    };
    await page.evaluate(() => {
      window.design.updateNodes(["card"], { minW: 50 });
      window.design.setSelection(["card"]);
    });
    await bind("w", "space/lg");
    assert.equal((await node("card")).w, 40);
    await bind("minW", "spacing");
    assert.equal((await node("card")).minW, 40);
    await page.getByRole("button", { name: "Independent corner radii", exact: true }).click();
    const r = (await node("card")).radius;
    await bind("radiusTopLeft", "spacing");
    assert.deepEqual((await node("card")).cornerRadii, [40, r, r, r]);
    await openVariables();
    const spacing = panel.getByRole("textbox", { name: "spacing value" });
    await spacing.fill("16");
    await spacing.press("Enter");
    await page.waitForFunction(
      () => window.design.getDocument().pages[0].nodes[0].cornerRadii?.[0] === 16,
    );
    assert.equal(
      await page
        .locator('#canvas [data-id="card"]')
        .evaluate((el) => getComputedStyle(el).borderTopLeftRadius),
      "16px",
    );
    assert.equal((await node("card")).minW, 16);
    await page.evaluate(() => window.design.setSelection(["title"]));
    await bind("lineHeight", "space/lg");
    assert.equal((await node("title")).lineHeight, 2, "40px over a 20px font");
    // Numbers only drive opacity, so the width picker does not offer them.
    await page.evaluate(() => window.design.setSelection(["card"]));
    await page.locator('[data-bound="w"]').click();
    assert.equal(await page.locator('[role="menuitem"][data-variable="strength"]').count(), 0);
    await page.keyboard.press("Escape");
    await page.reload();
    await page.waitForSelector('#canvas [data-id="card"]');
    const reloaded = await doc();
    assert.equal(reloaded.aliases.accent, "surface/raised");
    assert.deepEqual(reloaded.pages[0].nodes[0].bindings, {
      gap: "spacing",
      w: "space/lg",
      minW: "spacing",
      radiusTopLeft: "spacing",
    });
    assert.deepEqual(errors, [], "No uncaught renderer errors");
    console.log(
      "PASS variable folders: collapse, search by name, colour rename (incl. paints), folder rename/delete + undo, references (chain, cycle guard, detach), size/limit/corner/line-height bindings, reload",
    );
  } finally {
    try {
      await app?.close();
    } finally {
      await fs.rm(profile, { recursive: true, force: true });
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
