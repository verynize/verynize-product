// Vector layers through every text format: SVG → vectors (web/vector-svg.js), JSX round trips (jsx-codec.mjs +
// design-edit.mjs), update_elements edits, HTML import (codec-html.mjs), HTML export (export-html.mjs) and the schema.
import test from "node:test";
import assert from "node:assert/strict";
import { importSvg, toNodes } from "./vector-svg.mjs";
import { parsePath, pathBounds } from "./vector-geometry.mjs";
import { validateDocument } from "./design-store.mjs";
import { createArtboards, elementCode, getPage, runDirectives } from "./design-edit.mjs";
import { importHtml } from "./codec-html.mjs";
import { exportHTML } from "./export-html.mjs";

const LUCIDE_ARROW = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;
const LOGO = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<!-- exported by a drawing app -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 50">
  <style>.brand { fill: #ff0000 } #dot { opacity: .5 }</style>
  <defs><path id="tri" d="M0 0h5v5z"/></defs>
  <g transform="translate(10 5) scale(2)">
    <rect class="brand" width="10" height="10" rx="2"/>
    <circle id="dot" cx="20" cy="5" r="5" fill="blue"/>
  </g>
  <use xlink:href="#tri" x="80" y="30" fill="green"/>
</svg>`;
const empty = () => ({
  version: 2,
  name: "Vectors",
  tokens: { ink: "#112233" },
  activePage: "p",
  pages: [{ id: "p", name: "Page", nodes: [] }],
});
const vectors = (page) => page.nodes.filter((n) => n.type === "vector");
const shape = (n) => ({
  name: n.name,
  w: n.w,
  h: n.h,
  viewBox: n.viewBox,
  paths: n.paths,
  fills: n.fills,
  color: n.fills ? undefined : n.color,
  token: n.token || undefined,
  strokeWidth: n.strokeWidth,
  strokeColor: n.strokeWidth ? n.strokeColor : undefined,
  strokeToken: n.strokeToken,
  strokeCap: n.strokeCap,
  strokeJoin: n.strokeJoin,
  strokeDash: n.strokeDash,
  strokeHidden: n.strokeHidden,
});

test("an icon imports as one stroked vector the size of the SVG", () => {
  const result = importSvg(LUCIDE_ARROW, { color: "#334155" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.viewBox, [0, 0, 24, 24]);
  assert.equal(result.layers.length, 1, "both paths share one paint");
  assert.deepEqual(result.layers[0].paths, [{ d: "M5 12L19 12" }, { d: "M12 5L19 12L12 19" }]);
  const [node] = toNodes(result, { uid: () => "a", w: 48, h: 48 });
  assert.equal(node.type, "vector");
  assert.deepEqual(node.fills, [], 'fill="none" is an empty paint stack');
  assert.equal(node.strokeWidth, 4, "stroke-width scales with the layer (2 at 24 px → 4 at 48 px)");
  assert.equal(node.strokeColor, "#334155", "currentColor");
  assert.equal(node.strokeCap, "round");
  assert.equal(node.strokeJoin, "round");
});

test("transforms, <use>, <style> rules, shapes and opacity are baked into absolute paths", () => {
  const result = importSvg(LOGO);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.layers.length, 3, "three paints");
  const [rect, dot, tri] = result.layers;
  assert.deepEqual(rect.style.fill, { color: "#ff0000", opacity: 100 });
  assert.deepEqual(
    pathBounds(parsePath(rect.paths[0].d)),
    { x: 10, y: 5, w: 20, h: 20 },
    "translate(10 5) scale(2)",
  );
  assert.deepEqual(dot.style.fill, { color: "#0000ff", opacity: 50 }, "#dot { opacity: .5 }");
  const b = pathBounds(parsePath(dot.paths[0].d));
  assert.deepEqual(
    [b.x, b.y, b.w, b.h].map((v) => Math.round(v * 1000) / 1000),
    [40, 5, 20, 20],
  );
  assert.equal(tri.paths[0].d, "M80 30L85 30L85 35Z", "<use> at x/y");
  // Several paints: a free frame of the SVG's size holding one vector per paint, each hugging its geometry.
  let id = 0;
  const nodes = toNodes(result, { name: "Logo", uid: () => "n" + id++ });
  assert.equal(nodes[0].type, "frame");
  assert.deepEqual([nodes[0].w, nodes[0].h, nodes[0].layout], [100, 50, "free"]);
  assert.deepEqual(
    nodes.slice(1).map((n) => [n.x, n.y, n.w, n.h]),
    [
      [10, 5, 20, 20],
      [40, 5, 20, 20],
      [80, 30, 5, 5],
    ],
  );
  const doc = empty();
  doc.pages[0].nodes = nodes.map((n) => ({ ...n, text: "" }));
  validateDocument(doc);
});

test("preserveAspectRatio, nested viewports and hidden content", () => {
  // A 10×10 viewBox shown in a 20×10 viewport is letterboxed: the layer's viewBox is the region really shown.
  assert.deepEqual(
    importSvg(
      `<svg viewBox="0 0 10 10" width="20" height="10"><rect width="10" height="10"/></svg>`,
    ).viewBox,
    [-5, 0, 20, 10],
  );
  assert.deepEqual(
    importSvg(
      `<svg viewBox="0 0 10 10" width="20" height="10" preserveAspectRatio="none"><rect width="10" height="10"/></svg>`,
    ).viewBox,
    [0, 0, 10, 10],
  );
  const nested = importSvg(
    `<svg viewBox="0 0 100 100"><svg x="50" y="50" width="50" height="50" viewBox="0 0 10 10"><rect width="10" height="10"/></svg><rect width="5" height="5" display="none"/><g style="display:none"><rect width="9" height="9"/></g></svg>`,
  );
  assert.equal(nested.layers.length, 1);
  assert.deepEqual(nested.layers[0].paths.length, 1, "hidden shapes are skipped");
  assert.deepEqual(pathBounds(parsePath(nested.layers[0].paths[0].d)), {
    x: 50,
    y: 50,
    w: 50,
    h: 50,
  });
  // Lines and polylines; evenodd; stroke dashes scale like stroke widths.
  const lines = importSvg(
    `<svg viewBox="0 0 10 10" width="20" height="20"><line x1="0" y1="0" x2="10" y2="10" stroke="#000" stroke-dasharray="2 1"/><polygon points="0,0 10,0 10,10" fill-rule="evenodd"/></svg>`,
  );
  assert.equal(lines.layers[0].style.fill, null, "a line has no fill");
  assert.deepEqual(lines.layers[0].style.stroke.dash, [4, 2]);
  assert.equal(lines.layers[1].paths[0].fillRule, "evenodd");
});

test("what a vector cannot hold is refused with the reason (callers keep an SVG image)", () => {
  for (const [markup, reason] of [
    [
      `<svg viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><rect width="10" height="10" fill="url(#g)"/></svg>`,
      /gradient/,
    ],
    [`<svg viewBox="0 0 10 10"><text>Hi</text></svg>`, /text/],
    [`<svg viewBox="0 0 10 10"><rect width="5" height="5" filter="url(#f)"/></svg>`, /filters/],
    [
      `<svg viewBox="0 0 10 10"><g clip-path="url(#c)"><rect width="5" height="5"/></g></svg>`,
      /clip paths/,
    ],
    [`<svg viewBox="0 0 10 10"><rect width="5" height="5" mask="url(#m)"/></svg>`, /masks/],
    [`<svg viewBox="0 0 10 10"><image href="x.png" width="5" height="5"/></svg>`, /images/],
    [
      `<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="none"/></svg>`,
      /no visible shapes/,
    ],
    [`<svg viewBox="0 0 10 10"><path d="M0 0 Q"/></svg>`, /could not be read/],
    [`<div/>`, /no <svg>/],
  ]) {
    const r = importSvg(markup);
    assert.equal(r.ok, false, markup);
    assert.match(r.reason, reason);
  }
  // Caps: too many shapes, and a <use> cycle is skipped instead of recursing.
  assert.match(
    importSvg(`<svg viewBox="0 0 10 10">${'<rect width="1" height="1"/>'.repeat(2001)}</svg>`)
      .reason,
    /more than 2000 shapes/,
  );
  const cycle = importSvg(
    `<svg viewBox="0 0 10 10"><g id="a"><rect width="1" height="1"/><use href="#a"/></g></svg>`,
  );
  assert.equal(cycle.ok, true);
  assert.ok(cycle.warnings.some((w) => /use/.test(w)));
});

test("JSX: inline <svg> becomes vectors; serialize → parse round-trips every vector field", () => {
  const code = `<div data-node-label="Board" className="flex gap-4 p-4 bg-white text-slate-700">
  ${LUCIDE_ARROW.replace(/stroke-width/g, "strokeWidth").replace(/stroke-line(cap|join)/g, (_, k) => "strokeLine" + k)}
  <svg viewBox="0 0 100 50" className="w-[200px] h-[100px]">${LOGO.slice(LOGO.indexOf("<defs>"), LOGO.lastIndexOf("</svg>")).replace('class="brand"', 'fill="#ff0000"').replace('id="dot"', "").replace("xlink:href", "href")}</svg>
  <svg viewBox="0 0 10 10" className="size-10"><text>hi</text></svg>
  <svg data-node-label="Dashed" data-vector viewBox="0 0 10 10" className="size-6" fill="#abcdef" data-fill-token="ink" stroke="#00000080" strokeWidth={1.5} strokeLinecap="square" strokeLinejoin="bevel" strokeMiterlimit={8} strokeDasharray="3 1" data-stroke-hidden="true"><path d="M0 0H10V10Z" fillRule="evenodd" /></svg>
</div>`;
  const out = createArtboards(empty(), "p", code);
  assert.ok(
    out.warnings.some((w) => /SVG uses text; kept it as an SVG image/.test(w)),
    out.warnings.join("\n"),
  );
  validateDocument(out.document);
  const page = getPage(out.document, "p");
  const list = vectors(page);
  assert.equal(list.length, 5, "icon + 3 logo paints + the canonical element"); // JSX has no <style> braces: the dot is opaque here
  const icon = list[0];
  assert.deepEqual(
    [icon.w, icon.h, icon.strokeWidth, icon.strokeColor],
    [24, 24, 2, "#314158"],
    "currentColor is the text colour",
  );
  const logo = page.nodes.find(
    (n) => n.type === "frame" && n.parentId && vectors(page).some((v) => v.parentId === n.id),
  );
  assert.deepEqual([logo.w, logo.h, logo.layout], [200, 100, "free"]);
  assert.deepEqual(
    vectors(page)
      .filter((v) => v.parentId === logo.id)
      .map((v) => [v.x, v.y, v.w, v.h]),
    [
      [20, 10, 40, 40],
      [80, 10, 40, 40],
      [160, 60, 10, 10],
    ],
    "scaled to the classes' 200 × 100",
  );
  const dashed = list[4];
  assert.deepEqual(shape(dashed), {
    name: "Dashed",
    w: 24,
    h: 24,
    viewBox: [0, 0, 10, 10],
    paths: [{ d: "M0 0H10V10Z", fillRule: "evenodd" }],
    fills: undefined,
    color: "#112233",
    token: "ink",
    strokeWidth: 1.5,
    strokeColor: "#00000080",
    strokeToken: undefined,
    strokeCap: "square",
    strokeJoin: "bevel",
    strokeDash: [3, 1],
    strokeHidden: true,
  });
  assert.equal(page.nodes.filter((n) => n.type === "image").length, 1);
  // Round trip: read the board back as JSX and build it again.
  const root = page.nodes.find((n) => !n.parentId);
  const jsx = elementCode(out.document, page, root);
  assert.match(
    jsx,
    /<svg data-node-id="[^"]+" data-node-label="Dashed" data-vector viewBox="0 0 10 10" fill="#112233" data-fill-token="ink" stroke="#00000080" strokeWidth=\{1.5\}/,
  );
  assert.doesNotMatch(
    jsx,
    /<svg[^>]*className="[^"]*(bg-|border|rounded)/,
    "no box paint classes on vectors",
  );
  const again = createArtboards(empty(), "p", jsx);
  assert.deepEqual(vectors(getPage(again.document, "p")).map(shape), list.map(shape));
});

test("compact reads elide long path data and edits keep it", () => {
  const long = "M0 0" + "L1 1L2 0".repeat(800);
  const code = `<div data-node-label="Board" className="w-[200px] h-[200px] layout-free"><svg data-node-label="Scribble" data-vector viewBox="0 0 2 1" className="absolute left-[0px] top-[0px] w-[100px] h-[50px]" fill="none" stroke="#000000" strokeWidth={1}><path d="${long}" /></svg></div>`;
  const out = createArtboards(empty(), "p", code);
  const page = getPage(out.document, "p");
  const v = vectors(page)[0];
  assert.equal(v.paths[0].d, long);
  const compact = elementCode(out.document, page, v);
  assert.match(compact, /<path d="\[path data 6 KB\]" \/>/, "reads stay compact");
  // Writing the compact form back (an agent editing other attributes) keeps the stored paths.
  const back = runDirectives(
    out.document,
    "p",
    `{/* replace ${v.shortId} */}\n${compact.replace('stroke="#000000"', 'stroke="#0000ff"')}`,
  );
  assert.equal(back.failed, 0, back.report);
  const replaced = vectors(getPage(back.document, "p"))[0];
  assert.equal(replaced.paths[0].d, long);
  assert.equal(replaced.strokeColor, "#0000ff");
  const short = runDirectives(
    out.document,
    "p",
    `{/* edit ${v.shortId} */}\n<svg data-vector stroke="#ff0000" strokeLinecap="round" strokeDasharray="2 2" />`,
  );
  const edited = vectors(getPage(short.document, "p"))[0];
  assert.equal(edited.paths[0].d, long, "an edit without <path> children keeps the paths");
  assert.deepEqual(
    [edited.strokeColor, edited.strokeWidth, edited.strokeCap, edited.strokeDash],
    ["#ff0000", 1, "round", [2, 2]],
  );
  const repathed = runDirectives(
    short.document,
    "p",
    `{/* edit ${v.shortId} */}\n<svg data-vector fill="#00ff00"><path d="M0 0L2 1" /></svg>`,
  );
  const next = vectors(getPage(repathed.document, "p"))[0];
  assert.deepEqual(next.paths, [{ d: "M0 0L2 1" }]);
  assert.equal(next.fills, undefined);
  assert.equal(next.color, "#00ff00");
  const bad = runDirectives(
    repathed.document,
    "p",
    `{/* edit ${v.shortId} */}\n<svg data-vector><path d="L0" /></svg>`,
  );
  assert.equal(bad.failed, 1);
  assert.match(bad.report, /invalid path data/);
});

test("HTML import: inline SVG becomes vectors (gradients stay images), export draws inline SVG", async () => {
  const html = `<div style="display:flex;gap:8px;color:#1e293b;padding:8px">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
    <svg viewBox="0 0 10 10" style="width:40px;height:40px"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>
  </div>`;
  const { document, warnings } = await importHtml(html);
  assert.ok(warnings.some((w) => /gradient or pattern paints; kept it as an SVG image/.test(w)));
  const nodes = document.pages[0].nodes;
  const ring = nodes.find((n) => n.type === "vector");
  assert.deepEqual([ring.w, ring.h, ring.strokeColor], [32, 32, "#1e293b"]);
  assert.equal(Math.round(ring.strokeWidth * 1000) / 1000, 2.667, "2 units at 24 → 32 px");
  assert.ok(nodes.some((n) => n.type === "image" && n.src.startsWith("data:image/svg+xml")));
  const out = exportHTML(document, document.pages[0].id);
  assert.match(
    out,
    /<div[^>]*data-design-type="vector"[^>]*><svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 24 24" preserveAspectRatio="none"/,
  );
  assert.match(out, /stroke="#1e293b" stroke-width="2.667" vector-effect="non-scaling-stroke"/);
  // The vector's box paints nothing itself.
  const box = /<div[^>]*data-design-type="vector"[^>]*style="([^"]*)"/.exec(out)[1];
  assert.match(box, /background:transparent/);
  assert.match(box, /border:0px/);
});

test("schema: vector-only keys, limits and stroke details", () => {
  const doc = (n) => ({
    version: 2,
    name: "d",
    tokens: {},
    pages: [
      { id: "p", name: "P", nodes: [{ id: "v", name: "V", x: 0, y: 0, w: 24, h: 24, ...n }] },
    ],
  });
  const ok = { type: "vector", paths: [{ d: "M0 0L24 24" }], viewBox: [0, 0, 24, 24] };
  validateDocument(
    doc({
      ...ok,
      strokeCap: "round",
      strokeJoin: "bevel",
      strokeMiter: 10,
      strokeDash: [2, 2],
      fills: [],
    }),
  );
  for (const [extra, message] of /** @type {[Record<string, unknown>, RegExp][]} */ ([
    [{ paths: [] }, /1–500 paths/],
    [{ paths: Array(501).fill({ d: "M0 0" }) }, /1–500 paths/],
    [{ paths: [{ d: "Q" }] }, /Invalid vector path/],
    [{ paths: [{ d: "M0 0", stroke: "#000" }] }, /\{d, fillRule\?\}/],
    [{ paths: [{ d: "M0 0", fillRule: "odd" }] }, /fillRule/],
    [{ viewBox: [0, 0, 0, 1] }, /viewBox/],
    [{ viewBox: [0, 0, 1] }, /viewBox/],
    [{ strokeCap: "flat" }, /cap/],
    [{ strokeJoin: "sharp" }, /join/],
    [{ strokeMiter: 0 }, /miter/],
    [{ strokeDash: [-1] }, /strokeDash/],
    [{ paths: Array(3).fill({ d: "M0 0" + "L1 1".repeat(49000) }) }, /at most 500000 characters/],
  ]))
    assert.throws(
      () => validateDocument(doc({ ...ok, ...extra })),
      message,
      JSON.stringify(extra).slice(0, 80),
    );
  assert.throws(
    () => validateDocument(doc({ type: "rectangle", viewBox: [0, 0, 1, 1] })),
    /viewBox belongs to vector layers/,
  );
  assert.throws(
    () => validateDocument(doc({ type: "frame", strokeDash: [1] })),
    /strokeDash belongs to vector layers/,
  );
});
