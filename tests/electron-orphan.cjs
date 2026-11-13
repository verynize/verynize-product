const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { crashGuard } = require("./helpers/electron-crash-reports.cjs");
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== "ESRCH";
  }
};
(async () => {
  const checkReports = crashGuard();
  for (const mode of ["", "--epipe"]) {
    const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "orphan-test-"));
    let pid;
    const child = spawn(
      process.execPath,
      [path.join(__dirname, "fixtures/electron-orphan-parent.cjs"), mode],
      {
        env: { ...process.env, TMPDIR: tmpdir },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "",
      errors = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      errors += data;
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 30000);
    try {
      const exit = await new Promise((resolve) =>
        child.on("exit", (code, signal) => resolve({ code, signal })),
      );
      clearTimeout(timeout);
      const record = output.split("\n").find((line) => line.startsWith('{"pid":'));
      assert.ok(record, errors);
      pid = JSON.parse(record).pid;
      assert.equal(exit.signal, "SIGKILL", "controller really dies abruptly");
      const deadline = Date.now() + 5000;
      while (alive(pid) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(alive(pid), false, "Electron exits within 5s instead of showing an error modal");
      checkReports();
    } finally {
      clearTimeout(timeout);
      child.kill("SIGKILL");
      if (pid && alive(pid)) process.kill(pid, "SIGKILL");
      await fs.rm(tmpdir, { recursive: true, force: true });
    }
  }
  console.log(
    "PASS parent SIGKILL and broken stderr pipe leave no Electron orphan or crash report",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
