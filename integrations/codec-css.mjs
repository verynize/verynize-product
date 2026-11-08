// CSS value helpers for the JSX codec: var() substitution, calc() evaluation to a linear length,
// and color parsing (hex, rgb, hsl, oklch, oklab, color-mix) into sRGB hex. Pure and synchronous.

// ---------------------------------------------------------------------------------------------
// Tokenizing helpers

/** Split at top-level separators (commas or whitespace), respecting parentheses and quotes. */
export function splitTop(value, separator = ",") {
  const out = [];
  let depth = 0,
    quote = null,
    start = 0;
  const s = String(value);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && (separator === " " ? /\s/.test(c) : c === separator)) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out
    .map((part) => part.trim())
    .filter((part, i, all) => (separator === " " ? part !== "" : part !== "" || all.length > 1));
}

/** Index of the parenthesis closing the one at `open`. */
function closing(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/**
 * Replace var(--name, fallback) using lookup(name) -> string|undefined. Returns null when a
 * variable without fallback is undefined (CSS "invalid at computed-value time").
 * `missing` collects undefined variable names.
 */
export function substituteVars(value, lookup, missing = [], depth = 0) {
  if (value === null || value === undefined) return null;
  let s = String(value);
  if (depth > 24) return null;
  for (;;) {
    const at = s.indexOf("var(");
    if (at < 0) return s;
    const end = closing(s, at + 3);
    if (end < 0) return null;
    const inner = s.slice(at + 4, end);
    const comma = splitTop(inner, ",");
    const name = comma[0].trim();
    const fallback = inner.includes(",") ? inner.slice(inner.indexOf(",") + 1) : undefined;
    let replacement = lookup(name);
    if (replacement !== undefined && replacement !== null)
      replacement = substituteVars(replacement, lookup, missing, depth + 1);
    if (replacement === undefined || replacement === null) {
      if (fallback === undefined) {
        missing.push(name);
        return null;
      }
      replacement = substituteVars(fallback.trim(), lookup, missing, depth + 1);
      if (replacement === null) return null;
    }
    s = s.slice(0, at) + replacement + s.slice(end + 1);
  }
}

// ---------------------------------------------------------------------------------------------
// Lengths: a linear combination {px, pct, em, vw, vh, n} (n = unitless number).

const ZERO = () => ({ px: 0, pct: 0, em: 0, vw: 0, vh: 0, n: 0 });
const UNIT_KEYS = ["px", "pct", "em", "vw", "vh", "n"];
const isPureNumber = (v) => UNIT_KEYS.every((k) => k === "n" || !v[k]);
const add = (a, b, sign = 1) => Object.fromEntries(UNIT_KEYS.map((k) => [k, a[k] + sign * b[k]]));
const scale = (a, f) => Object.fromEntries(UNIT_KEYS.map((k) => [k, a[k] === 0 ? 0 : a[k] * f]));

function atom(token) {
  if (/^[+-]?infinity$/i.test(token))
    return { ...ZERO(), n: token.startsWith("-") ? -Infinity : Infinity };
  const m = token.match(
    /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|rem|em|%|vw|vh|svh|dvh|lvh|deg|ch|ex|)$/i,
  );
  if (!m) return null;
  const v = ZERO(),
    n = Number(m[1]),
    unit = m[2].toLowerCase();
  if (unit === "px") v.px = n;
  else if (unit === "rem") v.px = n * 16;
  else if (unit === "em") v.em = n;
  else if (unit === "ch" || unit === "ex") v.em = n * 0.5;
  else if (unit === "%") v.pct = n;
  else if (unit === "vw") v.vw = n;
  else if (unit.endsWith("vh")) v.vh = n;
  else v.n = n; // deg and bare numbers
  return v;
}

/** Evaluate a CSS length/number expression (including nested calc()) to a linear value, or null. */
export function evalLength(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const tokens =
    s
      .replace(/calc\(/gi, "(")
      .match(/[+-]?infinity|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[a-z%]*|[()*/+-]|\S/gi) || [];
  let i = 0;
  const peek = () => tokens[i];
  const primary = () => {
    const t = tokens[i++];
    if (t === undefined) throw new Error("end");
    if (t === "(") {
      const v = expr();
      if (tokens[i++] !== ")") throw new Error("paren");
      return v;
    }
    if (t === "-") return scale(primary(), -1);
    if (t === "+") return primary();
    const v = atom(t);
    if (!v) throw new Error("atom");
    return v;
  };
  const term = () => {
    let v = primary();
    while (peek() === "*" || peek() === "/") {
      const op = tokens[i++],
        r = primary();
      if (op === "*") {
        if (isPureNumber(r)) v = scale(v, r.n);
        else if (isPureNumber(v)) v = scale(r, v.n);
        else throw new Error("mul");
      } else {
        if (!isPureNumber(r) || r.n === 0) throw new Error("div");
        v = scale(v, 1 / r.n);
      }
    }
    return v;
  };
  const expr = () => {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const op = tokens[i++];
      v = add(v, term(), op === "-" ? -1 : 1);
    }
    return v;
  };
  try {
    const v = expr();
    if (i !== tokens.length) return null;
    return v;
  } catch {
    return null;
  }
}

/** Convenience: {px} for pure px, {frac} for pure %, {px, frac} for mixes, {n} for numbers. */
export function lengthOf(value, { fontSize = 16 } = {}) {
  const v = evalLength(value);
  if (!v) return null;
  if (v.vw || v.vh) return { viewport: true };
  const px = v.px + v.em * fontSize;
  if (v.pct && !px && !v.n) return { frac: v.pct / 100 };
  if (v.pct) return { frac: v.pct / 100, px: px + v.n };
  if (v.n && !px) return { n: v.n, px: v.n === 0 ? 0 : undefined };
  return { px };
}

// ---------------------------------------------------------------------------------------------
// Colors -> {r,g,b,a} (0..255, alpha 0..1) -> hex

const NAMED = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  navy: "#000080",
  teal: "#008080",
  aqua: "#00ffff",
  cyan: "#00ffff",
  fuchsia: "#ff00ff",
  magenta: "#ff00ff",
  lime: "#00ff00",
  olive: "#808000",
  pink: "#ffc0cb",
  brown: "#a52a2a",
  gold: "#ffd700",
  indigo: "#4b0082",
  violet: "#ee82ee",
  crimson: "#dc143c",
  coral: "#ff7f50",
  salmon: "#fa8072",
  tomato: "#ff6347",
  beige: "#f5f5dc",
  ivory: "#fffff0",
  khaki: "#f0e68c",
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const num = (raw, percentScale = 1) => {
  const t = String(raw).trim();
  if (t === "none") return 0;
  if (t.endsWith("%")) return (Number(t.slice(0, -1)) / 100) * percentScale;
  return Number(t);
};
const toGamma = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const toLinear = (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));

function oklabToRgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b,
    m_ = L - 0.1055613458 * a - 0.0638541728 * b,
    s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3,
    m = m_ ** 3,
    s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [r, g, bl].map((x) => Math.round(clamp01(toGamma(x)) * 255));
}
function rgbToOklab([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map((x) => toLinear(x / 255));
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12,
    a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((x) => Math.round(clamp01(x) * 255));
}
function splitColorArgs(inner) {
  const [main, alpha] = inner.includes("/")
    ? [inner.slice(0, inner.lastIndexOf("/")), inner.slice(inner.lastIndexOf("/") + 1)]
    : [inner, undefined];
  const parts = main.includes(",") ? main.split(",") : main.trim().split(/\s+/);
  let a = alpha === undefined ? 1 : num(alpha);
  if (parts.length === 4 && alpha === undefined) {
    a = num(parts[3]);
    parts.length = 3;
  }
  return { parts: parts.map((p) => p.trim()), a };
}

/** Parse a CSS color to {r,g,b,a} or null. */
export function parseColor(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (NAMED[v]) return parseColor(NAMED[v]);
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = Array.from(h, (c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  m = v.match(/^([a-z-]+)\((.*)\)$/s);
  if (!m) return null;
  const fn = m[1],
    inner = m[2];
  if (fn === "color-mix") return colorMix(inner);
  const { parts, a } = splitColorArgs(inner);
  if (parts.length !== 3 || !Number.isFinite(a)) return null;
  let rgb;
  if (fn === "rgb" || fn === "rgba")
    rgb = parts.map((p) => Math.round(Math.min(255, Math.max(0, num(p, 255)))));
  else if (fn === "hsl" || fn === "hsla")
    rgb = hslToRgb(num(parts[0]), num(parts[1], 1), num(parts[2], 1));
  else if (fn === "oklch") {
    const L = num(parts[0], 1),
      C = num(parts[1], 0.4),
      H = (num(parts[2]) * Math.PI) / 180;
    rgb = oklabToRgb(L, C * Math.cos(H), C * Math.sin(H));
  } else if (fn === "oklab")
    rgb = oklabToRgb(num(parts[0], 1), num(parts[1], 0.4), num(parts[2], 0.4));
  else return null;
  if (rgb.some((x) => !Number.isFinite(x))) return null;
  return { r: rgb[0], g: rgb[1], b: rgb[2], a: clamp01(a) };
}

function colorMix(inner) {
  const args = splitTop(inner, ",");
  if (args.length < 3 || !/^in\s/.test(args[0])) return null;
  const read = (arg) => {
    const m = arg.match(/^(.*?)(?:\s+(-?[\d.]+)%)?$/s);
    const color = parseColor(m[1]);
    return color ? { color, p: m[2] !== undefined ? Number(m[2]) / 100 : undefined } : null;
  };
  const one = read(args[1]),
    two = read(args[2]);
  if (!one || !two) return null;
  let p1 = one.p,
    p2 = two.p;
  if (p1 === undefined && p2 === undefined) {
    p1 = 0.5;
    p2 = 0.5;
  } else if (p1 === undefined) p1 = 1 - p2;
  else if (p2 === undefined) p2 = 1 - p1;
  const total = p1 + p2;
  if (total <= 0) return null;
  const alphaScale = Math.min(1, total);
  const w1 = p1 / total,
    w2 = p2 / total;
  const a = one.color.a * w1 + two.color.a * w2;
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  // Premultiplied interpolation in oklab (Tailwind always mixes "in oklab").
  const lab1 = rgbToOklab([one.color.r, one.color.g, one.color.b]),
    lab2 = rgbToOklab([two.color.r, two.color.g, two.color.b]);
  const mixed = [0, 1, 2].map((k) => (lab1[k] * one.color.a * w1 + lab2[k] * two.color.a * w2) / a);
  const rgb = oklabToRgb(...mixed);
  return { r: rgb[0], g: rgb[1], b: rgb[2], a: clamp01(a * alphaScale) };
}

const hex2 = (n) => Math.round(n).toString(16).padStart(2, "0");
/** #rrggbb, or #rrggbbaa when translucent, or 'transparent'. */
export function colorToHex(color) {
  if (!color) return null;
  if (color.a <= 0) return "transparent";
  const base = "#" + hex2(color.r) + hex2(color.g) + hex2(color.b);
  return color.a >= 0.999 ? base : base + hex2(color.a * 255);
}
export const cssColorToHex = (value) => colorToHex(parseColor(value));

/** Replace every color function / hex in a CSS string (gradients, shadows) with sRGB hex. */
export function normalizeColorsIn(value) {
  let s = String(value);
  for (const fn of ["color-mix", "oklch", "oklab", "hsla", "hsl", "rgba", "rgb"]) {
    let from = 0;
    for (;;) {
      const at = s.indexOf(fn + "(", from);
      if (at < 0) break;
      if (at > 0 && /[a-z-]/i.test(s[at - 1])) {
        from = at + 1;
        continue;
      }
      const end = closing(s, at + fn.length);
      if (end < 0) break;
      const hex = cssColorToHex(s.slice(at, end + 1));
      if (hex) {
        s = s.slice(0, at) + (hex === "transparent" ? "#0000" : hex) + s.slice(end + 1);
        from = at + 1;
      } else from = end + 1;
    }
  }
  return s
    .replace(/#([0-9a-f]{3,8})\b/gi, (match) => cssColorToHex(match) ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Media queries, evaluated for a fixed viewport (import time has no live window).

/** Default environment used when importing: a light, hover-capable screen. */
export const MEDIA_DEFAULTS = Object.freeze({
  width: 1440,
  height: 900,
  colorScheme: "light",
  hover: true,
  reducedMotion: false,
  type: "screen",
  resolution: 1,
});

/** Split at a top-level keyword (" and " / " or "), ignoring parentheses. */
function splitKeyword(text, word) {
  const out = [];
  let depth = 0,
    start = 0;
  const lower = text.toLowerCase(),
    needle = ` ${word} `;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (depth === 0 && lower.startsWith(needle, i)) {
      out.push(text.slice(start, i));
      start = i + needle.length;
      i += needle.length - 1;
    }
  }
  out.push(text.slice(start));
  return out.map((part) => part.trim()).filter(Boolean);
}
const mediaLength = (value) => {
  const v = String(value).trim();
  const ratio = v.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (ratio) return Number(ratio[1]) / Number(ratio[2]);
  const dppx = v.match(/^(\d+(?:\.\d+)?)(dppx|x|dpi)$/);
  if (dppx) return dppx[2] === "dpi" ? Number(dppx[1]) / 96 : Number(dppx[1]);
  const len = lengthOf(v);
  if (!len) return NaN;
  return len.px ?? len.n ?? NaN;
};
function featureValue(name, env) {
  switch (name) {
    case "width":
    case "device-width":
      return env.width;
    case "height":
    case "device-height":
      return env.height;
    case "aspect-ratio":
    case "device-aspect-ratio":
      return env.width / env.height;
    case "resolution":
      return env.resolution;
    default:
      return undefined;
  }
}
const compare = (a, op, b) =>
  op === "<"
    ? a < b
    : op === "<="
      ? a <= b + 1e-9
      : op === ">"
        ? a > b
        : op === ">="
          ? a >= b - 1e-9
          : Math.abs(a - b) < 1e-9;
const flip = (op) => ({ "<": ">", "<=": ">=", ">": "<", ">=": "<=", "=": "=" })[op];
function evalFeature(inner, env) {
  const text = inner.trim().toLowerCase();
  // Range syntax: (width >= 48rem), (400px <= width < 900px)
  const range = text.match(/^(.+?)\s*(<=|>=|<|>|=)\s*(.+?)(?:\s*(<=|>=|<|>|=)\s*(.+))?$/);
  if (range && !text.includes(":")) {
    const [, a, op1, b, op2, c] = range;
    if (op2) {
      const v = featureValue(b.trim(), env);
      if (v === undefined) return false;
      return compare(mediaLength(a), op1, v) && compare(v, op2, mediaLength(c));
    }
    const left = featureValue(a.trim(), env);
    if (left !== undefined) return compare(left, op1, mediaLength(b));
    const right = featureValue(b.trim(), env);
    if (right !== undefined) return compare(right, flip(op1), mediaLength(a));
    return false;
  }
  const colon = text.indexOf(":");
  const name = (colon < 0 ? text : text.slice(0, colon)).trim(),
    value = colon < 0 ? null : text.slice(colon + 1).trim();
  const prefix = name.match(/^(min|max)-(.+)$/);
  if (prefix) {
    const v = featureValue(prefix[2], env);
    if (v === undefined || value === null) return false;
    return compare(v, prefix[1] === "min" ? ">=" : "<=", mediaLength(value));
  }
  if (featureValue(name, env) !== undefined)
    return value === null ? true : compare(featureValue(name, env), "=", mediaLength(value));
  switch (name) {
    case "prefers-color-scheme":
      return value === null || value === env.colorScheme;
    case "hover":
    case "any-hover":
      return value === null ? env.hover : (value === "hover") === env.hover;
    case "pointer":
    case "any-pointer":
      return value === null ? true : value === (env.hover ? "fine" : "coarse");
    case "prefers-reduced-motion":
      return value === null ? env.reducedMotion : (value === "reduce") === env.reducedMotion;
    case "orientation":
      return value === (env.width >= env.height ? "landscape" : "portrait");
    case "color":
      return true;
    case "prefers-contrast":
    case "forced-colors":
    case "inverted-colors":
      return value === "no-preference" || value === "none";
    case "display-mode":
      return value === "browser";
    case "scripting":
      return value === "enabled" || value === null;
    default:
      return false;
  }
}
function evalCondition(text, env) {
  const t = text.trim();
  if (/^not\s/i.test(t)) return !evalCondition(t.slice(3), env);
  const ors = splitKeyword(t, "or");
  if (ors.length > 1) return ors.some((part) => evalCondition(part, env));
  const ands = splitKeyword(t, "and");
  if (ands.length > 1) return ands.every((part) => evalCondition(part, env));
  if (t.startsWith("(") && closing(t, 0) === t.length - 1) {
    const inner = t.slice(1, -1).trim();
    return inner.startsWith("(") || /^not\s/i.test(inner)
      ? evalCondition(inner, env)
      : evalFeature(inner, env);
  }
  return false;
}

/** Whether a media query list (the text after `@media`) matches `env` (see MEDIA_DEFAULTS). */
export function matchMedia(query, env = MEDIA_DEFAULTS) {
  const e = { ...MEDIA_DEFAULTS, ...env };
  const list = splitTop(String(query || "").trim(), ",");
  if (!list.length || (list.length === 1 && !list[0])) return true;
  return list.some((raw) => {
    let q = raw.trim(),
      negate = false;
    const lead = q.match(/^(not|only)\s+/i);
    if (lead) {
      negate = lead[1].toLowerCase() === "not";
      q = q.slice(lead[0].length);
    }
    let ok = true;
    const type = q.match(/^([a-z-]+)(?:\s+and\s+|\s*$)/i);
    if (type && !q.startsWith("(")) {
      const name = type[1].toLowerCase();
      ok = name === "all" || name === e.type;
      q = q.slice(type[0].length);
    }
    if (ok && q.trim()) ok = evalCondition(q, e);
    return negate ? !ok : ok;
  });
}
