// Hosted MCP endpoint (cloud/mcp.js, POST /api/mcp) on the real Worker bundle in Miniflare:
// handshake, tool listing, authentication, listing/reading rooms, edits that live sockets receive
// as `ops` and that persist, role checks (viewer, other account), creating rooms in the personal
// organization, unavailable tools and JSON-RPC edge cases.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, cloudOptions, passwordUser, signIn } from "./cloud-harness.mjs";
import { noisePng } from "./helpers/png.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-mcp-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
const ORIGIN = "http://localhost";
const local = (url, init) => mf.dispatchFetch(url, init);
const send = (route, { method = "GET", body, session, headers = {} } = {}) =>
  mf.dispatchFetch(ORIGIN + route, {
    method,
    headers: {
      "content-type": "application/json",
      ...(session ? { "x-verynize-session": session } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const data = async (response, status) => {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return text ? JSON.parse(text) : null;
};

let nextId = 1;
/** One JSON-RPC request to /api/mcp with a bearer token; returns the parsed response body. */
async function mcp(token, method, params, { status = 200, headers = {} } = {}) {
  const response = await mf.dispatchFetch(ORIGIN + "/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) }),
  });
  const text = await response.text();
  assert.equal(response.status, status, text);
  return text ? JSON.parse(text) : null;
}
/** tools/call; returns {isError, text, json} where json is the parsed text when it is JSON. */
async function call(token, name, args = {}) {
  const { result, error } = await mcp(token, "tools/call", { name, arguments: args });
  assert.equal(error, undefined, JSON.stringify(error));
  const text = result.content.map((c) => c.text || "").join("\n");
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { isError: !!result.isError, text, json: parsed, meta: result._meta };
}

async function connect(roomId, session) {
  const upgrade = await mf.dispatchFetch(
    `${ORIGIN}/api/rooms/${roomId}/socket?session=${encodeURIComponent(session)}&client=editor1`,
    { headers: { Upgrade: "websocket" } },
  );
  assert.equal(upgrade.status, 101, "socket upgrade");
  const socket = upgrade.webSocket;
  const seen = [];
  const waiters = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    // A message goes to one waiter or into `seen`, never both: otherwise a later next() could
    // return a message an earlier next() already consumed (only when it arrived after the wait).
    const waiter = waiters.find((w) => w.predicate(message));
    if (!waiter) return void seen.push(message);
    waiters.splice(waiters.indexOf(waiter), 1);
    waiter.resolve(message);
  });
  socket.accept();
  return {
    socket,
    next: (predicate) =>
      new Promise((resolve, reject) => {
        const found = seen.find(predicate);
        if (found) {
          seen.splice(seen.indexOf(found), 1);
          return resolve(found);
        }
        const timer = setTimeout(() => reject(Error("Timed out waiting for socket message")), 8000);
        waiters.push({
          predicate,
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
        });
      }),
  };
}

const designDocument = (name) => ({
  version: 2,
  name,
  pages: [{ id: "page-1", name: "Page 1", nodes: [] }],
  tokens: {},
});

try {
  const ana = await passwordUser(ORIGIN, "ana@example.test", "Ana", local, "192.0.2.1");
  const dodi = await passwordUser(ORIGIN, "dodi@example.test", "Dodi", local, "192.0.2.2");
  const eva = await passwordUser(ORIGIN, "eva@example.test", "Eva", local, "192.0.2.3");
  const anaMe = await data(await send("/api/me", { session: ana }), 200);

  // Authentication: no token, a garbage token and a room capability token are all refused.
  const anonymous = await mf.dispatchFetch(ORIGIN + "/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get("www-authenticate") || "", /^Bearer realm="verynize"/);
  assert.equal((await anonymous.json()).error.code, -32000);
  await mcp("not-a-token", "tools/list", null, { status: 401 });
  const room = await data(
    await send("/api/rooms", {
      method: "POST",
      session: ana,
      body: { document: designDocument("Launch page") },
    }),
    201,
  );
  await mcp(room.token, "tools/list", null, { status: 401 });
  // GET (SSE stream) is not offered; foreign browser origins are refused.
  const get = await mf.dispatchFetch(ORIGIN + "/api/mcp", {
    headers: { authorization: `Bearer ${ana}`, accept: "text/event-stream" },
  });
  assert.equal(get.status, 405);
  assert.match(get.headers.get("allow") || "", /POST/);
  await mcp(ana, "ping", null, { status: 403, headers: { origin: "https://evil.example" } });

  // Handshake.
  const init = await mcp(ana, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(init.result.serverInfo.name, "verynize");
  assert.deepEqual(init.result.capabilities.tools, { listChanged: false });
  assert.match(init.result.instructions, /Hosted server \(headless\)/);
  assert.equal(init.result._meta["verynize/headless"], true);
  const unknownVersion = await mcp(ana, "initialize", { protocolVersion: "1999-01-01" });
  assert.equal(unknownVersion.result.protocolVersion, "2025-11-25");
  const initialized = await mf.dispatchFetch(ORIGIN + "/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ana}` },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  assert.equal(initialized.status, 202);
  assert.equal(await initialized.text(), "");
  assert.deepEqual((await mcp(ana, "ping")).result, {});
  assert.equal((await mcp(ana, "resources/list")).error.code, -32601);
  await mcp(ana, "ping", null, { status: 400, headers: { "mcp-protocol-version": "1999-01-01" } });
  // X-Verynize-Session works like Authorization.
  assert.ok(
    (await mcp(null, "tools/list", null, { headers: { "x-verynize-session": ana } })).result.tools
      .length,
  );

  // tools/list mirrors the shared tool definitions minus what needs the desktop app.
  const tools = (await mcp(ana, "tools/list")).result.tools;
  const names = tools.map((t) => t.name);
  for (const name of [
    "get_design_context",
    "create_artboard",
    "update_elements",
    "get_element_code",
    "list_documents",
    "create_document",
    "read_document",
    "apply_operations",
    "get_icons",
    "export_jsx",
  ])
    assert.ok(names.includes(name), `tools/list has ${name}`);
  for (const name of [
    "take_screenshot",
    "ask_agent",
    "import_html",
    "run_terminal_command",
    "save_design_preference",
  ])
    assert.ok(!names.includes(name), `tools/list omits ${name}`);
  const createArtboard = tools.find((t) => t.name === "create_artboard");
  assert.equal(createArtboard.inputSchema.type, "object");
  assert.deepEqual(createArtboard.inputSchema.required, ["code"]);
  assert.ok(createArtboard.inputSchema.properties.document);
  const screenshot = await call(ana, "take_screenshot", { id: "abc" });
  assert.equal(screenshot.isError, true);
  assert.match(screenshot.text, /unavailable on the hosted/);
  assert.equal((await mcp(ana, "tools/call", { name: "no_such_tool" })).error.code, -32602);
  const invalid = await call(ana, "get_element_code", { ids: [] });
  assert.equal(invalid.isError, true);
  assert.match(invalid.text, /Invalid arguments/);

  // list_documents = the account's rooms, with organization and editor URL.
  const listed = await call(ana, "list_documents");
  assert.equal(listed.isError, false, listed.text);
  assert.equal(listed.json.headless, true);
  const entry = listed.json.documents.find((d) => d.name === room.id);
  assert.ok(entry, "room listed");
  assert.equal(entry.title, "Launch page");
  assert.equal(entry.role, "owner");
  assert.equal(entry.organizationId, anaMe.personalOrganizationId);
  assert.equal(entry.url, `${ORIGIN}/#room=${room.id}`);

  // Read: the only room is the default; the context names it.
  const context = await call(ana, "get_design_context", {});
  assert.equal(context.isError, false, context.text);
  assert.match(context.text, new RegExp(`"name": "${room.id}"`));
  assert.match(context.text, /"headless": true/);
  const read = await call(ana, "read_document", { name: room.id });
  assert.equal(read.json.document.name, "Launch page");

  // An edit through tools/call reaches a connected editor as `ops` and persists.
  const editor = await connect(room.id, ana);
  await editor.next((m) => m.type === "snapshot");
  const created = await call(ana, "create_artboard", {
    document: room.id,
    code: '<div data-node-label="Hero" className="w-[480px] bg-white p-8 flex flex-col gap-4"><h1 className="text-3xl font-bold text-slate-900">Ship faster</h1><Icon name="lucide:arrow-right" className="size-5 text-slate-900" /></div>',
  });
  assert.equal(created.isError, false, created.text);
  assert.equal(created.json.live, false);
  const heroId = created.json.trees[0].id;
  const ops = await editor.next((m) => m.type === "ops");
  assert.match(ops.client, /^mcp-/);
  assert.ok(ops.ops.some((op) => op.t === "add" && op.value?.name === "Hero"));
  assert.ok(ops.revision >= 1);
  const stored = await data(await send(`/api/rooms/${room.id}`, { session: ana }), 200);
  const nodes = stored.document.pages[0].nodes;
  assert.ok(nodes.some((n) => n.name === "Hero"));
  assert.ok(nodes.some((n) => n.type === "text" && n.text === "Ship faster"));
  assert.ok(
    nodes.some((n) => n.type === "image" && (n.src || "").startsWith("data:image/svg+xml")),
  );

  // An embedded photo in the JSX becomes a room asset (cloud/inline-binaries.js): the room and the
  // live editor receive its URL, never the data URI.
  const photo = noisePng(64, 64);
  const photoArt = await call(ana, "create_artboard", {
    document: room.id,
    code: `<div data-node-label="Photo" className="w-[200px] h-[200px]"><img src="data:image/png;base64,${photo.toString("base64")}" alt="Noise" className="w-[64px] h-[64px]" /></div>`,
  });
  assert.equal(photoArt.isError, false, photoArt.text);
  const photoOps = await editor.next((m) => m.type === "ops");
  assert.ok(!JSON.stringify(photoOps).includes("data:image/png"), "no data URI over the socket");
  const withPhoto = await data(await send(`/api/rooms/${room.id}`, { session: ana }), 200);
  const photoNode = withPhoto.document.pages[0].nodes.find(
    (n) => n.type === "image" && n.name !== "Icon" && !String(n.src).startsWith("data:image/svg"),
  );
  assert.match(
    photoNode?.src || "",
    new RegExp(`/api/rooms/${room.id}/assets/[0-9a-f-]{36}\\?sig=[0-9a-f]{64}$`),
    JSON.stringify(photoNode),
  );
  const photoBytes = Buffer.from(await (await mf.dispatchFetch(photoNode.src)).arrayBuffer());
  assert.ok(photoBytes.equals(photo), "the asset holds the photo's bytes");

  // A directive edit; the editor sees a text change and the code reads back.
  const headline = nodes.find((n) => n.type === "text").shortId;
  const edit = await call(ana, "update_elements", {
    document: room.id,
    edit: `{/* edit ${heroId}.${headline} */}\n<h1>Ship today</h1>`,
  });
  assert.equal(edit.isError, false, edit.text);
  assert.match(edit.text, /OK/);
  const textOps = await editor.next((m) => m.type === "ops");
  assert.ok(
    textOps.ops.some((op) => op.key === "text" && op.value === "Ship today"),
    JSON.stringify(textOps),
  );
  const code = await call(ana, "get_element_code", { document: room.id, ids: [heroId] });
  assert.match(code.text, /Ship today/);
  const jsx = await call(ana, "export_jsx", { name: room.id });
  assert.equal(jsx.isError, false, jsx.text);
  assert.match(jsx.json.code, /Ship today/);
  const css = await call(ana, "export_css", { name: room.id });
  assert.equal(css.isError, false, css.text);
  assert.match(css.json.html, /Ship today/);
  const icons = await call(ana, "get_icons", { query: "arrow", set: "ph", limit: 2 });
  assert.equal(icons.isError, false, icons.text);
  assert.ok(icons.json.icons[0].name.startsWith("ph:"));
  // An edit by the editor client is visible to the next MCP read (no stale cache).
  editor.socket.send(
    JSON.stringify({
      type: "ops",
      batch: 1,
      ops: [{ t: "doc", key: "name", value: "Launch page v2" }],
    }),
  );
  await editor.next((m) => m.type === "ops" && m.client === "editor1");
  const renamed = await call(ana, "read_document", { name: room.id });
  assert.equal(renamed.json.document.name, "Launch page v2");
  const finished = await call(ana, "finish_artboard", {
    document: room.id,
    id: heroId,
    reviewNote: "Checked hierarchy and spacing",
  });
  assert.equal(finished.isError, false, finished.text);
  assert.equal(finished.json.status, "unverified");
  assert.equal(finished.json.headless, true);

  // A viewer reads but cannot edit; nothing reaches the editor.
  await data(
    await send(`/api/rooms/${room.id}/members`, {
      method: "POST",
      session: ana,
      body: { email: "dodi@example.test", role: "viewer" },
    }),
    200,
  );
  const viewerRooms = await call(dodi, "list_documents");
  assert.equal(viewerRooms.json.documents.find((d) => d.name === room.id)?.role, "viewer");
  const viewerRead = await call(dodi, "get_artboards", { document: room.id });
  assert.equal(viewerRead.isError, false, viewerRead.text);
  assert.equal(viewerRead.json.artboards[0].label, "Hero");
  const viewerEdit = await call(dodi, "rename_elements", {
    document: room.id,
    renames: [{ id: heroId, label: "Hacked" }],
  });
  assert.equal(viewerEdit.isError, true);
  assert.match(viewerEdit.text, /viewer\) cannot edit/);
  const afterViewer = await data(await send(`/api/rooms/${room.id}`, { session: ana }), 200);
  assert.ok(afterViewer.document.pages[0].nodes.some((n) => n.name === "Hero"));
  assert.ok(!afterViewer.document.pages[0].nodes.some((n) => n.name === "Hacked"));

  // Another account cannot read a room it has no access to, nor see it listed.
  const foreign = await call(eva, "read_document", { name: room.id });
  assert.equal(foreign.isError, true);
  assert.match(foreign.text, /no access/);
  const foreignEdit = await call(eva, "create_page", { document: room.id, name: "Mine" });
  assert.equal(foreignEdit.isError, true);
  assert.ok(!(await call(eva, "list_documents")).json.documents.some((d) => d.name === room.id));
  const noDefault = await call(eva, "get_design_context", {});
  assert.equal(noDefault.isError, true);
  assert.match(noDefault.text, /create_document/);

  // create_document makes a room in the personal organization, listed by /api/me/rooms.
  const made = await call(eva, "create_document", { title: "Eva board", name: "ignored" });
  assert.equal(made.isError, false, made.text);
  assert.equal(made.json.headless, true);
  assert.equal(made.json.role, "owner");
  const evaMe = await data(await send("/api/me", { session: eva }), 200);
  assert.equal(made.json.organizationId, evaMe.personalOrganizationId);
  const evaRooms = await data(await send("/api/me/rooms", { session: eva }), 200);
  const madeRoom = evaRooms.rooms.find((r) => r.id === made.json.roomId);
  assert.ok(madeRoom, "created room is listed");
  assert.equal(madeRoom.organizationId, evaMe.personalOrganizationId);
  assert.equal(madeRoom.role, "owner");
  const madeState = await data(await send(`/api/rooms/${made.json.roomId}`, { session: eva }), 200);
  assert.equal(madeState.document.name, "Eva board");
  assert.equal(madeState.role, "owner");
  // The only room is now the default document.
  const page = await call(eva, "create_page", { name: "Second" });
  assert.equal(page.isError, false, page.text);
  const opened = await call(eva, "open_document", { name: made.json.roomId });
  assert.equal(opened.json.url, `${ORIGIN}/#room=${made.json.roomId}`);
  assert.equal(
    (await call(eva, "create_document", { title: "Elsewhere", organizationId: "nope" })).isError,
    true,
  );

  // Low-level revision-checked operations work against room documents.
  const raw = await call(eva, "read_document", {});
  const applied = await call(eva, "apply_operations", {
    revision: raw.json.revision,
    operations: [{ type: "rename_document", name: "Eva board 2" }],
  });
  assert.equal(applied.isError, false, applied.text);
  const stale = await call(eva, "apply_operations", {
    revision: raw.json.revision,
    operations: [{ type: "rename_document", name: "Stale" }],
  });
  assert.equal(stale.isError, true);
  assert.match(stale.text, /Revision conflict/);
  // The organization index follows the new title.
  const renamedRooms = await data(await send("/api/me/rooms", { session: eva }), 200);
  assert.equal(renamedRooms.rooms.find((r) => r.id === made.json.roomId).title, "Eva board 2");

  // Legacy (magic-link) sessions work too; batches answer every request.
  const legacy = await signIn(ORIGIN, "lena@example.test", local);
  const batch = await mf.dispatchFetch(ORIGIN + "/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${legacy.session}` },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: "a", method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      {
        jsonrpc: "2.0",
        id: "b",
        method: "tools/call",
        params: { name: "list_documents", arguments: {} },
      },
    ]),
  });
  const answers = await data(batch, 200);
  assert.deepEqual(
    answers.map((a) => a.id),
    ["a", "b"],
  );
  assert.deepEqual(JSON.parse(answers[1].result.content[0].text).documents, []);
  const badJson = await mf.dispatchFetch(ORIGIN + "/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ana}` },
    body: "{",
  });
  assert.equal(badJson.status, 400);
  assert.equal((await badJson.json()).error.code, -32700);

  editor.socket.close();
  console.log(
    "PASS hosted MCP: auth (401 + WWW-Authenticate, capability tokens refused), handshake, tools/list subset, list/read rooms, edits broadcast as ops and persisted, embedded photos stored as room assets, icons, viewer/other-account refused, create_document in personal organization, apply_operations revisions, legacy sessions, batches",
  );
} finally {
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
