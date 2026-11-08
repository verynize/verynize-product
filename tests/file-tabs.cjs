// Title-bar file tabs in the desktop window: every opened file keeps a tab, a click on any tab switches files (the
// bar is a window drag region, so tabs must opt out), drag reorders the strip, and the + opens the file switcher.
const { _electron } = require(process.cwd() + "/node_modules/@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");

(async () => {
  const profile = await fs.mkdtemp(os.tmpdir() + "/bd-file-tabs-");
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    timeout: 20000,
    env,
    args: [".", `--user-data-dir=${profile}`],
  });
  try {
    const page = await app.firstWindow({ timeout: 15000 });
    await waitForUiReady(page);
    for (const name of ["Alpha", "Beta"])
      await page.evaluate(async (name) => {
        const doc = window.design.getDocument();
        doc.name = name;
        await window.fileLibrary.createFromDocument(doc);
      }, name);
    const names = () =>
      page
        .locator("[data-file-tab]:visible")
        .evaluateAll((tabs) =>
          tabs.map((tab) => tab.querySelector("input")?.value ?? tab.textContent.trim()),
        );
    const tab = (name) =>
      page.locator("[data-file-tab]:visible").filter({ has: page.locator(`text="${name}"`) });
    const current = () => page.evaluate(() => window.design.getDocument().name);
    assert.deepEqual((await names()).slice(-2), ["Alpha", "Beta"]);

    // Any tab is clickable while another one is active, and is not part of the window drag region.
    assert.equal(
      await page
        .locator("[data-file-tab]:not([data-document-tab])")
        .first()
        .evaluate((el) => getComputedStyle(el).getPropertyValue("-webkit-app-region")),
      "no-drag",
    );
    await tab("Alpha").click();
    await page.waitForFunction(() => window.design.getDocument().name === "Alpha");
    await page
      .locator("[data-file-tab]:visible:not([data-document-tab])")
      .filter({ hasText: "Beta" })
      .click();
    await page.waitForFunction(() => window.design.getDocument().name === "Beta");
    assert.equal(await current(), "Beta");

    const fileIds = await page.evaluate(() =>
      Object.fromEntries(window.fileLibrary.summaries().map((file) => [file.name, file.id])),
    );
    const expectFile = async (name) => {
      await page.waitForFunction(
        ({ id, name }) =>
          location.pathname === "/editor/" + encodeURIComponent(id) &&
          window.fileLibrary.currentId === id &&
          window.design.getDocument().name === name,
        { id: fileIds[name], name },
      );
    };
    await expectFile("Beta");
    await page.evaluate(() => history.back());
    await expectFile("Alpha");
    await page.evaluate(() => history.forward());
    await expectFile("Beta");
    await page.reload();
    await waitForUiReady(page);
    await expectFile("Beta");
    await page.evaluate(() => window.appSettings.open("preferences"));
    await page.waitForFunction(() => location.pathname === "/settings/preferences");
    assert.equal(await page.evaluate(() => history.state.settingsUnder), "/editor/" + fileIds.Beta);
    await page.evaluate(() => window.appSettings.close());
    await expectFile("Beta");
    const beforeBare = await page.evaluate(() => history.state.__TSR_index);
    await page.evaluate(() => window.shellNavigation.navigate({ to: "/editor" }));
    await expectFile("Beta");
    assert.equal(
      await page.evaluate(() => history.state.__TSR_index),
      beforeBare + 1,
      "bare editor navigation adds one entry; canonicalization replaces it",
    );
    await page.evaluate(() =>
      window.shellNavigation.navigate({
        to: "/editor/$fileId",
        params: { fileId: "missing-file" },
      }),
    );
    await page.waitForFunction(
      () => location.pathname === "/" && document.body.classList.contains("files-view"),
    );
    await page
      .getByText("This file is unavailable. Choose a file from Files.", { exact: true })
      .waitFor();
    await page.evaluate((id) => window.fileLibrary.open(id), fileIds.Beta);
    await expectFile("Beta");

    // A typed URL overrides the library's last active file on startup.
    await page.goto("app://verynize/editor/" + fileIds.Alpha);
    await waitForUiReady(page);
    await expectFile("Alpha");
    await page.evaluate((id) => window.fileLibrary.open(id), fileIds.Beta);
    await expectFile("Beta");

    // Drag Beta in front of Alpha: the strip reorders and keeps the order after a reload.
    const before = await names();
    const alpha = page
      .locator("[data-file-tab]:visible:not([data-document-tab])")
      .filter({ hasText: "Alpha" });
    const box = await alpha.boundingBox();
    await page
      .locator("[data-document-tab]")
      .dragTo(alpha, { targetPosition: { x: 4, y: box.height / 2 } });
    const after = await names();
    assert.equal(
      after.indexOf("Beta"),
      after.indexOf("Alpha") - 1,
      `dragged: ${before} → ${after}`,
    );
    await page.reload();
    await waitForUiReady(page);
    assert.deepEqual(await names(), after, "order survives a reload");

    // + opens the file switcher.
    await page.locator("#shell-new-file").click();
    await page.locator("#file-switcher [data-switcher-new]").waitFor();
    await page.keyboard.press("Escape");
    await page.locator("#file-switcher").waitFor({ state: "detached" });
    // Renames preserve identity; a room id can resolve a known local cloud record.
    await page.evaluate((id) => window.fileLibrary.rename(id, "Renamed Beta"), fileIds.Beta);
    assert.equal(new URL(page.url()).pathname, "/editor/" + fileIds.Beta);
    await page.evaluate(
      (id) =>
        window.fileLibrary.setCloud(id, {
          server: "https://example.invalid",
          roomId: "known-room-alias",
          detached: true,
        }),
      fileIds.Beta,
    );
    await page.evaluate((id) => window.fileLibrary.open(id), fileIds.Alpha);
    await expectFile("Alpha");
    await page.evaluate(() =>
      window.shellNavigation.navigate({
        to: "/editor/$fileId",
        params: { fileId: "known-room-alias" },
      }),
    );
    await page.waitForFunction(
      (id) => location.pathname === "/editor/" + id && window.fileLibrary.currentId === id,
      fileIds.Beta,
    );
    await page.evaluate((id) => window.fileLibrary.setCloud(id, null), fileIds.Beta);
    // While a tab loads, the clicked tab already looks active and the outgoing one does not.
    const target = await page.evaluate(
      () => window.fileLibrary.summaries().find((f) => f.id !== window.fileLibrary.currentId).id,
    );
    await page.evaluate(() => {
      const prepare = window.documentLifecycle.prepareSwitch;
      window.documentLifecycle.prepareSwitch = async (options) => {
        window.documentLifecycle.prepareSwitch = prepare;
        await new Promise((resolve) => setTimeout(resolve, 800));
        return prepare(options);
      };
    });
    await page.locator(`[data-file-tab="${target}"]:not([data-document-tab])`).click();
    const pendingTab = page.locator(`[data-file-tab="${target}"][data-switch-pending]`);
    await pendingTab.waitFor();
    assert.match(await pendingTab.getAttribute("class"), /bg-input/);
    assert.doesNotMatch(
      await page.locator("[data-document-tab]").getAttribute("class"),
      /bg-input/,
    );
    await page.waitForFunction((id) => window.fileLibrary.currentId === id, target);
    assert.equal(await page.locator("[data-switch-pending]").count(), 0);
    assert.match(await page.locator("[data-document-tab]").getAttribute("class"), /bg-input/);
    // Closing each active tab selects its neighbour, then returns to Files.
    while (await page.locator("[data-file-tab-close]").count()) {
      const id = await page.evaluate(() => window.fileLibrary.currentId);
      await page.locator(`[data-file-tab-close="${id}"]`).click({ force: true });
      await page.waitForFunction(
        (previous) =>
          location.pathname === "/" ||
          (window.fileLibrary.currentId !== previous &&
            location.pathname === "/editor/" + encodeURIComponent(window.fileLibrary.currentId)),
        id,
      );
      if (new URL(page.url()).pathname === "/") break;
    }
    assert.equal(new URL(page.url()).pathname, "/");

    console.log(
      "PASS file tabs: one tab per file, click any tab (no-drag), drag to reorder (persists), + file switcher",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
