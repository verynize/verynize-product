const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
(async () => {
  const profile = await fs.mkdtemp(`${os.tmpdir()}/verynize-test-`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await waitForUiReady(page);
    await page.waitForSelector("#canvas .layer");
    const count = () => page.locator("#canvas .layer").count();
    assert.equal(await count(), 3);
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.locator("#rectangle").click();
    assert.equal(await count(), 4);
    await page.locator('[name="w"]').fill("333");
    await page.locator('[name="w"]').press("Tab");
    assert.equal(await page.locator("#canvas .selected").evaluate((e) => e.style.width), "333px");
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.locator("#undo").click();
    assert.equal(await page.locator("#canvas .selected").evaluate((e) => e.style.width), "250px");
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.locator("#redo").click();
    await page.reload();
    await waitForUiReady(page);
    await page.waitForSelector("#canvas .layer");
    assert.equal(await count(), 4);
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.locator("#preview").click();
    assert.equal(await page.locator("#frame").getAttribute("sandbox"), "");
    await page.locator("#close").click();
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.locator("#import").click();
    await page
      .locator("#source")
      .fill(
        '<div style="position:absolute;left:12px;top:24px;color:#ff0000">Imported text</div><script>window.compromised=true</script>',
      );
    await page.locator("#apply").click();
    // The desktop importer (codec-html via IPC) is asynchronous: wait for the dialog to close.
    await page.waitForFunction(() => !document.getElementById("modal"), null, { timeout: 15000 });
    assert.equal(await count(), 5);
    assert.equal(
      await page.locator("#canvas .selected").evaluate((e) => e.textContent.replace(/\s+$/, "")),
      "Imported text",
    );
    assert.equal(await page.evaluate(() => window.compromised), undefined);
    assert.equal(await page.evaluate(() => typeof require), "undefined");
    console.log(
      "PASS: creation, inspector, undo/redo, persistence, sandbox preview, inert import, renderer isolation",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
