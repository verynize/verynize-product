#!/usr/bin/env node
// Run under the Electron flock. Alternates baseline/current app.js, restoring it even on failure.
// Usage: node eval/canvas-perf/world-bounds-render.cjs /path/to/d78d899-app.js
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("@playwright/test");
const { synthetic } = require("./bench-verynize.cjs");
const { waitForUiReady } = require("../../tests/helpers/ui-ready.cjs");
const root = path.resolve(__dirname, "../..");
(async () => {
  const file = path.join(root, "web/app.js");
  const current = await fs.readFile(file);
  const baseline = await fs.readFile(process.argv[2]);
  const results = [];
  try {
    for (const label of ["baseline", "current", "current", "baseline"]) {
      await fs.writeFile(file, label === "baseline" ? baseline : current);
      const profile = await fs.mkdtemp(path.join(os.tmpdir(), "bounds-perf-"));
      const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
      delete env.ELECTRON_RUN_AS_NODE;
      const app = await _electron.launch({
        cwd: root,
        env,
        args: [root, `--user-data-dir=${profile}`],
      });
      try {
        const p = await app.firstWindow();
        await waitForUiReady(p);
        await p.evaluate(() => window.fileLibrary?.showEditor());
        await p.evaluate(
          (d) => {
            window.design.loadDocument(d);
            window.design.setCamera(0, 0, 1);
          },
          synthetic(10000, { clip: true }),
        );
        await p.waitForTimeout(1000);
        const timing = await p.evaluate(async () => {
          // Render alone: no edit, no clone, no validation. Include production subscribers.
          for (let i = 0; i < 10; i++) render();
          const ms = [];
          for (let i = 0; i < 40; i++) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const start = performance.now();
            render();
            ms.push(performance.now() - start);
          }
          ms.sort((a, b) => a - b);
          return { median: ms[20], p25: ms[10], p75: ms[30], samples: ms };
        });
        results.push({ label, ...timing });
        console.log(JSON.stringify(results.at(-1)));
      } finally {
        await app.close();
        await fs.rm(profile, { recursive: true, force: true });
      }
    }
  } finally {
    await fs.writeFile(file, current);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
