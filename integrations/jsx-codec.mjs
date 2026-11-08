// Verynize JSX codec: a small reader/writer for the Tailwind JSX subset that agents use to
// read and write designs. It never evaluates code: attribute expressions are limited to string,
// number and boolean literals, and child expressions are limited to comments and string literals.
// Classes are resolved by the real Tailwind v4 engine (tailwind-map.mjs); the serializer writes
// flow-preserving Tailwind (flex/gap/p-*/w-full) and uses `absolute` only for absolute nodes.
import { NODE_LIMITS } from "./document-core.mjs";
import { parseClasses as mapClasses, cssVarForToken, GENERIC_FAMILIES } from "./tailwind-map.mjs";
import {
  paletteName,
  fontSizeName,
  fontSizeLineHeight,
  radiusName,
  shadowName,
  weightName,
  trackingName,
  leadingName,
  containerName,
} from "./tailwind-engine.mjs";
import { cssColorToHex } from "./codec-css.mjs";
import { effectsOf } from "./node-style.mjs";
import { parseCalc, BLOCK_ALIGN, trackWeight } from "./node-style.mjs";
import { paintAttrs } from "./paints.mjs";
import { shaderJsxAttrs } from "./shaders.mjs";
import { baselineTextStyle, TEXT_DEFAULTS } from "./codec-text.mjs";
import { residualAttr } from "./codec-residual.mjs";
import { vectorAttrs, vectorPaths } from "./vector-jsx.mjs";

export { cssVarForToken };

export const NODE_DEFAULTS = Object.freeze({
  type: "rectangle",
  parentId: null,
  name: "Rectangle",
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  color: "#d9d9d9",
  text: "",
  fontSize: 16,
  radius: 0,
  zIndex: 0,
  fontFamily: "system-ui",
  fontWeight: "400",
  textAlign: "left",
  layout: "free",
  direction: "row",
  gap: 0,
  padding: 0,
  columns: 2,
  token: "",
  gradient: "",
  mask: "",
  animated: "",
  textRuns: [],
  shaderPreset: "aurora",
  shaderSpeed: 1,
  shaderIntensity: 1,
  rotation: 0,
  opacity: 100,
  strokeWidth: 0,
  strokeColor: "#000000",
  shadow: "",
  clipContent: false,
  lineHeight: 1.15,
  letterSpacing: 0,
  alignItems: "stretch",
  justifyContent: "flex-start",
});

// ---------------------------------------------------------------------------------------------
// Small helpers

const round = (value) => Math.round(Number(value) * 100) / 100;
const close = (a, b, eps = 0.002) => Math.abs(Number(a) - Number(b)) < eps;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, body) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}
const escapeText = (text) =>
  text.replace(
    /[&<>{}]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "{": "&#123;", "}": "&#125;" })[c],
  );
const escapeAttr = (text) =>
  String(text).replace(
    /[&"<>]/g,
    (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c],
  );
// Tailwind arbitrary values use "_" for spaces; a literal underscore is written "\_".
const toArbitrary = (value) => String(value).replace(/_/g, "\\_").replace(/\s+/g, "_");

const NAMED_COLORS = { white: "#ffffff", black: "#000000" };
/** Normalize a color to #rrggbb (alpha dropped) — used for design tokens, which are opaque hex. */
export function normalizeColor(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "transparent") return "transparent";
  if (NAMED_COLORS[v]) return NAMED_COLORS[v];
  const hex = cssColorToHex(v);
  if (!hex || hex === "transparent") return hex && v.startsWith("#") ? "#000000" : hex;
  return hex.slice(0, 7);
}

/**
 * Parse a className string with the Tailwind v4 engine. Returns {props, has, ignored, warnings,
 * w, h, minW, maxW, minH, maxH, top, right, bottom, left, absolute, italic, margin, translate}.
 * `ignored` lists every class that was not (fully) applied, in source order; `warnings` explains why.
 */
export function parseClasses(className, options = {}) {
  const spec = mapClasses(className, options);
  const order = String(className || "")
    .split(/\s+/)
    .filter(Boolean);
  spec.ignored.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return spec;
}

/**
 * CSS auto sizing for an element without width/height classes, given its parent. The codec stores
 * these as wMode/hMode so the renderer reflows (hug = fit content, fill = stretch to parent).
 */
export function defaultSizing(node, parent) {
  const canHug = node.type === "text" || node.type === "frame";
  const h = canHug ? "hug" : "fixed";
  if (!parent) return { w: "fixed", h };
  const freeParent = !parent.layout || parent.layout === "free";
  // Absolute children of flow frames, and children of free frames anchored by insets (constraints).
  if (
    freeParent
      ? Array.isArray(node.inset) && node.inset.some((v) => v !== null && v !== undefined)
      : node.position === "absolute"
  ) {
    const inset = Array.isArray(node.inset) ? node.inset : [];
    const set = (i) => inset[i] !== null && inset[i] !== undefined;
    return {
      w: set(1) && set(3) ? "fill" : canHug ? "hug" : "fixed",
      h: set(0) && set(2) ? "fill" : h,
    };
  }
  if (!parent.layout || parent.layout === "free") return { w: canHug ? "hug" : "fixed", h };
  if (node.type === "image" || node.type === "shader" || node.type === "vector")
    return { w: "fixed", h: "fixed" };
  if (parent.layout === "flex" && parent.direction !== "column")
    return { w: canHug ? "hug" : "fixed", h };
  // Inline-level tags (span, a, button…) shrink to fit in block flow, like inline-block.
  if (
    (parent.layout === "block" || parent.layout === "inline") &&
    canHug &&
    INLINE_TAGS.has(node.htmlTag) &&
    node.layout !== "block"
  )
    return { w: "hug", h };
  // Block alignment (justify-items start/center/end): auto-width children shrink to fit, like justify-self in block flow.
  if (parent.layout === "block" && BLOCK_ALIGN[parent.justifyItems])
    return { w: canHug ? "hug" : "fixed", h };
  if (parent.layout === "flex") {
    const align =
      node.alignSelf && node.alignSelf !== "auto" ? node.alignSelf : parent.alignItems || "stretch";
    return { w: align === "stretch" ? "fill" : canHug ? "hug" : "fixed", h };
  }
  return { w: "fill", h }; // block, inline and grid cells stretch horizontally
}
/** Calculate sizing -> `w-[calc(100%_-_24px)]` (an invalid expression falls back to the measured px). */
const calcClass = (prefix, expr, px) => {
  const c = parseCalc(expr);
  return c ? `${prefix}-[calc(${c.text.replace(/ /g, "_")})]` : `${prefix}-[${round(px)}px]`;
};
const INLINE_TAGS = new Set([
  "span",
  "a",
  "button",
  "label",
  "small",
  "strong",
  "em",
  "code",
  "b",
  "i",
]);
export const isFlexRow = (parent) =>
  !!parent && parent.layout === "flex" && parent.direction !== "column";

// ---------------------------------------------------------------------------------------------
// Node -> Tailwind classes

/** Spacing value -> Tailwind suffix ("4", "0.5", "px", "[13px]"). */
/** grid-cols-N / grid-rows-N, or an arbitrary list of Fill tracks when the fr weights differ. */
const gridTrackClass = (axis, count, sizes) => {
  const weights = Array.from({ length: count }, (_, i) => trackWeight(sizes, i));
  return weights.every((w) => w === 1)
    ? `grid-${axis}-${count}`
    : `grid-${axis}-[${weights.map((w) => `minmax(0,${w}fr)`).join("_")}]`;
};
const space = (px) => {
  const v = Math.abs(Number(px));
  if (v === 1) return "px";
  if (Number.isInteger(v) && v % 2 === 0) return String(v / 4);
  return `[${round(v)}px]`;
};
const signed = (prefix, px) =>
  Number(px) < 0 ? `-${prefix}-${space(px)}` : `${prefix}-${space(px)}`;
const FRACTIONS = {
  50: "1/2",
  33.333: "1/3",
  66.667: "2/3",
  25: "1/4",
  75: "3/4",
  20: "1/5",
  40: "2/5",
  60: "3/5",
  80: "4/5",
  16.667: "1/6",
  83.333: "5/6",
  100: "full",
};
const pctSuffix = (pct) => {
  for (const [k, v] of Object.entries(FRACTIONS)) if (close(k, pct, 0.01)) return v;
  return `[${round(pct)}%]`;
};
const lengthSuffix = (value) =>
  typeof value === "string" && value.endsWith("%")
    ? pctSuffix(Number(value.slice(0, -1)))
    : space(value);

/** Four-sided shorthand: p / px,py / pt,pr,pb,pl. */
function sides(prefix, values, valueClass) {
  const [t, r, b, l] = values;
  const cls = (p, v) => valueClass(p, v);
  if (t === r && r === b && b === l) return t === 0 ? [] : [cls(prefix, t)];
  const out = [];
  if (t === b && l === r) {
    if (l !== 0) out.push(cls(prefix + "x", l));
    if (t !== 0) out.push(cls(prefix + "y", t));
    return out;
  }
  if (l === r) {
    if (l !== 0) out.push(cls(prefix + "x", l));
  } else {
    if (r !== 0) out.push(cls(prefix + "r", r));
    if (l !== 0) out.push(cls(prefix + "l", l));
  }
  if (t === b) {
    if (t !== 0) out.push(cls(prefix + "y", t));
  } else {
    if (t !== 0) out.push(cls(prefix + "t", t));
    if (b !== 0) out.push(cls(prefix + "b", b));
  }
  return out;
}

/** colorClass with an explicit `color:` hint for variables (border/outline arbitrary values are otherwise read as widths). */
function typedColorClass(prefix, color, token, tokens) {
  if (token && tokens[token] !== undefined)
    return `${prefix}-[color:var(${cssVarForToken(token)})]`;
  return colorClass(prefix, color, "", tokens);
}
function colorClass(prefix, color, token, tokens) {
  if (token && tokens[token] !== undefined) return `${prefix}-[var(${cssVarForToken(token)})]`;
  if (color === "transparent") return `${prefix}-transparent`;
  const hex = cssColorToHex(String(color));
  if (!hex) return `${prefix}-[${toArbitrary(color)}]`;
  if (hex === "transparent") return `${prefix}-transparent`;
  const name = paletteName(hex.slice(0, 7));
  if (name && hex.length === 7) return `${prefix}-${name}`;
  if (name) {
    const alpha = parseInt(hex.slice(7), 16),
      pct = Math.round((alpha / 255) * 100);
    if (Math.abs(Math.round((pct / 100) * 255) - alpha) <= 1) return `${prefix}-${name}/${pct}`;
  }
  return `${prefix}-[${hex}]`;
}

function familyClass(family) {
  for (const [name, legacy] of Object.entries(GENERIC_FAMILIES))
    if (family === legacy) return `font-${name}`;
  if (!family.includes(",")) return `font-['${toArbitrary(family.replace(/'/g, ""))}']`;
  return `[font-family:${toArbitrary(family)}]`;
}
function sizeClass(fontSize, withLeading) {
  const name = fontSizeName(fontSize);
  return name && withLeading
    ? { cls: `text-${name}`, leading: fontSizeLineHeight(name) }
    : { cls: `text-[${round(fontSize)}px]`, leading: undefined };
}
function leadingClass(ratio, fontSize) {
  const named = leadingName(ratio);
  if (named) return `leading-${named}`;
  const px = ratio * fontSize;
  if (Math.abs(px - Math.round(px)) < 0.05 && Math.round(px) % 2 === 0)
    return `leading-${Math.round(px) / 4}`;
  return `leading-[${Math.round(ratio * 1000) / 1000}]`;
}
function trackingClass(px, fontSize) {
  const named = trackingName(px / (fontSize || 16));
  return named ? `tracking-${named}` : `tracking-[${round(px)}px]`;
}

/** Classes for a resolved text style compared with what the element would inherit. */
function textClasses(style, baseline, tokens, own = new Set()) {
  const c = [];
  // Keys the text declares itself (styleOwn) are written even when they equal the inherited value.
  if (own.size) {
    baseline = { ...baseline };
    for (const key of own)
      if (key !== "textWrap" || style.textWrap) baseline[key] = key === "color" ? undefined : NaN;
    if (own.has("color")) baseline.token = undefined;
  }
  if (
    style.color !== undefined &&
    (style.color !== baseline.color || (style.token || "") !== (baseline.token || ""))
  )
    c.push(colorClass("text", style.color, style.token, tokens));
  // lineHeight 'auto' (inspector "Auto") is CSS `normal`: leading-[normal].
  const autoLeading = style.lineHeight === "auto";
  let leadingSet = baseline.lineHeight;
  if (style.fontSize !== undefined && !close(style.fontSize, baseline.fontSize, 0.01)) {
    // A size declared without its own leading must not bring Tailwind's implied leading (text-2xl sets both).
    const { cls, leading } = sizeClass(
      style.fontSize,
      style.lineHeight !== undefined && !(own.has("fontSize") && !own.has("lineHeight")),
    );
    if (
      !autoLeading &&
      leading !== undefined &&
      style.lineHeight !== undefined &&
      !close(style.lineHeight, leading, 0.003)
    ) {
      // Tailwind's size/leading shorthand: text-sm/6, text-5xl/tight.
      const named = leadingName(style.lineHeight),
        px = style.lineHeight * style.fontSize;
      if (named) {
        c.push(`${cls}/${named}`);
        leadingSet = style.lineHeight;
      } else if (Math.abs(px - Math.round(px)) < 0.05 && Math.round(px) % 2 === 0) {
        c.push(`${cls}/${Math.round(px) / 4}`);
        leadingSet = style.lineHeight;
      } else {
        c.push(cls);
        leadingSet = leading;
      }
    } else {
      c.push(cls);
      if (leading !== undefined) leadingSet = leading;
    }
  }
  if (autoLeading) {
    if (leadingSet !== "auto") c.push("leading-[normal]");
  } else if (style.lineHeight !== undefined && !close(style.lineHeight, leadingSet, 0.003))
    c.push(leadingClass(style.lineHeight, style.fontSize ?? baseline.fontSize));
  if (style.fontWeight !== undefined && String(style.fontWeight) !== String(baseline.fontWeight)) {
    const name = weightName(String(style.fontWeight));
    c.push(name ? `font-${name}` : `font-[${style.fontWeight}]`);
  }
  if (style.fontFamily !== undefined && style.fontFamily !== baseline.fontFamily)
    c.push(familyClass(style.fontFamily));
  if (
    style.letterSpacing !== undefined &&
    !close(style.letterSpacing, baseline.letterSpacing, 0.02)
  )
    c.push(trackingClass(style.letterSpacing, style.fontSize ?? baseline.fontSize));
  if (style.textAlign !== undefined && style.textAlign !== baseline.textAlign)
    c.push(`text-${style.textAlign}`);
  if (style.textTransform !== undefined && style.textTransform !== baseline.textTransform)
    c.push(style.textTransform || "normal-case");
  if (style.textDecoration !== undefined && style.textDecoration !== baseline.textDecoration)
    c.push(style.textDecoration || "no-underline");
  if (style.fontStyle !== undefined && style.fontStyle !== baseline.fontStyle)
    c.push(style.fontStyle === "italic" ? "italic" : "not-italic");
  if (style.textWrap !== undefined && style.textWrap !== baseline.textWrap && style.textWrap)
    c.push(`text-${style.textWrap}`);
  return c;
}

/** Classes for the inheritable text declarations stored on a frame (`textStyle`). */
function declaredTextClasses(style, tokens) {
  const c = [];
  if (style.color !== undefined) c.push(colorClass("text", style.color, style.token, tokens));
  const hasLeading = style.lineHeight !== undefined || style.lineHeightPx !== undefined;
  let implied,
    sizeAt = -1;
  if (style.fontSize !== undefined) {
    const { cls, leading } = sizeClass(style.fontSize, hasLeading);
    sizeAt = c.push(cls) - 1;
    implied = leading;
  }
  // Leading suffix: combined with a named size as text-sm/6 or text-5xl/tight when possible.
  const suffix = (value, separate) => {
    if (implied !== undefined && sizeAt >= 0) c[sizeAt] += `/${value}`;
    else c.push(separate);
  };
  if (style.lineHeightPx !== undefined) {
    const px = style.lineHeightPx;
    if (implied === undefined || !close(implied * style.fontSize, px, 0.05)) {
      if (Number.isInteger(px) && px % 2 === 0) suffix(px / 4, `leading-${px / 4}`);
      else c.push(`leading-[${round(px)}px]`);
    }
  } else if (style.lineHeight === "auto") c.push("leading-[normal]");
  else if (
    style.lineHeight !== undefined &&
    (implied === undefined || !close(implied, style.lineHeight, 0.003))
  ) {
    const named = leadingName(style.lineHeight);
    if (named) suffix(named, `leading-${named}`);
    else c.push(`leading-[${Math.round(style.lineHeight * 1000) / 1000}]`);
  }
  if (style.fontWeight !== undefined) {
    const name = weightName(String(style.fontWeight));
    c.push(name ? `font-${name}` : `font-[${style.fontWeight}]`);
  }
  if (style.fontFamily !== undefined) c.push(familyClass(style.fontFamily));
  if (style.letterSpacingEm !== undefined) {
    const named = trackingName(style.letterSpacingEm);
    c.push(named ? `tracking-${named}` : `tracking-[${style.letterSpacingEm}em]`);
  } else if (style.letterSpacing !== undefined)
    c.push(`tracking-[${round(style.letterSpacing)}px]`);
  if (style.textAlign !== undefined) c.push(`text-${style.textAlign}`);
  if (style.textTransform !== undefined) c.push(style.textTransform || "normal-case");
  if (style.textDecoration !== undefined) c.push(style.textDecoration || "no-underline");
  if (style.fontStyle !== undefined) c.push(style.fontStyle === "italic" ? "italic" : "not-italic");
  if (style.textWrap) c.push(`text-${style.textWrap}`);
  return c;
}

function classesFor(node, { parent, isRoot, tokens, ancestors }) {
  const c = [];
  const freeParent = !isRoot && (!parent || !parent.layout || parent.layout === "free");
  // Children of free frames with constraints (insets) export their anchoring; the rest keep left/top from x/y.
  const anchoredFree =
    freeParent &&
    !!parent &&
    Array.isArray(node.inset) &&
    node.inset.some((v) => v !== null && v !== undefined);
  const positionedFree = freeParent && !anchoredFree;
  const absolute = !isRoot && !positionedFree && (anchoredFree || node.position === "absolute");
  if (positionedFree) c.push("absolute", `left-[${round(node.x)}px]`, `top-[${round(node.y)}px]`);
  if (absolute) {
    c.push("absolute");
    const inset = Array.isArray(node.inset) ? node.inset : [null, null, null, null];
    const names = ["top", "right", "bottom", "left"];
    const has = inset.map((v) => v !== null && v !== undefined);
    if (has.every(Boolean) && inset.every((v) => v === inset[0]))
      c.push(insetClass("inset", inset[0]));
    else
      inset.forEach((v, i) => {
        if (has[i]) c.push(insetClass(names[i], v));
      });
    const tr = Array.isArray(node.translate) ? node.translate : [0, 0];
    ["x", "y"].forEach((axis, i) => {
      const v = tr[i];
      if (!v) return;
      if (typeof v === "string") {
        const pct = Number(v.slice(0, -1));
        c.push(`${pct < 0 ? "-" : ""}translate-${axis}-${pctSuffix(Math.abs(pct))}`);
      } else c.push(`${v < 0 ? "-" : ""}translate-${axis}-${space(v)}`);
    });
  }
  // Layout
  if (node.type === "frame") {
    const layout = node.layout || "free";
    if (layout === "flex") {
      c.push("flex");
      if (node.direction === "column") c.push(node.reverse ? "flex-col-reverse" : "flex-col");
      else if (node.reverse) c.push("flex-row-reverse");
      if (node.flexWrap) c.push("flex-wrap");
    } else if (layout === "grid") {
      c.push(
        "grid",
        gridTrackClass("cols", Math.max(1, Math.floor(node.columns) || 2), node.columnSizes),
      );
      if (Number(node.rows) >= 1)
        c.push(gridTrackClass("rows", Math.floor(node.rows), node.rowSizes));
    } else if (layout === "inline") c.push("inline-flow");
    else if (layout === "free") c.push("layout-free");
    if (layout !== "free") {
      const gx = Number(node.gapX ?? node.gap) || 0,
        gy = Number(node.gapY ?? node.gap) || 0;
      if (layout === "flex" || layout === "grid") {
        if (gx === gy) {
          if (gx) c.push(`gap-${space(gx)}`);
        } else {
          if (gx) c.push(`gap-x-${space(gx)}`);
          if (gy) c.push(`gap-y-${space(gy)}`);
        }
      } else if (Number(node.gapY)) c.push(`space-y-${space(Number(node.gapY))}`);
      // Block alignment: justify-items on a block frame (children narrower than it sit left / centre / right).
      if (layout === "block" && BLOCK_ALIGN[node.justifyItems])
        c.push(`justify-items-${BLOCK_ALIGN[node.justifyItems]}`);
      if (layout === "flex" || layout === "grid") {
        const items = {
          "flex-start": "start",
          "flex-end": "end",
          center: "center",
          baseline: "baseline",
        }[node.alignItems];
        if (items) c.push(`items-${items}`);
        const justify = {
          "flex-end": "end",
          center: "center",
          "space-between": "between",
          "space-around": "around",
          "space-evenly": "evenly",
        }[node.justifyContent];
        if (justify) c.push(`justify-${justify}`);
        const cells = {
          "flex-start": "start",
          start: "start",
          "flex-end": "end",
          end: "end",
          center: "center",
          stretch: "stretch",
        }[node.justifyItems];
        if (layout === "grid" && cells) c.push(`justify-items-${cells}`);
      }
      c.push(
        ...sides(
          "p",
          [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft].map(
            (v) => Number(v ?? node.padding) || 0,
          ),
          (p, v) => `${p}-${space(v)}`,
        ),
      );
    }
  }
  // Size
  const def = defaultSizing(node, isRoot ? null : parent);
  const wm = node.wMode || "fixed",
    hm = node.hMode || "fixed";
  const row = !isRoot && !positionedFree && !absolute && isFlexRow(parent);
  const iconSquare =
    node.icon &&
    wm === "fixed" &&
    hm === "fixed" &&
    node.wPct === undefined &&
    node.hPct === undefined &&
    close(node.w, node.h, 0.01);
  if (iconSquare) c.push(`size-${space(node.w)}`);
  else if (wm === "fixed")
    c.push(node.wPct !== undefined ? `w-${pctSuffix(node.wPct)}` : `w-[${round(node.w)}px]`);
  else if (wm === "calc") c.push(calcClass("w", node.wCalc, node.w));
  else if (wm === "auto") c.push("w-auto");
  else if (wm === "fill" && row) {
    c.push("flex-1");
  } else if (wm !== def.w) c.push(wm === "fill" ? "w-full" : "w-fit");
  if (iconSquare) {
    /* size-* above */
  } else if (hm === "fixed")
    c.push(node.hPct !== undefined ? `h-${pctSuffix(node.hPct)}` : `h-[${round(node.h)}px]`);
  else if (hm === "calc") c.push(calcClass("h", node.hCalc, node.h));
  else if (hm === "auto") c.push("h-auto");
  else if (hm !== def.h) c.push(hm === "fill" ? "h-full" : "h-fit");
  const flexOne =
    wm === "fill" &&
    row &&
    (node.grow === undefined || node.grow === 1) &&
    (node.shrink === undefined || node.shrink === 1) &&
    (node.basis === undefined || node.basis === "0%");
  if ((!isRoot && isFlexRow(parent)) || parent?.layout === "flex") {
    if (!flexOne) {
      if (node.grow !== undefined && node.grow !== (wm === "fill" && row ? 1 : 0))
        c.push(node.grow === 1 ? "grow" : node.grow === 0 ? "grow-0" : `grow-[${node.grow}]`);
      const defShrink = wm === "hug" || wm === "auto" ? 1 : 0;
      if (node.shrink !== undefined && node.shrink !== defShrink)
        c.push(
          node.shrink === 0 ? "shrink-0" : node.shrink === 1 ? "shrink" : `shrink-[${node.shrink}]`,
        );
      if (node.basis !== undefined && !(wm === "fill" && row && node.basis === "0%"))
        c.push(`basis-${lengthSuffix(node.basis)}`);
    }
    const self = {
      "flex-start": "start",
      "flex-end": "end",
      center: "center",
      stretch: "stretch",
      baseline: "baseline",
    }[node.alignSelf];
    if (self) c.push(`self-${self}`);
  }
  if (node.colSpan !== undefined && parent?.layout === "grid")
    c.push(node.colSpan === "full" ? "col-span-full" : `col-span-${node.colSpan}`);
  if (node.rowSpan !== undefined && parent?.layout === "grid") c.push(`row-span-${node.rowSpan}`);
  for (const [key, prefix] of [
    ["minW", "min-w"],
    ["maxW", "max-w"],
    ["minH", "min-h"],
    ["maxH", "max-h"],
  ]) {
    const v = node[key];
    if (v === undefined || v === null) continue;
    if (typeof v === "string") c.push(`${prefix}-${pctSuffix(Number(v.slice(0, -1)))}`);
    else {
      const named = key === "maxW" ? containerName(v) : null;
      c.push(named ? `${prefix}-${named}` : `${prefix}-[${round(v)}px]`);
    }
  }
  if (node.aspectRatio)
    c.push(
      close(node.aspectRatio, 16 / 9, 0.002)
        ? "aspect-video"
        : close(node.aspectRatio, 1)
          ? "aspect-square"
          : `aspect-[${round(node.aspectRatio)}]`,
    );
  if (Array.isArray(node.margin)) {
    const m = node.margin.map((v) => (v === "auto" ? "auto" : Number(v) || 0));
    const margin = sides("m", m, (p, v) => (v === "auto" ? `${p}-auto` : signed(p, v)));
    c.push(...(margin.length ? margin : ["m-0"])); // an explicit zero margin is still stated
  }
  // Fill, typography
  if (node.type === "text") {
    // Tag defaults (h1 size/weight…) are written out so code read back states the real size.
    const baseline = { ...baselineTextStyle(node, ancestors) };
    const inherited = baselineTextStyle({ type: "text" }, ancestors);
    for (const key of ["fontSize", "fontWeight"])
      if (baseline[key] !== inherited[key]) baseline[key] = NaN;
    c.push(
      ...textClasses(
        {
          color: node.color ?? TEXT_DEFAULTS.color,
          token: node.token || "",
          fontSize: Number(node.fontSize ?? 16),
          lineHeight: node.lineHeight === "auto" ? "auto" : Number(node.lineHeight ?? 1.15),
          fontWeight: String(node.fontWeight ?? "400"),
          fontFamily: node.fontFamily ?? "system-ui",
          letterSpacing: Number(node.letterSpacing) || 0,
          textAlign: node.textAlign || "left",
          textTransform: node.textTransform || "",
          textDecoration: node.textDecoration || "",
          fontStyle: node.fontStyle || "",
          textWrap: node.textWrap || "",
        },
        baseline,
        tokens,
        new Set(Array.isArray(node.styleOwn) ? node.styleOwn : []),
      ),
    );
    if (node.truncate) c.push("truncate");
    else if (node.whiteSpace) c.push(`whitespace-${node.whiteSpace}`);
    else if (node.noWrap) c.push("whitespace-nowrap");
    // Type settings (absent = canvas default: top, pre-wrap, wrap anywhere, no indent, inherited smoothing).
    if (node.textAlignVertical === "center") c.push("content-center");
    else if (node.textAlignVertical === "bottom") c.push("content-end");
    if (node.wordBreak === "normal") c.push("break-normal");
    else if (node.wordBreak === "break-all") c.push("break-all");
    if (Number(node.textIndent)) c.push(signed("indent", node.textIndent));
    if (node.fontSmoothing === "antialiased") c.push("antialiased");
    else if (node.fontSmoothing === "subpixel-antialiased") c.push("subpixel-antialiased");
    if (Number(node.lineClamp) > 0) c.push(`line-clamp-${node.lineClamp}`);
  } else if (node.type !== "image" && node.type !== "vector") {
    const color = node.color ?? "#d9d9d9";
    if (node.type !== "frame" || node.token || (color !== "transparent" && color !== "#00000000"))
      c.push(colorClass("bg", color, node.token, tokens));
    if (node.gradient) c.push(`bg-[${toArbitrary(node.gradient)}]`);
  }
  if (node.type === "frame" && node.textStyle && typeof node.textStyle === "object")
    c.push(...declaredTextClasses(node.textStyle, tokens));
  if (node.type === "image" && node.objectFit) c.push(`object-${node.objectFit}`);
  if (node.type === "image" && node.icon && node.iconColor)
    c.push(colorClass("text", node.iconColor, "", tokens));
  // Shape and effects
  if (node.ellipse === true && node.type !== "text") c.push("rounded-[50%]");
  else if (
    Array.isArray(node.cornerRadii) &&
    node.cornerRadii.length === 4 &&
    !node.cornerRadii.every((v) => v === node.cornerRadii[0])
  ) {
    const [tl, tr, br, bl] = node.cornerRadii;
    const r = (p, v) => (v ? radiusClass(p, v) : null);
    const out =
      tl === tr && bl === br
        ? [r("rounded-t", tl), r("rounded-b", bl)]
        : tl === bl && tr === br
          ? [r("rounded-l", tl), r("rounded-r", tr)]
          : [r("rounded-tl", tl), r("rounded-tr", tr), r("rounded-br", br), r("rounded-bl", bl)];
    c.push(...out.filter(Boolean));
  } else if (Number(node.radius) && node.type !== "vector")
    c.push(radiusClass("rounded", Number(node.radius)));
  if (node.opacity !== undefined && Number(node.opacity) !== 100)
    c.push(
      Number.isInteger(node.opacity)
        ? `opacity-${node.opacity}`
        : `opacity-[${round(node.opacity)}%]`,
    );
  if (Number(node.rotation)) c.push(`rotate-[${round(node.rotation)}deg]`);
  if (node.flipX === true && node.flipY === true) c.push("-scale-100");
  else if (node.flipX === true) c.push("-scale-x-100");
  else if (node.flipY === true) c.push("-scale-y-100");
  // A hidden border (inspector eye) draws nothing, so it writes no classes; data-vn keeps it (codec-residual.mjs).
  // A vector's stroke follows its path and is written as SVG attributes instead.
  const strokeShown = node.strokeHidden !== true && node.type !== "vector";
  // A side hidden with its own eye (strokeHiddenSides) draws nothing either; data-vn keeps its width.
  const sideHidden = (i) =>
    Array.isArray(node.strokeHiddenSides) && node.strokeHiddenSides[i] === true;
  const widths =
    Array.isArray(node.strokeWidths) && node.strokeWidths.length === 4
      ? node.strokeWidths.map((v, i) => (sideHidden(i) ? 0 : Number(v)))
      : null;
  const sidesHidden = !!widths && [0, 1, 2, 3].some(sideHidden);
  if (!strokeShown || (sidesHidden && widths.every((v) => !v))) {
    /* no border classes */
  } else if (widths && (sidesHidden || !widths.every((v) => v === widths[0]))) {
    ["t", "r", "b", "l"].forEach((side, i) => {
      if (widths[i])
        c.push(
          widths[i] === 1
            ? `border-${side}`
            : Number.isInteger(widths[i])
              ? `border-${side}-${widths[i]}`
              : `border-${side}-[${round(widths[i])}px]`,
        );
    });
    c.push(typedColorClass("border", node.strokeColor || "#000000", node.strokeToken, tokens));
  } else if (Number(node.strokeWidth) > 0) {
    const w = Number(node.strokeWidth);
    c.push(
      w === 1 ? "border" : Number.isInteger(w) ? `border-${w}` : `border-[${round(w)}px]`,
      typedColorClass("border", node.strokeColor || "#000000", node.strokeToken, tokens),
    );
  }
  // Per-side border colours (top, right, bottom, left), each optionally bound to a colour variable.
  if (
    strokeShown &&
    Array.isArray(node.strokeColors) &&
    node.strokeColors.length === 4 &&
    (widths ? widths.some(Boolean) : Number(node.strokeWidth) > 0)
  )
    ["t", "r", "b", "l"].forEach((side, i) =>
      c.push(
        typedColorClass(
          `border-${side}`,
          node.strokeColors[i]?.color || node.strokeColor || "#000000",
          node.strokeColors[i]?.token,
          tokens,
        ),
      ),
    );
  if (
    strokeShown &&
    node.strokeStyle &&
    node.strokeStyle !== "solid" &&
    (widths ? widths.some(Boolean) : Number(node.strokeWidth) > 0)
  )
    c.push(`border-${node.strokeStyle}`);
  if (Number(node.ringWidth) > 0) {
    const w = Number(node.ringWidth);
    c.push(
      Number.isInteger(w) ? (w === 1 ? "ring-1" : `ring-${w}`) : `ring-[${round(w)}px]`,
      colorClass("ring", node.ringColor || "#000000", "", tokens),
    );
    if (node.ringInset) c.push("ring-inset");
  }
  // Structured effects (web/node-style.js effectsOf): hidden entries are not written; colors are resolved.
  const fx = effectsOf(node, tokens);
  if (fx.boxShadow.length)
    c.push(`shadow-[${toArbitrary([...fx.boxShadow, node.shadow].filter(Boolean).join(", "))}]`);
  else if (node.shadow) {
    const name = shadowName(node.shadow);
    c.push(name ? `shadow-${name}` : `shadow-[${toArbitrary(node.shadow)}]`);
  }
  if (fx.outline) {
    const { width: w, style, color, offset } = fx.outline;
    c.push(
      w === 1 ? "outline" : Number.isInteger(w) ? `outline-${w}` : `outline-[${round(w)}px]`,
      typedColorClass(
        "outline",
        node.outlineToken && tokens[node.outlineToken] !== undefined
          ? node.outlineColor || color
          : color,
        node.outlineToken,
        tokens,
      ),
    );
    if (style !== "solid") c.push(`outline-${style}`);
    if (offset)
      c.push(
        Number.isInteger(offset)
          ? `${offset < 0 ? "-" : ""}outline-offset-${Math.abs(offset)}`
          : `outline-offset-[${round(offset)}px]`,
      );
  }
  if (fx.filter.length || fx.drop.length)
    c.push(`[filter:${toArbitrary([...fx.filter, ...fx.drop].join(" "))}]`);
  if (fx.backdrop.length) c.push(`[backdrop-filter:${toArbitrary(fx.backdrop.join(" "))}]`);
  if (fx.textShadow.length) c.push(`[text-shadow:${toArbitrary(fx.textShadow.join(", "))}]`);
  if (fx.blend) c.push(`mix-blend-${fx.blend}`);
  if (node.clipContent && !(node.type === "text" && (node.truncate || Number(node.lineClamp) > 0)))
    c.push("overflow-hidden");
  if (Number(node.zIndex))
    c.push(Number(node.zIndex) < 0 ? `-z-${-node.zIndex}` : `z-${node.zIndex}`);
  if (fx.masks.length || node.mask)
    c.push(`[mask-image:${toArbitrary([...fx.masks, node.mask].filter(Boolean).join(", "))}]`);
  if (node.animated) c.push(`animate-[${node.animated}]`);
  if (node.hidden === true) c.push("hidden");
  // Variant classes (md:…, hover:…) recorded at import are written back after the base classes.
  if (typeof node.variantClasses === "string" && node.variantClasses.trim())
    c.push(...node.variantClasses.trim().split(/\s+/));
  return c.join(" ");
}
function radiusClass(prefix, px) {
  if (px >= 9999) return `${prefix}-full`;
  const name = radiusName(px);
  return name ? `${prefix}-${name}` : `${prefix}-[${round(px)}px]`;
}
function insetClass(prefix, value) {
  if (typeof value === "string") {
    const pct = Number(value.slice(0, -1));
    return `${pct < 0 ? "-" : ""}${prefix}-${pctSuffix(Math.abs(pct))}`;
  }
  return signed(prefix, value);
}
function richChildren(node) {
  const text = node.text || "",
    runs = Array.isArray(node.textRuns) ? node.textRuns : [];
  const encode = (value) => escapeText(value).split("\n").join("<br />");
  if (!runs.length) return encode(text);
  const points = [...new Set([0, text.length, ...runs.flatMap((r) => [r.start, r.end])])]
    .filter((p) => p >= 0 && p <= text.length)
    .sort((a, b) => a - b);
  let out = "";
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1],
      active = runs.filter((r) => r.start <= a && r.end >= b);
    let piece = encode(text.slice(a, b));
    const color = active.findLast((r) => r.color)?.color,
      size = active.findLast((r) => r.fontSize)?.fontSize;
    if (color || size)
      piece = `<span className="${[color ? `text-[${color}]` : "", size ? `text-[${size}px]` : ""].filter(Boolean).join(" ")}">${piece}</span>`;
    if (active.some((r) => r.italic)) piece = `<i>${piece}</i>`;
    if (active.some((r) => r.bold)) piece = `<b>${piece}</b>`;
    out += piece;
  }
  return out;
}

const DEFAULT_TAG = {
  frame: "div",
  rectangle: "div",
  text: "p",
  image: "img",
  shader: "Shader",
  vector: "svg",
};
const SAFE_TAGS = new Set([
  "div",
  "section",
  "header",
  "footer",
  "main",
  "nav",
  "aside",
  "article",
  "ul",
  "ol",
  "li",
  "form",
  "figure",
  "p",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "label",
  "a",
  "button",
  "small",
  "strong",
  "em",
  "blockquote",
  "code",
  "hr",
  "input",
]);
export const isSafeTag = (tag) => SAFE_TAGS.has(tag);
export const MAX_INLINE_SRC = 2048;

/**
 * Component links (web/component-core.js) as attributes, read back by design-edit.mjs:
 * data-component="true" on a main; data-instance-of="<main short id>" on an instance (the main's long id when it
 * is on another page); data-slot="<slot name>" on a slot frame, plus data-slot-state="default|modified" on the
 * copy of a slot inside an instance.
 */
export function componentAttrs(node, index) {
  const out = [];
  if (node.component === true && node.type === "frame") out.push('data-component="true"');
  if (typeof node.instanceOf === "string" && node.instanceOf) {
    const main = index.byId?.get(node.instanceOf);
    out.push(`data-instance-of="${escapeAttr(main ? index.shortId(main) : node.instanceOf)}"`);
  }
  if (node.slot === true) {
    out.push(`data-slot="${escapeAttr(node.slotName || node.name || "")}"`);
    const inInstance =
      typeof node.sourceId === "string" && node.sourceId && node.sourceId !== node.instanceOf;
    if (inInstance)
      out.push(
        `data-slot-state="${Array.isArray(node.overrides) && node.overrides.includes("children") ? "modified" : "default"}"`,
      );
  }
  return out;
}

/**
 * Serialize one node (and descendants up to `depth`) as Tailwind JSX.
 * `index` must provide children(id) and shortId(node).
 */
export function serializeNode(
  node,
  index,
  {
    depth = Infinity,
    tokens = {},
    indent = "",
    parent = null,
    isRoot = !node.parentId,
    full = false,
  } = {},
) {
  const icon = node.type === "image" && typeof node.icon === "string" && node.icon;
  const tag = icon
    ? "Icon"
    : node.type !== "image" &&
        node.type !== "shader" &&
        node.type !== "vector" &&
        node.htmlTag &&
        SAFE_TAGS.has(node.htmlTag)
      ? node.htmlTag
      : DEFAULT_TAG[node.type] || "div";
  const attrs = [
    `data-node-id="${escapeAttr(index.shortId(node))}"`,
    `data-node-label="${escapeAttr(node.name || "")}"`,
    ...componentAttrs(node, index),
  ];
  if (isRoot)
    attrs.push(`data-component-x="${round(node.x)}"`, `data-component-y="${round(node.y)}"`);
  if (icon) {
    attrs.push(`name="${escapeAttr(icon)}"`);
    if (Number(node.iconStrokeWidth) > 0)
      attrs.push(`strokeWidth={${round(node.iconStrokeWidth)}}`);
  } else if (node.type === "image") {
    // Embedded data wins; a remote URL not fetched yet is written back as-is.
    const src = node.src || node.srcRemote || "";
    if (node.svgColor) attrs.push(`data-svg-color="${escapeAttr(node.svgColor)}"`);
    if (node.svgColorToken) attrs.push(`data-svg-color-token="${escapeAttr(node.svgColorToken)}"`);
    attrs.push(
      `src="${escapeAttr(!full && src.length > MAX_INLINE_SRC ? `[embedded image ${Math.round(src.length / 1024)} KB]` : src)}"`,
      `alt="${escapeAttr(node.name || "")}"`,
    );
  }
  // Vector layers write their fill and stroke as SVG attributes (vector-jsx.mjs).
  if (node.type === "vector")
    attrs.push(...vectorAttrs(node), ...paintAttrs({ ...node, fills: undefined }, escapeAttr));
  else
    attrs.push(
      ...(full && Array.isArray(node.fills)
        ? [
            `data-fills="${escapeAttr(JSON.stringify(node.fills))}"`,
            ...paintAttrs({ ...node, fills: undefined }, escapeAttr),
          ]
        : paintAttrs(node, escapeAttr)),
    );
  if (node.type === "shader") attrs.push(...shaderJsxAttrs(node, escapeAttr));
  const ancestors = isRoot
    ? []
    : typeof index.ancestors === "function"
      ? index.ancestors(node)
      : parent
        ? [parent]
        : [];
  const classes = classesFor(node, { parent, isRoot, tokens, ancestors });
  if (classes) attrs.push(`className="${escapeAttr(classes)}"`);
  const residual = residualAttr(node);
  if (residual) attrs.push(residual);
  const open = `${indent}<${tag} ${attrs.join(" ")}`;
  if (node.type === "text") return `${open}>${richChildren(node)}</${tag}>`;
  if (node.type === "vector")
    return `${open}>\n${vectorPaths(node, { indent: indent + "  ", full })}\n${indent}</${tag}>`;
  if (node.type !== "frame") return `${open} />`;
  const children = index.children(node.id);
  if (!children.length) return `${open}></${tag}>`;
  if (depth <= 0)
    return `${open}>\n${indent}  {/* ${children.length} child element${children.length === 1 ? "" : "s"} not shown; raise depth to read them */}\n${indent}</${tag}>`;
  const inner = children
    .map((child) =>
      serializeNode(child, index, {
        depth: depth - 1,
        tokens,
        indent: indent + "  ",
        parent: node,
        isRoot: false,
        full,
      }),
    )
    .join("\n");
  return `${open}>\n${inner}\n${indent}</${tag}>`;
}

// ---------------------------------------------------------------------------------------------
// JSX text -> AST

export class JsxSyntaxError extends Error {}

/** Parse JSX source into an array of element ASTs. Leading import lines are ignored. */
export function parseJsx(
  source,
  { maxLength = 5_000_000, maxElements = NODE_LIMITS.perDocument } = {},
) {
  if (typeof source !== "string") throw new JsxSyntaxError("Code must be a string");
  if (source.length > maxLength)
    throw new JsxSyntaxError(`JSX parse stage exceeds ${maxLength} characters`);
  let src = source.replace(/^﻿/, "");
  const imports = [];
  src = src.replace(/^\s*import\s[^;\n]*?from\s*['"][^'"]+['"]\s*;?[ \t]*$/gm, (line) => {
    imports.push(line.trim());
    return "";
  });
  src = src.replace(/^\s*export\s+default\s+/m, "");
  let i = 0,
    count = 0;
  const fail = (message) => {
    const before = src.slice(0, i),
      line = before.split("\n").length,
      column = i - before.lastIndexOf("\n");
    throw new JsxSyntaxError(`${message} (line ${line}, column ${column})`);
  };
  const skipSpace = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const skipTrivia = () => {
    for (;;) {
      skipSpace();
      if (src.startsWith("{/*", i) || src.startsWith("{ /*", i)) {
        const end = src.indexOf("*/", i);
        if (end < 0) fail("Unterminated comment");
        i = end + 2;
        skipSpace();
        if (src[i] !== "}") fail("Expected } after comment");
        i++;
        continue;
      }
      if (src.startsWith("/*", i)) {
        const end = src.indexOf("*/", i);
        if (end < 0) fail("Unterminated comment");
        i = end + 2;
        continue;
      }
      if (src.startsWith("//", i)) {
        const end = src.indexOf("\n", i);
        i = end < 0 ? src.length : end + 1;
        continue;
      }
      if (src[i] === "(" || src[i] === ")" || src[i] === ";") {
        i++;
        continue;
      }
      return;
    }
  };
  const readName = () => {
    const m = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(src.slice(i, i + 200));
    if (!m) fail("Expected a tag or attribute name");
    i += m[0].length;
    return m[0];
  };
  const readString = (quote) => {
    const start = ++i;
    while (i < src.length && src[i] !== quote) {
      if (src[i] === "\\" && quote !== '"' && quote !== "'") i++;
      i++;
    }
    if (i >= src.length) fail("Unterminated string");
    return src.slice(start, i++);
  };
  const readJsString = (quote) => {
    let out = "";
    i++;
    while (i < src.length && src[i] !== quote) {
      if (src[i] === "\\") {
        const next = src[i + 1];
        out += next === "n" ? "\n" : next === "t" ? "\t" : next;
        i += 2;
        continue;
      }
      if (quote === "`" && src[i] === "$" && src[i + 1] === "{")
        fail("Template interpolation is not supported");
      out += src[i++];
    }
    if (i >= src.length) fail("Unterminated string");
    i++;
    return out;
  };
  const readExpression = () => {
    // Called with src[i] === '{'. Only literals are accepted; nothing is evaluated.
    i++;
    skipSpace();
    let value;
    if (src[i] === '"' || src[i] === "'" || src[i] === "`") value = readJsString(src[i]);
    else {
      const m = /^(-?\d*\.?\d+(?:e[+-]?\d+)?|true|false|null|undefined)/i.exec(
        src.slice(i, i + 64),
      );
      if (!m)
        fail(
          "Only string, number and boolean literals are supported inside { } (no JavaScript, .map() or variables; write repeated elements out explicitly)",
        );
      i += m[0].length;
      value =
        m[0] === "true"
          ? true
          : m[0] === "false"
            ? false
            : m[0] === "null" || m[0] === "undefined"
              ? null
              : Number(m[0]);
    }
    skipSpace();
    if (src[i] !== "}") fail("Expected } after literal");
    i++;
    return value;
  };
  const parseElement = () => {
    if (src[i] !== "<") fail("Expected an element starting with <");
    if (++count > maxElements)
      fail(
        `Import has at least ${count} elements; limit is ${maxElements}. Split the import across multiple pages or documents`,
      );
    i++;
    if (src[i] === ">") {
      i++;
      const children = parseChildren("");
      return { tag: "#fragment", attrs: {}, children, selfClosing: false };
    }
    const tag = readName();
    const attrs = {};
    for (;;) {
      skipSpace();
      if (src.startsWith("/>", i)) {
        i += 2;
        return { tag, attrs, children: [], selfClosing: true };
      }
      if (src[i] === ">") {
        i++;
        break;
      }
      if (src[i] === "{") {
        if (src.startsWith("{...", i)) fail("Spread attributes are not supported");
        fail("Unexpected { in tag");
      }
      const name = readName();
      skipSpace();
      if (src[i] !== "=") {
        attrs[name] = true;
        continue;
      }
      i++;
      skipSpace();
      if (src[i] === '"' || src[i] === "'") attrs[name] = decodeEntities(readString(src[i]));
      else if (src[i] === "{") attrs[name] = readExpression();
      else fail(`Expected a value for attribute ${name}`);
    }
    return { tag, attrs, children: parseChildren(tag), selfClosing: false };
  };
  let nesting = 0;
  const parseChildren = (tag) => {
    if (++nesting > 256) fail("JSX parse stage exceeds nesting limit 256");
    const children = [];
    for (;;) {
      if (i >= src.length) fail(`Missing closing tag </${tag || ""}>`);
      if (src.startsWith("</", i)) {
        i += 2;
        skipSpace();
        const name = src[i] === ">" ? "" : readName();
        skipSpace();
        if (src[i] !== ">") fail("Expected > in closing tag");
        i++;
        if (name !== tag) fail(`Closing tag </${name}> does not match <${tag}>`);
        nesting--;
        return children;
      }
      if (src[i] === "<") {
        children.push(parseElement());
        continue;
      }
      if (src[i] === "{") {
        let j = i + 1;
        while (/\s/.test(src[j])) j++;
        if (src.startsWith("/*", j)) {
          const end = src.indexOf("*/", j);
          if (end < 0) fail("Unterminated comment");
          i = end + 2;
          skipSpace();
          if (src[i] !== "}") fail("Expected } after comment");
          i++;
          continue;
        }
        const value = readExpression();
        if (value !== null && value !== false && value !== true)
          children.push({ text: String(value), literal: true });
        continue;
      }
      const start = i;
      while (i < src.length && src[i] !== "<" && src[i] !== "{") i++;
      const raw = src.slice(start, i);
      const text = jsxText(raw);
      if (text) children.push({ text: decodeEntities(text) });
    }
  };
  const elements = [];
  for (;;) {
    skipTrivia();
    if (i >= src.length) break;
    if (src[i] !== "<") fail("Expected JSX element");
    const el = parseElement();
    if (el.tag === "#fragment") elements.push(...el.children.filter((c) => c.tag));
    else elements.push(el);
  }
  return { elements, imports };
}

// React's JSX whitespace rule: trim each line, drop blank lines, join the rest with single spaces.
function jsxText(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  if (lines.length === 1) return raw;
  const kept = [];
  lines.forEach((line, index) => {
    let value = line.replace(/\t/g, " ");
    if (index > 0) value = value.replace(/^\s+/, "");
    if (index < lines.length - 1) value = value.replace(/\s+$/, "");
    if (value) kept.push(value);
  });
  return kept.join(" ");
}

const INLINE_TEXT_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "span",
  "br",
  "a",
  "small",
  "code",
  "u",
  "s",
  "mark",
  "sup",
  "sub",
]);
export function isTextOnly(el) {
  const visit = (node) =>
    node.text !== undefined || (INLINE_TEXT_TAGS.has(node.tag) && node.children.every(visit));
  return (
    el.children.every(visit) &&
    el.children.some(function has(node) {
      return node.text !== undefined ? node.text.trim().length > 0 : node.children.some(has);
    })
  );
}

/** Collect text and style runs from an element whose children are text and inline tags. */
export function collectText(el, { tokens = {} } = {}) {
  let text = "";
  const runs = [];
  const visit = (node, style) => {
    if (node.text !== undefined) {
      const start = text.length;
      text += node.text;
      if (text.length > start && (style.bold || style.italic || style.color || style.fontSize))
        runs.push({
          start,
          end: text.length,
          bold: !!style.bold,
          italic: !!style.italic,
          ...(style.color ? { color: style.color } : {}),
          ...(style.fontSize ? { fontSize: style.fontSize } : {}),
        });
      return;
    }
    if (node.tag === "br") {
      text += "\n";
      return;
    }
    const next = { ...style };
    if (node.tag === "b" || node.tag === "strong") next.bold = true;
    if (node.tag === "i" || node.tag === "em") next.italic = true;
    const cls = node.attrs?.className || node.attrs?.class;
    if (cls) {
      const spec = parseClasses(cls, { tokens });
      if (spec.props.ink && /^#[0-9a-f]{6}$/.test(spec.props.ink)) next.color = spec.props.ink;
      if (spec.props.fontSize) next.fontSize = Math.min(200, Math.max(8, spec.props.fontSize));
      if (Number(spec.props.fontWeight) >= 600) next.bold = true;
      if (spec.italic) next.italic = true;
    }
    for (const child of node.children) visit(child, next);
  };
  for (const child of el.children) visit(child, {});
  // Merge adjacent runs with identical styling.
  const merged = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (
      last &&
      last.end === run.start &&
      last.bold === run.bold &&
      last.italic === run.italic &&
      last.color === run.color &&
      last.fontSize === run.fontSize
    )
      last.end = run.end;
    else merged.push({ ...run });
  }
  return { text, runs: merged };
}
