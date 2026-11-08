const { _electron } = require(process.cwd() + "/node_modules/@playwright/test");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { waitForUiReady } = require(process.cwd() + "/tests/helpers/ui-ready.cjs");
(async () => {
  const out = path.resolve("design/pen-parity/switch-loading-audit/integrated");
  const profile = await fs.mkdtemp(os.tmpdir() + "/switch-proof-");
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 870 });
    await waitForUiReady(page);
    const ids = await page.evaluate(async () => {
      const base = window.design.getDocument();
      const mk = (name, color, title) => ({
        ...structuredClone(base),
        name,
        pages: [
          {
            id: "p1",
            name: "Desktop",
            background: "#F5F3EE",
            nodes: [
              {
                id: "t1",
                type: "text",
                name: "Heading",
                x: 120,
                y: 120,
                w: 560,
                h: 120,
                text: title,
                fontSize: 56,
                color: "#111111",
              },
              {
                id: "r1",
                type: "rectangle",
                name: "Card",
                x: 120,
                y: 300,
                w: 420,
                h: 300,
                fill: color,
                radius: 24,
              },
            ],
          },
          {
            id: "p2",
            name: "Mobile",
            background: "#EEF3F5",
            nodes: [
              {
                id: "t2",
                type: "text",
                name: "Mobile heading",
                x: 80,
                y: 100,
                w: 360,
                h: 80,
                text: "Mobile page",
                fontSize: 40,
                color: "#111111",
              },
              {
                id: "r2",
                type: "rectangle",
                name: "Tile",
                x: 80,
                y: 220,
                w: 300,
                h: 420,
                fill: "#2B8A7E",
                radius: 32,
              },
            ],
          },
        ],
        activePage: "p1",
      });
      const a = await window.fileLibrary.createFromDocument(
        mk("Sample A", "#9B7FE0", "Sample A design"),
      );
      const b = await window.fileLibrary.createFromDocument(
        mk("Sample B", "#E0A23B", "Sample B design"),
      );
      await window.fileLibrary.open(a);
      localStorage.setItem("verynize.switchLoading.delay", "0");
      return { a, b };
    });
    await page.waitForTimeout(500);
    const urls = {};
    const shot = async (n) => {
      urls[n] = await page.evaluate(() => location.href);
      await page.screenshot({
        path: path.join(out, n + ".png"),
        style: "#presence-slot{visibility:hidden!important}",
      });
    };
    await shot("tab-before");
    // Slow the outgoing flush so the real file switch has a visible wait.
    await page.evaluate(() => {
      const orig = window.documentLifecycle.prepareSwitch;
      window.documentLifecycle.prepareSwitch = async (o) => {
        await new Promise((r) => setTimeout(r, 2000));
        return orig(o);
      };
    });
    const opening = page.evaluate((b) => window.fileLibrary.open(b), ids.b);
    await page.waitForFunction(
      () => document.querySelector("#workspace").dataset.switchLoading === "file",
    );
    await page.waitForTimeout(200);
    await shot("tab-loading");
    await opening;
    await page.waitForTimeout(400);
    await shot("tab-after");
    // Page switch to a page the loader reports as unloaded, released after 2 s.
    await page.evaluate(() => {
      window.pageLoader.reset(["p2"]);
      setTimeout(() => {
        window.pageLoader.reset([]);
        window.verynize.updatePage({ name: "Mobile" }, "p2");
      }, 2000);
    });
    await page.evaluate(() => window.design.setActivePage("p2"));
    await page.waitForFunction(
      () => document.querySelector("#workspace").dataset.switchLoading === "page",
    );
    await page.waitForTimeout(200);
    await shot("page-loading");
    await page.waitForFunction(
      () => !document.querySelector("#workspace").dataset.switchLoading,
      null,
      { timeout: 10000 },
    );
    await page.waitForTimeout(300);
    await shot("page-after");
    await fs.writeFile(path.join(out, "urls-desktop.json"), JSON.stringify(urls, null, 2) + "\n");
    console.log("ok");
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
