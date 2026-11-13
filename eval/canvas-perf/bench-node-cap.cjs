#!/usr/bin/env node
// Sequential capacity sweep. Temporarily lift only the shared limits; restore even on failure.
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const root = path.resolve(__dirname, "../..");
process.chdir(root);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const label = arg("--label", new Date().toISOString().replace(/[:.]/g, "-"));
if (!/^[a-zA-Z0-9_-]+$/.test(label))
  throw Error("Use letters, digits, underscores or hyphens for --label");
const sizes = arg("--sizes", "5000,10000,20000,30000,50000");
const runs = arg("--runs", "3");
const source = path.join(root, "web/document-core.js");
const original = fs.readFileSync(source, "utf8");
const pattern = /const NODE_LIMITS = Object\.freeze\(\{[\s\S]*?\}\);/;
if (!pattern.test(original)) throw Error("Cannot locate NODE_LIMITS; no files changed");
const out = (kind) => `eval/canvas-perf/results/node-cap-${kind}-${label}.json`;
const run = (file, args) =>
  cp.execFileSync(process.execPath, [file, ...args], { stdio: "inherit" });
console.log(cp.execFileSync("uptime", { encoding: "utf8" }).trim());
run("scripts/build-ui.cjs", []);
try {
  fs.writeFileSync(
    source,
    original.replace(
      pattern,
      "const NODE_LIMITS = Object.freeze({ perPage: 100000, perDocument: 100000 });",
    ),
  );
  for (const { kind, extra } of [
    { kind: "single", extra: [] },
    { kind: "pages", extra: ["--nodes-per-page", "5000"] },
  ])
    run("eval/canvas-perf/bench-verynize.cjs", [
      "--sizes",
      sizes,
      "--runs",
      runs,
      "--skip",
      "selectAll",
      "--no-profile",
      ...extra,
      "--output",
      out(kind),
    ]);
  run("eval/canvas-perf/bench-tiles.cjs", [
    "--sizes",
    sizes,
    "--runs",
    runs,
    "--output",
    out("tiles"),
  ]);
} finally {
  fs.writeFileSync(source, original);
}
