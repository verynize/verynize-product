// SVG → vector layers (docs/vector-nodes.md). DOM-free, shared by the canvas (paste, drop; a classic <script> after
// web/vector-geometry.js) and Node (HTML and JSX import through integrations/vector-svg.mjs). Registers
// globalThis.VerynizeVectorSvg.
//
// importSvg(markup, options) reads an SVG document with a small XML reader (no DOM, nothing evaluated, no external
// references) and flattens it: shapes (path, rect, circle, ellipse, line, polyline, polygon) become path data in the
// root viewBox's units with every transform, nested <svg> viewport and <use> reference baked in. Consecutive shapes
// with the same paint become one layer. It returns
//   {ok: true, width, height, viewBox, layers: [{paths: [{d, fillRule?}], style}], warnings}
// or {ok: false, reason, warnings} when the drawing needs something a vector layer cannot represent (gradients,
// patterns, filters, masks, clip paths, text, embedded images, foreignObject) or breaks the caps. Callers then keep
// the SVG as an image layer and report the reason.
//   options.color          what currentColor means (default #000000)
//   options.pixelStrokes   stroke widths are already layer pixels (Verynize's own <svg data-vector> markup)
//
// toNodes(result, {name, x, y, w, h, uid, parentId}) builds the layers as document nodes: one vector layer the size
// of the SVG, or a free frame of that size holding one vector per paint group (each hugging its own geometry).
(function (root) {
  "use strict";
  const V = () => root.VerynizeVector;
  const CAPS = Object.freeze({
    elements: 20000,
    shapes: 2000,
    layers: 200,
    useDepth: 8,
    segments: 200000,
  });
  const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
  const CONTAINERS = new Set(["svg", "g", "a", "switch", "symbol"]);
  const SKIPPED = new Set([
    "defs",
    "title",
    "desc",
    "metadata",
    "style",
    "script",
    "marker",
    "linearGradient",
    "radialGradient",
    "pattern",
    "clipPath",
    "mask",
    "filter",
    "symbol",
  ]);
  const UNSUPPORTED = {
    text: "text",
    image: "embedded images",
    foreignObject: "foreignObject",
    video: "video",
    audio: "audio",
    iframe: "iframe",
    canvas: "canvas",
  };
  const INHERITED = [
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-dasharray",
    "color",
    "visibility",
  ];
  const STYLED = [
    ...INHERITED,
    "opacity",
    "display",
    "filter",
    "mask",
    "clip-path",
    "vector-effect",
    "transform",
  ];
  const NAMED = {
    black: "#000000",
    white: "#ffffff",
    red: "#ff0000",
    green: "#008000",
    blue: "#0000ff",
    yellow: "#ffff00",
    cyan: "#00ffff",
    aqua: "#00ffff",
    magenta: "#ff00ff",
    fuchsia: "#ff00ff",
    gray: "#808080",
    grey: "#808080",
    orange: "#ffa500",
    purple: "#800080",
    silver: "#c0c0c0",
    maroon: "#800000",
    navy: "#000080",
    teal: "#008080",
    olive: "#808000",
    lime: "#00ff00",
  };
  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

  class Unsupported extends Error {}

  // ---------- XML ----------
  const decode = (s) =>
    s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) =>
      e[0] === "#"
        ? String.fromCodePoint(
            e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
          )
        : (ENTITIES[e] ?? all),
    );
  /** Attributes of a start tag from `from` up to its > (values of any length). */
  function readAttributes(text, from) {
    const attrs = Object.create(null);
    let j = from,
      selfClosing = false;
    const n = text.length;
    for (;;) {
      while (j < n && /\s/.test(text[j])) j++;
      if (j >= n) break;
      if (text.startsWith("/>", j)) {
        selfClosing = true;
        j += 2;
        break;
      }
      if (text[j] === ">") {
        j++;
        break;
      }
      const name = /^[^\s=/>]+/.exec(text.slice(j, j + 256));
      if (!name) {
        j++;
        continue;
      }
      j += name[0].length;
      while (j < n && /\s/.test(text[j])) j++;
      let value = "";
      if (text[j] === "=") {
        j++;
        while (j < n && /\s/.test(text[j])) j++;
        const q = text[j];
        if (q === '"' || q === "'") {
          const end = text.indexOf(q, j + 1);
          value = text.slice(j + 1, end < 0 ? n : end);
          j = end < 0 ? n : end + 1;
        } else {
          const m = /^[^\s>]+/.exec(text.slice(j, j + 4096));
          value = m ? m[0] : "";
          j += value.length;
        }
      }
      attrs[name[0]] = decode(value);
    }
    return { attrs, end: j, selfClosing };
  }

  /** Element tree {tag, attrs, children, text}; the svg: prefix on tags is dropped. */
  function parse(text) {
    const top = { tag: "#root", attrs: {}, children: [], text: "" },
      stack = [top];
    let i = 0,
      count = 0;
    const n = text.length;
    while (i < n) {
      const lt = text.indexOf("<", i);
      if (lt < 0) break;
      if (lt > i) stack[stack.length - 1].text += decode(text.slice(i, lt));
      if (text.startsWith("<!--", lt)) {
        const end = text.indexOf("-->", lt + 4);
        i = end < 0 ? n : end + 3;
      } else if (text.startsWith("<![CDATA[", lt)) {
        const end = text.indexOf("]]>", lt + 9);
        stack[stack.length - 1].text += text.slice(lt + 9, end < 0 ? n : end);
        i = end < 0 ? n : end + 3;
      } else if (text.startsWith("<?", lt)) {
        const end = text.indexOf("?>", lt + 2);
        i = end < 0 ? n : end + 2;
      } else if (text.startsWith("<!", lt)) {
        const bracket = text.indexOf("[", lt),
          close = text.indexOf(">", lt);
        const end = bracket >= 0 && bracket < close ? text.indexOf("]>", bracket) + 1 : close;
        i = end <= 0 ? n : end + 1;
      } else if (text[lt + 1] === "/") {
        const end = text.indexOf(">", lt);
        const name = text
          .slice(lt + 2, end < 0 ? n : end)
          .trim()
          .replace(/^svg:/, "");
        for (let k = stack.length - 1; k > 0; k--)
          if (stack[k].tag === name) {
            stack.length = k;
            break;
          }
        i = end < 0 ? n : end + 1;
      } else {
        const m = /^<([A-Za-z_][\w:.-]*)/.exec(text.slice(lt, lt + 200));
        if (!m) {
          stack[stack.length - 1].text += "<";
          i = lt + 1;
          continue;
        }
        if (++count > CAPS.elements) throw new Unsupported(`more than ${CAPS.elements} elements`);
        const { attrs, end, selfClosing } = readAttributes(text, lt + m[0].length);
        const el = { tag: m[1].replace(/^svg:/, ""), attrs, children: [], text: "" };
        stack[stack.length - 1].children.push(el);
        if (!selfClosing) stack.push(el);
        i = end;
      }
    }
    return top;
  }

  // ---------- Styles ----------
  function declarations(text) {
    const out = {};
    for (const part of String(text || "").split(";")) {
      const k = part.indexOf(":");
      if (k < 0) continue;
      const name = part.slice(0, k).trim().toLowerCase(),
        value = part
          .slice(k + 1)
          .replace(/!important/i, "")
          .trim();
      if (name && value) out[name] = value;
    }
    return out;
  }
  /** Rules of <style> elements with simple selectors (tag, .class, #id, tag.class), in specificity order. */
  function styleRules(tree, warnings) {
    const rules = [];
    const visit = (el) => {
      if (el.tag === "style") {
        const css = el.text.replace(/\/\*[\s\S]*?\*\//g, "");
        for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g))
          for (const selector of m[1]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)) {
            const simple = /^([a-zA-Z][\w-]*)?(?:([.#])([\w-]+))?$/.exec(selector);
            if (!simple || (!simple[1] && !simple[2])) {
              warnings.push(`SVG style selector "${selector.slice(0, 60)}" was ignored`);
              continue;
            }
            rules.push({
              tag: simple[1] || null,
              kind: simple[2] || null,
              name: simple[3] || null,
              weight: simple[2] === "#" ? 2 : simple[2] ? 1 : 0,
              decls: declarations(m[2]),
            });
          }
      }
      el.children.forEach(visit);
    };
    visit(tree);
    return rules.sort((a, b) => a.weight - b.weight);
  }
  /** Presentation attributes < <style> rules < the style attribute. */
  function ownStyle(el, rules) {
    const out = {};
    for (const key of STYLED)
      if (el.attrs[key] !== undefined) out[key] = String(el.attrs[key]).trim();
    const classes = String(el.attrs.class || "")
      .split(/\s+/)
      .filter(Boolean);
    for (const r of rules) {
      if (r.tag && r.tag !== el.tag) continue;
      if (r.kind === "." && !classes.includes(r.name)) continue;
      if (r.kind === "#" && el.attrs.id !== r.name) continue;
      Object.assign(out, r.decls);
    }
    Object.assign(out, declarations(el.attrs.style));
    return out;
  }

  function color(value, current) {
    let v = String(value || "")
      .trim()
      .toLowerCase();
    if (!v || v === "none" || v === "transparent") return { none: true };
    if (v === "currentcolor") v = String(current || "#000000").toLowerCase();
    if (v.startsWith("url(")) throw new Unsupported("gradient or pattern paints");
    if (NAMED[v]) return { hex: NAMED[v], alpha: 1 };
    if (/^#[0-9a-f]{3,4}$/.test(v)) v = "#" + Array.from(v.slice(1), (c) => c + c).join("");
    if (/^#[0-9a-f]{6}$/.test(v)) return { hex: v, alpha: 1 };
    if (/^#[0-9a-f]{8}$/.test(v))
      return { hex: v.slice(0, 7), alpha: parseInt(v.slice(7), 16) / 255 };
    const m =
      /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(
        v,
      );
    if (m) {
      const channel = (c) =>
        Math.max(
          0,
          Math.min(255, Math.round(c.endsWith("%") ? parseFloat(c) * 2.55 : parseFloat(c))),
        );
      const alpha =
        m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      return {
        hex: "#" + [m[1], m[2], m[3]].map((c) => channel(c).toString(16).padStart(2, "0")).join(""),
        alpha: Math.max(0, Math.min(1, alpha)),
      };
    }
    throw new Unsupported(`the colour "${String(value).slice(0, 40)}"`);
  }
  const fraction = (v, fallback = 1) => {
    if (v === undefined || v === "") return fallback;
    const n = String(v).trim().endsWith("%") ? parseFloat(v) / 100 : parseFloat(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
  };
  /** A length in user units; percentages resolve against `ref`. */
  function length(v, ref = 0, fallback = 0) {
    if (v === undefined || v === null || v === "") return fallback;
    const m =
      /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in|em|rem|%)?\s*$/i.exec(
        String(v),
      );
    if (!m) return fallback;
    const n = Number(m[1]),
      unit = (m[2] || "px").toLowerCase();
    if (unit === "%") return (n * ref) / 100;
    return (
      n *
      ({ px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, rem: 16 }[unit] ??
        1)
    );
  }
  const numbers = (v) =>
    String(v || "")
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);

  // ---------- Shapes ----------
  function shapePath(el, vb) {
    const a = el.attrs,
      L = (k, ref) => length(a[k], ref);
    const dw = vb[2],
      dh = vb[3],
      dd = Math.hypot(dw, dh) / Math.SQRT2;
    switch (el.tag) {
      case "path":
        return a.d || "";
      case "rect": {
        const x = L("x", dw),
          y = L("y", dh),
          w = L("width", dw),
          h = L("height", dh);
        if (!(w > 0) || !(h > 0)) return "";
        let rx = a.rx !== undefined && a.rx !== "auto" ? L("rx", dw) : null,
          ry = a.ry !== undefined && a.ry !== "auto" ? L("ry", dh) : null;
        if (rx === null) rx = ry ?? 0;
        if (ry === null) ry = rx;
        rx = Math.min(Math.max(0, rx), w / 2);
        ry = Math.min(Math.max(0, ry), h / 2);
        if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
        return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
      }
      case "circle":
      case "ellipse": {
        const cx = L("cx", dw),
          cy = L("cy", dh);
        const rx = el.tag === "circle" ? L("r", dd) : L("rx", dw),
          ry = el.tag === "circle" ? rx : a.ry !== undefined ? L("ry", dh) : rx;
        if (!(rx > 0) || !(ry > 0)) return "";
        return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
      }
      case "line":
        return `M${L("x1", dw)} ${L("y1", dh)}L${L("x2", dw)} ${L("y2", dh)}`;
      default: {
        const p = numbers(a.points);
        if (p.length < 4 || p.some((v) => !Number.isFinite(v))) return "";
        let d = `M${p[0]} ${p[1]}`;
        for (let k = 2; k + 1 < p.length; k += 2) d += `L${p[k]} ${p[k + 1]}`;
        return el.tag === "polygon" ? d + "Z" : d;
      }
    }
  }
  /** viewBox → viewport mapping (preserveAspectRatio, default xMidYMid meet). */
  function viewportMatrix(vb, w, h, par) {
    const sx = w / vb[2],
      sy = h / vb[3];
    const spec = String(par || "xMidYMid meet")
      .trim()
      .split(/\s+/);
    if (spec[0] === "none") return [sx, 0, 0, sy, -vb[0] * sx, -vb[1] * sy];
    const s = spec[1] === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
    const align = spec[0] || "xMidYMid",
      ax = /xMid/.test(align) ? 0.5 : /xMax/.test(align) ? 1 : 0,
      ay = /YMid/.test(align) ? 0.5 : /YMax/.test(align) ? 1 : 0;
    return [s, 0, 0, s, (w - vb[2] * s) * ax - vb[0] * s, (h - vb[3] * s) * ay - vb[1] * s];
  }

  // ---------- Import ----------
  function importSvg(markup, options = {}) {
    const warnings = [];
    try {
      return { ok: true, ...flatten(String(markup || ""), options, warnings), warnings };
    } catch (error) {
      if (error instanceof Unsupported)
        return { ok: false, reason: `SVG uses ${error.message}`, warnings };
      return { ok: false, reason: `SVG could not be read as vectors: ${error.message}`, warnings };
    }
  }
  function flatten(markup, options, warnings) {
    const G = V();
    const tree = parse(markup);
    const svg = (function first(el) {
      for (const c of el.children) {
        if (c.tag === "svg") return c;
        const f = first(c);
        if (f) return f;
      }
      return null;
    })(tree);
    if (!svg) throw new Error("no <svg> element");
    const rules = styleRules(svg, warnings);
    const ids = new Map();
    (function index(el) {
      if (el.attrs.id && !ids.has(el.attrs.id)) ids.set(el.attrs.id, el);
      el.children.forEach(index);
    })(svg);
    const box = numbers(svg.attrs.viewBox);
    const declared = declarations(svg.attrs.style);
    let width = length(options.width ?? declared.width ?? svg.attrs.width, 0, NaN),
      height = length(options.height ?? declared.height ?? svg.attrs.height, 0, NaN);
    const hasBox = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0;
    if (!(width > 0)) width = hasBox ? (height > 0 ? (height * box[2]) / box[3] : box[2]) : 300;
    if (!(height > 0)) height = hasBox ? (width * box[3]) / box[2] : 150;
    const vb = hasBox ? box : [0, 0, width, height];
    // The layer draws its viewBox stretched over its box, so the viewBox is the region the viewport really shows.
    const fit = viewportMatrix(vb, width, height, svg.attrs.preserveAspectRatio);
    const inv = G.invert(fit);
    const tl = G.applyPoint(inv, 0, 0),
      br = G.applyPoint(inv, width, height);
    const viewBox = [tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]];
    const unit = Math.sqrt(Math.abs((width / viewBox[2]) * (height / viewBox[3]))); // layer px per viewBox unit
    const shapes = [];
    let segments = 0;
    const current = options.color || "#000000";

    const walk = (el, inherited, matrix, opacity, depth, refs) => {
      const own = ownStyle(el, rules);
      if (own.display === "none") return;
      if (own.filter && own.filter !== "none") throw new Unsupported("filters");
      if (own.mask && own.mask !== "none") throw new Unsupported("masks");
      if (own["clip-path"] && own["clip-path"] !== "none") throw new Unsupported("clip paths");
      const style = { ...inherited };
      for (const key of INHERITED)
        if (own[key] !== undefined && own[key] !== "inherit") style[key] = own[key];
      let m = matrix;
      const transform =
        el.attrs.transform ?? (own.transform && own.transform !== "none" ? own.transform : "");
      if (transform) m = G.multiply(m, G.parseTransform(transform));
      const alpha = opacity * fraction(own.opacity);
      if (UNSUPPORTED[el.tag]) throw new Unsupported(UNSUPPORTED[el.tag]);
      if (el.tag === "use") {
        const ref = String(el.attrs.href ?? el.attrs["xlink:href"] ?? "").replace(/^#/, "");
        const target = ids.get(ref);
        if (!target || depth >= CAPS.useDepth || refs.has(ref)) {
          warnings.push(`<use> of "${ref.slice(0, 60)}" was skipped`);
          return;
        }
        const placed = G.multiply(m, [
          1,
          0,
          0,
          1,
          length(el.attrs.x, vb[2]),
          length(el.attrs.y, vb[3]),
        ]);
        const next = new Set(refs).add(ref);
        if (target.tag === "symbol" || target.tag === "svg") {
          const w = length(el.attrs.width ?? target.attrs.width, vb[2], NaN),
            h = length(el.attrs.height ?? target.attrs.height, vb[3], NaN);
          const sb = numbers(target.attrs.viewBox);
          const inner =
            sb.length === 4 && w > 0 && h > 0
              ? G.multiply(placed, viewportMatrix(sb, w, h, target.attrs.preserveAspectRatio))
              : placed;
          for (const c of target.children) walk(c, style, inner, alpha, depth + 1, next);
        } else walk(target, style, placed, alpha, depth + 1, next);
        return;
      }
      if (el !== svg && el.tag === "svg") {
        // A nested viewport: positioned at x/y and mapped from its own viewBox.
        const w = length(el.attrs.width, vb[2], vb[2]),
          h = length(el.attrs.height, vb[3], vb[3]);
        const sb = numbers(el.attrs.viewBox);
        m = G.multiply(m, [1, 0, 0, 1, length(el.attrs.x, vb[2]), length(el.attrs.y, vb[3])]);
        if (sb.length === 4 && sb[2] > 0 && sb[3] > 0)
          m = G.multiply(m, viewportMatrix(sb, w, h, el.attrs.preserveAspectRatio));
      }
      if (CONTAINERS.has(el.tag) && (el === svg || el.tag !== "symbol")) {
        const kids = el.tag === "switch" ? el.children.slice(0, 1) : el.children;
        for (const c of kids) walk(c, style, m, alpha, depth, refs);
        return;
      }
      if (SKIPPED.has(el.tag) || !SHAPES.has(el.tag)) {
        if (!SKIPPED.has(el.tag) && el.tag !== "#root") warnings.push(`<${el.tag}> was skipped`);
        return;
      }
      if (style.visibility === "hidden" || style.visibility === "collapse") return;
      const d = shapePath(el, vb);
      if (!d.trim()) return;
      const segs = G.transformSegments(G.parsePath(d), m);
      segments += segs.length;
      if (segments > CAPS.segments)
        throw new Unsupported(`more than ${CAPS.segments} path segments`);
      if (shapes.length >= CAPS.shapes) throw new Unsupported(`more than ${CAPS.shapes} shapes`);
      const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      const fill =
        el.tag === "line" || el.tag === "polyline"
          ? style.fill === undefined
            ? { none: el.tag === "line" }
            : color(style.fill, style.color || current)
          : color(style.fill ?? "#000000", style.color || current);
      const stroke = color(style.stroke ?? "none", style.color || current);
      const pixel = options.pixelStrokes || own["vector-effect"] === "non-scaling-stroke";
      const strokeWidth = stroke.none
        ? 0
        : Math.max(0, length(style["stroke-width"], Math.hypot(vb[2], vb[3]) / Math.SQRT2, 1)) *
          (pixel ? 1 : scale * unit);
      const dash =
        style["stroke-dasharray"] && style["stroke-dasharray"] !== "none"
          ? numbers(style["stroke-dasharray"])
          : null;
      const fo = (fill.alpha ?? 1) * fraction(style["fill-opacity"]) * alpha,
        so = (stroke.alpha ?? 1) * fraction(style["stroke-opacity"]) * alpha;
      shapes.push({
        d: G.serializePath(segs),
        fillRule: style["fill-rule"] === "evenodd" ? "evenodd" : undefined,
        style: {
          fill:
            fill.none || fo <= 0 ? null : { color: fill.hex, opacity: Math.round(fo * 1000) / 10 },
          stroke:
            stroke.none || so <= 0 || !(strokeWidth > 0)
              ? null
              : {
                  color: stroke.hex,
                  opacity: Math.round(so * 1000) / 10,
                  width: Math.round(strokeWidth * 1000) / 1000,
                  cap: ["round", "square"].includes(style["stroke-linecap"])
                    ? style["stroke-linecap"]
                    : undefined,
                  join: ["round", "bevel"].includes(style["stroke-linejoin"])
                    ? style["stroke-linejoin"]
                    : undefined,
                  miter:
                    Number(style["stroke-miterlimit"]) > 0 &&
                    Number(style["stroke-miterlimit"]) !== 4
                      ? Number(style["stroke-miterlimit"])
                      : undefined,
                  dash:
                    dash &&
                    dash.length &&
                    dash.every((v) => Number.isFinite(v) && v >= 0) &&
                    dash.some((v) => v > 0)
                      ? dash
                          .slice(0, 16)
                          .map((v) => Math.round(v * (pixel ? 1 : scale * unit) * 1000) / 1000)
                      : undefined,
                },
        },
      });
    };
    walk(svg, {}, G.IDENTITY, 1, 0, new Set());
    // Consecutive shapes with the same paint share a layer (a layer holds at most LIMITS.paths paths).
    const layers = [];
    for (const s of shapes) {
      if (!s.style.fill && !s.style.stroke) continue;
      const key = JSON.stringify(s.style),
        last = layers[layers.length - 1];
      const path = s.fillRule ? { d: s.d, fillRule: s.fillRule } : { d: s.d };
      if (
        last &&
        last.key === key &&
        last.paths.length < G.LIMITS.paths &&
        last.chars + s.d.length <= G.LIMITS.totalChars
      ) {
        last.paths.push(path);
        last.chars += s.d.length;
      } else layers.push({ key, style: s.style, paths: [path], chars: s.d.length });
      if (s.d.length > G.LIMITS.pathChars)
        throw new Unsupported("a path longer than a vector layer holds");
    }
    if (!layers.length) throw new Unsupported("no visible shapes");
    if (layers.length > CAPS.layers)
      throw new Unsupported(`more than ${CAPS.layers} differently painted shape groups`);
    return {
      width,
      height,
      viewBox,
      layers: layers.map(({ style, paths }) => ({ style, paths })),
    };
  }

  // ---------- Nodes ----------
  const hex2 = (opacity) =>
    opacity >= 100
      ? ""
      : Math.round((Math.max(0, opacity) / 100) * 255)
          .toString(16)
          .padStart(2, "0");
  /** A layer's paint as vector node fields (the document's fill/stroke model); `scale` multiplies stroke lengths. */
  function styleFields(style, scale = 1) {
    const r3 = (v) => Math.round(v * scale * 1000) / 1000;
    const out = {};
    if (!style.fill) out.fills = [];
    else if (style.fill.opacity < 100)
      out.fills = [{ type: "solid", color: style.fill.color, opacity: style.fill.opacity }];
    else out.color = style.fill.color;
    if (style.stroke) {
      out.strokeWidth = r3(style.stroke.width);
      out.strokeColor = style.stroke.color + hex2(style.stroke.opacity);
      if (style.stroke.cap) out.strokeCap = style.stroke.cap;
      if (style.stroke.join) out.strokeJoin = style.stroke.join;
      if (style.stroke.miter) out.strokeMiter = Math.min(100, Math.max(1, style.stroke.miter));
      if (style.stroke.dash) out.strokeDash = style.stroke.dash.map(r3);
    } else out.strokeWidth = 0;
    if (!out.color) out.color = style.fill?.color || "transparent";
    return out;
  }
  function toNodes(result, { name = "Vector", x = 0, y = 0, w, h, uid, parentId = null } = {}) {
    const G = V();
    const W = w > 0 ? w : result.width,
      H = h > 0 ? h : result.height;
    // Strokes were measured at the SVG's own size; a layer drawn larger or smaller scales them with the drawing.
    const k = Math.sqrt((W / result.width) * (H / result.height)) || 1;
    const base = (extra) => ({
      type: "vector",
      name,
      x,
      y,
      w: Math.max(1, W),
      h: Math.max(1, H),
      parentId,
      rotation: 0,
      opacity: 100,
      ...extra,
    });
    if (result.layers.length === 1) {
      const layer = result.layers[0];
      return [
        {
          id: uid(),
          ...base({ viewBox: result.viewBox, paths: layer.paths, ...styleFields(layer.style, k) }),
        },
      ];
    }
    const frame = {
      id: uid(),
      type: "frame",
      name,
      x,
      y,
      w: Math.max(1, W),
      h: Math.max(1, H),
      parentId,
      layout: "free",
      color: "transparent",
      clipContent: false,
      radius: 0,
      strokeWidth: 0,
      rotation: 0,
      opacity: 100,
    };
    const out = [frame];
    result.layers.forEach((layer, i) => {
      const draft = { x: 0, y: 0, w: frame.w, h: frame.h, viewBox: result.viewBox };
      const fitted = G.fitBox(draft, layer.paths) || { ...draft };
      out.push({
        id: uid(),
        type: "vector",
        name: `${name} ${i + 1}`,
        parentId: frame.id,
        x: fitted.x,
        y: fitted.y,
        w: Math.max(1, fitted.w),
        h: Math.max(1, fitted.h),
        viewBox: fitted.viewBox,
        paths: layer.paths,
        rotation: 0,
        opacity: 100,
        ...styleFields(layer.style, k),
      });
    });
    return out;
  }

  root.VerynizeVectorSvg = { CAPS, importSvg, toNodes, styleFields, parseXml: parse };
})(typeof globalThis !== "undefined" ? globalThis : window);
