// Remaining inspector parity (Wonder 15–21, validation v06/v09/v15): Colors variables on the border (one colour
// or per side) and the outline, folder groups in the bind menu and the colour picker Variables tab, Image and
// Custom masks, Advanced mask options (Mode, Repeat, Position, Size), mask operations and "Detach mask as
// shape". Everything goes through the real inspector, renders on the canvas, is undoable and survives reload.
const { _electron } = require("@playwright/test");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

// 2×2 PNG: opaque top row, transparent bottom row.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z8DwnwEIGBgYGBgYAAAx3AT8LmURdgAAAABJRU5ErkJggg==";

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "inspector-border-mask-"));
  const imagePath = path.join(profile, "mask.png");
  await fs.writeFile(imagePath, Buffer.from(PNG, "base64"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1"; env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${profile}`],
    timeout: 20000,
  });
  try {
    let page = await app.firstWindow({ timeout: 20000 }); await moveOffCursor(app);
    await page.waitForSelector("#canvas .layer");
    const doc = () => page.evaluate(() => window.design.getDocument());
    const node = (id) =>
      page.evaluate(
        (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id),
        id,
      );
    const css = (id, prop) =>
      page
        .locator(`#canvas [data-id="${id}"]`)
        .evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), prop);
    const undo = () => page.evaluate(() => window.design.runCommand("edit.undo"));
    const commit = async (selector, value) => {
      const field = page.locator(selector);
      await field.fill(value);
      await field.press("Enter");
    };
    const setToken = (name, value) =>
      page.evaluate(
        ([name, value]) => {
          const d = window.design.getDocument();
          d.tokens[name] = value;
          const selection = window.design.getSelection();
          window.design.setDocument(d);
          window.design.setSelection(selection);
        },
        [name, value],
      );
    const pickVariable = async (pickLabel, name) => {
      await page.getByRole("button", { name: pickLabel, exact: true }).click();
      const dialog = page.locator("#color-dialog");
      await dialog.getByRole("tab", { name: "Variables" }).click();
      await dialog.locator(`[role=option][data-variable="${name}"]`).click();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
    };
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens = { accent: "#5eead4", "brand/line": "#334155", "brand/glow": "#ff00ff" };
      d.variables = {
        gutter: { type: "dimension", value: 8 },
        "space/md": { type: "dimension", value: 240 },
      };
      d.pages = [
        {
          id: "p",
          name: "Parity",
          nodes: [
            {
              id: "card",
              name: "Card",
              type: "rectangle",
              x: 40,
              y: 40,
              w: 200,
              h: 120,
              color: "#ffcc00",
              strokeWidth: 4,
              strokeColor: "#000000",
            },
          ],
        },
      ];
      d.activePage = "p";
      window.design.setDocument(d);
      window.design.setSelection(["card"]);
    });
    await page.waitForSelector("#border-section [name=strokeColor]");

    // Colour picker Variables tab groups slash names into folders (root first, then "brand").
    await page.getByRole("button", { name: "Pick border colour", exact: true }).click();
    await page.locator("#color-dialog").getByRole("tab", { name: "Variables" }).click();
    const groups = await page
      .locator("#color-dialog [role=group]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    assert.deepEqual(groups, ["Colors", "brand"]);
    assert.equal(
      await page
        .locator('#color-dialog [role=group][aria-label="brand"] [data-variable="brand/line"]')
        .innerText()
        .then((t) => t.includes("line")),
      true,
    );
    await page.keyboard.press("Escape");

    // Border colour bound to a variable follows it; detaching keeps the resolved colour; undo rebinds.
    await pickVariable("Pick border colour", "brand/line");
    let n = await node("card");
    assert.deepEqual([n.strokeToken, n.strokeColor], ["brand/line", "#334155"]);
    assert.equal(await css("card", "border-top-color"), "rgb(51, 65, 85)");
    await setToken("brand/line", "#ff0000");
    assert.equal(await css("card", "border-left-color"), "rgb(255, 0, 0)");
    // Wonder A2: the unlink sits inside the bound colour field and only shows on hover; no trailing buttons.
    const detach = page.getByRole("button", { name: "Detach border colour variable" });
    const opacity = () => detach.evaluate((el) => getComputedStyle(el).opacity);
    await page.mouse.move(0, 0);
    assert.equal(await opacity(), "0");
    assert.equal(
      await detach.evaluate((el) => !!el.closest("[data-bound-color=strokeColor]")),
      true,
      "unlink lives inside the colour field",
    );
    await page.locator("[data-bound-color=strokeColor]").hover();
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector("[data-detach-token]")).opacity === "1",
    );
    await detach.click();
    n = await node("card");
    assert.deepEqual([n.strokeToken, n.strokeColor], [undefined, "#ff0000"]);
    assert.equal(await css("card", "border-top-color"), "rgb(255, 0, 0)");
    await undo();
    assert.equal((await node("card")).strokeToken, "brand/line");

    // Independent sides (Wonder A2): four side entries, each with its own colour row and bindable; the uniform
    // binding seeds the four sides.
    await page.getByRole("button", { name: "Independent border sides" }).click();
    n = await node("card");
    assert.deepEqual(n.strokeWidths, [4, 4, 4, 4]);
    assert.equal(n.strokeColors.length, 4);
    assert.deepEqual(n.strokeColors[0], { color: "#ff0000", token: "brand/line" });
    assert.equal(n.strokeToken, undefined);
    // A bound side shows the variable; detach it, then type a colour.
    // Bound: a variable chip replaces the hex/alpha inputs, so the side cannot be typed into.
    assert.equal(await page.locator("[name=strokeColorRight]").count(), 0);
    assert.equal(
      await page
        .locator('[data-bound-color=strokeColorRight] [data-variable-chip="brand/line"]')
        .innerText(),
      "line",
    );
    await page.getByRole("button", { name: "Detach right border colour variable" }).click();
    assert.deepEqual((await node("card")).strokeColors[1], { color: "#ff0000" });
    await commit("[name=strokeColorRight]", "00FF00");
    await pickVariable("Pick left border colour", "accent");
    n = await node("card");
    assert.deepEqual(n.strokeColors[1], { color: "#00ff00" });
    assert.deepEqual(n.strokeColors[3], { color: "#5eead4", token: "accent" });
    assert.equal(await css("card", "border-right-color"), "rgb(0, 255, 0)");
    assert.equal(await css("card", "border-left-color"), "rgb(94, 234, 212)");
    await setToken("accent", "#0000ff");
    assert.equal(await css("card", "border-left-color"), "rgb(0, 0, 255)");
    assert.equal(await css("card", "border-top-color"), "rgb(255, 0, 0)");

    // Outline colour bound to a Colors variable.
    await page.locator("#outline-section .insp-add").click();
    await pickVariable("Pick outline colour", "brand/glow");
    n = await node("card");
    assert.deepEqual([n.outlineToken, n.outlineColor], ["brand/glow", "#ff00ff"]);
    assert.equal(await css("card", "outline-color"), "rgb(255, 0, 255)");
    await setToken("brand/glow", "#00ffff");
    assert.equal(await css("card", "outline-color"), "rgb(0, 255, 255)");

    // Bind menu groups typed variables by folder.
    await page.locator("[name=w]").hover();
    await page.locator("[data-bind=w]").click();
    await page
      .locator('[role=menu] [data-variable-folder="space"] [data-variable="space/md"]')
      .waitFor();
    const order = await page
      .locator("[role=menu] [data-variable]")
      .evaluateAll((els) => els.map((el) => el.dataset.variable));
    assert.deepEqual(order, ["gutter", "space/md"]);
    await page.locator('[role=menuitem][data-variable="space/md"]').click();
    assert.equal((await node("card")).w, 240);

    // Custom mask with Advanced options and an operation.
    await page.locator("#mask-section .insp-add").click();
    await page.waitForSelector("#mask-editor");
    await page.locator('#mask-editor [data-mask-type="custom"]').click();
    assert.equal((await node("card")).masks[0].type, "custom");
    await commit("[name=mask-0-css]", "linear-gradient(90deg, black, transparent)");
    await page.locator("[data-mask-advanced='0']").click();
    await page.locator("[name=mask-0-mode]").selectOption("luminance");
    await page.locator("[name=mask-0-repeat]").selectOption("no-repeat");
    await commit("[name=mask-0-x]", "10");
    await commit("[name=mask-0-y]", "20");
    await commit("[name=mask-0-size]", "50% 100%");
    await page.locator("[name=mask-0-composite]").selectOption("intersect");
    assert.deepEqual((await node("card")).masks[0], {
      type: "custom",
      rotation: 180, // gradient settings stay for switching back to Linear
      alpha: 100,
      css: "linear-gradient(90deg, black, transparent)",
      mode: "luminance",
      repeat: "no-repeat",
      x: 10,
      y: 20,
      size: "50% 100%",
      composite: "intersect",
    });
    assert.match(await css("card", "mask-image"), /linear-gradient\(90deg/);
    assert.equal(await css("card", "mask-mode"), "luminance");
    assert.equal(await css("card", "mask-repeat"), "no-repeat");
    assert.equal(await css("card", "mask-position"), "10% 20%");
    assert.equal(await css("card", "mask-size"), "50% 100%");
    assert.equal(await css("card", "mask-composite"), "intersect");
    // Invalid values are refused in the field.
    await commit("[name=mask-0-size]", "10vw");
    assert.equal((await node("card")).masks[0].size, "50% 100%");
    await undo();
    assert.equal((await node("card")).masks[0].composite, undefined);

    // Image mask from a file; rendered as a mask-image url.
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator('#mask-editor [data-mask-type="image"]').click(),
    ]);
    await chooser.setFiles(imagePath);
    await page.waitForFunction(
      () => window.design.getDocument().pages[0].nodes[0].masks?.[0]?.type === "image",
    );
    n = await node("card");
    assert.equal(n.masks[0].src, "data:image/png;base64," + PNG);
    assert.equal(n.masks[0].css, undefined);
    assert.match(await css("card", "mask-image"), /^url\("data:image\/png;base64,/);
    await page.locator("#mask-editor").getByRole("button", { name: "Replace image…" }).waitFor();

    // Reload keeps every binding and mask.
    await page.waitForTimeout(600);
    await page.reload();
    await page.waitForSelector("#canvas .layer");
    await page.evaluate(() => window.design.setSelection(["card"]));
    n = await node("card");
    assert.equal(n.strokeColors[3].token, "accent");
    assert.equal(n.outlineToken, "brand/glow");
    assert.equal(n.masks[0].type, "image");
    assert.equal(await css("card", "border-left-color"), "rgb(0, 0, 255)");

    // Detach mask as shape: the mask leaves the layer and becomes a new layer above it (one undo step).
    const before = (await doc()).pages[0].nodes.length;
    await page.locator("[data-mask-edit='0']").click();
    await page.locator("[data-mask-detach='0']").click();
    let d = await doc();
    assert.equal(d.pages[0].nodes.length, before + 1);
    const shape = d.pages[0].nodes[d.pages[0].nodes.findIndex((x) => x.id === "card") + 1];
    assert.equal(shape.type, "rectangle");
    assert.equal(shape.name, "Card mask");
    assert.deepEqual([shape.x, shape.y, shape.w, shape.h], [40, 40, 240, 120]);
    assert.equal(shape.fills[0].type, "image");
    assert.equal(shape.fills[0].src, "data:image/png;base64," + PNG);
    assert.equal(shape.masks, undefined);
    assert.equal(d.pages[0].nodes.find((x) => x.id === "card").masks, undefined);
    assert.deepEqual(await page.evaluate(() => window.design.getSelection()), [shape.id]);
    assert.equal(await css("card", "mask-image"), "none");
    await undo();
    d = await doc();
    assert.equal(d.pages[0].nodes.length, before);
    assert.equal(d.pages[0].nodes.find((x) => x.id === "card").masks[0].type, "image");

    // Gradient masks detach into gradient fills (black fading to transparent, alpha kept).
    await page.evaluate(() => {
      window.design.setSelection(["card"]);
      window.design.updateNodes(["card"], { masks: [{ type: "linear", rotation: 90, alpha: 50 }] });
    });
    await page.locator("[data-mask-edit='0']").click();
    await page.locator("[data-mask-detach='0']").click();
    d = await doc();
    const fade = d.pages[0].nodes.at(-1);
    assert.deepEqual(fade.fills, [
      {
        type: "linear",
        angle: 90,
        stops: [
          { position: 0, color: "#00000080" },
          { position: 100, color: "#00000000" },
        ],
      },
    ]);

    // Validation rejects malformed values (shared with design-store validateDocument).
    const rejected = await page.evaluate(() => {
      const out = [];
      for (const patch of [
        { strokeToken: 7 },
        { outlineToken: "" },
        { strokeColors: [{ color: "#fff" }] },
        { masks: [{ type: "image", src: "https://x/y.png" }] },
        { masks: [{ type: "linear", composite: "xor" }] },
      ]) {
        try {
          window.design.updateNodes(["card"], patch);
          out.push(false);
        } catch {
          out.push(true);
        }
      }
      return out;
    });
    assert.deepEqual(rejected, [true, true, true, true, true]);
    console.log(
      "PASS inspector border/outline variables, per-side colours, folder groups in pickers, image/custom masks, advanced mask options, operations, detach mask as shape, reload, undo, validation",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
