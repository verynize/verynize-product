import test from "node:test";
import assert from "node:assert/strict";
import {
  fundamentals,
  archetypes,
  listArchetypes,
  getArchetype,
  pickArchetype,
  archetypeTokens,
  playbooks,
  getPlaybook,
  skills,
  getSkill,
  listSkills,
  persona,
  getDesignGuidelines,
  contrastRatio,
  styles,
  styleIds,
  listStyles,
  getStyle,
  pickStyle,
  styleTokens,
  styleMarkdown,
  skillCatalog,
  skillAliases,
  resolveSkillName,
  resolveStyle,
  designTokens,
} from "./design-knowledge/index.mjs";

const HEX = /^#[0-9a-fA-F]{6}$/;
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
const words = (s) => s.trim().split(/\s+/).length;

test("contrast helper matches known WCAG values", () => {
  assert.equal(contrastRatio("#000000", "#ffffff").toFixed(1), "21.0");
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
  assert.ok(Math.abs(contrastRatio("#767676", "#ffffff") - 4.54) < 0.01);
});

test("fundamentals cover the required topics at a readable length", () => {
  const n = words(fundamentals);
  assert.ok(n >= 900 && n <= 1550, `fundamentals word count ${n}`);
  for (const topic of [
    "impress",
    "Hierarchy",
    "Layout",
    "Spacing",
    "Typography",
    "45–75",
    "Inter",
    "Color",
    "purple",
    "cream",
    "Elevation",
    "concentric",
    "4.5:1",
    "lorem",
    "“",
    "States",
    "Icons",
    "emoji",
    "Imagery",
    "reduction",
    "card inside a card",
  ])
    assert.ok(
      fundamentals.toLowerCase().includes(topic.toLowerCase()),
      `fundamentals mention ${topic}`,
    );
});

test("at least 24 archetypes with complete, valid, binding parameters", () => {
  assert.ok(archetypes.length >= 24, `${archetypes.length} archetypes`);
  const ids = new Set();
  for (const a of archetypes) {
    assert.match(a.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(a.id), `duplicate id ${a.id}`);
    ids.add(a.id);
    for (const key of ["name", "identity", "scene", "imagery", "density"])
      assert.ok(typeof a[key] === "string" && a[key].length > 3, `${a.id}.${key}`);
    assert.ok(a.composition.length >= 3, `${a.id} composition`);
    assert.ok(a.typography.display && a.typography.body, `${a.id} fonts`);
    assert.ok(
      a.alternativePairing.display && a.alternativePairing.body,
      `${a.id} alternative pairing`,
    );
    assert.ok(a.do.length >= 2 && a.dont.length >= 2, `${a.id} do/dont`);
    assert.equal(a.useCases.length, 2, `${a.id} use cases`);
    assert.ok(a.keywords.length >= 6, `${a.id} keywords`);
    for (const step of ["none", "sm", "md", "lg", "xl", "full"])
      assert.equal(typeof a.radius[step], "number", `${a.id} radius.${step}`);
    assert.ok(
      a.radius.sm <= a.radius.md && a.radius.md <= a.radius.lg && a.radius.lg <= a.radius.xl,
      `${a.id} radius ascending`,
    );
    for (const level of ["raised", "overlay"])
      assert.match(a.elevation[level].tailwind, /^shadow-/, `${a.id} elevation.${level}`);
    for (const role of ROLES) assert.match(a.palette[role], HEX, `${a.id} palette.${role}`);
    for (const v of Object.values(a.palette))
      for (const c of [v].flat()) assert.match(c, HEX, `${a.id} palette value ${c}`);
    const fg = contrastRatio(a.palette.foreground, a.palette.background);
    const ac = contrastRatio(a.palette.accentForeground, a.palette.accent);
    assert.ok(fg >= 4.5, `${a.id} foreground/background ${fg.toFixed(2)}`);
    assert.ok(ac >= 4.5, `${a.id} accentForeground/accent ${ac.toFixed(2)}`);
    assert.ok(
      contrastRatio(a.palette.muted, a.palette.background) >= 4.5,
      `${a.id} muted/background`,
    );
    assert.ok(
      contrastRatio(a.palette.foreground, a.palette.surface) >= 4.5,
      `${a.id} foreground/surface`,
    );
  }
});

test("font pairings are unique and avoid default UI fonts", () => {
  const pairs = new Set();
  for (const a of archetypes) {
    const pair = `${a.typography.display}|${a.typography.body}`;
    assert.ok(!pairs.has(pair), `duplicate pairing ${pair}`);
    pairs.add(pair);
    for (const f of [a.typography.display, a.typography.body])
      assert.ok(
        !["Inter", "Roboto", "Arial", "system-ui", "Helvetica"].includes(f),
        `${a.id} uses default font ${f}`,
      );
  }
});

test("archetype lookup, listing and tokens", () => {
  assert.equal(listArchetypes().length, archetypes.length);
  assert.equal(getArchetype("Swiss Grid").id, "swiss-grid");
  assert.equal(getArchetype("nope"), null);
  const t = archetypeTokens("ledger-precision");
  assert.ok(t.colors.some((c) => c.name === "color/accent-foreground" && HEX.test(c.value)));
  assert.ok(t.colors.every((c) => c.type === "color" && /^color\/[a-z-]+$/.test(c.name)));
  assert.deepEqual(
    t.fontFamilies.map((f) => f.name),
    ["font/display", "font/body", "font/mono"],
  );
  assert.equal(t.fontFamilies[0].tailwind, "font-['Hanken_Grotesk']");
  assert.ok(t.radii.some((r) => r.name === "radius/full" && r.tailwind === "rounded-full"));
  assert.equal(t.shadows.length, 2);
  assert.throws(() => archetypeTokens("nope"), /Unknown archetype/);
});

test("pickArchetype returns sensible top-3 candidates", () => {
  const cases = [
    ["Treasury dashboard for a fintech startup tracking payments and revenue", "ledger-precision"],
    ["Landing page for a luxury watch brand", "quiet-luxury"],
    ["Docs and landing page for a developer CLI that deploys to the cloud", "terminal-native"],
    ["Reading app for kids aged 5 to 8 with parents dashboard", "playground"],
    ["Website for a genomics research lab publishing papers", "lab-notebook"],
    ["Telehealth appointment booking for a dental clinic", "clinical-trust"],
    ["Meditation and sleep app", "still-water"],
  ];
  for (const [brief, expected] of cases) {
    const top = pickArchetype(brief);
    assert.equal(top.length, 3, brief);
    assert.equal(top[0].id, expected, `${brief} → ${top.map((t) => t.id).join(", ")}`);
    assert.ok(top[0].score > 0);
  }
  const vague = pickArchetype("something nice");
  assert.equal(vague.length, 3);
  assert.ok(vague.every((v) => getArchetype(v.id)));
});

test("playbooks have numeric contracts", () => {
  const required = [
    "landing-page",
    "web-app",
    "data-table",
    "mobile-app",
    "settings-form",
    "slides",
    "e-commerce",
    "onboarding",
  ];
  for (const id of required)
    assert.ok(
      playbooks.some((p) => p.id === id),
      `playbook ${id}`,
    );
  for (const p of playbooks) {
    assert.ok(
      p.viewports.length >= 1 && p.viewports.every((v) => v.width > 0 && v.height > 0),
      `${p.id} viewports`,
    );
    for (const key of ["structure", "numbers", "states", "failures"])
      assert.ok(p[key].length >= 3 && p[key].every((s) => s.length > 10), `${p.id}.${key}`);
    assert.ok(
      p.numbers.every((n) => /\d/.test(n)),
      `${p.id} numbers contain numbers`,
    );
    assert.ok(Object.keys(p.density).length >= 2, `${p.id} density`);
  }
  const mobile = getPlaybook("mobile");
  assert.deepEqual([mobile.viewports[0].width, mobile.viewports[0].height], [390, 844]);
  assert.ok(mobile.numbers.join(" ").includes("44"));
  assert.equal(getPlaybook("slides").viewports[0].width, 1920);
  assert.equal(getPlaybook("dashboard").id, "web-app");
});

test("skills exist, are routed by name, and carry the key rules", () => {
  const names = listSkills().map((s) => s.name);
  for (const n of [
    "new-design",
    "edit-design",
    "design-to-code",
    "code-to-design",
    "design-library",
    "generate-assets",
    "design-review",
  ])
    assert.ok(names.includes(n), n);
  // Old names keep resolving to the skills that absorbed them.
  assert.equal(resolveSkillName("variations"), "new-design");
  assert.equal(resolveSkillName("design-system"), "design-library");
  assert.equal(resolveSkillName("nope"), null);
  assert.ok(
    Object.keys(skillAliases).every((alias) => names.includes(alias)),
    "aliases are listed",
  );
  assert.ok(!listSkills({ aliases: false }).some((s) => s.kind === "alias"));
  for (const s of Object.values(skills))
    assert.ok(words(s.body) > 120 && s.summary.length > 20, s.name);
  assert.match(getSkill("new-design"), /skeleton/i);
  assert.match(getSkill("new-design"), /take_screenshot/);
  assert.match(getSkill("design-review"), /3 repair iterations/);
  assert.match(getSkill("design-review"), /element id/);
  assert.match(getSkill(resolveSkillName("variations")), /4 variations|at most 4|up to 4/i);
  assert.match(getSkill("variations"), /new-design/);
  assert.match(skillCatalog(), /\*\*new-design\*\*:/);
  assert.match(getSkill("Design Review"), /Hierarchy/);
  assert.throws(() => getSkill("nope"), /Unknown skill/);
});

test("persona and getDesignGuidelines", () => {
  const n = words(persona);
  assert.ok(n >= 250 && n <= 400, `persona ${n} words`);
  for (const k of [
    "get_design_guidelines",
    "get_skills",
    "take_screenshot",
    "design-review",
    "finish_artboard",
  ])
    assert.ok(persona.includes(k), k);
  const base = getDesignGuidelines();
  assert.equal(base.fundamentals, fundamentals);
  assert.equal(base.styleSection, undefined);
  assert.equal(base.archetype, undefined);
  assert.equal(base.notes.length, 1);
  assert.match(base.notes[0], /swiss-minimalist/);

  // Named styles resolve first.
  const styled = getDesignGuidelines({ style: "neo-brutalism", domain: "landing" });
  assert.equal(styled.styleKind, "style");
  assert.equal(styled.styleId, "neo-brutalism");
  assert.equal(styled.styleSection, styleMarkdown("neo-brutalism"));
  assert.equal(styled.archetype, undefined);
  assert.match(styled.playbook, /1440×900/);
  assert.equal(getDesignGuidelines({ style: "Swiss Minimalist" }).styleId, "swiss-minimalist");

  // Archetype ids remain available as a fallback.
  const full = getDesignGuidelines({ style: "swiss-grid", domain: "landing" });
  assert.equal(full.styleKind, "archetype");
  assert.equal(full.styleId, "swiss-grid");
  assert.match(full.styleSection, /Schibsted Grotesk/);
  assert.equal(full.archetype, full.styleSection);
  assert.match(full.playbook, /1440×900/);

  const bad = getDesignGuidelines({ style: "x", domain: "y" });
  assert.equal(bad.notes.length, 2);
  assert.match(bad.notes[0], /Valid style slugs: academia, art-deco/);
  assert.match(bad.notes[0], /swiss-grid/);

  const suggested = getDesignGuidelines({
    brief: "landing page for a developer CLI with a terminal feel",
  });
  assert.equal(suggested.suggestions.length, 3);
  assert.ok(suggested.suggestions.every((p) => getStyle(p.id)));
  assert.ok(suggested.archetypeSuggestions.every((p) => getArchetype(p.id)));
  assert.match(suggested.notes[0], /from the suggestions/);
});

test("styles API is re-exported and style tokens resolve before archetypes", () => {
  assert.equal(styles.length, 31);
  assert.equal(styleIds.length, 31);
  assert.equal(listStyles().length, 31);
  assert.equal(pickStyle("anything").length, 3);
  assert.equal(resolveStyle("saas").kind, "style");
  assert.equal(resolveStyle("ledger-precision").kind, "archetype");
  assert.equal(resolveStyle("nope"), null);
  const s = designTokens("minimal-dark");
  assert.equal(s.kind, "style");
  assert.equal(s.style, "minimal-dark");
  assert.deepEqual(s.colors, styleTokens("minimal-dark").colors);
  assert.ok(
    s.colors.some((c) => c.name === "color/hairline" && String(c.value).startsWith("rgba(")),
    "extra translucent tokens are included",
  );
  const a = designTokens("ledger-precision");
  assert.equal(a.kind, "archetype");
  assert.equal(a.archetype, "ledger-precision");
  assert.throws(() => designTokens("nope"), /Unknown style "nope"\. Styles: academia/);
});
