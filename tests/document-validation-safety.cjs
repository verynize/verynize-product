// Stored documents the shared schema (web/document-core.js) rejects are never silently replaced (web/document-safety.js):
// (a) a repairable legacy document loads repaired, with a notice and a backup of the original;
// (b) an unrepairable one is kept in localStorage, backed up and announced; neither save() nor the file library
//     overwrite it until the user edits, also across a relaunch;
// (c) a file-library entry that fails stays listed and marked, and opening it changes nothing;
// (d) a native .verynize.json the store refuses is left untouched and nothing opens.
const { waitForAsync } = require("./helpers/wait-for-async.cjs");
const { check: checkAsyncWaits } = require("../scripts/check-async-waits.cjs");
const { _electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");

const rect = (id, extra = {}) => ({
  id,
  type: "rectangle",
  name: id,
  x: 10,
  y: 10,
  w: 100,
  h: 80,
  color: "#8844cc",
  ...extra,
});
const doc = (name, nodes, pageId = "p-" + name.replace(/\W/g, "")) => ({
  version: 2,
  name,
  activePage: pageId,
  tokens: {},
  pages: [{ id: pageId, name: "Page 1", nodes }],
});
const file = (id, document, updated = Date.now()) => ({
  id,
  name: document.name,
  document,
  updated,
  folder: null,
  archived: false,
});
// Ids are never rewritten and unknown layer types never guessed: two problems the canvas cannot repair.
const broken = doc("Broken", [rect("i".repeat(250)), rect("blob", { type: "blob" }), rect("ok")]);
const legacy = doc("Legacy", [
  rect("far", { x: 2_500_000 }),
  rect("long", { name: "L".repeat(300) }),
  rect("kept", { x: 40 }),
]);
const good = doc("Good", [rect("g1")]);

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
      // The outgoing page still holds its own document and may save it (a media-query re-render) before the reload
      // commits; only the seeded state may reach the next page.
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
const stored = (page, key) => page.evaluate((key) => localStorage.getItem(key), key);
const storedLibrary = require("./helpers/library-store.cjs").readLibrary;
const notices = (page) => page.evaluate(() => window.documentSafety.notices());
const backups = (page) => page.evaluate(() => window.documentSafety.backups());
const waitNotice = (page, kind) =>
  page.waitForFunction(
    (kind) => window.documentSafety.notices().some((n) => n.kind === kind),
    kind,
    { timeout: 10000 },
  );
// Gives every startup timer, save and library sync a chance to (wrongly) write.
const settle = (page) => page.waitForTimeout(2500);

// Exercise the shared poller against real renderer Promises (also through a Frame).
async function asyncWaits(dir) {
  checkAsyncWaits();
  const { app, page } = await launch(dir);
  try {
    await page.evaluate(() => {
      window.__asyncPolls = 0;
    });
    const result = await waitForAsync(
      page,
      async (target) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return ++window.__asyncPolls >= target && "ready";
      },
      3,
      { interval: 5 },
    );
    assert.equal(result, "ready");
    assert.equal(await page.evaluate(() => window.__asyncPolls), 3);
    assert.equal(await waitForAsync(page.mainFrame(), () => Promise.resolve("frame")), "frame");
    await assert.rejects(
      waitForAsync(page, () => Promise.resolve(false), null, { timeout: 100, interval: 5 }),
      /timed out after 100ms/,
    );
    await assert.rejects(
      // Keep the pending Promise reachable: an unreferenced one can be garbage collected before the
      // timeout, which Playwright reports as a different error.
      waitForAsync(page, () => (window.__pendingWait = new Promise(() => {})), null, {
        timeout: 100,
      }),
      /timed out after 100ms/,
    );
    await assert.rejects(
      waitForAsync(page, () => Promise.reject(new Error("predicate failed"))),
      /predicate failed/,
    );
  } finally {
    await app.close();
  }
}

async function repairable(dir) {
  const { app, page, errors } = await launch(dir);
  try {
    const text = JSON.stringify(legacy);
    await seed(page, {
      current: text,
      library: { files: [file("legacy", legacy)], folders: [], active: "legacy" },
    });
    await waitNotice(page, "repaired");
    const shown = await page.evaluate(() => window.design.getDocument());
    assert.equal(shown.name, "Legacy", "the stored document loads");
    const nodes = Object.fromEntries(shown.pages[0].nodes.map((n) => [n.id, n]));
    assert.deepEqual(Object.keys(nodes), ["far", "long", "kept"], "every layer is kept");
    assert.equal(nodes.far.x, 1e6, "coordinates clamped");
    assert.equal(nodes.long.name, "L".repeat(200), "name cut to 200 characters");
    assert.equal(nodes.kept.x, 40);
    const [notice] = await notices(page);
    assert.match(notice.text, /Repaired “Legacy”/);
    assert.match(notice.text, /2 values/);
    assert.match(notice.text, /backed up/);
    await waitForAsync(page, () => window.documentSafety.backups().then((b) => b.length > 0));
    const [saved] = await backups(page);
    assert.equal(saved.text, text, "the original text is backed up byte for byte");
    assert.equal(saved.reason, "repaired");
    assert.deepEqual(
      saved.repairs.map((r) => r.path),
      ["pages[0].nodes[0].x", "pages[0].nodes[1].name"],
    );
    await page.click('#document-notices [data-kind="repaired"] .document-notice-dismiss');
    assert.equal(
      (await notices(page)).filter((n) => n.kind === "repaired").length,
      0,
      "the repair notice is dismissable",
    );
    await waitNotice(page, "advisory");
    await page.evaluate(() =>
      window.design.updateNodes(["kept"], { name: "Saved alongside overflow" }),
    );
    await settle(page);
    assert.equal(
      JSON.parse(await stored(page, "verynize-v2")).pages[0].nodes[2].name,
      "Saved alongside overflow",
      "out-of-range documents still save",
    );
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
}

async function unrepairable(dir) {
  const text = JSON.stringify(broken);
  let { app, page, errors } = await launch(dir);
  try {
    await seed(page, {
      current: text,
      library: { files: [file("broken", broken)], folders: [], active: "broken" },
    });
    await waitNotice(page, "failed");
    const check = async (label) => {
      const [notice] = await notices(page);
      assert.equal(notice.kind, "failed", label);
      assert.match(notice.text, /Couldn’t open “Broken”/, label);
      assert.match(notice.text, /Node id must be a nonempty string/, label + ": first error");
      assert.match(notice.text, /\(2 problems\)/, label + ": problem count");
      assert.match(notice.text, /Export JSON/, label);
      assert.notEqual((await page.evaluate(() => window.design.getDocument())).name, "Broken");
      assert.equal(await stored(page, "verynize-v2"), text, label + ": stored document untouched");
      const lib = await storedLibrary(page);
      assert.deepEqual(
        lib.files.map((f) => f.id),
        ["broken"],
        label + ": no placeholder file added",
      );
      assert.deepEqual(lib.files[0].document, broken, label + ": library entry untouched");
      await waitForAsync(page, () => window.documentSafety.backups().then((b) => b.length === 1));
      const [saved] = await backups(page);
      assert.equal(saved.text, text, label + ": backed up once");
      assert.equal(saved.reason, "invalid");
    };
    await settle(page);
    await page.evaluate(() => window.design.setCamera(10, 10, 1));
    await settle(page);
    await check("after the autosave interval");
    assert.deepEqual(errors, []);
    await app.close();

    ({ app, page, errors } = await launch(dir));
    await waitNotice(page, "failed");
    await settle(page);
    await check("after a relaunch");

    // The library marks the entry; opening it changes nothing.
    await page.evaluate(() => window.fileLibrary.showHome());
    const card = page.locator('[data-file-id="broken"][data-invalid="true"]');
    await card.waitFor();
    assert.match(await card.textContent(), /Can’t open/);

    // Editing the placeholder (the backup exists) releases the hold: the edit is saved and goes to a new file.
    await page.evaluate(() => window.fileLibrary.showEditor());
    await page.evaluate(() => {
      const id = window.design.getDocument().pages[0].nodes[0].id;
      window.design.updateNodes([id], { name: "Edited placeholder" });
    });
    await page.waitForFunction(() =>
      localStorage.getItem("verynize-v2").includes("Edited placeholder"),
    );
    const lib = await storedLibrary(page);
    assert.equal(lib.files.length, 2, "the edit is stored as a new file");
    assert.deepEqual(
      lib.files.find((f) => f.id === "broken").document,
      broken,
      "the invalid entry stays",
    );
    assert.notEqual(lib.active, "broken");
    assert.equal((await backups(page))[0].text, text, "the backup survives");
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
}

async function library(dir) {
  const { app, page, errors } = await launch(dir);
  try {
    const old = doc("Old lib", [rect("o1", { x: -3e6 })]);
    await seed(page, {
      current: JSON.stringify(good),
      library: {
        files: [
          file("good", good, 3),
          file("bad", { ...broken, name: "Broken lib" }, 2),
          file("old", old, 1),
        ],
        folders: [],
        active: "good",
      },
    });
    await settle(page);
    assert.deepEqual(await notices(page), [], "a valid start shows nothing");
    await page.evaluate(() => window.fileLibrary.showHome());
    const bad = page.locator('[data-file-id="bad"]');
    await bad.locator("text=Can’t open").waitFor();
    assert.equal(await bad.getAttribute("data-invalid"), "true");
    assert.equal(await page.locator('[data-file-id="good"]').getAttribute("data-invalid"), null);
    assert.equal(
      await page.locator('[data-file-id="old"]').getAttribute("data-invalid"),
      null,
      "repairable entries open",
    );
    const listed = await page.evaluate(
      () => window.fileLibrary.list().find((f) => f.id === "bad").invalid,
    );
    assert.equal(listed.count, 2);
    await bad.locator('[aria-label="Open Broken lib"]').click();
    await waitNotice(page, "failed");
    const [notice] = await notices(page);
    assert.match(
      notice.text,
      /Couldn’t open “Broken lib”.*\(2 problems\).*stays in your files unchanged/s,
    );
    assert.equal(
      await page.evaluate(() => window.fileLibrary.currentId),
      "good",
      "nothing else opened",
    );
    assert.equal((await page.evaluate(() => window.design.getDocument())).name, "Good");
    await settle(page);
    let lib = await storedLibrary(page);
    assert.deepEqual(
      lib.files.map((f) => f.id),
      ["good", "bad", "old"],
      "still listed",
    );
    assert.deepEqual(lib.files[1].document, { ...broken, name: "Broken lib" }, "unchanged");

    // A repairable entry opens repaired, and its original is backed up first.
    await page.evaluate(() => window.fileLibrary.open("old"));
    await waitNotice(page, "repaired");
    assert.equal(
      (await page.evaluate(() => window.design.getDocument())).pages[0].nodes[0].x,
      -1e6,
    );
    await waitForAsync(page, () =>
      window.documentSafety.backups().then((b) => b.some((x) => x.source === "library")),
    );
    const saved = (await backups(page)).find((b) => b.source === "library");
    assert.deepEqual(JSON.parse(saved.text), old);
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
}

async function native(dir, work) {
  const { app, page, errors } = await launch(dir);
  try {
    const target = path.join(work, "broken.verynize.json"),
      bytes = JSON.stringify(doc("On disk", [rect("d1", { x: 2e6 }), rect("", {})]), null, 2);
    await fs.writeFile(target, bytes);
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    }, target);
    const before = await page.evaluate(() => window.design.getDocument());
    await page.evaluate(() => document.getElementById("open-project").click());
    await waitNotice(page, "failed");
    const [notice] = await notices(page);
    assert.match(notice.text, /broken\.verynize\.json was not opened and is unchanged/);
    assert.match(notice.text, /\(2 problems\)/);
    assert.equal(await fs.readFile(target, "utf8"), bytes, "the file is untouched");
    assert.deepEqual(
      await page.evaluate(() => window.design.getDocument()),
      before,
      "nothing opened",
    );
    assert.equal(
      await page.evaluate(() => window.fileLibrary.list().some((f) => f.nativePath)),
      false,
      "no library entry for the file",
    );
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
  }
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "document-validation-safety-"));
  try {
    const dir = (name) => path.join(root, name);
    await asyncWaits(dir("async"));
    console.log(
      "ok async wait retries false, awaits Promise, supports Frame, times out and propagates errors",
    );
    await repairable(dir("a"));
    console.log("ok repairable legacy document loads repaired, announced and backed up");
    await unrepairable(dir("b"));
    console.log(
      "ok unrepairable document kept, backed up, announced, not overwritten across relaunch",
    );
    await library(dir("c"));
    console.log("ok failing library entry stays listed, marked and unchanged");
    const work = dir("files");
    await fs.mkdir(work);
    await native(dir("d"), work);
    console.log("ok refused native file left untouched, nothing opened");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
