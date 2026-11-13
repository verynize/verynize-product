// Plain-browser smoke test of the platform layer (web/platform.js, web/src/lib/platform.ts): web/ served by a tiny
// static server with the SPA fallback the Worker uses (extensionless paths → index.html), loaded in Chromium with no
// preload, so there is no window.desktop. The runtime reports kind 'web' with no capabilities, the editor still loads
// a document through the shared schema, desktop-only entry points keep their "open the desktop app" behaviour, and
// the page throws nothing. Browser: Playwright's Chromium, else the installed Chrome, else an Electron window
// without a preload (still plain Chromium; the test fails if window.desktop exists).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium, _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");

const webRoot = path.join(__dirname, "..", "web");
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    // No backend here: the cloud API answers 404 like an unreachable server would.
    if (url.pathname.startsWith("/api/"))
      return res
        .writeHead(404, { "content-type": "application/json" })
        .end('{"error":"not found"}');
    let file = path.join(webRoot, decodeURIComponent(url.pathname));
    if (!file.startsWith(webRoot + path.sep) && file !== webRoot) return res.writeHead(403).end();
    if (!path.extname(file) || url.pathname === "/") file = path.join(webRoot, "index.html");
    fs.readFile(file, (error, body) => {
      if (error) return res.writeHead(404).end();
      res
        .writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" })
        .end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function openBrowser(url) {
  // VERYNIZE_WEB_SMOKE_ELECTRON=1 skips straight to the Electron fallback.
  for (const options of process.env.VERYNIZE_WEB_SMOKE_ELECTRON
    ? []
    : [{}, { channel: "chrome" }]) {
    try {
      const browser = await chromium.launch({ ...options, headless: true });
      const page = await browser.newPage({ viewport: { width: 1440, height: 870 } });
      return { page, close: () => browser.close(), label: options.channel || "chromium" };
    } catch {
      /* try the next browser */
    }
  }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "verynize-web-"));
  const env = { ...process.env, VERYNIZE_PLAIN_URL: url };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: [path.join(__dirname, "fixtures/plain-window.cjs"), `--user-data-dir=${userData}`],
    env,
  });
  const page = await app.firstWindow();
  return { page, close: () => app.close(), label: "electron without preload" };
}

(async () => {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const errors = [];
  const browser = await openBrowser(origin + "/editor");
  const { page } = browser;
  try {
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    if (page.url() !== origin + "/editor") await page.goto(origin + "/editor");
    await waitForUiReady(page);

    // Runtime: plain web, nothing desktop.
    const runtime = await page.evaluate(() => ({
      desktop: typeof window.desktop,
      kind: window.verynizePlatform.kind,
      bridge: window.verynizePlatform.desktop,
      capabilities: Object.entries(window.verynizePlatform.capabilities)
        .filter(([, on]) => on)
        .map(([name]) => name),
      can: window.verynizePlatform.can("projects"),
      frozen: Object.isFrozen(window.verynizePlatform),
    }));
    assert.deepEqual(runtime, {
      desktop: "undefined",
      kind: "web",
      bridge: null,
      capabilities: [],
      can: false,
      frozen: true,
    });

    // The editor loads and edits through the shared schema (web/document-core.js).
    const editor = await page.evaluate(() => {
      const d = window.design.getDocument();
      d.pages[0].nodes.push({
        id: "smoke",
        type: "rectangle",
        name: "Smoke",
        x: 10,
        y: 10,
        w: 40,
        h: 40,
      });
      window.design.loadDocument(d);
      let rejected = "";
      try {
        window.design.loadDocument({
          ...d,
          pages: [
            {
              id: "x",
              name: "X",
              nodes: [{ id: "n", type: "rectangle", name: "N", x: 0, y: 0, w: 0, h: 10 }],
            },
          ],
        });
      } catch (error) {
        rejected = error.message;
      }
      return {
        schema: typeof window.VerynizeDocument?.validateDocument,
        version: d.version,
        smoke: !!window.design.getDocument().pages[0].nodes.find((n) => n.id === "smoke"),
        rejected,
        layer: !!document.querySelector('#canvas [data-id="smoke"]'),
      };
    });
    assert.deepEqual(editor, {
      schema: "function",
      version: 2,
      smoke: true,
      rejected: "Invalid node w",
      layer: true,
    });

    // The browser cover path rasterizes real editor markup without a desktop preload.
    const cover = await page.evaluate(async () => {
      const original = window.design.getDocument();
      const doc = structuredClone(original);
      doc.pages[0].nodes.push({
        id: "web-cover",
        name: "Cover",
        type: "frame",
        parentId: null,
        x: 0,
        y: 0,
        w: 64,
        h: 32,
        layout: "free",
        color: "#ff0000",
        radius: 0,
        opacity: 100,
      });
      window.design.loadDocument(doc);
      const before = JSON.stringify(window.design.getDocument());
      const src = await window.fileThumbnails.render("web-cover");
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = src;
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const result = {
        width: image.width,
        height: image.height,
        pixel: [...context.getImageData(60, 28, 1, 1).data],
        unchanged: before === JSON.stringify(window.design.getDocument()),
      };
      window.design.loadDocument(original);
      return result;
    });
    assert.deepEqual(cover, { width: 64, height: 32, pixel: [255, 0, 0, 255], unchanged: true });

    // Default covers render every first-page root, with negative bounds and the file's own tokens.
    const fullPage = await page.evaluate(async () => {
      const before = JSON.stringify(window.design.getDocument());
      const doc = window.design.getDocument();
      doc.tokens = { coverInk: "#ff0000" };
      doc.pages = [
        {
          id: "cover-first",
          name: "First",
          nodes: Array.from({ length: 40 }, (_, index) => ({
            id: `root-${index}`,
            type: "rectangle",
            name: `Root ${index}`,
            parentId: null,
            x: index * 10 - 100,
            y: -50,
            w: 10,
            h: 10,
            radius: 0,
            opacity: 100,
            token: index === 39 ? undefined : "coverInk",
            color: index === 39 ? "#00ff00" : "#0000ff",
          })),
        },
        { id: "cover-second", name: "Second", nodes: [] },
      ];
      doc.activePage = "cover-second";
      delete doc.thumbnailNodeId;
      const markup = window.design.thumbnailMarkup(null, doc);
      const src = await window.fileThumbnails.render(null, doc);
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = src;
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return {
        width: image.width,
        height: image.height,
        first: [...context.getImageData(5, 5, 1, 1).data],
        last: [...context.getImageData(395, 5, 1, 1).data],
        roots: (markup.html.match(/data-id=/g) || []).length,
        unchanged: before === JSON.stringify(window.design.getDocument()),
      };
    });
    assert.deepEqual(fullPage, {
      width: 400,
      height: 10,
      first: [255, 0, 0, 255],
      last: [0, 255, 0, 255],
      roots: 40,
      unchanged: true,
    });

    // Desktop-only entry points keep their web behaviour.
    assert.equal(
      await page.locator("#project-agent-status").textContent(),
      "Open the desktop app to use project files and local agents.",
    );
    assert.equal(
      await page.evaluate(() => document.body.classList.contains("onboarding-open")),
      false,
      "no desktop onboarding on the web",
    );
    // No window controls on the web: the title bar starts at the 8px edge gap, and there is no repositories sidebar.
    const chrome = await page.evaluate(() => ({
      platform: document.documentElement.dataset.platform,
      inset: getComputedStyle(document.querySelector('[data-chrome-bar][role="banner"]'))
        .paddingLeft,
      sidebar: !!document.getElementById("chrome-sidebar"),
    }));
    assert.deepEqual(chrome, { platform: "web", inset: "8px", sidebar: false });
    // Every opened file keeps its own tab; + opens the file switcher; closing the shown tab opens its neighbour.
    for (const name of ["Tab two", "Tab three"])
      await page.evaluate(async (name) => {
        const doc = window.design.getDocument();
        doc.name = name;
        await window.fileLibrary.createFromDocument(doc);
      }, name);
    const tabNames = () =>
      page
        .locator("[data-file-tab]:visible")
        .evaluateAll((tabs) =>
          tabs.map((tab) => tab.querySelector("input")?.value ?? tab.textContent.trim()),
        );
    assert.deepEqual((await tabNames()).slice(-2), ["Tab two", "Tab three"]);
    await page.locator("#shell-new-file").click();
    const switcher = page.locator("#file-switcher");
    await switcher.waitFor();
    assert.equal(await switcher.locator("[data-switcher-new]").isVisible(), true, "New file row");
    assert.equal(
      await switcher
        .locator('[data-switcher-section="Recents"] [data-switcher-file] [data-switcher-name]')
        .first()
        .innerText(),
      "Tab three",
      "Recents are newest first",
    );
    await page.keyboard.type("two");
    await page.keyboard.press("Enter");
    await switcher.waitFor({ state: "detached" });
    await page.waitForFunction(() => window.design.getDocument().name === "Tab two");
    assert.deepEqual(
      (await tabNames()).slice(-2),
      ["Tab two", "Tab three"],
      "opening keeps every tab",
    );
    await page.locator("[data-document-tab]").hover();
    await page.locator("[data-document-tab] [data-file-tab-close]").click();
    await page.waitForFunction(() => window.design.getDocument().name === "Tab three");
    assert.equal((await tabNames()).includes("Tab two"), false, "closed tab is gone");
    // The Figma dialog (a shadcn Dialog) exists only while open.
    await page.evaluate(() => document.getElementById("figma-import").click());
    await page.locator("#figma-run").click();
    await page.locator("#figma-status").filter({ hasText: /\S/ }).waitFor();
    const figma = await page.locator("#figma-status").textContent();
    await page.keyboard.press("Escape");
    await page.locator("#figma-dialog").waitFor({ state: "detached" });
    const notes = await page.evaluate(async () => {
      const $ = (id) => document.getElementById(id);
      const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
      $("capture-web-url").value = "https://example.com/";
      $("capture-web-form").requestSubmit();
      await settle();
      $("cloud-app-section").open = true;
      await settle();
      return {
        capture: $("capture-web-status").textContent,
        publish: $("cloud-app-project").textContent,
      };
    });
    assert.equal(figma, "Open the desktop app to import from Figma.");
    assert.deepEqual(notes, {
      capture: "Open the desktop app to capture web pages.",
      publish: "App publishing runs in the Verynize desktop app.",
    });
    await page.evaluate(() => window.appSettings.open("agents"));
    await page.locator("#settings-screen").getByText("Desktop app required").waitFor();
    await page.evaluate(() => window.appSettings.close());

    assert.deepEqual(errors, [], "no page errors");
    console.log(`web platform smoke (${browser.label}): PASS`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
