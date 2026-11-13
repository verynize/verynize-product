// Renderer half of the live MCP bridge (see desktop/mcp-bridge.cjs). Main sends narrow requests
// over window.desktop.agentBridge; this file answers them using only the public editor API
// (window.verynize) so agent edits go through the same setDocument path as user edits:
// rendered at once, persisted, and undoable as one step per tool call. All document logic (JSX,
// directives, short ids) runs in the main process; nothing here evaluates agent-supplied code.
(() => {
  "use strict";
  const api = window.verynizePlatform.can("agentBridge") ? window.desktop.agentBridge : null;
  const editor = () => window.verynize;
  if (!api || !editor()) return;
  // Every editor render bumps the stamp; commits carry the stamp they were computed from, so a
  // user edit made while the agent was working is never silently overwritten.
  let stamp = 0;
  editor().subscribe(() => {
    stamp++;
  });

  const library = () => {
    const lib = window.fileLibrary;
    const files = lib?.list?.() || [];
    const active = files.find((file) => file.id === lib?.currentId) || null;
    return {
      file: active
        ? { id: active.id, name: active.name, nativePath: active.nativePath || null }
        : null,
      files: files
        .filter((file) => !file.archived)
        .map((file) => ({
          id: file.id,
          name: file.name,
          nativePath: file.nativePath || null,
          active: file.id === lib?.currentId,
        })),
    };
  };
  // Boxes keyed by node id, translated so the screenshotted element sits at (0, 0).
  const rebase = (boxes, rootId) => {
    const origin = boxes && boxes[rootId];
    if (!origin) return null;
    const out = {};
    for (const [id, b] of Object.entries(boxes))
      out[id] = { ...b, x: b.x - origin.x, y: b.y - origin.y };
    return out;
  };
  const measureCanvas = (rootId) => {
    const root = document.querySelector(`#canvas [data-id="${CSS.escape(rootId)}"]`);
    if (!root) return null;
    const zoom = Number(editor().getCamera?.().zoom) || 1;
    const base = root.getBoundingClientRect();
    const out = {};
    for (const el of [root, ...root.querySelectorAll("[data-id]")].slice(
      0,
      window.VerynizeDocument.NODE_LIMITS.perPage,
    )) {
      const r = el.getBoundingClientRect();
      const box = {
        x: (r.left - base.left) / zoom,
        y: (r.top - base.top) / zoom,
        w: r.width / zoom,
        h: r.height / zoom,
      };
      if (el.dataset.designType === "text")
        Object.assign(box, {
          scrollWidth: el.scrollWidth,
          scrollHeight: el.scrollHeight,
          clientWidth: el.clientWidth,
          clientHeight: el.clientHeight,
        });
      out[el.dataset.id] = box;
    }
    return out;
  };

  // Web fonts used by the document are loaded into the editor page too (embedded @font-face from
  // the main process font cache), so the canvas matches screenshots and exports.
  const fontState = { requested: "", timer: null };
  const documentFonts = (doc) => {
    const byFamily = new Map();
    const add = (family, weight, italic) => {
      const first = String(family || "")
        .split(",")[0]
        .trim()
        .replace(/^['"]|['"]$/g, "")
        .replace(/_/g, " ");
      if (!first || /^(system-ui|sans-serif|serif|monospace|ui-[a-z-]+|inherit)$/i.test(first))
        return;
      const entry = byFamily.get(first.toLowerCase()) || {
        family: first,
        weights: new Set(),
        styles: new Set(),
      };
      const w = weight === "bold" ? 700 : Number(weight) || 400;
      entry.weights.add(w);
      entry.styles.add(italic ? "italic" : "normal");
      byFamily.set(first.toLowerCase(), entry);
    };
    for (const page of doc.pages || [])
      for (const n of page.nodes || []) {
        if (n.fontFamily) add(n.fontFamily, n.fontWeight, n.fontStyle === "italic");
        if (n.textStyle?.fontFamily)
          add(n.textStyle.fontFamily, n.textStyle.fontWeight, n.textStyle.fontStyle === "italic");
        for (const r of n.textRuns || [])
          if (r.bold && n.fontFamily) add(n.fontFamily, 700, r.italic);
      }
    return [...byFamily.values()].slice(0, 40).map((e) => ({
      family: e.family,
      weights: [...e.weights].sort((a, b) => Number(a) - Number(b)),
      styles: [...e.styles],
    }));
  };
  const syncFonts = () => {
    clearTimeout(fontState.timer);
    fontState.timer = setTimeout(async () => {
      if (!window.verynizePlatform.can("localFonts")) return;
      const families = documentFonts(editor().getSnapshot());
      const key = JSON.stringify(families);
      if (!families.length || key === fontState.requested) return;
      fontState.requested = key;
      try {
        const { css } = await window.desktop.fontFaces(families);
        let style = document.getElementById("bd-design-fonts");
        if (!style) {
          style = document.createElement("style");
          style.id = "bd-design-fonts";
          document.head.append(style);
        }
        style.textContent = css || "";
      } catch {
        fontState.requested = "";
      }
    }, 400);
  };
  editor().subscribe(syncFonts);
  syncFonts();

  const nodeOnActivePage = (pageId, nodeId) => {
    const doc = editor().getDocument();
    return (
      doc.activePage === pageId &&
      doc.pages.find((p) => p.id === pageId)?.nodes.some((n) => n.id === nodeId)
    );
  };

  const ops = {
    // Main announces the serving tool generation (desktop/mcp-bridge.cjs); Settings › Agents shows it.
    info({ toolsVersion, serverVersion }) {
      const clean = (v) => (typeof v === "string" && /^[\w.-]{1,40}$/.test(v) ? v : null);
      window.verynizeTools = Object.freeze({
        toolsVersion: clean(toolsVersion),
        serverVersion: clean(serverVersion),
      });
      window.dispatchEvent(new CustomEvent("verynize-tools", { detail: window.verynizeTools }));
      return { ok: true };
    },
    async state() {
      // Shared rooms load pages lazily (web/page-loader.js); agents read and write whole documents.
      await window.pageLoader?.ensureAll();
      const document = editor().getDocument();
      return {
        document,
        stamp,
        selection: editor().getSelection(),
        activePage: document.activePage,
        ...library(),
      };
    },
    commit({ document, stamp: expected, actor, force, artboardId, label }) {
      if (expected !== stamp) return { conflict: true };
      const selection = editor().getSelection();
      const view = editor().getView();
      // Version history (web/version-history.js): the commit is an agent edit; a restore_version
      // commit stores the state it replaces first.
      const history = window.versionHistory;
      const run = () => {
        window.VerynizeDocument.validateWorldBoundsChange(editor().getDocument(), document);
        editor().setDocument(document);
      };
      if (history)
        history.as(
          actor?.kind === "agent"
            ? actor
            : { kind: "agent", name: actor?.name || "Agent", restore: actor?.restore },
          run,
          force === "restore" && typeof artboardId === "string"
            ? { force, artboardId, label }
            : null,
        );
      else run();
      const after = editor().getDocument();
      const page = after.pages.find((p) => p.id === after.activePage);
      const keep = selection.filter((id) => page?.nodes.some((n) => n.id === id));
      if (keep.length) editor().setSelection(keep);
      if (view.page !== after.activePage && after.pages.some((p) => p.id === view.page))
        editor().setView(view);
      return { ok: true, document: editor().getDocument() };
    },
    // Version history of the open document (web/version-history.js) for list_versions/restore_version.
    async versions({ artboardId }) {
      if (!window.versionHistory) throw new Error("Version history is unavailable in this editor");
      return {
        versions: await window.versionHistory.list(
          typeof artboardId === "string" ? artboardId : null,
        ),
      };
    },
    async version({ id }) {
      if (!window.versionHistory) throw new Error("Version history is unavailable in this editor");
      return { found: await window.versionHistory.get(String(id || "")) };
    },
    async versionCapture({ artboardId, reason, label }) {
      if (!window.versionHistory) throw new Error("Version history is unavailable in this editor");
      return {
        versions: await window.versionHistory.capture(String(artboardId || ""), {
          reason,
          label,
          author: { kind: "agent", name: "Agent" },
        }),
      };
    },
    focus({ pageId, nodeId }) {
      const view = editor().getView();
      if (view.page !== pageId) editor().setView({ ...view, page: pageId });
      editor().setSelection([nodeId]);
      document
        .querySelector(`#canvas [data-id="${CSS.escape(nodeId)}"]`)
        ?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      return { focused: editor().getSelection().includes(nodeId) };
    },
    async screenshot({ pageId, nodeId, scale }) {
      if (!nodeOnActivePage(pageId, nodeId) || !editor().exportArtwork)
        return { unavailable: true };
      const previous = editor().getSelection();
      editor().setSelection([nodeId]);
      try {
        const raster = await editor().exportArtwork({
          format: "PNG",
          scale,
          selectionOnly: true,
          screenshot: true,
        });
        // Measured layout boxes relative to the screenshotted element: from the offscreen render
        // (desktop/render.cjs) when it reports them, otherwise from the live canvas DOM.
        const bounds = rebase(raster?.boxes, nodeId) || measureCanvas(nodeId);
        const { boxes: _boxes, ...rest } = raster || {};
        return {
          ...rest,
          ...(bounds ? { bounds, boundsSource: raster?.boxes ? "render" : "canvas" } : {}),
        };
      } finally {
        editor().setSelection(previous);
      }
    },
    async open({ document, path }) {
      if (window.fileLibrary?.openNative) await window.fileLibrary.openNative({ document, path });
      else {
        await window.documentLifecycle?.prepareSwitch({ preserveNative: true });
        editor().setDocument(document);
      }
      return { opened: true };
    },
    async openFile({ fileId }) {
      if (!window.fileLibrary?.open) throw new Error("This editor has no file library");
      if (!window.fileLibrary.list().some((file) => file.id === fileId))
        throw new Error("No library file with that id");
      await window.fileLibrary.open(fileId);
      return { opened: true };
    },
  };

  // --- agent shell: editor commands for the execute_action MCP tool (desktop/agent-shell.cjs) ---
  // Runs entries of the editor's own command registry (window.verynize.commands/runCommand),
  // the same commands as the shortcuts and context menu, so each one is undoable like a user action.
  // OS clipboard commands stay with the user.
  const BLOCKED_ACTIONS = new Set(["edit.copy", "edit.cut", "edit.paste", "edit.pasteInPlace"]);
  const actionList = () =>
    (editor().commands?.() || []).filter(
      (command) => !BLOCKED_ACTIONS.has(command.id) && !command.id.startsWith("clipboard."),
    );
  ops.actions = () => ({ actions: actionList() });
  ops.action = ({ id, ids, pageId }) => {
    if (!actionList().some((command) => command.id === id))
      throw new Error(`Unknown action ${id}; call execute_action without an id to list actions`);
    if (pageId) {
      const view = editor().getView();
      if (view.page !== pageId) editor().setView({ ...view, page: pageId });
    }
    if (Array.isArray(ids)) editor().setSelection(ids.filter((value) => typeof value === "string"));
    const ran = editor().runCommand(id);
    return {
      ran,
      selection: editor().getSelection(),
      activePage: editor().getDocument().activePage,
      tool: editor().getTool?.() || null,
      camera: editor().getCamera?.() || null,
    };
  };
  // --- end agent shell ---

  api.onCall(async (message) => {
    const { requestId, op, args } = message || {};
    if (typeof requestId !== "string") return;
    try {
      if (!Object.hasOwn(ops, op)) throw new Error("Unknown bridge operation");
      api.reply(requestId, { ok: true, result: await ops[op](args || {}) });
    } catch (error) {
      api.reply(requestId, { ok: false, error: String(error?.message || error) });
    }
  });
})();
