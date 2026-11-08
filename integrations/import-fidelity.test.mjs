import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { NODE_LIMITS } from "./document-core.mjs";
import { preflightImportNodes } from "./design-edit.mjs";
import { importHtml } from "./codec-html.mjs";
import { jsxToDocument, documentFromMeta, importJsxInto } from "./codec-source.mjs";
import { DesignStore } from "./design-store.mjs";
import { createStoreBackend, runTool } from "./design-tools.mjs";
const nodes = (r) => r.document.pages[0].nodes;
const svg =
  '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M0 0 L24 24" stroke="red"/></svg>';
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1kAAAAASUVORK5CYII=";
test("HTML and JSX SVG become one vector layer with geometry and paths", async () => {
  for (const r of [await importHtml(svg), jsxToDocument(svg)]) {
    assert.equal(nodes(r).length, 1);
    const n = nodes(r)[0];
    assert.equal(n.type, "vector");
    assert.equal(n.w, 24);
    assert.deepEqual(n.viewBox, [0, 0, 24, 24]);
    assert.deepEqual(n.paths, [{ d: "M0 0L24 24" }]);
    assert.equal(n.strokeColor, "#ff0000");
  }
});
test("HTML and JSX SVG a vector cannot hold stay one sanitized image with geometry and paths", async () => {
  const text = svg.replace("</svg>", "<text>Label</text></svg>");
  for (const r of [await importHtml(text), jsxToDocument(text)]) {
    assert.equal(nodes(r).length, 1);
    const n = nodes(r)[0];
    assert.equal(n.type, "image");
    assert.equal(n.w, 24);
    assert.ok(r.warnings.some((w) => /SVG uses text; kept it as an SVG image/.test(w)));
    const decoded = Buffer.from(n.src.split(",")[1], "base64").toString();
    assert.match(decoded, /viewBox="0 0 24 24"/);
    assert.match(decoded, /M0 0 L24 24/);
    assert.equal((decoded.match(/<\/svg>/g) || []).length, 1);
  }
});
test("arbitrary border, corners, outline and data background match HTML CSS", async () => {
  for (const [css, cls, props] of [
    ["border:2px solid red", "[border:2px_solid_red]", ["strokeWidth", "strokeColor"]],
    [
      "border-left:3px solid blue",
      "[border-left:3px_solid_blue]",
      ["strokeWidths", "strokeColors"],
    ],
    ["border-radius:1px 2px 3px 4px", "[border-radius:1px_2px_3px_4px]", ["cornerRadii"]],
    ["outline:3px solid blue", "[outline:3px_solid_blue]", ["outlineWidth", "outlineColor"]],
    [`background-image:url(${png})`, `[background-image:url(${png})]`, ["fills"]],
    [`background:url(${png})`, `[background:url(${png})]`, ["fills"]],
  ]) {
    const baseline = nodes(await importHtml(`<div style="${String(css)}"></div>`))[0];
    for (const r of [
      await importHtml(`<div class="${String(cls)}"></div>`),
      jsxToDocument(`<div className="${String(cls)}"/>`),
    ])
      for (const prop of props)
        assert.deepEqual(nodes(r)[0][prop], baseline[prop], `${String(cls)} ${prop}`);
  }
  assert.ok(
    jsxToDocument('<div className="[border-radius:2px/4px]"/>').warnings.some((w) =>
      /elliptical/.test(w),
    ),
  );
});
test("visible text and unresolved relative images have explicit outcomes", async () => {
  const r = await importHtml(
    '<div><div style="display:contents">LOST<span>kept</span></div><input value="Value"><input placeholder="Hint"><textarea>Area</textarea><select><option>A</option><option selected>B</option></select><img src="pic.png"></div>',
  );
  const text = nodes(r)
    .map((n) => n.text || "")
    .join(" ");
  for (const word of ["LOST", "kept", "Value", "Hint", "Area", "B"])
    assert.ok(text.includes(word), word);
  assert.ok(r.warnings.some((w) => /Unresolved relative image/.test(w)));
});
test("source budget allows embedded data above the former hidden cap", async () => {
  const source = `<img src="data:image/png;base64,${"A".repeat(2_000_001)}"/>`;
  assert.ok(nodes(await importHtml(source))[0].src.length > 2_000_000);
  assert.ok(nodes(jsxToDocument(source))[0].src.length > 2_000_000);
});
test("expanded node preflight is atomic and reports counts", () => {
  const doc = documentFromMeta();
  const before = structuredClone(doc);
  const limit = NODE_LIMITS.perPage;
  assert.throws(
    () => preflightImportNodes(doc, doc.activePage, limit + 1),
    new RegExp(`existing=0, incoming=${limit + 1}, limit=${limit}`),
  );
  const importButtons = () =>
    importJsxInto(doc, doc.activePage, "<div>" + "<button>X</button>".repeat(2500) + "</div>");
  if (limit < 5001) assert.throws(importButtons, /incoming=5001/);
  else assert.equal(nodes(importButtons()).length, 5001);
  assert.deepEqual(doc, before);
  // The document budget counts every page, not only the target page.
  const full = documentFromMeta();
  const filler = (count) =>
    Array.from({ length: count }, (_, i) => ({
      id: `n${full.pages.length}-${i}`,
      type: "rectangle",
    }));
  while (full.pages.reduce((sum, p) => sum + p.nodes.length, 0) < NODE_LIMITS.perDocument - limit)
    full.pages.push({ id: `p${full.pages.length}`, name: "Filler", nodes: filler(limit) });
  const total = full.pages.reduce((sum, p) => sum + p.nodes.length, 0);
  assert.ok(total > 10000, "the document budget is larger than the old 10,000-node cap");
  preflightImportNodes(full, full.activePage, NODE_LIMITS.perDocument - total);
  assert.throws(
    () => preflightImportNodes(full, full.activePage, NODE_LIMITS.perDocument - total + 1),
    new RegExp(
      `document existing=${total}, incoming=${NODE_LIMITS.perDocument - total + 1}, limit=${NODE_LIMITS.perDocument}`,
    ),
  );
});
test("concurrent imports both land, auto placement separates roots and names persist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "import-fidelity-"));
  try {
    const store = new DesignStore(dir);
    await store.create("test", "Test");
    const backend = createStoreBackend(store);
    const results = await Promise.all(
      ["One", "Two"].map((name) =>
        runTool(backend, "import_html", {
          document: "test",
          name,
          html: '<div style="position:absolute;left:0px;top:0px;width:100px;height:100px"></div>',
        }),
      ),
    );
    for (const r of results) assert.ok(!r.isError, JSON.stringify(r));
    const roots = (await store.read("test")).document.pages[0].nodes.filter((n) => !n.parentId);
    assert.deepEqual(roots.map((n) => n.name).sort(), ["One", "Two"]);
    assert.ok(Math.abs(roots[0].x - roots[1].x) >= 180);
    const result = await runTool(backend, "import_jsx", {
      document: "test",
      placement: "preserve",
      code: '<div data-name="Preserved" data-component-x="12" data-component-y="34"/>',
    });
    assert.ok(!result.isError, JSON.stringify(result));
    assert.equal(
      (await store.read("test")).document.pages[0].nodes.find((n) => n.name === "Preserved").x,
      12,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("explicit remote opt-in embeds real loopback images and reports failures", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/missing") {
      res.writeHead(404);
      res.end();
    } else {
      res.setHeader("content-type", "image/png");
      res.end(Buffer.from(png.split(",")[1], "base64"));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const r = await importHtml(`<div><img src="${url}/image"><img src="${url}/missing"></div>`, {
      allowRemote: true,
    });
    assert.equal(nodes(r).filter((n) => n.src === png).length, 1);
    assert.ok(r.warnings.some((w) => /404/.test(w)));
  } finally {
    server.close();
  }
});

test("shorthand winners honor important declarations and reset every corner", async () => {
  const cls =
    "[border-radius:1px_2px_3px_4px] [border-radius:9px]! [border:2px_solid_red]! [border:3px_solid_blue]";
  for (const result of [
    await importHtml(`<div class="${cls}"></div>`),
    jsxToDocument(`<div className="${cls}"/>`),
  ]) {
    const node = nodes(result)[0];
    assert.equal(node.radius, 9);
    assert.equal(node.cornerRadii, undefined);
    assert.equal(node.strokeWidth, 2);
    assert.equal(node.strokeColor, "#ff0000");
  }
});

test("HTML expansion counts canvas nodes and names the overflowing page atomically", async () => {
  const doc = documentFromMeta();
  doc.pages[0].name = "Import target";
  const source = "<div>" + "<button>X</button>".repeat(5000) + "</div>";
  // Only 5001 HTML elements, but each button also needs its own text layer.
  const before = structuredClone(doc);
  const { prepareHtmlImport } = await import("./codec-source.mjs");
  await assert.rejects(async () => {
    const prepared = await prepareHtmlImport(source, doc, doc.activePage, { split: "none" });
    prepared.apply(doc);
  }, /(?:Import target|artboard).*10001|10001.*(?:Import target|artboard)/i);
  assert.deepEqual(doc, before);
});

test("unnamed overflowing pages report their ID instead of the document limit", async () => {
  const { documentProblems } = await import("./document-core.mjs");
  const doc = documentFromMeta();
  const page = doc.pages[0];
  delete page.name;
  page.nodes = Array.from({ length: NODE_LIMITS.perPage + 1 }, (_, i) => ({
    id: `n${i}`,
    type: "rectangle",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
  }));
  assert.ok(
    documentProblems(doc).some((problem) =>
      problem.message.includes(`Page "${page.id}" has 10001 nodes; limit is 10000`),
    ),
  );
});
