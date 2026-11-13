// Finding large imported-style sections must not change the apparent page background. A result that fits the
// view gets a uniform light dim (no edge); a result larger than the view gets the outline only.
const { _electron, expect } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "find-background-"));
  const output = process.env.BACKGROUND_SCREENSHOTS || profile;
  await fs.mkdir(output, { recursive: true });
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1", VERYNIZE_LAUNCH_EDITOR: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${profile}`, "--force-device-scale-factor=1"],
  });
  try {
    const page = await app.firstWindow();
    await waitForUiReady(page);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 870),
    );
    await page.evaluate(() => {
      const nodes = [];
      for (let i = 0; i < 7; i++) {
        const id = `section-${i}`;
        nodes.push({
          id,
          type: "frame",
          name: `Section ${i}`,
          // Stay within ±100,000 so the far-from-origin advisory does not cover sampled pixels.
          x: [0, 45000, -45000][i % 3],
          y: [0, 35000, -35000][Math.floor(i / 3)],
          w: 40000,
          h: 30000,
          color: "transparent",
          layout: "free",
        });
        for (let j = 0; j < 40; j++) {
          nodes.push({
            id: `${id}-screen-${j}`,
            parentId: id,
            type: "frame",
            name: i === 0 && j === 1 ? "Focus screen" : `Screen ${i} ${j}`,
            x: (j % 10) * 3000,
            y: Math.floor(j / 10) * 5000,
            w: 1440,
            h: 3000,
            color: "#ffffff",
            layout: "free",
          });
        }
      }
      window.design.setDocument({
        version: 2,
        name: "Synthetic Spaces",
        activePage: "page",
        tokens: {},
        pages: [{ id: "page", name: "Spaces", background: "#2b2b2b", nodes }],
      });
      window.design.setSelection([]);
    });
    const input = page.locator("#find-layers-input");
    const spotlight = page.locator("#find-layers-spotlight");
    async function background(name, points, expected = [43, 43, 43]) {
      // Wait for camera/spotlight animation frames, then read actual composited pixels.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const file = path.join(output, `${name}.png`);
      await page.screenshot({ path: file });
      const pixels = await app.evaluate(
        ({ nativeImage }, { file, points }) => {
          const image = nativeImage.createFromPath(file);
          const { width } = image.getSize();
          const bitmap = image.toBitmap();
          return points.map(([x, y]) => {
            const offset = (y * width + x) * 4;
            return [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]];
          });
        },
        { file, points },
      );
      for (let i = 0; i < points.length; i++) {
        assert.ok(
          pixels[i].every((v, c) => Math.abs(v - expected[c]) <= 1),
          `${name} at ${points[i].join(",")}: rgb(${pixels[i].join(",")}) != rgb(${expected.join(",")}) (${file})`,
        );
      }
      console.log(
        `${name}: ${points.length} background samples = rgb(${expected.join(",")}); ${file}`,
      );
    }
    await page.locator("#find-layers-button").click();
    await input.fill("Section 0");
    await expect(spotlight).toBeVisible();
    await page.evaluate(() => window.design.setCamera(-500, -864, 0.05));
    await expect
      .poll(() => spotlight.evaluate((el) => el.getBoundingClientRect().bottom))
      .toBe(676);
    const acrossEdge = [350, 700, 1050].flatMap((x) => [500, 670, 680, 750].map((y) => [x, y]));
    assert.equal(
      await spotlight.getAttribute("data-fits"),
      null,
      "no dim around a result larger than the view",
    );
    await background("large-section", acrossEdge);
    assert.equal(await spotlight.evaluate((el) => getComputedStyle(el).outlineWidth), "2px");
    await input.fill("Focus screen");
    await expect(page.locator("[data-find-result]")).toHaveCount(1);
    await expect(page.locator('#canvas [data-id="section-0-screen-1"]')).toHaveAttribute(
      "data-find-focus",
      "",
    );
    await expect(spotlight).toHaveAttribute("data-fits", "");
    // 20% black over #2b2b2b, uniform across the whole view.
    await background(
      "screen-jump",
      [[350, 60], ...[350, 1050].flatMap((x) => [500, 670, 750].map((y) => [x, y]))],
      [34, 34, 34],
    );
    await input.press("Enter");
    await expect(spotlight).toHaveCount(0);
    await background(
      "finder-closed",
      [350, 1050].flatMap((x) => [500, 670, 750].map((y) => [x, y])),
    );
    console.log(
      "PASS: finder preserves page background across large sections, screen jumps, and close",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
