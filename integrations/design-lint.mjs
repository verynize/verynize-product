// Design lint for one artboard of a version 2 document: structural defects (clipping, overflow,
// overlap, placeholders, missing assets), WCAG contrast against the real backdrop, and taste
// heuristics. Pure and dependency-free so the MCP tools, the desktop bridge and tests share it.
//
// Geometry comes from `bounds` (measured DOM boxes from the renderer) when given, otherwise from
// stored node geometry: free-layout children are exact ("stored"), flow children are simulated
// ("estimated"). Estimated geometry problems are reported one severity lower than measured ones.
// Reads both legacy fields (numeric padding/gap/radius, `color`) and newer ones (per-side
// padding, gapX/gapY, per-corner radius, fill/textColor, shadow arrays, hug/fill sizing).

const SEVERITIES = ["critical", "major", "minor"];
const DOWNGRADE = { critical: "major", major: "minor", minor: "minor" };
const num = (value, fallback = 0) =>
  Number.isFinite(Number(value)) && value !== "" && value !== null ? Number(value) : fallback;
const clamp01 = (value) => Math.min(1, Math.max(0, value));

// ---------------------------------------------------------------------------------------------
// Colors

const NAMED = { white: [255, 255, 255], black: [0, 0, 0] };
/** Parse a CSS color into {r,g,b,a} (0-255, alpha 0-1); null when unknown. */
export function parseColor(value) {
  if (value && typeof value === "object" && "r" in value)
    return { r: num(value.r), g: num(value.g), b: num(value.b), a: num(value.a, 1) };
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "transparent" || v === "none" || v === "")
    return v === "transparent" ? { r: 0, g: 0, b: 0, a: 0 } : null;
  if (NAMED[v]) return { r: NAMED[v][0], g: NAMED[v][1], b: NAMED[v][2], a: 1 };
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = Array.from(h, (c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1,
    };
  }
  m = v.match(/^(rgba?|hsla?|oklch)\(([^)]*)\)$/);
  if (!m) return null;
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const alpha =
    parts[3] === undefined
      ? 1
      : parts[3].endsWith("%")
        ? parseFloat(parts[3]) / 100
        : parseFloat(parts[3]);
  const pct = (p, scale) => (p.endsWith("%") ? (parseFloat(p) / 100) * scale : parseFloat(p));
  let rgb;
  if (m[1].startsWith("rgb")) rgb = parts.slice(0, 3).map((p) => pct(p, 255));
  else if (m[1].startsWith("hsl"))
    rgb = hslToRgb(
      parseFloat(parts[0]),
      pct(parts[1], 1) > 1 ? pct(parts[1], 1) / 100 : pct(parts[1], 1),
      pct(parts[2], 1) > 1 ? pct(parts[2], 1) / 100 : pct(parts[2], 1),
    );
  else rgb = oklchToRgb(pct(parts[0], 1), pct(parts[1], 0.4), parseFloat(parts[2]) || 0);
  if (rgb.some((c) => !Number.isFinite(c)) || !Number.isFinite(alpha)) return null;
  const [r, g, b] = rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))));
  return { r, g, b, a: clamp01(alpha) };
}
function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12,
    a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
}
function oklchToRgb(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180),
    b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map(
    (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055),
  );
}
const over = (top, under) => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1,
});
const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const luminance = (c) =>
  0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
export function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const hex = (c) =>
  "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
function saturation(c) {
  const max = Math.max(c.r, c.g, c.b) / 255,
    min = Math.min(c.r, c.g, c.b) / 255,
    l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
}
const COLOR_IN_TEXT =
  /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch)\([^)]*\)|\b(?:white|black|transparent)\b/gi;
const colorsIn = (text) =>
  (String(text).match(COLOR_IN_TEXT) || []).map(parseColor).filter(Boolean);

// ---------------------------------------------------------------------------------------------
// Field readers (legacy + new)

function sides(value) {
  if (
    Number.isFinite(Number(value)) &&
    value !== "" &&
    value !== null &&
    typeof value !== "object"
  ) {
    const v = Number(value);
    return [v, v, v, v];
  }
  if (Array.isArray(value)) {
    const [t = 0, r = t, b = t, l = r] = value.map((v) => num(v));
    return [t, r, b, l];
  }
  if (value && typeof value === "object")
    return [
      num(value.top ?? value.t ?? value.y),
      num(value.right ?? value.r ?? value.x),
      num(value.bottom ?? value.b ?? value.y),
      num(value.left ?? value.l ?? value.x),
    ];
  return [0, 0, 0, 0];
}
/** [top, right, bottom, left] padding; legacy numeric padding only applies to flow layouts. */
export function paddingOf(node) {
  const p =
    node.layout === "free" && typeof node.padding === "number" && node.paddingTop === undefined
      ? [0, 0, 0, 0]
      : sides(node.padding);
  const pick = (i, ...keys) => {
    for (const key of keys) if (node[key] !== undefined) return num(node[key]);
    return p[i];
  };
  return [
    pick(0, "paddingTop", "pt", "paddingY", "py"),
    pick(1, "paddingRight", "pr", "paddingX", "px"),
    pick(2, "paddingBottom", "pb", "paddingY", "py"),
    pick(3, "paddingLeft", "pl", "paddingX", "px"),
  ];
}
function gapOf(node) {
  const g = node.gap && typeof node.gap === "object" ? node.gap : null;
  const base = g ? 0 : num(node.gap);
  return {
    x: num(node.gapX ?? node.columnGap ?? g?.x ?? g?.column, base),
    y: num(node.gapY ?? node.rowGap ?? g?.y ?? g?.row, base),
  };
}
function radiusOf(node) {
  const values = [
    ...sides(node.radius),
    ...[
      "radiusTopLeft",
      "radiusTopRight",
      "radiusBottomRight",
      "radiusBottomLeft",
      "topLeftRadius",
      "topRightRadius",
      "bottomRightRadius",
      "bottomLeftRadius",
    ].map((k) => num(node[k])),
  ];
  if (node.radius && typeof node.radius === "object" && !Array.isArray(node.radius))
    values.push(...Object.values(node.radius).map((v) => num(v)));
  return Math.max(0, ...values);
}
function tokenValue(document, name) {
  const t = document.tokens?.[name];
  return typeof t === "string" ? t : t?.value;
}
function resolveColor(document, value, token) {
  if (token && tokenValue(document, token)) return parseColor(tokenValue(document, token));
  const v = typeof value === "string" ? value.match(/^var\((--[^),]+)/) : null;
  if (v) {
    for (const name of Object.keys(document.tokens || {}))
      if (
        "--" +
          name
            .trim()
            .replace(/[^a-zA-Z0-9_-]+/g, "-")
            .replace(/^-+|-+$/g, "") ===
        v[1].trim()
      )
        return parseColor(tokenValue(document, name));
    return null;
  }
  return parseColor(
    value && typeof value === "object" && !("r" in value) ? (value.color ?? value.value) : value,
  );
}
const isText = (node) => node.type === "text";
const textOf = (node) => String(node.text ?? "");
/** Solid fill of a box node (frame/rectangle) or null. */
function fillOf(document, node) {
  if (isText(node) || node.type === "image" || node.type === "vector") return null; // a vector paints its shape, not its box
  const raw = node.fill ?? node.background ?? node.color;
  const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  const color = resolveColor(
    document,
    value,
    node.fillToken || (node.fill === undefined ? node.token : ""),
  );
  return color ? { ...color, a: color.a * opacityOf(node) } : null;
}
function gradientColors(node) {
  const g = node.gradient;
  if (!g) return [];
  if (typeof g === "string") return colorsIn(g);
  const stops = Array.isArray(g) ? g : g.stops || g.colors || [];
  return stops.map((s) => parseColor(typeof s === "string" ? s : s?.color)).filter(Boolean);
}
const opacityOf = (node) => {
  const o = num(node.opacity, 100);
  return clamp01(o > 1 ? o / 100 : o);
};
function shadowsOf(node) {
  const raw = node.shadows ?? node.shadow;
  if (!raw) return [];
  if (Array.isArray(raw) || typeof raw === "object")
    return []
      .concat(raw)
      .filter((s) => s && typeof s === "object")
      .map((s) => ({
        x: num(s.x ?? s.offsetX),
        y: num(s.y ?? s.offsetY),
        blur: num(s.blur),
        color: parseColor(s.color) || { r: 0, g: 0, b: 0, a: 1 },
      }));
  return String(raw)
    .split(/,(?![^(]*\))/)
    .map((part) => {
      const color = colorsIn(part)[0] || { r: 0, g: 0, b: 0, a: 1 };
      const lengths = part
        .replace(COLOR_IN_TEXT, " ")
        .replace(/inset/g, " ")
        .trim()
        .split(/\s+/)
        .map(parseFloat)
        .filter(Number.isFinite);
      return { x: lengths[0] || 0, y: lengths[1] || 0, blur: lengths[2] || 0, color };
    })
    .filter((s) => s.color.a > 0 && (s.x || s.y || s.blur));
}
// Text style inheritance: explicit on the text node, else the nearest ancestor `textStyle`.
const inheritedStyle = (node, ancestors, key) =>
  node[key] ??
  [...ancestors].reverse().find((a) => a.textStyle?.[key] !== undefined)?.textStyle[key];
const fontSizeOf = (node, ancestors) => num(inheritedStyle(node, ancestors, "fontSize"), 16);
const weightOf = (node) => {
  const w = String(node.fontWeight ?? "400");
  return w === "bold" ? 700 : num(w, 400);
};
const lineHeightPx = (node, size) =>
  node.lineHeightPx
    ? num(node.lineHeightPx)
    : num(node.lineHeight, 1.15) > 4
      ? num(node.lineHeight)
      : num(node.lineHeight, 1.15) * size;
const charWidth = (node, size) =>
  size * (weightOf(node) >= 600 ? 0.58 : 0.53) + num(node.letterSpacing);
function textLines(node, size, width) {
  const cw = charWidth(node, size);
  return textOf(node)
    .split("\n")
    .reduce(
      (sum, line) => sum + Math.max(1, Math.ceil((line.length * cw) / Math.max(1, width - 1))),
      0,
    );
}
const isHidden = (node) => node.hidden === true || node.visible === false;
const isAbsolute = (node) => node.position === "absolute" || node.absolute === true;
const isFlow = (node) => node.type === "frame" && node.layout && node.layout !== "free";
const clips = (node) =>
  node.clipContent === true || node.overflow === "hidden" || node.overflow === "clip";
const isInteractive = (node) =>
  ["button", "a"].includes(node.htmlTag) || /\b(button|btn|cta|link)\b/i.test(node.name || "");

// ---------------------------------------------------------------------------------------------
// Geometry

function normBox(b) {
  if (!b) return null;
  const x = num(b.x ?? b.left),
    y = num(b.y ?? b.top),
    w = num(b.w ?? b.width),
    h = num(b.h ?? b.height);
  return {
    x,
    y,
    w,
    h,
    scrollW: b.scrollWidth ?? b.scrollW,
    scrollH: b.scrollHeight ?? b.scrollH,
    overflow: b.overflow === true,
  };
}
function boundsLookup(bounds) {
  if (!bounds) return () => null;
  const get = bounds instanceof Map ? (key) => bounds.get(key) : (key) => bounds[key];
  return (...keys) => {
    for (const key of keys) {
      const b = key && get(key);
      if (b) return normBox(b);
    }
    return null;
  };
}

/** Absolute boxes for every node under root: Map id -> {x,y,w,h,confidence}. */
function layoutBoxes(index, root, measuredOf) {
  const boxes = new Map();
  const place = (node, guess, confidence) => {
    const measured = measuredOf(node.id, refOf(index, node));
    const box = measured ? { ...measured, confidence: "measured" } : { ...guess, confidence };
    boxes.set(node.id, box);
    const kids = index.children(node.id).filter((k) => !isHidden(k));
    const flow = isFlow(node) ? kids.filter((k) => !isAbsolute(k)) : [];
    const childConfidence = box.confidence === "estimated" ? "estimated" : null;
    for (const kid of kids)
      if (!flow.includes(kid))
        place(
          kid,
          { x: box.x + num(kid.x), y: box.y + num(kid.y), w: num(kid.w), h: num(kid.h) },
          childConfidence || "stored",
        );
    if (!flow.length) return;
    const [pt, pr, pb, pl] = paddingOf(node),
      gap = gapOf(node);
    const inner = { x: box.x + pl, y: box.y + pt, w: box.w - pl - pr, h: box.h - pt - pb };
    const guesses = [];
    if (node.layout === "grid") {
      const cols = Math.max(1, Math.round(num(node.columns, 2))),
        cellW = (inner.w - gap.x * (cols - 1)) / cols;
      let y = inner.y;
      for (let i = 0; i < flow.length; i += cols) {
        const row = flow.slice(i, i + cols),
          rowH = Math.max(...row.map((k) => num(k.h)));
        row.forEach((k, c) =>
          guesses.push({ x: inner.x + c * (cellW + gap.x), y, w: num(k.w), h: num(k.h) }),
        );
        y += rowH + gap.y;
      }
    } else {
      const column =
        node.layout === "block" || (node.layout === "flex" && /column/.test(node.direction || ""));
      const [main, cross, mainSize, crossSize, mainGap] = column
        ? ["y", "x", "h", "w", node.layout === "block" ? 0 : gap.y]
        : ["x", "y", "w", "h", gap.x];
      const total = flow.reduce((s, k) => s + num(k[mainSize]), 0) + mainGap * (flow.length - 1);
      const free = inner[mainSize] - total,
        justify = node.justifyContent || "";
      let cursor =
          inner[main] + (/center/.test(justify) ? free / 2 : /end/.test(justify) ? free : 0),
        step = mainGap;
      if (/between/.test(justify) && flow.length > 1 && free > 0)
        step = mainGap + free / (flow.length - 1);
      const wrap = !column && (node.wrap === true || /wrap/.test(node.flexWrap || node.wrap || ""));
      let lineStart = cursor,
        lineCross = inner[cross],
        lineSize = 0;
      for (const k of flow) {
        const size = num(k[mainSize]),
          crossLen = num(k[crossSize]);
        if (wrap && cursor > lineStart && cursor + size > inner[main] + inner[mainSize]) {
          cursor = lineStart;
          lineCross += lineSize + gap.y;
          lineSize = 0;
        }
        const align = node.alignItems || "";
        const offset = /center/.test(align)
          ? (inner[crossSize] - crossLen) / 2
          : /end/.test(align)
            ? inner[crossSize] - crossLen
            : 0;
        guesses.push({
          [main]: cursor,
          [cross]: (wrap ? lineCross : inner[cross]) + offset,
          w: num(k.w),
          h: num(k.h),
        });
        cursor += size + step;
        lineSize = Math.max(lineSize, crossLen);
      }
    }
    flow.forEach((k, i) => place(k, guesses[i], "estimated"));
  };
  place(root, { x: num(root.x), y: num(root.y), w: num(root.w), h: num(root.h) }, "stored");
  return boxes;
}
function refOf(index, node) {
  if (!node.shortId) return node.id;
  if (!node.parentId) return node.shortId;
  const root = index.rootOf(node);
  return root.shortId ? `${root.shortId}.${node.shortId}` : node.shortId;
}
const intersect = (a, b) => ({
  w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
  h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y),
});
const contains = (a, p) => p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h;

function pageIndex(page) {
  const byId = new Map(page.nodes.map((n) => [n.id, n])),
    byShort = new Map(),
    kids = new Map();
  for (const node of page.nodes) {
    if (node.shortId && !node.parentId) byShort.set(node.shortId, node);
    const key = node.parentId || null;
    if (!kids.has(key)) kids.set(key, []);
    kids.get(key).push(node);
  }
  const children = (id) =>
    (kids.get(id) || [])
      .map((n, i) => [n, i])
      .sort((a, b) => num(a[0].zIndex) - num(b[0].zIndex) || a[1] - b[1])
      .map(([n]) => n);
  const ancestors = (node) => {
    const out = [];
    let cur = node;
    const seen = new Set();
    while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parentId);
      out.unshift(cur);
    }
    return out;
  };
  const rootOf = (node) => ancestors(node)[0] || node;
  const resolve = (ref) =>
    byId.get(ref) ||
    byShort.get(ref) ||
    page.nodes.find(
      (n) => n.shortId && ref.endsWith("." + n.shortId) && rootOf(n).shortId === ref.split(".")[0],
    ) ||
    null;
  return { byId, children, ancestors, rootOf, resolve };
}

// ---------------------------------------------------------------------------------------------
// Rules

const PLACEHOLDER_EXACT = new Set([
  "lorem",
  "title",
  "subtitle",
  "button",
  "heading",
  "text",
  "image",
  "placeholder",
  "todo",
  "click here",
  "your text here",
  "text here",
]);
const PLACEHOLDER_ANY =
  /lorem ipsum|\blorem\b|\bdolor sit\b|\bTODO\b|\bTBD\b|\bFIXME\b|\bplaceholder\b|\[(?:insert|your|add)\b[^\]]*\]/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Emoji_Component}|‍|️|\s)+$/u;

/**
 * Lint one artboard. Returns {problems, stats, summary}.
 * options.bounds: Map|object of nodeId (or short ref) -> {x,y,w,h | left,top,width,height, scrollWidth?, scrollHeight?}
 *   in one shared, unzoomed coordinate space. options.warnings: codec warnings (strings or {message,nodeId}).
 */
export function lintArtboard(document, pageId, rootId, options = {}) {
  const page =
    (document.pages || []).find((p) => p.id === pageId) ||
    (document.pages || []).find((p) => p.id === document.activePage) ||
    document.pages?.[0];
  if (!page) throw new Error(`Page ${pageId} not found`);
  const index = pageIndex(page);
  const root = index.resolve(rootId);
  if (!root) throw new Error(`Artboard ${rootId} not found on page ${page.id}`);
  const measuredOf = boundsLookup(options.bounds);
  const boxes = layoutBoxes(index, root, measuredOf);
  const nodes = [root];
  const walk = (id) => {
    for (const k of index.children(id))
      if (!isHidden(k)) {
        nodes.push(k);
        walk(k.id);
      }
  };
  walk(root.id);
  const problems = [];
  // `confidence` is passed by geometry rules only; estimated geometry drops one severity level.
  const add = (severity, rule, node, message, fix, confidence) => {
    const sev = confidence === "estimated" ? DOWNGRADE[severity] : severity;
    const ref = node ? refOf(index, node) : null;
    const id = `${rule}:${ref ?? "artboard"}`;
    if (problems.some((p) => p.id === id)) return;
    problems.push({
      id,
      severity: sev,
      rule,
      nodeId: node?.id ?? null,
      ref,
      message,
      fix,
      ...(confidence ? { confidence } : {}),
    });
  };
  const label = (node) =>
    node.type === "text"
      ? `"${textOf(node).replace(/\s+/g, " ").trim().slice(0, 32)}"`
      : node.name || node.type;
  const texts = nodes.filter((n) => isText(n) && textOf(n).trim());
  const rootBox = boxes.get(root.id),
    rootArea = Math.max(1, rootBox.w * rootBox.h);

  // Structural ------------------------------------------------------------------------------
  for (const node of nodes) {
    const box = boxes.get(node.id),
      parent = node === root ? null : index.byId.get(node.parentId),
      pbox = parent && boxes.get(parent.id);
    if (node.type === "frame" && (box.w < 2 || box.h < 2))
      add(
        "critical",
        "collapsed",
        node,
        `Frame ${label(node)} has collapsed to ${Math.round(box.w)}×${Math.round(box.h)}px.`,
        "Give it explicit size, padding or content, or delete it.",
        box.confidence,
      );
    if (pbox && box.w > 0 && box.h > 0) {
      const hugX = box.confidence === "estimated" && parent.wMode === "hug",
        hugY = box.confidence === "estimated" && parent.hMode === "hug";
      const outX = hugX ? 0 : Math.max(pbox.x - box.x, box.x + box.w - pbox.x - pbox.w),
        outY = hugY ? 0 : Math.max(pbox.y - box.y, box.y + box.h - pbox.y - pbox.h);
      if (Math.max(outX, outY) > 1) {
        const conf =
          box.confidence === "estimated" || pbox.confidence === "estimated"
            ? "estimated"
            : box.confidence;
        if (clips(parent) || parent === root)
          add(
            "critical",
            "clipped",
            node,
            `${label(node)} extends ${Math.round(Math.max(outX, outY))}px outside ${parent === root ? "the artboard" : label(parent)}, which clips it.`,
            "Resize or reposition it, let the parent hug its content, or allow wrapping.",
            conf,
          );
        else if (isFlow(parent) && !isAbsolute(node))
          add(
            "major",
            "overflow",
            node,
            `${label(node)} overflows its flow container ${label(parent)} by ${Math.round(Math.max(outX, outY))}px.`,
            "Reduce content/gap/padding, use fill/hug sizing, or wrap.",
            conf,
          );
      }
    }
    if (isText(node) && textOf(node).trim()) {
      const size = fontSizeOf(node, index.ancestors(node));
      if (
        box.confidence === "measured" &&
        (box.overflow || num(box.scrollH) > box.h + 1 || num(box.scrollW) > box.w + 1)
      )
        add(
          "critical",
          "text-overflow",
          node,
          `Text ${label(node)} overflows its box (scroll ${Math.round(num(box.scrollW, box.w))}×${Math.round(num(box.scrollH, box.h))} > ${Math.round(box.w)}×${Math.round(box.h)}).`,
          "Let the text hug its height, widen it, or shorten the copy.",
          "measured",
        );
      else if (box.confidence !== "measured" && node.hMode !== "hug") {
        const width = node.wMode === "hug" ? Infinity : box.w,
          need = textLines(node, size, width) * lineHeightPx(node, size);
        if (need > box.h + Math.max(4, lineHeightPx(node, size) * 0.5))
          add(
            "critical",
            "text-overflow",
            node,
            `Text ${label(node)} needs ~${Math.round(need)}px height but its box is ${Math.round(box.h)}px.`,
            "Set the text height to hug, widen it, or shorten the copy.",
            "estimated",
          );
      }
      const clean = textOf(node)
        .trim()
        .replace(/[.:!…]+$/, "")
        .toLowerCase();
      if (PLACEHOLDER_EXACT.has(clean) || PLACEHOLDER_ANY.test(textOf(node)))
        add(
          "critical",
          "placeholder-text",
          node,
          `Placeholder copy ${label(node)}.`,
          "Write real, specific content for this element.",
        );
    }
    if (node.type === "image" && !node.src && !node.url && !node.asset)
      add(
        "critical",
        "missing-image",
        node,
        `Image ${label(node)} has no source.`,
        "Embed a real image (data:image URL) or remove the image element.",
      );
    if (node.assetStatus === "missing" || node.missing === true || node.warning)
      add(
        "critical",
        "missing-asset",
        node,
        `${label(node)}: ${typeof node.warning === "string" ? node.warning : "asset or icon could not be resolved"}.`,
        "Use an available icon/asset name or replace the element.",
      );
  }
  for (const warning of [].concat(options.warnings || [])) {
    const message = typeof warning === "string" ? warning : warning?.message;
    if (!message) continue;
    const node = warning?.nodeId ? index.resolve(warning.nodeId) : null;
    problems.push({
      id: `codec-warning:${problems.length}`,
      severity: "critical",
      rule: "codec-warning",
      nodeId: node?.id ?? null,
      ref: node ? refOf(index, node) : null,
      message: `Unresolved codec warning: ${message}`,
      fix: "Rewrite the affected classes/elements with supported syntax and re-read the element code.",
    });
  }
  // Sibling overlap: measured flow children, and overlapping free-positioned text.
  for (const parent of nodes.filter((n) => n.type === "frame")) {
    const kids = index.children(parent.id).filter((k) => !isHidden(k));
    for (let i = 0; i < kids.length; i++)
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i],
          b = kids[j],
          ba = boxes.get(a.id),
          bb = boxes.get(b.id),
          ov = intersect(ba, bb);
        if (ov.w <= 1 || ov.h <= 1) continue;
        if (
          isFlow(parent) &&
          !isAbsolute(a) &&
          !isAbsolute(b) &&
          ba.confidence === "measured" &&
          bb.confidence === "measured"
        )
          add(
            "critical",
            "sibling-overlap",
            b,
            `${label(b)} overlaps sibling ${label(a)} by ${Math.round(ov.w)}×${Math.round(ov.h)}px in a ${parent.layout} layout.`,
            "Fix sizes/negative margins, or mark one as absolutely positioned on purpose.",
            "measured",
          );
        else if (isText(a) && isText(b) && textOf(a).trim() && textOf(b).trim())
          add(
            "major",
            "sibling-overlap",
            b,
            `Text ${label(b)} overlaps text ${label(a)}.`,
            "Move one of them or put both in a flex column with a gap.",
            ba.confidence === "estimated" || bb.confidence === "estimated"
              ? "estimated"
              : ba.confidence,
          );
      }
  }

  // Contrast --------------------------------------------------------------------------------
  const order = [];
  const dfs = (node) => {
    order.push(node);
    for (const k of index.children(node.id)) if (!isHidden(k)) dfs(k);
  };
  dfs(root);
  for (const node of texts) {
    const ancestors = index.ancestors(node),
      box = boxes.get(node.id),
      center = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const before = order
      .slice(0, order.indexOf(node))
      .filter(
        (n) =>
          !isText(n) &&
          (ancestors.includes(n) ||
            contains(boxes.get(n.id) || { x: 0, y: 0, w: 0, h: 0 }, center)),
      );
    let backdrops = [{ r: 255, g: 255, b: 255, a: 1 }],
      unknown = false;
    for (const layer of before) {
      if (
        layer.type === "image" ||
        layer.type === "shader" ||
        layer.type === "vector" ||
        (layer.animated && layer.animated !== "")
      ) {
        unknown = true;
        backdrops = [];
        continue;
      }
      const fill = fillOf(document, layer);
      if (fill && fill.a > 0) {
        if (fill.a >= 0.999) {
          backdrops = [fill];
          unknown = false;
        } else backdrops = backdrops.map((b) => over(fill, b));
      }
      const stops = gradientColors(layer).map((c) => ({ ...c, a: c.a * opacityOf(layer) }));
      if (stops.length) {
        const base = backdrops.length ? backdrops : [{ r: 255, g: 255, b: 255, a: 1 }];
        backdrops = stops.flatMap((s) => base.map((b) => over(s, b)));
        if (stops.every((s) => s.a >= 0.999)) unknown = false;
      }
    }
    const inherited = [...ancestors]
      .reverse()
      .map((a) => a.textStyle?.color ?? a.textColor ?? a.ink)
      .find(Boolean);
    const inks = [
      resolveColor(
        document,
        node.textColor ?? node.ink ?? node.color ?? inherited ?? "#000000",
        node.inkToken || node.token,
      ),
      ...(node.textRuns || []).filter((r) => r.color).map((r) => parseColor(r.color)),
    ].filter(Boolean);
    if (unknown && !backdrops.length) {
      add(
        "minor",
        "contrast-unknown",
        node,
        `Text ${label(node)} sits on an image/shader; contrast could not be computed.`,
        "Check the screenshot; add a scrim or text shadow if legibility is weak.",
      );
      continue;
    }
    if (!inks.length) continue;
    const size = fontSizeOf(node, ancestors),
      large = size >= 24 || (size >= 18.66 && weightOf(node) >= 700),
      need = large ? 3 : 4.5;
    let worst = Infinity,
      pair = null;
    for (const ink of inks)
      for (const back of backdrops) {
        const r = contrastRatio(over({ ...ink, a: ink.a * opacityOf(node) }, back), back);
        if (r < worst) {
          worst = r;
          pair = [ink, back];
        }
      }
    if (worst < need)
      add(
        worst < (need * 2) / 3 ? "critical" : "major",
        "contrast",
        node,
        `Text ${label(node)} contrast ${worst.toFixed(2)}:1 (${hex(pair[0])} on ${hex(pair[1])}) is below ${need}:1 for ${large ? "large" : "body"} text.`,
        `Darken/lighten the text or its backdrop to reach ≥${need}:1.`,
      );
  }

  // Taste -----------------------------------------------------------------------------------
  const families = new Set(),
    sizes = new Set();
  for (const node of texts) {
    const ancestors = index.ancestors(node),
      size = fontSizeOf(node, ancestors);
    const family = String(inheritedStyle(node, ancestors, "fontFamily") ?? "system-ui")
      .split(",")[0]
      .replace(/["']/g, "")
      .trim()
      .toLowerCase();
    families.add(family);
    sizes.add(Math.round(size));
    for (const run of node.textRuns || []) if (run.fontSize) sizes.add(Math.round(run.fontSize));
    if (size < 12)
      add(
        "major",
        "tiny-text",
        node,
        `Text ${label(node)} is ${size}px.`,
        "Use ≥14px for body text (12px only for captions/labels).",
      );
    else if (size < 14)
      add(
        "minor",
        "small-text",
        node,
        `Text ${label(node)} is ${size}px; fine for captions, too small for body copy.`,
        "Use ≥14px unless this is a caption or label.",
      );
    const box = boxes.get(node.id),
      width = node.wMode === "hug" ? Infinity : box.w,
      cpl = Math.min(
        Math.max(
          ...textOf(node)
            .split("\n")
            .map((l) => l.length),
        ),
        width / charWidth(node, size),
      );
    if (cpl > 85)
      add(
        "minor",
        "line-length",
        node,
        `Text ${label(node)} runs ~${Math.round(cpl)} characters per line.`,
        "Cap the measure at ~60–75 characters (narrower box, e.g. max-w-[640px]).",
      );
    if (/center/.test(node.textAlign || "") && textLines(node, size, width) > 3)
      add(
        "minor",
        "centered-paragraph",
        node,
        `Centered paragraph ${label(node)} spans ${textLines(node, size, width)} lines.`,
        "Left-align multi-line paragraphs; center only short headings.",
      );
    const trimmed = textOf(node).trim();
    if (EMOJI_ONLY.test(trimmed) && EMOJI.test(trimmed))
      add(
        "major",
        "emoji-icon",
        node,
        `Emoji ${label(node)} used as an icon.`,
        "Use a real icon (one consistent icon set) instead of emoji.",
      );
    else if (EMOJI.test(trimmed.slice(0, 3)))
      add(
        "minor",
        "emoji-icon",
        node,
        `Text ${label(node)} starts with an emoji.`,
        "Replace the emoji with a proper icon or remove it.",
      );
  }
  if (families.size > 3)
    add(
      "major",
      "font-families",
      root,
      `${families.size} font families on one artboard (${[...families].join(", ")}).`,
      "Use at most two families (display + text).",
    );
  else if (families.size === 3)
    add(
      "minor",
      "font-families",
      root,
      `3 font families (${[...families].join(", ")}).`,
      "Prefer two families (display + text).",
    );
  if (sizes.size > 7)
    add(
      "major",
      "font-sizes",
      root,
      `${sizes.size} distinct font sizes (${[...sizes].sort((a, b) => a - b).join(", ")}).`,
      "Collapse to a type scale of ≤6 sizes.",
    );

  const isCard = (node) =>
    node.type === "frame" &&
    node !== root &&
    (fillOf(document, node)?.a > 0.05 ||
      gradientColors(node).length ||
      num(node.strokeWidth) > 0) &&
    (radiusOf(node) > 0 || shadowsOf(node).length || num(node.strokeWidth) > 0);
  for (const node of nodes) {
    if (node === root || node.type !== "frame") continue;
    const box = boxes.get(node.id),
      kids = index.children(node.id).filter((k) => !isHidden(k));
    if (
      isCard(node) &&
      kids.length >= 2 &&
      Math.min(box.w, box.h) >= 64 &&
      !isInteractive(node) &&
      index.ancestors(node).some(isCard)
    )
      add(
        "major",
        "card-in-card",
        node,
        `Card ${label(node)} is nested inside another card.`,
        "Flatten: drop the inner card surface (fill/border/shadow) and separate with spacing or a divider.",
      );
    if (
      shadowsOf(node).some(
        (s) => s.color.a > 0.25 && s.blur < 2 * Math.max(Math.abs(s.x), Math.abs(s.y)),
      )
    )
      add(
        "major",
        "harsh-shadow",
        node,
        `${label(node)} has a hard, dark shadow.`,
        "Use a soft shadow: alpha ≤0.12 and blur ≥2× the offset, ideally two layers.",
      );
    const radius = radiusOf(node),
      min = Math.min(box.w, box.h);
    if (min >= 200 && radius >= 40 && radius < min / 2)
      add(
        "minor",
        "large-radius",
        node,
        `${label(node)} (${Math.round(box.w)}×${Math.round(box.h)}) has ${radius}px radius.`,
        "Use 12–24px radius on large containers.",
      );
    const off = [
      ...(node.layout && node.layout !== "free" ? paddingOf(node) : []),
      ...(isFlow(node) ? Object.values(gapOf(node)) : []),
    ].filter((v) => v > 2 && v % 4 !== 0);
    if (off.length)
      add(
        "minor",
        "off-scale-spacing",
        node,
        `${label(node)} uses off-scale spacing (${[...new Set(off)].join(", ")}px).`,
        "Use the 4px scale (4, 8, 12, 16, 24, 32…).",
      );
  }
  // Fixed-height sections: a vertical flow frame pinned to an explicit height whose flow content is
  // noticeably shorter or taller. Spacing should come from padding/gap with the frame hugging.
  for (const node of nodes) {
    if (
      node === root ||
      node.type !== "frame" ||
      node.hMode !== "fixed" ||
      node.hPct !== undefined ||
      !isFlow(node)
    )
      continue;
    if (
      !(node.layout === "block" || (node.layout === "flex" && /column/.test(node.direction || "")))
    )
      continue;
    const flow = index.children(node.id).filter((k) => !isHidden(k) && !isAbsolute(k));
    if (!flow.length || flow.some((k) => k.hMode === "fill" || num(k.grow) > 0)) continue;
    const box = boxes.get(node.id),
      kidBoxes = flow.map((k) => boxes.get(k.id)).filter(Boolean);
    if (!box || !kidBoxes.length) continue;
    const [, , pb] = paddingOf(node),
      [bt, , bb] =
        Array.isArray(node.strokeWidths) && node.strokeWidths.length === 4
          ? node.strokeWidths.map((v) => num(v))
          : [0, 0, 0];
    const content = Math.max(...kidBoxes.map((b) => b.y + b.h)) - box.y + pb + bb;
    const diff = box.h - content,
      limit = Math.max(16, box.h * 0.08);
    if (Math.abs(diff) < limit || content <= paddingOf(node)[0] + pb + bt + bb) continue;
    const measured =
      box.confidence === "measured" && kidBoxes.every((b) => b.confidence === "measured");
    add(
      "major",
      "fixed-height-section",
      node,
      `${label(node)} is pinned to a fixed ${Math.round(box.h)}px height but its content needs ~${Math.round(content)}px (${diff > 0 ? `${Math.round(diff)}px of empty space` : `${Math.round(-diff)}px too short`}${measured ? "" : ", estimated"}).`,
      "Remove h-[…], use padding (py-*/pt-*/pb-*) and gap for the spacing, and let the section hug its content.",
    );
  }
  for (const node of nodes)
    if (
      node.type !== "frame" &&
      node !== root &&
      node.type !== "text" &&
      shadowsOf(node).some(
        (s) => s.color.a > 0.25 && s.blur < 2 * Math.max(Math.abs(s.x), Math.abs(s.y)),
      )
    )
      add(
        "major",
        "harsh-shadow",
        node,
        `${label(node)} has a hard, dark shadow.`,
        "Use a soft shadow: alpha ≤0.12 and blur ≥2× the offset.",
      );

  // Repeated identical grids: ≥2 frames (not nested in each other) with the same ≥3-child structure.
  const signature = (node) =>
    `${node.type}:${node.layout || ""}:${node.columns || ""}[${index
      .children(node.id)
      .filter((k) => !isHidden(k))
      .map(signature)
      .join(",")}]`;
  const groups = new Map();
  // A "grid" here is a frame of ≥3 structurally identical items (so cards with mixed content don't count).
  for (const node of nodes) {
    const kids = index.children(node.id).filter((k) => !isHidden(k));
    if (
      node.type !== "frame" ||
      node === root ||
      kids.length < 3 ||
      new Set(kids.map(signature)).size !== 1
    )
      continue;
    const sig = signature(node);
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(node);
  }
  for (const group of groups.values()) {
    const top = group.filter((n) => !group.some((o) => o !== n && index.ancestors(n).includes(o)));
    if (top.length >= 2)
      add(
        "minor",
        "repeated-grid",
        top[1],
        `${top.length} sections repeat the same ${index.children(top[0].id).length}-item structure (${top.map(label).join(", ")}).`,
        "Vary the layouts: feature one item, change columns, or use a different pattern.",
      );
  }

  // Accent overuse: the most saturated fill covering >30% of the artboard.
  const coverage = new Map();
  for (const node of nodes) {
    const fill = fillOf(document, node);
    if (!fill || fill.a < 0.5) continue;
    const key = hex(fill),
      box = boxes.get(node.id),
      entry = coverage.get(key) || { color: fill, area: 0, interactive: false, node };
    entry.area += isInteractive(node) ? 0 : Math.max(0, box.w * box.h);
    entry.interactive ||= isInteractive(node) || index.ancestors(node).some(isInteractive);
    if (!isInteractive(node) && box.w * box.h > num(entry.largest)) {
      entry.node = node;
      entry.largest = box.w * box.h;
    }
    coverage.set(key, entry);
  }
  const accent = [...coverage.values()]
    .filter(
      (e) => saturation(e.color) >= 0.5 && luminance(e.color) > 0.02 && luminance(e.color) < 0.8,
    )
    .sort((a, b) => saturation(b.color) - saturation(a.color))[0];
  if (accent && accent.area / rootArea > 0.3)
    add(
      accent.interactive ? "major" : "minor",
      "accent-overuse",
      accent.node,
      `Accent ${hex(accent.color)} covers ${Math.round(Math.min(1, accent.area / rootArea) * 100)}% of the artboard${accent.interactive ? " and is also the action color" : ""}.`,
      "Reserve the accent for actions/highlights; use neutral surfaces for large areas.",
    );

  // More than one primary (filled, saturated or dark) button per section (or per card).
  const sectionOf = (node) =>
    [...index.ancestors(node)].reverse().find(isCard) || index.ancestors(node)[1] || root;
  const primaries = new Map();
  for (const node of nodes) {
    if (node.type !== "frame" || !isInteractive(node)) continue;
    const fill = fillOf(document, node);
    if (!fill || fill.a < 0.9 || !(saturation(fill) > 0.3 || luminance(fill) < 0.05)) continue;
    const section = sectionOf(node);
    primaries.set(section, [...(primaries.get(section) || []), node]);
  }
  for (const [section, list] of primaries)
    if (list.length > 1)
      add(
        "minor",
        "multiple-primary",
        list[1],
        `${list.length} primary-styled buttons in ${label(section)} (${list.map(label).join(", ")}).`,
        "Keep one primary action per section; make the others secondary (outline/ghost).",
      );

  problems.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  const counts = Object.fromEntries(
    SEVERITIES.map((s) => [s, problems.filter((p) => p.severity === s).length]),
  );
  const measured = [...boxes.values()].some((b) => b.confidence === "measured");
  const stats = {
    nodes: nodes.length,
    texts: texts.length,
    fontFamilies: [...families],
    fontSizes: [...sizes].sort((a, b) => a - b),
    geometry: measured ? "measured" : "estimated",
    ...counts,
  };
  return { problems, stats, summary: summarize(problems, stats, refOf(index, root)) };
}

/** Compact, severity-grouped text for humans and models. */
export function summarize(problems, stats, artboard = "", limit = 40) {
  if (!problems.length)
    return `Lint ${artboard}: no problems (${stats.nodes} elements, geometry ${stats.geometry}).`;
  const lines = [
    `Lint ${artboard}: ${stats.critical} critical, ${stats.major} major, ${stats.minor} minor (geometry ${stats.geometry}).`,
  ];
  let shown = 0;
  for (const severity of SEVERITIES) {
    const list = problems.filter((p) => p.severity === severity);
    if (!list.length) continue;
    lines.push(severity.toUpperCase());
    for (const p of list) {
      if (shown++ >= limit) break;
      lines.push(
        `- [${p.rule}] ${p.ref || "artboard"}${p.confidence === "estimated" ? " (estimated)" : ""}: ${p.message} Fix: ${p.fix}`,
      );
    }
  }
  if (problems.length > limit) lines.push(`… ${problems.length - limit} more`);
  return lines.join("\n");
}
