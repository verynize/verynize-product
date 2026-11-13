#!/usr/bin/env node
// Aggregate Tier 2 judge results: eval/results/<app>/<brief>/<run>.json.
//
//   node eval/summarize.mjs [--judge claude] [--focus verynize] [--json out.json]
//
// Gate (Tier 2 part): focus app has zero critical defects, and its median weighted score is not
// below any competitor's, overall and per brief (briefs where a competitor has no data are skipped).
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EVAL_DIR } from "./lib/briefs.mjs";
import { median } from "./lib/stats.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const judge = opt("--judge", "claude"),
  focus = opt("--focus", "verynize");
const root = join(EVAL_DIR, "results");
const rows = [];
for (const app of existsSync(root) ? readdirSync(root) : []) {
  if (!statSync(join(root, app)).isDirectory()) continue;
  for (const brief of readdirSync(join(root, app))) {
    const dir = join(root, app, brief);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const j = JSON.parse(readFileSync(join(dir, f), "utf8")).judgements?.[judge];
      if (j)
        rows.push({
          app,
          brief,
          run: f.replace(/\.json$/, ""),
          score: j.derived.weightedScore,
          pass: j.derived.checklistPassRate,
          critical: j.derived.criticalDefectCount,
          defects: [...j.criticalDefects, ...j.derived.failedCriticalItems],
        });
    }
  }
}
if (!rows.length) {
  console.error(`no ${judge} judgements under eval/results`);
  process.exit(2);
}
const apps = [...new Set(rows.map((r) => r.app))].sort((a, b) =>
  a === focus ? -1 : b === focus ? 1 : a.localeCompare(b),
);
const briefs = [...new Set(rows.map((r) => r.brief))].sort();
const stat = (list) =>
  list.length
    ? {
        n: list.length,
        median: median(list.map((r) => r.score)),
        pass: median(list.map((r) => r.pass)),
        critical: list.reduce((s, r) => s + r.critical, 0),
      }
    : null;
const cell = (s) =>
  s
    ? `${s.median.toFixed(1).padStart(5)} ${String(Math.round(s.pass * 100)).padStart(3)}% c${s.critical} n${s.n}`
    : "      -";
const W = 24;
console.log(
  `judge: ${judge}. cell = median weighted score, median checklist pass, critical defects, runs\n`,
);
console.log("brief".padEnd(30) + apps.map((a) => a.padEnd(W)).join(""));
const table = {};
for (const b of [...briefs, "ALL"]) {
  table[b] = Object.fromEntries(
    apps.map((a) => [a, stat(rows.filter((r) => r.app === a && (b === "ALL" || r.brief === b)))]),
  );
  console.log(b.padEnd(30) + apps.map((a) => cell(table[b][a]).padEnd(W)).join(""));
}
const failures = [];
const mine = table.ALL[focus];
if (!mine) failures.push(`no results for ${focus}`);
else {
  if (mine.critical) failures.push(`${focus} has ${mine.critical} critical defect(s)`);
  for (const b of [...briefs, "ALL"])
    for (const a of apps.filter((a) => a !== focus)) {
      const me = table[b][focus],
        them = table[b][a];
      if (me && them && me.median < them.median)
        failures.push(
          `${b}: ${focus} median ${me.median.toFixed(1)} < ${a} ${them.median.toFixed(1)}`,
        );
    }
}
console.log(`\nTier 2 gate for ${focus}: ${failures.length ? "FAIL" : "PASS"}`);
for (const f of failures) console.log(`  - ${f}`);
const crit = rows.filter((r) => r.app === focus && r.critical);
if (crit.length) {
  console.log("\ncritical defects:");
  for (const r of crit) console.log(`  ${r.brief}/${r.run}: ${r.defects.join(" | ")}`);
}
if (opt("--json"))
  writeFileSync(
    resolve(opt("--json")),
    JSON.stringify({ judge, focus, table, failures, rows }, null, 2) + "\n",
  );
process.exitCode = failures.length ? 1 : 0;
