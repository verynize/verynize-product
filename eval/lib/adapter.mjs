// The ONLY place eval/ touches Verynize internals. The codec and document schema are being
// rewritten, so every accessor here tolerates several plausible shapes (old flat fields, per-side
// fields, arrays, objects). If an API moves, fix it here and nowhere else.
const repo = new URL("../../", import.meta.url);
const tryImport = async (rel) => {
  try {
    return await import(new URL(rel, repo).href);
  } catch (error) {
    return { __error: error };
  }
};

let modules = null;
export async function codec() {
  if (modules) return modules;
  const [edit, codecMod, exportMod, store] = await Promise.all([
    tryImport("integrations/design-edit.mjs"),
    tryImport("integrations/jsx-codec.mjs"),
    tryImport("integrations/export-html.mjs"),
    tryImport("integrations/design-store.mjs"),
  ]);
  const pick = (name, ...mods) => mods.map((m) => m?.[name]).find((f) => typeof f === "function");
  modules = {
    createArtboards: pick("createArtboards", edit),
    runDirectives: pick("runDirectives", edit),
    elementCode: pick("elementCode", edit),
    indexPage: pick("indexPage", edit),
    exportHTML: pick("exportHTML", exportMod),
    validateDocument: pick("validateDocument", store),
    loadErrors: [edit, codecMod, exportMod, store]
      .filter((m) => m.__error)
      .map((m) => m.__error.message),
  };
  if (!modules.createArtboards)
    throw new Error(
      `Verynize codec not loadable: ${modules.loadErrors.join("; ") || "createArtboards missing"}`,
    );
  return modules;
}

export const blankDocument = ({ width = 1440, height = 900 } = {}, tokens = {}, variables) => ({
  version: 2,
  name: "Eval",
  activePage: "p1",
  tokens: { ...tokens },
  ...(variables ? { variables: { ...variables } } : {}),
  pages: [{ id: "p1", name: "Page", width, height, nodes: [] }],
});

const normWarnings = (list) =>
  (Array.isArray(list) ? list : []).map((w) =>
    typeof w === "string" ? w : w?.message || w?.text || JSON.stringify(w),
  );
const pageOf = (state) => state.doc.pages.find((p) => p.id === state.pageId) || state.doc.pages[0];

/** HTML (+ CSS) -> document through the HTML importer. Returns the same shape as build(). */
export async function buildHtml(html, viewport) {
  const { importHtml } = await import(new URL("integrations/codec-html.mjs", repo).href);
  const result = await importHtml(html, { viewport });
  return {
    doc: result.document,
    pageId: result.pageId,
    warnings: result.warnings,
    rootIds: (result.roots || []).map((r) => r.id),
  };
}

/** JSX -> document. Returns {doc, pageId, warnings, rootIds}. */
export async function build(jsx, viewport, { tokens, variables } = {}) {
  const m = await codec();
  const result = await m.createArtboards(blankDocument(viewport, tokens, variables), "p1", jsx);
  const warnings = normWarnings(result.warnings).concat(normWarnings(result.diagnostics));
  return {
    doc: result.document,
    pageId: "p1",
    warnings,
    rootIds: (result.roots || []).map((r) => r.id),
  };
}

export const nodes = (state) => pageOf(state).nodes;
export const findByLabel = (state, label) => nodes(state).filter((n) => n.name === label);
export const childrenOf = (state, node) => nodes(state).filter((n) => n.parentId === node.id);
export const parentOf = (state, node) => nodes(state).find((n) => n.id === node.parentId) || null;

function refFor(state, m, node) {
  const index = m.indexPage ? m.indexPage(pageOf(state)) : null;
  return index?.shortId?.(node) || node.shortId || node.id;
}

/** Apply an edit. step = {target: label, jsx, kind?: 'edit'|'replace'|'insert-last'|'insert-after'|'delete'}. */
export async function edit(state, step) {
  const m = await codec();
  if (!m.runDirectives) throw new Error("runDirectives not available");
  const [target] = findByLabel(state, step.target);
  if (!target) throw new Error(`edit target "${step.target}" not found`);
  const ref = refFor(state, m, target);
  const header = {
    edit: "edit",
    replace: "replace",
    "insert-last": "insert as last child of",
    "insert-after": "insert after",
    delete: "delete",
  }[step.kind || "edit"];
  const script = `{/* ${header} ${ref} */}\n${step.jsx || ""}`;
  const result = await m.runDirectives(state.doc, state.pageId, script);
  if (result.failed)
    throw new Error(
      `edit failed: ${
        String(result.report)
          .split("\n")
          .find((l) => l.startsWith("FAIL")) || result.report
      }`,
    );
  const warnings = [...String(result.report || "").matchAll(/warnings: (.*)/g)].map((x) => x[1]);
  return { ...state, doc: result.document, warnings: state.warnings.concat(warnings) };
}

/** Serialize a root (by label or the first root) back to JSX. */
export async function serialize(state, label) {
  const m = await codec();
  const page = pageOf(state);
  const node = label ? findByLabel(state, label)[0] : page.nodes.find((n) => !n.parentId);
  if (!node) throw new Error(`serialize: node "${label}" not found`);
  return await m.elementCode(state.doc, page, node);
}

export async function toHtml(state) {
  const m = await codec();
  if (!m.exportHTML) throw new Error("exportHTML not available");
  return await m.exportHTML(state.doc, state.pageId);
}

export async function validate(state) {
  const m = await codec();
  if (m.validateDocument) m.validateDocument(state.doc);
}

// ---------------------------------------------------------------------------------------------
// Normalized property accessors. Each returns a plain value regardless of schema version.

const num = (v) =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
      ? Number(v)
      : undefined;
function sides(
  node,
  base,
  names = ["Top", "Right", "Bottom", "Left"],
  keys = ["top", "right", "bottom", "left"],
) {
  const v = node[base];
  const out = {};
  if (Array.isArray(v)) {
    const a = v.map(num);
    const [t, r = t, b = t, l = r] = a;
    Object.assign(out, { [keys[0]]: t, [keys[1]]: r, [keys[2]]: b, [keys[3]]: l });
  } else if (v && typeof v === "object") {
    keys.forEach((k, i) => {
      out[k] = num(v[k] ?? v[names[i].toLowerCase()] ?? v[names[i]]);
    });
  } else if (num(v) !== undefined)
    keys.forEach((k) => {
      out[k] = num(v);
    });
  keys.forEach((k, i) => {
    const direct = num(node[base + names[i]]);
    if (direct !== undefined) out[k] = direct;
  });
  if (base === "padding") {
    if (num(node.paddingX) !== undefined) {
      out.left ??= num(node.paddingX);
      out.right ??= num(node.paddingX);
    }
    if (num(node.paddingY) !== undefined) {
      out.top ??= num(node.paddingY);
      out.bottom ??= num(node.paddingY);
    }
  }
  keys.forEach((k) => {
    out[k] ??= 0;
  });
  return out;
}

export const padding = (node) => sides(node, "padding");
export function radius(node) {
  const keys = ["tl", "tr", "br", "bl"];
  // Per-corner radii (codec: cornerRadii [tl, tr, br, bl], only when they differ) win over the
  // uniform `radius`, which then only holds the largest corner.
  for (const base of ["cornerRadii", "radii"])
    if (Array.isArray(node[base]) && node[base].length === 4) {
      const [tl, tr, br, bl] = node[base].map((v) => num(v) ?? 0);
      return { tl, tr, br, bl };
    }
  for (const base of ["radius", "cornerRadius", "radii", "borderRadius"]) {
    if (node[base] === undefined && !["TopLeft", "TL"].some((s) => node[base + s] !== undefined))
      continue;
    const out = sides(node, base, ["TopLeft", "TopRight", "BottomRight", "BottomLeft"], keys);
    for (const [k, s] of [
      ["tl", "TL"],
      ["tr", "TR"],
      ["br", "BR"],
      ["bl", "BL"],
    ])
      if (num(node[base + s]) !== undefined) out[k] = num(node[base + s]);
    if (node[base] && typeof node[base] === "object" && !Array.isArray(node[base])) {
      const o = node[base];
      for (const [k, alts] of [
        ["tl", ["topLeft", "tl"]],
        ["tr", ["topRight", "tr"]],
        ["br", ["bottomRight", "br"]],
        ["bl", ["bottomLeft", "bl"]],
      ])
        for (const a of alts) if (num(o[a]) !== undefined) out[k] = num(o[a]);
    }
    return out;
  }
  return { tl: 0, tr: 0, br: 0, bl: 0 };
}
export function gap(node) {
  const g = node.gap;
  const both = num(g);
  const obj = g && typeof g === "object" ? g : {};
  const x = num(node.gapX) ?? num(node.columnGap) ?? num(obj.x) ?? num(obj.column) ?? both ?? 0;
  const y = num(node.gapY) ?? num(node.rowGap) ?? num(obj.y) ?? num(obj.row) ?? both ?? 0;
  return { x, y };
}
const isText = (node) => node.type === "text";
/** Background fill of a non-text node. Solid color only; see gradient(). */
export const fill = (node) =>
  isText(node)
    ? (node.background ?? node.fill ?? "transparent")
    : (node.fill ?? node.background ?? node.color);
/** Ink color: for text nodes their color; for containers an inherited text color if the schema stores one. */
export const ink = (node) =>
  isText(node) ? (node.textColor ?? node.ink ?? node.color) : (node.textColor ?? node.ink);
export const strokeColor = (node) => node.strokeColor ?? node.borderColor ?? node.stroke?.color;
export const strokeWidth = (node) =>
  num(node.strokeWidth) ?? num(node.borderWidth) ?? num(node.stroke?.width) ?? 0;
function mode(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).toLowerCase();
  if (["hug", "fit", "fit_content", "fit-content", "auto", "content", "hug_contents"].includes(s))
    return "hug";
  if (["fill", "fill_container", "fill-container", "stretch", "grow", "flex"].includes(s))
    return "fill";
  if (["fixed", "px"].includes(s)) return "fixed";
  return s;
}
export function sizing(node) {
  return {
    w:
      mode(
        node.wMode ??
          node.widthMode ??
          node.sizing?.w ??
          node.sizing?.width ??
          node.layoutSizingHorizontal,
      ) ?? "fixed",
    h:
      mode(
        node.hMode ??
          node.heightMode ??
          node.sizing?.h ??
          node.sizing?.height ??
          node.layoutSizingVertical,
      ) ?? "fixed",
  };
}
export const layout = (node) => String(node.layout ?? "free").toLowerCase();
export const direction = (node) =>
  String(node.direction ?? node.flexDirection ?? "row")
    .toLowerCase()
    .replace("vertical", "column")
    .replace("horizontal", "row");
export const fontSize = (node) => num(node.fontSize);
export function lineHeightPx(node) {
  if (num(node.lineHeightPx) !== undefined) return num(node.lineHeightPx);
  const lh = node.lineHeight;
  if (typeof lh === "string" && lh.endsWith("px")) return parseFloat(lh);
  const v = num(lh);
  if (v === undefined) return undefined;
  return v > 4 ? v : Math.round(v * (fontSize(node) || 16) * 100) / 100;
}
export const fontWeight = (node) => num(node.fontWeight);
export const fontFamily = (node) => String(node.fontFamily ?? "");
export const letterSpacingPx = (node) => num(node.letterSpacingPx) ?? num(node.letterSpacing) ?? 0;
export const gradient = (node) =>
  String(
    node.gradient ??
      node.backgroundImage ??
      (Array.isArray(node.fills)
        ? node.fills.find((f) => /gradient/i.test(f?.type || ""))?.css
        : "") ??
      "",
  );
export const shadow = (node) =>
  String(
    Array.isArray(node.shadow)
      ? JSON.stringify(node.shadow)
      : (node.shadow ?? node.boxShadow ?? ""),
  );
export const truncate = (node) =>
  Boolean(
    node.truncate ||
    node.textOverflow === "ellipsis" ||
    num(node.maxLines) === 1 ||
    num(node.lineClamp) === 1 ||
    node.textGrowth === "truncate",
  );
export const positioning = (node) =>
  String(
    node.position ?? node.layoutPosition ?? (node.absolute ? "absolute" : "auto"),
  ).toLowerCase();
export const flexGrow = (node) =>
  num(node.grow) ?? num(node.flexGrow) ?? (sizing(node).w === "fill" ? 1 : 0);
export const textTransform = (node) =>
  String(node.textTransform ?? node.textCase ?? "none").toLowerCase();
export const box = (node) => ({
  x: num(node.x) ?? 0,
  y: num(node.y) ?? 0,
  w: num(node.w) ?? num(node.width) ?? 0,
  h: num(node.h) ?? num(node.height) ?? 0,
});

export const token = (node) => String(node.token ?? "");
export const variants = (node) => String(node.variantClasses ?? "");
export const bindings = (node) =>
  node.bindings && typeof node.bindings === "object" ? node.bindings : {};
export const hidden = (node) => node.hidden === true;
export const effects = (node) => ({
  shadows: (node.shadows || []).length,
  hiddenShadows: (node.shadows || []).filter((s) => s.hidden).length,
  filters: (node.filters || []).length,
  masks: (node.masks || []).length,
});

export const type = (node) => node.type;
export const w = (node) => node.w;
export const src = (node) => node.src;
export const outlineWidth = (node) => node.outlineWidth;
export const fills = (node) => node.fills;
export const svgMarkup = (node) =>
  /^data:image\/svg\+xml;base64,/.test(node.src || "")
    ? Buffer.from(node.src.split(",")[1], "base64").toString()
    : "";

// Vector layers: path data joined with " | ", the viewBox as "x y w h", the stroke cap.
export const paths = (node) =>
  Array.isArray(node.paths) ? node.paths.map((p) => p.d).join(" | ") : "";
export const viewBox = (node) => (Array.isArray(node.viewBox) ? node.viewBox.join(" ") : "");
export const strokeCap = (node) => node.strokeCap ?? "butt";

export const ACCESSORS = {
  paths,
  viewBox,
  strokeCap,
  type,
  w,
  src,
  outlineWidth,
  fills,
  svgMarkup,
  token,
  variants,
  bindings,
  hidden,
  effects,
  padding,
  radius,
  gap,
  fill,
  ink,
  strokeColor,
  strokeWidth,
  sizing,
  layout,
  direction,
  fontSize,
  lineHeightPx,
  fontWeight,
  fontFamily,
  letterSpacingPx,
  gradient,
  shadow,
  truncate,
  positioning,
  flexGrow,
  textTransform,
  box,
};
