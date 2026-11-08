import test from "node:test";
import assert from "node:assert/strict";
import { nodeStyle, styleText, lastInFlowId } from "./node-style.mjs";
import { exportHTML } from "./export-html.mjs";
import { createArtboards } from "./design-edit.mjs";

const decl = (list, key) => Object.fromEntries(list)[key];
const frame = (extra) => ({
  id: "f",
  type: "frame",
  name: "F",
  parentId: null,
  x: 0,
  y: 0,
  w: 300,
  h: 200,
  layout: "flex",
  direction: "row",
  padding: 8,
  gap: 4,
  color: "#ffffff",
  ...extra,
});

test("shared node style: per-side padding, gaps, per-corner radius, borders, ring", () => {
  const { box } = nodeStyle(
    frame({
      paddingTop: 12,
      paddingRight: 32,
      paddingBottom: 12,
      paddingLeft: 32,
      gapX: 32,
      gapY: 8,
      cornerRadii: [12, 12, 4, 4],
      strokeWidth: 1,
      strokeWidths: [2, 0, 0, 0],
      ringWidth: 1,
      ringColor: "#ff0000",
      shadow: "0 1px 2px #0000001a",
    }),
    null,
  );
  assert.equal(decl(box, "padding"), "12px 32px 12px 32px");
  assert.equal(decl(box, "column-gap"), "32px");
  assert.equal(decl(box, "row-gap"), "8px");
  assert.equal(decl(box, "border-radius"), "12px 12px 4px 4px");
  assert.equal(decl(box, "border-width"), "2px 0px 0px 0px");
  assert.equal(decl(box, "box-shadow"), "0 0 0 1px #ff0000, 0 1px 2px #0000001a");
  // Longhands come after the shorthand they refine.
  const keys = box.map(([k]) => k);
  assert.ok(keys.indexOf("border-width") > keys.indexOf("border"));
});

test("shared node style: block flow, margins, space-y, absolute insets, sizing", () => {
  const parent = frame({ layout: "block", gapY: 12, strokeWidth: 1 });
  assert.equal(decl(nodeStyle(parent, null).box, "display"), "flow-root");
  const child = {
    id: "c",
    type: "text",
    name: "T",
    parentId: "f",
    x: 0,
    y: 0,
    w: 100,
    h: 20,
    wMode: "fill",
    hMode: "hug",
    margin: ["auto", "auto", 0, "auto"],
    maxW: 640,
  };
  const s = nodeStyle(child, parent, { lastInFlow: false }).box;
  assert.equal(
    decl(s, "margin"),
    "auto auto 12px auto",
    "space-y adds the gap below non-last children",
  );
  assert.equal(decl(s, "width"), "auto");
  assert.equal(decl(s, "height"), "auto");
  assert.equal(decl(s, "max-width"), "640px");
  assert.equal(
    decl(
      nodeStyle({ ...child, margin: [0, 0, 20, 0] }, parent, { lastInFlow: false }).box,
      "margin",
    ),
    "0px 0px 20px 0px",
    "own bottom margin wins over space-y",
  );
  assert.equal(
    decl(nodeStyle(child, parent, { lastInFlow: true }).box, "margin"),
    "auto auto 0px auto",
  );
  const badge = {
    id: "b",
    type: "frame",
    layout: "block",
    name: "B",
    parentId: "f",
    x: 0,
    y: 0,
    w: 40,
    h: 20,
    position: "absolute",
    inset: [8, 8, null, null],
    translate: ["-50%", 0],
    wMode: "hug",
    hMode: "hug",
  };
  const b = nodeStyle(badge, frame()).box;
  assert.equal(decl(b, "position"), "absolute");
  assert.equal(decl(b, "top"), "8px");
  assert.equal(decl(b, "right"), "8px");
  assert.equal(decl(b, "left"), undefined);
  assert.equal(decl(b, "translate"), "-50% 0px");
  assert.equal(decl(b, "width"), "fit-content");
  assert.equal(
    lastInFlowId([
      { id: "a" },
      { id: "b" },
      { id: "c", position: "absolute" },
      { id: "d", hidden: true },
    ]),
    "b",
  );
});

test("shared node style sanitizes document values", () => {
  const { box } = nodeStyle(
    frame({
      gradient: "url(https://evil.test/x.png)",
      shadow: "0 0 0 red;position:fixed",
      fontFamily: "Inter</style>",
      color: "red}",
    }),
    null,
  );
  const text = styleText(box);
  assert.doesNotMatch(text, /url\(|position:fixed|<\/style|red\}/);
});

test("export-html renders through the shared style and matches nodeStyle exactly", () => {
  const { document, page } = createArtboards(
    {
      version: 2,
      name: "D",
      activePage: "p1",
      pages: [{ id: "p1", name: "P", nodes: [] }],
      tokens: {},
    },
    "p1",
    `<div data-component-x="0" data-component-y="0" className="relative flex flex-col gap-y-2 px-8 py-3 w-[320px] rounded-t-xl rounded-b-sm"><span className="absolute top-2 right-2 text-xs">New</span><p className="mx-auto max-w-[200px]">Hi</p><Icon name="lucide:x" className="size-5"/><img src="https://example.com/a.png" className="w-10 h-10"/></div>`,
  );
  const html = exportHTML(document, "p1");
  const root = page.nodes.find((n) => !n.parentId),
    byId = new Map(page.nodes.map((n) => [n.id, n]));
  const kids = page.nodes.filter((n) => n.parentId === root.id),
    last = lastInFlowId(kids);
  for (const n of page.nodes) {
    const parent = byId.get(n.parentId) || null;
    const expected = styleText(
      nodeStyle(n, parent, { color: n.color, lastInFlow: parent ? n.id === last : undefined }).box,
    )
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    assert.ok(html.includes(`style="${expected}"`), `export uses shared style for ${n.name}`);
  }
  assert.match(html, /padding:12px 32px 12px 32px/);
  assert.match(html, /border-radius:12px 12px 4px 4px/);
  assert.match(html, /top:8px;right:8px|right:8px/);
  assert.match(html, /<img src="data:image\/svg\+xml;base64,/);
  assert.match(html, /data-icon="lucide:x"/);
  assert.match(html, /<img src="https:\/\/example\.com\/a\.png"/);
});
