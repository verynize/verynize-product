// Inspector parity with Wonder (design/wonder 23, 26–27, 41–42, 45–50): colour picker alpha + formats, per-fill
// opacity, typed variables (dimension/number/font family/font weight) with bindings, the font catalog picker with
// family-specific weights, and artwork export at 0.5×/4× and as PDF through the native save dialog.
const { _electron } = require("@playwright/test");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");

const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inspector-parity-"));
  const fontCache = path.join(dir, "fonts"),
    out = path.join(dir, "out");
  await fs.mkdir(path.join(fontCache, "meta"), { recursive: true });
  await fs.mkdir(out);
  // Fresh catalog in the font cache: the picker must not need the network.
  await fs.writeFile(
    path.join(fontCache, "meta", "catalog.json"),
    JSON.stringify([
      {
        id: "lora",
        family: "Lora",
        category: "serif",
        weights: [400, 500, 600, 700],
        styles: ["normal", "italic"],
        kind: "web",
      },
      {
        id: "zilla-slab",
        family: "Zilla Slab",
        category: "serif",
        weights: [300, 400, 500, 600, 700],
        styles: ["normal"],
        kind: "web",
      },
      // Enough families for the picker's infinite scroll to need more than one page.
      ...Array.from({ length: 90 }, (_, i) => ({
        id: `scroll-test-${i}`,
        family: `Scroll Test ${String(i).padStart(2, "0")}`,
        category: "sans-serif",
        weights: [400],
        styles: ["normal"],
        kind: "web",
      })),
    ]),
  );
  const env = { ...process.env, VERYNIZE_FONT_CACHE: fontCache };
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
    await moveOffCursor(app);
    await waitForUiReady(page);
    await page.waitForSelector("#canvas .layer");
    const doc = () => page.evaluate(() => window.design.getDocument());
    // Menus/popovers animate out; wait until the previous one is gone before opening the next.
    const closed = () =>
      page.waitForFunction(
        () => !document.querySelector("#font-weight-picker,#font-family-picker"),
      );
    const node = async (id) => (await doc()).pages[0].nodes.find((n) => n.id === id);
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens = {};
      delete d.variables;
      d.pages[0].nodes = [
        {
          id: "card",
          name: "Card",
          type: "frame",
          x: 20,
          y: 20,
          w: 100,
          h: 80,
          color: "#ff0000",
          layout: "flex",
          gap: 4,
          padding: 8,
        },
        {
          id: "title",
          name: "Title",
          type: "text",
          x: 200,
          y: 40,
          w: 160,
          h: 40,
          text: "Hello",
          color: "#111111",
          fontFamily: "Inter",
          fontWeight: "400",
          fontSize: 24,
        },
      ];
      window.design.setDocument(d);
      window.design.setSelection(["card"]);
    });

    // --- Colour picker: alpha slider value, formats, per-fill opacity -----------------------------------------
    await page.locator("[name=color]").click();
    await page.waitForSelector("#color-dialog #color-field");
    await page.getByRole("textbox", { name: "Opacity percent" }).fill("50");
    await page.getByRole("textbox", { name: "Opacity percent" }).press("Enter");
    assert.equal((await node("card")).color, "#ff000080");
    assert.equal(
      (await node("card")).opacity ?? 100,
      100,
      "fill alpha does not change layer opacity",
    );
    assert.equal(
      await page
        .locator("#canvas [data-id=card]")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgba(255, 0, 0, 0.5)",
    );
    await page.locator('#color-dialog select[aria-label="Colour format"]').selectOption("rgb");
    assert.equal(await page.locator("#color-value").inputValue(), "rgb(255 0 0)");
    await page.locator("#color-value").fill("hsl(120 100% 25%)");
    await page.locator("#color-value").press("Tab");
    assert.equal((await node("card")).color, "#00800080", "typed colours keep the alpha");
    await page.locator('#color-dialog select[aria-label="Colour format"]').selectOption("oklch");
    assert.match(await page.locator("#color-value").inputValue(), /^oklch\(/);
    // Drag on the saturation/value plane: top-right corner = fully saturated hue, committed once on release.
    const field = await page.locator("#color-field").boundingBox();
    await page.mouse.move(field.x + field.width / 2, field.y + field.height / 2);
    await page.mouse.down();
    await page.mouse.move(field.x + field.width - 4, field.y + 4, { steps: 4 });
    assert.equal((await node("card")).color, "#00800080", "dragging previews without committing");
    await page.mouse.up();
    assert.match(
      (await node("card")).color,
      /^#0[0-9a-f][ef][0-9a-f]0[0-9a-f]80$/,
      "released near the top-right corner: saturated green, alpha kept",
    );
    await page.locator("#color-dialog .dialog-head button").click();
    await page.waitForSelector("#color-dialog", { state: "detached" });
    await page.getByRole("textbox", { name: "Fill opacity" }).fill("25");
    await page.getByRole("textbox", { name: "Fill opacity" }).press("Enter");
    assert.match((await node("card")).color, /40$/);
    await page.getByRole("textbox", { name: "Fill hex colour" }).fill("123456");
    await page.getByRole("textbox", { name: "Fill hex colour" }).press("Enter");
    assert.equal((await node("card")).color, "#12345640", "retyping the hex keeps the fill alpha");
    console.log(
      "PASS colour picker alpha, HEX/RGB/HSL/OKLCH formats, drag commit and per-fill opacity",
    );

    // --- Variables: create every type, bind, follow value changes, detach on delete ---------------------------
    const create = async (type, name) => {
      await page.locator("[id^=add-][id$=-variable]").first().waitFor({ state: "detached" });
      await page.locator("#add-token").click();
      await page.locator(`#add-${type}-variable`).click();
      await page.locator("#text-prompt-input").fill(name);
      await page.locator("#text-prompt-ok").click();
      await page.waitForFunction((n) => window.design.getDocument().variables?.[n], name);
    };
    await create("dimension", "space/md");
    await create("number", "ratio");
    await create("fontFamily", "font/body");
    await create("fontWeight", "weight/strong");
    assert.deepEqual((await doc()).variables, {
      "space/md": { type: "dimension", value: 16 },
      ratio: { type: "number", value: 1 },
      "font/body": { type: "fontFamily", value: "Inter" },
      "weight/strong": { type: "fontWeight", value: "400" },
    });
    assert.deepEqual(
      await page.evaluate(() => window.design.getSelection()),
      ["card"],
      "creating a variable keeps the selection",
    );
    await page
      .locator('#insp-variables [role=group][aria-label="Dimensions"] [data-variable="space/md"]')
      .waitFor();
    // Bind the frame's corner radius and gap.
    await page.locator("[name=radius]").hover();
    await page.locator("[data-bind=radius]").click();
    await page.locator('[role=menuitem][data-variable="space/md"]').click();
    await page.waitForFunction(
      () => window.design.getDocument().pages[0].nodes[0].bindings?.radius === "space/md",
    );
    assert.equal((await node("card")).radius, 16);
    await page.locator("[data-bound=radius]").waitFor();
    await page.locator("[name=gap]").hover();
    await page.locator("[data-bind=gap]").click();
    await page.locator('[role=menuitem][data-variable="space/md"]').click();
    await page.waitForFunction(() => window.design.getDocument().pages[0].nodes[0].gap === 16);
    // Change the variable value: bound layers follow (one undo step).
    const valueField = page.getByRole("textbox", { name: "space/md value" });
    await valueField.fill("24");
    await valueField.press("Enter");
    await page.waitForFunction(
      () => window.design.getDocument().variables["space/md"].value === 24,
    );
    assert.equal((await node("card")).radius, 24);
    assert.equal((await node("card")).gap, 24);
    assert.equal(
      await page.locator("#canvas [data-id=card]").evaluate((el) => el.style.borderRadius),
      "24px",
    );
    // Number variables drive unitless properties such as opacity.
    await page.locator("[name=opacity]").hover();
    await page.locator("[data-bind=opacity]").click();
    await page.locator('[role=menuitem][data-variable="ratio"]').click();
    await page.waitForFunction(
      () => window.design.getDocument().pages[0].nodes[0].bindings?.opacity === "ratio",
    );
    assert.equal((await node("card")).opacity, 1);
    // Typing into a bound field is impossible (chip); detaching keeps the value.
    await page.locator("[data-bound=opacity]").click();
    await page.getByRole("menuitem", { name: "Detach variable" }).click();
    await page.waitForFunction(
      () => !window.design.getDocument().pages[0].nodes[0].bindings?.opacity,
    );
    // Deleting a variable unbinds layers but keeps their resolved values.
    const radiusBefore = (await node("card")).radius;
    await page.locator('[data-variable="space/md"]').hover();
    await page.getByRole("button", { name: "Delete variable space/md" }).click();
    await page.waitForFunction(() => !window.design.getDocument().variables["space/md"]);
    assert.equal((await node("card")).bindings, undefined);
    assert.equal((await node("card")).radius, radiusBefore);
    // validate() in app.js rejects malformed variables and bindings (mirrors integrations/design-store.mjs).
    const rejected = await page.evaluate(() => {
      const out = [];
      for (const patch of [
        (d) => {
          d.variables = { x: { type: "dimension", value: "12px" } };
        },
        (d) => {
          d.variables = { "bad;": { type: "number", value: 1 } };
        },
        (d) => {
          d.pages[0].nodes[0].bindings = { color: "ratio" };
        },
        (d) => {
          d.tokens = { a: "#12345" };
        },
        (d) => {
          d.variables = { x: { type: "fontFamily", value: "a;b" } };
        },
      ]) {
        const d = window.design.getDocument();
        patch(d);
        try {
          window.design.setDocument(d);
          out.push(false);
        } catch {
          out.push(true);
        }
      }
      return out;
    });
    assert.deepEqual(rejected, [true, true, true, true, true]);
    // CSS variable export.
    await page.locator("#variables-css").click();
    await page.locator("#copy-variables-css").click();
    await page
      .getByText(/Copied \d+ variables as CSS/)
      .first()
      .waitFor();
    const css = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.match(
      css,
      /^:root \{\n  --ratio: 1;\n  --font-body: Inter;\n  --weight-strong: 400;\n\}/,
    );
    console.log(
      "PASS dimension/number/font variables: create, bind, follow, detach, delete, validate, CSS export",
    );

    // --- Typography: catalog font picker, weights limited to the family, font variables -----------------------
    await page.evaluate(() => window.design.setSelection(["title"]));
    await closed();
    await page.getByRole("button", { name: "Font family" }).click();
    await page.getByRole("combobox", { name: "Search fonts" }).fill("lor");
    await page.locator('#font-family-list [data-family="Lora"]').click();
    await page.waitForFunction(
      () => window.design.getDocument().pages[0].nodes[1].fontFamily === "Lora",
    );
    await closed();
    await page.getByRole("button", { name: "Font weight" }).click();
    const weights = await page
      .locator("#font-weight-picker [data-weight]")
      .evaluateAll((els) => els.map((el) => el.dataset.weight));
    assert.deepEqual(weights, ["400", "500", "600", "700"], "only the weights Lora ships");
    await page.locator('#font-weight-picker [data-weight="600"]').click();
    assert.equal((await node("title")).fontWeight, "600");
    // Switching to a family without the current weight snaps to the nearest one it has.
    await closed();
    await page.getByRole("button", { name: "Font family" }).click();
    await page.getByRole("combobox", { name: "Search fonts" }).fill("zilla");
    await page.getByRole("combobox", { name: "Search fonts" }).press("Enter");
    await page.waitForFunction(
      () => window.design.getDocument().pages[0].nodes[1].fontFamily === "Zilla Slab",
    );
    await closed();
    await page.getByRole("button", { name: "Font weight" }).click();
    await page.locator('#font-weight-picker [data-weight="300"]').click();
    await page.waitForFunction(
      () => window.design.getDocument().pages[0].nodes[1].fontWeight === "300",
    );
    await closed();
    await page.getByRole("button", { name: "Font family" }).click();
    await page.getByRole("combobox", { name: "Search fonts" }).fill("Lora");
    await page.getByRole("combobox", { name: "Search fonts" }).press("Enter");
    await page.waitForFunction(
      () => window.design.getDocument().pages[0].nodes[1].fontWeight === "400",
    );
    // Font family / weight variables.
    await closed();
    await page.getByRole("button", { name: "Font weight" }).click();
    await page
      .locator("#font-weight-picker [role=menuitem]")
      .filter({ hasText: "weight/strong" })
      .click();
    await page.waitForFunction(
      () => window.design.getDocument().pages[0].nodes[1].bindings?.fontWeight === "weight/strong",
    );
    await page.locator('[data-variable="weight/strong"] select').selectOption("800");
    await page.waitForFunction(
      () => window.design.getDocument().pages[0].nodes[1].fontWeight === "800",
    );
    // Font source tabs: All (Google + system), Custom (installed), Variable (font family variables, detach).
    await closed();
    await page.getByRole("button", { name: "Font family" }).click();
    const tabs = page.locator("#font-family-picker [role=tab]");
    assert.deepEqual(await tabs.allInnerTexts(), ["All", "Custom", "Variable"]);
    assert.equal(
      await page
        .locator("#font-family-list [data-family]")
        .filter({ hasText: "Installed" })
        .count(),
      0,
      "All lists no installed fonts",
    );
    // Infinite scroll: one page of 40, then the next page loads (spinner row) when the bottom is reached.
    const options = page.locator("#font-family-list [data-family]");
    assert.equal(await options.count(), 40, "first page");
    await page.locator("#font-family-list [data-font-list-more] [role=status]").waitFor();
    await page.locator("#font-family-list").evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForFunction(
      () => document.querySelectorAll("#font-family-list [data-family]").length === 80,
      null,
      { timeout: 15000 },
    );
    await tabs.filter({ hasText: "Variable" }).click();
    assert.equal(
      await page.locator("#font-family-list [data-font-list-more]").count(),
      0,
      "no spinner under variables",
    );
    await page.locator('#font-family-list [data-variable="font/body"]').click();
    await page.waitForFunction(
      () => window.design.getDocument().pages[0].nodes[1].bindings?.fontFamily === "font/body",
    );
    await closed();
    await page.getByRole("button", { name: "Font family" }).click();
    assert.equal(
      await tabs.filter({ hasText: "Variable" }).getAttribute("aria-selected"),
      "true",
      "a bound family opens on Variable",
    );
    await page
      .locator("#font-family-list")
      .getByRole("button", { name: "Detach variable" })
      .click();
    await page.waitForFunction(
      () => !window.design.getDocument().pages[0].nodes[1].bindings?.fontFamily,
    );
    console.log("PASS font catalog picker, family-limited weights, font family/weight variables");

    // --- Export: 0.5× / 4× PNG and PDF through the native save dialog, success toast --------------------------
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.pages[0].nodes[0].color = "#ff0000";
      d.pages[0].nodes[0].radius = 0;
      d.pages[0].nodes[0].opacity = 100;
      window.design.setDocument(d);
      window.design.setSelection(["card"]);
    });
    let target = "";
    const saveAs = async (file) => {
      target = path.join(out, file);
      await app.evaluate(({ dialog }, t) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: t });
      }, target);
    };
    await page.locator("#export-section .insp-add").click();
    const scales = await page
      .locator("#artwork-scale option")
      .evaluateAll((els) => els.map((el) => el.value));
    assert.deepEqual(scales, [
      "0.5",
      "1",
      "2",
      "3",
      "4",
      "720p",
      "1080p",
      "1440p",
      "2160p",
      "512w",
      "512h",
    ]);
    const formats = await page
      .locator("#artwork-format option")
      .evaluateAll((els) => els.map((el) => el.value));
    assert.ok(formats.includes("PDF"));
    await saveAs("card@4x.png");
    await page.locator("#artwork-scale").selectOption("4");
    await page.locator("#artwork-format").selectOption("PNG");
    await page.locator("#artwork-download").click();
    await page.getByText("Exported 1 element").first().waitFor({ timeout: 20000 });
    assert.deepEqual(pngSize(await fs.readFile(target)), { width: 400, height: 320 });
    await saveAs("card@0.5x.png");
    await page.locator("#artwork-scale").selectOption("0.5");
    await page.locator("#artwork-download").click();
    await page.waitForFunction(
      () => /card@0\.5x\.png/.test(document.querySelector("#artwork-status")?.textContent || ""),
      null,
      { timeout: 20000 },
    );
    assert.deepEqual(pngSize(await fs.readFile(target)), { width: 50, height: 40 });
    await saveAs("card.pdf");
    await page.locator("#artwork-format").selectOption("PDF");
    assert.equal(await page.locator("#artwork-download").textContent(), "Export as PDF");
    await page.locator("#artwork-download").click();
    await page.waitForFunction(
      () => /card\.pdf/.test(document.querySelector("#artwork-status")?.textContent || ""),
      null,
      { timeout: 20000 },
    );
    // One export, one toast: a second toast stacks, and a hovered stack keeps both on screen.
    await page.locator("[data-sonner-toast]", { hasText: "card.pdf" }).first().waitFor();
    assert.equal(await page.locator("[data-sonner-toast]").count(), 1, "one toast per export");
    const pdf = await fs.readFile(target);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.match(
      pdf.toString("latin1"),
      /\/MediaBox \[0 0 75(\.\d+)? 60(\.\d+)?\]/,
      "one page at the artwork size (100×80 px = 75×60 pt)",
    );
    assert.equal((pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length, 1, "single page");
    assert.match(
      pdf.toString("latin1"),
      /\/Title \(Card\)/,
      "PDF title is the export name, not the HTML",
    );
    // Cancelling the save dialog writes nothing and shows no error.
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true });
    });
    // SVG is offered only when every exported layer is an SVG image (a frame is not).
    assert.equal(formats.includes("SVG"), false);
    await page.locator("#artwork-format").selectOption("JPG");
    await page.locator("#artwork-download").click();
    await page.waitForTimeout(500);
    assert.equal(await page.locator("#artwork-status").textContent(), "");
    console.log("PASS export 0.5×/4× PNG, PDF and native save dialog with success toast");
    // Like Wonder (ref 50) the export toasts sit over the bottom-right of the inspector; let them leave (Sonner pauses
    // while hovered) before the menus below open there.
    await page.mouse.move(400, 300);
    await page.waitForSelector("[data-sonner-toast]", { state: "detached", timeout: 20000 });

    // --- Layout section per display (Wonder Layout panel): flex matrix/distribution/reverse/wrap/gaps, padding
    // axes and sides, Grid settings tracks (fr weights, auto rows) + Automatic positioning + cell alignment, grid child spans, margin auto, block spacing, min/max limits ------
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.pages[0].nodes = [
        {
          id: "fx",
          name: "Flex",
          type: "frame",
          x: 0,
          y: 0,
          w: 300,
          h: 120,
          color: "#ffffff",
          layout: "flex",
          direction: "row",
          gap: 4,
          padding: 8,
          alignItems: "stretch",
          justifyContent: "flex-start",
        },
        {
          id: "fa",
          name: "A",
          type: "rectangle",
          parentId: "fx",
          x: 0,
          y: 0,
          w: 40,
          h: 40,
          color: "#ff0000",
        },
        {
          id: "gd",
          name: "Grid",
          type: "frame",
          x: 0,
          y: 200,
          w: 400,
          h: 300,
          color: "#ffffff",
          layout: "grid",
          columns: 2,
          gap: 10,
          padding: 0,
        },
        {
          id: "gc",
          name: "Cell",
          type: "frame",
          parentId: "gd",
          x: 0,
          y: 0,
          w: 80,
          h: 60,
          color: "#eeeeee",
          layout: "free",
        },
        {
          id: "bk",
          name: "Block",
          type: "frame",
          x: 500,
          y: 0,
          w: 200,
          h: 200,
          color: "#ffffff",
          layout: "block",
          padding: 0,
        },
      ];
      window.design.setDocument(d);
      window.design.setSelection(["fx"]);
    });
    const styleOf = (id, prop) =>
      page.locator(`#canvas [data-id=${id}]`).evaluate((el, p) => getComputedStyle(el)[p], prop);
    const typeIn = async (name, value) => {
      const f = page.locator(`#layout-section [name=${name}]`);
      await f.fill(value);
      await f.press("Enter");
    };
    const matrix = (label) => page.locator(`#layout-section [role=group][aria-label="${label}"]`);
    // A Radix menu that is still closing ignores the next press on its trigger: wait until it is gone.
    const openMenu = async (trigger) => {
      await page.locator("[role=menu]").waitFor({ state: "detached" });
      await page.locator(trigger).click();
      await page.locator("[role=menu]").waitFor();
    };
    // Row direction: the matrix column is the main axis (justify), the row is the cross axis (align).
    await matrix("Alignment").locator('[data-cell="1-2"]').click();
    assert.deepEqual(
      [(await node("fx")).justifyContent, (await node("fx")).alignItems],
      ["flex-end", "center"],
      "matrix sets justify + align",
    );
    assert.equal(
      await matrix("Alignment").locator("[aria-pressed=true]").getAttribute("data-cell"),
      "1-2",
    );
    // Wonder G4 (verified crops): the active glyph sits on the dot column/row along the main axis and 3px from the
    // well's edge on the cross axis, in all 9 cells and both directions (10 × 10 box of 6/10/6 bars).
    const glyphBox = () =>
      matrix("Alignment").evaluate((m) => {
        const g = m.querySelector("[aria-pressed=true] > span"),
          a = m.getBoundingClientRect(),
          b = g.getBoundingClientRect();
        return [b.left - a.left, b.top - a.top, b.width, b.height];
      });
    const WONDER = {
      row: { x: [15, 49, 83], y: [3, 23, 43] },
      column: { x: [3, 49, 95], y: [6.5, 23, 39.5] },
    };
    for (const dir of ["row", "column"]) {
      await page.evaluate((d) => window.design.updateNodes(["fx"], { direction: d }), dir);
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) {
          await matrix("Alignment").locator(`[data-cell="${r}-${c}"]`).click();
          const [x, y, w, h] = await glyphBox();
          assert.ok(
            Math.abs(x - WONDER[dir].x[c]) <= 0.5 &&
              Math.abs(y - WONDER[dir].y[r]) <= 0.5 &&
              w === 10 &&
              h === 10,
            `${dir} ${r}-${c}: glyph at ${[x, y, w, h].join(",")}`,
          );
        }
    }
    await page.evaluate(() =>
      window.design.updateNodes(["fx"], {
        direction: "row",
        justifyContent: "flex-end",
        alignItems: "center",
      }),
    );
    // Wonder H9: the cell tooltip is the app's own chip ("Align bottom right"), not a native title.
    assert.equal(
      await matrix("Alignment").locator('[data-cell="2-2"]').getAttribute("title"),
      null,
    );
    await page.mouse.move(5, 5);
    await matrix("Alignment").locator('[data-cell="2-2"]').hover();
    await page.getByRole("tooltip", { name: "Align bottom right" }).waitFor();
    await page.mouse.move(5, 5);
    await page.locator("#layout-section [data-distribute=space-between]").click();
    assert.equal((await node("fx")).justifyContent, "space-between");
    assert.equal(
      await matrix("Alignment").locator("[aria-pressed=true]").count(),
      3,
      "distributed: the whole cross row is active",
    );
    await page.locator("#layout-section [data-distribute=space-between]").click();
    assert.equal(
      (await node("fx")).justifyContent,
      "flex-start",
      "pressing the active distribution returns to packed",
    );
    await page.getByRole("button", { name: "Reverse order" }).click();
    assert.equal((await node("fx")).reverse, true);
    assert.equal(await styleOf("fx", "flexDirection"), "row-reverse");
    // Wonder B1: the cross gap is typeable without wrap (it only shows once the stack wraps), and committing the
    // main gap never moves it.
    assert.equal(
      await page.locator("#layout-section [name=gapY]").isDisabled(),
      false,
      "cross gap is editable without wrap",
    );
    await typeIn("gap", "37");
    assert.deepEqual(
      [(await node("fx")).gap, (await node("fx")).gapY, (await node("fx")).flexWrap],
      [37, 4, undefined],
      "the main gap pins the cross gap to its old value",
    );
    assert.equal(await page.locator("#layout-section [name=gapY]").inputValue(), "4");
    await typeIn("gapY", "12");
    assert.deepEqual(
      [(await node("fx")).gapY, (await node("fx")).flexWrap],
      [12, undefined],
      "typing the cross gap does not turn wrap on",
    );
    await page.getByRole("button", { name: "Wrap" }).click();
    assert.equal((await node("fx")).flexWrap, true);
    assert.equal(
      await page.getByRole("button", { name: "Wrap" }).getAttribute("data-active"),
      "true",
    );
    // Computed colour-mix() values come back as rgb() or color(srgb …): compare the 0–255 channels.
    const rgbOf = (css) => {
      const m = css.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/);
      return m
        ? m.slice(1, 4).map((v) => Math.round(Number(v) * 255))
        : css
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number);
    };
    const wrapStyle = await page
      .getByRole("button", { name: "Wrap" })
      .evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]);
    assert.deepEqual(
      rgbOf(wrapStyle[0]),
      [54, 36, 64],
      "active flex toggles take the purple tint #362440",
    );
    assert.ok(
      rgbOf(wrapStyle[1]).every((v, i) => Math.abs(v - [206, 134, 248][i]) <= 6),
      `active glyph is #ce86f8 (${wrapStyle[1]})`,
    );
    await typeIn("gap", "20");
    assert.deepEqual([(await node("fx")).gap, (await node("fx")).gapY], [20, 12]);
    // Baseline (rows only) sits first in the trailing column.
    await page.getByRole("button", { name: "Align to baseline" }).click();
    assert.equal((await node("fx")).alignItems, "baseline");
    assert.equal(await styleOf("fx", "alignItems"), "baseline");
    await page.getByRole("button", { name: "Align to baseline" }).click();
    assert.equal((await node("fx")).alignItems, "flex-start");
    assert.equal(await styleOf("fx", "columnGap"), "20px");
    assert.equal(await styleOf("fx", "rowGap"), "12px");
    await page.locator("#layout-section .insp-direction [data-direction=column]").click();
    assert.equal((await node("fx")).direction, "column");
    assert.equal(await styleOf("fx", "flexDirection"), "column-reverse");
    assert.equal(
      await page.getByRole("button", { name: "Align to baseline" }).count(),
      0,
      "no baseline toggle for columns",
    );
    // Padding: axes, collapse back to a single value, then independent sides.
    await typeIn("paddingX", "10");
    let fx = await node("fx");
    assert.deepEqual(
      [fx.paddingTop, fx.paddingRight, fx.paddingBottom, fx.paddingLeft],
      [8, 10, 8, 10],
    );
    await typeIn("paddingY", "10");
    fx = await node("fx");
    assert.equal(fx.padding, 10);
    assert.equal(fx.paddingTop, undefined, "equal sides collapse to padding");
    await page.getByRole("button", { name: "Independent padding" }).click();
    await typeIn("paddingTop", "5");
    assert.equal(await styleOf("fx", "padding"), "5px 10px 10px");
    // Min/max limits from the W menu: an empty row (Wonder B2-max-width-added), written once a value is typed.
    await openMenu("#layout-section [data-size-menu=w]");
    await page.locator("[role=menuitem][data-limit=maxW]").click();
    assert.equal(await page.locator("#layout-section [name=maxW]").inputValue(), "");
    assert.equal((await node("fx")).maxW, undefined);
    await typeIn("maxW", "250");
    assert.equal((await node("fx")).maxW, 250);
    assert.equal(await styleOf("fx", "maxWidth"), "250px");
    await openMenu("#layout-section [data-limit-menu=maxW]");
    await page.locator("[role=menuitem][data-limit-remove=maxW]").click();
    assert.equal((await node("fx")).maxW, undefined);
    // Grid: Grid settings (Wonder G5): one "Fill · 1 fr" row per track, rows automatic until one is added.
    await page.evaluate(() => window.design.setSelection(["gd"]));
    assert.equal((await page.locator("#grid-tracks").textContent()).trim(), "2 × Auto");
    assert.equal(
      await page.locator("#grid-tracks [data-grid-cell]").count(),
      2,
      "one outline per column while rows are auto",
    );
    await page.locator("#grid-tracks").click();
    const pop = page.locator("#grid-settings");
    await pop.waitFor();
    assert.match(await pop.textContent(), /Grid settings/);
    assert.match(
      await pop.locator("[data-grid-axis=rows]").textContent(),
      /Rows are added to fit content/,
    );
    assert.equal(await pop.locator("[data-grid-axis=columns] [data-grid-track]").count(), 2);
    assert.deepEqual(
      await pop
        .locator('[data-grid-axis=columns] [data-grid-track="0"] select')
        .evaluateAll((s) => s.map((x) => x.value)),
      ["fill", "fr"],
      "each track reads Fill · fr",
    );
    assert.equal(await pop.locator("[name=columnSize-0]").inputValue(), "1");
    await pop.locator("[data-grid-add=columns]").click();
    await pop.locator("[data-grid-add=rows]").click();
    await pop.locator("[data-grid-add=rows]").click();
    assert.deepEqual([(await node("gd")).columns, (await node("gd")).rows], [3, 2]);
    assert.equal(
      await pop.locator("[data-grid-axis=rows] [data-grid-track]").count(),
      2,
      "explicit rows list their tracks",
    );
    assert.equal(
      (await styleOf("gd", "gridTemplateRows")).split(" ").length,
      2,
      "equal rows render",
    );
    assert.equal(
      await page.locator("#grid-tracks [data-grid-cell]").count(),
      6,
      "the preview outlines every track (3 × 2)",
    );
    assert.equal((await page.locator("#grid-tracks").textContent()).trim(), "3 × 2");
    // Per-track fr weights (G5 "1 fr"): a 2 fr middle column is twice as wide on the canvas.
    await pop.locator("[name=columnSize-1]").fill("2");
    await pop.locator("[name=columnSize-1]").press("Enter");
    assert.deepEqual((await node("gd")).columnSizes, [1, 2, 1]);
    const cols = (await styleOf("gd", "gridTemplateColumns")).split(" ").map(parseFloat);
    assert.ok(
      Math.abs(cols[1] - 2 * cols[0]) < 1 && Math.abs(cols[0] - cols[2]) < 1,
      `2 fr renders twice as wide: ${cols.join(",")}`,
    );
    await pop.locator("[name=columnSize-1]").fill("1");
    await pop.locator("[name=columnSize-1]").press("Enter");
    assert.equal((await node("gd")).columnSizes, undefined, "all-1fr tracks store nothing");
    // Removing the last explicit row returns to automatic rows.
    for (let i = 0; i < 2; i++) {
      const row = pop.locator("[data-grid-axis=rows] [data-grid-track]").last();
      await row.hover();
      await row.locator("[data-grid-remove=rows]").click();
    }
    assert.equal((await node("gd")).rows, undefined);
    assert.match(
      await pop.locator("[data-grid-axis=rows]").textContent(),
      /Rows are added to fit content/,
    );
    await pop.locator("[data-grid-add=rows]").click();
    await pop.locator("[data-grid-add=rows]").click();
    await page.keyboard.press("Escape");
    await pop.waitFor({ state: "detached" });
    // H7: the header's "Automatic positioning" toggle keeps the explicit row count (Wonder H7-wrap-off: 4 × 2 stays 4 × 2).
    const autoPos = page.locator("#layout-section [data-grid-wrap]");
    assert.equal(await autoPos.getAttribute("aria-label"), "Automatic positioning");
    assert.equal(await autoPos.getAttribute("aria-pressed"), "true", "on by default");
    await autoPos.click();
    assert.equal(await autoPos.getAttribute("aria-pressed"), "false");
    assert.deepEqual(
      [(await node("gd")).autoPosition, (await node("gd")).columns, (await node("gd")).rows],
      [false, 3, 2],
      "toggling does not pin or replace the rows",
    );
    assert.equal((await page.locator("#grid-tracks").textContent()).trim(), "3 × 2");
    await autoPos.click();
    assert.equal((await node("gd")).autoPosition, undefined);
    // The grid icon is "Grid settings" and opens the same popover.
    const gridTool = page.locator("#layout-section [data-grid-tracks-tool]");
    assert.equal(await gridTool.getAttribute("aria-label"), "Grid settings");
    await gridTool.click();
    await pop.waitFor();
    await pop.getByRole("button", { name: "Close grid settings" }).click();
    await pop.waitFor({ state: "detached" });
    await matrix("Cell alignment").locator('[data-cell="1-1"]').click();
    assert.deepEqual(
      [(await node("gd")).alignItems, (await node("gd")).justifyItems],
      ["center", "center"],
    );
    assert.equal(await styleOf("gd", "justifyItems"), "center");
    await matrix("Cell alignment").locator('[data-cell="1-1"]').click();
    assert.deepEqual(
      [(await node("gd")).alignItems, (await node("gd")).justifyItems],
      ["stretch", undefined],
      "pressing the active cell restores stretch",
    );
    // Grid child: spans and margin (auto centers it).
    await page.evaluate(() => window.design.setSelection(["gc"]));
    await typeIn("colSpan", "2");
    await typeIn("rowSpan", "2");
    assert.equal(await styleOf("gc", "gridColumnStart"), "span 2");
    assert.equal(await styleOf("gc", "gridRowStart"), "span 2");
    const marginUnit = async (unit) => {
      await openMenu("#layout-section [data-unit-menu=marginX]");
      await page.locator(`[role=menuitem][data-unit=${unit}]`).click();
    };
    await marginUnit("auto");
    assert.deepEqual((await node("gc")).margin, [0, "auto", 0, "auto"]);
    await marginUnit("px");
    assert.equal((await node("gc")).margin, undefined, "zero margins are removed");
    // Block flow: vertical spacing, no flex/grid controls; free frames have no padding.
    await page.evaluate(() => window.design.setSelection(["bk"]));
    assert.equal(await matrix("Alignment").count(), 0);
    await typeIn("gapY", "8");
    assert.equal((await node("bk")).gapY, 8);
    // Block alignment (Wonder C2-display-block): left / centre / right of children narrower than the frame.
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.pages[0].nodes.push({
        id: "bc",
        name: "Child",
        type: "rectangle",
        parentId: "bk",
        x: 0,
        y: 0,
        w: 50,
        h: 20,
        color: "#ff0000",
      });
      window.design.setDocument(d);
      window.design.setSelection(["bk"]);
    });
    await page.locator("#layout-section .insp-block-align [data-align=center]").click();
    assert.equal((await node("bk")).justifyItems, "center");
    assert.equal(
      await page.locator("#canvas [data-id=bc]").evaluate((e) => e.offsetLeft),
      75,
      "the child is centred in the 200px block",
    );
    await page.locator("#layout-section .insp-block-align [data-align=flex-start]").click();
    assert.equal((await node("bk")).justifyItems, undefined);
    await page.locator(".insp-display [data-layout=free]").click();
    assert.equal(
      await page.locator("#layout-section [name=paddingX]").count(),
      0,
      "free position has no padding",
    );
    // Switching Display back and forth never stacks copies of Padding / Margin (they once shared a React key).
    await page.evaluate(() => window.design.setSelection(["gc"]));
    for (const mode of ["flex", "grid", "block", "flex", "free", "grid", "block", "grid"])
      await page.locator(`#layout-section .insp-display [data-layout=${mode}]`).click();
    const captions = (label) =>
      page.locator("#layout-section").getByText(label, { exact: true }).count();
    assert.equal(await captions("Padding"), 1, "one Padding group after switching display");
    assert.equal(await captions("Margin"), 1, "one Margin group after switching display");
    console.log(
      "PASS layout section: flex matrix, distribution, reverse, wrap, gaps, padding axes/sides, limits, Grid settings tracks (fr weights, auto rows) + Automatic positioning + cell alignment, grid child spans, margin auto, block spacing",
    );
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
