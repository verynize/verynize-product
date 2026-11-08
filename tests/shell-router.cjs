const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");

(async () => {
  const profile = await fs.mkdtemp(`${os.tmpdir()}/shell-router-`);
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await waitForUiReady(page);
    await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
    // Desktop serves the renderer from app://verynize, so routes own the real URL path.
    assert.equal(await page.evaluate(() => location.origin), "app://verynize");
    const ipcWorks = () =>
      page.evaluate(() => window.desktop.onboardingState().then((s) => s.skip === true));
    const documentBefore = await page.evaluate(() => window.design.getDocument());
    const expectView = async (path) => {
      await page.waitForFunction((path) => {
        if (path === "/editor")
          path = "/editor/" + encodeURIComponent(window.fileLibrary.currentId);
        return (
          window.shellRouter.state.location.pathname === path &&
          location.pathname === path &&
          document.body.classList.contains("files-view") === (path === "/")
        );
      }, path);
    };
    await expectView("/");
    await page.locator(".file-open").first().click();
    await expectView("/editor");
    await page.evaluate(() => window.shellRouter.history.back());
    await expectView("/");
    await page.evaluate(() => window.shellRouter.history.forward());
    await expectView("/editor");
    await page.evaluate(() => window.shellRouter.navigate({ to: "/" }));
    await expectView("/");
    await page.keyboard.press("Escape");
    await expectView("/editor");
    // Repeated legacy calls must not create duplicate entries.
    const length = await page.evaluate(() => window.shellRouter.history.length);
    await page.evaluate(() => {
      window.fileLibrary.showEditor();
      window.fileLibrary.showEditor();
    });
    assert.equal(await page.evaluate(() => window.shellRouter.history.length), length);
    // Two view changes in one tick: the URL follows the last one (router state lags history).
    await page.evaluate(() => {
      window.fileLibrary.showHome();
      window.fileLibrary.showEditor();
    });
    await expectView("/editor");
    await page.waitForTimeout(300);
    await expectView("/editor");
    assert.equal(
      new URL(page.url()).pathname,
      await page.evaluate(() => "/editor/" + encodeURIComponent(window.fileLibrary.currentId)),
    );
    assert.ok(await ipcWorks(), "IPC after route changes");
    assert.deepEqual(await page.evaluate(() => window.design.getDocument()), documentBefore);
    // Cloud fragments: every navigation path keeps #room=/#public= by construction.
    const ROOM = "11111111-1111-4111-8111-111111111111";
    const TOKEN = "ab".repeat(32);
    const state = () =>
      page.evaluate(() => ({
        path: location.pathname,
        hash: location.hash,
        index: history.state?.__TSR_index,
        length: history.length,
        settings: document.body.classList.contains("settings-open"),
      }));
    const expectAt = async (path, hash) => {
      await expectView(path);
      await page.waitForFunction((hash) => location.hash === hash, hash);
    };
    const nativeBack = () => page.evaluate(() => history.back());
    const nativeForward = () => page.evaluate(() => history.forward());
    for (const hash of [`#room=${ROOM}&token=a%2Fb%3D`, "#public=router-test"]) {
      await page.evaluate((hash) => (location.hash = hash), hash);
      await page.evaluate(() => window.fileLibrary.showHome());
      await expectAt("/", hash);
      await page.evaluate(() => window.fileLibrary.showEditor());
      await expectAt("/editor", hash);
      // Direct router navigation without hash: true.
      await page.evaluate(() => window.shellRouter.navigate({ to: "/" }));
      await expectAt("/", hash);
      await page.evaluate(() => window.shellNavigation.navigate({ to: "/editor" }));
      await expectAt("/editor", hash);
      // Raw history push.
      await page.evaluate(() => window.shellRouter.history.push("/"));
      await expectAt("/", hash);
      // Navigating to the current path must not add an entry (the fragment makes it the same URL).
      const before = await state();
      await page.evaluate(() => window.shellRouter.navigate({ to: "/" }));
      await page.evaluate(() => window.shellRouter.navigate({ to: "/", hash: true }));
      await page.evaluate(() => window.fileLibrary.showHome());
      assert.deepEqual(await state(), before);
      // Native Back/Forward.
      await nativeBack();
      await expectAt("/editor", hash);
      await nativeForward();
      await expectAt("/", hash);
      // The settings route keeps it while opening, switching sections and closing.
      await page.evaluate(() => window.appSettings.open("usage"));
      await page.waitForFunction(() => location.pathname === "/settings/usage");
      assert.equal((await state()).hash, hash);
      await page.evaluate(() => window.appSettings.select("models"));
      await page.waitForFunction(() => location.pathname === "/settings/models");
      assert.equal((await state()).hash, hash);
      await page.locator("#settings-back").click();
      await expectAt("/", hash);
      // Reload keeps path and fragment.
      await page.reload();
      await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
      await expectAt("/", hash);
      await page.evaluate(() => (location.hash = ""));
    }

    // Invite fragment on the app window's own address: it is no http(s) link (collab/links.ts opens those), so nothing
    // opens and no dialog asks; the hash survives navigation.
    const invite = `#room=${ROOM}&token=${TOKEN}`;
    // From app://verynize/ a goto to the same path would only change the fragment: load it fresh.
    await page.goto(`app://verynize/editor`);
    await page.goto(`app://verynize/${invite}`);
    await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
    await expectAt("/", invite);
    assert.equal(await page.evaluate(() => document.getElementById("cloud-dialog").open), false);
    await page.evaluate(() => window.shellRouter.navigate({ to: "/editor" }));
    await expectAt("/editor", invite);

    // Leaving the room clears its fragment; Back onto an older entry of that room drops it again.
    await page.reload();
    await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
    await page.evaluate(() => document.getElementById("cloud-dialog").close());
    const fakeServer = (room) =>
      page.evaluate((room) => {
        window.confirm = () => true;
        window.WebSocket = class {
          static OPEN = 1;
          readyState = 0;
          send() {}
          close() {}
        };
        const remote = structuredClone(window.design.getDocument());
        window.fetch = async (url) => {
          const data = new URL(String(url)).pathname.endsWith(`/api/rooms/${room}`)
            ? { document: remote, revision: 0, role: "owner" }
            : {};
          return { ok: true, status: 200, json: async () => data };
        };
      }, room);
    await fakeServer(ROOM);
    await page.evaluate(
      ({ ROOM, TOKEN }) =>
        window.cloudWorkspace.openRoom({ server: "http://localhost:9999", id: ROOM, token: TOKEN }),
      { ROOM, TOKEN },
    );
    await page.waitForFunction(() => window.cloudWorkspace.isConnected());
    await page.evaluate(() => window.fileLibrary.showHome());
    await expectAt("/", invite);
    const beforeLeave = await state();
    await page.evaluate(() => document.getElementById("cloud-leave").onclick());
    await expectAt("/", "");
    assert.equal(await page.evaluate(() => window.cloudWorkspace.isConnected()), false);
    assert.equal((await state()).index, beforeLeave.index, "leaving replaces, never pushes");
    await nativeBack();
    await expectAt("/editor", "");
    await page.reload();
    await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
    await expectAt("/editor", "");
    assert.equal(await page.evaluate(() => document.getElementById("cloud-dialog").open), false);

    // verynize://join deep link while settings is open: settings closes (Back to the view it was
    // opened from), the room joins, and the capability token never enters the app:// URL.
    await fakeServer(ROOM);
    const beforeSettings = await state();
    await page.evaluate(() => window.appSettings.open("preferences"));
    await page.waitForFunction(() => location.pathname === "/settings/preferences");
    const invitation = `http://localhost:9999/#room=${ROOM}&token=${TOKEN}`;
    const link = `verynize://join?invite=${encodeURIComponent(invitation)}`;
    await app.evaluate(
      ({ app }, link) => app.emit("open-url", { preventDefault() {} }, link),
      link,
    );
    await page.waitForFunction(() => window.cloudWorkspace.isConnected());
    await expectAt("/editor", "");
    const afterLink = await state();
    assert.equal(afterLink.settings, false);
    assert.equal(afterLink.index, beforeSettings.index);
    await page.evaluate(() => document.getElementById("cloud-leave").onclick());

    // A reload on a route lands on the same view, with IPC still trusted.
    await page.evaluate(() => window.fileLibrary.showHome());
    await expectView("/");
    await page.reload();
    await waitForUiReady(page);
    await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
    await expectView("/");
    await page.evaluate(() => window.shellRouter.navigate({ to: "/editor" }));
    await expectView("/editor");
    await page.reload();
    await waitForUiReady(page);
    await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
    await expectView("/editor");
    assert.ok(await ipcWorks(), "IPC after reloading /editor");
    console.log(
      "PASS shell router: app:// browser history, URL path sync, reload on routes, route/view sync, Back/Forward, Escape, deduplication, document; cloud fragment kept through legacy/router/history/settings navigation, Back/Forward and reload; invite link; leaving clears it; verynize://join keeps the token out of the URL",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
