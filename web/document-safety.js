// Document safety: no stored document is silently lost because the shared schema (web/document-core.js) rejects it.
// Loaded after document-core.js and before app.js; registers window.documentSafety.
//
// restore(text)          startup (web/app.js, localStorage 'verynize-v2'): the prepared document, or null when it
//                        cannot load. Then the raw text is backed up, a notice offers it as JSON, and save() leaves
//                        the stored copy alone (holdSave) until the user edits with the backup written, or exports.
// load(d)                every loadDocument/setDocument: prepare with load-time repairs (normalizeDocument's
//                        `repairs`); repairs are reported in a notice, and backed up when the source asks for it
//                        (withSource({source, backup: true}, fn): the file library).
// check(d)               null when d loads, else {error, count}; cached per document object (file library marks).
// Backups live in IndexedDB 'verynize-recovery' (store 'backups', keyed by content hash, latest 10 kept), so a
// large backup cannot fill the localStorage quota the editor itself saves into.
(() => {
  "use strict";
  const core = window.VerynizeDocument;
  let defaults = {};
  const sources = [];
  const checked = new WeakMap();
  const dismissed = new Set();
  let startup = null; // {backupOk, exported, released} after a failed restore

  // ---- backups ----
  const DB = "verynize-recovery",
    STORE = "backups",
    KEEP = 10;
  let opened;
  const db = () =>
    (opened ||= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  const run = (mode, fn) =>
    db().then(
      (database) =>
        new Promise((resolve, reject) => {
          const tx = database.transaction(STORE, mode),
            request = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(request?.result);
          tx.onerror = tx.onabort = () => reject(tx.error);
        }),
    );
  async function hash(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  /** Stores the raw text once per content; resolves false when it could not be written. */
  async function backup(text, meta) {
    try {
      const id = await hash(text);
      await run("readwrite", (store) => store.put({ ...meta, id, savedAt: Date.now(), text }));
      const all = await run("readonly", (store) => store.getAll());
      const stale = all.sort((a, b) => b.savedAt - a.savedAt).slice(KEEP);
      if (stale.length) await run("readwrite", (store) => stale.forEach((b) => store.delete(b.id)));
      return true;
    } catch (error) {
      console.error("Document backup failed", error);
      return false;
    }
  }
  const backups = () =>
    run("readonly", (store) => store.getAll()).then((all) =>
      all.sort((a, b) => b.savedAt - a.savedAt),
    );

  // ---- reports ----
  const nameOf = (d) => {
    const name = d && typeof d.name === "string" && d.name.trim() ? d.name.trim() : "Untitled";
    return name.length > 60 ? name.slice(0, 59) + "…" : name;
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  function problemsOf(raw) {
    try {
      const copy = structuredClone(raw);
      core.normalizeDocument(copy, defaults, []);
      return core.documentProblems(copy);
    } catch {
      return [];
    }
  }
  /** {error, count}: the first problem (what validation threw) and how many there are. */
  function failure(error, raw) {
    const problems = raw === undefined ? [] : problemsOf(raw);
    return {
      error: String(error?.message || error),
      count: Math.max(1, problems.length),
      problems,
    };
  }
  const show = (value) => (typeof value === "string" ? JSON.stringify(value) : String(value));

  function exportText(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" })),
      a = document.createElement("a");
    a.href = url;
    a.download = (name.replace(/[^\w .-]+/g, "").trim() || "document") + ".recovered.verynize.json";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // A non-blocking stack of notices, bottom right. One notice per key: a repeat updates it, a dismissed key stays
  // quiet for the session (a room re-applying the same repaired snapshot, a library card clicked twice).
  function host() {
    let stack = document.getElementById("document-notices");
    if (stack) return stack;
    stack = document.createElement("div");
    stack.id = "document-notices";
    stack.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;flex-direction:column;gap:8px;max-width:380px;font:13px/1.4 system-ui,sans-serif";
    document.body.append(stack);
    return stack;
  }
  /** @param {{key: any, kind: any, title: any, detail: any, items?: any[], text?: any, name?: any, onExport?: any, action?: any}} notice */
  function notify({ key, kind, title, detail, items = [], text, name, onExport, action }) {
    if (dismissed.has(key)) return null;
    const add = () => {
      const stack = host();
      let box = [...stack.children].find((n) => n.dataset.key === key);
      if (!box) {
        box = document.createElement("section");
        box.className = "document-notice";
        box.dataset.key = key;
        stack.append(box);
      }
      box.dataset.kind = kind;
      box.setAttribute("role", kind === "failed" ? "alert" : "status");
      box.style.cssText =
        "padding:12px 14px;border-radius:10px;border:1px solid var(--border,#3a3a40);background:var(--popover,#1f1f23);color:var(--foreground,#f2f2f2);box-shadow:0 8px 24px rgba(0,0,0,.25)";
      box.replaceChildren();
      const heading = document.createElement("strong");
      heading.textContent = title;
      const body = document.createElement("p");
      body.className = "document-notice-detail";
      body.style.margin = "4px 0 8px";
      body.textContent = detail;
      box.append(heading, body);
      if (items.length) {
        const more = document.createElement("details"),
          summary = document.createElement("summary"),
          list = document.createElement("ul");
        summary.textContent = kind === "failed" ? "Problems" : "Changes";
        list.style.cssText = "margin:4px 0 8px;padding-left:18px;max-height:140px;overflow:auto";
        for (const item of items.slice(0, 50)) {
          const li = document.createElement("li");
          li.textContent = item;
          list.append(li);
        }
        more.append(summary, list);
        box.append(more);
      }
      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
      if (action) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action.label;
        button.onclick = action.run;
        actions.append(button);
      }
      if (text) {
        const save = document.createElement("button");
        save.type = "button";
        save.className = "document-notice-export";
        save.textContent = "Export JSON";
        save.onclick = () => {
          exportText(typeof text === "function" ? text() : text, name || "document");
          onExport?.();
        };
        actions.append(save);
      }
      const close = document.createElement("button");
      close.type = "button";
      close.className = "document-notice-dismiss";
      close.textContent = "Dismiss";
      close.onclick = () => {
        dismissed.add(key);
        box.remove();
      };
      actions.append(close);
      box.append(actions);
    };
    if (document.body) add();
    else document.addEventListener("DOMContentLoaded", add, { once: true });
    return key;
  }
  function notifyRepaired(raw, repairs, { source, backedUp }) {
    const name = nameOf(raw);
    notify({
      key: `repaired:${source || "load"}:${name}:${repairs.map((r) => r.path).join(",")}`,
      kind: "repaired",
      title: `Repaired “${name}” to open it`,
      detail:
        `${plural(repairs.length, "value")} broke current limits and ${repairs.length === 1 ? "was" : "were"} adjusted. ` +
        (backedUp ? "The original is backed up." : "Export the original to keep it as it was."),
      items: repairs.map((r) => `${r.path}: ${show(r.before)} → ${show(r.after)}`),
      text: () => JSON.stringify(raw, null, 2),
      name,
    });
  }
  /** A document that cannot load: the raw copy stays where it is; the notice names the first problem and offers it. */
  function reportOpenFailure({
    document: raw,
    text,
    error,
    source = "load",
    name,
    kept,
    onExport,
  }) {
    const label = name || nameOf(raw),
      f =
        raw === undefined
          ? { error: cleanError(error), count: 1, problems: [] }
          : failure(error, raw);
    const key = `failed:${source}:${label}${raw === undefined ? `:${f.error}` : ""}`;
    notify({
      key,
      kind: "failed",
      title: `Couldn’t open “${label}”`,
      detail: `${f.error}${f.count > 1 ? ` (${plural(f.count, "problem")})` : ""}. ${kept || "The original was not changed."}`,
      items: f.problems.map((p) => `${p.path}: ${p.message}`),
      text: text || (raw === undefined ? null : () => JSON.stringify(raw, null, 2)),
      name: label,
      onExport,
    });
    return { ...f, key };
  }
  const cleanError = (error) =>
    String(error?.message || error).replace(
      /^Error invoking remote method '[^']+': (Error: )?/,
      "",
    );

  // ---- loading ----
  function load(d) {
    const ctx = sources[sources.length - 1] || {},
      repairs = [];
    if (ctx.source === "library" && window.switchCache?.isTrustedLocal(d))
      return structuredClone(d);
    let prepared;
    try {
      prepared = window.VerynizeLazyDocument.prepare(structuredClone(d), defaults, repairs);
    } catch (error) {
      error.problems = failure(error, d).count;
      throw error;
    }
    if (repairs.length) {
      if (ctx.backup)
        void backup(JSON.stringify(d), {
          source: ctx.source,
          reason: "repaired",
          name: nameOf(d),
          repairs: repairs.slice(0, 50),
        });
      notifyRepaired(d, repairs, { source: ctx.source, backedUp: !!ctx.backup });
    }
    return prepared;
  }
  function restore(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      return failStartup(text, undefined, error);
    }
    const repairs = [];
    try {
      const prepared = window.VerynizeLazyDocument.prepare(structuredClone(raw), defaults, repairs);
      if (repairs.length) {
        void backup(text, {
          source: "startup",
          reason: "repaired",
          name: nameOf(raw),
          repairs: repairs.slice(0, 50),
        });
        notifyRepaired(raw, repairs, { source: "startup", backedUp: true });
      }
      return prepared;
    } catch (error) {
      return failStartup(text, raw, error);
    }
  }
  function failStartup(text, raw, error) {
    startup = { backupOk: false, exported: false, released: false };
    const kept =
      "Your original is kept unchanged and backed up; the editor shows the default document until you edit it.";
    const f = reportOpenFailure({
      document: raw,
      text,
      error,
      source: "startup",
      name: raw === undefined ? "Last document" : undefined,
      kept,
      onExport: () => (startup.exported = true),
    });
    const box = () => document.querySelector(`#document-notices [data-key="${CSS.escape(f.key)}"]`);
    void backup(text, {
      source: "startup",
      reason: "invalid",
      name: nameOf(raw),
      error: f.error,
      count: f.count,
    }).then((ok) => {
      startup.backupOk = ok;
      const detail = box()?.querySelector(".document-notice-detail");
      if (!ok && detail)
        detail.textContent = detail.textContent.replace(
          kept,
          "Your original is kept unchanged but could not be backed up: export it before editing.",
        );
    });
    return null;
  }

  window.documentSafety = {
    editRejected(detail) {
      notify({
        key: "world-bounds-edit",
        kind: "advisory",
        title: "Edit exceeds world bounds",
        detail,
      });
    },
    worldBounds(page, recenter) {
      const key = "world-bounds";
      if (!core.pageWorldBounds(page).advisory) {
        document.querySelector(`[data-key="${key}"]`)?.remove();
        dismissed.delete(key);
        return;
      }
      notify({
        key,
        kind: "advisory",
        title: "Content is far from the origin",
        detail: "This page extends beyond ±100,000 world px. Recenter it to keep editing precise.",
        action: { label: "Recenter page", run: recenter },
      });
    },
    configure(canvasDefaults) {
      defaults = canvasDefaults;
    },
    restore,
    load,
    withSource(source, fn) {
      sources.push(source);
      try {
        return fn();
      } finally {
        sources.pop();
      }
    },
    check(d) {
      if (!d || typeof d !== "object") return { error: "Not a document", count: 1 };
      if (checked.has(d)) return checked.get(d);
      let result = null;
      try {
        try {
          core.validateDocument(d);
        } catch {
          core.prepareDocument(structuredClone(d), defaults, []);
        }
      } catch (error) {
        const f = failure(error, d);
        result = { error: f.error, count: f.count };
      }
      checked.set(d, result);
      return result;
    },
    /** True while the stored document that failed to load at startup must not be overwritten: until the user has
     * edited (`edited`) with its backup written, or exported it. */
    holdSave(edited) {
      if (!startup || startup.released) return false;
      if (startup.exported || (edited && startup.backupOk)) startup.released = true;
      return !startup.released;
    },
    /** The startup document failed and the user has not edited the placeholder since. */
    startupPending(edited) {
      return !!startup && !startup.released && !edited;
    },
    startupFailed: () => !!startup,
    reportOpenFailure,
    backups,
    notices: () =>
      [...document.querySelectorAll("#document-notices .document-notice")].map((n) => ({
        key: n.dataset.key,
        kind: n.dataset.kind,
        text: n.textContent,
      })),
  };
})();
