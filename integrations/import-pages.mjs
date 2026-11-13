import { randomUUID } from "node:crypto";
import { NODE_LIMITS } from "./document-core.mjs";

// Called on a private transaction copy, after component expansion.
export function distributeImport(document, page, existingCount, roots, split) {
  const incoming = page.nodes.splice(existingCount);
  const total = document.pages.reduce((n, p) => n + p.nodes.length, 0);
  if (total + incoming.length > NODE_LIMITS.perDocument)
    throw new Error(
      `Import node preflight: document existing=${total}, incoming=${incoming.length}, limit=${NODE_LIMITS.perDocument}. Nothing was imported; use another document.`,
    );
  const children = new Map();
  for (const node of incoming) {
    const key = node.parentId || null;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(node);
  }
  const assignments = [];
  let destination = page,
    nextX = 0;
  for (const root of roots) {
    const nodes = [],
      stack = [root];
    while (stack.length) {
      const node = stack.pop();
      nodes.push(node);
      stack.push(...(children.get(node.id) || []).toReversed());
    }
    if (nodes.length > NODE_LIMITS.perPage)
      throw new Error(
        `Import node preflight: artboard "${root.name}" incoming=${nodes.length}, limit=${NODE_LIMITS.perPage}. Nothing was imported; split this artboard into smaller top-level sections.`,
      );
    if (destination.nodes.length + nodes.length > NODE_LIMITS.perPage) {
      if (split !== "pages")
        throw new Error(
          `Import node preflight: page existing=${page.nodes.length}, incoming=${incoming.length}, limit=${NODE_LIMITS.perPage}. Nothing was imported; use split: "pages".`,
        );
      let suffix = 2;
      while (document.pages.some((p) => p.name === `${page.name} ${suffix}`)) suffix++;
      destination = { ...page, id: randomUUID(), name: `${page.name} ${suffix}`, nodes: [] };
      document.pages.push(destination);
      nextX = 0;
    }
    // Positions were chosen against the original page; a new page lays its artboards out from the origin.
    if (destination !== page && Number.isFinite(root.x)) {
      root.x = nextX;
      root.y = 0;
      nextX += (Number.isFinite(root.w) ? root.w : 0) + 80;
    }
    destination.nodes.push(...nodes);
    assignments.push({ page: destination, root, nodeCount: nodes.length });
  }
  return assignments;
}

export function importPageReport(assignments) {
  const pages = new Map();
  for (const { page, root, nodeCount } of assignments) {
    if (!pages.has(page.id))
      pages.set(page.id, { id: page.id, name: page.name, nodeCount: 0, artboards: [] });
    const report = pages.get(page.id);
    report.nodeCount += nodeCount;
    report.artboards.push({ id: root.shortId || root.id, name: root.name, nodeCount });
  }
  return [...pages.values()];
}
