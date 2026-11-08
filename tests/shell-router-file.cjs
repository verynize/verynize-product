// Exercise the file:// memory-history compatibility branch without preload or app protocol.
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "router-file-"));
  const main = path.join(profile, "main.cjs");
  // The production entry uses origin-root asset URLs for app:// and HTTPS routes. Rebase only
  // those URLs in a temporary file fixture; all application scripts (including the router) run
  // unchanged, without an app protocol, preload, or production testing flag.
  const entry = path.join(profile, "index.html");
  const webRoot = pathToFileURL(path.resolve("web")).href;
  await fs.writeFile(
    entry,
    (await fs.readFile(path.resolve("web/index.html"), "utf8")).replace(
      /\b(src|href)="\//g,
      `$1="${webRoot}/`,
    ),
  );
  await fs.writeFile(
    main,
    `const {app, BrowserWindow} = require('electron');
    app.setPath('userData', ${JSON.stringify(profile)});
    app.whenReady().then(() => { const win = new BrowserWindow({show:false, webPreferences:{sandbox:true, contextIsolation:true}}); win.loadURL(${JSON.stringify(pathToFileURL(entry).href)}); });`,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ env, args: [main] });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await waitForUiReady(page);
    assert.equal(await page.evaluate(() => typeof window.desktop), "undefined");
    for (const hash of ["", "#room=file-fallback&token=a%2Fb%3D", "#public=file-fallback"]) {
      await page.evaluate((hash) => {
        location.hash = hash;
      }, hash);
      const url = page.url();
      const nativeLength = await page.evaluate(() => history.length);
      const expectView = async (route) => {
        // The editor's route is the shown file's canonical /editor/<fileId>.
        await page.waitForFunction(
          (route) =>
            window.shellRouter?.state.location.pathname ===
              (route === "/editor"
                ? "/editor/" + encodeURIComponent(window.fileLibrary.currentId)
                : route) && document.body.classList.contains("files-view") === (route === "/"),
          route,
        );
        assert.equal(page.url(), url, "memory navigation never changes file URL or cloud fragment");
        assert.equal(await page.evaluate(() => history.length), nativeLength);
      };
      await page.evaluate(() => window.fileLibrary.showEditor());
      await expectView("/editor");
      await page.evaluate(() => window.fileLibrary.showHome());
      await expectView("/");
      await page.evaluate(() => window.shellRouter.navigate({ to: "/editor" }));
      await expectView("/editor");
      await page.evaluate(() => window.shellRouter.history.back());
      await expectView("/");
      await page.evaluate(() => window.shellRouter.history.forward());
      await expectView("/editor");
      await page.reload();
      await waitForUiReady(page);
      await expectView("/editor");
      await page.evaluate(() => document.getElementById("cloud-dialog")?.close());
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS file router: no desktop bridge, memory history, legacy/router/back/forward view sync, unchanged URL and room/public hashes, no page errors",
    );
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
