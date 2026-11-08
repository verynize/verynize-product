const { _electron, expect } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { mod } = require("./helpers/keys.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-find-"));
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1", VERYNIZE_LAUNCH_EDITOR: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${profile}`, "--force-device-scale-factor=2"],
  });
  try {
    const p = await app.firstWindow();
    await waitForUiReady(p);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 870),
    );
    await p.evaluate(() => {
      const d = window.design.getDocument();
      const base = {
        type: "rectangle",
        x: 0,
        y: 0,
        w: 100,
        h: 80,
        color: "#6688aa",
        parentId: null,
      };
      d.pages = [
        {
          id: "one",
          name: "First",
          nodes: [
            {
              ...base,
              id: "parent",
              shortId: "par",
              name: "Container",
              type: "frame",
              w: 1440,
              h: 900,
            },
            { ...base, id: "child", shortId: "kid", parentId: "parent", name: "Nested target" },
            {
              ...base,
              id: "11111111-2222-4333-8444-555555555555",
              shortId: "abc",
              name: "Card alpha",
              x: -4000,
            },
            {
              ...base,
              id: "text",
              name: "Card beta",
              type: "text",
              text: "A ripe mango [literal].",
              w: 380,
              h: 80,
              fontSize: 24,
              x: 4000,
            },
            { ...base, id: "hidden", name: "Secret card", hidden: true },
            { ...base, id: "locked", name: "Locked card", locked: true },
          ],
        },
        { id: "two", name: "Second", nodes: [{ ...base, id: "other", name: "Other page" }] },
      ];
      d.activePage = "one";
      window.design.setDocument(d);
      window.design.setSelection(["child"]);
      window.design.setCamera(0, 0, 1);
    });
    const panel = p.locator("#find-layers");
    const input = p.locator("#find-layers-input");
    const rows = p.locator("[data-find-result]");
    const count = p.locator("#find-layers-count");
    const spotlight = p.locator("#find-layers-spotlight");
    const camera = () => p.evaluate(() => window.design.getCamera());
    const selection = () => p.evaluate(() => window.design.getSelection());
    const expectFramed = async (id) => {
      await expect
        .poll(() =>
          p.evaluate((id) => {
            const node = document
              .querySelector(`#canvas [data-id="${id}"]`)
              .getBoundingClientRect();
            const viewport = document.getElementById("canvas-wrap").getBoundingClientRect();
            const finder = document.getElementById("find-layers").getBoundingClientRect();
            return (
              node.left >= viewport.left + 31 &&
              node.right <= finder.left - 31 &&
              node.top >= viewport.top + 47 &&
              node.bottom <= viewport.bottom - 79
            );
          }, id),
        )
        .toBe(true);
    };
    const shot = async (name) => {
      if (!process.env.FIND_SCREENSHOT_DIR) return;
      await fs.mkdir(process.env.FIND_SCREENSHOT_DIR, { recursive: true });
      await p.screenshot({ path: path.join(process.env.FIND_SCREENSHOT_DIR, `find-${name}.png`) });
    };
    await p.getByRole("button", { name: "Collapse Container", exact: true }).click();
    await expect(p.locator('.layer-row[data-id="child"]')).toHaveCount(0);
    await p.evaluate(() => document.activeElement?.blur());
    const originalCamera = await camera();
    await p.keyboard.press(mod("f"));
    await expect(panel).toBeVisible();
    assert.deepEqual(await selection(), []);
    await expect(panel).toContainText("Search by layer name, text, or ID");
    await expect(spotlight).toHaveCount(0);
    await shot("empty");
    await input.fill(" CARD ");
    await expect(rows).toHaveCount(4);
    assert.deepEqual(await rows.evaluateAll((list) => list.map((n) => n.dataset.findResult)), [
      "locked",
      "hidden",
      "text",
      "11111111-2222-4333-8444-555555555555",
    ]);
    await expect(count).toHaveText("1 of 4");
    await p.evaluate(() => window.design.setCamera(0, 0, 1));
    await p.keyboard.press("ArrowUp");
    await expect(count).toHaveText("4 of 4");
    await expectFramed("11111111-2222-4333-8444-555555555555");
    const before = await camera();
    await p.keyboard.press("ArrowUp");
    await expect(count).toHaveText("3 of 4");
    assert.notDeepEqual(await camera(), before);
    await expectFramed("text");
    await expect(spotlight).toBeVisible();
    const expectSpotlight = async (id) => {
      await expect
        .poll(() =>
          p.evaluate((id) => {
            const node = document
              .querySelector(`#canvas [data-id="${id}"]`)
              .getBoundingClientRect();
            const focus = document.getElementById("find-layers-spotlight").getBoundingClientRect();
            return ["left", "top", "width", "height"].every(
              (key) => Math.abs(node[key] - focus[key]) < 1,
            );
          }, id),
        )
        .toBe(true);
    };
    await expectSpotlight("text");
    await p.evaluate(() => window.design.setCamera(-320, 120, 0.25));
    await expectSpotlight("text");
    assert.equal(await spotlight.evaluate((el) => getComputedStyle(el).outlineWidth), "2px");
    assert.equal(await spotlight.evaluate((el) => getComputedStyle(el).pointerEvents), "none");
    assert.deepEqual(await selection(), []);
    await p.evaluate(() =>
      window.design.updateNodes(["text"], { text: "A ripe mango [literal]. Updated" }),
    );
    await expect(count).toHaveText("3 of 4");
    await expect(p.locator('#canvas [data-id="text"]')).toHaveAttribute("data-find-focus", "");
    await p.keyboard.press("Escape");
    assert.deepEqual(await selection(), ["child"]);
    assert.deepEqual(await camera(), originalCamera);
    await expect(spotlight).toHaveCount(0);
    await p.locator("#find-layers-button").click();
    await expect(count).toHaveText("3 of 4");
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    assert.deepEqual(await selection(), ["child"]);
    await p.locator("#find-layers-button").click();
    await expect(count).toHaveText("3 of 4");
    await shot("results");
    await p.evaluate(() => (document.documentElement.dataset.uiTheme = "light"));
    await shot("light");
    await p.evaluate(() => (document.documentElement.dataset.uiTheme = "dark"));
    const wheelBefore = await camera();
    await rows.first().hover();
    await p.mouse.wheel(0, 250);
    await p.waitForTimeout(100);
    assert.deepEqual(await camera(), wheelBefore);
    await p.evaluate(() => window.design.setCamera(0, 0, 0.16));
    await rows.first().click();
    await expect(count).toHaveText("1 of 4");
    await expectFramed("locked");
    assert.equal((await camera()).zoom, 1);
    assert.deepEqual(await selection(), []);
    const derivedRef = await p.evaluate(
      () => window.agentWorkspace.searchElements("Card beta").find((n) => n.id === "text").shortId,
    );
    await input.fill(derivedRef);
    // The derived ref "ner" also occurs in Container; name matching remains enabled.
    await expect(rows).toHaveCount(2);
    await expect(p.locator('[data-find-result="text"]')).toBeVisible();
    await input.fill("Container");
    await expect(rows).toHaveCount(1);
    await expectFramed("parent");
    await expectSpotlight("parent");
    assert.ok((await camera()).zoom > 0.16 && (await camera()).zoom < 1);
    // Clicking the active result also recovers the framing after a manual camera change.
    await p.evaluate(() => window.design.setCamera(0, 0, 0.16));
    await rows.first().click();
    await expectFramed("parent");
    for (const [query, id] of [
      ["MANGO", "text"],
      ["[literal]", "text"],
      ["11111111-2222-4333-8444-555555555555", "11111111-2222-4333-8444-555555555555"],
      ["abc", "11111111-2222-4333-8444-555555555555"],
      ["par.kid", "child"],
    ]) {
      await input.fill(query);
      await expect(rows).toHaveCount(1);
      await expect(rows).toHaveAttribute("data-find-result", id);
    }
    await expectFramed("child");
    const committedCamera = await camera();
    await shot("id");
    await p.keyboard.press("Enter");
    assert.deepEqual(await camera(), committedCamera);
    await expect(panel).toHaveCount(0);
    assert.deepEqual(await selection(), ["child"]);
    await expect(p.locator('.layer-row[data-id="child"]')).toBeVisible();
    await p.locator("#find-layers-button").click();
    await expect(input).toHaveValue("par.kid");
    await input.fill("11111111-2222");
    await expect(rows).toHaveCount(0);
    await expect(panel).toContainText("No layers found for");
    await expect(spotlight).toHaveCount(0);
    await shot("no-results");
    await input.fill("card");
    await p.evaluate(() => window.design.setActivePage("two"));
    await expect(rows).toHaveCount(0);
    await input.fill("Other");
    await expect(rows).toHaveCount(1);
    await p.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await p.locator("#find-layers-button").click();
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await p.locator("#find-layers-button").click();
    await p.locator("#workspace").click({ position: { x: 10, y: 200 } });
    await expect(panel).toHaveCount(0);
    await p.keyboard.press(mod("k"));
    await p.locator("[cmdk-input]").fill("Find layers");
    await p.keyboard.press(mod("f"));
    await expect(panel).toHaveCount(0);
    await p.locator('[data-command-id="app.findLayers"]').click();
    await expect(panel).toBeVisible();
    await input.dispatchEvent("keydown", { key: "Escape", isComposing: true });
    await expect(panel).toBeVisible();
    await p.keyboard.press("Escape");
    await p.evaluate(() => {
      document.activeElement?.blur();
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ф",
          code: "KeyF",
          metaKey: /Mac/.test(navigator.platform),
          ctrlKey: !/Mac/.test(navigator.platform),
          bubbles: true,
        }),
      );
    });
    await expect(panel).toBeVisible();
    await p.locator("#zoom-menu-button").focus();
    await expect(panel).toHaveCount(0);
    if (process.env.FIND_SCREENSHOT_DIR) {
      await p.keyboard.press("Escape");
      await p.evaluate(() => {
        document.documentElement.dataset.uiTheme = "dark";
        const d = window.design.getDocument();
        d.name = "Layer finder";
        d.pages = [
          {
            id: "proof",
            name: "Design",
            nodes: [0, 1, 2].map((i) => ({
              id: "proof-" + i,
              shortId: ["one", "two", "tri"][i],
              type: "rectangle",
              name: ["Card — Ocean", "Card — Forest", "Card — Sunset"][i],
              x: i * 240,
              y: 80,
              w: 200,
              h: 240,
              radius: 16,
              color: ["#4b7ca3", "#537f6b", "#b78162"][i],
              parentId: null,
            })),
          },
        ];
        d.activePage = "proof";
        window.design.setDocument(d);
        window.design.setSelection([]);
        window.design.zoomToFit();
      });
      await p.locator("#find-layers-button").click();
      await input.fill("");
      await shot("empty");
      await input.fill("Card");
      await p.keyboard.press("ArrowDown");
      await expect(count).toHaveText("2 of 3");
      await expect(p.locator('#canvas [data-id="proof-1"]')).toHaveAttribute("data-find-focus", "");
      await shot("results");
      await p.evaluate(() => (document.documentElement.dataset.uiTheme = "light"));
      await shot("light");
      await p.evaluate(() => (document.documentElement.dataset.uiTheme = "dark"));
      await input.fill("missing");
      await shot("no-results");
      await input.fill("two");
      await expect(rows).toHaveCount(1);
      await shot("id");
    }
    console.log("Find layers: all assertions passed");
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
