// Per-artboard version history in the editor (docs/version-history.md): watches the open
// document, applies the capture rules of web/version-history-core.js and stores the versions where
// the document lives. Registers window.versionHistory (the history island and agent bridge use it).
//
// - Native files (desktop): the NAME.verynize.history/ sidecar, through window.desktop.versions*.
// - Library documents (browser storage): IndexedDB `verynize-versions`.
// - Shared rooms: the room captures every batch itself (cloud/room-history.js); this module only
//   names the editor of local batches (`batchActor`, read by web/cloud-panel.js) and reads the
//   room's /versions API.
//
// The editor is the person at the keyboard unless an edit runs inside `as(author, fn)`: agent
// commits (web/agent-bridge.js) and restores. setDocument/loadDocument outside `as` (opening a
// file, reloading it from disk) is not an edit: the history starts over from the loaded document.
(() => {
  "use strict";
  const V = window.VerynizeVersions;
  const editor = () => window.verynize;
  if (!V || !editor()) return;
  const platform = window.verynizePlatform;
  const settings = { idleMs: V.IDLE_MS, debounceMs: 800 };

  const person = () => {
    const account = window.cloudAccount?.get?.()?.account;
    return {
      kind: "user",
      name: account?.displayName || account?.name || account?.handle || "You",
    };
  };
  let override = null;
  const actor = () => override || person();

  /** Where the open document's versions live. */
  function target() {
    const room = window.cloudWorkspace?.isConnected?.() ? window.cloudWorkspace.room?.() : null;
    if (room) return { kind: "room", key: `room:${room.server}|${room.id}`, room };
    const lib = window.fileLibrary;
    const file = lib?.list?.().find((entry) => entry.id === lib.currentId);
    if (file?.nativePath && platform?.can("versionHistory"))
      return { kind: "native", key: `native:${file.nativePath}`, path: file.nativePath };
    return { kind: "local", key: `local:${lib?.currentId || "default"}` };
  }

  // ---- stores -----------------------------------------------------------------------------------
  const DB = "verynize-versions";
  let db = null;
  function openDb() {
    db ||= new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB, 1);
        request.onupgradeneeded = () => {
          const meta = request.result.createObjectStore("meta", { keyPath: "key" });
          meta.createIndex("file", "file");
          request.result.createObjectStore("snapshots");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return db;
  }
  async function idb(mode, run) {
    const handle = await openDb();
    if (!handle) throw Error("Version history storage is unavailable in this browser");
    return new Promise((resolve, reject) => {
      const tx = handle.transaction(["meta", "snapshots"], mode);
      let result;
      void Promise.resolve(run(tx.objectStore("meta"), tx.objectStore("snapshots"))).then(
        (value) => (result = value),
      );
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || Error("Version history write failed"));
    });
  }
  const request = (store, method, ...args) =>
    new Promise((resolve, reject) => {
      const req = store[method](...args);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  const stores = {
    native: {
      async state(t) {
        return window.desktop.versionsList({ path: t.path });
      },
      async list(t, artboardId) {
        return (await window.desktop.versionsList({ path: t.path, artboardId })).versions;
      },
      get: (t, id) => window.desktop.versionsGet({ path: t.path, id }),
      add: (t, entries, last) => window.desktop.versionsAdd({ path: t.path, entries, last }),
    },
    local: {
      async state(t) {
        return { versions: await this.list(t, null), last: {} };
      },
      async list(t, artboardId) {
        const rows = await idb("readonly", (meta) =>
          request(meta.index("file"), "getAll", IDBKeyRange.only(t.key)),
        );
        return rows
          .map((row) => row.meta)
          .filter((meta) => !artboardId || meta.artboardId === artboardId)
          .sort((a, b) => b.at - a.at);
      },
      async get(t, id) {
        const key = `${t.key}|${id}`;
        return idb("readonly", async (meta, snapshots) => {
          const row = await request(meta, "get", key);
          const snapshot = row && (await request(snapshots, "get", key));
          return row && snapshot ? { meta: row.meta, snapshot } : null;
        });
      },
      async add(t, entries) {
        await idb("readwrite", (meta, snapshots) => {
          for (const { meta: m, snapshot } of entries) {
            meta.put({ key: `${t.key}|${m.id}`, file: t.key, meta: m });
            snapshots.put(snapshot, `${t.key}|${m.id}`);
          }
        });
        const boards = new Set(entries.map((entry) => entry.meta.artboardId));
        const metas = (await this.list(t, null)).filter((meta) => boards.has(meta.artboardId));
        const drop = V.prune(metas);
        if (drop.length)
          await idb("readwrite", (meta, snapshots) => {
            for (const id of drop) {
              meta.delete(`${t.key}|${id}`);
              snapshots.delete(`${t.key}|${id}`);
            }
          });
        return entries.map((entry) => entry.meta);
      },
    },
    room: {
      async state() {
        return { versions: [], last: {} };
      },
      async list(t, artboardId) {
        if (!artboardId) {
          const { artboards } = await window.cloudWorkspace.request(
            `/api/rooms/${t.room.id}/versions`,
          );
          return artboards.map((board) => board.latest);
        }
        const { versions } = await window.cloudWorkspace.request(
          `/api/rooms/${t.room.id}/versions?artboard=${encodeURIComponent(artboardId)}`,
        );
        return versions;
      },
      async get(t, id) {
        try {
          const found = await window.cloudWorkspace.request(
            `/api/rooms/${t.room.id}/versions/${encodeURIComponent(id)}`,
          );
          return { meta: found.version, snapshot: found.snapshot };
        } catch (error) {
          if (error.status === 404) return null;
          throw error;
        }
      },
      async capture(t, artboardId, label) {
        const { versions } = await window.cloudWorkspace.request(
          `/api/rooms/${t.room.id}/versions`,
          {
            method: "POST",
            body: JSON.stringify({ artboard: artboardId, label }),
          },
        );
        return versions;
      },
    },
  };

  // ---- tracking ---------------------------------------------------------------------------------
  let key = null,
    baseline = null,
    state = { last: {}, latest: {} },
    flushTimer = 0,
    idleTimer = 0,
    inside = 0,
    writes = Promise.resolve();

  const changed = (artboardIds) =>
    window.dispatchEvent(new CustomEvent("verynize:versions-changed", { detail: { artboardIds } }));

  /** Start over from the open document (a file was opened or loaded). */
  function reset() {
    clearTimeout(flushTimer);
    flushTimer = 0;
    const t = target();
    const same = t.key === key;
    key = t.key;
    baseline = t.kind === "room" ? null : editor().getDocument();
    if (same) return;
    clearTimeout(idleTimer);
    state = { last: {}, latest: {} };
    if (t.kind === "room") return;
    stores[t.kind]
      .state(t)
      .then((stored) => {
        if (key !== t.key) return;
        V.seed(state, stored.versions);
        for (const [id, last] of Object.entries(stored.last || {})) state.last[id] ||= last;
        scheduleIdle();
      })
      .catch(() => {});
  }

  function persist(t, captured) {
    if (!captured.length) return writes;
    const ids = [...new Set(captured.map((entry) => entry.meta.artboardId))];
    writes = writes
      .then(() => stores[t.kind].add(t, captured, state.last))
      .then(() => changed(ids))
      .catch((error) => console.warn("[version-history]", error?.message || error));
    return writes;
  }

  /** Apply the capture rules to the edits since the last flush, as the current editor. */
  function flush(force = null) {
    clearTimeout(flushTimer);
    flushTimer = 0;
    const t = target();
    if (t.key !== key) {
      reset();
      return [];
    }
    if (t.kind === "room") return [];
    const now = editor().getDocument();
    const edits = V.changes(baseline, now);
    if (force?.artboardId && !edits.some((edit) => edit.artboardId === force.artboardId)) {
      const before = V.snapshot(baseline, force.artboardId);
      if (before)
        edits.push({
          artboardId: force.artboardId,
          before,
          after: V.snapshot(now, force.artboardId),
        });
    }
    baseline = now;
    if (!edits.length) return [];
    const author = actor(),
      at = Date.now();
    const captured = [];
    for (const edit of edits)
      captured.push(
        ...V.observe(
          state,
          { ...edit, author, at, ...(force && edit.artboardId === force.artboardId ? force : {}) },
          { idleMs: settings.idleMs },
        ),
      );
    void persist(t, captured);
    scheduleIdle();
    changed(edits.map((edit) => edit.artboardId));
    return captured.map((entry) => entry.meta);
  }

  function scheduleIdle() {
    clearTimeout(idleTimer);
    const due = Object.entries(state.last)
      .filter(([id, last]) => state.latest[id]?.hash !== last.hash)
      .map(([, last]) => last.at + settings.idleMs);
    if (!due.length) return;
    idleTimer = setTimeout(runIdle, Math.max(50, Math.min(...due) - Date.now()));
  }

  function runIdle() {
    flush();
    const t = target();
    if (t.kind === "room") return;
    const doc = editor().getDocument();
    const captured = V.idle(state, Date.now(), (id) => V.snapshot(doc, id), {
      idleMs: settings.idleMs,
    });
    void persist(t, captured);
    if (captured.length) changed(captured.map((entry) => entry.meta.artboardId));
    scheduleIdle();
  }

  /** Run `fn` as `author` (one or more edits); `force` marks a restore of `force.artboardId`. */
  function as(author, fn, force = null) {
    if (!inside) flush();
    const previous = override;
    override = V.cleanAuthor(author);
    if (author?.restore) override.restore = String(author.restore);
    inside++;
    try {
      const out = fn();
      flush(force);
      return out;
    } finally {
      inside--;
      override = previous;
    }
  }

  editor().subscribe(() => {
    if (inside) return;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => flush(), settings.debounceMs);
  });
  // Loading a document is not an edit: pending edits are stored first, then the history follows
  // the loaded document (agent commits and restores load inside `as`, so they count as edits).
  const load = editor().loadDocument;
  editor().loadDocument = editor().setDocument = (document) => {
    if (inside) return load(document);
    flush();
    const out = load(document);
    reset();
    return out;
  };
  reset();

  // ---- API --------------------------------------------------------------------------------------
  let previewing = null;
  async function get(id) {
    const t = target();
    return stores[t.kind].get(t, id);
  }
  function endPreview() {
    const current = previewing;
    previewing = null;
    current?.release?.();
    if (current)
      window.dispatchEvent(new CustomEvent("verynize:version-preview", { detail: null }));
  }
  editor().subscribe(() => {
    // Any real render (an edit, a remote change, a page switch) ends the preview.
    if (previewing) {
      previewing = null;
      window.dispatchEvent(new CustomEvent("verynize:version-preview", { detail: null }));
    }
  });

  window.versionHistory = Object.freeze({
    /** The editor of the current edit ({kind, name}). */
    actor,
    /** The agent or restore marker local room batches carry (web/cloud-panel.js), or null. */
    batchActor: () => (override ? { ...override } : null),
    as,
    /** Where versions of the open document live: {kind: native|local|room, key}. */
    target: () => {
      const { kind, key: k } = target();
      return { kind, key: k };
    },
    /** Versions of an artboard, newest first (all artboards' newest when artboardId is null). */
    async list(artboardId = null) {
      flush();
      await writes;
      const t = target();
      return stores[t.kind].list(t, artboardId);
    },
    get,
    /** Show a version on the canvas without changing the document; any render ends it. */
    async preview(id) {
      const found = await get(id);
      if (!found) throw Error("Version not found");
      endPreview();
      const restored = V.restore(editor().getDocument(), found.snapshot);
      restored.document.activePage = restored.pageId;
      const release = editor().presentDocument(restored.document);
      previewing = { id, release, artboardId: found.meta.artboardId };
      window.dispatchEvent(
        new CustomEvent("verynize:version-preview", {
          detail: { id, artboardId: found.meta.artboardId },
        }),
      );
      return { id, artboardId: found.meta.artboardId };
    },
    endPreview,
    previewing: () =>
      previewing ? { id: previewing.id, artboardId: previewing.artboardId } : null,
    /**
     * Restore an artboard to a version as one edit (one undo step; ordinary operations in rooms).
     * The replaced state is stored as a version first. `asCopy` adds the version as a new artboard.
     */
    async restore(id, { asCopy = false } = {}) {
      const t = target();
      if (t.kind === "room" && !["editor", "owner"].includes(window.cloudWorkspace?.role?.()))
        throw Error("Your role in this file cannot edit");
      const found = await get(id);
      if (!found) throw Error("Version not found");
      endPreview();
      if (t.kind === "room") await window.pageLoader?.ensureAll?.();
      const view = editor().getView();
      const restored = V.restore(editor().getDocument(), found.snapshot, { asCopy });
      as(
        { ...person(), ...(asCopy ? {} : { restore: id }) },
        () => editor().setDocument(restored.document),
        asCopy
          ? null
          : { force: "restore", artboardId: found.meta.artboardId, label: "Before restore" },
      );
      if (restored.pageId === view.page) editor().setView(view);
      else editor().setActivePage(restored.pageId);
      editor().setSelection([restored.artboardId]);
      await writes;
      changed([found.meta.artboardId, restored.artboardId]);
      return {
        artboardId: restored.artboardId,
        pageId: restored.pageId,
        renamed: restored.remapped,
      };
    },
    /** Store the artboard's current state as a version now (Save version, finish_artboard). */
    async capture(artboardId, { reason = "manual", label, author } = {}) {
      const t = target();
      if (t.kind === "room") return stores.room.capture(t, artboardId, label);
      flush();
      const snap = V.snapshot(editor().getDocument(), artboardId);
      if (!snap) throw Error("Artboard not found");
      const captured = V.observe(
        state,
        {
          artboardId,
          before: snap,
          after: snap,
          author: author || actor(),
          at: Date.now(),
          force: reason === "finish" ? "finish" : "manual",
          label,
        },
        { idleMs: settings.idleMs },
      );
      await persist(t, captured);
      changed([artboardId]);
      return captured.map((entry) => entry.meta);
    },
    /** Store pending edits now (tests and the panel). */
    flush: () => {
      flush();
      return writes;
    },
    /** Test hook: shorter idle time and debounce. */
    configure({ idleMs, debounceMs } = {}) {
      if (Number.isFinite(idleMs) && idleMs > 0) settings.idleMs = idleMs;
      if (Number.isFinite(debounceMs) && debounceMs >= 0) settings.debounceMs = debounceMs;
      scheduleIdle();
      return { ...settings };
    },
  });
})();
