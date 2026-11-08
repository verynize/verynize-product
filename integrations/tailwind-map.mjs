// Tailwind classes -> Verynize node properties, using CSS declarations produced by the real
// Tailwind v4 engine (tailwind-engine.mjs). Every class that cannot be represented is reported
// with a reason; nothing is dropped silently.
import { expand } from "./codec-css-cascade.mjs";
import { compileClass, sortClasses, resolveValue } from "./tailwind-engine.mjs";
import { lengthOf, cssColorToHex, normalizeColorsIn, splitTop, matchMedia } from "./codec-css.mjs";
import { BLEND_MODES, FILTERS } from "./node-style.mjs";
import { parseCalc } from "./node-style.mjs";

const FILTER_TYPES = {
  blur: "blur",
  brightness: "brightness",
  contrast: "contrast",
  grayscale: "grayscale",
  "hue-rotate": "hueRotate",
  invert: "invert",
  saturate: "saturate",
  sepia: "sepia",
};

// Mask layers with embedded images (url("data:image/…;base64,…")) become structured masks: image layers
// keep their data URL, other layers stay CSS gradients (type 'custom'). Anything else stays unsafe.
const MASK_DATA_URL =
  /^url\(\s*(["']?)(data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+)\1\s*\)$/;
function maskLayersOf(value) {
  const parts = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(value.slice(start).trim());
  const out = [];
  for (const part of parts) {
    const image = part.match(MASK_DATA_URL);
    if (image) out.push({ type: "image", src: image[2] });
    else if (/^(repeating-)?(linear|radial|conic)-gradient\(/i.test(part) && SAFE_CSS(part))
      out.push({ type: "custom", css: normalizeColorsIn(part) });
    else return null;
  }
  return out.some((m) => m.type === "image") && out.length <= 8 ? out : null;
}
export const cssVarForToken = (name) =>
  "--" +
  String(name)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
export const SAFE_CSS = (value) =>
  typeof value === "string" &&
  value.length <= 4000 &&
  !/[;{}<>\\]/.test(value) &&
  !/url\s*\(/i.test(value);
const round = (value) => Math.round(Number(value) * 1000) / 1000;
/** fr weights of a track list made only of Fill tracks (`minmax(0, Nfr)`), or null (1–100 tracks). */
function frTracks(value) {
  const tracks = splitTop(String(value).replace(/\s*,\s*/g, ","), " ").filter(Boolean);
  const weights = tracks
    .map((t) => t.match(/^minmax\(0(?:px)?,(\d*\.?\d+)fr\)$/))
    .map((m) => (m ? Number(m[1]) : NaN));
  return weights.length >= 1 && weights.length <= 100 && weights.every((w) => w > 0 && w <= 1000)
    ? weights.map(round)
    : null;
}

// Properties that have no static visual effect on a canvas (interaction, motion, a11y). Accepted
// without a warning because nothing is lost.
const NO_OP = new Set([
  "cursor",
  "pointer-events",
  "user-select",
  "-webkit-user-select",
  "transition-property",
  "transition-timing-function",
  "transition-duration",
  "transition-delay",
  "transition-behavior",
  "will-change",
  "outline-style",
  "outline-width",
  "outline-offset",
  "outline-color",
  "outline",
  "-webkit-font-smoothing",
  "-moz-osx-font-smoothing",
  "box-sizing",
  "isolation",
  "appearance",
  "scroll-behavior",
  "scroll-snap-type",
  "scroll-snap-align",
  "touch-action",
  "resize",
  "list-style-type",
  "list-style-position",
  "list-style-image",
  "font-variant-numeric",
  "-webkit-tap-highlight-color",
  "text-rendering",
  "forced-color-adjust",
  "content",
  "vertical-align",
  "speak",
  "clip",
  "animation-play-state",
  "text-wrap",
  "text-wrap-mode",
  "text-wrap-style",
  "word-break",
  "overflow-wrap",
  "hyphens",
  "white-space-collapse",
  "object-position",
  "text-underline-offset",
  "text-decoration-thickness",
  "text-decoration-style",
  "text-decoration-color",
  "font-feature-settings",
  "font-variation-settings",
  "-webkit-box-orient",
  "backface-visibility",
  "perspective",
  "transform-style",
  "transform-origin",
  "caret-color",
  "accent-color",
  "scrollbar-width",
  "scrollbar-color",
  "scrollbar-gutter",
  "overscroll-behavior",
  "overscroll-behavior-x",
  "overscroll-behavior-y",
  "field-sizing",
  "contain",
  "container-type",
  "-webkit-backdrop-filter",
]);

const ALIGN = {
  start: "flex-start",
  "flex-start": "flex-start",
  "self-start": "flex-start",
  end: "flex-end",
  "flex-end": "flex-end",
  "self-end": "flex-end",
  center: "center",
  stretch: "stretch",
  baseline: "baseline",
  "last baseline": "baseline",
  normal: "stretch",
  "safe center": "center",
  "center safe": "center",
  "safe flex-end": "flex-end",
  "flex-end safe": "flex-end",
  auto: "auto",
};
const JUSTIFY = {
  start: "flex-start",
  "flex-start": "flex-start",
  left: "flex-start",
  normal: "flex-start",
  end: "flex-end",
  "flex-end": "flex-end",
  right: "flex-end",
  center: "center",
  "space-between": "space-between",
  "space-around": "space-around",
  "space-evenly": "space-evenly",
  stretch: "flex-start",
  "safe center": "center",
  "center safe": "center",
};
export const GENERIC_FAMILIES = { sans: "system-ui", serif: "Georgia", mono: "monospace" };

const SIDES = ["top", "right", "bottom", "left"];
const LOGICAL = {
  "padding-inline": ["right", "left"],
  "padding-block": ["top", "bottom"],
  "padding-inline-start": ["left"],
  "padding-inline-end": ["right"],
  "padding-block-start": ["top"],
  "padding-block-end": ["bottom"],
};
// Shorthand first: Tailwind emits `rounded-*` before per-corner utilities, so corners override it.
const CORNERS = {
  "border-radius": [0, 1, 2, 3],
  "border-top-left-radius": [0],
  "border-top-right-radius": [1],
  "border-bottom-right-radius": [2],
  "border-bottom-left-radius": [3],
  "border-start-start-radius": [0],
  "border-start-end-radius": [1],
  "border-end-end-radius": [2],
  "border-end-start-radius": [3],
};

/**
 * Parse a className string. Returns
 *   {props, has:Set, ignored:[class], warnings:[message], w, h, minW, maxW, minH, maxH, top, right, bottom, left,
 *    absolute, italic, margin:{top,right,bottom,left}, translate:{x,y}}
 * Geometry entries are {px} | {frac} | {frac, px} | {auto} | {fit}. Color-like props are split into
 * `fill` (background) and `ink` (text color) so callers can apply them by node type.
 */
export function parseClasses(className, { tokens = {}, viewport = null } = {}) {
  const out = { props: {}, has: new Set(), ignored: [], warnings: [] };
  const variantClasses = [];
  let hiddenBy = null;
  const set = (key, value) => {
    out.props[key] = value;
    out.has.add(key);
  };
  const ignore = (cls, why) => {
    if (!out.ignored.includes(cls)) out.ignored.push(cls);
    out.warnings.push(`${cls}: ${why}`);
  };
  const tokenVars = new Map(
    Object.entries(tokens).map(([name, value]) => [cssVarForToken(name), value]),
  );
  const tokenByVar = new Map(Object.keys(tokens).map((name) => [cssVarForToken(name), name]));
  const classes = [
    ...new Set(
      String(className || "")
        .split(/\s+/)
        .filter(Boolean),
    ),
  ];

  // Legacy codec classes that are not Tailwind utilities.
  const tailwind = [];
  for (const cls of classes) {
    if (cls === "layout-free") set("layout", "free");
    else if (cls === "inline-flow") set("layout", "inline");
    else tailwind.push(cls);
  }

  // Compile and cascade. Variants and invalid classes are reported, base classes apply.
  const decls = new Map(),
    child = [];
  const fromClass = new Map();
  for (const cls of sortClasses(tailwind)) {
    const result = compileClass(cls);
    if (result.kind === "invalid") {
      ignore(cls, "not a Tailwind v4 class (unknown utility or invalid value)");
      continue;
    }
    if (result.kind === "variant") {
      // Variant classes are kept on the layer (variantClasses) and written back on export. Responsive
      // variants whose media conditions match the import viewport also apply, after the base classes.
      variantClasses.push(cls);
      const applies =
        viewport &&
        result.plain &&
        result.media.length > 0 &&
        result.media.every((q) => matchMedia(q, viewport));
      if (!applies) {
        ignore(
          cls,
          `variant ${result.variants.join(":")}: is ignored — ${viewport ? "its condition does not match the import viewport or it is a state variant" : "responsive, state and dark-mode variants are not represented on the canvas"}; only base classes apply (the class is kept on the layer and written back on export)`,
        );
        continue;
      }
    }
    if (result.kind === "unsupported") {
      ignore(
        cls,
        `produces only ${result.extras.join(", ")} rules, which the canvas does not represent`,
      );
      continue;
    }
    for (const raw of result.decls) {
      if (raw.property === "border-radius" && raw.value.includes("/"))
        ignore(cls, "elliptical border radius is approximated by horizontal radii");
      for (const decl of /^(border(?:-(?:top|right|bottom|left|radius|width|style|color))?|outline|background)$/.test(
        raw.property,
      )
        ? expand(raw)
        : [raw]) {
        // `hidden` (display:none) hides the layer without discarding its layout class (flex, grid…);
        // a matching responsive variant that sets a display value shows it again (hidden md:flex).
        if (decl.property === "display") {
          if (decl.value.trim() === "none") {
            hiddenBy = cls;
            continue;
          } else if (result.kind === "variant") hiddenBy = null;
        }
        const prev = decls.get(decl.property);
        if (prev && prev.important && !decl.important) continue;
        decls.set(decl.property, { ...decl, cls });
      }
    }
    if (result.childDecls.length) child.push({ cls, decls: result.childDecls });
    fromClass.set(cls, result);
  }
  const custom = new Map(
    [...decls].filter(([p]) => p.startsWith("--")).map(([p, d]) => [p, d.value]),
  );
  const resolve = (raw) => {
    const missing = [];
    const value = resolveValue(raw, { custom, tokenVars, missing });
    return { value, missing };
  };
  const handled = new Set();
  const take = (property) => {
    handled.add(property);
    const d = decls.get(property);
    if (!d) return null;
    const { value, missing } = resolve(d.value);
    if (value === null) {
      ignore(
        d.cls,
        `uses undefined CSS variable ${missing.join(", ")} (define it as a design token first)`,
      );
      return null;
    }
    return { ...d, resolved: value.trim() };
  };
  const len = (d, what = "length") => {
    const l = lengthOf(d.resolved);
    if (!l || (l.n !== undefined && l.px === undefined)) {
      ignore(d.cls, `unsupported ${what} ${d.resolved}`);
      return null;
    }
    if (l.viewport) {
      ignore(
        d.cls,
        `viewport units (${d.resolved}) are not represented; the canvas has no viewport`,
      );
      return null;
    }
    return l;
  };
  const px = (d, what) => {
    const l = len(d, what);
    if (!l) return null;
    if (l.frac !== undefined) {
      ignore(d.cls, `percentage ${what} ${d.resolved} is not supported here`);
      return null;
    }
    return l.px;
  };
  const color = (d) => {
    const raw = d.value.trim();
    const variable = raw.match(/^var\(\s*(--[a-zA-Z0-9_-]+)\s*\)$/);
    if (variable && tokenByVar.has(variable[1]))
      return {
        color:
          cssColorToHex(tokens[tokenByVar.get(variable[1])]) || tokens[tokenByVar.get(variable[1])],
        token: tokenByVar.get(variable[1]),
      };
    if (/^currentcolor$/i.test(d.resolved) || d.resolved === "inherit") return { inherit: true };
    const hex = cssColorToHex(d.resolved);
    if (!hex) {
      ignore(d.cls, `unsupported color ${d.resolved}`);
      return null;
    }
    return { color: hex };
  };

  // --- display / layout
  let d;
  if ((d = take("display"))) {
    const v = d.resolved;
    if (v === "flex" || v === "inline-flex") set("layout", "flex");
    else if (v === "grid" || v === "inline-grid") set("layout", "grid");
    else if (v === "block" || v === "flow-root" || v === "list-item") set("layout", "block");
    else if (v === "inline" || v === "inline-block") set("layout", "inline");
    else if (v === "none") set("hidden", true);
    else if (v === "-webkit-box" && decls.has("-webkit-line-clamp")) {
      /* line-clamp */
    } else ignore(d.cls, `display:${v} is not supported`);
  }
  if ((d = take("flex-direction"))) {
    set("direction", d.resolved.startsWith("column") ? "column" : "row");
    if (d.resolved.endsWith("reverse")) set("reverse", true);
  }
  if ((d = take("flex-wrap"))) {
    set("flexWrap", d.resolved !== "nowrap");
    if (d.resolved === "wrap-reverse") ignore(d.cls, "wrap-reverse is rendered as wrap");
  }
  if ((d = take("flex"))) {
    const v = d.resolved,
      parts = splitTop(v, " ");
    const named = { auto: [1, 1, "auto"], none: [0, 0, "auto"], initial: [0, 1, "auto"] }[v];
    const triple =
      named ||
      (parts.length === 1 && /^[\d.]+$/.test(parts[0])
        ? [Number(parts[0]), 1, "0%"]
        : parts.length === 3
          ? [Number(parts[0]), Number(parts[1]), parts[2]]
          : null);
    if (triple && Number.isFinite(triple[0]) && Number.isFinite(triple[1])) {
      set("grow", triple[0]);
      set("shrink", triple[1]);
      setBasis(triple[2], d.cls);
    } else ignore(d.cls, `flex shorthand ${v} is not supported`);
  }
  if ((d = take("flex-grow"))) {
    const n = Number(d.resolved);
    if (Number.isFinite(n)) set("grow", n);
    else ignore(d.cls, "invalid flex-grow");
  }
  if ((d = take("flex-shrink"))) {
    const n = Number(d.resolved);
    if (Number.isFinite(n)) set("shrink", n);
    else ignore(d.cls, "invalid flex-shrink");
  }
  if ((d = take("flex-basis"))) setBasis(d.resolved, d.cls);
  function setBasis(value, cls) {
    if (value === "auto" || value === "content") return;
    const l = lengthOf(value);
    if (!l || l.viewport) {
      ignore(cls, `flex-basis ${value} is not supported`);
      return;
    }
    if (l.frac !== undefined && !l.px) set("basis", `${round(l.frac * 100)}%`);
    else if (l.frac === undefined) set("basis", Math.max(0, l.px));
    else ignore(cls, `mixed flex-basis ${value} is not supported`);
  }
  if ((d = take("align-items"))) {
    if (ALIGN[d.resolved] && ALIGN[d.resolved] !== "auto") set("alignItems", ALIGN[d.resolved]);
    else ignore(d.cls, `align-items:${d.resolved} is not supported`);
  }
  if ((d = take("align-self"))) {
    if (ALIGN[d.resolved]) set("alignSelf", ALIGN[d.resolved]);
    else ignore(d.cls, `align-self:${d.resolved} is not supported`);
  }
  if ((d = take("justify-content"))) {
    if (JUSTIFY[d.resolved]) set("justifyContent", JUSTIFY[d.resolved]);
    else ignore(d.cls, `justify-content:${d.resolved} is not supported`);
  }
  for (const p of [
    "place-items",
    "place-content",
    "place-self",
    "justify-items",
    "justify-self",
    "align-content",
  ])
    if ((d = take(p))) {
      if (p === "place-items" && ALIGN[d.resolved]) {
        set("alignItems", ALIGN[d.resolved]);
        set("justifyItems", ALIGN[d.resolved]);
      } else if (p === "justify-items" && ALIGN[d.resolved] && ALIGN[d.resolved] !== "auto")
        set("justifyItems", ALIGN[d.resolved]);
      else if (p === "place-content" && JUSTIFY[d.resolved]) {
        set("justifyContent", JUSTIFY[d.resolved]);
      } else if (p === "align-content" && d.resolved === "normal") {
        /* default */
      }
      // On a text layer align-content places the lines in a fixed-height box (vertical text alignment).
      else if (
        p === "align-content" &&
        ["start", "flex-start", "center", "end", "flex-end"].includes(d.resolved)
      )
        set(
          "textAlignVertical",
          d.resolved === "center" ? "center" : /end$/.test(d.resolved) ? "bottom" : "top",
        );
      else ignore(d.cls, `${p}:${d.resolved} is not supported`);
    }
  // gap
  if ((d = take("gap"))) {
    const v = px(d, "gap");
    if (v !== null) {
      set("gapX", Math.max(0, v));
      set("gapY", Math.max(0, v));
    }
  }
  if ((d = take("column-gap"))) {
    const v = px(d, "gap");
    if (v !== null) set("gapX", Math.max(0, v));
  }
  if ((d = take("row-gap"))) {
    const v = px(d, "gap");
    if (v !== null) set("gapY", Math.max(0, v));
  }
  for (const { cls, decls: list } of child) {
    const m = cls.match(/^-?space-([xy])-/);
    if (m) {
      const decl = list.find(
        (x) => x.property === (m[1] === "y" ? "margin-block-end" : "margin-inline-end"),
      );
      const reverse = new Map([[`--tw-space-${m[1]}-reverse`, "0"]]);
      const value = decl ? resolveValue(decl.value, { custom: reverse, tokenVars }) : null;
      const l = value !== null ? lengthOf(value) : null;
      if (l?.px !== undefined) {
        set(m[1] === "y" ? "gapY" : "gapX", Math.max(0, l.px));
        out.warnings.push(`${cls}: converted to ${m[1] === "y" ? "row" : "column"} gap`);
      } else ignore(cls, "unsupported spacing value");
    } else
      ignore(
        cls,
        "styles applied to child elements (divide-*, child selectors) are not supported; style the children directly",
      );
  }
  if (out.has.has("gapX") || out.has.has("gapY")) {
    const gx = out.props.gapX,
      gy = out.props.gapY;
    set(
      "gap",
      gx !== undefined && gy !== undefined ? (gx === gy ? gx : Math.max(gx, gy)) : (gx ?? gy),
    );
  }
  // grid: equal tracks, or fr-weighted Fill tracks (`minmax(0, 2fr)` each, as the exporter writes them)
  let weights;
  if ((d = take("grid-template-columns"))) {
    const rep = d.resolved.match(
      /^repeat\(\s*(\d+)\s*,\s*minmax\(\s*0(?:px)?\s*,\s*1fr\s*\)\s*\)$/,
    );
    if (rep) set("columns", Math.max(1, Math.min(100, Number(rep[1]))));
    else if (d.resolved === "none" || d.resolved === "subgrid") ignore(d.cls, "not supported");
    else if ((weights = frTracks(d.resolved))) {
      set("columns", weights.length);
      if (weights.some((w) => w !== 1)) set("columnSizes", weights);
    } else {
      const tracks = splitTop(d.resolved, " ").length;
      set("columns", Math.max(1, Math.min(100, tracks)));
      ignore(
        d.cls,
        `custom grid tracks (${d.resolved}) are approximated as ${tracks} equal columns`,
      );
      out.ignored.pop();
    }
  }
  if ((d = take("grid-column"))) {
    const span = d.resolved.match(/^span (\d+) \/ span \1$/);
    if (span) set("colSpan", Number(span[1]));
    else if (d.resolved === "1 / -1") set("colSpan", "full");
    else ignore(d.cls, `grid-column:${d.resolved} is not supported`);
  }
  if ((d = take("grid-template-rows"))) {
    const rep = d.resolved.match(
      /^repeat\(\s*(\d+)\s*,\s*minmax\(\s*0(?:px)?\s*,\s*1fr\s*\)\s*\)$/,
    );
    if (rep) set("rows", Math.max(1, Math.min(100, Number(rep[1]))));
    else if ((weights = frTracks(d.resolved))) {
      set("rows", weights.length);
      if (weights.some((w) => w !== 1)) set("rowSizes", weights);
    } else ignore(d.cls, `grid-template-rows:${d.resolved} is not supported`);
  }
  if ((d = take("grid-row"))) {
    const span = d.resolved.match(/^span (\d+) \/ span \1$/);
    if (span) set("rowSpan", Number(span[1]));
    else ignore(d.cls, `grid-row:${d.resolved} is not supported`);
  }
  for (const p of [
    "grid-auto-flow",
    "grid-auto-rows",
    "grid-auto-columns",
    "grid-column-start",
    "grid-column-end",
    "grid-row-start",
    "grid-row-end",
    "order",
  ])
    if ((d = take(p))) ignore(d.cls, `${p} is not supported`);

  // --- padding / margin
  const padding = {};
  const sideLength = (d, allowAuto) => {
    if (allowAuto && d.resolved === "auto") return "auto";
    const l = len(d);
    if (!l) return null;
    if (l.frac !== undefined) {
      ignore(d.cls, "percentage spacing is not supported");
      return null;
    }
    return l.px;
  };
  const spread = (target, property, base, allowAuto) => {
    for (const p of [
      base,
      `${base}-inline`,
      `${base}-block`,
      ...SIDES.map((s) => `${base}-${s}`),
      `${base}-inline-start`,
      `${base}-inline-end`,
      `${base}-block-start`,
      `${base}-block-end`,
    ]) {
      const decl = take(p);
      if (!decl) continue;
      if (p === base) {
        const parts = splitTop(decl.resolved, " ");
        if (parts.length === 1) {
          const v = sideLength(decl, allowAuto);
          if (v !== null) for (const s of SIDES) target[s] = v;
        } else {
          const vals = parts.map((part) => sideLength({ ...decl, resolved: part }, allowAuto));
          const [t, r = t, b = t, l = r] = vals;
          Object.assign(target, { top: t, right: r, bottom: b, left: l });
        }
        continue;
      }
      const v = sideLength(decl, allowAuto);
      if (v === null) continue;
      const sides = LOGICAL[p.replace(base, "padding")] || [p.slice(base.length + 1)];
      for (const s of sides) target[s] = v;
    }
    void property;
  };
  spread(padding, "padding", "padding", false);
  if (Object.keys(padding).length) {
    for (const s of SIDES)
      if (padding[s] !== undefined)
        set("padding" + s[0].toUpperCase() + s.slice(1), Math.max(0, padding[s]));
    out.has.add("padding");
    const values = SIDES.map((s) => padding[s]);
    if (values.every((v) => v !== undefined && v === values[0]))
      out.props.padding = Math.max(0, values[0]);
  }
  const margin = {};
  spread(margin, "margin", "margin", true);
  if (Object.keys(margin).length) out.margin = margin;

  // --- size
  const size = (property, key) => {
    const decl = take(property);
    if (!decl) return;
    const v = decl.resolved;
    if (v === "auto") {
      out[key] = { auto: true };
      return;
    }
    if (/^(fit-content|max-content|min-content)$/.test(v)) {
      out[key] = { fit: true };
      return;
    }
    if (v === "none" && key.startsWith("max")) return;
    // A width/height calc() of px and % terms is kept as a Calculate expression (wCalc / hCalc).
    // Only an authored calc() (w-[calc(…)]) is one: theme fractions such as w-1/2 also resolve to calc() but stay a %.
    const calc =
      (key === "w" || key === "h") && /^calc\(/i.test(v) && /\[calc\(/i.test(decl.cls || "")
        ? parseCalc(v)
        : null;
    if (calc) {
      out[key] = {
        calc: calc.text,
        ...(calc.pct ? { frac: calc.pct / 100 } : {}),
        ...(calc.px || !calc.pct ? { px: calc.px } : {}),
      };
      return;
    }
    const l = len(decl, property);
    if (!l) return;
    out[key] =
      l.frac !== undefined
        ? l.px
          ? { frac: l.frac, px: l.px }
          : { frac: l.frac }
        : { px: Math.max(0, l.px) };
  };
  size("width", "w");
  size("height", "h");
  size("min-width", "minW");
  size("max-width", "maxW");
  size("min-height", "minH");
  size("max-height", "maxH");
  if ((d = take("aspect-ratio"))) {
    const parts = d.resolved.split("/").map((x) => Number(x.trim()));
    const ratio = parts.length === 2 ? parts[0] / parts[1] : parts[0];
    if (Number.isFinite(ratio) && ratio > 0) set("aspectRatio", round(ratio));
    else if (d.resolved !== "auto") ignore(d.cls, `aspect-ratio ${d.resolved} is not supported`);
  }

  // --- position
  if ((d = take("position"))) {
    if (d.resolved === "absolute") out.absolute = true;
    else if (d.resolved === "fixed") {
      out.absolute = true;
      out.warnings.push(`${d.cls}: fixed positioning is treated as absolute within the parent`);
    } else if (d.resolved === "sticky")
      ignore(d.cls, "sticky positioning is not represented; the element stays in flow");
  }
  const insetSide = (decl, sides) => {
    if (decl.resolved === "auto") return;
    const l = len(decl, "offset");
    if (!l) return;
    for (const s of sides)
      out[s] =
        l.frac !== undefined ? { frac: l.frac, ...(l.px ? { px: l.px } : {}) } : { px: l.px };
  };
  if ((d = take("inset"))) {
    const parts = splitTop(d.resolved, " ");
    if (parts.length === 1) insetSide(d, SIDES);
    else ignore(d.cls, "multi-value inset is not supported");
  }
  if ((d = take("inset-inline"))) insetSide(d, ["left", "right"]);
  if ((d = take("inset-block"))) insetSide(d, ["top", "bottom"]);
  if ((d = take("inset-inline-start"))) insetSide(d, ["left"]);
  if ((d = take("inset-inline-end"))) insetSide(d, ["right"]);
  for (const s of SIDES) if ((d = take(s))) insetSide(d, [s]);
  if ((d = take("translate"))) {
    const parts = splitTop(d.resolved, " ");
    const conv = (part) => {
      const l = lengthOf(part);
      if (!l || l.viewport) return null;
      if (l.frac !== undefined && !l.px) return `${round(l.frac * 100)}%`;
      if (l.frac === undefined) return l.px ?? 0;
      return null;
    };
    const x = conv(parts[0] ?? "0"),
      y = conv(parts[1] ?? "0");
    if (x === null || y === null) ignore(d.cls, `translate ${d.resolved} is not supported`);
    else if (x !== 0 || y !== 0) out.translate = { x, y };
  }
  if ((d = take("z-index"))) {
    if (d.resolved === "auto") set("zIndex", 0);
    else if (/^-?\d+$/.test(d.resolved)) set("zIndex", Number(d.resolved));
    else ignore(d.cls, "invalid z-index");
  }
  for (const p of ["overflow", "overflow-x", "overflow-y"])
    if ((d = take(p))) {
      if (decls.has("-webkit-line-clamp") || decls.get("text-overflow")) {
        /* part of truncate / line-clamp */
      }
      set("clipContent", d.resolved !== "visible");
    }
  if ((d = take("opacity"))) {
    const l = lengthOf(d.resolved);
    const n =
      l?.frac !== undefined ? l.frac * 100 : l?.n !== undefined ? l.n * 100 : l?.px === 0 ? 0 : NaN;
    if (Number.isFinite(n)) set("opacity", Math.min(100, Math.max(0, round(n))));
    else ignore(d.cls, "invalid opacity");
  }
  if ((d = take("visibility"))) {
    if (d.resolved === "hidden") set("hidden", true);
  }
  if ((d = take("rotate"))) {
    const m = d.resolved.match(/^(-?[\d.]+)deg$/);
    if (m) set("rotation", Number(m[1]));
    else if (d.resolved !== "none") ignore(d.cls, `rotate ${d.resolved} is not supported`);
  }
  // Flips: -scale-x-100 / -scale-y-100 / -scale-100 (Tailwind's `scale` = x y factors). Only ±1 factors are represented.
  if ((d = take("scale"))) {
    const factor = (part) => {
      const l = lengthOf(part);
      return l?.frac !== undefined && !l.px ? l.frac : l?.n !== undefined ? l.n : null;
    };
    const parts = splitTop(d.resolved, " "),
      fx = factor(parts[0] ?? ""),
      fy = parts.length > 1 ? factor(parts[1]) : fx;
    if (d.resolved === "none") {
      /* no scale */
    } else if ([fx, fy].every((f) => f !== null && Math.abs(Math.abs(f) - 1) < 1e-6)) {
      if (fx < 0) set("flipX", true);
      if (fy < 0) set("flipY", true);
    } else
      ignore(
        d.cls,
        `scale ${d.resolved} is not supported (only flips: -scale-x-100, -scale-y-100)`,
      );
  }

  // --- backgrounds
  if ((d = take("background-color"))) {
    const c = color(d);
    if (c && !c.inherit) {
      set("fill", c.color);
      if (c.token) set("fillToken", c.token);
    }
  }
  if ((d = take("background-image"))) {
    let v = d.resolved;
    if (v === "none") set("gradient", "");
    else if (/url\s*\(/i.test(v)) {
      const match = /^url\(\s*(["']?)(.*?)\1\s*\)$/.exec(v);
      if (match && /^data:image\//.test(match[2]))
        set("fills", [{ type: "image", src: match[2], fit: "cover" }]);
      else if (match && /^https?:\/\//.test(match[2])) set("backgroundRemote", match[2]);
      else
        ignore(
          d.cls,
          "Unresolved background URL; use HTML import with a base URL or an embedded image",
        );
    } else {
      v = normalizeColorsIn(
        v
          .replace(
            /\s+in\s+(?:oklab|oklch|srgb|hsl)(?:\s+(?:shorter|longer|increasing|decreasing)\s+hue)?/g,
            "",
          )
          .replace(/\(\s*,\s*/g, "(")
          .replace(/,\s*,/g, ","),
      );
      if (SAFE_CSS(v) && /gradient\(/.test(v)) set("gradient", v);
      else ignore(d.cls, `background-image ${d.resolved} is not supported`);
    }
  }
  if ((d = take("background"))) {
    const c = cssColorToHex(d.resolved);
    if (c) set("fill", c);
    else if (/gradient\(/.test(d.resolved) && SAFE_CSS(d.resolved))
      set("gradient", normalizeColorsIn(d.resolved));
    else ignore(d.cls, `background ${d.resolved} is not supported`);
  }
  if ((d = take("background-size"))) {
    const fit = { cover: "cover", contain: "contain", "100% 100%": "fill", auto: "none" }[
      d.resolved
    ];
    if (fit && out.props.fills) {
      for (const fill of out.props.fills) if (fill.type === "image") fill.fit = fit;
    } else if (!fit || out.props.backgroundRemote)
      ignore(d.cls, "background-size is approximated by cover");
  }
  for (const p of [
    "background-position",
    "background-repeat",
    "background-clip",
    "background-attachment",
    "background-origin",
  ])
    if ((d = take(p))) {
      if (p === "background-position" && /^(center|50% 50%)$/.test(d.resolved)) continue;
      if (p === "background-repeat" && d.resolved === "no-repeat") continue;
      ignore(d.cls, `${p} is approximated by a centered non-repeating image fill`);
    }

  // --- borders
  const widths = {};
  for (const [p, sides] of [
    ["border-width", SIDES],
    ["border-inline-width", ["left", "right"]],
    ["border-block-width", ["top", "bottom"]],
    ["border-inline-start-width", ["left"]],
    ["border-inline-end-width", ["right"]],
    ...SIDES.map((s) => [`border-${s}-width`, [s]]),
  ]) {
    if (!(d = take(p))) continue;
    const parts = splitTop(d.resolved, " ");
    if (parts.length > 1) {
      const v = parts.map((part) => lengthOf(part)?.px ?? 0);
      const [t, r = t, b = t, l = r] = v;
      Object.assign(widths, { top: t, right: r, bottom: b, left: l });
      continue;
    }
    const v = px(d, "border width");
    if (v !== null) for (const s of sides) widths[s] = Math.max(0, v);
  }
  if ((d = take("border-style"))) {
    if (d.resolved === "none" || d.resolved === "hidden") {
      for (const s of SIDES) widths[s] = 0;
    } else if (d.resolved !== "solid") {
      set(
        "strokeStyle",
        d.resolved === "dashed" || d.resolved === "dotted" || d.resolved === "double"
          ? d.resolved
          : "solid",
      );
    }
  }
  for (const s of SIDES) take(`border-${s}-style`);
  if (Object.keys(widths).length) {
    const values = SIDES.map((s) => widths[s] ?? null);
    if (values.every((v) => v === values[0])) set("strokeWidth", values[0]);
    else {
      set("strokeWidths", values);
      set("strokeWidth", Math.max(...values.map((v) => v ?? 0)));
    }
  }
  {
    // Border colour: one colour (strokeColor, strokeToken when it is a colour variable) plus per-side
    // colours (strokeColors, top/right/bottom/left) when a side states its own.
    let base = null;
    const sides = [null, null, null, null];
    for (const p of [
      "border-color",
      ...SIDES.map((s) => `border-${s}-color`),
      "border-inline-color",
      "border-block-color",
    ])
      if ((d = take(p))) {
        const c = color(d);
        if (!c || c.inherit) continue;
        if (p === "border-color") base = c;
        else
          for (const i of p === "border-inline-color"
            ? [1, 3]
            : p === "border-block-color"
              ? [0, 2]
              : [SIDES.indexOf(p.slice(7, -6))])
            sides[i] = c;
      }
    if (base) {
      set("strokeColor", base.color);
      set("strokeToken", base.token || "");
    }
    if (sides.some(Boolean)) {
      const fallback = base || sides.find(Boolean);
      if (!base) {
        set("strokeColor", fallback.color);
        set(
          "strokeToken",
          sides.every((c) => c?.token === fallback.token) ? fallback.token || "" : "",
        );
      }
      if (!sides.every((c) => c?.color === fallback.color && c?.token === fallback.token))
        set(
          "strokeColors",
          sides.map((c) => {
            const v = c || fallback;
            return v.token ? { color: v.color, token: v.token } : { color: v.color };
          }),
        );
    }
  }
  const corners = [undefined, undefined, undefined, undefined];
  const ellipse = ["top-left", "top-right", "bottom-right", "bottom-left"].every((corner) => {
    const raw = decls.get(`border-${corner}-radius`);
    const value = raw && lengthOf(resolve(raw.value).value);
    return value?.frac === 0.5 && !value.px;
  });
  if (ellipse) set("ellipse", true);
  for (const [p, idx] of Object.entries(CORNERS)) {
    if (!(d = take(p))) continue;
    if (ellipse) continue;
    const axes = splitTop(d.resolved, " ");
    if (axes.length > 1)
      ignore(d.cls, "elliptical border radius is approximated by horizontal radii");
    const l = lengthOf(axes[0]);
    // rounded-[50%] on every corner is an ellipse inscribed in the box (other percentages are not represented).
    if (p === "border-radius" && l?.frac === 0.5 && !l.px) {
      set("ellipse", true);
      continue;
    }
    if (!l || l.px === undefined || l.frac !== undefined) {
      ignore(d.cls, `radius ${d.resolved} is not supported`);
      continue;
    }
    const v = l.px === Infinity ? 9999 : Math.min(9999, Math.max(0, l.px));
    for (const i of idx) corners[i] = v;
  }
  if (corners.some((v) => v !== undefined)) {
    // Partial corners keep null so edits merge with the node's existing radii.
    if (corners.every((v) => v === corners[0])) set("radius", corners[0]);
    else {
      set(
        "cornerRadii",
        corners.map((v) => v ?? null),
      );
      set("radius", Math.max(...corners.map((v) => v ?? 0)));
    }
  }
  // Shadows and rings (Tailwind composes both into box-shadow through --tw-* variables).
  if ((d = take("box-shadow"))) {
    if (/var\(--tw-shadow\)/.test(d.value)) {
      const zero = (part) =>
        /^(?:inset\s+)?0(?:px)?\s+0(?:px)?(?:\s+0(?:px)?)?(?:\s+0(?:px)?)?\s+(?:#0000|#00000000|transparent)$/i.test(
          part.trim(),
        );
      const shadowRaw = resolveValue("var(--tw-inset-shadow), var(--tw-shadow)", {
        custom,
        tokenVars,
      });
      const shadow =
        shadowRaw === null
          ? ""
          : splitTop(normalizeColorsIn(shadowRaw), ",")
              .filter((part) => part && !zero(part))
              .join(", ");
      if (custom.has("--tw-shadow") || custom.has("--tw-inset-shadow")) set("shadow", shadow);
      const ringRaw = resolveValue("var(--tw-ring-shadow)", { custom, tokenVars });
      if (ringRaw !== null && custom.has("--tw-ring-shadow")) {
        const ink = decls.get("color") ? resolve(decls.get("color").value).value : null;
        const ring = normalizeColorsIn(ringRaw.replace(/currentcolor/gi, ink || "#25252e"));
        const m = ring
          .trim()
          .match(/^(inset\s+)?0(?:px)?\s+0(?:px)?\s+0(?:px)?\s+(calc\(.+?\)|[\d.]+px)\s+(.+)$/);
        const width = m ? lengthOf(m[2])?.px : undefined;
        if (m && width !== undefined) {
          set("ringWidth", width);
          set("ringColor", cssColorToHex(m[3]) || "#000000");
          if (m[1]) set("ringInset", true);
        } else ignore(d.cls, `ring ${ringRaw} is not supported`);
        const offset = lengthOf(
          resolveValue("var(--tw-ring-offset-width)", { custom, tokenVars }) ?? "0",
        )?.px;
        if (offset) out.warnings.push(`${d.cls}: ring offset is not rendered`);
      }
    } else if (d.resolved === "none") set("shadow", "");
    else {
      const v = normalizeColorsIn(d.resolved);
      if (SAFE_CSS(v)) set("shadow", v);
      else ignore(d.cls, "unsafe shadow");
    }
  }

  // --- effects: blend, outline, filters (drop-shadow becomes a Drop shadow), backdrop filters, text shadow
  if ((d = take("mix-blend-mode"))) {
    if (BLEND_MODES.includes(d.resolved)) set("blendMode", d.resolved);
    else ignore(d.cls, `blend mode ${d.resolved} is not supported`);
  }
  if ((d = take("outline-width"))) {
    const width = px(d, "outline width");
    const style = decls.has("outline-style")
      ? resolve(decls.get("outline-style").value).value?.trim() || "solid"
      : "solid";
    if (width !== null && style === "none") set("outlineWidth", 0);
    else if (width !== null) {
      set("outlineWidth", Math.min(1000, width));
      set("outlineStyle", ["dashed", "dotted"].includes(style) ? style : "solid");
      if (!["solid", "dashed", "dotted"].includes(style))
        out.warnings.push(`${d.cls}: outline style ${style} is drawn solid`);
      const ink = decls.get("color") ? resolve(decls.get("color").value).value : null;
      const raw = decls.has("outline-color")
        ? resolve(decls.get("outline-color").value).value
        : null;
      const hex = cssColorToHex(raw && !/^currentcolor$/i.test(raw) ? raw : ink || "#000000");
      if (hex && hex !== "transparent") set("outlineColor", hex);
      else set("outlineWidth", 0);
      const bound = String(decls.get("outline-color")?.value || "")
        .trim()
        .match(/^var\(\s*(--[a-zA-Z0-9_-]+)\s*\)$/);
      set("outlineToken", bound && tokenByVar.has(bound[1]) ? tokenByVar.get(bound[1]) : "");
      const offset = decls.has("outline-offset")
        ? lengthOf(resolve(decls.get("outline-offset").value).value || "0")?.px
        : 0;
      if (Number.isFinite(offset)) set("outlineOffset", Math.max(-1000, Math.min(1000, offset)));
    }
    handled.add("outline-style");
    handled.add("outline-color");
    handled.add("outline-offset");
  }
  const filterList = (d, backdrop) => {
    const list = [],
      drops = [];
    for (const part of splitTop(normalizeColorsIn(d.resolved), " ")
      .map((v) => v.trim())
      .filter(Boolean)) {
      const m = part.match(/^([a-z-]+)\((.*)\)$/s);
      const type = m && FILTER_TYPES[m[1]];
      if (m && m[1] === "drop-shadow" && !backdrop) {
        const args = splitTop(m[2], " ").filter(Boolean),
          lens = args.slice(0, -1).map((v) => lengthOf(v)?.px),
          color = cssColorToHex(args.at(-1) || "");
        if (lens.length >= 2 && lens.length <= 3 && lens.every(Number.isFinite) && color)
          drops.push({
            type: "drop",
            x: lens[0],
            y: lens[1],
            blur: Math.max(0, lens[2] ?? 0),
            spread: 0,
            color,
          });
        else ignore(d.cls, `drop shadow ${part} is not supported`);
        continue;
      }
      if (!type) {
        ignore(d.cls, `filter ${part} is not supported`);
        continue;
      }
      const arg = m[2].trim(),
        spec = FILTERS[type];
      let value =
        type === "blur"
          ? lengthOf(arg || "0")?.px
          : type === "hueRotate"
            ? /^-?[\d.]+(deg)?$/.test(arg)
              ? parseFloat(arg)
              : /^-?[\d.]+turn$/.test(arg)
                ? parseFloat(arg) * 360
                : NaN
            : arg === ""
              ? 1
              : arg.endsWith("%")
                ? parseFloat(arg) / 100
                : Number(arg);
      if (!Number.isFinite(value)) {
        ignore(d.cls, `filter ${part} is not supported`);
        continue;
      }
      if (value < spec.min || value > spec.max) {
        value = Math.min(spec.max, Math.max(spec.min, value));
        out.warnings.push(`${d.cls}: ${m[1]} clamped to ${value}`);
      }
      list.push(
        backdrop ? { type, value: round(value), backdrop: true } : { type, value: round(value) },
      );
    }
    return { list, drops };
  };
  if ((d = take("filter"))) {
    if (d.resolved === "none") {
      set("filters", []);
      set("dropShadows", []);
    } else {
      const { list, drops } = filterList(d, false);
      set("filters", list);
      set("dropShadows", drops);
    }
  }
  if ((d = take("backdrop-filter"))) {
    if (d.resolved === "none") set("backdropFilters", []);
    else set("backdropFilters", filterList(d, true).list);
  }
  if ((d = take("text-shadow"))) {
    const list = [];
    if (d.resolved !== "none")
      for (const part of splitTop(normalizeColorsIn(d.resolved), ",")) {
        const args = splitTop(part.trim(), " ").filter(Boolean),
          colorAt = args.findIndex((v) => cssColorToHex(v)),
          lens = args.filter((_, i) => i !== colorAt).map((v) => lengthOf(v)?.px);
        if (colorAt >= 0 && lens.length >= 2 && lens.length <= 3 && lens.every(Number.isFinite))
          list.push({
            type: "text",
            x: lens[0],
            y: lens[1],
            blur: Math.max(0, lens[2] ?? 0),
            spread: 0,
            color: cssColorToHex(args[colorAt]),
          });
        else ignore(d.cls, `text shadow ${part.trim()} is not supported`);
      }
    set("textShadows", list);
  }

  // --- typography
  if ((d = take("color"))) {
    const c = color(d);
    if (c && !c.inherit) {
      set("ink", c.color);
      if (c.token) set("inkToken", c.token);
    }
  }
  if ((d = take("font-size"))) {
    const v = px(d, "font size");
    if (v !== null) {
      const clamped = Math.min(200, Math.max(8, v));
      if (clamped !== v) out.warnings.push(`${d.cls}: font size clamped to ${clamped}px`);
      set("fontSize", clamped);
    }
  }
  if ((d = take("line-height"))) {
    const l = lengthOf(d.resolved);
    if (d.resolved === "normal") set("lineHeight", "auto"); // leading-[normal]: the font's own line height (inspector "Auto")
    else if (l?.n !== undefined && l.px === undefined) set("lineHeight", round(l.n));
    else if (l?.frac !== undefined && !l.px) set("lineHeight", round(l.frac));
    else if (l?.px !== undefined && l.frac === undefined) set("lineHeightPx", l.px);
    else ignore(d.cls, `line-height ${d.resolved} is not supported`);
  }
  if ((d = take("font-family"))) {
    const family = fontFamilyOf(d.resolved);
    if (family && SAFE_CSS(family)) set("fontFamily", family);
    else ignore(d.cls, `font-family ${d.resolved} is not supported`);
  }
  if ((d = take("font-weight"))) {
    const w =
      { normal: "400", bold: "700", bolder: "700", lighter: "300" }[d.resolved] || d.resolved;
    if (/^[1-9]\d{0,2}$/.test(w)) set("fontWeight", w);
    else ignore(d.cls, `font-weight ${d.resolved} is not supported`);
  }
  if ((d = take("font-style"))) {
    if (d.resolved === "italic" || d.resolved === "oblique") {
      out.italic = true;
      set("fontStyle", "italic");
    } else if (d.resolved === "normal") {
      out.italic = false;
      set("fontStyle", "normal");
    }
  }
  if ((d = take("letter-spacing"))) {
    const em = d.resolved.match(/^(-?[\d.]+)em$/);
    if (em) set("letterSpacingEm", Number(em[1]));
    else {
      const l = lengthOf(d.resolved);
      if (l?.px !== undefined && l.frac === undefined) set("letterSpacing", l.px);
      else if (d.resolved === "normal") set("letterSpacing", 0);
      else ignore(d.cls, `letter-spacing ${d.resolved} is not supported`);
    }
  }
  if ((d = take("text-align"))) {
    const a = {
      start: "left",
      end: "right",
      left: "left",
      right: "right",
      center: "center",
      justify: "justify",
    }[d.resolved];
    if (a) set("textAlign", a);
    else ignore(d.cls, "unsupported text-align");
  }
  if ((d = take("text-transform"))) {
    if (["uppercase", "lowercase", "capitalize", "none"].includes(d.resolved))
      set("textTransform", d.resolved === "none" ? "" : d.resolved);
  }
  if ((d = take("text-decoration-line"))) {
    if (["underline", "line-through", "overline", "none"].includes(d.resolved))
      set("textDecoration", d.resolved === "none" ? "" : d.resolved);
    else ignore(d.cls, "unsupported text decoration");
  }
  if ((d = take("text-overflow"))) {
    if (d.resolved === "ellipsis") set("truncate", true);
  }
  if ((d = take("white-space"))) {
    if (d.resolved === "nowrap") set("noWrap", true);
    else if (["normal", "pre", "pre-wrap", "pre-line", "break-spaces"].includes(d.resolved)) {
      set("noWrap", false);
      set("whiteSpace", d.resolved === "pre-wrap" ? "" : d.resolved);
    } // pre-wrap is the canvas default
  }
  {
    // Word break (inspector Off / All / Word): break-normal states both properties; Word is the canvas default.
    const wrapAt = take("overflow-wrap"),
      breakAt = take("word-break");
    if (breakAt?.resolved === "break-all") set("wordBreak", "break-all");
    else if (wrapAt?.resolved === "normal") set("wordBreak", "normal");
    else if (wrapAt && ["anywhere", "break-word"].includes(wrapAt.resolved)) set("wordBreak", "");
  }
  if ((d = take("text-indent"))) {
    const v = px(d, "text indent");
    if (v !== null) set("textIndent", v);
  }
  if ((d = take("-webkit-font-smoothing"))) {
    if (d.resolved === "antialiased") set("fontSmoothing", "antialiased");
    else if (d.resolved === "auto") set("fontSmoothing", "subpixel-antialiased");
  }
  if ((d = take("-webkit-line-clamp"))) {
    const n = Number(d.resolved);
    if (Number.isInteger(n) && n > 0) set("lineClamp", n);
    else if (d.resolved === "unset" || d.resolved === "none") set("lineClamp", 0);
  }
  if (decls.has("text-wrap")) {
    const v = resolve(decls.get("text-wrap").value).value;
    if (v === "balance" || v === "pretty" || v === "nowrap") set("textWrap", v);
    else if (v === "wrap") set("textWrap", "");
  }
  if ((d = take("object-fit"))) {
    if (["cover", "contain", "fill", "none", "scale-down"].includes(d.resolved))
      set("objectFit", d.resolved);
  }
  // Arbitrary properties that map to node fields.
  if ((d = take("mask-image")) || (d = take("-webkit-mask-image"))) {
    if (d.resolved === "none") set("mask", "");
    else if (SAFE_CSS(d.resolved)) set("mask", normalizeColorsIn(d.resolved));
    else {
      const layers = maskLayersOf(d.resolved);
      if (layers) {
        set("mask", "");
        set("maskLayers", layers);
      } else ignore(d.cls, "unsafe mask");
    }
  }
  if ((d = take("animation"))) {
    if (["aurora", "sunset", "ocean"].includes(d.resolved)) set("animated", d.resolved);
    else if (d.resolved === "none") set("animated", "");
    else ignore(d.cls, "animations are not rendered on the canvas");
  }
  if ((d = take("layout"))) {
    if (["free", "flex", "grid", "block", "inline"].includes(d.resolved)) set("layout", d.resolved);
    else ignore(d.cls, "unknown layout");
  }

  // Everything else is explicit: no-op (non-visual) or unsupported.
  for (const [property, decl] of decls) {
    if (handled.has(property) || property.startsWith("--")) continue;
    if (NO_OP.has(property)) continue;
    ignore(decl.cls, `CSS property ${property} is not supported by the canvas`);
  }
  if (hiddenBy) set("hidden", true);
  if (variantClasses.length)
    set("variantClasses", classes.filter((cls) => variantClasses.includes(cls)).join(" "));
  return out;
}

/** Map a resolved CSS font-family to a node fontFamily. Theme generic stacks keep their legacy names. */
function fontFamilyOf(value) {
  const v = value.trim();
  for (const [name, legacy] of Object.entries(GENERIC_FAMILIES)) {
    const theme = resolveValue(`var(--font-${name})`);
    if (theme && theme.replace(/\s+/g, " ").trim() === v.replace(/\s+/g, " ")) return legacy;
  }
  const families = splitTop(v, ",");
  if (families.length === 1) return families[0].replace(/^['"]|['"]$/g, "");
  return families.map((f) => f.trim()).join(", ");
}
