import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createArtboards, elementCode } from "./design-edit.mjs";
import { replaceInElement } from "./replace-in-element.mjs";
import { DesignStore } from "./design-store.mjs";
import { createStoreBackend, runTool } from "./design-tools.mjs";

function fixture() {
  return createArtboards(
    {
      version: 2,
      name: "Test",
      activePage: "p",
      pages: [{ id: "p", name: "Page", nodes: [] }],
      tokens: {},
    },
    "p",
    '<div className="w-[400px] h-[300px]"><p>Hello</p><p>Untouched</p></div>',
  );
}
test("unique replacement round-trips and preserves descendant ids", () => {
  const { document, page, roots } = fixture();
  const before = JSON.stringify(document);
  const result = replaceInElement(document, "p", roots[0].id, ">Hello<", ">Welcome<");
  assert.match(result.result.code, /Welcome/);
  assert.deepEqual(
    result.document.pages[0].nodes.map((n) => n.id),
    page.nodes.map((n) => n.id),
  );
  assert.equal(JSON.stringify(document), before);
  const again = replaceInElement(result.document, "p", roots[0].id, ">Welcome<", ">Hello<");
  assert.equal(again.result.code, elementCode(document, page, roots[0]));
});
for (const [old, replacement, message] of [
  ["absent", "x", /matched 0 times/],
  ["data-node-id", "x", /matched 3 times/],
  [">Hello<", "<p>", /Expected a tag or attribute name/],
  [">Hello<", "</p></div><div>", /Expected a tag or attribute name/],
]) {
  test(`rejects ${old} -> ${replacement} without mutation`, () => {
    const { document, roots } = fixture();
    const before = JSON.stringify(document);
    assert.throws(() => replaceInElement(document, "p", roots[0].id, old, replacement), message);
    assert.equal(JSON.stringify(document), before);
  });
}
test("real file backend runTool smoke: revision check, replacement and hint", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vn-replace-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const backend = createStoreBackend(await DesignStore.open(dir));
  const run = (name, args) => runTool(backend, name, args);
  const json = (r) => {
    assert.ok(!r.isError, r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
  json(await run("create_document", { name: "doc", title: "Doc" }));
  const created = json(
    await run("create_artboard", {
      document: "doc",
      code: '<div className="w-[400px] h-[300px]"><p>Hello</p></div>',
    }),
  );
  const state = await backend.read("doc");
  const args = {
    document: "doc",
    id: created.trees[0].id,
    old: ">Hello<",
    new: ">Welcome<",
    revision: state.revision,
  };
  const out = json(await run("replace_in_element", args));
  assert.match(out.code, /Welcome/);
  assert.match(out.nextStep, /take_screenshot/);
  const rejected = await run("replace_in_element", args);
  assert.equal(rejected.isError, true);
  assert.match(rejected.content[0].text, /Revision conflict/);
  assert.equal((await backend.read("doc")).revision, out.revision);
});

test("get_element_code revision drives replacement; hints reuse the tool's document", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vn-replace-rev-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const backend = createStoreBackend(await DesignStore.open(dir));
  let reads = 0;
  const read = backend.read.bind(backend);
  backend.read = (...a) => (reads++, read(...a));
  const run = (name, args) => runTool(backend, name, args);
  const json = (r) => {
    assert.ok(!r.isError, r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
  json(await run("create_document", { name: "doc", title: "Doc" }));
  const id = json(
    await run("create_artboard", {
      document: "doc",
      code: '<div className="w-[400px] h-[300px]"><p>Hello</p></div>',
    }),
  ).trees[0].id;
  reads = 0;
  const code = json(await run("get_element_code", { document: "doc", ids: [id] }));
  assert.equal(reads, 1, "the hint must not read the document a second time");
  assert.ok(code.revision, "get_element_code returns the revision replace_in_element checks");
  assert.doesNotMatch(
    code.nextStep || "",
    /take_screenshot/,
    "read-only tools get no finish hints",
  );
  const out = json(
    await run("replace_in_element", {
      document: "doc",
      id,
      old: ">Hello<",
      new: ">Hi<",
      revision: code.revision,
    }),
  );
  assert.match(out.code, />Hi</);
  const loose = json(
    await run("replace_in_element", { document: "doc", id, old: ">Hi<", new: ">Yo<" }),
  );
  assert.match(loose.code, />Yo</, "revision is optional");
});

test("real stdio exposes and executes exact replacement", async (t) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const dir = await mkdtemp(path.join(os.tmpdir(), "vn-replace-stdio-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const client = new Client({ name: "replace-smoke", version: "1" });
  t.after(() => client.close());
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["integrations/mcp-server.mjs", "--root", dir],
      stderr: "pipe",
      env: { ...process.env, VERYNIZE_MCP_FILE: path.join(dir, "no-bridge.json") },
    }),
  );
  const call = async (name, args) => {
    const out = await client.callTool({ name, arguments: args });
    assert.ok(!out.isError, out.content[0].text);
    return JSON.parse(out.content[0].text);
  };
  await call("create_document", { name: "doc", title: "Doc" });
  const created = await call("create_artboard", {
    document: "doc",
    code: '<div className="w-[400px] h-[300px]"><p>Hello</p></div>',
  });
  const state = await call("read_document", { name: "doc" });
  const out = await call("replace_in_element", {
    document: "doc",
    id: created.trees[0].id,
    old: ">Hello<",
    new: ">Welcome<",
    revision: state.revision,
  });
  assert.match(out.code, /Welcome/);
  assert.match(out.nextStep, /take_screenshot/);
});

test("outside-element guard rejects sibling changes after component synchronization", () => {
  const { document, page } = fixture();
  const child = page.nodes.find((n) => n.text === "Hello");
  const result = replaceInElement(document, "p", child.id, ">Hello<", ">Welcome<");
  const sibling = result.document.pages[0].nodes.find((n) => n.text === "Untouched");
  assert.deepEqual(
    sibling,
    page.nodes.find((n) => n.id === sibling.id),
  );
  sibling.text = "Changed outside";
  assert.throws(() => result.guard(result.document), /outside the element/);
});

test("rejects extra root elements rather than dropping them", () => {
  const { document, page, roots } = fixture();
  const code = elementCode(document, page, roots[0]);
  assert.throws(
    () => replaceInElement(document, "p", roots[0].id, code, `${code}<div />`),
    /exactly one JSX element/,
  );
});
