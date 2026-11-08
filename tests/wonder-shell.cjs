const { _electron } = require("@playwright/test");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "shell-ui-")),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${root}`],
    timeout: 20000,
  });
  try {
    const p = await app.firstWindow({ timeout: 15000 });
    await waitForUiReady(p);
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.waitForSelector("#canvas-toolbar");
    await p.waitForFunction(() => window.fileLibrary?.currentId);
    await p.screenshot({ path: "/tmp/better-shell-editor.png" });
    await p.locator("#files-home").click();
    await p.screenshot({ path: "/tmp/better-shell-home.png" });
    await p.locator("#library-new-file").click();
    await p.locator("#text-prompt-input").fill("Landing exploration");
    await p.locator("#text-prompt-ok").click();
    await p.waitForFunction(() => window.design.getDocument().name === "Landing exploration");
    assert.equal(await p.locator("#canvas .layer").count(), 0);
    await p.locator(".app-menu-trigger:visible").first().click();
    await p.locator("#rectangle").click();
    await p.locator("#files-home").click();
    await p.locator("#library-search").fill("Landing");
    assert.equal(await p.locator(".file-card").count(), 1);
    await p.locator("#library-list").click();
    assert.equal(await p.locator("#library-files").getAttribute("class"), "list");
    await p.locator(".file-actions").click();
    await p.getByRole("menuitem", { name: "Archive", exact: true }).click();
    assert.equal(await p.locator(".file-card").count(), 0);
    await p.locator("[data-filter=archived]").click();
    assert.equal(await p.locator(".file-card").count(), 1);
    await p.locator(".file-actions").click();
    await p.getByRole("menuitem", { name: "Restore", exact: true }).click();
    await p.locator("[data-filter=all]").click();
    await p.locator(".file-open").click();
    assert.equal(await p.locator("#canvas .layer").count(), 1);
    await p.reload();
    await waitForUiReady(p);
    await p.waitForSelector("#canvas-toolbar");
    await p.waitForFunction(() => window.fileLibrary?.currentId);
    assert.equal(await p.locator("#canvas .layer").count(), 1);
    const switching = await p.evaluate(async () => {
      const original = window.documentLifecycle;
      const calls = [];
      window.documentLifecycle = {
        prepareSwitch: async (options) => {
          calls.push(options.preserveNative === true);
          await new Promise((resolve) => setTimeout(resolve, 20));
        },
      };
      const first = window.fileLibrary.currentId,
        before = JSON.stringify(window.fileLibrary.list().find((f) => f.id === first).document),
        doc = window.design.getDocument();
      doc.name = "Native separate";
      await window.fileLibrary.openNative({ document: doc, path: "/tmp/native-isolation.design" });
      const nativeId = window.fileLibrary.currentId;
      await window.fileLibrary.open(first);
      const after = JSON.stringify(window.fileLibrary.list().find((f) => f.id === first).document);
      window.documentLifecycle = original;
      return { calls, first, nativeId, untouched: before === after };
    });
    assert.deepEqual(switching.calls, [true, false]);
    assert.notEqual(switching.first, switching.nativeId);
    assert.equal(switching.untouched, true);
    await p.setViewportSize({ width: 1000, height: 700 });
    await p.screenshot({ path: "/tmp/better-shell-1000.png" });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(
      "PASS shell file library creation/search/archive/restore/reopen/persistence and1000px overflow",
    );
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
