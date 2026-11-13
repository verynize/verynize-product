const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "preview-setup-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  const app = await _electron.launch({ env, args: [".", `--user-data-dir=${dir}`] });
  try {
    const result = await app.evaluate(async ({ app }, root) => {
      const require = process
        .getBuiltinModule("module")
        .createRequire(app.getAppPath() + "/package.json");
      const { registerDevServerIPC } = require(app.getAppPath() + "/desktop/agent-shell.cjs");
      const handlers = {};
      registerDevServerIPC(
        (name, handler) => {
          handlers[name] = handler;
        },
        {
          getProject: () => ({ root }),
          resolveRoot: async (requested) => {
            if (requested !== root) throw Error("Unknown repository");
            return { root };
          },
        },
      );
      await handlers.devServerConfigure({
        root,
        command: ["node", "-e", "process.exit(0)"],
        setup: ["node", "-e", "console.log('setup ready');setInterval(()=>{},1000)"],
      });
      const setup = handlers.devServerSetup({ root });
      let status;
      const deadline = Date.now() + 10000;
      do {
        status = await handlers.devServerStatus({ root });
        if (status.setup?.tail?.includes("setup ready")) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      } while (Date.now() < deadline);
      await handlers.devServerStop({ root });
      const stopped = await setup;
      let rejected = "";
      try {
        await handlers.devServerStart({ root: root + "/unregistered" });
      } catch (error) {
        rejected = error.message;
      }
      return { status, stopped, rejected, after: await handlers.devServerStatus({ root }) };
    }, dir);
    assert.match(result.status.setup.tail, /setup ready/);
    assert.equal(result.stopped.state, "stopped");
    assert.notEqual(result.stopped.exitCode, 0);
    assert.equal(result.after.setup, undefined);
    assert.match(result.rejected, /Unknown repository/);
    console.log(
      "PASS preview setup logs, process-group cancellation, and registered repository boundary",
    );
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
