// Shared immutable commit snapshots and reversible, page-local history patches.
// Legacy callers may still checkpoint JSON; compact it only after the edit has committed.
(() => {
  function freeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) freeze(child);
    return Object.freeze(value);
  }
  function same(a, b) {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]))
    );
  }
  function diff(before, after, path = [], out = []) {
    if (same(before, after)) return out;
    if (
      before &&
      after &&
      typeof before === "object" &&
      typeof after === "object" &&
      Array.isArray(before) === Array.isArray(after)
    ) {
      if (
        Array.isArray(before) &&
        (before.length !== after.length || before.some((v, i) => v?.id !== after[i]?.id))
      ) {
        if ([...before, ...after].every((item) => item && typeof item.id === "string")) {
          const old = new Map(before.map((item) => [item.id, item]));
          const next = new Map(after.map((item) => [item.id, item]));
          after.forEach((item, index) => {
            if (old.has(item.id)) diff(old.get(item.id), item, [...path, String(index)], out);
          });
          out.push({
            path,
            order: before.map((item) => item.id),
            restored: before.filter((item) => !next.has(item.id)),
          });
        } else out.push({ path, value: before });
      } else {
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
          if (!Object.hasOwn(before, key)) out.push({ path: [...path, key], remove: true });
          else if (!Object.hasOwn(after, key))
            out.push({ path: [...path, key], value: before[key] });
          else diff(before[key], after[key], [...path, key], out);
        }
      }
    } else out.push({ path, value: before });
    return out;
  }
  const read = (value) => (typeof value === "string" ? JSON.parse(value) : value);
  function compact(entry, current) {
    if (entry?.patches) return entry;
    if (!entry?.nodeEdit) return { patches: diff(read(entry), current) };
    const before = entry.before;
    const pageIndex = before.pages.findIndex((page) => page.id === entry.page);
    const oldPage = before.pages[pageIndex],
      page = current.pages[pageIndex];
    const fallback = () => ({ patches: diff(before, current) });
    if (
      !page ||
      page.id !== oldPage.id ||
      page.nodes.length !== oldPage.nodes.length ||
      current.pages.length !== before.pages.length ||
      !same({ ...before, pages: null }, { ...current, pages: null })
    )
      return fallback();
    const wanted = new Set(entry.nodeEdit),
      patches = [];
    for (let i = 0; i < page.nodes.length; i++) {
      const old = oldPage.nodes[i],
        node = page.nodes[i];
      if (old.id !== node.id) return fallback();
      // In addition to explicit node edits, render reads CSS layout back into these fields.
      if (wanted.has(node.id) || ["x", "y", "w", "h"].some((key) => node[key] !== old[key]))
        diff(old, node, ["pages", String(pageIndex), "nodes", String(i)], patches);
    }
    return { patches };
  }
  // Inverse captured before mutation; patches own their values, never a reference to live nodes.
  function apply(entry, current) {
    const patches = compact(entry, current).patches;
    const inverse = [];
    let document = current;
    for (const patch of patches) {
      if (!patch.path.length) {
        inverse.push({ path: [], value: structuredClone(document) });
        document = structuredClone(patch.value);
        continue;
      }
      let parent = document;
      for (const key of patch.path.slice(0, -1)) parent = parent[key];
      const key = patch.path.at(-1);
      if (patch.order) {
        const list = parent[key];
        const wanted = new Set(patch.order);
        inverse.push({
          path: patch.path,
          order: list.map((item) => item.id),
          restored: structuredClone(list.filter((item) => !wanted.has(item.id))),
        });
        const byId = new Map(list.map((item) => [item.id, item]));
        for (const item of patch.restored) byId.set(item.id, structuredClone(item));
        parent[key] = patch.order.map((id) => byId.get(id));
        continue;
      }
      inverse.push(
        Object.hasOwn(parent, key)
          ? { path: patch.path, value: structuredClone(parent[key]) }
          : { path: patch.path, remove: true },
      );
      if (patch.remove) delete parent[key];
      else
        Object.defineProperty(parent, key, {
          value: structuredClone(patch.value),
          writable: true,
          enumerable: true,
          configurable: true,
        });
    }
    return { document: { ...document }, inverse: { patches: inverse.reverse() } };
  }
  function store() {
    let snapshot;
    return {
      invalidate() {
        snapshot = undefined;
      },
      get(document) {
        return (snapshot ||= freeze(structuredClone(document)));
      },
    };
  }
  window.VerynizeCommitState = Object.freeze({ freeze, same, diff, compact, apply, store });
})();
