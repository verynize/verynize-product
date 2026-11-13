// Baseline the whole import graph per area; never silently accept compiler startup failures.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const areas = ["desktop", "legacy-web", "integrations", "cloud"];
const baselineFile = new URL("../typecheck-baseline.json", import.meta.url);
const update = process.argv.includes("--update");
if (update && process.env.CI)
  throw Error("Baseline updates are local-only; review and commit them.");
const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
const current = {};
let failed = false;
mkdirSync(new URL("../.typecheck/", import.meta.url), { recursive: true });
// Migrated source has no baseline allowance, including during --update.
const strict = spawnSync(
  process.execPath,
  [
    "node_modules/typescript/bin/tsc",
    "-p",
    "tsconfig.integrations-build.json",
    "--pretty",
    "false",
  ],
  { cwd: root, encoding: "utf8" },
);
if (strict.error || strict.status !== 0)
  throw Error(
    `Strict integrations check failed: ${strict.error || strict.stdout || strict.stderr}`,
  );
for (const area of areas) {
  const run = spawnSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "-p", `tsconfig.${area}.json`, "--pretty", "false"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const output = (run.stdout || "") + (run.stderr || "");
  writeFileSync(new URL(`../.typecheck/${area}.log`, import.meta.url), output);
  if (run.error || run.signal || ![0, 1, 2].includes(run.status))
    throw Error(`Checker failed for ${area}: ${run.error || output}`);
  const files = {};
  let total = 0;
  for (const line of output.split("\n")) {
    if (!line.includes("error TS")) continue;
    const match = /^(.*?)\(\d+,\d+\): error TS(\d+):/.exec(line);
    if (!match || /\.json$/i.test(match[1])) throw Error(`Configuration error in ${area}: ${line}`);
    const key = `${match[1].replaceAll("\\", "/")} TS${match[2]}`;
    files[key] = (files[key] || 0) + 1;
    total++;
  }
  if (run.status !== 0 && total === 0) throw Error(`No diagnostics parsed for ${area}: ${output}`);
  current[area] = {
    total,
    files: Object.fromEntries(
      Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  };
  console.log(
    `${area}: ${total} errors${baseline ? ` (baseline ${baseline[area]?.total ?? 0})` : ""}; details in .typecheck/${area}.log`,
  );
  if (!baseline) continue;
  for (const [key, count] of Object.entries(files)) {
    if (count > (baseline[area]?.files[key] ?? 0)) {
      console.error(`${area}: ${key}: ${count} exceeds ${baseline[area]?.files[key] ?? 0}`);
      failed = true;
    }
  }
  if (total > (baseline[area]?.total ?? 0)) failed = true;
}
if (update && !failed) writeFileSync(baselineFile, JSON.stringify(current, null, 2) + "\n");
if (failed) process.exitCode = 1;
