// One document schema (web/document-core.js) for the canvas (web/app.js validate → prepareDocument) and the headless
// store (design-store.mjs validateDocument): what the canvas prepares, the store accepts, and the rules the two
// hand-synced validators used to disagree on are settled in one place.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NODE_LIMITS,
  nodeLimitMessage,
  validateDocument as coreValidate,
  normalizeDocument,
  prepareDocument,
  resolveAliases,
  documentProblems,
} from "./document-core.mjs";
import { validateDocument } from "./design-store.mjs";

const read = (rel) => readFileSync(new URL("../" + rel, import.meta.url), "utf8");
// The canvas layer defaults (`const defaults={…}` in web/app.js), a plain object literal.
// oxlint-disable-next-line typescript/no-implied-eval -- evaluates the object literal copied from web/app.js
const DEFAULTS = Function(
  `return (${read("web/app.js").match(/const defaults\s*=\s*(\{[^}]*\})/)[1]})`,
)();
const page = (nodes) => ({ id: "p1", name: "Page 1", nodes });
const doc = (nodes, extra = {}) => ({
  version: 2,
  name: "Doc",
  activePage: "p1",
  tokens: {},
  pages: [page(nodes)],
  ...extra,
});
const rect = (extra = {}) => ({
  id: "r1",
  type: "rectangle",
  name: "Box",
  x: 0,
  y: 0,
  w: 100,
  h: 80,
  ...extra,
});

test("web/app.js has no validator of its own: validate() is prepareDocument with the canvas defaults", () => {
  const app = read("web/app.js");
  assert.match(
    app,
    /function validate\(d\)\s*\{\s*return window\.VerynizeDocument\.prepareDocument\(d,\s*defaults\);?\s*\}/,
  );
  assert.doesNotMatch(app, /function roomAssetUrl/);
  const html = read("web/index.html");
  const order = [
    "/platform.js",
    "/shaders.js",
    "/node-style.js",
    "/document-core.js",
    "/document-safety.js",
    "/app.js",
  ].map((src) => html.indexOf(`src="${src}"`));
  assert.ok(
    order.every((i) => i >= 0),
    "index.html loads the shared scripts",
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    "shared scripts load before app.js",
  );
});

test("a document the canvas prepares passes the store validator", () => {
  const sparse = {
    version: 2,
    pages: [
      {
        id: "p1",
        nodes: [
          rect({ name: "" }),
          { id: "t1", type: "text", x: 1, y: 2, w: 30, h: 20, fontWeight: 700, animated: "neon" },
        ],
      },
    ],
  };
  const prepared = prepareDocument(sparse, DEFAULTS);
  assert.equal(prepared, sparse, "prepared in place, like the old validate()");
  assert.equal(prepared.name, "Untitled");
  assert.equal(prepared.pages[0].name, "Page");
  assert.equal(prepared.activePage, "p1");
  assert.deepEqual(prepared.tokens, {});
  const [box, text] = prepared.pages[0].nodes;
  assert.equal(box.name, "Rectangle", "a blank layer name falls back to the type");
  assert.equal(box.shaderPreset, "aurora", "canvas defaults filled");
  assert.equal(text.fontWeight, "700", "numeric font weight stored as a string");
  assert.equal(text.animated, "", "unknown animated palette (rendered as none) cleared");
  assert.doesNotThrow(() => validateDocument(structuredClone(prepared)));
});

test("the store validator does not repair: missing names and a dangling active page are errors", () => {
  assert.throws(() => validateDocument({ ...doc([rect()]), name: "" }), /Document name/);
  assert.throws(() => validateDocument(doc([rect({ name: " " })])), /Node name/);
  assert.throws(() => validateDocument(doc([rect()], { activePage: "gone" })), /active page/);
  assert.throws(() => validateDocument({ ...doc([rect()]), tokens: undefined }), /tokens/);
  // The canvas repairs the same documents.
  for (const bad of [
    { ...doc([rect()]), name: "" },
    doc([rect({ name: " " })]),
    doc([rect()], { activePage: "gone" }),
  ])
    assert.doesNotThrow(() => prepareDocument(bad, DEFAULTS));
});

test("rules the two validators used to disagree on now hold for both", () => {
  const both = (d, re, label) => {
    assert.throws(() => validateDocument(structuredClone(d)), re, "store: " + label);
    assert.throws(() => prepareDocument(structuredClone(d), DEFAULTS), re, "canvas: " + label);
  };
  // Previously store-only.
  both(doc([rect({ x: 2e6 })]), /Invalid node x/, "coordinates within ±1e6");
  both(doc([rect({ id: "" })]), /Node id/, "nonempty ids");
  both(
    doc([rect({ gradient: "x".repeat(4001) })]),
    /Invalid node gradient/,
    "free-form strings ≤ 4000",
  );
  both(doc([rect({ name: "x".repeat(201) })]), /Node name/, "names ≤ 200");
  both(
    sizedDocument(NODE_LIMITS.perDocument + 1),
    /Split the design into multiple documents/,
    "document node limit",
  );
  both(
    doc([rect()], {
      views: [{ id: "v".repeat(201), name: "V", page: "p1", zoom: 1, scrollLeft: 0, scrollTop: 0 }],
    }),
    /View id/,
    "view ids ≤ 200",
  );
  // Previously canvas-only.
  both(doc([rect({ strokeWidth: -1 })]), /strokeWidth/, "non-negative border width");
  both(doc([rect({ shadow: "0 0 url(https://x.example/a)" })]), /shadow/, "no url() in shadows");
  both(
    doc([
      rect({ textRuns: [], text: "ab" }),
      rect({
        id: "r2",
        text: "ab",
        textRuns: [{ start: 0, end: 1, bold: true, italic: false, color: ["#ffffff"] }],
      }),
    ]),
    /text ranges/,
    "text run colours are strings",
  );
  both(
    doc([rect({ shaderPreset: "custom" })]),
    /shader preset/,
    "shader preset on any layer that sets it",
  );
  both(doc([rect({ shaderSpeed: 9 })]), /shaderSpeed/, "shader speed on any layer that sets it");
});

test("aliases are validated by the shared core and resolved only when the canvas loads", () => {
  const d = doc([rect()], {
    tokens: { brand: "#112233", accent: "#000000" },
    aliases: { accent: "brand" },
  });
  assert.equal(
    coreValidate(structuredClone(d)).tokens.accent,
    "#000000",
    "validation never mutates",
  );
  assert.equal(prepareDocument(structuredClone(d), DEFAULTS).tokens.accent, "#112233");
  assert.equal(resolveAliases(structuredClone(d)).tokens.accent, "#112233");
  assert.throws(
    () =>
      prepareDocument(
        doc([rect()], { tokens: { a: "#000000", b: "#ffffff" }, aliases: { a: "b", b: "a" } }),
        DEFAULTS,
      ),
    /cycle/,
  );
});

test("normalizeDocument tolerates malformed input and leaves rejection to validation", () => {
  for (const bad of [
    null,
    1,
    "x",
    {},
    { version: 2, pages: "x" },
    { version: 2, pages: [null, 1, { id: "p", nodes: [null] }] },
  ]) {
    assert.doesNotThrow(() => normalizeDocument(bad, DEFAULTS));
    assert.throws(() => prepareDocument(bad, DEFAULTS));
  }
});

// Load-time repairs (normalizeDocument/prepareDocument with a `repairs` array): documents saved before the shared
// schema load with each change reported as {path, before, after}; editing (no array) keeps rejecting.
const repaired = (d) => {
  const repairs = [];
  const prepared = prepareDocument(structuredClone(d), DEFAULTS, repairs);
  assert.doesNotThrow(() => validateDocument(structuredClone(prepared)), "the store accepts it");
  return { prepared, repairs };
};

test("load repairs clamp coordinates and sizes to ±1e6 and report each change", () => {
  const { prepared, repairs } = repaired(doc([rect({ x: 2e6, y: -3.5e6, w: 4e6, h: 80 })]));
  const box = prepared.pages[0].nodes[0];
  assert.deepEqual([box.x, box.y, box.w, box.h], [1e6, -1e6, 1e6, 80]);
  assert.deepEqual(repairs, [
    { path: "pages[0].nodes[0].x", before: 2e6, after: 1e6 },
    { path: "pages[0].nodes[0].y", before: -3.5e6, after: -1e6 },
    { path: "pages[0].nodes[0].w", before: 4e6, after: 1e6 },
  ]);
  assert.throws(
    () => prepareDocument(doc([rect({ x: Infinity })]), DEFAULTS, []),
    /Invalid node x/,
  );
});

test("load repairs cut document, page and layer names to 200 characters", () => {
  const long = "n".repeat(250),
    emoji = "a".repeat(199) + "😀" + "b";
  const { prepared, repairs } = repaired({
    ...doc([rect({ name: long }), rect({ id: "r2", name: emoji })]),
    name: long,
    pages: [{ ...page([rect({ name: long }), rect({ id: "r2", name: emoji })]), name: long }],
  });
  assert.equal(prepared.name, "n".repeat(200));
  assert.equal(prepared.pages[0].name, "n".repeat(200));
  assert.equal(prepared.pages[0].nodes[0].name, "n".repeat(200));
  assert.equal(prepared.pages[0].nodes[1].name, "a".repeat(199), "a surrogate pair is never split");
  assert.deepEqual(
    repairs.map((r) => r.path),
    ["document.name", "pages[0].name", "pages[0].nodes[0].name", "pages[0].nodes[1].name"],
  );
  assert.match(
    repairs[0].before,
    /… \(250 characters\)$/,
    "long values are shortened in the report",
  );
  assert.match(repairs[0].after, /… \(200 characters\)$/);
});

test("load repairs reset over-long or mistyped style strings to the editor default", () => {
  const { prepared, repairs } = repaired(
    doc([rect({ gradient: "g".repeat(4001), shadow: "s".repeat(5000), alignItems: 7 })]),
  );
  const box = prepared.pages[0].nodes[0];
  assert.equal(box.gradient, "");
  assert.equal(box.shadow, "");
  assert.equal(box.alignItems, "stretch");
  assert.deepEqual(
    repairs.map((r) => [r.path, r.after]),
    [
      ["pages[0].nodes[0].gradient", ""],
      ["pages[0].nodes[0].shadow", ""],
      ["pages[0].nodes[0].alignItems", "stretch"],
    ],
  );
  assert.equal(repairs[2].before, 7);
});

test("load repairs report the coercions the canvas always made (font weight, palette, names, active page)", () => {
  const { prepared, repairs } = repaired(
    doc(
      [
        rect({ name: " ", fontWeight: "heavy", animated: "neon" }),
        rect({ id: "r2", fontWeight: 700 }),
      ],
      { activePage: "gone" },
    ),
  );
  assert.equal(prepared.activePage, "p1");
  assert.equal(
    prepared.pages[0].nodes[1].fontWeight,
    "700",
    "a numeric weight is stored, not reported",
  );
  assert.deepEqual(repairs, [
    { path: "pages[0].nodes[0].name", before: " ", after: "Rectangle" },
    { path: "pages[0].nodes[0].fontWeight", before: "heavy", after: "400" },
    { path: "pages[0].nodes[0].animated", before: "neon", after: "" },
    { path: "activePage", before: "gone", after: "p1" },
  ]);
  assert.deepEqual(repaired(doc([rect()])).repairs, [], "a valid document reports nothing");
});

test("load repairs never rewrite ids or token names and never drop layers", () => {
  const refuse = (d, re) =>
    assert.throws(() => prepareDocument(structuredClone(d), DEFAULTS, []), re);
  refuse(doc([rect({ id: "" })]), /Node id/);
  refuse(doc([rect({ id: "i".repeat(201) })]), /Node id/);
  refuse({ ...doc([rect()]), pages: [{ ...page([rect()]), id: "p".repeat(201) }] }, /Page id/);
  refuse(doc([rect()], { tokens: { ["t".repeat(201)]: "#ffffff" } }), /Token name/);
  refuse(sizedDocument(NODE_LIMITS.perDocument + 1), /Split the design into multiple documents/);
});

test("documentProblems lists every problem with its path, not only the first", () => {
  const problems = documentProblems({
    ...doc([
      rect({ id: "" }),
      rect({ id: "r2", type: "blob" }),
      rect({ id: "r3", parentId: "nowhere" }),
      rect({ id: "r4" }),
    ]),
    name: "",
  });
  assert.deepEqual(
    problems.map((p) => p.path),
    ["document", "pages[0].nodes[0]", "pages[0].nodes[1]", "pages[0].nodes[2].parentId"],
  );
  assert.match(problems[0].message, /Document name/);
  assert.match(problems[1].message, /Node id/);
  assert.deepEqual(documentProblems(doc([rect()])), []);
  assert.equal(documentProblems(null).length, 1);
});

// Spread full pages without cross-page parents; ids remain document-unique.
function sizedDocument(count) {
  const pages = [];
  for (let offset = 0; offset < count; offset += NODE_LIMITS.perPage)
    pages.push({
      id: `p${pages.length + 1}`,
      name: `Page ${pages.length + 1}`,
      nodes: Array.from({ length: Math.min(NODE_LIMITS.perPage, count - offset) }, (_, i) =>
        rect({ id: `node${offset + i}` }),
      ),
    });
  return { ...doc([]), pages };
}

test("node limits accept boundaries and reject excess without dropping content", () => {
  for (const count of [NODE_LIMITS.perDocument - 1, NODE_LIMITS.perDocument]) {
    const d = sizedDocument(count);
    assert.doesNotThrow(() => coreValidate(d));
    assert.deepEqual(documentProblems(d), []);
  }
  for (const count of [NODE_LIMITS.perPage - 1, NODE_LIMITS.perPage])
    assert.doesNotThrow(() =>
      coreValidate(doc(Array.from({ length: count }, (_, i) => rect({ id: `n${i}` })))),
    );
  const cases = [
    [
      sizedDocument(NODE_LIMITS.perDocument + 1),
      nodeLimitMessage(NODE_LIMITS.perDocument + 1, NODE_LIMITS.perDocument),
    ],
    [
      doc(Array.from({ length: NODE_LIMITS.perPage + 1 }, (_, i) => rect({ id: `n${i}` }))),
      nodeLimitMessage(NODE_LIMITS.perPage + 1, NODE_LIMITS.perPage, "Page 1"),
    ],
  ];
  for (const [d, message] of cases) {
    const original = structuredClone(d);
    assert.throws(() => coreValidate(d), { message });
    assert.throws(() => validateDocument(d), { message });
    assert.throws(() => prepareDocument(d, DEFAULTS, []), { message });
    assert.deepEqual(
      d.pages.map((p) => p.nodes.map((n) => n.id)),
      original.pages.map((p) => p.nodes.map((n) => n.id)),
    );
    assert.ok(documentProblems(d).some((p) => p.message === message));
  }
});
