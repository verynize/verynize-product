import test from "node:test";
import assert from "node:assert/strict";
import { validateDocument } from "./design-store.mjs";
import { nodeStyle } from "./node-style.mjs";
import { exportHTML } from "./export-html.mjs";
import {
  buildNodes,
  elementCode,
  renameTokenRefs,
  syncTokenColors,
  unbindToken,
} from "./design-edit.mjs";
import { parseJsx } from "./jsx-codec.mjs";

const src =
  "data:image/svg+xml;base64," +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000000"><path d="M4 12h16M12 4v16"/></svg>',
  ).toString("base64");
const fixture = () => ({
  version: 2,
  name: "SVG colors",
  activePage: "p",
  tokens: { accent: "#ff8800" },
  pages: [
    {
      id: "p",
      name: "Page",
      nodes: [
        {
          id: "icon",
          name: "Plus",
          type: "image",
          x: 0,
          y: 0,
          w: 64,
          h: 64,
          color: "#eeeeee",
          src,
          svgColor: "#000000",
          svgColorToken: "accent",
        },
      ],
    },
  ],
});

test("SVG color uses the source alpha shape and preserves the independent background", () => {
  const d = validateDocument(fixture()),
    n = d.pages[0].nodes[0];
  const style = nodeStyle(n, null, { color: n.color, svgColor: d.tokens[n.svgColorToken] });
  assert.equal(style.svgTint, true);
  assert.equal(Object.fromEntries(style.box)["background"], "#eeeeee");
  assert.equal(Object.fromEntries(style.img)["background-color"], "#ff8800");
  assert.equal(Object.fromEntries(style.img)["mask-mode"], "alpha");
  assert.equal(Object.fromEntries(style.img)["mask-image"], `url("${src}")`);
  const plain = { ...n };
  delete plain.svgColor;
  delete plain.svgColorToken;
  assert.equal(nodeStyle(plain, null).svgTint, false, "Old image nodes retain their img rendering");
});

test("SVG variable changes, rename, detach, reload and HTML export preserve the actual color and source", () => {
  const d = fixture(),
    n = d.pages[0].nodes[0];
  d.tokens.accent = "#00ff0080";
  syncTokenColors(d);
  assert.equal(n.svgColor, "#00ff0080");
  assert.equal(n.src, src);
  assert.equal(n.color, "#eeeeee");
  const html = exportHTML(JSON.parse(JSON.stringify(d)), "p");
  assert.match(html, /data-svg-color="true"/);
  assert.match(html, /mask-mode:alpha/);
  assert.match(html, /background-color:#00ff0080/);
  assert.match(html, /background:#eeeeee/);
  renameTokenRefs(d, "accent", "accent-new");
  d.tokens["accent-new"] = d.tokens.accent;
  delete d.tokens.accent;
  assert.equal(n.svgColorToken, "accent-new");
  unbindToken(d, "accent-new");
  delete d.tokens["accent-new"];
  assert.equal(n.svgColorToken, undefined);
  assert.equal(n.svgColor, "#00ff0080");
  assert.match(exportHTML(d, "p"), /background-color:#00ff0080/);
});

test("SVG color fields and binding survive a JSX round trip without modifying source", () => {
  const d = fixture(),
    page = d.pages[0];
  const code = elementCode(d, page, page.nodes[0]);
  assert.match(code, /data-svg-color="#000000"/);
  assert.match(code, /data-svg-color-token="accent"/);
  const out = buildNodes(parseJsx(code).elements, { document: d, page });
  const image = out.nodes.find((n) => n.type === "image");
  assert.equal(image.svgColor, "#000000");
  assert.equal(image.svgColorToken, "accent");
  assert.equal(image.src, src);
});

test("SVG color validation rejects unsupported source and malformed paint fields", () => {
  for (const patch of [
    { svgColor: "red;display:none" },
    { svgColor: 123 },
    { svgColorToken: 4 },
    { svgColorToken: "bad;name" },
    { svgColor: undefined },
    { src: "data:image/png;base64,AAAA" },
    { type: "rectangle" },
  ]) {
    const d = fixture();
    Object.assign(d.pages[0].nodes[0], patch);
    assert.throws(() => validateDocument(d), /SVG color/);
  }
});
