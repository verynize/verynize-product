// Figma binary formats: kiwi schema/message codec, fig-kiwi archive (deflate and zstd), .fig zip with images,
// clipboard HTML, scene -> REST shape -> Verynize document conversion, fidelity of geometry/layout/effects/text,
// and .pen refusal. Fixtures are authored in tests/fixtures/figma-scene-fixture.mjs (no Figma file content).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const kiwi = require("../integrations/figma-kiwi.mjs");
const scene = require("../integrations/figma-scene.mjs");
const figma = require("../desktop/figma.cjs");
const fixture = import("./fixtures/figma-scene-fixture.mjs");
const store = import("../integrations/design-store.mjs");
const byName = (nodes, name) => {
  const n = nodes.find((x) => x.name === name);
  assert.ok(n, `missing layer ${name}`);
  return n;
};
const svgOf = (node) => Buffer.from(node.src.split(",")[1], "base64").toString("utf8");

test("kiwi schema and message codec round-trips every built-in type", async () => {
  const schema = {
    definitions: [
      {
        name: "Kind",
        kind: "ENUM",
        fields: [
          { name: "A", type: "uint", isArray: false, value: 3 },
          { name: "B", type: "uint", isArray: false, value: 9 },
        ],
      },
      {
        name: "Pair",
        kind: "STRUCT",
        fields: [
          { name: "x", type: "float", isArray: false, value: 1 },
          { name: "y", type: "int", isArray: false, value: 2 },
        ],
      },
      {
        name: "Message",
        kind: "MESSAGE",
        fields: [
          ["flag", "bool"],
          ["b", "byte"],
          ["i", "int"],
          ["u", "uint"],
          ["f", "float"],
          ["s", "string"],
          ["big", "int64"],
          ["ubig", "uint64"],
          ["kind", "Kind"],
          ["pair", "Pair"],
          ["list", "Pair", true],
          ["raw", "byte", true],
          ["nums", "float", true],
        ].map(([name, type, isArray], i) => ({ name, type, isArray: !!isArray, value: i + 1 })),
      },
    ],
  };
  const back = kiwi.decodeSchema(kiwi.encodeSchema(schema));
  assert.deepEqual(
    back.definitions.map((d) => [
      d.name,
      d.kind,
      d.fields.map((f) => [f.name, f.type, f.isArray, f.value]),
    ]),
    schema.definitions.map((d) => [
      d.name,
      d.kind,
      d.fields.map((f) => [f.name, f.type, f.isArray, f.value]),
    ]),
  );
  const value = {
    flag: true,
    b: 200,
    i: -123456,
    u: 4000000000,
    f: -1.5,
    s: "héllo ✓",
    big: -9007199254740993n,
    ubig: 18446744073709551615n,
    kind: "B",
    pair: { x: 0.25, y: -7 },
    list: [
      { x: 0, y: 0 },
      { x: 1e-30, y: 2147483647 },
    ],
    raw: new Uint8Array([0, 1, 255]),
    nums: [0, 3.14159, -0],
  };
  const decoded = kiwi.decodeMessage(back, kiwi.encodeMessage(back, value));
  assert.equal(decoded.flag, true);
  assert.equal(decoded.b, 200);
  assert.equal(decoded.i, -123456);
  assert.equal(decoded.u, 4000000000);
  assert.equal(decoded.f, -1.5);
  assert.equal(decoded.s, "héllo ✓");
  assert.equal(decoded.big, -9007199254740993n);
  assert.equal(decoded.ubig, 18446744073709551615n);
  assert.equal(decoded.kind, "B");
  assert.deepEqual(decoded.pair, { x: 0.25, y: -7 });
  assert.equal(decoded.list[1].y, 2147483647);
  assert.ok(Math.abs(decoded.list[1].x - 1e-30) < 1e-36);
  assert.deepEqual([...decoded.raw], [0, 1, 255]);
  assert.ok(Math.abs(decoded.nums[1] - 3.14159) < 1e-6);
  // Fields absent from a message stay absent; unknown field ids are rejected rather than misread.
  assert.deepEqual(kiwi.decodeMessage(back, kiwi.encodeMessage(back, { s: "only" })), {
    s: "only",
  });
  assert.throws(() => kiwi.decodeMessage(back, new Uint8Array([99, 0])), /unknown field/);
  assert.throws(() => kiwi.decodeMessage(back, new Uint8Array([6, 104, 105])), /ends unexpectedly/);
});

test("fig-kiwi archives decode with deflate and zstd chunks; clipboard HTML carries metadata and scene", async () => {
  const { schema, buildScene, clipboardHtml } = await fixture;
  for (const compression of ["deflate", "zstd", "none"]) {
    const bytes = kiwi.encodeScene(schema, buildScene(), { compression });
    assert.equal(Buffer.from(bytes.subarray(0, 8)).toString(), "fig-kiwi");
    const { message } = kiwi.decodeScene(bytes);
    assert.equal(message.type, "NODE_CHANGES");
    assert.equal(message.nodeChanges.length, buildScene().nodeChanges.length);
    assert.equal(message.blobs.length, 3);
    assert.equal(
      message.nodeChanges.find((n) => n.name === "Title").textData.characters,
      "Hello Figma",
    );
  }
  const html = clipboardHtml();
  const parsed = kiwi.parseClipboardHtml(html);
  assert.deepEqual(parsed.meta, { fileKey: "FixtureKey123", pasteID: 42, dataType: "scene" });
  assert.ok(kiwi.isFigmaClipboard(html));
  assert.equal(kiwi.parseClipboardHtml("<p>(figmeta)e30=(/figmeta)</p>"), null);
  assert.equal(kiwi.isFigmaClipboard("<b>plain</b>"), false);
  assert.throws(
    () => kiwi.readArchive(new TextEncoder().encode("not-a-figma-archive")),
    /Not a Figma scene archive/,
  );
  const truncated = kiwi.encodeScene(schema, buildScene()).slice(0, 40);
  assert.throws(() => kiwi.decodeScene(truncated), /truncated|no scene data/);
});

test("path blobs decode to SVG path data", () => {
  const d = "M0 0L10 0Q15 5 10 10C5 15 0 10 0 5Z";
  assert.equal(scene.pathFromCommands(scene.commandsFromPath(d)), d);
  assert.throws(() => scene.pathFromCommands(new Uint8Array([7, 0, 0])), /Invalid Figma path/);
  assert.equal(scene.weightOf("Semi Bold Italic"), 600);
  assert.equal(scene.weightOf("ExtraBold"), 800);
  assert.equal(scene.weightOf("Black"), 900);
  assert.equal(scene.weightOf("Regular"), 400);
});

test("clipboard paste converts the scene into valid, faithful Verynize layers", async () => {
  const { clipboardHtml } = await fixture;
  const { validateDocument } = await store;
  for (const compression of ["deflate", "zstd"]) {
    const result = figma.convertFigmaClipboard(clipboardHtml({ compression }));
    assert.equal(result.format, "verynize/nodes");
    const nodes = result.nodes;
    // Internal component page, removed and hidden layers, and boolean operands are not emitted.
    assert.deepEqual(
      nodes.map((n) => n.name),
      [
        "Card",
        "Title",
        "Triangle",
        "Union",
        "Row",
        "Grow",
        "Pinned",
        "Buy button (Button)",
        "Label",
        "Badge",
        "Rotated",
        "Dot",
        "Photo",
        "Glass",
        "Curve",
      ],
    );
    assert.deepEqual(result.roots, [byName(nodes, "Card").id]);
    validateDocument({
      version: 2,
      name: "Paste",
      pages: [{ id: "p", name: "P", nodes }],
      tokens: {},
    });
    const card = byName(nodes, "Card");
    assert.deepEqual(
      [card.type, card.x, card.y, card.w, card.h, card.clipContent],
      ["frame", 0, 0, 400, 300, true],
    );
    assert.equal(card.gradient, "linear-gradient(90deg,rgba(255,0,0,1) 0%,rgba(0,0,255,1) 100%)");
    assert.deepEqual(card.cornerRadii, [16, 16, 0, 0]);
    assert.deepEqual([card.strokeWidths, card.strokeColor], [[0, 0, 2, 0], "#ff0000"]);
    assert.deepEqual(card.shadows, [
      { type: "box", x: 0, y: 4, blur: 12, spread: 2, color: "#00000040" },
      { type: "box", x: 0, y: 1, blur: 0, spread: 0, color: "#ffffff80", inset: true },
    ]);
    const title = byName(nodes, "Title");
    assert.deepEqual(
      [
        title.text,
        title.fontFamily,
        title.fontWeight,
        title.fontSize,
        title.textAlign,
        title.lineHeight,
        title.letterSpacing,
        title.textTransform,
        title.textDecoration,
        title.color,
      ],
      [
        "Hello Figma",
        "Inter",
        "700",
        24,
        "center",
        1.333,
        -0.48,
        "uppercase",
        "underline",
        "rgba(26,26,26,1)",
      ],
    );
    assert.deepEqual(title.textRuns, [
      { start: 6, end: 11, bold: false, italic: true, color: "#ff0000", fontSize: 24 },
    ]);
    const triangle = byName(nodes, "Triangle");
    assert.deepEqual(
      [triangle.type, triangle.x, triangle.y, triangle.w, triangle.h],
      ["image", 300, 24, 40, 40],
    );
    assert.match(
      svgOf(triangle),
      /<path d="M20 0L40 40L0 40Z" fill-rule="nonzero" fill="#00cc33" fill-opacity="1"\/>/,
    );
    assert.deepEqual(triangle.shadows, [
      { type: "drop", x: 1, y: 2, blur: 3, spread: 0, color: "#00000080" },
    ]);
    const union = byName(nodes, "Union");
    assert.match(svgOf(union), /fill-rule="evenodd"/);
    assert.equal(
      nodes.some((n) => n.name === "Operand"),
      false,
    );
    const row = byName(nodes, "Row");
    assert.deepEqual(
      [
        row.layout,
        row.direction,
        row.gap,
        row.gapX,
        row.gapY,
        row.flexWrap,
        row.justifyContent,
        row.alignItems,
        row.hMode,
        row.wMode,
        row.clipContent,
      ],
      ["flex", "row", 8, 8, 4, true, "center", "flex-end", "hug", undefined, undefined],
    );
    assert.deepEqual(
      [row.paddingTop, row.paddingRight, row.paddingBottom, row.paddingLeft],
      [12, 20, 12, 16],
    );
    const grow = byName(nodes, "Grow");
    assert.deepEqual([grow.wMode, grow.hMode, grow.parentId], ["fill", "fill", row.id]);
    const pinned = byName(nodes, "Pinned");
    assert.deepEqual([pinned.position, pinned.inset], ["absolute", [10, 10, null, null]]);
    const button = byName(nodes, "Buy button (Button)");
    assert.deepEqual(
      [
        button.type,
        button.layout,
        button.color,
        button.radius,
        button.justifyContent,
        button.alignItems,
        button.wMode,
        button.hMode,
        button.padding,
        button.paddingTop,
      ],
      ["frame", "flex", "rgba(51,102,255,1)", 8, "center", "center", "hug", "hug", 12, 8],
    );
    const label = byName(nodes, "Label");
    assert.deepEqual(
      [label.text, label.parentId, label.fontWeight, label.wMode],
      ["Checkout", button.id, "600", "hug"],
    );
    const badge = byName(nodes, "Badge");
    assert.deepEqual(badge.inset, [null, 10, 8, null]); // inside the 2px bottom border
    const rotated = byName(nodes, "Rotated");
    assert.deepEqual(
      [
        rotated.x,
        rotated.y,
        rotated.w,
        rotated.h,
        rotated.rotation,
        rotated.opacity,
        rotated.blendMode,
      ],
      [210, 210, 40, 20, 90, 50, "multiply"],
    );
    const dot = byName(nodes, "Dot");
    assert.equal(dot.ellipse, true);
    assert.equal(
      dot.gradient,
      "radial-gradient(20px 20px at 50% 50%,rgba(255,255,255,1) 0%,rgba(0,0,0,1) 100%)",
    );
    const glass = byName(nodes, "Glass");
    assert.deepEqual(glass.fills, [
      {
        type: "conic",
        angle: 90,
        stops: [
          { position: 0, color: "#ff0000" },
          { position: 100, color: "#00ff00" },
        ],
        opacity: 50,
      },
      { type: "solid", color: "#ffffff33", opacity: 100 },
    ]);
    assert.deepEqual(
      [glass.outlineWidth, glass.outlineColor, glass.outlineStyle, glass.outlineOffset],
      [1, "#ffffff99", "dashed", 0],
    );
    assert.deepEqual(glass.filters, [
      { type: "blur", value: 10, backdrop: true },
      { type: "blur", value: 2 },
    ]);
    const curve = byName(nodes, "Curve");
    assert.deepEqual([curve.y, curve.h], [140, 10]);
    assert.match(svgOf(curve), /viewBox="0 -10 40 10"/);
    // Clipboard data carries image references only: reported, never silently dropped.
    assert.equal(byName(nodes, "Photo").type, "rectangle");
    assert.ok(result.warnings.some((w) => /image fill not included/.test(w)));
    assert.ok(
      result.warnings.includes("Buy button: Component instance flattened into editable layers"),
    );
    assert.ok(result.warnings.includes("Title: Per-range lighter fontWeight not imported"));
  }
  assert.throws(() => figma.convertFigmaClipboard("<p>hello</p>"), /does not contain Figma layers/);
  assert.throws(
    () => figma.convertFigmaClipboard("<span>(figma)AAAA(/figma)</span>"),
    /Unable to read Figma clipboard data/,
  );
});

test(".fig file import reads the zip container, embeds images and names the document", async () => {
  const { figFile, schema, buildScene } = await fixture;
  const { validateDocument } = await store;
  const { bytes, png } = figFile();
  const result = figma.convertFigFile(bytes);
  validateDocument(result.document);
  assert.equal(result.document.name, "Fixture design");
  assert.deepEqual(
    result.document.pages.map((p) => p.name),
    ["Page 1"],
  );
  const photo = byName(result.document.pages[0].nodes, "Photo");
  assert.deepEqual(
    [photo.type, photo.objectFit, photo.src],
    ["image", "contain", "data:image/png;base64," + Buffer.from(png).toString("base64")],
  );
  assert.equal(
    result.warnings.some((w) => /image fill/i.test(w)),
    false,
  );
  // A bare fig-kiwi canvas (older files) imports too.
  assert.equal(
    figma.convertFigFile(kiwi.encodeScene(schema, buildScene())).document.pages[0].nodes.length,
    15,
  );
  assert.throws(() => figma.convertFigFile(kiwi.writeZip([["meta.json", "{}"]])), /no canvas.fig/);
  assert.throws(() => figma.convertFigFile(new Uint8Array([1, 2, 3])), /Unable to read .fig file/);
  assert.throws(() => figma.convertFigFile(new Uint8Array()), /empty/);
});

test("IPC handlers: clipboard, .fig bytes and .pen refusal", async () => {
  const { clipboardHtml, figFile } = await fixture;
  const handlers = {};
  figma.registerFigma(
    (name, fn) => {
      handlers[name] = fn;
    },
    null,
    { dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } },
  );
  assert.deepEqual(Object.keys(handlers).sort(), [
    "figmaClipboard",
    "figmaFile",
    "figmaFileOpen",
    "importFigma",
  ]);
  assert.equal((await handlers.figmaClipboard(clipboardHtml())).nodes[0].name, "Card");
  assert.equal(
    (await handlers.figmaFile({ bytes: figFile().bytes, name: "Landing.fig" })).document.name,
    "Landing",
  );
  await assert.rejects(
    async () => handlers.figmaFile({ bytes: new Uint8Array([1]), name: "Design.pen" }),
    /Unsupported Pen signature; encrypted\/binary files are not decoded/,
  );
  assert.equal(await handlers.figmaFileOpen(), null);
  await assert.rejects(
    async () => handlers.importFigma({ url: "https://figma.com/design/ABC", useAccount: true }),
    /Connect your Figma account/,
  );
});

test("REST geometry=paths: vectors, constraints, rotation, per-side padding and gradient handle geometry", async () => {
  const { validateDocument } = await store;
  const frame = {
    id: "1:1",
    type: "FRAME",
    name: "Frame",
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
    size: { x: 200, y: 100 },
    relativeTransform: [
      [1, 0, 0],
      [0, 1, 0],
    ],
    clipsContent: true,
    fills: [
      {
        type: "GRADIENT_LINEAR",
        gradientHandlePositions: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        gradientStops: [
          { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
        ],
      },
    ],
    strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }],
    strokeWeight: 4,
    strokeAlign: "CENTER",
    children: [
      {
        id: "1:2",
        type: "STAR",
        name: "Star",
        absoluteBoundingBox: { x: 10, y: 10, width: 20, height: 20 },
        size: { x: 20, y: 20 },
        relativeTransform: [
          [1, 0, 10],
          [0, 1, 10],
        ],
        fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 0.5 }],
        strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
        strokeWeight: 2,
        fillGeometry: [{ path: "M10 0L20 20L0 20Z", windingRule: "NONZERO" }],
        strokeGeometry: [{ path: "M10 -1L21 21L-1 21Z", windingRule: "NONZERO" }],
      },
      {
        id: "1:3",
        type: "RECTANGLE",
        name: "Centered",
        absoluteBoundingBox: { x: 90, y: 40, width: 20, height: 20 },
        fills: [{ type: "SOLID", color: { r: 0, g: 1, b: 0, a: 1 } }],
        constraints: { horizontal: "CENTER", vertical: "SCALE" },
      },
      {
        id: "1:4",
        type: "RECTANGLE",
        name: "Stretch",
        absoluteBoundingBox: { x: 10, y: 80, width: 180, height: 10 },
        fills: [],
        constraints: { horizontal: "LEFT_RIGHT", vertical: "BOTTOM" },
        effects: [{ type: "LAYER_BLUR", visible: true, radius: 8 }],
      },
      {
        id: "1:5",
        type: "RECTANGLE",
        name: "Flipped",
        absoluteBoundingBox: { x: 150, y: 10, width: 30, height: 20 },
        size: { x: 30, y: 20 },
        relativeTransform: [
          [-1, 0, 180],
          [0, 1, 10],
        ],
        fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
      },
    ],
  };
  const result = figma.convertFigma({ name: "REST", document: frame });
  validateDocument(result.document);
  const [f, star, centered, stretch, flipped] = result.document.pages[0].nodes;
  // Diagonal handles on a 2:1 box: the CSS angle follows pixel space, stops re-projected onto the CSS line.
  assert.match(
    f.gradient,
    /^linear-gradient\(116\.57deg,rgba\(0,0,0,1\) 0%,rgba\(255,255,255,1\) 100%\)$/,
  );
  assert.deepEqual([f.outlineWidth, f.outlineOffset, f.outlineColor], [4, -2, "#0000ff"]);
  assert.equal(star.type, "image");
  const svg = svgOf(star);
  assert.match(svg, /fill="#ff0000" fill-opacity="0.5"/);
  assert.match(svg, /<path d="M10 -1L21 21L-1 21Z" fill-rule="nonzero" fill="#000000"/);
  assert.match(svg, /viewBox="-1 -1 22 22"/);
  assert.deepEqual([star.x, star.y, star.w, star.h], [9, 9, 22, 22]);
  assert.deepEqual(
    [centered.inset, centered.translate, centered.hPct],
    [["40%", null, null, "50%"], ["-50%", null], 20],
  );
  assert.deepEqual(
    [stretch.inset, stretch.wMode, stretch.filters],
    [[null, 10, 10, 10], "fill", [{ type: "blur", value: 4 }]],
  );
  assert.deepEqual(
    [flipped.x, flipped.y, flipped.flipX, flipped.rotation],
    [150, 10, true, undefined],
  );
});
