import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { runProcess } from "../scripts/run-tests.mjs";
const result = await runProcess(
  process.execPath,
  ["tests/fixtures/electron-orphan-parent.cjs", "--hang"],
  {
    env: process.env,
    timeoutMs: 15000,
  },
);
assert.equal(result.timedOut, true);
const record = result.output.split("\n").find((line) => line.startsWith('{"pid":'));
assert.ok(record, result.output);
const { tmpdir } = JSON.parse(record);
assert.equal(fs.existsSync(tmpdir), false, "per-test temp directory removed");
assert.equal(
  spawnSync("pgrep", ["-f", tmpdir]).status,
  1,
  "no detached process survives the runner timeout",
);
console.log("PASS runner timeout sweeps detached Electron by its unique TMPDIR");
