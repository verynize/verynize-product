// W/H sizing modes beyond Fixed / Hug / Fill (properties-audit B2): Relative (wPct / hPct), Auto (CSS auto) and
// Calculate (wCalc / hCalc, a calc() of px and % terms), plus the Block alignment of a block frame (C2,
// justifyItems). Each must validate, render (shared node-style), lay out headlessly and round-trip through the
// JSX and HTML codecs.
import test from "node:test";
import assert from "node:assert/strict";
import { validateDocument } from "./design-store.mjs";
import { getPage } from "./design-edit.mjs";
import { documentToJsx, jsxToDocument, documentToHtml, htmlToDocument } from "./codec-source.mjs";
import { parseCalc, calcCss, calcValue, nodeStyle, sizingError } from "./node-style.mjs";
import { layoutPage } from "./codec-layout.mjs";
import { exportHTML } from "./export-html.mjs";

const base = { color: "#dddddd", text: "", fontSize: 16, radius: 0 };
function sample() {
  return {
    version: 2,
    name: "Sizing",
    activePage: "p",
    tokens: {},
    pages: [
      {
        id: "p",
        name: "Page",
        nodes: [
          {
            ...base,
            id: "board",
            name: "Board",
            type: "frame",
            x: 0,
            y: 0,
            w: 400,
            h: 300,
            layout: "block",
            padding: 0,
            justifyItems: "center",
            parentId: null,
          },
          {
            ...base,
            id: "calc",
            name: "Calc",
            type: "rectangle",
            parentId: "board",
            x: 0,
            y: 0,
            w: 180,
            h: 40,
            wMode: "calc",
            wCalc: "50% - 20px",
          },
          {
            ...base,
            id: "pct",
            name: "Pct",
            type: "rectangle",
            parentId: "board",
            x: 0,
            y: 0,
            w: 100,
            h: 20,
            wPct: 25,
          },
          {
            ...base,
            id: "auto",
            name: "Auto",
            type: "text",
            parentId: "board",
            x: 0,
            y: 0,
            w: 40,
            h: 18,
            text: "Auto",
            wMode: "auto",
            hMode: "auto",
          },
          {
            ...base,
            id: "fill",
            name: "Fill",
            type: "frame",
            parentId: "board",
            x: 0,
            y: 0,
            w: 400,
            h: 10,
            layout: "block",
            padding: 0,
            wMode: "fill",
          },
          {
            ...base,
            id: "row",
            name: "Row",
            type: "frame",
            x: 0,
            y: 400,
            w: 300,
            h: 60,
            layout: "flex",
            direction: "row",
            gap: 0,
            padding: 0,
            parentId: null,
          },
          {
            ...base,
            id: "rcalc",
            name: "Row calc",
            type: "rectangle",
            parentId: "row",
            x: 0,
            y: 0,
            w: 100,
            h: 20,
            wMode: "calc",
            wCalc: "(50% + 10px) / 2",
            hMode: "calc",
            hCalc: "24px",
          },
        ],
      },
    ],
  };
}
const byName = (doc, name) => getPage(doc, doc.activePage).nodes.find((n) => n.name === name);
const css = (decls, prop) =>
  decls.box
    .filter(([p]) => p === prop)
    .map(([, v]) => v)
    .at(-1);

test("Calculate expressions: canonical CSS spacing, px/% terms only", () => {
  assert.deepEqual(parseCalc("100%-24px"), { pct: 100, px: -24, text: "100% - 24px" });
  assert.deepEqual(parseCalc("calc((50% + 8px) * 2)"), {
    pct: 100,
    px: 16,
    text: "(50% + 8px) * 2",
  });
  assert.equal(parseCalc("270PX").text, "270px");
  assert.equal(calcCss("-(10px)"), "calc(-1 * (10px))", "a negated group stays valid CSS");
  assert.equal(calcValue("50% - 20px", 400), 180);
  for (const bad of [
    "",
    "12",
    "10px + 2",
    "10px * 5px",
    "1px / 0",
    "100vw",
    "url(x)",
    "10px; color: red",
    "a".repeat(201),
  ])
    assert.equal(parseCalc(bad), null, `rejects ${JSON.stringify(bad)}`);
});

test("the validators accept the new modes and reject broken ones", () => {
  assert.doesNotThrow(() => validateDocument(sample()));
  const broken = (patch) => {
    const d = sample();
    Object.assign(d.pages[0].nodes[1], patch);
    return d;
  };
  assert.throws(() => validateDocument(broken({ wMode: "stretch" })), /sizing mode/);
  assert.throws(
    () => validateDocument(broken({ wCalc: undefined })),
    /size expression/,
    "Calculate needs an expression",
  );
  assert.throws(() => validateDocument(broken({ wCalc: "url(x)" })), /size expression/);
  assert.equal(sizingError({ type: "text", hMode: "auto" }), "");
});

test("node-style renders Relative, Auto, Calculate and Block alignment", () => {
  const doc = sample(),
    [board, calc, pct, auto, fill] = doc.pages[0].nodes;
  assert.equal(css(nodeStyle(calc, board, {}), "width"), "calc(50% - 20px)");
  assert.equal(css(nodeStyle(pct, board, {}), "width"), "25%");
  const autoCss = nodeStyle(auto, board, {});
  assert.deepEqual([css(autoCss, "width"), css(autoCss, "height")], ["auto", "auto"]);
  assert.equal(
    css(nodeStyle(board, null, {}), "justify-items"),
    "center",
    "Block alignment is justify-items on the block frame",
  );
  assert.equal(
    css(nodeStyle(fill, board, {}), "justify-self"),
    "stretch",
    "Fill keeps the full width under a Block alignment",
  );
  const row = doc.pages[0].nodes[5],
    rcalc = doc.pages[0].nodes[6];
  assert.deepEqual(
    [css(nodeStyle(rcalc, row, {}), "width"), css(nodeStyle(rcalc, row, {}), "height")],
    ["calc((50% + 10px) / 2)", "calc(24px)"],
  );
});

test("the headless layout resolves the new modes like CSS", () => {
  const doc = sample();
  layoutPage(getPage(doc, "p"));
  const at = (name) => {
    const n = byName(doc, name);
    return [n.x, n.w];
  };
  assert.deepEqual(at("Calc"), [110, 180], "calc(50% - 20px) of 400, centred");
  assert.deepEqual(at("Pct"), [150, 100], "25% of 400, centred");
  assert.deepEqual(at("Fill"), [0, 400], "Fill ignores the alignment");
  assert.ok(
    byName(doc, "Auto").w < 60 && byName(doc, "Auto").x > 150,
    "Auto text fits its content and centres",
  );
  assert.deepEqual([byName(doc, "Row calc").w, byName(doc, "Row calc").h], [80, 24]);
});

test("JSX and HTML round-trip the modes", () => {
  const doc = sample();
  const code = documentToJsx(doc, "p");
  for (const cls of [
    "w-[calc(50%_-_20px)]",
    "w-1/4",
    "w-auto",
    "h-auto",
    "justify-items-center",
    "w-full",
    "w-[calc((50%_+_10px)_/_2)]",
    "h-[calc(24px)]",
  ])
    assert.ok(code.includes(cls), `${cls} in\n${code}`);
  const check = (back, label) => {
    assert.deepEqual(
      [byName(back, "Calc").wMode, byName(back, "Calc").wCalc],
      ["calc", "50% - 20px"],
      label,
    );
    assert.deepEqual(
      [byName(back, "Pct").wMode ?? "fixed", byName(back, "Pct").wPct],
      ["fixed", 25],
      label,
    );
    assert.deepEqual(
      [byName(back, "Auto").wMode, byName(back, "Auto").hMode],
      ["auto", "auto"],
      label,
    );
    assert.equal(byName(back, "Fill").wMode, "fill", label);
    assert.equal(byName(back, "Board").justifyItems, "center", label);
    assert.deepEqual(
      [
        byName(back, "Row calc").wCalc,
        byName(back, "Row calc").hMode,
        byName(back, "Row calc").hCalc,
      ],
      ["(50% + 10px) / 2", "calc", "24px"],
      label,
    );
    assert.doesNotThrow(() => validateDocument(back));
  };
  const { document: fromJsx } = jsxToDocument(code);
  check(fromJsx, "JSX");
  assert.equal(
    documentToJsx(fromJsx, fromJsx.activePage).replace(/ data-node-id="[^"]*"/g, ""),
    code.replace(/ data-node-id="[^"]*"/g, ""),
    "JSX is a fixed point",
  );
});

test("HTML round-trips the modes", async () => {
  const { document: back } = await htmlToDocument(documentToHtml(sample(), "p"));
  assert.deepEqual(
    [byName(back, "Calc").wMode, byName(back, "Calc").wCalc],
    ["calc", "50% - 20px"],
  );
  assert.deepEqual(
    [byName(back, "Auto").wMode, byName(back, "Board").justifyItems],
    ["auto", "center"],
  );
});

test("HTML export writes the calc() widths", () => {
  const out = exportHTML(sample(), "p");
  const text = typeof out === "string" ? out : (out.html ?? JSON.stringify(out));
  assert.match(text, /width:\s*calc\(50% - 20px\)/);
  assert.match(text, /justify-items:\s*center/);
});
