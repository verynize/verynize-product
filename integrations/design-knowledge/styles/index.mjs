// Registry of named design styles. Original to Verynize.
// Each style is one module, styles/<slug>.mjs; see README.md for the contract.

import academia from "./academia.mjs";
import artDeco from "./art-deco.mjs";
import bauhaus from "./bauhaus.mjs";
import boldTypography from "./bold-typography.mjs";
import botanical from "./botanical.mjs";
import claymorphism from "./claymorphism.mjs";
import cyberpunk from "./cyberpunk.mjs";
import enterprise from "./enterprise.mjs";
import flatDesign from "./flat-design.mjs";
import glassmorphism from "./glassmorphism.mjs";
import industrial from "./industrial.mjs";
import kinetic from "./kinetic.mjs";
import luxury from "./luxury.mjs";
import materialDesign from "./material-design.mjs";
import maximalism from "./maximalism.mjs";
import minimalDark from "./minimal-dark.mjs";
import modernDark from "./modern-dark.mjs";
import monochrome from "./monochrome.mjs";
import neoBrutalism from "./neo-brutalism.mjs";
import neumorphism from "./neumorphism.mjs";
import newsprint from "./newsprint.mjs";
import organic from "./organic.mjs";
import playfulGeometric from "./playful-geometric.mjs";
import professional from "./professional.mjs";
import retro from "./retro.mjs";
import saas from "./saas.mjs";
import sketch from "./sketch.mjs";
import swissMinimalist from "./swiss-minimalist.mjs";
import terminal from "./terminal.mjs";
import vaporwave from "./vaporwave.mjs";
import web3 from "./web3.mjs";

export const styles = [
  academia,
  artDeco,
  bauhaus,
  boldTypography,
  botanical,
  claymorphism,
  cyberpunk,
  enterprise,
  flatDesign,
  glassmorphism,
  industrial,
  kinetic,
  luxury,
  materialDesign,
  maximalism,
  minimalDark,
  modernDark,
  monochrome,
  neoBrutalism,
  neumorphism,
  newsprint,
  organic,
  playfulGeometric,
  professional,
  retro,
  saas,
  sketch,
  swissMinimalist,
  terminal,
  vaporwave,
  web3,
];

export const styleIds = styles.map((s) => s.id);

const byId = new Map(styles.map((s) => [s.id, s]));
const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-");

export function listStyles() {
  return styles.map(({ id, name, summary, density, typography }) => ({
    id,
    name,
    summary,
    density,
    fonts: `${typography.display} / ${typography.body}`,
  }));
}

/** Look up a style by id, display name, or id written with spaces/underscores. */
export function getStyle(idOrName) {
  if (!idOrName) return null;
  const raw = String(idOrName).toLowerCase().trim();
  return (
    byId.get(raw) ||
    byId.get(normalize(raw)) ||
    styles.find((s) => s.name.toLowerCase() === raw || normalize(s.name) === normalize(raw)) ||
    null
  );
}

const STOP = new Set([
  "page",
  "pages",
  "landing",
  "site",
  "website",
  "home",
  "view",
  "flow",
  "with",
  "for",
  "and",
  "the",
  "app",
  "apps",
  "design",
  "screen",
  "style",
  "look",
]);
const tokenize = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ");
const FALLBACK = ["saas", "professional", "swiss-minimalist"];

/** Score styles against a free-text brief; returns the top candidates with a reason. */
export function pickStyle(brief, { limit = 3 } = {}) {
  const text = ` ${tokenize(brief).replace(/\s+/g, " ")} `;
  const words = new Set(
    text
      .trim()
      .split(" ")
      .filter((w) => w.length > 1),
  );
  const scored = styles.map((s, index) => {
    const matched = [];
    let score = 0;
    for (const kw of s.keywords) {
      const k = kw.toLowerCase();
      const multi = /[\s-]/.test(k);
      const hit = multi
        ? text.includes(` ${k} `) || text.includes(` ${k.replace(/-/g, " ")} `)
        : words.has(k) || words.has(`${k}s`) || (k.endsWith("s") && words.has(k.slice(0, -1)));
      if (hit) {
        score += multi ? 4 : 3;
        matched.push(kw);
      }
    }
    for (const w of tokenize(`${s.name} ${s.summary} ${s.useCases.join(" ")}`).split(/\s+/)) {
      if (w.length > 3 && !STOP.has(w) && words.has(w) && !matched.includes(w)) {
        score += 1;
        matched.push(w);
      }
    }
    return { id: s.id, name: s.name, score, matched, index };
  });
  scored.sort((x, y) => y.score - x.score || x.index - y.index);
  const top = scored.filter((s) => s.score > 0).slice(0, limit);
  for (const id of FALLBACK) {
    if (top.length >= limit) break;
    const s = scored.find((c) => c.id === id);
    if (s && !top.some((t) => t.id === id)) top.push({ ...s, score: 0, matched: [] });
  }
  return top.map(({ id, name, score, matched }) => ({
    id,
    name,
    score,
    why: matched.length
      ? `matched: ${matched.join(", ")}`
      : "neutral default — no strong keyword match; choose by brief",
  }));
}

const kebab = (role) => role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const fontClass = (family) => `font-['${family.replace(/ /g, "_")}']`;

/** Design-token objects for a style, same shape as archetypeTokens(). */
export function styleTokens(id) {
  const s = getStyle(id);
  if (!s) throw new Error(`Unknown style: ${id}`);
  const colors = [
    ...Object.entries(s.palette).map(([role, value]) => ({
      name: `color/${kebab(role)}`,
      type: "color",
      value,
    })),
    ...(s.extraTokens || []).map((t) => ({
      name: t.name,
      type: "color",
      value: t.value,
      description: t.use,
    })),
  ];
  const fontFamilies = Object.entries({
    display: s.typography.display,
    body: s.typography.body,
    mono: s.typography.mono,
  })
    .filter(([, v]) => v)
    .map(([role, value]) => ({
      name: `font/${role}`,
      type: "fontFamily",
      value,
      tailwind: fontClass(value),
    }));
  const radii = Object.entries(s.radius).map(([step, px]) => ({
    name: `radius/${step}`,
    type: "radius",
    value: px,
    tailwind: px === 9999 ? "rounded-full" : `rounded-[${px}px]`,
  }));
  const shadows = ["raised", "overlay"].map((level) => ({
    name: `shadow/${level}`,
    type: "shadow",
    value: s.elevation[level].css,
    tailwind: s.elevation[level].tailwind,
  }));
  return {
    style: s.id,
    colors,
    fontFamilies,
    radii,
    shadows,
    all: [...colors, ...fontFamilies, ...radii, ...shadows],
  };
}

const list = (items) => items.map((r) => `- ${r}`).join("\n");

/** Markdown section used by get_design_guidelines {style}. */
export function styleMarkdown(style) {
  const s = typeof style === "string" ? getStyle(style) : style;
  if (!s) throw new Error(`Unknown style: ${style}`);
  const t = s.typography;
  const roles = Object.entries(s.palette)
    .map(([k, v]) => `${k} \`${v}\``)
    .join(" · ");
  const extras = (s.extraTokens || [])
    .map((x) => `- \`${x.name}\` \`${x.value}\` — ${x.use}`)
    .join("\n");
  const r = s.radius;
  return `# Style: ${s.name} (\`${s.id}\`)

${s.summary}

**Scene:** ${s.scene}

${s.identity}

## Composition
${list(s.composition)}

## Typography
- Display: **${t.display}** ${t.displayWeight}, tracking ${t.displayTracking} → \`${fontClass(t.display)}\`
- Body: **${t.body}** ${t.bodyWeight} → \`${fontClass(t.body)}\`${t.mono ? `\n- Mono: **${t.mono}** → \`${fontClass(t.mono)}\`` : ""}
- Scale ratio ${t.scale}. Alternative pairing: ${s.alternativePairing.display} / ${s.alternativePairing.body}.
${list(t.notes || [])}

## Palette
Roles: ${roles}
${extras ? `\nExtra tokens:\n${extras}\n` : ""}
Keep the roles and their contrast if you shift the hue to match a brand.

## Shape and depth
- Radius px: sm ${r.sm}, md ${r.md}, lg ${r.lg}, xl ${r.xl}${r.sm === 0 && r.xl === 0 ? " (square corners)" : ""}.
- Light from ${s.elevation.light}. Raised: \`${s.elevation.raised.tailwind}\`. Overlay: \`${s.elevation.overlay.tailwind}\`.
${list(s.shape)}

## Components
${list(s.components)}

## Signature moves
${list(s.signatureMoves)}

## Imagery
${s.imagery}

## Layout
Density: ${s.density}.
${list(s.layout)}

## Do
${list(s.do)}

## Don't
${list(s.dont)}

## Good for
${list(s.useCases)}
`;
}
