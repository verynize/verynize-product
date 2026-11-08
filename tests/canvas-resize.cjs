const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-resize-")),
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
    await moveOffCursor(app);
    await page.waitForSelector("#canvas .layer");
    async function seed(rotation = 0) {
      await page.evaluate((rotation) => {
        const d = window.design.getDocument();
        d.pages[0].nodes = [
          {
            id: "resize",
            name: "Resize card",
            type: "rectangle",
            x: 220,
            y: 180,
            w: 160,
            h: 100,
            color: "#8844cc",
            rotation,
          },
        ];
        window.design.setDocument(d);
        window.design.setSelection(["resize"]);
      }, rotation);
    }
    async function drag(corner, dx, dy) {
      const grip = page.locator(`#canvas [data-id=resize]>.handle[data-corner=${corner}]`),
        b = await grip.boundingBox(),
        zoom = await page.evaluate(() => window.design.getView().zoom);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + dx * zoom, b.y + b.height / 2 + dy * zoom);
      await page.mouse.up();
      return page.evaluate(() => window.design.getDocument().pages[0].nodes[0]);
    }
    const near = (actual, expected) =>
      assert.ok(Math.abs(actual - expected) < 1.5, `${actual} ~= ${expected}`);
    for (const corner of ["nw", "ne", "sw", "se"]) {
      await seed();
      assert.equal(await page.locator("#canvas .handle").count(), 4);
      assert.equal(await page.locator("#selection-name").textContent(), "Resize card");
      const west = corner.includes("w"),
        north = corner.includes("n"),
        n = await drag(corner, west ? -20 : 20, north ? -10 : 10);
      near(n.w, 180);
      near(n.h, 110);
      near(n.x, west ? 200 : 220);
      near(n.y, north ? 170 : 180);
    }
    await seed(30);
    const a = Math.PI / 6,
      n = await drag(
        "se",
        20 * Math.cos(a) - 10 * Math.sin(a),
        20 * Math.sin(a) + 10 * Math.cos(a),
      );
    near(n.w, 180);
    near(n.h, 110);
    near(n.x, 220 + (20 * Math.cos(a) - 10 * Math.sin(a) - 20) / 2);
    near(n.y, 180 + (20 * Math.sin(a) + 10 * Math.cos(a) - 10) / 2);
    await seed();
    const small = await drag("nw", 155, 95);
    near(small.w, 10);
    near(small.h, 10);
    near(small.x, 370);
    near(small.y, 270);
    console.log(
      "PASS four resize corners, fixed opposite corner, rotated geometry, minimum dimensions, selection name",
    );
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
