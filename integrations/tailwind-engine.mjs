// The real Tailwind v4 engine, loaded once (top-level await) so class resolution stays
// synchronous for callers. Classes are compiled with tailwindcss's design system and returned as
// cascaded CSS declarations; theme lookups and reverse lookups (hex -> palette name, px -> scale
// step) serve the serializer so code read back uses idiomatic Tailwind.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { substituteVars, lengthOf, cssColorToHex, normalizeColorsIn } from "./codec-css.mjs";

// Hosts without a file system (the collaboration Worker, cloud/mcp-env.js) provide the theme
// stylesheet as globalThis.__verynizeTailwindTheme before this module loads.
let designSystem = null,
  engineError = null;
try {
  const tailwind = await import("tailwindcss");
  const provided =
    typeof globalThis.__verynizeTailwindTheme === "string"
      ? globalThis.__verynizeTailwindTheme
      : null;
  const theme =
    provided ??
    readFileSync(createRequire(import.meta.url).resolve("tailwindcss/theme.css"), "utf8");
  designSystem = await tailwind.__unstable__loadDesignSystem(`${theme}\n@tailwind utilities;\n`, {
    base: provided === null ? dirname(fileURLToPath(import.meta.url)) : "/",
  });
} catch (error) {
  engineError = error;
}

export const tailwindAvailable = () => !!designSystem;
function system() {
  if (!designSystem)
    throw new Error(
      `The Tailwind engine (tailwindcss v4) could not be loaded: ${engineError?.message || "unknown error"}`,
    );
  return designSystem;
}

// @property initial values seen while compiling (e.g. --tw-ring-offset-width: 0px).
const INITIAL = new Map();
const compiled = new Map();

/**
 * Compile one class. Returns {kind:'ok', decls:[{property,value,important}], childDecls:[...]} or
 * {kind:'invalid'} or {kind:'variant', variants:[names]}.
 */
export function compileClass(cls) {
  if (compiled.has(cls)) return compiled.get(cls);
  const ds = system();
  let result;
  let candidates = [];
  try {
    candidates = ds.parseCandidate(cls);
  } catch {
    candidates = [];
  }
  if (!candidates.length) result = { kind: "invalid" };
  else if (candidates[0].variants?.length) {
    const ast = ds.candidatesToAst([cls])[0];
    result = ast?.length
      ? {
          kind: "variant",
          variants: candidates[0].variants.map((v) => {
            try {
              return ds.printVariant(v);
            } catch {
              return "?";
            }
          }),
          ...variantBody(ast),
        }
      : { kind: "invalid" };
  } else {
    const ast = ds.candidatesToAst([cls])[0] || [];
    const decls = [],
      childDecls = [],
      extras = [];
    for (const node of ast) {
      if (node.kind === "at-rule" && node.name === "@property") {
        const initial = node.nodes?.find(
          (d) => d.kind === "declaration" && d.property === "initial-value",
        );
        if (initial && !INITIAL.has(node.params.trim()))
          INITIAL.set(node.params.trim(), initial.value);
        continue;
      }
      if (node.kind === "at-rule") {
        extras.push(node.name);
        continue;
      }
      if (node.kind !== "rule") continue;
      const target = /(?<!\\)[>~+]|:where\(|:is\(/.test(node.selector) ? childDecls : decls; // an escaped \+ (w-[calc(50%_+_8px)]) is part of the class name
      for (const child of node.nodes || [])
        if (child.kind === "declaration" && child.value !== undefined)
          target.push({
            property: child.property,
            value: child.value,
            important: !!child.important,
          });
    }
    result =
      decls.length || childDecls.length
        ? { kind: "ok", decls, childDecls, extras }
        : { kind: extras.length ? "unsupported" : "invalid", extras };
  }
  compiled.set(cls, result);
  return result;
}

/**
 * What a variant class compiles to: the @media conditions wrapping it and its declarations.
 * `plain` is true when every rule targets the element itself (or its children, like space-y) without
 * a state selector (:hover, .dark &, [data-*]…), so it applies whenever the media conditions match.
 */
function variantBody(ast) {
  const media = [],
    decls = [],
    childDecls = [];
  let plain = true;
  const walk = (nodes, depth) => {
    for (const node of nodes || []) {
      if (node.kind === "at-rule" && node.name === "@property") {
        const initial = node.nodes?.find(
          (d) => d.kind === "declaration" && d.property === "initial-value",
        );
        if (initial && !INITIAL.has(node.params.trim()))
          INITIAL.set(node.params.trim(), initial.value);
        continue;
      }
      if (node.kind === "at-rule") {
        if (node.name === "@media") media.push(node.params.trim());
        else plain = false;
        walk(node.nodes, depth + 1);
        continue;
      }
      if (node.kind !== "rule") continue;
      const selector = node.selector.trim();
      const child = /^:where\(\.[^\s:]+(?:\\:[^\s:]+)*\s*>\s*:not\(:last-child\)\)$/.test(selector);
      // A plain class selector: "." + escaped name, with no unescaped ':' / '[' / ' ' afterwards.
      const self = /^\.(?:\\.|[^\s:[\]>~+()])+$/.test(selector);
      if (!self && !child) plain = false;
      for (const d of node.nodes || [])
        if (d.kind === "declaration" && d.value !== undefined)
          (child ? childDecls : decls).push({
            property: d.property,
            value: d.value,
            important: !!d.important,
          });
    }
  };
  walk(ast, 0);
  return { media, plain: plain && (decls.length > 0 || childDecls.length > 0), decls, childDecls };
}

/** Sort classes the way Tailwind emits them (so `p-4 px-2` behaves like CSS). Invalid classes keep input order. */
export function sortClasses(classes) {
  const ds = system();
  let order;
  try {
    order = new Map(ds.getClassOrder(classes));
  } catch {
    return classes;
  }
  return classes
    .map((cls, i) => ({ cls, i, o: order.get(cls) }))
    .sort((a, b) => {
      if (a.o === null || a.o === undefined || b.o === null || b.o === undefined) return a.i - b.i;
      return a.o < b.o ? -1 : a.o > b.o ? 1 : a.i - b.i;
    })
    .map((x) => x.cls);
}

export function themeValue(name) {
  const ds = system();
  try {
    return ds.theme.get([name]) ?? undefined;
  } catch {
    return undefined;
  }
}
export const initialValue = (name) => INITIAL.get(name);

/** Resolve var()s against element declarations, document tokens, @property initials and the theme. */
export function resolveValue(
  value,
  { custom = new Map(), tokenVars = new Map(), missing = [] } = {},
) {
  const lookup = (name) => {
    if (custom.has(name)) return custom.get(name);
    if (tokenVars.has(name)) return tokenVars.get(name);
    const theme = themeValue(name);
    if (theme !== undefined) return theme;
    return INITIAL.get(name);
  };
  return substituteVars(value, lookup, missing);
}

// ---------------------------------------------------------------------------------------------
// Reverse lookups for the serializer

let reverse = null;
function reverseMaps() {
  if (reverse) return reverse;
  const ds = system();
  const colors = new Map(),
    fontSizes = new Map(),
    radii = new Map(),
    shadows = new Map(),
    weights = new Map(),
    tracking = new Map(),
    leading = new Map(),
    containers = new Map();
  const sizeLineHeights = new Map();
  const resolve = (value) => resolveValue(value);
  for (const [key, entry] of ds.theme.entries()) {
    const value = resolve(entry.value);
    if (value === null) continue;
    let m;
    if ((m = key.match(/^--color-(.+)$/))) {
      const hex = cssColorToHex(value);
      if (hex && !colors.has(hex)) colors.set(hex, m[1]);
    } else if ((m = key.match(/^--text-([a-z0-9]+)$/))) {
      const len = lengthOf(value);
      if (len?.px !== undefined) fontSizes.set(len.px, m[1]);
    } else if ((m = key.match(/^--text-([a-z0-9]+)--line-height$/))) {
      const len = lengthOf(value);
      if (len?.n !== undefined) sizeLineHeights.set(m[1], len.n);
    } else if ((m = key.match(/^--radius-(.+)$/))) {
      const len = lengthOf(value);
      if (len?.px !== undefined && !radii.has(len.px)) radii.set(len.px, m[1]);
    } else if ((m = key.match(/^--shadow-(.+)$/))) shadows.set(normalizeColorsIn(value), m[1]);
    else if ((m = key.match(/^--font-weight-(.+)$/))) weights.set(String(value).trim(), m[1]);
    else if ((m = key.match(/^--tracking-(.+)$/))) {
      const em = String(value)
        .trim()
        .match(/^(-?[\d.]+)em$/);
      if (em) tracking.set(Number(em[1]), m[1]);
    } else if ((m = key.match(/^--leading-(.+)$/))) {
      const n = Number(value);
      if (Number.isFinite(n)) leading.set(n, m[1]);
    } else if ((m = key.match(/^--container-(.+)$/))) {
      const len = lengthOf(value);
      if (len?.px !== undefined) containers.set(len.px, m[1]);
    }
  }
  reverse = {
    colors,
    fontSizes,
    sizeLineHeights,
    radii,
    shadows,
    weights,
    tracking,
    leading,
    containers,
  };
  return reverse;
}

const near = (map, value, eps = 0.01) => {
  for (const [k, v] of map) if (Math.abs(k - value) < eps) return v;
  return null;
};
export const paletteName = (hex) => reverseMaps().colors.get(String(hex).toLowerCase()) ?? null;
export const fontSizeName = (px) => near(reverseMaps().fontSizes, px);
export const fontSizeLineHeight = (name) => reverseMaps().sizeLineHeights.get(name);
export const radiusName = (px) => near(reverseMaps().radii, px);
export const shadowName = (value) => reverseMaps().shadows.get(normalizeColorsIn(value)) ?? null;
export const weightName = (value) => reverseMaps().weights.get(String(value)) ?? null;
export const trackingName = (em) => near(reverseMaps().tracking, em, 0.0005);
export const leadingName = (n) => near(reverseMaps().leading, n, 0.0005);
export const containerName = (px) => near(reverseMaps().containers, px);
