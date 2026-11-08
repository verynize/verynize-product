// Expanded preview tab (Wonder PF3 / X5): ⌘⌥P and the frame's expand button open the canvas preview as its own app
// tab with a separate page state; the tab survives tab switches, "Show on canvas" returns to the selected frame and
// keeps the tab, closing it never stops the dev server, and a stopped server shows "<worktree> · Stopped".
const { _electron } = require("@playwright/test");
const { mod } = require("./helpers/keys.cjs");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const APP = `require('http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end(q.url.startsWith('/about')?'<h1>About page</h1><a href="/">Home</a>':'<h1>Sunbird home</h1><a id="about" href="/about">About</a><input aria-label="Message">')}).listen(0,'127.0.0.1',function(){console.log('http://127.0.0.1:'+this.address().port+'/')})`;

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "preview-tab-"));
  const repo = path.join(dir, "sunbird");
  await fs.mkdir(repo);
  await fs.writeFile(path.join(repo, "server.js"), APP);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${path.join(dir, "profile")}`],
  });
  let root = "";
  const page = await app.firstWindow();
  await waitForUiReady(page);
  try {
    await page.waitForFunction(
      () => !!window.livePreview && !!window.previewTab && !!window.agentWorkspace,
    );
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, repo);
    root = (await page.evaluate(() => window.desktop.openProject())).root;
    const started = await page.evaluate(async (root) => {
      await window.desktop.devServer.configure({ root, command: ["node", "server.js"] });
      return window.desktop.devServer.start({ root });
    }, root);
    assert.equal(started.state, "running", JSON.stringify(started));
    const base = started.url;
    const frameId = await page.evaluate(
      ({ url, root }) => {
        window.livePreview.show(url, { root, name: "Sunbird", chatId: "" });
        return window.livePreview.getNodeId();
      },
      { url: base, root },
    );
    const canvasFrame = () =>
      page.frames().find((frame) => frame.name() === "verynize-live-preview");
    const tabFrame = () => page.frames().find((frame) => frame.name() === "verynize-preview-tab");
    await page.waitForFunction(
      () => !!document.querySelector("#live-preview[data-preview-state=running]"),
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll("iframe")].some(
        (f) => f.name === "verynize-live-preview" && f.src,
      ),
    );
    await page.frameLocator("iframe[name=verynize-live-preview]").locator("h1").waitFor();
    await canvasFrame().evaluate(() => {
      window.canvasMarker = "canvas";
    });

    // ⌘⌥P on the selected preview frame (canvas command registry) opens the internal tab.
    assert.ok(
      (await page.evaluate(() => window.design.commands())).some(
        (c) => c.id === "preview.openInTab" && c.keys.includes("mod+alt+p"),
      ),
    );
    await page.evaluate((id) => window.design.setSelection([id]), frameId);
    await page.locator("#canvas-wrap").hover();
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press(mod("Alt+KeyP"));
    const tab = page.locator(`[data-preview-tab="${frameId}"]`);
    await tab.waitFor();
    await page.waitForFunction(
      (id) => document.querySelector(`[data-preview-tab="${id}"]`)?.dataset.status === "running",
      frameId,
    );
    assert.match((await tab.innerText()).replace(/\s+/g, " "), /Sunbird · Preview/);
    assert.equal(
      await tab.locator("button[aria-current=page]").count(),
      1,
      "preview tab is the current tab",
    );
    assert.equal(
      await page.locator("[data-document-tab]").getAttribute("aria-current"),
      null,
      "document tab is not current",
    );
    const view = page.locator("#preview-tab-view");
    await view.waitFor();
    const bar = await view.locator("[data-pt=bar]").boundingBox();
    assert.equal(Math.round(bar.height), 36, "36px browser bar");
    assert.equal(Math.round(bar.y), 40, "browser bar sits under the 40px app strip");

    // Fresh, separate page state; the canvas frame keeps its own name and state.
    await page.waitForFunction(() => document.querySelector("iframe[name=verynize-preview-tab]"));
    await page.frameLocator("iframe[name=verynize-preview-tab]").locator("h1").waitFor();
    assert.notEqual(tabFrame(), canvasFrame());
    assert.equal(
      await tabFrame().evaluate(() => window.canvasMarker),
      undefined,
      "tab loads the app fresh",
    );
    assert.equal(
      await canvasFrame().evaluate(() => window.canvasMarker),
      "canvas",
      "canvas page state untouched",
    );
    assert.equal(
      page.frames().filter((frame) => frame.name() === "verynize-live-preview").length,
      1,
      "only one frame answers to the canvas name",
    );
    const sandbox = await page.evaluate(() => [
      document.querySelector("iframe[name=verynize-preview-tab]").getAttribute("sandbox"),
      document.querySelector("iframe[name=verynize-live-preview]").getAttribute("sandbox"),
    ]);
    assert.equal(sandbox[0], sandbox[1], "same sandbox flags as the canvas preview");

    // Canvas shortcuts do not reach the hidden canvas while the tab is visible.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Delete");
    assert.ok(
      await page.evaluate(
        (id) => window.design.getDocument().pages.some((p) => p.nodes.some((n) => n.id === id)),
        frameId,
      ),
      "Delete in the tab keeps the frame",
    );

    // Browser bar: typed path, in-app link, back.
    const pathField = view.getByRole("textbox", { name: "Preview path" });
    assert.equal(await pathField.inputValue(), "/");
    await pathField.fill("/about");
    await pathField.press("Enter");
    await page.waitForFunction(() =>
      /\/about$/.test(
        [...document.querySelectorAll("iframe")].find((f) => f.name === "verynize-preview-tab")
          ?.src || "",
      ),
    );
    const preview = page.frameLocator("iframe[name=verynize-preview-tab]");
    await preview.getByRole("heading", { name: "About page" }).waitFor();
    await tabFrame().waitForURL(new URL("/about", base).href);
    // Enter replaces the cross-origin iframe. Its DOM can be ready before Chromium has
    // committed the new surface for hit testing (also covered by preview-interaction).
    // Wait for painted frames, not an arbitrary delay, before the first pointer action.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await preview.getByRole("link", { name: "Home", exact: true }).click();
    await tabFrame().waitForURL(base);
    await page.waitForFunction(
      () => document.querySelector('#preview-tab-view [aria-label="Preview path"]').value === "/",
    );
    await view.getByRole("button", { name: "Back" }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('#preview-tab-view [aria-label="Preview path"]').value === "/about",
    );
    await view.getByRole("button", { name: "Forward" }).click();
    await page.waitForFunction(
      () => document.querySelector('#preview-tab-view [aria-label="Preview path"]').value === "/",
    );
    await tabFrame().waitForSelector("#about");
    await tabFrame().fill("input", "kept in the tab");
    assert.equal(
      await canvasFrame().evaluate(() => location.pathname),
      "/",
      "tab navigation does not move the canvas frame",
    );

    // Bottom toolbar mirrors the canvas modes.
    for (const name of ["Navigate", "Edit", "Capture"])
      assert.equal(await view.getByRole("button", { name, exact: true }).isVisible(), true, name);
    assert.equal(
      await view
        .getByRole("button", { name: "Navigate", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );

    // Switching tabs keeps the tab's page alive.
    await page.locator("[data-document-tab]").click();
    await view.waitFor({ state: "hidden" });
    assert.equal(await page.locator("[data-document-tab]").getAttribute("aria-current"), "page");
    assert.equal(await tab.isVisible(), true, "tab stays in the strip");
    await page.locator("#files-home").click();
    await page.waitForFunction(() => document.body.classList.contains("files-view"));
    await tab.locator("button[aria-current], button:not([aria-label])").first().click();
    await view.waitFor();
    assert.equal(
      await page.evaluate(() => document.body.classList.contains("files-view")),
      false,
      "preview tab replaces the Files home",
    );
    assert.equal(
      await tabFrame().inputValue("input"),
      "kept in the tab",
      "page state survives switching tabs",
    );

    // The document tab shows the file name only; right-click opens its tab menu, Close Other Tabs closes the preview.
    assert.equal(
      await page
        .locator("[data-document-tab]")
        .innerText()
        .then((t) => t.trim()),
      "",
      'no " - Page" suffix (the name is the input value)',
    );
    assert.equal(
      await page.locator("[data-document-tab] [data-file-tab-close]").isVisible(),
      false,
      "close button only on hover",
    );
    // Arrow cursor on the tab; the name is renamed only after a double-click.
    const name = page.locator("#document-name");
    assert.deepEqual(
      await name.evaluate((el) => [
        el.readOnly,
        getComputedStyle(el).pointerEvents,
        getComputedStyle(el.closest("[data-document-tab]")).cursor,
      ]),
      [true, "none", "auto"],
    );
    const before = await name.inputValue();
    await page.locator("[data-document-tab]").dblclick();
    await page.waitForFunction(
      () => document.activeElement?.id === "document-name" && !document.activeElement.readOnly,
    );
    await page.keyboard.type("Renamed tab");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.design.getDocument().name === "Renamed tab");
    assert.equal(await name.evaluate((el) => el.readOnly), true, "rename ends on Enter");
    await page.locator("[data-document-tab]").dblclick();
    await page.keyboard.type(before);
    await page.keyboard.press("Enter");
    await tab.locator("button[aria-current], button:not([aria-label])").first().click();
    await view.waitFor();
    await page.locator("[data-document-tab]").click({ button: "right" });
    const menu = page.locator("[data-file-tab-menu]");
    await menu.waitFor();
    assert.deepEqual(await menu.getByRole("menuitem").allInnerTexts(), [
      "New Tab",
      "Close Tab",
      "Close Other Tabs",
      "Reload",
    ]);
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });

    // Show on canvas: back to the design file with the frame selected; the tab stays open.
    await view.getByRole("button", { name: "Show on canvas" }).first().click();
    await view.waitFor({ state: "hidden" });
    assert.deepEqual(await page.evaluate(() => window.design.getSelection()), [frameId]);
    assert.equal(await tab.count(), 1);

    // The frame's expand button opens the same tab.
    await page.locator(`.canvas-preview[data-id="${frameId}"] [data-pf=expand]`).click();
    await view.waitFor();
    assert.equal(await page.locator("[data-preview-tab]").count(), 1, "expand reuses the open tab");

    // Closing the tab leaves the server running; reopen and stop the server → Stopped state.
    await page.evaluate((id) => window.previewTab.close(id), frameId);
    await tab.waitFor({ state: "detached" });
    assert.equal(
      await page.evaluate(() => document.body.classList.contains("preview-tab-view")),
      false,
    );
    assert.equal(
      (await page.evaluate((root) => window.desktop.devServer.status({ root }), root)).state,
      "running",
      "closing the tab does not stop the server",
    );
    assert.equal(await page.evaluate((id) => window.previewTab.open(id), frameId), true);
    await page.waitForFunction(
      (id) => document.querySelector(`[data-preview-tab="${id}"]`)?.dataset.status === "running",
      frameId,
    );
    await page.evaluate((root) => window.desktop.devServer.stop({ root }), root);
    await page.waitForFunction(
      (id) => document.querySelector(`[data-preview-tab="${id}"]`)?.dataset.status === "stopped",
      frameId,
      { timeout: 10000 },
    );
    assert.match((await tab.innerText()).replace(/\s+/g, " "), /Sunbird · Stopped/);
    await view.getByText("Preview stopped").waitFor();
    assert.equal(
      await page.locator("iframe[name=verynize-preview-tab]").count(),
      0,
      "no stale app page once stopped",
    );
    await page.evaluate((root) => window.desktop.devServer.start({ root }), root);
    await page.waitForFunction(
      (id) => document.querySelector(`[data-preview-tab="${id}"]`)?.dataset.status === "running",
      frameId,
      { timeout: 10000 },
    );
    await page.waitForFunction(() =>
      document.querySelector("iframe[name=verynize-preview-tab]")?.src.startsWith("http"),
    );
    assert.match((await tab.innerText()).replace(/\s+/g, " "), /Sunbird · Preview/);
    await page.locator("[data-document-tab]").click({ button: "right" });
    await page
      .locator("[data-file-tab-menu]")
      .getByRole("menuitem", { name: "Close Other Tabs" })
      .click();
    await tab.waitFor({ state: "detached" });
    assert.equal(
      await page.locator("[data-document-tab]").getAttribute("aria-current"),
      "page",
      "Close Other Tabs keeps the file",
    );
    await page.locator("[data-document-tab]").hover();
    await page.locator("[data-document-tab] [data-file-tab-close]").click();
    await page.waitForFunction(() => document.body.classList.contains("files-view"));
    console.log(
      "PASS preview tab: document tab menu (Close Tab, Close Other Tabs), ⌘⌥P/expand open, separate page state, browser bar, tab switching, show on canvas, close keeps server, stopped state",
    );
  } finally {
    if (root)
      await page.evaluate((root) => window.desktop.devServer.stop({ root }), root).catch(() => {});
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
