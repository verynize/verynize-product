// Typography fields from the inspector's Type settings (design/wonder/properties-audit A10): vertical alignment,
// line height "auto", white space, word break, indent, smoothing (plus the existing case, wrap, truncation and
// decoration). Checks the shared validator, the canvas/export CSS, that absent fields leave older documents
// untouched, and that every field round-trips through JSX/Tailwind and the HTML export.
import test from "node:test";
import assert from "node:assert/strict";
import { nodeStyle, typographyError } from "./node-style.mjs";
import { validateDocument } from "./design-store.mjs";
import { exportHTML } from "./export-html.mjs";
import { parseClasses } from "./jsx-codec.mjs";
import { documentToJsx, jsxToDocument } from "./codec-source.mjs";

const decls = (node) => Object.fromEntries(nodeStyle(node, null).box);
const text = (extra = {}) => ({
  id: "t",
  type: "text",
  name: "T",
  parentId: null,
  x: 0,
  y: 0,
  w: 200,
  h: 80,
  text: "Hello world",
  color: "#111111",
  fontSize: 16,
  ...extra,
});
const doc = (...nodes) => ({
  version: 2,
  name: "Type",
  activePage: "p",
  tokens: {},
  pages: [{ id: "p", name: "Page", nodes }],
});

const SETTINGS = {
  lineHeight: "auto",
  textAlignVertical: "center",
  whiteSpace: "pre-line",
  wordBreak: "break-all",
  textIndent: -6,
  fontSmoothing: "antialiased",
  textTransform: "uppercase",
  textDecoration: "line-through",
  textWrap: "balance",
  truncate: true,
};

test("type settings: the shared validator accepts the options and rejects anything else", () => {
  assert.equal(typographyError(text(SETTINGS)), "");
  assert.equal(
    typographyError(
      text({
        lineHeight: 1.4,
        textAlignVertical: "bottom",
        wordBreak: "normal",
        fontSmoothing: "subpixel-antialiased",
      }),
    ),
    "",
  );
  for (const bad of [
    { lineHeight: "normal" },
    { lineHeight: Infinity },
    { textAlignVertical: "middle" },
    { whiteSpace: "pre-wrap " },
    { wordBreak: "word" },
    { textIndent: "4px" },
    { textIndent: 20000 },
    { fontSmoothing: "grayscale" },
  ])
    assert.notEqual(typographyError(text(bad)), "", JSON.stringify(bad));
  assert.doesNotThrow(() => validateDocument(doc(text(SETTINGS))));
  assert.throws(
    () => validateDocument(doc(text({ textAlignVertical: "middle" }))),
    /vertical text alignment/,
  );
  assert.throws(() => validateDocument(doc(text({ lineHeight: "tall" }))), /line height/);
});

test("type settings: canvas CSS for every option; absent fields keep the old declarations", () => {
  const before = nodeStyle(text({ lineHeight: 1.15 }), null).box;
  // A node without the new fields renders exactly the base text CSS (older documents are unchanged).
  assert.equal(decls(text({ lineHeight: 1.15 }))["line-height"], "1.15");
  assert.equal(decls(text())["white-space"], "pre-wrap");
  assert.equal(decls(text())["overflow-wrap"], "anywhere");
  for (const key of [
    "align-content",
    "text-indent",
    "word-break",
    "-webkit-font-smoothing",
    "-moz-osx-font-smoothing",
  ])
    assert.equal(decls(text())[key], undefined, key);
  assert.deepEqual(
    nodeStyle(text({ lineHeight: 1.15, textAlignVertical: undefined, wordBreak: undefined }), null)
      .box,
    before,
  );

  const d = decls(text({ ...SETTINGS, truncate: false }));
  assert.equal(d["line-height"], "normal");
  assert.equal(d["align-content"], "center");
  assert.equal(d["white-space"], "pre-line");
  assert.equal(d["word-break"], "break-all");
  assert.equal(d["text-indent"], "-6px");
  assert.equal(d["-webkit-font-smoothing"], "antialiased");
  assert.equal(d["-moz-osx-font-smoothing"], "grayscale");
  assert.equal(d["text-transform"], "uppercase");
  assert.equal(d["text-decoration-line"], "line-through");
  assert.equal(d["text-wrap"], "balance");
  assert.equal(decls(text({ textAlignVertical: "bottom" }))["align-content"], "flex-end");
  assert.equal(decls(text({ wordBreak: "normal" }))["overflow-wrap"], "normal");
  assert.equal(
    decls(text({ fontSmoothing: "subpixel-antialiased" }))["-webkit-font-smoothing"],
    "auto",
  );
  // Truncation wins over the white-space option (one line with an ellipsis); white-space comes before text-wrap.
  const t = decls(text(SETTINGS));
  assert.equal(t["white-space"], "nowrap");
  assert.equal(t["text-overflow"], "ellipsis");
  const keys = nodeStyle(text({ whiteSpace: "normal", textWrap: "pretty" }), null).box.map(
    ([k]) => k,
  );
  assert.ok(keys.lastIndexOf("white-space") < keys.indexOf("text-wrap"));
  // An explicit white-space beats the legacy noWrap flag.
  assert.equal(decls(text({ noWrap: true, whiteSpace: "normal" }))["white-space"], "normal");
  assert.equal(decls(text({ noWrap: true }))["white-space"], "pre");
});

test("type settings: HTML export carries the CSS", () => {
  const html = exportHTML(doc(text({ ...SETTINGS, truncate: false })), "p");
  for (const css of [
    "line-height:normal",
    "align-content:center",
    "white-space:pre-line",
    "word-break:break-all",
    "text-indent:-6px",
    "-webkit-font-smoothing:antialiased",
  ])
    assert.ok(html.includes(css), css);
});

test("type settings: Tailwind classes map to the fields", () => {
  const props = (cls) => parseClasses(cls).props;
  assert.equal(props("leading-[normal]").lineHeight, "auto");
  assert.equal(props("content-center").textAlignVertical, "center");
  assert.equal(props("content-end").textAlignVertical, "bottom");
  assert.equal(props("content-start").textAlignVertical, "top");
  assert.equal(props("whitespace-pre-line").whiteSpace, "pre-line");
  assert.equal(props("whitespace-pre-wrap").whiteSpace, "", "pre-wrap is the canvas default");
  assert.equal(props("whitespace-nowrap").noWrap, true);
  assert.equal(props("break-all").wordBreak, "break-all");
  assert.equal(props("break-normal").wordBreak, "normal");
  assert.equal(props("break-words").wordBreak, "", "wrapping long words is the canvas default");
  assert.equal(props("indent-4").textIndent, 16);
  assert.equal(props("-indent-[6px]").textIndent, -6);
  assert.equal(props("antialiased").fontSmoothing, "antialiased");
  assert.equal(props("subpixel-antialiased").fontSmoothing, "subpixel-antialiased");
  assert.equal(props("text-nowrap").textWrap, "nowrap");
});

test("type settings: document -> JSX -> document keeps every field, and defaults add no classes", () => {
  const frame = {
    id: "f",
    type: "frame",
    name: "Board",
    parentId: null,
    x: 0,
    y: 0,
    w: 600,
    h: 400,
    layout: "free",
    color: "#ffffff",
  };
  const nodes = [
    frame,
    text({ id: "a", name: "A", parentId: "f", ...SETTINGS, truncate: false, textWrap: "pretty" }),
    text({
      id: "b",
      name: "B",
      parentId: "f",
      y: 100,
      textAlignVertical: "bottom",
      whiteSpace: "normal",
      wordBreak: "normal",
      textIndent: 16,
      fontSmoothing: "subpixel-antialiased",
      lineHeight: 1.4,
    }),
    text({ id: "d", name: "D", parentId: "f", y: 300, truncate: true, lineHeight: 1.15 }),
    text({ id: "c", name: "C", parentId: "f", y: 200, lineHeight: 1.15 }),
  ];
  const jsx = documentToJsx(doc(...nodes), "p");
  assert.match(jsx, /leading-\[normal\]/);
  assert.match(jsx, /content-center/);
  assert.match(jsx, /content-end/);
  const plain = jsx.split("\n").find((line) => line.includes('data-node-label="C"'));
  for (const cls of [
    "content-",
    "whitespace-",
    "break-",
    "indent-",
    "antialiased",
    "leading-[normal]",
  ])
    assert.ok(!plain.includes(cls), `${cls} in ${plain}`);
  const back = jsxToDocument(jsx).document.pages[0].nodes;
  const by = (name) => back.find((n) => n.name === name);
  const pick = (n) =>
    Object.fromEntries(
      [
        "lineHeight",
        "textAlignVertical",
        "whiteSpace",
        "wordBreak",
        "textIndent",
        "fontSmoothing",
        "textTransform",
        "textDecoration",
        "textWrap",
        "truncate",
      ].map((k) => [k, n[k] || undefined]),
    );
  assert.deepEqual(pick(by("A")), pick(nodes[1]));
  assert.deepEqual(pick(by("B")), pick(nodes[2]));
  assert.deepEqual(pick(by("D")), pick(nodes[3]));
  for (const key of ["textAlignVertical", "whiteSpace", "wordBreak", "textIndent", "fontSmoothing"])
    assert.equal(by("C")[key], undefined, key);
  assert.equal(by("C").lineHeight, 1.15);
});
