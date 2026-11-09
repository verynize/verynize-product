// The file library never creates files on its own (web/wonder-shell.js `mayFile`), and the canvas is drawn only while the
// editor shows (web/app.js `canvasHidden`):
// (a) a fresh profile gets one starter file, once;
// (b) a stored library whose open file is gone (deleted, or a signed-in file that never reached the database) gets no
//     new "Untitled" file at launch, on the Files home or across relaunches; an edit in the editor does create one;
// (c) a profile whose files were all deleted stays empty;
// (d) edits made while the Files home shows reach the canvas when the editor shows again.
const { _electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os");

const doc = (name) => ({
  version: 2,
  name,
  activePage: "p1",
  tokens: {},
  pages: [
    {
      id: "p1",
      name: "Page 1",
      nodes: [
        { id: "r1", type: "rectangle", name: "Box", x: 10, y: 10, w: 100, h: 80, color: "#8844cc" },
      ],
    },
  ],
});
const file = (id, document) => ({
  id,
  name: document.name,
  document,
  updated: Date.now(),
  folder: null,
  archived: false,
});

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
  return { app, page, errors };
}
/** Replaces the stored state and reloads before anything renders again. */
async function seed(page, { current, library }) {
  const reloaded = page.waitForEvent("load");
  await page.evaluate(
    async ({ current, library }) => {
      await window.fileLibrary.flush();
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase("verynize-library");
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });
      localStorage.setItem("verynize-v2", current);
      localStorage.setItem("verynize-library-v1", JSON.stringify(library));
      // oxlint-disable-next-line typescript/unbound-method -- monkey-patch: the original is re-invoked with .call(this) or restored
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "verynize-v2" || key === "verynize-library-v1") return;
        return set.call(this, key, value);
      };
      location.reload();
    },
    { current, library },
  );
  await reloaded;
  await waitForUiReady(page);
}
const storedLibrary = require("./helpers/library-store.cjs").readLibrary;
const fileIds = async (page) => ((await storedLibrary(page))?.files || []).map((f) => f.id).sort();
// Gives every startup render, save and library sync a chance to (wrongly) create a file.
const settle = (page) => page.waitForTimeout(2000);
const layers = (page) => page.locator("#canvas .layer").count();

(async () => {
  const dir = await fs.mkdtemp(`${os.tmpdir()}/verynize-implicit-files-`);
  let app;
  try {
    let page, errors;
    ({ app, page, errors } = await launch(dir));

    // (a) A fresh profile: one starter file on Home, opened only after selecting it.
    assert.equal(new URL(page.url()).pathname, "/");
    await page.locator(".file-open").first().click();
    await page.waitForSelector("#canvas .layer");
    await settle(page);
    const starter = await storedLibrary(page);
    assert.equal(starter.files.length, 1, "one starter file");
    assert.equal(starter.seeded, true);
    assert.equal(new URL(page.url()).pathname, `/editor/${starter.files[0].id}`);
    await page.reload();
    await waitForUiReady(page);
    await settle(page);
    assert.deepEqual(await fileIds(page), [starter.files[0].id], "no second starter on reload");

    // (b) The open file is gone: no file appears at launch, on the Files home or after a relaunch.
    const kept = doc("Kept");
    await seed(page, {
      current: JSON.stringify(doc("Placeholder")),
      library: { files: [file("kept", kept)], folders: [], active: "gone", seeded: true },
    });
    await settle(page);
    assert.deepEqual(await fileIds(page), ["kept"], "no file for the missing open file");
    await page.evaluate(() => window.design.setCamera(20, 20, 1));
    await settle(page);
    assert.deepEqual(await fileIds(page), ["kept"], "a view change is no edit");
    await app.close();
    ({ app, page, errors } = await launch(dir));
    await settle(page);
    assert.deepEqual(await fileIds(page), ["kept"], "no file after a relaunch");

    // An edit in the editor keeps the work: it becomes a file.
    await page.evaluate(() => window.fileLibrary.applyEditor());
    await page.evaluate(() => window.design.updateNodes(["r1"], { name: "Edited" }));
    await page.waitForFunction(
      () => window.fileLibrary.list().length === 2,
    );
    const edited = (await storedLibrary(page)).files.find((f) => f.id !== "kept");
    assert.equal(edited.document.pages[0].nodes[0].name, "Edited");

    // (c) Every file deleted: the profile stays empty.
    await seed(page, {
      current: JSON.stringify(doc("Leftover")),
      library: { files: [], folders: [], active: null, seeded: true },
    });
    await settle(page);
    assert.deepEqual(await fileIds(page), [], "no file resurrected");

    // (d) The canvas is drawn while the editor shows only, and catches up when it shows again.
    await seed(page, {
      current: JSON.stringify(kept),
      library: { files: [file("kept", kept)], folders: [], active: "kept", seeded: true },
    });
    await page.evaluate(() => window.fileLibrary.showEditor());
    await page.waitForSelector('#canvas .layer[data-id="r1"]');
    assert.equal(await layers(page), 1);
    await page.evaluate(() => window.fileLibrary.showHome());
    await page.waitForFunction(() => document.body.classList.contains("files-view"));
    await page.evaluate(() => window.design.updateNodes(["r1"], { name: "Home edit", w: 140 }));
    assert.equal(
      await page.locator('#canvas .layer[data-id="r1"]').evaluate((e) => e.style.width),
      "100px",
      "the hidden canvas is not redrawn",
    );
    await page.evaluate(() => window.fileLibrary.showEditor());
    await page.waitForFunction(
      () => document.querySelector('#canvas .layer[data-id="r1"]')?.style.width === "140px",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS library implicit files: one starter, no file for missing/deleted open files or the Files home, edits kept, canvas drawn only in the editor",
    );
  } finally {
    await app?.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
