const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "better-ipc-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  let app;
  try {
    app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.desktop);
    assert.equal(await page.evaluate(() => typeof require), "undefined");
    const result = await page.evaluate(() => window.desktop.discoverAgents());
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((a) => a.id),
      ["codex", "claude"],
    );
    assert.match(
      await page.evaluate(async () => {
        try {
          await window.desktop.readFile("test");
          return "unexpected";
        } catch (e) {
          return e.message;
        }
      }),
      /Open a project folder first/,
    );
    console.log(
      "PASS desktop preload, agent discovery, no-project rejection and renderer isolation",
    );
  } finally {
    if (app) await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
