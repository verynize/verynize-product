// Dedicated Electron main process for render-readiness.cjs. Never show native error dialogs.
process.on("uncaughtException", (error) => {
  console.error(error);
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error(error);
  process.exit(1);
});
const { app, BrowserWindow, dialog, protocol } = require("electron");
dialog.showErrorBox = (title, message) => {
  console.error(title, message);
  process.exitCode = 1;
};
require("../desktop/app-protocol.cjs").registerSchemes(protocol);
void app.whenReady().then(() => {
  global.render = require("../desktop/render.cjs");
  global.renderAssets = require("../desktop/assets.cjs");
  global.renderAssets.register();
  protocol.handle(
    "http",
    () =>
      new Response("<!doctype html><body>Asset test</body>", {
        headers: { "content-type": "text/html" },
      }),
  );
  global.win = new BrowserWindow({ show: false });
  return global.win.loadURL("http://localhost/render-test");
});

// Real file backend plus the production renderer, exercised through the MCP definition.
global.captureTool = async (root) => {
  const { DesignStore } = await import("../integrations/design-store.mjs");
  const { createStoreBackend, toolTable, sessionFor } =
    await import("../integrations/design-tools.mjs");
  const { exportHTML } = await import("../integrations/export-html.mjs");
  const store = await DesignStore.open(root);
  await store.create("large", "Large");
  const state = await store.mutate("large", async () => {
    const { document } = await store.read("large");
    document.pages[0].nodes.push({
      id: "board",
      shortId: "big",
      name: "Large board",
      type: "frame",
      x: 0,
      y: 0,
      w: 18420,
      h: 5313,
      color: "#ffffff",
      layout: "free",
      parentId: null,
    });
    return document;
  });
  const backend = createStoreBackend(store, {
    screenshot: async (document, pageId, nodeId, scale) => {
      const shot = await global.render.renderHTML({
        html: exportHTML(document, pageId, { nodeId }),
        width: 18420,
        height: 5313,
        scale,
        screenshot: true,
        fonts: [],
      });
      return {
        data: shot.dataURL.split(",")[1],
        width: shot.width,
        height: shot.height,
        source: "offscreen",
        bounds: shot.boxes,
        fonts: shot.fonts,
      };
    },
  });
  const output = await toolTable(backend).take_screenshot.run({
    document: "large",
    pageId: state.document.pages[0].id,
    id: "board",
  });
  const current = await backend.read("large");
  const receipt = sessionFor(backend).receipts.latest(
    "large",
    current.document.pages[0].nodes[0].shortId,
  );
  return { image: output.content.some((block) => block.type === "image"), receipt };
};
