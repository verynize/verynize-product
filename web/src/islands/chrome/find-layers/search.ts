import type { LayerNode } from "@/lib/bridge";

export type SearchNode = Pick<
  LayerNode,
  "id" | "name" | "type" | "parentId" | "hidden" | "locked"
> & { text?: string; shortId?: string };
// Same stable short-reference scheme as desktop-panel.js and design-edit.mjs.
function codeFor(id: string, attempt: number) {
  let h = 0x811c9dc5;
  const value = `${id}:${attempt}`;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 0x01000193) >>> 0;
  if (attempt < 6)
    return (
      "bcdfghjklmnprstvwz"[h % 18] +
      "aeiou"[Math.floor(h / 18) % 5] +
      "bcdfghjklmnprstvwz"[Math.floor(h / 90) % 18]
    );
  return Array.from(
    { length: attempt < 40 ? 3 : 4 },
    (_, k) => "abcdefghijklmnopqrstuvwxyz"[Math.floor(h / 26 ** k) % 26],
  ).join("");
}
export function buildIndex(nodes: SearchNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const codes = new Map<string, string>();
  const used = new Set<string>();
  for (const node of nodes) {
    let code =
      node.shortId && /^[a-z]{3,4}$/.test(node.shortId) && !used.has(node.shortId)
        ? node.shortId
        : "";
    let attempt = 0;
    while (!code || used.has(code)) code = codeFor(node.id, attempt++);
    used.add(code);
    codes.set(node.id, code);
  }
  const children = new Map<string | null, SearchNode[]>();
  for (const node of nodes) {
    const parent = node.parentId && byId.has(node.parentId) ? node.parentId : null;
    const group = children.get(parent) ?? [];
    group.push(node);
    children.set(parent, group);
  }
  const ordered: SearchNode[] = [];
  const seen = new Set<string>();
  const visit = (node: SearchNode) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    ordered.push(node);
    for (const child of [...(children.get(node.id) ?? [])].reverse()) visit(child);
  };
  for (const node of [...(children.get(null) ?? [])].reverse()) visit(node);
  for (const node of nodes) visit(node);
  return ordered.map((node) => {
    let root = node;
    const ancestors = new Set<string>();
    while (root.parentId && byId.has(root.parentId) && !ancestors.has(root.id)) {
      ancestors.add(root.id);
      root = byId.get(root.parentId)!;
    }
    const code = codes.get(node.id)!;
    return {
      ...node,
      refs: [node.id, node.shortId, code, node.parentId ? `${codes.get(root.id)}.${code}` : code],
      nameLower: node.name.toLowerCase(),
      textLower: node.text?.toLowerCase() ?? "",
    };
  });
}
export function search(index: ReturnType<typeof buildIndex>, query: string) {
  const q = query.slice(0, 1000).trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  return index.flatMap((node) => {
    const nameAt = node.nameLower.indexOf(lower);
    const textAt = node.textLower.indexOf(lower);
    const field = nameAt >= 0 ? "name" : textAt >= 0 ? "text" : node.refs.includes(q) ? "id" : null;
    if (!field) return [];
    const title = field === "text" ? node.text! : node.name;
    const at = field === "name" ? nameAt : textAt;
    const start = field === "text" ? Math.max(0, at - 16) : 0;
    return [
      {
        ...node,
        field,
        title,
        idText: field === "id" ? q : undefined,
        snippet:
          field === "id"
            ? { before: title, hit: "", after: "" }
            : {
                before: (start ? "…" : "") + title.slice(start, at),
                hit: title.slice(at, at + q.length),
                after: title.slice(
                  at + q.length,
                  field === "text" ? at + q.length + 120 : undefined,
                ),
              },
      },
    ];
  });
}
