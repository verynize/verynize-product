#!/usr/bin/env node
// Tests the hypothesis in docs/canvas-performance/reviews/opus-on-verynize-baseline.md:
// `#workspace:has(...)` (and other `:has()`) rules make every label insert restyle the whole workspace.
// Rules are removed at runtime through CSSOM; no product file is changed.
// node eval/canvas-perf/experiment-has.cjs [--sizes 500,1000] [--runs 3] [--output file.json]
"use strict";
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("../../tests/helpers/ui-ready.cjs");
const install = require("./renderer.cjs");
const { synthetic, bounded } = require("./bench-verynize.cjs");

const root = path.resolve(__dirname, "../..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const sizes = arg("--sizes", "500,1000").split(",").map(Number);
const runs = Number(arg("--runs", "3"));
const output = path.resolve(
  arg("--output", path.join(__dirname, "results/experiment-has-2026-11-04.json")),
);
// Each variant removes the style rules whose selector matches its pattern.
const VARIANTS = {
  base: null,
  "no-workspace-has": "#workspace:has\\(",
  "no-group-has": ":where\\(\\.group[^)]*\\):has\\(",
  "no-has-except-group": "^(?!.*:where\\(\\.group).*:has\\(",
  "no-has-focus-visible": ":has\\(:focus-visible\\)",
  "no-has-cloud-dialog": "#cloud-dialog",
  "no-has": ":has\\(",
};
const variants = arg("--variants", "base,no-workspace-has,no-group-has,no-has").split(",");

function strip(pattern) {
  if (!pattern) return 0;
  let removed = 0;
  const re = new RegExp(pattern);
  const match = (text) => re.test(text);
  const walk = (list) => {
    for (let i = list.cssRules.length - 1; i >= 0; i--) {
      const rule = list.cssRules[i];
      if (rule.selectorText && match(rule.selectorText)) {
        list.deleteRule(i);
        removed++;
      } else if (rule.cssRules) walk(rule);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet);
    } catch {}
  }
  return removed;
}

const quantile = (xs, q) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
};
const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

async function main() {
  process.chdir(root);
  const results = [];
  for (const n of sizes) {
    const doc = synthetic(n);
    for (const variant of variants) {
      for (let run = 0; run < runs; run++) {
        const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-has-"));
        const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
        delete env.ELECTRON_RUN_AS_NODE;
        const app = await electron.launch({
          cwd: root,
          env,
          args: [".", `--user-data-dir=${profileDir}`],
        });
        try {
          const page = await app.firstWindow();
          await waitForUiReady(page);
          await page.evaluate(() => window.fileLibrary?.showEditor());
          await page.evaluate(install);
          const removed = await page.evaluate(strip, VARIANTS[variant]);
          await bounded(
            page.evaluate((d) => __perf.action("load", d), doc),
            "load",
          );
          const row = { n, variant, run, removed, load: os.loadavg()[0] };
          row.edit = await bounded(
            page.evaluate(() => __perf.action("edit")),
            "edit",
          );
          for (const kind of ["pan", "zoom", "drag"]) {
            await page.evaluate(async () => {
              window.design.setCamera(40, 60, 1);
              window.design.setSelection(["n1"]);
              await __perf.settle();
            });
            const m = await bounded(
              page.evaluate((k) => __perf.motion(k), kind),
              kind,
            );
            row[kind] = {
              p50: quantile(m.intervals, 0.5),
              p95: quantile(m.intervals, 0.95),
              handlerP50: quantile(m.handlers, 0.5),
              changed: m.changed,
            };
          }
          results.push(row);
          console.log(
            JSON.stringify({
              n,
              variant,
              run,
              removed,
              editSync: row.edit.syncMs,
              pan: row.pan.p50,
              panHandler: row.pan.handlerP50,
              zoom: row.zoom.p50,
              drag: row.drag.p50,
            }),
          );
        } finally {
          await app.close().catch(() => {});
          await fs.rm(profileDir, { recursive: true, force: true });
        }
      }
    }
  }
  const summary = [];
  for (const n of sizes)
    for (const variant of variants) {
      const rows = results.filter((r) => r.n === n && r.variant === variant);
      summary.push({
        n,
        variant,
        removedRules: rows[0]?.removed,
        editSyncMs: median(rows.map((r) => r.edit.syncMs)),
        editFenceMs: median(rows.map((r) => r.edit.paintFenceMs)),
        panP50: median(rows.map((r) => r.pan.p50)),
        panP95: median(rows.map((r) => r.pan.p95)),
        panHandlerP50: median(rows.map((r) => r.pan.handlerP50)),
        zoomHandlerP50: median(rows.map((r) => r.zoom.handlerP50)),
        dragHandlerP50: median(rows.map((r) => r.drag.handlerP50)),
        zoomP50: median(rows.map((r) => r.zoom.p50)),
        dragP50: median(rows.map((r) => r.drag.p50)),
      });
    }
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(
    output,
    JSON.stringify({ date: new Date().toISOString(), sizes, runs, summary, results }, null, 2),
  );
  console.table(summary);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
