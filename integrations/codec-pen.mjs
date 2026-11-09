// Bounded, non-executing JSON interchange subset. This is not an encrypted .pen decoder.
import { createHash, randomUUID } from "node:crypto";
import { createComponent, createInstance, syncComponents } from "./component-core.mjs";
import { validateDocument } from "./design-store.mjs";
import { reflow } from "./design-edit.mjs";
import { iconToNodeImage } from "./assets.mjs";
const MAX_BYTES = 5_000_000;
const MAX_NODES = 5000;
const supported = new Set([
  "id",
  "type",
  "name",
  "x",
  "y",
  "width",
  "height",
  "fill",
  "cornerRadius",
  "content",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "layout",
  "gap",
  "padding",
  "alignItems",
  "justifyContent",
  "clip",
  "enabled",
  "visible",
  "children",
  "reusable",
  "ref",
  "descendants",
  "geometry",
  "iconFontName",
  "iconFontFamily",
]);
export async function importPen(source, { assetSink, name = "Imported Pen" } = {}) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  if (bytes.length > MAX_BYTES) throw Error(`Pen source exceeds limit ${MAX_BYTES} bytes`);
  const text = bytes
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (!text.startsWith("{"))
    throw Error(
      "Unsupported Pen signature; encrypted/binary files are not decoded. Supply an unencrypted JSON export.",
    );
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    throw Error("Invalid Pen JSON");
  }
  if (!["1.0", "2.8"].includes(String(input.version)))
    throw Error(`Unsupported Pen version: ${String(input.version).slice(0, 40)}`);
  if (!Array.isArray(input.children)) throw Error("Pen document requires children");
  const sourceDigest = createHash("sha256").update(bytes).digest("hex");
  const page = { id: randomUUID(), name, nodes: [] };
  const document = { version: 2, name, tokens: {}, pages: [page], activePage: page.id };
  const sources = new Map(),
    ids = new Map(),
    parents = new Map(),
    built = new Set(),
    building = new Set();
  const unsupportedFeatures = [];
  const loss = (id, feature) => unsupportedFeatures.push({ sourceId: id, feature });
  function scan(nodes, parent = null, depth = 0) {
    if (depth > 128) throw Error("Pen nesting exceeds limit 128");
    for (const node of nodes) {
      if (
        !node ||
        typeof node.id !== "string" ||
        !node.id ||
        node.id.length > 200 ||
        sources.has(node.id)
      )
        throw Error("Pen ids must be unique nonempty strings");
      if (sources.size >= MAX_NODES) throw Error(`Pen nodes exceed limit ${MAX_NODES}`);
      sources.set(node.id, node);
      ids.set(node.id, randomUUID());
      parents.set(node.id, parent);
      for (const key of Object.keys(node)) if (!supported.has(key)) loss(node.id, key);
      if (node.children !== undefined) {
        if (!Array.isArray(node.children)) throw Error("Pen children must be an array");
        scan(node.children, node.id, depth + 1);
      }
    }
  }
  scan(input.children);
  for (const key of Object.keys(input)) if (!["version", "children"].includes(key)) loss(null, key);
  const number = (value, fallback) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  function props(src) {
    const out = {};
    const mapping = {
      name: "name",
      x: "x",
      y: "y",
      width: "w",
      height: "h",
      cornerRadius: "radius",
      content: "text",
      fontFamily: "fontFamily",
      fontSize: "fontSize",
      gap: "gap",
      padding: "padding",
      alignItems: "alignItems",
      justifyContent: "justifyContent",
      clip: "clipContent",
    };
    for (const [from, to] of Object.entries(mapping))
      if (src[from] !== undefined) {
        if (["width", "height"].includes(from) && typeof src[from] !== "number") {
          loss(src.id, from + ":" + src[from]);
          continue;
        }
        out[to] = src[from];
      }
    if (src.enabled !== undefined || src.visible !== undefined)
      out.hidden = src.enabled === false || src.visible === false;
    if (src.fill !== undefined) {
      if (typeof src.fill === "string" && /^#[0-9a-f]{6}$/i.test(src.fill)) out.color = src.fill;
      else loss(src.id, "fill");
    }
    if (src.fontWeight !== undefined) out.fontWeight = String(src.fontWeight);
    if (src.layout !== undefined) {
      if (src.layout === "none") out.layout = "free";
      else if (["horizontal", "vertical"].includes(src.layout)) {
        out.layout = "flex";
        out.direction = src.layout === "horizontal" ? "row" : "column";
      } else loss(src.id, "layout:" + src.layout);
    }
    return out;
  }
  async function build(id) {
    if (built.has(id)) return;
    if (building.has(id)) throw Error("Pen component reference cycle");
    const src = sources.get(id);
    if (!src) throw Error("Pen reference target not found");
    if (building.size >= 128) throw Error("Pen component dependency depth exceeds limit 128");
    building.add(id);
    const parentId = ids.get(parents.get(id)) || null;
    if (src.type === "ref") {
      const main = sources.get(src.ref);
      if (!main?.reusable) throw Error("Pen instance requires a reusable component");
      await build(src.ref);
      createInstance(document, ids.get(src.ref), {
        id: ids.get(id),
        pageId: page.id,
        parentId,
        x: number(src.x, 0),
        y: number(src.y, 0),
      });
      const before = structuredClone(document);
      Object.assign(
        page.nodes.find((n) => n.id === ids.get(id)),
        props(src),
      );
      const overrides = Object.entries(src.descendants || {});
      if (overrides.length > MAX_NODES) throw Error(`Pen overrides exceed limit ${MAX_NODES}`);
      const byId = new Map(page.nodes.map((node) => [node.id, node]));
      const byParent = new Map();
      for (const node of page.nodes) {
        if (!byParent.has(node.parentId)) byParent.set(node.parentId, []);
        byParent.get(node.parentId).push(node);
      }
      for (const [path, override] of overrides) {
        const segments = path.split("/");
        if (segments.length > 128 || path.length > 4000)
          throw Error("Pen override path exceeds limit");
        let parent = ids.get(id),
          target;
        for (const segment of segments) {
          target = (byParent.get(parent) || []).find((n) => {
            const seen = new Set();
            for (let sourceId = n.sourceId; sourceId && !seen.has(sourceId);) {
              if (sourceId === ids.get(segment)) return true;
              seen.add(sourceId);
              sourceId = byId.get(sourceId)?.sourceId;
            }
            return false;
          });
          if (!target) throw Error(`Pen override path not found: ${path.slice(0, 200)}`);
          parent = target.id;
        }
        Object.assign(target, props(override));
      }
      syncComponents(before, document);
    } else {
      const types = {
        frame: "frame",
        group: "frame",
        rectangle: "rectangle",
        text: "text",
        path: "vector",
        icon_font: "image",
      };
      const type = types[src.type];
      if (!type) throw Error(`Unsupported Pen node type: ${String(src.type).slice(0, 50)}`);
      const node = {
        id: ids.get(id),
        type,
        name: src.name || src.id,
        parentId,
        x: number(src.x, 0),
        y: number(src.y, 0),
        w: Math.max(1, number(src.width, 100)),
        h: Math.max(1, number(src.height, 100)),
        color: type === "frame" ? "transparent" : "#000000",
        ...props(src),
      };
      if (type === "frame") node.layout ||= "free";
      if (type === "vector") {
        node.paths = [{ d: src.geometry }];
        node.viewBox = [0, 0, node.w, node.h];
      }
      if (type === "image") {
        const icon = src.iconFontName?.includes(":")
          ? src.iconFontName
          : `${src.iconFontFamily || "lucide"}:${src.iconFontName}`;
        const data = iconToNodeImage(icon, { color: node.color, size: node.w });
        if (!data) {
          loss(src.id, "unresolved icon:" + icon);
          node.assetStatus = "missing";
        } else
          node.src = assetSink
            ? (await assetSink(Buffer.from(data.split(",")[1], "base64"), "image/svg+xml")).ref
            : data;
      }
      page.nodes.push(node);
      for (const child of src.children || []) await build(child.id);
      if (src.reusable) createComponent(document, page.id, node.id);
    }
    if (page.nodes.length > MAX_NODES) throw Error(`Expanded Pen nodes exceed limit ${MAX_NODES}`);
    building.delete(id);
    built.add(id);
  }
  // Build containing frames before instances while allowing forward component references.
  for (const src of input.children) await build(src.id);
  // Dependency construction may visit a forward component before its instance. Restore
  // the source stacking order after all dependencies and inherited children exist.
  const targets = new Map(page.nodes.map((node) => [node.id, node]));
  const children = new Map();
  for (const node of page.nodes) {
    let ancestor = node,
      depth = 0;
    while (ancestor.parentId) {
      if (++depth > 128) throw Error("Expanded Pen nesting exceeds limit 128");
      ancestor = targets.get(ancestor.parentId);
      if (!ancestor) throw Error("Pen parent not found");
    }
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node.id);
  }
  const ordered = [];
  const emitTarget = (id) => {
    ordered.push(targets.get(id));
    for (const child of children.get(id) || []) emitTarget(child);
  };
  const emitSource = (source) => {
    if (source.type === "ref") emitTarget(ids.get(source.id));
    else {
      ordered.push(targets.get(ids.get(source.id)));
      for (const child of source.children || []) emitSource(child);
    }
  };
  input.children.forEach(emitSource);
  page.nodes = ordered;
  reflow(page, null, [], document);
  validateDocument(document);
  return {
    document,
    sourceDigest,
    sourceFormat: "pen-json-subset",
    unsupportedFeatures,
    fidelityStatus: unsupportedFeatures.length ? "partial" : "unverified",
    counts: { sourceNodes: sources.size, nodes: page.nodes.length },
  };
}
