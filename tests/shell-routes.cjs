const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");

// The URL is the single source of truth for the top-level shell (web/src/lib/router/shell-router.ts):
// / Files home, /editor, /code (body.code-mode), /settings/<section> over the view in history state.
// Legacy entry points request a route and the route applies the view; this covers the code route,
// Back/Forward and reload across all four, Escape over home, settings over code, requests made while
// settings is closing (and a reload in that tick), requests made before the router bundle runs and
// the room fragment through all of it.
(async () => {
  const profile = await fs.mkdtemp(`${os.tmpdir()}/shell-routes-`);
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const ready = async () => {
      await waitForUiReady(page);
      await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
    };
    await ready();
    const state = () =>
      page.evaluate(() => ({
        path: location.pathname,
        hash: location.hash,
        index: history.state?.__TSR_index,
        length: history.length,
        home: document.body.classList.contains("files-view"),
        code: document.body.classList.contains("code-mode"),
        settings: document.body.classList.contains("settings-open")
          ? window.appSettings.getState().section
          : null,
      }));
    // URL, router, view classes and the settings overlay all agree.
    const expectShell = async (path, { under } = {}) => {
      await page
        .waitForFunction(
          ({ path, under }) => {
            if (path === "/editor")
              path = "/editor/" + encodeURIComponent(window.fileLibrary.currentId);
            const settings = path.startsWith("/settings/") ? path.slice(10) : null;
            const view = settings ? under : path;
            const body = document.body.classList;
            return (
              location.pathname === path &&
              window.shellRouter.state.location.pathname === path &&
              body.contains("files-view") === (view === "/") &&
              body.contains("code-mode") === (view === "/code") &&
              body.contains("settings-open") === !!settings &&
              (!settings || window.appSettings.getState().section === settings)
            );
          },
          { path, under },
          { timeout: 10000 },
        )
        .catch(async (error) => {
          const now = await state().catch(() => null);
          console.error(`expected ${path} (under ${under}), at ${JSON.stringify(now)}`);
          throw error;
        });
      return state();
    };
    const back = () => page.evaluate(() => history.back());
    const forward = () => page.evaluate(() => history.forward());
    const reload = async () => {
      await page.reload();
      await ready();
    };

    // Code mode is a route. The Design/Code switch and agentWorkspace.setCodeMode request it.
    await expectShell("/");
    await page.locator(".file-open").first().click();
    const start = await expectShell("/editor");
    await page.getByRole("radio", { name: "Code" }).click();
    let at = await expectShell("/code");
    assert.equal(at.index, start.index + 1, "entering code mode pushes /code");
    assert.equal(await page.evaluate(() => window.agentWorkspace.getState().codeMode), true);
    await page.getByRole("radio", { name: "Design" }).click();
    at = await expectShell("/editor");
    assert.equal(at.index, start.index + 2);
    // setCodeMode is synchronous for callers and repeated calls add nothing.
    assert.deepEqual(
      await page.evaluate(() => {
        window.agentWorkspace.setCodeMode(true);
        const on = document.body.classList.contains("code-mode");
        window.agentWorkspace.setCodeMode(true);
        return { on, path: window.shellRouter.history.location.pathname };
      }),
      { on: true, path: "/code" },
    );
    at = await expectShell("/code");
    assert.equal(at.index, start.index + 3);
    // Showing Files from code mode leaves code mode for the home (it is no longer opened hidden behind it).
    await page.evaluate(() => window.fileLibrary.showHome());
    at = await expectShell("/");
    assert.equal(at.index, start.index + 4);
    // Settings over code: Back to app returns to /code without an extra entry.
    await back();
    await expectShell("/code");
    await page.evaluate(() => window.appSettings.open("usage"));
    at = await expectShell("/settings/usage", { under: "/code" });
    assert.equal(at.index, start.index + 4);
    await reload();
    await expectShell("/settings/usage", { under: "/code" });
    await page.locator("#settings-back").click();
    at = await expectShell("/code");
    assert.equal(at.index, start.index + 3, "closing settings steps back to /code");

    // Back/Forward across all four routes, and reload on each.
    await page.evaluate(() => window.shellNavigation.navigate({ to: "/" }));
    await expectShell("/");
    await page.evaluate(() => window.appSettings.open("models"));
    await expectShell("/settings/models", { under: "/" });
    const trail = [
      ["/settings/models", "/"],
      ["/"],
      ["/code"],
      ["/editor"],
      ["/code"],
      ["/editor"],
    ];
    for (const [path, under] of trail.slice(1)) {
      await back();
      await expectShell(path, { under });
    }
    for (const [path, under] of trail.slice(0, -1).reverse()) {
      await forward();
      await expectShell(path, { under });
    }
    for (const [path, under] of trail) {
      await page.evaluate(
        ({ path }) =>
          path.startsWith("/settings/")
            ? window.shellNavigation.navigate({
                to: "/settings/$section",
                params: { section: path.slice(10) },
              })
            : window.shellNavigation.navigate({ to: path }),
        { path },
      );
      const before = await expectShell(path, { under: under ?? "/editor" });
      await reload();
      const after = await expectShell(path, { under: under ?? "/editor" });
      assert.equal(after.index, before.index, `reload keeps ${path}`);
    }

    // Escape over the Files home with settings open closes settings only.
    await page.evaluate(() => window.shellNavigation.navigate({ to: "/" }));
    const home = await expectShell("/");
    await page.evaluate(() => window.appSettings.open("account"));
    await expectShell("/settings/account", { under: "/" });
    await page.keyboard.press("Escape");
    at = await expectShell("/");
    assert.equal(at.index, home.index);
    await page.waitForTimeout(200);
    assert.deepEqual(await state(), at, "Escape closed settings and stayed on the Files home");
    await page.keyboard.press("Escape");
    await expectShell("/editor");

    // A request made while closing settings (history.back() not landed yet) is committed after landing.
    const editor = await expectShell("/editor");
    await page.evaluate(() => window.appSettings.open("tools"));
    await expectShell("/settings/tools", { under: "/editor" });
    assert.deepEqual(
      await page.evaluate(() => {
        window.appSettings.close();
        window.fileLibrary.showHome();
        return document.body.classList.contains("files-view");
      }),
      true,
    );
    at = await expectShell("/");
    assert.equal(at.index, editor.index + 1, "landed on /editor, then pushed /");
    // Closing then reloading in the same tick comes back closed (the URL used to lag one tick).
    await page.evaluate(() => window.appSettings.open("tools"));
    await expectShell("/settings/tools", { under: "/" });
    await page.evaluate(() => {
      window.appSettings.close();
      location.reload();
    });
    await page.waitForLoadState("domcontentloaded");
    await ready();
    await expectShell("/");
    await page.waitForTimeout(200);
    await expectShell("/");

    // The room fragment survives code mode, settings over code, Back/Forward and reload.
    const hash = "#room=11111111-1111-4111-8111-111111111111&token=a%2Fb%3D";
    await page.evaluate((hash) => (location.hash = hash), hash);
    await page.evaluate(() => document.getElementById("cloud-dialog")?.close());
    await page.evaluate(() => window.agentWorkspace.setCodeMode(true));
    await expectShell("/code");
    await page.evaluate(() => window.appSettings.open("preferences"));
    await expectShell("/settings/preferences", { under: "/code" });
    assert.equal((await state()).hash, hash);
    await back();
    await expectShell("/code");
    await page.evaluate(() => window.agentWorkspace.setCodeMode(false));
    await expectShell("/editor");
    await back();
    await expectShell("/code");
    await reload();
    await page.evaluate(() => document.getElementById("cloud-dialog")?.close());
    at = await expectShell("/code");
    assert.equal(at.hash, hash);
    await page.evaluate(() => (location.hash = ""));

    // A request made before the router bundle runs (settings opened while ui.js loads) is not lost: it is applied
    // over the startup URL's view.
    await page.evaluate(() => window.shellNavigation.navigate({ to: "/" }));
    await expectShell("/");
    await page.addInitScript(() => {
      let library;
      Object.defineProperty(window, "fileLibrary", {
        configurable: true,
        get: () => library,
        set(value) {
          library = value;
          // wonder-shell.js runs after settings.js and before dist/ui.js.
          if (window.shellNavigation || !sessionStorage.getItem("pre-router-open")) return;
          sessionStorage.removeItem("pre-router-open");
          window.appSettings.open("memory");
        },
      });
    });
    await page.evaluate(() => sessionStorage.setItem("pre-router-open", "1"));
    await reload();
    await expectShell("/settings/memory", { under: "/" });
    await page.locator("#settings-back").click();
    await expectShell("/");

    // Stored code mode must not override an explicit editor URL.
    await page.evaluate(() => {
      localStorage.setItem("verynize-code-mode", "1");
      window.shellNavigation.navigate({ to: "/editor" });
    });
    at = await expectShell("/editor");
    await reload();
    await page.waitForTimeout(500);
    assert.equal((await expectShell("/editor")).index, at.index, "a reload of /editor stays there");
    // A fresh load of /editor (a same-URL goto would be a reload, so leave it first), like the desktop launch.
    await page.evaluate(() => window.shellNavigation.navigate({ to: "/" }));
    await expectShell("/");
    await page.goto("app://verynize/editor");
    await ready();
    const launched = await page.evaluate(() => history.length);
    at = await expectShell("/editor");
    assert.equal(at.length, launched, "editor URL retains the launch entry");
    assert.deepEqual(errors, []);
    console.log(
      "PASS shell routes: /code route (switch, setCodeMode, showHome), settings over code, Back/Forward across home/editor/code/settings, reload on every route, Escape over home closes settings only, requests while closing settings, reload while closing, room fragment through code/settings/reload, pre-router request, explicit editor URL wins over stored code mode",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
