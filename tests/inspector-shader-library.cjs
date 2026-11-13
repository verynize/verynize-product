// Shader library (behaviour modelled on design/wonder/2026-10-30/30–31): search the preset picker, apply an
// original parametric preset, edit its four colours (custom and bound to a Colors variable that the GPU output
// follows), change sliders in Shader settings (one undo step each), reload persistence and real WebGL pixels.
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "inspector-shader-library-"));
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
    const node = () =>
      page.evaluate(() => window.design.getDocument().pages[0].nodes.find((n) => n.id === "sh"));
    const undo = () => page.evaluate(() => window.design.runCommand("edit.undo"));
    const params = () =>
      page
        .locator('#canvas [data-id="sh"]')
        .evaluate((el) => (el.dataset.shaderParams ? JSON.parse(el.dataset.shaderParams) : null));
    // Centre pixel of the live WebGL surface (premultiplied RGBA).
    const pixel = async () => {
      await page.waitForSelector('#canvas [data-id="sh"][data-shader-status="ready"]');
      return page.locator('#canvas [data-id="sh"] canvas.shader-surface').evaluate((c) => {
        const gl = c.getContext("webgl"),
          p = new Uint8Array(4);
        gl.readPixels(
          Math.floor(c.width / 2),
          Math.floor(c.height / 2),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          p,
        );
        return { rgba: [...p], error: gl.getError() };
      });
    };
    const setup = () =>
      page.evaluate(() => {
        const d = window.design.getDocument();
        d.tokens = { ...d.tokens, "brand/glow": "#ff0000" };
        d.pages = [
          {
            id: "p",
            name: "Shaders",
            nodes: [
              {
                id: "sh",
                name: "Shader",
                type: "shader",
                x: 40,
                y: 40,
                w: 320,
                h: 220,
                color: "#a58bdd",
                shaderPreset: "aurora",
                shaderSpeed: 0,
                shaderIntensity: 1,
              },
            ],
          },
        ];
        d.activePage = "p";
        window.design.setDocument(d);
        window.design.setSelection(["sh"]);
      });
    await setup();
    await page.waitForSelector("#shader-settings:not([hidden])");
    assert.equal(
      await page.locator("#shader-parameters").count(),
      0,
      "classic presets have no colour rows",
    );

    // Picker: search filters by name and family; no match shows an empty message.
    await page.locator("#shader-settings summary").click();
    await page.locator("#choose-shader").click();
    const gallery = page.locator("#shader-gallery");
    await gallery.waitFor();
    const total = await gallery.locator("[data-shader-option]").count();
    assert.ok(total >= 19, `catalog has ${total} presets`);
    await gallery.locator("[name=shaderSearch]").fill("ripple");
    assert.deepEqual(
      await gallery
        .locator("[data-shader-option]")
        .evaluateAll((els) => els.map((e) => e.dataset.shaderOption)),
      ["ripple-pool-1", "ripple-pool-2", "ripple-pool-3"],
    );
    await gallery.locator("[name=shaderSearch]").fill("zzz");
    assert.equal(await gallery.locator("[data-shader-option]").count(), 0);
    assert.match(await gallery.textContent(), /No shaders match/);
    await gallery.locator("[name=shaderSearch]").fill("tidal swirl 3");
    await gallery.locator('[data-shader-option="tidal-swirl-3"]').click();
    await gallery.waitFor({ state: "detached" });
    let n = await node();
    assert.equal(n.shaderPreset, "tidal-swirl-3");
    assert.equal(n.shaderSpeed, 1.5, "a parametric preset loads its default speed");
    await undo();
    assert.equal((await node()).shaderPreset, "aurora", "choosing a preset is one undo step");
    await page.evaluate(() => window.design.runCommand("edit.redo"));
    assert.equal((await node()).shaderPreset, "tidal-swirl-3");
    await page.locator("#shader-parameters").waitFor();
    // Freeze motion so pixels are deterministic.
    await page.locator("[name=shaderSpeed]").fill("0");
    await page.locator("[name=shaderSpeed]").press("Enter");
    assert.equal((await node()).shaderSpeed, 0);
    const base = await pixel();
    assert.equal(base.error, 0);
    assert.ok(
      base.rgba[3] > 0 && base.rgba.slice(0, 3).some((v) => v > 0),
      "parametric shader paints",
    );
    assert.equal((await params()).colors.center, "#2fb5a3");

    // Four colour rows with hex + alpha; a custom colour is stored and rendered.
    for (const label of ["Gradient Center", "Gradient Edge", "Ripple Color", "Background"])
      assert.ok(
        await page.locator("#shader-parameters").getByText(label, { exact: true }).isVisible(),
      );
    await page.locator("[name=shader-center]").fill("0000FF");
    await page.locator("[name=shader-center]").press("Enter");
    assert.deepEqual((await node()).shaderColors.center, { color: "#0000ff" });
    assert.equal((await params()).colors.center, "#0000ff");
    const blue = await pixel();
    assert.ok(blue.rgba[2] > blue.rgba[0], `centre turns blue ${blue.rgba.join(",")}`);
    await page.locator("[name=shader-backgroundAlpha]").fill("50");
    await page.locator("[name=shader-backgroundAlpha]").press("Enter");
    assert.equal((await node()).shaderColors.background.color, "#020a0b80");

    // Bind the centre colour to a Colors variable through the picker's Variables tab.
    await page.getByRole("button", { name: "Pick gradient center" }).click();
    const picker = page.locator("#color-dialog");
    await picker.getByRole("tab", { name: "Variables" }).click();
    await picker.getByRole("option", { name: /brand\/glow/ }).click();
    n = await node();
    assert.deepEqual(n.shaderColors.center, { color: "#ff0000", token: "brand/glow" });
    assert.equal((await params()).colors.center, "#ff0000");
    const red = await pixel();
    assert.ok(red.rgba[0] > red.rgba[2], `centre follows the variable ${red.rgba.join(",")}`);
    await page.keyboard.press("Escape");
    // Changing the variable re-renders the shader with the new value.
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens["brand/glow"] = "#00ff00";
      window.design.setDocument(d);
      window.design.setSelection(["sh"]);
    });
    assert.equal((await params()).colors.center, "#00ff00");
    const green = await pixel();
    assert.ok(
      green.rgba[1] > green.rgba[0] && green.rgba[1] > green.rgba[2],
      `variable change ${green.rgba.join(",")}`,
    );

    // Shader settings: six sliders, each change one undo step.
    await page.locator("#shader-options-open").click();
    const options = page.locator("#shader-options");
    await options.waitFor();
    for (const label of [
      "Gradient Aspect",
      "Gradient Size",
      "Ripple Density",
      "Animation Speed",
      "Distortion Amount",
      "Grain Strength",
    ])
      assert.equal(await options.getByRole("slider", { name: label }).count(), 1, label);
    assert.equal(await options.locator("[name=shader-density]").inputValue(), "14");
    await options.locator("[name=shader-density]").fill("80");
    assert.equal((await node()).shaderParams.density, 80);
    assert.equal((await params()).density, 80);
    const dense = await pixel();
    await options.locator("[name=shader-grain]").fill("0");
    assert.deepEqual((await node()).shaderParams, { density: 80, grain: 0 });
    await options.locator("[name=shader-speed]").fill("2.5");
    assert.equal((await node()).shaderSpeed, 2.5);
    await undo();
    assert.equal((await node()).shaderSpeed, 0);
    await undo();
    assert.deepEqual((await node()).shaderParams, { density: 80 });
    await undo();
    assert.equal((await node()).shaderParams, undefined);
    await page.evaluate(() => window.design.runCommand("edit.redo"));
    assert.equal((await node()).shaderParams.density, 80);
    assert.ok(dense.rgba[3] > 0);
    await page.keyboard.press("Escape");

    // Detach: a custom colour from the picker drops the binding but keeps the chosen value.
    await page.getByRole("button", { name: "Pick gradient center" }).click();
    await page.locator("#color-dialog").getByRole("tab", { name: "Custom" }).click();
    await page.locator("#color-value").fill("#123456");
    await page.locator("#color-value").press("Enter");
    assert.deepEqual((await node()).shaderColors.center, { color: "#123456" });
    await page.keyboard.press("Escape");

    // A second custom colour (ripple) for the persistence check.
    await page.locator("[name=shader-ripple]").fill("ABCDEF");
    await page.locator("[name=shader-ripple]").press("Enter");

    // Persistence across reload; the canvas renders the stored parameters again.
    await page.waitForTimeout(400);
    await page.reload();
    await page.waitForSelector('#canvas [data-id="sh"][data-shader-status="ready"]');
    n = await node();
    assert.equal(n.shaderPreset, "tidal-swirl-3");
    assert.equal(n.shaderColors.ripple.color, "#abcdef");
    assert.equal(n.shaderParams.density, 80);
    const reloaded = await params();
    assert.equal(reloaded.colors.center, "#123456");
    assert.equal(reloaded.colors.background, "#020a0b80");
    const after = await pixel();
    assert.ok(after.rgba[3] > 0 && after.rgba.slice(0, 3).some((v) => v > 0));

    // Exported HTML carries the resolved parameters and paints in a sandboxed preview.
    const html = await page.evaluate(() => window.design.exportHTML());
    assert.match(html, /data-shader-params="/);
    await page.evaluate((html) => {
      const frame = document.createElement("iframe");
      frame.id = "shader-library-export";
      frame.sandbox = "allow-scripts";
      frame.style.cssText = "position:fixed;inset:0;width:500px;height:400px;z-index:999999";
      frame.srcdoc = html;
      document.body.append(frame);
    }, html);
    const frame = page.frameLocator("#shader-library-export");
    await frame.locator('[data-shader-kind="param"][data-shader-status="ready"]').waitFor();
    console.log(
      "PASS: shader library search, parametric preset + undo, custom/bound/detached colours drive GPU pixels, sliders one undo step each, reload and export",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
