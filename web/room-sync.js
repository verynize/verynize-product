// Room sync integrity, shared by the renderer (web/cloud-panel.js) and the room server
// (cloud/rooms.js, which imports this classic script for its side effect):
// - content digests: a reconnecting client at the server's revision proves it holds the same
//   pages (`sync` → `same:true` with `pages` node counts and `digests`), so a stale copy at the
//   right revision number is replaced instead of kept;
// - how a client classifies a rejected batch (`code`, not the error text);
// - which queued operations depend on a held (rejected) batch, so only those wait with it.
// API: window.VerynizeRoomSync / globalThis.VerynizeRoomSync.
(function (scope) {
  // Top-level keys a client keeps for itself (web/cloud-panel.js LOCAL_KEYS): never compared.
  const LOCAL_KEYS = ["activePage"];
  const hex = (value) => (value >>> 0).toString(16).padStart(8, "0");

  /** Two 32-bit lanes over UTF-16 units (cyrb53 mixing), 64 bits of output. Not cryptographic. */
  function hasher() {
    let h1 = 0xdeadbeef,
      h2 = 0x41c6ce57;
    return {
      update(text) {
        for (let i = 0; i < text.length; i++) {
          const code = text.charCodeAt(i);
          h1 = Math.imul(h1 ^ code, 2654435761);
          h2 = Math.imul(h2 ^ code, 1597334677);
        }
      },
      digest() {
        let a = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
        a ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        let b = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
        b ^= Math.imul(a ^ (a >>> 13), 3266489909);
        return hex(b) + hex(a);
      },
    };
  }

  // JSON semantics (undefined and functions are skipped in objects and null in arrays, non-finite
  // numbers are null) with sorted object keys, so key order never changes the digest.
  const skipped = (value) => value === undefined || typeof value === "function";
  function feed(hash, value, omit) {
    if (value === null || typeof value !== "object") {
      if (typeof value === "string") hash.update(`"${value.length}:${value}`);
      else if (typeof value === "number") hash.update(Number.isFinite(value) ? `#${value}` : "n");
      else if (typeof value === "boolean") hash.update(value ? "t" : "f");
      else hash.update("n");
      return;
    }
    if (Array.isArray(value)) {
      hash.update(`[${value.length}`);
      for (const item of value) {
        hash.update(",");
        feed(hash, skipped(item) ? null : item, null);
      }
      hash.update("]");
      return;
    }
    const keys = Object.keys(value)
      .filter((key) => !skipped(value[key]) && !omit?.includes(key))
      .sort();
    hash.update("{");
    for (const key of keys) {
      hash.update(`${key.length}:${key}=`);
      feed(hash, value[key], null);
      hash.update(";");
    }
    hash.update("}");
  }
  /** Digest of a JSON value; `omit` lists top-level keys left out. */
  function digest(value, omit = null) {
    const hash = hasher();
    feed(hash, value, omit);
    return hash.digest();
  }
  /** Digest of a page with its nodes, as the room stores it. */
  const pageDigest = (page) => digest(page);
  /** Digest of a document's settings: every top-level key except its pages and local keys. */
  const metaDigest = (doc) => digest(doc, ["pages", ...LOCAL_KEYS]);

  /**
   * Why `doc` (a client's confirmed document) differs from the room that answered `same:true`, or
   * null when nothing shows a difference. `reply.pages` is the room's page index ({id, nodes}),
   * `reply.digests` the page digests of the pages the client named and `reply.metaDigest` the
   * settings digest. Pages the client has not loaded (`isUnloaded(id)`) are stubs and skipped.
   * @param {any} doc
   * @param {any} reply
   * @param {(id: string) => boolean} [isUnloaded]
   */
  function divergence(doc, reply, isUnloaded = () => false) {
    if (!doc || typeof doc !== "object") return "no document";
    const structured = Array.isArray(doc.pages);
    const index = Array.isArray(reply?.pages) ? reply.pages : [];
    if (index.length) {
      if (!structured) return "pages";
      if (
        index.length !== doc.pages.length ||
        index.some((entry, i) => entry?.id !== doc.pages[i]?.id)
      )
        return "page list";
      for (let i = 0; i < index.length; i++) {
        const page = doc.pages[i];
        if (isUnloaded(page.id) || !Number.isSafeInteger(index[i].nodes)) continue;
        if ((Array.isArray(page.nodes) ? page.nodes.length : 0) !== index[i].nodes)
          return "node count";
      }
    }
    const digests = reply?.digests;
    if (structured && digests && typeof digests === "object")
      for (const page of doc.pages) {
        if (isUnloaded(page.id) || typeof digests[page.id] !== "string") continue;
        if (pageDigest(page) !== digests[page.id]) return "page content";
      }
    if (typeof reply?.metaDigest === "string" && metaDigest(doc) !== reply.metaDigest)
      return "document settings";
    return null;
  }

  /**
   * The rejection a batch receipt reports for this client: "interrupted" (the batch stopped the
   * room; never sent again on its own), "too_large" (it exceeds a limit; sent again once it fits)
   * or null. Servers before `code` only set `tooLarge`, which counts as "too_large".
   */
  function rejection(message) {
    if (!message || typeof message !== "object") return null;
    if (message.code === "interrupted" || message.code === "too_large") return message.code;
    if (
      Array.isArray(message.reasons) &&
      message.reasons.some((reason) => reason?.code === "too_large")
    )
      return "too_large";
    if (message.code === undefined && message.tooLarge) return "too_large";
    return null;
  }

  /**
   * Split `ops` into those that build on `held` operations (edits of nodes or pages `held`
   * adds, children of them, orders naming them, later values of a property `held` sets) and the
   * rest. Dependencies chain: an operation on a node added by a held operation is held too.
   */
  function splitDependent(held, ops) {
    const nodes = new Set(),
      pages = new Set(),
      paths = new Set();
    let all = false;
    const pathOf = (op) =>
      op?.t === "node" || op?.t === "text"
        ? `n/${op.id}/${op.key}`
        : op?.t === "page"
          ? `p/${op.page}/${op.key}`
          : op?.t === "doc"
            ? `d/${op.key}`
            : op?.t === "nodeOrder"
              ? `o/${op.page}`
              : op?.t === "pageOrder"
                ? "o"
                : null;
    const note = (op) => {
      const path = pathOf(op);
      if (path) paths.add(path);
      if (op?.t === "root") all = true;
      else if (op?.t === "add") nodes.add(op.id);
      else if (op?.t === "addPage") {
        pages.add(op.id);
        for (const node of op.value?.nodes || []) nodes.add(node?.id);
      }
    };
    held.forEach(note);
    const kept = [],
      free = [];
    const names = (list, set) => Array.isArray(list) && list.some((id) => set.has(id));
    for (const op of ops) {
      const depends =
        all ||
        op?.t === "root" ||
        paths.has(pathOf(op)) ||
        (op?.page !== undefined && pages.has(op.page)) ||
        (["addPage", "removePage"].includes(op?.t) && pages.has(op.id)) ||
        (["add", "remove", "node", "text"].includes(op?.t) && nodes.has(op.id)) ||
        (op?.t === "add" && nodes.has(op.value?.parentId)) ||
        (op?.t === "node" && op.key === "parentId" && nodes.has(op.value)) ||
        (op?.t === "nodeOrder" && names(op.value, nodes)) ||
        (op?.t === "pageOrder" && names(op.value, pages));
      if (depends) {
        kept.push(op);
        note(op);
      } else free.push(op);
    }
    return { held: kept, free };
  }

  scope.VerynizeRoomSync = Object.freeze({
    LOCAL_KEYS,
    digest,
    pageDigest,
    metaDigest,
    divergence,
    rejection,
    splitDependent,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
