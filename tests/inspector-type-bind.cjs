// Type-to-bind (properties audit G1, Wonder design/wonder/properties-audit/wonder/G1-*.png): typing a name into W/H or
// the gap opens the compatible variables under the field; ↓ + Enter binds (the field becomes the chip), Escape closes
// the list and keeps the typed text; an empty Min/Max row lists the variables as soon as it is focused.
const { _electron } = require("@playwright/test");
const { mod } = require("./helpers/keys.cjs");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "inspector-type-bind-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1"; env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${profile}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await waitForUiReady(page);
    await page.waitForSelector("#canvas .layer");
    const node = () =>
      page.evaluate(() => window.design.getDocument().pages[0].nodes.find((n) => n.id === "box"));
    const list = (field) => page.locator(`[data-type-bind="${field}"]`);
    const options = (field) => list(field).locator("[role=option]");
    const addWidthLimit = async (field) => {
      const trigger = page.locator('[data-size-menu="w"]');
      // Radix keeps closing menu items mounted during their exit animation. Finish
      // that lifecycle before reopening, and never target an exiting menu item.
      await page.locator('[role=menu][data-state=closed]').waitFor({ state: "detached" });
      await trigger.click();
      const menu = page.locator('[role=menu][data-state=open]').filter({
        has: page.locator(`[data-limit="${field}"]`),
      });
      await menu.locator(`[data-limit="${field}"]`).click();
      await page.locator('[role=menu]').waitFor({ state: "detached" });
      await list(field).waitFor();
    };
    const typeInto = async (name, text) => {
      const input = page.locator(`#properties [name="${name}"]`);
      await input.click();
      await input.press(mod("a"));
      await input.pressSequentially(text);
      return input;
    };
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.variables = {
        "dimension-1": { type: "dimension", value: 0 },
        "content-width": { type: "dimension", value: 240 },
        ratio: { type: "number", value: 2 },
      };
      d.pages = [
        {
          id: "p",
          name: "Type to bind",
          nodes: [
            {
              id: "box",
              name: "Box",
              type: "frame",
              x: 40,
              y: 40,
              w: 270,
              h: 193,
              color: "#ffffff",
              layout: "flex",
              direction: "row",
              gap: 8,
            },
          ],
        },
      ];
      d.activePage = "p";
      window.design.setDocument(d);
      window.design.setSelection(["box"]);
    });

    // 1. Suggestions appear while typing a name into W, under the field and as wide as it (Wonder x 12–120, 32 tall).
    const w = await typeInto("w", "width");
    await list("w").waitFor();
    assert.deepEqual(await options("w").evaluateAll((o) => o.map((e) => e.dataset.variable)), [
      "content-width",
    ]);
    assert.match(await options("w").first().innerText(), /content-width\s+240px/);
    const geometry = await page.evaluate(() => {
      const shell = document
        .querySelector('#properties [name="w"]')
        .closest("[data-field-shell]")
        .getBoundingClientRect();
      const box = document.querySelector('[data-type-bind="w"]').getBoundingClientRect();
      const row = document.querySelector('[data-type-bind="w"] [role=option]').getBoundingClientRect();
      return { shell, box, row };
    });
    assert.ok(Math.abs(geometry.box.left - geometry.shell.left) <= 0.5, "list aligned to the field x");
    assert.ok(Math.abs(geometry.box.width - geometry.shell.width) <= 0.5, "list as wide as the field");
    assert.ok(
      Math.abs(geometry.box.top - geometry.shell.bottom - 4) <= 0.5,
      `list 4px under the field (${geometry.box.top - geometry.shell.bottom})`,
    );
    assert.equal(geometry.box.height, 32, "one suggestion → 32px list");
    assert.equal(geometry.row.height, 24, "24px rows");
    assert.equal(await list("w").locator("[data-active]").count(), 0, "nothing highlighted before ↓");
    assert.ok(await w.evaluate((e) => e === document.activeElement), "the field keeps focus");

    // Variable types follow BINDABLE: W takes dimensions only, the gap also numbers. Plain numbers open nothing.
    await typeInto("w", "ra");
    await page.waitForTimeout(100);
    assert.equal(await list("w").count(), 0, "a number variable is not offered for W");
    await typeInto("w", "300");
    await page.waitForTimeout(100);
    assert.equal(await list("w").count(), 0, "a plain number opens no list");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => window.design.getDocument().pages[0].nodes[0].w === 300,
    );

    // 2. ↓ highlights, Enter binds through the same path as the diamond menu: the field becomes the chip.
    await typeInto("w", "dimen");
    await list("w").waitFor();
    await page.keyboard.press("ArrowDown");
    assert.equal(await list("w").locator("[data-active]").getAttribute("data-variable"), "dimension-1");
    await page.keyboard.press("Enter");
    await page.locator('[data-bound="w"]').waitFor();
    let box = await node();
    assert.equal(box.bindings?.w, "dimension-1");
    assert.equal(box.w, 1, "bound width resolves (0 clamps to the 1px minimum)");
    assert.equal(
      await page.locator('[data-bound="w"] [data-variable-chip]').innerText(),
      "dimension-1",
    );
    assert.equal(await list("w").count(), 0, "list closed after binding");
    assert.equal(await page.locator("#properties [name=w]").count(), 0, "no editable W input while bound");
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    await page.locator("#properties [name=w]").waitFor();
    assert.equal((await node()).bindings?.w, undefined, "undo restores the unbound width");

    // 3. Gap: numbers are offered too; Escape closes the list and keeps the typed text and focus.
    const gap = await typeInto("gap", "rat");
    await list("gap").waitFor();
    assert.match(await options("gap").first().innerText(), /ratio\s+2/);
    await typeInto("gap", "dim");
    await list("gap").waitFor();
    await page.keyboard.press("Escape");
    await list("gap").waitFor({ state: "detached" });
    assert.equal(await gap.inputValue(), "dim", "Escape keeps the typed text");
    assert.ok(await gap.evaluate((e) => e === document.activeElement), "Escape keeps focus");
    box = await node();
    assert.equal(box.gap, 8);
    assert.equal(box.bindings?.gap, undefined);
    await page.keyboard.press("Escape");
    assert.equal(await gap.inputValue(), "8", "a second Escape reverts the field");

    // 4. Add min width: the empty, focused row lists the dimension variables without typing (Wonder 224 wide).
    await addWidthLimit("minW");
    assert.ok(
      await page.locator("#properties [name=minW]").evaluate((e) => e === document.activeElement),
      "the new Min W row is focused",
    );
    assert.deepEqual(await options("minW").evaluateAll((o) => o.map((e) => e.dataset.variable)), [
      "dimension-1",
      "content-width",
    ]);
    const limit = await page.evaluate(() => {
      const shell = document
        .querySelector('#properties [name="minW"]')
        .closest("[data-field-shell]")
        .getBoundingClientRect();
      const box = document.querySelector('[data-type-bind="minW"]').getBoundingClientRect();
      return { shell: shell.width, box: box.width, left: box.left - shell.left };
    });
    assert.ok(Math.abs(limit.box - limit.shell) <= 0.5, `limit list as wide as the row (${limit.box})`);
    assert.ok(Math.abs(limit.left) <= 0.5, "limit list aligned to the row");
    await page.keyboard.press("Escape");
    await list("minW").waitFor({ state: "detached" });
    assert.ok(
      await page.locator("#properties [name=minW]").evaluate((e) => e === document.activeElement),
      "Escape keeps the empty row focused",
    );
    // Focusing the empty row again lists the variables again.
    await page.locator("#properties [name=x]").click();
    await page.locator("#properties [name=minW]").click();
    await list("minW").waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.locator('[data-bound="minW"]').waitFor();
    box = await node();
    assert.equal(box.bindings?.minW, "content-width");
    assert.equal(box.minW, 240);

    // Max W behaves the same.
    await addWidthLimit("maxW");
    assert.equal(await options("maxW").count(), 2);
    await page.keyboard.press("Escape");
    await list("maxW").waitFor({ state: "detached" });

    assert.deepEqual(errors, []);
    console.log("Inspector type-to-bind tests passed");
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
