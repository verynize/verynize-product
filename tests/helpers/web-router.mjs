// Shared browser check of navigation in the web app (web-start), run against every web target.
// Start's router is the page's only router: the legacy shell router runs hosted on it
// (web-start/src/legacy/shell-host.ts). Checks UI clicks, app navigation and Back/Forward between
// /, /editor, /code and /settings/<section>; that the editor never remounts; that Start's router
// location always matches the address bar and Back/Forward move exactly one entry; deep links; and
// that the #room= fragment survives navigation. The non-canvas areas are rendered by Start's routes
// (data-route-owner="start"), not by island mounts, from the same React copy as the islands: the
// settings overlay (settings.tsx), the Files home (index.tsx) and the Code workspace (code.tsx),
// plus the view under settings.
import assert from "node:assert/strict";
import { checkHomeOpening } from "./home-first-opening.cjs";
import { openStarterFile, readLibrary, writeLibrary } from "./web-app.mjs";

const ROOM = "11111111-1111-4111-8111-111111111111";
const INVITE = `#room=${ROOM}&token=${"ab".repeat(32)}`;

/** `context`: where to open the page; the web app needs a signed-in one (helpers/web-app.mjs signedInContext). */
export async function checkWebRouter(browser, origin, context = browser) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // A second React copy shows up as hook errors once an island hook runs under the other renderer.
  page.on("console", (message) => {
    if (/Invalid hook call|more than one copy of React/i.test(message.text()))
      errors.push(message.text());
  });
  const ready = async () => {
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.legacyEditor === "ready" ||
        (location.pathname === "/" && document.documentElement.dataset.legacyHome === "ready"),
    );
    await page.waitForFunction(() => document.documentElement.dataset.uiReady === "true", null, {
      timeout: 20000,
    });
    await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
  };
  // Address bar, Start's router, history entry and the legacy views.
  const state = () =>
    page.evaluate(() => {
      const routed = window.shellRouter.state.location;
      return {
        path: location.pathname,
        hash: location.hash,
        routerHref: routed.pathname + routed.searchStr + (routed.hash ? `#${routed.hash}` : ""),
        index: history.state?.__TSR_index,
        length: history.length,
        home: document.body.classList.contains("files-view"),
        code: document.body.classList.contains("code-mode"),
        settings: document.body.classList.contains("settings-open"),
        section: window.appSettings.getState().section,
      };
    });
  // Waits until the URL, Start's router (resolved, same href) and the views agree on `path`.
  const expectShell = async (path, { home = path === "/", code = path === "/code" } = {}) => {
    await page.waitForFunction(
      ({ path, home, code }) => {
        if (path === "/editor")
          path = "/editor/" + encodeURIComponent(window.fileLibrary.currentId);
        const routed = window.shellRouter.state.location;
        const settings = path.startsWith("/settings/");
        const body = document.body.classList;
        const screen = document.getElementById("settings-screen");
        const fileHome = document.getElementById("file-home");
        return (
          window.shellRouter.state.status === "idle" &&
          location.pathname === path &&
          routed.pathname + routed.searchStr + (routed.hash ? `#${routed.hash}` : "") ===
            location.pathname + location.search + location.hash &&
          body.contains("settings-open") === settings &&
          (!settings || window.appSettings.getState().section === path.slice(10)) &&
          // Start's Files route (or the settings route over Files) renders the home screen.
          !!fileHome &&
          fileHome.hidden === !home &&
          (fileHome.dataset.routeOwner === "start") === home &&
          !!document.querySelector("#bd-home-root #library-files") === home &&
          // Start's Code route (or the settings route over Code) renders the workspace; no
          // island-rendered copy exists on the web.
          document.querySelectorAll("#code-workspace").length === (code ? 1 : 0) &&
          (!code ||
            (document.getElementById("code-workspace").dataset.routeOwner === "start" &&
              !!document.querySelector("#code-workspace #code-chat-host .project-agent"))) &&
          // Start's settings route renders the overlay (route-area.tsx), not the settings island.
          !!screen &&
          screen.hidden === !settings &&
          (screen.dataset.routeOwner === "start") === settings &&
          (!settings ||
            screen
              .querySelector(`#settings-nav [data-section="${path.slice(10)}"]`)
              ?.getAttribute("aria-current") === "page") &&
          body.contains("files-view") === home &&
          body.contains("code-mode") === code
        );
      },
      { path, home, code },
    );
    return state();
  };
  const back = () => page.goBack({ waitUntil: "commit" });

  await page.goto(origin + "/");
  await ready();
  await expectShell("/");
  await checkHomeOpening(page, { detached: true });

  await page.goto(origin + "/editor");
  await ready();
  if (!(await page.evaluate(() => window.fileLibrary.currentId)))
    await openStarterFile(page, { detached: true });

  // File URLs restore documents through Start's parameter route without remounting the editor.
  const original = await page.evaluate(() => window.fileLibrary.currentId);
  const library = await readLibrary(page);
  const fixture = await page.evaluate(() => window.design.getDocument());
  const urlFileId = crypto.randomUUID();
  fixture.name = "URL route fixture";
  // Detached records exercise local file routing without asking the Node stub backend to create rooms.
  const cloud = { server: new URL(page.url()).origin, roomId: "route-fixture", detached: true };
  library.files.find((file) => file.id === library.active).cloud = cloud;
  library.files.push({
    id: urlFileId,
    name: fixture.name,
    document: fixture,
    updated: Date.now(),
    archived: false,
    folder: null,
    cloud: { ...cloud, roomId: "route-fixture-two" },
  });
  // Write while no app instance runs: a running editor persists its in-memory library in an idle
  // callback, which under load can land after this write and drop the fixture file.
  const editorUrl = page.url();
  await page.goto(new URL("/favicon.svg", editorUrl).href);
  await writeLibrary(page, library);
  await page.goto(editorUrl);
  await ready();
  await page.evaluate(
    (id) =>
      window.shellNavigation.navigate({
        to: "/editor/$fileId",
        params: { fileId: id },
      }),
    urlFileId,
  );
  await expectShell("/editor/" + urlFileId);
  await page.waitForFunction((id) => window.fileLibrary.currentId === id, urlFileId);
  await back();
  await expectShell("/editor/" + original);
  await page.waitForFunction((id) => window.fileLibrary.currentId === id, original);
  await page.goForward({ waitUntil: "commit" });
  await expectShell("/editor/" + urlFileId);
  await page.waitForFunction((id) => window.fileLibrary.currentId === id, urlFileId);
  await page.reload();
  await ready();
  await expectShell("/editor/" + urlFileId);
  await page.waitForFunction((id) => window.fileLibrary.currentId === id, urlFileId);
  assert.equal(await page.evaluate(() => window.fileLibrary.currentId), urlFileId);
  await page.goto(origin + "/editor/missing-file");
  await ready();
  await expectShell("/", { home: true });
  await page
    .getByText("This file is unavailable. Choose a file from Files.", { exact: true })
    .waitFor();
  await page.evaluate((id) => window.fileLibrary.open(id), original);
  await expectShell("/editor/" + original);

  // One router and one history on the page: the shell router is Start's router.
  assert.equal(
    await page.evaluate(
      () =>
        window.verynizeShellHost !== undefined &&
        window.shellRouter === window.verynizeShellHost.router &&
        window.shellRouter.history === window.verynizeShellHost.router.history,
    ),
    true,
    "the shell router runs hosted on Start's router",
  );
  // One React: the islands run from source inside Start's client build; web/dist/ui.js (the
  // desktop IIFE with its own React) is not loaded.
  assert.deepEqual(
    await page.evaluate(() => ({
      shared: document.documentElement.dataset.sharedReact,
      uiBundle: document.querySelectorAll('script[src*="dist/ui.js"]').length,
    })),
    { shared: "true", uiBundle: 0 },
    "one React copy on the page",
  );
  // Markers that a remount would lose: the canvas element, a window property, one boot.
  await page.evaluate(() => {
    window.__routerMarker = "kept";
    window.__routerCanvas = document.getElementById("canvas");
  });
  const mounted = () =>
    page.evaluate(() => ({
      marker: window.__routerMarker,
      canvas: window.__routerCanvas === document.getElementById("canvas"),
      appScripts: [...document.scripts].filter((script) =>
        /^\/(?:app\.js|assets\/legacy\/app-[a-f0-9]{16}\.js)$/.test(
          new URL(script.src, location.href).pathname,
        ),
      ).length,
      layouts: document.querySelectorAll("#canvas").length,
    }));
  const MOUNTED = { marker: "kept", canvas: true, appScripts: 1, layouts: 1 };

  const start = await expectShell("/editor");
  // UI click: Files home pushes one entry.
  await page.locator("#files-home").click();
  let at = await expectShell("/");
  assert.equal(at.index, start.index + 1, "Files pushes one entry");
  assert.equal(at.length, start.length + 1, "one history entry per navigation");
  // The route-rendered screen is interactive and keeps its view choice when the route unmounts it.
  await page.locator("#library-list").click();
  await page.waitForFunction(() => document.getElementById("library-files")?.className === "list");
  // Back goes exactly one step, Forward returns.
  await back();
  at = await expectShell("/editor");
  assert.equal(at.index, start.index, "Back moves one entry");
  await page.goForward({ waitUntil: "commit" });
  at = await expectShell("/");
  assert.equal(at.index, start.index + 1, "Forward moves one entry");
  assert.equal(
    await page.evaluate(() => document.getElementById("library-list").getAttribute("aria-pressed")),
    "true",
    "the Files route keeps the list view across remounts",
  );
  await page.locator("#library-grid").click();
  await back();
  await expectShell("/editor");

  // Settings from the app menu: opening pushes one entry, a section click replaces it, Back to app
  // returns to the entry it was opened from.
  await page.locator(".app-menu-trigger:visible").first().click();
  await page.locator("#shell-settings").click();
  at = await expectShell("/settings/preferences", { home: false });
  assert.equal(at.index, start.index + 1, "opening settings pushes one entry");
  const other = await page.evaluate(() => {
    const button = [...document.querySelectorAll("#settings-nav button")].find(
      (b) => b.offsetParent !== null && !/preferences/i.test(b.textContent),
    );
    return button?.textContent.trim();
  });
  assert.ok(other, "another settings section to click");
  await page.evaluate(() => (window.__settingsNav = document.getElementById("settings-nav")));
  await page.locator("#settings-nav button").filter({ hasText: other }).first().click();
  await page.waitForFunction(() => location.pathname !== "/settings/preferences");
  const section = await page.evaluate(() => location.pathname);
  at = await expectShell(section);
  assert.equal(at.index, start.index + 1, "switching sections replaces the entry");
  assert.equal(
    await page.evaluate(() => window.__settingsNav === document.getElementById("settings-nav")),
    true,
    "switching sections keeps the route's settings screen mounted",
  );
  await back();
  at = await expectShell("/editor");
  assert.equal(at.index, start.index, "Back closes settings in one step");
  await page.goForward({ waitUntil: "commit" });
  await expectShell(section);
  await page.locator("#settings-back").click();
  at = await expectShell("/editor");
  assert.equal(at.index, start.index, "Back to app adds no entry");
  assert.equal(at.length, start.length + 1, "only one forward entry exists");

  // Code workspace through app navigation (Start's router), then Back/Forward.
  await page.evaluate(() => window.shellNavigation.navigate({ to: "/code" }));
  at = await expectShell("/code");
  assert.equal(at.index, start.index + 1);
  await back();
  await expectShell("/editor");
  await page.goForward({ waitUntil: "commit" });
  await expectShell("/code");
  // Legacy request from code mode to the Files home, then Back to code.
  await page.evaluate(() => window.fileLibrary.showHome());
  at = await expectShell("/");
  assert.equal(at.index, start.index + 2);
  await back();
  await expectShell("/code");
  await page.evaluate(() => window.shellRouter.navigate({ to: "/editor" }));
  await expectShell("/editor");
  assert.deepEqual(await mounted(), MOUNTED, "the editor never remounts");

  // Reload keeps settings over the view it was opened from (history state), and Back returns to it.
  await page.locator("#files-home").click();
  const home = await expectShell("/");
  await page.evaluate(() => window.appSettings.open("account"));
  at = await expectShell("/settings/account", { home: true });
  assert.equal(at.index, home.index + 1);
  await page.reload();
  await ready();
  at = await expectShell("/settings/account", { home: true });
  assert.equal(at.index, home.index + 1, "reload keeps the entry");
  await back();
  at = await expectShell("/");
  assert.equal(at.index, home.index);

  // Deep links render the right area (fresh loads, no history state).
  for (const [url, path, options] of [
    ["/", "/", {}],
    ["/code", "/code", {}],
    ["/settings/account", "/settings/account", {}],
    ["/settings", "/settings/preferences", {}],
    ["/settings/nope", "/settings/preferences", {}],
  ]) {
    await page.goto(origin + url);
    await ready();
    await expectShell(path, options);
  }

  // The room fragment stays client-side and survives every kind of navigation.
  // The link handler (web/src/islands/collab/links.ts) takes the link at once: its token leaves the address before
  // the room loads, the room id stays (what follows depends on the backend: no access here, a stub elsewhere).
  const KEPT = `#room=${ROOM}`;
  await page.goto(origin + "/editor" + INVITE);
  await ready();
  await page.waitForFunction((kept) => location.hash === kept, KEPT);
  await expectShell("/editor");
  const withInvite = await state();
  assert.equal(withInvite.hash, KEPT);
  await page.locator("#files-home").click();
  at = await expectShell("/");
  assert.equal(at.hash, KEPT, "UI navigation keeps the fragment");
  await page.evaluate(() => window.shellNavigation.navigate({ to: "/code" }));
  at = await expectShell("/code");
  assert.equal(at.hash, KEPT, "router navigation keeps the fragment");
  await page.evaluate(() => window.appSettings.open("account"));
  at = await expectShell("/settings/account", { code: true });
  assert.equal(at.hash, KEPT, "settings keeps the fragment");
  await back();
  at = await expectShell("/code");
  assert.equal(at.hash, KEPT);
  await back();
  at = await expectShell("/");
  assert.equal(at.hash, KEPT, "Back keeps the fragment");
  // Navigating to the current path adds no entry even though the fragment is kept.
  await page.evaluate(() => window.shellRouter.navigate({ to: "/" }));
  assert.deepEqual(await state(), at);
  // Leaving the room drops it in place.
  await page.evaluate((room) => window.shellNavigation.clearRoomHash(room), ROOM);
  await page.waitForFunction(() => location.hash === "");
  at = await expectShell("/");
  assert.equal(at.hash, "");

  assert.deepEqual(errors, []);
  await page.close();
}
