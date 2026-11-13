import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DesignStore } from "./design-store.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store: await DesignStore.open(root) };
}
test("atomic CRUD persists across instances, detects conflict and deletes descendants", async (t) => {
  const { root, store } = await fixture(t);
  const first = await store.create("landing", "Landing page");
  const pageId = first.document.pages[0].id;
  const edited = await store.update("landing", first.revision, [
    { type: "create_node", pageId, node: { id: "frame", type: "frame", name: "Frame" } },
    {
      type: "create_node",
      pageId,
      node: { id: "child", name: "Title", type: "text", parentId: "frame", text: "Hello" },
    },
    { type: "set_token", name: "brand", value: "#123456" },
  ]);
  assert.deepEqual(await store.list(), ["landing"]);
  assert.equal(
    (await (await DesignStore.open(root)).read("landing")).document.pages[0].nodes.length,
    2,
  );
  await assert.rejects(
    store.update("landing", first.revision, [{ type: "rename_document", name: "Lost update" }]),
    /Revision conflict/,
  );
  const deleted = await store.update("landing", edited.revision, [
    { type: "delete_node", pageId, nodeId: "frame" },
  ]);
  assert.equal(deleted.document.pages[0].nodes.length, 0);
});
test("invalid batches roll back, cycle and invalid page rejection", async (t) => {
  const { store } = await fixture(t);
  const first = await store.create("doc", "Doc"),
    pageId = first.document.pages[0].id;
  await assert.rejects(
    store.update("doc", first.revision, [
      { type: "rename_document", name: "Must not persist" },
      { type: "create_node", pageId, node: { id: "cycle", type: "frame", parentId: "cycle" } },
    ]),
    /cycle/,
  );
  assert.equal((await store.read("doc")).document.name, "Doc");
  await assert.rejects(
    store.update("doc", first.revision, [{ type: "delete_page", pageId }]),
    /1–100/,
  );
});
test("rejects traversal, symlinks and overwrite", async (t) => {
  const { root, store } = await fixture(t);
  await assert.rejects(store.create("../escape", "Escaped"), /letters/);
  await store.create("existing", "Existing");
  await assert.rejects(store.create("existing", "Overwrite"), /already exists/);
  await fs.symlink(
    path.join(root, "existing.verynize.json"),
    path.join(root, "link.verynize.json"),
  );
  await assert.rejects(store.read("link"), /regular document/);
});
test("files stay pretty-printed; a document whose pretty form exceeds 20 MiB is written compact and reopens", async (t) => {
  const { root, store } = await fixture(t);
  const small = await store.create("small", "Small");
  assert.match(
    await fs.readFile(path.join(root, "small.verynize.json"), "utf8"),
    /\n  "version": 2/,
  );
  const LIMIT = 20 * 1024 * 1024,
    pages = Array.from({ length: 10 }, (_, p) => ({ id: "p" + p, name: "Page " + p, nodes: [] }));
  const doc = { ...small.document, pages };
  const node = (p, i) => ({
    id: `n${p}-${i}`,
    type: "rectangle",
    name: "Box ".repeat(45),
    text: "x".repeat(120),
    x: i,
    y: i,
    w: 10,
    h: 10,
    opacity: 1,
    rotation: 0,
  });
  let size = Buffer.byteLength(JSON.stringify(doc)),
    count = 0;
  for (let i = 0; size < LIMIT - 400000; i++)
    for (let p = 0; p < 10 && size < LIMIT - 400000; p++) {
      const n = node(p, i);
      pages[p].nodes.push(n);
      size += Buffer.byteLength(JSON.stringify(n)) + 1;
      count++;
    }
  assert.ok(
    Buffer.byteLength(JSON.stringify(doc, null, 2)) > LIMIT,
    "precondition: pretty form is over the limit",
  );
  await store.mutate("small", async () => doc);
  const bytes = await fs.readFile(path.join(root, "small.verynize.json"), "utf8");
  assert.ok(Buffer.byteLength(bytes) <= LIMIT);
  assert.equal(
    (await (await DesignStore.open(root)).read("small")).document.pages.reduce(
      (n, p) => n + p.nodes.length,
      0,
    ),
    count,
  );
});
