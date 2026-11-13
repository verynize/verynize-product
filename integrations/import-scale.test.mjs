import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importJsxInto, documentFromMeta } from "./codec-source.mjs";
import { parseJsx } from "./jsx-codec.mjs";
import { importHtml, parseHtml } from "./codec-html.mjs";
import { DesignStore } from "./design-store.mjs";
import { createStoreBackend, runTool } from "./design-tools.mjs";
import { NODE_LIMITS } from "./document-core.mjs";

const L = NODE_LIMITS.perPage,
  part = Math.floor(L * 0.6);

const board = (count, name = "Board") =>
  `<div data-name="${name}">${"<div/>".repeat(count - 1)}</div>`;
const count = (doc) => doc.pages.reduce((n, p) => n + p.nodes.length, 0);
test("whole artboards split by default, including a full target; opt-out is atomic", () => {
  const doc = importJsxInto(documentFromMeta(), "page-1", board(L)).document;
  const before = structuredClone(doc);
  const r = importJsxInto(doc, "page-1", board(part, "A") + board(part, "B"));
  assert.deepEqual(
    r.document.pages.map((p) => p.nodes.length),
    [L, part, part],
  );
  assert.deepEqual(
    r.pages.map((p) => p.name),
    ["Page 2", "Page 3"],
  );
  assert.deepEqual(
    r.pages.map((p) => p.artboards[0].name),
    ["A", "B"],
  );
  assert.throws(
    () => importJsxInto(doc, "page-1", board(2), { split: "none" }),
    /Nothing was imported/,
  );
  assert.deepEqual(doc, before);
  assert.throws(() => importJsxInto(doc, "page-1", board(L + 1)), new RegExp(`incoming=${L + 1}`));
});
test("document cap rejects all incoming boards atomically", () => {
  const doc = documentFromMeta();
  doc.pages = Array.from({ length: NODE_LIMITS.perDocument / L }, (_, p) => ({
    id: p ? `page-${p + 1}` : "page-1",
    name: `Page ${p}`,
    nodes: Array.from({ length: L }, (_, n) => ({
      id: `n-${p}-${n}`,
      type: "rectangle",
      parentId: null,
    })),
  }));
  assert.throws(
    () => importJsxInto(doc, "page-1", "<div/>"),
    new RegExp(
      `document existing=${NODE_LIMITS.perDocument}, incoming=1, limit=${NODE_LIMITS.perDocument}`,
    ),
  );
  assert.equal(count(doc), NODE_LIMITS.perDocument);
});
test("parser guards permit 20K elements and reject excess and deep nesting", () => {
  const start = performance.now(),
    heap = process.memoryUsage().heapUsed;
  assert.equal(parseJsx("<div/>".repeat(20000)).elements.length, 20000);
  console.log(
    `20K JSX parse: ${(performance.now() - start).toFixed(0)}ms, heap delta ${((process.memoryUsage().heapUsed - heap) / 1048576).toFixed(1)} MiB`,
  );
  assert.throws(() => parseJsx("<div/>".repeat(50001)), /limit is 50000/);
  assert.throws(() => parseJsx("<div>".repeat(260) + "</div>".repeat(260)), /nesting limit/);
  assert.throws(() => parseHtml("<div>".repeat(260)), /nesting limit/);
});
test("CSS pruning preserves matching selectors, inheritance and cascade", async () => {
  const css = Array.from({ length: 10000 }, (_, n) => `.unused-${n}{color:red}`).join("");
  const html = `<style>${css}.parent .child{color:blue}.child:hover{color:red}:is(.child,.missing){padding:7px}[data-name="Child"]{border-radius:8px}</style><div class="parent"><div data-name="Child" class="child">Hi</div></div>`;
  const props = (r) =>
    r.document.pages[0].nodes.map(({ name, color, textColor, radius, padding }) => ({
      name,
      color,
      textColor,
      radius,
      padding,
    }));
  const start = performance.now();
  const baseline = await importHtml(html, { pruneCss: false });
  const middle = performance.now();
  const pruned = await importHtml(html);
  console.log(
    `CSS 10K rules: unpruned ${(middle - start).toFixed(0)}ms, pruned ${(performance.now() - middle).toFixed(0)}ms, removed ${pruned.stats.prunedRules}`,
  );
  // The default 50ms deadline keeps the rest under load, so count removals without one.
  const unbounded = await importHtml(html, { pruneCssBudgetMs: Infinity });
  assert.equal(unbounded.stats.prunedRules, 10000);
  assert.deepEqual(props(unbounded), props(baseline));
  assert.deepEqual(props(pruned), props(baseline));
});
test("20K-node HTML and JSX imports run end-to-end through file backend", async () => {
  const dir = await mkdtemp(join(tmpdir(), "import-scale-"));
  try {
    const store = new DesignStore(dir),
      backend = createStoreBackend(store);
    const source = Array.from({ length: 20 }, (_, n) => board(1000, `Screen ${n}`)).join("");
    for (const format of ["jsx", "html"]) {
      await store.create(format, format);
      const start = performance.now(),
        heap = process.memoryUsage().heapUsed;
      const result = await runTool(backend, `import_${format}`, {
        document: format,
        [format === "jsx" ? "code" : "html"]: source.replaceAll(
          "<div/>",
          format === "html" ? "<div></div>" : "<div/>",
        ),
      });
      assert.ok(!result.isError, JSON.stringify(result));
      const report = JSON.parse(result.content[0].text);
      assert.equal(
        report.pages.reduce((n, p) => n + p.nodeCount, 0),
        20000,
      );
      const saved = await backend.read(format);
      assert.equal(count(saved.document), 20000);
      assert.equal(saved.document.pages.length, Math.ceil(20000 / L));
      console.log(
        `20K ${format} runTool: ${(performance.now() - start).toFixed(0)}ms, heap delta ${((process.memoryUsage().heapUsed - heap) / 1048576).toFixed(1)} MiB, RSS ${(process.memoryUsage().rss / 1048576).toFixed(1)} MiB`,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("elliptical radius approximation and image sizing agree across HTML and JSX", async () => {
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1kAAAAASUVORK5CYII=";
  for (const [size, fit] of [
    ["contain", "contain"],
    ["cover", "cover"],
    ["100% 100%", "fill"],
    ["auto", "none"],
  ]) {
    const html = await importHtml(
      `<div style="border-radius:12px / 24px;background-image:url(${png});background-size:${size};background-position:center;background-repeat:no-repeat"></div>`,
    );
    const jsx = importJsxInto(
      documentFromMeta(),
      "page-1",
      `<div className="rounded-[12px/24px] [background-image:url(${png})] [background-size:${size.replaceAll(" ", "_")}]"/>`,
    );
    for (const result of [html, jsx]) {
      assert.equal(result.document.pages[0].nodes[0].radius, 12);
      assert.equal(result.document.pages[0].nodes[0].fills[0].fit, fit);
      assert.ok(result.warnings.some((w) => /elliptical/.test(w)));
    }
  }
});
test("large full HTML promotes body sections and honors explicit opt-out", async () => {
  const source =
    "<html><body>" +
    (board(part, "A") + board(part, "B")).replaceAll("<div/>", "<div></div>") +
    "</body></html>";
  const result = await importHtml(source);
  assert.equal(result.document.pages.length, 2);
  assert.equal(count(result.document), 2 * part);
  await assert.rejects(importHtml(source, { split: "none" }), /Nothing was imported/);
});
test("HTML emitted element budget fails atomically at a configured limit", async () => {
  await assert.rejects(
    importHtml("<div></div>".repeat(11), { maxElements: 10 }),
    /exceeds 10 elements/,
  );
});
test("splitting retains sibling order and per-page root placement", () => {
  const doc = importJsxInto(documentFromMeta(), "page-1", board(L)).document;
  const result = importJsxInto(
    doc,
    "page-1",
    '<div data-name="Root"><div data-name="First"/><div data-name="Second"/></div><div data-name="Next"/>',
    { placement: "auto" },
  );
  const page = result.document.pages[1];
  assert.deepEqual(
    page.nodes.map((n) => n.name),
    ["Root", "First", "Second", "Next"],
  );
  assert.ok(page.nodes[3].x >= page.nodes[0].x + page.nodes[0].w);
  assert.equal(page.nodes[0].x, 0, "a new page lays its artboards out from the origin");
  assert.equal(page.nodes[0].y, 0);
});

test("CSS pruning includes the HTML root in its selector inventory", async () => {
  const html =
    '<html id="root" class="theme"><head><style>html.theme#root{font-size:20px}div{padding:1.5rem}</style></head><body><div data-name="Child"></div></body></html>';
  for (const pruneCss of [true, false]) {
    const r = await importHtml(html, { pruneCss });
    assert.equal(r.document.pages[0].nodes.find((n) => n.name === "Child").padding, 30);
  }
});

test("HTML tool splits a full target page and opt-out preserves revision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "import-full-"));
  try {
    const store = new DesignStore(dir),
      backend = createStoreBackend(store);
    await store.create("full", "Full");
    const filled = await runTool(backend, "import_jsx", { document: "full", code: board(L) });
    assert.ok(!filled.isError, JSON.stringify(filled));
    const before = await backend.read("full");
    const refused = await runTool(backend, "import_html", {
      document: "full",
      html: "<div>New</div>",
      split: "none",
    });
    assert.equal(refused.isError, true);
    assert.equal((await backend.read("full")).revision, before.revision);
    const accepted = await runTool(backend, "import_html", {
      document: "full",
      html: '<div data-name="New">New</div>',
    });
    assert.ok(!accepted.isError, JSON.stringify(accepted));
    const report = JSON.parse(accepted.content[0].text);
    assert.equal(report.pages.length, 1);
    assert.equal(report.pages[0].artboards[0].name, "New");
    const saved = await backend.read("full");
    assert.equal(saved.document.pages.length, 2);
    assert.equal(saved.document.pages[0].nodes.length, L);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
