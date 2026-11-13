// Colour math for the inspector colour picker (design/wonder 23): parse CSS colours, convert between
// HSV (picker plane), RGB, HSL and OKLCH, and serialise. Documents store `#rrggbb` when opaque and
// `#rrggbbaa` when translucent, which every validator, codec and exporter already understands.

export type Rgba = { r: number; g: number; b: number; a: number };
export type Hsva = { h: number; s: number; v: number; a: number };
export type ColorFormat = "hex" | "rgb" | "hsl" | "oklch";
export const FORMATS: { value: ColorFormat; label: string }[] = [
  { value: "hex", label: "HEX" },
  { value: "rgb", label: "RGB" },
  { value: "hsl", label: "HSL" },
  { value: "oklch", label: "OKLCH" },
];

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const round = (v: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
const hex2 = (n: number) =>
  Math.round(clamp(n, 0, 255))
    .toString(16)
    .padStart(2, "0");

/** "#rrggbb" (alpha 1) or "#rrggbbaa". */
export function toHex({ r, g, b, a }: Rgba): string {
  const base = "#" + hex2(r) + hex2(g) + hex2(b);
  const alpha = Math.round(clamp(a) * 255);
  return alpha >= 255 ? base : base + hex2(alpha);
}
/** "RRGGBB" for display, without alpha. */
export const hexDigits = (c: Rgba) =>
  toHex({ ...c, a: 1 })
    .slice(1)
    .toUpperCase();

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2,
    d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function rgbToOklch(r: number, g: number, b: number): [number, number, number] {
  const [lr, lg, lb] = [r, g, b].map((c) => toLinear(c / 255));
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  return [L, C, C < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}
function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const A = C * Math.cos((H * Math.PI) / 180),
    B = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => clamp(fromLinear(c)) * 255) as [number, number, number];
}

/** Parse "#rgb[a]", "#rrggbb[aa]", "rgb()/rgba()", "hsl()/hsla()", "oklch()" (with or without "#" for hex). */
export function parseColor(input: string): Rgba | null {
  const v = input.trim().toLowerCase();
  if (!v) return null;
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4)
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^(rgba?|hsla?|oklch)\((.*)\)$/.exec(v);
  if (!fn) return null;
  const [main, slash] = fn[2].split("/");
  const parts = main.split(/[\s,]+/).filter(Boolean);
  const alphaRaw = slash ?? (parts.length === 4 ? parts[3] : undefined);
  const num = (s: string | undefined, scale: number) => {
    if (s === undefined) return NaN;
    const t = s.trim();
    return t.endsWith("%") ? (parseFloat(t) / 100) * scale : parseFloat(t);
  };
  const a = alphaRaw === undefined ? 1 : clamp(num(alphaRaw, 1));
  if (parts.length < 3 || !Number.isFinite(a)) return null;
  let rgb: [number, number, number];
  if (fn[1].startsWith("rgb")) rgb = [num(parts[0], 255), num(parts[1], 255), num(parts[2], 255)];
  else if (fn[1].startsWith("hsl"))
    rgb = hslToRgb(
      parseFloat(parts[0]),
      clamp(num(parts[1], 1) / (parts[1].endsWith("%") ? 1 : 100)),
      clamp(num(parts[2], 1) / (parts[2].endsWith("%") ? 1 : 100)),
    );
  else rgb = oklchToRgb(num(parts[0], 1), num(parts[1], 0.4), parseFloat(parts[2]));
  if (rgb.some((c) => !Number.isFinite(c))) return null;
  return { r: clamp(rgb[0], 0, 255), g: clamp(rgb[1], 0, 255), b: clamp(rgb[2], 0, 255), a };
}

export function rgbaToHsva({ r, g, b, a }: Rgba): Hsva {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn),
    d = max - min;
  let h = 0;
  if (d) h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max, a };
}
export function hsvaToRgba({ h, s, v, a }: Hsva): Rgba {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return { r: f(5), g: f(3), b: f(1), a };
}

/** The three channel values shown under the picker for a format. */
export function channels(
  c: Rgba,
  format: ColorFormat,
): { label: string; value: number; max: number; step: number }[] {
  if (format === "hsl") {
    const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
    return [
      { label: "Hue", value: round(h), max: 360, step: 1 },
      { label: "Saturation", value: round(s * 100), max: 100, step: 1 },
      { label: "Lightness", value: round(l * 100), max: 100, step: 1 },
    ];
  }
  if (format === "oklch") {
    const [L, C, H] = rgbToOklch(c.r, c.g, c.b);
    return [
      { label: "Lightness", value: round(L * 100, 1), max: 100, step: 1 },
      { label: "Chroma", value: round(C, 3), max: 0.4, step: 0.01 },
      { label: "Hue", value: round(H, 1), max: 360, step: 1 },
    ];
  }
  return [
    { label: "Red", value: Math.round(c.r), max: 255, step: 1 },
    { label: "Green", value: Math.round(c.g), max: 255, step: 1 },
    { label: "Blue", value: Math.round(c.b), max: 255, step: 1 },
  ];
}

/** Rebuild a colour after editing one channel of a format. */
export function withChannel(c: Rgba, format: ColorFormat, index: number, value: number): Rgba {
  const values = channels(c, format).map((ch) => ch.value);
  values[index] = clamp(value, 0, channels(c, format)[index].max);
  let rgb: [number, number, number];
  if (format === "hsl") rgb = hslToRgb(values[0], values[1] / 100, values[2] / 100);
  else if (format === "oklch") rgb = oklchToRgb(values[0] / 100, values[1], values[2]);
  else rgb = [values[0], values[1], values[2]];
  return { r: rgb[0], g: rgb[1], b: rgb[2], a: c.a };
}

/** Text shown in the value field: "RRGGBB" for hex, otherwise a CSS colour without alpha. */
export function formatColor(c: Rgba, format: ColorFormat): string {
  if (format === "hex") return hexDigits(c);
  const [x, y, z] = channels(c, format).map((ch) => ch.value);
  if (format === "rgb") return `rgb(${x} ${y} ${z})`;
  if (format === "hsl") return `hsl(${x} ${y}% ${z}%)`;
  return `oklch(${x}% ${y} ${z})`;
}
/** CSS string including alpha, used for copying. */
export function cssColor(c: Rgba, format: ColorFormat): string {
  if (format === "hex") return toHex(c).toUpperCase();
  const base = formatColor(c, format);
  return c.a >= 1 ? base : base.replace(/\)$/, ` / ${round(c.a * 100)}%)`);
}

/** Alpha in percent for a stored colour (100 for opaque or unparsable values). */
export const alphaPercent = (color: string) => {
  const c = parseColor(color);
  return c ? Math.round(c.a * 100) : 100;
};
/** Replace the alpha of a stored colour; returns null for unparsable colours. */
export function withAlpha(color: string, percent: number): string | null {
  const c = parseColor(color);
  return c ? toHex({ ...c, a: clamp(percent / 100) }) : null;
}

/** True when typed colour text spells out an alpha (#rgba, #rrggbbaa, "/ a" or a fourth rgba()/hsla() argument). */
export function hasAlpha(text: string): boolean {
  const v = text.trim().toLowerCase();
  if (/^#?([0-9a-f]{4}|[0-9a-f]{8})$/.test(v)) return true;
  const inner = /\((.*)\)/.exec(v)?.[1] ?? "";
  return inner.includes("/") || inner.split(",").length === 4;
}
