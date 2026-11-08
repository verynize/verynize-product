// Real Electron with an intentionally unreachable keychain, without Playwright's
// mock-keychain loader. All storage operations retain their production behavior.
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");

(async () => {
  if (process.platform !== "darwin") {
    console.log("SKIP keychain startup: macOS only");
    return;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-keychain-"));
  const home = path.join(dir, "home");
  const profile = path.join(dir, "profile");
  await fs.mkdir(home);
  const env = {
    ...process.env,
    HOME: home,
    VERYNIZE_SKIP_ONBOARDING: "1",
    VERYNIZE_DISABLE_USAGE_PROBES: "1",
    VERYNIZE_BLOCK_PRODUCTION_CLOUD: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const diagnostics = () =>
    app.evaluate(() => {
      const require = process
        .getBuiltinModule("module")
        .createRequire(process.cwd() + "/package.json");
      return require("./desktop/secure-storage.cjs").secureStorageDiagnostics();
    });
  try {
    // Deliberate exception to testElectronArgs: this test proves the product HOME
    // guard works without a mock keychain. Never use a real user's HOME here.
    app = await _electron.launch({
      executablePath: require("electron"),
      env,
      args: [".", `--user-data-dir=${profile}`],
      timeout: 20000,
    });
    const page = await app.firstWindow({ timeout: 20000 });
    await waitForUiReady(page);
    assert.equal(
      await app.evaluate(({ app }) => app.commandLine.hasSwitch("use-mock-keychain")),
      false,
    );
    assert.deepEqual(await diagnostics(), { availabilityChecks: 0, keychainReachable: false });
    await page.evaluate(() => window.appSettings.open("preferences"));
    await page.locator("#settings-image-provider:not([disabled])").waitFor();
    const initial = await page.evaluate(() => window.desktop.imageProvider.get());
    assert.equal(initial.secureStorage, null);
    assert.equal(initial.keyStorage, "none");
    assert.equal(
      (await page.evaluate(() => window.desktop.figmaOAuth.status())).secureStorage,
      null,
    );
    await page.evaluate(() => window.appSettings.close());
    // The app opens on Home, where the editor's app menu is hidden; click the menu command directly.
    await page.evaluate(() => document.getElementById("figma-import").click());
    await page.locator("#figma-dialog").waitFor({ state: "visible" });
    await page.evaluate(() => window.desktop.figmaOAuth.status());
    const saved = await page.evaluate(() =>
      window.desktop.imageProvider.set({ apiKey: "fixture-session-secret" }),
    );
    assert.equal(saved.secureStorage, false);
    assert.equal(saved.keyStorage, "session");
    assert.doesNotMatch(
      await fs.readFile(path.join(profile, "image-provider.json"), "utf8"),
      /fixture-session-secret/,
    );
    await assert.rejects(
      page.evaluate(() =>
        window.desktop.figmaOAuth.configure({
          clientId: "fixture-client",
          clientSecret: "fixture-secret",
        }),
      ),
      /Secure storage is unavailable/,
    );
    // Existing ciphertext also cannot trigger decryption in a redirected HOME.
    await fs.writeFile(
      path.join(profile, "figma-oauth.json"),
      JSON.stringify({ sealed: "fixture-ciphertext" }),
    );
    const figma = await page.evaluate(() => window.desktop.figmaOAuth.status());
    assert.equal(figma.connected, false);
    assert.equal(figma.secureStorage, false);
    assert.deepEqual(await diagnostics(), { availabilityChecks: 0, keychainReachable: false });
    console.log(
      "PASS launch, Preferences and Figma never probe the keychain under redirected HOME; image keys stay in session memory",
    );
  } finally {
    if (app) await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
