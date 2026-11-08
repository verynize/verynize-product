import test from "node:test";
import assert from "node:assert/strict";
import { validateDocument } from "./design-store.mjs";
import {
  nodeStyle,
  paintError,
  fillsCss,
  svgPaintList,
  recolorSvg,
  paintColor,
} from "./node-style.mjs";
import { exportHTML } from "./export-html.mjs";
import {
  buildNodes,
  elementCode,
  renameTokenRefs,
  syncTokenColors,
  unbindToken,
  runDirectives,
  ensureShortIds,
} from "./design-edit.mjs";
import { parseJsx } from "./jsx-codec.mjs";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const svg = (markup) => "data:image/svg+xml;base64," + Buffer.from(markup).toString("base64");
const MULTI = svg(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="10" height="10" fill="#FF0000"/><rect x="10" width="10" height="10" style="fill:rgb(0, 0, 255)"/><path d="M0 0h20" stroke="red"/></svg>',
);
const css = (node, ctx) => Object.fromEntries(nodeStyle(node, null, ctx).box);
const doc = (nodes) => ({
  version: 2,
  name: "Paints",
  activePage: "p",
  tokens: { brand: "#172033", glow: "#456099" },
  pages: [{ id: "p", name: "Page", nodes }],
});
const stack = () => [
  { type: "solid", color: "#ff000080", token: "brand", opacity: 50 },
  {
    type: "linear",
    angle: 90,
    stops: [
      { position: 100, color: "#0000ff" },
      { position: 0, color: "#00ff00", token: "glow" },
    ],
  },
  {
    type: "radial",
    hidden: true,
    stops: [
      { position: 0, color: "#ffffff" },
      { position: 100, color: "#000000" },
    ],
  },
  { type: "image", src: PNG, fit: "cover", opacity: 40 },
];

test("legacy single fill documents keep loading and render exactly as before", () => {
  const d = validateDocument(
    doc([
      {
        id: "a",
        name: "A",
        type: "rectangle",
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        color: "#a58bdd",
        token: "",
        gradient: "linear-gradient(red, blue)",
      },
    ]),
  );
  const s = css(d.pages[0].nodes[0], { color: "#a58bdd", tokens: d.tokens });
  assert.equal(s.background, "#a58bdd");
  assert.equal(s["background-image"], "linear-gradient(red, blue)");
  assert.equal(s["background-size"], undefined);
});

test("paint stack renders top-first layers with tokens, per-paint opacity, hidden paints and image fit", () => {
  const tokens = { brand: "#172033", glow: "#456099" };
  const s = css(
    { id: "a", type: "rectangle", w: 10, h: 10, color: "#172033", fills: stack() },
    { color: "#172033", tokens },
  );
  assert.equal(s.background, "transparent");
  const layers = s["background-image"].split(/, (?=linear|radial|conic|url)/);
  assert.equal(layers.length, 3, "hidden radial paint is skipped");
  assert.equal(
    layers[0],
    "linear-gradient(rgba(23, 32, 51, 0.5), rgba(23, 32, 51, 0.5))",
    "solid paint resolves its variable and multiplies opacity",
  );
  assert.equal(
    layers[1],
    "linear-gradient(90deg, #456099 0%, #0000ff 100%)",
    "stops sorted, stop variable resolved",
  );
  assert.match(
    layers[2],
    /^url\("data:image\/svg\+xml,/,
    "translucent image paint is wrapped to apply opacity",
  );
  assert.match(decodeURIComponent(layers[2]), /preserveAspectRatio="xMidYMid slice" opacity="0.4"/);
  assert.equal(s["background-size"], "auto, auto, 100% 100%");
  assert.equal(s["background-repeat"], "repeat, repeat, no-repeat");
  for (const [fit, size] of [
    ["fill", "100% 100%"],
    ["cover", "cover"],
    ["contain", "contain"],
    ["none", "auto"],
  ]) {
    const one = css({ type: "frame", w: 10, h: 10, fills: [{ type: "image", src: PNG, fit }] }, {});
    assert.equal(one["background-size"], size, fit);
    assert.equal(one["background-image"], `url("${PNG}")`);
    assert.equal(one["background-position"], "center");
  }
  const conic = fillsCss(
    {
      fills: [
        {
          type: "conic",
          angle: 45,
          stops: [
            { position: 0, color: "#000000" },
            { position: 100, color: "#ffffff" },
          ],
        },
      ],
    },
    {},
  );
  assert.equal(
    conic.layers[0].image,
    "conic-gradient(from 45deg at 50% 50%, #000000 0%, #ffffff 100%)",
  );
  const radial = fillsCss(
    {
      fills: [
        {
          type: "radial",
          stops: [
            { position: 0, color: "#000000" },
            { position: 100, color: "#ffffff" },
          ],
          opacity: 50,
        },
      ],
    },
    {},
  );
  assert.equal(
    radial.layers[0].image,
    "radial-gradient(ellipse farthest-corner at 50% 50%, rgba(0, 0, 0, 0.5) 0%, rgba(255, 255, 255, 0.5) 100%)",
  );
  assert.equal(paintColor("#ff000080", 50), "rgba(255, 0, 0, 0.251)");
});

test("Text Fill: one solid paint sets the ink, other stacks clip the paints to the glyphs", () => {
  const text = { type: "text", w: 10, h: 10, text: "Hi", color: "#000000" };
  assert.equal(css({ ...text, fills: [{ type: "solid", color: "#f8fafc" }] }, {}).color, "#f8fafc");
  const g = css(
    {
      ...text,
      fills: [
        {
          type: "linear",
          stops: [
            { position: 0, color: "#ff0000" },
            { position: 100, color: "#0000ff" },
          ],
        },
      ],
    },
    {},
  );
  assert.equal(g.color, "transparent");
  assert.equal(g["background-clip"], "text");
  assert.equal(g["-webkit-background-clip"], "text");
  assert.equal(g["background-image"], "linear-gradient(180deg, #ff0000 0%, #0000ff 100%)");
  assert.equal(
    css({ ...text, fills: [{ type: "solid", color: "#f8fafc", hidden: true }] }, {}).color,
    "transparent",
    "hidden ink hides the text",
  );
});

test("both validators share the paint rules", () => {
  const ok = { type: "rectangle", fills: stack() };
  assert.equal(paintError(ok), "");
  const bad = [
    { fills: {} },
    { fills: [{ type: "pattern" }] },
    { fills: [{ type: "solid", color: "red" }] },
    { fills: [{ type: "solid", color: "#ffffff", opacity: 120 }] },
    { fills: [{ type: "solid", color: "#ffffff", token: "bad;name" }] },
    { fills: [{ type: "linear", stops: [{ position: 0, color: "#ffffff" }] }] },
    {
      fills: [
        {
          type: "linear",
          stops: [
            { position: 0, color: "#ffffff" },
            { position: 140, color: "#000000" },
          ],
        },
      ],
    },
    { fills: [{ type: "image", src: "https://example.com/a.png" }] },
    { fills: [{ type: "image", src: PNG, fit: "scale-down" }] },
    { fills: [{ type: "solid", color: "#ffffff", hidden: "yes" }] },
    { fills: Array.from({ length: 17 }, () => ({ type: "solid", color: "#ffffff" })) },
    { type: "rectangle", svgPaints: { "#ff0000": "#00ff00" } },
    { type: "image", src: MULTI, svgPaints: { "#FF0000": "#00ff00" } },
    { type: "image", src: MULTI, svgPaints: { "#ff0000": "blue" } },
  ];
  for (const patch of bad) {
    const d = doc([
      {
        id: "a",
        name: "A",
        type: "rectangle",
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        color: "#ffffff",
        ...patch,
      },
    ]);
    assert.throws(() => validateDocument(d), Error, JSON.stringify(patch).slice(0, 80));
  }
  assert.ok(
    validateDocument(
      doc([
        {
          id: "a",
          name: "A",
          type: "text",
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          color: "#ffffff",
          text: "x",
          fills: stack(),
        },
      ]),
    ),
  );
});

test("colour variables: rename, sync and delete keep paints bound or detached with the resolved value", () => {
  const d = doc([
    {
      id: "a",
      name: "A",
      type: "rectangle",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      color: "#172033",
      fills: stack(),
    },
  ]);
  d.tokens.glow = "#112233";
  syncTokenColors(d);
  const n = d.pages[0].nodes[0];
  assert.equal(n.fills[1].stops[1].color, "#112233", "sync writes the resolved stop colour");
  renameTokenRefs(d, "glow", "shine");
  d.tokens.shine = d.tokens.glow;
  delete d.tokens.glow;
  assert.equal(n.fills[1].stops[1].token, "shine");
  unbindToken(d, "shine");
  delete d.tokens.shine;
  assert.equal(n.fills[1].stops[1].token, undefined);
  assert.equal(n.fills[1].stops[1].color, "#112233", "detach preserves the resolved colour");
  assert.ok(validateDocument(d));
});

test("multicolour SVG: paints are listed and individually replaced in canvas and HTML export without touching the source", () => {
  assert.deepEqual(svgPaintList(MULTI), ["#ff0000", "#0000ff"]);
  const recolored = recolorSvg(MULTI, { "#ff0000": "#00ff00" });
  const markup = Buffer.from(recolored.split(",")[1], "base64").toString();
  assert.match(markup, /fill="#00ff00"/);
  assert.match(markup, /stroke="#00ff00"/, "named colour with the same value is replaced too");
  assert.match(markup, /fill:rgb\(0, 0, 255\)/, "other paints are untouched");
  const node = {
    id: "i",
    name: "Logo",
    type: "image",
    x: 0,
    y: 0,
    w: 20,
    h: 10,
    color: "transparent",
    src: MULTI,
    svgPaints: { "#ff0000": "#00ff00", "#0000ff": "#ffff0080" },
  };
  const d = validateDocument(doc([node]));
  const style = nodeStyle(d.pages[0].nodes[0], null, {});
  assert.ok(style.src && style.src !== MULTI);
  assert.deepEqual(svgPaintList(style.src), ["#00ff00", "#ffff0080"]);
  const html = exportHTML(d, "p");
  assert.ok(html.includes(style.src), "export renders the recoloured copy");
  assert.equal(d.pages[0].nodes[0].src, MULTI, "stored source unchanged");
  assert.equal(nodeStyle({ ...node, svgPaints: undefined }, null, {}).src, null);
});

test("fills and SVG paints survive a JSX round trip; elided image paints are restored on edit", () => {
  const big = "data:image/png;base64," + "A".repeat(4000);
  const d = doc([
    {
      id: "card",
      name: "Card",
      type: "frame",
      x: 0,
      y: 0,
      w: 100,
      h: 80,
      color: "#172033",
      layout: "free",
      fills: [
        ...stack().slice(0, 2),
        { type: "image", src: big, fit: "contain", imageWidth: 10, imageHeight: 10 },
      ],
    },
    {
      id: "logo",
      name: "Logo",
      type: "image",
      x: 0,
      y: 0,
      w: 20,
      h: 10,
      color: "transparent",
      src: MULTI,
      svgPaints: { "#ff0000": "#00ff00" },
    },
  ]);
  validateDocument(d);
  ensureShortIds(d);
  const page = d.pages[0];
  const code = elementCode(d, page, page.nodes[0]);
  assert.match(code, /data-fills="\[/);
  assert.ok(!code.includes("A".repeat(4000)), "large image data is elided");
  const built = buildNodes(parseJsx(code).elements, { document: d, page });
  const card = built.nodes[0];
  assert.deepEqual(card.fills.slice(0, 2), page.nodes[0].fills.slice(0, 2));
  assert.equal(
    card.fills.length,
    2,
    "a new element cannot restore an elided image, so that paint is dropped",
  );
  const logo = buildNodes(parseJsx(elementCode(d, page, page.nodes[1])).elements, {
    document: d,
    page,
  }).nodes[0];
  assert.deepEqual(logo.svgPaints, { "#ff0000": "#00ff00" });
  // Editing the existing element keeps the elided image paint.
  const id = code.match(/data-node-id="([^"]+)"/)[1];
  const edited = runDirectives(
    d,
    "p",
    `{/* edit ${id} */}\n${code.replace("&quot;angle&quot;:90", "&quot;angle&quot;:45")}`,
  );
  assert.equal(edited.failed, 0, edited.report);
  const node = edited.document.pages[0].nodes.find((n) => n.id === "card");
  assert.equal(node.fills[1].angle, 45);
  assert.equal(node.fills[2].src, big);
  assert.throws(
    () =>
      buildNodes(parseJsx('<div data-fills="[{&quot;type&quot;:&quot;solid&quot;}]" />').elements, {
        document: d,
        page,
      }),
    /Solid paint/,
  );
});

test("code export: Tailwind component without editor bookkeeping, CSS classes from inline styles", async () => {
  const { tailwindCode, cssCode } = await import("./export-code.mjs");
  const d = doc([
    {
      id: "card",
      name: "Hero card",
      type: "frame",
      x: 40,
      y: 40,
      w: 100,
      h: 80,
      color: "#172033",
      token: "brand",
      layout: "free",
      fills: stack().slice(0, 2),
    },
    {
      id: "label",
      name: "Label",
      type: "text",
      parentId: "card",
      x: 0,
      y: 0,
      w: 80,
      h: 20,
      color: "#ffffff",
      text: "Hi",
    },
  ]);
  const jsx = tailwindCode(d, "p", ["card", "label"], "Hero card");
  assert.match(
    jsx,
    /^\/\* Colour variables[\s\S]*--brand: #172033;[\s\S]*export default function HeroCard\(\) \{/,
  );
  assert.equal(
    (jsx.match(/data-node-label="Label"/g) || []).length,
    1,
    "a child of an exported frame is not repeated",
  );
  assert.doesNotMatch(jsx, /data-node-id|data-component-x/);
  assert.match(jsx, /data-fills=/);
  assert.doesNotMatch(
    jsx,
    /Made with Verynize|box-sizing/,
    "the plain export has no clipboard header",
  );
  // The clipboard form (Copy as code / Copy prompt, Wonder P1-copy-code.txt): header comment, then the reset.
  const snippet = tailwindCode(d, "p", ["label"], "Label", {
    snippet: { links: ["verynize://node/doc/p/abc"], date: "Oct 31, 2026" },
  });
  assert.match(
    snippet,
    /^\/\*\*\n \* Made with Verynize\n \* verynize:\/\/node\/doc\/p\/abc\n \* Oct 31, 2026\n \*\/\n/,
  );
  assert.match(snippet, /<>\n {6}<style>\{"\* \{ box-sizing: border-box; \}"\}<\/style>\n/);
  const html = exportHTML(validateDocument(d), "p");
  const out = cssCode(html, d.tokens);
  assert.match(out, /<style>\n:root \{\n  --brand: #172033;\n  --glow: #456099;\n\}\n/);
  assert.match(out, /\.hero-card \{\n  box-sizing: border-box;/);
  assert.match(
    out,
    /\.hero-card \{[^}]*background-image: linear-gradient\(rgba\(23, 32, 51, 0\.5\)/,
    "semicolons inside url()/gradients do not split declarations",
  );
  assert.match(out, /<div[^>]* class="hero-card">/);
  assert.doesNotMatch(out, /data-id="card"[^>]*style=/);
  assert.throws(() => tailwindCode(d, "p", ["missing"]), /Select at least one layer/);
});

test("text Background Fill: validated on text only, drawn under the glyphs, bound, and kept by the codec", () => {
  const label = {
    id: "label",
    name: "Label",
    type: "text",
    x: 0,
    y: 0,
    w: 80,
    h: 20,
    color: "#ffffff",
    text: "Hi",
    backgroundFills: [{ type: "solid", color: "#ff0000", token: "brand" }],
  };
  const d = validateDocument(doc([label]));
  assert.equal(paintError({ type: "frame", backgroundFills: [] }) !== "", true, "frames use fills");
  assert.throws(
    () => validateDocument(doc([{ ...label, backgroundFills: [{ type: "solid" }] }])),
    /Solid paint/,
  );
  // A solid Text Fill keeps `color`; the background paints the box.
  const plain = css(d.pages[0].nodes[0], { tokens: d.tokens });
  assert.equal(plain.color, "#ffffff");
  assert.equal(plain["background-image"], "linear-gradient(#172033, #172033)");
  assert.equal(plain["background-clip"], "border-box");
  // A gradient Text Fill stays clipped to the glyphs, above the box-clipped background.
  const both = css(
    {
      ...label,
      backgroundFills: [{ type: "solid", color: "#00ff00" }],
      fills: [
        {
          type: "linear",
          angle: 90,
          stops: [
            { position: 0, color: "#ff0000" },
            { position: 100, color: "#0000ff" },
          ],
        },
      ],
    },
    { tokens: {} },
  );
  assert.equal(both.color, "transparent");
  assert.equal(both["background-clip"], "text, border-box");
  assert.match(
    both["background-image"],
    /^linear-gradient\(90deg[^)]*\)[^,]*, linear-gradient\(#00ff00/,
  );
  // Colour variables are followed (rename, unbind) like any other paint.
  renameTokenRefs(d, "brand", "ink");
  assert.equal(d.pages[0].nodes[0].backgroundFills[0].token, "ink");
  d.tokens.ink = d.tokens.brand;
  unbindToken(d, "ink");
  assert.deepEqual(d.pages[0].nodes[0].backgroundFills[0], { type: "solid", color: "#172033" });
  // JSX round trip.
  ensureShortIds(d);
  const page = d.pages[0];
  const code = elementCode(d, page, page.nodes[0]);
  assert.match(code, /data-background-fills="\[/);
  const built = buildNodes(parseJsx(code).elements, { document: d, page }).nodes[0];
  assert.deepEqual(built.backgroundFills, [{ type: "solid", color: "#172033" }]);
});
