// General source round trips: document -> JSX -> document and document -> HTML/CSS -> document are the
// identity (modulo ids) for a "kitchen sink" page that sets every layer property of the schema, and a
// coverage check enumerates the schema from the validators (the shared validateDocument in
// web/document-core.js, the effect/paint/shader validators in web/node-style.js and
// web/shaders.js) plus the codec node model, and fails when a property is neither exercised by the
// kitchen sink nor explicitly exempt.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateDocument } from "./design-store.mjs";
import { createArtboards, reflow, getPage } from "./design-edit.mjs";
import { NODE_DEFAULTS } from "./jsx-codec.mjs";
import { documentToJsx, jsxToDocument, documentToHtml, htmlToDocument } from "./codec-source.mjs";
import { tailwindCode, cssCode } from "./export-code.mjs";
import { exportHTML } from "./export-html.mjs";

const root = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");
const SVG =
  "data:image/svg+xml;base64," +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ff0000"/><circle cx="5" cy="5" r="3" fill="#00ff00"/></svg>',
  ).toString("base64");
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// ---------------------------------------------------------------------------------------------
// Schema enumeration

function body(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return "";
  let i = src.indexOf("{", at),
    depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}
/** Layer property names the validators and the codec node model know about. */
export function schemaKeys() {
  const app = read("web/app.js"),
    core = read("web/document-core.js"),
    style = read("web/node-style.js"),
    shaders = read("web/shaders.js"),
    edit = read("integrations/design-edit.mjs");
  const texts = [
    body(core, "function validateNode(node)"),
    body(core, "function normalizeDocument("),
    body(style, "function validateEffects"),
    body(style, "function paintError"),
    body(shaders, "function validate"),
  ];
  const keys = new Set();
  for (const t of texts) {
    for (const m of t.matchAll(/\b(?:n|node)\.([a-zA-Z_]\w*)/g)) keys.add(m[1]);
    for (const m of t.matchAll(/for\s*\(\s*const\s+(?:key|\[key,\s*\w+\])\s+of\s+\[([^\]]*)\]/g))
      for (const k of m[1].matchAll(/'([a-zA-Z]\w*)'/g)) keys.add(k[1]);
  }
  // Per-type key lists of the shared validator (NUMERIC_KEYS, STRING_KEYS, BOOLEAN_KEYS).
  for (const m of core.matchAll(/const [A-Z]+_KEYS = \[([^\]]*)\]/g))
    for (const k of m[1].matchAll(/'([a-zA-Z]\w*)'/g)) keys.add(k[1]);
  for (const k of Object.keys(NODE_DEFAULTS)) keys.add(k);
  const defaults = app.match(/const defaults=\{([^}]*)\}/);
  if (defaults) for (const m of defaults[1].matchAll(/([a-zA-Z]\w*):/g)) keys.add(m[1]);
  // The codec node model comment in design-edit.mjs ("Node model written by the codec").
  const model = edit.slice(
    edit.indexOf("Node model written by the codec"),
    edit.indexOf("const BOX_KEYS"),
  );
  for (const line of model.split("\n").slice(1)) {
    const column = line
      .replace(/^\/\/\s*/, "")
      .split(/\s{2,}/)[0]
      .replace(/'[^']*'/g, " ")
      .replace(/\([^)]*\)?/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .split(/[;:]/)[0];
    for (const word of column.split(/[\s,/+]+/))
      if (/^[a-z][a-zA-Z]{2,}$/.test(word)) keys.add(word);
  }
  return keys;
}
// Not layer properties, or bookkeeping recomputed on every read (ids, layout estimate flag).
const EXEMPT = new Set(["id", "parentId", "type", "shortId", "measured"]);

// ---------------------------------------------------------------------------------------------
// Kitchen sink: built through the codec (so it is in canonical form), then given every property the
// inspector can set directly, then laid out again.

const SINK_JSX = `
<section data-node-label="Board" data-component-x="40" data-component-y="60" className="flex flex-col gap-6 p-8 w-[960px] bg-white text-zinc-900 font-sans">
  <header data-node-label="Head" className="flex flex-row-reverse flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-2 pr-3 pb-4 pl-5 rounded-t-xl border-b-2 border-zinc-200">
    <h1 data-node-label="Title" className="text-4xl/tight font-semibold tracking-tight uppercase underline italic text-balance">Hello <b>bold</b> <span className="text-[#ff0000] text-[20px]">red</span></h1>
    <Icon data-node-label="Glyph" name="lucide:arrow-right" strokeWidth={1.5} className="size-6 text-indigo-500" />
    <button data-node-label="CTA" className="px-4 py-2 rounded-full bg-indigo-600 text-white text-sm font-medium">Go</button>
  </header>
  <div data-node-label="Grid" className="grid grid-cols-3 grid-rows-2 gap-4 justify-items-center items-center">
    <div data-node-label="Cell A" className="col-span-2 row-span-2 h-[80px] bg-zinc-100 rounded-lg shadow-md" />
    <div data-node-label="Cell B" className="h-[40px] aspect-video bg-[#123456] opacity-50 rotate-[12deg] -scale-x-100 z-10" />
    <p data-node-label="Clamp" className="line-clamp-2 text-sm leading-[1.4] text-right">Long text that is clamped to two lines in the cell</p>
  </div>
  <div data-node-label="Free" className="layout-free relative w-[600px] h-[240px] bg-zinc-50 overflow-hidden">
    <div data-node-label="Pinned" className="absolute left-[24px] top-[16px] w-[120px] h-[60px] bg-amber-200 border-dashed border-4 border-amber-600 ring-2 ring-sky-400 ring-inset" />
    <div data-node-label="Anchored" className="absolute right-[20px] bottom-[10px] w-[80px] h-[40px] bg-rose-300 rounded-[50%]" />
    <div data-node-label="Centered" className="absolute left-1/2 top-[100px] -translate-x-1/2 w-[50%] h-[40%] bg-emerald-300" />
    <img data-node-label="Remote" src="https://example.com/remote.png" className="absolute left-[10px] top-[180px] w-[40px] h-[40px]" />
    <img data-node-label="Photo" src="${PNG}" className="absolute left-[300px] top-[20px] w-[90px] h-[60px] object-cover" />
    <img data-node-label="Vector" src="${SVG}" className="absolute left-[400px] top-[20px] w-[40px] h-[40px]" />
    <Shader data-node-label="Glow" preset="waves" speed={2} intensity={1.5} className="absolute left-[450px] top-[100px] w-[120px] h-[90px]" />
    <p data-node-label="Type" className="absolute left-[24px] top-[100px] w-[200px] h-[80px] content-center whitespace-pre-line break-all -indent-[6px] antialiased leading-[normal] text-nowrap">Centred\nlines</p>
  </div>
  <div data-node-label="Row" className="flex items-baseline gap-3 min-h-[40px] max-w-[800px]">
    <p data-node-label="Grow" className="flex-1 truncate font-['Inter'] font-[450]">Grows and truncates</p>
    <div data-node-label="Badge" className="absolute top-0 right-[-4px] w-[10px] h-[10px] rounded-full bg-red-500" />
    <span data-node-label="Pill" className="shrink-0 basis-[120px] self-center mx-auto px-2 py-0.5 rounded-md bg-gradient-to-r from-indigo-500 to-pink-500 text-white text-xs whitespace-nowrap">Pill</span>
    <div data-node-label="Fixed pct" className="w-[25%] h-[20px] min-w-[40px] max-h-[30px] bg-zinc-300 animate-[aurora] [mask-image:linear-gradient(black,transparent)]" />
    <div data-node-label="Calc" className="w-[calc(50%_-_12px)] h-[calc(10px_*_2)] bg-zinc-400" />
    <p data-node-label="Auto" className="w-auto h-auto text-xs">Auto sized</p>
  </div>
  <div data-node-label="Flow" className="space-y-2 inline-flow">
    <p data-node-label="Inline A" className="text-xs tracking-[0.5px] normal-case">Inline flow</p>
    <p data-node-label="Inline B" className="h-[48px] content-end whitespace-normal break-normal indent-4 subpixel-antialiased">Type settings</p>
  </div>
  <hr data-node-label="Rule" className="h-px bg-zinc-200 w-full" />
</section>
<div data-node-label="Second" data-component-x="1100" data-component-y="60" className="w-[320px] h-[200px] bg-[#0f172a] p-4">
  <p data-node-label="Ink" className="text-[var(--ink)] text-lg">Token ink</p>
</div>`;

function buildSink() {
  let doc = {
    version: 2,
    name: "Sink",
    activePage: "p",
    tokens: { brand: "#4f46e5", ink: "#f8fafc", glow: "#22d3ee" },
    variables: {
      "space/md": { type: "dimension", value: 16 },
      "space/alias": { type: "dimension", value: 16 },
      "font/body": { type: "fontFamily", value: "Inter" },
      "weight/strong": { type: "fontWeight", value: "700" },
      "ratio/half": { type: "number", value: 50 },
    },
    aliases: { "space/alias": "space/md" },
    pages: [{ id: "p", name: "Page", width: 1600, height: 1000, background: "#f5f3ee", nodes: [] }],
  };
  doc = createArtboards(doc, "p", SINK_JSX).document;
  const page = getPage(doc, "p");
  const by = (name) => {
    const n = page.nodes.find((x) => x.name === name);
    assert.ok(n, name);
    return n;
  };
  Object.assign(by("Board"), {
    preview: { root: "/", name: "Site", url: "http://localhost:5173/", template: "Desktop" },
    locked: true,
    labelHidden: true,
    bindings: { padding: "space/md", gap: "space/md" },
    padding: 16,
    gap: 16,
  });
  Object.assign(by("Head"), {
    shadows: [
      { type: "box", x: 0, y: 4, blur: 12, spread: -2, color: "#4f46e5", token: "brand" },
      { type: "box", inset: true, x: 1, y: 1, blur: 0, spread: 0, color: "#00000040" },
      { type: "drop", x: 0, y: 2, blur: 6, spread: 0, color: "#00000080", hidden: true },
    ],
    blendMode: "multiply",
    outlineWidth: 2,
    outlineOffset: 3,
    outlineColor: "#22d3ee",
    outlineStyle: "dashed",
    outlineToken: "glow",
  });
  Object.assign(by("Title"), {
    textRuns: [
      { start: 0, end: 5, bold: true, italic: false },
      { start: 2, end: 8, bold: false, italic: true, color: "#00ff00" },
      { start: 6, end: 11, bold: false, italic: false, fontSize: 30 },
    ],
    shadows: [{ type: "text", x: 1, y: 1, blur: 2, spread: 0, color: "#22d3ee", token: "glow" }],
    // Text Background Fill (properties-audit A10, WP-6).
    backgroundFills: [
      { type: "solid", color: "#4f46e5", token: "brand", opacity: 80 },
      {
        type: "linear",
        angle: 45,
        stops: [
          { position: 0, color: "#000000" },
          { position: 100, color: "#ffffff" },
        ],
      },
    ],
  });
  Object.assign(by("Cell A"), {
    filters: [
      { type: "blur", value: 2 },
      { type: "brightness", value: 1.2, backdrop: true },
      { type: "sepia", value: 1, hidden: true },
      { type: "contrast", value: 1.5 },
    ],
    masks: [
      { type: "linear", rotation: 45, alpha: 80 },
      { type: "radial", rotation: 0, alpha: 100, invert: true, hidden: true },
    ],
    fills: [
      { type: "solid", color: "#ff000080", token: "brand", opacity: 90 },
      {
        type: "linear",
        angle: 90,
        stops: [
          { position: 0, color: "#000000" },
          { position: 100, color: "#ffffff", token: "ink" },
        ],
      },
      { type: "image", src: PNG, fit: "cover", imageWidth: 1, imageHeight: 1, hidden: true },
    ],
  });
  Object.assign(by("Cell B"), {
    flipY: true,
    hidden: true,
    cornerRadii: [4, 8, 12, 0],
    radius: 12,
    bindings: { radiusTopLeft: "space/alias" },
  });
  by("Cell B").cornerRadii[0] = 16;
  Object.assign(by("Vector"), {
    svgColor: "#336699",
    svgColorToken: "brand",
    svgPaints: { "#ff0000": "#0000ff" },
  });
  by("Vector").svgColor = "#4f46e5";
  Object.assign(by("Glow"), {
    shaderColors: { center: { color: "#ff0000" }, edge: { color: "#00ff00", token: "glow" } },
    shaderParams: { size: 40, grain: 10 },
  });
  Object.assign(by("Free"), {
    columns: 4,
    direction: "column",
    gap: 12,
    clipContent: true,
    columnSizes: [2, 1, 1, 1],
  });
  // Grid settings: fr-weighted Fill tracks and Automatic positioning off (G5 / H7).
  Object.assign(by("Grid"), { columnSizes: [1, 2, 1], rowSizes: [1, 3], autoPosition: false });
  Object.assign(by("Grow"), {
    fontFamily: "Inter",
    bindings: { fontFamily: "font/body", fontWeight: "weight/strong" },
    fontWeight: "700",
    styleOwn: [...new Set([...(by("Grow").styleOwn || []), "fontWeight", "fontFamily"])],
  });
  Object.assign(by("Fixed pct"), {
    opacity: 50,
    bindings: { opacity: "ratio/half" },
    strokeWidths: [0, 2, 0, 2],
    strokeWidth: 2,
    strokeColor: "#ff00ff",
  });
  // Border colour variables (uniform and per side).
  Object.assign(by("Fixed pct"), {
    strokeColor: "#4f46e5",
    strokeToken: "brand",
    strokeColors: [
      { color: "#ff00ff" },
      { color: "#4f46e5", token: "brand" },
      { color: "#ff00ff" },
      { color: "#22d3ee", token: "glow" },
    ],
    // The right side is hidden with its own eye (inspector side entry): it draws nothing, data-vn keeps it.
    strokeHiddenSides: [false, true, false, false],
  });
  Object.assign(by("Inline A"), { name: "  Inline A ", textDecoration: "line-through" });
  // A border and an outline hidden with the inspector's eye: nothing drawn, both kept.
  Object.assign(by("CTA"), {
    strokeWidth: 3,
    strokeColor: "#ff0000",
    strokeStyle: "dashed",
    strokeHidden: true,
    outlineWidth: 2,
    outlineColor: "#00ff00",
    outlineHidden: true,
  });
  Object.assign(by("Second"), { variantClasses: "md:p-8 hover:opacity-90 dark:bg-black" });
  // Shader mode (Wonder H6): a frame paints its fill with a shader preset; the paint stack stays as the fallback.
  Object.assign(by("Second"), {
    shaderFill: true,
    shaderPreset: "ripple-pool-2",
    shaderSpeed: 2,
    shaderColors: { center: { color: "#ff0000" }, ripple: { color: "#22d3ee", token: "glow" } },
    shaderParams: { density: 60 },
  });
  reflow(page, null, [], doc);
  return validateDocument(doc);
}

// ---------------------------------------------------------------------------------------------
// Comparison (modulo ids)

const IGNORE = new Set(["id", "parentId", "shortId", "measured"]);
function ordered(page) {
  const kids = new Map();
  for (const n of page.nodes) {
    const k = n.parentId || null;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(n);
  }
  const out = [];
  const walk = (pid, path) =>
    (kids.get(pid) || []).forEach((n, i) => {
      out.push({ path: `${path}/${i}`, node: n });
      walk(n.id, `${path}/${i}`);
    });
  walk(null, "");
  return out;
}
const DEFAULTS = {
  ...NODE_DEFAULTS,
  hidden: false,
  locked: false,
  flipX: false,
  flipY: false,
  ellipse: false,
};
const canon = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
function normalize(node) {
  const out = {};
  for (const [key, value] of Object.entries({ ...DEFAULTS, ...node })) {
    if (IGNORE.has(key)) continue;
    if (Array.isArray(value) && !value.length && key !== "textRuns") continue;
    out[key] = typeof value === "number" ? Math.round(value * 100) / 100 : canon(value);
  }
  if (Array.isArray(out.styleOwn)) out.styleOwn = [...out.styleOwn].sort();
  return out;
}
export function diffPages(a, b) {
  const left = ordered(a),
    right = ordered(b),
    diffs = [];
  if (left.length !== right.length) diffs.push(`layer count ${left.length} -> ${right.length}`);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i].path !== right[i].path) {
      diffs.push(`structure differs at ${left[i].path} vs ${right[i].path}`);
      break;
    }
    const x = normalize(left[i].node),
      y = normalize(right[i].node);
    for (const key of new Set([...Object.keys(x), ...Object.keys(y)]))
      if (JSON.stringify(x[key]) !== JSON.stringify(y[key]))
        diffs.push(
          `${left[i].node.name} (${left[i].path}).${key}: ${JSON.stringify(x[key])?.slice(0, 160)} -> ${JSON.stringify(y[key])?.slice(0, 160)}`,
        );
  }
  return diffs;
}
const docDiff = (a, b) => {
  const out = [];
  for (const key of ["tokens", "variables", "aliases"])
    if (JSON.stringify(a[key] || {}) !== JSON.stringify(b[key] || {}))
      out.push(`${key}: ${JSON.stringify(a[key])} -> ${JSON.stringify(b[key])}`);
  const pa = getPage(a, a.activePage),
    pb = getPage(b, b.activePage);
  for (const key of ["name", "width", "height", "background"])
    if (pa[key] !== pb[key]) out.push(`page.${key}: ${pa[key]} -> ${pb[key]}`);
  return out.concat(diffPages(pa, pb));
};

// ---------------------------------------------------------------------------------------------

test("every schema property is exercised by the round-trip kitchen sink", () => {
  const sink = buildSink();
  const used = new Set();
  for (const n of getPage(sink, "p").nodes)
    for (const [key, value] of Object.entries(n))
      if (JSON.stringify(value) !== JSON.stringify(DEFAULTS[key])) used.add(key);
  const missing = [...schemaKeys()].filter((key) => !EXEMPT.has(key) && !used.has(key)).sort();
  assert.deepEqual(
    missing,
    [],
    `schema properties without round-trip coverage: ${missing.join(", ")} — add them to the kitchen sink in integrations/codec-roundtrip.test.mjs`,
  );
});

test("document -> JSX -> document is the identity modulo ids", () => {
  const sink = buildSink();
  const code = documentToJsx(sink, "p");
  const { document: back } = jsxToDocument(code);
  assert.deepEqual(docDiff(sink, back), []);
  // And the JSX is a fixed point.
  assert.equal(
    documentToJsx(back, back.activePage).replace(/ data-node-id="[^"]*"/g, ""),
    code.replace(/ data-node-id="[^"]*"/g, ""),
  );
});

test("document -> HTML/CSS -> document is the identity modulo ids", async () => {
  const sink = buildSink();
  const html = documentToHtml(sink, "p");
  assert.match(html, /<style>/);
  assert.doesNotMatch(
    html.slice(html.indexOf("<body")),
    / style="/,
    "every declaration moved into a class rule",
  );
  const { document: back } = await htmlToDocument(html);
  assert.deepEqual(docDiff(sink, back), []);
});

test("Tailwind and CSS code exports read back losslessly", async () => {
  const sink = buildSink();
  const page = getPage(sink, "p");
  const roots = page.nodes.filter((n) => !n.parentId).map((n) => n.id);
  const jsx = tailwindCode(sink, "p", roots, "Sink");
  const { document: fromJsx } = jsxToDocument(jsx);
  // The component export keeps artboard canvas positions (data-canvas-x/y) and everything else.
  assert.match(jsx, / data-canvas-x="40" data-canvas-y="60"/);
  assert.deepEqual(diffPages(page, getPage(fromJsx, fromJsx.activePage)), []);
  assert.deepEqual(fromJsx.variables, sink.variables);
  assert.deepEqual(fromJsx.aliases, sink.aliases);
  const css = cssCode(exportHTML(sink, "p"), sink.tokens, { document: sink, pageId: "p" });
  const { document: fromCss } = await htmlToDocument(css);
  assert.deepEqual(docDiff(sink, fromCss), []);
});
