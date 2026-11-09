require("../web/document-core.js");
const { NODE_LIMITS } = globalThis.VerynizeDocument;
const { onWindowClosed } = require("./window-cleanup.cjs");
/**
 * Verynize live MCP bridge (desktop main process)
 * ====================================================
 * Serves the shared Verynize tool set (integrations/design-tools.mjs) over Streamable HTTP
 * at http://127.0.0.1:<random port>/mcp. Every request needs `Authorization: Bearer <token>`, a
 * random secret created per launch. Tool calls that target the document open in an editor window
 * are relayed over IPC to web/agent-bridge.js, which applies them through the editor's own
 * setDocument path (rendered immediately, one undo step per tool call, persisted like any edit).
 * Calls that name a saved document that is not open, or arrive while no editor is reachable, edit
 * files in "<userData>/documents" through integrations/design-store.mjs ("headless").
 *
 * The URL and token are also written to "<userData>/mcp.json" (mode 0600) so
 * `node integrations/mcp-server.mjs` (stdio) can proxy to this bridge. The file is removed on quit.
 *
 * Public API
 *   startBridge(app, {askAgent}?) -> Promise<{url, token, file, documentsRoot, toolsVersion}>
 *                                                                    once, after app 'ready'. askAgent
 *       ({agent?: 'claude'|'codex', task}) -> Promise<{text, agent, model}> backs the read-only
 *       ask_agent tool (second opinion / design review); calling startBridge again (or
 *       setBridgeOptions) replaces the options. Without it ask_agent reports unavailable.
 *   setBridgeOptions({askAgent, shellExec, confirmExec})             update options at any time
 *   registerWindow(win, {designFiles, trusted})                      per editor BrowserWindow (trusted(event): IPC sender guard)
 *   getBridgeInfo() -> {url, token, file, documentsRoot, toolsVersion} | null   null until started
 *   toolsVersion: TOOLS_VERSION of integrations/design-tools.mjs (also in mcp.json and pushed to
 *   editor windows as the 'info' bridge op -> window.verynizeTools).
 *   stopBridge() -> void                                             closes server, deletes file
 *
 * For agent runtimes (desktop/agents.cjs) use getBridgeInfo():
 *   Claude Code:  --mcp-config '{"mcpServers":{"verynize":{"type":"http","url":"<url>",
 *                   "headers":{"Authorization":"Bearer <token>"}}}}'
 *                 --allowedTools 'mcp__verynize__*'
 *   Codex:        -c mcp_servers.verynize.url="<url>"
 *                 -c mcp_servers.verynize.bearer_token_env_var="VERYNIZE_MCP_TOKEN"
 *                 and set VERYNIZE_MCP_TOKEN=<token> in the child environment.
 * take_screenshot (live): the editor renders the element offscreen (desktop/render.cjs, fonts
 * embedded) and returns the PNG plus measured per-node boxes relative to the element (`bounds`) and
 * missing fonts; the tool layer turns these into a revision-bound receipt and a measured lint.
 *
 * Shell tools (integrations/shell-tools.mjs, desktop/agent-shell.cjs): dev server, running-app
 * preview automation, terminal commands and execute_action. Options: shellExec:false (or env
 * VERYNIZE_SHELL_EXEC=0) refuses commands; confirmExec({title, detail, root, access}) ->
 * boolean|{allowed, remember} replaces the native approval dialog. Requests may send header
 * `x-verynize-access: readonly|ask|edit|auto|full`; see agent-shell.cjs for the policy.
 *
 * Set VERYNIZE_DISABLE_MCP=1 to skip starting the bridge.
 */
const path = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { BrowserWindow } = require("electron");
const { renderHTML } = require("./render.cjs");
const agentShell = require("./agent-shell.cjs"); // running-app / terminal / editor-action tools
const agentUsage = require("./agent-usage.cjs"); // Settings › Usage: AI-generated layer count

const load = (file) => import(pathToFileURL(path.join(__dirname, "../integrations", file)).href);
const SUFFIX = ".verynize.json";
const windows = new Map(); // webContents.id -> {win, designFiles, trusted, pending}
let info = null,
  server = null,
  starting = null,
  lastFocused = null;
const bridgeOptions = { askAgent: null, shellExec: true, confirmExec: null };
function setBridgeOptions(options = {}) {
  if (options && Object.hasOwn(options, "generateImage"))
    bridgeOptions.generateImage =
      typeof options.generateImage === "function" ? options.generateImage : null;
  if (options && Object.hasOwn(options, "askAgent"))
    bridgeOptions.askAgent = typeof options.askAgent === "function" ? options.askAgent : null;
  if (options && Object.hasOwn(options, "shellExec"))
    bridgeOptions.shellExec = options.shellExec !== false;
  if (options && Object.hasOwn(options, "confirmExec"))
    bridgeOptions.confirmExec =
      typeof options.confirmExec === "function" ? options.confirmExec : null;
}
// Tell an editor window which tool generation is serving it (Settings › Agents shows it).
// Called on every did-finish-load and for every window once the bridge starts (a message sent
// before the page's bridge script runs is dropped; that page announces again on did-finish-load).
function announce(entry) {
  if (!info || !entry || entry.win.isDestroyed()) return;
  request(
    entry,
    "info",
    { toolsVersion: info.toolsVersion, serverVersion: info.serverVersion },
    5000,
  ).catch(() => {});
}

function registerWindow(win, { designFiles = null, trusted = null } = {}) {
  const entry = { win, designFiles, trusted, pending: new Map() };
  const id = win.webContents.id;
  windows.set(id, entry);
  lastFocused = id;
  win.on("focus", () => {
    lastFocused = id;
  });
  win.webContents.on("did-finish-load", () => announce(entry));
  win.webContents.ipc.on("bd:mcp-reply", (event, requestId, payload) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      (trusted && !trusted(event))
    )
      return;
    const pending = entry.pending.get(requestId);
    if (!pending || !payload || typeof payload !== "object") return;
    entry.pending.delete(requestId);
    clearTimeout(pending.timer);
    if (payload.ok) pending.resolve(payload.result);
    else
      pending.reject(
        new Error(
          typeof payload.error === "string"
            ? payload.error.slice(0, 2000)
            : "Editor request failed",
        ),
      );
  });
  onWindowClosed(win, () => {
    for (const pending of entry.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Editor window closed"));
    }
    windows.delete(id);
    if (lastFocused === id) lastFocused = null;
  });
}

function activeEditor() {
  const live = [...windows.values()].filter(
    (e) => !e.win.isDestroyed() && !e.win.webContents.isLoading(),
  );
  const focused = BrowserWindow.getFocusedWindow();
  return (
    live.find((e) => focused && e.win === focused) ||
    live.find((e) => e.win.webContents.id === lastFocused) ||
    live[0] ||
    null
  );
}

// The renderer can answer MCP calls a moment before its window finishes loading (custom-protocol
// loads settle later than file:// did); wait briefly for a loading editor instead of failing.
async function editorReady(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const entry = activeEditor();
    if (entry) return entry;
    const loading = [...windows.values()].some(
      (e) => !e.win.isDestroyed() && e.win.webContents.isLoading(),
    );
    if (!loading || Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function request(entry, op, args = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      entry.pending.delete(requestId);
      reject(new Error(`Editor did not answer ${op} within ${timeoutMs / 1000}s`));
    }, timeoutMs);
    entry.pending.set(requestId, { resolve, reject, timer });
    entry.win.webContents.send("bd:mcp-call", { requestId, op, args });
  });
}

const nameFromPath = (file) =>
  typeof file === "string" && path.basename(file).endsWith(SUFFIX)
    ? path.basename(file).slice(0, -SUFFIX.length)
    : null;
const looksLikeDocument = (d) =>
  d &&
  d.version === 2 &&
  Array.isArray(d.pages) &&
  d.pages.length > 0 &&
  d.pages.every((p) => p && Array.isArray(p.nodes));

// Renderer-reported layout boxes: {[nodeId]: {x, y, w, h, scrollWidth?, …}} with finite numbers only.
function validBounds(bounds) {
  if (!bounds || typeof bounds !== "object" || Array.isArray(bounds)) return false;
  const entries = Object.entries(bounds);
  return (
    entries.length > 0 &&
    entries.length <= NODE_LIMITS.perPage &&
    entries.every(([, b]) => b && ["x", "y", "w", "h"].every((k) => Number.isFinite(b[k])))
  );
}

function createLiveBackend({
  store,
  storeBackend,
  tools,
  edit,
  exportHTML,
  validateDocument,
  fonts,
}) {
  const editorState = async (entry) => {
    const state = await request(entry, "state", {}, 4000);
    if (!state || !looksLikeDocument(state.document))
      throw new Error("Editor returned an invalid document");
    return state;
  };
  // Decide whether a call targets the open editor document or a stored file.
  const route = async (ref) => {
    const entry = await editorReady();
    if (!entry) return { live: false };
    let state;
    try {
      state = await editorState(entry);
    } catch {
      return { live: false };
    }
    const openName = nameFromPath(state.file?.nativePath);
    if (!ref || ref === openName) return { live: true, entry, state, name: openName };
    return { live: false };
  };
  // Offscreen fallback (editor not showing the page): exported HTML carries data-id per node, so
  // render.cjs measures real boxes (root rendered at 0,0 = artboard-relative). Fonts are embedded.
  const shot = async (document, pageId, nodeId, scale) => {
    const node = edit.getPage(document, pageId).nodes.find((n) => n.id === nodeId);
    const html = exportHTML(withName(document), pageId, { nodeId });
    const result = await renderHTML({
      html,
      width: Math.max(1, node.w),
      height: Math.max(1, node.h),
      scale,
      screenshot: true,
      fonts: fonts.extractFontFamilies(document),
    });
    return {
      data: result.dataURL.replace(/^data:image\/png;base64,/, ""),
      mimeType: "image/png",
      width: result.width,
      height: result.height,
      scale: result.scale,
      requestedScale: result.requestedScale,
      source: "offscreen",
      ...(validBounds(result.boxes) ? { bounds: result.boxes } : {}),
      fonts: result.fonts,
    };
  };
  const withName = (document) =>
    typeof document.name === "string" && document.name.trim()
      ? document
      : { ...document, name: "Untitled" };
  return {
    mode: "live",
    assets: {
      async put(ref, bytes, type) {
        const target = await route(ref);
        if (!target.live) return storeBackend.assets.put(ref, bytes, type);
        return (await require("./assets.cjs").store()).put(bytes, type);
      },
      async get(ref, asset) {
        const target = await route(ref);
        return target.live ? (await require("./assets.cjs").store()).get(asset) : storeBackend.assets.get(ref, asset);
      },
    },
    shell: agentShell.createShell({
      activeEditor: editorReady,
      request,
      options: () => bridgeOptions,
    }),
    async list() {
      const saved = await storeBackend.list();
      const entry = await editorReady();
      let editor = null;
      if (entry)
        try {
          const state = await editorState(entry);
          editor = {
            title: state.document.name,
            document: nameFromPath(state.file?.nativePath),
            fileId: state.file?.id || null,
            path: state.file?.nativePath || null,
            activePage: state.document.activePage,
            focused: true,
            libraryFiles: (state.files || []).slice(0, 200),
          };
        } catch {}
      return { documents: saved.documents, editor, documentsRoot: store.root, headless: !editor };
    },
    async read(ref) {
      const target = await route(ref);
      if (!target.live) return storeBackend.read(ref);
      return {
        document: target.state.document,
        revision: tools.revisionOf(target.state.document),
        live: true,
        name: target.name,
        selection: target.state.selection || [],
      };
    },
    async transact(ref, fn, options = {}) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const target = await route(ref);
        if (!target.live) {
          // Settings › Usage: count layers the agent added (desktop/agent-usage.cjs)
          let added = 0;
          const result = await storeBackend.transact(
            ref,
            (document, meta) => {
              const before = structuredClone(document);
              const out = fn(document, meta);
              added = agentUsage.countNewNodes(before, out?.document);
              return out;
            },
            options,
          );
          agentUsage.recordGeneratedLayers(added);
          return result;
        }
        const { state, entry } = target;
        const out = fn(structuredClone(state.document), {
          revision: tools.revisionOf(state.document),
        });
        validateDocument(withName(out.document));
        // Version history (web/version-history.js): an agent edit; restore_version marks a restore.
        const history = {
          actor: options.actor || { kind: "agent", name: "Agent" },
          ...(options.force
            ? { force: options.force, artboardId: options.artboardId, label: options.label }
            : {}),
        };
        const reply = await request(
          entry,
          "commit",
          { document: out.document, stamp: state.stamp, ...history },
          15000,
        );
        if (reply?.conflict) continue; // the user edited meanwhile; re-read and re-apply
        const committed = looksLikeDocument(reply?.document) ? reply.document : out.document;
        agentUsage.recordGeneratedLayers(agentUsage.countNewNodes(state.document, committed));
        return {
          result: out.result,
          revision: tools.revisionOf(committed),
          live: true,
          name: target.name,
        };
      }
      throw new Error("The document kept changing in the editor; try again");
    },
    async create(name, title, { open = true } = {}) {
      const created = await storeBackend.create(name, title);
      if (open && (await editorReady()))
        return { ...created, ...(await this.open({ name })), revision: created.revision };
      return created;
    },
    async open({ name, fileId }) {
      const entry = await editorReady();
      if (!entry) throw new Error("No editor window is open");
      if (fileId) {
        await request(entry, "openFile", { fileId }, 15000);
        return { opened: true, fileId, live: true };
      }
      const file = store.file(name);
      const state = entry.designFiles
        ? await entry.designFiles.open(file)
        : { ...(await store.read(name)), path: file };
      await request(entry, "open", { document: state.document, path: file }, 15000);
      return { opened: true, name, path: file, live: true, pageId: state.document.pages[0].id };
    },
    // Version history: the open document's (sidecar, browser storage or room) through the editor,
    // a stored file's sidecar otherwise.
    versions: {
      async list(ref, artboardId) {
        const target = await route(ref);
        if (!target.live) return storeBackend.versions.list(ref, artboardId);
        return (await request(target.entry, "versions", { artboardId }, 15000)).versions;
      },
      async get(ref, id) {
        const target = await route(ref);
        if (!target.live) return storeBackend.versions.get(ref, id);
        return (await request(target.entry, "version", { id }, 15000)).found;
      },
      async capture(ref, artboardId, options = {}) {
        const target = await route(ref);
        if (!target.live) return storeBackend.versions.capture(ref, artboardId, options);
        return (
          await request(
            target.entry,
            "versionCapture",
            { artboardId, reason: options.reason, label: options.label },
            15000,
          )
        ).versions;
      },
    },
    async focus(ref, pageId, nodeId) {
      const target = await route(ref);
      if (!target.live) return { focused: false };
      return request(target.entry, "focus", { pageId, nodeId }, 5000);
    },
    async generateImage(options) {
      if (!bridgeOptions.generateImage)
        throw new Error("Image generation needs the Verynize desktop app");
      const entry = await editorReady();
      if (!entry) throw new Error("Image generation needs an open Verynize desktop editor");
      const image = await bridgeOptions.generateImage(options);
      return entry.win.webContents.executeJavaScript(
        `(async()=>{const blob=await (await fetch(${JSON.stringify(image.src)})).blob();return window.imageUpload.prepare(new File([blob], 'generated.png', {type:blob.type}));})()`,
      );
    },
    async askAgent({ agent, task }) {
      if (typeof bridgeOptions.askAgent !== "function")
        throw new Error(
          "ask_agent is unavailable: this Verynize build has no reviewer agent configured",
        );
      const reply = await bridgeOptions.askAgent({ agent, task });
      return typeof reply === "string" ? { text: reply, agent: agent || null, model: null } : reply;
    },
    async screenshot(ref, pageId, nodeId, scale, state) {
      if (state.live) {
        const entry = await editorReady();
        try {
          const result =
            entry && (await request(entry, "screenshot", { pageId, nodeId, scale }, 60000));
          if (result?.dataURL?.startsWith("data:image/png;base64,"))
            return {
              data: result.dataURL.slice("data:image/png;base64,".length),
              mimeType: "image/png",
              width: result.width,
              height: result.height,
              scale: result.scale,
              requestedScale: result.requestedScale,
              source: "editor",
              ...(validBounds(result.bounds) ? { bounds: result.bounds } : {}),
              ...(result.fonts ? { fonts: result.fonts } : {}),
            };
        } catch {}
      }
      if (!state.live) {
        const { copyAssets, sidecarAssets } = await import("../integrations/asset-store.mjs");
        await copyAssets(state.document, sidecarAssets(store.file(state.name || ref)), await require("./assets.cjs").store());
      }
      return shot(state.document, pageId, nodeId, scale);
    },
  };
}

async function startBridge(app, options = {}) {
  setBridgeOptions(options);
  if (info) return info;
  if (starting) return starting;
  if (process.env.VERYNIZE_DISABLE_MCP === "1") return null;
  starting = (async () => {
    const [{ DesignStore, validateDocument }, tools, edit, { exportHTML }, http, fonts] =
      await Promise.all([
        load("design-store.mjs"),
        load("design-tools.mjs"),
        load("design-edit.mjs"),
        load("export-html.mjs"),
        load("mcp-http.mjs"),
        load("fonts.mjs"),
      ]);
    const documentsRoot = path.join(app.getPath("userData"), "documents");
    fs.mkdirSync(documentsRoot, { recursive: true, mode: 0o700 });
    const store = await DesignStore.open(documentsRoot);
    const storeBackend = tools.createStoreBackend(store);
    const backend = createLiveBackend({
      store,
      storeBackend,
      tools,
      edit,
      exportHTML,
      validateDocument,
      fonts,
    });
    const instructions = `${tools.INSTRUCTIONS}\n\nConnected to the Verynize desktop app. Omit "document" to edit the document open in the editor (live, undoable). Saved documents live in ${documentsRoot}. Tools version ${tools.TOOLS_VERSION}.`;
    // Per request: the optional x-verynize-access header (readonly|ask|edit|auto|full) scopes the shell tools.
    server = await http.startHttpServer({
      makeServer: ({ headers } = {}) =>
        tools.createDesignServer(
          { backend, context: { access: agentShell.parseAccess(headers?.["x-verynize-access"]) } },
          { instructions },
        ),
      onError: (error) => console.error("[mcp-bridge]", error),
    });
    const file = path.join(app.getPath("userData"), "mcp.json");
    await http.writeBridgeFile(file, {
      url: server.url,
      token: server.token,
      pid: process.pid,
      version: tools.SERVER_VERSION,
      toolsVersion: tools.TOOLS_VERSION,
    });
    info = {
      url: server.url,
      token: server.token,
      file,
      documentsRoot,
      toolsVersion: tools.TOOLS_VERSION,
      serverVersion: tools.SERVER_VERSION,
    };
    for (const entry of windows.values()) announce(entry);
    return info;
  })();
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

function getBridgeInfo() {
  return info ? { ...info } : null;
}

function stopBridge() {
  if (!info) return;
  try {
    const current = JSON.parse(fs.readFileSync(info.file, "utf8"));
    if (current.token === info.token) fs.unlinkSync(info.file);
  } catch {}
  server?.close().catch?.(() => {});
  server = null;
  info = null;
}

module.exports = { startBridge, setBridgeOptions, registerWindow, getBridgeInfo, stopBridge };
