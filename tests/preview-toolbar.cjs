const { _electron } = require("@playwright/test");
const { mod } = require("./helpers/keys.cjs");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "preview-toolbar-"));
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(
      '<h1>Toolbar capture</h1><input aria-label="App input" value="hello"><script>window.receivedKeys=[];document.addEventListener("keydown",event=>window.receivedKeys.push(event.key));</script>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await waitForUiReady(page);
    await page.waitForFunction(() => !!window.livePreview?.getSelectionState);
    await page.evaluate(
      (url) => window.livePreview.show(url),
      `http://127.0.0.1:${server.address().port}/`,
    );
    const toolbar = page.locator("#preview-toolbar");
    await toolbar.waitFor();
    const before = await toolbar.boundingBox(),
      main = await page.locator("#canvas-toolbar").boundingBox();
    assert.ok(before.y + before.height < main.y, "preview actions are above canvas toolbar");
    await page.evaluate(() => {
      const camera = window.design.getCamera();
      window.design.setCamera(camera.x, camera.y, 0.35);
    });
    const after = await toolbar.boundingBox();
    assert.ok(
      Math.abs(before.width - after.width) < 1 && Math.abs(before.y - after.y) < 1,
      "toolbar stays in screen space across zoom",
    );
    await page.locator("#preview-edit").click();
    await page.locator("#preview-edit[aria-pressed=true]").waitFor();
    await page.locator("#preview-navigate").click();
    assert.equal(await page.locator("#preview-navigate").getAttribute("aria-pressed"), "true");
    await page.locator("#preview-more").click();
    await page.getByRole("menuitemcheckbox", { name: "Send all input to app" }).waitFor();
    assert.equal(await page.getByRole("menuitem", { name: "Open in browser" }).isEnabled(), true);
    const menu = await page.locator("#preview-options-menu").boundingBox();
    assert.ok(menu.y + menu.height <= after.y, "overflow menu opens upward");
    await page.screenshot({ path: "/tmp/verynize-preview-toolbar.png" });
    await page.keyboard.press("Escape");
    await page.locator("#preview-options-menu").waitFor({ state: "hidden" });
    await page.waitForFunction(
      () => document.getElementById("preview-more") === document.activeElement,
    );
    await page.locator("#preview-more").click();
    await page.getByRole("menuitemcheckbox", { name: "Send all input to app" }).click();
    await page.waitForFunction(() => window.livePreview.getSelectionState()?.inputToApp === true);
    await page.locator("#preview-options-menu").waitFor({ state: "hidden" });
    const frame = page.frames().find((frame) => frame.name() === "verynize-live-preview");
    assert.ok(frame);
    await page.keyboard.press("q");
    await frame.waitForFunction(() => window.receivedKeys.includes("q"));
    await page.keyboard.press(mod("Shift+Escape"));
    await page.waitForFunction(() => window.livePreview.getSelectionState()?.inputToApp === false);
    await page.locator("#live-capture").click();
    await page.locator("#live-capture[aria-pressed=true]").waitFor();
    await page.keyboard.press(mod("Enter"));
    await page.waitForFunction(() =>
      window.design
        .getDocument()
        .pages.some((p) => p.nodes.some((n) => n.text === "Toolbar capture")),
    );
    await page.evaluate(() => window.design.setSelection([]));
    await toolbar.waitFor({ state: "hidden" });
    const pausedId = await page.evaluate(() =>
      window.livePreview.ensure({
        root: "",
        chatId: "single-click-paused",
        name: "Paused selection",
      }),
    );
    await page.evaluate(() => window.design.setSelection([]));
    const placeholder = page.locator(`[data-id="${pausedId}"] .preview-setup-card`);
    await placeholder.locator("strong").click();
    assert.deepEqual(
      await page.evaluate(() => window.design.getSelection()),
      [pausedId],
      "one click on paused content selects preview",
    );
    await toolbar.waitFor();
    console.log(
      "PASS preview toolbar: selected-only, fixed placement, zoom independence, modes, menu keyboard/focus, input forwarding and capture",
    );
  } finally {
    await app.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
