// Disposable confirmed room presentations. No tokens, local files, or outbox ownership.
(() => {
  const entries = new Map();
  let trustedLocal = new WeakSet();
  let localHits = 0;
  const MAX_FILES = 8,
    MAX_BYTES = 64 * 1024 * 1024;
  let bytes = 0,
    hits = 0,
    evictions = 0;
  const key = (info) =>
    JSON.stringify([
      window.cloudAccount?.get()?.account.id || "anonymous",
      new URL(info.server).origin,
      info.id,
    ]);
  function remove(id) {
    const entry = entries.get(id);
    if (entry) {
      bytes -= entry.bytes;
      entries.delete(id);
    }
  }
  function trim() {
    for (const [id, entry] of entries) {
      if (entries.size <= MAX_FILES && bytes <= MAX_BYTES) break;
      if (!entry.pinned) {
        remove(id);
        evictions++;
      }
    }
  }
  window.switchCache = {
    key,
    trustLocal(document) {
      trustedLocal.add(document);
    },
    isTrustedLocal(document) {
      const hit = trustedLocal.has(document);
      if (hit) localHits++;
      return hit;
    },
    put(id, document, meta = {}) {
      const size = new TextEncoder().encode(JSON.stringify(document)).length;
      remove(id);
      if (size > MAX_BYTES) return;
      entries.set(id, { ...meta, document: structuredClone(document), bytes: size });
      bytes += size;
      trim();
    },
    get(id) {
      const entry = entries.get(id);
      if (!entry) return null;
      hits++;
      entries.delete(id);
      entries.set(id, entry);
      return structuredClone(entry);
    },
    remove,
    clear() {
      trustedLocal = new WeakSet();
      entries.clear();
      bytes = 0;
    },
    stats: () => ({
      entries: entries.size,
      bytes,
      hits,
      localHits,
      evictions,
      maxFiles: MAX_FILES,
      maxBytes: MAX_BYTES,
    }),
  };
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        document.getElementById("workspace")?.inert &&
        !event.target.closest?.("input,textarea")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  window.addEventListener("cloud-account-changed", () => window.switchCache.clear());
  window.addEventListener("cloud-access-revoked", () => window.switchCache.clear());
})();
