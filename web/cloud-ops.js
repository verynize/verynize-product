// Operation-based merging shared by the collaboration Worker (cloud/rooms.js) and the
// desktop share panel (web/cloud-panel.js). Loaded as a classic script in the renderer and
// as a side-effect module in the Worker; both read globalThis.VerynizeOps.
//
// A document change is described as a list of small operations (per page, per node and per
// property). Every operation carries a hybrid logical clock stamp. The server applies batches
// in arrival order and keeps the newest stamp per property path (last writer wins), merges
// concurrent edits of the same text range-wise, rejects tree moves that would create cycles,
// and rebroadcasts only the accepted, resolved operations. Clients replay those operations
// in the same order, so every replica converges on the server's document.
(function (scope) {
  "use strict";
  const PROTOCOL = 2;
  const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
  const KINDS = new Set([
    "root",
    "doc",
    "addPage",
    "removePage",
    "page",
    "pageOrder",
    "add",
    "remove",
    "node",
    "text",
    "nodeOrder",
  ]);
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const validKey = (key) =>
    typeof key === "string" && key.length > 0 && key.length <= 120 && !FORBIDDEN.has(key);
  const validId = (id) =>
    typeof id === "string" && id.length > 0 && id.length <= 200 && !FORBIDDEN.has(id);

  // Hybrid logical clock: fixed-width base-36 wall time, counter and replica id, so plain
  // string comparison orders stamps and breaks ties deterministically by replica.
  function encode(wall, count, replica) {
    return (
      wall.toString(36).padStart(10, "0") +
      "." +
      count.toString(36).padStart(6, "0") +
      "." +
      replica
    );
  }
  function decode(stamp) {
    if (typeof stamp !== "string") return null;
    const parts = stamp.split(".");
    if (parts.length < 3 || parts[0].length !== 10 || parts[1].length !== 6) return null;
    const wall = parseInt(parts[0], 36),
      count = parseInt(parts[1], 36);
    if (!Number.isFinite(wall) || !Number.isFinite(count)) return null;
    return { wall, count, replica: parts.slice(2).join(".") };
  }
  function createClock(replica, now = () => Date.now()) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(replica))
      throw Error("Clock replica ids use letters, numbers, dashes or underscores");
    let wall = 0,
      count = 0;
    return {
      next() {
        const time = now();
        if (time > wall) {
          wall = time;
          count = 0;
        } else count++;
        return encode(wall, count, replica);
      },
      observe(stamp) {
        const parsed = decode(stamp);
        if (!parsed) return;
        if (parsed.wall > wall) {
          wall = parsed.wall;
          count = parsed.count;
        } else if (parsed.wall === wall && parsed.count > count) count = parsed.count;
      },
    };
  }

  function isStructured(doc) {
    return (
      isObject(doc) &&
      Array.isArray(doc.pages) &&
      doc.pages.every(
        (page) =>
          isObject(page) &&
          validId(page.id) &&
          Array.isArray(page.nodes) &&
          page.nodes.every((node) => isObject(node) && validId(node.id)),
      )
    );
  }

  // Smallest single splice turning `from` into `to`.
  function splice(from, to) {
    let start = 0;
    const limit = Math.min(from.length, to.length);
    while (start < limit && from[start] === to[start]) start++;
    let tail = 0;
    while (tail < limit - start && from[from.length - 1 - tail] === to[to.length - 1 - tail])
      tail++;
    return { start, end: from.length - tail, text: to.slice(start, to.length - tail) };
  }
  // Three-way text merge of two concurrent edits made from the same base. Edits to disjoint
  // ranges are both kept; overlapping edits return null so the caller falls back to LWW.
  function mergeText(base, mine, theirs) {
    if (mine === theirs || theirs === base) return mine;
    if (mine === base) return theirs;
    const a = splice(base, mine),
      b = splice(base, theirs);
    if (a.start === a.end && b.start === b.end && a.start === b.start)
      return base.slice(0, a.start) + b.text + a.text + base.slice(a.start);
    if (a.end <= b.start)
      return (
        base.slice(0, a.start) + a.text + base.slice(a.end, b.start) + b.text + base.slice(b.end)
      );
    if (b.end <= a.start)
      return (
        base.slice(0, b.start) + b.text + base.slice(b.end, a.start) + a.text + base.slice(a.end)
      );
    return null;
  }

  // Ids of `after`, unless they equal "ids of before that survived, then new ids in order".
  function orderChange(before, after) {
    const kept = new Set(after);
    const old = before.filter((id) => kept.has(id));
    const known = new Set(old);
    const expected = old.concat(after.filter((id) => !known.has(id)));
    return same(expected, after) ? null : after;
  }

  /** Operations that turn `before` into `after`. `ignore` lists top-level keys kept local (such as activePage). */
  function diff(before, after, options = {}) {
    const ignore = new Set(options.ignore || []);
    if (!isObject(before) || !isObject(after))
      return same(before, after) ? [] : [{ t: "root", value: clone(after) }];
    const structured = isStructured(after);
    if (structured !== isStructured(before)) return [{ t: "root", value: clone(after) }];
    const removals = [],
      ops = [];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (
        ignore.has(key) ||
        (structured && key === "pages") ||
        !validKey(key) ||
        same(before[key], after[key])
      )
        continue;
      ops.push(
        key in after ? { t: "doc", key, value: clone(after[key]) } : { t: "doc", key, del: true },
      );
    }
    if (!structured) return ops;
    const oldPages = new Map(before.pages.map((page) => [page.id, page]));
    const newPages = new Map(after.pages.map((page) => [page.id, page]));
    for (const page of before.pages)
      if (!newPages.has(page.id)) removals.push({ t: "removePage", id: page.id });
    for (const page of after.pages) {
      const old = oldPages.get(page.id);
      if (!old) {
        ops.push({ t: "addPage", id: page.id, value: clone(page) });
        continue;
      }
      for (const key of new Set([...Object.keys(old), ...Object.keys(page)])) {
        if (key === "id" || key === "nodes" || !validKey(key) || same(old[key], page[key]))
          continue;
        ops.push(
          key in page
            ? { t: "page", page: page.id, key, value: clone(page[key]) }
            : { t: "page", page: page.id, key, del: true },
        );
      }
      const oldNodes = new Map(old.nodes.map((node) => [node.id, node]));
      const newIds = new Set(page.nodes.map((node) => node.id));
      for (const node of old.nodes)
        if (!newIds.has(node.id)) removals.push({ t: "remove", page: page.id, id: node.id });
      for (const node of page.nodes) {
        const prior = oldNodes.get(node.id);
        if (!prior) {
          ops.push({ t: "add", page: page.id, id: node.id, value: clone(node) });
          continue;
        }
        for (const key of new Set([...Object.keys(prior), ...Object.keys(node)])) {
          if (key === "id" || !validKey(key) || same(prior[key], node[key])) continue;
          if (key === "text" && typeof prior[key] === "string" && typeof node[key] === "string")
            ops.push({
              t: "text",
              page: page.id,
              id: node.id,
              key,
              base: prior[key],
              value: node[key],
            });
          else
            ops.push(
              key in node
                ? { t: "node", page: page.id, id: node.id, key, value: clone(node[key]) }
                : { t: "node", page: page.id, id: node.id, key, del: true },
            );
        }
      }
      const order = orderChange(
        old.nodes.map((node) => node.id),
        page.nodes.map((node) => node.id),
      );
      if (order) ops.push({ t: "nodeOrder", page: page.id, value: order });
    }
    const pageOrder = orderChange(
      before.pages.map((page) => page.id),
      after.pages.map((page) => page.id),
    );
    if (pageOrder) ops.push({ t: "pageOrder", value: pageOrder });
    return removals.concat(ops);
  }

  function reorder(items, ids) {
    const byId = new Map(items.map((item) => [item.id, item]));
    const listed = [];
    for (const id of ids)
      if (byId.has(id)) {
        listed.push(byId.get(id));
        byId.delete(id);
      }
    return listed.concat(items.filter((item) => byId.has(item.id)));
  }
  function pathOf(op) {
    switch (op.t) {
      case "root":
        return "r";
      case "doc":
        return "d/" + op.key;
      case "addPage":
      case "removePage":
        return "p/" + op.id;
      case "page":
        return "p/" + op.page + "/" + op.key;
      case "pageOrder":
        return "po";
      case "add":
      case "remove":
        return "n/" + op.id;
      case "node":
      case "text":
        return "n/" + op.id + "/" + op.key;
      case "nodeOrder":
        return "no/" + op.page;
    }
    return null;
  }
  function shapeError(op) {
    if (!isObject(op) || !KINDS.has(op.t)) return "Unknown operation";
    if (["doc", "page", "node", "text"].includes(op.t) && !validKey(op.key))
      return "Invalid property name";
    if (
      ["addPage", "removePage", "add", "remove", "node", "text"].includes(op.t) &&
      !validId(op.id)
    )
      return "Invalid id";
    if (["page", "add", "remove", "node", "text", "nodeOrder"].includes(op.t) && !validId(op.page))
      return "Invalid page id";
    if (
      (op.t === "pageOrder" || op.t === "nodeOrder") &&
      (!Array.isArray(op.value) || !op.value.every(validId))
    )
      return "Invalid order";
    if (op.t === "text" && (typeof op.base !== "string" || typeof op.value !== "string"))
      return "Invalid text edit";
    if (op.t === "root" && (op.value === null || typeof op.value !== "object"))
      return "Document must be a JSON object or array";
    if ((op.t === "add" || op.t === "addPage") && (!isObject(op.value) || op.value.id !== op.id))
      return "Invalid inserted value";
    if (op.t === "addPage" && !isStructured({ pages: [op.value] })) return "Invalid page";
    if (op.s !== undefined && !decode(op.s)) return "Invalid stamp";
    return null;
  }

  /**
   * Apply operations to a document. The input is never changed: the result shares every page,
   * node and value the operations leave alone and copies only what they write (copy on write).
   * With `stamps` (a {get,set,clear} stamp store) the call is authoritative: stale stamps lose,
   * and the resolved operations to broadcast are returned in `applied`. Without it (replicas
   * replaying accepted operations) every valid operation applies in order. `external(id)`
   * (optional) is true for node ids used on pages the document leaves out. `owned` hands the
   * operation values over (a freshly parsed message): they enter the document without a copy.
   * Values in `applied` are the operations' own values; neither they nor the result's values
   * may be changed in place afterwards.
   */
  function apply(document, ops, options = {}) {
    const stamps = options.stamps || null;
    const own = options.owned ? (value) => value : clone;
    let doc = document;
    const applied = [],
      rejected = [];
    // Objects this call created, which it may change in place; everything else is copied first.
    const fresh = new WeakSet();
    const writable = (value) => {
      if (fresh.has(value)) return value;
      const copy = Array.isArray(value) ? value.slice() : { ...value };
      fresh.add(copy);
      return copy;
    };
    const docForWrite = () => (doc = writable(doc));
    const pagesForWrite = () => (docForWrite().pages = writable(doc.pages));
    const newer = (path, stamp) =>
      !stamps || !stamps.get(path) || (stamp && stamp > stamps.get(path));
    const record = (path, stamp) => {
      if (stamps && stamp && (!stamps.get(path) || stamp > stamps.get(path)))
        stamps.set(path, stamp);
    };
    // Cache shape validation too: isStructured walks every node. Tombstones let a run
    // of removes stay linear; compact only at an order change or the end of the batch.
    let indexed = false,
      structured,
      pages,
      positions,
      nodeIds,
      indexes;
    const dirtyPages = new Set();
    const compact = () => {
      for (const page of dirtyPages) fresh.add((page.nodes = page.nodes.filter(Boolean)));
      dirtyPages.clear();
    };
    const ensureIndex = () => {
      if (indexed) return;
      compact();
      structured = isStructured(doc);
      pages = new Map();
      positions = new Map();
      nodeIds = new Map();
      indexes = new Map();
      if (structured)
        doc.pages.forEach((page, position) => {
          if (!pages.has(page.id)) pages.set(page.id, page);
          positions.set(page, position);
          const first = new Map(),
            byId = new Map();
          page.nodes.forEach((node, index) => {
            if (!first.has(node.id)) first.set(node.id, { node, index });
            byId.set(node.id, node);
            nodeIds.set(node.id, (nodeIds.get(node.id) || 0) + 1);
          });
          indexes.set(page, { first, byId });
        });
      indexed = true;
    };
    // Writable versions of an indexed page, its node list and one of its nodes, swapped into
    // the document and the indexes in place of the shared originals.
    const pageForWrite = (page) => {
      if (fresh.has(page)) return page;
      const copy = writable(page),
        position = positions.get(page);
      pagesForWrite()[position] = copy;
      positions.set(copy, position);
      indexes.set(copy, indexes.get(page));
      if (pages.get(page.id) === page) pages.set(page.id, copy);
      return copy;
    };
    const nodesForWrite = (page) => {
      page = pageForWrite(page);
      page.nodes = writable(page.nodes);
      return page;
    };
    const nodeForWrite = (page, index, node) => {
      if (fresh.has(node)) return node;
      page = nodesForWrite(page);
      const copy = writable(node);
      page.nodes[index] = copy;
      const { first, byId } = indexes.get(page);
      if (byId.get(node.id) === node) byId.set(node.id, copy);
      const entry = first.get(node.id);
      if (entry?.node === node) entry.node = copy;
      return copy;
    };
    const hasPages = () => {
      ensureIndex();
      return structured;
    };
    const findNode = (id) => {
      ensureIndex();
      if (!structured) return false;
      return nodeIds.has(id) || options.external?.(id);
    };
    const pageOf = (id) => {
      ensureIndex();
      return pages.get(id);
    };
    const entryOf = (page, id) => (page ? indexes.get(page).first.get(id) : undefined);
    const createsCycle = (page, id, parent) => {
      const byId = indexes.get(page).byId;
      const seen = new Set();
      for (let current = parent; current; current = byId.get(current)?.parentId) {
        if (current === id || seen.has(current)) return true;
        seen.add(current);
      }
      return false;
    };
    ops.forEach((op, index) => {
      const problem = shapeError(op);
      if (problem) {
        rejected.push({ index, reason: problem });
        return;
      }
      const reject = (reason) => rejected.push({ index, reason });
      const path = pathOf(op),
        stamp = op.s;
      const accept = (resolved) => {
        record(path, stamp);
        applied.push(stamp ? { ...resolved, s: stamp } : resolved);
      };
      switch (op.t) {
        case "root": {
          if (!newer(path, stamp)) return reject("Superseded");
          compact();
          doc = own(op.value);
          indexed = false;
          if (stamps) stamps.clear();
          return accept({ t: "root", value: op.value });
        }
        case "doc": {
          if (!isObject(doc)) return reject("Document is not an object");
          if (op.key === "pages" && hasPages())
            return reject("Pages change through page operations");
          if (!newer(path, stamp)) return reject("Superseded");
          docForWrite();
          if (op.del) delete doc[op.key];
          else doc[op.key] = own(op.value);
          if (op.key === "pages") indexed = false;
          return accept(
            op.del
              ? { t: "doc", key: op.key, del: true }
              : { t: "doc", key: op.key, value: op.value },
          );
        }
        case "addPage": {
          if (!hasPages()) return reject("Document has no pages");
          if (pageOf(op.id)) return reject("Page exists");
          if (op.value.nodes.some((node) => findNode(node.id)))
            return reject("Node id already used");
          if (!newer(path, stamp)) return reject("Superseded");
          pagesForWrite().push(own(op.value));
          indexed = false;
          for (const node of op.value.nodes) record("n/" + node.id, stamp);
          return accept({ t: "addPage", id: op.id, value: op.value });
        }
        case "removePage": {
          const page = pageOf(op.id);
          if (!page) return reject("Missing page");
          if (doc.pages.length === 1) return reject("A document keeps at least one page");
          if (!newer(path, stamp)) return reject("Superseded");
          fresh.add((docForWrite().pages = doc.pages.filter((item) => item.id !== op.id)));
          indexed = false;
          for (const node of page.nodes) if (node) record("n/" + node.id, stamp);
          return accept({ t: "removePage", id: op.id });
        }
        case "page": {
          const page = pageOf(op.page);
          if (!page) return reject("Missing page");
          if (op.key === "id" || op.key === "nodes") return reject("Reserved page property");
          if (!newer(path, stamp)) return reject("Superseded");
          const target = pageForWrite(page);
          if (op.del) delete target[op.key];
          else target[op.key] = own(op.value);
          return accept(
            op.del
              ? { t: "page", page: op.page, key: op.key, del: true }
              : { t: "page", page: op.page, key: op.key, value: op.value },
          );
        }
        case "pageOrder": {
          if (!hasPages()) return reject("Document has no pages");
          if (!newer(path, stamp)) return reject("Superseded");
          fresh.add((docForWrite().pages = reorder(doc.pages, op.value)));
          indexed = false;
          return accept({ t: "pageOrder", value: op.value.slice() });
        }
        case "add": {
          const page = pageOf(op.page);
          if (!page) return reject("Missing page");
          if (findNode(op.id)) return reject("Node exists");
          if (!newer(path, stamp)) return reject("Superseded");
          const node = own(op.value);
          // A copy made here may change in place; a handed-over value is also in `applied`.
          if (node !== op.value) fresh.add(node);
          const target = nodesForWrite(page);
          const index = target.nodes.length;
          target.nodes.push(node);
          indexes.get(target).first.set(node.id, { node, index });
          indexes.get(target).byId.set(node.id, node);
          nodeIds.set(node.id, 1);
          if (stamps && stamp)
            for (const key of Object.keys(op.value)) record(path + "/" + key, stamp);
          return accept({ t: "add", page: op.page, id: op.id, value: op.value });
        }
        case "remove": {
          let page = pageOf(op.page);
          const index = entryOf(page, op.id)?.index ?? -1;
          if (index < 0) return reject("Missing node");
          if (!newer(path, stamp)) return reject("Superseded");
          page = nodesForWrite(page);
          page.nodes[index] = null;
          dirtyPages.add(page);
          const count = nodeIds.get(op.id);
          if (count === 1) nodeIds.delete(op.id);
          else nodeIds.set(op.id, count - 1);
          indexes.get(page).first.delete(op.id);
          indexes.get(page).byId.delete(op.id);
          // Legacy malformed documents may repeat ids: retain first-match lookup semantics.
          if (count > 1) indexed = false;
          return accept({ t: "remove", page: op.page, id: op.id });
        }
        case "node": {
          const page = pageOf(op.page);
          const entry = entryOf(page, op.id);
          if (!entry) return reject("Missing node");
          if (op.key === "id") return reject("Node ids are immutable");
          if (op.key === "parentId" && !op.del && op.value !== null) {
            if (!validId(op.value) || !indexes.get(page).byId.has(op.value))
              return reject("Missing parent");
            if (createsCycle(page, op.id, op.value)) return reject("Move would create a cycle");
          }
          if (!newer(path, stamp)) return reject("Superseded");
          const node = nodeForWrite(page, entry.index, entry.node);
          if (op.del) delete node[op.key];
          else node[op.key] = own(op.value);
          return accept(
            op.del
              ? { t: "node", page: op.page, id: op.id, key: op.key, del: true }
              : { t: "node", page: op.page, id: op.id, key: op.key, value: op.value },
          );
        }
        case "text": {
          const page = pageOf(op.page);
          const entry = entryOf(page, op.id);
          if (!entry) return reject("Missing node");
          const current = entry.node[op.key];
          let value =
            typeof current === "string"
              ? current === op.base
                ? op.value
                : mergeText(op.base, op.value, current)
              : null;
          if (value === null) {
            if (!newer(path, stamp)) return reject("Superseded");
            value = op.value;
          }
          nodeForWrite(page, entry.index, entry.node)[op.key] = value;
          if (op.key === "id") indexed = false;
          return accept({ t: "node", page: op.page, id: op.id, key: op.key, value });
        }
        case "nodeOrder": {
          const page = pageOf(op.page);
          if (!page) return reject("Missing page");
          if (!newer(path, stamp)) return reject("Superseded");
          compact();
          const target = pageForWrite(page);
          fresh.add((target.nodes = reorder(target.nodes, op.value)));
          indexed = false;
          return accept({ t: "nodeOrder", page: op.page, value: op.value.slice() });
        }
      }
    });
    compact();
    if (options.normalize && hasPages()) {
      // Concurrent deletes can orphan children; reattach them to the page so content stays visible.
      for (const page of doc.pages) {
        let target = page;
        const byId = indexes.get(page).byId;
        const ids = new Set(byId.keys());
        const unique = ids.size === page.nodes.length;
        // Label parent chains once. When a repair breaks a chain, mark its reverse
        // descendants safe too; each edge is visited at most once across all repairs.
        const reaches = new Map(),
          children = new Map();
        for (const node of page.nodes) {
          if (!children.has(node.parentId)) children.set(node.parentId, []);
          children.get(node.parentId).push(node.id);
        }
        if (unique)
          for (const node of page.nodes) {
            if (reaches.has(node.id)) continue;
            const chain = [],
              positions = new Map();
            let current = node.id;
            while (
              current &&
              byId.has(current) &&
              !reaches.has(current) &&
              !positions.has(current)
            ) {
              positions.set(current, chain.length);
              chain.push(current);
              current = byId.get(current).parentId;
            }
            let cycle = reaches.get(current) || null;
            if (positions.has(current)) {
              cycle = current;
            }
            for (const id of chain) reaches.set(id, cycle);
          }
        page.nodes.forEach((node, index) => {
          if (
            node.parentId !== undefined &&
            node.parentId !== null &&
            (!ids.has(node.parentId) ||
              (unique ? reaches.get(node.id) : createsCycle(page, node.id, node.parentId)))
          ) {
            if (unique && reaches.get(node.id)) {
              const safe = [node.id];
              reaches.set(node.id, null);
              for (let i = 0; i < safe.length; i++)
                for (const child of children.get(safe[i]) || []) {
                  if (!reaches.get(child)) continue;
                  reaches.set(child, null);
                  safe.push(child);
                }
            }
            target = nodesForWrite(target);
            nodeForWrite(target, index, node).parentId = null;
            applied.push({
              t: "node",
              page: page.id,
              id: node.id,
              key: "parentId",
              value: null,
              ...(options.stamp ? { s: options.stamp } : {}),
            });
            record("n/" + node.id + "/parentId", options.stamp);
          }
        });
      }
    }
    return { doc, applied, rejected };
  }

  /**
   * Pages an operation list reads or writes: `all` for a root replacement, otherwise the ids of
   * the pages whose properties or nodes change (document keys and page order touch none).
   */
  function touchedPages(ops) {
    const pages = new Set();
    let all = false;
    for (const op of ops || []) {
      if (!isObject(op)) continue;
      if (op.t === "root") all = true;
      else if (op.t === "addPage" || op.t === "removePage") pages.add(op.id);
      else if (typeof op.page === "string") pages.add(op.page);
    }
    return { all, pages };
  }
  /** True for operations on the nodes of a page (not its properties, existence or order). */
  const NODE_KINDS = new Set(["add", "remove", "node", "text", "nodeOrder"]);
  const isNodeOp = (op) => isObject(op) && NODE_KINDS.has(op.t);

  /** A stamp store backed by a plain object (tests and in-memory replicas). */
  function memoryStamps(initial = {}) {
    const data = { ...initial };
    return {
      get: (path) => data[path],
      set: (path, stamp) => {
        data[path] = stamp;
      },
      clear: () => {
        for (const key of Object.keys(data)) delete data[key];
      },
      data,
    };
  }

  scope.VerynizeOps = Object.freeze({
    PROTOCOL,
    createClock,
    decode,
    diff,
    apply,
    mergeText,
    isStructured,
    memoryStamps,
    pathOf,
    touchedPages,
    isNodeOp,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
