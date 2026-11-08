// Headless layout for Verynize documents: a small CSS-like engine (block flow, flex row and
// column with wrap/grow/shrink, grid with equal or fr-weighted tracks, absolute children, free frames) that turns the
// node tree into x/y/w/h. Text is measured with a font-aware character-width estimate, so every
// node it touches is marked `measured: false` until a real renderer measures it.
//
// What is authoritative:
//   - Sizing: wMode/hMode. 'fixed' w/h (or wPct/hPct) and 'calc' (wCalc/hCalc) are inputs; 'hug'/'fill'/'auto' w/h are outputs.
//   - Position: x/y are inputs only for artboards (no parent), children of `layout: 'free'`
//     frames, and nothing else. Flow children (any other layout) get x/y computed here, relative
//     to the parent's border box; absolute children (position: 'absolute') are placed from
//     `inset`/`translate`. The canvas renderer lays flow children out with real CSS and ignores
//     their stored x/y.

import { parseCalc, BLOCK_ALIGN, trackWeight } from "./node-style.mjs";

const SIDES4 = [0, 0, 0, 0];
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function paddingOf(n) {
  if (n.type !== "frame" || n.layout === "free") return SIDES4;
  const p = num(n.padding);
  return [n.paddingTop ?? p, n.paddingRight ?? p, n.paddingBottom ?? p, n.paddingLeft ?? p].map(
    num,
  );
}
export function bordersOf(n) {
  if (n.strokeHidden === true) return [0, 0, 0, 0];
  if (Array.isArray(n.strokeWidths) && n.strokeWidths.length === 4)
    return n.strokeWidths.map((v, i) =>
      Array.isArray(n.strokeHiddenSides) && n.strokeHiddenSides[i] === true ? 0 : num(v),
    );
  const w = num(n.strokeWidth);
  return [w, w, w, w];
}
export const gapXOf = (n) => num(n.gapX ?? n.gap);
export const gapYOf = (n) => num(n.gapY ?? n.gap);
const marginOf = (n) =>
  Array.isArray(n.margin) && n.margin.length === 4 ? n.margin : ["0", 0, 0, 0].map(() => 0);
const numericMargin = (v) => (v === "auto" ? 0 : num(v));
const isAbsolute = (n) => n.position === "absolute";
const wMode = (n) => n.wMode || "fixed";
const hMode = (n) => n.hMode || "fixed";
// Calculate sizing: px + pct% of `base`; a % term without a definite base resolves to undefined (CSS: auto).
const calcSize = (n, axis, base) => {
  const c = parseCalc(n[axis + "Calc"]);
  return !c
    ? undefined
    : c.pct && base === undefined
      ? undefined
      : c.px + (c.pct / 100) * (base || 0);
};
// Fixed and Calculate sizes are inputs; the other modes are layout outputs.
const definite = (mode) => mode === "fixed" || mode === "calc";
const pctOf = (value, base) => {
  if (typeof value === "string" && value.endsWith("%"))
    return base === undefined ? undefined : (base * Number(value.slice(0, -1))) / 100;
  return value === undefined || value === null ? undefined : num(value);
};

// ---------------------------------------------------------------------------------------------
// Text estimate

const NARROW = new Set("il.,:;!|'`ıI ".split("")),
  SEMI = new Set('fjrt()[]{}-"/\\'.split("")),
  WIDE = new Set("mwMW@%".split(""));
function familyFactor(family = "") {
  const f = String(family).toLowerCase();
  if (/mono|courier|menlo|consolas/.test(f)) return { mono: true, k: 1 };
  if (/georgia|serif|times|playfair|garamond|merriweather|lora/.test(f) && !/sans/.test(f))
    return { k: 0.97 };
  if (/condensed|narrow|oswald|bebas/.test(f)) return { k: 0.82 };
  if (/inter|geist|helvetica|arial|system-ui|sans|roboto/.test(f)) return { k: 1 };
  return { k: 1.02 };
}
function charEm(c) {
  if (NARROW.has(c)) return c === " " ? 0.27 : 0.26;
  if (SEMI.has(c)) return 0.36;
  if (WIDE.has(c)) return 0.86;
  if (/[A-Z]/.test(c)) return 0.67;
  if (/[0-9]/.test(c)) return 0.57;
  if (/[a-z]/.test(c)) return 0.52;
  if (/[　-鿿가-힯]/.test(c)) return 1;
  if (/\p{Extended_Pictographic}/u.test(c)) return 1.2;
  return 0.56;
}
function transformText(n, text) {
  if (n.textTransform === "uppercase") return text.toUpperCase();
  if (n.textTransform === "lowercase") return text.toLowerCase();
  if (n.textTransform === "capitalize") return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return text;
}
function widthFn(n) {
  const size = num(n.fontSize) || 16,
    { mono, k } = familyFactor(n.fontFamily);
  const weight = Number(n.fontWeight) || 400,
    bold = 1 + Math.max(-0.06, Math.min(0.12, ((weight - 400) / 100) * 0.025));
  const spacing = num(n.letterSpacing);
  return (text) => {
    let w = 0;
    for (const c of text) w += (mono ? 0.6 : charEm(c) * k * bold) * size + spacing;
    return w;
  };
}

/** Natural (max-content) and min-content widths of a text node. */
export function textIntrinsic(n) {
  const width = widthFn(n),
    text = transformText(n, String(n.text || ""));
  const lines = text.split("\n");
  const max = Math.max(1, ...lines.map(width));
  const min =
    n.noWrap || n.truncate || n.whiteSpace === "nowrap" || n.whiteSpace === "pre"
      ? max
      : Math.max(1, ...lines.flatMap((line) => line.split(/\s+/)).map(width));
  return {
    max: Math.ceil(max + 1),
    min: Math.ceil(n.truncate ? Math.min(min, num(n.fontSize) * 2) : min),
  };
}

/** Estimate a text node's box at a given width (or its natural width). */
export function measureText(n, width) {
  const measure = widthFn(n),
    text = transformText(n, String(n.text || ""));
  const { max } = textIntrinsic(n);
  const w = width ?? Math.min(max, 1200);
  const space = measure(" ");
  let rows = 0;
  for (const line of text.split("\n")) {
    if (n.noWrap || n.truncate || n.whiteSpace === "nowrap" || n.whiteSpace === "pre") {
      rows++;
      continue;
    }
    let cur = 0,
      lineRows = 1;
    for (const word of line.split(/\s+/).filter(Boolean)) {
      const ww = measure(word);
      if (cur > 0 && cur + space + ww > w + 0.5) {
        lineRows++;
        cur = 0;
      }
      if (cur === 0 && ww > w + 0.5) {
        const extra = Math.ceil(ww / Math.max(1, w)) - 1;
        lineRows += extra;
        cur = ww - extra * w;
        continue;
      }
      cur += (cur > 0 ? space : 0) + ww;
    }
    rows += lineRows;
  }
  if (num(n.lineClamp) > 0) rows = Math.min(rows, num(n.lineClamp));
  // lineHeight 'auto' is CSS `normal`, about 1.2 for most text faces.
  const lineHeight =
    (num(n.fontSize) || 16) * (n.lineHeight === "auto" ? 1.2 : num(n.lineHeight) || 1.15);
  return {
    w: Math.max(1, Math.ceil(w)),
    h: Math.max(1, Math.ceil(Math.max(1, rows) * lineHeight)),
  };
}

// ---------------------------------------------------------------------------------------------
// Layout

export function layoutPage(page, rootIds = null) {
  const kids = new Map();
  for (const n of page.nodes) {
    const key = n.parentId || null;
    if (!kids.has(key)) kids.set(key, []);
    kids.get(key).push(n);
  }
  const childrenOf = (id) => (kids.get(id) || []).filter((c) => !c.hidden);
  const roots = (kids.get(null) || []).filter((r) => !rootIds || rootIds.has(r.id));
  const touched = new Set();

  const clampW = (n, w, base) => {
    const min = pctOf(n.minW, base),
      max = pctOf(n.maxW, base);
    if (max !== undefined) w = Math.min(w, max);
    if (min !== undefined) w = Math.max(w, min);
    return Math.max(1, w);
  };
  const clampH = (n, h, base) => {
    const min = pctOf(n.minH, base),
      max = pctOf(n.maxH, base);
    if (max !== undefined) h = Math.min(h, max);
    if (min !== undefined) h = Math.max(h, min);
    return Math.max(1, h);
  };
  const flowKids = (n) => childrenOf(n.id).filter((c) => !isAbsolute(c));
  const hMarg = (c) => numericMargin(marginOf(c)[1]) + numericMargin(marginOf(c)[3]);
  const vMarg = (c) => numericMargin(marginOf(c)[0]) + numericMargin(marginOf(c)[2]);
  const chrome = (n) => {
    const p = paddingOf(n),
      b = bordersOf(n);
    return {
      x: p[3] + p[1] + b[3] + b[1],
      y: p[0] + p[2] + b[0] + b[2],
      left: p[3] + b[3],
      top: p[0] + b[0],
    };
  };

  // Intrinsic widths (max-content / min-content), memoized per pass.
  const memo = new Map();
  const intrinsic = (n) => {
    if (memo.has(n)) return memo.get(n);
    let result;
    if (wMode(n) === "fixed" && n.wPct === undefined) result = { max: num(n.w), min: num(n.w) };
    else if (wMode(n) === "calc") {
      const v = Math.max(0, calcSize(n, "w", 0) ?? num(n.w));
      result = { max: v, min: v };
    } else if (n.type === "text") result = textIntrinsic(n);
    else if (n.type !== "frame") result = { max: num(n.w), min: num(n.w) };
    else {
      const list = flowKids(n),
        c = chrome(n);
      const parts = list.map((k) => {
        const i = intrinsic(k);
        return { max: i.max + hMarg(k), min: i.min + hMarg(k) };
      });
      let max = 0,
        min = 0;
      if (!parts.length) {
        max = 0;
        min = 0;
      } else if (n.layout === "flex" && n.direction !== "column") {
        max = parts.reduce((s, p) => s + p.max, 0) + gapXOf(n) * (parts.length - 1);
        min = n.flexWrap
          ? Math.max(...parts.map((p) => p.min))
          : parts.reduce((s, p) => s + p.min, 0) + gapXOf(n) * (parts.length - 1);
      } else if (n.layout === "grid") {
        // Fill tracks share by fr weight: the narrowest track must still hold the widest item.
        const cols = Math.max(1, num(n.columns) || 1),
          w = Array.from({ length: cols }, (_, i) => trackWeight(n.columnSizes, i));
        const scale = w.reduce((a, b) => a + b, 0) / Math.min(...w);
        max = Math.max(...parts.map((p) => p.max)) * scale + gapXOf(n) * (cols - 1);
        min = Math.max(...parts.map((p) => p.min)) * scale + gapXOf(n) * (cols - 1);
      } else if (n.layout === "free") {
        max = Math.max(...list.map((k) => num(k.x) + num(k.w)));
        min = max;
      } else {
        max = Math.max(...parts.map((p) => p.max));
        min = Math.max(...parts.map((p) => p.min));
      }
      result = { max: clampW(n, max + c.x), min: clampW(n, min + c.x) };
    }
    memo.set(n, result);
    return result;
  };

  // Width a child takes in a non-flex-row context with `avail` space (after margins).
  const childWidth = (k, avail, stretch) => {
    const mode = wMode(k);
    let w;
    if (mode === "fixed") w = k.wPct !== undefined ? (avail * num(k.wPct)) / 100 : num(k.w);
    else if (mode === "calc") w = calcSize(k, "w", avail) ?? num(k.w);
    else if (
      mode === "fill" ||
      (stretch && mode !== "hug" && (k.type !== "text" || mode === "auto"))
    )
      w = avail;
    else {
      const i = intrinsic(k);
      w = Math.max(Math.min(i.max, avail), Math.min(i.min, avail));
    }
    if (mode === "fill" && stretch === false) w = avail;
    return clampW(k, w, avail);
  };

  // Lay out `n` at border-box width `w`; `forcedH` fixes the height (stretch / grow / fill).
  const layoutBox = (n, w, forcedH, parentInnerH) => {
    touched.add(n);
    n.w = Math.max(1, w);
    let h;
    const fixedH =
      hMode(n) === "fixed"
        ? n.hPct !== undefined
          ? parentInnerH !== undefined
            ? (parentInnerH * num(n.hPct)) / 100
            : num(n.h)
          : num(n.h)
        : hMode(n) === "calc"
          ? calcSize(n, "h", parentInnerH)
          : undefined;
    const ratioH = n.aspectRatio && !definite(hMode(n)) ? n.w / num(n.aspectRatio) : undefined;
    const definiteH = forcedH ?? fixedH ?? ratioH;
    if (n.type === "frame") {
      const contentH = layoutChildren(n, definiteH);
      h = definiteH ?? contentH;
    } else if (n.type === "text") h = definiteH ?? measureText(n, n.w).h;
    else h = definiteH ?? num(n.h);
    n.h = Math.max(1, Math.round(clampH(n, h, parentInnerH) * 100) / 100);
    if (n.type === "frame") placeAbsolute(n);
  };

  const layoutChildren = (n, definiteH) => {
    const c = chrome(n),
      cw = Math.max(0, n.w - c.x),
      innerH = definiteH !== undefined ? Math.max(0, definiteH - c.y) : undefined;
    const list = flowKids(n);
    if (n.layout === "free") {
      for (const k of childrenOf(n.id)) {
        const w =
          wMode(k) === "hug" || wMode(k) === "auto"
            ? intrinsic(k).max
            : wMode(k) === "calc"
              ? (calcSize(k, "w", n.w) ?? num(k.w))
              : k.wPct !== undefined
                ? (n.w * num(k.wPct)) / 100
                : num(k.w);
        layoutBox(k, w, undefined, n.h);
      }
      return Math.max(1, ...childrenOf(n.id).map((k) => num(k.y) + k.h));
    }
    if (!list.length) return c.y;
    if (n.layout === "grid") return grid(n, list, c, cw, innerH);
    const row = n.layout === "flex" && n.direction !== "column";
    const contentH = row
      ? flexRow(n, list, c, cw, innerH)
      : column(n, list, c, cw, innerH, n.layout === "flex");
    // row-reverse / column-reverse mirror the forward layout along the main axis inside the content box.
    if (n.layout === "flex" && n.reverse === true) {
      const mainH = innerH ?? contentH - c.y;
      for (const k of list) {
        if (row) k.x = round(2 * c.left + cw - k.x - k.w);
        else k.y = round(2 * c.top + mainH - k.y - k.h);
      }
    }
    return contentH;
  };

  const crossAlign = (n, k) =>
    k.alignSelf && k.alignSelf !== "auto"
      ? k.alignSelf
      : n.layout === "flex" || n.layout === "grid"
        ? n.alignItems || "stretch"
        : "stretch";

  // Block flow and flex column share this: children stacked vertically.
  const column = (n, list, c, cw, innerH, flex) => {
    const gap = flex ? gapYOf(n) : num(n.gapY); // block flow only spaces children via space-y (gapY)
    // Block alignment (justify-items on a block frame) places children narrower than the frame.
    const blockAlign = flex
      ? undefined
      : { start: "flex-start", center: "center", end: "flex-end" }[BLOCK_ALIGN[n.justifyItems]];
    for (const k of list) {
      const align = flex ? crossAlign(n, k) : blockAlign || "stretch";
      const avail = Math.max(0, cw - hMarg(k));
      const stretch = align === "stretch" && wMode(k) !== "hug" && !definite(wMode(k));
      const w =
        stretch || wMode(k) === "fill" ? clampW(k, avail, avail) : childWidth(k, avail, false);
      layoutBox(
        k,
        w,
        hMode(k) === "fill" && innerH !== undefined && !flex
          ? Math.max(1, innerH - vMarg(k))
          : undefined,
        innerH,
      );
    }
    // Grow (flex column with a definite height).
    let used = list.reduce((s, k) => s + k.h + vMarg(k), 0) + gap * (list.length - 1);
    if (flex && innerH !== undefined) {
      const growers = list.filter((k) => num(k.grow) > 0 || hMode(k) === "fill");
      const free = innerH - used;
      if (free > 0 && growers.length) {
        const total = growers.reduce((s, k) => s + (num(k.grow) || 1), 0);
        for (const k of growers)
          layoutBox(k, k.w, k.h + (free * (num(k.grow) || 1)) / total, innerH);
        used = innerH;
      }
    }
    let y = c.top,
      between = gap;
    if (flex && innerH !== undefined && innerH > used) {
      const free = innerH - used,
        j = n.justifyContent;
      if (j === "center") y += free / 2;
      else if (j === "flex-end") y += free;
      else if (j === "space-between" && list.length > 1) between += free / (list.length - 1);
      else if (j === "space-around") {
        between += free / list.length;
        y += free / list.length / 2;
      } else if (j === "space-evenly") {
        between += free / (list.length + 1);
        y += free / (list.length + 1);
      }
    }
    // Block flow: adjacent vertical margins collapse (CSS 2.1 §8.3.1); space-y gives every in-flow
    // child but the last a bottom margin unless it declares one. The frame is a flow-root, so the
    // first/last child margins stay inside it.
    const collapse = (a, b) =>
      a >= 0 && b >= 0 ? Math.max(a, b) : a < 0 && b < 0 ? Math.min(a, b) : a + b;
    let prevBottom = null;
    for (const [i, k] of list.entries()) {
      const m = marginOf(k),
        align = flex ? crossAlign(n, k) : blockAlign || "stretch";
      const space = cw - k.w - hMarg(k);
      if (!flex) {
        const top = numericMargin(m[0]);
        let bottom = numericMargin(m[2]);
        if (gap && i < list.length - 1 && !bottom) bottom = gap;
        y += prevBottom === null ? top : collapse(prevBottom, top);
        let bx = c.left + numericMargin(m[3]);
        if (m[1] === "auto" && m[3] === "auto") bx = c.left + (cw - k.w) / 2;
        else if (m[3] === "auto") bx = c.left + cw - k.w - numericMargin(m[1]);
        else if (m[1] !== "auto" && space > 0)
          bx += align === "center" ? space / 2 : align === "flex-end" ? space : 0;
        k.x = round(bx);
        k.y = round(y);
        y += k.h;
        prevBottom = bottom;
        if (i === list.length - 1) y += bottom;
        continue;
      }
      let x = c.left + numericMargin(m[3]);
      if (m[1] === "auto" && m[3] === "auto") x = c.left + (cw - k.w) / 2;
      else if (m[3] === "auto") x = c.left + cw - k.w - numericMargin(m[1]);
      else if (align === "center") x += space / 2;
      else if (align === "flex-end") x += space;
      y += numericMargin(m[0]);
      k.x = round(x);
      k.y = round(y);
      y += k.h + numericMargin(m[2]) + between;
    }
    if (!flex) return y - c.top + c.y;
    return y - between - c.top + c.y;
  };

  const flexRow = (n, list, c, cw, innerH) => {
    const gapX = gapXOf(n),
      gapY = gapYOf(n);
    const items = list.map((k) => {
      const mode = wMode(k);
      let basis =
        k.basis !== undefined
          ? pctOf(k.basis, cw)
          : mode === "fixed"
            ? k.wPct !== undefined
              ? (cw * num(k.wPct)) / 100
              : num(k.w)
            : mode === "calc"
              ? (calcSize(k, "w", cw) ?? num(k.w))
              : mode === "fill"
                ? 0
                : intrinsic(k).max;
      const grow = k.grow !== undefined ? num(k.grow) : mode === "fill" ? 1 : 0;
      const shrink =
        k.shrink !== undefined ? num(k.shrink) : mode === "hug" || mode === "auto" ? 1 : 0;
      const min =
        k.minW !== undefined
          ? pctOf(k.minW, cw)
          : mode === "hug" || mode === "fill" || mode === "auto"
            ? intrinsic(k).min
            : 0;
      return {
        k,
        basis: Math.max(0, basis ?? 0),
        grow,
        shrink,
        min: Math.min(min ?? 0, Math.max(basis ?? 0, mode === "fill" ? Infinity : 0)),
        outer: hMarg(k),
      };
    });
    // Break into lines.
    const lines = [];
    let line = [],
      width = 0;
    for (const it of items) {
      const add = it.basis + it.outer + (line.length ? gapX : 0);
      if (n.flexWrap && line.length && width + add > cw + 0.5) {
        lines.push(line);
        line = [];
        width = 0;
      }
      width += it.basis + it.outer + (line.length ? gapX : 0);
      line.push(it);
    }
    if (line.length) lines.push(line);
    let y = c.top;
    const lineBoxes = [];
    for (const ln of lines) {
      let free = cw - ln.reduce((s, it) => s + it.basis + it.outer, 0) - gapX * (ln.length - 1);
      for (const it of ln) it.size = it.basis;
      if (free > 0) {
        const total = ln.reduce((s, it) => s + it.grow, 0);
        if (total > 0) for (const it of ln) it.size += (free * it.grow) / Math.max(1, total);
      } else if (free < 0) {
        for (let pass = 0; pass < 4 && free < -0.5; pass++) {
          const flexible = ln.filter((it) => it.shrink > 0 && it.size > it.min + 0.01);
          const weight = flexible.reduce((s, it) => s + it.shrink * Math.max(1, it.basis), 0);
          if (!weight) break;
          let reclaimed = 0;
          for (const it of flexible) {
            const cut = Math.min(
              it.size - it.min,
              (-free * it.shrink * Math.max(1, it.basis)) / weight,
            );
            it.size -= cut;
            reclaimed += cut;
          }
          free += reclaimed;
        }
      }
      for (const it of ln) layoutBox(it.k, clampW(it.k, it.size, cw), undefined, innerH);
      const single = lines.length === 1 && innerH !== undefined;
      const lineH = single ? innerH : Math.max(...ln.map((it) => it.k.h + vMarg(it.k)));
      // Stretch auto-height items to the line.
      for (const it of ln)
        if (crossAlign(n, it.k) === "stretch" && !definite(hMode(it.k)) && !it.k.aspectRatio)
          layoutBox(it.k, it.k.w, Math.max(1, lineH - vMarg(it.k)), innerH);
      // Main-axis placement.
      const used = ln.reduce((s, it) => s + it.k.w + it.outer, 0) + gapX * (ln.length - 1);
      let x = c.left,
        between = gapX;
      const rest = cw - used;
      const autos = ln.filter((it) => marginOf(it.k)[1] === "auto" || marginOf(it.k)[3] === "auto");
      if (rest > 0 && !autos.length) {
        const j = n.justifyContent;
        if (j === "center") x += rest / 2;
        else if (j === "flex-end") x += rest;
        else if (j === "space-between" && ln.length > 1) between += rest / (ln.length - 1);
        else if (j === "space-around") {
          between += rest / ln.length;
          x += rest / ln.length / 2;
        } else if (j === "space-evenly") {
          between += rest / (ln.length + 1);
          x += rest / (ln.length + 1);
        }
      }
      const autoShare =
        rest > 0 && autos.length
          ? rest /
            autos.reduce(
              (s, it) => s + (marginOf(it.k)[1] === "auto") + (marginOf(it.k)[3] === "auto"),
              0,
            )
          : 0;
      for (const it of ln) {
        const m = marginOf(it.k);
        x += m[3] === "auto" ? autoShare : numericMargin(m[3]);
        const align = crossAlign(n, it.k),
          space = lineH - it.k.h - vMarg(it.k);
        let ky = y + numericMargin(m[0]);
        if (align === "center") ky += space / 2;
        else if (align === "flex-end") ky += space;
        it.k.x = round(x);
        it.k.y = round(ky);
        x += it.k.w + (m[1] === "auto" ? autoShare : numericMargin(m[1])) + between;
      }
      lineBoxes.push(lineH);
      y += lineH + gapY;
    }
    return y - gapY - c.top + c.y;
  };

  const grid = (n, list, c, cw, innerH) => {
    const cols = Math.max(1, num(n.columns) || 1),
      gapX = gapXOf(n),
      gapY = gapYOf(n);
    // Fill tracks (minmax(0, Nfr)) split the free width by their fr weights (columnSizes; equal by default).
    const colWeights = Array.from({ length: cols }, (_, i) => trackWeight(n.columnSizes, i)),
      colTotal = colWeights.reduce((a, b) => a + b, 0);
    const colWs = colWeights.map((w) => Math.max(1, ((cw - gapX * (cols - 1)) * w) / colTotal));
    const colX = colWs.map((_, i) => colWs.slice(0, i).reduce((a, b) => a + b + gapX, 0));
    const rows = [];
    let row = [],
      used = 0;
    for (const k of list) {
      const span = k.colSpan === "full" ? cols : Math.min(cols, Math.max(1, num(k.colSpan) || 1));
      if (used + span > cols && row.length) {
        rows.push(row);
        row = [];
        used = 0;
      }
      row.push({ k, span, col: used });
      used += span;
    }
    if (row.length) rows.push(row);
    // Explicit rows (grid-template-rows of minmax(0, Nfr)) share a definite height by weight; extra rows are auto.
    const fixedRows = Math.floor(num(n.rows)),
      rowWeights = Array.from({ length: Math.max(0, fixedRows) }, (_, i) =>
        trackWeight(n.rowSizes, i),
      ),
      rowTotal = rowWeights.reduce((a, b) => a + b, 0);
    const fixedH = (ri) =>
      fixedRows >= 1 && innerH !== undefined && ri < fixedRows
        ? Math.max(0, ((innerH - gapY * (fixedRows - 1)) * rowWeights[ri]) / rowTotal)
        : undefined;
    const offset = (align, space) =>
      space > 0
        ? align === "center"
          ? space / 2
          : align === "flex-end" || align === "end"
            ? space
            : 0
        : 0;
    let y = c.top;
    for (const [ri, r] of rows.entries()) {
      for (const cell of r) {
        const area =
          colWs.slice(cell.col, cell.col + cell.span).reduce((a, b) => a + b, 0) +
          gapX * (cell.span - 1);
        const avail = Math.max(1, area - hMarg(cell.k));
        layoutBox(
          cell.k,
          wMode(cell.k) === "fixed" || wMode(cell.k) === "hug" || wMode(cell.k) === "calc"
            ? childWidth(cell.k, avail, false)
            : avail,
          undefined,
          innerH,
        );
        cell.area = area;
      }
      const rowH = fixedH(ri) ?? Math.max(...r.map((cell) => cell.k.h + vMarg(cell.k)));
      for (const cell of r) {
        const align = crossAlign(n, cell.k);
        if (!definite(hMode(cell.k)) && align === "stretch" && !cell.k.aspectRatio)
          layoutBox(cell.k, cell.k.w, Math.max(1, rowH - vMarg(cell.k)), innerH);
        const m = marginOf(cell.k);
        cell.k.x = round(
          c.left +
            colX[cell.col] +
            numericMargin(m[3]) +
            offset(n.justifyItems, cell.area - cell.k.w - hMarg(cell.k)),
        );
        cell.k.y = round(y + numericMargin(m[0]) + offset(align, rowH - cell.k.h - vMarg(cell.k)));
      }
      y += rowH + gapY;
    }
    return y - gapY - c.top + c.y;
  };

  // Absolute children of flow frames, and children of free frames with constraints (insets). Free frames
  // measure x/y inside their border; flow frames from the border box.
  const placeAbsolute = (n) => {
    const b = bordersOf(n),
      cbW = Math.max(1, n.w - b[1] - b[3]),
      cbH = Math.max(1, n.h - b[0] - b[2]);
    const free = n.layout === "free",
      origin = free ? [0, 0, 0, 0] : b;
    const anchoredFree = (k) =>
      Array.isArray(k.inset) && k.inset.some((v) => v !== null && v !== undefined);
    for (const k of childrenOf(n.id).filter((k) => (free ? anchoredFree(k) : isAbsolute(k)))) {
      const inset = Array.isArray(k.inset) ? k.inset : [null, null, null, null];
      const [t, r, bt, l] = [
        pctOf(inset[0], cbH),
        pctOf(inset[1], cbW),
        pctOf(inset[2], cbH),
        pctOf(inset[3], cbW),
      ];
      let w;
      if (wMode(k) === "fixed") w = k.wPct !== undefined ? (cbW * num(k.wPct)) / 100 : num(k.w);
      else if (wMode(k) === "calc") w = calcSize(k, "w", cbW) ?? num(k.w);
      else if (l !== undefined && r !== undefined) w = cbW - l - r;
      else if (wMode(k) === "fill") w = cbW;
      else w = Math.min(intrinsic(k).max, cbW);
      let forced;
      if (!definite(hMode(k)) && t !== undefined && bt !== undefined)
        forced = Math.max(1, cbH - t - bt);
      else if (hMode(k) === "fill") forced = cbH;
      layoutBox(k, clampW(k, w, cbW), forced, cbH);
      const p = paddingOf(n);
      let x =
        l !== undefined
          ? origin[3] + l
          : r !== undefined
            ? origin[3] + cbW - r - k.w
            : origin[3] + p[3];
      let y =
        t !== undefined
          ? origin[0] + t
          : bt !== undefined
            ? origin[0] + cbH - bt - k.h
            : origin[0] + p[0];
      const tr = Array.isArray(k.translate) ? k.translate : [0, 0];
      x += pctOf(tr[0], k.w) ?? 0;
      y += pctOf(tr[1], k.h) ?? 0;
      k.x = round(x);
      k.y = round(y);
    }
  };

  for (const root of roots) {
    const w =
      wMode(root) === "hug" || wMode(root) === "auto"
        ? Math.min(intrinsic(root).max, 4000)
        : wMode(root) === "calc"
          ? (calcSize(root, "w", 0) ?? num(root.w))
          : num(root.w);
    layoutBox(root, w, undefined, undefined);
  }
  for (const n of touched) {
    n.w = Math.max(1, round(n.w));
    n.h = Math.max(1, round(n.h));
    if (n.parentId) {
      n.x = round(num(n.x));
      n.y = round(num(n.y));
    }
    n.measured = false;
  }
  return touched;
}
const round = (v) => Math.round(v * 100) / 100;
