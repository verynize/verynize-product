const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
(async () => {
  const profile = await fs.mkdtemp(`${os.tmpdir()}/verynize-tiles-`);
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await waitForUiReady(page);
    await page.evaluate(() => {
      window.fileLibrary.showEditor();
      window.design.setCamera(0, 0, 0.2);
    });
    assert.equal(await page.evaluate(() => typeof window.canvasTiles), "undefined");
    assert.equal(await page.locator("#canvas-tiles").count(), 0);
    await page.evaluate(() => localStorage.setItem("verynize.canvasTiles", "1"));
    await page.reload();
    await waitForUiReady(page);
    await page.evaluate(() => {
      window.fileLibrary.showEditor();
      window.design.loadDocument({
        version: 2,
        name: "Tiles",
        activePage: "p",
        tokens: {},
        pages: [
          {
            id: "p",
            name: "p",
            nodes: [
              {
                id: "text",
                type: "text",
                name: "Text",
                x: 80,
                y: 700,
                w: 600,
                h: 100,
                fontSize: 20,
                text: "Overview text wraps across words",
                color: "#aabbcc",
              },
              {
                id: "image",
                type: "image",
                name: "Image",
                x: 1000,
                y: 700,
                w: 300,
                h: 200,
                src:
                  "data:image/svg+xml;base64," +
                  btoa(
                    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#91b3d5"/></svg>',
                  ),
              },
              {
                id: "frame",
                type: "frame",
                name: "Frame",
                x: 1500,
                y: 50,
                w: 800,
                h: 600,
                layout: "flex",
                color: "#ffffff",
                padding: 20,
                gap: 20,
                clipContent: true,
              },
              {
                id: "child",
                parentId: "frame",
                type: "rectangle",
                name: "Flow",
                x: 0,
                y: 0,
                w: 300,
                h: 200,
                color: "#7799bb",
                opacity: 70,
              },

              {
                id: "a",
                type: "rectangle",
                name: "A",
                x: 50,
                y: 50,
                w: 800,
                h: 600,
                color: "#cc4422",
                radius: 12,
              },
              {
                id: "b",
                type: "rectangle",
                name: "B",
                x: 4000,
                y: 50,
                w: 800,
                h: 600,
                color: "#22cc44",
              },
            ],
          },
        ],
      });
      window.design.setCamera(0, 0, 1);
      window.design.setCamera(0, 0, 0.2);
      window.tileKeep = setInterval(() => window.canvasTiles.camera(window.design.getCamera()), 30);
    });
    await page.waitForFunction(() => window.canvasTiles.stats().exact > 0.999);
    assert.equal(
      await page.locator("#canvas").evaluate((el) => el.classList.contains("tile-overview")),
      true,
    );
    const clip = await page.locator("#canvas-wrap").boundingBox();
    const tiled = await page.screenshot({ clip });
    await page.evaluate(() => {
      clearInterval(window.tileKeep);
    });
    await page.waitForFunction(() => !window.canvasTiles.stats().active);
    assert.equal(
      await page.locator("#canvas").evaluate((el) => el.classList.contains("tile-overview")),
      false,
    );
    const dom = await page.screenshot({ clip });
    await fs.mkdir("eval/canvas-perf/results/fix-4", { recursive: true });
    await fs.writeFile("eval/canvas-perf/results/fix-4/tiles.png", tiled);
    await fs.writeFile("eval/canvas-perf/results/fix-4/dom.png", dom);
    // Electron decodes both PNGs, avoiding a second image library. Compare RGB at
    // overview scale: at most 2% pixels may differ by more than 24/255 per channel.
    const diff = await app.evaluate(
      ({ nativeImage }, { a, b }) => {
        const aa = nativeImage.createFromBuffer(Buffer.from(a)).toBitmap(),
          bb = nativeImage.createFromBuffer(Buffer.from(b)).toBitmap();
        let changed = 0;
        for (let i = 0; i < aa.length; i += 4)
          if (Math.max(...[0, 1, 2].map((c) => Math.abs(aa[i + c] - bb[i + c]))) > 24) changed++;
        return changed / (aa.length / 4);
      },
      { a: [...tiled], b: [...dom] },
    );
    assert.ok(diff < 0.02, `overview diff ${diff}`);
    const damage = await page.evaluate(() => {
      const before = window.canvasTiles.stats();
      window.design.updateNodes(["a"], { color: "#2244cc" });
      const after = window.canvasTiles.stats();
      return {
        removed: after.invalidated - before.invalidated,
        before: before.tiles,
        after: after.tiles,
      };
    });
    assert.ok(damage.removed > 0 && damage.removed < damage.before, JSON.stringify(damage));
    await page.evaluate(() => window.design.setCamera(0, 0, 1));
    assert.equal(await page.evaluate(() => window.canvasTiles.stats().active), false);
    await page.evaluate(() => {
      window.design.setSelection(["text"]);
      window.design.setCamera(0, 0, 0.18);
    });
    await page.waitForFunction(() => !window.canvasTiles.stats().active);
    assert.equal(
      await page.locator("#canvas .selected").evaluate((el) => getComputedStyle(el).opacity),
      "1",
    );
    await page.evaluate(() => {
      window.design.setSelection([]);
      const frame = document.createElement("iframe");
      frame.id = "test-live-frame";
      document.querySelector("#canvas").append(frame);
      window.design.setCamera(0, 0, 0.16);
    });
    await page.waitForFunction(() => !window.canvasTiles.stats().active);
    await page.evaluate(() => document.querySelector("#test-live-frame").remove());
    console.log(
      `PASS tiles: disabled path, overview, settle, local damage, overview RGB diff ${(diff * 100).toFixed(3)}%`,
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
