const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseFigmaURL, convertFigma, importFigma } = require("../desktop/figma.cjs");
const solid = { type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } };
const frame = {
  id: "1:2",
  type: "FRAME",
  name: "Card",
  absoluteBoundingBox: { x: 200, y: 300, width: 400, height: 200 },
  layoutMode: "VERTICAL",
  paddingLeft: 20,
  paddingRight: 20,
  paddingTop: 20,
  paddingBottom: 20,
  itemSpacing: 12,
  fills: [solid],
  children: [
    {
      id: "1:3",
      type: "TEXT",
      name: "Title",
      absoluteBoundingBox: { x: 220, y: 320, width: 360, height: 50 },
      characters: "Hello world",
      style: { fontFamily: "Inter", fontSize: 24, fontWeight: 400, textAlignHorizontal: "LEFT" },
      characterStyleOverrides: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
      styleOverrideTable: { 1: { fontWeight: 700, italic: true, fills: [solid] } },
      fills: [solid],
    },
  ],
};
test("strict Figma URL parsing", () => {
  assert.deepEqual(parseFigmaURL("https://www.figma.com/design/ABC123/Card?node-id=1-2"), {
    fileKey: "ABC123",
    nodeId: "1:2",
  });
  assert.equal(parseFigmaURL("https://figma.com/file/ABC123?node-id=1%3A2").nodeId, "1:2");
  assert.throws(() => parseFigmaURL("https://figma.com.evil.test/design/ABC"));
  assert.throws(() => parseFigmaURL("http://figma.com/design/ABC"));
  assert.throws(() => parseFigmaURL("https://name:secret@figma.com/file/ABC"));
});
test("converts hierarchy, relative coordinates, auto layout and mixed text", () => {
  const result = convertFigma(
    { name: "Fixture", nodes: { "1:2": { document: frame } } },
    { nodeId: "1:2" },
  );
  const [parent, child] = result.document.pages[0].nodes;
  assert.equal(result.document.version, 2);
  assert.equal(parent.x, 0);
  assert.equal(parent.y, 0);
  assert.equal(parent.layout, "flex");
  assert.equal(parent.direction, "column");
  assert.equal(parent.padding, 20);
  assert.equal(child.parentId, parent.id);
  assert.equal(child.x, 20);
  assert.equal(child.y, 20);
  assert.equal(child.text, "Hello world");
  assert.deepEqual(child.textRuns[0], {
    start: 6,
    end: 11,
    bold: true,
    italic: true,
    color: "#ff0000",
    fontSize: 24,
  });
  assert.equal(result.document.name, "Fixture");
});
test("converts gradients and image fills, skips hidden, reports unsupported detail", () => {
  const source = structuredClone(frame);
  source.children = [
    {
      id: "1:4",
      type: "RECTANGLE",
      name: "Gradient",
      absoluteBoundingBox: { x: 200, y: 300, width: 40, height: 40 },
      fills: [
        {
          type: "GRADIENT_LINEAR",
          gradientHandlePositions: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
          gradientStops: [
            { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
          ],
        },
      ],
    },
    {
      id: "1:5",
      type: "RECTANGLE",
      name: "Photo",
      absoluteBoundingBox: { x: 250, y: 300, width: 40, height: 40 },
      fills: [{ type: "IMAGE", imageRef: "img", scaleMode: "FILL" }],
    },
    { id: "1:6", type: "TEXT", visible: false, characters: "hidden" },
  ];
  source.paddingRight = 10;
  const result = convertFigma(
    { document: source },
    { images: { img: "data:image/png;base64,YQ==" } },
  );
  const [parent, gradient, image] = result.document.pages[0].nodes;
  assert.equal(parent.layout, "flex");
  assert.deepEqual(
    [parent.paddingTop, parent.paddingRight, parent.paddingBottom, parent.paddingLeft],
    [20, 10, 20, 20],
  );
  assert.match(gradient.gradient, /linear-gradient\(90deg/);
  assert.equal(image.type, "image");
  assert.equal(image.src, "data:image/png;base64,YQ==");
  assert.equal(result.document.pages[0].nodes.length, 3);
  assert.equal(image.objectFit, "cover");
  assert.equal(
    result.warnings.some((w) => /asymmetric|contain scaling/.test(w)),
    false,
  );
});
test("native import fetches official API, never sends PAT to image CDN", async () => {
  const calls = [],
    fixture = structuredClone(frame);
  fixture.children = [
    {
      id: "1:5",
      type: "RECTANGLE",
      name: "Photo",
      absoluteBoundingBox: { x: 250, y: 300, width: 40, height: 40 },
      fills: [{ type: "IMAGE", imageRef: "photo", scaleMode: "FIT" }],
    },
  ];
  const response = (data, type = "application/json") =>
    new Response(typeof data === "string" ? data : JSON.stringify(data), {
      headers: { "content-type": type },
    });
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/nodes?"))
      return response({ name: "Imported", nodes: { "1:2": { document: fixture } } });
    if (url.endsWith("/images"))
      return response({ meta: { images: { photo: "https://s3-alpha.figma.com/image.png" } } });
    return response("fake-png-fixture", "image/png");
  };
  const result = await importFigma(
    { url: "https://figma.com/design/ABC?node-id=1-2", token: "test-token" },
    fetcher,
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.headers["X-Figma-Token"], "test-token");
  assert.equal(calls[1].options.headers["X-Figma-Token"], "test-token");
  assert.equal(calls[2].options.headers["X-Figma-Token"], undefined);
  assert.equal(calls[2].options.redirect, "error");
  assert.equal(result.document.pages[0].nodes[1].type, "image");
  assert.equal(JSON.stringify(result).includes("test-token"), false);
});
test("handles missing node and denied access without leaking tokens", async () => {
  assert.throws(() => convertFigma({ nodes: { "1:2": null } }, { nodeId: "1:2" }), /not found/);
  await assert.rejects(
    importFigma(
      { url: "https://figma.com/design/ABC", token: "private" },
      async () => new Response("", { status: 403 }),
    ),
    /Figma denied access/,
  );
  await assert.rejects(
    importFigma({ url: "https://figma.com/design/ABC", token: "" }),
    /personal access token/,
  );
});
