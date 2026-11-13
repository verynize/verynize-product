// Remaining inspector parity: colour variables on border (uniform and per side) and outline, Image/Custom
// masks with Mode/Repeat/Position/Size and boolean operations. One CSS mapping (web/node-style.js) for the
// canvas and export, shared validation, colour-variable rename/delete/sync and the JSX codec.
import test from "node:test";
import assert from "node:assert/strict";
import { nodeStyle, validateEffects, eachPaintColor } from "./node-style.mjs";
import { validateDocument } from "./design-store.mjs";
import { exportHTML } from "./export-html.mjs";
import { serializeNode } from "./jsx-codec.mjs";
import {
  createArtboards,
  ensureShortIds,
  indexPage,
  renameTokenRefs,
  unbindToken,
  syncTokenColors,
} from "./design-edit.mjs";

const rect = (extra) => ({
  id: "r",
  type: "rectangle",
  name: "R",
  x: 0,
  y: 0,
  w: 100,
  h: 80,
  color: "#ffcc00",
  ...extra,
});
const frame = (extra) => ({ ...rect(extra), type: "frame", layout: "block" });
const doc = (nodes, tokens = {}) => ({
  version: 2,
  name: "Parity",
  tokens,
  pages: [{ id: "p", name: "P", nodes }],
});
const decls = (node, tokens) => Object.fromEntries(nodeStyle(node, null, { tokens }).box);
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("border and outline colours follow a bound colour variable; per-side colours paint each side", () => {
  const tokens = { "brand/line": "#334155", accent: "#5eead4" };
  const css = decls(
    rect({
      strokeWidth: 1,
      strokeColor: "#000000",
      strokeToken: "brand/line",
      outlineWidth: 1,
      outlineOffset: 4,
      outlineColor: "#000000",
      outlineToken: "accent",
    }),
    tokens,
  );
  assert.equal(css["border-color"], "#334155");
  assert.equal(css.outline, "1px solid #5eead4");
  // A missing variable falls back to the stored colour.
  assert.equal(
    decls(rect({ strokeWidth: 1, strokeColor: "#111111", strokeToken: "gone" }), tokens)[
      "border-color"
    ],
    undefined,
  );
  assert.equal(
    decls(rect({ outlineWidth: 2, outlineColor: "#111111", outlineToken: "gone" }), tokens).outline,
    "2px solid #111111",
  );
  const sides = decls(
    rect({
      strokeWidths: [1, 2, 3, 4],
      strokeWidth: 4,
      strokeColor: "#000000",
      strokeColors: [
        { color: "#ff0000" },
        { color: "#000000", token: "accent" },
        { color: "#0000ff" },
        { color: "#ffffff80" },
      ],
    }),
    tokens,
  );
  assert.equal(sides["border-color"], "#ff0000 #5eead4 #0000ff #ffffff80");
  assert.equal(sides["border-width"], "1px 2px 3px 4px");
});

test("validation rejects malformed border/outline variables and side colours (shared schema, web/document-core.js)", () => {
  assert.equal(validateEffects(rect({ strokeToken: "ok/name", outlineToken: "x" })), "");
  assert.match(validateEffects(rect({ strokeToken: 5 })), /border color variable/);
  assert.match(validateEffects(rect({ outlineToken: "" })), /outline color variable/);
  assert.match(validateEffects(rect({ strokeColors: [{ color: "#fff" }] })), /border side colors/);
  assert.match(
    validateEffects(rect({ strokeColors: Array(4).fill({ color: "red" }) })),
    /border side colors/,
  );
  assert.throws(
    () => validateDocument(doc([rect({ strokeColors: [1, 2, 3, 4] })])),
    /border side colors/,
  );
});

test("a border side hidden with its own eye draws nothing, keeps its width and is validated", () => {
  const node = rect({
    strokeWidths: [1, 2, 3, 4],
    strokeWidth: 4,
    strokeColor: "#000000",
    strokeHiddenSides: [false, true, false, true],
  });
  assert.equal(decls(node)["border-width"], "1px 0px 3px 0px");
  assert.deepEqual(node.strokeWidths, [1, 2, 3, 4]);
  // The JSX codec writes only the visible sides.
  const jsxOf = (n) => {
    const d = doc([n]);
    ensureShortIds(d);
    return serializeNode(d.pages[0].nodes[0], indexPage(d.pages[0]));
  };
  const jsx = jsxOf(node);
  assert.match(jsx, /border-t\b/);
  assert.match(jsx, /border-b-3/);
  assert.doesNotMatch(jsx, /border-r-2|border-l-4/);
  // Every side hidden: no border classes at all.
  assert.doesNotMatch(
    jsxOf(
      rect({
        strokeWidths: [1, 1, 1, 1],
        strokeWidth: 1,
        strokeHiddenSides: [true, true, true, true],
      }),
    ),
    /\bborder\b/,
  );
  assert.equal(validateEffects(node), "");
  assert.match(validateEffects(rect({ strokeHiddenSides: [true] })), /border side visibility/);
  assert.match(
    validateEffects(rect({ strokeHiddenSides: [1, 0, 0, 0] })),
    /border side visibility/,
  );
  assert.throws(
    () => validateDocument(doc([rect({ strokeHiddenSides: "top" })])),
    /border side visibility/,
  );
});

test("colour variable rename, delete and value sync reach border, side colours and outline", () => {
  const d = doc(
    [
      rect({
        strokeWidth: 1,
        strokeColor: "#000000",
        strokeToken: "line",
        outlineWidth: 1,
        outlineColor: "#000000",
        outlineToken: "line",
        strokeColors: [
          { color: "#000000", token: "line" },
          { color: "#ff0000" },
          { color: "#ff0000" },
          { color: "#ff0000" },
        ],
      }),
    ],
    { line: "#123456" },
  );
  syncTokenColors(d);
  let n = d.pages[0].nodes[0];
  assert.deepEqual(
    [n.strokeColor, n.outlineColor, n.strokeColors[0].color],
    ["#123456", "#123456", "#123456"],
  );
  d.tokens.edge = d.tokens.line;
  delete d.tokens.line;
  renameTokenRefs(d, "line", "edge");
  assert.deepEqual(
    [n.strokeToken, n.outlineToken, n.strokeColors[0].token],
    ["edge", "edge", "edge"],
  );
  d.tokens.edge = "#abcdef";
  unbindToken(d, "edge");
  delete d.tokens.edge;
  assert.deepEqual(
    [n.strokeToken, n.outlineToken, n.strokeColors[0].token],
    [undefined, undefined, undefined],
  );
  assert.deepEqual(
    [n.strokeColor, n.outlineColor, n.strokeColors[0].color],
    ["#abcdef", "#abcdef", "#abcdef"],
  );
  // Shadows are colour holders too (rename keeps the binding).
  const s = rect({
    shadows: [{ type: "box", x: 0, y: 1, blur: 2, spread: 0, color: "#000000", token: "a" }],
  });
  eachPaintColor(s, (c) => {
    if (c.token === "a") c.token = "b";
  });
  assert.equal(s.shadows[0].token, "b");
  n = null;
});

test("image and custom masks with mode, repeat, position, size and boolean operations", () => {
  const masks = [
    {
      type: "image",
      src: PNG,
      mode: "luminance",
      repeat: "no-repeat",
      x: 10,
      y: 20,
      size: "50%",
      composite: "subtract",
    },
    {
      type: "custom",
      css: "radial-gradient(circle, black 40%, transparent 41%)",
      composite: "intersect",
    },
    { type: "linear", rotation: 90, alpha: 100, mode: "alpha", size: "cover", repeat: "repeat-x" },
    { type: "radial", alpha: 100, hidden: true },
  ];
  assert.equal(validateEffects(rect({ masks })), "");
  const css = decls(rect({ masks }));
  assert.equal(
    css["mask-image"],
    `url("${PNG}"), radial-gradient(circle, black 40%, transparent 41%), linear-gradient(90deg, rgba(0, 0, 0, 1), rgba(0, 0, 0, 0))`,
  );
  assert.equal(css["mask-mode"], "luminance, match-source, alpha");
  assert.equal(css["mask-repeat"], "no-repeat, repeat, repeat-x");
  assert.equal(css["mask-position"], "10% 20%, 0% 0%, 0% 0%");
  assert.equal(css["mask-size"], "50%, auto, cover");
  assert.equal(css["mask-composite"], "subtract, intersect, add");
  // Older gradient-only masks keep exactly their previous declarations.
  const plain = decls(rect({ masks: [{ type: "linear", rotation: 180, alpha: 100 }] }));
  assert.deepEqual(
    ["mask-mode", "mask-repeat", "mask-position", "mask-size", "mask-composite"].map(
      (k) => plain[k],
    ),
    [undefined, undefined, undefined, undefined, undefined],
  );
  for (const [bad, message] of [
    [{ type: "image", src: "https://example.com/a.png" }, /embedded base64/],
    [{ type: "custom", css: "url(x.png)" }, /CSS gradient/],
    [{ type: "custom", css: "linear-gradient(red, url(x))" }, /CSS gradient/],
    [{ type: "linear", mode: "stencil" }, /mask mode/],
    [{ type: "linear", repeat: "tile" }, /mask repeat/],
    [{ type: "linear", composite: "xor" }, /mask operation/],
    [{ type: "linear", size: "10vw" }, /mask size/],
    [{ type: "linear", x: "left" }, /mask position/],
  ])
    assert.match(validateEffects(rect({ masks: [bad] })), message, JSON.stringify(bad));
  assert.throws(
    () => validateDocument(doc([rect({ masks: [{ type: "image", src: "x" }] })])),
    /Image mask/,
  );
  const html = exportHTML(doc([rect({ masks })]), "p");
  assert.match(html, /mask-composite: ?subtract, intersect, add/);
});

test("JSX codec carries border/outline variables, per-side border colours and advanced masks", () => {
  const tokens = { "brand/line": "#334155", accent: "#5eead4" };
  const masks = [
    {
      type: "image",
      src: PNG,
      mode: "luminance",
      repeat: "no-repeat",
      x: 10,
      y: 20,
      size: "50%",
      composite: "subtract",
    },
    { type: "linear", rotation: 180, alpha: 100, hidden: true },
  ];
  const node = frame({
    strokeWidth: 2,
    strokeColor: "#334155",
    strokeToken: "brand/line",
    outlineWidth: 1,
    outlineColor: "#5eead4",
    outlineToken: "accent",
    masks,
  });
  const sideNode = {
    ...frame({
      strokeWidths: [1, 2, 1, 2],
      strokeWidth: 2,
      strokeColor: "#000000",
      strokeColors: [
        { color: "#ff0000" },
        { color: "#5eead4", token: "accent" },
        { color: "#00ff00" },
        { color: "#0000ff" },
      ],
    }),
    id: "s",
    x: 200,
  };
  const source = doc([node, sideNode], tokens);
  ensureShortIds(source);
  const index = indexPage(source.pages[0]);
  const code =
    serializeNode(node, index, { tokens }) + "\n" + serializeNode(sideNode, index, { tokens });
  assert.match(code, /border-\[color:var\(--brand-line\)\]/);
  assert.match(code, /outline-\[color:var\(--accent\)\]/);
  assert.match(code, /border-r-\[color:var\(--accent\)\]/);
  const back = createArtboards(doc([], tokens), "p", code);
  const [a, b] = back.document.pages[0].nodes;
  assert.equal(a.strokeToken, "brand/line");
  assert.equal(a.outlineToken, "accent");
  assert.deepEqual(a.masks, masks);
  assert.deepEqual(b.strokeColors, sideNode.strokeColors);
  assert.equal(b.strokeToken, undefined);
  // The rebuilt layers render the same CSS.
  for (const [before, after] of [
    [node, a],
    [sideNode, b],
  ]) {
    const x = decls(before, tokens),
      y = decls(after, tokens);
    for (const prop of [
      "border-color",
      "border-width",
      "outline",
      "mask-image",
      "mask-mode",
      "mask-composite",
    ])
      assert.equal(y[prop], x[prop], prop);
  }
  // Rewriting the colour as a plain class detaches the variable (classes stay authoritative).
  const plain = createArtboards(
    doc([], tokens),
    "p",
    code
      .split("\n")[0]
      .replace("border-[color:var(--brand-line)]", "border-[#334155]")
      .replace("outline-[color:var(--accent)]", "outline-[#5eead4]"),
  );
  const p = plain.document.pages[0].nodes[0];
  assert.equal(p.strokeToken, undefined);
  assert.equal(p.outlineToken, undefined);
  assert.equal(p.strokeColor, "#334155");
});
