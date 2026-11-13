// A small vector miniature of a document's active page (templates, components): one rect per layer, text as a bar.
// Same drawing as `designTemplates.svgPreview` in web/views-templates.js, rendered as React elements.
import type { DesignDocument, LayerNode } from "@/lib/bridge";

const HEX = /^#[0-9a-f]{3,8}$/i;

export function DocumentPreview({
  document,
  width = 240,
  height = 148,
  className,
}: {
  document: DesignDocument;
  width?: number;
  height?: number;
  className?: string;
}) {
  const page = document.pages.find((p) => p.id === document.activePage) ?? document.pages[0];
  const nodes = page?.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const positions = new Map<string, { x: number; y: number }>();
  const absolute = (node: LayerNode, depth = 0): { x: number; y: number } => {
    const known = positions.get(node.id);
    if (known) return known;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const base = parent && depth < 50 ? absolute(parent, depth + 1) : { x: 0, y: 0 };
    const position = { x: base.x + (Number(node.x) || 0), y: base.y + (Number(node.y) || 0) };
    positions.set(node.id, position);
    return position;
  };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const node of nodes) {
    const p = absolute(node);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + node.w);
    maxY = Math.max(maxY, p.y + node.h);
  }
  if (!nodes.length) {
    minX = minY = 0;
    maxX = maxY = 1;
  }
  const scale = Math.min(width / (maxX - minX || 1), height / (maxY - minY || 1));
  const ox = (width - (maxX - minX) * scale) / 2;
  const oy = (height - (maxY - minY) * scale) / 2;
  const fill = (value: unknown) => {
    const color = typeof value === "string" ? value : "";
    return HEX.test(color) ? color : (document.tokens?.[color] ?? "#888888");
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Preview"
      className={className}
    >
      {nodes.slice(0, 600).map((node) => {
        const p = absolute(node);
        const x = ox + (p.x - minX) * scale;
        const y = oy + (p.y - minY) * scale;
        const w = Math.max(1, node.w * scale);
        const h = Math.max(1, node.h * scale);
        if (node.type === "text")
          return (
            <rect
              key={node.id}
              x={x}
              y={y + h * 0.3}
              width={w * 0.8}
              height={Math.max(1, h * 0.35)}
              rx={1}
              fill={fill(node.color)}
              opacity={0.7}
            />
          );
        return (
          <rect
            key={node.id}
            x={x}
            y={y}
            width={w}
            height={h}
            rx={Math.min(Number(node.radius) || 0, h / 2) * scale}
            fill={fill(node.color)}
          />
        );
      })}
    </svg>
  );
}
