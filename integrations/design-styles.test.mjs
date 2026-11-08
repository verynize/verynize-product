import test from "node:test";
import assert from "node:assert/strict";
import {
  styles,
  styleIds,
  listStyles,
  getStyle,
  pickStyle,
  styleTokens,
  styleMarkdown,
} from "./design-knowledge/styles/index.mjs";
import { contrastRatio, HEX } from "./design-knowledge/color.mjs";

const EXPECTED = [
  "academia",
  "art-deco",
  "bauhaus",
  "bold-typography",
  "botanical",
  "claymorphism",
  "cyberpunk",
  "enterprise",
  "flat-design",
  "glassmorphism",
  "industrial",
  "kinetic",
  "luxury",
  "material-design",
  "maximalism",
  "minimal-dark",
  "modern-dark",
  "monochrome",
  "neo-brutalism",
  "neumorphism",
  "newsprint",
  "organic",
  "playful-geometric",
  "professional",
  "retro",
  "saas",
  "sketch",
  "swiss-minimalist",
  "terminal",
  "vaporwave",
  "web3",
];
const ROLES = [
  "background",
  "surface",
  "surfaceAlt",
  "foreground",
  "muted",
  "border",
  "accent",
  "accentForeground",
  "success",
  "warning",
  "danger",
  "info",
];
const DENSITIES = ["compact", "comfortable", "spacious"];
// The 12 roles must be #rrggbb; extra tokens may also carry alpha (glows, scanlines).
const EXTRA_COLOR =
  /^(#[0-9a-fA-F]{6}|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\))$/;
const BANNED_FONTS = ["inter", "roboto", "arial", "helvetica"];

const isStringArray = (v, min, max) =>
  Array.isArray(v) &&
  v.length >= min &&
  v.length <= max &&
  v.every((x) => typeof x === "string" && x.trim().length > 0);
const isShadow = (v) =>
  v &&
  typeof v.css === "string" &&
  typeof v.tailwind === "string" &&
  v.tailwind.startsWith("shadow-");

test("registry holds exactly the 31 expected styles in alphabetical order", () => {
  assert.equal(styles.length, 31);
  assert.deepEqual(styleIds, EXPECTED);
  assert.deepEqual([...styleIds].sort(), styleIds);
  assert.equal(new Set(styleIds).size, 31);
});

for (const s of styles) {
  test(`style ${s.id} satisfies the contract`, () => {
    assert.match(s.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(typeof s.name === "string" && s.name.length > 0, "name");
    assert.ok(
      typeof s.summary === "string" && s.summary.length > 0 && s.summary.length <= 120,
      `summary ≤120 (${s.summary?.length})`,
    );
    assert.ok(isStringArray(s.keywords, 6, 100), "keywords ≥ 6");
    assert.ok(
      s.keywords.every((k) => k === k.toLowerCase()),
      "keywords lowercase",
    );
    assert.ok(typeof s.scene === "string" && s.scene.length > 0, "scene");
    assert.ok(typeof s.identity === "string" && s.identity.length > 0, "identity");
    assert.ok(isStringArray(s.composition, 3, 6), "composition 3–6");

    const t = s.typography;
    assert.ok(
      t && typeof t.display === "string" && typeof t.body === "string",
      "typography display/body",
    );
    assert.ok(t.mono === null || typeof t.mono === "string", "typography mono string or null");
    assert.ok(Number.isFinite(t.displayWeight) && Number.isFinite(t.bodyWeight), "weights");
    assert.equal(typeof t.displayTracking, "string");
    assert.ok(Number.isFinite(t.scale) && t.scale > 1, "scale");
    assert.ok(isStringArray(t.notes, 2, 4), "typography notes 2–4");
    assert.ok(
      s.alternativePairing &&
        typeof s.alternativePairing.display === "string" &&
        typeof s.alternativePairing.body === "string",
      "alternativePairing",
    );

    assert.deepEqual(Object.keys(s.palette).sort(), [...ROLES].sort(), "exactly 12 palette roles");
    for (const role of ROLES) assert.match(s.palette[role], HEX, `${role} is #rrggbb`);
    const extras = s.extraTokens || [];
    assert.ok(Array.isArray(extras) && extras.length <= 6, "extraTokens 0–6");
    for (const x of extras) {
      assert.match(x.name, /^color\/[a-z0-9-]+$/, `extra token name ${x.name}`);
      assert.match(x.value, EXTRA_COLOR, `extra token ${x.name} is #rrggbb or rgba()`);
      assert.ok(typeof x.use === "string" && x.use.length > 0, `extra token ${x.name} use`);
    }

    for (const step of ["none", "sm", "md", "lg", "xl", "full"])
      assert.ok(Number.isFinite(s.radius[step]), `radius.${step}`);
    assert.equal(typeof s.elevation.light, "string");
    for (const level of ["flat", "raised", "overlay"])
      assert.ok(isShadow(s.elevation[level]), `elevation.${level}`);

    assert.ok(isStringArray(s.shape, 2, 5), "shape 2–5");
    assert.ok(isStringArray(s.components, 4, 7), "components 4–7");
    assert.ok(isStringArray(s.signatureMoves, 3, 6), "signatureMoves 3–6");
    assert.ok(typeof s.imagery === "string" && s.imagery.length > 0, "imagery");
    assert.ok(isStringArray(s.layout, 2, 4), "layout 2–4");
    assert.ok(DENSITIES.includes(s.density), "density");
    assert.ok(isStringArray(s.do, 3, 5), "do 3–5");
    assert.ok(isStringArray(s.dont, 3, 5), "dont 3–5");
    assert.ok(isStringArray(s.useCases, 2, 2), "useCases exactly 2");
  });

  test(`style ${s.id} meets contrast minimums`, () => {
    const p = s.palette;
    for (const [a, b] of [
      ["foreground", "background"],
      ["foreground", "surface"],
      ["accentForeground", "accent"],
      ["muted", "background"],
    ]) {
      const ratio = contrastRatio(p[a], p[b]);
      assert.ok(ratio >= 4.5, `${a} ${p[a]} on ${b} ${p[b]} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`style ${s.id} avoids default system fonts unless its identity names them`, () => {
    const families = [
      s.typography.display,
      s.typography.body,
      s.typography.mono,
      s.alternativePairing.display,
      s.alternativePairing.body,
    ].filter(Boolean);
    for (const family of families) {
      const first = family.toLowerCase().split(/\s+/)[0];
      if (BANNED_FONTS.includes(first)) {
        assert.ok(
          s.identity.toLowerCase().includes(first),
          `${family} used without being named in the identity`,
        );
      }
    }
  });
}

test("listStyles summarises every style", () => {
  const list = listStyles();
  assert.equal(list.length, 31);
  for (const item of list) {
    assert.deepEqual(Object.keys(item).sort(), ["density", "fonts", "id", "name", "summary"]);
    assert.match(item.fonts, /^.+ \/ .+$/);
  }
});

test("getStyle resolves ids, names and loose spellings", () => {
  assert.equal(getStyle("web3").id, "web3");
  assert.equal(getStyle("NEO-BRUTALISM").id, "neo-brutalism");
  assert.equal(getStyle("neo brutalism").id, "neo-brutalism");
  assert.equal(getStyle("swiss_minimalist").id, "swiss-minimalist");
  assert.equal(getStyle(getStyle("playful-geometric").name).id, "playful-geometric");
  for (const s of styles) {
    assert.equal(getStyle(s.id), s);
    assert.equal(getStyle(s.name.toUpperCase()), s);
  }
  assert.equal(getStyle("no-such-style"), null);
  assert.equal(getStyle(""), null);
  assert.equal(getStyle(undefined), null);
});

test("styleTokens returns color, font, radius and shadow tokens", () => {
  for (const s of styles) {
    const tokens = styleTokens(s.id);
    assert.equal(tokens.style, s.id);
    assert.equal(tokens.colors.length, 12 + (s.extraTokens || []).length);
    for (const role of ROLES) {
      const name = `color/${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
      const token = tokens.colors.find((c) => c.name === name);
      assert.ok(token, `${s.id} missing ${name}`);
      assert.equal(token.type, "color");
      assert.equal(token.value, s.palette[role]);
    }
    assert.ok(tokens.fontFamilies.length >= 2);
    for (const f of tokens.fontFamilies) assert.match(f.tailwind, /^font-\['[A-Za-z0-9_]+'\]$/);
    assert.equal(tokens.radii.length, 6);
    assert.deepEqual(
      tokens.shadows.map((x) => x.name),
      ["shadow/raised", "shadow/overlay"],
    );
    assert.equal(
      tokens.all.length,
      tokens.colors.length +
        tokens.fontFamilies.length +
        tokens.radii.length +
        tokens.shadows.length,
    );
  }
  assert.throws(() => styleTokens("no-such-style"));
});

test("styleMarkdown renders every section", () => {
  const sections = [
    "## Composition",
    "## Typography",
    "## Palette",
    "## Shape and depth",
    "## Components",
    "## Signature moves",
    "## Imagery",
    "## Layout",
    "## Do",
    "## Don't",
    "## Good for",
  ];
  for (const s of styles) {
    const md = styleMarkdown(s);
    assert.ok(md.startsWith(`# Style: ${s.name} (\`${s.id}\`)`), `${s.id} heading`);
    assert.ok(md.includes(s.scene), `${s.id} scene`);
    assert.ok(md.includes(s.identity), `${s.id} identity`);
    let last = -1;
    for (const h of sections) {
      const at = md.indexOf(`\n${h}\n`);
      assert.ok(at > last, `${s.id} section ${h} present and in order`);
      last = at;
    }
    assert.ok(
      md.includes(`font-['${s.typography.display.replace(/ /g, "_")}']`),
      `${s.id} display font class`,
    );
    assert.ok(md.includes(s.palette.accent), `${s.id} palette`);
    for (const x of s.extraTokens || [])
      assert.ok(md.includes(x.name), `${s.id} extra token ${x.name}`);
    assert.ok(md.includes(s.elevation.raised.tailwind), `${s.id} elevation`);
  }
});

test("pickStyle ranks obvious briefs", () => {
  const top = (brief, n = 3) =>
    pickStyle(brief)
      .slice(0, n)
      .map((r) => r.id);
  assert.ok(top("crypto wallet defi dashboard").includes("web3"));
  assert.equal(pickStyle("hand drawn sketchy notebook")[0].id, "sketch");
  assert.equal(pickStyle("retro 90s geocities fan page")[0].id, "retro");
  assert.ok(top("terminal cli for a self-hosted server").includes("terminal"));
  assert.ok(top("newspaper style front page for a daily bulletin").includes("newsprint"));
  assert.ok(top("synthwave outrun neon music festival").includes("vaporwave"));
  assert.ok(top("neumorphic smart home thermostat controls").includes("neumorphism"));
  for (const r of pickStyle("crypto wallet")) {
    assert.deepEqual(Object.keys(r).sort(), ["id", "name", "score", "why"]);
  }
});

test("pickStyle falls back to neutral defaults", () => {
  const picks = pickStyle("zzqx");
  assert.deepEqual(
    picks.map((p) => p.id),
    ["saas", "professional", "swiss-minimalist"],
  );
  assert.ok(picks.every((p) => p.score === 0 && /neutral default/.test(p.why)));
  assert.equal(pickStyle("crypto bitcoin defi", { limit: 5 }).length, 5);
  assert.equal(pickStyle("", { limit: 1 }).length, 1);
});
