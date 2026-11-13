import { readFile } from "node:fs/promises";

// Advisory only: unmet/missing budgets do not change the exit status.
const input = process.argv[2];
if (!input || process.argv.length !== 3) {
  console.error("Usage: node eval/canvas-perf/check-budgets.mjs <bench-verynize.json>");
  process.exit(1);
}
const results = JSON.parse(await readFile(input, "utf8"));
const { budgets } = JSON.parse(await readFile(new URL("./budgets.json", import.meta.url), "utf8"));
if (results.schemaVersion !== 1 || !Array.isArray(results.summary)) {
  throw new Error("Expected bench-verynize schemaVersion 1 with a summary array");
}
const counts = { PASS: 0, FAIL: 0, REPORT: 0 };
for (const { metric, nodeCount, unit, budget } of budgets) {
  const row = results.summary.find(({ n }) => n === nodeCount);
  const value = metric.split(".").reduce((current, key) => current?.[key], row);
  const measured =
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    (unit !== "percent" || value <= 100);
  const status = !measured
    ? "FAIL"
    : budget.operator === "report"
      ? "REPORT"
      : (budget.operator === "lt" && value < budget.value) ||
          (budget.operator === "eq" && value === budget.value)
        ? "PASS"
        : "FAIL";
  const target =
    budget.operator === "report"
      ? "report required; no numeric limit"
      : `${budget.operator === "lt" ? "<" : "="} ${budget.value} ${unit}`;
  const ceiling = results.ceiling?.n === nodeCount ? `; ${results.ceiling.error}` : "";
  const actual = measured ? `${value.toFixed(3)} ${unit}` : `missing measurement${ceiling}`;
  console.log(`${status} ${nodeCount} ${metric}: ${actual} (${target})`);
  counts[status]++;
}
console.log(
  `Advisory: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.REPORT} REPORT; no CI gate.`,
);
