import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DesignStore } from "./design-store.mjs";
import {
  TOOLS_VERSION,
  INSTRUCTIONS,
  TOOL_NAMES,
  createDesignServer,
  createStoreBackend,
  runTool,
  sessionFor,
} from "./design-tools.mjs";
import { SHELL_TOOL_NAMES } from "./shell-tools.mjs";
import { createPreferenceStore } from "./preferences.mjs";
import { connectBridge, readBridgeFile, startHttpServer, writeBridgeFile } from "./mcp-http.mjs";

// Bridge-only shell tools (integrations/shell-tools.mjs): listed everywhere, usable only through the desktop app.
const SHELL_TOOLS = [
  "get_dev_server",
  "start_dev_server",
  "stop_dev_server",
  "configure_dev_server",
  "propose_preview",
  "preview_open",
  "preview_snapshot",
  "preview_screenshot",
  "preview_click",
  "preview_type",
  "preview_scroll",
  "preview_console",
  "capture_preview_to_canvas",
  "run_terminal_command",
  "read_terminal",
  "execute_action",
];
const EXPECTED_TOOLS = [
  "get_design_context",
  "get_artboards",
  "get_element_tree",
  "get_element_code",
  "find_elements",
  "take_screenshot",
  "create_artboard",
  "replace_in_element",
  "update_elements",
  "duplicate_elements",
  "delete_elements",
  "rename_elements",
  "list_components",
  "create_component",
  "create_instance",
  "detach_instance",
  "reset_overrides",
  "set_slot",
  "finish_artboard",
  "list_versions",
  "restore_version",
  "get_design_guidelines",
  "get_skills",
  "get_icons",
  "search_images",
  "apply_style_tokens",
  "get_design_tokens",
  "create_design_tokens",
  "update_design_tokens",
  "delete_design_tokens",
  "bind_variables",
  "list_documents",
  "open_document",
  "create_document",
  "create_page",
  "rename_page",
  "read_document",
  "apply_operations",
  "save_design_preference",
  "list_design_preferences",
  "update_design_preference",
  "delete_design_preference",
  "generate_image",
  "ask_agent",
  "export_document",
  "export_css",
  "export_jsx",
  "import_html",
  "import_jsx",
  ...SHELL_TOOLS,
];
const SERVER = path.resolve("integrations/mcp-server.mjs");

async function tempDir(t, prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
async function stdioClient(t, args, env = {}) {
  const client = new Client({ name: "test", version: "1" });
  // VERYNIZE_MCP_FILE points at a missing file so a real running app is never contacted.
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER, ...args],
      stderr: "pipe",
      env: {
        ...process.env,
        VERYNIZE_MCP_FILE: path.join(os.tmpdir(), "verynize-no-bridge.json"),
        VERYNIZE_PREFERENCES: path.join(os.tmpdir(), `verynize-test-prefs-${process.pid}.json`),
        ...env,
      },
    }),
  );
  t.after(() => client.close());
  return client;
}
const json = (result) => {
  assert.ok(!result.isError, result.content?.[0]?.text);
  return JSON.parse(result.content[0].text);
};
const call = (client, name, args = {}) => client.callTool({ name, arguments: args });

test("real stdio MCP session (store fallback) exposes the full tool set and edits files", async (t) => {
  const root = await tempDir(t, "verynize-mcp-");
  const client = await stdioClient(t, ["--root", root]);
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    EXPECTED_TOOLS,
  );
  assert.deepEqual(TOOL_NAMES, EXPECTED_TOOLS);

  const created = json(await call(client, "create_document", { name: "home", title: "Home" }));
  assert.equal(created.live, false);
  json(
    await call(client, "create_design_tokens", {
      tokens: [{ name: "color/brand", value: "#FF0066" }],
    }),
  );
  const artboard = json(
    await call(client, "create_artboard", {
      code: '<div data-node-label="Hero" className="flex flex-col gap-4 p-8 w-[600px] bg-[var(--color-brand)]"><h1 className="text-white">Hello MCP</h1><p>Sub &lt;script&gt;</p></div>',
    }),
  );
  const heroId = artboard.trees[0].id;
  assert.match(heroId, /^[a-z]{3}$/);
  assert.match(artboard.trees[0].code, /bg-\[var\(--color-brand\)\]/);

  const context = await call(client, "get_design_context", {});
  assert.match(context.content[0].text, /"headless": true/);
  assert.match(context.content[0].text, /"label": "Hero"/);
  assert.match(
    context.content[0].text,
    /# Design fundamentals/,
    "fundamentals replace the old guidelines",
  );
  const tree = await call(client, "get_element_tree", { ids: [heroId] });
  assert.match(
    tree.content[0].text,
    new RegExp(`<h1 data-node-id="${heroId}\\.[a-z]{3}" data-node-label="Hello MCP">`),
  );
  const found = json(await call(client, "find_elements", { queries: [{ query: "hello" }] }));
  assert.equal(found.matches.length, 1);
  assert.equal(found.matches[0].artboardId, heroId);
  const headingId = found.matches[0].id;

  const update = await call(client, "update_elements", {
    edit: `{/* edit ${headingId} */}\n<h1>Hello live MCP</h1>\n{/* insert as last child of ${heroId} */}\n<button className="bg-[#000000] text-[#ffffff] px-4 py-2">Go</button>\n{/* delete ${heroId}.zzz */}`,
  });
  assert.ok(!update.isError);
  assert.match(update.content[0].text, /2 of 3 directives applied\. 1 failed\./);
  const code = json(await call(client, "get_element_code", { ids: [heroId] }));
  assert.match(code.results[0].code, /Hello live MCP/);
  assert.match(code.results[0].code, /<button/);
  const nothing = await call(client, "update_elements", { edit: `{/* delete ${heroId}.zzz */}` });
  assert.equal(nothing.isError, true);
  assert.match(nothing.content[0].text, /Nothing was changed/);

  const dup = json(
    await call(client, "duplicate_elements", { id: heroId, overrides: { label: "Hero B" } }),
  );
  json(
    await call(client, "rename_elements", {
      renames: [{ id: dup.newDuplicateIds[0], label: "Hero variant" }],
    }),
  );
  json(
    await call(client, "update_design_tokens", {
      tokens: [{ name: "color/brand", newName: "color/accent", value: "#00aa00" }],
    }),
  );
  const shot = await call(client, "take_screenshot", { id: heroId });
  assert.equal(shot.isError, true);
  assert.match(shot.content[0].text, /unavailable in headless mode/);
  assert.equal(
    (await call(client, "finish_artboard", { id: heroId })).isError,
    true,
    "reviewNote is required",
  );
  const finished = json(
    await call(client, "finish_artboard", {
      id: heroId,
      reviewNote: "Checked hierarchy, spacing and contrast.",
    }),
  );
  assert.equal(finished.headless, true);
  assert.equal(finished.status, "unverified");
  assert.match(finished.reasons.join(" "), /no verification receipt/);
  assert.match(finished.designLink.url, new RegExp(`^verynize://node/home/[^/]+/${heroId}$`));
  const page = json(await call(client, "create_page", { name: "Mobile" }));
  json(await call(client, "rename_page", { pageId: page.pageId, name: "Phone" }));

  const saved = JSON.parse(await fs.readFile(path.join(root, "home.verynize.json"), "utf8"));
  assert.equal(saved.pages.length, 2);
  assert.equal(saved.pages[1].name, "Phone");
  assert.deepEqual(saved.tokens, { "color/accent": "#00aa00" });
  const nodes = saved.pages[0].nodes;
  assert.ok(
    nodes.every((n) => /^[a-z]{3,4}$/.test(n.shortId)),
    "short ids persisted",
  );
  assert.equal(
    nodes.find((n) => n.shortId === heroId).color,
    "#00aa00",
    "token-bound color follows token updates",
  );
  assert.ok(nodes.some((n) => n.name === "Hero variant" && !n.parentId));

  // Legacy low-level API still works and is revision checked.
  const raw = json(await call(client, "read_document", { name: "home" }));
  const applied = json(
    await call(client, "apply_operations", {
      name: "home",
      revision: raw.revision,
      operations: [{ type: "rename_document", name: "Renamed" }],
    }),
  );
  assert.equal(applied.document.name, "Renamed");
  const conflict = await call(client, "apply_operations", {
    name: "home",
    revision: raw.revision,
    operations: [{ type: "rename_document", name: "Stale" }],
  });
  assert.equal(conflict.isError, true);
  assert.match(conflict.content[0].text, /Revision conflict/);
  const html = json(await call(client, "export_document", { name: "home" })).html;
  assert.match(html, /Hello live MCP/);
  assert.match(html, /&lt;script&gt;/);

  // Validation: bad names and paths are rejected by schema; open_document needs the app.
  assert.equal(
    (await call(client, "create_document", { name: "../escape", title: "x" })).isError,
    true,
  );
  assert.equal(
    (await call(client, "get_element_code", { document: "home", ids: [] })).isError,
    true,
  );
  assert.match(
    (await call(client, "open_document", { name: "home" })).content[0].text,
    /needs the Verynize desktop app/,
  );
  assert.match(
    (
      await call(client, "update_elements", {
        edit: `{/* insert as last child of ${heroId} */}<div>{items.map(x => x)}</div>`,
      })
    ).content[0].text,
    /no JavaScript|Only string/,
  );
});

test("agents create, update, bind and delete typed variables through the token tools", async (t) => {
  const root = await tempDir(t, "verynize-mcp-vars-");
  const client = await stdioClient(t, ["--root", root]);
  json(await call(client, "create_document", { name: "tokens", title: "Tokens" }));
  const created = json(
    await call(client, "create_design_tokens", {
      tokens: [
        { name: "color/brand", value: "#2348c4" },
        { name: "radius/md", type: "dimension", value: "14px" },
        { name: "leading/body", type: "number", value: 1.5 },
        { name: "font/display", type: "fontFamily", value: "'Instrument Serif'" },
        { name: "weight/strong", type: "fontWeight", value: 600 },
      ],
    }),
  );
  assert.deepEqual(
    created.tokens.map((t) => [t.name, t.type, t.value]),
    [
      ["color/brand", "color", "#2348c4"],
      ["radius/md", "dimension", 14],
      ["leading/body", "number", 1.5],
      ["font/display", "fontFamily", "Instrument Serif"],
      ["weight/strong", "fontWeight", "600"],
    ],
  );
  assert.equal(
    (
      await call(client, "create_design_tokens", {
        tokens: [{ name: "gap/x", type: "dimension", value: "2rem" }],
      })
    ).isError,
    true,
  );
  assert.equal(
    (
      await call(client, "create_design_tokens", {
        tokens: [{ name: "radius/md", type: "dimension", value: 4 }],
      })
    ).isError,
    true,
  );

  const artboard = json(
    await call(client, "create_artboard", {
      code: '<div className="w-[400px] h-[200px] bg-white"><p className="text-black">Hi</p></div>',
    }),
  );
  const card = artboard.trees[0].id;
  json(
    await call(client, "bind_variables", {
      bindings: [{ id: card, property: "radius", token: "radius/md" }],
    }),
  );
  assert.equal(
    (
      await call(client, "bind_variables", {
        bindings: [{ id: card, property: "fontFamily", token: "radius/md" }],
      })
    ).isError,
    true,
    "type mismatch is rejected",
  );
  assert.equal(
    (
      await call(client, "bind_variables", {
        bindings: [{ id: card, property: "radius", token: "color/brand" }],
      })
    ).isError,
    true,
    "colors are not bindable",
  );
  const nodeOf = async () => {
    const d = json(await call(client, "read_document", {})).document;
    return d.pages[0].nodes.find((n) => !n.parentId);
  };
  let node = await nodeOf();
  assert.deepEqual([node.bindings, node.radius], [{ radius: "radius/md" }, 14]);

  json(
    await call(client, "update_design_tokens", {
      tokens: [{ name: "radius/md", newName: "radius/card", value: 20 }],
    }),
  );
  node = await nodeOf();
  assert.deepEqual(
    [node.bindings, node.radius],
    [{ radius: "radius/card" }, 20],
    "bound elements follow value and rename",
  );
  const listed = json(await call(client, "get_design_tokens", {})).tokens;
  assert.ok(listed.some((t) => t.name === "radius/card" && t.cssVar === "var(--radius-card)"));

  json(await call(client, "delete_design_tokens", { names: ["radius/card"] }));
  node = await nodeOf();
  assert.deepEqual(
    [node.bindings, node.radius],
    [undefined, 20],
    "deleting unbinds and keeps the value",
  );
});

test("loopback HTTP bridge requires the bearer token and refuses browser origins", async (t) => {
  const root = await tempDir(t, "verynize-http-");
  const store = await DesignStore.open(root);
  const backend = createStoreBackend(store);
  const server = await startHttpServer({ makeServer: () => createDesignServer({ backend }) });
  t.after(() => server.close());
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  assert.equal((await fetch(server.url, { method: "POST", headers, body })).status, 401);
  assert.equal(
    (
      await fetch(server.url, {
        method: "POST",
        headers: { ...headers, authorization: "Bearer wrong-token-wrong-token" },
        body,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(server.url, {
        method: "POST",
        headers: {
          ...headers,
          authorization: `Bearer ${server.token}`,
          origin: "https://evil.example",
        },
        body,
      })
    ).status,
    403,
  );
  await assert.rejects(
    connectBridge({ url: server.url, token: "not-the-token-at-all" }),
    /401|Unauthorized|invalid bearer/i,
  );

  const client = await connectBridge({ url: server.url, token: server.token });
  t.after(() => client.close());
  assert.deepEqual(
    (await client.listTools()).tools.map((tool) => tool.name),
    EXPECTED_TOOLS,
  );
  json(
    await client.callTool({ name: "create_document", arguments: { name: "web", title: "Web" } }),
  );
  const art = json(
    await client.callTool({
      name: "create_artboard",
      arguments: { document: "web", code: '<div className="w-[100px] h-[100px] bg-[#ff0000]" />' },
    }),
  );
  assert.equal(art.live, false);
  assert.equal((await store.read("web")).document.pages[0].nodes[0].type, "rectangle");
});

test("stdio server proxies to a running bridge and falls back to files when it is gone", async (t) => {
  const bridgeRoot = await tempDir(t, "verynize-bridge-");
  const localRoot = await tempDir(t, "verynize-local-");
  const configDir = await tempDir(t, "verynize-config-");
  const bridgeFile = path.join(configDir, "mcp.json");
  const store = await DesignStore.open(bridgeRoot);
  await store.create("shared", "Shared");
  const server = await startHttpServer({
    makeServer: () => createDesignServer({ backend: createStoreBackend(store) }),
  });
  await writeBridgeFile(bridgeFile, { url: server.url, token: server.token });
  assert.equal((await fs.stat(bridgeFile)).mode & 0o777, 0o600);
  assert.equal((await readBridgeFile(bridgeFile)).token, server.token);

  // No --root: only the bridge can serve this session.
  const proxied = await stdioClient(t, ["--bridge-file", bridgeFile]);
  assert.deepEqual(
    (await proxied.listTools()).tools.map((tool) => tool.name),
    EXPECTED_TOOLS,
  );
  json(
    await call(proxied, "create_artboard", {
      document: "shared",
      code: '<div data-node-label="Via proxy" className="w-[50px] h-[50px]" />',
    }),
  );
  assert.equal(
    (await store.read("shared")).document.pages[0].nodes[0].name,
    "Via proxy",
    "edit landed in the bridge store",
  );
  const badArgs = await call(proxied, "get_element_code", {
    document: "shared",
    ids: "not-an-array",
  });
  assert.equal(badArgs.isError, true);

  // With --root, a session started while the bridge runs falls back to files once it stops.
  await fs.writeFile(
    path.join(localRoot, "local.verynize.json"),
    JSON.stringify({
      version: 2,
      name: "Local",
      pages: [{ id: "p", name: "P", nodes: [] }],
      tokens: {},
    }),
  );
  const hybrid = await stdioClient(t, ["--bridge-file", bridgeFile, "--root", localRoot]);
  assert.ok(
    json(await call(hybrid, "list_documents")).documents.some((d) => d.name === "shared"),
    "served by the bridge",
  );
  await server.close();
  const after = json(await call(hybrid, "list_documents"));
  assert.deepEqual(
    after.documents.map((d) => d.name),
    ["local"],
    "fell back to --root store",
  );

  // A stale bridge file (server gone) is ignored at startup.
  const stale = await stdioClient(t, ["--bridge-file", bridgeFile, "--root", localRoot]);
  assert.deepEqual(
    json(await call(stale, "list_documents")).documents.map((d) => d.name),
    ["local"],
  );
});

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
async function verifiedBackend(t, options = {}) {
  const root = await tempDir(t, "verynize-verify-");
  const store = await DesignStore.open(root);
  const shots = [];
  const backend = createStoreBackend(store, {
    screenshot: async (document, pageId, nodeId) => {
      shots.push(nodeId);
      return {
        data: PNG,
        mimeType: "image/png",
        width: 1,
        height: 1,
        source: "offscreen",
        fonts: { loaded: 1, missing: [] },
        ...(options.bounds ? { bounds: options.bounds(document, nodeId) } : {}),
      };
    },
    ...options,
  });
  await store.create("doc", "Doc");
  const GLOBAL = new Set([
    "get_design_guidelines",
    "get_skills",
    "get_icons",
    "search_images",
    "save_design_preference",
    "list_design_preferences",
    "update_design_preference",
    "delete_design_preference",
    "ask_agent",
    "read_document",
    "apply_operations",
  ]);
  return {
    store,
    backend,
    shots,
    run: (name, args = {}) =>
      runTool(backend, name, GLOBAL.has(name) ? args : { document: "doc", ...args }),
  };
}
const body = (result) =>
  result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
const CARD =
  '<div data-node-label="Pricing card" className="flex flex-col gap-3 p-8 w-[360px] bg-[#ffffff]"><h2 className="text-[24px] text-[#111827]">Team plan for growing studios</h2><p className="text-[16px] text-[#374151]">Shared libraries, review links and unlimited projects for nine seats.</p></div>';

test("knowledge, icon, image and style-token tools", async (t) => {
  const fakePhotos = async (query) => ({
    source: "unsplash",
    results: [
      {
        url: "https://images.unsplash.com/photo-1",
        width: 4000,
        height: 3000,
        alt: `${query} at dusk`,
        author: "Ana Lee",
        source: "unsplash",
        pageUrl: "https://unsplash.com/photos/1",
      },
    ],
  });
  const { run, store } = await verifiedBackend(t, { searchImages: fakePhotos });
  const guidelines = body(
    await run("get_design_guidelines", {
      brief: "landing page for a boutique coffee roaster",
      domain: "landing",
    }),
  );
  assert.match(guidelines, /Suggested styles for the brief/);
  assert.match(guidelines, /^# Design fundamentals/);
  assert.ok(
    guidelines.indexOf("\n\n---\n\n") > guidelines.indexOf("# Design fundamentals"),
    "fundamentals come first, then the separator",
  );
  assert.ok(guidelines.indexOf("Suggested styles") > guidelines.indexOf("\n\n---\n\n"));
  // Fundamentals first, then '---', then the style, then the playbook.
  const styled = body(
    await run("get_design_guidelines", { style: "neo-brutalism", domain: "landing" }),
  );
  const order = [
    "# Design fundamentals",
    "\n\n---\n\n",
    "# Style: Neo-Brutalism (`neo-brutalism`)",
    'apply_style_tokens {style:"neo-brutalism"}',
    "# Playbook: ",
  ].map((marker) => styled.indexOf(marker));
  assert.ok(
    order.every((i) => i >= 0),
    `markers present: ${order.join(",")}`,
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    "fundamentals → --- → style → playbook",
  );
  assert.equal(styled.indexOf("# Design fundamentals"), 0);
  // An older archetype id still resolves, after the separator.
  const legacy = body(await run("get_design_guidelines", { style: "swiss-grid" }));
  assert.ok(
    legacy.indexOf("\n\n---\n\n") < legacy.indexOf("Schibsted Grotesk"),
    "archetype section follows the fundamentals",
  );
  assert.match(legacy, /apply_style_tokens \{style:"swiss-grid"\}/);
  const unknown = body(await run("get_design_guidelines", { style: "no-such-style" }));
  assert.match(unknown, /Unknown style "no-such-style"\. Valid style slugs: academia, art-deco/);
  // No style: the fundamentals and a short note pointing at the styles, no style section.
  const plain = body(await run("get_design_guidelines"));
  assert.equal(plain.indexOf("# Design fundamentals"), 0);
  assert.doesNotMatch(plain, /# Style:/);
  assert.match(plain, /## Notes\n- No style chosen yet[^\n]*swiss-minimalist/);
  assert.match(body(await run("get_skills")), /\*\*new-design\*\*:/);
  assert.match(body(await run("get_skills", { skill: "new-design" })), /# Skill: new-design/);
  assert.match(
    body(await run("get_skills", { name: "new-design" })),
    /# Skill: new-design/,
    "name stays as an alias of skill",
  );
  assert.match(
    body(await run("get_skills", { skill: "variations" })),
    /new-design/,
    "old skill names resolve",
  );
  const missing = await run("get_skills", { skill: "nope" });
  assert.equal(missing.isError, true);
  assert.match(body(missing), /Available: new-design, edit-design/);
  assert.equal((await run("get_skills", { name: "nope" })).isError, true);
  const icons = JSON.parse(
    body(await run("get_icons", { query: "arrow right", set: "lucide", limit: 3 })),
  );
  assert.equal(icons.icons.length, 3);
  assert.match(icons.icons[0].name, /^lucide:/);
  assert.match(icons.icons[0].preview, /^<svg/);
  assert.match(icons.usage, /<Icon name="lucide:/);
  const photos = JSON.parse(
    body(
      await run("search_images", { query: "coffee roastery", orientation: "landscape", count: 1 }),
    ),
  );
  assert.equal(photos.images[0].url, "https://images.unsplash.com/photo-1");
  assert.equal(photos.images[0].attribution, "Photo by Ana Lee on Unsplash");
  const archetype = (await import("./design-knowledge/index.mjs")).listArchetypes()[0].id;
  const applied = JSON.parse(body(await run("apply_style_tokens", { archetype })));
  assert.ok(applied.created.length > 3);
  assert.ok(applied.classes.fonts.length);
  const again = JSON.parse(body(await run("apply_style_tokens", { archetype })));
  assert.equal(again.created.length, 0);
  assert.equal(
    again.kept.length,
    applied.created.length,
    "existing tokens are kept without overwrite",
  );
  assert.ok(
    Object.keys((await store.read("doc")).document.tokens).length >= applied.created.length,
  );
  const badStyle = await run("apply_style_tokens", { archetype: "no-such-style" });
  assert.equal(badStyle.isError, true);
  assert.match(body(badStyle), /Styles: academia, art-deco/);
  assert.equal((await run("apply_style_tokens", {})).isError, true);
  // A style slug applies the palette roles plus the style's extra tokens; translucent rgba() extras keep their alpha.
  const dark = JSON.parse(body(await run("apply_style_tokens", { style: "minimal-dark" })));
  assert.equal(dark.style, "minimal-dark");
  assert.equal(dark.kind, "style");
  const { styleTokens } = await import("./design-knowledge/index.mjs");
  assert.deepEqual(
    dark.created.sort(),
    styleTokens("minimal-dark")
      .colors.map((c) => c.name)
      .filter((n) => !applied.created.includes(n))
      .sort(),
  );
  const stored = (await store.read("doc")).document.tokens;
  assert.equal(
    stored["color/hairline"],
    "#ffffff14",
    "rgba(255,255,255,0.08) is stored as #rrggbbaa",
  );
  assert.match(stored["color/accent"], /^#[0-9a-f]{6}$/);
  assert.ok(dark.classes.fonts.length && dark.classes.radius.length && dark.classes.shadows.length);
});

test("take_screenshot records a receipt and lint; finish gate verifies, goes stale on edit and blocks critical lint", async (t) => {
  const { run, backend, store } = await verifiedBackend(t);
  const created = JSON.parse(body(await run("create_artboard", { code: CARD })));
  const id = created.trees[0].id;
  assert.deepEqual(created.warnings, []);

  // No receipt yet: allowed, but honestly unverified.
  let finish = JSON.parse(
    body(await run("finish_artboard", { id, reviewNote: "Reviewed spacing and contrast." })),
  );
  assert.equal(finish.status, "unverified");
  assert.match(finish.reasons[0], /no verification receipt/);

  const shot = await run("take_screenshot", { id });
  assert.equal(shot.content[0].type, "image");
  const meta = JSON.parse(shot.content[1].text);
  assert.equal(meta.geometry, "estimated");
  assert.equal(meta.lint.critical, 0);
  assert.ok(meta.receipt);
  assert.match(shot.content[2].text, /^Lint /);
  assert.match(shot.content[2].text, /Receipt .* recorded for artboard/);
  assert.ok(sessionFor(backend).receipts.latest("doc", id), "receipt stored");
  finish = JSON.parse(
    body(
      await run("finish_artboard", {
        id: `${id}`,
        reviewNote: "Reviewed hierarchy, spacing rhythm, contrast and copy.",
      }),
    ),
  );
  assert.equal(finish.status, "verified");
  assert.equal(finish.verified, true);
  assert.deepEqual(finish.reasons, []);

  // Any edit invalidates the receipt; finishing again is unverified (stale/missing), not verified.
  const heading = JSON.parse(
    body(await run("find_elements", { queries: [{ query: "Team plan" }] })),
  ).matches[0].id;
  assert.ok(
    !(
      await run("update_elements", {
        edit: `{/* edit ${heading} */}<h2>Team plan for small studios</h2>`,
      })
    ).isError,
  );
  assert.equal(
    sessionFor(backend).receipts.latest("doc", id),
    null,
    "edit invalidated the receipt",
  );
  finish = JSON.parse(body(await run("finish_artboard", { id, reviewNote: "Re-checked." })));
  assert.equal(finish.status, "unverified");

  // A receipt that no longer matches the document revision (changed outside the tools) is stale.
  await run("take_screenshot", { id });
  await store.mutate("doc", async () => {
    const { document } = await store.read("doc");
    document.pages[0].nodes.find((n) => n.text === "Team plan for small studios").text =
      "Team plan";
    return document;
  });
  finish = JSON.parse(body(await run("finish_artboard", { id, reviewNote: "Re-checked." })));
  assert.equal(finish.status, "unverified");
  assert.match(finish.reasons.join(" "), /stale receipt/);

  // Critical lint (white text on white) blocks finishing, without focusing; repairs are capped.
  const bad = JSON.parse(
    body(
      await run("create_artboard", {
        code: '<div data-node-label="Bad" className="flex flex-col p-8 w-[300px] bg-[#ffffff]"><p className="text-[16px] text-[#ffffff]">Invisible launch announcement copy</p></div>',
      }),
    ),
  ).trees[0].id;
  const badShot = await run("take_screenshot", { id: bad });
  assert.ok(JSON.parse(badShot.content[1].text).lint.critical >= 1);
  assert.match(badShot.content[2].text, /CRITICAL[\s\S]*contrast/);
  for (let round = 1; round <= 3; round++) {
    const blocked = await run("finish_artboard", { id: bad, reviewNote: "Checked." });
    assert.equal(blocked.isError, true);
    assert.match(body(blocked), /Finish blocked/);
    assert.match(body(blocked), /contrast/);
    assert.match(body(blocked), new RegExp(`Repair round ${round} of 3`));
  }
  const exhausted = JSON.parse(
    body(await run("finish_artboard", { id: bad, reviewNote: "Checked." })),
  );
  assert.equal(exhausted.status, "unverified");
  assert.match(exhausted.reasons.join(" "), /repair budget exhausted/);
});

test("measured bounds from the backend drive the lint; pending remote images resolve before screenshots", async (t) => {
  const fetched = [];
  const { run, store } = await verifiedBackend(t, {
    bounds: (document, nodeId) =>
      Object.fromEntries(
        document.pages[0].nodes
          .filter((n) => n.id === nodeId || n.parentId === nodeId)
          .map((n) => [
            n.id,
            {
              x: 0,
              y: 0,
              w: n.w,
              h: n.h,
              ...(n.type === "text" ? { scrollWidth: n.w, scrollHeight: n.h } : {}),
            },
          ]),
      ),
    fetchImage: async (url) => {
      fetched.push(url);
      await new Promise((resolve) => setTimeout(resolve, 50));
      return url.includes("missing")
        ? { ok: false, error: "HTTP 404" }
        : { ok: true, dataUrl: `data:image/png;base64,${PNG}` };
    },
  });
  const id = JSON.parse(body(await run("create_artboard", { code: CARD }))).trees[0].id;
  // Simulate the codec's remote image nodes (srcRemote + assetStatus:'pending').
  await store.mutate("doc", async () => {
    const { document } = await store.read("doc");
    const card = document.pages[0].nodes.find((n) => !n.parentId);
    document.pages[0].nodes.push(
      {
        id: "photo-ok",
        type: "image",
        name: "Hero photo",
        parentId: card.id,
        x: 0,
        y: 0,
        w: 100,
        h: 60,
        src: "",
        srcRemote: "https://images.example.com/ok.jpg",
        assetStatus: "pending",
      },
      {
        id: "photo-bad",
        type: "image",
        name: "Gone",
        parentId: card.id,
        x: 0,
        y: 0,
        w: 100,
        h: 60,
        src: "",
        srcRemote: "https://images.example.com/missing.jpg",
        assetStatus: "pending",
      },
    );
    return document;
  });
  assert.ok(
    !(await run("rename_elements", { renames: [{ id, label: "Pricing card v2" }] })).isError,
    "any write queues pending images",
  );
  const shot = await run("take_screenshot", { id });
  assert.equal(JSON.parse(shot.content[1].text).geometry, "measured");
  assert.match(shot.content[2].text, /WARNING images not loaded:[\s\S]*missing: HTTP 404/);
  assert.deepEqual(
    fetched.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ["https://images.example.com/missing.jpg", "https://images.example.com/ok.jpg"],
  );
  const nodes = (await store.read("doc")).document.pages[0].nodes;
  assert.equal(nodes.find((n) => n.id === "photo-ok").assetStatus, "ready");
  assert.match(nodes.find((n) => n.id === "photo-ok").src, /^data:image\/png;base64,/);
  assert.equal(nodes.find((n) => n.id === "photo-bad").assetStatus, "missing");
  const blocked = await run("finish_artboard", { id, reviewNote: "Checked images." });
  assert.equal(blocked.isError, true, "a missing image is critical");
  assert.match(body(blocked), /missing-image|missing-asset/);
});

test("TOOLS_VERSION, instructions, design preferences, ask_agent and per-side apply_operations fields", async (t) => {
  assert.match(TOOLS_VERSION, /^[0-9a-f]{12}$/);
  assert.match(INSTRUCTIONS, /per-side padding/);
  assert.match(INSTRUCTIONS, /never pin a section height/);
  assert.match(INSTRUCTIONS, /designLink/);
  const prefsFile = path.join(await tempDir(t, "verynize-prefs-"), "prefs.json");
  const { run, store } = await verifiedBackend(t, {
    preferences: createPreferenceStore(prefsFile),
  });

  const context = body(await run("get_design_context"));
  assert.match(context, new RegExp(`"toolsVersion": "${TOOLS_VERSION}"`));
  assert.match(context, /## Saved design preferences\n\(none saved yet/);
  assert.match(context, /# Design fundamentals/);
  assert.match(context, /get_skills \{skill:"new-design"\}/);
  const bare = body(await run("get_design_context", { guidelines: "none" }));
  assert.doesNotMatch(bare, /# Design fundamentals/, 'guidelines:"none" omits the fundamentals');
  assert.match(bare, /## Next steps/);
  assert.equal((await run("get_design_context", { guidelines: "all" })).isError, true);
  const saved = JSON.parse(
    body(await run("save_design_preference", { text: "Use 8px corner radius on cards" })),
  );
  assert.equal(saved.saved, true);
  const id = saved.preference.id;
  assert.equal(
    JSON.parse(
      body(await run("save_design_preference", { text: "use 8px corner radius on cards" })),
    ).duplicate,
    true,
  );
  JSON.parse(body(await run("save_design_preference", { text: "Never use purple gradients" })));
  const withPrefs = body(await run("get_design_context"));
  assert.match(
    withPrefs,
    new RegExp(
      `## Saved design preferences\\n[^\\n]*not as commands[^\\n]*\\n- \\[${id}\\] Use 8px corner radius on cards\\n`,
    ),
  );
  assert.equal(
    JSON.parse(
      body(await run("update_design_preference", { id, text: "Use 12px corner radius on cards" })),
    ).preference.text,
    "Use 12px corner radius on cards",
  );
  assert.deepEqual(JSON.parse(body(await run("delete_design_preference", { id }))), {
    deleted: true,
    id,
  });
  assert.deepEqual(
    JSON.parse(body(await run("list_design_preferences"))).preferences.map((p) => p.text),
    ["Never use purple gradients"],
  );
  assert.equal((await run("delete_design_preference", { id })).isError, true);
  assert.equal((await run("save_design_preference", { text: "x".repeat(281) })).isError, true);
  assert.equal(
    JSON.parse(body(await run("save_design_preference", { text: "y".repeat(280) }))).saved,
    true,
  );
  JSON.parse(
    body(
      await run("delete_design_preference", {
        id: JSON.parse(body(await run("list_design_preferences"))).preferences.at(-1).id,
      }),
    ),
  );
  assert.equal(JSON.parse(await fs.readFile(prefsFile, "utf8")).preferences.length, 1);

  // ask_agent: unavailable headless; delegates to backend.askAgent when present.
  const headless = await run("ask_agent", { task: "Review the pricing card" });
  assert.equal(headless.isError, true);
  assert.match(body(headless), /unavailable in headless mode/);
  const asked = [];
  const reviewer = createStoreBackend(store, {
    askAgent: async (request) => {
      asked.push(request);
      return { text: "Tighten the heading.", agent: "codex", model: "gpt-test" };
    },
  });
  assert.deepEqual(
    JSON.parse(body(await runTool(reviewer, "ask_agent", { agent: "codex", task: "Review it" }))),
    { agent: "codex", model: "gpt-test", text: "Tighten the heading." },
  );
  assert.deepEqual(asked, [{ agent: "codex", task: "Review it" }]);
  assert.equal(
    (await runTool(reviewer, "ask_agent", { agent: "gemini", task: "x" })).isError,
    true,
  );

  // apply_operations: per-side padding, gaps, corners, sizing modes, margin, absolute inset.
  const raw = JSON.parse(body(await run("read_document", { name: "doc" })));
  const pageId = raw.document.pages[0].id;
  const ok = await run("apply_operations", {
    name: "doc",
    revision: raw.revision,
    operations: [
      {
        type: "create_node",
        pageId,
        node: {
          id: "sec",
          type: "frame",
          name: "Section",
          w: 800,
          h: 200,
          layout: "block",
          wMode: "fixed",
          hMode: "hug",
          paddingTop: 96,
          paddingBottom: 64,
          paddingLeft: 32,
          paddingRight: 32,
          gapX: 8,
          gapY: 24,
          cornerRadii: [16, 16, 0, 0],
          margin: [0, "auto", 0, "auto"],
          minH: 320,
          maxW: "100%",
        },
      },
      {
        type: "create_node",
        pageId,
        node: {
          id: "tag",
          type: "text",
          name: "Badge",
          parentId: "sec",
          text: "New",
          w: 40,
          h: 20,
          position: "absolute",
          inset: [16, 16, null, null],
          translate: ["-50%", 0],
          textTransform: "uppercase",
          grow: 0,
        },
      },
    ],
  });
  assert.ok(!ok.isError, body(ok));
  const node = (await store.read("doc")).document.pages[0].nodes.find((n) => n.id === "sec");
  assert.equal(node.paddingTop, 96);
  assert.deepEqual(node.cornerRadii, [16, 16, 0, 0]);
  assert.equal(node.hMode, "hug");
  assert.deepEqual(node.margin, [0, "auto", 0, "auto"]);
  const rev = JSON.parse(body(await run("read_document", { name: "doc" }))).revision;
  const bad = await run("apply_operations", {
    name: "doc",
    revision: rev,
    operations: [
      {
        type: "update_node",
        pageId,
        nodeId: "sec",
        properties: { paddingTop: -4, hMode: "stretch", cornerRadii: [1, 2] },
      },
    ],
  });
  assert.equal(bad.isError, true);
  assert.match(body(bad), /paddingTop/);
  assert.match(body(bad), /hMode/);
  assert.match(body(bad), /cornerRadii/);
});

test('shell tools: stdio file mode answers "needs the desktop app"; a bridge shell receives the request access level', async (t) => {
  assert.deepEqual(SHELL_TOOL_NAMES, SHELL_TOOLS);
  assert.match(INSTRUCTIONS, /Running app and editor actions \(desktop app only\)/);
  const root = await tempDir(t, "verynize-shell-");
  const client = await stdioClient(t, ["--root", root]);
  const samples = {
    get_dev_server: {},
    start_dev_server: {},
    stop_dev_server: {},
    configure_dev_server: { command: ["npm", "run", "dev"] },
    propose_preview: { command: ["npm", "run", "dev"], port: 5173 },
    preview_open: { url: "http://localhost:3000" },
    preview_snapshot: {},
    preview_screenshot: {},
    preview_click: { selector: "button" },
    preview_type: { text: "hi", selector: "input" },
    preview_scroll: { deltaY: 200 },
    preview_console: {},
    capture_preview_to_canvas: {},
    run_terminal_command: { argv: ["ls"] },
    read_terminal: {},
    execute_action: {},
  };
  for (const name of SHELL_TOOLS) {
    const result = await call(client, name, samples[name]);
    assert.equal(result.isError, true, name);
    assert.match(
      result.content[0].text,
      new RegExp(`^${name} needs the Verynize desktop app`),
      name,
    );
  }
  // Schema checks still run first: non-localhost URLs and shell strings are refused.
  assert.match(
    (await call(client, "preview_open", { url: "https://example.com" })).content[0].text,
    /localhost/,
  );
  assert.equal((await call(client, "run_terminal_command", { argv: "rm -rf /" })).isError, true);

  // A bridge backend with `shell` gets each call with the per-request access header.
  const store = await DesignStore.open(root);
  const seen = [];
  const backend = {
    ...createStoreBackend(store),
    shell: {
      call: async (op, args, context) => {
        seen.push({ op, args, access: context.access });
        return { op };
      },
    },
  };
  const server = await startHttpServer({
    makeServer: ({ headers }) =>
      createDesignServer({ backend, context: { access: headers["x-verynize-access"] || null } }),
  });
  t.after(() => server.close());
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const http = new Client({ name: "shell-test", version: "1" });
  await http.connect(
    new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${server.token}`, "x-verynize-access": "readonly" },
      },
    }),
  );
  t.after(() => http.close());
  assert.deepEqual(
    json(await http.callTool({ name: "read_terminal", arguments: { id: "dev-server", since: 3 } })),
    { op: "terminalRead" },
  );
  json(await http.callTool({ name: "read_terminal", arguments: { id: "job-1", stop: true } }));
  json(
    await http.callTool({
      name: "run_terminal_command",
      arguments: { argv: ["npm", "test"], background: true },
    }),
  );
  assert.deepEqual(seen, [
    {
      op: "terminalRead",
      args: { id: "dev-server", since: 3, limit: undefined },
      access: "readonly",
    },
    { op: "terminalStop", args: { id: "job-1" }, access: "readonly" },
    { op: "terminalRun", args: { argv: ["npm", "test"], background: true }, access: "readonly" },
  ]);
});
