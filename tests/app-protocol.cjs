// app://verynize/ custom protocol (desktop/app-protocol.cjs) and the one-time file:// storage copy
// (desktop/storage-migration.cjs): page origin, origin-based IPC trust across client-side routes and
// reloads, navigation lock, path containment, MIME types and the localStorage/IndexedDB migration.
const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const appProtocol = require("../desktop/app-protocol.cjs");
const { MARKER, PROBE, STAGED } = require("../desktop/storage-migration.cjs");

const ENTRY = "app://verynize/editor";
const SECRET = "registerSchemes(protocol)"; // text from desktop/main.cjs: must never be served

const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const launch = (profile) => electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
/** The editor window (the storage copy may open a hidden window first). */
async function editor(app) {
  for (let i = 0; i < 200; i++) {
    const page = app
      .windows()
      .find(
        (p) =>
          p.url().startsWith("app://verynize/") && !p.url().endsWith("/storage-migration.html"),
      );
    if (page) {
      await page.waitForFunction(() => !!window.desktop && document.readyState === "complete");
      return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error("The editor window did not open");
}
const ipcWorks = (page) =>
  page.evaluate(async () => (await window.desktop.onboardingState()).skip === true);
const stylesLoaded = (page) =>
  page.evaluate(
    () =>
      [...document.styleSheets].filter((s) => {
        try {
          return s.cssRules.length > 0;
        } catch {
          return false;
        }
      }).length,
  );

async function unitChecks() {
  // Path containment, independent of Electron.
  const status = async (url) => (await appProtocol.resolveRequest(url)).status;
  for (const url of [
    "app://verynize/..%2fdesktop%2fmain.cjs",
    "app://verynize/%2e%2e%2fdesktop%2fmain.cjs",
    "app://verynize/assets/..%2f..%2fdesktop/main.cjs",
    "app://verynize/%5c..%5cdesktop%5cmain.cjs",
    "app://verynize/%2Fetc%2Fpasswd",
    "app://verynize/%00.js",
    "app://verynize/C:%5cWindows%5cwin.ini",
  ])
    assert.ok((await status(url)) >= 400 && (await status(url)) < 500, url);
  for (const url of [
    "app://verynize/../desktop/main.cjs", // the URL parser folds this to /desktop/main.cjs: not in web/
    "app://verynize/%2e%2e/desktop/main.cjs",
    "app://verynize//etc/passwd.txt",
    "app://verynize/missing.js",
    "app://verynize/.gitignore",
    "app://other/index.html",
    "app://verynize/" + path.resolve("desktop/main.cjs").slice(1),
  ])
    assert.equal(await status(url), 404, url);
  assert.equal(await status("app://verynize/%"), 400);
  const spa = await appProtocol.resolveRequest("app://verynize/projects/abc/editor");
  assert.equal(
    spa.file,
    path.resolve("web/index.html"),
    "extensionless paths are client-side routes",
  );
  // A cloud file's route holds an encoded colon (/editor/room%3A<id>): reloading it must load the app.
  const roomRoute = "app://verynize/editor/room%3A0b7e4b5e-4f7a-4c55-9a43-7a2d1c3e9f10";
  assert.equal((await appProtocol.resolveRequest(roomRoute)).file, path.resolve("web/index.html"));
  assert.equal((await appProtocol.serve(new Request(roomRoute))).status, 200);
  assert.equal(
    await status("app://verynize/assets/C%3Afont.woff2"),
    403,
    "never a colon in a file",
  );
  // A symlink inside web/ that points outside it is refused.
  const link = path.resolve("web/zz-app-protocol-test-link.js");
  await fs.symlink(path.resolve("desktop/main.cjs"), link);
  try {
    assert.equal(await status("app://verynize/zz-app-protocol-test-link.js"), 403);
  } finally {
    await fs.rm(link, { force: true });
  }
  // serve(): MIME types, method, error bodies never carry file content.
  const res = await appProtocol.serve(new Request("app://verynize/app.js"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/javascript/);
  assert.equal(
    (await appProtocol.serve(new Request("app://verynize/style.css"))).headers.get("content-type"),
    "text/css; charset=utf-8",
  );
  assert.equal(
    (
      await appProtocol.serve(
        new Request("app://verynize/assets/fonts/inter-latin-400-normal.woff2"),
      )
    ).headers.get("content-type"),
    "font/woff2",
  );
  assert.equal(
    (await appProtocol.serve(new Request("app://verynize/editor"))).headers.get("content-type"),
    "text/html; charset=utf-8",
  );
  assert.equal(
    (
      await appProtocol.serve(
        new Request("app://verynize/index.html", { method: "POST", body: "x" }),
      )
    ).status,
    405,
  );
  const denied = await appProtocol.serve(new Request("app://verynize/..%2fdesktop%2fmain.cjs"));
  assert.ok(!(await denied.text()).includes(SECRET));
  // IPC sender guard: only the window's own main frame on app://verynize.
  const win = { isDestroyed: () => false, webContents: null };
  const mainFrame = { url: ENTRY, origin: "app://verynize" };
  win.webContents = { mainFrame };
  const event = (frame, sender = win.webContents) => ({ sender, senderFrame: frame });
  assert.equal(appProtocol.isTrustedSender(event(mainFrame), win), true);
  for (const url of ["app://verynize/editor", "app://verynize/settings?tab=agents#x"]) {
    const frame = { url, origin: "app://verynize" },
      contents = { mainFrame: frame };
    assert.equal(
      appProtocol.isTrustedSender(event(frame, contents), {
        isDestroyed: () => false,
        webContents: contents,
      }),
      true,
      url,
    );
  }
  const bad = [
    event(null),
    event({ url: ENTRY, origin: "app://verynize" }), // a subframe: not the main frame object
    event(mainFrame, { mainFrame }), // another webContents
  ];
  for (const e of bad) assert.equal(appProtocol.isTrustedSender(e, win), false);
  for (const [url, origin] of [
    ["about:blank", "app://verynize"],
    ["file:///x/web/index.html", "file://"],
    ["app://evil/index.html", "app://evil"],
    ["app://verynize/index.html", "null"],
    ["not a url", "app://verynize"],
    ["app://user:pw@verynize/", "app://verynize"],
  ]) {
    const frame = { url, origin };
    assert.equal(
      appProtocol.isTrustedSender(event(frame, { mainFrame: frame }), {
        isDestroyed: () => false,
        webContents: { mainFrame: frame },
      }),
      false,
      url,
    );
  }
  assert.equal(
    appProtocol.isTrustedSender(event(mainFrame), { ...win, isDestroyed: () => true }),
    false,
  );
}

async function appChecks(profile) {
  const app = await launch(profile);
  try {
    const page = await editor(app);
    await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
    assert.equal(page.url(), "app://verynize/");
    assert.equal(await page.evaluate(() => location.origin), "app://verynize");
    assert.equal(await page.evaluate(() => isSecureContext), true);
    assert.equal(await page.evaluate(() => document.body.classList.contains("files-view")), true);
    assert.ok(await ipcWorks(page));
    // Client-side routes: path, query and hash do not matter to IPC.
    // (The router replaces a bare /editor with the active file's URL.)
    await page.evaluate(() => history.pushState({}, "", "/editor"));
    assert.match(await page.evaluate(() => location.pathname), /^\/editor(\/[^/]+)?$/);
    assert.ok(await ipcWorks(page), "IPC after pushState");
    await page.evaluate(() => history.pushState({}, "", "/settings?tab=agents#advanced"));
    assert.ok(await ipcWorks(page), "IPC with query and hash");
    // Renderer-initiated reload of a route (passes will-navigate): the app loads again with its styles.
    await page.evaluate(() => history.pushState({}, "", "/editor"));
    await Promise.all([page.waitForEvent("load"), page.evaluate(() => location.reload())]);
    await page.waitForFunction(() => !!window.desktop);
    // Bare /editor is replaced with the active file's canonical URL (/editor/<fileId>).
    await page.waitForFunction(
      () => location.pathname === "/editor/" + encodeURIComponent(window.fileLibrary?.currentId),
    );
    assert.match(page.url(), /^app:\/\/verynize\/editor\/[^/?#]+$/);
    assert.ok(await ipcWorks(page), "IPC after reloading app://verynize/editor");
    assert.ok((await stylesLoaded(page)) >= 10, "stylesheets load from a route URL");
    // Reloading a cloud file's route (Cmd+R or location.reload()) loads the app, not "Forbidden".
    const room = "/editor/room%3A0b7e4b5e-4f7a-4c55-9a43-7a2d1c3e9f10";
    await page.evaluate((route) => history.pushState({}, "", route), room);
    const [reloaded] = await Promise.all([
      page.waitForResponse((response) => response.url() === "app://verynize" + room),
      page.evaluate(() => location.reload()),
    ]);
    assert.equal(reloaded.status(), 200);
    await page.waitForFunction(() => !!window.desktop && document.readyState === "complete");
    assert.ok(await ipcWorks(page), "IPC after reloading a cloud file's route");
    assert.ok((await stylesLoaded(page)) >= 10, "the app loads, not an error page");
    // A nested route loads its root-absolute assets too.
    await Promise.all([
      page.waitForEvent("load"),
      page.evaluate(() => {
        location.href = "app://verynize/projects/abc/editor?x=1";
      }),
    ]);
    await page.waitForFunction(() => !!window.desktop && typeof window.design === "object");
    assert.ok(await ipcWorks(page), "IPC on a nested route");
    assert.ok((await stylesLoaded(page)) >= 10);
    // Other origins stay blocked.
    for (const target of ["https://example.com/", "file:///etc/hosts", "app://evil/index.html"]) {
      await page.evaluate((url) => {
        location.href = url;
      }, target);
      await page.waitForTimeout(300);
      assert.equal(page.url(), "app://verynize/projects/abc/editor?x=1", target);
    }
    // Containment as seen by the renderer: 4xx and never file content.
    const results = await page.evaluate(async (secret) => {
      const out = {};
      for (const url of [
        "app://verynize/../desktop/main.cjs",
        "/%2e%2e/desktop/main.cjs",
        "/%2e%2e%2fdesktop%2fmain.cjs",
        "/..%2fdesktop%2fmain.cjs",
        "/assets/..%2f..%2fdesktop/main.cjs",
        "/%2Fetc%2Fpasswd",
        "/missing.js",
      ]) {
        const r = await fetch(url);
        out[url] = { status: r.status, leaked: (await r.text()).includes(secret) };
      }
      const css = await fetch("/style.css");
      out.css = css.headers.get("content-type");
      return out;
    }, SECRET);
    for (const [url, r] of Object.entries(results))
      if (url !== "css") {
        assert.ok(r.status >= 400 && r.status < 500, url + " → " + r.status);
        assert.equal(r.leaked, false, url);
      }
    assert.equal(results.css, "text/css; charset=utf-8");
    // A subframe gets no desktop bridge, even same-origin.
    const framed = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const frame = document.createElement("iframe");
          frame.src = "/storage-migration.html";
          frame.onload = () => {
            const has = typeof frame.contentWindow.desktop;
            frame.remove();
            resolve(has);
          };
          document.body.append(frame);
        }),
    );
    assert.equal(framed, "undefined");
    // Seed old file:// storage (as a previous build would have left it) and a key that already exists on app://.
    await page.evaluate(() => localStorage.setItem("verynize-migration-collide", "app"));
    await app.evaluate(
      async ({ BrowserWindow }, url) => {
        const win = new BrowserWindow({
          show: false,
          webPreferences: { sandbox: true, contextIsolation: true },
        });
        await win.loadURL(url);
        await win.webContents.executeJavaScript(
          `(async () => {
        localStorage.setItem('verynize-migration-probe', JSON.stringify({ doc: 'kept' }));
        localStorage.setItem('verynize-migration-collide', 'file');
        const db = await new Promise((ok, no) => { const r = indexedDB.open('verynize-cloud', 1); r.onupgradeneeded = () => r.result.createObjectStore('outbox'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
        await new Promise(ok => { const tx = db.transaction('outbox', 'readwrite'); tx.objectStore('outbox').put({ id: 'room-1', pending: [{ n: 1 }] }, 'https://cloud|room-1'); tx.oncomplete = ok; });
        db.close();
      })()`,
          true,
        );
        win.destroy();
      },
      pathToFileURL(path.resolve("web/storage-migration.html")).href,
    );
  } finally {
    await app.close();
  }
}

async function migrationChecks(profile) {
  const marker = path.join(profile, MARKER);
  assert.match(
    await fs.readFile(marker, "utf8"),
    /"fresh": true/,
    "the first launch found no file:// data",
  );
  await fs.rm(marker);
  const app = await launch(profile);
  try {
    const page = await editor(app);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("verynize-migration-probe")),
      JSON.stringify({ doc: "kept" }),
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("verynize-migration-collide")),
      "app",
      "existing app:// keys are never overwritten",
    );
    const outbox = await page.evaluate(
      () =>
        new Promise((ok, no) => {
          const r = indexedDB.open("verynize-cloud", 1);
          r.onsuccess = () => {
            const get = r.result
              .transaction("outbox")
              .objectStore("outbox")
              .get("https://cloud|room-1");
            get.onsuccess = () => {
              ok(get.result);
              r.result.close();
            };
          };
          r.onerror = () => no(r.error);
        }),
    );
    assert.deepEqual(outbox, { id: "room-1", pending: [{ n: 1 }] });
    const record = JSON.parse(await fs.readFile(marker, "utf8"));
    assert.equal(record.to, "app://verynize");
    assert.ok(
      record.copied >= 1 && record.kept >= 1 && record.outbox === 1,
      JSON.stringify(record),
    );
    assert.ok(await ipcWorks(page));
  } finally {
    await app.close();
  }
  // Third launch: no window before the editor; the downgrade probe runs in the background and
  // neither recopies nor stages unchanged storage.
  const before = await fs.readFile(marker, "utf8");
  await fs.rm(path.join(profile, PROBE), { force: true });
  const again = await electron.launch({
    env: { ...env, VERYNIZE_STORAGE_PROBE_DELAY_MS: "0" },
    args: [".", `--user-data-dir=${profile}`],
  });
  try {
    const page = await editor(again);
    // Plain launches open Home even when a migrated profile has an active file.
    assert.match(
      page.url(),
      /^app:\/\/verynize\/$/,
      "editor opens without waiting for the downgrade probe",
    );
    let probe;
    for (let i = 0; i < 400 && !probe; i++) {
      probe = await fs
        .readFile(path.join(profile, PROBE), "utf8")
        .then(JSON.parse)
        .catch(() => null);
      if (!probe) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(probe, "background probe finished");
    assert.equal(probe.unchanged, true, JSON.stringify(probe));
    assert.equal(probe.startup.windows, 0, "no hidden window before the editor");
    assert.equal(await fs.readFile(marker, "utf8"), before, "nothing recopied");
    await assert.rejects(fs.access(path.join(profile, STAGED)), "nothing staged");
  } finally {
    await again.close();
  }
}

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-app-protocol-"));
  try {
    await unitChecks();
    await appChecks(profile);
    await migrationChecks(profile);
    console.log(
      "PASS app:// protocol: origin, IPC across routes and reloads, navigation lock, containment, MIME, subframe isolation, file:// storage migration",
    );
  } finally {
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
