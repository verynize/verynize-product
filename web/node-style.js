// Shared node -> CSS mapping for Verynize documents. ONE source of truth for the live canvas
// (web/app.js, loaded as a classic <script>) and the headless HTML export
// (integrations/export-html.mjs, which imports this file through integrations/node-style.mjs), so the
// canvas, screenshots and exported HTML cannot drift.
//
// nodeStyle(node, parent, ctx) -> {box, img}: ordered lists of [css-property, value] declarations for
// the layer element and (image nodes) its inner <img>. Values from the document are sanitized, so
// the result is safe to serialize into a style attribute (after attribute escaping).
//   ctx.color      resolved fill/ink color (token lookup is the caller's job)
//   ctx.lastInFlow true when the node is the last in-flow child of a block parent (space-y)
//
// Layout model (see integrations/codec-layout.mjs for the matching headless engine):
//   free   children positioned by x/y (absolute)
//   block  CSS block flow (display: flow-root, so child margins never escape the frame; adjacent
//          sibling margins collapse like CSS); gapY = space-y
//   flex   flexbox with gap/gapX/gapY, wrap, grow/shrink/basis, align-self, auto margins
//   grid   columns (optional explicit rows), equal or fr-weighted (columnSizes / rowSizes), with col-span /
//          row-span; justifyItems aligns cells
//   inline children are inline-block
(function (root) {
  "use strict";
  const SIDES = ["top", "right", "bottom", "left"];
  const PALETTES = {
    aurora: "#a58bdd,#85d6be,#c9a7ef",
    sunset: "#ffc078,#e582a8,#a58bdd",
    ocean: "#6ed8df,#6d91d7,#9b84d4",
  };
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : d);
  const px = (v) => num(v) + "px";
  // Length: number -> px, 'N%' -> percent; anything else -> 0px.
  const len = (v) => (typeof v === "string" ? (/^-?\d+(\.\d+)?%$/.test(v) ? v : "0px") : px(v));
  /** Accept a free-form CSS value from the document only when it cannot break out of a declaration. */
  const safe = (value, fallback = "") =>
    typeof value === "string" &&
    value.length <= 4000 &&
    !/[;{}<>\\]/.test(value) &&
    !/url\s*\(/i.test(value)
      ? value
      : fallback;
  const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  const ALIGN = ["flex-start", "flex-end", "center", "stretch", "baseline", "start", "end"];
  const JUSTIFY = [
    "flex-start",
    "flex-end",
    "center",
    "space-between",
    "space-around",
    "space-evenly",
    "start",
    "end",
  ];

  /**
   * Sizing modes (wMode / hMode): Fixed always (with wPct/hPct it is Relative, a percentage of the parent);
   * Hug for text and flow frames; Fill inside flow parents; Auto (CSS `auto`) for text and frames; Calculate
   * (a CSS calc() expression of px and % terms in wCalc / hCalc) for any layer.
   */
  function sizingAllowed(n, parent, mode) {
    if (!mode || mode === "fixed" || mode === "calc") return true;
    if (mode === "hug") return n.type === "text" || (n.type === "frame" && n.layout !== "free");
    if (mode === "fill") return !!parent && parent.type === "frame" && parent.layout !== "free";
    if (mode === "auto") return n.type === "text" || n.type === "frame";
    return false;
  }
  const SIZING_MODES = ["fixed", "hug", "fill", "auto", "calc"];
  /** Block alignment (frame.justifyItems on a block frame) -> CSS justify-items. */
  const BLOCK_ALIGN = {
    "flex-start": "start",
    start: "start",
    center: "center",
    "flex-end": "end",
    end: "end",
  };
  /**
   * Parse a Calculate expression ("270px", "100% - 20px", "(50% + 8px) * 2") into its linear form
   * {pct, px, text}: the value is px + pct% of the parent, `text` the canonical spacing CSS calc() needs.
   * Only px and % lengths, unitless factors, + - * / and parentheses; null when invalid.
   */
  function parseCalc(input) {
    if (typeof input !== "string" || !input.trim() || input.length > 200) return null;
    const tokens =
      input
        .trim()
        .replace(/^calc\((.*)\)$/i, "$1")
        .match(/\d*\.?\d+(?:px|%)?|[-+*/()]|\S/gi) || [];
    let i = 0;
    const peek = () => tokens[i];
    const out = [];
    const unit = (t) => (/%$/.test(t) ? "pct" : /px$/i.test(t) ? "px" : "n");
    const factor = () => {
      const t = tokens[i++];
      if (t === undefined) return null;
      if (t === "(") {
        out.push("(");
        const v = expr();
        if (!v || tokens[i++] !== ")") return null;
        out.push(")");
        return v;
      }
      if (t === "-" || t === "+") {
        const at = out.length;
        const v = factor();
        if (!v) return null;
        if (t === "-") {
          out.splice(at, 0, /^\d/.test(out[at]) ? "-" : "-1 * ");
          return { pct: -v.pct, px: -v.px, n: -v.n, kind: v.kind };
        }
        return v;
      }
      if (!/^\d*\.?\d+(?:px|%)?$/i.test(t)) return null;
      const value = parseFloat(t),
        kind = unit(t);
      out.push(kind === "pct" ? value + "%" : kind === "px" ? value + "px" : String(value));
      return {
        pct: kind === "pct" ? value : 0,
        px: kind === "px" ? value : 0,
        n: kind === "n" ? value : 0,
        kind: kind === "n" ? "n" : "len",
      };
    };
    const term = () => {
      let a = factor();
      while (a && (peek() === "*" || peek() === "/")) {
        const op = tokens[i++];
        out.push(" " + op + " ");
        const b = factor();
        if (!b) return null;
        if (op === "*") {
          if (a.kind === "n") a = { pct: a.n * b.pct, px: a.n * b.px, n: a.n * b.n, kind: b.kind };
          else if (b.kind === "n") a = { pct: a.pct * b.n, px: a.px * b.n, n: 0, kind: "len" };
          else return null;
        } else {
          if (b.kind !== "n" || !b.n) return null;
          a = { pct: a.pct / b.n, px: a.px / b.n, n: a.n / b.n, kind: a.kind };
        }
      }
      return a;
    };
    const expr = () => {
      let a = term();
      while (a && (peek() === "+" || peek() === "-")) {
        const op = tokens[i++];
        out.push(" " + op + " ");
        const b = term();
        if (!b || b.kind !== a.kind) return null;
        const s = op === "-" ? -1 : 1;
        a = { pct: a.pct + s * b.pct, px: a.px + s * b.px, n: a.n + s * b.n, kind: a.kind };
      }
      return a;
    };
    const v = expr();
    if (!v || i !== tokens.length || v.kind !== "len" || ![v.pct, v.px].every(Number.isFinite))
      return null;
    return { pct: v.pct, px: v.px, text: out.join("") };
  }
  /** Resolve a Calculate expression against the parent's size (px). */
  const calcValue = (expr, base = 0) => {
    const c = parseCalc(expr);
    return c ? c.px + (c.pct / 100) * (Number(base) || 0) : null;
  };
  /** The CSS `calc()` for a Calculate expression, or '' when invalid. */
  const calcCss = (expr) => {
    const c = parseCalc(expr);
    return c ? `calc(${c.text})` : "";
  };
  /** Sizing validation, called by validateDocument in web/document-core.js (canvas and headless store). */
  function sizingError(n) {
    for (const [mode, calc] of [
      ["wMode", "wCalc"],
      ["hMode", "hCalc"],
    ]) {
      if (n[mode] !== undefined && !SIZING_MODES.includes(n[mode])) return "Invalid sizing mode";
      if (n[calc] !== undefined && !parseCalc(n[calc])) return "Invalid size expression";
      if (n[mode] === "calc" && n[calc] === undefined) return "Invalid size expression";
    }
    if (
      n.type === "frame" &&
      n.justifyItems !== undefined &&
      (typeof n.justifyItems !== "string" || n.justifyItems.length > 40)
    )
      return "Invalid node justifyItems";
    // Grid track sizes (Grid settings: each track is "Fill · N fr"): fr weights per column / row, missing = 1.
    for (const key of ["columnSizes", "rowSizes"])
      if (
        n[key] !== undefined &&
        (n.type !== "frame" ||
          !Array.isArray(n[key]) ||
          n[key].length > 100 ||
          !n[key].every((v) => isNum(v) && v > 0 && v <= 1000))
      )
        return "Invalid grid track sizes";
    // Grid "Automatic positioning" toggle (stored only while off).
    if (n.autoPosition !== undefined && (n.type !== "frame" || typeof n.autoPosition !== "boolean"))
      return "Invalid automatic positioning";
    return "";
  }
  /** fr weight of grid track `i` (Grid settings "Fill · N fr"); 1 when unset. */
  const trackWeight = (sizes, i) =>
    Array.isArray(sizes) && isNum(sizes[i]) && sizes[i] > 0 ? Math.min(1000, sizes[i]) : 1;
  /** grid-template-columns / -rows for `count` tracks: equal tracks stay `repeat(N, minmax(0, 1fr))`. */
  function gridTracks(count, sizes) {
    const weights = Array.from({ length: count }, (_, i) => trackWeight(sizes, i));
    return weights.every((w) => w === 1)
      ? `repeat(${count}, minmax(0, 1fr))`
      : weights.map((w) => `minmax(0, ${w}fr)`).join(" ");
  }
  function sizingMode(n, axis, parent) {
    const mode = n[axis === "w" ? "wMode" : "hMode"] || "fixed";
    // A Left & Right (Top & Bottom) constraint stretches the layer between both insets, in any parent.
    if (mode === "fill" && anchored(n, parent) && pinnedBoth(n, axis)) return "fill";
    if (mode === "calc" && !parseCalc(n[axis === "w" ? "wCalc" : "hCalc"])) return "fixed";
    return sizingAllowed(n, parent, mode) ? mode : "fixed";
  }
  const inFlow = (n, parent) => !!parent && parent.layout !== "free" && n.position !== "absolute";

  // ---------- Constraints ----------
  // Constraints are CSS anchoring of an absolutely positioned child (a child of a free frame, or an
  // absolute child of a flow frame). They live in the same fields the Tailwind codec uses, so they
  // export and re-import as written: `inset` [top, right, bottom, left] (px or 'N%') and `translate`.
  //   start   (Left/Top)          left inset, or no insets at all (x/y)
  //   end     (Right/Bottom)      right inset only
  //   stretch (Left & Right)      both insets, sizing mode fill (width auto between them)
  //   center  (Center)            left 50% + translate (-50% when exactly centered, else a px offset)
  //   scale   (Scale)             percentage inset + wPct/hPct
  // Insets are measured inside the parent's border (its padding box, the CSS containing block).
  const isSet = (v) => v !== null && v !== undefined;
  const isPct = (v) => typeof v === "string" && v.endsWith("%");
  const hasInset = (n) => Array.isArray(n.inset) && n.inset.some(isSet);
  /** Whether a layer is positioned by insets (and so has constraints). */
  function anchored(n, parent) {
    if (!parent) return false;
    return parent.layout !== "free" ? n.position === "absolute" : hasInset(n);
  }
  const AXES = {
    h: { start: 3, end: 1, t: 0, size: "w", pct: "wPct", mode: "wMode" },
    v: { start: 0, end: 2, t: 1, size: "h", pct: "hPct", mode: "hMode" },
  };
  const pinnedBoth = (n, axis) => {
    const a = AXES[axis === "w" ? "h" : "v"];
    return Array.isArray(n.inset) && isSet(n.inset[a.start]) && isSet(n.inset[a.end]);
  };
  /** The constraint per axis: {h, v} each 'start' | 'end' | 'stretch' | 'center' | 'scale'. */
  function constraintsOf(n) {
    const ins = Array.isArray(n.inset) ? n.inset : [],
      tr = Array.isArray(n.translate) ? n.translate : [];
    const read = (a) => {
      const s = ins[a.start],
        e = ins[a.end];
      if (s === "50%" && !isSet(e) && isSet(tr[a.t])) return "center";
      if (isPct(s) || isPct(e)) return "scale";
      if (isSet(s) && isSet(e)) return "stretch";
      return isSet(e) ? "end" : "start";
    };
    return { h: read(AXES.h), v: read(AXES.v) };
  }
  /**
   * Insets for constraints that keep a layer where it is. `box` is its geometry inside the parent's
   * padding box ({x, y, w, h}); `cb` the padding box size ({w, h}). Returns a patch (null = remove).
   */
  function anchorPatch(n, constraints, box, cb) {
    const r2 = (v) => Math.round(v * 100) / 100,
      pct = (v, total) => r2(total ? (v / total) * 100 : 0) + "%";
    const inset = [null, null, null, null],
      translate = [null, null],
      patch = {};
    for (const key of ["h", "v"]) {
      const a = AXES[key],
        c = constraints[key] || "start",
        pos = key === "h" ? box.x : box.y,
        size = box[a.size],
        total = cb[a.size];
      patch[a.pct] = null;
      if (c === "stretch") patch[a.mode] = "fill";
      else if (n[a.mode] === "fill" || (c === "scale" && n[a.mode] !== "fixed")) {
        patch[a.mode] = "fixed";
        patch[a.size] = r2(size);
      }
      if (c === "start") inset[a.start] = r2(pos);
      else if (c === "end") inset[a.end] = r2(total - pos - size);
      else if (c === "stretch") {
        inset[a.start] = r2(pos);
        inset[a.end] = r2(total - pos - size);
      } else if (c === "center") {
        inset[a.start] = "50%";
        const off = pos + size / 2 - total / 2;
        translate[a.t] = Math.abs(off) < 0.5 ? "-50%" : r2(pos - total / 2);
      } else if (c === "scale") {
        inset[a.start] = pct(pos, total);
        patch[a.pct] = r2(total ? (size / total) * 100 : 100);
      }
    }
    // Plain Left/Top is the x/y default: no insets at all.
    const plain = constraints.h === "start" && constraints.v === "start";
    patch.inset = plain ? null : inset;
    patch.translate = translate.some(isSet) ? translate : null;
    return patch;
  }
  /**
   * Where the insets place a layer inside its parent's padding box (the inverse of anchorPatch):
   * {x, y, w, h}. `size` is the layer's own size for axes the insets don't decide.
   */
  function anchoredBox(n, cb, size) {
    const ins = Array.isArray(n.inset) ? n.inset : [],
      tr = Array.isArray(n.translate) ? n.translate : [],
      out = {};
    const resolve = (v, total) => (isPct(v) ? (parseFloat(v) / 100) * total : num(v));
    for (const key of ["h", "v"]) {
      const a = AXES[key],
        total = cb[a.size],
        s = ins[a.start],
        e = ins[a.end],
        t = tr[a.t];
      let w =
        isSet(n[a.pct]) && (n[a.mode] || "fixed") === "fixed"
          ? (num(n[a.pct]) / 100) * total
          : size[a.size];
      let pos;
      if (isSet(s) && isSet(e) && n[a.mode] === "fill") {
        pos = resolve(s, total);
        w = Math.max(0, total - pos - resolve(e, total));
      } else if (isSet(s)) pos = resolve(s, total);
      else if (isSet(e)) pos = total - resolve(e, total) - w;
      else pos = key === "h" ? num(n.x) : num(n.y);
      if (isSet(t)) pos += isPct(t) ? (parseFloat(t) / 100) * w : num(t);
      out[key === "h" ? "x" : "y"] = pos;
      out[a.size] = w;
    }
    return out;
  }

  // ---------- Effects ----------
  // Structured effects (all optional; documents without them render exactly as before):
  //   blendMode     one of BLEND_MODES -> mix-blend-mode (plus-darker falls back to color-burn where unsupported)
  //   outlineWidth/outlineOffset/outlineColor/outlineStyle -> a real CSS outline (drawn outside the border box)
  //   shadows [{type: 'box'|'drop'|'text', inset?, x, y, blur, spread, color, token?, hidden?}]
  //     box -> box-shadow (inset = inner shadow), drop -> filter drop-shadow(), text -> text-shadow (text layers only)
  //     `token` binds the color to a Colors variable; `color` keeps the resolved fallback.
  //   filters [{type: keyof FILTERS, value, backdrop?, hidden?}] -> filter / backdrop-filter, in list order
  //   masks [{type: 'linear'|'radial'|'conic'|'image'|'custom', rotation, alpha, invert?, hidden?,
  //           src? (image: embedded data URL), css? (custom: a CSS gradient), mode? ('alpha'|'luminance'),
  //           repeat?, x?/y? (position %), size? ('auto'|'cover'|'contain'|'<n>%'|'<n>px'), composite?}]
  //     -> mask-image layers plus mask-mode / mask-repeat / mask-position / mask-size / mask-composite lists
  //   masks [{type: 'shape', shape: 'inset(T% R% B% L%)', hidden?, composite?}]: a shape mask made by "Use as mask"
  //     (Wonder P5): the consumed sibling's rectangle, as CSS inset() percentages of this layer's box (negative =
  //     outside it). Rendered as an SVG rectangle mask layer stretched over the box; the other mask options do not apply.
  //   outlineToken / strokeToken bind the outline / border colour to a Colors variable; strokeColors
  //     [{color, token?} x4] (top, right, bottom, left) paints each border side separately.
  //   strokeHidden / outlineHidden: true hides the border / outline without discarding it (the inspector's
  //     eye toggle): nothing is drawn and the border takes no space.
  //   strokeHiddenSides [bool x4] (top, right, bottom, left) hides single sides of a per-side border
  //     (strokeWidths) the same way: the side keeps its width and colour but draws nothing.
  const BLEND_MODES = [
    "normal",
    "darken",
    "multiply",
    "plus-darker",
    "color-burn",
    "lighten",
    "screen",
    "plus-lighter",
    "color-dodge",
    "overlay",
    "soft-light",
    "hard-light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
  ];
  const FILTERS = {
    blur: { fn: "blur", unit: "px", min: 0, max: 1000, value: 4 },
    brightness: { fn: "brightness", unit: "", min: 0, max: 3, value: 1.2 },
    contrast: { fn: "contrast", unit: "", min: 0, max: 3, value: 1.2 },
    grayscale: { fn: "grayscale", unit: "", min: 0, max: 1, value: 1 },
    hueRotate: { fn: "hue-rotate", unit: "deg", min: -360, max: 360, value: 90 },
    invert: { fn: "invert", unit: "", min: 0, max: 1, value: 1 },
    saturate: { fn: "saturate", unit: "", min: 0, max: 3, value: 1.5 },
    sepia: { fn: "sepia", unit: "", min: 0, max: 1, value: 1 },
  };
  const SHADOW_TYPES = ["box", "drop", "text"];
  const MASK_TYPES = ["linear", "radial", "conic", "image", "custom", "shape"];
  const MASK_MODES = ["auto", "alpha", "luminance"];
  const MASK_REPEATS = ["repeat", "no-repeat", "repeat-x", "repeat-y", "space", "round"];
  const MASK_COMPOSITES = ["add", "subtract", "intersect", "exclude"];
  const MASK_SIZE = /^(auto|cover|contain|\d{1,5}(\.\d{1,3})?(px|%)( \d{1,5}(\.\d{1,3})?(px|%))?)$/;
  const MASK_IMAGE = /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
  // Room asset URLs (cloud/assets.js): the check lives in web/document-core.js, loaded after this file.
  const assetUrl = (v) => !!root.VerynizeDocument?.isRoomAssetUrl?.(v);
  const imageSource = (v) => typeof v === "string" && (MASK_IMAGE.test(v) || assetUrl(v));
  const MASK_CSS = /^(repeating-)?(linear|radial|conic)-gradient\([^;{}<>\\]{1,2000}\)$/i;
  const MASK_SHAPE = /^inset\(-?\d{1,5}(\.\d{1,3})?%( -?\d{1,5}(\.\d{1,3})?%){0,3}\)$/;
  /** inset() percentages as [top, right, bottom, left] (CSS shorthand: 1–4 values), or null. */
  function maskInset(shape) {
    if (typeof shape !== "string" || !MASK_SHAPE.test(shape)) return null;
    const v = shape.slice(6, -1).split(" ").map(parseFloat);
    return [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]];
  }
  const toBase64 = (text) =>
    typeof btoa === "function" ? btoa(text) : Buffer.from(text).toString("base64");
  const OUTLINE_STYLES = ["solid", "dashed", "dotted"];
  const FX_HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
  const FX_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_./ -]{0,99}$/;
  const r3 = (v) => Math.round(num(v) * 1000) / 1000;
  const visible = (list) =>
    Array.isArray(list)
      ? list.filter((item) => item && typeof item === "object" && item.hidden !== true)
      : [];
  /** Shadow color: the bound Colors variable when it resolves, else the stored color. */
  const shadowColor = (s, tokens) =>
    s.token && tokens && FX_HEX.test(tokens[s.token] || "")
      ? tokens[s.token]
      : FX_HEX.test(s.color || "")
        ? s.color
        : "#00000040";
  function shadowCss(s, tokens) {
    const base = `${px(r3(s.x))} ${px(r3(s.y))} ${px(Math.max(0, r3(s.blur)))}`,
      color = shadowColor(s, tokens);
    if (s.type === "drop") return `drop-shadow(${base} ${color})`;
    if (s.type === "text") return `${base} ${color}`;
    return `${s.inset === true ? "inset " : ""}${base} ${px(r3(s.spread))} ${color}`;
  }
  const filterCss = (f) => {
    const d = FILTERS[f.type];
    return `${d.fn}(${r3(Math.min(d.max, Math.max(d.min, num(f.value, d.value))))}${d.unit})`;
  };
  function maskCss(m) {
    if (m.type === "image") return `url("${m.src}")`;
    if (m.type === "custom") return m.css;
    if (m.type === "shape") {
      const [t, r, b, l] = maskInset(m.shape),
        w = Math.max(0, 100 - l - r),
        h = Math.max(0, 100 - t - b);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="${r3(l)}" y="${r3(t)}" width="${r3(w)}" height="${r3(h)}"/></svg>`;
      return `url("data:image/svg+xml;base64,${toBase64(svg)}")`;
    }
    const a = Math.min(100, Math.max(0, num(m.alpha, 100))) / 100,
      solid = `rgba(0, 0, 0, ${r3(a)})`,
      clear = "rgba(0, 0, 0, 0)";
    const [from, to] = m.invert === true ? [clear, solid] : [solid, clear];
    if (m.type === "radial") return `radial-gradient(${from}, ${to})`;
    if (m.type === "conic") return `conic-gradient(from ${r3(m.rotation)}deg, ${from}, ${to})`;
    return `linear-gradient(${r3(m.rotation)}deg, ${from}, ${to})`;
  }
  /**
   * Effect values for one layer, shared by the canvas, HTML export and the JSX codec.
   * Returns {blend, outline, boxShadow[], drop[], textShadow[], filter[], backdrop[], masks[]} (CSS strings).
   */
  function effectsOf(n, tokens) {
    const shadows = visible(n.shadows),
      filters = visible(n.filters).filter((f) => FILTERS[f.type]),
      masks = visible(n.masks).filter(usableMask);
    const width = n.outlineHidden === true ? 0 : Math.max(0, num(n.outlineWidth));
    return {
      blend: BLEND_MODES.includes(n.blendMode) && n.blendMode !== "normal" ? n.blendMode : "",
      outline:
        width > 0
          ? {
              width,
              style: pick(n.outlineStyle, OUTLINE_STYLES, "solid"),
              color: shadowColor(
                { color: n.outlineColor || "#000000", token: n.outlineToken },
                tokens,
              ),
              offset: num(n.outlineOffset),
            }
          : null,
      border: borderColors(n, tokens),
      boxShadow: shadows.filter((s) => s.type === "box").map((s) => shadowCss(s, tokens)),
      drop: shadows.filter((s) => s.type === "drop").map((s) => shadowCss(s, tokens)),
      textShadow:
        n.type === "text"
          ? shadows.filter((s) => s.type === "text").map((s) => shadowCss(s, tokens))
          : [],
      filter: filters.filter((f) => f.backdrop !== true).map(filterCss),
      backdrop: filters.filter((f) => f.backdrop === true).map(filterCss),
      masks: masks.map(maskCss),
      maskLayers: masks.map((m) =>
        m.type === "shape"
          ? {
              mode: "alpha",
              repeat: "no-repeat",
              position: "0% 0%",
              size: "100% 100%",
              composite: pick(m.composite, MASK_COMPOSITES, "add"),
            }
          : {
              mode: m.mode === "alpha" || m.mode === "luminance" ? m.mode : "match-source",
              repeat: pick(m.repeat, MASK_REPEATS, "repeat"),
              position: `${r3(num(m.x))}% ${r3(num(m.y))}%`,
              size: MASK_SIZE.test(m.size || "") ? m.size : "auto",
              composite: pick(m.composite, MASK_COMPOSITES, "add"),
            },
      ),
    };
  }
  /** Border colour CSS (one value or four sides) when a variable or per-side colours apply, else ''. */
  function borderColors(n, tokens) {
    if (Array.isArray(n.strokeColors) && n.strokeColors.length === 4)
      return n.strokeColors
        .map((c) =>
          shadowColor({ color: c?.color || n.strokeColor || "#000000", token: c?.token }, tokens),
        )
        .join(" ");
    if (n.strokeToken && tokens && FX_HEX.test(tokens[n.strokeToken] || ""))
      return tokens[n.strokeToken];
    return "";
  }
  const usableMask = (m) =>
    MASK_TYPES.includes(m.type) &&
    (m.type !== "image" || imageSource(m.src)) &&
    (m.type !== "custom" || MASK_CSS.test(m.css || "")) &&
    (m.type !== "shape" || !!maskInset(m.shape));
  const isBool = (v) => v === undefined || typeof v === "boolean";
  const finite = (v, min, max) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  /** Validate the structured effect fields of a layer. Returns an error message, or '' when valid. */
  function validateEffects(n) {
    if (n.blendMode !== undefined && !BLEND_MODES.includes(n.blendMode))
      return "Invalid blend mode";
    if (n.outlineWidth !== undefined && !finite(n.outlineWidth, 0, 1000))
      return "Invalid outline width";
    if (n.outlineOffset !== undefined && !finite(n.outlineOffset, -1000, 1000))
      return "Invalid outline offset";
    if (n.outlineColor !== undefined && !FX_HEX.test(String(n.outlineColor)))
      return "Invalid outline color";
    if (n.outlineStyle !== undefined && !OUTLINE_STYLES.includes(n.outlineStyle))
      return "Invalid outline style";
    const tokenName = (v) => v === undefined || (typeof v === "string" && FX_NAME.test(v));
    if (!tokenName(n.outlineToken)) return "Invalid outline color variable";
    if (!tokenName(n.strokeToken)) return "Invalid border color variable";
    if (!isBool(n.strokeHidden)) return "Invalid border visibility";
    if (!isBool(n.outlineHidden)) return "Invalid outline visibility";
    if (
      n.strokeHiddenSides !== undefined &&
      (!Array.isArray(n.strokeHiddenSides) ||
        n.strokeHiddenSides.length !== 4 ||
        !n.strokeHiddenSides.every((v) => typeof v === "boolean"))
    )
      return "Invalid border side visibility";
    if (
      n.strokeColors !== undefined &&
      (!Array.isArray(n.strokeColors) ||
        n.strokeColors.length !== 4 ||
        !n.strokeColors.every(
          (c) => c && typeof c === "object" && FX_HEX.test(String(c.color)) && tokenName(c.token),
        ))
    )
      return "Invalid border side colors";
    const list = (v, max) =>
      v === undefined ||
      (Array.isArray(v) &&
        v.length <= max &&
        v.every(
          (item) => item && typeof item === "object" && !Array.isArray(item) && isBool(item.hidden),
        ));
    if (!list(n.shadows, 20)) return "Invalid shadows";
    for (const s of n.shadows || []) {
      if (!SHADOW_TYPES.includes(s.type) || (s.type === "text" && n.type !== "text"))
        return "Invalid shadow type";
      if (
        !["x", "y", "spread"].every((k) => finite(s[k], -10000, 10000)) ||
        !finite(s.blur, 0, 10000)
      )
        return "Invalid shadow geometry";
      if (
        !FX_HEX.test(String(s.color)) ||
        (s.token !== undefined && (typeof s.token !== "string" || !FX_NAME.test(s.token)))
      )
        return "Invalid shadow color";
      if (!isBool(s.inset) || (s.inset === true && s.type !== "box")) return "Invalid inner shadow";
    }
    if (!list(n.filters, 20)) return "Invalid filters";
    for (const f of n.filters || [])
      if (
        !Object.hasOwn(FILTERS, f.type) ||
        !finite(f.value, FILTERS[f.type].min, FILTERS[f.type].max) ||
        !isBool(f.backdrop)
      )
        return "Invalid filter";
    if (!list(n.masks, 8)) return "Invalid masks";
    for (const m of n.masks || []) {
      if (
        !MASK_TYPES.includes(m.type) ||
        !finite(m.rotation ?? 0, -3600, 3600) ||
        !finite(m.alpha ?? 100, 0, 100) ||
        !isBool(m.invert)
      )
        return "Invalid mask";
      if (
        m.type === "image" &&
        (typeof m.src !== "string" || m.src.length > 15e6 || !imageSource(m.src))
      )
        return "Image mask needs an embedded base64 image or a room asset";
      if (
        m.type === "custom" &&
        (typeof m.css !== "string" || !MASK_CSS.test(m.css) || /url\s*\(/i.test(m.css))
      )
        return "Custom mask needs a CSS gradient";
      if (m.type === "shape" && !maskInset(m.shape))
        return "Shape mask needs an inset() of percentages";
      if (m.shape !== undefined && m.type !== "shape") return "Invalid mask";
      if (m.mode !== undefined && !MASK_MODES.includes(m.mode)) return "Invalid mask mode";
      if (m.repeat !== undefined && !MASK_REPEATS.includes(m.repeat)) return "Invalid mask repeat";
      if (m.composite !== undefined && !MASK_COMPOSITES.includes(m.composite))
        return "Invalid mask operation";
      if (!finite(m.x ?? 0, -10000, 10000) || !finite(m.y ?? 0, -10000, 10000))
        return "Invalid mask position";
      if (m.size !== undefined && (typeof m.size !== "string" || !MASK_SIZE.test(m.size)))
        return "Invalid mask size";
    }
    return "";
  }

  // ---------- Paints ----------
  // Optional paint stack `fills` (index 0 paints on top), used by Background Fill and Text Fill:
  //   {type: 'solid', color, token?, opacity?, hidden?}
  //   {type: 'linear' | 'radial' | 'conic', angle?, stops: [{position 0–100, color, token?}], opacity?, hidden?}
  //   {type: 'image', src (embedded data URL), fit: 'fill' | 'cover' | 'contain' | 'none', imageWidth?, imageHeight?, opacity?, hidden?}
  // Without `fills` a layer keeps the single `color`/`token` fill (older documents). Colours are #rrggbb[aa];
  // `token` names a colour variable and wins over `color` while it exists (color keeps the resolved value).
  // `svgPaints` ({'#original': '#replacement'}) recolours individual paints of a multicolour SVG image.
  const HEX_COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
  const TOKEN_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_./ -]{0,99}$/;
  const PAINT_TYPES = ["solid", "linear", "radial", "conic", "image"];
  const GRADIENT_TYPES = ["linear", "radial", "conic"];
  const IMAGE_FITS = ["fill", "cover", "contain", "none"];
  const PAINT_IMAGE = /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
  const SVG_SOURCE = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/=\s]+)$/;
  const inRange = (v, min, max) => isNum(v) && v >= min && v <= max;
  function colorError(c, label) {
    if (!c || typeof c !== "object" || !HEX_COLOR.test(c.color || ""))
      return `${label} needs a six- or eight-digit hex colour`;
    if (
      c.token !== undefined &&
      (typeof c.token !== "string" || (c.token !== "" && !TOKEN_NAME.test(c.token)))
    )
      return `${label} has an invalid colour variable`;
    return "";
  }
  function onePaintError(p) {
    if (!p || typeof p !== "object" || Array.isArray(p) || !PAINT_TYPES.includes(p.type))
      return "Paint type must be solid, linear, radial, conic or image";
    if (p.hidden !== undefined && typeof p.hidden !== "boolean")
      return "Paint visibility must be true or false";
    if (p.opacity !== undefined && !inRange(p.opacity, 0, 100))
      return "Paint opacity must be 0–100";
    if (p.type === "solid") return colorError(p, "Solid paint");
    if (GRADIENT_TYPES.includes(p.type)) {
      if (p.angle !== undefined && !inRange(p.angle, -3600, 3600))
        return "Gradient angle must be a number of degrees";
      if (!Array.isArray(p.stops) || p.stops.length < 2 || p.stops.length > 16)
        return "Gradients need 2–16 stops";
      for (const s of p.stops) {
        const e = colorError(s, "Gradient stop");
        if (e) return e;
        if (!inRange(s.position, 0, 100)) return "Gradient stop position must be 0–100";
      }
      return "";
    }
    if (
      typeof p.src !== "string" ||
      p.src.length > 15e6 ||
      !(PAINT_IMAGE.test(p.src) || assetUrl(p.src))
    )
      return "Image paint needs an embedded base64 image or a room asset";
    if (p.fit !== undefined && !IMAGE_FITS.includes(p.fit))
      return "Image fit must be fill, cover, contain or none";
    for (const k of ["imageWidth", "imageHeight"])
      if (p[k] !== undefined && !inRange(p[k], 1, 1e5)) return "Invalid image paint size";
    return "";
  }
  /** Validation called by validateDocument in web/document-core.js (canvas and headless store). */
  function paintError(n) {
    if (n.fills !== undefined) {
      if (!Array.isArray(n.fills) || n.fills.length > 16)
        return "fills must be a list of at most 16 paints";
      for (const p of n.fills) {
        const e = onePaintError(p);
        if (e) return e;
      }
    }
    if (n.backgroundFills !== undefined) {
      // Text layers only: the Background Fill stack drawn behind the glyphs.
      if (n.type !== "text" || !Array.isArray(n.backgroundFills) || n.backgroundFills.length > 16)
        return "backgroundFills must be a list of at most 16 paints on a text layer";
      for (const p of n.backgroundFills) {
        const e = onePaintError(p);
        if (e) return e;
      }
    }
    if (n.svgPaints !== undefined) {
      const map = n.svgPaints;
      if (
        n.type !== "image" ||
        !SVG_SOURCE.test(n.src || "") ||
        !map ||
        typeof map !== "object" ||
        Array.isArray(map) ||
        Object.keys(map).length > 64
      )
        return "svgPaints needs an SVG image and at most 64 colours";
      for (const [from, to] of Object.entries(map))
        if (
          !/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(from) ||
          typeof to !== "string" ||
          !HEX_COLOR.test(to)
        )
          return "svgPaints maps lower-case hex colours to hex colours";
    }
    return "";
  }
  /** Flat `${prefix}Color` / `${prefix}Token` pair (outline, border) seen as one {color, token} holder. */
  function flatHolder(n, colorKey, tokenKey, fn) {
    if (n[colorKey] === undefined && !n[tokenKey]) return;
    const h = { color: n[colorKey], token: n[tokenKey] };
    fn(h);
    if (h.color !== undefined) n[colorKey] = h.color;
    if (h.token) n[tokenKey] = h.token;
    else delete n[tokenKey];
  }
  /**
   * Call fn on every colour holder ({color, token}) of a layer that can bind a Colors variable: solid paints and
   * gradient stops, shadows, border (uniform `strokeToken` and per-side `strokeColors`), outline
   * (`outlineToken`) and shader colours. Rename/delete/sync of colour variables goes through here.
   */
  function eachPaintColor(n, fn) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n.fills))
      for (const p of n.fills) {
        if (p?.type === "solid") fn(p);
        else if (Array.isArray(p?.stops)) for (const s of p.stops) if (s) fn(s);
      }
    if (Array.isArray(n.backgroundFills))
      for (const p of n.backgroundFills) {
        if (p?.type === "solid") fn(p);
        else if (Array.isArray(p?.stops)) for (const s of p.stops) if (s) fn(s);
      }
    if (Array.isArray(n.shadows)) for (const s of n.shadows) if (s && typeof s === "object") fn(s);
    if (Array.isArray(n.strokeColors))
      for (const s of n.strokeColors) if (s && typeof s === "object") fn(s);
    if (n.shaderColors && typeof n.shaderColors === "object")
      for (const c of Object.values(n.shaderColors)) if (c && typeof c === "object") fn(c);
    flatHolder(n, "strokeColor", "strokeToken", fn);
    flatHolder(n, "outlineColor", "outlineToken", fn);
  }
  const resolveColor = (c, tokens) =>
    c.token && tokens && HEX_COLOR.test(tokens[c.token] || "") ? tokens[c.token] : c.color;
  /** #rrggbb[aa] × opacity percent → CSS colour. */
  function paintColor(hex, opacity = 100) {
    if (!HEX_COLOR.test(hex)) return "transparent";
    const a =
      ((hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1) *
        Math.max(0, Math.min(100, num(opacity, 100)))) /
      100;
    if (a >= 1) return hex.slice(0, 7).toLowerCase();
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
  }
  const visibleFills = (n) =>
    Array.isArray(n.fills) ? n.fills.filter((p) => p && !p.hidden) : null;
  const IMAGE_SIZE = { fill: "100% 100%", cover: "cover", contain: "contain", none: "auto" };
  const ASPECT = { fill: "none", cover: "xMidYMid slice", contain: "xMidYMid meet" };
  /** One paint → a CSS background layer {image, size, position, repeat}. */
  function paintLayer(p, tokens) {
    const o = num(p.opacity, 100);
    if (p.type === "solid") {
      const c = paintColor(resolveColor(p, tokens), o);
      return {
        image: `linear-gradient(${c}, ${c})`,
        size: "auto",
        position: "0% 0%",
        repeat: "repeat",
      };
    }
    if (GRADIENT_TYPES.includes(p.type)) {
      const stops = [...p.stops]
        .sort((a, b) => a.position - b.position)
        .map((s) => `${paintColor(resolveColor(s, tokens), o)} ${num(s.position)}%`)
        .join(", ");
      const angle = num(p.angle, p.type === "linear" ? 180 : 0);
      const image =
        p.type === "linear"
          ? `linear-gradient(${angle}deg, ${stops})`
          : p.type === "radial"
            ? `radial-gradient(ellipse farthest-corner at 50% 50%, ${stops})`
            : `conic-gradient(from ${angle}deg at 50% 50%, ${stops})`;
      return { image, size: "auto", position: "0% 0%", repeat: "repeat" };
    }
    const fit = pick(p.fit, IMAGE_FITS, "fill");
    let url = p.src,
      size = IMAGE_SIZE[fit];
    if (o < 100 && !/^data:/.test(p.src)) {
      // Room asset URL: an SVG image cannot load it, so fade it against a transparent layer.
      const image = `-webkit-cross-fade(linear-gradient(transparent, transparent), url("${p.src}"), ${Math.round(o)}%)`;
      return { image, size, position: "center", repeat: "no-repeat" };
    }
    if (o < 100) {
      // CSS has no per-layer opacity: wrap the bitmap in an SVG image that applies it.
      const w = num(p.imageWidth),
        h = num(p.imageHeight),
        alpha = Math.round(o) / 100;
      if (fit !== "none") {
        url =
          "data:image/svg+xml," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image width="100%" height="100%" preserveAspectRatio="${ASPECT[fit]}" opacity="${alpha}" xlink:href="${p.src}"/></svg>`,
          );
        size = "100% 100%";
      } else if (w && h)
        url =
          "data:image/svg+xml," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}"><image width="${w}" height="${h}" opacity="${alpha}" xlink:href="${p.src}"/></svg>`,
          );
    }
    return { image: `url("${url}")`, size, position: "center", repeat: "no-repeat" };
  }
  /** CSS for a paint stack: {layers, solid} where solid is the colour when the stack is one visible solid paint. */
  function fillsCss(n, tokens) {
    const paints = visibleFills(n);
    if (!paints) return null;
    const only =
      paints.length === 1 && paints[0].type === "solid"
        ? paintColor(resolveColor(paints[0], tokens), num(paints[0].opacity, 100))
        : null;
    return { solid: only, layers: paints.map((p) => paintLayer(p, tokens)) };
  }

  // ---------- SVG paints ----------
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
  /** An SVG paint value → lower-case #rrggbb[aa], or null for none/currentColor/url()/unknown. */
  function svgColorKey(value) {
    let v = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s*!important$/, "");
    if (NAMED[v]) return NAMED[v];
    if (/^#[0-9a-f]{3,4}$/.test(v)) v = "#" + [...v.slice(1)].map((c) => c + c).join("");
    if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v))
      return v.length === 9 && v.endsWith("ff") ? v.slice(0, 7) : v;
    const m =
      /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
    if (!m) return null;
    const hex = [m[1], m[2], m[3]]
      .map((x) => Math.min(255, +x).toString(16).padStart(2, "0"))
      .join("");
    const a =
      m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return (
      "#" +
      hex +
      (a >= 1
        ? ""
        : Math.round(Math.max(0, a) * 255)
            .toString(16)
            .padStart(2, "0"))
    );
  }
  const SVG_PAINT_PROPS = "fill|stroke|stop-color|flood-color|lighting-color";
  const SVG_ATTR = new RegExp(`(?<![\\w-])(${SVG_PAINT_PROPS})(\\s*=\\s*)(["'])([^"']*)\\3`, "gi");
  const SVG_DECL = new RegExp(`(?<![\\w-])(${SVG_PAINT_PROPS})(\\s*:\\s*)([^;"'}<>]+)`, "gi");
  function svgMarkup(src) {
    const m = SVG_SOURCE.exec(src || "");
    if (!m) return null;
    try {
      return new TextDecoder().decode(
        Uint8Array.from(atob(m[1].replace(/\s/g, "")), (c) => c.charCodeAt(0)),
      );
    } catch {
      return null;
    }
  }
  /** Distinct explicit paints of an SVG, in document order. */
  function svgPaintList(src) {
    const markup = svgMarkup(src);
    if (!markup) return [];
    const out = new Set();
    for (const m of markup.matchAll(SVG_ATTR)) {
      const k = svgColorKey(m[4]);
      if (k) out.add(k);
    }
    for (const m of markup.matchAll(SVG_DECL)) {
      const k = svgColorKey(m[3]);
      if (k) out.add(k);
    }
    return [...out];
  }
  const recolorCache = new Map();
  /** Source with every paint listed in `map` replaced (the stored source is never changed). */
  function recolorSvg(src, map) {
    if (!map || typeof map !== "object" || !Object.keys(map).length) return src;
    const key = JSON.stringify(map) + src;
    if (recolorCache.has(key)) return recolorCache.get(key);
    const markup = svgMarkup(src);
    if (!markup) return src;
    const swap = (v) => {
      const k = svgColorKey(v);
      return k && HEX_COLOR.test(map[k] || "") ? map[k] : null;
    };
    const next = markup
      .replace(SVG_ATTR, (all, prop, eq, q, v) => {
        const c = swap(v);
        return c ? `${prop}${eq}${q}${c}${q}` : all;
      })
      .replace(SVG_DECL, (all, prop, sep, v) => {
        const c = swap(v);
        return c ? `${prop}${sep}${c}${/!important\s*$/i.test(v) ? " !important" : ""}` : all;
      });
    const bytes = new TextEncoder().encode(next);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const out = "data:image/svg+xml;base64," + btoa(binary);
    if (recolorCache.size > 64) recolorCache.clear();
    recolorCache.set(key, out);
    return out;
  }

  function nodeStyle(n, parent, ctx = {}) {
    const decl = new Map();
    // Later writes win and move to the end, so shorthands never clobber longhands set after them.
    const set = (k, v) => {
      if (v === undefined || v === null || v === "") return;
      decl.delete(k);
      decl.set(k, String(v));
    };
    const color = safe(ctx.color ?? n.color, n.type === "text" ? "#25252e" : "transparent");
    const flowParent = !!parent && parent.layout !== "free";
    // Positioned by insets: an absolute child of a flow frame, or a child of a free frame with constraints.
    const absoluteInFlow = anchored(n, parent);
    const flow = flowParent && !absoluteInFlow;

    // Base box.
    set("box-sizing", "border-box");
    set("position", flow ? "relative" : "absolute");
    if (!flowParent && !absoluteInFlow) {
      set("left", px(n.x));
      set("top", px(n.y));
    }
    set("width", px(n.w));
    set("height", px(n.h));
    set("border-radius", px(n.radius));
    set("font-size", px(num(n.fontSize, 16)));
    set("font-family", safe(n.fontFamily, "system-ui"));
    set(
      "font-weight",
      /^(normal|bold|[1-9][0-9]{0,2}|1000)$/.test(String(n.fontWeight))
        ? String(n.fontWeight)
        : "400",
    );
    set(
      "text-align",
      pick(n.textAlign, ["left", "center", "right", "justify", "start", "end"], "left"),
    );
    set("line-height", n.lineHeight === "auto" ? "normal" : String(num(n.lineHeight, 1.15)));
    set("letter-spacing", px(n.letterSpacing));
    // Rotation, then flips (negative scale) in the node's own frame: transform = rotate(r) scale(±1, ±1).
    const flip =
      n.flipX === true || n.flipY === true
        ? `scale(${n.flipX === true ? -1 : 1}, ${n.flipY === true ? -1 : 1})`
        : "";
    if (num(n.rotation) || flip)
      set(
        "transform",
        [num(n.rotation) ? `rotate(${num(n.rotation)}deg)` : "", flip].filter(Boolean).join(" "),
      );
    set("opacity", String(num(n.opacity, 100) / 100));
    // A vector layer paints its fill and stroke in its <svg> (web/vector-geometry.js), never on the box.
    const vector = n.type === "vector";
    set(
      "border",
      `${n.strokeHidden === true || vector ? 0 : Math.max(0, num(n.strokeWidth))}px solid ${safe(n.strokeColor, "#000000")}`,
    );
    if (safe(n.shadow)) set("box-shadow", safe(n.shadow));
    if (n.clipContent) set("overflow", "hidden");
    set("white-space", "pre-wrap");
    set("overflow-wrap", "anywhere");
    set("color", color);
    set("z-index", String(Math.round(num(n.zIndex))));
    set("flex-shrink", "0");
    set("background", n.type === "text" || vector ? "transparent" : color);
    if (n.type !== "text" && !vector && safe(n.gradient)) set("background-image", safe(n.gradient));
    const paints = n.type === "shader" || vector ? null : fillsCss(n, ctx.tokens);
    if (paints && n.type === "text" && paints.solid) set("color", paints.solid);
    else if (paints) {
      // A legacy CSS gradient string stays on top of the stack.
      const layers = [
        ...(n.type !== "text" && safe(n.gradient)
          ? [{ image: safe(n.gradient), size: "auto", position: "0% 0%", repeat: "repeat" }]
          : []),
        ...paints.layers,
      ];
      set("background", "transparent");
      if (layers.length)
        for (const [prop, key] of [
          ["background-image", "image"],
          ["background-size", "size"],
          ["background-position", "position"],
          ["background-repeat", "repeat"],
        ])
          set(prop, layers.map((l) => l[key]).join(", "));
      if (n.type === "text") {
        set("color", "transparent");
        set("-webkit-background-clip", "text");
        set("background-clip", "text");
      }
    }
    // Text Background Fill (`backgroundFills`): box-clipped layers under any text-clipped Text Fill layers.
    const backdrop =
      n.type === "text" && Array.isArray(n.backgroundFills)
        ? fillsCss({ fills: n.backgroundFills }, ctx.tokens)
        : null;
    if (backdrop?.layers.length) {
      const glyphs = paints && !paints.solid ? paints.layers : [];
      const layers = [...glyphs, ...backdrop.layers];
      for (const [prop, key] of [
        ["background-image", "image"],
        ["background-size", "size"],
        ["background-position", "position"],
        ["background-repeat", "repeat"],
      ])
        set(prop, layers.map((l) => l[key]).join(", "));
      const clip = layers.map((_, i) => (i < glyphs.length ? "text" : "border-box")).join(", ");
      set("-webkit-background-clip", clip);
      set("background-clip", clip);
    }
    if (PALETTES[n.animated] && !vector) {
      set("background-image", `linear-gradient(120deg,${PALETTES[n.animated]})`);
      set("background-size", "250% 250%");
      set("animation", "design-gradient 8s ease infinite");
    }
    if (safe(n.mask)) set("mask-image", safe(n.mask));
    if (parent?.layout === "inline") {
      set("display", "inline-block");
      set("vertical-align", "top");
    }

    // Frame layout.
    if (n.type === "frame") {
      const layout = n.layout || "free";
      set(
        "display",
        layout === "free" || layout === "inline"
          ? "block"
          : layout === "block"
            ? "flow-root"
            : layout,
      );
      if (layout === "free") set("padding", "0px");
      else {
        const p = num(n.padding);
        set(
          "padding",
          [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft]
            .map((v) => px(v ?? p))
            .join(" "),
        );
      }
      if (layout === "flex" || layout === "grid") {
        const g = num(n.gap);
        set("row-gap", px(n.gapY ?? g));
        set("column-gap", px(n.gapX ?? g));
        set("align-items", pick(n.alignItems, ALIGN, "stretch"));
        set("justify-content", pick(n.justifyContent, JUSTIFY, "flex-start"));
      }
      if (layout === "flex") {
        set(
          "flex-direction",
          (n.direction === "column" ? "column" : "row") + (n.reverse === true ? "-reverse" : ""),
        );
        if (n.flexWrap) set("flex-wrap", "wrap");
      }
      if (layout === "grid") {
        set(
          "grid-template-columns",
          gridTracks(Math.max(1, Math.min(100, Math.floor(num(n.columns, 2)) || 2)), n.columnSizes),
        );
        if (num(n.rows) >= 1)
          set("grid-template-rows", gridTracks(Math.min(100, Math.floor(num(n.rows))), n.rowSizes));
        if (n.justifyItems !== undefined)
          set("justify-items", pick(n.justifyItems, ALIGN, "stretch"));
      }
      // Block alignment: children narrower than the frame sit left / centre / right (justify-items in block flow).
      if (layout === "block" && BLOCK_ALIGN[n.justifyItems])
        set("justify-items", BLOCK_ALIGN[n.justifyItems]);
    }

    // Sizing modes (hug = fit content, fill = stretch into the parent).
    const w = sizingMode(n, "w", parent),
      h = sizingMode(n, "h", parent);
    const flex = parent?.layout === "flex",
      row = flex && parent.direction !== "column";
    if (w === "hug") set("width", n.type === "text" && !parent ? "max-content" : "fit-content");
    if (h === "hug") set("height", "auto");
    // Auto is CSS `auto` (fills a block parent, fits content in a flex row); Calculate is a calc() expression.
    if (w === "auto") set("width", n.type === "text" && !parent ? "max-content" : "auto");
    if (h === "auto") set("height", "auto");
    if (w === "calc") set("width", calcCss(n.wCalc));
    if (h === "calc") set("height", calcCss(n.hCalc));
    const insetSet = (i) =>
      absoluteInFlow && Array.isArray(n.inset) && n.inset[i] !== null && n.inset[i] !== undefined;
    if (w === "fill") {
      set(
        "width",
        absoluteInFlow
          ? insetSet(1) && insetSet(3)
            ? "auto"
            : "100%"
          : parent.layout === "inline"
            ? "100%"
            : "auto",
      );
      set("min-width", "0");
      if (flow && row) {
        set("flex-grow", "1");
        set("flex-basis", "0");
      } else if (flow && flex) set("align-self", "stretch");
      else if (flow && parent.layout === "block" && BLOCK_ALIGN[parent.justifyItems])
        set("justify-self", "stretch"); // Fill ignores the Block alignment
    }
    if (h === "fill") {
      set(
        "height",
        absoluteInFlow ? (insetSet(0) && insetSet(2) ? "auto" : "100%") : flex ? "auto" : "100%",
      );
      set("min-height", "0");
      if (flow && flex && !row) {
        set("flex-grow", "1");
        set("flex-basis", "0");
      } else if (flow && flex) set("align-self", "stretch");
    }

    // Placement inside a flow parent.
    if (absoluteInFlow) {
      const inset = Array.isArray(n.inset) ? n.inset : [];
      const has = (i) => inset[i] !== null && inset[i] !== undefined;
      if (SIDES.some((_, i) => has(i)))
        SIDES.forEach((k, i) => {
          if (has(i)) set(k, len(inset[i]));
        });
      else {
        // No offsets: x/y are relative to the parent's border box; CSS offsets start inside the border.
        const b = bordersOf(parent);
        set("left", px(num(n.x) - b[3]));
        set("top", px(num(n.y) - b[0]));
      }
      if (Array.isArray(n.translate))
        set("translate", len(n.translate[0]) + " " + len(n.translate[1]));
    } else if (flow) {
      set("flex-shrink", String(n.shrink ?? (w === "hug" || w === "auto" ? 1 : 0)));
      if (n.grow !== undefined) set("flex-grow", String(num(n.grow)));
      if (n.basis !== undefined) set("flex-basis", len(n.basis));
      if (n.alignSelf && n.alignSelf !== "auto")
        set("align-self", pick(n.alignSelf, ALIGN, "auto"));
      const margin =
        Array.isArray(n.margin) && n.margin.length === 4
          ? n.margin.map((v) => (v === "auto" ? "auto" : len(v)))
          : ["0px", "0px", "0px", "0px"];
      // space-y on a block parent: every in-flow child but the last gets the gap as its bottom margin
      // unless it declares its own (Tailwind v4: the child's margin class wins over space-y).
      if (parent.layout === "block" && num(parent.gapY) && !ctx.lastInFlow && margin[2] === "0px")
        margin[2] = px(parent.gapY);
      if (margin.some((v) => v !== "0px")) set("margin", margin.join(" "));
      if (n.colSpan !== undefined && parent.layout === "grid")
        set(
          "grid-column",
          n.colSpan === "full"
            ? "1 / -1"
            : `span ${Math.max(1, Math.floor(num(n.colSpan, 1)))} / span ${Math.max(1, Math.floor(num(n.colSpan, 1)))}`,
        );
      if (n.rowSpan !== undefined && parent.layout === "grid")
        set(
          "grid-row",
          `span ${Math.max(1, Math.floor(num(n.rowSpan, 1)))} / span ${Math.max(1, Math.floor(num(n.rowSpan, 1)))}`,
        );
    }
    if (parent) {
      if (n.wPct !== undefined && w === "fixed") set("width", num(n.wPct) + "%");
      if (n.hPct !== undefined && h === "fixed") set("height", num(n.hPct) + "%");
    }
    for (const [k, prop] of [
      ["minW", "min-width"],
      ["maxW", "max-width"],
      ["minH", "min-height"],
      ["maxH", "max-height"],
    ])
      if (n[k] !== undefined && n[k] !== null) set(prop, len(n[k]));
    if (num(n.aspectRatio) > 0 && h !== "fixed") {
      set("aspect-ratio", String(num(n.aspectRatio)));
      set("height", "auto");
    }

    // Shape and effects.
    if (Array.isArray(n.cornerRadii) && n.cornerRadii.length === 4)
      set("border-radius", n.cornerRadii.map(px).join(" "));
    // Ellipse: any box type can be drawn as an ellipse inscribed in its bounds; it overrides corner radii.
    if (n.ellipse === true && n.type !== "text") set("border-radius", "50%");
    if (vector) set("border-radius", "0px"); // the path is the shape; the box has no corners
    if (
      n.strokeHidden !== true &&
      !vector &&
      Array.isArray(n.strokeWidths) &&
      n.strokeWidths.length === 4
    )
      set(
        "border-width",
        bordersOf(n)
          .map((v) => px(Math.max(0, v)))
          .join(" "),
      );
    if (["dashed", "dotted", "double"].includes(n.strokeStyle)) set("border-style", n.strokeStyle);
    if (num(n.ringWidth) > 0) {
      const ring =
        (n.ringInset ? "inset " : "") +
        `0 0 0 ${num(n.ringWidth)}px ${safe(n.ringColor, "#000000")}`;
      set("box-shadow", safe(n.shadow) ? ring + ", " + safe(n.shadow) : ring);
    }
    // Structured effects (inspector Shadow / Outline / Filters / Mask / blend).
    const fx = effectsOf(n, ctx.tokens);
    if (fx.boxShadow.length) {
      const ring =
        num(n.ringWidth) > 0
          ? (n.ringInset ? "inset " : "") +
            `0 0 0 ${num(n.ringWidth)}px ${safe(n.ringColor, "#000000")}`
          : "";
      set("box-shadow", [ring, ...fx.boxShadow, safe(n.shadow)].filter(Boolean).join(", "));
    }
    if (fx.outline) {
      set("outline", `${fx.outline.width}px ${fx.outline.style} ${fx.outline.color}`);
      set("outline-offset", px(fx.outline.offset));
    }
    if (fx.filter.length || fx.drop.length) set("filter", [...fx.filter, ...fx.drop].join(" "));
    if (fx.backdrop.length) set("backdrop-filter", fx.backdrop.join(" "));
    if (fx.textShadow.length) set("text-shadow", fx.textShadow.join(", "));
    if (fx.masks.length) {
      set("mask-image", [...fx.masks, safe(n.mask)].filter(Boolean).join(", "));
      // Per-layer options only when one differs from the CSS defaults (older documents keep their CSS).
      const layers = [
        ...fx.maskLayers,
        ...(safe(n.mask)
          ? [
              {
                mode: "match-source",
                repeat: "repeat",
                position: "0% 0%",
                size: "auto",
                composite: "add",
              },
            ]
          : []),
      ];
      const list = (key) => layers.map((l) => l[key]).join(", ");
      if (layers.some((l) => l.mode !== "match-source")) set("mask-mode", list("mode"));
      if (layers.some((l) => l.repeat !== "repeat")) set("mask-repeat", list("repeat"));
      if (layers.some((l) => l.position !== "0% 0%")) set("mask-position", list("position"));
      if (layers.some((l) => l.size !== "auto")) set("mask-size", list("size"));
      if (layers.some((l) => l.composite !== "add")) set("mask-composite", list("composite"));
    }
    if (fx.border) set("border-color", fx.border);
    if (fx.blend) set("mix-blend-mode", fx.blend);

    // Text.
    if (n.type === "text") {
      if (["uppercase", "lowercase", "capitalize"].includes(n.textTransform))
        set("text-transform", n.textTransform);
      if (
        /^(none|underline|overline|line-through)( (underline|overline|line-through))*$/.test(
          String(n.textDecoration || ""),
        )
      )
        set("text-decoration-line", n.textDecoration);
      if (["italic", "normal"].includes(n.fontStyle)) set("font-style", n.fontStyle);
      // Type settings (inspector): each field is absent by default, which keeps the base text CSS above.
      // white-space before text-wrap: the white-space shorthand resets text-wrap-mode.
      if (WHITE_SPACES.includes(n.whiteSpace)) set("white-space", n.whiteSpace);
      if (n.wordBreak === "normal") set("overflow-wrap", "normal");
      else if (n.wordBreak === "break-all") set("word-break", "break-all");
      if (num(n.textIndent)) set("text-indent", px(n.textIndent));
      if (n.fontSmoothing === "antialiased") {
        set("-webkit-font-smoothing", "antialiased");
        set("-moz-osx-font-smoothing", "grayscale");
      } else if (n.fontSmoothing === "subpixel-antialiased") {
        set("-webkit-font-smoothing", "auto");
        set("-moz-osx-font-smoothing", "auto");
      }
      // Vertical alignment inside a fixed-height box: align-content on the block container keeps runs inline.
      if (n.textAlignVertical === "center") set("align-content", "center");
      else if (n.textAlignVertical === "bottom") set("align-content", "flex-end");
      if (["wrap", "nowrap", "balance", "pretty", "stable"].includes(n.textWrap))
        set("text-wrap", n.textWrap);
      if (n.truncate) {
        set("white-space", "nowrap");
        set("overflow", "hidden");
        set("text-overflow", "ellipsis");
      } else if (n.noWrap && !WHITE_SPACES.includes(n.whiteSpace)) set("white-space", "pre");
      if (num(n.lineClamp) > 0) {
        set("display", "-webkit-box");
        set("-webkit-line-clamp", String(Math.floor(num(n.lineClamp))));
        set("-webkit-box-orient", "vertical");
        set("overflow", "hidden");
      }
    }
    if (n.hidden) set("display", "none");

    const img =
      n.type === "image"
        ? [
            ["width", "100%"],
            ["height", "100%"],
            [
              "object-fit",
              pick(n.objectFit, ["contain", "cover", "fill", "none", "scale-down"], "contain"),
            ],
            ["display", "block"],
          ]
        : null;
    // Optional monochrome SVG paint: retain the source and recolor its alpha silhouette.
    const svgTint =
      n.type === "image" &&
      /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(ctx.svgColor || n.svgColor || "") &&
      /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=\s]+$/.test(n.src || "");
    if (svgTint)
      img.push(
        ["background-color", ctx.svgColor || n.svgColor],
        ["mask-image", `url("${n.src.replace(/\s/g, "")}")`],
        ["mask-mode", "alpha"],
        [
          "mask-size",
          n.objectFit === "cover"
            ? "cover"
            : n.objectFit === "none"
              ? "auto"
              : n.objectFit === "fill"
                ? "100% 100%"
                : "contain",
        ],
        ["mask-position", "center"],
        ["mask-repeat", "no-repeat"],
      );
    const box = [...decl];
    // plus-darker is not implemented by every engine: declare the closest standard mode first, so an
    // engine that rejects the second declaration keeps the fallback (inline style and setProperty alike).
    if (fx.blend === "plus-darker")
      box.splice(
        box.findIndex(([k]) => k === "mix-blend-mode"),
        0,
        ["mix-blend-mode", "color-burn"],
      );
    // Per-colour SVG replacement (multicolour artwork): render a recoloured copy of the source.
    const src =
      n.type === "image" && n.svgPaints && SVG_SOURCE.test(n.src || "")
        ? recolorSvg(n.src, n.svgPaints)
        : null;
    if (src && svgTint)
      img.splice(
        img.findIndex(([k]) => k === "mask-image"),
        1,
        ["mask-image", `url("${src}")`],
      );
    return { box, img, svgTint, src: src !== n.src ? src : null };
  }

  function bordersOf(n) {
    if (n?.strokeHidden === true) return [0, 0, 0, 0];
    if (Array.isArray(n?.strokeWidths) && n.strokeWidths.length === 4) {
      const hidden =
        Array.isArray(n.strokeHiddenSides) && n.strokeHiddenSides.length === 4
          ? n.strokeHiddenSides
          : [];
      return n.strokeWidths.map((v, i) => (hidden[i] === true ? 0 : num(v)));
    }
    const w = num(n?.strokeWidth);
    return [w, w, w, w];
  }
  /** Serialize declarations as a style attribute value (caller escapes for HTML). */
  const styleText = (decls) => (decls || []).map(([k, v]) => `${k}:${v}`).join(";");
  /** Apply declarations to a DOM element (browser). */
  function applyStyle(el, decls) {
    for (const [k, v] of decls || []) el.style.setProperty(k, v);
  }
  // Typography fields beyond the base text properties (inspector Type settings). Every one is optional and
  // absent by default, so older documents keep their rendering. Checked by validateDocument in
  // web/document-core.js.
  const TEXT_ALIGN_VERTICAL = ["top", "center", "bottom"];
  const WHITE_SPACES = ["normal", "nowrap", "pre", "pre-wrap", "pre-line", "break-spaces"];
  const WORD_BREAKS = ["normal", "break-all"];
  const FONT_SMOOTHINGS = ["antialiased", "subpixel-antialiased"];
  function typographyError(n) {
    if (!n || typeof n !== "object") return "";
    if (n.lineHeight !== undefined && n.lineHeight !== "auto" && !Number.isFinite(n.lineHeight))
      return "Invalid line height";
    if (n.textAlignVertical !== undefined && !TEXT_ALIGN_VERTICAL.includes(n.textAlignVertical))
      return "Invalid vertical text alignment";
    if (n.whiteSpace !== undefined && !WHITE_SPACES.includes(n.whiteSpace))
      return "Invalid white space";
    if (n.wordBreak !== undefined && !WORD_BREAKS.includes(n.wordBreak))
      return "Invalid word break";
    if (
      n.textIndent !== undefined &&
      (!Number.isFinite(n.textIndent) || Math.abs(n.textIndent) > 10000)
    )
      return "Invalid text indent";
    if (n.fontSmoothing !== undefined && !FONT_SMOOTHINGS.includes(n.fontSmoothing))
      return "Invalid font smoothing";
    return "";
  }
  /** Text runs -> [{text, style: [[prop, value]]}] segments (bold/italic/color/size). */
  function textSegments(n) {
    const text = String(n.text || ""),
      runs = Array.isArray(n.textRuns) ? n.textRuns : [];
    const points = [...new Set([0, text.length, ...runs.flatMap((r) => [r.start, r.end])])]
      .filter((p) => p >= 0 && p <= text.length)
      .sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1],
        style = [];
      for (const r of runs.filter((r) => r.start <= a && r.end >= b)) {
        if (r.bold) style.push(["font-weight", "700"]);
        if (r.italic) style.push(["font-style", "italic"]);
        if (safe(r.color)) style.push(["color", safe(r.color)]);
        if (isNum(r.fontSize)) style.push(["font-size", r.fontSize + "px"]);
      }
      out.push({ text: text.slice(a, b), style });
    }
    return out;
  }
  /** Index of the last in-flow (not hidden, not absolute) child in a list of siblings. */
  const lastInFlowId = (children) =>
    children.filter((c) => !c.hidden && c.position !== "absolute").at(-1)?.id;

  root.BetterNodeStyle = {
    nodeStyle,
    styleText,
    applyStyle,
    textSegments,
    sizingAllowed,
    sizingMode,
    inFlow,
    lastInFlowId,
    anchored,
    constraintsOf,
    anchorPatch,
    anchoredBox,
    safeCss: safe,
    PALETTES,
    paintError,
    eachPaintColor,
    paintColor,
    fillsCss,
    svgPaintList,
    svgColorKey,
    recolorSvg,
    PAINT_TYPES,
    IMAGE_FITS,
    BLEND_MODES,
    FILTERS,
    SHADOW_TYPES,
    MASK_TYPES,
    MASK_MODES,
    MASK_REPEATS,
    MASK_COMPOSITES,
    OUTLINE_STYLES,
    effectsOf,
    validateEffects,
    typographyError,
    TEXT_ALIGN_VERTICAL,
    WHITE_SPACES,
    WORD_BREAKS,
    FONT_SMOOTHINGS,
  };
  // Sizing modes (Relative / Auto / Calculate) and Block alignment.
  Object.assign(root.BetterNodeStyle, {
    parseCalc,
    calcValue,
    calcCss,
    sizingError,
    SIZING_MODES,
    BLOCK_ALIGN,
    trackWeight,
    gridTracks,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
