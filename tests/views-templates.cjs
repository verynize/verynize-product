const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-views-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${root}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await waitForUiReady(page);
    await page.waitForFunction(() => !!window.designTemplates);
    await page.evaluate(() => {
      window.fileLibrary.showHome();
      window.fileLibrary.showEditor();
    });
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.locator("#templates-open").click();
    await page.locator('[data-template="presentation"]').click();
    assert.equal(await page.evaluate(() => window.design.getDocument().pages.length), 2);
    assert.ok(await page.evaluate(() => window.design.getDocument().pages[1].nodes.length > 10));
    assert.equal(
      await page.evaluate(
        () => window.fileLibrary.list().filter((f) => f.name === "Project presentation").length,
      ),
      1,
    );
    await page.evaluate(() =>
      window.design.setView({
        ...window.design.getView(),
        zoom: 0.02,
        scrollLeft: 55,
        scrollTop: 80,
      }),
    );
    const expected = await page.evaluate(() => window.design.getView());
    await page.locator("#bd-view-menu-button").click();
    await page.getByRole("menuitem", { name: "Save current view" }).click();
    await page.locator("#view-save").click();
    await page.locator("#text-prompt-input").fill("Opening focus");
    await page.locator("#text-prompt-ok").click();
    await page.waitForFunction(() => window.design.getDocument().views?.length === 1);
    await page.locator("#views-close").click();
    await page.evaluate(() => {
      const d = window.design.getDocument();
      window.design.setView({ page: d.pages[1].id, zoom: 0.6, scrollLeft: 0, scrollTop: 0 });
    });
    await page.locator("#bd-view-menu-button").click();
    await page.getByRole("menuitem", { name: "Save current view" }).click();
    await page.locator("[data-view-name]").click();
    assert.deepEqual(await page.evaluate(() => window.design.getView()), expected);
    await page.reload();
    await waitForUiReady(page);
    await page.waitForFunction(() => !!window.designTemplates);
    assert.equal(
      await page.evaluate(() => window.design.getDocument().views[0].name),
      "Opening focus",
    );
    assert.equal(await page.evaluate(() => window.design.getDocument().views[0].zoom), 0.02);
    const result = await page.evaluate(() => {
      const d = window.design.getDocument();
      d.views[0].zoom = 99;
      try {
        window.design.setDocument(d);
        return false;
      } catch {
        return true;
      }
    });
    assert.equal(result, true);
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.activePage = d.views[0].page;
      window.design.setDocument(d);
      document.getElementById("delete-page").click();
    });
    assert.equal(await page.evaluate(() => window.design.getDocument().views.length), 0);
    for (const kind of ["landing", "dashboard"]) {
      await page.evaluate(
        (kind) => window.fileLibrary.createFromDocument(window.designTemplates.create(kind)),
        kind,
      );
      assert.ok(await page.evaluate(() => window.design.getDocument().pages[0].nodes.length > 10));
    }
    console.log(
      "PASS authored template files, saved page/zoom/scroll views, reload persistence, invalid view rejection and page deletion cleanup",
    );
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
