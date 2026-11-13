"use strict";
// Structural index over a page's flat node list (id → node, parent → children), so lookups, subtrees and
// "selected nodes without a selected ancestor" stop scanning the whole page per node.
//
// The editor mutates node arrays in place (push, splice, parentId edits) without a revision counter, so an index is
// cached per array and checked against the live array on use: `of(list)` compares every slot's node, id and parentId
// (one tight O(N) pass, no allocation) and rebuilds when anything structural changed. `find(list, id)` is O(1): it
// verifies only the one slot it returns and falls back to the full check on a miss. Results are never stale.
(() => {
  const cache = new WeakMap();

  function build(list) {
    const nodes = list.slice(),
      ids = nodes.map((node) => node?.id),
      parents = nodes.map((node) => node?.parentId),
      at = new Map(),
      kids = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) continue;
      if (!at.has(node.id)) at.set(node.id, i); // the first wins, like Array#find
      const key = node.parentId || null;
      let group = kids.get(key);
      if (!group) kids.set(key, (group = []));
      group.push(node);
    }
    return { list, nodes, ids, parents, at, kids };
  }

  function current(state) {
    const { list, nodes, ids, parents } = state;
    if (list.length !== nodes.length) return false;
    for (let i = 0; i < nodes.length; i++) {
      const node = list[i];
      if (node !== nodes[i] || (node && (node.id !== ids[i] || node.parentId !== parents[i])))
        return false;
    }
    return true;
  }

  function stateOf(list, check = true) {
    let state = cache.get(list);
    if (!state || (check && !current(state))) cache.set(list, (state = build(list)));
    return state;
  }

  const EMPTY = Object.freeze([]);
  function view(state) {
    const get = (id) => {
      const i = state.at.get(id);
      return i === undefined ? undefined : state.nodes[i];
    };
    return {
      get,
      has: (id) => state.at.has(id),
      /** Direct children of `parentId` (null: top level) in document order. Read-only: copy before changing it. */
      children: (parentId) => state.kids.get(parentId || null) || EMPTY,
      /** `id` and every node below it, as a new Set (`id` first, then breadth first). */
      descendants(id) {
        const found = new Set([id]);
        for (const key of found)
          for (const child of state.kids.get(key) || EMPTY) found.add(child.id);
        return found;
      },
      /** The nodes of `list` that have no ancestor in `list`, in the order given (top-level selection). */
      topmost(list) {
        const chosen = new Set(list.map((node) => node.id));
        return list.filter((node) => {
          let parent = get(node.parentId);
          for (let steps = state.nodes.length; parent && steps > 0; steps--) {
            if (parent.id === node.id) break; // a parent cycle (invalid document) leads back to the node itself
            if (chosen.has(parent.id)) return false;
            parent = get(parent.parentId);
          }
          return true;
        });
      },
    };
  }

  /** The index of `list`, rebuilt first if the array's structure changed since it was built. */
  function of(list) {
    return view(stateOf(list));
  }

  /** `list.find(n => n.id === id)` in O(1) while the slot it finds is unchanged. */
  function find(list, id) {
    if (id === null || id === undefined) return undefined;
    let state = stateOf(list, false),
      i = state.at.get(id);
    if (i !== undefined && list[i]?.id === id) return list[i];
    state = stateOf(list);
    i = state.at.get(id);
    return i === undefined ? undefined : list[i];
  }

  window.VerynizeNodeIndex = Object.freeze({ of, find });
})();
