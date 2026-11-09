// Size limits of shared design rooms, in UTF-8 bytes of JSON. One definition for the
// collaboration Worker (imported through cloud/limits.js) and the renderer (classic script:
// globalThis.VerynizeRoomLimits), so warnings in the editor match what the server enforces.
//
// Rooms store each page separately (cloud/room-store.js): a page holds its properties and nodes,
// the document metadata (name, variables, styles, page order, other top-level fields) is kept
// apart, and the whole document matches the 20 MiB a desktop file allows.
(function (scope) {
  "use strict";
  const MiB = 1024 * 1024;
  const DOCUMENT_BYTES = 20 * MiB;
  const PAGE_BYTES = DOCUMENT_BYTES;
  const META_BYTES = 2 * MiB;
  // Whole-document requests (create, legacy snapshot writes) and socket messages carry up to a
  // whole document plus their envelope.
  const REQUEST_BYTES = DOCUMENT_BYTES + MiB;
  const MESSAGE_BYTES = REQUEST_BYTES;
  // One operation batch (its whole message) and its operations. The room applies a batch in one
  // synchronous turn, holding the message, the parsed operations and the broadcast at once, so a
  // batch stays a small fraction of the isolate's 128 MB. One operation larger than that (a node
  // holding a large text) travels alone, up to MESSAGE_BYTES. The room rejects other batches above
  // these limits with `code: "batch_too_large"` (BATCH_TOO_LARGE).
  const BATCH_BYTES = 4 * MiB;
  const BATCH_OPS = 5000;
  const BATCH_TOO_LARGE = "batch_too_large";
  // Leave room for message type, batch number and future envelope fields.
  const ENVELOPE_BYTES = 65536;

  /** UTF-8 length of a string without encoding it (lone surrogates count as U+FFFD). */
  function utf8Length(text) {
    let length = text.length;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 0x80) continue;
      if (code < 0x800) length += 1;
      else if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00 &&
        i + 1 < text.length
      ) {
        length += 2;
        i++;
      } else length += 2;
    }
    return length;
  }
  const bytes = (value) => utf8Length(typeof value === "string" ? value : JSON.stringify(value));

  const NODE_KINDS = new Set(["add", "remove", "node", "text"]);
  const ORDER_KINDS = new Set(["nodeOrder", "pageOrder"]);

  /**
   * Split operations into batches the room accepts, or null when one operation alone is too
   * large. A change that fits one batch stays one batch, so collaborators see it at once. A
   * larger change is split into self-contained units, each applied atomically: everything one
   * artboard (top-level node with its descendants) gains, loses or changes is one unit, with nodes
   * that move between artboards joining both. A unit that is still too large is split the same
   * way one level down (a parent's additions before its children, its removal after them), so no
   * batch leaves a node pointing at a parent that is not there. Order changes come last.
   * `documents()` (optional) returns {before, after}, the documents around the change, to find the
   * artboard of a node the operations do not place themselves.
   * @param {any[]} ops
   * @param {{ documents?: () => { before: any; after: any } }} [options]
   */
  function batchOps(ops, { documents } = {}) {
    const limit = BATCH_BYTES - ENVELOPE_BYTES;
    const size = new Map();
    let total = 2;
    for (const op of ops) {
      const length = bytes(op) + 1;
      if (length + 2 > MESSAGE_BYTES - ENVELOPE_BYTES) return null;
      size.set(op, length);
      total += length;
    }
    if (!ops.length) return [];
    const fits = (list) => {
      if (list.length > BATCH_OPS) return false;
      let sum = 2;
      for (const op of list) if ((sum += size.get(op)) > limit) return false;
      return true;
    };
    if (ops.length <= BATCH_OPS && total <= limit) return [ops.slice()];

    // An oversized new page arrives empty, then fills artboard by artboard.
    const expanded = [],
      created = new Map();
    for (const op of ops) {
      if (op?.t !== "addPage" || fits([op]) || !Array.isArray(op.value?.nodes)) {
        expanded.push(op);
        continue;
      }
      const head = { ...op, value: { ...op.value, nodes: [] } };
      size.set(head, bytes(head) + 1);
      created.set(op.id, expanded.length);
      expanded.push(head);
      for (const node of op.value.nodes) {
        const add = {
          t: "add",
          page: op.id,
          id: node.id,
          value: node,
          ...(op.s ? { s: op.s } : {}),
        };
        size.set(add, bytes(add) + 1);
        expanded.push(add);
      }
    }

    // Parents after the change (the operations' own values first) and before it.
    /** @type {{ before?: any; after?: any }} */
    const docs = documents?.() || {};
    const parentMap = (doc) => {
      const map = new Map();
      for (const page of Array.isArray(doc?.pages) ? doc.pages : [])
        for (const node of Array.isArray(page?.nodes) ? page.nodes : [])
          if (node && typeof node.id === "string" && !map.has(node.id))
            map.set(node.id, node.parentId ?? null);
      return map;
    };
    const before = parentMap(docs.before),
      after = parentMap(docs.after);
    const set = new Map();
    for (const op of expanded) {
      if (op?.t === "add" && op.value) set.set(op.id, op.value.parentId ?? null);
      else if (op?.t === "node" && op.key === "parentId")
        set.set(op.id, op.del ? null : (op.value ?? null));
    }
    const pathOf = (lookup) => {
      const memo = new Map();
      const walk = (id) => {
        if (memo.has(id)) return memo.get(id);
        const chain = [],
          seen = new Set();
        for (let current = id; current != null && !seen.has(current); current = lookup(current)) {
          if (memo.has(current)) {
            chain.push(...memo.get(current).slice().reverse());
            break;
          }
          seen.add(current);
          chain.push(current);
        }
        const path = chain.reverse();
        memo.set(id, path);
        return path;
      };
      return walk;
    };
    const pathAfter = pathOf((id) =>
      set.has(id) ? set.get(id) : after.has(id) ? after.get(id) : (before.get(id) ?? null),
    );
    const pathBefore = pathOf((id) =>
      before.has(id) ? before.get(id) : set.has(id) ? set.get(id) : (after.get(id) ?? null),
    );

    // Group operations by the keys they touch at one level (union-find), in first-operation order.
    function groupBy(list, keysOf) {
      const parent = new Map();
      const find = (key) => {
        while (parent.get(key) !== key) {
          parent.set(key, parent.get(parent.get(key)));
          key = parent.get(key);
        }
        return key;
      };
      const join = (a, b) => {
        for (const key of [a, b]) if (!parent.has(key)) parent.set(key, key);
        const x = find(a),
          y = find(b);
        if (x !== y) parent.set(y, x);
      };
      const keyed = list.map((op) => {
        const keys = keysOf(op);
        if (!keys) return null;
        join(keys[0], keys[keys.length - 1]);
        return keys[0];
      });
      const groups = new Map(),
        rest = [];
      list.forEach((op, index) => {
        if (keyed[index] === null) return rest.push(op);
        const root = find(keyed[index]);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(op);
      });
      return { groups: [...groups.values()], rest };
    }
    // Last resort for one node's own operations: plain chunks in order.
    function chunk(list) {
      const out = [];
      let part = [],
        sum = 2;
      for (const op of list) {
        if (part.length && (part.length >= BATCH_OPS || sum + size.get(op) > limit)) {
          out.push(part);
          part = [];
          sum = 2;
        }
        part.push(op);
        sum += size.get(op);
      }
      if (part.length) out.push(part);
      return out;
    }
    // Units of a group whose operations share the ancestor at `depth` of their paths.
    function split(list, depth) {
      if (fits(list)) return [list];
      const keyAt = (path) => (path.length > depth + 1 ? path[depth + 1] : null);
      const { groups, rest: head } = groupBy(list, (op) => {
        const keys = [keyAt(pathAfter(op.id)), keyAt(pathBefore(op.id))].filter((k) => k !== null);
        return keys.length ? keys : null;
      });
      if (groups.length + Number(head.length > 0) < 2) return chunk(list);
      const children = groups.flatMap((group) => split(group, depth + 1));
      const own = head.length ? split(head, depth) : [];
      const removed = head.some((op) => op.t === "remove") && !head.some((op) => op.t === "add");
      return removed ? children.concat(own) : own.concat(children);
    }

    const ordered = expanded.filter((op) => ORDER_KINDS.has(op?.t));
    const { groups, rest } = groupBy(
      expanded.filter((op) => !ORDER_KINDS.has(op?.t)),
      (op) =>
        NODE_KINDS.has(op?.t) ? ["n:" + pathAfter(op.id)[0], "n:" + pathBefore(op.id)[0]] : null,
    );
    // Units in the order of their first operation (after the page their nodes join); page and
    // document changes stay single units.
    const index = new Map(expanded.map((op, at) => [op, at]));
    const placed = (group) =>
      Math.max(
        index.get(group[0]),
        ...group.map((op) => (op.t === "add" && created.has(op.page) ? created.get(op.page) : -1)),
      );
    const units = groups
      .map((group) => ({ at: placed(group), parts: split(group, 0) }))
      .concat(rest.map((op) => ({ at: index.get(op), parts: [[op]] })))
      .sort((a, b) => a.at - b.at)
      .flatMap((unit) => unit.parts);
    // Nodes join their page in unit order; where that differs from the change's own order, the
    // page's final order (from `after`) follows unless the change reorders the page itself.
    const addsOf = (list) => {
      const pages = new Map();
      for (const op of list)
        if (op.t === "add") pages.set(op.page, (pages.get(op.page) || "") + "\n" + op.id);
      return pages;
    };
    const intended = addsOf(expanded),
      emitted = addsOf(units.flat());
    const reordered = new Set(ordered.filter((op) => op.t === "nodeOrder").map((op) => op.page));
    for (const [page, ids] of intended) {
      const nodes = docs.after?.pages?.find?.((item) => item?.id === page)?.nodes;
      if (emitted.get(page) === ids || reordered.has(page) || !Array.isArray(nodes)) continue;
      const stamps = expanded.filter((op) => op.page === page && op.s).map((op) => op.s);
      const order = { t: "nodeOrder", page, value: nodes.map((node) => node.id) };
      if (stamps.length) order.s = stamps.reduce((a, b) => (b > a ? b : a));
      size.set(order, bytes(order) + 1);
      ordered.push(order);
    }
    if (ordered.length) units.push(...chunk(ordered));

    const batches = [];
    let batch = [],
      sum = 2;
    for (const unit of units) {
      const unitSize = unit.reduce((n, op) => n + size.get(op), 0);
      if (batch.length && (batch.length + unit.length > BATCH_OPS || sum + unitSize > limit)) {
        batches.push(batch);
        batch = [];
        sum = 2;
      }
      batch.push(...unit);
      sum += unitSize;
    }
    if (batch.length) batches.push(batch);
    return batches;
  }
  scope.VerynizeRoomLimits = Object.freeze({
    batchOps,
    PAGE_BYTES,
    DOCUMENT_BYTES,
    META_BYTES,
    REQUEST_BYTES,
    MESSAGE_BYTES,
    BATCH_BYTES,
    BATCH_OPS,
    BATCH_TOO_LARGE,
    ENVELOPE_BYTES,
    bytes,
    utf8Length,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
