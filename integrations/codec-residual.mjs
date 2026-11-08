// Lossless side channel for the JSX codec. Tailwind classes describe what a layer looks like, but some
// layer state has no class: hidden effects, the variable a shadow colour or padding is bound to, the
// order of filters, overlapping text ranges, lock state, artboard preview settings. The serializer
// writes that state as one JSON attribute, data-vn='{…}', and the parser restores it.
//
// Classes stay authoritative. Every restorable group carries a visual signature: the importer
// compares the signature of the layer built from the classes with the signature the stored state
// would produce, and restores the group only when they agree. When an agent (or a person) edits the
// classes, the stale side-channel group is dropped and the classes win.
import { effectsOf } from "./node-style.mjs";
import { normalizeColorsIn } from "./codec-css.mjs";
import { CORNER_KEYS, PADDING_AXES } from "./variables.mjs";
import { shaderError } from "./shaders.mjs";

export const RESIDUAL_ATTR = "data-vn";
const NODE_KEEP = new Set(["id", "parentId", "shortId"]);

const norm = (value) =>
  normalizeColorsIn(String(value || ""))
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
const list = (value) => (Array.isArray(value) && value.length ? value : null);

// --- signatures --------------------------------------------------------------------------------

function shadowSig(node, tokens) {
  const fx = effectsOf(node, tokens);
  return [
    norm([...fx.boxShadow, node.shadow].filter(Boolean).join(", ")),
    norm(fx.drop.join(" ")),
    norm(fx.textShadow.join(", ")),
  ].join("|");
}
function filterSig(node, tokens) {
  const fx = effectsOf(node, tokens);
  return `${norm(fx.filter.join(" "))}|${norm(fx.backdrop.join(" "))}`;
}
// A hidden border / outline (the inspector's eye) writes no classes: restore it only while the classes
// draw no border / outline either.
const STROKE_KEYS = [
  "strokeWidth",
  "strokeWidths",
  "strokeColor",
  "strokeColors",
  "strokeToken",
  "strokeStyle",
  "strokeHidden",
  "strokeHiddenSides",
];
const OUTLINE_KEYS = [
  "outlineWidth",
  "outlineOffset",
  "outlineColor",
  "outlineStyle",
  "outlineToken",
  "outlineHidden",
];
function borderSig(node) {
  if (node.strokeHidden === true) return "0,0,0,0";
  const hidden = Array.isArray(node.strokeHiddenSides) ? node.strokeHiddenSides : [];
  const widths =
    Array.isArray(node.strokeWidths) && node.strokeWidths.length === 4
      ? node.strokeWidths.map((v, i) => (hidden[i] === true ? 0 : v))
      : Array(4).fill(node.strokeWidth);
  return widths.map((v) => Math.max(0, Number(v) || 0)).join(",");
}
function outlineSig(node, tokens) {
  return JSON.stringify(effectsOf(node, tokens).outline);
}
function maskSig(node, tokens) {
  const fx = effectsOf(node, tokens);
  return norm([...fx.masks, node.mask].filter(Boolean).join(", "));
}

/** Text ranges flattened to non-overlapping segments with their effective style (the visual result). */
export function canonicalRuns(text, runs) {
  const length = String(text || "").length;
  const all = Array.isArray(runs) ? runs : [];
  const points = [...new Set([0, length, ...all.flatMap((r) => [r.start, r.end])])]
    .filter((p) => p >= 0 && p <= length)
    .sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1],
      active = all.filter((r) => r.start <= a && r.end >= b);
    const style = {
      bold: active.some((r) => r.bold),
      italic: active.some((r) => r.italic),
      color: active.findLast((r) => r.color)?.color?.toLowerCase() ?? null,
      fontSize: active.findLast((r) => r.fontSize)?.fontSize ?? null,
    };
    const last = out.at(-1);
    if (
      last &&
      last.bold === style.bold &&
      last.italic === style.italic &&
      last.color === style.color &&
      last.fontSize === style.fontSize
    )
      last.end = b;
    else out.push({ start: a, end: b, ...style });
  }
  return JSON.stringify(out.filter((s) => s.bold || s.italic || s.color || s.fontSize));
}

// Bound layer fields (see writeBoundValue in variables.mjs): the value a binding currently drives.
function boundField(node, key) {
  const corner = CORNER_KEYS.indexOf(key);
  if (corner >= 0) return Array.isArray(node.cornerRadii) ? node.cornerRadii[corner] : node.radius;
  if (PADDING_AXES[key]) return PADDING_AXES[key].map((side) => node[side] ?? node.padding);
  return node[key];
}
const boundValues = (node, bindings) =>
  Object.fromEntries(Object.keys(bindings).map((key) => [key, boundField(node, key)]));
const sameValue = (a, b) =>
  JSON.stringify(a) === JSON.stringify(b) ||
  (Number.isFinite(Number(a)) &&
    Number.isFinite(Number(b)) &&
    typeof a !== "object" &&
    Math.abs(Number(a) - Number(b)) < 1e-6);

// Layer state that only matters while another setting is active (grid columns of a flex frame…). The
// inspector keeps it so switching back restores it; classes cannot carry it.
const DORMANT = [
  [
    "columns",
    (n) => n.type === "frame" && n.layout !== "grid" && n.columns !== undefined && n.columns !== 2,
  ],
  ["rows", (n) => n.type === "frame" && n.layout !== "grid" && n.rows !== undefined],
  ["columnSizes", (n) => n.type === "frame" && n.layout !== "grid" && n.columnSizes !== undefined],
  [
    "rowSizes",
    (n) =>
      n.type === "frame" &&
      (n.layout !== "grid" || !(Number(n.rows) >= 1)) &&
      n.rowSizes !== undefined,
  ],
  [
    "direction",
    (n) =>
      n.type === "frame" &&
      n.layout !== "flex" &&
      n.direction !== undefined &&
      n.direction !== "row",
  ],
  ["reverse", (n) => n.type === "frame" && n.layout !== "flex" && n.reverse !== undefined],
  ["flexWrap", (n) => n.type === "frame" && n.layout !== "flex" && n.flexWrap !== undefined],
  [
    "alignItems",
    (n) =>
      n.type === "frame" &&
      n.layout !== "flex" &&
      n.layout !== "grid" &&
      n.alignItems !== undefined &&
      n.alignItems !== "stretch",
  ],
  [
    "justifyContent",
    (n) =>
      n.type === "frame" &&
      n.layout !== "flex" &&
      n.layout !== "grid" &&
      n.justifyContent !== undefined &&
      n.justifyContent !== "flex-start",
  ],
  [
    "justifyItems",
    (n) => n.type === "frame" && n.layout !== "grid" && n.justifyItems !== undefined,
  ],
  [
    "gap",
    (n) => n.type === "frame" && n.layout === "free" && Number(n.gap) !== 0 && n.gap !== undefined,
  ],
  ["gapX", (n) => n.type === "frame" && n.layout === "free" && n.gapX !== undefined],
  ["gapY", (n) => n.type === "frame" && n.layout === "free" && n.gapY !== undefined],
  [
    "padding",
    (n) =>
      n.type === "frame" &&
      n.layout === "free" &&
      Number(n.padding) !== 0 &&
      n.padding !== undefined,
  ],
  ...["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"].map((key) => [
    key,
    (n) => n.type === "frame" && n.layout === "free" && n[key] !== undefined,
  ]),
  // Per-corner radii win over `radius`; a stale uniform value is kept for when the corners are reset.
  [
    "radius",
    (n) =>
      Array.isArray(n.cornerRadii) &&
      n.cornerRadii.length === 4 &&
      Number(n.radius) !== Math.max(...n.cornerRadii.map(Number)),
  ],
];
const BOX = ["x", "y", "w", "h"];
// Shader mode (shaderFill) and the shader settings of a non-shader layer have no class; Shader layers write
// them as JSX attributes instead (shaders.mjs). Values equal to the node defaults are left out.
const SHADER_KEYS = [
  "shaderFill",
  "shaderPreset",
  "shaderSpeed",
  "shaderIntensity",
  "shaderColors",
  "shaderParams",
];
const SHADER_DEFAULTS = {
  shaderFill: false,
  shaderPreset: "aurora",
  shaderSpeed: 1,
  shaderIntensity: 1,
};

// --- write ---------------------------------------------------------------------------------------

/** Side-channel state for one layer, or null when the classes and attributes already say everything. */
export function residualOf(node) {
  const r = {};
  if (list(node.shadows)) {
    r.shadows = node.shadows;
    if (node.shadow) r.shadow = node.shadow;
  }
  if (list(node.filters)) r.filters = node.filters;
  if (list(node.masks)) {
    r.masks = node.masks;
    if (node.mask) r.mask = node.mask;
  }
  for (const [flag, keys] of [
    ["strokeHidden", STROKE_KEYS],
    ["strokeHiddenSides", STROKE_KEYS],
    ["outlineHidden", OUTLINE_KEYS],
  ])
    if (node[flag] === true || (Array.isArray(node[flag]) && node[flag].includes(true)))
      for (const key of keys) if (node[key] !== undefined) r[key] = node[key];
  if (node.bindings && typeof node.bindings === "object" && Object.keys(node.bindings).length) {
    r.bindings = node.bindings;
    r.bound = boundValues(node, node.bindings);
  }
  if (Array.isArray(node.textRuns) && node.textRuns.length) r.textRuns = node.textRuns;
  if (node.locked === true) r.locked = true;
  // Grid "Automatic positioning" off has no class (it changes no CSS).
  if (node.type === "frame" && node.autoPosition === false) r.autoPosition = false;
  // "Hide label" on a top-level frame (canvas context menu) has no class either.
  if (node.type === "frame" && !node.parentId && node.labelHidden === true) r.labelHidden = true;
  if (node.preview && typeof node.preview === "object" && !node.parentId) r.preview = node.preview;
  const name = typeof node.name === "string" ? node.name : "";
  if (name && (name !== name.trim() || name.length > 200)) r.name = name;
  for (const [key, dormant] of DORMANT) if (dormant(node)) r[key] = node[key];
  if (node.type !== "shader")
    for (const key of SHADER_KEYS)
      if (node[key] !== undefined && node[key] !== SHADER_DEFAULTS[key]) r[key] = node[key];
  // Hidden layers are skipped by layout, so their last geometry cannot be recomputed on import.
  if (node.hidden === true && node.parentId) r.box = BOX.map((key) => node[key]);
  return Object.keys(r).length ? r : null;
}

const escapeSingle = (text) =>
  String(text).replace(
    /[&'<>]/g,
    (c) => ({ "&": "&amp;", "'": "&#39;", "<": "&lt;", ">": "&gt;" })[c],
  );
/** The data-vn attribute for a layer ('' when nothing needs saying). */
export function residualAttr(node) {
  const r = residualOf(node);
  return r ? `${RESIDUAL_ATTR}='${escapeSingle(JSON.stringify(r))}'` : "";
}

// --- read ----------------------------------------------------------------------------------------

/** Parse a data-vn attribute value (string or object). Returns null when absent; throws on bad JSON. */
export function readResidual(value) {
  if (value === undefined || value === null || value === "" || value === true) return null;
  if (typeof value === "object") return value;
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    throw new Error(`${RESIDUAL_ATTR} must be a JSON object`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${RESIDUAL_ATTR} must be a JSON object`);
  return parsed;
}

/**
 * Restore side-channel state onto a node the classes have just been applied to. Groups whose visual
 * signature disagrees with the classes are skipped (and reported) — the classes were edited.
 */
export function applyResidual(node, attrs, { tokens = {}, warnings = [], where = "" } = {}) {
  const r = readResidual(attrs?.[RESIDUAL_ATTR]);
  if (!r) return node;
  if (r.node && typeof r.node === "object" && !Array.isArray(r.node)) {
    // A whole layer exported by Verynize whose CSS is unchanged (codec-html.mjs checks the signature).
    for (const key of Object.keys(node)) if (!NODE_KEEP.has(key)) delete node[key];
    for (const [key, value] of Object.entries(r.node))
      if (!NODE_KEEP.has(key)) node[key] = structuredClone(value);
    return node;
  }
  const stale = [];
  const group = (keys, sig) => {
    const next = { ...node };
    for (const key of keys) {
      if (r[key] === undefined) delete next[key];
      else next[key] = structuredClone(r[key]);
    }
    if (sig(next, tokens) !== sig(node, tokens)) {
      stale.push(keys[0]);
      return;
    }
    for (const key of keys) {
      if (r[key] === undefined) delete node[key];
      else node[key] = structuredClone(r[key]);
    }
  };
  if (r.shadows !== undefined) group(["shadows", "shadow"], shadowSig);
  if (r.filters !== undefined) group(["filters"], filterSig);
  if (r.masks !== undefined) group(["masks", "mask"], maskSig);
  if (
    r.strokeHidden === true ||
    (Array.isArray(r.strokeHiddenSides) && r.strokeHiddenSides.includes(true))
  )
    group(STROKE_KEYS, borderSig);
  if (r.outlineHidden === true) group(OUTLINE_KEYS, outlineSig);
  if (r.textRuns !== undefined && node.type === "text") {
    if (
      canonicalRuns(node.text, r.textRuns) === canonicalRuns(node.text, node.textRuns) &&
      r.textRuns.every((run) => run.end <= String(node.text || "").length)
    )
      node.textRuns = structuredClone(r.textRuns);
    else stale.push("textRuns");
  }
  if (r.bindings && typeof r.bindings === "object") {
    const kept = {};
    for (const [key, name] of Object.entries(r.bindings))
      if (!r.bound || sameValue(boundField(node, key), r.bound[key])) kept[key] = name;
    if (Object.keys(kept).length) node.bindings = kept;
    else delete node.bindings;
    if (Object.keys(kept).length < Object.keys(r.bindings).length) stale.push("bindings");
  }
  if (r.locked === true) node.locked = true;
  if (r.autoPosition === false && node.type === "frame") node.autoPosition = false;
  if (r.labelHidden === true && node.type === "frame" && !node.parentId) node.labelHidden = true;
  if (r.preview && typeof r.preview === "object" && !node.parentId)
    node.preview = structuredClone(r.preview);
  if (typeof r.name === "string" && r.name.trim() && r.name.trim().slice(0, 200) === node.name)
    node.name = r.name;
  for (const [key, dormant] of DORMANT)
    if (r[key] !== undefined) {
      const next = { ...node, [key]: r[key] };
      if (dormant(next)) node[key] = r[key];
    }
  if (node.type !== "shader" && SHADER_KEYS.some((key) => r[key] !== undefined)) {
    const next = { ...node };
    for (const key of SHADER_KEYS) if (r[key] !== undefined) next[key] = structuredClone(r[key]);
    if (shaderError(next)) stale.push("shaderFill");
    else for (const key of SHADER_KEYS) if (r[key] !== undefined) node[key] = next[key];
  }
  if (
    Array.isArray(r.box) &&
    node.hidden === true &&
    r.box.length === 4 &&
    r.box.every(Number.isFinite)
  )
    BOX.forEach((key, i) => {
      node[key] = r.box[i];
    });
  if (stale.length)
    warnings.push(
      `${where || "Layer"}: ${RESIDUAL_ATTR} ${stale.join(", ")} no longer match${stale.length === 1 ? "es" : ""} the classes; the classes were applied instead`,
    );
  return node;
}
