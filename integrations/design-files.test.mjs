import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { DesignStore } from "./design-store.mjs";
import files from "../desktop/design-files.cjs";
const { DesignFileSession } = files;
test("desktop file session watches MCP atomic writes and refuses stale saves", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-watch-"));
  let resolveChange;
  const changed = new Promise((resolve) => (resolveChange = resolve));
  const session = new DesignFileSession((event) => resolveChange(event));
  t.after(async () => {
    session.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const store = await DesignStore.open(root),
    first = await store.create("shared", "Shared");
  await session.open(path.join(root, "shared.verynize.json"));
  await store.update("shared", first.revision, [
    { type: "rename_document", name: "Changed by MCP" },
  ]);
  const timeout = setTimeout(() => resolveChange({ error: "Watch timeout" }), 2000);
  const event = await changed;
  clearTimeout(timeout);
  assert.ok(!event.error, event.error);
  assert.equal(event.document.name, "Changed by MCP");
  await assert.rejects(session.save(first.document), /changed on disk/);
  const accepted = await session.reload();
  assert.equal(accepted.document.name, "Changed by MCP");
  accepted.document.name = "Changed by desktop";
  await session.save(accepted.document);
  assert.equal((await store.read("shared")).document.name, "Changed by desktop");
});
test("native file session validates filenames, supports new file and refuses symlinks", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-save-")),
    session = new DesignFileSession();
  t.after(async () => {
    session.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const doc = {
    version: 2,
    name: "New",
    pages: [{ id: "page", name: "Page", nodes: [] }],
    tokens: {},
  };
  await assert.rejects(session.save(doc, path.join(root, "arbitrary.json")), /verynize/);
  const saved = await session.save(doc, path.join(root, "new.verynize.json"));
  assert.equal(saved.document.name, "New");
  await fs.symlink(saved.path, path.join(root, "link.verynize.json"));
  await assert.rejects(session.open(path.join(root, "link.verynize.json")), /regular document/);
});
