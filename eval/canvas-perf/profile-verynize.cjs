#!/usr/bin/env node
// Supplemental detailed pass, after the uninstrumented baseline has finished.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("../../tests/helpers/ui-ready.cjs");
const install = require("./renderer.cjs");
const { synthetic, profile, bounded } = require("./bench-verynize.cjs");
(async () => {
  const root = path.resolve(__dirname, "../..");
  const file = path.resolve(process.argv[process.argv.indexOf("--output") + 1]);
  const report = JSON.parse(await fs.readFile(file, "utf8"));
  const n = report.summary.at(-1).n;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-prof-"));
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ cwd: root, env, args: [".", `--user-data-dir=${dir}`] });
  try {
    const page = await app.firstWindow();
    await waitForUiReady(page);
    await page.evaluate(() => window.fileLibrary.showEditor());
    await page.evaluate(install);
    await bounded(
      page.evaluate((d) => __perf.action("load", d), synthetic(n)),
      "profile load",
    );
    const cdp = await page.context().newCDPSession(page);
    report.supplementalMachine = {
      at: new Date().toISOString(),
      cpu: os.cpus()[0].model,
      ramBytes: os.totalmem(),
      freeBytes: os.freemem(),
      loadAverage: os.loadavg(),
    };
    report.supplementalProfiles = [];
    for (const kind of ["render", "edit", "pan", "zoom", "drag", "selectAll"]) {
      await bounded(
        page.evaluate(async (kind) => {
          window.design.setCamera(40, 60, 1);
          window.design.setSelection(["pan", "zoom", "drag"].includes(kind) ? ["n1"] : []);
          await __perf.settle();
        }, kind),
        "prepare profile",
      );
      report.supplementalProfiles.push({ n, ...(await profile(page, cdp, kind, `detail-${n}`)) });
      await fs.writeFile(file, JSON.stringify(report, null, 2));
      console.log(n, kind);
    }
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
