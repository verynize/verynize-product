// Real app, fixed 24-camera trajectory. Run sequentially after fixes 1–3 land.
const { _electron: electron } = require("@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const { synthetic, bounded } = require("./bench-verynize.cjs");
const { waitForUiReady } = require("../../tests/helpers/ui-ready.cjs");
const output =
  (process.argv.includes("--output") ? process.argv[process.argv.indexOf("--output") + 1] : null) ||
  "eval/canvas-perf/results/fix-4-tiles.json";
const quantile = (a, q) =>
  [...a].sort((a, b) => a - b)[Math.max(0, Math.ceil(a.length * q) - 1)] ?? null;
(async () => {
  const report = {
    at: new Date().toISOString(),
    cpu: os.cpus()[0].model,
    notes:
      "Concurrent work may affect load. rAF intervals are not presentation timestamps. DOM completeness is unmeasured.",
    samples: [],
  };
  for (const n of process.argv.includes("--sizes")
    ? process.argv[process.argv.indexOf("--sizes") + 1].split(",").map(Number)
    : [1000, 5000, 13000, 50000])
    for (
      let run = 0;
      run <
      Number(
        process.argv.includes("--runs") ? process.argv[process.argv.indexOf("--runs") + 1] : 1,
      );
      run++
    )
      for (const flag of [false, true]) {
        const profile = await fs.mkdtemp(`${os.tmpdir()}/tiles-bench-`);
        const row = { n, run, flag, loadAverage: os.loadavg(), freeBytes: os.freemem() };
        report.samples.push(row);
        let app,
          failed = false;
        try {
          const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
          delete env.ELECTRON_RUN_AS_NODE;
          app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
          const page = await app.firstWindow();
          await waitForUiReady(page);
          await page.evaluate(
            (flag) => localStorage.setItem("verynize.canvasTiles", flag ? "1" : "0"),
            flag,
          );
          await page.reload();
          await waitForUiReady(page);
          row.loadMs = await bounded(
            page.evaluate((doc) => {
              window.fileLibrary.showEditor();
              const t = performance.now();
              window.design.loadDocument(doc);
              return performance.now() - t;
            }, synthetic(n)),
            "load",
          );
          row.motion = await bounded(
            page.evaluate(async () => {
              const handlers = [],
                intervals = [],
                completeness = [];
              let last;
              for (let i = 0; i < 24; i++) {
                const now = await new Promise(requestAnimationFrame);
                if (last !== undefined) intervals.push(now - last);
                last = now;
                completeness.push(window.canvasTiles?.stats() || null);
                const t = performance.now();
                window.design.setCamera(20, 40, 0.24 - 0.16 * (i < 12 ? i / 12 : (24 - i) / 12));
                handlers.push(performance.now() - t);
              }
              const start = performance.now();
              while (window.canvasTiles?.stats().active && performance.now() - start < 10000)
                await new Promise(requestAnimationFrame);
              return {
                handlers,
                intervals,
                completeness,
                final: window.canvasTiles?.stats() || null,
                settleMs: performance.now() - start,
              };
            }),
            "zoom",
          );
          row.summary = {
            handlerP50: quantile(row.motion.handlers, 0.5),
            handlerP95: quantile(row.motion.handlers, 0.95),
            over16_7Pct:
              (100 * row.motion.intervals.filter((x) => x > 16.7).length) /
              row.motion.intervals.length,
          };
          console.log(JSON.stringify({ n, flag, loadMs: row.loadMs, ...row.summary }));
        } catch (e) {
          row.error = String(e);
          failed = true;
          console.log(JSON.stringify(row));
        } finally {
          if (app) {
            if (failed) app.process().kill("SIGKILL");
            else await app.close();
          }
          await fs.rm(profile, { recursive: true, force: true });
          await fs.writeFile(output, JSON.stringify(report, null, 2));
        }
      }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
