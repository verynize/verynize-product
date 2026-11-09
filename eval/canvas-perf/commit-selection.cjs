// Additional measurements for the commit/selection audit: real renderer heap, long tasks and tile overview.
// Run serially under the Electron lock. --tiles compares the opt-in overview on/off in fresh profiles.
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("../../tests/helpers/ui-ready.cjs");
const { synthetic } = require("./bench-verynize.cjs");
const install = require("./renderer.cjs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
const percentile = (a, p) => [...a].sort((a, b) => a - b)[Math.ceil(a.length * p) - 1];
async function run(tiles) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-extra-perf-"));
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1", VERYNIZE_LAUNCH_EDITOR: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await waitForUiReady(page);
    await page.evaluate(
      (enabled) => localStorage.setItem("verynize.canvasTiles", enabled ? "1" : "0"),
      tiles,
    );
    await page.reload();
    await waitForUiReady(page);
    await page.evaluate(install);
    await page.evaluate((d) => window.__perf.action("load", d), synthetic(10000));
    await page.evaluate(() => window.fileLibrary.flush());
    const motion = [];
    for (let i = 0; i < 3; i++) {
      await page.evaluate(async () => {
        window.design.setCamera(40, 60, 0.15);
        await window.__perf.settle();
      });
      const raw = await page.evaluate(() => window.__perf.motion("zoom"));
      motion.push({
        handlerP95: percentile(raw.handlers, 0.95),
        rafP95: percentile(raw.intervals, 0.95),
        over25Pct: (raw.intervals.filter((x) => x > 25).length / raw.intervals.length) * 100,
      });
    }
    const selection = await page.evaluate(async () => {
      window.design.setCamera(40, 60, 1);
      await window.__perf.settle();
      const tasks = [];
      const observer = new PerformanceObserver((list) =>
        tasks.push(...list.getEntries().map((e) => e.duration)),
      );
      observer.observe({ type: "longtask" });
      const start = performance.now();
      window.design.setSelection(window.design.getDocument().pages[0].nodes.map((n) => n.id));
      const syncMs = performance.now() - start;
      await window.__perf.settle();
      const fenceMs = performance.now() - start;
      await new Promise((r) => setTimeout(r, 300));
      observer.disconnect();
      return { syncMs, fenceMs, longestTaskMs: Math.max(0, ...tasks) };
    });
    if (process.argv.includes("--tiles")) return { tiles, motion, selection };
    await page.evaluate(() => window.design.setSelection([]));
    await page.evaluate((d) => window.__perf.action("load", d), synthetic(5000));
    const selection5k = await page.evaluate(async () => {
      await window.__perf.settle();
      const tasks = [];
      const observer = new PerformanceObserver((list) =>
        tasks.push(...list.getEntries().map((e) => e.duration)),
      );
      observer.observe({ type: "longtask" });
      const start = performance.now();
      window.design.setSelection(window.design.getSnapshot().pages[0].nodes.map((n) => n.id));
      const syncMs = performance.now() - start;
      await window.__perf.settle();
      const fenceMs = performance.now() - start;
      await new Promise((resolve) => setTimeout(resolve, 300));
      observer.disconnect();
      window.design.setSelection([]);
      return { syncMs, fenceMs, longestTaskMs: Math.max(0, ...tasks) };
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    const before = await cdp.send("Runtime.getHeapUsage");
    for (let i = 0; i < 170; i += 10)
      await page.evaluate(async (start) => {
        for (let j = start; j < start + 10; j++)
          window.design.updateNodes(["n1"], { color: j % 2 ? "#123456" : "#654321" });
        await window.__perf.settle();
      }, i);
    await page.waitForTimeout(2000);
    await cdp.send("HeapProfiler.collectGarbage");
    const after = await cdp.send("Runtime.getHeapUsage");
    const history = await page.evaluate(() => ({
      entries: past.length,
      bytes: JSON.stringify(past).length,
      documentBytes: JSON.stringify(design).length,
    }));
    return {
      tiles,
      motion,
      selection,
      selection5k,
      heapBeforeMiB: before.usedSize / 2 ** 20,
      heapAfter170MiB: after.usedSize / 2 ** 20,
      history,
    };
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
}
(async () => {
  const rows = [];
  for (const enabled of process.argv.includes("--tiles") ? [false, true] : [false]) {
    const row = await run(enabled);
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  if (out) await fs.writeFile(out, JSON.stringify(rows, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
