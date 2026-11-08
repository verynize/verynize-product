// Paint stack, image fill fit, multicolour SVG Colors and the Export section (design/wonder/2026-10-30 05–07,
// 21–26, 41; docs/wonder-design-workflow-2026-10-30.md P20, P22, P23, P30, P32). Real Electron: UI edits through
// the inspector, native raster/vector/code export through the save dialog, decoded output pixels and dimensions.
const { _electron } = require("@playwright/test");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");

const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
const svg = (markup) => "data:image/svg+xml;base64," + Buffer.from(markup).toString("base64");
const LOGO = svg(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="10" height="10" fill="#ff0000"/><rect x="10" width="10" height="10" fill="#0000ff"/></svg>',
);

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inspector-paints-"));
  const out = path.join(dir, "out");
  await fs.mkdir(out);
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
    await moveOffCursor(app);
    await page.waitForSelector("#canvas .layer");
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const node = (id) =>
      page.evaluate(
        (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id),
        id,
      );
    const fill = page.locator("#fill-section");
    const setup = (nodes) =>
      page.evaluate((nodes) => {
        const d = window.design.getDocument();
        d.tokens = { brand: "#172033" };
        delete d.variables;
        d.pages[0].nodes = nodes;
        window.design.setDocument(d);
        window.design.setSelection([nodes[0].id]);
      }, nodes);
    // Decode an exported image in the renderer (sRGB canvas) and sample pixels at output coordinates.
    const sample = (file, mime, points) =>
      fs.readFile(file).then((bytes) =>
        page.evaluate(
          async ({ b64, mime, points }) => {
            const image = new Image();
            await new Promise((ok, fail) => {
              image.onload = ok;
              image.onerror = fail;
              image.src = `data:${mime};base64,${b64}`;
            });
            const c = document.createElement("canvas");
            c.width = image.naturalWidth;
            c.height = image.naturalHeight;
            const ctx = c.getContext("2d");
            ctx.drawImage(image, 0, 0);
            return {
              width: c.width,
              height: c.height,
              px: points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]),
            };
          },
          { b64: bytes.toString("base64"), mime, points },
        ),
      );
    const near = (actual, expected, label, tol = 3) =>
      assert.ok(
        actual.every((v, i) => Math.abs(v - expected[i]) <= tol),
        `${label}: ${actual} ≈ ${expected}`,
      );
    // Escape only while a paint editor is open (on the canvas it would clear the selection).
    const closeDialog = async () => {
      if (await page.locator("#color-dialog").count()) await page.keyboard.press("Escape");
      await page.waitForSelector("#color-dialog", { state: "detached" });
    };
    let target = "",
      defaultPath = "";
    // The Export section starts closed for every newly selected layer.
    // Like Wonder (ref 50), the "Exported …" toast sits over the bottom of the inspector, where the Export section
    // ends up; wait for the previous export's toast to leave before clicking under it.
    const toastsGone = async () => {
      // Sonner pauses its timers while the pointer is over a toast.
      await page.mouse.move(400, 300);
      await page.waitForSelector("[data-sonner-toast]", { state: "detached", timeout: 15000 });
    };
    const openExport = async () => {
      if (!(await page.locator("#artwork-scale").isVisible())) {
        await toastsGone();
        await page.locator("#export-section .insp-add").click();
      }
    };
    const saveAs = async (file) => {
      target = path.join(out, file);
      await app.evaluate(({ dialog }, t) => {
        dialog.showSaveDialog = async (_w, o) => {
          globalThis.__lastDefault = o.defaultPath;
          return { canceled: false, filePath: t };
        };
      }, target);
    };
    const exportNow = async () => {
      await fs.rm(target, { force: true });
      await page.locator("#artwork-download").click();
      const deadline = Date.now() + 30000;
      for (;;) {
        const status = (await page.locator("#artwork-status").textContent()) || "";
        if (
          /^Exported/.test(status) &&
          (await fs.stat(target).then(
            () => true,
            () => false,
          ))
        )
          break;
        if (status && !/^Exported/.test(status)) throw new Error("Export failed: " + status);
        if (Date.now() > deadline) throw new Error("Export timed out");
        await page.waitForTimeout(100);
      }
      defaultPath = await app.evaluate(() => globalThis.__lastDefault);
      return fs.readFile(target);
    };

    // --- Paint stack through the inspector --------------------------------------------------------------------
    await setup([
      {
        id: "card",
        name: "Card",
        type: "frame",
        x: 20,
        y: 20,
        w: 100,
        h: 80,
        color: "#ff0000",
        layout: "free",
      },
    ]);
    // count() does not wait: let the inspector render the selection first (slow on software-rendered CI).
    await fill.locator("[data-paint]").first().waitFor();
    assert.equal(
      await fill.locator("[data-paint]").count(),
      1,
      "an older single-fill layer shows one solid paint",
    );
    await fill.getByRole("button", { name: "Add paint" }).click();
    let card = await node("card");
    assert.deepEqual(
      card.fills,
      [
        { type: "solid", color: "#00000033" },
        { type: "solid", color: "#ff0000" },
      ],
      "new paint goes on top: Wonder adds black at 20 % after the first paint",
    );
    await page.locator("[name=color]").click();
    // Wonder: three paint-type icons (solid, gradient, image) on the picker's tab row.
    await page.locator("#color-dialog").getByRole("radio", { name: "Gradient" }).click();
    card = await node("card");
    assert.equal(card.fills[0].type, "linear");
    assert.equal(card.fills[0].stops.length, 2);
    assert.equal(card.fills[0].stops[0].color, "#00000033", "conversion keeps the colour");
    await closeDialog();
    await fill.getByRole("button", { name: "Edit linear paint" }).click();
    await page.locator("#color-dialog").getByRole("button", { name: "Add stop" }).click();
    assert.equal((await node("card")).fills[0].stops.length, 3, "Add stop");
    const pos = page.getByRole("textbox", { name: "Stop 3 position" });
    await pos.fill("25");
    await pos.press("Enter");
    assert.equal((await node("card")).fills[0].stops[2].position, 25);
    await page.locator("#color-dialog").getByRole("button", { name: "Remove stop 3" }).click();
    assert.equal((await node("card")).fills[0].stops.length, 2, "Remove stop");
    // Bind stop 1 to a colour variable, then detach: the resolved colour stays.
    await page.locator("#color-dialog").getByRole("button", { name: "Select stop 1" }).click();
    await page.locator("#color-dialog").getByRole("tab", { name: "Variables" }).click();
    await page.locator("#color-dialog").getByRole("option", { name: /brand/ }).click();
    card = await node("card");
    assert.deepEqual(card.fills[0].stops[0], { position: 0, color: "#172033", token: "brand" });
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens.brand = "#00ff00";
      window.design.setDocument(d);
      window.design.setSelection(["card"]);
    });
    assert.match(
      await page.locator("#canvas [data-id=card]").evaluate((e) => e.style.backgroundImage),
      /rgb\(0, 255, 0\) 0%/,
      "bound stop follows the variable at render time",
    );
    // setDocument replaces the document (the editor may close); reopen it to detach.
    await page.waitForTimeout(300);
    if (!(await page.locator("#color-dialog").count()))
      await fill.getByRole("button", { name: "Edit linear paint" }).click();
    await page
      .locator("#color-dialog")
      .getByRole("button", { name: "Detach stop 1 variable" })
      .click();
    card = await node("card");
    assert.deepEqual(
      card.fills[0].stops[0],
      { position: 0, color: "#00ff00" },
      "detach keeps the resolved colour",
    );
    await page.locator("#color-dialog").getByRole("button", { name: "Move paint down" }).click();
    assert.equal((await node("card")).fills[1].type, "linear", "reorder");
    await closeDialog();
    await fill.locator('[data-paint-visibility="1"]').click();
    assert.equal((await node("card")).fills[1].hidden, true, "hide paint");
    assert.equal(
      await page.locator("#canvas [data-id=card]").evaluate((e) => e.style.backgroundImage),
      "linear-gradient(rgb(255, 0, 0), rgb(255, 0, 0))",
      "hidden paint is not drawn",
    );
    await fill.locator('[data-paint-remove="1"]').click();
    card = await node("card");
    assert.equal(card.fills, undefined, "one plain solid paint collapses back into color");
    assert.equal(card.color, "#ff0000");
    // Removing the last paint leaves no fill (no stale colour); a new paint starts from the default.
    await fill.locator('[data-paint-remove="0"]').click();
    card = await node("card");
    assert.deepEqual([card.fills, card.color, card.token], [undefined, "transparent", ""]);
    assert.equal(
      await page
        .locator("#canvas [data-id=card]")
        .evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgba(0, 0, 0, 0)",
      "no paint draws nothing",
    );
    assert.equal(await fill.locator("[data-paint]").count(), 0);
    await fill.getByRole("button", { name: "Add paint" }).click();
    card = await node("card");
    assert.deepEqual(
      [card.fills, card.color],
      [undefined, "#ffffff"],
      "re-added first paint is Wonder's white",
    );
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    assert.equal((await node("card")).color, "#ff0000", "undo restores the removed paint");
    console.log(
      "PASS paint stack: add, type conversion, stops add/position/remove, stop variable bind/follow/detach, reorder, hide, remove, collapse to single fill",
    );

    // --- Wonder parity: Background Fill slicing and P0 paint fixes (properties-audit README A1, B3, WP-1, WP-2) ---
    // Geometry in inspector CSS px: x 0 is the panel's inner left edge (its 1 px border excluded).
    const box = (loc) =>
      loc.evaluate((e) => {
        const panel = document.querySelector("#properties");
        const left = panel.getBoundingClientRect().left + panel.clientLeft;
        const r = e.getBoundingClientRect();
        return {
          x: r.left - left,
          right: r.right - left,
          cx: (r.left + r.right) / 2 - left,
          y: r.top,
          h: r.height,
        };
      });
    const visibleOpacity = (loc) => loc.evaluate((e) => getComputedStyle(e).opacity);
    await setup([
      {
        id: "card",
        name: "Card",
        type: "frame",
        x: 20,
        y: 20,
        w: 100,
        h: 80,
        color: "transparent",
        layout: "free",
      },
    ]);
    assert.equal(await fill.locator("[data-paint]").count(), 0);
    assert.equal((await box(fill)).h, 32, "an empty fill is the 32 px header only");
    assert.doesNotMatch(await fill.innerText(), /No paints/, "no placeholder text");
    assert.equal(await fill.locator("[name=animated]").count(), 0, "Animated is not in the body");
    // Header tools 8 px apart: the wavy square (Shader mode, H6) at 224, + at 256.
    assert.equal((await box(fill.locator("[data-shader-mode]"))).cx, 224);
    assert.equal((await box(fill.getByRole("button", { name: "Add paint" }))).cx, 256);
    // Defaults: white first, then black at 20 %.
    await fill.getByRole("button", { name: "Add paint" }).click();
    assert.equal((await node("card")).color, "#ffffff");
    await fill.getByRole("button", { name: "Add paint" }).click();
    assert.deepEqual((await node("card")).fills, [
      { type: "solid", color: "#00000033" },
      { type: "solid", color: "#ffffff" },
    ]);
    assert.equal(
      await fill.getByRole("textbox", { name: "Fill hex colour" }).inputValue(),
      "000000",
    );
    assert.equal(await fill.getByRole("textbox", { name: "Fill opacity" }).inputValue(), "20");
    const row0 = fill.locator("[data-paint='0']"),
      row1 = fill.locator("[data-paint='1']");
    const field0 = await box(row0.locator("[data-color-anchor]"));
    assert.deepEqual([field0.x, field0.right, field0.h], [12, 204, 24], "field x 12–204, 24 tall");
    assert.equal((await box(row0.locator("[data-paint-visibility]"))).cx, 224, "eye centre 224");
    assert.equal((await box(row0.locator("[data-paint-remove]"))).cx, 256, "− centre 256");
    assert.equal((await box(row1)).y - (await box(row0)).y, 33, "33 px row pitch");
    assert.equal(
      (await box(fill)).h,
      32 + 5 + 24 + 9 + 24 + 12,
      "two rows: 5 px under the header, 12 above the divider",
    );
    // Hover drag grip in the left gutter; dragging the lower paint onto the upper one reorders the stack.
    const grip = row1.locator("[data-paint-grip]");
    await page.mouse.move(5, 5);
    assert.equal(await visibleOpacity(grip), "0", "grip hidden until hover");
    await row1.hover();
    assert.equal(await visibleOpacity(grip), "1", "grip shows on hover");
    const g = await grip.boundingBox();
    assert.ok(g.x + g.width / 2 - (await box(fill)).x >= 3 - 1, "grip sits in the left gutter");
    const top = await row0.boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, top.y + 4, { steps: 4 });
    await page.mouse.up();
    assert.deepEqual(
      (await node("card")).fills.map((p) => p.color),
      ["#ffffff", "#00000033"],
      "drag grip reorders",
    );
    // Hidden paint: Wonder's closed-eye glyph.
    await fill.locator('[data-paint-visibility="1"]').click();
    assert.equal(
      await fill.locator('[data-paint-visibility="1"] svg.lucide-eye-closed').count(),
      1,
    );
    // --- H6: the wavy square is the "Shader mode" toggle (wonder/H6-tooltip-confirmed, H6-open-confirmed) ---
    const shaderMode = fill.locator("[data-shader-mode]");
    const paintsBefore = (await node("card")).fills;
    await page.mouse.move(5, 5);
    await shaderMode.hover();
    await page.getByRole("tooltip", { name: "Shader mode" }).waitFor();
    assert.equal(await shaderMode.getAttribute("aria-label"), "Shader mode");
    assert.equal(await shaderMode.getAttribute("aria-pressed"), "false");
    await shaderMode.click();
    let modeCard = await node("card");
    assert.equal(modeCard.shaderFill, true, "shader mode on");
    assert.equal(modeCard.type, "frame", "the layer keeps its type; only its fill changes");
    assert.equal(modeCard.shaderPreset, "tidal-swirl-1", "starts on the first parametric preset");
    assert.deepEqual(modeCard.fills, paintsBefore, "paints are kept");
    assert.equal(await shaderMode.getAttribute("aria-pressed"), "true");
    assert.equal(await shaderMode.getAttribute("data-active"), "true");
    // Pressed look: the purple toggle tint behind a light purple glyph (Wonder #372441 / #ce86f8).
    assert.notEqual(
      await shaderMode.evaluate((e) => getComputedStyle(e).backgroundColor),
      await fill
        .getByRole("button", { name: "Add paint" })
        .evaluate((e) => getComputedStyle(e).backgroundColor),
    );
    // Preset dropdown + settings button + the preset's colours replace the paint rows.
    assert.equal(await fill.locator("[data-paint]").count(), 0, "paint rows replaced");
    assert.equal(await fill.locator("#shader-fill-preset").innerText(), "Tidal Swirl 1");
    assert.equal(await fill.locator("[data-shader-color-row]").count(), 4);
    const presetBox = await box(fill.locator("#shader-fill-preset"));
    assert.deepEqual(
      [presetBox.x, presetBox.right, presetBox.h],
      [12, 232, 24],
      "dropdown x 12–232",
    );
    assert.equal(
      (await box(fill.locator("#shader-options-open"))).cx,
      256,
      "settings button under +",
    );
    assert.equal((await box(fill.getByRole("button", { name: "Add paint" }))).cx, 256, "+ stays");
    // The canvas paints the fill with a shader surface under the layer's content.
    const surface = page.locator('#canvas [data-id="card"] > canvas.shader-surface');
    await surface.waitFor({ state: "attached" });
    assert.equal(
      await page.locator('#canvas [data-id="card"]').getAttribute("data-shader-fill"),
      "true",
    );
    assert.equal(
      await page.locator('#canvas [data-id="card"]').getAttribute("data-shader-preset"),
      "tidal-swirl-1",
    );
    assert.equal(await surface.evaluate((e) => getComputedStyle(e).zIndex), "-1");
    // Choosing a preset changes the fill, not the layer type.
    await fill.locator("#shader-fill-preset").click();
    await page.locator('#shader-gallery [data-shader-option="ripple-pool-2"]').click();
    modeCard = await node("card");
    assert.deepEqual(
      [modeCard.type, modeCard.shaderPreset, modeCard.shaderFill],
      ["frame", "ripple-pool-2", true],
    );
    assert.equal(await fill.locator("#shader-fill-preset").innerText(), "Ripple Pool 2");
    await fill.locator("#shader-options-open").click();
    await page.locator("#shader-options").waitFor();
    await page
      .locator("#shader-options")
      .getByRole("button", { name: "Close shader settings" })
      .click();
    // Persisted: the mode, preset and pressed state survive a reload.
    await page.reload();
    await page.waitForSelector("#canvas .layer");
    await page.evaluate(() => window.design.setSelection(["card"]));
    modeCard = await node("card");
    assert.deepEqual(
      [modeCard.shaderFill, modeCard.shaderPreset],
      [true, "ripple-pool-2"],
      "saved with the document",
    );
    assert.equal(
      await shaderMode.getAttribute("aria-pressed"),
      "true",
      "still pressed after reload",
    );
    await page
      .locator('#canvas [data-id="card"] > canvas.shader-surface')
      .waitFor({ state: "attached" });
    // Off: the paint rows come back unchanged, the surface goes, the chosen preset is kept for next time.
    await shaderMode.click();
    modeCard = await node("card");
    assert.equal(modeCard.shaderFill, undefined, "shader mode off");
    assert.deepEqual(modeCard.fills, paintsBefore);
    assert.equal(modeCard.shaderPreset, "ripple-pool-2");
    assert.equal(await shaderMode.getAttribute("aria-pressed"), "false");
    assert.equal(await fill.locator("[data-paint]").count(), 2, "paint rows back");
    assert.equal(await page.locator('#canvas [data-id="card"] > canvas.shader-surface').count(), 0);
    assert.equal(
      await page.locator('#canvas [data-id="card"]').getAttribute("data-shader-fill"),
      null,
    );
    // + in Shader mode adds a paint and goes back to the paint rows (one step).
    await shaderMode.click();
    await fill.getByRole("button", { name: "Add paint" }).click();
    modeCard = await node("card");
    assert.equal(modeCard.shaderFill, undefined);
    assert.equal(modeCard.fills.length, 3);
    // Older documents: an `animated` gradient still renders and stays editable; Shader mode replaces it.
    await page.evaluate(() => window.design.updateNodes(["card"], { animated: "aurora" }));
    assert.ok(
      (await page.locator('#canvas [data-id="card"]').evaluate((e) => e.style.animation)).includes(
        "design-gradient",
      ),
    );
    assert.equal(await fill.locator("[name=animated]").inputValue(), "aurora");
    await shaderMode.click();
    assert.equal((await node("card")).animated, "", "Shader mode replaces the animated gradient");
    assert.equal(await fill.locator("[name=animated]").count(), 0);
    // Text: Text Fill has no shader mode (disabled); the Background Fill behind the glyphs does.
    await setup([
      {
        id: "label",
        name: "Label",
        type: "text",
        text: "Hi",
        x: 20,
        y: 20,
        w: 100,
        h: 40,
        color: "#ffffff",
      },
    ]);
    assert.equal(
      await fill.locator("[data-shader-mode]").isDisabled(),
      true,
      "Text Fill: no shader mode",
    );
    const textBackground = page.locator("#text-background-fill-section");
    await textBackground.locator("[data-shader-mode]").click();
    assert.equal((await node("label")).shaderFill, true);
    assert.equal(await textBackground.locator("[data-shader-color-row]").count(), 4);
    await page
      .locator('#canvas [data-id="label"] > canvas.shader-surface')
      .waitFor({ state: "attached" });
    assert.equal(
      await page.locator('#canvas [data-id="label"]').innerText(),
      "Hi",
      "glyphs stay above the shader",
    );
    console.log(
      "PASS shader mode: tooltip, pressed toggle, preset + colours replace paints, canvas surface, reload, off, legacy animated",
    );

    // P0 bug 1: a solid with a separate paint opacity shows the product, and edits fold it into the colour alpha.
    await setup([
      {
        id: "card",
        name: "Card",
        type: "frame",
        x: 20,
        y: 20,
        w: 100,
        h: 80,
        color: "#ff0000",
        layout: "free",
        fills: [
          { type: "solid", color: "#ff0000", opacity: 50 },
          {
            type: "linear",
            angle: 90,
            stops: [
              { position: 0, color: "#0000ff" },
              { position: 100, color: "#00ff00" },
            ],
          },
        ],
      },
    ]);
    const opacity0 = fill.getByRole("textbox", { name: "Fill opacity" });
    assert.equal(await opacity0.inputValue(), "50", "opacity 50 does not read 100 %");
    await opacity0.fill("40");
    await opacity0.press("Enter");
    assert.deepEqual(
      (await node("card")).fills[0],
      { type: "solid", color: "#ff000066" },
      "40 % is the paint's alpha, not 40 % of 50 %",
    );
    assert.equal(
      await fill.locator("[data-paint='1'] input").count(),
      0,
      "gradient row: no % field",
    );
    // Swatch of a translucent colour: Wonder's split swatch (opaque left, checker right).
    assert.match(
      await row0.locator("button[name=color] span").getAttribute("style"),
      /linear-gradient\(to right, #ff0000 50%, #ff000066 50%\), repeating-conic-gradient/,
    );

    // B3 / P0 bugs 2 and 5: bound paint. No % at any alpha, hover-only unlink, picker plane renders, alpha edits the variable.
    await setup([
      {
        id: "card",
        name: "Card",
        type: "frame",
        x: 20,
        y: 20,
        w: 100,
        h: 80,
        color: "#172033",
        token: "brand",
        layout: "free",
      },
    ]);
    assert.equal(await row0.getByRole("textbox").count(), 0, "bound fill shows no hex or %");
    const unlink = row0.getByRole("button", { name: "Detach variable" });
    await page.mouse.move(5, 5);
    assert.equal(await visibleOpacity(unlink), "0", "unlink hidden until hover");
    await row0.hover();
    assert.equal(await visibleOpacity(unlink), "1", "unlink shows on hover");
    const u = await box(unlink);
    assert.ok(u.cx > 180 && u.right <= 204, `unlink inside the field (${u.cx})`);
    await page.locator("[name=color]").click();
    await page.locator("#color-dialog").getByRole("tab", { name: "Custom" }).click();
    const plane = await page
      .locator("#color-dialog #color-field")
      .evaluate((e) => getComputedStyle(e).backgroundImage);
    assert.match(plane, /linear-gradient/, "picker plane renders for a bound paint");
    assert.match(
      await page.locator("#color-dialog [data-bound-edit]").innerText(),
      /Editing variable brand/,
    );
    const alpha = page.getByRole("textbox", { name: "Opacity percent" });
    await alpha.fill("50");
    await alpha.press("Enter");
    card = await node("card");
    assert.deepEqual(
      [card.token, card.fills],
      ["brand", undefined],
      "alpha edit keeps the binding",
    );
    assert.equal(
      await page.evaluate(() => window.design.getDocument().tokens.brand),
      "#17203380",
      "translucency lives in the variable",
    );
    assert.equal(
      await page
        .locator("#canvas [data-id=card]")
        .evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgba(23, 32, 51, 0.5)",
    );
    assert.equal(await row0.locator("[data-paint-token=brand]").count(), 1, "chip stays");
    assert.equal(await row0.getByRole("textbox").count(), 0, "still no % at alpha 50");
    // Explicit detach from the picker keeps the resolved colour.
    await page.locator("#color-dialog").getByRole("button", { name: "Detach variable" }).click();
    card = await node("card");
    assert.deepEqual([card.token, card.color], ["", "#17203380"]);
    await closeDialog();
    assert.equal(await fill.getByRole("textbox", { name: "Fill opacity" }).inputValue(), "50");
    console.log(
      "PASS Wonder fill parity: empty header only, Shader mode header toggle, defaults, 12–204 field, 224/256 tools, 33 px pitch, drag grip, opacity 50, no gradient %, bound fill unlink/plane/variable alpha",
    );

    // --- Rendered pixels: stack with per-paint opacity, hidden paint (native PNG export, 2×) ------------------
    await setup([
      {
        id: "card",
        name: "Card",
        type: "frame",
        x: 20,
        y: 20,
        w: 100,
        h: 80,
        color: "#ff0000",
        layout: "free",
        fills: [
          { type: "solid", color: "#ff0000", opacity: 50 },
          {
            type: "linear",
            angle: 90,
            stops: [
              { position: 0, color: "#0000ff" },
              { position: 50, color: "#0000ff" },
              { position: 50, color: "#00ff00" },
              { position: 100, color: "#00ff00" },
            ],
          },
        ],
      },
    ]);
    await openExport();
    await saveAs("stack.png");
    await page.locator("#artwork-scale").selectOption("2");
    await page.locator("#artwork-format").selectOption("PNG");
    await exportNow();
    let shot = await sample(target, "image/png", [
      [40, 80],
      [160, 80],
    ]);
    assert.deepEqual({ width: shot.width, height: shot.height }, { width: 200, height: 160 });
    assert.equal(path.basename(defaultPath), "Card@2x.png", "default name gets the scale suffix");
    // Translucent blending happens in the display colour space (macOS offscreen capture), so the expected
    // colours come from the equivalent plain layering rendered by the same native pipeline.
    const ref = await page.evaluate(async () => {
      const res = await window.desktop.renderDesign({
        html: '<body style="margin:0"><div style="position:relative;width:100px;height:80px"><div style="position:absolute;inset:0 50px 0 0;background:#0000ff"></div><div style="position:absolute;inset:0 0 0 50px;background:#00ff00"></div><div style="position:absolute;inset:0;background:rgba(255,0,0,0.5)"></div></div>',
        width: 100,
        height: 80,
        scale: 2,
      });
      const i = new Image();
      await new Promise((o) => {
        i.onload = o;
        i.src = res.dataURL;
      });
      const c = document.createElement("canvas");
      c.width = i.width;
      c.height = i.height;
      const x = c.getContext("2d");
      x.drawImage(i, 0, 0);
      return [
        [40, 80],
        [160, 80],
      ].map(([a, b]) => [...x.getImageData(a, b, 1, 1).data]);
    });
    near(shot.px[0], ref[0], "left: 50% red over blue");
    near(shot.px[1], ref[1], "right: 50% red over green");
    assert.ok(
      shot.px[0][0] > 100 && shot.px[0][2] > 100 && shot.px[1][0] > 100 && shot.px[1][1] > 100,
      "both paints contribute",
    );
    await fill.locator('[data-paint-visibility="0"]').click();
    await exportNow();
    shot = await sample(target, "image/png", [
      [40, 80],
      [160, 80],
    ]);
    near(shot.px[0], [0, 0, 255, 255], "hidden top paint: blue");
    near(shot.px[1], [0, 255, 0, 255], "hidden top paint: green");
    console.log("PASS stack pixels: per-paint opacity and hidden paint in the exported PNG");

    // --- Image fill fit modes (Fill / Cover / Contain / None) and image paint opacity ---------------------------
    const green = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 10;
      c.height = 10;
      const x = c.getContext("2d");
      x.fillStyle = "#00ff00";
      x.fillRect(0, 0, 10, 10);
      return c.toDataURL("image/png");
    });
    await setup([
      {
        id: "pic",
        name: "Pic",
        type: "frame",
        x: 20,
        y: 200,
        w: 100,
        h: 50,
        color: "transparent",
        layout: "free",
        fills: [{ type: "image", src: green, fit: "fill", imageWidth: 10, imageHeight: 10 }],
      },
    ]);
    await saveAs("pic.png");
    await openExport();
    await page.locator("#artwork-scale").selectOption("1");
    const expect = { fill: [1, 1, 1], cover: [1, 1, 1], contain: [0, 1, 1], none: [0, 0, 1] };
    for (const fit of ["fill", "cover", "contain", "none"]) {
      await fill.getByRole("button", { name: "Edit image paint" }).click();
      await page.locator("#color-dialog #paint-image-fit").selectOption(fit);
      assert.equal((await node("pic")).fills[0].fit, fit);
      await closeDialog();
      await exportNow();
      const r = await sample(target, "image/png", [
        [10, 25],
        [30, 25],
        [50, 25],
      ]);
      assert.deepEqual(
        r.px.map((p) => (p[3] > 200 && p[1] > 200 ? 1 : 0)),
        expect[fit],
        `${fit}: painted columns ${JSON.stringify(r.px)}`,
      );
      assert.equal(r.px[0][3] === 0 || expect[fit][0] === 1, true);
    }
    const opacityField = fill.getByRole("textbox", { name: "Fill opacity" });
    await opacityField.fill("50");
    await opacityField.press("Enter");
    assert.equal((await node("pic")).fills[0].opacity, 50);
    await exportNow();
    const faded = await sample(target, "image/png", [[50, 25]]);
    assert.ok(
      Math.abs(faded.px[0][3] - 128) <= 4 && faded.px[0][1] > 240,
      `image paint at 50%: ${faded.px[0]}`,
    );
    console.log(
      "PASS image fill fit Fill/Cover/Contain/None and image paint opacity in exported pixels",
    );

    // --- Text Fill: gradient paint clips to the glyphs ------------------------------------------------------------
    await setup([
      {
        id: "title",
        name: "Title",
        type: "text",
        x: 20,
        y: 300,
        w: 200,
        h: 60,
        text: "Gradient",
        fontSize: 40,
        color: "#111111",
        fills: [
          {
            type: "linear",
            angle: 90,
            stops: [
              { position: 0, color: "#ff0000" },
              { position: 100, color: "#0000ff" },
            ],
          },
        ],
      },
    ]);
    assert.equal(await fill.locator("h3").textContent(), "Text Fill");
    const textStyle = await page.locator("#canvas [data-id=title]").evaluate((e) => ({
      clip: getComputedStyle(e).backgroundClip,
      color: getComputedStyle(e).color,
      image: e.style.backgroundImage,
    }));
    assert.deepEqual(textStyle, {
      clip: "text",
      color: "rgba(0, 0, 0, 0)",
      image: "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
    });
    console.log("PASS Text Fill gradient clipped to text");

    // --- Text Background Fill (properties-audit A10): a second stack behind the glyphs, stored in backgroundFills --
    const bg = page.locator("#text-background-fill-section");
    assert.equal(await bg.locator("h3").textContent(), "Background Fill");
    assert.equal(
      await page.evaluate(() => {
        const a = document.querySelector("#fill-section"),
          b = document.querySelector("#text-background-fill-section");
        return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? "after" : "before";
      }),
      "after",
      "Background Fill sits after Text Fill",
    );
    assert.equal(await bg.locator("[data-paint]").count(), 0);
    assert.equal(
      await bg.evaluate((e) => e.getBoundingClientRect().height),
      32,
      "an empty Background Fill is the 32 px header only",
    );
    await bg.getByRole("button", { name: "Add background paint" }).click();
    let title = await node("title");
    assert.deepEqual(
      title.backgroundFills,
      [{ type: "solid", color: "#ffffff" }],
      "Add defaults to white",
    );
    assert.equal(title.color, "#111111", "the text colour is untouched");
    assert.equal(title.fills.length, 1, "the Text Fill stack is untouched");
    assert.equal(
      await bg.locator("[data-paint-stack]").getAttribute("data-paint-target"),
      "backgroundFills",
    );
    assert.equal(
      await fill.locator("[data-paint-stack]").getAttribute("data-paint-target"),
      "fills",
    );
    assert.equal(
      await page.locator("[name=color]").count(),
      1,
      "only the Text Fill row owns [name=color]",
    );
    const bgHex = bg.getByRole("textbox", { name: "Background fill hex colour" });
    await bgHex.fill("ff0000");
    await bgHex.press("Enter");
    title = await node("title");
    assert.deepEqual(
      title.backgroundFills,
      [{ type: "solid", color: "#ff0000" }],
      "a single solid stays in backgroundFills (never collapsed into color/token)",
    );
    assert.equal(title.color, "#111111");
    assert.equal(title.token ?? "", "");
    assert.match(
      await page.locator("#canvas [data-id=title]").evaluate((e) => e.style.backgroundImage),
      /rgb\(255, 0, 0\)/,
      "the background paint renders behind the glyphs",
    );
    await bg.getByRole("button", { name: "Add background paint" }).click();
    assert.deepEqual((await node("title")).backgroundFills, [
      { type: "solid", color: "#00000033" },
      { type: "solid", color: "#ff0000" },
    ]);
    await bg.locator("[data-paint-remove='0']").click();
    await bg.locator("[data-paint-remove='0']").click();
    title = await node("title");
    assert.equal(
      title.backgroundFills,
      undefined,
      "an empty stack writes backgroundFills: undefined",
    );
    assert.equal(
      await page.evaluate(
        () =>
          "backgroundFills" in
          JSON.parse(JSON.stringify(window.design.getDocument())).pages[0].nodes[0],
      ),
      false,
      "and leaves nothing in the saved document",
    );
    assert.equal(title.color, "#111111");
    assert.equal(await bg.locator("[data-paint]").count(), 0);
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    assert.deepEqual(
      (await node("title")).backgroundFills,
      [{ type: "solid", color: "#ff0000" }],
      "undo restores it",
    );
    await setup([
      {
        id: "box",
        name: "Box",
        type: "frame",
        x: 20,
        y: 20,
        w: 100,
        h: 80,
        color: "#ffffff",
        layout: "free",
      },
    ]);
    assert.equal(await bg.count(), 0, "only text layers have a Background Fill under the fill");
    console.log(
      "PASS text Background Fill: own stack in backgroundFills, white default, no collapse, empty removes",
    );

    // --- Multicolour SVG Colors, SVG-only export format, recoloured raster and vector output --------------------
    await setup([
      {
        id: "logo",
        name: "Logo",
        type: "image",
        x: 20,
        y: 400,
        w: 40,
        h: 20,
        color: "transparent",
        src: LOGO,
      },
    ]);
    // The SVG Colors rows now live in Selection colors (properties-audit A9, WP-6).
    const colors = page.locator("#selection-colors-section");
    assert.equal(
      await colors.locator("[data-selection-colors]").getAttribute("data-selection-colors"),
      "2",
      "one row per distinct paint",
    );
    const hex = page.getByRole("textbox", { name: "Selection color 1 hex" });
    await hex.fill("00ff00");
    await hex.press("Enter");
    assert.deepEqual((await node("logo")).svgPaints, { "#ff0000": "#00ff00" });
    assert.equal((await node("logo")).src, LOGO, "source unchanged");
    await openExport();
    const formats = await page
      .locator("#artwork-format option")
      .evaluateAll((els) => els.map((e) => e.value));
    assert.deepEqual(
      formats,
      ["SVG", "PNG", "JPG", "WEBP", "PDF", "CODE"],
      "SVG offered for an SVG-only selection",
    );
    await saveAs("logo.png");
    await page.locator("#artwork-scale").selectOption("2");
    await page.locator("#artwork-format").selectOption("PNG");
    await exportNow();
    const logo = await sample(target, "image/png", [
      [20, 20],
      [60, 20],
    ]);
    assert.deepEqual({ width: logo.width, height: logo.height }, { width: 80, height: 40 });
    near(logo.px[0], [0, 255, 0, 255], "replaced paint");
    near(logo.px[1], [0, 0, 255, 255], "untouched paint");
    await saveAs("logo.svg");
    await page.locator("#artwork-format").selectOption("SVG");
    const vector = (await exportNow()).toString();
    assert.match(vector, /^<svg[^>]* width="80" height="40" viewBox="0 0 40 20"/);
    assert.match(vector, /fill="#00ff00"/);
    assert.match(vector, /fill="#0000ff"/);
    assert.doesNotMatch(vector, /foreignObject/);
    const drawn = await sample(target, "image/svg+xml", [
      [20, 20],
      [60, 20],
    ]);
    near(drawn.px[0], [0, 255, 0, 255], "SVG output draws the replacement");
    await page.getByRole("button", { name: "Restore original SVG colors" }).click();
    assert.equal((await node("logo")).svgPaints, undefined);
    console.log(
      "PASS multicolour SVG Colors: per-paint replacement, restore, SVG-only format, recoloured PNG and SVG output",
    );

    // --- Size presets, formats, suffix and code ----------------------------------------------------------------
    await setup([
      {
        id: "card",
        name: "Card",
        type: "frame",
        x: 20,
        y: 20,
        w: 100,
        h: 80,
        color: "#ff0000",
        layout: "free",
        fills: [
          { type: "solid", color: "#ff0000" },
          { type: "solid", color: "#0000ff", hidden: true },
        ],
      },
    ]);
    await openExport();
    assert.deepEqual(
      await page.locator("#artwork-format option").evaluateAll((els) => els.map((e) => e.value)),
      ["PNG", "JPG", "WEBP", "PDF", "CODE"],
      "no SVG for a frame",
    );
    // Wonder G2: size and format are styled menus (✓ on the current item, separators between the size groups),
    // 152px wide with 24px rows; the hidden selects above stay in sync for scripts.
    const exportMenu = async (id) => {
      await page.locator(`[data-export-menu="${id}"]`).click();
      const menu = page.getByRole("menu");
      await menu.waitFor();
      // Measure after the open (zoom-in) animation.
      await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      return {
        menu,
        items: await menu
          .locator("[data-export-option]")
          .evaluateAll((els) =>
            els.map((e) => e.innerText.trim() + (e.querySelector("svg") ? " ✓" : "")),
          ),
        separators: await menu.locator('[role="separator"]').count(),
        width: (await menu.boundingBox()).width,
        rows: await menu
          .locator("[data-export-option]")
          .evaluateAll((els) => [...new Set(els.map((e) => e.getBoundingClientRect().height))]),
      };
    };
    let menu = await exportMenu("artwork-scale");
    assert.deepEqual(menu.items, [
      "0.5x",
      "1x",
      "2x ✓",
      "3x",
      "4x",
      "720p",
      "1080p",
      "1440p",
      "2160p",
      "512w",
      "512h",
    ]);
    assert.deepEqual([menu.separators, menu.width, menu.rows], [2, 152, [24]]);
    await menu.menu.locator('[data-export-option="1080p"]').click();
    await menu.menu.waitFor({ state: "detached" });
    assert.equal(await page.locator("#artwork-scale").inputValue(), "1080p");
    assert.equal(await page.locator('[data-export-menu="artwork-scale"]').innerText(), "1080p");
    menu = await exportMenu("artwork-format");
    assert.deepEqual(menu.items, ["PNG ✓", "JPG", "WebP", "PDF", "Code"]);
    assert.deepEqual([menu.separators, menu.width, menu.rows], [0, 152, [24]]);
    await menu.menu.locator('[data-export-option="JPG"]').click();
    await menu.menu.waitFor({ state: "detached" });
    assert.equal(await page.locator("#artwork-format").inputValue(), "JPG");
    assert.equal(await page.locator("#artwork-download").innerText(), "Export as JPG");
    await page.locator("#artwork-format").selectOption("PNG");
    for (const [preset, size, name] of [
      ["720p", [900, 720], "Card@720p.png"],
      ["512w", [512, 410], "Card@512w.png"],
      ["512h", [640, 512], "Card@512h.png"],
      ["2160p", [2700, 2160], "Card@2160p.png"],
      ["0.5", [50, 40], "Card@0.5x.png"],
    ]) {
      await saveAs(`card-${preset}.png`);
      await page.locator("#artwork-scale").selectOption(preset);
      const bytes = await exportNow();
      assert.deepEqual(pngSize(bytes), { width: size[0], height: size[1] }, preset);
      assert.equal(path.basename(defaultPath), name);
      // Right and bottom edge centres (layers default to a 12 px corner radius, so not the corner itself).
      const corner = await sample(target, "image/png", [
        [size[0] - 2, Math.floor(size[1] / 2)],
        [Math.floor(size[0] / 2), size[1] - 2],
      ]);
      near(corner.px[0], [255, 0, 0, 255], `${preset}: artwork fills the output`);
      near(corner.px[1], [255, 0, 0, 255], `${preset}: artwork fills the output height`);
    }
    // The suffix lives in the Export options popover (the name field is full width, as in Wonder A7).
    // The last export's toast sits over this button.
    await toastsGone();
    await page.getByRole("button", { name: "Export options" }).click();
    const suffix = page.getByRole("textbox", { name: "Export file suffix" });
    await suffix.fill("-hero");
    await suffix.press("Enter");
    await saveAs("hero.png");
    await exportNow();
    assert.equal(path.basename(defaultPath), "Card-hero.png", "custom suffix");
    for (const [format, mime, magic] of [
      ["JPG", "image/jpeg", "ffd8ff"],
      ["WEBP", "image/webp", "52494646"],
    ]) {
      await page.locator("#artwork-scale").selectOption("2");
      await page.locator("#artwork-format").selectOption(format);
      await saveAs(`card.${format.toLowerCase()}`);
      const bytes = await exportNow();
      assert.equal(
        bytes.subarray(0, magic.length / 2).toString("hex"),
        magic,
        `${format} signature`,
      );
      const r = await sample(target, mime, [[100, 80]]);
      assert.deepEqual(
        { width: r.width, height: r.height },
        { width: 200, height: 160 },
        `${format} dimensions`,
      );
      near(r.px[0], [255, 0, 0, 255], `${format} pixels`, 12);
    }
    await page.locator("#artwork-format").selectOption("CODE");
    assert.equal(await page.locator("#artwork-scale").isDisabled(), true, "code has no scale");
    await page.locator("#artwork-code").selectOption("tailwind");
    await saveAs("card.jsx");
    const jsx = (await exportNow()).toString();
    assert.match(jsx, /export default function Card\(\)/);
    assert.match(jsx, /data-fills="\[/);
    assert.match(jsx, /className="[^"]*bg-/);
    assert.doesNotMatch(jsx, /data-node-id/);
    await page.locator("#artwork-code").selectOption("css");
    await saveAs("card.html");
    const html = (await exportNow()).toString();
    assert.match(
      html,
      /<style>[\s\S]*:root \{\n  --brand: #172033;[\s\S]*\.card \{\n[^}]*background: linear-gradient\(rgb\(255, 0, 0\), rgb\(255, 0, 0\)\)/,
    );
    assert.match(html, /<div[^>]* class="card"/);
    assert.doesNotMatch(html, /data-id="card"[^>]* style=/);
    console.log(
      "PASS export presets 720p/512w/512h/2160p/0.5×, suffix, JPG/WebP pixels, Code Tailwind and CSS",
    );

    // --- Persistence and back-compat ------------------------------------------------------------------------------
    await page.evaluate((src) => {
      const d = window.design.getDocument();
      d.pages[0].nodes.push(
        {
          id: "old",
          name: "Old",
          type: "rectangle",
          x: 300,
          y: 20,
          w: 50,
          h: 50,
          color: "#123456",
        },
        {
          id: "logo",
          name: "Logo",
          type: "image",
          x: 20,
          y: 400,
          w: 40,
          h: 20,
          color: "transparent",
          src,
          svgPaints: { "#0000ff": "#ffff00" },
        },
      );
      window.design.setDocument(d);
    }, LOGO);
    await page.reload();
    await page.waitForSelector("#canvas .layer");
    assert.equal((await node("card")).fills.length, 2, "fills persist");
    assert.deepEqual(
      (await node("logo")).svgPaints,
      { "#0000ff": "#ffff00" },
      "SVG paints persist",
    );
    assert.equal((await node("old")).fills, undefined, "single-fill layers keep their shape");
    assert.equal(
      await page
        .locator("#canvas [data-id=old]")
        .evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgb(18, 52, 86)",
    );
    const rejected = await page.evaluate(() => {
      const out = [];
      for (const bad of [
        { type: "solid", color: "red" },
        { type: "image", src: "https://x.test/a.png" },
        { type: "linear", stops: [] },
      ]) {
        const d = window.design.getDocument();
        d.pages[0].nodes[0].fills = [bad];
        try {
          window.design.setDocument(d);
          out.push(false);
        } catch {
          out.push(true);
        }
      }
      return out;
    });
    assert.deepEqual(rejected, [true, true, true], "validate() rejects malformed paints");
    assert.deepEqual(errors, [], "no renderer errors");
    console.log("PASS persistence, single-fill back-compat and paint validation");
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
