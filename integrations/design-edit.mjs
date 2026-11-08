import { distributeImport, importPageReport } from "./import-pages.mjs";
// Pure document transforms used by the MCP tools: stable short element ids, page indexing,
// JSX -> node construction (Tailwind v4 classes, CSS-like flow layout with hug/fill sizing and
// text inheritance), and the update_elements directive script. Everything here operates on plain
// version-2 document objects.
import { NODE_LIMITS, nodeLimitMessage } from "./document-core.mjs";
import { randomUUID } from "node:crypto";
import {
  NODE_DEFAULTS,
  parseJsx,
  parseClasses,
  collectText,
  isTextOnly,
  isSafeTag,
  serializeNode,
  cssVarForToken,
  normalizeColor,
  JsxSyntaxError,
  defaultSizing,
  isFlexRow,
} from "./jsx-codec.mjs";
import { layoutPage, measureText } from "./codec-layout.mjs";
import {
  cascadeText,
  styleFromSpec,
  mergeStyle,
  TEXT_DEFAULTS,
  baselineTextStyle,
} from "./codec-text.mjs";
import { resolveIcon, iconToNodeImage, isSafeColor, sanitizeSvg } from "./assets.mjs";
import { cssColorToHex } from "./codec-css.mjs";
import { BINDABLE, checkVariableValue } from "./design-store.mjs";
import {
  syncAliases,
  renameAliasRefs,
  dropAliases,
  boundValue,
  writeBoundValue,
  bindingOrder,
} from "./variables.mjs";
import {
  applyPaintAttrs,
  renamePaintTokens,
  unbindPaintTokens,
  syncPaintTokens,
} from "./paints.mjs";
import { applyShaderAttrs } from "./shaders.mjs";
import { applyResidual } from "./codec-residual.mjs";
import { svgElementJsx, vectorFromElement } from "./vector-jsx.mjs";
import { createInstance, createComponent, adoptCopies, componentInfo } from "./component-core.mjs";

export { measureText };

export const clone = (value) => structuredClone(value);

// ---------------------------------------------------------------------------------------------
// Short ids. Each node gets a page-unique code stored as `shortId`. Artboards (top-level nodes)
// are addressed by their code ("bok"); descendants by "<artboard code>.<own code>" ("bok.tem").

/** Array#sort's default string order (UTF-16 code units). */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const CONSONANTS = "bcdfghjklmnprstvwz",
  VOWELS = "aeiou",
  LETTERS = "abcdefghijklmnopqrstuvwxyz";
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
function codeFor(id, attempt) {
  const h = hash(id + ":" + attempt);
  if (attempt < 6)
    return (
      CONSONANTS[h % 18] + VOWELS[Math.floor(h / 18) % 5] + CONSONANTS[Math.floor(h / 90) % 18]
    );
  if (attempt < 40) return [0, 1, 2].map((k) => LETTERS[Math.floor(h / 26 ** k) % 26]).join("");
  return [0, 1, 2, 3].map((k) => LETTERS[Math.floor(h / 26 ** k) % 26]).join("");
}
const SHORT = /^[a-z]{3,4}$/;
/** Assign missing or duplicate short ids in place. Returns true when anything changed. */
export function ensureShortIds(document) {
  let changed = false;
  for (const page of document.pages) {
    const used = new Set();
    for (const node of page.nodes) {
      if (typeof node.shortId === "string" && SHORT.test(node.shortId) && !used.has(node.shortId)) {
        used.add(node.shortId);
        continue;
      }
      let attempt = 0,
        code;
      do code = codeFor(node.id, attempt++);
      while (used.has(code));
      node.shortId = code;
      used.add(code);
      changed = true;
    }
  }
  return changed;
}

export function indexPage(page) {
  const byId = new Map(),
    byCode = new Map(),
    kids = new Map();
  for (const node of page.nodes) {
    byId.set(node.id, node);
    if (node.shortId) byCode.set(node.shortId, node);
    const key = node.parentId || null;
    if (!kids.has(key)) kids.set(key, []);
    kids.get(key).push(node);
  }
  const rootOf = (node) => {
    let current = node;
    const seen = new Set();
    while (current.parentId && byId.has(current.parentId) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.parentId);
    }
    return current;
  };
  const shortId = (node) =>
    node.parentId ? `${rootOf(node).shortId}.${node.shortId}` : node.shortId;
  const children = (id) => kids.get(id) || [];
  const descendants = (id) => {
    const out = [];
    const walk = (pid) => {
      for (const child of children(pid)) {
        out.push(child);
        walk(child.id);
      }
    };
    walk(id);
    return out;
  };
  const ancestors = (node) => {
    const out = [];
    let current = node;
    while (current.parentId && byId.has(current.parentId)) {
      current = byId.get(current.parentId);
      out.unshift(current);
    }
    return out;
  };
  const resolve = (ref) => {
    if (typeof ref !== "string" || !ref) return null;
    if (byId.has(ref)) return byId.get(ref);
    const code = ref.includes(".") ? ref.slice(ref.lastIndexOf(".") + 1) : ref;
    const node = byCode.get(code);
    if (!node) return null;
    if (ref.includes(".") && rootOf(node).shortId !== ref.slice(0, ref.indexOf("."))) return null;
    return node;
  };
  const require = (ref) => {
    const node = resolve(ref);
    if (!node) throw new Error(`Element ${JSON.stringify(ref)} not found on page ${page.id}`);
    return node;
  };
  return { page, byId, children, descendants, ancestors, rootOf, shortId, resolve, require };
}

export function getPage(document, pageId) {
  const page = pageId
    ? document.pages.find((p) => p.id === pageId)
    : document.pages.find((p) => p.id === document.activePage) || document.pages[0];
  if (!page) throw new Error(`Page ${pageId} not found. Call get_design_context for page ids.`);
  return page;
}

export function elementCode(document, page, node, depth = Infinity) {
  const index = indexPage(page);
  const parent = node.parentId ? index.byId.get(node.parentId) : null;
  return serializeNode(node, index, {
    depth,
    tokens: document.tokens || {},
    parent,
    isRoot: !node.parentId,
  });
}

// ---------------------------------------------------------------------------------------------
// JSX -> nodes
//
// Node model written by the codec (all optional; legacy documents keep working):
//   layout 'block'|'flex'|'grid'|'inline'|'free'   frames default to 'block' (CSS block flow)
//   wMode/hMode 'fixed'|'hug'|'fill'|'auto'|'calc', wPct/hPct     sizing; hug/fill/auto/calc w/h are layout outputs
//   wCalc/hCalc (Calculate expression)              px/% calc() terms for wMode/hMode 'calc' (w-[calc(100%_-_24px)]); 'auto' = w-auto
//   paddingTop/Right/Bottom/Left                    when not uniform (uniform -> `padding`)
//   gapX/gapY                                       when they differ (equal -> `gap`)
//   cornerRadii [tl,tr,br,bl], strokeWidths [t,r,b,l], strokeStyle, ringWidth/ringColor/ringInset
//   ellipse (rounded-[50%]), flipX/flipY (-scale-x-100 / -scale-y-100)
//   flexWrap, reverse (row-/column-reverse), grow, shrink, basis, alignSelf, colSpan, rowSpan, margin [t,r,b,l] (number|'auto')
//   rows (equal grid rows), justifyItems (grid cell alignment; Block alignment on block frames)
//   minW/maxW/minH/maxH (px number or 'N%'), aspectRatio
//   position 'absolute' + inset [t,r,b,l] (px|'N%'|null) + translate [x,y] (px|'N%')
//   textTransform, textDecoration, fontStyle, truncate, noWrap, lineClamp, textWrap, objectFit, hidden
//   textAlignVertical (content-center/end), whiteSpace (whitespace-*), wordBreak (break-normal/break-all), textIndent (indent-*),
//     fontSmoothing (antialiased/subpixel-antialiased), lineHeight 'auto' (leading-[normal])
//   textStyle (frames: inheritable text declarations), styleOwn (text: keys declared on itself)
//   measured: false                                  geometry came from the headless estimate
//   icon 'set:name' (image nodes from <Icon name> / <ArrowRight/>): src is a generated SVG data URL;
//     iconColor (own text-* / color, else inherited text color), iconStrokeWidth; regenerated by reflow
//   srcRemote 'https://…' + assetStatus 'pending'|'missing'|'ready'   remote <img> not yet embedded

const BOX_KEYS = [
  "fill",
  "gradient",
  "strokeWidth",
  "padding",
  "radius",
  "shadow",
  "ringWidth",
  "cornerRadii",
];
const COMMON_KEYS = [
  "variantClasses",
  "opacity",
  "rotation",
  "flipX",
  "flipY",
  "zIndex",
  "clipContent",
  "mask",
  "animated",
  "shadow",
  "strokeColor",
  "strokeStyle",
  "ringWidth",
  "ringColor",
  "ringInset",
  "hidden",
  "aspectRatio",
  "grow",
  "shrink",
  "basis",
  "alignSelf",
  "colSpan",
  "rowSpan",
  "blendMode",
  "outlineWidth",
  "outlineOffset",
  "outlineColor",
  "outlineStyle",
];
const FRAME_KEYS = [
  "layout",
  "direction",
  "reverse",
  "columns",
  "rows",
  "columnSizes",
  "rowSizes",
  "alignItems",
  "justifyContent",
  "justifyItems",
  "flexWrap",
];
const TEXT_ONLY_KEYS = ["truncate", "noWrap", "lineClamp", "textWrap"];
const TEXT_SPEC_KEYS = [
  "ink",
  "inkToken",
  "fontSize",
  "fontWeight",
  "fontFamily",
  "textAlign",
  "lineHeight",
  "lineHeightPx",
  "letterSpacing",
  "letterSpacingEm",
  "textTransform",
  "textDecoration",
  "fontStyle",
  "textWrap",
];
const OWN_KEY = {
  ink: "color",
  inkToken: "color",
  fontSize: "fontSize",
  fontWeight: "fontWeight",
  fontFamily: "fontFamily",
  textAlign: "textAlign",
  lineHeight: "lineHeight",
  lineHeightPx: "lineHeight",
  letterSpacing: "letterSpacing",
  letterSpacingEm: "letterSpacing",
  textTransform: "textTransform",
  textDecoration: "textDecoration",
  fontStyle: "fontStyle",
  textWrap: "textWrap",
};

function classify(el) {
  const override = el.attrs["data-node-type"];
  if (["frame", "rectangle", "text", "image", "shader"].includes(override)) return override;
  if (el.tag === "img") return "image";
  if (el.tag === "Shader") return "shader";
  if (el.tag === "svg" && el.attrs["data-vector"] !== undefined) return "vector";
  if (el.tag === "hr" || el.tag === "input") return "rectangle";
  if (/^[A-Z]/.test(el.tag)) return "icon";
  // A flex/grid container of inline elements (<nav className="flex"><a>…</a><a>…</a></nav>) is a frame.
  const layoutClass = /(^|\s)!?(flex|inline-flex|grid|inline-grid)(\s|$)/.test(
    String(el.attrs.className ?? el.attrs.class ?? ""),
  );
  if (
    el.children.length &&
    isTextOnly(el) &&
    !(layoutClass && el.children.filter((c) => c.tag && c.tag !== "br").length > 1)
  )
    return "text";
  if (el.selfClosing && el.tag === "div") return "rectangle";
  return "frame";
}

const sidesOf = (node, prefix, fallback) =>
  ["Top", "Right", "Bottom", "Left"].map((s) => node[prefix + s] ?? fallback);
function setPadding(node, values) {
  if (values.every((v) => v === values[0])) {
    node.padding = values[0];
    for (const s of ["Top", "Right", "Bottom", "Left"]) delete node["padding" + s];
  } else {
    ["Top", "Right", "Bottom", "Left"].forEach((s, i) => {
      node["padding" + s] = values[i];
    });
    node.padding = Math.max(...values);
  }
}
function mergeFour(current, next) {
  return next.map((v, i) => (v === null || v === undefined ? current[i] : v));
}

/** Apply parsed class props (not geometry) to a node of known type. Text keys become own (text) or inherited declarations (frames). */
export function applySpec(node, spec, tokens) {
  const p = spec.props;
  if (p.fills) node.fills = p.fills;
  if (p.backgroundRemote) {
    node.srcRemote = p.backgroundRemote;
    node.assetStatus = "pending";
  }
  for (const key of COMMON_KEYS) if (key in p) node[key] = p[key];
  // Structured effects: a class that states a kind of effect replaces that kind; other kinds are kept.
  // Box shadows round-trip through `shadow` (shadow-[…]), drop/text shadows and filters stay structured.
  if ("shadow" in p || "dropShadows" in p || "textShadows" in p) {
    const replaced = (s) =>
      ("shadow" in p && s?.type === "box") ||
      ("dropShadows" in p && s?.type === "drop") ||
      ("textShadows" in p && s?.type === "text");
    const next = [
      ...(Array.isArray(node.shadows) ? node.shadows : []).filter((s) => !replaced(s)),
      ...(p.dropShadows || []),
      ...(node.type === "text" ? p.textShadows || [] : []),
    ];
    if (next.length) node.shadows = next;
    else delete node.shadows;
  }
  if ("filters" in p || "backdropFilters" in p) {
    const next = [
      ...(Array.isArray(node.filters) ? node.filters : []).filter((f) =>
        f?.backdrop === true ? !("backdropFilters" in p) : !("filters" in p),
      ),
      ...(p.filters || []),
      ...(p.backdropFilters || []),
    ];
    if (next.length) node.filters = next;
    else delete node.filters;
  }
  if ("mask" in p) delete node.masks;
  if (Array.isArray(p.maskLayers)) node.masks = p.maskLayers;
  // Colour variables of border/outline and per-side border colours follow the classes that state a colour.
  if ("strokeColor" in p) {
    if (p.strokeToken) node.strokeToken = p.strokeToken;
    else delete node.strokeToken;
    if (p.strokeColors) node.strokeColors = p.strokeColors;
    else delete node.strokeColors;
  }
  if ("outlineToken" in p) {
    if (p.outlineToken) node.outlineToken = p.outlineToken;
    else delete node.outlineToken;
  }
  if (node.outlineWidth === 0)
    for (const key of [
      "outlineWidth",
      "outlineOffset",
      "outlineColor",
      "outlineStyle",
      "outlineToken",
    ])
      delete node[key];
  if ("cornerRadii" in p) {
    const merged = mergeFour(
      Array.isArray(node.cornerRadii) ? node.cornerRadii : Array(4).fill(Number(node.radius) || 0),
      p.cornerRadii,
    );
    if (merged.every((v) => v === merged[0])) {
      node.radius = merged[0];
      delete node.cornerRadii;
    } else {
      node.cornerRadii = merged;
      node.radius = Math.max(...merged);
    }
  } else if ("radius" in p) {
    node.radius = p.radius;
    delete node.cornerRadii;
  }
  // rounded-[50%] makes the box an ellipse; any other radius class turns it back into a rounded box.
  if (p.ellipse === true && node.type !== "text") node.ellipse = true;
  else if ("radius" in p || "cornerRadii" in p) delete node.ellipse;
  if ("strokeWidths" in p) {
    const merged = mergeFour(
      Array.isArray(node.strokeWidths)
        ? node.strokeWidths
        : Array(4).fill(Number(node.strokeWidth) || 0),
      p.strokeWidths,
    );
    if (merged.every((v) => v === merged[0])) {
      node.strokeWidth = merged[0];
      delete node.strokeWidths;
    } else {
      node.strokeWidths = merged;
      node.strokeWidth = Math.max(...merged);
    }
  } else if ("strokeWidth" in p) {
    node.strokeWidth = p.strokeWidth;
    delete node.strokeWidths;
  }
  if (node.type === "image" && "objectFit" in p) node.objectFit = p.objectFit;
  if (node.type === "text") {
    const own = new Set(Array.isArray(node.styleOwn) ? node.styleOwn : []);
    if ("fontSize" in p) node.fontSize = p.fontSize;
    if ("ink" in p) {
      node.color = p.ink;
      node.token = p.inkToken || "";
    }
    for (const key of [
      "fontWeight",
      "fontFamily",
      "textAlign",
      "lineHeight",
      "letterSpacing",
      "textTransform",
      "textDecoration",
      "fontStyle",
      "textWrap",
      "truncate",
      "noWrap",
      "lineClamp",
    ])
      if (key in p) node[key] = p[key];
    // Type settings: an empty value means the canvas default, which is stored as an absent field.
    for (const key of [
      "textAlignVertical",
      "whiteSpace",
      "wordBreak",
      "textIndent",
      "fontSmoothing",
    ])
      if (key in p) {
        if (p[key] === "" || p[key] === "top" || p[key] === 0) delete node[key];
        else node[key] = p[key];
      }
    if ("lineHeightPx" in p)
      node.lineHeight = Math.round((p.lineHeightPx / (node.fontSize || 16)) * 1000) / 1000;
    if ("letterSpacingEm" in p)
      node.letterSpacing = Math.round(p.letterSpacingEm * (node.fontSize || 16) * 100) / 100;
    for (const key of Object.keys(p)) if (OWN_KEY[key]) own.add(OWN_KEY[key]);
    if (spec.italic !== undefined) {
      own.add("fontStyle");
      node.fontStyle = spec.italic ? "italic" : "";
    }
    node.styleOwn = [...own];
  } else {
    if (node.type !== "image") {
      if ("fill" in p) {
        node.color = p.fill;
        node.token = p.fillToken || "";
      }
      if ("gradient" in p) node.gradient = p.gradient;
    }
    if (node.type === "frame") {
      const declared = styleFromSpec({
        props: Object.fromEntries(TEXT_SPEC_KEYS.filter((k) => k in p).map((k) => [k, p[k]])),
        italic: spec.italic,
      });
      if (Object.keys(declared).length) node.textStyle = mergeStyle(node.textStyle, declared);
    }
  }
  if (node.type === "frame") {
    for (const key of FRAME_KEYS) if (key in p) node[key] = p[key];
    // Equal tracks in the classes drop stale fr weights.
    if ("columns" in p && !("columnSizes" in p)) delete node.columnSizes;
    if ("rows" in p && !("rowSizes" in p)) delete node.rowSizes;
    if ("direction" in p && !("layout" in p) && (node.layout === "free" || node.layout === "block"))
      node.layout = "flex";
    if (["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"].some((k) => k in p))
      setPadding(
        node,
        mergeFour(sidesOf(node, "padding", Number(node.padding) || 0), [
          p.paddingTop,
          p.paddingRight,
          p.paddingBottom,
          p.paddingLeft,
        ]),
      );
    if ("gapX" in p || "gapY" in p) {
      const gx = p.gapX ?? node.gapX ?? node.gap ?? 0,
        gy = p.gapY ?? node.gapY ?? node.gap ?? 0;
      if (gx === gy) {
        node.gap = gx;
        delete node.gapX;
        delete node.gapY;
      } else {
        node.gapX = gx;
        node.gapY = gy;
        node.gap = Math.max(gx, gy);
      }
    }
  }
  void tokens;
}

const lengthValue = (len) =>
  len.frac !== undefined && !len.px ? `${Math.round(len.frac * 100000) / 1000}%` : (len.px ?? 0);
const FALLBACK = {
  rectangle: [100, 100],
  image: [200, 150],
  shader: [400, 300],
  frame: [100, 100],
  text: [100, 20],
  vector: [24, 24],
};

/**
 * Apply size/position classes. `parent` is the node's parent (null for artboards). New nodes get
 * CSS auto sizing (hug/fill); edits only change what the classes mention.
 */
function applyGeometry(node, spec, parent, { isNew, warnings, label }) {
  const free = parent && (!parent.layout || parent.layout === "free");
  const inset = [spec.top, spec.right, spec.bottom, spec.left];
  if (free) {
    // Free frames position children by x/y (Left/Top). Right/bottom, percentage and centring offsets are
    // constraints: kept as `inset`/`translate` so the renderer anchors them (see constraintsOf in node-style.js).
    const plainPx = (len) => len === undefined || (len.px !== undefined && len.frac === undefined);
    const constrained =
      spec.right || spec.bottom || spec.translate || !plainPx(spec.left) || !plainPx(spec.top);
    if (constrained) {
      node.inset = mergeFour(
        Array.isArray(node.inset) ? node.inset : [null, null, null, null],
        inset.map((v) => (v ? lengthValue(v) : null)),
      );
      if (spec.translate) node.translate = [spec.translate.x, spec.translate.y];
      // Keep an explicit start inset on axes the classes don't anchor, so x/y-less axes stay where they are.
      if (node.inset[1] === null && node.inset[3] === null)
        node.inset[3] = spec.left?.px ?? node.x ?? 0;
      if (node.inset[0] === null && node.inset[2] === null)
        node.inset[0] = spec.top?.px ?? node.y ?? 0;
    } else {
      if (Array.isArray(node.inset) && (spec.left || spec.top)) {
        delete node.inset;
        delete node.translate;
      }
      if (spec.left?.px !== undefined) node.x = spec.left.px;
      else if (isNew) node.x = 0;
      if (spec.top?.px !== undefined) node.y = spec.top.px;
      else if (isNew) node.y = 0;
    }
  } else if (parent) {
    if (spec.absolute) node.position = "absolute";
    else if (inset.some(Boolean) && node.position !== "absolute")
      warnings.push(
        `${label}: top/right/bottom/left offsets only apply to absolute elements; add "absolute"`,
      );
    if (node.position === "absolute") {
      if (inset.some(Boolean) || isNew)
        node.inset = mergeFour(
          Array.isArray(node.inset) ? node.inset : [null, null, null, null],
          inset.map((v) => (v ? lengthValue(v) : null)),
        );
      if (spec.translate) node.translate = [spec.translate.x, spec.translate.y];
    }
  } else if (spec.absolute)
    warnings.push(`${label}: artboards are positioned with data-component-x/y; "absolute" ignored`);
  if (spec.margin) {
    if (!parent) warnings.push(`${label}: margins on an artboard are ignored`);
    else
      node.margin = mergeFour(
        Array.isArray(node.margin) ? node.margin : [0, 0, 0, 0],
        ["top", "right", "bottom", "left"].map((s) => spec.margin[s]),
      );
  }
  for (const [key, prop] of [
    ["minW", "minW"],
    ["maxW", "maxW"],
    ["minH", "minH"],
    ["maxH", "maxH"],
  ])
    if (spec[key]) node[prop] = lengthValue(spec[key]);
  const def = defaultSizing(node, parent);
  const canHug = node.type === "text" || node.type === "frame";
  const row = isFlexRow(parent) && node.position !== "absolute";
  const axis = (len, key, modeKey, pctKey, defMode) => {
    const calcKey = key + "Calc";
    if (len) delete node[calcKey];
    // An explicit w-auto / h-auto on text or a frame is the Auto sizing mode (CSS auto); elsewhere it is the default.
    if (len?.auto && canHug && parent) {
      node[modeKey] = "auto";
      delete node[pctKey];
      return;
    }
    if (len?.calc) {
      node[modeKey] = "calc";
      node[calcKey] = len.calc;
      delete node[pctKey];
      if (len.frac === undefined) node[key] = Math.max(1, len.px);
      return;
    }
    if (!len || len.auto) {
      if (!isNew && !len) return;
      let mode = defMode;
      if (key === "w" && row && Number(node.grow) > 0 && spec.has.has("grow")) mode = "fill";
      if (key === "w" && !parent && canHug) mode = "hug"; // resolved to a fixed width after layout
      if (mode === "fixed") node[key] = node[key] ?? FALLBACK[node.type][key === "w" ? 0 : 1];
      node[modeKey] = mode;
      delete node[pctKey];
      return;
    }
    if (len.fit) {
      node[modeKey] = canHug ? "hug" : "fixed";
      delete node[pctKey];
      if (!canHug)
        warnings.push(`${label}: fit-content sizing needs a frame or text; kept a fixed size`);
      return;
    }
    if (len.px !== undefined && len.frac === undefined) {
      node[modeKey] = "fixed";
      node[key] = Math.max(1, len.px);
      delete node[pctKey];
      return;
    }
    if (len.frac === 1 && !len.px && parent && !free) {
      node[modeKey] = "fill";
      delete node[pctKey];
      return;
    }
    if (len.frac !== undefined && !len.px && parent) {
      node[modeKey] = "fixed";
      node[pctKey] = Math.round(len.frac * 100000) / 1000;
      return;
    }
    warnings.push(
      `${label}: ${key === "w" ? "width" : "height"} ${len.frac !== undefined ? `${len.frac * 100}%${len.px ? ` ${len.px < 0 ? "-" : "+"} ${Math.abs(len.px)}px` : ""}` : ""} cannot be represented here; kept the current size`,
    );
  };
  axis(spec.w, "w", "wMode", "wPct", def.w);
  axis(spec.h, "h", "hMode", "hPct", def.h);
  if (isNew && node.type === "rectangle" && !spec.h && !node.aspectRatio)
    warnings.push(
      `${label}: empty element without a height; used ${node.h}px (CSS would collapse it to 0)`,
    );
}

// ---------------------------------------------------------------------------------------------
// Icons: <Icon name="lucide:arrow-right" className="size-5 text-slate-500"/> and component names
// (<ArrowRight/>, <LuX/>, <IconBrandGithub/>) become image nodes with a generated SVG.

const ICON_TAGS = new Set(["Icon", "Iconify"]);
const iconNameOf = (el) =>
  (ICON_TAGS.has(el.tag)
    ? typeof el.attrs.name === "string"
      ? el.attrs.name
      : typeof el.attrs.icon === "string"
        ? el.attrs.icon
        : ""
    : el.tag
  ).trim();
const STROKE_CLASS = /^stroke-(?:(\d+(?:\.\d+)?)|\[(\d+(?:\.\d+)?)(?:px)?\])$/;
const isRemoteSrc = (src) =>
  typeof src === "string" && /^https?:\/\/[^\s"'<>]+$/i.test(src) && src.length <= 4000;
const isEmbeddedSrc = (src) =>
  typeof src === "string" && /^data:image\/(png|jpeg|webp|gif|svg\+xml);/i.test(src);

/** Split stroke-N classes off an icon's className (they are SVG stroke widths, not CSS borders). */
function iconClasses(className) {
  let strokeWidth;
  const rest = String(className || "")
    .split(/\s+/)
    .filter((c) => {
      const m = STROKE_CLASS.exec(c);
      if (!m) return true;
      strokeWidth = Number(m[1] ?? m[2]);
      return false;
    });
  return { className: rest.join(" "), strokeWidth };
}

/** Apply icon attributes/classes to an image node. Returns the parsed class spec. */
function applyIconElement(node, el, tokens, warnings, where, { isNew }) {
  const raw = iconNameOf(el);
  const icon = raw ? resolveIcon(raw) : null;
  if (raw || isNew) {
    if (icon) {
      node.icon = icon.name;
      node.assetStatus = "ready";
    } else {
      node.icon = raw || "unknown";
      node.assetStatus = "missing";
      delete node.src;
      warnings.push(
        `${where}: icon ${JSON.stringify(raw || "")} was not found in the bundled icon sets (lucide, tabler, ph); left an empty placeholder. Use search_icons or a "set:name" such as lucide:arrow-right`,
      );
    }
  }
  const { className, strokeWidth } = iconClasses(el.attrs.className ?? el.attrs.class ?? "");
  const spec = parseClasses(className, { tokens });
  if ("ink" in spec.props) node.iconColor = spec.props.ink;
  if (typeof el.attrs.color === "string") {
    if (isSafeColor(el.attrs.color) && el.attrs.color !== "currentColor")
      node.iconColor = normalizeColor(el.attrs.color) || el.attrs.color;
    else if (el.attrs.color === "currentColor") delete node.iconColor;
  }
  const sw = Number.isFinite(el.attrs.strokeWidth)
    ? el.attrs.strokeWidth
    : Number.isFinite(Number(el.attrs.strokeWidth)) && el.attrs.strokeWidth !== undefined
      ? Number(el.attrs.strokeWidth)
      : strokeWidth;
  if (Number.isFinite(sw) && sw > 0 && sw <= 32) node.iconStrokeWidth = sw;
  const size = Number(el.attrs.size);
  if (Number.isFinite(size) && size > 0) {
    if (!spec.w) {
      node.w = Math.min(2048, size);
      node.wMode = "fixed";
    }
    if (!spec.h) {
      node.h = Math.min(2048, size);
      node.hMode = "fixed";
    }
  } else if (isNew) {
    if (!spec.w) node.w = spec.h?.px ?? 24;
    if (!spec.h) node.h = spec.w?.px ?? 24;
  }
  return spec;
}

const iconCache = new Map();
/** Regenerate icon image sources from their resolved color, size and stroke width. */
export function refreshIcons(page, document = {}) {
  const index = indexPage(page);
  const tokens = document.tokens || {};
  for (const node of page.nodes) {
    if (node.type !== "image" || !node.icon || node.assetStatus === "missing") continue;
    let color = node.iconColor;
    if (!color) {
      const style = baselineTextStyle({ type: "text" }, index.ancestors(node));
      color = (style.token && tokens[style.token]) || style.color || TEXT_DEFAULTS.color;
    }
    const size = Math.round(Math.max(1, Math.min(Number(node.w) || 24, Number(node.h) || 24)));
    const key = `${node.icon}|${color}|${size}|${node.iconStrokeWidth ?? ""}`;
    if (!iconCache.has(key)) {
      if (iconCache.size > 500) iconCache.clear();
      iconCache.set(
        key,
        iconToNodeImage(node.icon, { size, color, strokeWidth: node.iconStrokeWidth }),
      );
    }
    const src = iconCache.get(key);
    if (src) {
      node.src = src;
      node.assetStatus = "ready";
    } else {
      delete node.src;
      node.assetStatus = "missing";
    }
  }
}

/**
 * Convert parsed JSX elements to nodes under `parent` (a node or null). Returns
 * {roots, nodes, warnings}. Geometry is computed later by `reflow` once the nodes are on the page.
 * `reuse` maps short/long ids of nodes being replaced to node ids that may be kept.
 */
function applySvgColor(node, attrs) {
  if (Object.hasOwn(attrs, "data-svg-color")) {
    const value = attrs["data-svg-color"];
    if (value === "") {
      delete node.svgColor;
      delete node.svgColorToken;
    } else if (typeof value === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value))
      node.svgColor = value;
    else throw new Error("Invalid SVG color");
  }
  if (Object.hasOwn(attrs, "data-svg-color-token")) {
    const name = attrs["data-svg-color-token"];
    if (name === "") delete node.svgColorToken;
    else {
      checkTokenName(name);
      node.svgColorToken = name;
    }
  }
  if (!String(node.src || "").startsWith("data:image/svg+xml;base64,")) {
    delete node.svgColor;
    delete node.svgColorToken;
  }
}

/**
 * An ordinary <svg> element as Verynize's vector JSX (a parsed element: <svg data-vector>, or a free frame of them),
 * or null with a warning when it must stay an image. Element attributes (label, id, residual, component placement)
 * carry over to the outer element.
 */
function svgToVector(el, markup, { tokens, parentNode, warnings }) {
  const className = String(el.attrs.className ?? el.attrs.class ?? "");
  const spec = parseClasses(className, { tokens }),
    ink = spec.props.ink;
  const px = (len, attr) =>
    len?.px !== undefined && len.frac === undefined
      ? len.px
      : Number(attr) > 0
        ? Number(attr)
        : undefined;
  const color =
    (typeof el.attrs.color === "string" && normalizeColor(el.attrs.color)) ||
    (typeof ink === "string" && normalizeColor(ink)) ||
    parentNode?.textStyle?.color ||
    TEXT_DEFAULTS.color;
  const keep = Object.entries(el.attrs).filter(
    ([k]) => k.startsWith("data-") && k !== "data-vector",
  );
  const attrs = keep.map(([k, v]) =>
    v === true
      ? k
      : `${k}="${String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`,
  );
  const sized = [
    Number(el.attrs.width) > 0 ? `[width:${Number(el.attrs.width)}px]` : "",
    Number(el.attrs.height) > 0 ? `[height:${Number(el.attrs.height)}px]` : "",
  ].filter(Boolean);
  const out = svgElementJsx(markup, {
    color,
    attrs,
    className: [className, ...sized].join(" ").trim(),
    label:
      el.attrs["data-node-label"] || el.attrs["data-name"] || el.attrs["aria-label"] || "Vector",
    w: px(spec.w, el.attrs.width),
    h: px(spec.h, el.attrs.height),
  });
  if (!out.ok) {
    warnings.push(`${out.reason}; kept it as an SVG image`);
    return null;
  }
  for (const w of out.warnings.slice(0, 6)) warnings.push(`Inline SVG: ${w}`);
  const parsed = parseJsx(out.jsx).elements[0];
  // An SVG without size classes or attributes is sized by its own width/height or viewBox.
  if (!sized.length && !/(^|\s)(size|w|h)-/.test(className)) {
    const { width, height } = out.result;
    parsed.attrs.className =
      `${parsed.attrs.className || ""} [width:${Math.round(width * 1000) / 1000}px] [height:${Math.round(height * 1000) / 1000}px]`.trim();
  }
  return parsed;
}

export function buildNodes(
  elements,
  {
    document,
    page,
    parent = null,
    warnings = [],
    keepRootId = null,
    reuse = null,
    viewport = null,
  },
) {
  const tokens = document.tokens || {};
  const nodes = [];
  const roots = [];
  const instances = [];
  const slots = [];
  const batch = new Map();
  const make = (el, parentNode, isTop) => {
    if (el.tag === "svg" && el.attrs["data-vector"] === undefined) {
      const escape = (value) =>
        String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      const serialize = (e) =>
        e.text !== undefined
          ? escape(e.text)
          : `<${e.tag}${Object.entries(e.attrs)
              .filter(([k]) => !/^on/i.test(k))
              .map(
                ([k, v]) =>
                  ` ${k === "className" ? "class" : k.replace(/^(stroke|fill|clip)([A-Z])/g, (_, a, b) => a + "-" + b.toLowerCase())}="${escape(v)}"`,
              )
              .join("")}>${e.children.map(serialize).join("")}</${e.tag}>`;
      const clean = sanitizeSvg(
        serialize({ ...el, attrs: { xmlns: "http://www.w3.org/2000/svg", ...el.attrs } }),
      );
      if (!clean) warnings.push("Inline SVG was rejected by the sanitizer");
      // Vector layers first (vector-jsx.mjs); drawings a vector cannot hold stay an SVG image.
      const vector = clean ? svgToVector(el, clean, { tokens, parentNode, warnings }) : null;
      if (vector) return make(vector, parentNode, isTop);
      el = {
        ...el,
        tag: "img",
        children: [],
        attrs: {
          ...el.attrs,
          src: clean ? `data:image/svg+xml;base64,${Buffer.from(clean).toString("base64")}` : "",
          className: `${el.attrs.className || el.attrs.class || ""} ${Number(el.attrs.width) > 0 ? `[width:${Number(el.attrs.width)}px]` : ""} ${Number(el.attrs.height) > 0 ? `[height:${Number(el.attrs.height)}px]` : ""}`,
        },
      };
    }
    if (!el.attrs["data-node-label"] && el.attrs["data-name"])
      el.attrs["data-node-label"] = el.attrs["data-name"];
    const kind = classify(el);
    if (el.tag === "br") return null;
    const isIcon = kind === "icon";
    const label =
      typeof el.attrs["data-node-label"] === "string" && el.attrs["data-node-label"].trim()
        ? el.attrs["data-node-label"].trim().slice(0, 200)
        : null;
    const where = `<${el.tag}${label ? ` "${label}"` : ""}>`;
    let reused = null;
    if (reuse && typeof el.attrs["data-node-id"] === "string")
      reused = reuse(el.attrs["data-node-id"]);
    const id = isTop && keepRootId ? keepRootId.id : reused?.id || randomUUID();
    const shortId = isTop && keepRootId ? keepRootId.shortId : reused?.shortId;
    // The node this element rewrites (replace): its component links carry over.
    const old = isTop && keepRootId ? keepRootId.node || null : reused;
    const instanceRef = linkRef(el.attrs["data-instance-of"]);
    if (
      instanceRef &&
      !(old?.instanceOf && refersTo(document, page, instanceRef, old.instanceOf))
    ) {
      // A new instance: a placeholder materialized from its main once the batch is on the page (placeBuilt).
      const node = {
        ...clone(NODE_DEFAULTS),
        id,
        type: "frame",
        parentId: parentNode?.id ?? null,
        name: label || "Instance",
        color: "transparent",
        layout: "block",
      };
      if (shortId) node.shortId = shortId;
      node._instance = { ref: instanceRef, el, label, ...instanceContent(el) };
      if (!parentNode)
        node._pos = {
          x: Number(el.attrs["data-component-x"]),
          y: Number(el.attrs["data-component-y"]),
        };
      if (typeof el.attrs["data-node-id"] === "string") batch.set(el.attrs["data-node-id"], node);
      nodes.push(node);
      instances.push(node);
      return node;
    }
    const spec = parseClasses(
      isIcon
        ? iconClasses(el.attrs.className ?? el.attrs.class ?? "").className
        : (el.attrs.className ?? el.attrs.class ?? ""),
      { tokens, viewport },
    );
    if (spec.warnings.length)
      warnings.push(
        `Classes on ${where}: ${spec.warnings.slice(0, 12).join("; ")}${spec.warnings.length > 12 ? " …" : ""}`,
      );
    if (el.attrs.style !== undefined)
      warnings.push(`style attributes are not supported on <${el.tag}>; use Tailwind classes`);
    const boxText =
      kind === "text" &&
      (el.tag === "button" || BOX_KEYS.some((k) => spec.has.has(k)) || spec.has.has("layout"));
    const type = boxText ? "frame" : isIcon ? "image" : kind;
    const node = {
      ...clone(NODE_DEFAULTS),
      id,
      type,
      parentId: parentNode?.id ?? null,
      name:
        label ||
        (isIcon
          ? resolveIcon(iconNameOf(el))?.icon || iconNameOf(el) || "Icon"
          : defaultName(type, el)),
    };
    if (shortId) node.shortId = shortId;
    if (isSafeTag(el.tag) && !["div", "p", "img"].includes(el.tag)) node.htmlTag = el.tag;
    node.color =
      type === "frame"
        ? "transparent"
        : type === "text"
          ? TEXT_DEFAULTS.color
          : type === "shader"
            ? "#a58bdd"
            : "#d9d9d9";
    if (type === "frame") node.layout = "block";
    if (type === "text") node.styleOwn = [];
    if (type === "shader") applyShaderAttrs(node, el.attrs);
    if (type === "vector") {
      Object.assign(
        node,
        { color: "#000000", radius: 0 },
        vectorFromElement(el, { tokens, reused: old, warnings, where }),
      );
      if (!node.paths.length)
        throw new Error(`${where}: a vector needs at least one <path d="…" />`);
      if (!node.viewBox)
        node.viewBox = [0, 0, Number(el.attrs.width) || 24, Number(el.attrs.height) || 24];
      // Unsized, it keeps its viewBox (or width/height attributes) as its size, like an <svg> in a browser.
      node.w = Math.max(1, Number(el.attrs.width) || node.viewBox[2]);
      node.h = Math.max(1, Number(el.attrs.height) || node.viewBox[3]);
    }
    if (isIcon) {
      node.color = "transparent";
      applyIconElement(node, el, tokens, warnings, where, { isNew: true });
    } else if (type === "image") {
      const src = typeof el.attrs.src === "string" ? el.attrs.src.trim() : "";
      if (isEmbeddedSrc(src)) node.src = src;
      else if (isRemoteSrc(src)) {
        // Fetched asynchronously by the tool layer, which embeds it as src and sets assetStatus 'ready'.
        if (reused?.srcRemote === src && reused.src) {
          node.src = reused.src;
          node.srcRemote = src;
          node.assetStatus = reused.assetStatus || "ready";
        } else {
          node.srcRemote = src;
          node.assetStatus = "pending";
        }
      } else if (reused?.src && !src) node.src = reused.src;
      else if (src)
        warnings.push(
          `Image ${label || ""} src must be an embedded data:image URL or an http(s) URL; created an empty image placeholder`,
        );
      if (el.attrs["data-asset-error"]) {
        node.assetStatus = "missing";
        node.assetError = String(el.attrs["data-asset-error"]).slice(0, 300);
      }
      applySvgColor(node, el.attrs);
    }
    if (type === "text") {
      const { text, runs } = collectText(el, { tokens });
      node.text = text;
      node.textRuns = runs;
    }
    // Text-only keys (truncate, line-clamp) belong to the label of a box-text element.
    const ownSpec = boxText
      ? {
          ...spec,
          props: Object.fromEntries(
            Object.entries(spec.props).filter(([k]) => !TEXT_ONLY_KEYS.includes(k)),
          ),
        }
      : spec;
    applySpec(node, ownSpec, tokens);
    applyPaintAttrs(node, el.attrs, reused);
    if (boxText) {
      // Text with a box (button, badge, pill): a flex frame that centers a text child.
      // Buttons center their label (UA behaviour); other boxes keep block flow and text-align.
      if (el.tag === "button" && !spec.has.has("layout")) {
        node.layout = "flex";
        if (!spec.has.has("alignItems")) node.alignItems = "center";
        if (!spec.has.has("justifyContent"))
          node.justifyContent =
            spec.props.textAlign === "left"
              ? "flex-start"
              : spec.props.textAlign === "right"
                ? "flex-end"
                : "center";
      }
      if (el.tag === "button" && !spec.has.has("fill") && !spec.has.has("gradient")) {
        node.color = "#25252e";
        if (!spec.has.has("ink"))
          node.textStyle = mergeStyle(node.textStyle, { color: "#ffffff", token: "" });
      }
    }
    applyGeometry(node, spec, parentNode, { isNew: true, warnings, label: where });
    applyResidual(node, el.attrs, { tokens, warnings, where });
    if (old) for (const key of LINK_KEYS) if (old[key] !== undefined) node[key] = clone(old[key]);
    applyComponentAttrs(node, el.attrs, { warnings, where, old, slots });
    if (typeof el.attrs["data-node-id"] === "string") batch.set(el.attrs["data-node-id"], node);
    nodes.push(node);
    if (boxText) {
      const text = {
        ...clone(NODE_DEFAULTS),
        id: randomUUID(),
        type: "text",
        parentId: node.id,
        name: "Label",
        color: TEXT_DEFAULTS.color,
        styleOwn: [],
      };
      const { text: content, runs } = collectText(el, { tokens });
      text.text = content;
      text.textRuns = runs;
      applySpec(
        text,
        {
          props: Object.fromEntries(
            TEXT_ONLY_KEYS.filter((k) => k in spec.props).map((k) => [k, spec.props[k]]),
          ),
          has: new Set(),
          ignored: [],
          warnings: [],
        },
        tokens,
      );
      applyGeometry(text, { props: {}, has: new Set() }, node, {
        isNew: true,
        warnings,
        label: where,
      });
      nodes.push(text);
    } else if (type === "frame") {
      for (const child of el.children) {
        if (child.text !== undefined) {
          if (child.text.trim())
            warnings.push(
              `Loose text "${child.text.trim().slice(0, 40)}" inside <${el.tag}> was wrapped in a text element`,
            );
          else continue;
          make({ tag: "p", attrs: {}, children: [child], selfClosing: false }, node, false);
          continue;
        }
        make(child, node, false);
      }
    }
    if (!parentNode && el) {
      const cw = Number(el.attrs["data-component-width"]),
        ch = Number(el.attrs["data-component-height"]);
      if (Number.isFinite(cw) && cw > 0 && !spec.w) {
        node.wMode = "fixed";
        node.w = cw;
      }
      if (Number.isFinite(ch) && ch > 0 && !spec.h) {
        node.hMode = "fixed";
        node.h = ch;
      }
      if (node.wMode === "hug") node._autoWidth = true;
      node._pos = {
        x: Number(el.attrs["data-component-x"]),
        y: Number(el.attrs["data-component-y"]),
      };
    }
    return node;
  };
  for (const el of elements) {
    const root = make(el, parent, true);
    if (root) roots.push(root);
  }
  return { roots, nodes, warnings, instances, slots, batch };
}

// ---------------------------------------------------------------------------------------------
// Components in JSX (web/component-core.js; attributes written by jsx-codec.mjs componentAttrs).
//   data-component="true"            the frame is a main component
//   data-instance-of="<main>"        a new element becomes an instance of the main (short id, long id or name);
//                                    descendants written as <div data-slot="Name">…</div> fill that slot
//   data-slot="<name>"               a frame inside a main is a slot
// Rewriting an existing node (replace) keeps its links; the shared sync then marks what changed as overrides.

const LINK_KEYS = ["component", "instanceOf", "sourceId", "overrides", "slot", "slotName"];
const linkRef = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const isMainNode = (node) => !!node && node.type === "frame" && node.component === true;
const isLinkedNode = (node) =>
  typeof node?.sourceId === "string" && !!node.sourceId && node.sourceId !== node.instanceOf;

/** The main component a data-instance-of value names: a main built in the same batch, a short or long id on the
 * page, a long id on another page, or a unique main name. */
export function resolveMain(document, page, ref, batch = null) {
  const fromBatch = batch?.get(ref);
  if (isMainNode(fromBatch)) return fromBatch;
  const onPage = indexPage(page).resolve(ref);
  if (isMainNode(onPage)) return onPage;
  const mains = document.pages.flatMap((p) => p.nodes.filter(isMainNode));
  const byId = mains.find((n) => n.id === ref);
  if (byId) return byId;
  const named = mains.filter((n) => String(n.name).trim().toLowerCase() === ref.toLowerCase());
  return named.length === 1 ? named[0] : null;
}
function refersTo(document, page, ref, mainId) {
  if (ref === mainId) return true;
  return resolveMain(document, page, ref)?.id === mainId;
}
const mainList = (document) =>
  document.pages
    .flatMap((p) => p.nodes.filter(isMainNode))
    .slice(0, 20)
    .map((n) => `"${n.name}"`)
    .join(", ") || "none";

/** Slot fills inside a new instance element: elements carrying data-slot (not data-slot-state="default"), searched
 * through the serialized structure; anything else written there is reported. */
function instanceContent(el) {
  const fills = [],
    stray = [];
  const walk = (children) => {
    for (const child of children) {
      if (child.text !== undefined) {
        if (child.text.trim()) stray.push(`"${child.text.trim().slice(0, 30)}"`);
        continue;
      }
      if (child.tag === "br") continue;
      if (Object.hasOwn(child.attrs, "data-slot")) {
        if (child.attrs["data-slot-state"] === "default") continue;
        const value = child.attrs["data-slot"];
        const name =
          typeof value === "string" && value.trim() && value.trim() !== "true"
            ? value.trim()
            : typeof child.attrs["data-node-label"] === "string"
              ? child.attrs["data-node-label"].trim()
              : "";
        fills.push({
          name,
          elements: child.children
            .filter((c) => c.tag || c.text?.trim())
            .map((c) => (c.tag ? c : { tag: "p", attrs: {}, children: [c], selfClosing: false })),
        });
        continue;
      }
      if (child.attrs["data-instance-of"] !== undefined) continue;
      // Copies serialized from an instance carry their ids; they come back from the main.
      if (typeof child.attrs["data-node-id"] !== "string") stray.push(`<${child.tag}>`);
      else walk(child.children);
    }
  };
  walk(el.children);
  return { fills, stray };
}

/** data-component / data-slot on a node being built (new or rewritten). */
function applyComponentAttrs(node, attrs, { warnings, where, old, slots }) {
  const comp = attrs["data-component"];
  if (comp === true || comp === "true" || comp === "") {
    if (node.type !== "frame")
      warnings.push(`data-component on ${where} ignored: only a frame can be a main component`);
    else if (isLinkedNode(node) || node.instanceOf) {
      if (!old)
        warnings.push(`data-component on ${where} ignored: an instance cannot be a main component`);
    } else node.component = true;
  } else if (comp === false || comp === "false") delete node.component;
  if (
    !Object.hasOwn(attrs, "data-slot") ||
    attrs["data-slot"] === false ||
    attrs["data-slot"] === "false"
  )
    return;
  if (node.type !== "frame") {
    warnings.push(`data-slot on ${where} ignored: only a frame can be a slot`);
    return;
  }
  const value = attrs["data-slot"];
  const name =
    typeof value === "string" && value.trim() !== "true" ? value.trim().slice(0, 100) : "";
  if (isLinkedNode(node)) return; // the copy of a slot inside an instance: set on the main
  const was = !!old?.slot;
  node.slot = true;
  if (name && name !== node.name) node.slotName = name;
  else if (name === node.name) delete node.slotName;
  if (!was) slots.push(node);
}

/**
 * Finish a built batch once its nodes are on the page: check new slots sit inside a main, then materialize each new
 * instance from its main (inner ones first), apply its label and classes as overrides and fill its slots.
 */
export function placeBuilt(document, page, built, warnings = []) {
  const parentOf = (node) => page.nodes.find((n) => n.id === node.parentId);
  for (const slot of built.slots || []) {
    let inMain = false;
    for (
      let cur = parentOf(slot), guard = 0;
      cur && guard < NODE_LIMITS.perPage;
      cur = parentOf(cur), guard++
    )
      if (isMainNode(cur)) {
        inMain = true;
        break;
      }
    if (!inMain) {
      delete slot.slot;
      delete slot.slotName;
      warnings.push(
        `data-slot on "${slot.name}" ignored: a slot must be inside a main component (data-component="true")`,
      );
    }
  }
  let pending = [...(built.instances || [])];
  while (pending.length) {
    const inside = (node) => {
      const seen = new Set();
      for (let cur = node; cur && !seen.has(cur); cur = parentOf(cur)) {
        seen.add(cur);
        if (isMainNode(cur)) return cur;
      }
      return null;
    };
    const blocked = new Set(pending.map(inside).filter(Boolean));
    const ready = pending.filter((ph) => {
      const main = resolveMain(document, page, ph._instance.ref, built.batch);
      return !main || !blocked.has(main);
    });
    if (!ready.length) throw new Error("A main component cannot contain an instance of itself");
    for (const ph of ready) materialize(document, page, ph, built.batch, warnings);
    pending = pending.filter((ph) => !ready.includes(ph));
  }
}

function materialize(document, page, ph, batch, warnings) {
  const info = ph._instance;
  delete ph._instance;
  const main = resolveMain(document, page, info.ref, batch);
  if (!main)
    throw new Error(
      `data-instance-of="${info.ref}": no main component with that id or name (mains: ${mainList(document)})`,
    );
  const at = page.nodes.indexOf(ph);
  page.nodes.splice(at, 1);
  try {
    createInstance(document, main.id, {
      pageId: page.id,
      parentId: ph.parentId || null,
      id: ph.id,
      x: Number.isFinite(ph.x) ? ph.x : 0,
      y: Number.isFinite(ph.y) ? ph.y : 0,
    });
  } catch (error) {
    page.nodes.splice(at, 0, ph);
    throw new Error(`data-instance-of="${info.ref}": ${error.message}`);
  }
  // Keep the placeholder object (callers hold it) and its place among its siblings.
  const created = page.nodes.find((n) => n.id === ph.id);
  page.nodes.splice(page.nodes.indexOf(created), 1);
  for (const key of Object.keys(ph)) if (!key.startsWith("_") && key !== "shortId") delete ph[key];
  Object.assign(ph, created);
  page.nodes.splice(at, 0, ph);
  const where = `instance of "${main.name}"`;
  const before = clone(ph);
  if (info.label && info.label !== main.name) ph.name = info.label;
  const cls = info.el.attrs.className ?? info.el.attrs.class;
  if (typeof cls === "string" && cls.trim()) {
    const spec = parseClasses(cls, { tokens: document.tokens || {} });
    if (spec.warnings.length)
      warnings.push(`Classes on ${where}: ${spec.warnings.slice(0, 12).join("; ")}`);
    applySpec(ph, spec, document.tokens);
    applyGeometry(ph, spec, page.nodes.find((n) => n.id === ph.parentId) || null, {
      isNew: false,
      warnings,
      label: where,
    });
  }
  const changed = [...new Set([...Object.keys(before), ...Object.keys(ph)])].filter(
    (key) =>
      !key.startsWith("_") &&
      !["x", "y", "id", "parentId", "shortId", ...LINK_KEYS].includes(key) &&
      JSON.stringify(before[key]) !== JSON.stringify(ph[key]),
  );
  if (changed.length)
    ph.overrides = [...new Set([...(ph.overrides || []), ...changed])].sort(byCodeUnit);
  if (info.stray.length)
    warnings.push(
      `${where}: ${info.stray.slice(0, 5).join(", ")} ignored; an instance's layers come from its main. Put per-instance content inside a slot: <div data-slot="Name">…</div>`,
    );
  const slots = componentInfo(document, ph.id)?.slots || [];
  for (const fill of info.fills) {
    const want = fill.name.toLowerCase();
    const slot =
      slots.find((s) => String(s.name).toLowerCase() === want) ||
      (slots.length === 1 && !want ? slots[0] : null);
    if (!slot) {
      warnings.push(
        `${where}: no slot named "${fill.name}" (slots: ${slots.map((s) => `"${s.name}"`).join(", ") || "none"}); its content was not added`,
      );
      continue;
    }
    const frame = page.nodes.find((n) => n.id === slot.id);
    for (const kid of page.nodes.filter((n) => n.parentId === frame.id)) removeSubtree(page, kid);
    frame.overrides = [...new Set([...(frame.overrides || []), "children"])].sort(byCodeUnit);
    const built = buildNodes(fill.elements, { document, page, parent: frame, warnings });
    page.nodes.push(...built.nodes);
    placeBuilt(document, page, built, warnings);
  }
}

function defaultName(type, el) {
  if (type === "text") {
    const t = el ? collectText(el).text.replace(/\s+/g, " ").trim().slice(0, 40).trim() : "";
    return t || "Text";
  }
  if (el && isSafeTag(el.tag) && el.tag !== "div") return el.tag[0].toUpperCase() + el.tag.slice(1);
  return (
    { frame: "Frame", rectangle: "Rectangle", image: "Image", shader: "Shader" }[type] || "Layer"
  );
}

/**
 * Recompute text inheritance and geometry for the artboards containing `nodes` (all artboards
 * when omitted). Flow children get x/y relative to their parent; hug/fill sizes are re-estimated.
 */
export function reflow(page, nodes = null, warnings = [], document = null) {
  const index = indexPage(page);
  cascadeText(page.nodes, index.byId);
  const roots = nodes
    ? new Set(nodes.filter(Boolean).map((n) => index.rootOf(index.byId.get(n.id) || n).id))
    : null;
  layoutPage(page, roots);
  // Artboards without a width: size to content once (capped), then keep that width fixed.
  // Artboards without a width hug their content; very wide content is capped at 1200px.
  const autos = page.nodes.filter((n) => n._autoWidth && delete n._autoWidth && n.w > 1200);
  for (const root of autos) {
    root.wMode = "fixed";
    root.w = 1200;
    warnings.push(
      `Artboard "${root.name}" has no width and its content is wider than 1200px; using 1200px. Add w-[…px] or data-component-width.`,
    );
  }
  if (autos.length) layoutPage(page, new Set(autos.map((n) => n.id)));
  refreshIcons(page, document || {});
  return warnings;
}

function nextArtboardX(page, self) {
  const existing = page.nodes.filter(
    (n) => !n.parentId && n !== self && Number.isFinite(n.x) && !n._placing,
  );
  if (!existing.length) return 0;
  return Math.ceil(Math.max(...existing.map((n) => n.x + n.w)) + 80);
}

// ---------------------------------------------------------------------------------------------
// Tree operations

export function removeSubtree(page, node) {
  const index = indexPage(page);
  const removed = new Set([node.id, ...index.descendants(node.id).map((n) => n.id)]);
  page.nodes = page.nodes.filter((n) => !removed.has(n.id));
  return removed;
}

/** Insert nodes (already parent-linked) relative to an anchor. */
export function insertNodes(page, newNodes, where) {
  let at = page.nodes.length;
  if (where.before) at = page.nodes.indexOf(where.before);
  else if (where.after) {
    at = page.nodes.indexOf(where.after) + 1;
  } else if (where.first) {
    const firstSibling = page.nodes.find((n) => (n.parentId || null) === (where.parentId || null));
    if (firstSibling) at = page.nodes.indexOf(firstSibling);
  }
  if (at < 0) at = page.nodes.length;
  page.nodes.splice(at, 0, ...newNodes);
}

function promoteToFrame(node) {
  if (node.type === "frame") return;
  if (node.type !== "rectangle")
    throw new Error(
      `Element is a ${node.type}; only frames (or empty rectangles) can contain children`,
    );
  node.type = "frame";
  if (!node.layout || node.layout === "free") node.layout = "block";
}

// ---------------------------------------------------------------------------------------------
// update_elements directive script

const DIRECTIVE =
  /\{?\s*\/\*\s*((?:edit|replace|delete|insert\s+as\s+(?:first|last)\s+child\s+of|insert\s+(?:before|after))\s+[A-Za-z0-9_.:-]+)\s*\*\/\s*\}?/gi;
export function parseDirectives(script) {
  if (typeof script !== "string" || !script.trim())
    throw new Error("edit must be a non-empty directive script");
  const matches = [...script.matchAll(DIRECTIVE)];
  if (!matches.length)
    throw new Error(
      "No directives found. Start each step with a comment such as {/* edit abc.def */}, {/* replace abc.def */}, {/* insert as last child of abc */}, {/* insert after abc.def */} or {/* delete abc.def */}.",
    );
  const leading = script.slice(0, matches[0].index).trim();
  if (leading) throw new Error("Unexpected content before the first directive");
  return matches.map((m, i) => {
    const header = m[1].replace(/\s+/g, " ").trim();
    const body = script
      .slice(m.index + m[0].length, i + 1 < matches.length ? matches[i + 1].index : script.length)
      .trim();
    const parts = header.split(" ");
    const target = parts.at(-1);
    const verb = parts[0].toLowerCase();
    const kind =
      verb === "insert"
        ? header.toLowerCase().includes("first child")
          ? "first"
          : header.toLowerCase().includes("last child")
            ? "last"
            : parts[1].toLowerCase()
        : verb;
    return { header, kind, target, body };
  });
}

/** Patch an existing node from an element (attributes, classes, text) and recurse into identified children. */
function editNode(document, page, node, el, warnings) {
  const index = indexPage(page);
  const iconTag = el.tag !== "Shader" && /^[A-Z]/.test(el.tag);
  const kind = el.tag === "Shader" ? "shader" : el.tag === "img" || iconTag ? "image" : null;
  if (kind && kind !== node.type)
    throw new Error(
      `Element ${index.shortId(node)} is a ${node.type}; use replace to change it into a ${kind}`,
    );
  if (iconTag !== !!node.icon && kind === "image")
    throw new Error(
      `Element ${index.shortId(node)} is ${node.icon ? 'an icon; edit it with <Icon name="…">' : "an image; edit it with <img>"} or use replace`,
    );
  if (typeof el.attrs["data-node-label"] === "string" && el.attrs["data-node-label"].trim())
    node.name = el.attrs["data-node-label"].trim().slice(0, 200);
  const cls = el.attrs.className ?? el.attrs.class;
  const textBefore = node.text,
    sizeBefore = node.fontSize;
  let spec = null;
  if (iconTag) {
    applyIconElement(node, el, document.tokens || {}, warnings, index.shortId(node), {
      isNew: false,
    });
  }
  if (typeof cls === "string") {
    spec = parseClasses(iconTag ? iconClasses(cls).className : cls, {
      tokens: document.tokens || {},
    });
    if (spec.warnings.length)
      warnings.push(`Classes on ${index.shortId(node)}: ${spec.warnings.slice(0, 12).join("; ")}`);
    applySpec(node, spec, document.tokens);
    const parent = node.parentId ? index.byId.get(node.parentId) : null;
    applyGeometry(node, spec, parent, { isNew: false, warnings, label: index.shortId(node) });
  }
  if (!node.parentId) {
    const cx = Number(el.attrs["data-component-x"]),
      cy = Number(el.attrs["data-component-y"]);
    if (Number.isFinite(cx)) node.x = cx;
    if (Number.isFinite(cy)) node.y = cy;
  }
  if (node.type === "image" && !node.icon && typeof el.attrs.src === "string") {
    const src = el.attrs.src.trim();
    if (isEmbeddedSrc(src)) {
      node.src = src;
      delete node.srcRemote;
      delete node.assetStatus;
    } else if (isRemoteSrc(src) && src !== node.srcRemote) {
      node.srcRemote = src;
      node.assetStatus = "pending";
      delete node.src;
    }
  }
  if (node.type === "image" && !node.icon) applySvgColor(node, el.attrs);
  applyPaintAttrs(node, el.attrs, { fills: node.fills });
  applyResidual(node, el.attrs, {
    tokens: document.tokens || {},
    warnings,
    where: index.shortId(node),
  });
  editComponentAttrs(document, page, node, el.attrs, index);
  if (node.type === "shader") applyShaderAttrs(node, el.attrs);
  if (node.type === "vector")
    return editVector(node, el, document.tokens || {}, warnings, index.shortId(node));
  if (node.type === "text") {
    if (el.children.length) {
      if (!isTextOnly(el))
        throw new Error(
          `Text element ${index.shortId(node)} can only contain text and inline tags (b, i, span, br)`,
        );
      const { text, runs } = collectText(el, { tokens: document.tokens || {} });
      node.text = text;
      node.textRuns = runs;
    }
    // Text grows with its content unless the edit pins a height (legacy nodes had baked heights).
    if (
      (node.text !== textBefore || node.fontSize !== sizeBefore) &&
      !(spec && spec.h) &&
      node.hMode !== "fill"
    )
      node.hMode = "hug";
    return;
  }
  for (const child of el.children) {
    if (child.text !== undefined) {
      if (child.text.trim())
        throw new Error(
          `Cannot put loose text inside ${node.type} ${index.shortId(node)}; edit a text child or insert one`,
        );
      continue;
    }
    const ref = child.attrs["data-node-id"];
    if (typeof ref !== "string")
      throw new Error(
        `Child <${child.tag}> inside an edit needs data-node-id; use "insert as last child of ${index.shortId(node)}" to add new elements`,
      );
    const target = index.require(ref);
    if (target.parentId !== node.id)
      throw new Error(`${ref} is not a direct child of ${index.shortId(node)}`);
    editNode(document, page, target, child, warnings);
  }
}

/** An edit of a vector (<svg data-vector …>): only the attributes it states change; <path> children replace the paths. */
function editVector(node, el, tokens, warnings, where) {
  if (el.tag !== "svg")
    throw new Error(`Element ${where} is a vector; edit it with <svg data-vector …>`);
  const v = vectorFromElement(el, { tokens, reused: node, warnings, where });
  const has = (...keys) => keys.some((k) => Object.hasOwn(el.attrs, k));
  if (el.children.some((c) => c.tag === "path")) {
    if (!v.paths.length) throw new Error(`${where}: a vector needs at least one <path d="…" />`);
    node.paths = v.paths;
  }
  if (has("viewBox") && v.viewBox) node.viewBox = v.viewBox;
  if (has("fill")) {
    if (v.fills) node.fills = [];
    else if (v.color) {
      delete node.fills;
      node.color = v.color;
      node.token = "";
    }
  }
  if (has("data-fill-token")) {
    node.token = v.token || "";
    if (v.color) node.color = v.color;
  }
  if (has("stroke", "strokeWidth", "stroke-width")) {
    const stroke = el.attrs.stroke,
      width = Number(el.attrs.strokeWidth ?? el.attrs["stroke-width"]);
    if (stroke === "none" || (has("strokeWidth", "stroke-width") && !(width > 0)))
      node.strokeWidth = 0;
    else {
      if (has("stroke") && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(String(stroke).trim())) {
        node.strokeColor = String(stroke).trim().toLowerCase();
        delete node.strokeToken;
      }
      if (width > 0) node.strokeWidth = width;
      else if (!(Number(node.strokeWidth) > 0)) node.strokeWidth = 1;
    }
  }
  if (has("data-stroke-token")) {
    if (el.attrs["data-stroke-token"]) {
      node.strokeToken = el.attrs["data-stroke-token"];
      if (tokens[node.strokeToken]) node.strokeColor = tokens[node.strokeToken];
    } else delete node.strokeToken;
  }
  for (const { attrs, key } of [
    { attrs: ["strokeLinecap", "stroke-linecap"], key: "strokeCap" },
    { attrs: ["strokeLinejoin", "stroke-linejoin"], key: "strokeJoin" },
    { attrs: ["strokeMiterlimit", "stroke-miterlimit"], key: "strokeMiter" },
    { attrs: ["strokeDasharray", "stroke-dasharray"], key: "strokeDash" },
    { attrs: ["data-stroke-hidden"], key: "strokeHidden" },
  ])
    if (has(...attrs)) {
      if (v[key] === undefined) delete node[key];
      else node[key] = v[key];
    }
}

/** Component attributes on an edit: patches only; links an edit cannot express are refused. */
function editComponentAttrs(document, page, node, attrs, index) {
  const ref = index.shortId(node);
  const instanceRef = linkRef(attrs["data-instance-of"]);
  if (instanceRef && !(node.instanceOf && refersTo(document, page, instanceRef, node.instanceOf)))
    throw new Error(
      node.instanceOf
        ? `${ref} is an instance of another main; an edit cannot re-point it (use replace, or detach_instance and create_instance)`
        : `${ref} is not an instance; insert <div data-instance-of="${instanceRef}" /> or call create_instance`,
    );
  const comp = attrs["data-component"];
  if ((comp === true || comp === "true" || comp === "") && !isMainNode(node))
    createComponent(document, page.id, node.id);
  else if ((comp === false || comp === "false") && isMainNode(node)) delete node.component;
  if (
    !Object.hasOwn(attrs, "data-slot") ||
    attrs["data-slot"] === false ||
    attrs["data-slot"] === "false" ||
    isLinkedNode(node)
  )
    return;
  if (node.type !== "frame")
    throw new Error(`${ref} is a ${node.type}; only a frame can be a slot`);
  if (!node.slot) {
    let inMain = false;
    for (const a of index.ancestors(node)) if (isMainNode(a)) inMain = true;
    if (!inMain || isMainNode(node) || node.instanceOf)
      throw new Error(`${ref} cannot be a slot: a slot is a frame inside a main component`);
    node.slot = true;
  }
  const value = attrs["data-slot"];
  const name =
    typeof value === "string" && value.trim() !== "true" ? value.trim().slice(0, 100) : "";
  if (name && name !== (node.slotName || node.name)) {
    if (name === node.name) delete node.slotName;
    else node.slotName = name;
  }
}

/** Where an edit lands relative to instances: notes for layers added to or removed from an instance outside its slots. */
function instanceNote(document, page, parent, verb) {
  if (!parent) return null;
  const info = componentInfo(document, parent.id);
  if (!info || (info.role !== "instance" && info.role !== "inherited")) return null;
  const index = indexPage(page);
  for (let cur = parent; cur; cur = cur.parentId ? index.byId.get(cur.parentId) : null) {
    if (cur.slot === true) return null;
    if (cur.id === info.instanceId) break;
  }
  const root = index.byId.get(info.instanceId);
  return verb === "delete"
    ? `${index.shortId(parent)} is inherited from main component "${info.mainName || info.mainId}" in instance ${root ? index.shortId(root) : info.instanceId}: deleting it hides it in this instance only (an override; reset_overrides brings it back). Edit the main to remove it everywhere.`
    : `${index.shortId(parent)} is an inherited part of instance ${root ? index.shortId(root) : info.instanceId} (main component "${info.mainName || info.mainId}"): the new layers exist in this instance only. For per-instance content, make a frame of the main a slot (set_slot) and insert into the instance's slot; to change every instance, edit the main.`;
}

export function applyDirective(document, page, directive, warnings = [], notes = []) {
  const index = indexPage(page);
  const target = index.require(directive.target);
  if (directive.kind === "delete") {
    if (directive.body) throw new Error("delete takes no JSX body");
    if (isLinkedNode(target)) {
      const note = instanceNote(document, page, target, "delete");
      if (note) notes.push(note);
    }
    const parent = target.parentId ? index.byId.get(target.parentId) : null;
    const removed = removeSubtree(page, target);
    return { removed: [...removed].length, affected: [], reflow: parent ? [parent] : [] };
  }
  const { elements } = parseJsx(directive.body);
  if (!elements.length)
    throw new Error(`${directive.kind} needs a JSX element after the directive`);
  if (directive.kind === "edit") {
    if (elements.length !== 1) throw new Error("edit takes exactly one element");
    editNode(document, page, target, elements[0], warnings);
    return { affected: [target] };
  }
  if (directive.kind === "replace") {
    if (elements.length !== 1) throw new Error("replace takes exactly one element");
    const oldNodes = [target, ...index.descendants(target.id)];
    const oldById = new Map(oldNodes.map((n) => [n.id, n]));
    const used = new Set();
    const reuse = (ref) => {
      const found = index.resolve(ref);
      if (!found || !oldById.has(found.id) || found.id === target.id || used.has(found.id))
        return null;
      used.add(found.id);
      return found;
    };
    const parent = target.parentId ? index.byId.get(target.parentId) : null;
    const position = page.nodes.indexOf(target);
    const built = buildNodes(elements, {
      document,
      page,
      parent,
      warnings,
      keepRootId: { id: target.id, shortId: target.shortId, node: target },
      reuse,
    });
    const { roots, nodes } = built;
    const root = roots[0];
    if (!root) throw new Error("Replacement produced no element");
    if (!parent) {
      delete root._autoWidth;
      if (root.wMode === "hug") {
        root.wMode = "fixed";
        root.w = target.w;
      }
      const cx = Number(elements[0].attrs["data-component-x"]),
        cy = Number(elements[0].attrs["data-component-y"]);
      root.x = Number.isFinite(cx) ? cx : target.x;
      root.y = Number.isFinite(cy) ? cy : target.y;
    } else if (!parent.layout || parent.layout === "free") {
      const spec = parseClasses(elements[0].attrs.className ?? "", {
        tokens: document.tokens || {},
      });
      if (spec.left === undefined) root.x = target.x;
      if (spec.top === undefined) root.y = target.y;
    }
    const before = page.nodes.slice(0, position).filter((n) => !oldById.has(n.id)).length;
    page.nodes = page.nodes.filter((n) => !oldById.has(n.id));
    page.nodes.splice(before, 0, ...nodes);
    placeBuilt(document, page, built, warnings);
    return { affected: [root], replaced: oldNodes.length };
  }
  // insert
  let parent, where;
  if (directive.kind === "first" || directive.kind === "last") {
    parent = target;
    promoteToFrame(parent);
    where = { parentId: parent.id, [directive.kind]: true };
  } else {
    parent = target.parentId ? index.byId.get(target.parentId) : null;
    where = { [directive.kind]: target };
  }
  const built = buildNodes(elements, { document, page, parent, warnings });
  const { roots, nodes } = built;
  if (!parent)
    for (const root of roots) {
      root._placing = true;
    }
  insertNodes(page, nodes, where);
  placeBuilt(document, page, built, warnings);
  const note = instanceNote(document, page, parent, "insert");
  if (note) notes.push(note);
  return { affected: roots, place: parent ? [] : roots };
}

export function runDirectives(document, pageId, script) {
  const directives = parseDirectives(script);
  let working = clone(document);
  ensureShortIds(working);
  const report = [];
  let applied = 0;
  directives.forEach((directive, i) => {
    const attempt = clone(working);
    const warnings = [],
      notes = [];
    try {
      const page = getPage(attempt, pageId);
      const result = applyDirective(attempt, page, directive, warnings, notes);
      const touched = [...result.affected, ...(result.reflow || [])].map((n) => n.id);
      reflow(
        page,
        touched.map((id) => page.nodes.find((n) => n.id === id)).filter(Boolean),
        warnings,
        attempt,
      );
      for (const root of result.place || []) {
        const pos = root._pos || {};
        delete root._placing;
        delete root._pos;
        root.x = Number.isFinite(pos.x) ? pos.x : nextArtboardX(page, root);
        root.y = Number.isFinite(pos.y) ? pos.y : 0;
      }
      for (const n of page.nodes) delete n._pos;
      ensureShortIds(attempt);
      const freshPage = getPage(attempt, pageId);
      const index = indexPage(freshPage);
      const code = result.affected
        .map((node) => elementCode(attempt, freshPage, index.byId.get(node.id), 3))
        .join("\n");
      working = attempt;
      applied++;
      report.push(
        `OK ${i + 1}. ${directive.header}${result.removed ? ` (removed ${result.removed} element${result.removed === 1 ? "" : "s"})` : ""}${warnings.length ? `\n  warnings: ${warnings.join("; ")}` : ""}${notes.length ? `\n  notes: ${notes.join("; ")}` : ""}${code ? `\n${code}` : ""}`,
      );
    } catch (error) {
      report.push(
        `FAIL ${i + 1}. ${directive.header}: ${error instanceof JsxSyntaxError ? "JSX syntax error: " : ""}${error.message}`,
      );
    }
  });
  const failed = directives.length - applied;
  report.push(
    `${applied} of ${directives.length} directives applied.${failed ? ` ${failed} failed.` : ""}`,
  );
  return { document: working, applied, failed, report: report.join("\n\n") };
}

// ---------------------------------------------------------------------------------------------
// Higher-level operations shared by the tools

export function preflightImportNodes(document, pageId, incoming) {
  const page = getPage(document, pageId);
  const existing = page.nodes.length;
  const total = document.pages.reduce((sum, p) => sum + p.nodes.length, 0);
  const { perPage: pageLimit, perDocument: documentLimit } = NODE_LIMITS;
  if (existing + incoming > pageLimit || total + incoming > documentLimit)
    throw new Error(
      `${existing + incoming > pageLimit ? nodeLimitMessage(existing + incoming, pageLimit, page.name ?? page.id) : nodeLimitMessage(total + incoming, documentLimit)} Import node preflight: page existing=${existing}, incoming=${incoming}, limit=${pageLimit}; document existing=${total}, incoming=${incoming}, limit=${documentLimit}. Nothing was imported; import into another page or split the source into smaller artboards.`,
    );
}

export function createArtboards(
  document,
  pageId,
  code,
  { viewport = null, name, placement = "preserve", importNames = false, split = "none" } = {},
) {
  const doc = clone(document);
  ensureShortIds(doc);
  const page = getPage(doc, pageId);
  const { elements, imports } = parseJsx(code);
  if (!elements.length) throw new Error("code must contain at least one root element");
  if (importNames)
    for (const el of elements)
      if (!el.attrs["data-node-label"] && !el.attrs["data-name"])
        el.attrs["data-node-label"] = "Imported page";
  const warnings = imports.length
    ? [
        `Import lines were ignored (${imports.length}); icon components (<Icon name="lucide:…"/>, <ArrowRight/>, <LuX/>, <IconBrandGithub/>) are resolved by name from the bundled lucide, tabler and phosphor sets`,
      ]
    : [];
  const built = buildNodes(elements, { document: doc, page, parent: null, warnings, viewport });
  const { roots, nodes } = built;
  if (!roots.length) throw new Error("No supported elements were found in code");
  const positions = new Map(roots.map((root) => [root, root._pos || {}]));
  for (const root of roots) {
    root._placing = true;
    delete root._pos;
  }
  page.nodes.push(...nodes);
  placeBuilt(doc, page, built, warnings);
  const incoming = page.nodes.length - getPage(document, pageId).nodes.length;
  if (split !== "pages") preflightImportNodes(document, pageId, incoming);
  const assignments = distributeImport(
    doc,
    page,
    getPage(document, pageId).nodes.length,
    roots,
    split,
  );
  for (const destination of new Set(assignments.map((a) => a.page)))
    reflow(
      destination,
      assignments.filter((a) => a.page === destination).map((a) => a.root),
      warnings,
      doc,
    );
  for (const { root, page } of assignments) {
    const { x, y } = positions.get(root) || {};
    delete root._placing;
    root.x = placement === "preserve" && Number.isFinite(x) ? x : nextArtboardX(page, root);
    root.y = placement === "preserve" && Number.isFinite(y) ? y : 0;
    if (name) root.name = name;
    if (root.name === "Imported page") {
      let n = 1;
      while (page.nodes.some((other) => other !== root && other.name === `Imported page ${n}`)) n++;
      root.name = `Imported page ${n}`;
    }
  }
  ensureShortIds(doc);
  return {
    document: doc,
    roots,
    pages: importPageReport(assignments),
    warnings,
    page: getPage(doc, pageId),
  };
}

/**
 * Wrap sibling elements in a new frame in place (create_component on several layers). The frame takes the first
 * element's place; in a free parent (or on the page) it spans their bounds, in a flow parent it flows like them.
 * Mutates `document` and returns the frame.
 */
export function wrapElements(document, pageId, refs, { label = "Component" } = {}) {
  const page = getPage(document, pageId),
    index = indexPage(page);
  const targets = [...new Set(refs.map((ref) => index.require(ref)))];
  const parentId = targets[0].parentId || null;
  if (targets.some((n) => (n.parentId || null) !== parentId))
    throw new Error("Elements to wrap must share one parent");
  if (targets.some((n) => isLinkedNode(n)))
    throw new Error(
      "Layers inherited from a main component cannot be wrapped; edit the main or detach the instance",
    );
  const parent = parentId ? index.byId.get(parentId) : null;
  targets.sort((a, b) => page.nodes.indexOf(a) - page.nodes.indexOf(b));
  const flow = !!parent && parent.layout && parent.layout !== "free";
  const frame = {
    ...clone(NODE_DEFAULTS),
    id: randomUUID(),
    type: "frame",
    parentId,
    name: String(label).slice(0, 200),
    color: "transparent",
    layout: "free",
  };
  if (flow) {
    Object.assign(frame, {
      layout: "flex",
      direction: parent.layout === "flex" && isFlexRow(parent) ? "row" : "column",
      gap: parent.gap || 0,
      alignItems: "flex-start",
      wMode: "hug",
      hMode: "hug",
    });
  } else {
    const x0 = Math.min(...targets.map((n) => n.x || 0)),
      y0 = Math.min(...targets.map((n) => n.y || 0));
    Object.assign(frame, {
      x: x0,
      y: y0,
      w: Math.max(1, Math.max(...targets.map((n) => (n.x || 0) + (n.w || 0))) - x0),
      h: Math.max(1, Math.max(...targets.map((n) => (n.y || 0) + (n.h || 0))) - y0),
    });
    for (const n of targets) {
      n.x = (n.x || 0) - x0;
      n.y = (n.y || 0) - y0;
    }
  }
  page.nodes.splice(page.nodes.indexOf(targets[0]), 0, frame);
  for (const n of targets) n.parentId = frame.id;
  if (flow) reflow(page, [frame], [], document);
  ensureShortIds(document);
  return frame;
}

export function duplicateElements(
  document,
  pageId,
  ref,
  { count = 1, newArtboard, label, className } = {},
) {
  const doc = clone(document);
  ensureShortIds(doc);
  const page = getPage(doc, pageId);
  const index = indexPage(page);
  const source = index.require(ref);
  const isRoot = !source.parentId;
  const asArtboard = newArtboard ?? isRoot;
  const subtree = [source, ...index.descendants(source.id)];
  const created = [];
  const warnings = [];
  let anchor = source;
  for (let copyIndex = 0; copyIndex < count; copyIndex++) {
    const ids = new Map(subtree.map((n) => [n.id, randomUUID()]));
    const copies = subtree.map((n) => {
      const c = clone(n);
      c.id = ids.get(n.id);
      delete c.shortId;
      c.parentId = n.id === source.id ? (asArtboard ? null : n.parentId) : ids.get(n.parentId);
      return c;
    });
    // A copy of a main is an instance of it; a copy of an instance keeps its overrides and slot content.
    adoptCopies(doc, copies, ids);
    const root = copies[0];
    const linked = typeof root.instanceOf === "string" && !!root.instanceOf;
    const plain = linked ? clone(root) : null;
    if (asArtboard) {
      const absolute = (() => {
        let x = source.x,
          y = source.y,
          cur = source;
        while (cur.parentId) {
          cur = index.byId.get(cur.parentId);
          x += cur.x;
          y += cur.y;
        }
        return { x, y };
      })();
      const right = Math.max(
        ...page.nodes.filter((n) => !n.parentId).map((n) => n.x + n.w),
        absolute.x + source.w,
      );
      root.x = Math.ceil(right + 80);
      root.y = absolute.y;
      if (!isRoot) {
        root.wMode = "fixed";
        root.w = source.w;
        if (root.hMode === "fill") root.hMode = "fixed";
        delete root.wPct;
        delete root.hPct;
        delete root.position;
        delete root.inset;
        delete root.translate;
        delete root.margin;
      }
      page.nodes.push(...copies);
    } else {
      const parent = source.parentId ? index.byId.get(source.parentId) : null;
      if (!parent || parent.layout === "free") {
        root.x = source.x + 20 * (copyIndex + 1);
        root.y = source.y + 20 * (copyIndex + 1);
      }
      insertNodes(page, copies, { after: anchor });
      anchor = root;
    }
    if (label) root.name = String(label).slice(0, 200);
    else if (asArtboard) root.name = `${source.name} copy${count > 1 ? " " + (copyIndex + 1) : ""}`;
    if (className) {
      const spec = parseClasses(className, { tokens: doc.tokens || {} });
      applySpec(root, spec, doc.tokens);
      applyGeometry(root, spec, root.parentId ? index.byId.get(root.parentId) : null, {
        isNew: false,
        warnings,
        label: root.name,
      });
    }
    if (linked) {
      // What this call changed on an instance root is the copy's own (the sync would copy the main back otherwise);
      // the default "copy" label follows the main like any duplicate.
      const keep = new Set([
        "x",
        "y",
        "id",
        "parentId",
        "shortId",
        ...LINK_KEYS,
        ...(label ? [] : ["name"]),
      ]);
      const changed = [...new Set([...Object.keys(plain), ...Object.keys(root)])].filter(
        (key) => !keep.has(key) && JSON.stringify(plain[key]) !== JSON.stringify(root[key]),
      );
      if (changed.length)
        root.overrides = [...new Set([...(root.overrides || []), ...changed])].sort(byCodeUnit);
    }
    created.push(root);
  }
  reflow(page, created, [], doc);
  ensureShortIds(doc);
  const fresh = indexPage(getPage(doc, pageId));
  return {
    document: doc,
    created: created.map((n) => fresh.byId.get(n.id)),
    page: getPage(doc, pageId),
    warnings,
  };
}

// ---------------------------------------------------------------------------------------------
// Design tokens. Verynize stores color variables as `tokens: {name: '#rrggbb'}`; tools expose
// them Wonder-style with slash-separated names and a CSS variable.

export function describeTokens(document) {
  return Object.entries(document.tokens || {}).map(([name, value]) => ({
    id: name,
    name,
    type: "color",
    value,
    cssVar: `var(${cssVarForToken(name)})`,
    ...(document.aliases?.[name] ? { aliasOf: document.aliases[name] } : {}),
  }));
}
export function tokenColor(value) {
  // Opaque colors become #rrggbb; translucent ones keep their alpha as #rrggbbaa.
  const exact = typeof value === "string" ? cssColorToHex(value.trim().toLowerCase()) : null;
  const color =
    exact && exact !== "transparent" && exact.length === 9 ? exact : normalizeColor(value);
  if (!color || color === "transparent")
    throw new Error(`Token value ${JSON.stringify(value)} must be a hex or rgb() color`);
  return color;
}
const RESERVED = new Set(["__proto__", "prototype", "constructor"]);
export function checkTokenName(name) {
  if (
    typeof name !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_./ -]{0,99}$/.test(name) ||
    RESERVED.has(name)
  )
    throw new Error(
      `Invalid token name ${JSON.stringify(name)}; use letters, digits, "-", "_", "." and "/" (e.g. color/text/primary)`,
    );
  return name;
}
export function renameTokenRefs(document, from, to) {
  renamePaintTokens(document, from, to);
  for (const page of document.pages)
    for (const node of page.nodes) {
      if (node.token === from) node.token = to;
      if (node.svgColorToken === from) node.svgColorToken = to;
    }
  renameAliasRefs(document, from, to);
}
export function unbindToken(document, name) {
  unbindPaintTokens(document, name);
  dropAliases(document, name);
  const value = document.tokens[name];
  for (const page of document.pages)
    for (const node of page.nodes) {
      if (node.token === name) {
        node.color = value;
        node.token = "";
      }
      if (node.svgColorToken === name) {
        node.svgColor = value;
        delete node.svgColorToken;
      }
    }
}
export function syncTokenColors(document) {
  syncPaintTokens(document);
  syncAliases(document);
  for (const page of document.pages)
    for (const node of page.nodes) {
      if (node.token && document.tokens[node.token]) node.color = document.tokens[node.token];
      if (node.svgColorToken && document.tokens[node.svgColorToken])
        node.svgColor = document.tokens[node.svgColorToken];
    }
  syncVariables(document);
}

// ---------------------------------------------------------------------------------------------
// Typed variables (dimension / number / fontFamily / fontWeight; see design-store.mjs). Bound layer
// properties hold the resolved value; syncVariables re-applies variable values after every write.

/** Value a variable gives to a layer property, or undefined when the binding cannot apply. */
export function variableValueFor(document, key, name, node) {
  const variable = document.variables?.[name];
  if (
    !variable ||
    !BINDABLE[key]?.includes(variable.type) ||
    !checkVariableValue(variable.type, variable.value)
  )
    return undefined;
  return boundValue(variable, key, node);
}
export function syncVariables(document) {
  if (!document.variables) return document;
  syncAliases(document);
  for (const page of document.pages)
    for (const node of page.nodes)
      for (const key of bindingOrder(node.bindings)) {
        const value = variableValueFor(document, key, node.bindings[key], node);
        if (value !== undefined) writeBoundValue(node, key, value);
      }
  return document;
}
/** Remove every binding to `name`; layers keep the current resolved value. */
export function unbindVariable(document, name) {
  dropAliases(document, name);
  for (const page of document.pages)
    for (const node of page.nodes)
      if (node.bindings) {
        for (const [key, bound] of Object.entries(node.bindings))
          if (bound === name) delete node.bindings[key];
        if (!Object.keys(node.bindings).length) delete node.bindings;
      }
  return document;
}
export function renameVariableRefs(document, from, to) {
  for (const page of document.pages)
    for (const node of page.nodes)
      for (const key of Object.keys(node.bindings || {}))
        if (node.bindings[key] === from) node.bindings[key] = to;
  return renameAliasRefs(document, from, to);
}
export function describeVariables(document) {
  return Object.entries(document.variables || {}).map(([name, v]) => ({
    id: name,
    name,
    type: v.type,
    value: v.value,
    cssVar: `var(${cssVarForToken(name)})`,
    ...(document.aliases?.[name] ? { aliasOf: document.aliases[name] } : {}),
  }));
}
/** CSS custom properties for color tokens and typed variables (`:root { --name: value; }`). */
export function variablesCss(document) {
  const lines = [];
  const names = new Map();
  const add = (name, value) => {
    const identifier = cssVarForToken(name);
    if (names.has(identifier))
      throw new Error(
        `Variables “${names.get(identifier)}” and “${name}” both export as ${identifier}. Rename one before exporting CSS.`,
      );
    names.set(identifier, name);
    lines.push(`  ${identifier}: ${value};`);
  };
  for (const [name, value] of Object.entries(document.tokens || {})) add(name, value);
  for (const [name, v] of Object.entries(document.variables || {})) {
    if (!checkVariableValue(v.type, v.value)) continue;
    const value =
      v.type === "dimension"
        ? `${v.value}px`
        : v.type === "fontFamily"
          ? /^[a-zA-Z-]+$/.test(v.value.trim())
            ? v.value.trim()
            : `'${v.value.trim().replace(/['\\]/g, "")}'`
          : String(v.value);
    add(name, value);
  }
  return lines.length ? `:root {\n${lines.join("\n")}\n}\n` : "";
}
