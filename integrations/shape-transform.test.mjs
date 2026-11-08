// Ellipse shapes and flips: document fields (ellipse, flipX, flipY) through the Tailwind JSX codec,
// the shared node -> CSS mapping and the headless validator.
import test from "node:test";
import assert from "node:assert/strict";
import { parseClasses } from "./jsx-codec.mjs";
import { createArtboards, elementCode } from "./design-edit.mjs";
import { validateDocument } from "./design-store.mjs";
import { nodeStyle } from "./node-style.mjs";

const blank = () => ({
  version: 2,
  name: "Doc",
  activePage: "p1",
  pages: [{ id: "p1", name: "Page", nodes: [] }],
  tokens: {},
});
const css = (node, parent = null) => Object.fromEntries(nodeStyle(node, parent).box);

test("flip and ellipse classes parse to node fields", () => {
  assert.deepEqual(parseClasses("-scale-x-100").props, { flipX: true });
  assert.deepEqual(parseClasses("-scale-y-100").props, { flipY: true });
  assert.deepEqual(parseClasses("-scale-100").props, { flipX: true, flipY: true });
  assert.deepEqual(parseClasses("rounded-[50%]").props, { ellipse: true });
  const scaled = parseClasses("scale-50");
  assert.deepEqual(scaled.props, {});
  assert.match(scaled.warnings[0], /only flips/);
});

test("ellipse and flips round-trip through element code", () => {
  const src = `<div data-component-x="0" data-component-y="0" className="relative w-[300px] h-[200px] bg-[#ffffff]">
  <div className="absolute left-[10px] top-[10px] w-[120px] h-[80px] bg-[#ff0000] rounded-[50%] rotate-[30deg] -scale-x-100" />
  <div className="absolute left-[150px] top-[10px] w-[60px] h-[60px] bg-[#00ff00] -scale-y-100" />
</div>`;
  const { document, page, roots } = createArtboards(blank(), "p1", src);
  validateDocument(document);
  const [shape, other] = page.nodes.filter((n) => n.parentId === roots[0].id);
  assert.equal(shape.ellipse, true);
  assert.equal(shape.flipX, true);
  assert.equal(shape.flipY, undefined);
  assert.equal(shape.rotation, 30);
  assert.equal(other.flipY, true);
  assert.equal(other.ellipse, undefined);
  const code = elementCode(document, page, roots[0]);
  assert.match(code, /rounded-\[50%\]/);
  assert.match(code, /rotate-\[30deg\] -scale-x-100/);
  assert.match(code, /-scale-y-100/);
  const again = createArtboards(blank(), "p1", code);
  const [shape2, other2] = again.page.nodes.filter((n) => n.parentId === again.roots[0].id);
  assert.equal(shape2.ellipse, true);
  assert.equal(shape2.flipX, true);
  assert.equal(other2.flipY, true);
});

test("node style renders flips after rotation and ellipses as 50% radius", () => {
  const base = { id: "a", type: "rectangle", x: 0, y: 0, w: 100, h: 50, radius: 12 };
  assert.equal(css({ ...base, rotation: 45, flipX: true }).transform, "rotate(45deg) scale(-1, 1)");
  assert.equal(css({ ...base, flipY: true }).transform, "scale(1, -1)");
  assert.equal(css(base).transform, undefined);
  assert.equal(css({ ...base, ellipse: true, cornerRadii: [1, 2, 3, 4] })["border-radius"], "50%");
  assert.equal(css(base)["border-radius"], "12px");
});

test("validator rejects non-boolean shape flags", () => {
  for (const key of ["flipX", "flipY", "ellipse"]) {
    const d = blank();
    d.pages[0].nodes.push({
      id: "n",
      type: "rectangle",
      name: "R",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      [key]: "yes",
    });
    assert.throws(() => validateDocument(d), new RegExp(key));
    d.pages[0].nodes[0][key] = true;
    validateDocument(d);
  }
});
