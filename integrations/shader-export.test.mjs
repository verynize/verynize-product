import test from "node:test";
import assert from "node:assert/strict";
import { validateDocument } from "./design-store.mjs";
import { exportHTML } from "./export-html.mjs";
const design = () => ({
  version: 2,
  name: "Shader",
  tokens: { brand: "#aa77dd" },
  pages: [
    {
      id: "page",
      name: "Page",
      nodes: [
        {
          id: "shader",
          type: "shader",
          name: "Shader",
          x: 0,
          y: 0,
          w: 300,
          h: 200,
          color: "#aa77dd",
          token: "brand",
          shaderPreset: "waves",
          shaderSpeed: 0.5,
          shaderIntensity: 1.4,
        },
      ],
    },
  ],
});
test("shader preset and uniforms validated before persistence or export", () => {
  for (const properties of [
    { shaderPreset: "custom-code" },
    { shaderSpeed: Infinity },
    { shaderSpeed: -1 },
    { shaderSpeed: 6 },
    { shaderIntensity: 3 },
  ]) {
    const d = design();
    Object.assign(d.pages[0].nodes[0], properties);
    assert.throws(() => validateDocument(d), /shader/);
  }
  assert.equal(validateDocument(design()).pages[0].nodes[0].shaderPreset, "waves");
});
test("shader export embeds application runtime once and keeps node content inert", () => {
  const d = design();
  d.pages[0].nodes[0].name = "</script><script>globalThis.injected=true</script>";
  d.pages[0].nodes.push({ ...d.pages[0].nodes[0], id: "second", shaderPreset: "noise" });
  const html = exportHTML(d);
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.match(html, /data-shader-preset="waves"/);
  assert.match(html, /data-shader-speed="0.5"/);
  assert.match(html, /data-shader-intensity="1.4"/);
  assert.match(html, /data-shader-color="#aa77dd"/);
  assert.match(html, /BetterShaders.startAll/);
  assert.match(html, /&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>globalThis.injected/);
});
test("Shader mode (shaderFill) validates, keeps legacy animated fills loading and exports a fill surface", () => {
  const box = {
    id: "box",
    type: "frame",
    name: "Box",
    x: 0,
    y: 0,
    w: 200,
    h: 120,
    color: "#ffffff",
    layout: "free",
  };
  const doc = (extra) => ({
    version: 2,
    name: "Fill",
    tokens: {},
    pages: [{ id: "page", name: "Page", nodes: [{ ...box, ...extra }] }],
  });
  for (const extra of [
    { shaderFill: "yes" },
    { shaderFill: true, shaderPreset: "custom-code" },
    { shaderFill: true, shaderSpeed: 9 },
  ])
    assert.throws(() => validateDocument(doc(extra)), /shader/i);
  const shader = design();
  shader.pages[0].nodes[0].shaderFill = true;
  assert.throws(
    () => validateDocument(shader),
    /shader mode/i,
    "shader layers are shaders already",
  );
  assert.equal(
    validateDocument(doc({ animated: "aurora" })).pages[0].nodes[0].animated,
    "aurora",
    "older animated gradients still load",
  );
  const html = exportHTML(doc({ shaderFill: true, shaderPreset: "tidal-swirl-1" }));
  assert.match(html, /data-shader-fill="true" data-shader-preset="tidal-swirl-1"/);
  assert.match(html, /data-shader-params=/);
  assert.match(html, /BetterShaders.startAll/);
  assert.doesNotMatch(
    exportHTML(doc({ shaderFill: false, shaderPreset: "tidal-swirl-1" })),
    /data-shader-fill|BetterShaders/,
    "off: no surface, no runtime",
  );
});
