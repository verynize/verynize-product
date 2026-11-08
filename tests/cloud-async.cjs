const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-async-")),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${dir}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.cloudWorkspace && !!window.fileLibrary);
    await page.evaluate(() => {
      window.confirm = () => true;
      window.__requests = [];
      window.__events = [];
      window.addEventListener("design-publication-changed", (e) => window.__events.push(e.detail));
      window.WebSocket = class {
        static OPEN = 1;
        readyState = 0;
        send() {}
        close() {}
      };
      /* Background access checks (the Share popover's role and visibility) answer at once; the operations under test wait. */ window.fetch =
        (url, options) =>
          (url instanceof Request ? url.url : String(url)).endsWith("/access")
            ? Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({
                  role: "owner",
                  members: [],
                  visibility: "private",
                  organization: null,
                  you: {
                    role: "owner",
                    canInvite: true,
                    canChangeVisibility: true,
                    canClaim: false,
                  },
                }),
              })
            : new Promise((resolve) => window.__requests.push({ url, options, resolve }));
      window.__reply = (data) => {
        const r = window.__requests.shift();
        r.resolve({ ok: true, status: 200, json: async () => data });
      };
      document.getElementById("cloud-server").value = "http://localhost:9999";
      window.__room = { id: "11111111-1111-1111-1111-111111111111", token: "a".repeat(64) };
      window.__remote = structuredClone(window.design.getDocument());
      window.__remote.name = "Remote A";
      document.getElementById("cloud-invite").value =
        "http://localhost:9999/#" +
        new URLSearchParams({ room: window.__room.id, token: window.__room.token });
    });
    const start = async (id) => {
      await page.evaluate((id) => {
        window.__operation = document.getElementById(id).onclick();
      }, id);
      await page.waitForFunction(() => window.__requests.length === 1);
    };
    const reply = async (data) => {
      await page.evaluate((data) => window.__reply(data), data);
      await page.evaluate(() => window.__operation);
    };
    const switchDoc = () =>
      page.evaluate(async () => {
        const doc = window.design.getDocument();
        doc.name = "Private B";
        await window.fileLibrary.createFromDocument(doc);
      });
    await start("cloud-create");
    await switchDoc();
    await reply(await page.evaluate(() => window.__room));
    assert.equal(await page.evaluate(() => window.cloudWorkspace.isConnected()), false);
    assert.equal(await page.evaluate(() => window.__requests.length), 0);
    await start("cloud-connect");
    await switchDoc();
    await reply(await page.evaluate(() => ({ document: window.__remote, revision: 0 })));
    assert.equal(await page.evaluate(() => window.design.getDocument().name), "Private B");
    assert.equal(await page.evaluate(() => window.cloudWorkspace.isConnected()), false);
    const nativeA = path.join(dir, "local-a.verynize.json"),
      nativeB = path.join(dir, "shared-b.verynize.json");
    await app.evaluate(
      ({ dialog }, paths) => {
        globalThis.__saveCalls = 0;
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: paths[globalThis.__saveCalls++],
        });
      },
      [nativeA, nativeB],
    );
    const retainedId = await page.evaluate(async () => {
      const result = await window.desktop.designSave({ document: window.design.getDocument() });
      window.fileLibrary.setNativePath(result.path);
      return window.fileLibrary.currentId;
    });
    let checkedJoin = false;
    for (const id of ["cloud-publish", "cloud-unpublish", "cloud-reload", "cloud-overwrite"]) {
      await start("cloud-connect");
      await reply(await page.evaluate(() => ({ document: window.__remote, revision: 0 })));
      assert.equal(await page.evaluate(() => window.cloudWorkspace.isConnected()), true);
      if (!checkedJoin) {
        assert.notEqual(await page.evaluate(() => window.fileLibrary.currentId), retainedId);
        assert.equal(
          await page.evaluate(
            (id) => window.fileLibrary.list().find((f) => f.id === id).document.name,
            retainedId,
          ),
          "Private B",
        );
        await page.evaluate(() =>
          window.desktop.designSave({ document: window.design.getDocument() }),
        );
        assert.equal(await app.evaluate(() => globalThis.__saveCalls), 2);
        assert.equal(JSON.parse(await fs.readFile(nativeA, "utf8")).name, "Private B");
        assert.equal(JSON.parse(await fs.readFile(nativeB, "utf8")).name, "Remote A");
        checkedJoin = true;
      }
      await start(id);
      await switchDoc();
      await reply(
        await page.evaluate(() => ({
          document: window.__remote,
          revision: 8,
          publicId: "public-snapshot",
        })),
      );
      assert.equal(await page.evaluate(() => window.design.getDocument().name), "Private B", id);
      assert.equal(await page.evaluate(() => window.cloudWorkspace.isConnected()), false, id);
      assert.equal(await page.evaluate(() => window.__events.length), 0, id);
      assert.equal(await page.evaluate(() => window.__requests.length), 0, id);
    }
    const beforeRace = await page.evaluate(() => window.fileLibrary.list().length);
    await page.evaluate(() => {
      const original = window.documentLifecycle.prepareSwitch.bind(window.documentLifecycle);
      window.documentLifecycle.prepareSwitch = async (options) => {
        await original(options);
        if (options?.cloudJoinEpoch !== undefined)
          await new Promise((resolve) => (window.__releaseJoin = resolve));
      };
    });
    await start("cloud-connect");
    await page.evaluate(() => window.__reply({ document: window.__remote, revision: 0 }));
    await page.waitForFunction(() => !!window.__releaseJoin);
    await switchDoc();
    await page.evaluate(() => window.__releaseJoin());
    await page.evaluate(() => window.__operation);
    assert.equal(await page.evaluate(() => window.design.getDocument().name), "Private B");
    assert.equal(await page.evaluate(() => window.fileLibrary.list().length), beforeRace + 1);
    assert.equal(await page.evaluate(() => window.cloudWorkspace.isConnected()), false);
    console.log(
      "PASS joining retains prior library/native document and saves separately; stale create, connect, publish, unpublish, conflict reload and overwrite completions cannot mutate a newly selected document",
    );
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
