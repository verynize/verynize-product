// World-limit validation for a local node edit. Only descendants of changed geometry can move.
// The strict schema remains the single validator; this avoids calculating two complete world
// trees for a one-node edit well inside the limits. Existing overflow uses the full comparison.
(() => {
  const validated = new WeakSet();
  const GEOMETRY = [
    "x",
    "y",
    "w",
    "h",
    "rotation",
    "flipX",
    "flipY",
    "parentId",
    "strokeWidth",
    "strokeWidths",
    "strokeHidden",
    "strokeHiddenSides",
    "layout",
  ];
  function world(before, after, old, targets) {
    const core = window.VerynizeDocument;
    if (window.VerynizeComponents.hasComponents(after))
      return core.validateWorldBoundsChange(before, after);
    const changed = targets.filter((node, i) =>
      GEOMETRY.some((key) => !window.VerynizeCommitState.same(node[key], old[i][key])),
    );
    if (!changed.length) return;
    const page = after.pages.find((page) => page.id === after.activePage);
    const index = window.VerynizeNodeIndex.of(page.nodes);
    const needed = new Set();
    for (const node of index.topmost(changed))
      for (const id of index.descendants(node.id)) needed.add(id);
    for (const id of needed) {
      const parent = index.get(id)?.parentId;
      if (parent) needed.add(parent);
    }
    const subset = { nodes: [...needed].map((id) => index.get(id)) };
    if (core.pageWorldBounds(subset).outOfRange) core.validateWorldBoundsChange(before, after);
  }
  function schema(before, document, old, targets) {
    const core = window.VerynizeDocument;
    const stable =
      validated.has(before) &&
      !window.VerynizeComponents.hasComponents(document) &&
      targets.every((node, i) =>
        ["id", "type", "parentId"].every((key) => node[key] === old[i][key]),
      );
    if (stable) targets.forEach((node) => core.validateNode(node));
    else core.validateDocument(document);
  }
  // render can read CSS layout back into geometry after schema validation. Certify that read-back
  // before reusing validation on the next edit; all other fields were checked before rendering.
  function remember(snapshot) {
    for (const page of snapshot.pages)
      for (const node of page.nodes)
        for (const key of ["x", "y", "w", "h"])
          if (
            !Number.isFinite(node[key]) ||
            Math.abs(node[key]) > 1e6 ||
            ((key === "w" || key === "h") && node[key] < 1)
          )
            return;
    validated.add(snapshot);
  }
  window.VerynizeCommitValidation = Object.freeze({ world, schema, remember });
})();
