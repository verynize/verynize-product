// Components, instances and slots (spec: design/component-audit/README.md): ONE engine for the live canvas
// (web/app.js, loaded as a classic <script> before it) and the headless engine (integrations/design-tools.mjs and
// design-store.mjs, which import this file through integrations/component-core.mjs). Registers
// globalThis.VerynizeComponents.
//
// Instances are materialized: every layer of an instance is a real node on its page. The link fields live on
// ordinary nodes: `component: true` on a main frame, `instanceOf` on an instance root, `sourceId` on every linked
// node (the root's is the main id), `overrides` (keys the node owns), `slot`/`slotName` on frames inside a main.
//
// syncComponents(prev, next)      the one sync: marks overrides and slot changes made between prev and next, restores
//                                 deleted inherited layers as hidden, then copies every main onto its instances (inner
//                                 mains first). Mutates and returns `next` (node objects are updated in place, so
//                                 editors holding references keep working); `prev` is only read and may be null (then
//                                 nothing is marked: a loaded, undone or remote document is only reconciled).
//                                 Deterministic and idempotent: the result depends on (prev, next) alone, and materialized
//                                 ids are derived from (instance root id, source id).
// createComponent(doc, pageId, frameId)            frame → main component.
// createInstance(doc, mainId, {pageId, parentId, x, y, id}) -> {doc, id}
// detachInstance(doc, rootId)     instance → plain layers; nested instances stay instances of their own mains.
// resetOverrides(doc, ids, {all}) clears overrides of the nodes (all: of their whole instances), then re-syncs.
// setSlot(doc, frameId, on, name) marks a frame inside a main as a slot (or not).
// componentInfo(doc, nodeId)      what the inspector and layers panel show for a node.
// adoptCopies(doc, copies, idMap) duplicate/paste: copies of a main become instances, copies of an instance keep
//                                 their overrides with ids derived from the new root, copied parts of an instance
//                                 become plain layers.
// componentProblems(doc)          mains that contain an instance of themselves (they are never synced).
// wouldCycle(doc, nodes, parentId) whether placing `nodes` (layers with their descendants, in the document or not)
//                                 inside `parentId` would make a main contain an instance of itself.
// live() / editor(api)            renderer glue for web/app.js (baseline tracking and window.design.components).
//
// All functions except syncComponents/componentInfo/componentProblems/snapshot mutate the document they are given.
(function (root) {
  "use strict";
  const CHILDREN = "children";
  const GEOMETRY = ["x", "y", "w", "h"];
  // Keys a linked node never copies from its source (identity, structure, link fields, per-page short ids and the
  // old localStorage library stamp). An instance root also keeps its own position and main link.
  const NODE_LOCAL = new Set([
    "id",
    "parentId",
    "sourceId",
    "overrides",
    "component",
    "shortId",
    "libraryComponent",
  ]);
  const ROOT_LOCAL = new Set([...NODE_LOCAL, "instanceOf", "x", "y"]);
  // Keys never marked as overrides (instanceOf of a nested instance copy follows its source).
  const UNMARKED = new Set([...NODE_LOCAL, "instanceOf"]);
  const MAX_OVERRIDES = 500;

  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const isObject = (value) => !!value && typeof value === "object";
  const nonempty = (value) => typeof value === "string" && value.length > 0;
  function equal(a, b) {
    if (a === b) return true;
    if (!isObject(a) || !isObject(b) || Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
    const ka = Object.keys(a).filter((k) => a[k] !== undefined),
      kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => own(b, k) && equal(a[k], b[k]));
  }
  function copy(value) {
    if (!isObject(value)) return value;
    if (Array.isArray(value)) return value.map(copy);
    const out = {};
    for (const key of Object.keys(value)) out[key] = copy(value[key]);
    return out;
  }
  /** JSON with sorted keys: equal values give equal strings whatever order their keys were written in. */
  function stable(value) {
    if (!isObject(value)) return JSON.stringify(value) ?? "null";
    if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
    return (
      "{" +
      Object.keys(value)
        .filter((k) => value[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable(value[k]))
        .join(",") +
      "}"
    );
  }
  // 53-bit string hash (cyrb53); two seeds give the ~106-bit derived id suffix.
  function hash(text, seed) {
    let h1 = 0xdeadbeef ^ seed,
      h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  /** The id of the copy of `sourceId` inside the instance `rootId` (attempt > 0 when that id is taken). */
  function derivedId(rootId, sourceId, attempt = 0) {
    const key = rootId + "\u0000" + sourceId + (attempt ? "\u0000" + attempt : "");
    return `${String(rootId).slice(0, 80)}~${hash(key, 0).toString(36)}${hash(key, 1).toString(36)}`;
  }
  function freshId(taken, rootId, sourceId) {
    for (let attempt = 0; ; attempt++) {
      const id = derivedId(rootId, sourceId, attempt);
      if (!taken(id)) return id;
    }
  }
  const randomId = () =>
    root.crypto?.randomUUID?.() ||
    "n-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);

  // ---- node roles -------------------------------------------------------------------------------
  const isMain = (n) => !!n && n.type === "frame" && n.component === true;
  /** An instance root that owns its subtree: a nested instance copied inside another instance points its
   * sourceId at the node it copies (≠ instanceOf) and belongs to the outer instance. */
  const isTop = (n) =>
    !!n && nonempty(n.instanceOf) && (!nonempty(n.sourceId) || n.sourceId === n.instanceOf);
  const isLinked = (n) => !!n && nonempty(n.sourceId) && !isTop(n);
  const overridesOf = (n) =>
    Array.isArray(n.overrides) ? n.overrides.filter((k) => typeof k === "string") : [];
  const hasOverride = (n, key) => overridesOf(n).includes(key);
  function setOverrides(n, keys) {
    const list = [...new Set(keys.filter(nonempty))]
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, MAX_OVERRIDES);
    if (list.length) n.overrides = list;
    else delete n.overrides;
  }
  const addOverride = (n, key) => {
    if (!hasOverride(n, key)) setOverrides(n, [...overridesOf(n), key]);
  };
  const isModifiedSlot = (n) => n.slot === true && hasOverride(n, CHILDREN);
  /** Geometry the canvas computes (hug/fill/percent sizes, constraint-anchored boxes): neither marked nor copied,
   * except when a node is first materialized. */
  function measured(n, key) {
    if (Array.isArray(n.inset) && n.inset.some((v) => v !== null && v !== undefined))
      return GEOMETRY.includes(key);
    if (key === "w") return (n.wMode !== undefined && n.wMode !== "fixed") || n.wPct !== undefined;
    if (key === "h") return (n.hMode !== undefined && n.hMode !== "fixed") || n.hPct !== undefined;
    return false;
  }
  const pagesOf = (doc) =>
    doc && Array.isArray(doc.pages)
      ? doc.pages.filter((p) => p && typeof p === "object" && Array.isArray(p.nodes))
      : [];
  function hasComponents(doc) {
    for (const page of pagesOf(doc))
      for (const n of page.nodes)
        if (n && (n.component === true || n.instanceOf !== undefined || n.sourceId !== undefined))
          return true;
    return false;
  }

  // ---- index ------------------------------------------------------------------------------------
  // id → node and parent id → children (page order). Each node's page and array position are located on first use
  // (reconciling, commands): the sync reorders siblings by swapping their slots in the page array, and a group is
  // re-sorted only after a move or a reorder.
  const MAX_DEPTH = 10001;
  function indexOf(doc) {
    const byId = new Map(),
      kids = new Map(),
      unsorted = new Set(),
      pages = pagesOf(doc);
    for (const page of pages) {
      const list = page.nodes;
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (!n || typeof n !== "object" || !nonempty(n.id) || byId.has(n.id)) continue;
        byId.set(n.id, n);
        if (!n.parentId) continue;
        const group = kids.get(n.parentId);
        if (group) group.push(n);
        else kids.set(n.parentId, [n]);
      }
    }
    let located = null;
    const pageMap = new Map(),
      posMap = new Map();
    const locate = () => {
      if (located) return;
      located = true;
      for (const page of pages)
        page.nodes.forEach((n, i) => {
          if (n && byId.get(n.id) === n) {
            pageMap.set(n.id, page);
            posMap.set(n, i);
          }
        });
    };
    const ix = {
      byId,
      pageOf: { get: (id) => (locate(), pageMap.get(id)) },
      pos: { get: (n) => (locate(), posMap.get(n)), set: (n, i) => (locate(), posMap.set(n, i)) },
      get: (id) => (nonempty(id) ? byId.get(id) : undefined),
      /** Children in page order; read-only (`children` returns a copy that may be changed). */
      kidsOf(id) {
        const group = kids.get(id);
        if (!group) return [];
        if (unsorted.delete(id)) group.sort((a, b) => ix.pos.get(a) - ix.pos.get(b));
        return group;
      },
      children: (id) => ix.kidsOf(id).slice(),
      reordered: (id) => unsorted.add(id),
      parent: (n) => (n.parentId ? byId.get(n.parentId) : undefined),
      /** `id` and everything below it, depth first in page order (cycle-safe). */
      subtree(id) {
        const out = [],
          seen = new Set(),
          start = byId.get(id);
        const visit = (n) => {
          if (!n || seen.has(n)) return;
          seen.add(n);
          out.push(n);
          for (const c of ix.kidsOf(n.id)) visit(c);
        };
        visit(start);
        return out;
      },
      add(n, page) {
        locate();
        byId.set(n.id, n);
        pageMap.set(n.id, page);
        posMap.set(n, page.nodes.length);
        page.nodes.push(n);
        if (n.parentId) {
          let group = kids.get(n.parentId);
          if (!group) kids.set(n.parentId, (group = []));
          group.push(n);
        }
      },
      move(n, parentId) {
        if (n.parentId === parentId) return;
        const old = n.parentId && kids.get(n.parentId);
        if (old) old.splice(old.indexOf(n), 1);
        n.parentId = parentId;
        let group = kids.get(parentId);
        if (!group) kids.set(parentId, (group = []));
        group.push(n);
        unsorted.add(parentId);
      },
      /** Drops a node and its subtree from the index; the page arrays are compacted by `compact`. */
      remove(n, removed) {
        for (const d of ix.subtree(n.id)) {
          removed.add(d);
          byId.delete(d.id);
          kids.delete(d.id);
        }
        const group = n.parentId && kids.get(n.parentId);
        if (group && group.includes(n)) group.splice(group.indexOf(n), 1);
      },
    };
    return ix;
  }
  /** Removes the dropped nodes from the page arrays in place (other code may hold the arrays). */
  function compact(doc, removed) {
    if (!removed.size) return;
    for (const page of pagesOf(doc)) {
      let w = 0;
      for (let r = 0; r < page.nodes.length; r++)
        if (!removed.has(page.nodes[r])) page.nodes[w++] = page.nodes[r];
      page.nodes.length = w;
    }
  }
  /** The instance root a node belongs to: the nearest top instance root at or above it. */
  function ownerOf(ix, n) {
    for (let cur = n, i = 0; cur && i < MAX_DEPTH; cur = ix.parent(cur), i++)
      if (isTop(cur)) return cur;
    return null;
  }
  /** The nearest slot frame strictly above `n`, up to and including the instance root. */
  function slotAbove(ix, n, rootNode) {
    for (let cur = ix.parent(n), i = 0; cur && i < MAX_DEPTH; cur = ix.parent(cur), i++) {
      if (cur.slot === true) return cur;
      if (cur === rootNode) break;
    }
    return null;
  }

  // ---- dependency plan --------------------------------------------------------------------------
  // A main depends on the mains of the instances inside it. Mains that reach themselves are cyclic and their
  // instances are never synced (copying would grow forever); the others sync inner mains first.
  function planOf(ix) {
    const mains = [...ix.byId.values()].filter(isMain),
      deps = new Map(),
      scope = new Map(),
      containers = new Map();
    for (const m of mains) {
      const set = new Set(),
        ids = new Set();
      for (const n of ix.subtree(m.id)) {
        ids.add(n.id);
        if (!containers.has(n.id)) containers.set(n.id, []);
        containers.get(n.id).push(m.id);
        if (isTop(n) && isMain(ix.get(n.instanceOf))) set.add(n.instanceOf);
      }
      deps.set(m.id, set);
      scope.set(m.id, ids);
    }
    const cyclic = new Set();
    for (const m of mains) {
      const queue = [...deps.get(m.id)],
        seen = new Set();
      while (queue.length) {
        const id = queue.shift();
        if (id === m.id) {
          cyclic.add(m.id);
          break;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        queue.push(...(deps.get(id) || []));
      }
    }
    const level = new Map();
    const levelOf = (id) => {
      if (level.has(id)) return level.get(id);
      let l = 0;
      for (const d of deps.get(id) || []) if (!cyclic.has(d)) l = Math.max(l, levelOf(d) + 1);
      level.set(id, l);
      return l;
    };
    const syncable = (r) =>
      !!r && isTop(r) && isMain(ix.get(r.instanceOf)) && !cyclic.has(r.instanceOf);
    const instances = [];
    for (const n of ix.byId.values()) if (syncable(n)) instances.push(n);
    const order = instances
      .map((r, i) => ({ r, i, l: levelOf(r.instanceOf) }))
      .sort((a, b) => a.l - b.l || a.i - b.i)
      .map((e) => e.r);
    return {
      cyclic,
      deps,
      order,
      syncable,
      inScope: (r, sourceId) => !!scope.get(r.instanceOf)?.has(sourceId),
      /** The mains whose subtree holds the node. */
      mainsOf: (id) => containers.get(id) || [],
    };
  }

  // ---- unlinking (Modified slots, detach, stray copies) ----------------------------------------
  // Nodes inside a nested instance copy are re-pointed one level down (their source's source), so that nested
  // instance stays an instance of its own main with the overrides of both levels; the others become plain layers.
  function unlink(ix, nodes, { detachRoot = null, plainSlots = false } = {}) {
    const set = new Set(nodes);
    const nested = (n) => {
      const seen = new Set();
      for (let cur = n; cur && set.has(cur) && !seen.has(cur); cur = ix.parent(cur)) {
        seen.add(cur);
        if (cur !== detachRoot && nonempty(cur.instanceOf)) return true;
      }
      return false;
    };
    const plan = nodes.map((n) => ({ n, nested: nested(n), source: ix.get(n.sourceId) }));
    for (const { n, nested: inner, source } of plan) {
      if (inner && source && nonempty(source.sourceId)) {
        n.sourceId = source.sourceId;
        setOverrides(n, [...overridesOf(n), ...overridesOf(source)]);
        continue;
      }
      delete n.sourceId;
      delete n.overrides;
      if (n === detachRoot) delete n.instanceOf;
      if (plainSlots && !inner) {
        delete n.slot;
        delete n.slotName;
      }
    }
  }
  /** Linked nodes owned by `rootNode` (not crossing other top instances), in page order. */
  function ownedBy(ix, rootNode) {
    const out = [];
    for (const n of ix.subtree(rootNode.id)) {
      if (n === rootNode) continue;
      if (isLinked(n) && ownerOf(ix, n) === rootNode) out.push(n);
    }
    return out;
  }

  // ---- property copy ----------------------------------------------------------------------------
  /** Copies the source's keys onto a linked node (not local keys, not overrides); true when anything changed. */
  function copyProps(n, s, isRoot, fresh) {
    const local = isRoot ? ROOT_LOCAL : NODE_LOCAL;
    let changed = false;
    if (hasOverride(n, CHILDREN) && s.slot !== true) {
      setOverrides(
        n,
        overridesOf(n).filter((k) => k !== CHILDREN),
      );
      changed = true;
    }
    const ov = overridesOf(n);
    if (!isRoot && own(n, "component")) {
      delete n.component;
      changed = true;
    }
    const skip = (key) =>
      local.has(key) || ov.includes(key) || (GEOMETRY.includes(key) && !fresh && measured(n, key));
    // Sizing modes first, so `measured` sees the source's modes.
    const keys = Object.keys(s).sort((a, b) => GEOMETRY.includes(a) - GEOMETRY.includes(b));
    for (const key of keys) {
      if (s[key] === undefined || skip(key) || equal(n[key], s[key])) continue;
      n[key] = copy(s[key]);
      changed = true;
    }
    for (const key of Object.keys(n)) {
      if ((own(s, key) && s[key] !== undefined) || skip(key)) continue;
      delete n[key];
      changed = true;
    }
    return changed;
  }

  // ---- phase 1: what the edit between prev and next did to instances ----------------------------
  function slotSignature(ix, slot) {
    return ix
      .subtree(slot.id)
      .slice(1)
      .map((d) => {
        const fields = {};
        for (const key of Object.keys(d))
          if (!UNMARKED.has(key) && !measured(d, key)) fields[key] = d[key];
        return d.id + "|" + d.parentId + "|" + stable(fields);
      })
      .join("\n");
  }
  function markModified(ix, slot, rootNode) {
    if (hasOverride(slot, CHILDREN)) return;
    addOverride(slot, CHILDREN);
    const inside = ix
      .subtree(slot.id)
      .slice(1)
      .filter((d) => isLinked(d) && ownerOf(ix, d) === rootNode);
    unlink(ix, inside);
  }
  /** Same keys with equal values (undefined counts as absent). */
  /** Same keys with equal values (undefined counts as absent), measured geometry aside. */
  function sameNode(a, b) {
    let count = 0;
    for (const key in a) {
      const v = a[key];
      if (v === undefined) continue;
      count++;
      if (
        v !== b[key] &&
        !equal(v, b[key]) &&
        !(GEOMETRY.includes(key) && (measured(a, key) || measured(b, key)))
      )
        return false;
    }
    for (const key in b) if (b[key] !== undefined) count--;
    return count === 0;
  }
  /** Mains, instances and linked layers with everything inside them. */
  function relevantOf(ix) {
    const keep = new Set();
    for (const n of ix.byId.values())
      if (!keep.has(n) && (isMain(n) || isTop(n) || isLinked(n)))
        for (const d of ix.subtree(n.id)) keep.add(d);
    return keep;
  }
  /** Which instances and mains an edit touched: changed, added, removed or reordered layers inside them. Only those
   * are checked for overrides and re-synced; the others were left consistent by the previous sync. */
  function dirtyOf(prevIx, ix, plan) {
    const roots = new Set(),
      mains = new Set();
    const mark = (n) => {
      if (!n) return;
      const r = ownerOf(ix, n);
      if (r) roots.add(r.id);
      for (const m of plan.mainsOf(n.id)) mains.add(m);
    };
    for (const d of relevantOf(ix)) {
      {
        const p = prevIx.get(d.id);
        if (!p) mark(d);
        else if (!sameNode(p, d)) {
          mark(d);
          if (p.parentId !== d.parentId) mark(ix.get(p.parentId));
        }
        const now = ix.kidsOf(d.id),
          before = prevIx.kidsOf(d.id);
        if (now.length !== before.length || now.some((c, i) => c.id !== before[i].id)) mark(d);
      }
    }
    for (const p of prevIx.byId.values()) {
      if (ix.get(p.id)) continue;
      mark(ix.get(p.parentId));
      const was = ownerOf(prevIx, p);
      if (was && ix.get(was.id)) roots.add(was.id);
    }
    return { roots, mains };
  }
  /** Phase 1, on the instances the edit touched: strays, Modified slots, overrides, deleted inherited layers.
   * Reports whether it changed the tree (the caller re-indexes) or any node. */
  function detect(prevIx, ix, plan, dirty, doc) {
    let structural = false;
    // Linked nodes outside their instance (moved out, pasted, or a stray duplicate): back to their previous parent
    // when that is still in the same instance, otherwise they become plain layers.
    const strays = () =>
      [...ix.byId.values()].filter((n) => {
        if (!isLinked(n)) return false;
        const r = ownerOf(ix, n);
        if (r && !plan.syncable(r)) return false; // missing or cyclic main: left exactly as it is
        return !r || !plan.inScope(r, n.sourceId);
      });
    let lost = strays();
    if (lost.length && prevIx) {
      const lostSet = new Set(lost);
      for (const n of lost) {
        if (lostSet.has(ix.parent(n))) continue;
        const p = prevIx.get(n.id),
          was = p && ownerOf(prevIx, p),
          parent = p && ix.get(p.parentId);
        if (!was || !parent || lostSet.has(parent)) continue;
        if (ix.pageOf.get(parent.id) !== ix.pageOf.get(n.id)) continue;
        if (ownerOf(ix, parent) !== ix.get(was.id)) continue;
        n.parentId = parent.id;
        structural = true;
      }
      if (structural) {
        ix = indexOf(doc);
        lost = strays();
      }
    }
    if (lost.length) unlink(ix, lost);
    let changed = structural || lost.length > 0;
    // Instance roots written without a sourceId (agents) point it at their main.
    for (const n of ix.byId.values())
      if (isTop(n) && n.sourceId !== n.instanceOf) {
        n.sourceId = n.instanceOf;
        changed = true;
      }
    if (!prevIx || (!dirty.roots.size && !dirty.mains.size)) return { structural, changed };
    changed = true;
    const touched = [];
    for (const id of dirty.roots) {
      const r = ix.get(id);
      if (plan.syncable(r)) touched.push(r);
    }
    const owned = new Map(touched.map((r) => [r, ownedBy(ix, r)]));
    // Slots in Default state whose content changed (added, removed, reordered, moved, edited) become Modified.
    for (const r of touched)
      for (const n of owned.get(r)) {
        if (n.slot !== true || hasOverride(n, CHILDREN) || !isLinked(n)) continue;
        const p = prevIx.get(n.id);
        if (p && slotSignature(ix, n) !== slotSignature(prevIx, p)) markModified(ix, n, r);
      }
    // Changed keys of linked nodes (and instance roots) that differ from their source become overrides.
    const mark = (n, p, s, local) => {
      const check = (key) => {
        if (local.has(key) || measured(n, key) || measured(p, key)) return;
        if (!equal(p[key], n[key]) && !equal(n[key], s[key])) addOverride(n, key);
      };
      for (const key of Object.keys(p)) check(key);
      for (const key of Object.keys(n)) if (!own(p, key)) check(key);
    };
    for (const r of touched) {
      const main = ix.get(r.instanceOf),
        before = prevIx.get(r.id);
      if (before && !sameNode(before, r)) mark(r, before, main, ROOT_LOCAL);
      for (const n of owned.get(r)) {
        if (!isLinked(n)) continue; // unlinked by a slot turning Modified
        const slot = slotAbove(ix, n, r);
        if (slot && !hasOverride(slot, CHILDREN)) continue; // covered by the slot signature
        const p = prevIx.get(n.id),
          source = ix.get(n.sourceId);
        if (p && source && !sameNode(p, n)) mark(n, p, source, UNMARKED);
      }
    }
    // Inherited layers deleted inside an instance (outside slots) come back hidden.
    for (const p of prevIx.byId.values()) {
      if (!isLinked(p) || ix.get(p.id)) continue;
      const was = ownerOf(prevIx, p),
        r = was && ix.get(was.id),
        parent = ix.get(p.parentId),
        source = ix.get(p.sourceId);
      if (!r || !plan.syncable(r) || r.instanceOf !== was.instanceOf || !parent || !source)
        continue;
      if (!plan.inScope(r, p.sourceId) || (parent !== r && ownerOf(ix, parent) !== r)) continue;
      // Inside a slot the deletion is a slot change (the signature above made it Modified).
      if (parent.slot === true || (parent !== r && slotAbove(ix, parent, r))) continue;
      const page = ix.pageOf.get(r.id);
      // Only the linked part comes back (the canvas keeps no history of local layers).
      const clones = [];
      const keep = (d) => {
        if (ix.get(d.id) || !isLinked(d)) return;
        clones.push(copy(d));
        for (const c of prevIx.kidsOf(d.id)) keep(c);
      };
      keep(p);
      clones[0].hidden = true;
      if (source.hidden !== true) addOverride(clones[0], "hidden");
      else
        setOverrides(
          clones[0],
          overridesOf(clones[0]).filter((k) => k !== "hidden"),
        );
      for (const c of clones) ix.add(c, page);
      structural = true;
    }
    return { structural, changed };
  }

  // ---- phase 2: copy each main onto its instances ----------------------------------------------
  /** Copies the main onto one instance; true when anything changed. */
  function reconcile(ix, plan, rootNode, removed) {
    const main = ix.get(rootNode.instanceOf),
      page = ix.pageOf.get(rootNode.id);
    let changed = false;
    // Linked nodes of this instance by source id; later duplicates of a source become plain layers.
    const bySource = new Map(),
      strays = [];
    const seen = new Set();
    const walk = (n) => {
      for (const c of ix.kidsOf(n.id)) {
        if (seen.has(c) || isTop(c)) continue;
        seen.add(c);
        if (isLinked(c)) {
          if (bySource.has(c.sourceId) || !plan.inScope(rootNode, c.sourceId)) strays.push(c);
          else bySource.set(c.sourceId, c);
        }
        walk(c);
      }
    };
    walk(rootNode);
    if (strays.length) {
      unlink(ix, strays);
      changed = true;
    }
    const visited = new Set();
    const taken = (id) => ix.byId.has(id);
    const drop = (c) => {
      ix.remove(c, removed);
      changed = true;
    };
    const visit = (n, s, isRoot, fresh) => {
      visited.add(n);
      if (copyProps(n, s, isRoot, fresh)) changed = true;
      if (isModifiedSlot(n)) return;
      const sourceKids = ix.kidsOf(s.id);
      // A slot in Default state shows exactly the main's content.
      if (n.slot === true) {
        const wanted = new Set(sourceKids.map((k) => k.id));
        for (const c of ix.children(n.id))
          if (!(isLinked(c) && bySource.get(c.sourceId) === c && wanted.has(c.sourceId))) drop(c);
      }
      const ordered = [];
      for (const sc of sourceKids) {
        let c = bySource.get(sc.id),
          created = false;
        if (!c || removed.has(c)) {
          c = { id: freshId(taken, rootNode.id, sc.id), parentId: n.id, sourceId: sc.id };
          bySource.set(sc.id, c);
          ix.add(c, page);
          created = changed = true;
        } else if (c.parentId !== n.id) {
          ix.move(c, n.id);
          changed = true;
        }
        ordered.push(c);
        visit(c, sc, false, created);
      }
      // Siblings follow the main's order; local layers keep their places between them.
      const inOrder = new Set(ordered);
      const current = ix.kidsOf(n.id).filter((c) => inOrder.has(c));
      if (current.some((c, i) => c !== ordered[i])) {
        const slots = current.map((c) => ix.pos.get(c)).sort((a, b) => a - b);
        ordered.forEach((c, i) => {
          page.nodes[slots[i]] = c;
          ix.pos.set(c, slots[i]);
        });
        ix.reordered(n.id);
        changed = true;
      }
    };
    visit(rootNode, main, true, false);
    // Copies whose source left the main (or moved out of reach) go, unless they sit in a Modified slot.
    for (const c of bySource.values()) {
      if (visited.has(c) || removed.has(c)) continue;
      const slot = slotAbove(ix, c, rootNode);
      if (slot && isModifiedSlot(slot)) continue;
      drop(c);
    }
    return changed;
  }

  function syncComponents(prev, next) {
    syncIndexed(prev ? indexOf(prev) : null, next);
    return next;
  }
  /** Returns false only when nothing changed since `prevIx` and the sync had nothing to do. */
  function syncIndexed(prevIx, next) {
    if (!hasComponents(next)) return false;
    const ix = indexOf(next);
    return run(next, ix, prevIx, prevIx ? dirtyOf(prevIx, ix, planOf(ix)) : null);
  }
  /** The sync proper; `dirty` limits it to the instances and mains an edit touched (null: all of them). Returns
   * whether anything may have changed. */
  function run(next, ix, prevIx, dirty) {
    let plan = planOf(ix);
    const found = detect(prevIx, ix, plan, dirty, next);
    if (found.structural) {
      ix = indexOf(next);
      plan = planOf(ix);
    }
    const removed = new Set();
    for (const r of plan.order) {
      if (removed.has(r) || ix.byId.get(r.id) !== r) continue;
      if (dirty && !dirty.roots.has(r.id) && !dirty.mains.has(r.instanceOf)) continue;
      // A changed instance inside a main changes that main for the instances synced after it.
      if (reconcile(ix, plan, r, removed) && dirty)
        for (const m of plan.mainsOf(r.id)) dirty.mains.add(m);
    }
    compact(next, removed);
    return found.changed || !dirty || dirty.roots.size > 0 || dirty.mains.size > 0;
  }

  // ---- commands ---------------------------------------------------------------------------------
  /** Mains that contain an instance of themselves, directly or through other mains. */
  function componentProblems(doc) {
    const ix = indexOf(doc),
      plan = planOf(ix);
    return [...plan.cyclic].map((id) => ({
      id,
      message: `Main component ${ix.get(id)?.name || id} contains an instance of itself`,
    }));
  }
  function createComponent(doc, pageId, frameId) {
    const ix = indexOf(doc),
      n = ix.get(frameId);
    if (!n || (pageId && ix.pageOf.get(n.id)?.id !== pageId)) throw new Error("Layer not found");
    if (n.type !== "frame") throw new Error("Only a frame can become a main component");
    if (isMain(n)) throw new Error("This frame is already a main component");
    if (nonempty(n.instanceOf))
      throw new Error("Detach the instance before making it a main component");
    if (isLinked(n)) throw new Error("A layer inside an instance cannot become a main component");
    n.component = true;
    return doc;
  }
  /** Mains whose instances may not be placed inside `parentId` (it would make a main contain itself). */
  function cycleThrough(doc, mainId, parentId) {
    const ix = indexOf(doc),
      plan = planOf(ix);
    const reaches = (from, to) => {
      const queue = [from],
        seen = new Set();
      while (queue.length) {
        const id = queue.shift();
        if (id === to) return true;
        if (seen.has(id)) continue;
        seen.add(id);
        queue.push(...(plan.deps.get(id) || []));
      }
      return false;
    };
    const seen = new Set();
    for (let cur = ix.get(parentId); cur && !seen.has(cur); cur = ix.parent(cur)) {
      seen.add(cur);
      if (isMain(cur) && reaches(mainId, cur.id)) return true;
    }
    return false;
  }
  function wouldCycle(doc, nodes, parentId) {
    if (!parentId) return false;
    const mains = new Set();
    for (const n of nodes || []) if (n && nonempty(n.instanceOf)) mains.add(n.instanceOf);
    return [...mains].some((id) => cycleThrough(doc, id, parentId));
  }
  function createInstance(doc, mainId, options = {}) {
    const ix = indexOf(doc),
      main = ix.get(mainId);
    if (!isMain(main)) throw new Error("Main component not found");
    const page = options.pageId
      ? pagesOf(doc).find((p) => p.id === options.pageId)
      : ix.pageOf.get(main.id);
    if (!page) throw new Error("Page not found");
    const parentId = options.parentId || null;
    if (parentId) {
      const parent = ix.get(parentId);
      if (!parent || parent.type !== "frame" || ix.pageOf.get(parentId) !== page)
        throw new Error("Parent must be a frame on the same page");
      if (cycleThrough(doc, mainId, parentId))
        throw new Error("A main component cannot contain an instance of itself");
    }
    const id = options.id || randomId();
    if (ix.byId.has(id)) throw new Error("Duplicate id");
    const node = { id, parentId, instanceOf: main.id, sourceId: main.id };
    copyProps(node, main, true, true);
    node.x = Number.isFinite(options.x) ? options.x : (main.x || 0) + (main.w || 0) + 40;
    node.y = Number.isFinite(options.y) ? options.y : main.y || 0;
    page.nodes.push(node);
    // Only the new instance needs copying (mains holding it then re-sync their own instances).
    run(doc, indexOf(doc), null, { roots: new Set([id]), mains: new Set() });
    return { doc, id };
  }
  function detachInstance(doc, rootId) {
    const ix = indexOf(doc),
      r = ix.get(rootId);
    if (!isTop(r)) throw new Error("Not an instance");
    unlink(ix, [r, ...ownedBy(ix, r)], { detachRoot: r, plainSlots: true });
    return doc;
  }
  function resetOverrides(doc, ids, { all = false } = {}) {
    const ix = indexOf(doc),
      targets = new Set();
    for (const id of [].concat(ids || [])) {
      const n = ix.get(id);
      if (!n) continue;
      const r = isTop(n) ? n : isLinked(n) ? ownerOf(ix, n) : null;
      if (all && r) [r, ...ownedBy(ix, r)].forEach((x) => targets.add(x));
      else if (isTop(n) || isLinked(n)) targets.add(n);
    }
    for (const n of targets) delete n.overrides;
    return syncComponents(null, doc);
  }
  function setSlot(doc, frameId, on, name) {
    const ix = indexOf(doc),
      n = ix.get(frameId);
    if (!n) throw new Error("Layer not found");
    if (on) {
      if (n.type !== "frame") throw new Error("Only a frame can be a slot");
      if (isLinked(n) || isTop(n)) throw new Error("Slots are set on the main component");
      if (isMain(n)) throw new Error("A main component cannot be its own slot");
      let inMain = false;
      const seen = new Set();
      for (let cur = ix.parent(n); cur && !seen.has(cur); cur = ix.parent(cur)) {
        seen.add(cur);
        if (isMain(cur)) inMain = true;
      }
      if (!inMain) throw new Error("A slot must be inside a main component");
      n.slot = true;
      const label = typeof name === "string" ? name.trim().slice(0, 100) : "";
      if (label) n.slotName = label;
      else if (name !== undefined) delete n.slotName;
    } else {
      if (isLinked(n)) throw new Error("Slots are set on the main component");
      delete n.slot;
      delete n.slotName;
    }
    return syncComponents(null, doc);
  }

  function slotState(n) {
    return {
      id: n.id,
      name: n.slotName || n.name,
      state: hasOverride(n, CHILDREN) ? "modified" : "default",
    };
  }
  /** Inspector/layers data for a node: role main | instance | inherited | slot | local, or null. */
  function componentInfo(doc, nodeId) {
    const ix = indexOf(doc),
      n = ix.get(nodeId);
    if (!n) return null;
    const plan = planOf(ix);
    const info = {
      id: n.id,
      role: null,
      mainId: null,
      mainName: null,
      missingMain: false,
      cyclic: false,
      instanceId: null,
      overrides: overridesOf(n),
      overrideCount: 0,
      instanceCount: 0,
      slots: [],
      slot: null,
    };
    const describeMain = (id) => {
      const main = ix.get(id);
      info.mainId = id;
      info.mainName = isMain(main) ? main.name : null;
      info.missingMain = !isMain(main);
      info.cyclic = plan.cyclic.has(id);
    };
    if (isMain(n)) {
      info.role = "main";
      describeMain(n.id);
      info.instanceCount = [...ix.byId.values()].filter(
        (x) => isTop(x) && x.instanceOf === n.id,
      ).length;
      info.slots = ix
        .subtree(n.id)
        .filter((d) => d !== n && d.slot === true && !isLinked(d))
        .map((d) => ({ id: d.id, name: d.slotName || d.name }));
      return info;
    }
    const r = isTop(n) ? n : ownerOf(ix, n);
    if (isTop(n)) {
      info.role = "instance";
      info.instanceId = n.id;
      describeMain(n.instanceOf);
      const owned = ownedBy(ix, n);
      info.overrideCount = [n, ...owned].reduce((sum, x) => sum + overridesOf(x).length, 0);
      info.slots = owned.filter((d) => d.slot === true).map(slotState);
      return info;
    }
    if (isLinked(n) && r) {
      info.role = n.slot === true ? "slot" : "inherited";
      info.instanceId = r.id;
      describeMain(r.instanceOf);
      info.overrideCount = info.overrides.length;
      if (n.slot === true) info.slot = slotState(n);
      return info;
    }
    if (n.slot === true) {
      info.role = "slot";
      info.slot = { id: n.id, name: n.slotName || n.name, state: "default" };
      const seen = new Set();
      for (let cur = ix.parent(n); cur && !seen.has(cur); cur = ix.parent(cur)) {
        seen.add(cur);
        if (isMain(cur)) {
          describeMain(cur.id);
          break;
        }
      }
      return info;
    }
    if (r) {
      info.role = "local";
      info.instanceId = r.id;
      describeMain(r.instanceOf);
    }
    return info;
  }

  /** Duplicate/paste: `copies` are new nodes (not yet in `doc`), `idMap` maps each original id to its copy's id.
   * Mutates the copies (descendant ids may change; roots keep theirs) and returns them. */
  function adoptCopies(doc, copies, idMap) {
    if (!Array.isArray(copies) || !copies.length) return copies;
    const ix = indexOf(doc),
      originalOf = new Map();
    for (const [from, to] of idMap instanceof Map ? idMap : Object.entries(idMap || {}))
      originalOf.set(to, from);
    const byId = new Map(copies.map((c) => [c.id, c])),
      kids = new Map();
    for (const c of copies)
      if (byId.has(c.parentId)) {
        if (!kids.has(c.parentId)) kids.set(c.parentId, []);
        kids.get(c.parentId).push(c);
      }
    const below = (c) => {
      const out = [];
      const visit = (x) => {
        for (const k of kids.get(x.id) || []) {
          out.push(k);
          visit(k);
        }
      };
      visit(c);
      return out;
    };
    const taken = (id) => ix.byId.has(id) || byId.has(id);
    const rename = (c, id) => {
      if (c.id === id) return;
      for (const k of kids.get(c.id) || []) k.parentId = id;
      if (kids.has(c.id)) {
        kids.set(id, kids.get(c.id));
        kids.delete(c.id);
      }
      byId.delete(c.id);
      byId.set(id, c);
      c.id = id;
    };
    const handled = new Set();
    for (const c of copies) {
      if (byId.has(c.parentId)) continue;
      const original = ix.get(originalOf.get(c.id));
      if (c.component === true && isMain(original) && original.id === originalOf.get(c.id)) {
        // A copy of a main is an instance of it (Figma).
        delete c.component;
        delete c.overrides;
        c.instanceOf = original.id;
        c.sourceId = original.id;
        handled.add(c);
        for (const d of below(c)) {
          const from = originalOf.get(d.id);
          handled.add(d);
          delete d.component;
          delete d.overrides;
          if (!from) continue;
          d.sourceId = from;
          rename(d, freshId(taken, c.id, from));
        }
      } else if (isTop(c)) {
        // A copy of an instance keeps its overrides and slot content; its linked layers get ids of the new root.
        handled.add(c);
        const stop = new Set();
        for (const d of below(c)) {
          handled.add(d);
          if (stop.has(d.parentId) || (isTop(d) && d !== c)) {
            stop.add(d.id);
            continue;
          }
          if (isLinked(d)) rename(d, freshId(taken, c.id, d.sourceId));
        }
      }
    }
    // Parts of an instance copied without their root are plain layers (nested instances stay instances).
    const loose = copies.filter((c) => !handled.has(c) && isLinked(c) && !nestedUnderTop(c));
    function nestedUnderTop(c) {
      const seen = new Set();
      for (let cur = byId.get(c.parentId); cur && !seen.has(cur); cur = byId.get(cur.parentId)) {
        seen.add(cur);
        if (isTop(cur)) return true;
      }
      return false;
    }
    if (loose.length) {
      const view = {
        get: (id) => ix.get(id),
        parent: (n) => byId.get(n.parentId),
      };
      unlink(view, loose, { plainSlots: true });
    }
    return copies;
  }

  /** Mains, instances and linked layers with everything inside them: all the sync needs from `prev`. Values are
   * copied, strings shared (embedded images are not duplicated). */
  function snapshot(doc) {
    const keep = relevantOf(indexOf(doc));
    return {
      version: 2,
      pages: pagesOf(doc).map((page) => ({
        id: page.id,
        nodes: page.nodes.filter((n) => keep.has(n)).map(copy),
      })),
    };
  }

  // ---- renderer glue ----------------------------------------------------------------------------
  /** web/app.js: render() calls sync(design) before drawing. In-place edits made since the previous sync are diffed
   * against that sync's result (geometry the canvas measures while drawing is ignored); a replaced document (load,
   * undo, remote edits, agent commits that already ran the sync) is only reconciled. settle(doc) makes the document as
   * it is now the baseline (component commands, which leave it consistent). */
  function live() {
    let baseDoc = null,
      baseIx = null,
      memo = new Map(); // node id → {node, copy}: unchanged nodes keep their copy from one baseline to the next
    function settle(doc) {
      baseDoc = doc;
      baseIx = null;
      if (!hasComponents(doc)) {
        memo = new Map();
        return;
      }
      const keep = relevantOf(indexOf(doc)),
        next = new Map();
      const pages = pagesOf(doc).map((page) => {
        const nodes = [];
        for (const n of page.nodes) {
          if (!keep.has(n)) continue;
          let entry = memo.get(n.id);
          if (!entry || entry.node !== n || !sameNode(entry.copy, n))
            entry = { node: n, copy: copy(n) };
          next.set(n.id, entry);
          nodes.push(entry.copy);
        }
        return { id: page.id, nodes };
      });
      memo = next;
      baseIx = indexOf({ pages });
    }
    return {
      sync(doc) {
        try {
          if (!hasComponents(doc)) {
            if (baseIx) settle(doc);
            baseDoc = doc;
          } else if (syncIndexed(doc === baseDoc ? baseIx : null, doc) || doc !== baseDoc)
            settle(doc);
        } catch (error) {
          console.error("Component sync failed", error);
        }
        return doc;
      },
      settle,
    };
  }
  /** window.design.components: each command is checked on a copy first, then applied as one undo step. */
  function editor(api) {
    const selected = () => api.selection();
    const run = (fn) => {
      fn(JSON.parse(JSON.stringify(api.design)));
      api.checkpoint();
      const result = fn(api.design);
      api.sync.settle(api.design);
      api.render();
      return result;
    };
    const pageId = () => api.design.activePage;
    return {
      create(frameId = selected()[0]) {
        run((doc) => createComponent(doc, null, frameId));
        return frameId;
      },
      instance(mainId, options = {}) {
        const id = options.id || randomId();
        run((doc) => createInstance(doc, mainId, { pageId: pageId(), ...options, id }));
        api.select([id]);
        return id;
      },
      detach(rootId = selected()[0]) {
        run((doc) => detachInstance(doc, rootId));
        return rootId;
      },
      reset(ids = selected(), options = {}) {
        run((doc) => resetOverrides(doc, ids, options));
        return true;
      },
      setSlot(frameId, on = true, name) {
        run((doc) => setSlot(doc, frameId, on, name));
        return true;
      },
      info: (nodeId = selected()[0]) => componentInfo(api.design, nodeId),
      problems: () => componentProblems(api.design),
    };
  }

  root.VerynizeComponents = {
    syncComponents,
    createComponent,
    createInstance,
    detachInstance,
    resetOverrides,
    setSlot,
    componentInfo,
    componentProblems,
    wouldCycle,
    adoptCopies,
    hasComponents,
    snapshot,
    derivedId,
    live,
    editor,
    NODE_LOCAL,
    ROOT_LOCAL,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
