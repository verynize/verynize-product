// Grid settings (properties-audit G5 / H7): fr-weighted Fill tracks (columnSizes / rowSizes) and the
// "Automatic positioning" toggle (autoPosition). Each must validate, render (shared node-style), lay out
// headlessly and round-trip through the JSX and HTML codecs.
import test from "node:test";
import assert from "node:assert/strict";
import { validateDocument } from "./design-store.mjs";
import { getPage } from "./design-edit.mjs";
import { documentToJsx, jsxToDocument, documentToHtml, htmlToDocument } from "./codec-source.mjs";
import { nodeStyle, sizingError } from "./node-style.mjs";
import { layoutPage } from "./codec-layout.mjs";

const base = { color: "#dddddd", text: "", fontSize: 16, radius: 0 };
function sample() {
  return {
    version: 2,
    name: "Grid",
    activePage: "p",
    tokens: {},
    pages: [
      {
        id: "p",
        name: "Page",
        nodes: [
          {
            ...base,
            id: "grid",
            name: "Grid",
            type: "frame",
            x: 0,
            y: 0,
            w: 400,
            h: 200,
            layout: "grid",
            columns: 3,
            rows: 2,
            gap: 0,
            padding: 0,
            parentId: null,
            columnSizes: [1, 2, 1],
            rowSizes: [1, 3],
            autoPosition: false,
          },
          ...["a", "b", "c", "d"].map((id) => ({
            ...base,
            id,
            name: id.toUpperCase(),
            type: "rectangle",
            parentId: "grid",
            x: 0,
            y: 0,
            w: 10,
            h: 10,
            wMode: "fill",
            hMode: "fill",
          })),
        ],
      },
    ],
  };
}
const byName = (doc, name) => getPage(doc, doc.activePage).nodes.find((n) => n.name === name);
const css = (decls, prop) =>
  decls.box
    .filter(([p]) => p === prop)
    .map(([, v]) => v)
    .at(-1);

test("the validators accept track weights and the toggle and reject broken ones", () => {
  assert.doesNotThrow(() => validateDocument(sample()));
  const broken = (patch, i = 0) => {
    const d = sample();
    Object.assign(d.pages[0].nodes[i], patch);
    return d;
  };
  for (const bad of [
    { columnSizes: [1, 0] },
    { columnSizes: [1, -2] },
    { rowSizes: "x" },
    { columnSizes: [Infinity] },
    { columnSizes: Array(101).fill(1) },
  ])
    assert.throws(
      () => validateDocument(broken(bad)),
      /grid track sizes/,
      JSON.stringify(bad).slice(0, 40),
    );
  assert.throws(() => validateDocument(broken({ autoPosition: "off" })), /automatic positioning/);
  assert.throws(
    () => validateDocument(broken({ columnSizes: [1] }, 1)),
    /grid track sizes/,
    "only frames have tracks",
  );
  assert.equal(sizingError({ type: "frame", columnSizes: [1, 2.5] }), "");
});

test("node-style writes fr-weighted tracks and keeps equal tracks as repeat()", () => {
  const doc = sample(),
    grid = doc.pages[0].nodes[0];
  assert.equal(
    css(nodeStyle(grid, null, {}), "grid-template-columns"),
    "minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr)",
  );
  assert.equal(
    css(nodeStyle(grid, null, {}), "grid-template-rows"),
    "minmax(0, 1fr) minmax(0, 3fr)",
  );
  const equal = { ...grid, columnSizes: undefined, rowSizes: [1, 1] };
  assert.equal(
    css(nodeStyle(equal, null, {}), "grid-template-columns"),
    "repeat(3, minmax(0, 1fr))",
  );
  assert.equal(css(nodeStyle(equal, null, {}), "grid-template-rows"), "repeat(2, minmax(0, 1fr))");
  assert.equal(
    css(nodeStyle({ ...grid, columnSizes: [3] }, null, {}), "grid-template-columns"),
    "minmax(0, 3fr) minmax(0, 1fr) minmax(0, 1fr)",
    "missing weights are 1",
  );
  assert.equal(
    css(nodeStyle({ ...grid, autoPosition: true }, null, {}), "grid-template-rows"),
    css(nodeStyle(grid, null, {}), "grid-template-rows"),
    "Automatic positioning changes no CSS",
  );
});

test("the headless layout splits the free space by fr weight", () => {
  const doc = sample();
  layoutPage(getPage(doc, "p"));
  const box = (name) => {
    const n = byName(doc, name);
    return [n.x, n.y, n.w, n.h];
  };
  assert.deepEqual(box("A"), [0, 0, 100, 50]);
  assert.deepEqual(box("B"), [100, 0, 200, 50]);
  assert.deepEqual(box("C"), [300, 0, 100, 50]);
  assert.deepEqual(box("D"), [0, 50, 100, 150]);
});

test("JSX and HTML round-trip the tracks and the toggle", async () => {
  const doc = sample();
  const code = documentToJsx(doc, "p");
  assert.match(code, /grid-cols-\[minmax\(0,1fr\)_minmax\(0,2fr\)_minmax\(0,1fr\)\]/);
  assert.match(code, /grid-rows-\[minmax\(0,1fr\)_minmax\(0,3fr\)\]/);
  const tracks = (back) => {
    const g = byName(back, "Grid");
    return [g.columns, g.columnSizes, g.rows, g.rowSizes, g.autoPosition];
  };
  const { document: fromJsx } = jsxToDocument(code);
  assert.deepEqual(tracks(fromJsx), [3, [1, 2, 1], 2, [1, 3], false], "JSX");
  assert.doesNotThrow(() => validateDocument(fromJsx));
  assert.equal(
    documentToJsx(fromJsx, fromJsx.activePage).replace(/ data-node-id="[^"]*"/g, ""),
    code.replace(/ data-node-id="[^"]*"/g, ""),
    "JSX is a fixed point",
  );
  const { document: fromHtml } = await htmlToDocument(documentToHtml(doc, "p"));
  assert.deepEqual(tracks(fromHtml).slice(0, 4), [3, [1, 2, 1], 2, [1, 3]], "HTML");
  // Equal tracks export as grid-cols-N / grid-rows-N and import without weights.
  const plain = sample();
  Object.assign(plain.pages[0].nodes[0], {
    columnSizes: undefined,
    rowSizes: undefined,
    autoPosition: undefined,
  });
  const plainCode = documentToJsx(plain, "p");
  assert.match(plainCode, /grid-cols-3 grid-rows-2/);
  assert.deepEqual(tracks(jsxToDocument(plainCode).document), [
    3,
    undefined,
    2,
    undefined,
    undefined,
  ]);
});
