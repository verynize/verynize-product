const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { checkHomeOpening } = require("./helpers/home-first-opening.cjs");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "home-first-opening-"));
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const launch = async () => {
    app = await _electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
    const page = await app.firstWindow();
    await waitForUiReady(page);
    await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
    return page;
  };
  const shot = async (page, name) => {
    if (!process.env.VERYNIZE_SCREENSHOTS) return;
    await fs.mkdir(process.env.VERYNIZE_SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.VERYNIZE_SCREENSHOTS, name + ".png") });
  };
  try {
    let page = await launch();
    assert.equal(new URL(page.url()).pathname, "/");
    assert.equal(await page.locator("#file-home").isVisible(), true);
    await shot(page, "home-first-launch");
    const id = await checkHomeOpening(page);
    await page.waitForFunction(() => !document.body.dataset.switchLoading);
    await shot(page, "home-opened-document");
    await app.close();
    page = await launch();
    assert.equal(
      new URL(page.url()).pathname,
      "/",
      "relaunch with an active file still opens Home",
    );
    await page.goto(`app://verynize/editor/${id}`);
    await waitForUiReady(page);
    await page.waitForFunction(() => !document.body.classList.contains("files-view"));
    assert.equal(await page.evaluate(() => window.design.getDocument().name), "Opening fixture");
    await page.goto("app://verynize/editor");
    await waitForUiReady(page);
    await page.waitForFunction((id) => location.pathname === `/editor/${id}`, id);
    console.log(
      "PASS Home-first fresh/relaunch, explicit editor URLs, immediate centered logo before local document",
    );
  } finally {
    await app?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
