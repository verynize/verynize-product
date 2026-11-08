// Web fonts for designs: resolve family names to Fontsource ids, download latin woff2 files into an
// on-disk cache, and emit @font-face CSS (data: URLs for desktop/render.cjs, whose CSP is `font-src data:`).
// Inter ships with the app (@fontsource/inter). Network is injectable (`fetch` option) and never throws.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const FONTSOURCE_API = "https://api.fontsource.org/v1/fonts/";
const MAX_FONT_BYTES = 2 * 1024 * 1024;
const MAX_EMBED_BYTES = 12 * 1024 * 1024; // render.cjs caps HTML at 20 MB
const TIMEOUT_MS = 15000;

export function defaultFontCacheDir() {
  return (
    process.env.VERYNIZE_FONT_CACHE ||
    path.join(os.homedir(), "Library", "Application Support", "Verynize", "font-cache")
  );
}

export const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
  "-apple-system",
  "blinkmacsystemfont",
  "inherit",
  "initial",
  "unset",
  "revert",
]);
// Installed on macOS / standard web-safe stacks: rendered by the system, never fetched.
export const SYSTEM_FONTS = new Set([
  "arial",
  "helvetica",
  "helvetica neue",
  "georgia",
  "times",
  "times new roman",
  "courier",
  "courier new",
  "verdana",
  "tahoma",
  "trebuchet ms",
  "menlo",
  "monaco",
  "sf pro",
  "sf pro text",
  "sf pro display",
  "sf mono",
  "new york",
  "avenir",
  "avenir next",
  "futura",
  "gill sans",
  "optima",
  "palatino",
  "baskerville",
  "didot",
  "american typewriter",
  "segoe ui",
  "apple color emoji",
]);

// Popular Google Fonts families (all on Fontsource) so availability checks work offline.
export const POPULAR_FONTS = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Source Sans 3",
  "Raleway",
  "Nunito",
  "Nunito Sans",
  "Ubuntu",
  "Rubik",
  "Work Sans",
  "Noto Sans",
  "Noto Serif",
  "Playfair Display",
  "Merriweather",
  "Lora",
  "PT Sans",
  "PT Serif",
  "Oswald",
  "Mulish",
  "DM Sans",
  "DM Serif Display",
  "DM Serif Text",
  "DM Mono",
  "Manrope",
  "Space Grotesk",
  "Space Mono",
  "IBM Plex Sans",
  "IBM Plex Serif",
  "IBM Plex Mono",
  "JetBrains Mono",
  "Fira Sans",
  "Fira Code",
  "Fira Mono",
  "Source Serif 4",
  "Source Code Pro",
  "Libre Baskerville",
  "Libre Franklin",
  "Crimson Text",
  "Crimson Pro",
  "EB Garamond",
  "Cormorant",
  "Cormorant Garamond",
  "Bitter",
  "Arvo",
  "Barlow",
  "Barlow Condensed",
  "Barlow Semi Condensed",
  "Heebo",
  "Karla",
  "Quicksand",
  "Josefin Sans",
  "Cabin",
  "Archivo",
  "Archivo Black",
  "Archivo Narrow",
  "Outfit",
  "Plus Jakarta Sans",
  "Lexend",
  "Sora",
  "Urbanist",
  "Figtree",
  "Onest",
  "Geologica",
  "Red Hat Display",
  "Red Hat Text",
  "Red Hat Mono",
  "Epilogue",
  "Syne",
  "Unbounded",
  "Bricolage Grotesque",
  "Instrument Sans",
  "Instrument Serif",
  "Fraunces",
  "Newsreader",
  "Literata",
  "Spectral",
  "Alegreya",
  "Alegreya Sans",
  "Cardo",
  "Zilla Slab",
  "Roboto Slab",
  "Roboto Mono",
  "Roboto Condensed",
  "Roboto Flex",
  "Roboto Serif",
  "Inconsolata",
  "Anton",
  "Bebas Neue",
  "Abril Fatface",
  "Alfa Slab One",
  "Righteous",
  "Lobster",
  "Pacifico",
  "Dancing Script",
  "Caveat",
  "Shadows Into Light",
  "Permanent Marker",
  "Satisfy",
  "Great Vibes",
  "Kalam",
  "Comfortaa",
  "Varela Round",
  "Exo 2",
  "Titillium Web",
  "Hind",
  "Kanit",
  "Prompt",
  "Sarabun",
  "Assistant",
  "Overpass",
  "Overpass Mono",
  "Public Sans",
  "Albert Sans",
  "Be Vietnam Pro",
  "Schibsted Grotesk",
  "Hanken Grotesk",
  "Familjen Grotesk",
  "Darker Grotesque",
  "Chivo",
  "Chivo Mono",
  "Space Grotesk",
  "Martian Mono",
  "Geist",
  "Geist Mono",
  "Atkinson Hyperlegible",
  "Lexend Deca",
  "Inter Tight",
  "Gloock",
  "Young Serif",
  "Bodoni Moda",
  "Playfair",
  "Prata",
  "Marcellus",
  "Cinzel",
  "Tenor Sans",
  "Josefin Slab",
  "Sometype Mono",
  "Silkscreen",
  "Press Start 2P",
  "VT323",
];
const POPULAR_BY_ID = new Map(POPULAR_FONTS.map((f) => [fontId(f), f]));

/** "Playfair_Display" / "'Playfair Display'" -> "playfair-display" */
export function fontId(family) {
  return String(family || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
const cleanFamily = (f) =>
  String(f || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/_/g, " ")
    .trim();
/** First entries of a CSS font-family stack, unquoted. */
export function splitFontStack(value) {
  return String(value || "")
    .split(",")
    .map(cleanFamily)
    .filter(Boolean)
    .slice(0, 8);
}
export function familyKind(family) {
  const f = cleanFamily(family).toLowerCase();
  if (!f) return "generic";
  if (GENERIC_FAMILIES.has(f)) return "generic";
  if (SYSTEM_FONTS.has(f)) return "system";
  if (fontId(f) === "inter") return "bundled";
  return "web";
}
export const isGenericFamily = (family) =>
  familyKind(family) !== "web" && familyKind(family) !== "bundled";

function safeFetch(fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  return async (url, opts = {}) => {
    if (!String(url).startsWith("https://")) throw Error("refusing non-https URL");
    return f(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS), ...opts });
  };
}

async function writeAtomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

const metaCache = new Map();
async function fontMeta(id, { fetch, cacheDir, offline }) {
  const file = path.join(cacheDir, "meta", `${id}.json`);
  const key = `${cacheDir}\0${id}`;
  if (metaCache.has(key)) return metaCache.get(key);
  try {
    const meta = JSON.parse(await readFile(file, "utf8"));
    metaCache.set(key, { meta });
    return { meta };
  } catch {}
  if (offline) return { error: "offline" };
  try {
    const res = await safeFetch(fetch)(FONTSOURCE_API + encodeURIComponent(id), {
      headers: { accept: "application/json" },
    });
    if (res.status === 404) {
      const r = { notFound: true };
      metaCache.set(key, r);
      return r;
    }
    if (!res.ok) return { error: `Fontsource API HTTP ${res.status}` };
    const meta = await res.json();
    if (!meta || meta.id !== id || typeof meta.family !== "string" || !meta.variants)
      return { error: "unexpected Fontsource response" };
    const slim = {
      id: meta.id,
      family: meta.family,
      category: meta.category,
      weights: meta.weights,
      styles: meta.styles,
      defSubset: meta.defSubset,
      license: meta.license?.type,
      variants: meta.variants,
    };
    await writeAtomic(file, JSON.stringify(slim)).catch(() => {});
    metaCache.set(key, { meta: slim });
    return { meta: slim };
  } catch (error) {
    return {
      error: `network: ${error?.name === "TimeoutError" ? "timed out" : error?.message || error}`,
    };
  }
}

/**
 * Resolve a family name. -> {family, id, kind:'generic'|'system'|'bundled'|'web', available, reason?, offline?, weights?, styles?}
 * Never throws. With {offline:true} only the cache and the bundled popular list are consulted.
 */
export async function resolveFontFamily(
  family,
  { fetch, cacheDir = defaultFontCacheDir(), offline = false } = {},
) {
  const name = cleanFamily(family);
  const kind = familyKind(name);
  if (kind === "generic" || kind === "system")
    return { family: name, id: null, kind, available: true };
  const id = fontId(name);
  if (kind === "bundled")
    return {
      family: "Inter",
      id,
      kind,
      available: true,
      weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
      styles: ["normal", "italic"],
    };
  if (!id) return { family: name, id: null, kind, available: false, reason: "empty family name" };
  const r = await fontMeta(id, { fetch, cacheDir, offline });
  if (r.meta)
    return {
      family: r.meta.family,
      id,
      kind,
      available: true,
      weights: r.meta.weights,
      styles: r.meta.styles,
      category: r.meta.category,
    };
  if (r.notFound)
    return {
      family: name,
      id,
      kind,
      available: false,
      reason: `"${name}" is not a Google/Fontsource font`,
    };
  if (POPULAR_BY_ID.has(id))
    return {
      family: POPULAR_BY_ID.get(id),
      id,
      kind,
      available: true,
      offline: true,
      reason: r.error,
    };
  return { family: name, id, kind, available: false, reason: r.error };
}

const nearestWeight = (weights, w) =>
  [...weights].sort((a, b) => Math.abs(a - w) - Math.abs(b - w) || b - a)[0];
const interFile = (weight, style) => {
  const dir = path.join(
    path.dirname(createRequire(import.meta.url).resolve("@fontsource/inter/package.json")),
    "files",
  );
  return path.join(dir, `inter-latin-${weight}-${style}.woff2`);
};
const cachedFile = (cacheDir, id, weight, style, subset) =>
  path.join(cacheDir, "files", `${id}-${subset}-${weight}-${style}.woff2`);

/** Normalize [string | {family, weights?, styles?}] + default weights into [{family, weights, styles}]. */
function normalizeRequests(families, weights, styles) {
  const list = families instanceof Map ? [...families.values()] : [].concat(families || []);
  const byId = new Map();
  for (const item of list) {
    const entry = typeof item === "string" ? { family: item } : item;
    const raw = String(entry?.family || "")
      .split(",")
      .map((f) =>
        f
          .trim()
          .replace(/^['"]|['"]$/g, "")
          .trim(),
      )
      .filter(Boolean)
      .slice(0, 8);
    for (const original of raw) {
      const fam = cleanFamily(original);
      const kind = familyKind(fam);
      const key = kind === "web" || kind === "bundled" ? fontId(fam) : fam.toLowerCase();
      const prev = byId.get(key) || {
        family: fam,
        aliases: new Set(),
        weights: new Set(),
        styles: new Set(),
        kind,
      };
      prev.aliases.add(fam);
      prev.aliases.add(original); // keep "Playfair_Display" spellings too
      for (const w of [].concat(entry.weights ?? weights ?? [400])) {
        const n = Number(w);
        if (Number.isFinite(n) && n >= 1 && n <= 1000) prev.weights.add(n);
      }
      for (const s of [].concat(entry.styles ?? styles ?? ["normal"]))
        if (s === "normal" || s === "italic") prev.styles.add(s);
      byId.set(key, prev);
      if (kind === "web" || kind === "bundled") break; // first loadable family in a stack is the one that matters
    }
  }
  return [...byId.values()];
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

/**
 * Download latin woff2 files for the given families into the cache.
 * families: ["Playfair Display", ...] or extractFontFamilies() output; weights default [400]; opts.styles default ['normal'].
 * -> {loaded:[{family, id, weight, style, file, source}], missing:[{family, weight?, style?, reason}], skipped:[{family, kind}]}
 */
export async function ensureFonts(
  families,
  weights,
  { fetch, cacheDir = defaultFontCacheDir(), styles, offline = false } = {},
) {
  const loaded = [],
    missing = [],
    skipped = [];
  const tasks = [];
  for (const req of normalizeRequests(families, weights, styles)) {
    if (req.kind === "generic" || req.kind === "system") {
      skipped.push({ family: req.family, kind: req.kind });
      continue;
    }
    const info = await resolveFontFamily(req.family, { fetch, cacheDir, offline });
    if (!info.available) {
      missing.push({ family: req.family, reason: info.reason });
      continue;
    }
    if (info.kind === "bundled") {
      for (const w of req.weights)
        for (const s of req.styles) {
          const weight = nearestWeight(info.weights, w);
          const file = interFile(weight, s);
          if (existsSync(file))
            loaded.push({
              family: "Inter",
              id: "inter",
              weight,
              style: s,
              requested: w,
              file,
              source: "bundled",
            });
          else
            missing.push({
              family: "Inter",
              weight: w,
              style: s,
              reason: "bundled @fontsource/inter file missing",
            });
        }
      continue;
    }
    const meta = (await fontMeta(info.id, { fetch, cacheDir, offline })).meta;
    if (!meta) {
      missing.push({
        family: req.family,
        reason: info.reason || "font metadata unavailable (offline)",
      });
      continue;
    }
    const seen = new Set();
    for (const w of req.weights)
      for (const s of req.styles) {
        const weight = nearestWeight(meta.weights || [400], w);
        if (!(meta.styles || []).includes(s)) {
          missing.push({
            family: meta.family,
            weight: w,
            style: s,
            reason: `${s} style not available`,
          });
          continue;
        }
        if (seen.has(weight + s)) continue;
        seen.add(weight + s);
        const variant = meta.variants?.[weight]?.[s];
        const subset = variant?.latin ? "latin" : meta.defSubset;
        const url = variant?.[subset]?.url?.woff2;
        if (!url) {
          missing.push({
            family: meta.family,
            weight,
            style: s,
            reason: "no woff2 file for this variant",
          });
          continue;
        }
        tasks.push({
          family: meta.family,
          id: meta.id,
          weight,
          style: s,
          requested: w,
          url,
          subset,
        });
      }
  }
  await mapLimit(tasks, 4, async (t) => {
    const file = cachedFile(cacheDir, t.id, t.weight, t.style, t.subset);
    const entry = {
      family: t.family,
      id: t.id,
      weight: t.weight,
      style: t.style,
      requested: t.requested,
      file,
    };
    if (existsSync(file)) {
      loaded.push({ ...entry, source: "cache" });
      return;
    }
    if (offline) {
      missing.push({
        family: t.family,
        weight: t.weight,
        style: t.style,
        reason: "offline and not cached",
      });
      return;
    }
    try {
      const res = await safeFetch(fetch)(t.url);
      if (!res.ok) throw Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_FONT_BYTES) throw Error("font file too large");
      if (buf.subarray(0, 4).toString("latin1") !== "wOF2") throw Error("not a woff2 file");
      await writeAtomic(file, buf);
      loaded.push({ ...entry, source: "download" });
    } catch (error) {
      missing.push({
        family: t.family,
        weight: t.weight,
        style: t.style,
        reason: `download failed: ${error?.name === "TimeoutError" ? "timed out" : error?.message || error}`,
      });
    }
  });
  return { loaded, missing, skipped };
}

const cssString = (s) => `'${String(s).replace(/[\\'"\n\r<>]/g, "")}'`;

/**
 * @font-face CSS for fonts already available (bundled Inter or cached downloads). Call ensureFonts first.
 * embed:true -> data:font/woff2;base64 URLs (render.cjs CSP), false -> file:// URLs. Never fetches.
 * -> {css, faces:[{family, weight, style, bytes}], missing:[{family, reason}]}
 */
export async function fontFaceCss(
  families,
  {
    embed = true,
    cacheDir = defaultFontCacheDir(),
    weights,
    styles,
    maxBytes = MAX_EMBED_BYTES,
  } = {},
) {
  const faces = [],
    missing = [],
    rules = [];
  let total = 0;
  const result = await ensureFonts(families, weights, { cacheDir, styles, offline: true });
  missing.push(...result.missing);
  const seen = new Set();
  for (const f of result.loaded) {
    const key = `${f.id}|${f.weight}|${f.style}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let src;
    try {
      if (embed) {
        const buf = await readFile(f.file);
        if (total + buf.length > maxBytes) {
          missing.push({
            family: f.family,
            weight: f.weight,
            style: f.style,
            reason: "embed size budget exceeded",
          });
          continue;
        }
        total += buf.length;
        src = `url(data:font/woff2;base64,${buf.toString("base64")}) format('woff2')`;
      } else {
        await stat(f.file);
        src = `url(${pathToFileURL(f.file).href}) format('woff2')`;
      }
    } catch {
      missing.push({
        family: f.family,
        weight: f.weight,
        style: f.style,
        reason: "font file unreadable",
      });
      continue;
    }
    // Emit under the canonical family and every spelling the document used (e.g. "playfair display").
    const names = new Set([f.family]);
    for (const req of normalizeRequests(families, weights, styles))
      if (fontId(req.family) === f.id) for (const a of req.aliases) names.add(a);
    for (const name of names)
      rules.push(
        `@font-face{font-family:${cssString(name)};font-style:${f.style};font-weight:${f.weight};font-display:block;src:${src};}`,
      );
    faces.push({ family: f.family, weight: f.weight, style: f.style });
  }
  return { css: rules.join("\n"), faces, missing };
}

/**
 * Families used by a document's nodes (fontFamily/fontWeight, bold/italic text runs, run-level fontFamily/fontWeight if stored).
 * -> [{family, weights:[...], styles:[...]}] (web/bundled fonts only first-in-stack; generics included for completeness).
 */
export function extractFontFamilies(document) {
  const map = new Map();
  const add = (familyValue, weight, style) => {
    const stack = splitFontStack(familyValue);
    const fam =
      stack.find((f) => familyKind(f) === "web" || familyKind(f) === "bundled") || stack[0];
    if (!fam) return;
    const kind = familyKind(fam);
    const key = kind === "web" || kind === "bundled" ? fontId(fam) : fam.toLowerCase();
    const e = map.get(key) || { family: fam, weights: new Set(), styles: new Set() };
    const w = Number(weight === "bold" ? 700 : weight === "normal" ? 400 : weight);
    e.weights.add(Number.isFinite(w) && w > 0 ? w : 400);
    e.styles.add(style === "italic" ? "italic" : "normal");
    map.set(key, e);
  };
  for (const page of document?.pages || [])
    for (const n of page?.nodes || []) {
      if (!n || (n.type !== "text" && !n.text)) continue;
      const family = n.fontFamily || "system-ui";
      const style = n.fontStyle === "italic" || n.italic ? "italic" : "normal";
      add(family, n.fontWeight ?? 400, style);
      for (const r of Array.isArray(n.textRuns) ? n.textRuns : []) {
        add(
          r.fontFamily || family,
          r.fontWeight ?? (r.bold ? 700 : (n.fontWeight ?? 400)),
          r.italic ? "italic" : style,
        );
      }
    }
  return [...map.values()].map((e) => ({
    family: e.family,
    weights: [...e.weights].sort((a, b) => a - b),
    styles: [...e.styles].sort(),
  }));
}

/** Families referenced by a document that are not loadable (for a missingFonts gate). Offline unless fetch is allowed. */
export async function missingFonts(document, opts = {}) {
  const fams = extractFontFamilies(document).filter((f) => familyKind(f.family) === "web");
  const out = [];
  for (const f of fams) {
    const r = await resolveFontFamily(f.family, opts);
    if (!r.available) out.push({ family: f.family, reason: r.reason });
  }
  return out;
}

export async function listCachedFonts({ cacheDir = defaultFontCacheDir() } = {}) {
  try {
    return (await readdir(path.join(cacheDir, "files"))).filter((f) => f.endsWith(".woff2"));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------------------------
// Font catalog for the inspector's font family picker: every Fontsource family (cached on disk for a
// week), the bundled Inter and the macOS/web-safe system fonts. Offline or on network failure the cached
// list is used; with no cache, the bundled popular list (weights unknown → assume 400/700) is returned.
export const FONTSOURCE_LIST = "https://api.fontsource.org/v1/fonts";
const CATALOG_MAX_AGE = 7 * 24 * 3600 * 1000;
const SYSTEM_CATALOG = [
  ["system-ui", "sans-serif"],
  ["Arial", "sans-serif"],
  ["Helvetica", "sans-serif"],
  ["Helvetica Neue", "sans-serif"],
  ["Avenir", "sans-serif"],
  ["Avenir Next", "sans-serif"],
  ["Futura", "sans-serif"],
  ["Gill Sans", "sans-serif"],
  ["Optima", "sans-serif"],
  ["Verdana", "sans-serif"],
  ["Tahoma", "sans-serif"],
  ["Trebuchet MS", "sans-serif"],
  ["Georgia", "serif"],
  ["Times New Roman", "serif"],
  ["Palatino", "serif"],
  ["Baskerville", "serif"],
  ["Didot", "serif"],
  ["American Typewriter", "serif"],
  ["Courier New", "monospace"],
  ["Menlo", "monospace"],
  ["Monaco", "monospace"],
  ["sans-serif", "sans-serif"],
  ["serif", "serif"],
  ["monospace", "monospace"],
];
const ALL_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const slimEntry = (f) => ({
  family: f.family,
  id: f.id,
  category: f.category || "other",
  weights: (f.weights || []).filter(Number.isFinite),
  styles: (f.styles || ["normal"]).filter((s) => s === "normal" || s === "italic"),
  kind: "web",
});

/**
 * -> {fonts:[{family, id, kind:'bundled'|'system'|'generic'|'web', category, weights, styles}], source:'network'|'cache'|'bundled'}
 * Never throws. Inter first, then system fonts, then the catalog sorted by family.
 */
export async function fontCatalog({
  fetch,
  cacheDir = defaultFontCacheDir(),
  offline = false,
  maxAge = CATALOG_MAX_AGE,
} = {}) {
  const file = path.join(cacheDir, "meta", "catalog.json");
  let list = null,
    source = "bundled";
  try {
    const st = await stat(file);
    const cached = JSON.parse(await readFile(file, "utf8"));
    if (Array.isArray(cached)) {
      list = cached;
      source = "cache";
    }
    if (list && Date.now() - st.mtimeMs < maxAge) offline = true;
  } catch {}
  if (!offline) {
    try {
      const res = await safeFetch(fetch)(FONTSOURCE_LIST, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw Error("unexpected Fontsource response");
      const slim = data
        .filter(
          (f) =>
            f && typeof f.family === "string" && typeof f.id === "string" && f.family.length <= 120,
        )
        .slice(0, 5000)
        .map(slimEntry);
      if (slim.length) {
        list = slim;
        source = "network";
        await writeAtomic(file, JSON.stringify(slim)).catch(() => {});
      }
    } catch {}
  }
  if (!list)
    list = POPULAR_FONTS.map((family) => ({
      family,
      id: fontId(family),
      category: "other",
      weights: [400, 700],
      styles: ["normal"],
      kind: "web",
    }));
  const fonts = [
    {
      family: "Inter",
      id: "inter",
      kind: "bundled",
      category: "sans-serif",
      weights: ALL_WEIGHTS,
      styles: ["normal", "italic"],
    },
  ];
  for (const [family, category] of SYSTEM_CATALOG)
    fonts.push({
      family,
      id: null,
      kind: familyKind(family),
      category,
      weights: GENERIC_FAMILIES.has(family.toLowerCase()) ? ALL_WEIGHTS : [400, 700],
      styles: ["normal", "italic"],
    });
  const seen = new Set(fonts.map((f) => f.family.toLowerCase()));
  for (const f of [...list].sort((a, b) => a.family.localeCompare(b.family))) {
    if (seen.has(f.family.toLowerCase())) continue;
    seen.add(f.family.toLowerCase());
    fonts.push({ ...f, kind: "web", weights: f.weights?.length ? f.weights : [400] });
  }
  return { fonts, source };
}
