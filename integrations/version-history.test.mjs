// Per-artboard version history (docs/version-history.md): the shared capture rules, pruning and
// restore (web/version-history-core.js), the native-file sidecar (integrations/version-store.mjs)
// and the list_versions / restore_version MCP tools over the store backend.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import * as V from "./version-core.mjs";
import { VersionSidecar, historyDir } from "./version-store.mjs";
import { DesignStore } from "./design-store.mjs";
import { createStoreBackend, runTool } from "./design-tools.mjs";

const node = (id, extra = {}) => ({
  id,
  type: "rectangle",
  name: id,
  parentId: null,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  ...extra,
});
const doc = (nodes) => ({
  version: 2,
  name: "Doc",
  activePage: "p1",
  tokens: {},
  pages: [{ id: "p1", name: "Page 1", nodes }],
});
const board = (id, children = [], extra = {}) => [
  node(id, { type: "frame", w: 400, h: 300, ...extra }),
  ...children.map((child) => node(child, { parentId: id })),
];
const user = { kind: "user", name: "Ada" };
const agent = { kind: "agent", name: "Claude" };
const json = (result) => {
  assert.ok(!result.isError, result.content?.[0]?.text);
  return JSON.parse(result.content[0].text);
};

async function tempDir(t, prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("artboards are top-level frames and changes are reported per artboard", () => {
  const a = doc([...board("A", ["a1", "a2"]), ...board("B", ["b1"]), node("loose")]);
  assert.deepEqual([...V.groups(a.pages[0]).keys()], ["A", "B"]);
  const b = structuredClone(a);
  b.pages[0].nodes.find((n) => n.id === "a2").x = 50;
  b.pages[0].nodes.find((n) => n.id === "loose").x = 99;
  const changed = V.changes(a, b);
  assert.deepEqual(
    changed.map((c) => c.artboardId),
    ["A"],
  );
  assert.equal(changed[0].before.nodes.length, 3);
  assert.equal(changed[0].after.nodes.find((n) => n.id === "a2").x, 50);
  // Deleting an artboard reports it with no `after`.
  const c = doc(board("B", ["b1"]));
  const deleted = V.changes(a, c).find((x) => x.artboardId === "A");
  assert.equal(deleted.after, null);
  assert.equal(deleted.before.nodes.length, 3);
});

test("capture rules: editor switch, idle, agent baseline, delete, restore and finish", () => {
  const state = { last: {}, latest: {} };
  const snap = (x) => ({
    artboardId: "A",
    pageId: "p1",
    index: 0,
    name: "A",
    nodes: board("A", ["a1"]).map((n) => (n.id === "a1" ? { ...n, x } : n)),
  });
  // The user's first edits capture nothing (nothing to undo yet).
  assert.equal(
    V.observe(state, { artboardId: "A", before: snap(0), after: snap(1), author: user, at: 1000 })
      .length,
    0,
  );
  assert.equal(
    V.observe(state, { artboardId: "A", before: snap(1), after: snap(2), author: user, at: 2000 })
      .length,
    0,
  );
  // The agent starts: the user's work (before the agent's edit) is stored in the user's name.
  const switched = V.observe(state, {
    artboardId: "A",
    before: snap(2),
    after: snap(3),
    author: agent,
    at: 3000,
  });
  assert.equal(switched.length, 1);
  assert.equal(switched[0].meta.reason, "switch");
  assert.equal(switched[0].meta.author.name, "Ada");
  assert.equal(switched[0].meta.at, 2000);
  assert.equal(switched[0].snapshot.nodes[1].x, 2);
  // The agent continues within the burst: nothing.
  assert.equal(
    V.observe(state, { artboardId: "A", before: snap(3), after: snap(4), author: agent, at: 4000 })
      .length,
    0,
  );
  // After two idle minutes the next edit closes the earlier burst.
  const idle = V.observe(state, {
    artboardId: "A",
    before: snap(4),
    after: snap(5),
    author: agent,
    at: 4000 + V.IDLE_MS,
  });
  assert.equal(idle.length, 1);
  assert.equal(idle[0].meta.reason, "idle");
  assert.equal(idle[0].meta.author.kind, "agent");
  // The idle timer stores the current state once.
  const timer = V.idle(state, 4000 + 3 * V.IDLE_MS, () => snap(5));
  assert.equal(timer.length, 1);
  assert.equal(V.idle(state, 4000 + 4 * V.IDLE_MS, () => snap(5)).length, 0);
  // Idle settles what it looked at: a deleted artboard is forgotten, a state equal to the newest
  // version counts as seen (no timer loops on either).
  const settled = { last: { X: { author: user, at: 0, hash: "old" } }, latest: {} };
  assert.deepEqual(
    V.idle(settled, V.IDLE_MS, () => null),
    [],
  );
  assert.deepEqual(settled.last, {});
  const seen = {
    last: { A: { author: user, at: 0, hash: "old" } },
    latest: { A: { hash: V.snapshotHash(snap(5)), nodes: 2 } },
  };
  assert.deepEqual(
    V.idle(seen, V.IDLE_MS, () => snap(5)),
    [],
  );
  assert.equal(seen.last.A.hash, seen.latest.A.hash);
  // Identical snapshots are never stored twice.
  assert.equal(
    V.observe(state, {
      artboardId: "A",
      before: snap(5),
      after: snap(6),
      author: user,
      at: 10 ** 7,
    }).length,
    0,
  );
  // Restore stores the replaced state; finish stores the state after.
  const restored = V.observe(state, {
    artboardId: "A",
    before: snap(6),
    after: snap(0),
    author: user,
    at: 10 ** 7 + 1,
    force: "restore",
  });
  assert.equal(restored[0].meta.reason, "restore");
  const finished = V.observe(state, {
    artboardId: "A",
    before: snap(0),
    after: snap(7),
    author: agent,
    at: 10 ** 7 + 2,
    force: "finish",
  });
  assert.equal(finished.at(-1).meta.reason, "finish");
  assert.equal(finished.at(-1).snapshot.nodes[1].x, 7);
  // An agent editing an artboard nobody tracked stores its state first; a deletion always does.
  const fresh = { last: {}, latest: {} };
  const first = V.observe(fresh, {
    artboardId: "A",
    before: snap(8),
    after: snap(9),
    author: agent,
    at: 1,
  });
  assert.equal(first[0].meta.reason, "agent");
  const gone = V.observe(fresh, {
    artboardId: "A",
    before: snap(9),
    after: null,
    author: agent,
    at: 2,
  });
  assert.equal(gone[0].meta.reason, "delete");
  assert.match(first[0].meta.summary, /2 layers/);
});

test("pruning keeps the newest versions and older milestones", () => {
  const HOUR = 3600e3;
  const metas = [];
  // 80 plain versions, one every 10 minutes, plus two old milestones.
  for (let i = 0; i < 80; i++)
    metas.push({ id: `v${i}`, artboardId: "A", at: i * 600e3, reason: "idle" });
  metas.push({ id: "finish", artboardId: "A", at: 5 * 600e3 + 1, reason: "finish" });
  metas.push({ id: "restore", artboardId: "A", at: 1, reason: "restore" });
  metas.push({ id: "other", artboardId: "B", at: 0, reason: "idle" });
  const drop = new Set(V.prune(metas, { max: 50, recent: 20 }));
  const kept = metas.filter((m) => !drop.has(m.id));
  assert.equal(kept.filter((m) => m.artboardId === "A").length, 50);
  assert.ok(kept.some((m) => m.id === "other"));
  for (let i = 60; i < 80; i++) assert.ok(!drop.has(`v${i}`), `recent v${i} kept`);
  assert.ok(!drop.has("finish") && !drop.has("restore"), "milestones kept");
  // The oldest hour still has a representative (time buckets double going back).
  assert.ok(kept.some((m) => m.reason === "idle" && m.at < 6 * 600e3));
  assert.ok(80 * 600e3 > 8 * HOUR);
  assert.deepEqual(V.prune(metas.slice(0, 10)), []);
});

test("restore replaces the subtree in place, re-creates deleted artboards and renames colliding ids", () => {
  const original = doc([...board("A", ["a1", "a2"], { x: 0 }), ...board("B", ["b1"], { x: 600 })]);
  const snap = V.snapshot(original, "A");
  // Edited: a2 removed, a3 added, A moved to the back.
  const edited = doc([
    ...board("B", ["b1"], { x: 600 }),
    node("A", { type: "frame", w: 400, h: 300, x: 5 }),
    node("a1", { parentId: "A", x: 3 }),
    node("a3", { parentId: "A" }),
  ]);
  const r = V.restore(edited, snap);
  const ids = r.document.pages[0].nodes.map((n) => n.id);
  assert.deepEqual(ids, ["B", "b1", "A", "a1", "a2"]);
  assert.equal(r.remapped, 0);
  assert.equal(r.document.pages[0].nodes.find((n) => n.id === "a1").x, 0);
  // Deleted artboard: re-created on its page at its old position.
  const deleted = doc(board("B", ["b1"], { x: 600 }));
  const back = V.restore(deleted, snap);
  assert.deepEqual(
    back.document.pages[0].nodes.map((n) => n.id),
    ["A", "a1", "a2", "B", "b1"],
  );
  // A node of the snapshot now lives in another artboard: the restored one gets a new id.
  const moved = doc([
    ...board("A", ["a1"]),
    node("a2", { parentId: "B" }),
    node("B", { type: "frame" }),
  ]);
  const collide = V.restore(moved, snap);
  assert.equal(collide.remapped, 1);
  const page = collide.document.pages[0].nodes;
  assert.equal(new Set(page.map((n) => n.id)).size, page.length);
  assert.equal(page.filter((n) => n.parentId === "A").length, 2);
  // As a copy: every id is new and the copy sits to the right of the artboard.
  const copy = V.restore(original, snap, { asCopy: true });
  assert.notEqual(copy.artboardId, "A");
  const root = copy.document.pages[0].nodes.find((n) => n.id === copy.artboardId);
  assert.equal(root.x, 480);
  assert.match(root.name, /restored/);
  assert.equal(copy.document.pages[0].nodes.length, 8);
});

test("sidecar stores versions next to the file, prunes and survives reopening", async (t) => {
  const dir = await tempDir(t, "verynize-history-");
  const file = path.join(dir, "home.verynize.json");
  assert.equal(historyDir(file), path.join(dir, "home.verynize.history"));
  const sidecar = new VersionSidecar(file, { max: 5 });
  let current = doc(board("A", ["a1"]));
  for (let i = 0; i < 12; i++) {
    const next = structuredClone(current);
    next.pages[0].nodes[1].x = i + 1;
    // Alternate editors so every edit captures the previous one.
    await sidecar.observe(current, next, i % 2 ? user : agent, { at: 1000 + i });
    current = next;
  }
  const list = await new VersionSidecar(file, { max: 5 }).list("A");
  assert.equal(list.length, 5);
  assert.ok(list[0].at >= list[1].at);
  const files = (await fs.readdir(historyDir(file))).filter(
    (f) => f.endsWith(".json") && f !== "index.json",
  );
  assert.equal(files.length, 5, "pruned snapshots are deleted");
  const got = await sidecar.get(list[0].id);
  assert.equal(got.snapshot.artboardId, "A");
  assert.equal(await sidecar.get("../index"), null);
  // Untrusted entries are validated.
  await assert.rejects(sidecar.add([{ meta: { id: "../x", artboardId: "A" }, snapshot: {} }]));
});

test("a new sidecar ignores itself in git; deleting its .gitignore opts in for good", async (t) => {
  const dir = await tempDir(t, "verynize-history-git-");
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git("init", "-q");
  const file = path.join(dir, "home.verynize.json");
  await fs.writeFile(file, "{}\n");
  git("add", "home.verynize.json");
  git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "design");
  const sidecar = new VersionSidecar(file);
  let current = doc(board("A", ["a1"]));
  const edit = async (who, at) => {
    const next = structuredClone(current);
    next.pages[0].nodes[1].x = at;
    await sidecar.observe(current, next, who, { at });
    current = next;
  };
  await edit(agent, 1);
  await edit(user, 2);
  assert.ok((await sidecar.list("A")).length > 0, "a version was stored");
  assert.equal(
    git("status", "--porcelain", "--untracked-files=all"),
    "",
    "history stays out of git",
  );
  // Deleting the .gitignore opts in; later writes do not put it back.
  await fs.unlink(path.join(historyDir(file), ".gitignore"));
  await edit(agent, 3);
  assert.match(
    git("status", "--porcelain", "--untracked-files=all"),
    /home\.verynize\.history\/index\.json/,
  );
  await assert.rejects(fs.access(path.join(historyDir(file), ".gitignore")));
});

test("MCP list_versions and restore_version (store backend)", async (t) => {
  const root = await tempDir(t, "verynize-history-mcp-");
  const store = await DesignStore.open(root);
  await store.create("home", "Home");
  const backend = createStoreBackend(store, { agentName: "Claude" });
  const created = json(
    await runTool(backend, "create_artboard", {
      code: '<div data-node-label="Hero" className="flex flex-col p-8 w-[400px] h-[300px] bg-white"><p className="text-black">One</p></div>',
    }),
  );
  const id = created.trees[0].id;
  // The user edits the file in the app (simulated: written by another editor), then the agent edits.
  const { document: afterCreate } = await store.read("home");
  const userDoc = structuredClone(afterCreate);
  userDoc.pages[0].nodes.find((n) => n.type === "text").text = "User text";
  await store.mutate("home", async () => userDoc);
  const edit = await runTool(backend, "update_elements", {
    edit: `{/* replace ${id} */}\n<div data-node-label="Hero agent" className="flex flex-col p-8 w-[400px] h-[300px] bg-white"><p className="text-black">Agent</p></div>`,
  });
  assert.ok(!edit.isError, edit.content[0].text);
  const listing = json(await runTool(backend, "list_versions", {}));
  assert.equal(listing.artboards.length, 1);
  const versions = json(await runTool(backend, "list_versions", { artboard: id }));
  assert.ok(versions.total >= 1);
  const before = versions.versions.find((v) => v.summary);
  assert.ok(before);
  // Restore: the subtree returns, and the replaced state becomes a version itself.
  const restored = json(
    await runTool(backend, "restore_version", { artboard: id, version: before.version }),
  );
  assert.equal(restored.restored, before.version);
  const { document } = await store.read("home");
  assert.equal(document.pages[0].nodes.find((n) => n.type === "text").text, "User text");
  const again = json(await runTool(backend, "list_versions", { artboard: id }));
  assert.equal(again.versions[0].reason, "restore");
  assert.equal(again.total, versions.total + 1);
  // Restore that version back (restore is reversible).
  json(
    await runTool(backend, "restore_version", { artboard: id, version: again.versions[0].version }),
  );
  assert.equal(
    (await store.read("home")).document.pages[0].nodes.find((n) => n.type === "text").text,
    "Agent",
  );
  // Deleted artboard: listed by its long id and re-created by restore_version.
  json(await runTool(backend, "delete_elements", { ids: [id] }));
  const gone = json(await runTool(backend, "list_versions", {}));
  const deleted = gone.artboards.find((a) => a.deleted);
  assert.ok(deleted, JSON.stringify(gone));
  const rows = json(await runTool(backend, "list_versions", { artboard: deleted.artboard }));
  json(
    await runTool(backend, "restore_version", {
      artboard: deleted.artboard,
      version: rows.versions[0].version,
    }),
  );
  assert.equal(
    (await store.read("home")).document.pages[0].nodes.filter((n) => !n.parentId).length,
    1,
  );
  // As a copy, and a version of another artboard is refused.
  const copy = json(
    await runTool(backend, "restore_version", {
      artboard: deleted.artboard,
      version: rows.versions[0].version,
      asCopy: true,
    }),
  );
  assert.notEqual(copy.artboard, id);
  const wrong = await runTool(backend, "restore_version", {
    artboard: copy.artboard,
    version: rows.versions[0].version,
  });
  assert.ok(wrong.isError);
  // finish_artboard records a milestone.
  const copyEdit = await runTool(backend, "update_elements", {
    edit: `{/* replace ${copy.artboard} */}\n<div data-node-label="Copy" className="w-[200px] h-[100px] bg-white"></div>`,
  });
  assert.ok(!copyEdit.isError, copyEdit.content[0].text);
  await runTool(backend, "finish_artboard", {
    id: copy.artboard,
    reviewNote: "Checked spacing and contrast.",
  });
  const finished = json(await runTool(backend, "list_versions", { artboard: copy.artboard }));
  assert.ok(
    finished.versions.some((v) => v.reason === "finish"),
    JSON.stringify(finished),
  );
  // The document itself carries no history.
  assert.ok(!JSON.stringify((await store.read("home")).document).includes("versions"));
});
