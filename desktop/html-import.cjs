// Import HTML: pasted markup or a chosen .html file goes through the headless importer
// (integrations/codec-html.mjs): external stylesheets (relative to the chosen file; http(s) only when the
// user allows remote loading), the CSS cascade for a chosen viewport, :root colour tokens and typed
// variables. The renderer sends its current document and receives the updated one.
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const HTML_LIMIT = 5_000_000;
const codec = () =>
  import(pathToFileURL(path.join(__dirname, "../integrations/codec-html.mjs")).href);

/** Validate the renderer's options; returns importer options. */
function importOptions(options = {}) {
  const viewport = options.viewport || {};
  const width = Number(viewport.width),
    height = Number(viewport.height);
  if (
    !Number.isFinite(width) ||
    width < 200 ||
    width > 8000 ||
    !Number.isFinite(height) ||
    height < 200 ||
    height > 8000
  )
    throw Error("Viewport must be 200–8000 px wide and tall");
  if (!options.document || typeof options.document !== "object") throw Error("Missing document");
  return {
    viewport: {
      width,
      height,
      colorScheme: options.viewport.colorScheme === "dark" ? "dark" : "light",
    },
    document: options.document,
    pageId: typeof options.pageId === "string" ? options.pageId : undefined,
    allowRemote: options.allowRemote === true,
    assetSink: async (bytes, type) => (await require("./assets.cjs").store()).put(bytes, type),
  };
}
const summary = (result) => ({
  document: result.document,
  pageId: result.pageId,
  rootIds: (result.roots || []).map((r) => r.id),
  warnings: result.warnings,
  stats: result.stats,
});

async function importSource(options = {}) {
  const html = options.html;
  if (typeof html !== "string" || !html.trim()) throw Error("Paste some HTML to import");
  if (Buffer.byteLength(html) > HTML_LIMIT) throw Error("HTML source exceeds limit 5000000 bytes");
  let baseUrl;
  if (typeof options.baseUrl === "string" && options.baseUrl.trim()) {
    const url = new URL(options.baseUrl.trim());
    if (!["http:", "https:"].includes(url.protocol)) throw Error("Base URL must be http(s)");
    baseUrl = url.href;
  }
  const { importHtml } = await codec();
  return summary(await importHtml(html, { ...importOptions(options), baseUrl }));
}

async function importFile(file, options = {}) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw Error("Choose an HTML file");
  if (stat.size > HTML_LIMIT) throw Error("HTML source exceeds limit 5000000 bytes");
  const { importHtml } = await codec();
  // Local stylesheets and images resolve relative to the file and must stay inside its folder.
  const result = await importHtml(await fs.readFile(file, "utf8"), {
    ...importOptions(options),
    baseUrl: file,
    root: path.dirname(file),
    allowFiles: true,
    fallbackName: path.basename(file).replace(/\.html?$/i, ""),
  });
  return { ...summary(result), file: path.basename(file) };
}

function registerHtmlImport(handle, parent, { dialog } = {}) {
  handle("importHtml", (options) => importSource(options));
  handle("importHtmlFile", async (options) => {
    importOptions(options);
    const electron = dialog || require("electron").dialog;
    const picked = await electron.showOpenDialog(parent, {
      title: "Import HTML",
      properties: ["openFile"],
      filters: [{ name: "HTML", extensions: ["html", "htm"] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    return importFile(picked.filePaths[0], options);
  });
}

module.exports = { registerHtmlImport, importSource, importFile };
