// Vector layers in Tailwind JSX (docs/vector-nodes.md). One canonical element, written by jsx-codec.mjs and read by
// design-edit.mjs:
//
//   <svg data-node-id="…" data-node-label="Arrow" data-vector viewBox="0 0 24 24" className="size-6"
//        fill="none" stroke="#0f172a" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
//     <path d="M5 12h14" />
//     <path d="m12 5 7 7-7 7" fillRule="evenodd" />
//   </svg>
//
// data-vector marks Verynize's own form: stroke widths and dash lengths are layer pixels (the canvas draws them with
// vector-effect: non-scaling-stroke), fill/stroke are #rrggbb[aa], data-fill-token / data-stroke-token bind colour
// variables, data-fills carries a paint stack and data-stroke-hidden a hidden stroke. Any other <svg> is ordinary
// SVG (strokes in viewBox units): svgElementJsx converts it through web/vector-svg.js into the canonical form, a free
// frame of such vectors when it has several paints, or reports why it must stay an image.
import { importSvg, toNodes } from "./vector-svg.mjs";
import { pathError } from "./vector-geometry.mjs";

const esc = (text) =>
  String(text).replace(
    /[&"<>]/g,
    (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c],
  );
const r = (v) => Math.round(Number(v) * 1000) / 1000;
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
// Path data longer than this is elided in compact reads and restored from the layer on write.
export const MAX_INLINE_PATH = 4096;
const ELIDED = /^\[path data( \d+ KB)?\]$/;

/** Fill and stroke attributes of a vector layer (fields of a vector node). */
export function vectorAttrs(n) {
  const out = ["data-vector"];
  const vb = Array.isArray(n.viewBox) ? n.viewBox : [0, 0, n.w, n.h];
  out.push(`viewBox="${vb.map(r).join(" ")}"`);
  if (Array.isArray(n.fills)) {
    if (!n.fills.length) out.push('fill="none"');
    else out.push(`data-fills="${esc(JSON.stringify(n.fills))}"`);
  } else if (HEX.test(n.color || "")) {
    out.push(`fill="${esc(n.color)}"`);
    if (n.token) out.push(`data-fill-token="${esc(n.token)}"`);
  } else out.push('fill="none"');
  const width = Number(n.strokeWidth) || 0;
  if (width > 0) {
    out.push(
      `stroke="${esc(HEX.test(n.strokeColor || "") ? n.strokeColor : "#000000")}"`,
      `strokeWidth={${r(width)}}`,
    );
    if (n.strokeToken) out.push(`data-stroke-token="${esc(n.strokeToken)}"`);
    if (n.strokeCap) out.push(`strokeLinecap="${esc(n.strokeCap)}"`);
    if (n.strokeJoin) out.push(`strokeLinejoin="${esc(n.strokeJoin)}"`);
    if (Number(n.strokeMiter) > 0) out.push(`strokeMiterlimit={${r(n.strokeMiter)}}`);
    if (Array.isArray(n.strokeDash) && n.strokeDash.length)
      out.push(`strokeDasharray="${n.strokeDash.map(r).join(" ")}"`);
    if (n.strokeHidden === true) out.push('data-stroke-hidden="true"');
  }
  return out;
}

/** The <path> children; `full` false elides long path data ([path data N KB], restored on write). */
export function vectorPaths(n, { indent = "", full = true } = {}) {
  const paths = Array.isArray(n.paths) ? n.paths : [];
  const total = paths.reduce((sum, p) => sum + String(p.d || "").length, 0);
  const elide = !full && total > MAX_INLINE_PATH;
  return paths
    .map((p) => {
      const d = elide
        ? `[path data ${Math.max(1, Math.round(String(p.d).length / 1024))} KB]`
        : p.d;
      return `${indent}<path d="${esc(d)}"${p.fillRule === "evenodd" ? ' fillRule="evenodd"' : ""} />`;
    })
    .join("\n");
}

const numbers = (v) =>
  String(v ?? "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
const hexOf = (v) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : null);

/**
 * Vector fields from a parsed canonical <svg data-vector> element (jsx-codec parseJsx AST). `reused` is the layer the
 * element rewrites: elided path data is restored from it. Throws on invalid path data.
 */
export function vectorFromElement(
  el,
  { tokens = {}, reused = null, warnings = [], where = "<svg>" } = {},
) {
  const a = el.attrs;
  const out = {};
  const vb = numbers(a.viewBox);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) out.viewBox = vb;
  const children = el.children.filter((c) => c.tag === "path");
  if (children.some((c) => ELIDED.test(String(c.attrs.d || "")))) {
    if (reused?.type === "vector" && Array.isArray(reused.paths)) {
      out.paths = structuredClone(reused.paths);
      if (!out.viewBox && reused.viewBox) out.viewBox = [...reused.viewBox];
    } else
      warnings.push(
        `${where}: elided path data has no layer to restore it from; read the element with full output`,
      );
  }
  if (!out.paths)
    out.paths = children
      .map((c) => {
        const d = typeof c.attrs.d === "string" ? c.attrs.d.trim() : "";
        const error = pathError(d);
        if (error) throw new Error(`${where}: invalid path data (${error})`);
        const rule = c.attrs.fillRule ?? c.attrs["fill-rule"];
        return rule === "evenodd" ? { d, fillRule: "evenodd" } : { d };
      })
      .filter(Boolean);
  if (a.fill === "none") out.fills = [];
  else if (hexOf(a.fill)) out.color = hexOf(a.fill);
  if (typeof a["data-fill-token"] === "string" && a["data-fill-token"]) {
    out.token = a["data-fill-token"];
    if (HEX.test(tokens[out.token] || "")) out.color = tokens[out.token];
  }
  const width = Number(a.strokeWidth ?? a["stroke-width"]);
  const stroke = a.stroke;
  if (stroke === undefined || stroke === "none" || !(width > 0)) out.strokeWidth = 0;
  else {
    out.strokeWidth = width;
    out.strokeColor = hexOf(stroke) || "#000000";
    const token = a["data-stroke-token"];
    if (typeof token === "string" && token) {
      out.strokeToken = token;
      if (HEX.test(tokens[token] || "")) out.strokeColor = tokens[token];
    }
  }
  // Stroke details are read even without a stroke, so an edit can state them on their own.
  const cap = a.strokeLinecap ?? a["stroke-linecap"],
    join = a.strokeLinejoin ?? a["stroke-linejoin"],
    miter = Number(a.strokeMiterlimit ?? a["stroke-miterlimit"]),
    dash = numbers(a.strokeDasharray ?? a["stroke-dasharray"]);
  if (["round", "square"].includes(cap)) out.strokeCap = cap;
  if (["round", "bevel"].includes(join)) out.strokeJoin = join;
  if (miter >= 1 && miter <= 100) out.strokeMiter = miter;
  if (
    dash.length &&
    dash.length <= 16 &&
    dash.every((v) => Number.isFinite(v) && v >= 0) &&
    dash.some((v) => v > 0)
  )
    out.strokeDash = dash;
  if (a["data-stroke-hidden"] === "true" || a["data-stroke-hidden"] === true)
    out.strokeHidden = true;
  return out;
}

/**
 * Canonical JSX for an imported SVG result (web/vector-svg.js importSvg): one <svg data-vector>, or a free frame of
 * them. `attrs` are extra attribute strings for the outer element (label, residual…), `className` its classes.
 */
export function resultJsx(
  result,
  { attrs = [], className = "", indent = "", label = "Vector", w, h } = {},
) {
  let id = 0;
  const nodes = toNodes(result, { name: label, uid: () => `n${id++}`, w, h });
  if (!attrs.some((x) => x.startsWith("data-node-label=")))
    attrs = [...attrs, `data-node-label="${esc(label)}"`];
  const cls = (c) => (c.trim() ? ` className="${esc(c.trim())}"` : "");
  const svg = (n, extra, classes, pad) => {
    const open = `${pad}<svg ${[...extra, ...vectorAttrs(n)].join(" ")}${cls(classes)}>`;
    return `${open}\n${vectorPaths(n, { indent: pad + "  " })}\n${pad}</svg>`;
  };
  if (nodes.length === 1) return svg(nodes[0], attrs, className, indent);
  const kids = nodes.slice(1); // nodes[0] is the frame
  const children = kids
    .map((k) =>
      svg(
        k,
        [`data-node-label="${esc(k.name)}"`],
        `absolute left-[${r(k.x)}px] top-[${r(k.y)}px] w-[${r(k.w)}px] h-[${r(k.h)}px]`,
        indent + "  ",
      ),
    )
    .join("\n");
  return `${indent}<div ${attrs.join(" ")}${cls(`layout-free ${className}`)}>\n${children}\n${indent}</div>`;
}

/**
 * An ordinary <svg> as canonical JSX (`w`/`h`: the size its classes give it, when known): {ok: true, jsx, warnings} or {ok: false, reason, warnings} (keep it an image).
 */
export function svgElementJsx(
  markup,
  { color, attrs = [], className = "", label, indent = "", w, h } = {},
) {
  const result = importSvg(markup, { color, width: w, height: h });
  if (!result.ok) return result;
  return {
    ok: true,
    jsx: resultJsx(result, { attrs, className, indent, label, w, h }),
    result,
    warnings: result.warnings,
  };
}
