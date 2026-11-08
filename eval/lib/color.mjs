// Color parsing and comparison for fidelity assertions. Accepts hex (#rgb, #rgba, #rrggbb,
// #rrggbbaa), rgb()/rgba() (comma or space syntax), oklch(), "transparent", and
// "tw:<palette>-<shade>[/<alpha>]" which resolves against the installed Tailwind v4 theme.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let theme = null;
function tailwindTheme() {
  if (theme) return theme;
  theme = new Map();
  try {
    const css = readFileSync(require.resolve("tailwindcss/theme.css"), "utf8");
    for (const m of css.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) theme.set(m[1], m[2].trim());
  } catch {
    /* tailwind missing: tw: colors will fail to resolve */
  }
  return theme;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const pct = (s, scale = 1) => (s.endsWith("%") ? (parseFloat(s) / 100) * scale : parseFloat(s));

function oklchToRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h),
    b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3,
    m = m_ ** 3,
    s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => {
    const v = clamp01(c);
    return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  });
}

/** Parse a CSS-ish color into {r,g,b,a} (0-255, alpha 0-1) or null. */
export function parseColor(input) {
  if (input === null || input === undefined) return null;
  let s = String(input).trim().toLowerCase();
  if (!s) return null;
  if (s === "transparent" || s === "none") return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith("tw:")) {
    const [name, alpha] = s.slice(3).split("/");
    const value = tailwindTheme().get(name);
    if (!value) return null;
    const base = parseColor(value);
    if (!base) return null;
    return alpha !== undefined ? { ...base, a: base.a * (parseFloat(alpha) / 100) } : base;
  }
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1]
      .replace(/\s*\/\s*/, " / ")
      .split(/[\s,\/]+/)
      .filter(Boolean);
    const [r, g, b] = parts.slice(0, 3).map((p) => (p.endsWith("%") ? pct(p, 255) : parseFloat(p)));
    const a = parts[3] !== undefined ? pct(parts[3]) : 1;
    return [r, g, b, a].every(Number.isFinite)
      ? { r: Math.round(r), g: Math.round(g), b: Math.round(b), a }
      : null;
  }
  m = s.match(/^oklch\(([^)]+)\)$/);
  if (m) {
    const parts = m[1]
      .replace(/\s*\/\s*/, " / ")
      .split(/[\s\/]+/)
      .filter(Boolean);
    const L = pct(parts[0]),
      C = parseFloat(parts[1]),
      H = parseFloat(parts[2]) || 0;
    const a = parts[3] !== undefined ? pct(parts[3]) : 1;
    if (![L, C, a].every(Number.isFinite)) return null;
    const [r, g, b] = oklchToRgb(L, C, H);
    return { r, g, b, a };
  }
  const named = { white: "#ffffff", black: "#000000" };
  if (named[s]) return parseColor(named[s]);
  return null;
}

/** Compare two colors with per-channel tolerance (default 3/255) and alpha tolerance 0.03. */
export function sameColor(actual, expected, { tol = 3, alphaTol = 0.03 } = {}) {
  const a = parseColor(actual),
    e = parseColor(expected);
  if (!a || !e) return false;
  if (e.a === 0 && a.a === 0) return true;
  return (
    Math.abs(a.r - e.r) <= tol &&
    Math.abs(a.g - e.g) <= tol &&
    Math.abs(a.b - e.b) <= tol &&
    Math.abs(a.a - e.a) <= alphaTol
  );
}

export const formatColor = (c) => {
  const p = parseColor(c);
  return p ? `rgba(${p.r},${p.g},${p.b},${Math.round(p.a * 100) / 100})` : String(c);
};
