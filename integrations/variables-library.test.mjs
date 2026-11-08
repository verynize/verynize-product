// Variable library: aliases (references between variables), folders, colour rename and the
// Dimension/Number binding map (size, limits, axis padding, per-corner radius, line height).
import test from "node:test";
import assert from "node:assert/strict";
import { validateDocument } from "./design-store.mjs";
import {
  syncTokenColors,
  syncVariables,
  renameTokenRefs,
  renameVariableRefs,
  unbindToken,
  unbindVariable,
  variablesCss,
  describeVariables,
  describeTokens,
  elementCode,
} from "./design-edit.mjs";
import {
  aliasRoot,
  aliasCycle,
  setAlias,
  detachAlias,
  folderOf,
  folderMembers,
  folderRenames,
  validateAliases,
} from "./variables.mjs";
import { exportHTML } from "./export-html.mjs";

const base = () => ({
  version: 2,
  name: "Lib",
  activePage: "p",
  tokens: { "surface/base": "#111827", "surface/raised": "#1f2937", accent: "#5eead4" },
  variables: {
    spacing: { type: "dimension", value: 24 },
    "space/lg": { type: "dimension", value: 32 },
    strength: { type: "number", value: 60 },
    "type/body": { type: "fontFamily", value: "Inter" },
  },
  pages: [
    {
      id: "p",
      name: "Page",
      nodes: [
        {
          id: "card",
          type: "frame",
          name: "Card",
          x: 0,
          y: 0,
          w: 300,
          h: 200,
          color: "#111827",
          token: "surface/base",
          layout: "flex",
          radius: 0,
          padding: 0,
        },
        {
          id: "title",
          type: "text",
          name: "Title",
          parentId: "card",
          x: 0,
          y: 0,
          w: 200,
          h: 40,
          text: "Hi",
          color: "#ffffff",
          fontSize: 20,
          lineHeight: 1.2,
        },
      ],
    },
  ],
});

test("aliases resolve through chains and follow their source", () => {
  const d = base();
  setAlias(d, "surface/raised", "surface/base");
  setAlias(d, "accent", "surface/raised");
  assert.equal(aliasRoot(d, "accent"), "surface/base");
  assert.equal(d.tokens.accent, "#111827");
  d.tokens["surface/base"] = "#172033";
  syncTokenColors(d);
  assert.equal(d.tokens.accent, "#172033", "chain propagates after a source change");
  setAlias(d, "spacing", "space/lg");
  d.variables["space/lg"].value = 40;
  d.pages[0].nodes[0].bindings = { gap: "spacing" };
  syncVariables(d);
  assert.equal(d.variables.spacing.value, 40);
  assert.equal(d.pages[0].nodes[0].gap, 40, "bindings to an alias resolve to the source value");
  assert.doesNotThrow(() => validateDocument(d));
  assert.deepEqual(describeVariables(d).find((v) => v.name === "spacing").aliasOf, "space/lg");
  assert.equal(describeTokens(d).find((t) => t.name === "accent").aliasOf, "surface/raised");
});

test("aliases reject cycles, self references and mismatched types", () => {
  const d = base();
  setAlias(d, "surface/raised", "surface/base");
  assert.equal(aliasCycle(d, "surface/base", "surface/raised"), true);
  assert.throws(() => setAlias(d, "surface/base", "surface/raised"), /cycle/);
  assert.throws(() => setAlias(d, "accent", "accent"), /cycle/);
  assert.throws(() => setAlias(d, "spacing", "strength"), /same type/);
  assert.throws(() => setAlias(d, "accent", "spacing"), /same type/);
  for (const aliases of [
    [],
    { a: 5 },
    { "bad;": "accent" },
    { accent: "accent" },
    { accent: "spacing" },
    { "surface/base": "accent", accent: "surface/base" },
  ]) {
    const doc = { ...base(), aliases };
    assert.throws(() => validateDocument(doc), undefined, JSON.stringify(aliases));
  }
  // An alias whose source was deleted is tolerated; the variable keeps its last value.
  const dangling = { ...base(), aliases: { accent: "gone" } };
  assert.doesNotThrow(() => validateDocument(dangling));
  syncTokenColors(dangling);
  assert.equal(dangling.tokens.accent, "#5eead4");
});

test("detach keeps the resolved literal; deleting a source detaches its references", () => {
  const d = base();
  setAlias(d, "accent", "surface/base");
  detachAlias(d, "accent");
  assert.equal(d.aliases, undefined);
  assert.equal(d.tokens.accent, "#111827");
  setAlias(d, "spacing", "space/lg");
  unbindVariable(d, "space/lg");
  delete d.variables["space/lg"];
  assert.equal(d.aliases, undefined);
  assert.equal(d.variables.spacing.value, 32, "reference becomes literal with the resolved value");
  setAlias(d, "accent", "surface/raised");
  unbindToken(d, "surface/raised");
  delete d.tokens["surface/raised"];
  assert.equal(d.tokens.accent, "#1f2937");
  assert.doesNotThrow(() => validateDocument(d));
});

test("renaming colour and typed variables keeps layer references and aliases", () => {
  const d = base();
  setAlias(d, "accent", "surface/base");
  d.tokens["surface/primary"] = d.tokens["surface/base"];
  delete d.tokens["surface/base"];
  renameTokenRefs(d, "surface/base", "surface/primary");
  assert.equal(d.pages[0].nodes[0].token, "surface/primary");
  assert.deepEqual(d.aliases, { accent: "surface/primary" });
  setAlias(d, "spacing", "space/lg");
  d.variables["space/xl"] = d.variables["space/lg"];
  delete d.variables["space/lg"];
  renameVariableRefs(d, "space/lg", "space/xl");
  assert.deepEqual(d.aliases, { accent: "surface/primary", spacing: "space/xl" });
  assert.doesNotThrow(() => validateDocument(d));
});

test("folders: path, members and rename collisions", () => {
  const d = base();
  assert.equal(folderOf("surface/base"), "surface");
  assert.equal(folderOf("a/b/c"), "a/b");
  assert.equal(folderOf("accent"), "");
  assert.deepEqual(folderMembers(d, "surface").sort(), ["surface/base", "surface/raised"]);
  assert.deepEqual(folderRenames(d, "surface", "bg"), [
    ["surface/base", "bg/base"],
    ["surface/raised", "bg/raised"],
  ]);
  d.tokens["bg/base"] = "#000000";
  assert.throws(() => folderRenames(d, "surface", "bg"), /already exists/);
  assert.throws(() => folderRenames(d, "surface", "bad;"), /Invalid/);
});

test("Dimensions drive size, limits, axis padding, corners and line height", () => {
  const d = base();
  const card = d.pages[0].nodes[0],
    title = d.pages[0].nodes[1];
  card.bindings = {
    w: "space/lg",
    minH: "spacing",
    paddingX: "spacing",
    paddingY: "space/lg",
    radiusTopLeft: "spacing",
    radiusBottomRight: "space/lg",
  };
  title.bindings = { lineHeight: "spacing", fontSize: "space/lg" };
  validateDocument(d);
  syncVariables(d);
  assert.equal(card.w, 32);
  assert.equal(card.minH, 24);
  assert.deepEqual(
    [card.paddingTop, card.paddingRight, card.paddingBottom, card.paddingLeft],
    [32, 24, 32, 24],
  );
  assert.deepEqual(card.cornerRadii, [24, 0, 32, 0]);
  assert.equal(title.fontSize, 32, "font size resolves first");
  assert.equal(title.lineHeight, 0.75, "24px line height over a 32px font size");
  d.variables.spacing.value = 12;
  syncVariables(d);
  assert.deepEqual(card.cornerRadii, [12, 0, 32, 0]);
  assert.equal(title.lineHeight, 0.375);
  // Numbers only drive opacity on a 0–100 scale; they cannot drive a width.
  title.bindings = { opacity: "strength", w: "strength" };
  assert.doesNotThrow(() => validateDocument(d));
  syncVariables(d);
  assert.equal(title.opacity, 60);
  assert.equal(title.w, 200);
  const html = exportHTML(d, "p");
  assert.match(html, /border-radius: ?12px 0px 32px 0px/);
  assert.match(html, /padding: ?32px 12px 32px 12px/);
});

test("exports resolve aliases", () => {
  const d = base();
  setAlias(d, "accent", "surface/base");
  setAlias(d, "spacing", "space/lg");
  d.pages[0].nodes[1].token = "accent";
  syncTokenColors(d);
  const css = variablesCss(d);
  assert.match(css, /--accent: #111827;/);
  assert.match(css, /--spacing: 32px;/);
  assert.match(exportHTML(d, "p"), /#111827/);
  const code = elementCode(d, d.pages[0], d.pages[0].nodes[0]);
  assert.match(code, /var\(--accent\)/);
  validateAliases(d);
});
