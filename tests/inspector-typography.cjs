// Typography inspector parity with Wonder (design/wonder/properties-audit A10): field layout (family row full width,
// weight + size pair, line height "Auto", letter spacing, horizontal + vertical alignment), no text textarea or range
// row, the Type settings popover (case, wrap, whitespace, truncation, word break, indent, smoothing, decoration)
// writing optional fields that render on the canvas and clear back to absent, and in-canvas text editing with ⌘B / ⌘I
// range styling and undo. Screenshots go to $WP_TYPE_SHOTS when set.
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inspector-typography-"));
  const shots = process.env.WP_TYPE_SHOTS;
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1", VERYNIZE_LAUNCH_EDITOR: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${path.join(dir, "profile")}`, "--force-device-scale-factor=2"],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await page.setViewportSize({ width: 1440, height: 870 });
    await page.waitForSelector("#canvas .layer");
    const node = (id) =>
      page.evaluate(
        (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id),
        id,
      );
    const css = (id, prop) =>
      page
        .locator(`#canvas [data-id="${id}"]`)
        .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.pages[0].nodes = [
        {
          id: "title",
          name: "Title",
          type: "text",
          x: 200,
          y: 40,
          w: 240,
          h: 120,
          text: "Hello world",
          color: "#111111",
          fontFamily: "Inter",
          fontWeight: "400",
          fontSize: 24,
          lineHeight: 1.15,
        },
        {
          id: "box",
          name: "Box",
          type: "rectangle",
          x: 20,
          y: 20,
          w: 100,
          h: 80,
          color: "#ff0000",
        },
      ];
      window.design.setDocument(d);
      window.design.setSelection(["title"]);
    });
    const undo = async () => {
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press("ControlOrMeta+z");
    };
    const section = page.locator("#typography-section");
    await section.waitFor();

    // --- Layout: no textarea / range row; Wonder geometry (24 px fields, x 12 / 144, Inter row 256 wide) -------
    assert.equal(
      await page.locator("[name=text]").count(),
      0,
      "text is edited on the canvas, not in a textarea",
    );
    assert.equal(await page.locator("#range-bold, #range-italic, #range-style").count(), 0);
    const box = (loc) =>
      loc.evaluate((el) => {
        const r = el.getBoundingClientRect(),
          p = document.querySelector("#typography-section").getBoundingClientRect();
        return { x: Math.round(r.left - p.left), w: Math.round(r.width), h: Math.round(r.height) };
      });
    assert.deepEqual(await box(page.getByRole("button", { name: "Font family" })), {
      x: 12,
      w: 256,
      h: 24,
    });
    assert.deepEqual(await box(page.getByRole("button", { name: "Font weight" })), {
      x: 12,
      w: 124,
      h: 24,
    });
    const sizeShell = page
      .locator("#typography-section [name=fontSize]")
      .locator("xpath=ancestor::*[@data-field-shell][1]");
    assert.deepEqual(await box(sizeShell), { x: 144, w: 124, h: 24 });
    assert.deepEqual(await box(page.locator('[aria-label="Text alignment"]')), {
      x: 12,
      w: 124,
      h: 24,
    });
    assert.deepEqual(await box(page.locator('[aria-label="Vertical text alignment"]')), {
      x: 144,
      w: 124,
      h: 24,
    });
    // Fields sit on a 32 px pitch: weight row → line-height field (caption between) → alignment.
    const top = (loc) => loc.evaluate((el) => Math.round(el.getBoundingClientRect().top));
    const lhShell = page
      .locator("#typography-section [name=lineHeight]")
      .locator("xpath=ancestor::*[@data-field-shell][1]");
    assert.equal(
      (await top(sizeShell)) - (await top(page.getByRole("button", { name: "Font family" }))),
      32,
    );

    // --- Line height: ratio ↔ Auto -------------------------------------------------------------------------
    assert.equal(await page.locator("#typography-section [name=lineHeight]").inputValue(), "1.15");
    await page.locator("#typography-section [name=lineHeight]").fill("auto");
    await page.locator("#typography-section [name=lineHeight]").press("Enter");
    assert.equal((await node("title")).lineHeight, "auto");
    assert.equal(await page.locator("#typography-section [name=lineHeight]").inputValue(), "Auto");
    assert.equal(await css("title", "line-height"), "normal");
    await page.locator("#typography-section [name=lineHeight]").fill("1.5");
    await page.locator("#typography-section [name=lineHeight]").press("Enter");
    assert.equal((await node("title")).lineHeight, 1.5);
    await page.locator("#typography-section [name=lineHeight]").fill("");
    await page.locator("#typography-section [name=lineHeight]").press("Enter");
    assert.equal((await node("title")).lineHeight, "auto");
    assert.ok((await top(lhShell)) > (await top(sizeShell)));
    // New text stores line height Auto and the inspector reads "Auto" (Wonder CM3 / TX1-click), then back to Title.
    const added = await page.evaluate(() => window.design.addNode("text"));
    assert.equal((await node(added)).lineHeight, "auto");
    assert.equal(await page.locator("#typography-section [name=lineHeight]").inputValue(), "Auto");
    await page.evaluate(() => {
      window.design.runCommand("edit.undo");
      window.design.setSelection(["title"]);
    });

    // --- Vertical alignment ----------------------------------------------------------------------------------
    assert.equal(
      await page.getByRole("radio", { name: "Align top" }).getAttribute("data-state"),
      "on",
    );
    await page.getByRole("radio", { name: "Align middle" }).click();
    assert.equal((await node("title")).textAlignVertical, "center");
    assert.equal(await css("title", "align-content"), "center");
    await page.getByRole("radio", { name: "Align bottom" }).click();
    assert.equal(await css("title", "align-content"), "flex-end");
    // The text really moves to the bottom of its 120 px box.
    const textBottom = await page.locator('#canvas [data-id="title"]').evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el.querySelector("span"));
      return Math.round(el.getBoundingClientRect().bottom - r.getBoundingClientRect().bottom);
    });
    assert.ok(textBottom <= 2, `text sits at the bottom (gap ${textBottom})`);
    await page.getByRole("radio", { name: "Align top" }).click();
    assert.equal(
      (await node("title")).textAlignVertical,
      undefined,
      "top is the default and stores nothing",
    );
    assert.ok(!JSON.stringify(await node("title")).includes("textAlignVertical"));

    // --- Type settings popover ------------------------------------------------------------------------------
    await page.getByRole("button", { name: "Type settings" }).click();
    const pop = page.locator("#type-settings");
    await pop.waitFor();
    await pop.evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((x) => x.finished)),
    );
    assert.equal(await page.locator("#type-settings-toggle").getAttribute("data-active"), "true");
    // Opens beside the inspector (left of the panel), 288 wide.
    const geo = await pop.evaluate((el) => {
      const r = el.getBoundingClientRect(),
        p = document.querySelector("#properties").getBoundingClientRect();
      return { gap: Math.round(p.left - r.right), w: Math.round(r.width) };
    });
    assert.ok(geo.gap >= 0 && geo.gap <= 6, `popover sits next to the panel (gap ${geo.gap})`);
    assert.equal(geo.w, 288);
    assert.equal(
      await pop.getByRole("radio", { name: "No case" }).getAttribute("data-state"),
      "on",
    );
    assert.equal(
      await pop.getByRole("radio", { name: "Break words" }).getAttribute("data-state"),
      "on",
      "Word is the default",
    );
    assert.equal(
      await pop.getByRole("radio", { name: "Truncation off" }).getAttribute("data-state"),
      "on",
    );
    assert.equal(await pop.locator("[name=textWrap]").inputValue(), "");
    assert.equal(await pop.locator("[name=whiteSpace] option:checked").textContent(), "Normal");
    assert.equal(await pop.locator("[name=fontSmoothing] option:checked").textContent(), "Default");
    assert.equal(await pop.locator("[name=textIndent]").inputValue(), "0");
    if (shots) await page.screenshot({ path: path.join(shots, "type-settings-default.png") });

    await pop.getByRole("radio", { name: "Uppercase" }).click();
    await pop.locator("[name=textWrap]").selectOption("balance");
    await pop.locator("[name=whiteSpace]").selectOption("normal");
    await pop.getByRole("radio", { name: "Truncation on" }).click();
    await pop.getByRole("radio", { name: "Break all" }).click();
    await pop.locator("[name=textIndent]").fill("12");
    await pop.locator("[name=textIndent]").press("Enter");
    await pop.locator("[name=fontSmoothing]").selectOption("antialiased");
    await pop.getByRole("radio", { name: "Underline" }).click();
    const n1 = await node("title");
    assert.deepEqual(
      {
        t: n1.textTransform,
        w: n1.textWrap,
        s: n1.whiteSpace,
        tr: n1.truncate,
        b: n1.wordBreak,
        i: n1.textIndent,
        f: n1.fontSmoothing,
        d: n1.textDecoration,
      },
      {
        t: "uppercase",
        w: "balance",
        s: "normal",
        tr: true,
        b: "break-all",
        i: 12,
        f: "antialiased",
        d: "underline",
      },
    );
    assert.equal(await css("title", "text-transform"), "uppercase");
    assert.equal(await css("title", "text-decoration-line"), "underline");
    assert.equal(await css("title", "text-indent"), "12px");
    assert.equal(await css("title", "word-break"), "break-all");
    assert.equal(await css("title", "text-overflow"), "ellipsis");
    assert.equal(await css("title", "white-space-collapse"), "collapse");
    assert.equal(await css("title", "-webkit-font-smoothing"), "antialiased");
    assert.equal(
      await page
        .locator("#type-settings-preview")
        .evaluate((el) => getComputedStyle(el).textTransform),
      "uppercase",
      "preview follows the settings",
    );
    if (shots) await page.screenshot({ path: path.join(shots, "type-settings-set.png") });
    // Undo is one step per change.
    await undo();
    assert.equal(
      (await node("title")).textDecoration,
      undefined,
      "undo removes the last change only",
    );
    assert.equal((await node("title")).fontSmoothing, "antialiased");
    await pop.getByRole("radio", { name: "Underline" }).click();

    // Back to the defaults: every field is absent again, so the document is as before.
    await pop.getByRole("radio", { name: "No case" }).click();
    await pop.locator("[name=textWrap]").selectOption("");
    await pop.locator("[name=whiteSpace]").selectOption("");
    await pop.getByRole("radio", { name: "Truncation off" }).click();
    await pop.getByRole("radio", { name: "Break words" }).click();
    await pop.locator("[name=textIndent]").fill("0");
    await pop.locator("[name=textIndent]").press("Enter");
    await pop.locator("[name=fontSmoothing]").selectOption("");
    await pop.getByRole("radio", { name: "No decoration" }).click();
    const n2 = await node("title");
    for (const key of [
      "textTransform",
      "textWrap",
      "whiteSpace",
      "truncate",
      "wordBreak",
      "textIndent",
      "fontSmoothing",
      "textDecoration",
    ])
      assert.equal(n2[key], undefined, `${key} cleared`);
    await pop.getByRole("button", { name: "Close type settings" }).click();
    await pop.waitFor({ state: "detached" });

    // --- In-canvas editing: type, ⌘B / ⌘I a range, Escape commits one undo step ----------------------------
    await page.locator('#canvas [data-id="title"]').dblclick();
    const editor = page.locator("#canvas [data-text-editing]");
    await editor.waitFor();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Ship it");
    await page.evaluate(() => {
      const t = document.querySelector("#canvas [data-text-editing] span").firstChild,
        r = document.createRange();
      r.setStart(t, 0);
      r.setEnd(t, 4);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.press("ControlOrMeta+i");
    if (shots) await page.screenshot({ path: path.join(shots, "canvas-editing.png") });
    await page.keyboard.press("Escape");
    await editor.waitFor({ state: "detached" });
    const edited = await node("title");
    assert.equal(edited.text, "Ship it");
    assert.deepEqual(edited.textRuns, [{ start: 0, end: 4, bold: true, italic: true }]);
    assert.deepEqual(
      await page.evaluate(() => window.design.getSelection()),
      ["title"],
      "the layer stays selected after Escape",
    );
    // ⌘B on a range that is already bold removes it.
    await page.locator('#canvas [data-id="title"]').dblclick();
    await editor.waitFor();
    await page.evaluate(() => {
      const t = document.querySelector("#canvas [data-text-editing] span").firstChild,
        r = document.createRange();
      r.setStart(t, 0);
      r.setEnd(t, 4);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.press("ControlOrMeta+Enter");
    await editor.waitFor({ state: "detached" });
    assert.deepEqual((await node("title")).textRuns, [
      { start: 0, end: 4, bold: false, italic: true },
    ]);
    await undo();
    assert.deepEqual((await node("title")).textRuns, [
      { start: 0, end: 4, bold: true, italic: true },
    ]);
    await undo();
    assert.equal((await node("title")).text, "Hello world", "the first edit is one undo step");

    // A click elsewhere commits too.
    await page.locator('#canvas [data-id="title"]').dblclick();
    await editor.waitFor();
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await page.locator('#canvas [data-id="box"]').click();
    await editor.waitFor({ state: "detached" });
    assert.equal((await node("title")).text.endsWith("!"), true);

    // --- Light theme keeps the section readable (tokens switch) -----------------------------------------------
    await page.evaluate(() => window.design.setSelection(["title"]));
    await section.waitFor();
    if (shots) await section.screenshot({ path: path.join(shots, "typography-dark.png") });
    await page.evaluate(() => document.documentElement.setAttribute("data-ui-theme", "light"));
    const fieldBg = await page
      .getByRole("button", { name: "Font family" })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(fieldBg, "rgb(236, 236, 236)");
    if (shots) await section.screenshot({ path: path.join(shots, "typography-light.png") });
    console.log(
      "PASS typography: Wonder layout, line height Auto, vertical alignment, Type settings fields render + clear, in-canvas editing with range styling, light theme",
    );
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
