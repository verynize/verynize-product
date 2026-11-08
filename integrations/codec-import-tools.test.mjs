// Product wiring of the HTML/JSX importer: the MCP tools import_html / import_jsx / export_css / export_jsx
// (shared by the stdio server and the desktop bridge) on a real on-disk store, and the desktop IPC module
// desktop/html-import.cjs behind the Import HTML dialog (real files, real local HTTP server).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { DesignStore } from "./design-store.mjs";
import { createStoreBackend, runTool } from "./design-tools.mjs";

const require = createRequire(import.meta.url);
const json = (result) => {
  assert.ok(!result.isError, result.content?.[0]?.text);
  return JSON.parse(result.content[0].text);
};
const strip = (node) => {
  const { id: _id, parentId: _parentId, shortId: _shortId, measured: _measured, ...rest } = node;
  return rest;
};

async function site(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codec-tools-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, "css"));
  await fs.writeFile(path.join(dir, "css", "theme.css"), ":root{--brand:#7c3aed;--space:20px}");
  await fs.writeFile(
    path.join(dir, "css", "site.css"),
    '@import "theme.css";.card{padding:var(--space);background:var(--brand);color:#fff;border-radius:12px}@media (max-width:700px){.card{border-radius:0}}',
  );
  await fs.writeFile(
    path.join(dir, "index.html"),
    '<!doctype html><title>Promo</title><link rel="stylesheet" href="css/site.css"><body style="margin:0"><div class="card"><h2>Hello</h2></div></body>',
  );
  return dir;
}

test("MCP import_html / export_css / export_jsx / import_jsx on a real store", async (t) => {
  const dir = await site(t);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codec-tools-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const backend = createStoreBackend(await DesignStore.open(root));
  const NAMED = new Set(["read_document", "export_css", "export_jsx"]); // these take `name`, not `document`
  const run = (name, args = {}) =>
    runTool(
      backend,
      name,
      name === "create_document"
        ? args
        : { ...(NAMED.has(name) ? { name: "doc" } : { document: "doc" }), ...args },
    );
  json(await run("create_document", { name: "doc", title: "Doc" }));

  const fromFile = json(
    await run("import_html", {
      path: path.join(dir, "index.html"),
      viewport: { width: 1280, height: 800 },
    }),
  );
  assert.equal(fromFile.artboards.length, 1);
  assert.equal(fromFile.stats.stylesheets, 2, "<link> plus its @import");
  let doc = json(await run("read_document")).document;
  const card = doc.pages[0].nodes.find((n) => n.name === "div.card");
  assert.deepEqual(
    [card.padding, card.radius, card.token, card.bindings],
    [20, 12, "brand", { padding: "space" }],
  );
  assert.equal(doc.tokens.brand, "#7c3aed");
  assert.deepEqual(doc.variables.space, { type: "dimension", value: 20 });

  // Narrow viewport: the media query applies; the new artboard is placed beside the first one.
  json(
    await run("import_html", {
      path: path.join(dir, "index.html"),
      viewport: { width: 600, height: 800 },
    }),
  );
  doc = json(await run("read_document")).document;
  const roots = doc.pages[0].nodes.filter((n) => !n.parentId);
  assert.equal(roots.length, 2);
  assert.ok(roots[1].x >= roots[0].x + roots[0].w, "placed to the right of the existing artboard");
  assert.equal(doc.pages[0].nodes.filter((n) => n.name === "div.card")[1].radius, 0);

  assert.match((await run("import_html", { path: "relative.html" })).content[0].text, /absolute/);
  assert.match(
    (await run("import_html", { url: "http://127.0.0.1:9/x.html" })).content[0].text,
    /allowRemote/,
  );
  assert.match((await run("import_html", {})).content[0].text, /exactly one of html, path or url/);

  // Lossless exports, read back into a fresh document.
  const css = json(await run("export_css")).html;
  const jsx = json(await run("export_jsx")).code;
  json(await runTool(backend, "create_document", { name: "copy", title: "Copy" }));
  json(await runTool(backend, "import_html", { document: "copy", html: css }));
  json(await runTool(backend, "create_document", { name: "copy2", title: "Copy 2" }));
  json(await runTool(backend, "import_jsx", { document: "copy2", code: jsx }));
  for (const name of ["copy", "copy2"]) {
    const back = json(await runTool(backend, "read_document", { name })).document;
    assert.deepEqual(back.pages[0].nodes.map(strip), doc.pages[0].nodes.map(strip), name);
    assert.deepEqual(back.tokens, doc.tokens);
    assert.deepEqual(back.variables, doc.variables);
  }

  // Remote page with allowRemote, served by a real local server.
  const server = http.createServer((req, res) => {
    if (req.url === "/a.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end(".x{padding:7px;background:#123456}");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end('<link rel="stylesheet" href="/a.css"><div class="x">Remote</div>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const remote = json(
    await run("import_html", {
      url: `http://127.0.0.1:${server.address().port}/`,
      allowRemote: true,
    }),
  );
  doc = json(await run("read_document")).document;
  const x = doc.pages[0].nodes.find((n) => n.name === "div.x");
  assert.equal(remote.artboards.length, 1);
  assert.deepEqual([x.padding, x.color], [7, "#123456"]);
});

test("desktop IPC (Import HTML dialog): pasted HTML and a chosen file with its stylesheets", async (t) => {
  const dir = await site(t);
  const { registerHtmlImport } = require("../desktop/html-import.cjs");
  const handlers = {};
  let picked = [];
  registerHtmlImport(
    (name, fn) => {
      handlers[name] = fn;
    },
    null,
    { dialog: { showOpenDialog: async () => ({ canceled: !picked.length, filePaths: picked }) } },
  );
  assert.deepEqual(Object.keys(handlers).sort(), ["importHtml", "importHtmlFile"]);
  const document = {
    version: 2,
    name: "App",
    activePage: "p",
    tokens: { brand: "#000000" },
    pages: [{ id: "p", name: "P", nodes: [] }],
  };
  const viewport = { width: 1280, height: 800 };
  assert.equal(
    await handlers.importHtmlFile({ document, pageId: "p", viewport }),
    null,
    "cancelled dialog",
  );
  picked = [path.join(dir, "index.html")];
  const file = await handlers.importHtmlFile({ document, pageId: "p", viewport });
  assert.equal(file.file, "index.html");
  const card = file.document.pages[0].nodes.find((n) => n.name === "div.card");
  assert.equal(card.color, "#7c3aed", "the conflicting existing token is not rebound");
  assert.equal(card.token, "");
  assert.equal(file.document.tokens.brand, "#000000");
  assert.deepEqual(file.rootIds.length, 1);
  const pasted = await handlers.importHtml({
    document,
    pageId: "p",
    viewport,
    html: "<style>:root{--ink:#0f766e}p{color:var(--ink)}</style><p>Pasted</p>",
  });
  assert.equal(pasted.document.tokens.ink, "#0f766e");
  assert.equal(pasted.document.pages[0].nodes.find((n) => n.text === "Pasted").token, "ink");
  await assert.rejects(
    handlers.importHtml({ document, viewport: { width: 10, height: 10 }, html: "<p>x</p>" }),
    /Viewport/,
  );
  await assert.rejects(handlers.importHtml({ document, viewport, html: " " }), /Paste some HTML/);
});
