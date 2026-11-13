// Offline icon library for agents: Iconify JSON sets (lucide, ph, tabler) bundled as npm packages.
// searchIcons -> ranked names; resolveIcon -> SVG (currentColor); iconToNodeImage -> data:image/svg+xml
// URL with an explicit color, because canvas image nodes render <img> and do not inherit CSS color.
// sanitizeSvg is shared with images.mjs.
import { createRequire } from "node:module";
import { getIconData, iconToSVG, iconToHTML, replaceIDs } from "@iconify/utils";

export const ICON_SETS = {
  lucide: { package: "@iconify-json/lucide", title: "Lucide", style: "stroke" },
  ph: { package: "@iconify-json/ph", title: "Phosphor", style: "fill" },
  tabler: { package: "@iconify-json/tabler", title: "Tabler", style: "stroke" },
};
export const DEFAULT_ICON_SET = "lucide";
const loaded = new Map();
function iconSet(prefix) {
  if (!ICON_SETS[prefix]) return null;
  if (!loaded.has(prefix))
    loaded.set(prefix, createRequire(import.meta.url)(`${ICON_SETS[prefix].package}/icons.json`));
  return loaded.get(prefix);
}
/** Hosts without a file system (the collaboration Worker) hand over the parsed icon sets: {lucide, ph, tabler}. */
export function provideIconSets(sets) {
  for (const [prefix, set] of Object.entries(sets || {}))
    if (ICON_SETS[prefix] && set?.icons) loaded.set(prefix, set);
}

export function listIconSets() {
  return Object.entries(ICON_SETS).map(([prefix, meta]) => {
    const set = iconSet(prefix);
    return {
      prefix,
      title: meta.title,
      style: meta.style,
      total: Object.keys(set.icons).length,
      aliases: Object.keys(set.aliases || {}).length,
    };
  });
}

// ---- search -----------------------------------------------------------------------------------
// Small synonym table so common intents ("close", "settings") find the canonical glyph names.
const SYNONYMS = {
  close: ["x"],
  cancel: ["x"],
  remove: ["x", "trash", "minus"],
  delete: ["trash"],
  bin: ["trash"],
  settings: ["settings", "gear", "cog"],
  gear: ["settings", "cog"],
  user: ["user", "person"],
  person: ["user"],
  profile: ["user", "circle-user"],
  account: ["user"],
  home: ["house", "home"],
  house: ["home"],
  search: ["search", "magnifying-glass"],
  find: ["search"],
  email: ["mail", "envelope"],
  mail: ["envelope"],
  envelope: ["mail"],
  add: ["plus"],
  new: ["plus"],
  edit: ["pencil", "pen", "edit"],
  pencil: ["pen", "edit"],
  menu: ["menu", "list", "hamburger"],
  hamburger: ["menu"],
  cart: ["shopping-cart"],
  basket: ["shopping-basket"],
  like: ["heart", "thumbs-up"],
  favorite: ["heart", "star"],
  notification: ["bell"],
  alert: ["bell", "triangle-alert", "alert-triangle", "warning"],
  warning: ["triangle-alert", "alert-triangle"],
  info: ["info"],
  help: ["circle-help", "help", "question"],
  question: ["help"],
  calendar: ["calendar"],
  date: ["calendar"],
  time: ["clock"],
  clock: ["clock"],
  download: ["download"],
  upload: ["upload"],
  share: ["share"],
  link: ["link"],
  external: ["external-link", "arrow-up-right"],
  chat: ["message", "chat"],
  message: ["message", "chat"],
  comment: ["message"],
  phone: ["phone"],
  call: ["phone"],
  location: ["map-pin"],
  pin: ["map-pin"],
  map: ["map"],
  lock: ["lock"],
  security: ["shield", "lock"],
  logout: ["log-out", "sign-out"],
  login: ["log-in", "sign-in"],
  check: ["check"],
  done: ["check"],
  success: ["check", "circle-check"],
  error: ["circle-x", "x"],
  play: ["play"],
  pause: ["pause"],
  image: ["image"],
  photo: ["image", "camera"],
  picture: ["image"],
  file: ["file"],
  document: ["file"],
  folder: ["folder"],
  chart: ["chart"],
  graph: ["chart"],
  analytics: ["chart", "trending-up"],
  money: ["dollar", "banknote", "currency"],
  payment: ["credit-card"],
  card: ["credit-card"],
  eye: ["eye"],
  view: ["eye"],
  hide: ["eye-off"],
  filter: ["filter", "funnel"],
  sort: ["arrow-up-down", "sort"],
  refresh: ["refresh", "rotate"],
  reload: ["refresh", "rotate"],
  sun: ["sun"],
  light: ["sun"],
  dark: ["moon"],
  moon: ["moon"],
  star: ["star"],
  rating: ["star"],
  team: ["users"],
  people: ["users"],
  group: ["users"],
  copy: ["copy"],
  duplicate: ["copy"],
  sparkle: ["sparkles"],
  ai: ["sparkles", "bot", "brain"],
  github: ["github"],
  twitter: ["twitter", "x"],
  next: ["arrow-right", "chevron-right"],
  back: ["arrow-left", "chevron-left"],
  more: ["ellipsis", "dots", "more"],
};
// ph weight variants and tabler "-filled" are stylistic duplicates; demoted unless asked for.
const VARIANT_RE = { ph: /-(bold|fill|duotone|light|thin)$/, tabler: /-filled$/ };
const words = (s) =>
  String(s)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

function scoreName(name, query, tokens, expansions) {
  if (name === query) return 100;
  const parts = name.split("-");
  let score = 0;
  if (expansions.has(name)) score = Math.max(score, 80);
  if (name.startsWith(query + "-")) score = Math.max(score, 70 - parts.length);
  if (tokens.length && tokens.every((t) => parts.includes(t)))
    score = Math.max(score, 60 - (parts.length - tokens.length) * 3);
  else if (tokens.length && tokens.every((t) => parts.some((p) => p.startsWith(t))))
    score = Math.max(score, 45 - (parts.length - tokens.length) * 2);
  else if (name.includes(query)) score = Math.max(score, 30 - parts.length);
  for (const e of expansions)
    if (score < 50 && parts.includes(e)) score = Math.max(score, 50 - parts.length * 2);
    else if (score < 35 && e.includes("-") && name.includes(e))
      score = Math.max(score, 35 - parts.length);
  return score;
}

/** Search icons by name/alias. Returns [{name:"lucide:arrow-right", set, icon, score, alias?}] best first. */
export function searchIcons(query, { set, limit = 24 } = {}) {
  const tokens = words(query);
  if (!tokens.length) return [];
  const q = tokens.join("-");
  const expansions = new Set(tokens.flatMap((t) => SYNONYMS[t] || []));
  const prefixes = set ? [].concat(set).filter((p) => ICON_SETS[p]) : Object.keys(ICON_SETS);
  const wantsVariant = tokens.some((t) =>
    ["bold", "fill", "filled", "duotone", "light", "thin"].includes(t),
  );
  const results = [];
  prefixes.forEach((prefix, order) => {
    const data = iconSet(prefix);
    const consider = (icon, alias) => {
      let score = scoreName(icon, q, tokens, expansions);
      if (!score) return;
      if (!wantsVariant && VARIANT_RE[prefix]?.test(icon)) score -= 25;
      if (alias) score -= 5;
      if (data.icons[icon]?.hidden) score -= 40;
      if (score > 0)
        results.push({
          name: `${prefix}:${icon}`,
          set: prefix,
          icon,
          score: score - order * 0.1,
          ...(alias ? { alias: true } : {}),
        });
    };
    for (const icon of Object.keys(data.icons)) consider(icon, false);
    for (const icon of Object.keys(data.aliases || {})) consider(icon, true);
  });
  results.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
  return results.slice(0, Math.max(1, Math.min(200, limit)));
}

// ---- resolve ----------------------------------------------------------------------------------
const kebab = (s) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
const digitSplit = (s) => s.replace(/([a-z])(\d)/g, "$1-$2").replace(/(\d)([a-z])/g, "$1-$2");
// React package conventions: lucide-react (ArrowRight, ArrowRightIcon, LucideArrowRight), react-icons (LuX, PiX, TbX),
// @tabler/icons-react (IconArrowRight), @phosphor-icons/react (ArrowRight + weight prop, handled by caller).
const COMPONENT_PREFIXES = [
  ["Lucide", "lucide"],
  ["Lu", "lucide"],
  ["Pi", "ph"],
  ["Ph", "ph"],
  ["Tb", "tabler"],
  ["Icon", "tabler"],
];

function candidates(name) {
  const raw = String(name || "").trim();
  if (!raw || raw.length > 120) return [];
  const colon = raw.match(/^([a-z0-9-]+):([a-z0-9-]+)$/i);
  if (colon)
    return [
      [colon[1].toLowerCase(), colon[2].toLowerCase()],
      [colon[1].toLowerCase(), digitSplit(colon[2].toLowerCase())],
    ];
  if (/^[a-z0-9-]+$/.test(raw))
    return [DEFAULT_ICON_SET, "tabler", "ph"].flatMap((p) => [
      [p, raw],
      [p, digitSplit(raw)],
    ]);
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(raw)) return [];
  const out = [];
  const push = (prefix, pascal) => {
    if (!pascal) return;
    const k = kebab(pascal);
    out.push([prefix, digitSplit(k)], [prefix, k]);
  };
  for (const [pre, prefix] of COMPONENT_PREFIXES) {
    if (raw.startsWith(pre) && /^[A-Z0-9]/.test(raw.slice(pre.length)))
      push(prefix, raw.slice(pre.length).replace(/Icon$/, ""));
  }
  const base = raw.replace(/Icon$/, "");
  for (const prefix of [DEFAULT_ICON_SET, "tabler", "ph"]) push(prefix, base);
  return out;
}

const svgString = (body, attributes) => iconToHTML(replaceIDs(body), attributes);

/** Resolve "set:name", bare kebab name or a React component name. -> {name, set, icon, svg, body, width, height, viewBox} | null */
export function resolveIcon(name) {
  for (const [prefix, icon] of candidates(name)) {
    const set = iconSet(prefix);
    if (!set) continue;
    const data = getIconData(set, icon);
    if (!data) continue;
    const render = iconToSVG(data, { height: "auto" });
    const body = sanitizeSvgBody(render.body);
    return {
      name: `${prefix}:${icon}`,
      set: prefix,
      icon,
      body,
      svg: svgString(body, render.attributes),
      width: Number(render.attributes.width),
      height: Number(render.attributes.height),
      viewBox: render.attributes.viewBox,
    };
  }
  return null;
}

// ---- node image -------------------------------------------------------------------------------
const COLOR_RE =
  /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(rgb|hsl)a?\(\s*[\d.]+%?\s*(,|\s)\s*[\d.]+%?\s*(,|\s)\s*[\d.]+%?\s*([,/]\s*[\d.]+%?\s*)?\)|[a-z]{3,20})$/i;
export const isSafeColor = (c) =>
  typeof c === "string" &&
  COLOR_RE.test(c.trim()) &&
  !/^(currentcolor|inherit|initial|unset|revert)$/i.test(c.trim());

/**
 * data:image/svg+xml;base64 URL for an image node: explicit color instead of currentColor, explicit size,
 * optional stroke width (stroke-based sets). Returns null for unknown icons or unsafe colors.
 */
export function iconToNodeImage(name, { size = 24, color = "#25252e", strokeWidth } = {}) {
  const icon = resolveIcon(name);
  if (!icon || !isSafeColor(color)) return null;
  const px = Math.min(2048, Math.max(1, Number(size) || 24));
  let body = icon.body.replace(/currentColor/g, color.trim().replace(/"/g, ""));
  if (strokeWidth !== undefined) {
    const sw = Number(strokeWidth);
    if (Number.isFinite(sw) && sw > 0 && sw <= 32)
      body = body.replace(/stroke-width="[\d.]+"/g, `stroke-width="${sw}"`);
  }
  const ratio = icon.width / icon.height || 1;
  const attrs = {
    width: String(ratio >= 1 ? px : Math.round(px * ratio)),
    height: String(ratio >= 1 ? Math.round(px / ratio) : px),
    viewBox: icon.viewBox,
  };
  const svg = sanitizeSvg(svgString(body, attrs));
  return svg ? "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64") : null;
}

// ---- sanitizer --------------------------------------------------------------------------------
// Conservative regex sanitizer. SVGs end up in <img src="data:..."> where scripts never run, but they
// are also exported and may be inlined elsewhere, so active content and external references are removed.
const DANGEROUS_ELEMENTS = [
  "script",
  "foreignObject",
  "iframe",
  "object",
  "embed",
  "audio",
  "video",
  "canvas",
  "handler",
  "listener",
  "animate",
  "set",
  "animateMotion",
  "animateTransform",
  "discard",
];
export function sanitizeSvgBody(body) {
  let s = String(body);
  s = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<!(DOCTYPE|ENTITY)[\s\S]*?>/gi, "")
    .replace(/<\?[\s\S]*?\?>/g, "");
  for (const tag of DANGEROUS_ELEMENTS) {
    s = s
      .replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "")
      .replace(new RegExp(`<${tag}\\b[^>]*>`, "gi"), "")
      .replace(new RegExp(`<\\/${tag}\\s*>`, "gi"), "");
  }
  s = s.replace(/\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // href / xlink:href: allow only same-document fragments and raster data URLs.
  s = s.replace(
    /\s((?:xlink:)?href|src)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (m, _attr, _v, a, b, c) => {
      const v = (a ?? b ?? c ?? "").trim();
      return /^#[\w.:-]*$/.test(v) ||
        /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]*$/i.test(v)
        ? m
        : "";
    },
  );
  // url(...) in attributes/styles: only url(#id).
  s = s.replace(/url\(\s*(?!['"]?#)[^)]*\)/gi, "none");
  s = s.replace(/@import[^;]*;?/gi, "").replace(/javascript:|vbscript:|expression\s*\(/gi, "");
  return s;
}

/** Sanitize a full SVG document string; null if it is not an <svg> or exceeds maxBytes. */
export function sanitizeSvg(svg, { maxBytes = 2 * 1024 * 1024 } = {}) {
  if (typeof svg !== "string" || Buffer.byteLength(svg) > maxBytes) return null;
  const s = sanitizeSvgBody(svg.replace(/^﻿/, "")).trim();
  const match = s.match(/<svg\b[\s\S]*<\/svg>/i);
  return match ? match[0] : null;
}
