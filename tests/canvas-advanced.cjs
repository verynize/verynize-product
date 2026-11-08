const { _electron } = require(process.cwd() + "/node_modules/@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
(async () => {
  const profile = await fs.mkdtemp(os.tmpdir() + "/bd-advanced-"),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    timeout: 20000,
    env,
    args: [".", `--user-data-dir=${profile}`],
  });
  try {
    const p = await app.firstWindow({ timeout: 15000 });
    await waitForUiReady(p);
    await p.waitForSelector("#canvas .layer");
    await p.locator("#add-page").click();
    assert.equal(await p.locator("#canvas .layer").count(), 0);
    await p.evaluate(() => window.design.runCommand("insert.frame"));
    await p.locator(".insp-display [data-layout=flex]").click();
    await p.locator(".app-menu-trigger:visible").first().click();
    await p.locator("#rectangle").click();
    let d = await p.evaluate(() => window.design.getDocument());
    assert.equal(d.pages[1].nodes[1].parentId, d.pages[1].nodes[0].id);
    assert.equal(
      await p.locator("#canvas .frame-layer").evaluate((e) => getComputedStyle(e).display),
      "flex",
    );
    await p.evaluate(() => {
      const d = window.design.getDocument();
      d.tokens.brand = "#ff0000";
      d.pages[1].nodes[1].token = "brand";
      window.design.setDocument(d);
    });
    assert.equal(
      await p
        .locator("#canvas .frame-layer .layer")
        .evaluate((e) => getComputedStyle(e).backgroundColor),
      "rgb(255, 0, 0)",
    );
    const beforeZoom = parseInt(await p.locator("#zoom-reset").textContent());
    await p.locator("#zoom-menu-button").click();
    await p.locator("#zoom-in").click();
    assert.equal(
      parseInt(await p.locator("#zoom-reset").textContent()),
      [5, 10, 25, 50, 100, 200, 400, 800, 1600, 3200].find((stop) => stop > beforeZoom),
    );
    assert.equal(
      await p.evaluate(() => {
        const d = window.design.getDocument();
        d.pages[1].nodes[0].parentId = d.pages[1].nodes[0].id;
        try {
          window.design.setDocument(d);
          return false;
        } catch {
          return true;
        }
      }),
      true,
    );
    await p.evaluate(() =>
      window.design.importHTML(
        '<div style="display:grid;gap:20px;width:400px"><p>Nested</p></div>',
      ),
    );
    assert.equal(await p.locator("#canvas .frame-layer").count(), 2);
    await p.reload();
    await waitForUiReady(p);
    await p.waitForSelector("#canvas .layer");
    assert.equal(await p.locator("#canvas .frame-layer").count(), 2);
    await p.evaluate(() => window.design.addNode("text", { text: "Your next idea" }));
    await p.locator("#canvas .selected").dblclick();
    await p.locator("#canvas [data-text-editing]").waitFor();
    await p.evaluate(() => {
      const t = document.querySelector("#canvas [data-text-editing] span").firstChild,
        r = document.createRange();
      r.setStart(t, 0);
      r.setEnd(t, 4);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    await p.keyboard.press("ControlOrMeta+b");
    await p.keyboard.press("Escape");
    await p.locator("#canvas [data-text-editing]").waitFor({ state: "detached" });
    const editedId = await p.locator("#canvas .selected").getAttribute("data-id");
    assert.deepEqual(
      await p.evaluate(
        (id) =>
          window.design
            .getDocument()
            .pages.flatMap((x) => x.nodes)
            .find((x) => x.id === id).textRuns,
        editedId,
      ),
      [{ start: 0, end: 4, bold: true, italic: false }],
    );
    assert.equal(
      await p
        .locator("#canvas .selected span")
        .first()
        .evaluate((e) => e.style.fontWeight),
      "700",
    );
    await p.locator(".app-menu-trigger:visible").first().click();
    await p.locator("#rectangle").click();
    await p.evaluate(() =>
      window.design.updateNodes([...window.design.getSelection()], { animated: "aurora" }),
    );
    assert.ok(
      (await p.locator("#canvas .selected").evaluate((e) => e.style.animation)).includes(
        "design-gradient",
      ),
    );
    await p.locator("#fill-section [name=animated]").selectOption("sunset");
    assert.ok(
      (await p.locator("#canvas .selected").evaluate((e) => e.style.backgroundImage)).includes(
        "linear-gradient",
      ),
    );
    await p.locator("#fill-section [data-shader-mode]").click();
    assert.equal(
      await p.locator("#fill-section [data-shader-mode]").getAttribute("aria-pressed"),
      "true",
    );
    await p.locator("#canvas .selected > canvas.shader-surface").waitFor({ state: "attached" });
    assert.equal(await p.locator("#fill-section [name=animated]").count(), 0);
    await p.locator("#fill-section [data-shader-mode]").click();
    assert.equal(await p.locator("#canvas .selected > canvas.shader-surface").count(), 0);
    await p.locator("#mask-section .insp-add").click();
    await p.locator('[data-mask-editor="0"] [data-mask-type="custom"]').click();
    await p.locator("[name=mask-0-css]").fill("radial-gradient(black, transparent)");
    await p.locator("[name=mask-0-css]").press("Tab");
    assert.equal(await p.locator("[name=mask]").count(), 0);
    assert.ok(
      (await p.locator("#canvas .selected").evaluate((e) => e.style.maskImage)).includes(
        "radial-gradient(black, transparent)",
      ),
    );
    assert.ok(
      (await p.evaluate(() => window.design.exportHTML())).includes("@keyframes design-gradient"),
    );
    await p.locator(".app-menu-trigger:visible").first().click();
    await p.locator("#icon-kind").selectOption("heart");
    await p.locator(".app-menu-trigger:visible").first().click();
    await p.locator("#add-icon").click();
    assert.equal(await p.locator("#canvas .selected img").count(), 1);
    await p.locator(".app-menu-trigger:visible").first().click();
    await p.locator("#import-tokens").click();
    await p
      .locator("#text-prompt-input")
      .fill(":root { --accent: #ff8800; --muted: rgb(100, 100, 100); }");
    await p.locator("#text-prompt-ok").click();
    await p.waitForFunction(() => window.design.getDocument().tokens.accent);
    assert.equal(await p.evaluate(() => window.design.getDocument().tokens.accent), "#ff8800");
    await p.locator("#add-token").click();
    await p.locator("#add-color-token").click();
    await p.locator("#text-prompt-input").fill("secondary");
    await p.locator("#text-prompt-ok").click();
    await p.waitForFunction(() => window.design.getDocument().tokens.secondary);
    assert.equal(await p.evaluate(() => window.design.getDocument().tokens.secondary), "#a58bdd");
    await p.locator(".app-menu-trigger:visible").first().click();
    await p.locator("#rename-page").click();
    await p.locator('#bd-page-list input[aria-label="Page name"]').fill("Landing");
    await p.keyboard.press("Enter");
    await p.waitForFunction(() =>
      document.querySelector("#page-title").textContent.startsWith("LANDING"),
    );
    assert.equal(await p.locator("#page-title").textContent(), "LANDING · 1000 × 700");
    console.log(
      "PASS advanced: pages, nested frames, flex, token bindings, zoom, cycle rejection, nested HTML import, reload, mixed text ranges, animated gradient, shader mode, mask, SVG palette, CSS variables",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
