// Resolve a selection from stored layout geometry. Free-positioned layers need no DOM reads.
// CSS flow owns child offsets: read those offsets together, before computing rotated world boxes.
(() => {
  function rects(nodes, elementOf) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const resolved = nodes.map((node) => {
      const parent = byId.get(node.parentId);
      if (!parent || !parent.layout || parent.layout === "free" || node.position === "absolute")
        return node;
      const element = elementOf(node.id);
      return element?.offsetParent
        ? {
            ...node,
            x: element.offsetLeft,
            y: element.offsetTop,
            w: element.offsetWidth,
            h: element.offsetHeight,
          }
        : node;
    });
    return window.VerynizeDocument.pageWorldBounds({ nodes: resolved }).rects;
  }
  window.VerynizeSelectionBounds = Object.freeze({ rects });
})();
