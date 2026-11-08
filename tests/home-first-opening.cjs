const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { checkHomeOpening } = require("./helpers/home-first-opening.cjs");

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "home-first-opening-"));
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const launch = async () => {
    app = await _electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
    const page = await app.firstWindow();
    await waitForUiReady(page);
    await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
    return page;
  };
  const shot = async (page, name) => {
    if (!process.env.VERYNIZE_SCREENSHOTS) return;
    await fs.mkdir(process.env.VERYNIZE_SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.VERYNIZE_SCREENSHOTS, name + ".png") });
  };
  try {
    let page = await launch();
    assert.equal(new URL(page.url()).pathname, "/");
    assert.equal(await page.locator("#file-home").isVisible(), true);
    await shot(page, "home-first-launch");
    const id = await checkHomeOpening(page);
    await page.waitForFunction(() => !document.body.dataset.switchLoading);
    await shot(page, "home-opened-document");

    // Settings opened during a tab switch keeps the view, so it must not cancel that load.
    const switched = await page.evaluate(async () => {
      const other = window.fileLibrary.summaries().find((file) => file.name === "Other fixture");
      const opening = window.fileLibrary.open(other.id);
      window.appSettings.open();
      await opening;
      return { name: window.design.getDocument().name };
    });
    assert.equal(switched.name, "Other fixture", "settings did not cancel the tab switch");
    await page.evaluate(() => window.appSettings.close());
    await page.waitForFunction(() => !document.body.classList.contains("settings-open"));

    // A failed open from Home returns to Home (replacing the failed editor entry) and clears the cover.
    const failing = await page.evaluate(async () => {
      const doc = structuredClone(window.design.getDocument());
      doc.name = "Unreachable fixture";
      // No token and no session: the room open fails before any network request.
      const cloud = { server: "http://127.0.0.1:9", roomId: crypto.randomUUID() };
      await window.fileLibrary.createFromDocument(doc, { cloud }).catch(() => {});
      window.fileLibrary.showHome();
      return window.fileLibrary.summaries().find((file) => file.name === "Unreachable fixture")?.id;
    });
    assert.ok(failing, "the failing cloud file is listed");
    const before = await page.evaluate(() => ({
      length: history.length,
      name: window.design.getDocument().name,
    }));
    await page.locator(`#library-files [data-file-id="${failing}"] .file-open`).click();
    for (let i = 0; ; i++) {
      const state = await page.evaluate(() => ({
        path: location.pathname,
        home: document.body.classList.contains("files-view"),
        loading: !!document.body.dataset.switchLoading,
        phase: window.switchCoordinator.getState()?.phase,
      }));
      if (state.phase === "fail" && state.home && !state.loading) {
        assert.equal(state.path, "/");
        break;
      }
      assert.ok(i < 100, `failed open returns to Home: ${JSON.stringify(state)}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const after = await page.evaluate(() => ({
      length: history.length,
      name: window.design.getDocument().name,
    }));
    assert.equal(after.name, before.name, "the failed open keeps the previous document");
    assert.equal(after.length, before.length + 1, "the failed editor entry was replaced");
    assert.equal(await page.locator("#file-home").isVisible(), true);
    // ...and says so, once.
    const failure = page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Couldn’t open “Unreachable fixture”" });
    await failure.waitFor({ state: "visible" });
    assert.match(await failure.textContent(), /Sign in to open a room/);
    assert.equal(await failure.count(), 1);
    await shot(page, "open-failed-toast");

    // Repeated opens of a file that is loading join that load: a double click on its card, and two opens
    // from Files in the same tick (the second one arrives in the editor).
    const countBegins = () =>
      page.evaluate(() => {
        window.__begins = [];
        window.addEventListener("switch-loading-change", (event) => {
          if (event.detail.phase === "begin") window.__begins.push(event.detail.to.fileKey);
        });
      });
    await countBegins();
    await page.locator(`#library-files [data-file-id="${id}"] .file-open`).dblclick();
    await page.waitForFunction(() => window.design.getDocument().name === "Opening fixture");
    await page.waitForFunction(() => !document.body.dataset.switchLoading);
    assert.deepEqual(await page.evaluate(() => window.__begins), [id], "double click loads once");
    const repeated = await page.evaluate(async () => {
      window.fileLibrary.showHome();
      window.__begins = [];
      const other = window.fileLibrary.summaries().find((file) => file.name === "Other fixture");
      const results = await Promise.all([
        window.fileLibrary.open(other.id),
        window.fileLibrary.open(other.id),
      ]);
      return { results, begins: window.__begins, other: other.id };
    });
    assert.deepEqual(repeated.results, [repeated.other, repeated.other]);
    assert.deepEqual(repeated.begins, [repeated.other], "a repeated open loads once");
    // A different file supersedes the load in progress.
    const superseded = await page.evaluate(async (id) => {
      window.fileLibrary.showHome();
      window.__begins = [];
      const other = window.fileLibrary.summaries().find((file) => file.name === "Other fixture");
      const first = window.fileLibrary.open(other.id);
      await window.fileLibrary.open(id);
      await first.catch(() => {});
      return {
        name: window.design.getDocument().name,
        path: location.pathname,
        begins: window.__begins,
        other: other.id,
        loading: !!document.body.dataset.switchLoading,
      };
    }, id);
    assert.equal(superseded.name, "Opening fixture");
    assert.equal(superseded.path, `/editor/${id}`);
    assert.deepEqual(superseded.begins, [superseded.other, id]);
    await page.waitForFunction(() => !document.body.dataset.switchLoading);
    await app.close();
    page = await launch();
    assert.equal(
      new URL(page.url()).pathname,
      "/",
      "relaunch with an active file still opens Home",
    );
    await page.goto(`app://verynize/editor/${id}`);
    await waitForUiReady(page);
    await page.waitForFunction(() => !document.body.classList.contains("files-view"));
    assert.equal(await page.evaluate(() => window.design.getDocument().name), "Opening fixture");
    await page.goto("app://verynize/editor");
    await waitForUiReady(page);
    await page.waitForFunction((id) => location.pathname === `/editor/${id}`, id);
    console.log(
      "PASS Home-first fresh/relaunch, explicit editor URLs, immediate centered logo before local document",
    );
  } finally {
    await app?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
