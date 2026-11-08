const { testElectronArgs } = require("./helpers/electron-args.cjs");
const { _electron } = require("@playwright/test");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "better-packaged-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    executablePath: path.resolve("dist/Verynize.app/Contents/MacOS/Electron"),
    args: testElectronArgs([`--user-data-dir=${root}`]),
    env,
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await page.waitForSelector("#canvas .layer");
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), "0.6.0");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.resolve("dist/verynize-editor.png") });
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.locator("#rectangle").click();
    assert.equal(await page.locator("#canvas .layer").count(), 4);
    assert.equal(await page.locator("#generate-art").count(), 0);
    assert.equal(await page.locator("#figma-import").count(), 1);
    const target = path.join(root, "packaged.verynize.json");
    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, target);
    const saved = await page.evaluate(() =>
      window.desktop.designSave({ document: window.design.getDocument() }),
    );
    assert.equal(saved.document.version, 2);
    assert.equal(JSON.parse(await fs.readFile(target, "utf8")).pages[0].nodes.length, 4);
    console.log(
      "PASS packaged macOS app launch, canvas editing, native design save, generation/Figma controls",
    );
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
