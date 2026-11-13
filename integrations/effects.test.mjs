// Structured effects (blend, outline, shadows, filters, masks): one CSS mapping for canvas and export,
// shared validation (validateDocument, web/document-core.js, shared with the canvas), and the JSX codec.
import test from "node:test";
import assert from "node:assert/strict";
import { nodeStyle, effectsOf, validateEffects, BLEND_MODES } from "./node-style.mjs";
import { validateDocument } from "./design-store.mjs";
import { exportHTML } from "./export-html.mjs";
import { serializeNode } from "./jsx-codec.mjs";
import { createArtboards, ensureShortIds, indexPage } from "./design-edit.mjs";

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
const doc = (nodes, tokens = {}) => ({
  version: 2,
  name: "Effects",
  tokens,
  pages: [{ id: "p", name: "P", nodes }],
});
const decls = (node, ctx) => Object.fromEntries(nodeStyle(node, null, ctx).box);

test("all 18 Wonder blend modes map to mix-blend-mode; plus-darker keeps a fallback", () => {
  assert.equal(BLEND_MODES.length, 18);
  for (const mode of BLEND_MODES.filter((m) => m !== "normal"))
    assert.equal(decls(rect({ blendMode: mode }))["mix-blend-mode"], mode);
  assert.equal(decls(rect({ blendMode: "normal" }))["mix-blend-mode"], undefined);
  const box = nodeStyle(rect({ blendMode: "plus-darker" }), null)
    .box.filter(([k]) => k === "mix-blend-mode")
    .map(([, v]) => v);
  assert.deepEqual(box, ["color-burn", "plus-darker"]);
});

test("outline is a real CSS outline, independent of box-shadow", () => {
  const css = decls(
    rect({ outlineWidth: 1, outlineOffset: 4, outlineColor: "#5eead4", outlineStyle: "dashed" }),
  );
  assert.equal(css.outline, "1px dashed #5eead4");
  assert.equal(css["outline-offset"], "4px");
  assert.equal(css["box-shadow"], undefined);
  assert.equal(decls(rect({ outlineWidth: 0, outlineColor: "#ffffff" })).outline, undefined);
});

test("shadow list: box, inner, drop (filter), text (text layers), hidden and variable colours", () => {
  const shadows = [
    { type: "box", x: 0, y: 12, blur: 4, spread: -4, color: "#00000040" },
    { type: "box", inset: true, x: 1, y: 1, blur: 0, spread: 0, color: "#000000", token: "accent" },
    { type: "drop", x: 0, y: 2, blur: 6, spread: 0, color: "#00000080" },
    { type: "box", x: 9, y: 9, blur: 9, spread: 9, color: "#000000", hidden: true },
  ];
  const css = decls(
    rect({ shadows, ringWidth: 2, ringColor: "#ff0000", shadow: "0 1px 2px #000" }),
    { tokens: { accent: "#00ff00" } },
  );
  assert.equal(
    css["box-shadow"],
    "0 0 0 2px #ff0000, 0px 12px 4px -4px #00000040, inset 1px 1px 0px 0px #00ff00, 0 1px 2px #000",
  );
  assert.equal(css.filter, "drop-shadow(0px 2px 6px #00000080)");
  // Unresolved variable falls back to the stored colour.
  assert.match(decls(rect({ shadows: [shadows[1]] }))["box-shadow"], /#000000$/);
  const text = {
    id: "t",
    type: "text",
    name: "T",
    x: 0,
    y: 0,
    w: 100,
    h: 20,
    text: "Hi",
    shadows: [{ type: "text", x: 0, y: 1, blur: 2, spread: 0, color: "#00000080" }],
  };
  assert.equal(decls(text)["text-shadow"], "0px 1px 2px #00000080");
  assert.equal(validateEffects(rect({ shadows: [text.shadows[0]] })), "Invalid shadow type");
});

test("filters: layer and backdrop groups in list order, clamped to their ranges, hidden skipped", () => {
  const filters = [
    { type: "blur", value: 2 },
    { type: "brightness", value: 1.1 },
    { type: "contrast", value: 1.5 },
    { type: "grayscale", value: 0.5 },
    { type: "hueRotate", value: 90 },
    { type: "invert", value: 1 },
    { type: "saturate", value: 2 },
    { type: "sepia", value: 0.3 },
    { type: "blur", value: 8, backdrop: true },
    { type: "sepia", value: 1, hidden: true },
  ];
  const css = decls(rect({ filters }));
  assert.equal(
    css.filter,
    "blur(2px) brightness(1.1) contrast(1.5) grayscale(0.5) hue-rotate(90deg) invert(1) saturate(2) sepia(0.3)",
  );
  assert.equal(css["backdrop-filter"], "blur(8px)");
  assert.equal(
    validateEffects(rect({ filters: [{ type: "brightness", value: 3.5 }] })),
    "Invalid filter",
  );
  assert.equal(
    validateEffects(rect({ filters: [{ type: "dropShadow", value: 1 }] })),
    "Invalid filter",
  );
});

test("gradient masks: linear / radial / conic with alpha, rotation, invert and visibility", () => {
  const masks = [
    { type: "linear", rotation: 180, alpha: 100 },
    { type: "conic", rotation: 45, alpha: 50, invert: true },
    { type: "radial", alpha: 100, hidden: true },
  ];
  assert.equal(
    decls(rect({ masks }))["mask-image"],
    "linear-gradient(180deg, rgba(0, 0, 0, 1), rgba(0, 0, 0, 0)), conic-gradient(from 45deg, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.5))",
  );
  assert.equal(
    effectsOf(rect({ masks: [{ type: "radial" }] })).masks[0],
    "radial-gradient(rgba(0, 0, 0, 1), rgba(0, 0, 0, 0))",
  );
  assert.equal(decls(rect({ masks: [masks[2]] }))["mask-image"], undefined);
});

test("validateDocument enforces the effect schema (shared with the canvas)", () => {
  assert.doesNotThrow(() =>
    validateDocument(
      doc([
        rect({
          blendMode: "luminosity",
          outlineWidth: 2,
          outlineColor: "#000000",
          shadows: [{ type: "drop", x: 0, y: 0, blur: 1, spread: 0, color: "#000000" }],
          filters: [{ type: "invert", value: 1 }],
          masks: [{ type: "linear" }],
        }),
      ]),
    ),
  );
  for (const bad of [
    { blendMode: "burn" },
    { outlineWidth: -1 },
    { outlineColor: "red" },
    { shadows: {} },
    { shadows: [{ type: "box", x: 0, y: 0, blur: -1, spread: 0, color: "#000000" }] },
    { shadows: [{ type: "drop", inset: true, x: 0, y: 0, blur: 0, spread: 0, color: "#000000" }] },
    { filters: [{ type: "blur", value: 1, backdrop: "yes" }] },
    { masks: [{ type: "linear", alpha: 101 }] },
  ])
    assert.throws(() => validateDocument(doc([rect(bad)])), undefined, JSON.stringify(bad));
});

test("headless HTML export carries the same declarations, with variable shadow colours resolved", () => {
  const html = exportHTML(
    doc(
      [
        rect({
          blendMode: "multiply",
          outlineWidth: 1,
          outlineOffset: 4,
          outlineColor: "#5eead4",
          shadows: [
            { type: "box", x: 0, y: 12, blur: 4, spread: -4, color: "#000000", token: "shade" },
          ],
          filters: [{ type: "brightness", value: 1.1 }],
          masks: [{ type: "conic", rotation: 45 }],
        }),
      ],
      { shade: "#00000040" },
    ),
  );
  for (const part of [
    "mix-blend-mode:multiply",
    "outline:1px solid #5eead4",
    "outline-offset:4px",
    "box-shadow:0px 12px 4px -4px #00000040",
    "filter:brightness(1.1)",
    "mask-image:conic-gradient(from 45deg",
  ])
    assert.ok(html.includes(part), part);
});

test("JSX codec writes effects as Tailwind classes and reads them back", () => {
  const node = {
    ...rect({
      layout: "block",
      blendMode: "multiply",
      outlineWidth: 2,
      outlineOffset: 4,
      outlineColor: "#5eead4",
      outlineStyle: "dashed",
      shadows: [
        { type: "box", x: 0, y: 12, blur: 4, spread: -4, color: "#00000040" },
        { type: "drop", x: 0, y: 2, blur: 4, spread: 0, color: "#000000" },
      ],
      filters: [
        { type: "blur", value: 2 },
        { type: "hueRotate", value: 45 },
        { type: "blur", value: 6, backdrop: true },
      ],
    }),
    type: "frame",
  };
  const source = doc([node]);
  ensureShortIds(source);
  const code = serializeNode(node, indexPage(source.pages[0]), {});
  for (const cls of [
    "mix-blend-multiply",
    "outline-2",
    "outline-dashed",
    "outline-offset-4",
    "[filter:blur(2px)_hue-rotate(45deg)_drop-shadow(0px_2px_4px_#000000)]",
    "[backdrop-filter:blur(6px)]",
  ])
    assert.ok(code.includes(cls), cls);
  const target = doc([]);
  // Classes alone (no data-vn side channel, as an agent might write them): box shadows read back as the shadow string.
  assert.match(code, / data-vn='/);
  const result = createArtboards(
    target,
    "p",
    code.replace(/ data-vn='[^']*'/, "") +
      '\n<p className="text-white [text-shadow:0_1px_2px_#00000080] brightness-110 mix-blend-plus-lighter">Hi</p>',
  );
  const [frame, text] = (result.document || target).pages[0].nodes.filter(
    (n) => n.type === "frame" || n.type === "text",
  );
  // With the side channel the structured lists come back exactly (codec-residual.mjs).
  const exact = createArtboards(doc([]), "p", code).document.pages[0].nodes[0];
  assert.deepEqual(exact.shadows, node.shadows);
  assert.deepEqual(exact.filters, node.filters);
  assert.ok(!exact.shadow);
  assert.equal(frame.blendMode, "multiply");
  assert.deepEqual(
    [frame.outlineWidth, frame.outlineOffset, frame.outlineColor, frame.outlineStyle],
    [2, 4, "#5eead4", "dashed"],
  );
  assert.equal(frame.shadow, "0px 12px 4px -4px #00000040");
  assert.deepEqual(frame.shadows, [
    { type: "drop", x: 0, y: 2, blur: 4, spread: 0, color: "#000000" },
  ]);
  assert.deepEqual(frame.filters, [
    { type: "blur", value: 2 },
    { type: "hueRotate", value: 45 },
    { type: "blur", value: 6, backdrop: true },
  ]);
  assert.equal(text.blendMode, "plus-lighter");
  assert.deepEqual(text.filters, [{ type: "brightness", value: 1.1 }]);
  assert.deepEqual(text.shadows, [
    { type: "text", x: 0, y: 1, blur: 2, spread: 0, color: "#00000080" },
  ]);
  // The rebuilt layer renders the same CSS as the original.
  const before = decls(node),
    after = decls(frame);
  for (const prop of [
    "mix-blend-mode",
    "outline",
    "outline-offset",
    "box-shadow",
    "filter",
    "backdrop-filter",
  ])
    assert.equal(after[prop], before[prop], prop);
});

test('shape masks ("Use as mask"): an inset() rectangle as an alpha SVG layer stretched over the box', () => {
  const masks = [{ type: "shape", shape: "inset(25% 25% 50% 25%)" }];
  const svgOf = (value) =>
    Buffer.from(
      value.match(/^url\("data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"\)$/)[1],
      "base64",
    ).toString();
  const css = decls(rect({ masks }));
  assert.equal(
    svgOf(css["mask-image"]),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="25" y="25" width="50" height="25"/></svg>',
  );
  assert.deepEqual(
    [css["mask-mode"], css["mask-repeat"], css["mask-size"], css["mask-position"]],
    ["alpha", "no-repeat", "100% 100%", undefined],
  );
  // CSS shorthand: one value applies to every side; a mask larger than the box keeps all of it.
  assert.match(
    svgOf(effectsOf(rect({ masks: [{ type: "shape", shape: "inset(-50%)" }] })).masks[0]),
    /<rect x="-50" y="-50" width="200" height="200"\/>/,
  );
  // Stacks with the other masks.
  assert.equal(effectsOf(rect({ masks: [{ type: "linear" }, ...masks] })).masks.length, 2);
  assert.doesNotThrow(() => validateDocument(doc([rect({ masks })])));
  for (const bad of [
    [{ type: "shape" }],
    [{ type: "shape", shape: "inset(10px)" }],
    [{ type: "shape", shape: "circle(50%)" }],
    [{ type: "shape", shape: "inset(1% 2% 3% 4% 5%)" }],
    [{ type: "linear", shape: "inset(0%)" }],
  ])
    assert.throws(
      () => validateDocument(doc([rect({ masks: bad })])),
      undefined,
      JSON.stringify(bad),
    );
  assert.match(
    exportHTML(doc([rect({ masks })])),
    /mask-image:url\((&quot;|")data:image\/svg\+xml;base64,/,
  );
});

test("JSX codec round-trips a shape mask through the side channel", () => {
  const node = {
    ...rect({ layout: "block", masks: [{ type: "shape", shape: "inset(-50% -50% -50% -50%)" }] }),
    type: "frame",
  };
  const source = doc([node]);
  ensureShortIds(source);
  const code = serializeNode(node, indexPage(source.pages[0]), {});
  assert.match(code, /\[mask-image:url\(/);
  const back = createArtboards(doc([]), "p", code).document.pages[0].nodes[0];
  assert.deepEqual(back.masks, node.masks);
});
