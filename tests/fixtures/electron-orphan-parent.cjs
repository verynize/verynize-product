const { _electron } = require("@playwright/test");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orphan-profile-"));
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    cwd: path.join(__dirname, "../.."),
    args: [".", "--user-data-dir=" + profile],
    env,
  });
  console.log(JSON.stringify({ pid: app.process().pid, tmpdir: os.tmpdir() }));
  await app.firstWindow();
  if (process.argv.includes("--hang")) {
    // Exercise the runner sweep even when the main thread cannot poll its parent.
    await app.evaluate(() => {
      setTimeout(() => {
        while (true) {}
      }, 10);
    });
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
    return;
  }
  if (process.argv.includes("--epipe")) {
    await app.evaluate(() => {
      setTimeout(() => console.error("x".repeat(1e5)), 100);
    });
  }
  process.kill(process.pid, "SIGKILL");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
