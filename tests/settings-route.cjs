const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { mod } = require("./helpers/keys.cjs");
const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");

// /settings/<section> mirrors the settings overlay. The view underneath lives in history state:
// opening pushes one entry, switching sections replaces it, closing returns to the entry it was
// opened from (no extra entries), Back closes it, Forward and reload reopen it over the same view.
(async () => {
  const profile = await fs.mkdtemp(`${os.tmpdir()}/settings-route-`);
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1", VERYNIZE_LAUNCH_EDITOR: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    const ready = async () => {
      await waitForUiReady(page);
      await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
    };
    await ready();
    const state = () =>
      page.evaluate(() => ({
        path: location.pathname,
        index: history.state?.__TSR_index,
        length: history.length,
        open: document.body.classList.contains("settings-open"),
        section: window.appSettings.getState().section,
        home: document.body.classList.contains("files-view"),
      }));
    // Waits until URL, router, overlay and the view underneath agree.
    const expectShell = async (path, { home = false } = {}) => {
      await page.waitForFunction(
        ({ path, home }) => {
          if (path === "/editor")
            path = "/editor/" + encodeURIComponent(window.fileLibrary.currentId);
          const settings = path.startsWith("/settings/");
          return (
            location.pathname === path &&
            window.shellRouter.state.location.pathname === path &&
            document.body.classList.contains("settings-open") === settings &&
            (!settings || window.appSettings.getState().section === path.slice(10)) &&
            document.body.classList.contains("files-view") === home
          );
        },
        { path, home },
      );
      return state();
    };
    const back = () => page.evaluate(() => history.back());
    const forward = () => page.evaluate(() => history.forward());

    const start = await expectShell("/editor");
    // Open from the app menu.
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.locator("#shell-settings").click();
    let at = await expectShell("/settings/preferences");
    assert.equal(at.index, start.index + 1, "opening settings pushes one entry");
    // Switching sections replaces the entry.
    await page.locator("#settings-nav button").filter({ hasText: "Usage" }).click();
    at = await expectShell("/settings/usage");
    assert.equal(at.index, start.index + 1, "section changes replace");
    // Repeated open/select calls do not add entries.
    await page.evaluate(() => {
      window.appSettings.open("usage");
      window.appSettings.select("usage");
    });
    assert.deepEqual(await state(), at);
    // Back closes settings; Forward reopens the same section.
    await back();
    at = await expectShell("/editor");
    assert.equal(at.index, start.index);
    await forward();
    at = await expectShell("/settings/usage");
    // Closing (Back to app) returns to the entry it was opened from instead of adding one.
    await page.locator("#settings-back").click();
    at = await expectShell("/editor");
    assert.equal(at.index, start.index);
    assert.equal(at.length, start.length + 1, "only the settings entry was ever added");
    // ⌘, opens; Escape closes.
    await page.keyboard.press(mod("Comma"));
    at = await expectShell("/settings/preferences");
    assert.equal(at.index, start.index + 1);
    await page.keyboard.press("Escape");
    at = await expectShell("/editor");
    assert.equal(at.index, start.index);

    // Over Files home: reload restores the view underneath from history state; Back returns to it.
    await page.locator("#files-home").click();
    const home = await expectShell("/", { home: true });
    await page.evaluate(() => window.appSettings.open("account"));
    at = await expectShell("/settings/account", { home: true });
    assert.equal(at.index, home.index + 1);
    await page.reload();
    await ready();
    at = await expectShell("/settings/account", { home: true });
    assert.equal(at.index, home.index + 1);
    await back();
    at = await expectShell("/", { home: true });
    assert.equal(at.index, home.index);
    await forward();
    await expectShell("/settings/account", { home: true });
    await page.locator("#settings-back").click();
    at = await expectShell("/", { home: true });
    assert.equal(at.index, home.index);

    // Router-initiated navigation opens and closes the overlay too, over the view it came from.
    const openModels = () =>
      page.evaluate(() =>
        window.shellNavigation.navigate({
          to: "/settings/$section",
          params: { section: "models" },
        }),
      );
    await openModels();
    at = await expectShell("/settings/models", { home: true });
    assert.equal(at.index, home.index + 1);
    await page.locator("#settings-back").click();
    at = await expectShell("/", { home: true });
    assert.equal(at.index, home.index, "closing a router-pushed settings entry goes back");
    await openModels();
    await expectShell("/settings/models", { home: true });
    await page.evaluate(() => window.shellNavigation.navigate({ to: "/editor" }));
    at = await expectShell("/editor");
    assert.equal(at.index, home.index + 2);

    // Typed or shared URLs: no history state, so settings opens over the startup view (editor);
    // closing replaces the entry with that view. /settings and unknown sections canonicalize.
    await page.goto("app://verynize/settings/memory");
    await ready();
    const typed = await expectShell("/settings/memory");
    await page.locator("#settings-back").click();
    at = await expectShell("/editor");
    assert.equal(at.index, typed.index, "closing a typed settings URL replaces it");
    for (const url of ["app://verynize/settings", "app://verynize/settings/nope"]) {
      await page.goto(url);
      await ready();
      const loaded = await expectShell("/settings/preferences");
      await page.reload();
      await ready();
      assert.deepEqual(await expectShell("/settings/preferences"), loaded);
    }
    console.log(
      "PASS settings route: menu/⌘,/API open, section replace, Back/Forward, Back to app and Escape return without extra entries, reload over home restores the view, router navigation, typed /settings URLs canonicalize",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
