// The shared component engine (web/component-core.js), rule by rule from design/component-audit/README.md:
// override marking, propagation, structure, slots, nested instances, cycles, detach, reset, copies, missing mains,
// determinism (idempotence, two-client convergence through web/cloud-ops.js) and the schema/headless wiring.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../web/cloud-ops.js";
import {
  syncComponents,
  createComponent,
  createInstance,
  detachInstance,
  resetOverrides,
  setSlot,
  componentInfo,
  componentProblems,
  wouldCycle,
  adoptCopies,
  derivedId,
  snapshot,
  live,
} from "./component-core.mjs";
import { validateDocument, normalizeDocument } from "./document-core.mjs";
import { applyOperations } from "./design-store.mjs";

const Ops = globalThis.VerynizeOps;
const clone = (v) => JSON.parse(JSON.stringify(v));
const frame = (id, extra = {}) => ({
  id,
  type: "frame",
  name: id,
  parentId: null,
  x: 0,
  y: 0,
  w: 200,
  h: 100,
  color: "#ffffff",
  layout: "free",
  ...extra,
});
const text = (id, parentId, value, extra = {}) => ({
  id,
  type: "text",
  name: id,
  parentId,
  x: 10,
  y: 10,
  w: 100,
  h: 20,
  color: "#111111",
  text: value,
  textRuns: [],
  ...extra,
});
const rect = (id, parentId, extra = {}) => ({
  id,
  type: "rectangle",
  name: id,
  parentId,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  color: "#cccccc",
  ...extra,
});
const doc = (nodes, pages = []) => ({
  version: 2,
  name: "Doc",
  activePage: "p1",
  tokens: {},
  pages: [{ id: "p1", name: "Page 1", nodes }, ...pages],
});
const nodesOf = (d) => d.pages.flatMap((p) => p.nodes);
const byId = (d, id) => nodesOf(d).find((n) => n.id === id);
const bySource = (d, rootId, sourceId) =>
  nodesOf(d).find((n) => n.sourceId === sourceId && owner(d, n) === rootId);
function owner(d, n) {
  const all = new Map(nodesOf(d).map((x) => [x.id, x]));
  for (let cur = n; cur; cur = all.get(cur.parentId))
    if (cur.instanceOf && (!cur.sourceId || cur.sourceId === cur.instanceOf)) return cur.id;
  return null;
}
const kidsOf = (d, id) => nodesOf(d).filter((n) => n.parentId === id);
/** One edit as the canvas makes it: mutate in place, then sync against the state before. */
function edit(d, fn) {
  const prev = clone(d);
  fn(d);
  return syncComponents(prev, d);
}

/** Card main: a title and a body text; one instance "i1". */
function cardDoc() {
  const d = doc([
    frame("card", { x: 0, y: 0, color: "#ffffff" }),
    text("title", "card", "Title"),
    text("body", "card", "Body", { y: 40 }),
  ]);
  createComponent(d, "p1", "card");
  createInstance(d, "card", { pageId: "p1", id: "i1", x: 400, y: 0 });
  return d;
}

test("createInstance materializes the main with derived ids and links", () => {
  const d = cardDoc();
  const root = byId(d, "i1");
  assert.equal(root.instanceOf, "card");
  assert.equal(root.sourceId, "card");
  assert.equal(root.component, undefined, "an instance is not a main");
  assert.deepEqual([root.x, root.y], [400, 0]);
  const title = byId(d, derivedId("i1", "title"));
  assert.ok(title, "child ids derive from (instance root id, source id)");
  assert.equal(title.sourceId, "title");
  assert.equal(title.parentId, "i1");
  assert.equal(title.text, "Title");
  assert.deepEqual(
    kidsOf(d, "i1").map((n) => n.sourceId),
    ["title", "body"],
  );
  validateDocument(d);
  assert.deepEqual(componentInfo(d, "card").instanceCount, 1);
});

test("the sync is idempotent", () => {
  const d = cardDoc();
  const once = clone(d);
  syncComponents(null, d);
  assert.deepEqual(d, once);
  syncComponents(clone(d), d);
  assert.deepEqual(d, once);
});

test("instance edits become overrides; main edits propagate around them", () => {
  const d = cardDoc();
  const title = derivedId("i1", "title");
  edit(d, (d) => (byId(d, title).text = "Hello"));
  assert.deepEqual(byId(d, title).overrides, ["text"]);
  edit(d, (d) => {
    byId(d, "title").text = "New title";
    byId(d, "title").color = "#ff0000";
    byId(d, "card").color = "#00ff00";
  });
  assert.equal(byId(d, title).text, "Hello", "the override is kept");
  assert.equal(byId(d, title).color, "#ff0000", "other keys follow the main");
  assert.equal(byId(d, "i1").color, "#00ff00");
  // A change back to the main's value is not an override.
  edit(d, (d) => (byId(d, derivedId("i1", "body")).text = "Body"));
  assert.equal(byId(d, derivedId("i1", "body")).overrides, undefined);
  // An instance edit and a main edit of the same key in one step: the instance wins.
  edit(d, (d) => {
    byId(d, "body").fontSize = 20;
    byId(d, derivedId("i1", "body")).fontSize = 30;
  });
  assert.equal(byId(d, derivedId("i1", "body")).fontSize, 30);
  assert.deepEqual(byId(d, derivedId("i1", "body")).overrides, ["fontSize"]);
  assert.equal(componentInfo(d, "i1").overrideCount, 2);
});

test("root position is local; size and name are overrides", () => {
  const d = cardDoc();
  edit(d, (d) => Object.assign(byId(d, "i1"), { x: 900, y: 50 }));
  assert.equal(byId(d, "i1").overrides, undefined);
  edit(d, (d) => Object.assign(byId(d, "card"), { x: 5, y: 5, w: 300 }));
  assert.deepEqual([byId(d, "i1").x, byId(d, "i1").y, byId(d, "i1").w], [900, 50, 300]);
  edit(d, (d) => Object.assign(byId(d, "i1"), { w: 250, name: "Hero card" }));
  assert.deepEqual(byId(d, "i1").overrides, ["name", "w"]);
  edit(d, (d) => Object.assign(byId(d, "card"), { w: 320, name: "Card" }));
  assert.equal(byId(d, "i1").w, 250);
  assert.equal(byId(d, "i1").name, "Hero card");
  // Hug sizes are measured by the canvas: neither marked nor copied.
  edit(d, (d) => Object.assign(byId(d, derivedId("i1", "title")), { wMode: "hug" }));
  edit(d, (d) => (byId(d, derivedId("i1", "title")).w = 77));
  assert.deepEqual(byId(d, derivedId("i1", "title")).overrides, ["wMode"]);
});

test("children added, removed and reordered in the main follow in instances", () => {
  const d = cardDoc();
  edit(d, (d) => d.pages[0].nodes.push(rect("badge", "card")));
  const badge = byId(d, derivedId("i1", "badge"));
  assert.ok(badge && badge.parentId === "i1" && badge.sourceId === "badge");
  // A local layer added in the instance stays, between the linked ones.
  edit(d, (d) => d.pages[0].nodes.push(rect("local", "i1")));
  assert.equal(byId(d, "local").sourceId, undefined);
  edit(d, (d) => {
    const nodes = d.pages[0].nodes,
      i = nodes.findIndex((n) => n.id === "badge");
    const [b] = nodes.splice(i, 1);
    nodes.splice(1, 0, b); // badge first among the main's children
  });
  assert.deepEqual(
    kidsOf(d, "card").map((n) => n.id),
    ["badge", "title", "body"],
  );
  assert.deepEqual(
    kidsOf(d, "i1").map((n) => n.sourceId || n.id),
    ["badge", "title", "body", "local"],
    "linked layers take the main's order, the local layer keeps its slot",
  );
  edit(d, (d) => (d.pages[0].nodes = d.pages[0].nodes.filter((n) => n.id !== "title")));
  assert.equal(bySource(d, "i1", "title"), undefined);
  assert.ok(byId(d, "local"), "local layers survive structure changes");
  // Moving a node to another parent in the main moves its copy.
  edit(d, (d) => {
    d.pages[0].nodes.push(frame("group", { parentId: "card", w: 50, h: 50 }));
    byId(d, "badge").parentId = "group";
  });
  assert.equal(byId(d, derivedId("i1", "badge")).parentId, derivedId("i1", "group"));
  validateDocument(d);
});

test("deleting an inherited layer hides it; reset brings it back", () => {
  const d = cardDoc();
  const title = derivedId("i1", "title");
  edit(d, (d) => (d.pages[0].nodes = d.pages[0].nodes.filter((n) => n.id !== title)));
  assert.equal(byId(d, title).hidden, true);
  assert.deepEqual(byId(d, title).overrides, ["hidden"]);
  // Deleting a whole subtree restores it with only its top hidden.
  edit(d, (d) => d.pages[0].nodes.push(frame("row", { parentId: "card" }), rect("dot", "row")));
  const row = derivedId("i1", "row"),
    dot = derivedId("i1", "dot");
  edit(d, (d) => (d.pages[0].nodes = d.pages[0].nodes.filter((n) => n.id !== row && n.id !== dot)));
  assert.equal(byId(d, row).hidden, true);
  assert.ok(byId(d, dot) && byId(d, dot).hidden === undefined);
  resetOverrides(d, ["i1"], { all: true });
  assert.equal(byId(d, title).hidden, undefined);
  assert.equal(byId(d, title).overrides, undefined);
  // Deleting the instance root deletes the instance.
  edit(d, (d) => (d.pages[0].nodes = d.pages[0].nodes.filter((n) => owner(d, n) !== "i1")));
  assert.equal(byId(d, "i1"), undefined);
});

test("linked layers moved out of their instance snap back; without history they become plain", () => {
  const d = cardDoc();
  const title = derivedId("i1", "title");
  edit(d, (d) => Object.assign(byId(d, title), { parentId: null }));
  assert.equal(byId(d, title).parentId, "i1");
  const loose = clone(d);
  Object.assign(byId(loose, title), { parentId: null });
  syncComponents(null, loose);
  assert.equal(byId(loose, title).sourceId, undefined, "a loose copy becomes a plain layer");
  assert.ok(bySource(loose, "i1", "title"), "and the instance gets its layer back");
  validateDocument(loose);
});

/** App shell main with a Content slot holding a default placeholder; instance "shell1". */
function shellDoc() {
  const d = doc([
    frame("shell", { w: 800, h: 600 }),
    frame("header", { parentId: "shell", h: 60, color: "#222222" }),
    text("headline", "header", "App"),
    frame("content", { parentId: "shell", y: 60, w: 800, h: 540, color: "#fafafa" }),
    text("placeholder", "content", "Drop content here"),
  ]);
  createComponent(d, "p1", "shell");
  setSlot(d, "content", true, "Content");
  createInstance(d, "shell", { pageId: "p1", id: "shell1", x: 1000 });
  return d;
}

test("slots: Default follows the main, Modified keeps its own content, reset returns to Default", () => {
  const d = shellDoc();
  const slot = derivedId("shell1", "content"),
    placeholder = derivedId("shell1", "placeholder");
  assert.equal(byId(d, slot).slot, true);
  assert.equal(byId(d, slot).slotName, "Content");
  assert.deepEqual(componentInfo(d, "shell1").slots, [
    { id: slot, name: "Content", state: "default" },
  ]);
  // Default: the main's slot content changes reach the instance.
  edit(d, (d) => (byId(d, "placeholder").text = "Nothing yet"));
  assert.equal(byId(d, placeholder).text, "Nothing yet");
  // Adding a layer makes the slot Modified; the existing children become local.
  edit(d, (d) => d.pages[0].nodes.push(text("page-title", slot, "Dashboard")));
  assert.deepEqual(byId(d, slot).overrides, ["children"]);
  assert.equal(byId(d, placeholder).sourceId, undefined);
  assert.equal(componentInfo(d, slot).slot.state, "modified");
  // Main edits: slot content survives, the slot frame and the rest of the shell follow.
  edit(d, (d) => {
    byId(d, "placeholder").text = "Changed again";
    d.pages[0].nodes.push(rect("extra", "content"));
    byId(d, "content").color = "#eeeeee";
    byId(d, "headline").text = "My app";
  });
  assert.deepEqual(
    kidsOf(d, slot).map((n) => n.id),
    [placeholder, "page-title"],
  );
  assert.equal(byId(d, placeholder).text, "Nothing yet");
  assert.equal(byId(d, slot).color, "#eeeeee");
  assert.equal(bySource(d, "shell1", "headline").text, "My app");
  // Reset: back to the main's content.
  resetOverrides(d, [slot]);
  assert.equal(byId(d, slot).overrides, undefined);
  assert.deepEqual(
    kidsOf(d, slot).map((n) => n.sourceId),
    ["placeholder", "extra"],
  );
  assert.equal(byId(d, "page-title"), undefined);
  assert.equal(byId(d, placeholder).text, "Changed again");
  validateDocument(d);
});

test("slots become Modified on edit, delete and reorder of their content", () => {
  for (const change of ["edit", "delete", "reorder"]) {
    const d = shellDoc();
    edit(d, (d) => d.pages[0].nodes.push(rect("second", "content")));
    const slot = derivedId("shell1", "content"),
      placeholder = derivedId("shell1", "placeholder"),
      second = derivedId("shell1", "second");
    edit(d, (d) => {
      const nodes = d.pages[0].nodes;
      if (change === "edit") byId(d, placeholder).text = "Mine";
      if (change === "delete") d.pages[0].nodes = nodes.filter((n) => n.id !== placeholder);
      if (change === "reorder") {
        const i = nodes.findIndex((n) => n.id === second);
        const [s] = nodes.splice(i, 1);
        nodes.splice(
          nodes.findIndex((n) => n.id === placeholder),
          0,
          s,
        );
      }
    });
    assert.deepEqual(byId(d, slot).overrides, ["children"], change);
    if (change === "edit") assert.equal(byId(d, placeholder).text, "Mine");
    if (change === "delete")
      assert.equal(byId(d, placeholder), undefined, "no hidden copy in a slot");
    if (change === "reorder")
      assert.deepEqual(
        kidsOf(d, slot).map((n) => n.id),
        [second, placeholder],
      );
    // The slot frame's own properties are ordinary overrides and keep it Default.
    const fresh = shellDoc();
    edit(fresh, (d) => (byId(d, derivedId("shell1", "content")).color = "#000000"));
    assert.deepEqual(byId(fresh, derivedId("shell1", "content")).overrides, ["color"]);
  }
});

test("setSlot is limited to frames inside a main", () => {
  const d = shellDoc();
  assert.throws(() => setSlot(d, "headline", true), /frame/);
  assert.throws(() => setSlot(d, "shell", true), /own slot/);
  assert.throws(() => setSlot(d, derivedId("shell1", "header"), true), /main component/);
  d.pages[0].nodes.push(frame("free"));
  assert.throws(() => setSlot(d, "free", true), /inside a main/);
  setSlot(d, "content", false);
  assert.equal(
    byId(d, derivedId("shell1", "content")).slot,
    undefined,
    "removing a slot reaches instances",
  );
});

/** Button main; Card main containing a Button instance "b-in-card"; Card instance "c1". */
function nestedDoc() {
  const d = doc([
    frame("button", { w: 120, h: 40, color: "#0000ff" }),
    text("label", "button", "Button"),
    frame("card", { x: 0, y: 200, w: 300, h: 200 }),
    text("heading", "card", "Card"),
  ]);
  createComponent(d, "p1", "button");
  createComponent(d, "p1", "card");
  createInstance(d, "button", { pageId: "p1", parentId: "card", id: "b-in-card", x: 10, y: 50 });
  createInstance(d, "card", { pageId: "p1", id: "c1", x: 500, y: 200 });
  return d;
}

test("nested instances sync inner mains first, in one pass", () => {
  const d = nestedDoc();
  const copy = derivedId("c1", "b-in-card"),
    label = derivedId("c1", derivedId("b-in-card", "label"));
  assert.equal(byId(d, copy).instanceOf, "button");
  assert.equal(byId(d, copy).sourceId, "b-in-card", "a nested copy points at the node it copies");
  assert.equal(byId(d, label).text, "Button");
  assert.equal(
    componentInfo(d, "button").instanceCount,
    1,
    "nested copies are not top-level instances",
  );
  edit(d, (d) => {
    byId(d, "button").color = "#ff00ff";
    byId(d, "label").text = "Go";
  });
  assert.equal(byId(d, copy).color, "#ff00ff");
  assert.equal(byId(d, label).text, "Go");
  // An override on the Button inside the Card main reaches Card instances.
  edit(d, (d) => (byId(d, derivedId("b-in-card", "label")).text = "Buy"));
  assert.deepEqual(byId(d, derivedId("b-in-card", "label")).overrides, ["text"]);
  assert.equal(byId(d, label).text, "Buy");
  // And an override on the copy inside the Card instance stays.
  edit(d, (d) => (byId(d, label).text = "Order"));
  edit(d, (d) => (byId(d, derivedId("b-in-card", "label")).text = "Shop"));
  assert.equal(byId(d, label).text, "Order");
  assert.equal(componentInfo(d, label).role, "inherited");
  // Creating the Button instance in the Card main appears in existing Card instances.
  edit(d, (d) => createInstance(d, "button", { parentId: "card", id: "b2", x: 10, y: 100 }));
  assert.equal(byId(d, derivedId("c1", "b2")).instanceOf, "button");
  validateDocument(d);
});

test("detach: links removed, slots plain, nested instances re-pointed to their own main", () => {
  const d = nestedDoc();
  edit(d, (d) => (byId(d, derivedId("b-in-card", "label")).text = "Buy"));
  const copy = derivedId("c1", "b-in-card"),
    label = derivedId("c1", derivedId("b-in-card", "label"));
  edit(d, (d) => (byId(d, label).fontSize = 40));
  detachInstance(d, "c1");
  const root = byId(d, "c1");
  assert.equal(root.instanceOf, undefined);
  assert.equal(root.sourceId, undefined);
  assert.equal(byId(d, derivedId("c1", "heading")).sourceId, undefined);
  assert.equal(byId(d, copy).instanceOf, "button", "the nested instance stays an instance");
  assert.equal(byId(d, copy).sourceId, "button");
  assert.equal(byId(d, label).sourceId, "label", "re-pointed to the source's source");
  assert.deepEqual(
    byId(d, label).overrides,
    ["fontSize", "text"],
    "both levels' overrides are kept",
  );
  assert.equal(componentInfo(d, copy).role, "instance");
  edit(d, (d) => {
    byId(d, "button").color = "#123456";
    byId(d, "label").text = "Ignored";
  });
  assert.equal(byId(d, copy).color, "#123456", "the re-pointed instance follows Button");
  assert.equal(byId(d, label).text, "Buy");
  // Detaching an app shell turns its slots into plain frames that keep their children.
  const s = shellDoc();
  const slot = derivedId("shell1", "content");
  edit(s, (d) => d.pages[0].nodes.push(text("mine", slot, "Mine")));
  detachInstance(s, "shell1");
  assert.equal(byId(s, slot).slot, undefined);
  assert.equal(byId(s, slot).overrides, undefined);
  assert.equal(byId(s, "mine").parentId, slot);
  assert.throws(() => detachInstance(s, "shell1"), /Not an instance/);
  validateDocument(s);
});

test("cycles are never synced and creating one is refused", () => {
  const d = nestedDoc();
  assert.throws(
    () => createInstance(d, "card", { parentId: "card", id: "loop" }),
    /cannot contain an instance of itself/,
  );
  assert.throws(
    () => createInstance(d, "card", { parentId: "button", id: "loop" }),
    /cannot contain an instance of itself/,
    "indirect: Button would contain Card, which contains Button",
  );
  // A cycle written directly (merged remote edits, a hand-edited file): reported, left alone, no growth.
  const raw = nestedDoc();
  raw.pages[0].nodes.push(
    frame("loop", { parentId: "button", instanceOf: "card", sourceId: "card" }),
  );
  validateDocument(raw);
  const before = nodesOf(raw).length;
  syncComponents(null, raw);
  syncComponents(clone(raw), raw);
  assert.equal(nodesOf(raw).length, before);
  assert.deepEqual(
    componentProblems(raw)
      .map((p) => p.id)
      .sort(),
    ["button", "card"],
  );
  assert.equal(componentInfo(raw, "c1").cyclic, true);
  const stored = clone(raw);
  normalizeDocument(stored, {}, []);
  validateDocument(stored); // documentSafety keeps loading it
});

test("wouldCycle refuses placing an instance (or a layer holding one) inside a main it depends on", () => {
  const d = nestedDoc();
  const all = (id) => nodesOf(d).filter((n) => n.id === id || owner(d, n) === id);
  assert.equal(wouldCycle(d, all("c1"), "card"), true, "Card instance into Card");
  assert.equal(
    wouldCycle(d, all("c1"), "button"),
    true,
    "Card instance into Button (Card holds a Button)",
  );
  assert.equal(
    wouldCycle(d, [byId(d, "b-in-card")], "button"),
    true,
    "Button instance into Button",
  );
  assert.equal(wouldCycle(d, all("c1"), null), false, "onto the page");
  d.pages[0].nodes.push(frame("plain", { x: 900 }));
  assert.equal(wouldCycle(d, all("c1"), "plain"), false, "into a plain frame");
  const wrapper = [frame("w", { x: 0 }), { ...byId(d, "c1"), parentId: "w" }];
  assert.equal(wouldCycle(d, wrapper, "card"), true, "a frame holding an instance counts too");
});

test("a missing main leaves its instances as they are; restoring it resumes the sync", () => {
  const d = cardDoc();
  const title = derivedId("i1", "title");
  edit(d, (d) => (byId(d, title).text = "Mine"));
  const withMain = clone(d);
  edit(
    d,
    (d) =>
      (d.pages[0].nodes = d.pages[0].nodes.filter(
        (n) => !["card", "title", "body"].includes(n.id),
      )),
  );
  assert.equal(byId(d, title).text, "Mine");
  assert.equal(byId(d, title).sourceId, "title", "links are kept");
  const frozen = clone(d);
  edit(d, (d) => (byId(d, title).text = "Still mine"));
  syncComponents(null, d);
  assert.equal(byId(d, title).overrides.length, 1);
  assert.deepEqual(kidsOf(d, "i1").length, kidsOf(frozen, "i1").length);
  assert.equal(componentInfo(d, "i1").missingMain, true);
  validateDocument(d);
  // Undo brings the main back (a replaced document is only reconciled).
  const undone = clone(withMain);
  byId(undone, "title").text = "Main title";
  syncComponents(null, undone);
  assert.equal(byId(undone, title).text, "Mine");
  assert.equal(byId(undone, derivedId("i1", "body")).text, "Body");
});

test("instances on another page than their main", () => {
  const d = doc([frame("card"), text("t", "card", "Hi")], [{ id: "p2", name: "Two", nodes: [] }]);
  createComponent(d, "p1", "card");
  createInstance(d, "card", { pageId: "p2", id: "far" });
  assert.equal(d.pages[1].nodes.length, 2);
  edit(d, (d) => (byId(d, "t").text = "Hello"));
  assert.equal(byId(d, derivedId("far", "t")).text, "Hello");
  validateDocument(d);
});

test("an instance root written with only instanceOf is materialized (agents)", () => {
  const d = doc([frame("card", { component: true }), text("t", "card", "Hi")]);
  d.pages[0].nodes.push(frame("agent-made", { instanceOf: "card", x: 300 }));
  syncComponents(null, d);
  assert.equal(byId(d, "agent-made").sourceId, "card");
  assert.equal(byId(d, derivedId("agent-made", "t")).text, "Hi");
});

test("duplicate and paste: main → instance, instance → instance with its overrides, parts → plain", () => {
  const d = shellDoc();
  const slot = derivedId("shell1", "content");
  edit(d, (d) => {
    byId(d, derivedId("shell1", "headline")).text = "Mine";
    d.pages[0].nodes.push(text("mine", slot, "My content"));
  });
  const duplicate = (ids) => {
    const all = new Set();
    const add = (id) => {
      all.add(id);
      for (const n of nodesOf(d)) if (n.parentId === id) add(n.id);
    };
    ids.forEach(add);
    const mapping = new Map([...all].map((id, i) => [id, `copy-${ids[0]}-${i}`]));
    const copies = nodesOf(d)
      .filter((n) => all.has(n.id))
      .map((n) => ({
        ...clone(n),
        id: mapping.get(n.id),
        parentId: mapping.get(n.parentId) || n.parentId,
      }));
    adoptCopies(d, copies, mapping);
    return edit(d, (d) => d.pages[0].nodes.push(...copies)) && copies;
  };
  // Main → instance.
  const fromMain = duplicate(["shell"]);
  const newRoot = fromMain[0];
  assert.equal(newRoot.component, undefined);
  assert.equal(newRoot.instanceOf, "shell");
  assert.ok(byId(d, derivedId(newRoot.id, "headline")), "ids derived from the new root");
  assert.equal(componentInfo(d, "shell").instanceCount, 2);
  // Instance → instance keeping overrides and slot content.
  const fromInstance = duplicate(["shell1"]);
  const second = fromInstance[0];
  assert.equal(second.instanceOf, "shell");
  assert.equal(bySource(d, second.id, "headline").text, "Mine");
  assert.equal(bySource(d, second.id, "headline").id, derivedId(second.id, "headline"));
  const secondSlot = bySource(d, second.id, "content");
  assert.deepEqual(secondSlot.overrides, ["children"]);
  assert.deepEqual(
    kidsOf(d, secondSlot.id).map((n) => n.text),
    ["Drop content here", "My content"],
  );
  // The copies keep syncing.
  edit(d, (d) => (byId(d, "header").color = "#abcdef"));
  assert.equal(bySource(d, second.id, "header").color, "#abcdef");
  // A part of an instance copied on its own is plain.
  const part = duplicate([derivedId("shell1", "header")]);
  assert.equal(part[0].sourceId, undefined);
  assert.equal(part[1].sourceId, undefined);
  // A main copied from another document (its main is not here) stays a main.
  const other = doc([]);
  const pasted = [frame("x1", { component: true }), text("x2", "x1", "Elsewhere")];
  adoptCopies(other, pasted, new Map([["orig", "x1"]]));
  assert.equal(pasted[0].component, true);
  validateDocument(d);
});

test("componentInfo roles", () => {
  const d = shellDoc();
  const slot = derivedId("shell1", "content");
  edit(d, (d) => d.pages[0].nodes.push(text("mine", slot, "Mine")));
  assert.equal(componentInfo(d, "shell").role, "main");
  assert.deepEqual(componentInfo(d, "shell").slots, [{ id: "content", name: "Content" }]);
  assert.equal(componentInfo(d, "content").role, "slot");
  assert.equal(componentInfo(d, "content").mainId, "shell");
  assert.equal(componentInfo(d, "shell1").role, "instance");
  assert.equal(componentInfo(d, "shell1").mainName, "shell");
  assert.equal(componentInfo(d, derivedId("shell1", "header")).role, "inherited");
  assert.equal(componentInfo(d, slot).role, "slot");
  assert.equal(componentInfo(d, "mine").role, "local");
  assert.equal(componentInfo(d, "mine").instanceId, "shell1");
  assert.equal(componentInfo(d, "nope"), null);
  d.pages[0].nodes.push(rect("plain", null));
  assert.equal(componentInfo(d, "plain").role, null);
  assert.throws(() => createComponent(d, "p1", "plain"), /Only a frame/);
  assert.throws(() => createComponent(d, "p1", "shell1"), /Detach/);
  assert.throws(() => createComponent(d, "p1", "shell"), /already/);
});

// ---- determinism across clients ----------------------------------------------------------------
/** Room server: applies batches in arrival order with last-writer-wins stamps (web/cloud-ops.js). */
function room(base) {
  const stamps = Ops.memoryStamps();
  let doc = clone(base);
  return {
    get doc() {
      return doc;
    },
    submit(ops, stamp) {
      const out = Ops.apply(
        doc,
        ops.map((op) => ({ ...op, s: stamp })),
        { stamps },
      );
      doc = out.doc;
      return out.applied || ops;
    },
  };
}
const stampAt = (wall, replica) => Ops.createClock(replica, () => wall).next();

/** A document as the canvas sees it: nodes by id plus each parent's children in order (the flat array order of
 * unrelated nodes is the room server's to decide). */
function canonical(d) {
  return {
    ...d,
    pages: d.pages.map((p) => ({
      ...p,
      nodes: [...p.nodes].sort((a, b) => (a.id < b.id ? -1 : 1)),
      order: Object.fromEntries(
        [...new Set(p.nodes.map((n) => n.parentId || ""))]
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
          .map((parent) => [
            parent,
            p.nodes.filter((n) => (n.parentId || "") === parent).map((n) => n.id),
          ]),
      ),
    })),
  };
}

test("two clients converge: the same operations in either order give the same document", () => {
  const base = cardDoc();
  // Client A edits the main; client B overrides the instance text and adds a second instance.
  const a = clone(base);
  edit(a, (d) => {
    byId(d, "card").color = "#ff0000";
    d.pages[0].nodes.push(rect("badge", "card"));
  });
  const b = clone(base);
  edit(b, (d) => (byId(d, derivedId("i1", "title")).text = "B's title"));
  edit(b, (d) => createInstance(d, "card", { id: "i2", x: 800 }));
  const opsA = Ops.diff(base, a, { ignore: ["activePage"] });
  const opsB = Ops.diff(base, b, { ignore: ["activePage"] });
  const merged = [];
  for (const [first, second] of [
    [opsA, opsB],
    [opsB, opsA],
  ]) {
    let d = Ops.apply(base, first).doc;
    d = Ops.apply(d, second).doc;
    syncComponents(null, d); // what each client's render does after remote operations
    merged.push(d);
  }
  assert.deepEqual(canonical(merged[0]), canonical(merged[1]));
  const d = merged[0];
  assert.equal(byId(d, derivedId("i2", "badge")).parentId, "i2", "both clients derive the same id");
  assert.equal(byId(d, "i2").color, "#ff0000");
  assert.equal(byId(d, derivedId("i1", "title")).text, "B's title");
  assert.equal(byId(d, "i1").color, "#ff0000");
  // Each client sends what its sync added; replaying the other client's follow-up changes nothing.
  const replica = (first, second) => Ops.apply(Ops.apply(base, first).doc, second).doc;
  const followA = Ops.diff(replica(opsA, opsB), merged[0]);
  const followB = Ops.diff(replica(opsB, opsA), merged[1]);
  assert.deepEqual(canonical(Ops.apply(merged[0], followB).doc), canonical(merged[0]));
  assert.deepEqual(canonical(Ops.apply(merged[1], followA).doc), canonical(merged[1]));
  validateDocument(d);
});

test("conflicting edits through a last-writer-wins room settle on one consistent document", () => {
  const base = cardDoc();
  const title = derivedId("i1", "title");
  // A: main title color (propagates to the instance copy). B: overrides the same copy's color.
  const a = clone(base);
  edit(a, (d) => (byId(d, "title").color = "#ff0000"));
  const b = clone(base);
  edit(b, (d) => (byId(d, title).color = "#0000ff"));
  for (const [first, second] of [
    ["A", "B"],
    ["B", "A"],
  ]) {
    const server = room(base);
    const ops = { A: Ops.diff(base, a), B: Ops.diff(base, b) };
    server.submit(ops[first], stampAt(1000, first));
    server.submit(ops[second], stampAt(2000, second));
    const replica1 = syncComponents(null, clone(server.doc));
    const replica2 = syncComponents(null, clone(server.doc));
    assert.deepEqual(replica1, replica2);
    assert.deepEqual(
      byId(replica1, title).overrides,
      ["color"],
      "B's override survives either order",
    );
    assert.equal(byId(replica1, title).color, second === "B" ? "#0000ff" : "#ff0000");
    assert.deepEqual(syncComponents(null, clone(replica1)), replica1, "idempotent after the merge");
  }
});

// ---- renderer glue -------------------------------------------------------------------------------
test("live(): in-place edits are diffed against the settled state; a replaced document is only reconciled", () => {
  const tracker = live();
  let d = cardDoc();
  tracker.sync(d);
  tracker.settle(d);
  const title = derivedId("i1", "title");
  byId(d, title).text = "Edited in place";
  tracker.sync(d);
  tracker.settle(d);
  assert.deepEqual(byId(d, title).overrides, ["text"]);
  // Undo: a new document object whose instance differs from its main without an override is reconciled.
  d = clone(d);
  byId(d, derivedId("i1", "body")).text = "Stale";
  tracker.sync(d);
  assert.equal(byId(d, derivedId("i1", "body")).text, "Body");
  assert.equal(byId(d, derivedId("i1", "body")).overrides, undefined);
  // The snapshot holds mains and instances with their subtrees, not unrelated layers.
  d.pages[0].nodes.push(frame("unrelated"), rect("inside-unrelated", "unrelated"));
  assert.deepEqual(
    snapshot(d).pages[0].nodes.map((n) => n.id),
    nodesOf(d)
      .filter((n) => !n.id.includes("unrelated"))
      .map((n) => n.id),
  );
  // Unrelated edits leave instances alone (nothing to re-sync), an edit inside one is still marked.
  tracker.settle(d);
  byId(d, "unrelated").x = 99;
  byId(d, derivedId("i1", "body")).fontSize = 44;
  tracker.sync(d);
  assert.deepEqual(byId(d, derivedId("i1", "body")).overrides, ["fontSize"]);
});

// ---- schema and headless wiring -----------------------------------------------------------------
test("validation checks only types; repairs never reject a stored document over links", () => {
  const ok = doc([
    frame("f", { component: true, instanceOf: "gone", sourceId: "gone", overrides: ["w"] }),
  ]);
  validateDocument(ok); // dangling links are fine
  for (const [extra, message] of [
    [{ component: "yes" }, /component/],
    [{ instanceOf: 3 }, /instanceOf/],
    [{ sourceId: "" }, /sourceId/],
    [{ overrides: "w" }, /overrides/],
    [{ overrides: [1] }, /overrides/],
    [{ slotName: 5 }, /slotName/],
  ])
    assert.throws(() => validateDocument(doc([frame("f", extra)])), message);
  assert.throws(
    () => validateDocument(doc([rect("r", null, { slot: true })])),
    /Only frames can be slots/,
  );
  const stored = doc([rect("r", null, { slot: true, overrides: "x", instanceOf: "card" })]);
  const repairs = [];
  normalizeDocument(stored, {}, repairs);
  validateDocument(stored);
  assert.equal(stored.pages[0].nodes[0].instanceOf, "card", "valid link fields are kept");
  assert.deepEqual(
    repairs.map((r) => r.path).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ["pages[0].nodes[0].overrides", "pages[0].nodes[0].slot"],
  );
});

test("headless operations run the sync", () => {
  const d = cardDoc();
  const out = applyOperations(d, [
    {
      type: "update_node",
      pageId: "p1",
      nodeId: "title",
      properties: { text: "From agent", color: "#00ff00" },
    },
    {
      type: "update_node",
      pageId: "p1",
      nodeId: derivedId("i1", "body"),
      properties: { text: "Agent body" },
    },
    { type: "delete_node", pageId: "p1", nodeId: derivedId("i1", "title") },
  ]);
  const title = byId(out, derivedId("i1", "title"));
  assert.equal(title.hidden, true, "a deleted inherited layer is hidden");
  assert.equal(title.text, "From agent");
  assert.deepEqual(byId(out, derivedId("i1", "body")).overrides, ["text"]);
  assert.equal(byId(d, "title").text, "Title", "the input document is untouched");
});

test("the canvas loads the engine after the schema and before the editor scripts", () => {
  const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  const order = [
    "/document-core.js",
    "/component-core.js",
    "/canvas-interactions.js",
    "/clipboard-commands.js",
    "/app.js",
  ].map((src) => html.indexOf(`src="${src}"`));
  assert.ok(order.every((i) => i >= 0));
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  );
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const render =
    /\nfunction render\(selectionOnly = false\) \{\n([\s\S]*?)\n\}\n/.exec(app)?.[1] ?? "";
  assert.match(
    render,
    /componentSync\.sync\(design\);[\s\S]*?canvasRender\.render\(\)/,
    "render() syncs components before drawing the canvas",
  );
});
