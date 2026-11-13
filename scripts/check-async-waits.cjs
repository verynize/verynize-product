const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

// Deliberately a narrow syntax guard, not Promise type inference. The audit also checks
// non-async predicates; use waitForAsync for any predicate returning a Promise.
function violations(source) {
  const gap = String.raw`(?:\s|/\*[\s\S]*?\*/|//[^\n]*\n)*`;
  const pattern = new RegExp(String.raw`\bwaitForFunction${gap}\(${gap}(?:\(${gap})*async\b`, "g");
  return [...source.matchAll(pattern)].map((m) => source.slice(0, m.index).split("\n").length);
}

function check() {
  // Old call shapes, including multiline arrow and function predicates, must fail.
  for (const source of [
    "page.waitForFunction(async () => false)",
    "frame.waitForFunction(\n async (cwd) => await read(cwd))",
    "electronApp.waitForFunction(/* predicate */ async function () { return false; })",
    "page.waitForFunction((async expected => expected))",
  ])
    assert.equal(violations(source).length, 1, source);
  assert.deepEqual(violations("page.waitForFunction(() => window.ready)"), []);
  const failures = [];
  for (const directory of ["tests", "eval", "scripts"]) {
    for (const name of fs.readdirSync(directory, { recursive: true })) {
      if (!/\.[cm]?[jt]sx?$/.test(name)) continue;
      const file = path.join(directory, name);
      // This file contains intentional invalid source strings for the guard self-test.
      if (path.resolve(file) === __filename) continue;
      for (const line of violations(fs.readFileSync(file, "utf8")))
        failures.push(`${file}:${line}: async waitForFunction predicate; use waitForAsync`);
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
  console.log("Async wait guard passed (including 4 rejected regression fixtures)");
}

module.exports = { check, violations };
if (require.main === module) check();
