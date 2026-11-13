const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  http = require("node:http");
const { mod } = require("./helpers/keys.cjs");
(async () => {
  let loads = 0;
  const server = http.createServer((req, res) => {
    if (req.url === "/") {
      loads++;
      res.setHeader("content-type", "text/html");
      res.end(
        '<html><body style="margin:0"><p id="message">Before interaction</p><button id="change" onclick="document.getElementById(\'message\').textContent=\'After interaction\'">Change</button><input id="typed" value="original"><input id="secret" type="password" value="never-capture-this"></body></html>',
      );
    } else res.end("");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "capture-live-")),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${dir}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await page.waitForFunction(() => !!window.livePreview);
    await page.evaluate(
      (url) => window.livePreview.show(url),
      `http://127.0.0.1:${server.address().port}/`,
    );
    await page.frameLocator("#live-frame").locator("#message").waitFor();
    const beforeTab = loads;
    await page.locator("#live-expand").click();
    await page.waitForFunction(() => window.previewTab?.list().length === 1);
    for (let i = 0; loads === beforeTab && i < 100; i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.equal(loads, beforeTab + 1, "the preview tab loads the app in its own page");
    await page.evaluate(() => {
      const id = window.previewTab.list()[0].frameId;
      window.previewTab.showOnCanvas(id);
      window.previewTab.close(id);
    });
    loads = beforeTab;
    assert.equal(
      await page.locator("#canvas-wrap").evaluate((el) => getComputedStyle(el).visibility),
      "visible",
    );
    await page.locator("#preview-navigate").click();
    const frame = page.frameLocator("#live-frame");
    const bounds = await page.locator("#live-frame").boundingBox();
    const target = await frame.locator("#change").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const scale = await page
      .locator("#live-frame")
      .evaluate((el) => el.getBoundingClientRect().width / el.clientWidth);
    await page.mouse.click(bounds.x + target.x * scale, bounds.y + target.y * scale);
    await frame.locator("#typed").fill("User typed current value");
    const inspected = await page.evaluate(() =>
      window.desktop.previewInspect({ selector: "#message" }),
    );
    assert.equal(inspected.text, "After interaction");
    await page.evaluate(() =>
      window.desktop.previewEdit({
        selector: "#message",
        text: "Edited in preview",
        styles: { color: "rgb(255, 0, 0)" },
      }),
    );
    assert.equal(await frame.locator("#message").textContent(), "Edited in preview");
    await page.evaluate(() => window.desktop.previewEdit({ undo: true }));
    assert.equal(await frame.locator("#message").textContent(), "After interaction");
    const blockedEdit = await page.evaluate(async () => {
      try {
        await window.desktop.previewEdit({ selector: "#secret", text: "unsafe" });
      } catch (e) {
        return e.message;
      }
    });
    assert.match(blockedEdit, /text or layout/);
    await page.evaluate(() => window.design.setSelection([window.livePreview.getNodeId()]));
    await page.locator("#live-capture").click();
    await page.locator("#live-capture[aria-pressed=true]").waitFor();
    await page.keyboard.press(mod("Enter"));
    await page.waitForFunction(() =>
      window.design
        .getDocument()
        .pages.some((p) => p.nodes.some((n) => n.text === "After interaction")),
    );
    const text = await page.evaluate(() => JSON.stringify(window.design.getDocument()));
    assert.match(text, /After interaction/);
    assert.match(text, /User typed current value/);
    assert.doesNotMatch(text, /Before interaction|never-capture-this/);
    assert.equal(loads, 1);
    const savedPreview = await page.evaluate(() => {
      const n = window.design
        .getDocument()
        .pages.flatMap((p) => p.nodes)
        .find((n) => n.preview);
      window.design.updateNodes([n.id], { x: n.x + 25, w: 1100 });
      return window.design
        .getDocument()
        .pages.flatMap((p) => p.nodes)
        .find((n) => n.preview);
    });
    assert.equal(savedPreview.w, 1100);
    assert.match(savedPreview.preview.url, /127\.0\.0\.1/);
    const { validateDocument } = await import("../integrations/design-store.mjs");
    const persisted = await page.evaluate(() => window.design.getDocument());
    assert.deepEqual(
      validateDocument(JSON.parse(JSON.stringify(persisted)))
        .pages.flatMap((p) => p.nodes)
        .find((n) => n.preview).preview,
      savedPreview.preview,
    );
    assert.equal(loads, 1, "canvas updates retain iframe without reload");
    await page.evaluate(() => {
      const n = window.design
        .getDocument()
        .pages.flatMap((p) => p.nodes)
        .find((n) => n.preview);
      window.design.updateNodes([n.id], { preview: { ...n.preview, chatId: "different-chat" } });
    });
    assert.equal(
      await page.locator("#live-frame").getAttribute("src"),
      null,
      "reused node ID with different chat clears the old app",
    );
    assert.equal(await page.locator("#live-preview").getAttribute("data-preview-state"), "paused");
    assert.equal(await page.locator("#live-preview").isVisible(), true);
    const rejected = await page.evaluate(async () => {
      try {
        await window.desktop.captureLivePreview({ url: "https://example.com" });
      } catch (e) {
        return e.message;
      }
    });
    assert.match(rejected, /localhost/);
    await page.reload();
    await page.waitForFunction(() => !!document.querySelector(".canvas-preview"));
    const reopened = await page.evaluate(() =>
      window.design
        .getDocument()
        .pages.flatMap((p) => p.nodes)
        .find((n) => n.preview),
    );
    assert.equal(reopened.w, 1100);
    assert.equal(reopened.x, savedPreview.x);
    assert.equal(
      await page.locator(".canvas-preview").getAttribute("data-preview-state"),
      "paused",
    );
    assert.equal(await page.locator(".canvas-preview iframe").getAttribute("src"), null);
    assert.equal(loads, 1, "reopening never starts the app automatically");
    console.log(
      "PASS current iframe interaction/input state captured without URL reload, password masking and origin validation",
    );
  } finally {
    await app.close();
    await new Promise((r) => server.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
