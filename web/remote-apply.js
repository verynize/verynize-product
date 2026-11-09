"use strict";
// Collaborators' edits without losing the local gesture (web/cloud-panel.js → here → web/app.js applyRemote).
//
// patch(doc, next, held)  the editor document takes the server state node by node: a node that did not change keeps
//                         its object, a changed node is updated field by field in place, so a drag or resize holding
//                         node objects keeps moving the live ones. Selection, camera and the text caret stay.
// held(doc, selection, gesturing)
//                         the nodes a gesture in progress owns: the edited text layer, and during a pointer gesture
//                         (drag, resize, rotate, scale) the selection with its descendants. Remote changes to them wait;
//                         when the gesture ends the panel rebuilds from the server document plus this client's edits,
//                         so per-property last-writer-wins and range-merged text decide as on the server (cloud-ops).
// baseline(doc, prior, held)
//                         the panel's "last shared" document after a remote apply: held nodes keep their values from
//                         before the gesture, so the gesture's own changes are still sent (and undone) as one step.
// stream                  during a pointer gesture the held nodes' changes are sent every INTERVAL ms (a drag shows
//                         its path on other screens instead of jumping on release).
// throttle(fn, ms)        a fixed interval that later calls never push back (a debounce delayed a burst to its end).
// coalesce(tail, ops)     the unsent tail keeps only the newest value per property.
(() => {
  const INTERVAL = 80;
  const NONE = new Set();
  const isObject = (v) => v !== null && typeof v === "object";

  // Deep equality for the JSON-like values a document holds.
  function same(a, b) {
    if (a === b) return true;
    if (!isObject(a) || !isObject(b) || Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
      return true;
    }
    let count = 0;
    for (const k in a) {
      if (!(k in b) || !same(a[k], b[k])) return false;
      count++;
    }
    for (const _k in b) count--;
    return count === 0;
  }

  /** Make `live` equal to `next` in place, skipping `except` keys; true when anything changed. */
  function assign(live, next, except) {
    let changed = false;
    for (const k of Object.keys(live))
      if (!except?.has(k) && !(k in next)) {
        delete live[k];
        changed = true;
      }
    for (const k of Object.keys(next))
      if (!except?.has(k) && !same(live[k], next[k])) {
        live[k] = next[k];
        changed = true;
      }
    return changed;
  }

  const PAGE_KEYS = new Set(["id", "nodes"]);
  function patchNodes(list, nextList, held, changed) {
    const byId = new Map();
    for (const n of list) if (n && !byId.has(n.id)) byId.set(n.id, n);
    const out = [],
      used = new Set();
    for (const n of nextList) {
      const live = n && !used.has(n.id) ? byId.get(n.id) : undefined;
      if (!live) {
        out.push(n);
        if (n) changed.add(n.id);
        continue;
      }
      used.add(n.id);
      if (!held.has(n.id) && assign(live, n)) changed.add(n.id);
      out.push(live);
    }
    // A held node a collaborator removed stays (after the node it followed) until its gesture ends.
    list.forEach((n, i) => {
      if (!n || used.has(n.id)) return;
      if (!held.has(n.id)) {
        changed.add(n.id);
        return;
      }
      let at = 0;
      for (let j = i - 1; j >= 0; j--) {
        const k = out.indexOf(list[j]);
        if (k >= 0) {
          at = k + 1;
          break;
        }
      }
      out.splice(at, 0, n);
      used.add(n.id);
    });
    return out.length === list.length && out.every((n, i) => n === list[i]) ? list : out;
  }

  /**
   * The editor document `doc` updated to `next` (prepared, as loadDocument takes it). Pages and nodes are kept and
   * patched in place; the root is a new object (component sync treats it as a fresh document, as before). Nodes in
   * `held` keep their live state. The active page stays unless it was removed. `changed` collects the node ids drawn
   * differently.
   */
  function patch(doc, next, held = NONE, changed = new Set()) {
    if (!Array.isArray(doc?.pages) || !Array.isArray(next?.pages)) return next;
    const pages = new Map(doc.pages.map((p) => [p.id, p]));
    const list = next.pages.map((np) => {
      const page = pages.get(np.id);
      if (!page || !Array.isArray(page.nodes) || !Array.isArray(np.nodes)) return np;
      assign(page, np, PAGE_KEYS);
      page.nodes = patchNodes(page.nodes, np.nodes, held, changed);
      return page;
    });
    const root = { ...next, pages: list };
    if (list.some((p) => p.id === doc.activePage)) root.activePage = doc.activePage;
    return root;
  }

  function editingId() {
    return (
      (typeof document !== "undefined" &&
        /** @type {HTMLElement | null} */ (
          document.querySelector("#canvas .layer[data-text-editing]")
        )?.dataset.id) ||
      null
    );
  }
  /** Ids a gesture in progress owns on the active page (see the header). */
  function held(doc, selection, gesturing) {
    const ids = new Set();
    const editing = editingId();
    if (editing) ids.add(editing);
    if (gesturing && selection?.size) {
      const nodes = doc.pages.find((p) => p.id === doc.activePage)?.nodes || [];
      const index = window.VerynizeNodeIndex.of(nodes);
      for (const id of selection)
        if (index.has(id)) for (const d of index.descendants(id)) ids.add(d);
    }
    return ids;
  }

  /** `doc` (a copy of the editor document) with the held nodes as `prior` had them; held nodes `prior` lacks are dropped. */
  function baseline(doc, prior, ids) {
    if (!ids?.size || !Array.isArray(doc?.pages) || !Array.isArray(prior?.pages)) return doc;
    const before = new Map();
    for (const page of prior.pages)
      for (const n of page.nodes || []) if (ids.has(n?.id)) before.set(n.id, n);
    for (const page of doc.pages) {
      if (!Array.isArray(page.nodes) || !page.nodes.some((n) => ids.has(n?.id))) continue;
      page.nodes = page.nodes.flatMap((n) =>
        !ids.has(n?.id) ? [n] : before.has(n.id) ? [structuredClone(before.get(n.id))] : [],
      );
    }
    return doc;
  }

  /** Operations that turn node `prev` into `node` (the per-node part of VerynizeOps.diff). */
  function nodeOps(page, prev, node) {
    const ops = [];
    for (const key of new Set([...Object.keys(prev), ...Object.keys(node)])) {
      if (key === "id" || same(prev[key], node[key])) continue;
      if (key === "text" && typeof prev[key] === "string" && typeof node[key] === "string")
        ops.push({ t: "text", page, id: node.id, key, base: prev[key], value: node[key] });
      else if (key in node)
        ops.push({ t: "node", page, id: node.id, key, value: structuredClone(node[key]) });
      else ops.push({ t: "node", page, id: node.id, key, del: true });
    }
    return ops;
  }

  /** Calls `fn` at most once per `ms`; a call while one is scheduled joins it instead of delaying it. */
  function throttle(fn, ms = INTERVAL) {
    let timer = 0,
      last = -Infinity;
    const run = () => {
      timer = 0;
      last = performance.now();
      fn();
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(run, Math.max(0, last + ms - performance.now()));
    };
    schedule.cancel = () => {
      clearTimeout(timer);
      timer = 0;
    };
    return schedule;
  }

  // Property sets: a newer one replaces an older one on the same path. Text edits are merged range-wise by the
  // server, so they are kept as they are; adding or removing a node or page ends the run for it.
  const SETS = new Set(["node", "page", "doc"]);
  const scopeOf = (op) =>
    op.t === "node" ? "n/" + op.id : op.t === "page" ? "p/" + op.page : op.t === "doc" ? "d" : null;
  /**
   * Append `ops` to `tail` (in place), dropping tail entries they supersede; returns the dropped entries' bytes.
   * @param {any[]} tail
   * @param {any[]} ops
   * @param {(op: any) => number} [bytes]
   */
  function coalesce(tail, ops, bytes = () => 0) {
    const last = new Map(), // scope → key → index in tail
      dropped = new Set(),
      start = tail.length;
    const end = (scope) => last.delete(scope);
    const visit = (op, i) => {
      if (SETS.has(op.t)) {
        const scope = scopeOf(op);
        let keys = last.get(scope);
        if (!keys) last.set(scope, (keys = new Map()));
        if (i >= start && keys.has(op.key)) dropped.add(keys.get(op.key));
        keys.set(op.key, i);
      } else if (op.t === "add" || op.t === "remove") end("n/" + op.id);
      else if (op.t === "addPage" || op.t === "removePage") end("p/" + op.id);
      else if (op.t === "root") last.clear();
      else if (op.t === "text") last.get("n/" + op.id)?.delete(op.key);
    };
    tail.forEach(visit);
    tail.push(...ops);
    for (let i = start; i < tail.length; i++) visit(tail[i], i);
    if (!dropped.size) return 0;
    let size = 0;
    for (const i of dropped) size += bytes(tail[i]);
    let w = 0;
    for (let i = 0; i < tail.length; i++) if (!dropped.has(i)) tail[w++] = tail[i];
    tail.length = w;
    return size;
  }

  // ---- text caret ----------------------------------------------------------------------------------------------
  function offsetIn(el, node, offset) {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.setEnd(node, offset);
    return r.toString().length;
  }
  /** @returns {[Node, number]} */
  function pointAt(el, offset) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last = null;
    for (
      let t = /** @type {Text} */ (walker.nextNode());
      t;
      t = /** @type {Text} */ (walker.nextNode())
    ) {
      if (offset <= t.length) return [t, offset];
      offset -= t.length;
      last = t;
    }
    return last ? [last, last.length] : [el, el.childNodes.length];
  }
  function saveCaret() {
    const el = document.querySelector("#canvas .layer[data-text-editing]"),
      s = getSelection();
    if (!el || !s?.rangeCount) return null;
    const r = s.getRangeAt(0);
    if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return null;
    return {
      el,
      start: offsetIn(el, r.startContainer, r.startOffset),
      end: offsetIn(el, r.endContainer, r.endOffset),
    };
  }
  function restoreCaret(caret) {
    if (!caret?.el.isConnected || !caret.el.hasAttribute("data-text-editing")) return;
    const now = saveCaret();
    if (now?.el === caret.el && now.start === caret.start && now.end === caret.end) return;
    if (document.activeElement !== caret.el) caret.el.focus({ preventScroll: true });
    const r = document.createRange();
    r.setStart(...pointAt(caret.el, caret.start));
    r.setEnd(...pointAt(caret.el, caret.end));
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  // ---- runtime: the share panel's side --------------------------------------------------------------------------
  // window.design with the hooks web/app.js adds for this file (applyRemote, gesturing, gestureNodes).
  const editor = () => (/** @type {any} */ (typeof window !== "undefined" ? window.design : null));
  /** @type {{baseline(): any, stream(ops: any[]): void, settle(): void} | null} from web/cloud-panel.js */
  let peer = null,
    settleDue = false,
    streamed = null; // id → node as last streamed during the current pointer gesture

  /** Apply a remote document state; returns the held ids, or null when the caller should load it whole. */
  function apply(doc) {
    const d = editor();
    if (!d?.applyRemote || !Array.isArray(doc?.pages)) return null;
    const caret = saveCaret();
    const ids = d.applyRemote(doc);
    restoreCaret(caret);
    if (ids.size) settleDue = true;
    return ids;
  }

  function streamTick() {
    const g = peer && editor().gestureNodes?.();
    if (!g?.nodes.length) return;
    const base = peer.baseline()?.pages?.find((p) => p.id === g.page)?.nodes;
    if (!base) return;
    streamed ||= new Map();
    const ops = [];
    for (const n of g.nodes) {
      const prev = streamed.get(n.id) || base.find((b) => b.id === n.id);
      if (!prev) continue; // created by this gesture: sent whole when it ends
      ops.push(...nodeOps(g.page, prev, n));
      streamed.set(n.id, structuredClone(n));
    }
    if (ops.length) peer.stream(ops);
  }
  const streamSoon = throttle(streamTick);

  function connect(hooks) {
    peer = hooks;
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    window.addEventListener(
      "pointermove",
      () => {
        if (peer && editor()?.gesturing?.()) streamSoon();
      },
      true,
    );
    // Full renders (never during a pointer gesture): once no gesture holds nodes, the deferred remote edits are
    // reconciled, after the panel has queued the gesture's own edits.
    editor()?.subscribe(() => {
      if (editor().gesturing() || editingId()) return;
      streamed = null;
      if (settleDue && peer) {
        settleDue = false;
        setTimeout(() => peer?.settle(), 0);
      }
    });
  }

  const api = {
    INTERVAL,
    patch,
    held,
    baseline,
    nodeOps,
    throttle,
    coalesce,
    apply,
    connect,
    same,
  };
  if (typeof window !== "undefined") window.remoteApply = api;
  if (typeof module !== "undefined") module.exports = api;
})();
