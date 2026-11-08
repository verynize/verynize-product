const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  http = require("node:http");
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "preview-interaction-"));
  const server = http.createServer((_q, r) => {
    r.setHeader("content-type", "text/html");
    r.end(
      '<body style="margin:0;height:3000px"><button style="width:180px;height:80px" onclick="window.clicks=(window.clicks||0)+1">App action</button></body>',
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({ env, args: [".", `--user-data-dir=${dir}`] });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.livePreview);
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.evaluate((url) => window.livePreview.show(url), url);
    const frame = page.frames().find((f) => f.name() === "verynize-live-preview");
    await frame.waitForSelector("button");
    const position = () =>
      page.evaluate(() => {
        const n = window.design
          .getDocument()
          .pages.flatMap((p) => p.nodes)
          .find((n) => n.preview);
        return { x: n.x, y: n.y };
      });
    const point = () =>
      page.locator("#live-frame").evaluate((el) => {
        const r = el.getBoundingClientRect(),
          s = r.width / el.clientWidth;
        return { x: r.x + 90 * s, y: r.y + 40 * s };
      });
    let p = await point();
    assert.equal(await page.locator("#preview-navigate").getAttribute("aria-pressed"), "false");
    await page.mouse.click(p.x, p.y);
    assert.equal(
      await frame.evaluate(() => window.clicks || 0),
      0,
      "selection must not click the app",
    );
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(150);
    assert.equal(await frame.evaluate(() => scrollY), 0, "scroll is blocked until Navigate");
    await page.evaluate((url) => window.livePreview.show(url), url);
    await page.locator("#preview-navigate").click();
    // Navigate turns the cross-origin iframe's pointer-events on; Chromium routes clicks to it only after the next
    // painted frame, so wait for the mode and two frames before clicking (a click in the same frame hits the editor).
    await page.waitForFunction(
      () =>
        document.getElementById("preview-navigate")?.getAttribute("aria-pressed") === "true" &&
        getComputedStyle(document.getElementById("live-frame")).pointerEvents === "auto",
    );
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    p = await point();
    await page.mouse.click(p.x, p.y);
    assert.equal(await frame.evaluate(() => window.clicks), 1);
    await page.mouse.wheel(0, 250);
    await frame.waitForFunction(() => scrollY > 0);
    const wrap = await page.locator("#canvas-wrap").boundingBox();
    await page.mouse.click(wrap.x + 10, wrap.y + 10);
    assert.equal(await page.locator("#preview-toolbar").count(), 0);
    p = await point();
    const before = await position();
    await page.mouse.click(p.x, p.y);
    await page.mouse.move(p.x + 65, p.y + 45);
    assert.deepEqual(await position(), before, "reselect then move without holding must not drag");
    assert.equal(
      await page.locator("#preview-navigate").getAttribute("aria-pressed"),
      "false",
      "deselection resets Navigate",
    );
    assert.equal(
      await page.locator("#live-frame").evaluate((el) => getComputedStyle(el).pointerEvents),
      "none",
    );
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 60, p.y + 35, { steps: 5 });
    await page.mouse.up();
    const moved = await position();
    assert.notDeepEqual(moved, before, "held left button moves the frame");
    await page.mouse.move(p.x + 110, p.y + 70);
    assert.deepEqual(await position(), moved, "release ends drag");
    console.log(
      "PASS preview interaction: explicit Navigate, blocked click/scroll, deselect/reset, single-click reselect and held-button-only drag",
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
