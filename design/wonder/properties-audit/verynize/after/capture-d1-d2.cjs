// After-fix proof for properties-audit D1 (frame tool presets in Properties) and D2 (square new frames).
// Same setup as ../capture.cjs: real Electron, 1440×870 content at 2×, temp profile, onboarding skipped.
// Panel shots crop aside#properties; *-created are the full window; D2-corner-zoom is #canvas-wrap.
//
//   npm run build:ui
//   node design/wonder/properties-audit/verynize/after/capture-d1-d2.cjs
const ROOT = require("node:path").resolve(__dirname, "../../../../..");
const { _electron } = require(ROOT + "/node_modules/@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const OUT = __dirname;
const CATEGORIES = [
  ["phone", "Phone"],
  ["tablet", "Tablet"],
  ["desktop", "Desktop"],
  ["presentation", "Presentation"],
  ["smartwatch", "Smartwatch"],
  ["paper", "Paper"],
  ["social", "Social media"],
];

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "vp-d1-after-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  const app = await _electron.launch({
    cwd: ROOT,
    env,
    args: [
      ".",
      "--force-device-scale-factor=2",
      "--force-color-profile=srgb",
      `--user-data-dir=${profile}`,
    ],
    timeout: 30000,
  });
  const log = [];
  try {
    const page = await app.firstWindow({ timeout: 30000 });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 870),
    );
    await page.waitForSelector("#canvas .layer");
    await page.waitForTimeout(500);

    const wait = (ms = 250) => page.waitForTimeout(ms);
    const box = (selector) =>
      page.evaluate((s) => {
        const r = document.querySelector(s)?.getBoundingClientRect();
        return r && { x: r.left, y: r.top, width: r.width, height: r.height };
      }, selector);
    const state = () =>
      page.evaluate(() => ({
        tool: window.design.getTool(),
        selection: window.design.getSelection(),
        nodes: window.design
          .getDocument()
          .pages[0].nodes.map(
            ({ id, name, type, x, y, w, h, radius, color, clipContent, opacity }) => ({
              id,
              name,
              type,
              x,
              y,
              w,
              h,
              radius,
              color,
              clipContent,
              opacity,
            }),
          ),
        zoom: Math.round(window.design.getCamera().zoom * 100),
      }));
    const shot = async (file, target) => {
      const clip =
        target === "window"
          ? { x: 0, y: 0, width: 1440, height: 870 }
          : await box(target === "canvas" ? "#canvas-wrap" : "aside#properties");
      await page.screenshot({ path: path.join(OUT, file), clip });
      log.push({ file, ...(await state()) });
      console.log("shot", file);
    };
    const emptyPage = async () => {
      await page.keyboard.press("Escape");
      await page.evaluate(() => {
        const d = window.design.getDocument();
        d.pages = [{ id: "p", name: "Page 1", nodes: [] }];
        d.activePage = "p";
        window.design.setDocument(d);
        window.design.setSelection([]);
        window.design.setTool("move");
        window.design.setCamera(0, 0, 0.74);
      });
      await wait(300);
      await page.mouse.click(420, 160);
      await wait(150);
    };
    const away = async () => {
      await page.mouse.move(1330, 840);
      await wait(150);
    };

    /* D1: F with nothing selected → Properties lists the seven collapsed categories; open each one alone. */
    await emptyPage();
    await page.keyboard.press("f");
    await away();
    await shot("D1-collapsed.png", "panel");
    for (const [slug, name] of CATEGORIES) {
      const trigger = page.locator(`[data-frame-category="${name}"]`);
      await trigger.click();
      await wait(200);
      await shot(`D1-${slug}.png`, "panel");
      await trigger.click();
      await wait(150);
    }

    /* Click → 100×100 "Frame". */
    await page.mouse.click(420, 200);
    await wait(300);
    await shot("D1-click-created.png", "window");
    await page.evaluate(() =>
      document.querySelector("#appearance-section")?.scrollIntoView({ block: "nearest" }),
    );
    await wait(150);
    await shot("D2-click.png", "panel");

    /* Drag → gesture size. */
    await emptyPage();
    await page.keyboard.press("f");
    await page.mouse.move(420, 200);
    await page.mouse.down();
    await page.mouse.move(560, 300, { steps: 6 });
    await page.mouse.move(677, 393, { steps: 6 });
    await page.mouse.up();
    await wait(300);
    await shot("D1-drag-created.png", "window");
    await shot("D2-drag.png", "panel");
    // Zoom to the dragged frame (Shift+2), deselect, and show its corner on the canvas.
    await page.mouse.move(700, 120);
    await page.keyboard.press("Shift+Digit2");
    await wait(400);
    await page.evaluate(() => window.design.setSelection([]));
    await wait(250);
    await shot("D2-corner-zoom.png", "canvas");

    /* Preset (toolbar Frame button arms the tool) → selected "iPhone 17", centred and zoomed to. */
    await emptyPage();
    await page.locator("#canvas-toolbar #add-frame").click();
    await wait(200);
    await page.locator('[data-frame-category="Phone"]').click();
    await page.locator('[data-preset="iPhone 17"]').click();
    await wait(400);
    await shot("D1-preset-created.png", "window");
    await shot("D2-preset.png", "panel");
  } finally {
    await fs.writeFile(path.join(OUT, "capture-d1-d2.json"), JSON.stringify(log, null, 2) + "\n");
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
