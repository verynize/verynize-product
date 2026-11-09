// Library edits made just before the page goes away (web/library-storage.js). The library is written to IndexedDB in
// an idle callback (≤ 500 ms after the edit) and pagehide starts any write still queued, as the page unloads. For an
// edit followed within 0–450 ms by a reload, and by a quit and relaunch, the edit is in the editor and in the stored
// library afterwards. In the stalled rounds idle callbacks never run, so only the unload path can write the edit: the
// page logs (in localStorage, written synchronously) when that IndexedDB write is issued and when it commits, and at
// least one stalled round must leave before its commit is seen, so the test proves a write started while the page goes
// away is kept (no synchronous journal is needed for it).
const { _electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { readLibrary } = require("./helpers/library-store.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os");

async function launch(dir) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${dir}`],
    timeout: 20000,
  });
  const page = await app.firstWindow({ timeout: 20000 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await waitForUiReady(page);
  await page.waitForFunction(() => window.fileLibrary?.isReady());
  return { app, page, errors };
}

/**
 * Logs the IndexedDB writes of `marker` and pagehide, then renames the first layer to `marker` and reloads `delay` ms
 * later. `stalled`: idle callbacks never run, so the write is still queued when pagehide fires (a busy page, or one
 * reloaded before it was idle) and only pagehide starts it.
 */
function edit(page, marker, reload = null) {
  return page.evaluate(
    ({ marker, reload }) => {
      const key = "test-unload-log";
      const log = (event) => {
        const entries = JSON.parse(localStorage.getItem(key) || "[]");
        localStorage.setItem(key, JSON.stringify([...entries, event]));
      };
      localStorage.removeItem(key);
      // oxlint-disable-next-line typescript/unbound-method -- monkey-patch: the original is re-invoked with .call(this)
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, name) {
        if (
          typeof name === "string" &&
          name.startsWith("file:") &&
          JSON.stringify(value?.document ?? null).includes(marker)
        ) {
          log("put");
          this.transaction.addEventListener("complete", () => log("commit"));
          this.transaction.addEventListener("abort", () => log("abort"));
        }
        return put.call(this, value, name);
      };
      // A capture listener on the target runs before the app's own pagehide listeners.
      addEventListener("pagehide", () => log("pagehide"), { capture: true });
      const id = window.design.getDocument().pages[0].nodes[0].id;
      if (reload?.stalled) window.requestIdleCallback = () => 1;
      window.design.updateNodes([id], { name: marker });
      if (reload) setTimeout(() => location.reload(), reload.delay);
      return id;
    },
    { marker, reload },
  );
}
const unloadLog = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("test-unload-log") || "[]"));
// The write carrying the edit had not committed when the page started to go away.
const hitGap = (log) => !log.includes("commit") || log.indexOf("pagehide") < log.indexOf("commit");
const nodeName = (document, id) =>
  document.pages.flatMap((p) => p.nodes).find((n) => n.id === id)?.name;

(async () => {
  const dir = await fs.mkdtemp(`${os.tmpdir()}/verynize-unload-persistence-`);
  let app;
  const rounds = [];
  try {
    let page, errors;
    ({ app, page, errors } = await launch(dir));
    // The fresh profile's starter file, opened in the editor.
    await page.locator(".file-open").first().click();
    await page.waitForSelector("#canvas .layer");
    const fileId = await page.evaluate(() => window.fileLibrary.currentId);
    assert.ok(fileId);
    await readLibrary(page);

    // Reload 0–450 ms after the edit, and with the idle write stalled.
    for (const reload of [
      { delay: 0, stalled: true },
      { delay: 100, stalled: true },
      { delay: 0 },
      { delay: 0 },
      { delay: 10 },
      { delay: 50 },
      { delay: 150 },
      { delay: 450 },
    ]) {
      const delay = JSON.stringify(reload);
      const marker = `Reloaded ${rounds.length}`;
      const reloaded = page.waitForEvent("load");
      const id = await edit(page, marker, reload);
      await reloaded;
      await waitForUiReady(page);
      await page.waitForFunction(() => window.fileLibrary?.isReady() && !!window.design);
      const log = await unloadLog(page);
      rounds.push({ kind: "reload", delay, stalled: !!reload.stalled, log });
      assert.equal(
        await page.evaluate(() => window.fileLibrary.currentId),
        fileId,
        `reload ${delay} reopens the file`,
      );
      await page.waitForSelector("#canvas .layer");
      assert.equal(
        nodeName(await page.evaluate(() => window.design.getDocument()), id),
        marker,
        `reload ${delay}: the editor keeps the edit (${JSON.stringify(log)})`,
      );
      const stored = (await readLibrary(page)).files.find((f) => f.id === fileId);
      assert.equal(
        nodeName(stored.document, id),
        marker,
        `reload ${delay}: the stored library keeps the edit (${JSON.stringify(log)})`,
      );
    }

    // Quit 0–150 ms after the edit, then relaunch the profile.
    for (const delay of [0, 50, 150]) {
      const marker = `Relaunched ${rounds.length}`;
      const id = await edit(page, marker);
      if (delay) await new Promise((r) => setTimeout(r, delay));
      await app.close();
      ({ app, page, errors } = await launch(dir));
      const log = await unloadLog(page);
      rounds.push({ kind: "quit", delay, log });
      const stored = (await readLibrary(page)).files.find((f) => f.id === fileId);
      assert.equal(
        nodeName(stored.document, id),
        marker,
        `quit after ${delay} ms: the stored library keeps the edit (${JSON.stringify(log)})`,
      );
      if (new URL(page.url()).pathname === "/") await page.locator(".file-open").first().click();
      await page.waitForSelector("#canvas .layer");
      assert.equal(await page.evaluate(() => window.fileLibrary.currentId), fileId);
      assert.equal(
        nodeName(await page.evaluate(() => window.design.getDocument()), id),
        marker,
        `quit after ${delay} ms: the editor keeps the edit (${JSON.stringify(log)})`,
      );
    }

    console.log("rounds", JSON.stringify(rounds));
    assert.ok(
      rounds.some((round) => round.stalled && round.log.includes("put") && hitGap(round.log)),
      "a write started only as the page went away, and not seen committing before it left, is kept",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS library edits made 0–450 ms before a reload or quit, or still queued at unload, are kept in the editor and the stored library",
    );
  } catch (error) {
    console.log("rounds", JSON.stringify(rounds));
    throw error;
  } finally {
    await app?.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
