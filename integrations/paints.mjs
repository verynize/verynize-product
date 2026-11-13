// Paint stack (`fills`, plus `backgroundFills` on text) and per-colour SVG replacement (`svgPaints`) for the headless engine: colour
// variable rename/delete/sync across paints and the JSX attributes that carry both through the codec.
// Rendering and validation live in web/node-style.js (shared with the canvas); see paintError there.
import { paintError, eachPaintColor } from "./node-style.mjs";

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
// Same threshold as jsx-codec MAX_INLINE_SRC: larger embedded images are elided in JSX and restored on read.
const MAX_INLINE_SRC = 2048;
const ELIDED = /^\[embedded image( \d+ KB)?\]$/;

const allNodes = (document) => document.pages.flatMap((page) => page.nodes);

/** Rename a colour variable in every paint (solid paints and gradient stops). */
export function renamePaintTokens(document, from, to) {
  for (const node of allNodes(document))
    eachPaintColor(node, (c) => {
      if (c.token === from) c.token = to;
    });
}
/** Detach a colour variable from every paint, keeping its value (call before the token is deleted). */
export function unbindPaintTokens(document, name) {
  const value = document.tokens?.[name];
  for (const node of allNodes(document))
    eachPaintColor(node, (c) => {
      if (c.token === name) {
        if (HEX.test(value || "")) c.color = value;
        delete c.token;
      }
    });
}
/** Re-apply colour variable values to bound paints (paints store the resolved colour next to the reference). */
export function syncPaintTokens(document) {
  const tokens = document.tokens || {};
  for (const node of allNodes(document))
    eachPaintColor(node, (c) => {
      if (c.token && HEX.test(tokens[c.token] || "")) c.color = tokens[c.token];
    });
}

/** JSX attributes for a node's paints: data-fills (JSON) and data-svg-paints ("#from:#to …"). */
export function paintAttrs(node, escapeAttr) {
  const out = [];
  if (Array.isArray(node.fills)) {
    const fills = node.fills.map((p) =>
      p?.type === "image" && typeof p.src === "string" && p.src.length > MAX_INLINE_SRC
        ? { ...p, src: `[embedded image ${Math.round(p.src.length / 1024)} KB]` }
        : p,
    );
    out.push(`data-fills="${escapeAttr(JSON.stringify(fills))}"`);
  }
  if (Array.isArray(node.backgroundFills))
    out.push(`data-background-fills="${escapeAttr(JSON.stringify(node.backgroundFills))}"`);
  if (node.svgPaints && typeof node.svgPaints === "object")
    out.push(
      `data-svg-paints="${escapeAttr(
        Object.entries(node.svgPaints)
          .map(([from, to]) => `${from}:${to}`)
          .join(" "),
      )}"`,
    );
  return out;
}

/**
 * Apply data-fills / data-svg-paints from parsed JSX attributes. An empty value removes the field.
 * `previous` is the node being edited or replaced: elided image sources are restored from its paint at
 * the same position. Throws on invalid values.
 */
export function applyPaintAttrs(node, attrs, previous = null) {
  if (Object.hasOwn(attrs, "data-fills")) {
    const raw = attrs["data-fills"];
    if (raw === "" || raw === false) delete node.fills;
    else {
      let fills;
      try {
        fills = JSON.parse(String(raw));
      } catch {
        throw new Error("data-fills must be a JSON list of paints");
      }
      if (!Array.isArray(fills)) throw new Error("data-fills must be a JSON list of paints");
      fills = fills
        .map((p, i) => {
          if (p?.type !== "image" || !ELIDED.test(String(p.src || ""))) return p;
          const old = previous?.fills?.[i];
          return old?.type === "image" ? { ...p, src: old.src } : null; // no source to restore: drop the paint
        })
        .filter(Boolean);
      const error = paintError({ fills });
      if (error) throw new Error(error);
      node.fills = fills;
    }
  }
  if (Object.hasOwn(attrs, "data-background-fills")) {
    // Text Background Fill: same paint shape as data-fills (images keep their source inline).
    const raw = attrs["data-background-fills"];
    if (raw === "" || raw === false) delete node.backgroundFills;
    else {
      let fills;
      try {
        fills = JSON.parse(String(raw));
      } catch {
        throw new Error("data-background-fills must be a JSON list of paints");
      }
      const error = paintError({ type: node.type, backgroundFills: fills });
      if (error) throw new Error(error);
      node.backgroundFills = fills;
    }
  }
  if (Object.hasOwn(attrs, "data-svg-paints")) {
    const raw = String(attrs["data-svg-paints"] ?? "").trim();
    if (!raw) delete node.svgPaints;
    else {
      const map = {};
      for (const pair of raw.split(/\s+/)) {
        const [from, to] = pair.split(":");
        if (!HEX.test(from || "") || !HEX.test(to || ""))
          throw new Error('data-svg-paints lists "#from:#to" hex pairs');
        map[from.toLowerCase()] = to.toLowerCase();
      }
      node.svgPaints = map;
    }
  }
  if (
    node.svgPaints &&
    (node.type !== "image" || !String(node.src || "").startsWith("data:image/svg+xml;base64,"))
  )
    delete node.svgPaints;
}
