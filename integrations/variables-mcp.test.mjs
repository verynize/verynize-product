// MCP token tools with every variable type (Colors, Dimensions, Numbers, Font family, Font weight):
// creation and value parsing, filters by type/folder, folder rename/delete, colour bindings for fill,
// border and outline, typed bindings incl. size/limits/axis padding/corners, and the raw operation API.
// Real tool calls through the shared tool table against a DesignStore in a temp directory.
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { DesignStore } from "./design-store.mjs";
import { createStoreBackend, runTool } from "./design-tools.mjs";

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-vars-mcp-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await DesignStore.open(root);
  await store.create("doc", "Doc");
  const backend = createStoreBackend(store);
  const raw = (name, args) => runTool(backend, name, args);
  const run = async (name, args = {}) => {
    const result = await raw(name, { document: "doc", ...args });
    assert.ok(!result.isError, result.content?.[0]?.text);
    return JSON.parse(result.content[0].text);
  };
  const fail = async (name, args, pattern) => {
    const result = await raw(name, { document: "doc", ...args });
    assert.equal(result.isError, true, `${name} should fail`);
    assert.match(result.content[0].text, pattern);
  };
  const doc = async () => (await store.read("doc")).document;
  return { store, run, raw, fail, doc };
}

const CARD =
  '<div data-node-label="Card" className="flex flex-col p-4 w-[300px] h-[200px] rounded-[8px] bg-[#111827] border border-[#334155] outline outline-2 outline-offset-4 outline-[#5eead4]"><p className="text-[16px] text-[#ffffff]">Hello</p></div>';

test("typed tokens: create with parsing, list with type/folder filters and folder field", async (t) => {
  const { run, fail } = await setup(t);
  await run("create_design_tokens", {
    tokens: [
      { name: "surface/base", value: "#111827" },
      { name: "space/md", type: "dimension", value: "16px" },
      { name: "space/lg", type: "dimension", value: 32 },
      { name: "strength", type: "number", value: "0.6" },
      { name: "type/body", type: "fontFamily", value: '"Inter"' },
      { name: "type/bold", type: "fontWeight", value: 600 },
    ],
  });
  const all = (await run("get_design_tokens")).tokens;
  const by = Object.fromEntries(all.map((t) => [t.name, t]));
  assert.deepEqual(
    [by["space/md"].type, by["space/md"].value, by["space/md"].folder],
    ["dimension", 16, "space"],
  );
  assert.equal(by.strength.value, 0.6);
  assert.equal(by.strength.folder, undefined);
  assert.equal(by["type/body"].value, "Inter");
  assert.equal(by["type/bold"].value, "600");
  assert.equal(by["surface/base"].cssVar, "var(--surface-base)");
  assert.deepEqual(
    (await run("get_design_tokens", { type: "dimension" })).tokens.map((t) => t.name),
    ["space/md", "space/lg"],
  );
  assert.deepEqual(
    (await run("get_design_tokens", { folder: "type" })).tokens.map((t) => t.name).sort(),
    ["type/body", "type/bold"],
  );
  await fail(
    "create_design_tokens",
    { tokens: [{ name: "bad", type: "number", value: "12px" }] },
    /must be a number/,
  );
  await fail(
    "create_design_tokens",
    { tokens: [{ name: "space/md", type: "number", value: 1 }] },
    /already exists/,
  );
  await fail(
    "update_design_tokens",
    { tokens: [{ name: "type/bold", value: "heavy" }] },
    /invalid fontWeight/,
  );
});

test("typed bindings cover size, limits, axis padding and corners; values and renames follow", async (t) => {
  const { run, fail, doc } = await setup(t);
  await run("create_design_tokens", {
    tokens: [
      { name: "size/card", type: "dimension", value: 320 },
      { name: "size/max", type: "dimension", value: 480 },
      { name: "space/x", type: "dimension", value: 24 },
      { name: "radius/tl", type: "dimension", value: 12 },
      { name: "alpha", type: "number", value: 80 },
      { name: "brand", value: "#ff0066" },
    ],
  });
  const { results } = await run("create_artboard", { code: CARD });
  const id = results?.[0]?.id ?? (await run("get_artboards")).artboards[0].id;
  await run("bind_variables", {
    bindings: [
      { id, property: "w", token: "size/card" },
      { id, property: "maxW", token: "size/max" },
      { id, property: "paddingX", token: "space/x" },
      { id, property: "radiusTopLeft", token: "radius/tl" },
      { id, property: "opacity", token: "alpha" },
    ],
  });
  let card = (await doc()).pages[0].nodes.find((n) => n.name === "Card");
  assert.equal(card.w, 320);
  assert.equal(card.maxW, 480);
  assert.equal(card.paddingLeft, 24);
  assert.equal(card.paddingRight, 24);
  assert.equal(card.cornerRadii[0], 12);
  assert.equal(card.opacity, 80);
  await fail(
    "bind_variables",
    { bindings: [{ id, property: "w", token: "alpha" }] },
    /w takes a dimension token; alpha is number/,
  );
  await fail(
    "bind_variables",
    { bindings: [{ id, property: "w", token: "brand" }] },
    /color token/,
  );
  await run("update_design_tokens", {
    tokens: [
      { name: "size/card", value: "360px" },
      { name: "space/x", newName: "gutter" },
    ],
  });
  card = (await doc()).pages[0].nodes.find((n) => n.name === "Card");
  assert.equal(card.w, 360, "bound width follows the new value");
  assert.equal(card.bindings.paddingX, "gutter", "rename keeps the binding");
  await run("delete_design_tokens", { names: ["size/card"] });
  card = (await doc()).pages[0].nodes.find((n) => n.name === "Card");
  assert.equal(card.w, 360, "delete keeps the resolved value");
  assert.equal(card.bindings.w, undefined);
});

test("colour tokens bind to fill, border and outline; rename, value change and delete follow", async (t) => {
  const { run, fail, doc } = await setup(t);
  await run("create_design_tokens", {
    tokens: [
      { name: "line/edge", value: "#475569" },
      { name: "line/focus", value: "#22d3ee" },
      { name: "surface", value: "#0f172a" },
      { name: "gap", type: "dimension", value: 8 },
    ],
  });
  const { results } = await run("create_artboard", { code: CARD });
  const id = results?.[0]?.id ?? (await run("get_artboards")).artboards[0].id;
  await run("bind_variables", {
    bindings: [
      { id, property: "fill", token: "surface" },
      { id, property: "strokeColor", token: "line/edge" },
      { id, property: "outlineColor", token: "line/focus" },
    ],
  });
  let card = (await doc()).pages[0].nodes.find((n) => n.name === "Card");
  assert.deepEqual([card.token, card.color], ["surface", "#0f172a"]);
  assert.deepEqual([card.strokeToken, card.strokeColor], ["line/edge", "#475569"]);
  assert.deepEqual([card.outlineToken, card.outlineColor], ["line/focus", "#22d3ee"]);
  await fail(
    "bind_variables",
    { bindings: [{ id, property: "strokeColor", token: "gap" }] },
    /takes a color token; gap is dimension/,
  );
  await run("update_design_tokens", {
    tokens: [{ name: "line/edge", value: "#64748b" }],
    folders: [{ name: "line", newName: "stroke" }],
  });
  card = (await doc()).pages[0].nodes.find((n) => n.name === "Card");
  assert.deepEqual(
    [card.strokeToken, card.strokeColor],
    ["stroke/edge", "#64748b"],
    "value and folder rename follow",
  );
  assert.equal(card.outlineToken, "stroke/focus");
  await run("delete_design_tokens", { folders: ["stroke"] });
  const d = await doc();
  card = d.pages[0].nodes.find((n) => n.name === "Card");
  assert.equal(card.strokeToken, undefined);
  assert.equal(card.strokeColor, "#64748b", "delete keeps the resolved border colour");
  assert.equal(card.outlineToken, undefined);
  assert.equal(card.outlineColor, "#22d3ee");
  assert.equal(
    Object.keys(d.tokens).some((n) => n.startsWith("stroke/")),
    false,
  );
  await run("bind_variables", { bindings: [{ id, property: "fill", token: null }] });
  card = (await doc()).pages[0].nodes.find((n) => n.name === "Card");
  assert.deepEqual([card.token, card.color], ["", "#0f172a"]);
});

test("folder rename moves every type, rejects collisions and keeps aliases", async (t) => {
  const { run, fail, doc } = await setup(t);
  await run("create_design_tokens", {
    tokens: [
      { name: "a/x", type: "dimension", value: 4 },
      { name: "a/b/y", type: "number", value: 2 },
      { name: "a/c", value: "#ffffff" },
      { name: "z/x", type: "dimension", value: 9 },
      { name: "ref", type: "dimension", value: 1 },
    ],
  });
  await run("update_design_tokens", { tokens: [{ name: "ref", aliasOf: "a/x" }] });
  await fail("update_design_tokens", { folders: [{ name: "a", newName: "z" }] }, /already exists/);
  await run("update_design_tokens", { folders: [{ name: "a", newName: "a/a" }] });
  const d = await doc();
  assert.deepEqual(Object.keys(d.variables).sort(), ["a/a/b/y", "a/a/x", "ref", "z/x"]);
  assert.ok(d.tokens["a/a/c"]);
  assert.equal(d.aliases.ref, "a/a/x", "alias follows the folder rename");
  await fail(
    "update_design_tokens",
    { folders: [{ name: "missing", newName: "q" }] },
    /no variables/,
  );
  await fail("update_design_tokens", {}, /Provide tokens/);
});

test("raw apply_operations: set_variable, 8-digit set_token and delete_token keep resolved values", async (t) => {
  const { raw, run, doc, store } = await setup(t);
  const read = async () =>
    JSON.parse((await raw("read_document", { name: "doc" })).content[0].text);
  let { revision } = await read();
  let res = await raw("apply_operations", {
    name: "doc",
    revision,
    operations: [
      { type: "set_variable", name: "space/sm", variableType: "dimension", value: 8 },
      { type: "set_variable", name: "weight", variableType: "fontWeight", value: "700" },
      { type: "set_token", name: "glass", value: "#ffffff80" },
    ],
  });
  assert.ok(!res.isError, res.content?.[0]?.text);
  let d = await doc();
  assert.deepEqual(d.variables["space/sm"], { type: "dimension", value: 8 });
  assert.equal(d.tokens.glass, "#ffffff80");
  ({ revision } = await read());
  res = await raw("apply_operations", {
    name: "doc",
    revision,
    operations: [{ type: "set_variable", name: "glass", variableType: "number", value: 1 }],
  });
  assert.equal(res.isError, true, "a typed variable cannot reuse a colour name");
  res = await raw("apply_operations", {
    name: "doc",
    revision,
    operations: [{ type: "set_variable", name: "n", variableType: "number", value: "many" }],
  });
  assert.equal(res.isError, true);
  await run("create_artboard", { code: CARD });
  const id = (await run("get_artboards")).artboards[0].id;
  await run("bind_variables", {
    bindings: [
      { id, property: "gap", token: "space/sm" },
      { id, property: "strokeColor", token: "glass" },
    ],
  });
  ({ revision } = await read());
  res = await raw("apply_operations", {
    name: "doc",
    revision,
    operations: [
      { type: "delete_token", name: "space/sm" },
      { type: "delete_token", name: "glass" },
    ],
  });
  assert.ok(!res.isError, res.content?.[0]?.text);
  d = await doc();
  const card = d.pages[0].nodes.find((n) => n.name === "Card");
  assert.equal(card.gap, 8);
  assert.equal(card.bindings?.gap, undefined);
  assert.equal(card.strokeToken, undefined);
  assert.equal(card.strokeColor, "#ffffff80");
  assert.equal(d.variables["space/sm"], undefined);
  assert.equal(d.tokens.glass, undefined);
  assert.ok(store);
});
