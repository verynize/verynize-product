import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AssetStore, prepareAsset, copyAssets, inlineAssets, assetRefs } from "./asset-store.mjs";
import { importHtml, parseHtml } from "./codec-html.mjs";
import { importPen } from "./codec-pen.mjs";
import { exportHTML } from "./export-html.mjs";
import { DesignStore } from "./design-store.mjs";
import { createStoreBackend, toolTable } from "./design-tools.mjs";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const data = "data:image/png;base64," + png.toString("base64");
const pen = {
  version: "2.8",
  children: [
    {
      type: "frame",
      id: "card",
      reusable: true,
      width: 200,
      height: 100,
      fill: "#ffffff",
      layout: "horizontal",
      gap: 8,
      children: [
        {
          type: "text",
          id: "label",
          content: "Source title",
          fill: "#eeeeee",
          width: 100,
          height: 30,
          fontSize: 16,
        },
        {
          type: "icon_font",
          id: "icon",
          iconFontName: "lucide:heart",
          width: 24,
          height: 24,
          enabled: false,
        },
      ],
    },
    {
      type: "ref",
      id: "copy",
      ref: "card",
      x: 300,
      descendants: { label: { content: "Override" } },
    },
    { type: "path", id: "path", geometry: "M0 0L10 10Z", width: 10, height: 10 },
  ],
};
test("content addressed assets sanitize before hashing, dedupe, copy and detect corruption/symlinks", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vn-assets-"));
  try {
    const store = new AssetStore(path.join(dir, "assets"));
    const a = await store.put(png, "image/png");
    assert.deepEqual(await store.put(png), a);
    assert.equal((await readdir(store.directory)).length, 1);
    assert.deepEqual((await store.get(a.ref)).bytes, png);
    const target = new AssetStore(path.join(dir, "copy"));
    await copyAssets({ src: a.ref, fills: [{ src: a.ref }] }, store, target);
    assert.deepEqual((await target.get(a.ref)).bytes, png);
    assert.deepEqual(assetRefs({ text: a.ref }), []);
    const portable = await inlineAssets(
      `<p>${a.ref}</p><img src="${a.ref}"><div style="background:url(&quot;${a.ref}&quot;)"></div>`,
      (ref) => target.get(ref),
    );
    assert.ok(portable.includes(`<p>${a.ref}</p>`));
    assert.ok(portable.includes('src="data:image/png;base64,'));
    assert.ok(portable.includes("url(&quot;data:image/png;base64,"));
    const svg = prepareAsset(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M0 0L1 1"/></svg>',
      ),
    );
    assert.ok(!svg.bytes.includes(Buffer.from("<script")));
    assert.equal(prepareAsset(svg.bytes).ref, svg.ref);
    await writeFile(path.join(store.directory, a.sha256), Buffer.from("corrupt"));
    await assert.rejects(store.get(a.ref), /hash mismatch/);
    await rm(path.join(store.directory, a.sha256));
    await symlink(path.join(target.directory, a.sha256), path.join(store.directory, a.sha256));
    await assert.rejects(store.get(a.ref), /unavailable/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("HTML images and fills use one asset; inline data has decoded resource budgets", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vn-import-"));
  try {
    const store = new AssetStore(dir);
    const html = `<div style="width:100px;height:100px;background-image:url(${data})"><img src="${data}" width="10" height="10"/><img src="${data}" width="10" height="10"/></div>`;
    const result = await importHtml(html, { assetSink: (b, t) => store.put(b, t) });
    const json = JSON.stringify(result.document);
    assert.match(json, /asset:[a-f0-9]{64}/);
    assert.ok(!json.includes("data:image"));
    assert.equal(
      result.document.pages
        .flatMap((p) => p.nodes)
        .filter((n) => n.type === "image" && n.src?.startsWith("asset:")).length,
      2,
    );
    assert.equal((await readdir(dir)).length, 1);
    assert.match(exportHTML(result.document, result.pageId), /asset:[a-f0-9]{64}/);
    await assert.rejects(importHtml(html, { maxImageBytes: 10 }), /limit 10 bytes/);
    await assert.rejects(importHtml(html, { totalBytes: 10 }), /limit 10 bytes/);
    assert.throws(() => parseHtml("界".repeat(1_666_667)), /5000000 bytes/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("synthetic Pen preserves component links, overrides, hidden icons, flex and vectors", async () => {
  const result = await importPen(JSON.stringify(pen));
  const nodes = result.document.pages[0].nodes;
  assert.equal(nodes.find((n) => n.name === "card").component, true);
  const instance = nodes.find((n) => n.instanceOf && n.parentId === null);
  assert.ok(instance);
  const label = nodes.find((n) => n.parentId === instance.id && n.text === "Override");
  assert.ok(label.overrides.includes("text"));
  assert.equal(nodes.find((n) => n.name === "icon").hidden, true);
  assert.equal(nodes.find((n) => n.name === "card").layout, "flex");
  assert.equal(nodes.find((n) => n.name === "path").type, "vector");
  assert.equal(result.unsupportedFeatures.length, 0);
  const forward = await importPen(
    JSON.stringify({ ...pen, children: [pen.children[1], pen.children[0], pen.children[2]] }),
  );
  assert.ok(
    forward.document.pages[0].nodes[0].instanceOf,
    "forward references retain source stacking order",
  );
  await assert.rejects(importPen(Buffer.from([0, 1, 2])), /encrypted\/binary/);
  await assert.rejects(importPen(JSON.stringify({ ...pen, version: "99" })), /version/);
  const cyclic = {
    version: "2.8",
    children: [
      {
        type: "frame",
        id: "main",
        reusable: true,
        children: [{ type: "ref", id: "self", ref: "main" }],
      },
    ],
  };
  await assert.rejects(importPen(JSON.stringify(cyclic)), /cycle/);
});
test("nested Pen instance overrides follow source-ID paths and report unsupported features", async () => {
  const nested = structuredClone(pen);
  nested.children.push({
    type: "frame",
    id: "outer",
    reusable: true,
    width: 250,
    height: 150,
    children: [{ type: "ref", id: "inner", ref: "card", x: 5, y: 7 }],
  });
  nested.children.push({
    type: "ref",
    id: "outer-copy",
    ref: "outer",
    descendants: { "inner/label": { content: "Nested override", fontWeight: 500 } },
  });
  const imported = await importPen(JSON.stringify(nested));
  const text = imported.document.pages[0].nodes.find((node) => node.text === "Nested override");
  assert.ok(text);
  assert.equal(text.fontWeight, "500");
  assert.ok(text.overrides.includes("text"));
  const partial = await importPen(
    JSON.stringify({ ...pen, variables: { custom: { type: "color", value: "#fff" } } }),
  );
  assert.equal(partial.fidelityStatus, "partial");
  assert.ok(partial.unsupportedFeatures.some((item) => item.feature === "variables"));
});
test("MCP upload, preflight and faithful finish keep render and fidelity claims separate", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vn-tools-"));
  try {
    const store = await DesignStore.open(dir);
    await store.create("test", "Test");
    const backend = createStoreBackend(store, { defaultName: "test" });
    const tools = toolTable(backend);
    const file = path.join(dir, "fixture.pen");
    await writeFile(file, JSON.stringify(pen));
    const pngFile = path.join(dir, "fixture.png");
    await writeFile(pngFile, png);
    const asset = await tools.upload_asset.run({ path: pngFile });
    assert.match(asset.ref, /^asset:/);
    const prior = (await backend.read()).revision;
    await writeFile(path.join(dir, "test.verynize.assets", asset.sha256), "corrupt");
    await assert.rejects(
      tools.import_html.run({ html: `<img src="${data}"/>` }),
      /Asset storage failed/,
    );
    assert.equal(
      (await backend.read()).revision,
      prior,
      "failed asset staging never commits nodes",
    );
    const preflight = await tools.preflight_import.run({ path: file, format: "pen" });
    assert.equal(preflight.ok, true);
    assert.equal((await store.read("test")).document.pages.length, 1);
    const imported = await tools.import_pen.run({ path: file });
    const state = await backend.read();
    const page = state.document.pages.find((p) => p.id === imported.pages[0]);
    const root = page.nodes.find((n) => n.component);
    const output = await tools.finish_artboard.run({
      pageId: page.id,
      id: root.id,
      intent: "faithful-import",
      reviewNote: "Preserve source contrast",
    });
    const body = JSON.parse(output.content[0].text);
    assert.equal(body.renderVerified, false);
    assert.equal(body.fidelityStatus, "unverified");
    assert.ok(body.waivers.length > 0);
    assert.ok(
      body.waivers.every((w) => w.rule === "contrast" && w.sourceDigest === imported.sourceDigest),
    );
    await assert.rejects(
      tools.finish_artboard.run({
        pageId: state.document.pages[0].id,
        id: root.id,
        intent: "faithful-import",
        reviewNote: "x",
      }),
    );
    assert.ok((await readFile(pngFile)).equals(png));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
