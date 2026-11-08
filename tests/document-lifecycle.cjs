const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { openSharedDesign } = require("./helpers/shared-design.cjs");
(async () => {
  const { Miniflare } = await import("miniflare"),
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "document-life-"));
  const { cloudOptions } = await import("./cloud-harness.mjs");
  const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
  const server = (await mf.ready).origin,
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${path.join(dir, "profile")}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await waitForUiReady(page);
    await page.waitForFunction(() => !!window.fileLibrary);
    const a = path.join(dir, "a.verynize.json"),
      b = path.join(dir, "b.verynize.json");
    await app.evaluate(
      ({ dialog }, files) => {
        globalThis.__qaSaveCalls = 0;
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: files[globalThis.__qaSaveCalls++] || files.at(-1),
        });
      },
      [a, b],
    );
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.name = "Native A";
      window.design.setDocument(d);
    });
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.locator("#save-project").click();
    await page.waitForFunction(() =>
      document.getElementById("project-status").textContent.includes("a.verynize.json"),
    );
    await page.evaluate(async () => {
      const d = window.design.getDocument();
      d.name = "Library B";
      await window.fileLibrary.createFromDocument(d);
    });
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.locator("#save-project").click();
    await page.waitForFunction(() =>
      document.getElementById("project-status").textContent.includes("b.verynize.json"),
    );
    assert.equal(await app.evaluate(() => globalThis.__qaSaveCalls), 2);
    assert.equal(JSON.parse(await fs.readFile(a, "utf8")).name, "Native A");
    assert.equal(JSON.parse(await fs.readFile(b, "utf8")).name, "Library B");
    await openSharedDesign(page);
    await page.locator("#cloud-server").fill(server);
    await page.locator("#cloud-create").click();
    await page.waitForFunction(() =>
      document.getElementById("cloud-invite").value.includes("token="),
    );
    const invite = new URLSearchParams(
      new URL(await page.locator("#cloud-invite").inputValue()).hash.slice(1),
    );
    await page.locator("#cloud-close").click();
    await page.evaluate(async () => {
      const d = window.design.getDocument();
      d.name = "Private C";
      await window.fileLibrary.createFromDocument(d);
    });
    await page.waitForTimeout(1100);
    const response = await fetch(server + "/api/rooms/" + invite.get("room"), {
      headers: { authorization: "Bearer " + invite.get("token") },
    });
    assert.equal(response.status, 200);
    const shared = await response.json();
    assert.equal(shared.document.name, "Library B");
    assert.equal(shared.revision, 0);
    assert.equal(await page.locator("#cloud-presence").textContent(), "");
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = () =>
        new Promise((resolve) => {
          globalThis.__resolveDelayedSave = resolve;
        });
    });
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.locator("#save-project").click();
    await page.waitForTimeout(150);
    await page.evaluate(async () => {
      const d = window.design.getDocument();
      d.name = "Private D";
      await window.fileLibrary.createFromDocument(d);
    });
    const stalePath = path.join(dir, "stale.verynize.json");
    await app.evaluate(
      (_electron, filePath) => globalThis.__resolveDelayedSave({ canceled: false, filePath }),
      stalePath,
    );
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(
        () =>
          window.fileLibrary.list().find((f) => f.id === window.fileLibrary.currentId).nativePath,
      ),
      undefined,
    );
    await assert.rejects(fs.access(stalePath));
    console.log(
      "PASS document switching detaches native path and shared room; saved and private documents do not overwrite prior destinations",
    );
  } finally {
    await app.close();
    await mf.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
