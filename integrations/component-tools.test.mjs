// Components through the agent layer: the MCP tools (list_components, create_component, create_instance,
// detach_instance, reset_overrides, set_slot) against the file backend, the JSX codec's component attributes
// (data-component, data-instance-of, data-slot), override marking through update_elements, slot fills, duplicates,
// cycle refusal and the HTML export of instances.
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { DesignStore } from "./design-store.mjs";
import { createStoreBackend, runTool, TOOL_NAMES, SERVER_VERSION } from "./design-tools.mjs";
import { documentToJsx, jsxToDocument } from "./codec-source.mjs";
import { exportHTML } from "./export-html.mjs";
import { componentInfo } from "./component-core.mjs";
import { indexPage, duplicateElements, ensureShortIds } from "./design-edit.mjs";

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-components-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await DesignStore.open(root);
  const backend = createStoreBackend(store);
  await store.create("app", "App");
  const call = async (name, args = {}) => {
    const result = await runTool(backend, name, { document: "app", ...args });
    assert.ok(!result.isError, `${name}: ${result.content?.[0]?.text}`);
    const body = result.content[0].text;
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  };
  const fail = async (name, args = {}) => {
    const result = await runTool(backend, name, { document: "app", ...args });
    assert.equal(result.isError, true, `${name} should fail`);
    return result.content[0].text;
  };
  const doc = async () => (await store.read("app")).document;
  const nodeOf = async (ref) => {
    const d = await doc();
    const page = d.pages[0];
    return indexPage(page).require(ref);
  };
  return { store, backend, call, fail, doc, nodeOf };
}

const SHELL = `<div data-node-label="App Shell" className="flex flex-col w-[800px] bg-[#ffffff]">
  <header data-node-label="Header" className="flex items-center justify-between h-[56px] px-6 bg-[#111827]">
    <p data-node-label="Title" className="text-[#ffffff] text-lg font-semibold">Acme</p>
    <nav data-node-label="Nav" className="flex gap-4"><a className="text-[#d1d5db]">Home</a><a className="text-[#d1d5db]">Docs</a></nav>
  </header>
  <div data-node-label="Body" className="flex">
    <aside data-node-label="Sidebar" className="flex flex-col gap-2 w-[200px] p-4 bg-[#f3f4f6]"><p>Overview</p><p>Settings</p></aside>
    <main data-node-label="Content" className="flex flex-col gap-4 p-8 grow"><p data-node-label="Placeholder">Page content</p></main>
  </div>
</div>`;

/** An App Shell main with a Content slot; returns the ids. */
async function shell(call) {
  const art = await call("create_artboard", { code: SHELL });
  const shellId = art.trees[0].id;
  const tree = await call("get_element_tree", { ids: [shellId] });
  const idOf = (label) =>
    new RegExp(`data-node-id="([a-z.]+)" data-node-label="${label}"`).exec(tree)[1];
  const made = await call("create_component", { ids: [shellId] });
  assert.equal(made.id, shellId);
  assert.equal(made.wrapped, false);
  const slot = await call("set_slot", { id: idOf("Content"), name: "Content" });
  assert.equal(slot.slot, true);
  return { shellId, contentId: idOf("Content"), titleId: idOf("Title"), headerId: idOf("Header") };
}

test("the tool set lists the component tools and the server version moved on", () => {
  for (const name of [
    "list_components",
    "create_component",
    "create_instance",
    "detach_instance",
    "reset_overrides",
    "set_slot",
  ])
    assert.ok(TOOL_NAMES.includes(name), name);
  assert.equal(SERVER_VERSION, "0.9.0");
});

test("create_component, set_slot, create_instance and list_components on the file backend", async (t) => {
  const { call, fail, doc } = await setup(t);
  const { shellId, contentId } = await shell(call);
  const home = await call("create_instance", { component: shellId, label: "Home" });
  assert.match(home.id, /^[a-z]{3}$/);
  assert.equal(home.component.id, shellId);
  assert.deepEqual(
    home.slots.map((s) => [s.name, s.state]),
    [["Content", "default"]],
  );
  assert.match(home.code, /data-instance-of="[a-z]{3}"/);
  const byName = await call("create_instance", { component: "App Shell", x: 0, y: 2000 });
  const listed = await call("list_components");
  assert.equal(listed.components.length, 1);
  const [main] = listed.components;
  assert.equal(main.name, "App Shell");
  assert.deepEqual(
    main.slots.map((s) => [s.id, s.name]),
    [[contentId, "Content"]],
  );
  assert.deepEqual(
    main.instances.map((i) => i.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    [home.id, byName.id].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  assert.equal(
    main.instances.find((i) => i.id === home.id).name,
    "Home",
    "the label is an override",
  );
  assert.equal(main.instances.find((i) => i.id === home.id).overrideCount, 1);
  const tree = await call("get_element_tree", { ids: [home.id], depth: 1 });
  assert.match(
    tree,
    new RegExp(
      `^<div data-node-id="${home.id}" data-node-label="Home" data-instance-of="${shellId}">`,
    ),
  );
  const role = await call("list_components", { id: home.slots[0].id });
  assert.deepEqual([role.role, role.main.name, role.slot.state], ["slot", "App Shell", "default"]);
  // The instance is a full materialized copy: every layer of the main is there.
  const d = await doc();
  const page = d.pages[0],
    index = indexPage(page);
  assert.equal(
    index.descendants(index.require(home.id).id).length,
    index.descendants(index.require(shellId).id).length,
  );
  assert.match(
    await fail("create_instance", { component: "Nope" }),
    /No main component "Nope"; mains: "App Shell"/,
  );
  assert.match(
    await fail("set_slot", { id: home.id }),
    /Slots are set on the main component|slot must be inside a main/,
  );
});

test("create_component wraps several layers in a frame first", async (t) => {
  const { call, doc } = await setup(t);
  const art = await call("create_artboard", {
    code: '<div data-node-label="Board" className="flex flex-col gap-3 p-6 w-[400px]"><p>One</p><p>Two</p><p>Three</p></div>',
  });
  const tree = await call("get_element_tree", { ids: [art.trees[0].id] });
  const ids = [...tree.matchAll(/<p data-node-id="([a-z.]+)"/g)].map((m) => m[1]);
  const made = await call("create_component", { ids: ids.slice(0, 2), label: "Pair" });
  assert.equal(made.wrapped, true);
  const d = await doc();
  const index = indexPage(d.pages[0]);
  const frame = index.require(made.id);
  assert.deepEqual([frame.type, frame.component, frame.name], ["frame", true, "Pair"]);
  assert.deepEqual(
    index.children(frame.id).map((n) => n.text),
    ["One", "Two"],
  );
  assert.equal(
    index.children(index.require(art.trees[0].id).id).length,
    2,
    "the wrapper took the place of the two layers",
  );
});

test("editing an instance layer through update_elements marks an override and survives main edits", async (t) => {
  const { call, nodeOf } = await setup(t);
  const { shellId, titleId, headerId } = await shell(call);
  const inst = await call("create_instance", { component: shellId });
  const tree = await call("get_element_tree", { ids: [inst.id] });
  const instTitle = /data-node-id="([a-z.]+)" data-node-label="Title"/.exec(tree)[1];
  const instHeader = /data-node-id="([a-z.]+)" data-node-label="Header"/.exec(tree)[1];
  await call("update_elements", { edit: `{/* edit ${instTitle} */}\n<p>Acme Docs</p>` });
  let title = await nodeOf(instTitle);
  assert.equal(title.text, "Acme Docs");
  assert.ok(title.overrides.includes("text"), `text override: ${title.overrides}`);
  // Layout written by the headless reflow is not an override: a taller first item moves the second one down.
  const [first, second] = [
    ...tree.matchAll(/<p data-node-id="([a-z.]+)" data-node-label="(?:Overview|Settings)"/g),
  ].map((m) => m[1]);
  const y0 = (await nodeOf(second)).y;
  await call("update_elements", {
    edit: `{/* edit ${first} */}\n<p>Overview<br />of every<br />project</p>`,
  });
  assert.ok((await nodeOf(second)).y > y0, "the reflow moved the next item");
  assert.ok((await nodeOf(first)).overrides.includes("text"));
  for (const n of [await nodeOf(instHeader), title, await nodeOf(second)])
    assert.ok(
      !(n.overrides || []).some((k) => ["x", "y", "measured"].includes(k)),
      `${n.name}: ${n.overrides}`,
    );
  // The main changes: every non-overridden key follows, the overridden text stays.
  await call("update_elements", {
    edit: `{/* edit ${titleId} */}\n<p className="text-[#fbbf24]">Acme Inc</p>\n{/* edit ${headerId} */}\n<header className="bg-[#1e3a8a]"></header>`,
  });
  title = await nodeOf(instTitle);
  assert.equal(title.text, "Acme Docs");
  assert.equal((await nodeOf(instHeader)).color, (await nodeOf(headerId)).color);
  assert.equal((await nodeOf(instHeader)).color, "#1e3a8a");
  // reset_overrides brings the main's text back.
  const reset = await call("reset_overrides", { ids: [instTitle] });
  assert.equal(reset.clearedOverrides, 1);
  title = await nodeOf(instTitle);
  assert.equal(title.text, "Acme Inc");
  assert.equal(title.overrides, undefined);
});

test("inserting into an instance slot makes it Modified; other inherited parts get a note, deletes hide", async (t) => {
  const { call, nodeOf, doc } = await setup(t);
  const { shellId, contentId } = await shell(call);
  const inst = await call("create_instance", { component: shellId });
  const slotId = inst.slots[0].id;
  const report = await call("update_elements", {
    edit: `{/* insert as last child of ${slotId} */}\n<h1 data-node-label="Heading">Dashboard</h1>`,
  });
  assert.doesNotMatch(report, /notes:|WARNINGS/);
  const slot = await nodeOf(slotId);
  assert.deepEqual(slot.overrides, ["children"]);
  const d = await doc();
  const index = indexPage(d.pages[0]);
  assert.deepEqual(
    index.children(slot.id).map((n) => n.name),
    ["Placeholder", "Heading"],
    "the default content becomes local",
  );
  assert.ok(index.children(slot.id).every((n) => !n.sourceId));
  // The main's slot keeps its default content and later main edits leave the Modified slot alone.
  await call("update_elements", {
    edit: `{/* insert as last child of ${contentId} */}\n<p data-node-label="Default footer">Footer</p>`,
  });
  const after = indexPage((await doc()).pages[0]);
  assert.deepEqual(
    after.children(slot.id).map((n) => n.name),
    ["Placeholder", "Heading"],
  );
  assert.equal((await call("list_components", { id: slotId })).slot.state, "modified");
  // Outside the slot: a note (not a codec warning), and the layer stays local to the instance.
  const tree = await call("get_element_tree", { ids: [inst.id] });
  const nav = /data-node-id="([a-z.]+)" data-node-label="Nav"/.exec(tree)[1];
  const noted = await call("update_elements", {
    edit: `{/* insert as last child of ${nav} */}\n<a data-node-label="Extra">Extra</a>`,
  });
  assert.match(noted, /notes: .*inherited part of instance .*set_slot/);
  assert.doesNotMatch(noted, /WARNINGS/);
  const extra = indexPage((await doc()).pages[0])
    .children((await nodeOf(nav)).id)
    .find((n) => n.name === "Extra");
  assert.ok(extra && !extra.sourceId, "a local layer in the instance");
  // Deleting an inherited layer hides it.
  const title = /data-node-id="([a-z.]+)" data-node-label="Title"/.exec(tree)[1];
  const deleted = await call("update_elements", { edit: `{/* delete ${title} */}` });
  assert.match(deleted, /notes: .*hides it in this instance/);
  const hidden = await nodeOf(title);
  assert.equal(hidden.hidden, true);
  assert.ok(hidden.overrides.includes("hidden"));
});

test("JSX: component attributes round-trip, and new instances fill slots by name", async (t) => {
  const { call, nodeOf, doc } = await setup(t);
  const { shellId, contentId } = await shell(call);
  const code = (await call("get_element_code", { ids: [shellId] })).results[0].code;
  assert.match(
    code,
    new RegExp(`data-node-id="${shellId}" data-node-label="App Shell" data-component="true"`),
  );
  assert.match(
    code,
    new RegExp(
      `data-node-id="${contentId.replace(".", "\\.")}" data-node-label="Content" data-slot="Content"`,
    ),
  );
  // A new instance written as JSX: the label and classes become overrides, the slot gets its content.
  const art = await call("create_artboard", {
    code: `<div data-instance-of="${shellId}" data-node-label="Settings" className="w-[1000px]" data-component-x="0" data-component-y="3000">
    <div data-slot="Content"><h1 data-node-label="Settings title">Settings</h1><p>Manage your workspace.</p></div>
  </div>`,
  });
  assert.deepEqual(art.warnings, []);
  const inst = await nodeOf(art.trees[0].id);
  assert.equal(inst.instanceOf, (await nodeOf(shellId)).id);
  assert.equal(inst.name, "Settings");
  assert.equal(inst.w, 1000);
  assert.deepEqual([inst.x, inst.y], [0, 3000]);
  assert.ok(inst.overrides.includes("name") && inst.overrides.includes("w"), `${inst.overrides}`);
  const info = componentInfo(await doc(), inst.id);
  assert.deepEqual(
    info.slots.map((s) => [s.name, s.state]),
    [["Content", "modified"]],
  );
  const index = indexPage((await doc()).pages[0]);
  assert.deepEqual(
    index.children(info.slots[0].id).map((n) => n.name),
    ["Settings title", "Manage your workspace."],
  );
  // Reading it back: the instance names its main, the slot copy says it is modified.
  const instCode = (await call("get_element_code", { ids: [art.trees[0].id] })).results[0].code;
  assert.match(instCode, new RegExp(`data-instance-of="${shellId}"`));
  assert.match(instCode, /data-slot="Content" data-slot-state="modified"/);
  // An instance by main name inside another frame, with an unknown slot: a codec warning.
  const warned = await call("create_artboard", {
    code: `<div data-node-label="Wrap" className="flex flex-col w-[900px]"><div data-instance-of="App Shell"><div data-slot="Sidebar"><p>x</p></div><p>stray</p></div></div>`,
  });
  assert.ok(
    warned.WARNINGS.some((w) => /no slot named "Sidebar" \(slots: "Content"\)/.test(w)),
    warned.WARNINGS.join("\n"),
  );
  assert.ok(
    warned.WARNINGS.some((w) => /<p> ignored; an instance's layers come from its main/.test(w)),
    warned.WARNINGS.join("\n"),
  );
  // Unknown main: the directive fails.
  const bad = await runTool((await setup(t)).backend, "create_artboard", {
    document: "app",
    code: '<div data-instance-of="nope" />',
  });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /data-instance-of="nope": no main component/);
});

test("JSX: a slot attribute outside a main is dropped with a warning; edits set mains and slots", async (t) => {
  const { call, nodeOf } = await setup(t);
  const art = await call("create_artboard", {
    code: '<div data-node-label="Card" className="flex flex-col p-4 w-[300px]"><div data-node-label="Body" data-slot="Body"><p>Hi</p></div></div>',
  });
  assert.ok(
    art.WARNINGS.some((w) =>
      /data-slot on "Body" ignored: a slot must be inside a main component/.test(w),
    ),
  );
  const card = art.trees[0].id;
  const tree = await call("get_element_tree", { ids: [card] });
  const body = /data-node-id="([a-z.]+)" data-node-label="Body"/.exec(tree)[1];
  assert.equal((await nodeOf(body)).slot, undefined);
  await call("update_elements", {
    edit: `{/* edit ${card} */}\n<div data-component="true"><div data-node-id="${body}" data-slot="Card body"></div></div>`,
  });
  assert.equal((await nodeOf(card)).component, true);
  assert.deepEqual([(await nodeOf(body)).slot, (await nodeOf(body)).slotName], [true, "Card body"]);
  // An edit cannot turn a plain frame into an instance.
  const refused = await call("update_elements", {
    edit: `{/* edit ${body} */}\n<div data-instance-of="${card}"></div>\n{/* edit ${card} */}\n<div data-node-label="Card"></div>`,
  });
  assert.match(refused, /FAIL 1\. .*is not an instance/);
  // A main inside a new artboard and an instance of it in the same batch.
  const both = await call("create_artboard", {
    code: `<div data-node-id="zza" data-node-label="Badge" data-component="true" className="flex px-2 py-1 bg-[#e0e7ff]"><p>New</p></div><div data-node-label="Uses" className="flex gap-2 w-[300px]" data-component-x="0" data-component-y="900"><div data-instance-of="zza"></div><div data-instance-of="zza"></div></div>`,
  });
  assert.deepEqual(both.warnings, []);
  const usesCode = (await call("get_element_code", { ids: [both.trees[1].id] })).results[0].code;
  assert.equal(
    (usesCode.match(new RegExp(`data-instance-of="${both.trees[0].id}"`, "g")) || []).length,
    2,
  );
});

test("JSX: an instance of a main on another page names the main by its long id", async (t) => {
  const { call, doc } = await setup(t);
  const { shellId } = await shell(call);
  const page = await call("create_page", { name: "Screens" });
  const inst = await call("create_instance", { pageId: page.pageId, component: shellId });
  assert.equal(inst.component.id, shellId);
  const mainId = indexPage((await doc()).pages[0]).require(shellId).id;
  const code = (await call("get_element_code", { pageId: page.pageId, ids: [inst.id] })).results[0]
    .code;
  assert.match(code, new RegExp(`data-instance-of="${mainId}"`));
  const again = await call("create_artboard", {
    pageId: page.pageId,
    code: `<div data-instance-of="${mainId}" data-component-x="0" data-component-y="2000" />`,
  });
  assert.equal(indexPage((await doc()).pages[1]).require(again.trees[0].id).instanceOf, mainId);
});

test("JSX round trip keeps mains, instances and slot content", () => {
  const made =
    jsxToDocument(`<div data-node-id="abc" data-node-label="Shell" data-component="true" className="flex flex-col w-[400px]"><div data-node-label="Main" data-slot="Main" className="p-4"><p>Default</p></div></div>
<div data-node-id="def" data-node-label="Page" data-instance-of="abc" data-component-x="600" data-component-y="0"><div data-node-label="Main" data-slot="Main"><p>Own</p></div></div>`);
  assert.deepEqual(made.warnings, []);
  const page = made.document.pages[0];
  const shell = page.nodes.find((n) => n.component === true);
  const inst = page.nodes.find((n) => n.instanceOf === shell.id);
  assert.ok(inst);
  const again = jsxToDocument(documentToJsx(made.document, page.id));
  assert.deepEqual(again.warnings, []);
  const p2 = again.document.pages[0];
  const shell2 = p2.nodes.find((n) => n.component === true);
  const inst2 = p2.nodes.find((n) => n.instanceOf === shell2.id);
  const isUnder = (n, root) => {
    for (let cur = n; cur; cur = p2.nodes.find((x) => x.id === cur.parentId))
      if (cur === root) return true;
    return false;
  };
  const texts = (root) =>
    p2.nodes.filter((n) => n.type === "text" && isUnder(n, root)).map((n) => n.text);
  assert.deepEqual(texts(inst2), ["Own"]);
  assert.deepEqual(texts(shell2), ["Default"]);
  assert.ok(
    p2.nodes.find((n) => n.slot === true && isUnder(n, inst2)).overrides.includes("children"),
  );
});

test("duplicate_elements: a main duplicates as an instance, an instance keeps its overrides and slot content", async (t) => {
  const { call, nodeOf, doc } = await setup(t);
  const { shellId } = await shell(call);
  const dupMain = await call("duplicate_elements", { id: shellId });
  const copy = await nodeOf(dupMain.newDuplicateIds[0]);
  assert.equal(copy.component, undefined);
  assert.equal(copy.instanceOf, (await nodeOf(shellId)).id);
  assert.equal(copy.name, "App Shell", 'the "copy" label follows the main');
  const inst = await call("create_instance", { component: shellId, label: "Home" });
  await call("update_elements", {
    edit: `{/* insert as last child of ${inst.slots[0].id} */}\n<p data-node-label="Hello">Hello</p>`,
  });
  const dup = await call("duplicate_elements", { id: inst.id, overrides: { label: "Home 2" } });
  const twin = await nodeOf(dup.newDuplicateIds[0]);
  assert.equal(twin.name, "Home 2");
  assert.ok(twin.overrides.includes("name"));
  const info = componentInfo(await doc(), twin.id);
  assert.equal(info.slots[0].state, "modified");
  const index = indexPage((await doc()).pages[0]);
  assert.deepEqual(
    index.children(info.slots[0].id).map((n) => n.name),
    ["Placeholder", "Hello"],
  );
  assert.equal((await call("list_components")).components[0].instances.length, 3);
});

test("a main may not contain an instance of itself", async (t) => {
  const { call, fail } = await setup(t);
  const { shellId, contentId } = await shell(call);
  assert.match(
    await fail("create_instance", { component: shellId, parent: contentId }),
    /cannot contain an instance of itself/,
  );
  const report = await fail("update_elements", {
    edit: `{/* insert as last child of ${contentId} */}\n<div data-instance-of="${shellId}" />`,
  });
  assert.match(report, /FAIL 1\..*cannot contain an instance of itself/);
  // Nested mains: a Card main inside the shell is fine, the shell inside the card is not.
  const card = await call("create_artboard", {
    code: '<div data-node-label="Card" data-component="true" className="p-4 w-[200px]"><p>Card</p></div>',
  });
  await call("create_instance", { component: card.trees[0].id, parent: contentId });
  assert.match(
    await fail("create_instance", { component: shellId, parent: card.trees[0].id }),
    /cannot contain an instance of itself/,
  );
});

test("detach_instance turns an instance into plain layers and keeps slot content", async (t) => {
  const { call, fail, nodeOf, doc } = await setup(t);
  const { shellId } = await shell(call);
  const inst = await call("create_instance", { component: shellId });
  await call("update_elements", {
    edit: `{/* insert as last child of ${inst.slots[0].id} */}\n<p data-node-label="Mine">Mine</p>`,
  });
  const tree = await call("get_element_tree", { ids: [inst.id] });
  const title = /data-node-id="([a-z.]+)" data-node-label="Title"/.exec(tree)[1];
  assert.match(await fail("detach_instance", { ids: [title] }), /is inside instance/);
  await call("detach_instance", { ids: [inst.id] });
  const d = await doc();
  const index = indexPage(d.pages[0]);
  const root = await nodeOf(inst.id);
  for (const n of [root, ...index.descendants(root.id)])
    for (const key of ["instanceOf", "sourceId", "overrides", "slot", "slotName"])
      assert.equal(n[key], undefined, `${n.name}.${key}`);
  assert.ok(index.descendants(root.id).some((n) => n.name === "Mine"));
  assert.equal((await call("list_components")).components[0].instances.length, 0);
  assert.match(await fail("detach_instance", { ids: [inst.id] }), /is not an instance/);
});

test("reset_overrides on a slot returns it to the default content; all resets a whole instance", async (t) => {
  const { call, doc } = await setup(t);
  const { shellId } = await shell(call);
  const inst = await call("create_instance", { component: shellId, label: "Docs" });
  const slotId = inst.slots[0].id;
  await call("update_elements", {
    edit: `{/* insert as last child of ${slotId} */}\n<p data-node-label="Mine">Mine</p>`,
  });
  await call("reset_overrides", { ids: [slotId] });
  let info = componentInfo(await doc(), indexPage((await doc()).pages[0]).require(slotId).id);
  assert.equal(info.slot.state, "default");
  const index = indexPage((await doc()).pages[0]);
  assert.deepEqual(
    index.children(index.require(slotId).id).map((n) => n.name),
    ["Placeholder"],
  );
  const tree = await call("get_element_tree", { ids: [inst.id] });
  const title = /data-node-id="([a-z.]+)" data-node-label="Title"/.exec(tree)[1];
  await call("update_elements", { edit: `{/* edit ${title} */}\n<p>Docs</p>` });
  assert.equal(
    (await call("reset_overrides", { ids: [title], all: true })).clearedOverrides,
    2,
    "the label and the text",
  );
  info = componentInfo(await doc(), index.require(inst.id).id);
  assert.equal(info.overrideCount, 0);
  assert.equal(indexPage((await doc()).pages[0]).require(inst.id).name, "App Shell");
});

test("HTML export: instances export as plain layers with their slot content and no link fields", async (t) => {
  const { call, doc } = await setup(t);
  const { shellId } = await shell(call);
  const inst = await call("create_instance", { component: shellId });
  await call("update_elements", {
    edit: `{/* insert as last child of ${inst.slots[0].id} */}\n<p data-node-label="Exported">Slot text exported</p>`,
  });
  const d = await doc();
  const root = indexPage(d.pages[0]).require(inst.id);
  for (const lossless of [false, true]) {
    const html = exportHTML(d, d.pages[0].id, { nodeId: root.id, lossless });
    assert.match(html, /Slot text exported/);
    assert.doesNotMatch(
      html,
      /instanceOf|sourceId|overrides|slotName|&quot;component&quot;|&quot;slot&quot;/,
      `lossless ${lossless}`,
    );
  }
});

test("design-edit duplicateElements adopts copies without the tool layer", () => {
  const doc = {
    version: 2,
    name: "D",
    activePage: "p",
    tokens: {},
    pages: [
      {
        id: "p",
        name: "P",
        nodes: [
          {
            id: "m",
            type: "frame",
            name: "Main",
            parentId: null,
            x: 0,
            y: 0,
            w: 100,
            h: 50,
            color: "#ffffff",
            layout: "free",
            component: true,
          },
          {
            id: "t",
            type: "text",
            name: "T",
            parentId: "m",
            x: 0,
            y: 0,
            w: 50,
            h: 20,
            color: "#000000",
            text: "Hi",
          },
        ],
      },
    ],
  };
  ensureShortIds(doc);
  const out = duplicateElements(doc, "p", "m");
  const copy = out.created[0];
  assert.equal(copy.instanceOf, "m");
  assert.equal(copy.sourceId, "m");
  const kid = out.document.pages[0].nodes.find((n) => n.parentId === copy.id);
  assert.equal(kid.sourceId, "t");
  assert.match(kid.id, /^[^~]+~/, "derived id of (root, source)");
});
