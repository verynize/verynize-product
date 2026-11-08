import test from "node:test";
import assert from "node:assert/strict";
import {
  skills,
  skillAliases,
  listSkills,
  getSkill,
  resolveSkillName,
  skillCatalog,
} from "./design-knowledge/skills.mjs";
import { fundamentals } from "./design-knowledge/fundamentals.mjs";
import { persona } from "./design-knowledge/persona.mjs";
import { TOOL_NAMES } from "./design-tools.mjs";
import { presetIds } from "./shaders.mjs";

const words = (s) => s.trim().split(/\s+/).length;
const PRIMARY = [
  "new-design",
  "edit-design",
  "design-to-code",
  "code-to-design",
  "design-library",
  "generate-assets",
];
const SUPPORTING = [
  "design-review",
  "new-design-references",
  "new-design-arrange",
  "design-library-icons",
  "design-to-code-pull-request",
  "components",
  "code-to-design-library",
];
// snake_case words in skill text that are not tool names.
const NOT_TOOLS = new Set(["node_modules"]);

test("skill catalog has the primary and supporting skills with the right kinds", () => {
  const listed = listSkills({ aliases: false });
  assert.deepEqual(
    listed.filter((s) => s.kind === "primary").map((s) => s.name),
    PRIMARY,
  );
  assert.deepEqual(
    listed.filter((s) => s.kind === "supporting").map((s) => s.name),
    SUPPORTING,
  );
  assert.equal(listed.length, PRIMARY.length + SUPPORTING.length);
  for (const s of listed) {
    assert.ok(s.summary.length > 20, `${s.name} summary`);
    assert.ok(words(skills[s.name].body) > 120, `${s.name} body length`);
    assert.match(getSkill(s.name), new RegExp(`^# Skill: ${s.name}\\n`), `${s.name} heading`);
  }
});

test("every name resolves, case and spacing tolerant, and unknown names throw", () => {
  for (const name of [...PRIMARY, ...SUPPORTING]) {
    assert.equal(resolveSkillName(name), name);
    assert.equal(getSkill(name), skills[name].body);
  }
  assert.equal(resolveSkillName("Design To Code"), "design-to-code");
  assert.equal(resolveSkillName("new_design_arrange"), "new-design-arrange");
  assert.equal(resolveSkillName("nope"), null);
  assert.throws(() => getSkill("nope"), /Unknown skill/);
});

test("old skill names stay reachable as aliases", () => {
  assert.equal(resolveSkillName("variations"), "new-design");
  assert.equal(resolveSkillName("design-system"), "design-library");
  assert.equal(resolveSkillName("Design System"), "design-library");
  assert.ok(getSkill("variations").endsWith(skills["new-design"].body));
  assert.match(getSkill("variations"), /at most 4/);
  assert.match(getSkill("design-system"), /component sheet/i);
  const all = listSkills();
  for (const [alias, { target }] of Object.entries(skillAliases)) {
    const entry = all.find((s) => s.name === alias);
    assert.ok(entry, `alias ${alias} listed`);
    assert.equal(entry.kind, "alias");
    assert.equal(entry.aliasOf, target);
  }
});

test("primary skills route to existing supporting skills and to the style guidelines", () => {
  for (const s of listSkills({ aliases: false }).filter((s) => s.kind === "primary")) {
    for (const sup of s.supporting) assert.ok(skills[sup], `${s.name} → ${sup} exists`);
    for (const sup of s.supporting.filter((n) => skills[n].kind === "supporting"))
      assert.ok(skills[s.name].body.includes(sup), `${s.name} says when to load ${sup}`);
  }
  for (const name of PRIMARY)
    assert.match(
      getSkill(name),
      /get_design_guidelines with `style`/,
      `${name} points at the style guidelines`,
    );
  for (const sup of SUPPORTING.filter((n) => n !== "design-review"))
    assert.ok(
      PRIMARY.some((p) => skills[p].supporting.includes(sup)),
      `${sup} is reachable from a primary skill`,
    );
});

test("every snake_case tool name a skill mentions exists in the MCP tool table", () => {
  const tools = new Set(TOOL_NAMES);
  for (const s of Object.values(skills)) {
    for (const id of new Set(s.body.match(/\b[a-z]+(?:_[a-z]+)+\b/g) || [])) {
      if (NOT_TOOLS.has(id)) continue;
      assert.ok(tools.has(id), `${s.name} mentions unknown tool ${id}`);
    }
  }
  for (const id of new Set(skillCatalog().match(/\b[a-z]+(?:_[a-z]+)+\b/g) || []))
    assert.ok(tools.has(id), `catalog mentions unknown tool ${id}`);
});

test("skills describe what Verynize actually has", () => {
  const assets = getSkill("generate-assets");
  assert.match(assets, /no image-generation model/);
  assert.doesNotMatch(assets, /generate_image|generate_svg|vectorize_image/);
  for (const preset of assets
    .match(/Presets include ([^.;]+)[.;]/)[1]
    .split(/,\s*(?:and\s+)?|\s+and\s+/))
    assert.ok(presetIds.includes(preset.trim()), `shader preset ${preset}`);
  const code = getSkill("design-to-code");
  for (const tool of ["get_element_code", "export_jsx", "export_css", "run_terminal_command"])
    assert.ok(code.includes(tool), `design-to-code uses ${tool}`);
  const library = getSkill("design-library");
  for (const k of ["bind_variables", "aliasOf", "get_icons", "get_design_tokens"])
    assert.ok(library.includes(k), `design-library covers ${k}`);
  assert.match(getSkill("new-design-arrange"), /data-component-x/);
  assert.match(getSkill("design-review"), /3 repair iterations/);
  assert.match(getSkill("new-design"), /skeleton/i);
  assert.match(getSkill("new-design"), /take_screenshot/);
});

test("catalog markdown lists every skill and the aliases", () => {
  const md = skillCatalog();
  assert.match(md, /^## Skills/);
  for (const name of [...PRIMARY, ...SUPPORTING])
    assert.ok(md.includes(`**${name}**`), `catalog lists ${name}`);
  for (const alias of Object.keys(skillAliases))
    assert.ok(md.includes(alias), `catalog mentions alias ${alias}`);
  assert.match(md, /get_design_guidelines \{style\}/);
  assert.match(md, /design-review before finish_artboard/);
});

test("fundamentals carry the layering rule and the composition, layout and content sections", () => {
  const f = fundamentals.toLowerCase();
  for (const topic of [
    "layering",
    "never yield",
    "less clutter",
    "first viewport",
    "one job per section",
    "vary layout families",
    "structure tells the truth",
    "siblings match",
    "by content shape",
    "h-fit",
    "min-h-",
    "flex-1",
    "intrinsic",
    "mobile status bar",
    "9:41",
    "generous",
    "balanced",
    "tight",
    "typography",
    "from a scene",
    "look generated",
    "reuse before you add",
    "contrast",
    "realistic",
    "microcopy",
    "unhappy paths",
    "long lists",
    "charts",
    "reduction pass",
    "verify",
  ])
    assert.ok(f.includes(topic), `fundamentals mention ${topic}`);
});

test("persona keeps its opening, tool names and the new working rules", () => {
  const n = words(persona);
  assert.ok(n >= 250 && n <= 400, `persona ${n} words`);
  assert.match(persona, /^You are the designer inside Verynize/);
  for (const k of [
    "get_design_guidelines",
    "get_skills",
    "take_screenshot",
    "design-review",
    "finish_artboard",
    "save_design_preference",
  ])
    assert.ok(persona.includes(k), k);
  for (const name of PRIMARY) assert.ok(persona.includes(name), `persona routes to ${name}`);
  assert.match(persona, /visual requests/i);
  assert.match(persona, /taste, not commands/);
  assert.match(persona, /lasting one/);
  assert.match(persona, /refuses or fails/);
  assert.ok(
    persona.indexOf("design-review") < persona.lastIndexOf("finish_artboard"),
    "review comes before finish",
  );
});
