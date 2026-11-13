// Per-artboard version history: ONE implementation of the capture rules, pruning and restore for the
// canvas (web/version-history.js, loaded as a classic <script>), the headless engine
// (integrations/version-store.mjs and design-tools.mjs, through integrations/version-core.mjs) and
// the room actor (cloud/room-history.js). Registers globalThis.VerynizeVersions. Spec:
// docs/version-history.md.
//
// An artboard is a top-level frame (`type: "frame"`, no `parentId`). A version is a snapshot of
// its subtree: {artboardId, pageId, index, nodes} (nodes in page order, the root first among them
// is the node with `parentId: null`).
//
// observe(state, change)   the capture rules. `state` is {last: {[artboardId]: {author, at, hash}},
//                          latest: {[artboardId]: {hash, nodes}}} and is updated in place; `change`
//                          is one edit {artboardId, before, after, author, at, force?}. Returns the
//                          versions to store (meta + snapshot).
// idle(state, now, current, idleMs)
//                          versions for artboards whose last edit is older than idleMs and differs
//                          from their newest version (`current(id)` returns the live snapshot).
// changes(beforeDoc, afterDoc, {pages?, nodes?})
//                          the artboards whose subtree differs: [{artboardId, before, after}].
// prune(metas, options)    ids of the versions to delete so that at most `max` remain per artboard.
// restore(doc, snapshot, {asCopy, newId})
//                          a new document whose artboard subtree is the snapshot (re-created when
//                          deleted, colliding ids renamed): {document, artboardId, pageId, remapped}.
(function (root) {
  "use strict";
  const IDLE_MS = 2 * 60 * 1000;
  const MAX_VERSIONS = 50;
  const KEEP_RECENT = 20;
  const HOUR = 60 * 60 * 1000;
  // Versions kept ahead of plain ones when older versions are thinned out.
  const MILESTONES = new Set(["finish", "restore"]);
  const REASONS = new Set(["switch", "idle", "agent", "delete", "restore", "finish", "manual"]);
  const AUTHOR_KINDS = new Set(["user", "agent", "collaborator", "unknown"]);

  const clone = (value) => JSON.parse(JSON.stringify(value));

  /** 64-bit FNV-1a over UTF-16 units, as 16 hex digits (two 32-bit lanes). */
  function hash(text) {
    let a = 0x811c9dc5,
      b = 0x01000193 ^ text.length;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ (c + i), 0x01000193) >>> 0;
    }
    return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
  }

  const isArtboard = (node) => !!node && node.type === "frame" && !node.parentId;

  /** Map of artboard id → its nodes in page order (only top-level frames). */
  function groups(page) {
    const nodes = Array.isArray(page?.nodes) ? page.nodes : [];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const rootOf = new Map();
    const resolve = (node) => {
      const seen = [];
      let current = node,
        found = null;
      while (current) {
        if (rootOf.has(current.id)) {
          found = rootOf.get(current.id);
          break;
        }
        if (seen.includes(current)) break; // a cycle has no artboard
        seen.push(current);
        if (!current.parentId) {
          found = current.id;
          break;
        }
        current = byId.get(current.parentId);
      }
      for (const visited of seen) rootOf.set(visited.id, found);
      return found;
    };
    const out = new Map();
    for (const node of nodes) {
      const id = resolve(node);
      if (!id || !isArtboard(byId.get(id))) continue;
      if (!out.has(id)) out.set(id, []);
      out.get(id).push(node);
    }
    return out;
  }

  /** The artboard's snapshot, or null when no top-level frame has that id. */
  function snapshot(doc, artboardId) {
    for (const page of doc?.pages || []) {
      const root = page.nodes?.find((node) => node.id === artboardId);
      if (!root) continue;
      if (!isArtboard(root)) return null;
      const nodes = groups(page).get(artboardId) || [];
      return {
        artboardId,
        pageId: page.id,
        index: page.nodes.indexOf(root),
        name: typeof root.name === "string" ? root.name : "Artboard",
        nodes: clone(nodes),
      };
    }
    return null;
  }

  const snapshotHash = (snap) => (snap ? hash(JSON.stringify(snap.nodes)) : null);

  /**
   * Artboards whose subtree differs between two documents. `options.pages` limits the comparison
   * to some pages; `options.nodes` (node ids) to the artboards holding one of them, before or after.
   */
  function changes(beforeDoc, afterDoc, options = null) {
    const { pages: pageIds = null, nodes: nodeIds = null } = Array.isArray(options)
      ? { pages: options }
      : options || {};
    const wanted = pageIds ? new Set(pageIds) : null;
    const touched = nodeIds ? new Set(nodeIds) : null;
    const pagesOf = (doc) =>
      new Map((doc?.pages || []).filter((p) => !wanted || wanted.has(p.id)).map((p) => [p.id, p]));
    const before = pagesOf(beforeDoc),
      after = pagesOf(afterDoc);
    const out = [];
    const boards = (page) => {
      const map = new Map();
      for (const [id, nodes] of groups(page))
        if (!touched || nodes.some((node) => touched.has(node.id))) map.set(id, nodes);
      return map;
    };
    const describe = (id, nodes, page) => ({
      artboardId: id,
      pageId: page.id,
      index: page.nodes.indexOf(nodes[0]),
      name: typeof nodes[0].name === "string" ? nodes[0].name : "Artboard",
      nodes: clone(nodes),
    });
    // Artboards that moved between pages count once.
    const seen = new Set();
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const a = before.get(id),
        b = after.get(id);
      if (a && b && a.nodes === b.nodes) continue;
      const left = boards(a),
        right = boards(b);
      for (const boardId of new Set([...left.keys(), ...right.keys()])) {
        if (seen.has(boardId)) continue;
        const l = left.get(boardId),
          r = right.get(boardId);
        if (l && r && JSON.stringify(l) === JSON.stringify(r)) continue;
        seen.add(boardId);
        const beforeSnap = l ? describe(boardId, l, a) : snapshot(beforeDoc, boardId);
        const afterSnap = r ? describe(boardId, r, b) : snapshot(afterDoc, boardId);
        if (
          beforeSnap &&
          afterSnap &&
          JSON.stringify(beforeSnap.nodes) === JSON.stringify(afterSnap.nodes)
        )
          continue;
        out.push({ artboardId: boardId, before: beforeSnap, after: afterSnap });
      }
    }
    return out;
  }

  /** A stable key for "the same editor": kind plus id (or name). */
  const authorKey = (author) =>
    author ? `${author.kind || "unknown"}:${author.id || author.name || ""}` : "unknown:";

  function cleanAuthor(author) {
    const kind = AUTHOR_KINDS.has(author?.kind) ? author.kind : "unknown";
    const text = (value, max) =>
      typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
    const name =
      text(author?.name, 80) ||
      { user: "You", agent: "Agent", collaborator: "Collaborator", unknown: "Earlier edit" }[kind];
    const id = text(author?.id, 120);
    return { kind, name, ...(id ? { id } : {}) };
  }

  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  function summarize(snap, previous) {
    const count = snap.nodes.length;
    const delta = previous && Number.isFinite(previous.nodes) ? count - previous.nodes : null;
    return delta
      ? `${plural(count, "layer")} (${delta > 0 ? "+" : "−"}${Math.abs(delta)})`
      : plural(count, "layer");
  }

  let counter = 0;
  const versionId = (at) =>
    `v${Math.floor(at).toString(36)}${(counter++ % 1296).toString(36).padStart(2, "0")}${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  /** One stored version: {meta, snapshot}. Updates state.latest. */
  function entry(state, snap, author, at, reason, label) {
    const previous = state.latest[snap.artboardId];
    const digest = snapshotHash(snap);
    const meta = {
      id: versionId(at),
      artboardId: snap.artboardId,
      pageId: snap.pageId,
      name: snap.name,
      author: cleanAuthor(author),
      at: Math.floor(at),
      reason: REASONS.has(reason) ? reason : "manual",
      summary: summarize(snap, previous),
      nodes: snap.nodes.length,
      hash: digest,
      ...(typeof label === "string" && label ? { label: label.slice(0, 120) } : {}),
    };
    state.latest[snap.artboardId] = { hash: digest, nodes: snap.nodes.length };
    return { meta, snapshot: snap };
  }

  const fresh = (state, snap) =>
    !!snap && state.latest[snap.artboardId]?.hash !== snapshotHash(snap);

  /**
   * The capture rules for one edit of one artboard by `author` at `at`:
   * - the editor changed (user ↔ agent, another collaborator): the state before this edit is the
   *   previous editor's work, stored in their name (an unknown editor's when the artboard changed
   *   since the last edit this history saw);
   * - the same editor returns after `idleMs`: the state before this edit ends the earlier burst;
   * - an agent edits (or anyone deletes) an artboard whose current state is not stored yet: it is
   *   stored first, so every agent change and every deletion can be undone from the history;
   * - `force: "restore"` stores the state being replaced; `force: "finish"` (an agent finished
   *   the artboard) and `force: "manual"` store the state after.
   * Except for a restore, a snapshot identical to the artboard's newest version is not stored again.
   */
  function observe(state, change, { idleMs = IDLE_MS } = {}) {
    state.last ||= {};
    state.latest ||= {};
    const out = [];
    const { artboardId, before, after, force, label } = change;
    const author = cleanAuthor(change.author);
    const at = Number.isFinite(change.at) ? change.at : Date.now();
    const last = state.last[artboardId];
    if (force === "restore") {
      // Always listed, even when the newest version holds the same state: the restore is visible
      // in the history and can itself be undone from there.
      if (before) out.push(entry(state, before, author, at, "restore", label));
    } else if (before && fresh(state, before)) {
      if (last && last.hash && last.hash !== snapshotHash(before))
        // Someone this history did not see (another app, a merge) changed it since.
        out.push(entry(state, before, { kind: "unknown" }, at, "switch"));
      else if (last && authorKey(last.author) !== authorKey(author))
        out.push(entry(state, before, last.author, last.at, "switch"));
      else if (last && at - last.at >= idleMs)
        out.push(entry(state, before, last.author, last.at, "idle"));
      else if (!after)
        out.push(
          entry(state, before, last?.author || { kind: "unknown" }, last?.at ?? at, "delete"),
        );
      else if (!last && author.kind === "agent")
        out.push(entry(state, before, { kind: "unknown" }, at, "agent"));
    }
    if ((force === "finish" || force === "manual") && fresh(state, after))
      out.push(entry(state, after, author, at, force, label));
    if (after) state.last[artboardId] = { author, at, hash: snapshotHash(after) };
    else delete state.last[artboardId];
    return out;
  }

  /**
   * Versions for artboards idle for `idleMs` whose current state is not stored yet. Every artboard
   * looked at is settled: its current state counts as seen, and a deleted one is forgotten.
   */
  function idle(state, now, current, { idleMs = IDLE_MS } = {}) {
    const out = [];
    for (const [artboardId, last] of Object.entries(state.last || {})) {
      if (now - last.at < idleMs) continue;
      if (state.latest?.[artboardId]?.hash === last.hash) continue;
      const snap = current(artboardId);
      if (!snap) {
        delete state.last[artboardId];
        continue;
      }
      if (fresh(state, snap)) out.push(entry(state, snap, last.author, last.at, "idle"));
      last.hash = snapshotHash(snap);
    }
    return out;
  }

  /** Seed state.latest from stored metas (newest version per artboard). */
  function seed(state, metas) {
    state.last ||= {};
    state.latest ||= {};
    for (const meta of metas || []) {
      const known = state.latest[meta.artboardId];
      if (!known || (known.at ?? -1) <= meta.at)
        state.latest[meta.artboardId] = { hash: meta.hash, nodes: meta.nodes, at: meta.at };
    }
    return state;
  }

  /**
   * Ids to delete so each artboard keeps at most `max` versions. The newest `recent` are always
   * kept. Among older ones, the newest plain version per time bucket (buckets double in length
   * going back: 1 h, 2 h, 4 h, … before the newest version) and every milestone (finish, restore)
   * are preferred: the other plain versions go first (oldest first), then the oldest plain
   * versions, then the oldest milestones, until `max` remain.
   */
  function prune(metas, { max = MAX_VERSIONS, recent = KEEP_RECENT } = {}) {
    const byBoard = new Map();
    for (const meta of metas || []) {
      if (!byBoard.has(meta.artboardId)) byBoard.set(meta.artboardId, []);
      byBoard.get(meta.artboardId).push(meta);
    }
    const drop = [];
    for (const list of byBoard.values()) {
      if (list.length <= max) continue;
      list.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
      const newest = list[0].at;
      const keep = list.slice(0, Math.min(recent, max));
      const older = list.slice(keep.length);
      const buckets = new Set();
      const kept = [],
        thinned = [];
      for (const meta of older) {
        const age = Math.max(0, newest - meta.at);
        const bucket = Math.floor(Math.log2(age / HOUR + 1));
        if (MILESTONES.has(meta.reason) || !buckets.has(bucket)) {
          kept.push(meta);
          if (!MILESTONES.has(meta.reason)) buckets.add(bucket);
        } else thinned.push(meta);
      }
      // Only the excess goes: redundant versions (oldest first), then plain ones, then milestones.
      const milestones = kept.filter((meta) => MILESTONES.has(meta.reason));
      const plain = kept.filter((meta) => !MILESTONES.has(meta.reason));
      const order = [...thinned.reverse(), ...plain.reverse(), ...milestones.reverse()];
      drop.push(...order.slice(0, list.length - Math.max(max, keep.length)));
    }
    return drop.map((meta) => meta.id);
  }

  const newIdDefault = () =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  /**
   * Replace the artboard's subtree with the snapshot (one edit). The artboard is re-created on its
   * page (or the first page) when it was deleted, ids used elsewhere in the document are renamed,
   * and `asCopy` places a renamed copy to the right of the current artboard instead.
   */
  function restore(doc, snap, { asCopy = false, newId = newIdDefault } = {}) {
    if (!snap || !Array.isArray(snap.nodes) || !snap.nodes.length) throw new Error("Empty version");
    const document = clone(doc);
    if (!Array.isArray(document.pages) || !document.pages.length)
      throw new Error("Document has no pages");
    const rootNode = snap.nodes.find((node) => !node.parentId);
    if (!rootNode) throw new Error("Version has no artboard");
    let page = document.pages.find((p) => p.nodes.some((node) => node.id === snap.artboardId));
    const current = page?.nodes.find((node) => node.id === snap.artboardId) || null;
    let index;
    if (page && !asCopy) {
      const removed = new Set(
        groups(page)
          .get(snap.artboardId)
          ?.map((node) => node.id) || [snap.artboardId],
      );
      index = page.nodes
        .slice(0, page.nodes.indexOf(current))
        .filter((node) => !removed.has(node.id)).length;
      page.nodes = page.nodes.filter((node) => !removed.has(node.id));
    } else if (page) {
      index = page.nodes.length;
    } else {
      page =
        document.pages.find((p) => p.id === snap.pageId) ||
        document.pages.find((p) => p.id === document.activePage) ||
        document.pages[0];
      index = Math.max(
        0,
        Math.min(page.nodes.length, Number.isInteger(snap.index) ? snap.index : page.nodes.length),
      );
    }
    const taken = new Set(document.pages.flatMap((p) => p.nodes.map((node) => node.id)));
    const nodes = clone(snap.nodes);
    const idMap = new Map();
    for (const node of nodes)
      if (asCopy || taken.has(node.id)) {
        let id = newId();
        while (taken.has(id)) id = newId();
        idMap.set(node.id, id);
        taken.add(id);
      }
    for (const node of nodes) {
      if (idMap.has(node.id)) {
        node.id = idMap.get(node.id);
        delete node.shortId;
      }
      if (node.parentId && idMap.has(node.parentId)) node.parentId = idMap.get(node.parentId);
    }
    const root2 = nodes.find((node) => !node.parentId);
    if (asCopy) {
      const anchor = current || rootNode;
      root2.x = (Number(anchor.x) || 0) + (Number(anchor.w) || 0) + 80;
      root2.y = Number(anchor.y) || 0;
      root2.name = `${typeof rootNode.name === "string" && rootNode.name ? rootNode.name : "Artboard"} (restored)`;
    }
    if (idMap.size && root.VerynizeComponents?.adoptCopies)
      root.VerynizeComponents.adoptCopies(document, nodes, idMap);
    page.nodes.splice(index, 0, ...nodes);
    return { document, artboardId: root2.id, pageId: page.id, remapped: idMap.size };
  }

  /** Validate an untrusted snapshot shape (sizes are checked by the caller's store). */
  function checkSnapshot(snap) {
    if (!snap || typeof snap !== "object") throw new Error("Invalid version snapshot");
    if (typeof snap.artboardId !== "string" || !snap.artboardId)
      throw new Error("Invalid version artboard");
    if (typeof snap.pageId !== "string") throw new Error("Invalid version page");
    if (!Array.isArray(snap.nodes) || !snap.nodes.length) throw new Error("Invalid version nodes");
    if (!snap.nodes.every((node) => node && typeof node.id === "string"))
      throw new Error("Invalid version nodes");
    if (!snap.nodes.some((node) => node.id === snap.artboardId && !node.parentId))
      throw new Error("Version has no artboard");
    return snap;
  }

  /** Validate untrusted version metadata and return a clean copy. */
  function cleanMeta(meta) {
    if (!meta || typeof meta !== "object") throw new Error("Invalid version");
    const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(meta.id || "")) throw new Error("Invalid version id");
    if (typeof meta.artboardId !== "string" || !meta.artboardId || meta.artboardId.length > 200)
      throw new Error("Invalid version artboard");
    return {
      id: meta.id,
      artboardId: meta.artboardId,
      pageId: text(meta.pageId, 200),
      name: text(meta.name, 200) || "Artboard",
      author: cleanAuthor(meta.author),
      at: Number.isFinite(meta.at) ? Math.floor(meta.at) : Date.now(),
      reason: REASONS.has(meta.reason) ? meta.reason : "manual",
      summary: text(meta.summary, 200),
      nodes: Number.isSafeInteger(meta.nodes) ? meta.nodes : 0,
      hash: text(meta.hash, 64),
      ...(meta.label ? { label: text(meta.label, 120) } : {}),
    };
  }

  root.VerynizeVersions = Object.freeze({
    IDLE_MS,
    MAX_VERSIONS,
    KEEP_RECENT,
    hash,
    isArtboard,
    groups,
    snapshot,
    snapshotHash,
    changes,
    authorKey,
    cleanAuthor,
    observe,
    idle,
    seed,
    prune,
    restore,
    checkSnapshot,
    cleanMeta,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
