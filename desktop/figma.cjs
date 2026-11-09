// Figma import (desktop main process).
//
// Three sources share one converter, convertFigma(), which takes nodes in the shape of Figma's public REST
// API and produces a version-2 Verynize document:
//   - REST:      importFigma({url, token?})            GET /v1/files/:key[/nodes] with geometry=paths, using a
//                                                      transient personal access token or the connected OAuth account
//   - Clipboard: figmaClipboard(html)                  the text/html Figma writes on copy (binary scene, decoded by
//                                                      integrations/figma-kiwi.mjs + figma-scene.mjs)
//   - File:      figmaFile({bytes}) / figmaFileOpen()   a .fig file (zip with canvas.fig + images, or bare archive)
// OAuth account connection lives in desktop/figma-oauth.cjs.
require("../web/document-core.js");
const { NODE_LIMITS } = globalThis.VerynizeDocument;
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
require("../web/node-style.js");
const { anchorPatch } = globalThis.BetterNodeStyle;
const kiwi = require("../integrations/figma-kiwi.mjs");
const scene = require("../integrations/figma-scene.mjs");
const LIMIT = 20 * 1024 * 1024;
const FILE_LIMIT = 200 * 1024 * 1024;

function parseFigmaURL(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error("Enter a Figma design or file URL");
  }
  if (
    url.protocol !== "https:" ||
    !["figma.com", "www.figma.com"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw Error("Use an https://www.figma.com design URL");
  const match = url.pathname.match(/^\/(?:design|file)\/([a-zA-Z0-9_-]+)(?:\/|$)/);
  if (!match) throw Error("URL must identify a Figma design or file");
  const raw = url.searchParams.get("node-id"),
    nodeId = raw?.replace(/-/g, ":") || null;
  if (nodeId && !/^\d+:\d+$/.test(nodeId)) throw Error("Invalid Figma node-id");
  return { fileKey: match[1], nodeId };
}

// ---------- colour helpers ----------
const finite = (n, fallback = 0) => (Number.isFinite(n) ? n : fallback);
const clamp01 = (n) => Math.max(0, Math.min(1, finite(n)));
const channel = (n) => Math.round(clamp01(n) * 255);
const hex = (color) =>
  "#" +
  [color?.r, color?.g, color?.b].map((n) => channel(n).toString(16).padStart(2, "0")).join("");
const alphaOf = (color, opacity = 1) => clamp01(finite(color?.a, 1) * finite(opacity, 1));
const hex8 = (color, opacity = 1) => {
  const a = alphaOf(color, opacity);
  return a >= 1
    ? hex(color)
    : hex(color) +
        Math.round(a * 255)
          .toString(16)
          .padStart(2, "0");
};
const rgba = (color, opacity = 1) =>
  `rgba(${channel(color?.r)},${channel(color?.g)},${channel(color?.b)},${alphaOf(color, opacity)})`;
const r2 = (v) => Math.round(v * 100) / 100;
const visibleFills = (node) =>
  Array.isArray(node.fills) ? node.fills.filter((p) => p && p.visible !== false) : [];
const visibleStrokes = (node) =>
  Array.isArray(node.strokes) ? node.strokes.filter((p) => p && p.visible !== false) : [];
const BLEND = {
  DARKEN: "darken",
  MULTIPLY: "multiply",
  LINEAR_BURN: "plus-darker",
  COLOR_BURN: "color-burn",
  LIGHTEN: "lighten",
  SCREEN: "screen",
  LINEAR_DODGE: "plus-lighter",
  COLOR_DODGE: "color-dodge",
  OVERLAY: "overlay",
  SOFT_LIGHT: "soft-light",
  HARD_LIGHT: "hard-light",
  DIFFERENCE: "difference",
  EXCLUSION: "exclusion",
  HUE: "hue",
  SATURATION: "saturation",
  COLOR: "color",
  LUMINOSITY: "luminosity",
};
const FRAME_TYPES = ["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "GROUP", "SECTION"];
const VECTOR_TYPES = ["VECTOR", "STAR", "LINE", "REGULAR_POLYGON", "BOOLEAN_OPERATION", "POLYGON"];

// ---------- gradients ----------
/** Gradient handles (layer-normalised) -> pixel-space points. */
function handles(paint, w, h) {
  const hp = paint.gradientHandlePositions || [];
  if (hp.length < 2) return null;
  return hp.map((p) => ({ x: finite(p.x) * w, y: finite(p.y) * h }));
}
function stopList(paint, map = (s) => s) {
  return (paint.gradientStops || [])
    .map((s) => ({ position: Math.max(0, Math.min(1, map(finite(s.position)))), color: s.color }))
    .sort((a, b) => a.position - b.position);
}
/**
 * Linear gradient: CSS angle plus stop positions re-projected onto the CSS gradient line (which runs
 * through the box centre with length |w·sinθ|+|h·cosθ|), so stops land where Figma's handles put them.
 */
function linearGeometry(paint, w, h) {
  const pts = handles(paint, w, h);
  if (!pts) return null;
  const [a, b] = pts,
    dx = b.x - a.x,
    dy = b.y - a.y,
    len = Math.hypot(dx, dy);
  if (!len) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90,
    ux = dx / len,
    uy = dy / len,
    L = Math.abs(w * ux) + Math.abs(h * uy) || 1,
    cx = w / 2,
    cy = h / 2;
  const project = (t) => {
    const px = a.x + dx * t,
      py = a.y + dy * t;
    return ((px - cx) * ux + (py - cy) * uy) / L + 0.5;
  };
  return { angle: r2(((angle % 360) + 360) % 360), project };
}
function gradientCss(paint, w, h, warn) {
  const o = finite(paint.opacity, 1),
    type = paint.type;
  const fmt = (list) => list.map((s) => `${rgba(s.color, o)} ${r2(s.position * 100)}%`).join(",");
  if (type === "GRADIENT_LINEAR") {
    const g = linearGeometry(paint, w, h);
    if (!g) return `linear-gradient(180deg,${fmt(stopList(paint))})`;
    return `linear-gradient(${g.angle}deg,${fmt(stopList(paint, g.project))})`;
  }
  const pts = handles(paint, w, h);
  const c = pts?.[0] || { x: w / 2, y: h / 2 },
    at = `${r2(w ? (c.x / w) * 100 : 50)}% ${r2(h ? (c.y / h) * 100 : 50)}%`;
  if (type === "GRADIENT_RADIAL" || type === "GRADIENT_DIAMOND") {
    const rx = pts ? Math.hypot(pts[1].x - c.x, pts[1].y - c.y) : w / 2,
      ry = pts?.[2] ? Math.hypot(pts[2].x - c.x, pts[2].y - c.y) : h / 2;
    if (type === "GRADIENT_DIAMOND")
      warn("Diamond gradient approximated by an elliptical radial gradient");
    if (pts && Math.abs(pts[1].y - c.y) > 0.5 && Math.abs(pts[1].x - c.x) > 0.5)
      warn("Rotated radial gradient drawn axis-aligned");
    return `radial-gradient(${r2(Math.max(rx, 0.5))}px ${r2(Math.max(ry, 0.5))}px at ${at},${fmt(stopList(paint))})`;
  }
  if (type === "GRADIENT_ANGULAR") {
    const from = pts ? (Math.atan2(pts[1].y - c.y, pts[1].x - c.x) * 180) / Math.PI + 90 : 0;
    return `conic-gradient(from ${r2(from)}deg at ${at},${fmt(stopList(paint))})`;
  }
  return "";
}
/** Gradient paint -> structured paint-stack entry (inspector-editable). */
function gradientPaint(paint, w, h, warn) {
  const o = Math.round(finite(paint.opacity, 1) * 100),
    stops = (list) =>
      list.slice(0, 16).map((s) => ({ position: r2(s.position * 100), color: hex8(s.color) }));
  if (paint.type === "GRADIENT_LINEAR") {
    const g = linearGeometry(paint, w, h);
    return {
      type: "linear",
      angle: g?.angle ?? 180,
      stops: stops(stopList(paint, g?.project)),
      opacity: o,
    };
  }
  const pts = handles(paint, w, h),
    centred = !pts || (Math.abs(pts[0].x - w / 2) < 1 && Math.abs(pts[0].y - h / 2) < 1);
  if (!centred) warn("Off-centre radial/angular gradient in a multi-paint fill is centred");
  if (paint.type === "GRADIENT_ANGULAR") {
    const c = pts?.[0] || { x: w / 2, y: h / 2 },
      from = pts ? (Math.atan2(pts[1].y - c.y, pts[1].x - c.x) * 180) / Math.PI + 90 : 0;
    return { type: "conic", angle: r2(from), stops: stops(stopList(paint)), opacity: o };
  }
  if (paint.type === "GRADIENT_DIAMOND") warn("Diamond gradient approximated by a radial gradient");
  return { type: "radial", stops: stops(stopList(paint)), opacity: o };
}
const FIT = { FILL: "cover", FIT: "contain", STRETCH: "fill", TILE: "none" };

// ---------- vectors ----------
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
function pathBounds(paths) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const d of paths) {
    const nums = String(d).match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = +nums[i],
        y = +nums[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
}
/** SVG markup for a vector-like node: fill paints over fillGeometry, stroke paints over strokeGeometry. */
function vectorSvg(source, w, h, warn) {
  const fillGeo = source.fillGeometry || [],
    strokeGeo = source.strokeGeometry || [],
    defs = [],
    layers = [];
  let gid = 0;
  const paintAttr = (p) => {
    const o = finite(p.opacity, 1);
    if (p.type === "SOLID")
      return `fill="${hex(p.color)}" fill-opacity="${r2(alphaOf(p.color, o) * 1000) / 1000}"`;
    if (String(p.type).startsWith("GRADIENT_")) {
      const pts = handles(p, w, h);
      if (!pts) return null;
      const id = "g" + ++gid,
        stops = stopList(p)
          .map(
            (s) =>
              `<stop offset="${r2(s.position)}" stop-color="${hex(s.color)}" stop-opacity="${r2(alphaOf(s.color, o) * 1000) / 1000}"/>`,
          )
          .join("");
      const [a, b, c = pts[0]] = pts;
      if (p.type === "GRADIENT_LINEAR")
        defs.push(
          `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${r2(a.x)}" y1="${r2(a.y)}" x2="${r2(b.x)}" y2="${r2(b.y)}">${stops}</linearGradient>`,
        );
      else {
        if (p.type !== "GRADIENT_RADIAL")
          warn(
            `${p.type === "GRADIENT_ANGULAR" ? "Angular" : "Diamond"} gradient in vector drawn as radial`,
          );
        const m = [b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y, a.x, a.y].map(r2).join(" ");
        defs.push(
          `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="matrix(${m})">${stops}</radialGradient>`,
        );
      }
      return `fill="url(#${id})"`;
    }
    warn("Image paints inside vectors are not imported");
    return null;
  };
  for (const p of visibleFills(source)) {
    const attr = paintAttr(p);
    if (attr)
      for (const g of fillGeo)
        layers.push(
          `<path d="${esc(g.path)}" fill-rule="${g.windingRule === "EVENODD" ? "evenodd" : "nonzero"}" ${attr}/>`,
        );
  }
  const strokes = visibleStrokes(source);
  if (strokes.length && finite(source.strokeWeight, 1) > 0) {
    if (strokeGeo.length) {
      for (const p of strokes) {
        const attr = paintAttr(p);
        if (attr)
          for (const g of strokeGeo)
            layers.push(`<path d="${esc(g.path)}" fill-rule="nonzero" ${attr}/>`);
      }
    } else if (fillGeo.length) {
      const p = strokes.find((s) => s.type === "SOLID");
      if (p) {
        warn("Vector stroke drawn centred on the path");
        for (const g of fillGeo)
          layers.push(
            `<path d="${esc(g.path)}" fill="none" stroke="${hex(p.color)}" stroke-opacity="${r2(alphaOf(p.color, p.opacity))}" stroke-width="${r2(finite(source.strokeWeight, 1))}"${source.strokeDashes?.length ? ` stroke-dasharray="${source.strokeDashes.map(r2).join(" ")}"` : ""}/>`,
          );
      }
    }
  }
  const all = [...fillGeo, ...strokeGeo].map((g) => g.path),
    b = pathBounds(all) || { x: 0, y: 0, w, h };
  // Keep at least the layer box; extend for geometry (outside strokes, overshooting curves).
  const pad = layers.some((l) => l.includes(" stroke=")) ? finite(source.strokeWeight, 1) / 2 : 0;
  const box = { x: Math.min(0, b.x - pad), y: Math.min(0, b.y - pad) };
  box.w = Math.max(w, b.x + b.w + pad) - box.x;
  box.h = Math.max(h, b.y + b.h + pad) - box.y;
  box.w = Math.max(1, box.w);
  box.h = Math.max(1, box.h);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(box.w)}" height="${r2(box.h)}" viewBox="${r2(box.x)} ${r2(box.y)} ${r2(box.w)} ${r2(box.h)}">${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${layers.join("")}</svg>`;
  return { src: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"), box, svg };
}

// ---------- text ----------
const TEXT_CASE = { UPPER: "uppercase", LOWER: "lowercase", TITLE: "capitalize" };
const TEXT_DECORATION = { UNDERLINE: "underline", STRIKETHROUGH: "line-through" };
function lineHeightOf(style) {
  const size = finite(style.fontSize, 16);
  if (style.lineHeightUnit === "INTRINSIC_%") return undefined;
  if (Number.isFinite(style.lineHeightPercentFontSize) && style.lineHeightUnit === "FONT_SIZE_%")
    return r2((style.lineHeightPercentFontSize / 100) * 1000) / 1000;
  if (Number.isFinite(style.lineHeightPx) && size)
    return Math.round((style.lineHeightPx / size) * 1000) / 1000;
  return undefined;
}

// ---------- placement ----------
/**
 * The layer's unrotated local box placed so CSS (rotate about the element centre) reproduces Figma's
 * transform: the centre of the local box maps through the node transform. `local` is the box in the node's
 * own coordinates (normally 0,0,w,h; vectors may extend it to cover their geometry).
 */
function placement(source, local) {
  const bb = source.absoluteBoundingBox,
    size = source.size,
    rt = source.relativeTransform;
  const w = finite(size?.x, finite(bb?.width, 100)),
    h = finite(size?.y, finite(bb?.height, 100));
  const lin =
    Array.isArray(rt) && rt.length === 2
      ? { a: finite(rt[0][0], 1), b: finite(rt[0][1]), c: finite(rt[1][0]), d: finite(rt[1][1], 1) }
      : { a: 1, b: 0, c: 0, d: 1 };
  const centre = {
    x: finite(bb?.x) + finite(bb?.width, w) / 2,
    y: finite(bb?.y) + finite(bb?.height, h) / 2,
  };
  const box = local || { x: 0, y: 0, w, h },
    off = { x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - h / 2 };
  const c = {
    x: centre.x + lin.a * off.x + lin.b * off.y,
    y: centre.y + lin.c * off.x + lin.d * off.y,
  };
  const det = lin.a * lin.d - lin.b * lin.c,
    flip = det < 0;
  let rotation = flip
    ? (Math.atan2(-lin.c, -lin.a) * 180) / Math.PI
    : (Math.atan2(lin.c, lin.a) * 180) / Math.PI;
  rotation = Math.round(rotation * 100) / 100;
  if (Math.abs(rotation) < 0.01) rotation = 0;
  return { left: c.x - box.w / 2, top: c.y - box.h / 2, w: box.w, h: box.h, rotation, flip };
}

function convertFigma(payload, { nodeId = null, images = {} } = {}) {
  const warnings = new Set(),
    pages = [],
    warn = (node, message) => warnings.add(`${node.name || node.id || "Layer"}: ${message}`);
  let count = 0;
  let roots;
  if (payload.document?.type === "DOCUMENT") roots = payload.document.children || [];
  else if (payload.document) roots = [payload.document];
  else if (payload.nodes) {
    roots = nodeId
      ? [payload.nodes[nodeId]?.document]
      : Object.values(payload.nodes).map((n) => n?.document);
  } else throw Error("Figma response has no document");
  roots = roots.filter(Boolean);
  if (!roots.length) throw Error("Selected Figma node was not found");
  for (const root of roots) {
    if (pages.length >= 100) throw Error("Too many Figma pages; select a node in the URL");
    const page = { id: randomUUID(), name: root.name || "Imported", nodes: [] };
    const children = root.type === "CANVAS" ? root.children || [] : [root];
    const boxes = children
      .filter((n) => n.visible !== false)
      .map((n) => n.absoluteBoundingBox)
      .filter(Boolean);
    const origin = {
      x: boxes.length ? Math.min(...boxes.map((b) => finite(b.x))) : 0,
      y: boxes.length ? Math.min(...boxes.map((b) => finite(b.y))) : 0,
    };
    // parent: {node, origin:{x,y} absolute top-left of the parent's unrotated box, source, border:[t,r,b,l]}
    function walk(source, parent = null, depth = 0) {
      if (source.visible === false) return;
      if (depth > 80) throw Error("Figma hierarchy exceeds 80 levels");
      if (++count > NODE_LIMITS.perDocument)
        throw Error(
          `Figma import visited ${count} source nodes; limit is ${NODE_LIMITS.perDocument}. Select fewer pages or split into multiple documents.`,
        );
      const bounds = source.absoluteBoundingBox;
      if (!bounds && !source.children?.length) {
        warn(source, "No drawable bounds; skipped");
        return;
      }
      const w0 = (o) => warn(source, o);
      const hasGeometry = (source.fillGeometry?.length || source.strokeGeometry?.length) > 0;
      const vector =
        hasGeometry &&
        (VECTOR_TYPES.includes(source.type) || (source.type === "ELLIPSE" && source.arcData));
      const frame =
        !vector &&
        ((Array.isArray(source.children) && source.children.length > 0) ||
          FRAME_TYPES.includes(source.type));
      const fills = visibleFills(source),
        paint = fills.length === 1 ? fills[0] : null;
      const imagePaint = paint?.type === "IMAGE" ? paint : null;
      const box = bounds || {
        x: parent?.origin.x || origin.x,
        y: parent?.origin.y || origin.y,
        width: 1000,
        height: 700,
      };
      const src = bounds ? source : { ...source, absoluteBoundingBox: box };
      let svg = null;
      if (vector) {
        const w = finite(source.size?.x, box.width),
          h = finite(source.size?.y, box.height);
        svg = vectorSvg(source, w, h, w0);
      }
      const place = placement(src, svg?.box);
      const parentOrigin = parent?.origin ?? origin;
      const type =
        source.type === "TEXT"
          ? "text"
          : frame
            ? "frame"
            : vector
              ? "image"
              : imagePaint && images[imagePaint.imageRef] && !source.children?.length
                ? "image"
                : "rectangle";
      const node = {
        id: randomUUID(),
        type,
        parentId: parent?.node.id || null,
        name: source.name || source.type || "Layer",
        x: r2(place.left - parentOrigin.x),
        y: r2(place.top - parentOrigin.y),
        w: Math.max(1, r2(finite(place.w, 100))),
        h: Math.max(1, r2(finite(place.h, 100))),
        color:
          paint?.type === "SOLID"
            ? rgba(paint.color, finite(paint.opacity, 1))
            : source.type === "TEXT"
              ? "#000000"
              : "transparent",
        text: source.characters || "",
        fontSize: finite(source.style?.fontSize, 16),
        fontFamily: source.style?.fontFamily || "system-ui",
        fontWeight: String(finite(source.style?.fontWeight, 400)),
        textAlign:
          { JUSTIFIED: "justify" }[source.style?.textAlignHorizontal] ||
          source.style?.textAlignHorizontal?.toLowerCase() ||
          "left",
        radius: Math.max(0, finite(source.cornerRadius, 0)),
        zIndex: 0,
        layout: "free",
        direction: "row",
        gap: 0,
        padding: 0,
        columns: Math.max(1, finite(source.gridColumnCount, 2)),
        token: "",
        gradient: "",
        mask: "",
        animated: "",
        textRuns: [],
      };
      if (source.type === "INSTANCE") {
        if (source.componentName && source.componentName !== node.name)
          node.name = `${node.name} (${source.componentName})`;
        w0("Component instance flattened into editable layers");
      }
      if (source.type === "COMPONENT" || source.type === "COMPONENT_SET")
        w0("Component definition imported as a frame");
      if (place.rotation) node.rotation = place.rotation;
      if (place.flip) node.flipX = true;
      if (parent?.rotated) w0("Parent is rotated; child placement approximated");
      // Free-layout parent: child offsets are measured from inside the parent's border.
      if (parent && parent.node.layout === "free") {
        node.x = r2(node.x - parent.border[3]);
        node.y = r2(node.y - parent.border[0]);
      }
      if (svg) {
        node.src = svg.src;
        node.color = "transparent";
      } else if (source.type === "ELLIPSE") {
        node.ellipse = true;
        if (source.arcData)
          w0("Ellipse arc/donut geometry needs vector paths; drawn as a full ellipse");
      } else if (!["TEXT", "RECTANGLE", ...FRAME_TYPES].includes(source.type))
        w0(`${source.type} geometry approximated by its bounds`);
      if (
        Array.isArray(source.rectangleCornerRadii) &&
        source.rectangleCornerRadii.length === 4 &&
        new Set(source.rectangleCornerRadii).size > 1
      )
        node.cornerRadii = source.rectangleCornerRadii.map((v) => Math.max(0, finite(v)));
      if (source.opacity !== undefined && source.opacity !== 1)
        node.opacity = Math.round(clamp01(source.opacity) * 1000) / 10;
      if (BLEND[source.blendMode]) node.blendMode = BLEND[source.blendMode];
      if (source.clipsContent && type === "frame") node.clipContent = true;
      if (source.isMask) {
        node.hidden = true;
        w0("Mask shape kept hidden; masked siblings are not clipped");
      }

      // Fills.
      if (!svg) {
        if (paint && String(paint.type).startsWith("GRADIENT_")) {
          const css = gradientCss(paint, node.w, node.h, w0);
          if (type === "text") node.fills = [gradientPaint(paint, node.w, node.h, w0)];
          else if (css) node.gradient = css;
        }
        if (imagePaint) {
          const data = images[imagePaint.imageRef];
          if (!data) w0("Image fill download unavailable");
          else if (type === "image") {
            node.src = data;
            node.objectFit = FIT[imagePaint.scaleMode] || "cover";
            if (imagePaint.imageTransform) w0("Image crop transform not retained");
            if (imagePaint.scaleMode === "TILE") w0("Tiled image shown once at natural size");
          } else
            node.fills = [
              {
                type: "image",
                src: data,
                fit: FIT[imagePaint.scaleMode] || "cover",
                opacity: Math.round(finite(imagePaint.opacity, 1) * 100),
              },
            ];
        }
        if (fills.length > 1) {
          const stack = [];
          for (const p of [...fills].reverse()) {
            if (p.type === "SOLID")
              stack.push({
                type: "solid",
                color: hex8(p.color),
                opacity: Math.round(finite(p.opacity, 1) * 100),
              });
            else if (String(p.type).startsWith("GRADIENT_"))
              stack.push(gradientPaint(p, node.w, node.h, w0));
            else if (p.type === "IMAGE" && images[p.imageRef])
              stack.push({
                type: "image",
                src: images[p.imageRef],
                fit: FIT[p.scaleMode] || "cover",
                opacity: Math.round(finite(p.opacity, 1) * 100),
              });
            else w0(`${p.type} paint not imported`);
          }
          if (stack.length) node.fills = stack.slice(0, 16);
          if (fills.some((p) => p.blendMode && !["NORMAL", "PASS_THROUGH"].includes(p.blendMode)))
            w0("Per-paint blend modes are not imported");
        }
        if (
          fills.length &&
          !["SOLID", "IMAGE"].includes(fills[0].type) &&
          !String(fills[0].type).startsWith("GRADIENT_")
        )
          w0(`${fills[0].type} paint not imported`);
      }

      // Strokes (box layers): uniform -> outline (inside/centre/outside via offset); per-side -> border widths.
      const border = [0, 0, 0, 0];
      const strokes = visibleStrokes(source);
      if (!svg && strokes.length) {
        const sp = strokes.find((p) => p.type === "SOLID") || strokes[0],
          colour =
            sp.type === "SOLID"
              ? hex8(sp.color, finite(sp.opacity, 1))
              : sp.gradientStops?.[0]
                ? hex8(sp.gradientStops[0].color)
                : "#000000";
        if (strokes.length > 1 || sp.type !== "SOLID")
          w0("Only one solid stroke colour is imported");
        const dashed = Array.isArray(source.strokeDashes) && source.strokeDashes.length > 0;
        const sides = source.individualStrokeWeights;
        if (type === "text") w0("Text strokes are not imported");
        else if (sides && new Set([sides.top, sides.right, sides.bottom, sides.left]).size > 1) {
          const list = [sides.top, sides.right, sides.bottom, sides.left].map((v) =>
            Math.max(0, finite(v)),
          );
          node.strokeWidths = list;
          node.strokeWidth = Math.max(...list);
          node.strokeColor = colour;
          if (dashed) node.strokeStyle = "dashed";
          list.forEach((v, i) => {
            border[i] = v;
          });
          if (source.strokeAlign && source.strokeAlign !== "INSIDE")
            w0("Per-side strokes drawn inside the layer");
        } else {
          const width = Math.max(0, finite(sides?.top, finite(source.strokeWeight, 1)));
          if (width > 0) {
            node.outlineWidth = Math.min(1000, width);
            node.outlineColor = colour;
            node.outlineStyle = dashed ? "dashed" : "solid";
            node.outlineOffset =
              source.strokeAlign === "OUTSIDE"
                ? 0
                : source.strokeAlign === "CENTER"
                  ? -width / 2
                  : -width;
          }
        }
      }

      // Effects.
      const effects = Array.isArray(source.effects)
        ? source.effects.filter((e) => e && e.visible !== false)
        : [];
      for (const e of effects) {
        if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
          const s = {
            type: type === "text" ? "text" : svg ? "drop" : "box",
            x: r2(finite(e.offset?.x)),
            y: r2(finite(e.offset?.y)),
            blur: Math.max(0, r2(finite(e.radius))),
            spread: r2(finite(e.spread)),
            color: hex8(e.color),
          };
          if (e.type === "INNER_SHADOW") {
            if (s.type !== "box") {
              w0("Inner shadow on text/vector not imported");
              continue;
            }
            s.inset = true;
          }
          if (s.type !== "box" && s.spread) w0("Shadow spread ignored for text/vector layers");
          (node.shadows ||= []).push(s);
        } else if (e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR") {
          const f = { type: "blur", value: Math.min(1000, r2(Math.max(0, finite(e.radius)) / 2)) };
          if (e.type === "BACKGROUND_BLUR") f.backdrop = true;
          (node.filters ||= []).push(f);
        } else w0(`${e.type} effect not imported`);
      }
      if (node.shadows?.length > 20) node.shadows.length = 20;

      // Auto layout.
      if (frame && ["HORIZONTAL", "VERTICAL", "GRID"].includes(source.layoutMode)) {
        node.layout = source.layoutMode === "GRID" ? "grid" : "flex";
        node.direction = source.layoutMode === "VERTICAL" ? "column" : "row";
        const pad = [
          source.paddingTop,
          source.paddingRight,
          source.paddingBottom,
          source.paddingLeft,
        ].map((v, i) => Math.max(0, finite(v) - border[i]));
        if (new Set(pad).size === 1) node.padding = pad[0];
        else {
          node.padding = pad[3];
          [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft] = pad;
        }
        const between = source.primaryAxisAlignItems === "SPACE_BETWEEN";
        node.gap = between ? 0 : finite(source.itemSpacing, source.gridColumnGap || 0);
        if (node.layout === "flex") {
          node.justifyContent =
            {
              MIN: "flex-start",
              CENTER: "center",
              MAX: "flex-end",
              SPACE_BETWEEN: "space-between",
            }[source.primaryAxisAlignItems] || "flex-start";
          node.alignItems =
            { MIN: "flex-start", CENTER: "center", MAX: "flex-end", BASELINE: "baseline" }[
              source.counterAxisAlignItems
            ] || "flex-start";
          if (source.layoutWrap === "WRAP") {
            node.flexWrap = true;
            const cross = finite(source.counterAxisSpacing, node.gap);
            if (node.direction === "row") {
              node.gapX = node.gap;
              node.gapY = cross;
            } else {
              node.gapY = node.gap;
              node.gapX = cross;
            }
          }
          const primary = node.direction === "row" ? "wMode" : "hMode",
            counter = node.direction === "row" ? "hMode" : "wMode";
          if (source.primaryAxisSizingMode === "AUTO") node[primary] = "hug";
          if (source.counterAxisSizingMode === "AUTO") node[counter] = "hug";
        }
      }
      if (source.layoutSizingHorizontal === "HUG" && (type === "text" || node.layout !== "free"))
        node.wMode = "hug";
      if (source.layoutSizingVertical === "HUG" && (type === "text" || node.layout !== "free"))
        node.hMode = "hug";
      // Placement inside the parent: flow child, absolute child, or constrained child.
      const flowParent = parent && parent.node.layout !== "free";
      if (flowParent) {
        if (source.layoutPositioning === "ABSOLUTE") node.position = "absolute";
        else {
          const row = parent.node.direction === "row";
          if (
            finite(source.layoutGrow) > 0 ||
            (source.layoutSizingHorizontal === "FILL" && row) ||
            (source.layoutSizingVertical === "FILL" && !row)
          )
            node[row ? "wMode" : "hMode"] = "fill";
          if (
            source.layoutAlign === "STRETCH" ||
            (source.layoutSizingVertical === "FILL" && row) ||
            (source.layoutSizingHorizontal === "FILL" && !row)
          )
            node[row ? "hMode" : "wMode"] = "fill";
        }
      }
      if (type === "text") {
        const fit = source.style?.textAutoResize;
        if (fit === "WIDTH_AND_HEIGHT") {
          node.wMode = "hug";
          node.hMode = "hug";
        } else if (fit === "HEIGHT") node.hMode = "hug";
      }
      const constrained =
        parent &&
        !["GROUP", "BOOLEAN_OPERATION"].includes(parent.source.type) &&
        (!flowParent || node.position === "absolute");
      if (constrained && source.constraints) {
        const H = {
            LEFT: "start",
            RIGHT: "end",
            CENTER: "center",
            LEFT_RIGHT: "stretch",
            SCALE: "scale",
          },
          V = {
            TOP: "start",
            BOTTOM: "end",
            CENTER: "center",
            TOP_BOTTOM: "stretch",
            SCALE: "scale",
          };
        const c = {
          h: H[source.constraints.horizontal] || "start",
          v: V[source.constraints.vertical] || "start",
        };
        if (c.h !== "start" || c.v !== "start") {
          const pb = parent.border,
            inner = {
              x: node.x - (flowParent ? pb[3] : 0),
              y: node.y - (flowParent ? pb[0] : 0),
              w: node.w,
              h: node.h,
            },
            cb = {
              w: Math.max(1, parent.node.w - pb[1] - pb[3]),
              h: Math.max(1, parent.node.h - pb[0] - pb[2]),
            };
          const patch = anchorPatch(node, c, inner, cb);
          for (const [k, v] of Object.entries(patch))
            if (v === null || v === undefined) delete node[k];
            else node[k] = v;
        }
      }

      // Text.
      if (source.type === "TEXT") {
        const st = source.style || {};
        if (st.italic) node.fontStyle = "italic";
        const lh = lineHeightOf(st);
        if (lh !== undefined) node.lineHeight = lh;
        if (Number.isFinite(st.letterSpacing) && st.letterSpacing !== 0)
          node.letterSpacing = r2(st.letterSpacing);
        if (TEXT_CASE[st.textCase]) node.textTransform = TEXT_CASE[st.textCase];
        else if (st.textCase && st.textCase !== "ORIGINAL") w0("Small caps text case not imported");
        if (TEXT_DECORATION[st.textDecoration])
          node.textDecoration = TEXT_DECORATION[st.textDecoration];
        if (st.textAlignVertical && st.textAlignVertical !== "TOP")
          w0("Vertical text alignment uses top alignment");
        const overrides = source.characterStyleOverrides || [],
          table = source.styleOverrideTable || {};
        let start = 0;
        const unsupported = new Set();
        while (start < node.text.length) {
          const key = overrides[start] || 0;
          let end = start + 1;
          while (end < node.text.length && (overrides[end] || 0) === key) end++;
          const own = table[key] || {};
          const style = { ...st, ...own };
          const fill = (style.fills || []).find((p) => p.type === "SOLID" && p.visible !== false);
          if (key || style.italic) {
            const run = {
              start,
              end,
              bold: finite(style.fontWeight, 400) >= 600,
              italic: !!style.italic,
            };
            if (fill) run.color = hex(fill.color);
            if (Number.isFinite(style.fontSize))
              run.fontSize = Math.max(8, Math.min(200, style.fontSize));
            node.textRuns.push(run);
          }
          for (const k of [
            "fontFamily",
            "letterSpacing",
            "textDecoration",
            "textCase",
            "lineHeightPx",
          ])
            if (key && own[k] !== undefined && own[k] !== st[k]) unsupported.add(k);
          if (key && finite(st.fontWeight, 400) >= 600 && finite(style.fontWeight, 400) < 600)
            unsupported.add("lighter fontWeight");
          start = end;
        }
        if (unsupported.size) w0(`Per-range ${[...unsupported].join(", ")} not imported`);
      }
      page.nodes.push(node);
      if (!vector) {
        const rotated = !!(place.rotation || place.flip) || parent?.rotated;
        const origin = { x: place.left, y: place.top };
        for (const child of source.children || [])
          walk(child, { node, origin, source, border, rotated }, depth + 1);
      } else if (source.type === "BOOLEAN_OPERATION")
        w0("Boolean operation flattened to its resulting path");
    }
    children.forEach((child) => walk(child));
    pages.push(page);
  }
  const document = {
    version: 2,
    name: payload.name || "Figma import",
    activePage: pages[0].id,
    pages,
    tokens: {},
  };
  return { document, warnings: [...warnings] };
}
function imageReferences(payload, nodeId) {
  const refs = new Set();
  let count = 0;
  function walk(n, depth = 0) {
    if (!n || n.visible === false) return;
    if (depth > 80) throw Error("Figma hierarchy exceeds 80 levels; select a smaller node");
    if (++count > NODE_LIMITS.perDocument)
      throw Error(
        `Figma import visited ${count} source nodes; limit is ${NODE_LIMITS.perDocument}. Select fewer pages or split into multiple documents.`,
      );
    for (const p of visibleFills(n))
      if (p.type === "IMAGE" && typeof p.imageRef === "string") refs.add(p.imageRef);
    for (const child of n.children || []) walk(child, depth + 1);
  }
  if (payload.document) walk(payload.document);
  else
    for (const entry of nodeId ? [payload.nodes?.[nodeId]] : Object.values(payload.nodes || {}))
      walk(entry?.document);
  return [...refs];
}
async function limitedBytes(response, max) {
  if (!response.body) throw Error("Empty response");
  const reader = response.body.getReader(),
    chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw Error("Figma response exceeds import size limit");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}
/**
 * REST import. `token` is a transient personal access token (X-Figma-Token); `bearer` is an OAuth access
 * token from the connected account (Authorization: Bearer). Either credential is sent to api.figma.com only.
 */
async function importFigma({ url, token, bearer } = {}, fetcher = fetch) {
  const source = parseFigmaURL(url);
  const oauth = typeof bearer === "string" && bearer.length > 0;
  if (
    !oauth &&
    (typeof token !== "string" || !token.trim() || token.length > 4096 || /[\r\n]/.test(token))
  )
    throw Error(
      "Enter a Figma personal access token with file_content:read scope, or connect your Figma account",
    );
  const secret = oauth ? bearer : token.trim(),
    controllers = new Set();
  if (/[\r\n]/.test(secret) || secret.length > 8192) throw Error("Invalid Figma credential");
  async function fetchLimited(target, auth, max) {
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const headers = auth
        ? oauth
          ? { Authorization: `Bearer ${secret}` }
          : { "X-Figma-Token": secret }
        : {};
      const response = await fetcher(target, {
        headers,
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        if (auth && [401, 403].includes(response.status))
          throw Error(
            oauth
              ? "Figma denied access. Reconnect your Figma account or check file access."
              : "Figma denied access. Check token scope and file access.",
          );
        if (response.status === 429) throw Error("Figma rate limit reached. Retry later.");
        throw Error(`Figma request failed (${response.status})`);
      }
      return {
        bytes: await limitedBytes(response, max),
        type: response.headers.get("content-type")?.split(";")[0],
      };
    } catch (error) {
      if (error.name === "AbortError") throw Error("Figma request timed out");
      if (error.message?.startsWith("Figma")) throw error;
      throw Error("Unable to retrieve Figma content");
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }
  const endpoint = new URL(
    `https://api.figma.com/v1/files/${encodeURIComponent(source.fileKey)}${source.nodeId ? "/nodes" : ""}`,
  );
  if (source.nodeId) endpoint.searchParams.set("ids", source.nodeId);
  endpoint.searchParams.set("geometry", "paths");
  const { bytes } = await fetchLimited(endpoint.href, true, LIMIT);
  let payload;
  try {
    payload = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw Error("Figma returned invalid document JSON");
  }
  const refs = imageReferences(payload, source.nodeId),
    images = {},
    downloadWarnings = [];
  let totalImages = 0;
  if (refs.length) {
    let urls = {};
    try {
      const result = await fetchLimited(
        `https://api.figma.com/v1/files/${encodeURIComponent(source.fileKey)}/images`,
        true,
        2 * 1024 * 1024,
      );
      urls = JSON.parse(result.bytes.toString("utf8")).meta?.images || {};
    } catch (error) {
      downloadWarnings.push(error.message);
    }
    if (refs.length > 20) downloadWarnings.push("Only the first 20 image fills are downloaded");
    for (const ref of refs.slice(0, 20)) {
      try {
        const asset = new URL(urls[ref]);
        if (
          asset.protocol !== "https:" ||
          asset.username ||
          asset.password ||
          !(
            asset.hostname.endsWith(".figma.com") ||
            /^figma-[a-z0-9-]+\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(asset.hostname)
          )
        )
          throw Error("Unsupported image CDN");
        const result = await fetchLimited(
          asset.href,
          false,
          Math.min(5 * 1024 * 1024, 15 * 1024 * 1024 - totalImages),
        );
        if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(result.type))
          throw Error("Unsupported bitmap type");
        totalImages += result.bytes.length;
        images[ref] = `data:${result.type};base64,${result.bytes.toString("base64")}`;
      } catch {
        downloadWarnings.push(`Image fill ${ref.slice(0, 50)} was not imported`);
      }
    }
  }
  const result = convertFigma(payload, { nodeId: source.nodeId, images });
  result.warnings.push(...downloadWarnings);
  if (Buffer.byteLength(JSON.stringify(result.document)) > LIMIT)
    throw Error("Converted document exceeds 20 MB; select a smaller Figma node");
  return { ...result, source };
}

// ---------- binary scene imports (clipboard and .fig) ----------
function convertScene(decoded, { images = new Map(), name } = {}) {
  const rest = scene.sceneToRest(decoded.message, { images });
  const result = convertFigma(
    { name: name || rest.document.name, document: rest.document },
    { images: rest.images },
  );
  result.warnings.unshift(...rest.warnings);
  if (Buffer.byteLength(JSON.stringify(result.document)) > LIMIT)
    throw Error("Converted document exceeds 20 MB; import a smaller selection");
  return result;
}
/**
 * Clipboard paste: the text/html Figma writes on copy. Returns the in-app clipboard shape the canvas
 * pastes ({format:'verynize/nodes', nodes, roots}) plus warnings. All copied pages are merged.
 */
function convertFigmaClipboard(html) {
  if (typeof html !== "string" || html.length > 280 * 1024 * 1024)
    throw Error("Clipboard content is too large");
  const parsed = kiwi.parseClipboardHtml(html);
  if (!parsed) throw Error("Clipboard does not contain Figma layers");
  let decoded;
  try {
    decoded = kiwi.decodeScene(parsed.bytes);
  } catch (error) {
    throw Error("Unable to read Figma clipboard data: " + error.message);
  }
  const { document, warnings } = convertScene(decoded, { name: "Figma paste" });
  const nodes = document.pages.flatMap((p) => p.nodes);
  if (!nodes.length) throw Error("Figma clipboard has no visible layers");
  return {
    format: "verynize/nodes",
    nodes,
    roots: nodes.filter((n) => !n.parentId).map((n) => n.id),
    tokens: {},
    warnings,
    source: {
      fileKey: typeof parsed.meta?.fileKey === "string" ? parsed.meta.fileKey.slice(0, 100) : null,
    },
  };
}
function convertFigFile(bytes, { name } = {}) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!data.length) throw Error("The .fig file is empty");
  if (data.length > FILE_LIMIT) throw Error("The .fig file exceeds 200 MB");
  let decoded;
  try {
    decoded = kiwi.readFigFile(data);
  } catch (error) {
    throw Error("Unable to read .fig file: " + error.message);
  }
  return convertScene(decoded, {
    images: decoded.images,
    name: name || decoded.meta?.file_name || undefined,
  });
}
async function convertPenFile(bytes, name) {
  const { importPen } = await import("../integrations/codec-pen.mjs");
  const result = await importPen(Buffer.from(bytes), {
    name: name?.replace(/\.pen$/i, ""),
    assetSink: async (data, type) => (await require("./assets.cjs").store()).put(data, type),
  });
  return { document: result.document, warnings: result.unsupportedFeatures.map((item) => `Pen ${item.sourceId || "document"}: unsupported ${item.feature}`),
    source: { format: result.sourceFormat, digest: result.sourceDigest }, fidelityStatus: result.fidelityStatus };
}
function registerFigma(handle, parent, { dialog } = {}) {
  handle("importFigma", async (options) => {
    let bearer;
    if (options?.useAccount) {
      bearer = await require("./figma-oauth.cjs").accessToken();
      if (!bearer) throw Error("Connect your Figma account first");
    }
    return importFigma({ url: options?.url, token: options?.token, bearer });
  });
  handle("figmaClipboard", (html) => convertFigmaClipboard(html));
  handle("figmaFile", ({ bytes, name } = {}) => {
    if (typeof name === "string" && /\.pen$/i.test(name)) return convertPenFile(bytes, name);
    return convertFigFile(bytes, {
      name: typeof name === "string" ? name.replace(/\.fig$/i, "").slice(0, 200) : undefined,
    });
  });
  handle("figmaFileOpen", async () => {
    const electron = dialog || require("electron").dialog;
    const picked = await electron.showOpenDialog(parent, {
      title: "Import Figma file",
      properties: ["openFile"],
      filters: [{ name: "Design file", extensions: ["fig", "pen"] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const file = picked.filePaths[0];
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > FILE_LIMIT) throw Error("Choose a .fig file under 200 MB");
    if (/\.pen$/i.test(file) && stat.size > 5_000_000) throw Error("Pen source exceeds limit 5000000 bytes");
    const name = require("node:path")
      .basename(file)
      .replace(/\.fig$/i, "");
    if (/\.pen$/i.test(file)) return convertPenFile(await fs.readFile(file), name);
    return convertFigFile(await fs.readFile(file), { name });
  });
}
module.exports = {
  registerFigma,
  importFigma,
  convertFigma,
  convertFigmaClipboard,
  convertFigFile,
  parseFigmaURL,
  vectorSvg,
  convertPenFile,
};
