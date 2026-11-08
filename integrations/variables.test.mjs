// Typed variables (dimension / number / font family / font weight), node bindings, translucent colors
// and the font catalog used by the inspector.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateDocument, applyOperations } from "./design-store.mjs";
import {
  syncTokenColors,
  syncVariables,
  unbindVariable,
  renameVariableRefs,
  variablesCss,
  describeVariables,
  tokenColor,
} from "./design-edit.mjs";
import { exportHTML } from "./export-html.mjs";
import { fontCatalog } from "./fonts.mjs";

const doc = (extra = {}, node = {}) => ({
  version: 2,
  name: "Vars",
  tokens: { brand: "#2563eb", glass: "#ffffff80" },
  activePage: "p",
  pages: [
    {
      id: "p",
      name: "Page",
      nodes: [
        {
          id: "a",
          type: "text",
          name: "Title",
          x: 0,
          y: 0,
          w: 200,
          h: 40,
          text: "Hi",
          color: "#11223380",
          fontFamily: "Inter",
          fontWeight: "400",
          radius: 0,
          ...node,
        },
      ],
    },
  ],
  ...structuredClone(extra),
});
const variables = {
  "space/md": { type: "dimension", value: 12 },
  ratio: { type: "number", value: 1.4 },
  "font/body": { type: "fontFamily", value: "Playfair Display" },
  "weight/bold": { type: "fontWeight", value: "700" },
};

test("documents accept typed variables, bindings and translucent colors", () => {
  const d = doc(
    { variables },
    {
      bindings: {
        radius: "space/md",
        lineHeight: "ratio",
        fontFamily: "font/body",
        fontWeight: "weight/bold",
      },
    },
  );
  assert.equal(validateDocument(d), d);
  // Older documents without variables stay valid.
  assert.doesNotThrow(() => validateDocument(doc()));
});

test("invalid variables and bindings are rejected", () => {
  const bad = [
    { variables: [] },
    { variables: { "bad;name": { type: "number", value: 1 } } },
    { variables: { x: { type: "color", value: "#fff" } } },
    { variables: { x: { type: "dimension", value: "12px" } } },
    { variables: { x: { type: "number", value: Infinity } } },
    { variables: { x: { type: "fontFamily", value: "Inter; color:red" } } },
    { variables: { x: { type: "fontFamily", value: "url(x)" } } },
    { variables: { x: { type: "fontWeight", value: "heavy" } } },
    { variables: { brand: { type: "number", value: 1 } } }, // collides with a color token
  ];
  for (const extra of bad)
    assert.throws(() => validateDocument(doc(extra)), undefined, JSON.stringify(extra));
  assert.throws(
    () => validateDocument(doc({ variables }, { bindings: { color: "ratio" } })),
    /binding/,
  );
  assert.throws(() => validateDocument(doc({ variables }, { bindings: [] })), /bindings/);
  assert.throws(() => validateDocument(doc({ variables }, { bindings: { radius: 5 } })), /binding/);
  assert.throws(() => validateDocument(doc({ tokens: { brand: "#2563eb8" } })), /hex/);
  assert.throws(() => validateDocument(doc({ tokens: { brand: "rgba(0,0,0,.5)" } })), /hex/);
});

test("bound properties follow variable values; unknown or incompatible bindings are ignored", () => {
  const d = doc(
    { variables: { ...variables, "space/md": { type: "dimension", value: 20 } } },
    {
      radius: 3,
      opacity: 100,
      bindings: {
        radius: "space/md",
        fontWeight: "weight/bold",
        fontFamily: "font/body",
        opacity: "missing",
        fontSize: "font/body",
      },
    },
  );
  syncTokenColors(d); // the MCP write path calls this after every edit
  const n = d.pages[0].nodes[0];
  assert.equal(n.radius, 20);
  assert.equal(n.fontWeight, "700");
  assert.equal(n.fontFamily, "Playfair Display");
  assert.equal(n.opacity, 100);
  assert.equal(n.fontSize, undefined);
  d.variables.ratio.value = 250;
  n.bindings.opacity = "ratio";
  syncVariables(d);
  assert.equal(n.opacity, 100, "opacity is clamped to 0–100");
  renameVariableRefs(d, "space/md", "space/lg");
  assert.equal(n.bindings.radius, "space/lg");
  unbindVariable(d, "space/lg");
  unbindVariable(d, "weight/bold");
  unbindVariable(d, "font/body");
  unbindVariable(d, "ratio");
  assert.equal(n.bindings, undefined);
  assert.equal(n.radius, 20, "unbinding keeps the resolved value");
});

test("update_node operations keep bindings and re-validate", () => {
  const d = doc({ variables });
  const out = applyOperations(d, [
    {
      type: "update_node",
      pageId: "p",
      nodeId: "a",
      properties: { radius: 12, bindings: { radius: "space/md" } },
    },
  ]);
  assert.deepEqual(out.pages[0].nodes[0].bindings, { radius: "space/md" });
  assert.throws(
    () =>
      applyOperations(d, [
        {
          type: "update_node",
          pageId: "p",
          nodeId: "a",
          properties: { bindings: { x: "space/md" } },
        },
      ]),
    /binding/,
  );
});

test("variables export as CSS custom properties", () => {
  const css = variablesCss(doc({ variables }));
  assert.match(css, /^:root \{/);
  assert.match(css, /--brand: #2563eb;/);
  assert.match(css, /--glass: #ffffff80;/);
  assert.match(css, /--space-md: 12px;/);
  assert.match(css, /--ratio: 1\.4;/);
  assert.match(css, /--font-body: 'Playfair Display';/);
  assert.match(css, /--weight-bold: 700;/);
  assert.equal(variablesCss({ tokens: {}, pages: [] }), "");
  assert.deepEqual(
    describeVariables(doc({ variables })).map((v) => v.cssVar),
    ["var(--space-md)", "var(--ratio)", "var(--font-body)", "var(--weight-bold)"],
  );
});

test("translucent colors survive token creation and HTML export", () => {
  assert.equal(tokenColor("rgba(0, 0, 0, 0.5)"), "#00000080");
  assert.equal(tokenColor("#ABCDEF"), "#abcdef");
  assert.equal(tokenColor("hsl(0 100% 50% / 25%)"), "#ff000040");
  const html = exportHTML(doc({ variables }, { bindings: { radius: "space/md" } }), "p");
  assert.match(html, /color: ?#11223380/);
});

test("font catalog: network list is cached, offline falls back to cache then bundled list", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "bd-catalog-"));
  try {
    let calls = 0;
    const fetch = async (url) => {
      calls++;
      assert.equal(url, "https://api.fontsource.org/v1/fonts");
      return Response.json([
        {
          id: "lora",
          family: "Lora",
          category: "serif",
          weights: [400, 500, 600, 700],
          styles: ["normal", "italic"],
        },
        { id: "inter", family: "Inter", weights: [400] },
        { bogus: true },
      ]);
    };
    const live = await fontCatalog({ fetch, cacheDir });
    assert.equal(live.source, "network");
    assert.equal(live.fonts[0].family, "Inter");
    assert.equal(live.fonts[0].kind, "bundled");
    assert.equal(live.fonts.filter((f) => f.family === "Inter").length, 1);
    assert.deepEqual(live.fonts.find((f) => f.family === "Lora").weights, [400, 500, 600, 700]);
    assert.ok(live.fonts.some((f) => f.family === "Georgia" && f.kind === "system"));
    const cached = await fontCatalog({ fetch, cacheDir });
    assert.equal(cached.source, "cache");
    assert.equal(calls, 1, "fresh cache is not refetched");
    const failing = async () => {
      throw new Error("offline");
    };
    assert.equal((await fontCatalog({ fetch: failing, cacheDir, maxAge: 0 })).source, "cache");
    const empty = await fontCatalog({ fetch: failing, cacheDir: path.join(cacheDir, "none") });
    assert.equal(empty.source, "bundled");
    assert.ok(empty.fonts.some((f) => f.family === "Playfair Display"));
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("CSS variable export rejects aliases instead of silently overriding values", () => {
  for (const d of [
    doc({ tokens: { "space/md": "#123456", "space-md": "#abcdef" } }),
    doc({
      tokens: { "space-md": "#123456" },
      variables: { "space/md": { type: "dimension", value: 16 } },
    }),
    doc({
      variables: {
        "space md": { type: "dimension", value: 16 },
        "space.md": { type: "number", value: 2 },
      },
    }),
  ]) {
    validateDocument(d);
    assert.throws(() => variablesCss(d), /both export as --space-md.*Rename one/);
  }
  assert.match(
    variablesCss(doc({ variables: { "space/md": { type: "dimension", value: 16 } } })),
    /--space-md: 16px;/,
  );
});
