import test from "node:test";
import assert from "node:assert/strict";
import { lintArtboard, parseColor, contrastRatio, paddingOf } from "./design-lint.mjs";

// Legacy (pre-rewrite codec) node defaults; new-style tests override with newer fields.
const BASE = {
  parentId: null,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  color: "#d9d9d9",
  text: "",
  fontSize: 16,
  radius: 0,
  zIndex: 0,
  fontFamily: "system-ui",
  fontWeight: "400",
  textAlign: "left",
  layout: "free",
  direction: "row",
  gap: 0,
  padding: 0,
  columns: 2,
  token: "",
  gradient: "",
  textRuns: [],
  opacity: 100,
  strokeWidth: 0,
  strokeColor: "#000000",
  shadow: "",
  clipContent: false,
  lineHeight: 1.15,
  letterSpacing: 0,
  alignItems: "stretch",
  justifyContent: "flex-start",
};
const node = (id, props) => ({ ...BASE, id, shortId: id, ...props });
const art = (props = {}) =>
  node("art", { type: "frame", name: "Artboard", w: 400, h: 300, color: "#ffffff", ...props });
const text = (id, value, props = {}) =>
  node(id, {
    type: "text",
    parentId: "art",
    name: "Text",
    text: value,
    color: "#1a1a1a",
    w: 300,
    h: 19,
    ...props,
  });
const doc = (nodes, tokens = {}) => ({
  version: 2,
  name: "T",
  activePage: "p",
  pages: [{ id: "p", name: "P", nodes }],
  tokens,
});
const lint = (nodes, options, tokens) => lintArtboard(doc(nodes, tokens), "p", "art", options);
const rules = (result) => result.problems.map((p) => `${p.severity}:${p.rule}:${p.ref}`);
const find = (result, rule, ref) =>
  result.problems.find((p) => p.rule === rule && (!ref || p.ref === ref));

test("clean artboard has no problems", () => {
  const r = lint([
    art(),
    text("hed", "Ship design reviews faster", { fontSize: 24, w: 360, h: 28, x: 20, y: 20 }),
    text("bod", "Short readable body copy.", { x: 20, y: 60 }),
  ]);
  assert.deepEqual(r.problems, []);
  assert.equal(r.stats.geometry, "estimated");
  assert.match(r.summary, /no problems/);
});

test("resolves artboards by id or short id and throws on unknown ones", () => {
  const d = doc([art({ id: "uuid-1", shortId: "art" })]);
  assert.equal(lintArtboard(d, "p", "art").stats.nodes, 1);
  assert.equal(lintArtboard(d, "p", "uuid-1").stats.nodes, 1);
  assert.throws(() => lintArtboard(d, "p", "zzz"), /not found/);
});

test("structural: children outside clipping parents and the artboard", () => {
  const r = lint([
    art(),
    node("box", { type: "rectangle", parentId: "art", x: 350, y: 10, w: 100 }),
    node("frm", {
      type: "frame",
      parentId: "art",
      clipContent: true,
      x: 10,
      y: 150,
      w: 100,
      h: 100,
      color: "transparent",
    }),
    node("kid", { type: "rectangle", parentId: "frm", x: 60, y: 0, w: 80, h: 40 }),
  ]);
  const outside = find(r, "clipped", "art.box");
  assert.equal(outside.severity, "critical");
  assert.equal(outside.confidence, "stored");
  assert.equal(find(r, "clipped", "art.kid").severity, "critical");
});

test("structural: flow overflow is estimated (one level lower) and hug parents are skipped", () => {
  const row = (props) =>
    node("row", {
      type: "frame",
      parentId: "art",
      layout: "flex",
      direction: "row",
      w: 200,
      h: 50,
      color: "transparent",
      ...props,
    });
  const kids = ["aaa", "bbb", "ccc"].map((id) =>
    node(id, { type: "rectangle", parentId: "row", w: 80, h: 40 }),
  );
  const r = lint([art(), row({ gapX: 8, paddingLeft: 8 }), ...kids]);
  const p = find(r, "overflow", "art.ccc");
  assert.equal(p.severity, "minor");
  assert.equal(p.confidence, "estimated");
  assert.equal(
    find(lint([art(), row({ clipContent: true }), ...kids]), "clipped", "art.ccc").severity,
    "major",
  );
  assert.equal(find(lint([art(), row({ wMode: "hug" }), ...kids]), "overflow"), undefined);
});

test("structural: grid placement uses columns, gap and padding", () => {
  const r = lint([
    art(),
    node("grd", {
      type: "frame",
      parentId: "art",
      layout: "grid",
      columns: 2,
      gap: 20,
      padding: 20,
      w: 300,
      h: 100,
      color: "transparent",
    }),
    ...["aaa", "bbb", "ccc"].map((id) =>
      node(id, { type: "rectangle", parentId: "grd", w: 120, h: 40 }),
    ),
  ]);
  assert.equal(find(r, "overflow", "art.bbb"), undefined);
  assert.ok(find(r, "overflow", "art.ccc"), "third cell starts a second row past the 100px height");
});

test("structural: measured bounds detect overlap and text overflow (critical)", () => {
  const nodes = [
    art(),
    node("col", {
      type: "frame",
      parentId: "art",
      layout: "flex",
      direction: "column",
      w: 300,
      h: 200,
      color: "transparent",
    }),
    node("one", { type: "rectangle", parentId: "col", w: 300, h: 60 }),
    node("two", { type: "rectangle", parentId: "col", w: 300, h: 60 }),
    text("lbl", "Measured label", { parentId: "col" }),
  ];
  const bounds = new Map([
    ["art", { x: 0, y: 0, w: 400, h: 300 }],
    ["col", { x: 0, y: 0, w: 300, h: 200 }],
    ["one", { x: 0, y: 0, w: 300, h: 60 }],
    ["two", { x: 0, y: 40, w: 300, h: 60 }],
    ["lbl", { x: 0, y: 120, w: 300, h: 19, scrollHeight: 38 }],
  ]);
  const r = lint(nodes, { bounds });
  assert.equal(find(r, "sibling-overlap", "art.two").severity, "critical");
  assert.equal(find(r, "text-overflow", "art.lbl").severity, "critical");
  assert.equal(r.stats.geometry, "measured");
  // DOMRect-shaped plain object keyed by short ref also works.
  const r2 = lint(nodes, {
    bounds: {
      art: { left: 0, top: 0, width: 400, height: 300 },
      "art.one": { left: 0, top: 0, width: 300, height: 60 },
      "art.two": { left: 0, top: 30, width: 300, height: 60 },
    },
  });
  assert.equal(find(r2, "sibling-overlap", "art.two").severity, "critical");
});

test("structural: estimated text overflow, hug height and overlapping free text", () => {
  const long = "This sentence is much too long to fit in a tiny fixed box";
  assert.equal(
    find(lint([art(), text("txt", long, { w: 100, h: 20 })]), "text-overflow").severity,
    "major",
  );
  assert.equal(
    find(lint([art(), text("txt", long, { w: 100, h: 20, hMode: "hug" })]), "text-overflow"),
    undefined,
  );
  const r = lint([
    art(),
    text("one", "Revenue", { x: 10, y: 10, w: 100 }),
    text("two", "Growth", { x: 40, y: 15, w: 100 }),
  ]);
  assert.equal(find(r, "sibling-overlap", "art.two").severity, "major");
});

test("structural: collapsed frames, placeholders, missing assets and codec warnings", () => {
  const r = lint(
    [
      art(),
      node("emp", { type: "frame", parentId: "art", w: 200, h: 1, color: "transparent" }),
      text("lor", "Lorem ipsum dolor sit amet", { y: 10 }),
      text("btn", "Button", { y: 40 }),
      text("tdo", "TODO: pricing copy", { y: 70 }),
      text("nam", "Name", { y: 100 }),
      node("img", { type: "image", parentId: "art", x: 200, y: 150, w: 100, h: 100 }),
      node("ico", {
        type: "rectangle",
        parentId: "art",
        x: 10,
        y: 200,
        w: 24,
        h: 24,
        assetStatus: "missing",
      }),
    ],
    {
      warnings: [
        "Ignored classes on <div>: bg-brand",
        { message: "Unknown icon Rocket", nodeId: "art.ico" },
      ],
    },
  );
  for (const [rule, ref] of [
    ["collapsed", "art.emp"],
    ["placeholder-text", "art.lor"],
    ["placeholder-text", "art.btn"],
    ["placeholder-text", "art.tdo"],
    ["missing-image", "art.img"],
    ["missing-asset", "art.ico"],
  ])
    assert.equal(find(r, rule, ref)?.severity, "critical", `${rule} ${ref}`);
  assert.equal(find(r, "placeholder-text", "art.nam"), undefined);
  const warnings = r.problems.filter((p) => p.rule === "codec-warning");
  assert.equal(warnings.length, 2);
  assert.equal(warnings[1].ref, "art.ico");
});

test("colors: parsing and WCAG ratios", () => {
  assert.deepEqual(parseColor("#abc"), { r: 170, g: 187, b: 204, a: 1 });
  assert.equal(parseColor("#00000080").a.toFixed(2), "0.50");
  assert.deepEqual(parseColor("rgba(10, 20, 30, 0.5)"), { r: 10, g: 20, b: 30, a: 0.5 });
  assert.deepEqual(parseColor("hsl(0 100% 50%)"), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor("oklch(1 0 0)"), { r: 255, g: 255, b: 255, a: 1 });
  assert.equal(parseColor("blue-500"), null);
  assert.equal(contrastRatio(parseColor("#000"), parseColor("#fff")).toFixed(1), "21.0");
  assert.equal(contrastRatio(parseColor("#767676"), parseColor("#fff")).toFixed(2), "4.54");
});

test("contrast: thresholds for body and large text", () => {
  assert.equal(
    find(lint([art(), text("txt", "Pale", { color: "#aaaaaa" })]), "contrast").severity,
    "critical",
  );
  assert.equal(
    find(lint([art(), text("txt", "Grey", { color: "#888888" })]), "contrast").severity,
    "major",
  );
  assert.equal(
    find(lint([art(), text("txt", "Grey", { color: "#888888", fontSize: 24, h: 28 })]), "contrast"),
    undefined,
  );
  assert.equal(
    find(
      lint([
        art(),
        text("txt", "Grey", { color: "#888888", fontSize: 19, fontWeight: "700", h: 22 }),
      ]),
      "contrast",
    ),
    undefined,
  );
  assert.equal(
    find(lint([art(), text("txt", "Fine", { color: "#767676" })]), "contrast"),
    undefined,
  );
  assert.equal(
    find(lint([art(), text("txt", "Faint", { color: "rgba(0,0,0,0.3)" })]), "contrast").severity,
    "critical",
  );
});

test("contrast: composited, gradient, sibling, image, token and inherited backdrops", () => {
  const scrim = node("scr", {
    type: "frame",
    parentId: "art",
    w: 400,
    h: 100,
    color: "rgba(0,0,0,0.5)",
  });
  assert.equal(
    find(
      lint([art(), scrim, text("txt", "On scrim", { parentId: "scr", color: "#ffffff" })]),
      "contrast",
    ).severity,
    "major",
  );
  const grad = node("grd", {
    type: "frame",
    parentId: "art",
    w: 400,
    h: 100,
    color: "transparent",
    gradient: "linear-gradient(90deg, #000000, #ffffff)",
  });
  assert.equal(
    find(
      lint([art(), grad, text("txt", "On gradient", { parentId: "grd", color: "#ffffff" })]),
      "contrast",
    ).severity,
    "critical",
  );
  const under = node("bgr", {
    type: "rectangle",
    parentId: "art",
    x: 0,
    y: 0,
    w: 400,
    h: 100,
    color: "#111111",
  });
  assert.equal(
    find(
      lint([art(), under, text("txt", "On sibling", { x: 10, y: 10, color: "#ffffff" })]),
      "contrast",
    ),
    undefined,
  );
  assert.equal(
    find(
      lint([art(), text("txt", "Behind", { x: 10, y: 10, color: "#ffffff" }), under]),
      "contrast",
    ).severity,
    "critical",
    "a rectangle painted after the text is not its backdrop",
  );
  const photo = node("pho", {
    type: "image",
    parentId: "art",
    w: 400,
    h: 200,
    src: "data:image/png;base64,AA",
  });
  assert.equal(
    find(
      lint([art(), photo, text("txt", "On photo", { x: 10, y: 10, color: "#ffffff" })]),
      "contrast-unknown",
    ).severity,
    "minor",
  );
  assert.equal(
    find(
      lint(
        [
          art({ color: "#000000", token: "bg" }),
          text("txt", "Token ink", { color: "#000000", token: "ink" }),
        ],
        {},
        { bg: "#ffffff", ink: "#cccccc" },
      ),
      "contrast",
    ).severity,
    "critical",
  );
  // New style: dark card fill via `fill`, text color inherited from the card's textStyle.
  const card = node("crd", {
    type: "frame",
    parentId: "art",
    w: 300,
    h: 100,
    color: undefined,
    fill: "oklch(0.2 0.02 260)",
    textStyle: { color: "#ffffff", fontSize: 16 },
  });
  assert.equal(
    find(
      lint([art(), card, text("txt", "Inherited", { parentId: "crd", color: undefined })]),
      "contrast",
    ),
    undefined,
  );
  const textRun = text("txt", "Mixed runs", {
    textRuns: [{ start: 0, end: 5, bold: false, italic: false, color: "#eeeeee" }],
  });
  assert.equal(find(lint([art(), textRun]), "contrast").severity, "critical");
});

test("taste: small text, font families and font sizes", () => {
  const r = lint([
    art(),
    text("tny", "Fine print here", { fontSize: 10, h: 12 }),
    text("cap", "Caption text", { fontSize: 12, y: 20, h: 14 }),
  ]);
  assert.equal(find(r, "tiny-text", "art.tny").severity, "major");
  assert.equal(find(r, "small-text", "art.cap").severity, "minor");
  const fams = ["Inter", "Georgia", '"Space Mono", monospace', "Lobster"].map((f, i) =>
    text(`f${"abcd"[i]}a`, `Family ${i}`, { fontFamily: f, y: i * 20 }),
  );
  assert.equal(find(lint([art(), ...fams]), "font-families").severity, "major");
  assert.equal(find(lint([art(), ...fams.slice(0, 3)]), "font-families").severity, "minor");
  const many = [14, 15, 16, 18, 20, 24, 30, 36].map((s, i) =>
    text(`s${"abcdefgh"[i]}a`, `Size ${s}`, {
      fontSize: s,
      y: i * 36,
      h: 40,
      x: (i % 2) * 150,
      w: 140,
    }),
  );
  assert.equal(find(lint([art({ h: 400 }), ...many]), "font-sizes").severity, "major");
});

test("taste: card-in-card, harsh shadows and large radius", () => {
  const outer = node("out", {
    type: "frame",
    parentId: "art",
    w: 380,
    h: 280,
    radius: 16,
    color: "#f4f4f5",
    shadow: "0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)",
  });
  const inner = node("inn", {
    type: "frame",
    parentId: "out",
    x: 10,
    y: 10,
    w: 200,
    h: 120,
    radius: 12,
    color: "#ffffff",
    strokeWidth: 1,
  });
  const kids = [
    text("ona", "Plan", { parentId: "inn", w: 100 }),
    text("twa", "Details", { parentId: "inn", y: 30, w: 100 }),
  ];
  const r = lint([art(), outer, inner, ...kids]);
  assert.equal(find(r, "card-in-card", "art.inn").severity, "major");
  assert.equal(find(r, "harsh-shadow"), undefined, "tailwind shadow-lg is soft");
  const btn = node("btn", {
    type: "frame",
    parentId: "out",
    htmlTag: "button",
    x: 10,
    y: 200,
    w: 120,
    h: 40,
    radius: 8,
    color: "#2563eb",
  });
  assert.equal(
    find(
      lint([
        art(),
        outer,
        btn,
        text("lab", "Save", { parentId: "btn" }),
        text("lac", "now", { parentId: "btn" }),
      ]),
      "card-in-card",
    ),
    undefined,
  );
  assert.equal(
    find(
      lint([
        art(),
        node("hrd", {
          type: "frame",
          parentId: "art",
          w: 100,
          h: 100,
          shadow: "4px 4px 0 rgba(0,0,0,0.8)",
        }),
      ]),
      "harsh-shadow",
    ).severity,
    "major",
  );
  assert.ok(
    find(
      lint([
        art(),
        node("hrd", {
          type: "frame",
          parentId: "art",
          w: 100,
          h: 100,
          shadow: [{ x: 0, y: 6, blur: 4, color: "rgba(0,0,0,0.4)" }],
        }),
      ]),
      "harsh-shadow",
    ),
  );
  assert.equal(
    find(
      lint([
        art(),
        node("big", {
          type: "frame",
          parentId: "art",
          w: 360,
          h: 260,
          radius: 48,
          color: "#f4f4f5",
        }),
      ]),
      "large-radius",
    ).severity,
    "minor",
  );
  assert.equal(
    find(
      lint([
        art(),
        node("big", {
          type: "frame",
          parentId: "art",
          w: 360,
          h: 260,
          radius: [16, 16, 16, 64],
          color: "#f4f4f5",
        }),
      ]),
      "large-radius",
    ).severity,
    "minor",
  );
});

test("taste: repeated identical grids", () => {
  const grid = (id, y) => [
    node(id, {
      type: "frame",
      parentId: "art",
      layout: "grid",
      columns: 3,
      gap: 16,
      y,
      w: 400,
      h: 60,
      color: "transparent",
    }),
    ...[0, 1, 2].map((i) =>
      node(`${id}${"xyz"[i]}`, {
        type: "frame",
        parentId: id,
        w: 120,
        h: 50,
        color: "transparent",
      }),
    ),
  ];
  const r = lint([art(), ...grid("gra", 0), ...grid("grb", 100)]);
  assert.equal(find(r, "repeated-grid").severity, "minor");
  assert.equal(find(lint([art(), ...grid("gra", 0)]), "repeated-grid"), undefined);
  // Three sibling cards with mixed content (title, text, button) are one grid, not repeated grids.
  const card = (id) => [
    node(id, { type: "frame", parentId: "art", w: 120, h: 100, color: "#f4f4f5", radius: 12 }),
    text(`${id}t`, "Plan", { parentId: id, w: 100 }),
    text(`${id}p`, "For teams", { parentId: id, y: 30, w: 100 }),
    node(`${id}b`, { type: "frame", parentId: id, htmlTag: "button", y: 60, w: 80, h: 30 }),
  ];
  assert.equal(
    find(lint([art(), ...card("caa"), ...card("cab"), ...card("cac")]), "repeated-grid"),
    undefined,
  );
});

test("taste: accent overuse and multiple primary buttons", () => {
  const hero = node("her", { type: "frame", parentId: "art", w: 400, h: 200, color: "#2563eb" });
  const btn = (id, x) =>
    node(id, {
      type: "frame",
      parentId: "sec",
      htmlTag: "button",
      x,
      w: 100,
      h: 40,
      radius: 8,
      color: "#2563eb",
    });
  const sec = node("sec", {
    type: "frame",
    parentId: "art",
    y: 220,
    w: 400,
    h: 60,
    color: "transparent",
  });
  const r = lint([art(), hero, sec, btn("bta", 0), btn("btb", 120)]);
  assert.equal(find(r, "accent-overuse", "art.her").severity, "major");
  assert.equal(find(r, "multiple-primary").severity, "minor");
  assert.equal(find(lint([art(), sec, btn("bta", 0)]), "multiple-primary"), undefined);
  assert.equal(
    find(
      lint([
        art(),
        node("her", { type: "frame", parentId: "art", w: 400, h: 60, color: "#2563eb" }),
      ]),
      "accent-overuse",
    ),
    undefined,
  );
});

test("taste: off-scale spacing (legacy and per-side fields)", () => {
  assert.match(
    find(
      lint([
        art(),
        node("stk", {
          type: "frame",
          parentId: "art",
          layout: "flex",
          direction: "column",
          padding: 10,
          gap: 6,
          color: "transparent",
        }),
      ]),
      "off-scale-spacing",
    ).message,
    /10, 6/,
  );
  assert.match(
    find(
      lint([
        art(),
        node("stk", {
          type: "frame",
          parentId: "art",
          layout: "flex",
          padding: undefined,
          paddingTop: 16,
          paddingLeft: 18,
          gapY: 8,
          color: "transparent",
        }),
      ]),
      "off-scale-spacing",
    ).message,
    /18/,
  );
  assert.equal(
    find(
      lint([
        art(),
        node("stk", {
          type: "frame",
          parentId: "art",
          layout: "free",
          padding: 10,
          color: "transparent",
        }),
      ]),
      "off-scale-spacing",
    ),
    undefined,
    "legacy padding is inert in free layout",
  );
  assert.deepEqual(paddingOf({ layout: "flex", padding: [8, 16] }), [8, 16, 8, 16]);
  assert.deepEqual(paddingOf({ layout: "flex", padding: 4, paddingX: 12 }), [4, 12, 4, 12]);
});

test("taste: line length, centered paragraphs and emoji icons", () => {
  const words = "Design review keeps the work honest and the copy readable for everyone ".repeat(4);
  assert.equal(
    find(lint([art({ w: 1400, h: 400 }), text("wid", words, { w: 1300, h: 40 })]), "line-length")
      .severity,
    "minor",
  );
  assert.equal(
    find(
      lint([art({ h: 400 }), text("cen", words, { textAlign: "center", w: 300, h: 300 })]),
      "centered-paragraph",
    ).severity,
    "minor",
  );
  assert.equal(find(lint([art(), text("emo", "🚀", { w: 30 })]), "emoji-icon").severity, "major");
  assert.equal(find(lint([art(), text("emo", "⚡️ Fast builds")]), "emoji-icon").severity, "minor");
  assert.equal(find(lint([art(), text("num", "123")]), "emoji-icon"), undefined);
});

test("summary groups by severity with refs and fixes; hidden nodes are skipped", () => {
  const r = lint([
    art(),
    text("lor", "Lorem ipsum", { color: "#bbbbbb" }),
    text("hid", "TODO", { hidden: true, y: 40 }),
  ]);
  assert.deepEqual(
    rules(r).filter((x) => x.includes("hid")),
    [],
  );
  assert.match(r.summary, /^Lint art: 2 critical/);
  assert.match(r.summary, /CRITICAL\n- \[(placeholder-text|contrast)\] art\.lor: .* Fix: /);
  assert.equal(r.stats.critical, 2);
});

test("layout: fixed-height sections that fake spacing are flagged (major) with a hug + padding fix", () => {
  const art2 = art({ w: 800, h: 1200, layout: "block", hMode: "hug" });
  const section = (props) =>
    node("sec", {
      type: "frame",
      name: "Features",
      parentId: "art",
      layout: "block",
      w: 800,
      h: 600,
      hMode: "fixed",
      wMode: "fill",
      padding: 0,
      paddingTop: 32,
      paddingBottom: 32,
      color: "transparent",
      ...props,
    });
  const kids = [
    text("hed", "Everything your studio needs", {
      parentId: "sec",
      w: 736,
      h: 40,
      fontSize: 32,
      hMode: "hug",
    }),
    text("bod", "Shared libraries and review links.", {
      parentId: "sec",
      w: 736,
      h: 24,
      hMode: "hug",
    }),
  ];
  const r = lint([art2, section(), ...kids]);
  const p = find(r, "fixed-height-section", "art.sec");
  assert.equal(p.severity, "major");
  assert.match(p.message, /fixed 600px height/);
  assert.match(p.message, /empty space/);
  assert.match(p.fix, /Remove h-\[…\].*padding.*hug/);
  // Hugging sections, fixed heights that match content, fill/grow children and rows are fine.
  assert.equal(
    find(lint([art2, section({ hMode: "hug", h: 128 }), ...kids]), "fixed-height-section"),
    undefined,
  );
  assert.equal(find(lint([art2, section({ h: 132 }), ...kids]), "fixed-height-section"), undefined);
  assert.equal(
    find(
      lint([art2, section({ layout: "flex", direction: "row" }), ...kids]),
      "fixed-height-section",
    ),
    undefined,
  );
  assert.equal(
    find(lint([art2, section(), kids[0], { ...kids[1], grow: 1 }]), "fixed-height-section"),
    undefined,
  );
  assert.equal(
    find(lint([art2, section({ hMode: undefined }), ...kids]), "fixed-height-section"),
    undefined,
    "legacy nodes without hMode are not judged",
  );
  // Measured: content taller than the pinned height.
  const bounds = {
    art: { x: 0, y: 0, w: 800, h: 1200 },
    sec: { x: 0, y: 0, w: 800, h: 80 },
    hed: { x: 32, y: 32, w: 736, h: 80 },
    bod: { x: 32, y: 112, w: 736, h: 48 },
  };
  const tall = find(lint([art2, section({ h: 80 }), ...kids], { bounds }), "fixed-height-section");
  assert.match(tall.message, /too short/);
  assert.doesNotMatch(tall.message, /estimated/);
});
