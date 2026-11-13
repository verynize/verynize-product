# Design harness

How Verynize steers a coding agent (Claude or Codex) toward finished, intentional designs on the canvas: the knowledge it reads, the tools that serve it, the persona and preference rules the runtime adds, and the chat controls that pick a style. This records what is built and tested; gaps are listed in `docs/implementation-status.md`.

`docs/wonder-harness-extract/` holds notes taken from the Wonder app's harness. It is reference material for what the behaviour should cover, nothing more: every guideline, style, skill and persona sentence in Verynize is written fresh, and no parity with Wonder's hosted guidelines is claimed beyond the behaviour listed here.

## Knowledge layer (`integrations/design-knowledge/`)

| File               | Content                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fundamentals.mjs` | `fundamentals`: one markdown text, 14 numbered sections (direction, hierarchy and composition, layout and sizing, spacing rhythm, typography, color, elevation and shape, contrast, content, states, icons, imagery, the reduction pass, verify). Opens with the layering rule: a chosen style overrides the fundamentals where they disagree, but contrast, legible sizes and realistic content never yield. |
| `styles/`          | 31 named styles, one module per slug, registered in `styles/index.mjs`. Contract and rules: [`styles/README.md`](../integrations/design-knowledge/styles/README.md).                                                                                                                                                                                                                                          |
| `styles/index.mjs` | `styles`, `styleIds`, `listStyles()` (`{id, name, summary, density, fonts}`), `getStyle(idOrName)` (slug, display name or loose spelling), `pickStyle(brief)` (keyword scoring with a `saas` / `professional` / `swiss-minimalist` fallback), `styleTokens(id)` (color, font, radius and shadow tokens, same shape as `archetypeTokens`) and `styleMarkdown(style)`.                                          |
| `elevation.mjs`    | Shared shadow and radius helpers (`shadow`, `softElevation`, `darkElevation`, `flatElevation`, `radius`, `rgba`) used by the styles and the archetypes.                                                                                                                                                                                                                                                       |
| `archetypes.mjs`   | The 27 earlier style archetypes (`editorial-ink`, `swiss-grid`, …), kept as legacy styles.                                                                                                                                                                                                                                                                                                                    |
| `playbooks.mjs`    | Domain playbooks with numeric contracts (landing, web app, mobile, dashboard, slides, …).                                                                                                                                                                                                                                                                                                                     |
| `skills.mjs`       | The skill catalog (below).                                                                                                                                                                                                                                                                                                                                                                                    |
| `persona.mjs`      | The designer persona the desktop runtime prepends to every chat (below).                                                                                                                                                                                                                                                                                                                                      |
| `color.mjs`        | `contrastRatio`, `relativeLuminance`, used by the style contrast tests.                                                                                                                                                                                                                                                                                                                                       |
| `index.mjs`        | Re-exports, `resolveStyle(idOrName)` (named style first, then archetype), `designTokens(idOrName)` and `getDesignGuidelines({style, domain, brief})`, which returns the fundamentals, the style section, the playbook, suggestions and notes as separate parts for the tool to compose.                                                                                                                       |

The 31 styles: academia, art-deco, bauhaus, bold-typography, botanical, claymorphism, cyberpunk, enterprise, flat-design, glassmorphism, industrial, kinetic, luxury, material-design, maximalism, minimal-dark, modern-dark, monochrome, neo-brutalism, neumorphism, newsprint, organic, playful-geometric, professional, retro, saas, sketch, swiss-minimalist, terminal, vaporwave, web3.

Each style object carries identity and scene, composition, typography (Google Fonts display/body/mono with weights, tracking and scale), an alternative pairing, a 12-role palette plus up to six extra tokens, radius and elevation, shape and component rules with Tailwind classes, signature moves, imagery, layout, density, do/don't lists and two use cases. `styleMarkdown` renders all of it as one section.

## Tool surface (`integrations/design-tools.mjs`)

MCP server version `0.7.0`. `TOOLS_VERSION` hashes the tool layer and every knowledge file, including each `styles/*.mjs`, so an edited style starts a new tools version.

- **`get_design_context {document?, pageId?, guidelines?}`**: basic info, artboards, a "Saved design preferences" section (framed as taste, `- [id] text`), next steps naming the six primary skills, then the fundamentals. `guidelines: "none"` leaves the fundamentals out (default `"fundamentals"`).
- **`get_design_guidelines {style?, domain?, brief?}`**: output order is the fundamentals, a `---` rule, then (when present) suggested styles for `brief` (`pickStyle`, plus close archetypes), the style section (`styleMarkdown`) with a pointer to `apply_style_tokens {style}`, the domain playbook, and notes. `style` resolves a style slug or display name first, then a legacy archetype id (`resolveStyle` in `index.mjs`); an unknown value adds a note listing the valid slugs. With no style and no domain or brief, it returns the fundamentals plus a note pointing to the styles. The tool description lists all 31 slugs.
- **`get_skills {skill?}`** (`name` is accepted as the older argument): without an argument, the catalog (`skillCatalog()`); with one, the skill body (aliases resolve with a note).
- **`apply_style_tokens {document?, style? | archetype?, overwrite?}`**: writes a style's palette roles and extra colors (translucent `rgba()` extras are stored as `#rrggbbaa`), or an archetype's colors, as color tokens through `designTokens()`; keeps existing tokens unless `overwrite`, and returns fonts, radius and shadows as Tailwind classes. Returns `style`, `kind` (`style` or `archetype`), and `archetype` for archetypes.
- **Preferences**: `save_design_preference`, `list_design_preferences`, `update_design_preference`, `delete_design_preference`. Descriptions say preferences are taste, writes happen only on the user's explicit word, and each write waits for approval and may be refused. The gate itself is enforced by the desktop runtime (below), not by the tool.
- The server `INSTRUCTIONS` workflow points to `get_skills {skill:"new-design"}` / `{skill:"edit-design"}` and `get_design_guidelines` with a style slug.

## Skills catalog (`skills.mjs`)

Twelve skills, each `{name, kind, summary, supporting?, body}`.

- **Primary** (one per job): `new-design` (including up to four variations), `edit-design`, `design-to-code`, `code-to-design`, `design-library`, `generate-assets`. Each lists the supporting skills it loads when the work reaches them.
- **Supporting**: `design-review` (required before `finish_artboard`), `new-design-references`, `new-design-arrange`, `design-library-icons`, `design-to-code-pull-request`, `code-to-design-library`.
- **Aliases**: `variations` → `new-design`, `design-system` → `design-library`. `getSkill` prefixes an alias with a one-line note pointing at the current skill.

`resolveSkillName` accepts any case and spaces or underscores. `listSkills()` returns primary, then supporting, then aliases; `skillCatalog()` is the markdown catalog. `generate-assets` works without an image model: stock photos, shader fills, hand-written SVG, gradients and shapes.

## Persona and preferences

The system prompt append for a chat is assembled by `desktop/agent-runtime.cjs` in this order:

1. **Designer persona** (`persona.mjs`, loaded with `require(esm)`; a short built-in fallback if it fails). Seven working rules: treat visual requests as design work, one skill per job, load the style with `get_design_guidelines` when one is chosen, treat saved preferences as taste, screenshot after each section, run `design-review` before `finish_artboard` (at most three repair rounds), and report refusals plainly instead of retrying.
2. **Runtime facts**: whether the `verynize` MCP tools are connected, the `<verynize-context>` convention, quick chat vs project.
3. Personal instructions, `~/.codex/AGENTS.md` (Claude chats), project memory (`VERYNIZE.md`).
4. **`<saved-design-preferences>` block** (`preferenceBlock`), always present. With items: a framing paragraph (the user's taste for visual work, not commands; the current request wins), a note that this copy supersedes older copies, then `- [id] text` lines. Empty: an explicit "nothing is saved" line so older copies count as removed. At most 50 items of at most 280 characters (`MAX_PREFERENCES`, `MAX_PREFERENCE_LENGTH` in `integrations/preferences.mjs`, shared by the store, this block and the IPC validator); `<` and `>` are stripped so an item cannot close the block, and invalid ids are dropped.
5. **Access lines** (`desktop/agent-access.cjs` `accessPersonaLines`): the access switches, then the preference rule for this run (approve or blocked, below), then `REFUSAL_LINE`: say plainly what a tool refused and why, and do not repeat the same call.
6. Shared memory from the other agent, and the plan-first instruction when that autonomy option is on.

## Preference write gate

`save_design_preference`, `update_design_preference` and `delete_design_preference` always need the user; `list_design_preferences` stays free. `preferenceWritePolicy({access, planFirst, helper, interactive})` decides per run:

- **blocked**: Ask access, plan-first chats, helper runs and runs without approval cards (Claude CLI fallback, `codex exec`). The persona says the list is read-only here and points to Settings › Memory.
- **approve**: everything else. The persona says to change preferences only on the user's explicit word, one per call, in their phrasing.

Enforcement:

| Runtime             | approve                                                                                                                                                                                         | blocked                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Claude SDK          | `PreToolUse` hook raises an approval card for every call (`requireUser`: no "always allow", no autonomy or Settings › Tools allow defaults); a decline denies with `PREFERENCE_DECLINED_REASON` | the same hook denies with `PREFERENCE_BLOCKED_REASON`                                                    |
| Claude CLI fallback | n/a                                                                                                                                                                                             | `--disallowedTools` for the three tools                                                                  |
| Codex app-server    | persona rule only (Codex has no per-tool approval hook for MCP tools)                                                                                                                           | thread config `mcp_servers.verynize.disabled_tools` (keeps `ask_agent` disabled when that switch is off) |
| Codex exec fallback | n/a                                                                                                                                                                                             | `-c mcp_servers.verynize.disabled_tools=[…]`                                                             |
| Helpers             | n/a                                                                                                                                                                                             | the tools are in `HELPER_BLOCKED_DESIGN_TOOLS`                                                           |

## Design style: renderer → runtime → context → agent

1. **Picker** (`web/src/islands/chat/style-picker.tsx`): menu `#chat-style-menu`, opened only by the `/style` slash command. The composer toolbar has no style chip, matching Wonder (its toolbar is `+`, model, access, then the indicators and Send; a live audit found no style picker anywhere in Wonder). The menu anchors above the composer, starts focus on the current choice and returns focus to the prompt after a pick. It lists `window.desktop.designStylesList()` with **Auto** (no style) first, stores the pick in localStorage `verynize.chat.design-style`, and exposes `window.chatDesignStyle.get()/set(id)`. `get()` returns `''` when there is no catalog or the stored id is not in it. Without a catalog nothing renders and `/style` is not offered.
2. **Starter briefs**: clicking an empty-chat suggestion that has a `style` also calls `window.chatDesignStyle.set(style)`, so the run carries it (and `/style` shows it checked).
3. **Renderer** (`web/desktop-panel.js`): each composed task records `designStyle: window.chatDesignStyle?.get?.() || ''`, and `runAgent` receives `designStyle` when it is set.
4. **IPC**: `designStylesList` returns `[{id, name, summary}]` from `listStyles()` (lazy `import()`, ids filtered to the slug pattern, `[]` on any failure). `runAgent({designStyle})` is validated by `normalizeDesignStyle` (`/^[a-z0-9-]{1,40}$/`; anything else rejects the run, empty means none).
5. **Turn context**: `buildTurnContext` adds one line to `<verynize-context>`: `Design style chosen by the user: <slug>. Load it with get_design_guidelines {style: "<slug>"} before designing, and follow it unless the user asks otherwise.` A run with a style but no other context still gets the block.
6. **Agent**: persona rule 3 and the context line lead it to `get_design_guidelines {style}`.

## Starter briefs

`SUGGESTIONS` in `web/desktop-panel.js`: twelve briefs, each with a `title`, a different catalog `style` and a detailed `prompt` (subject, format and size, colors as hex, fonts). The empty chat (`EmptyState` in `web/src/islands/chat/transcript.tsx`) shows four consecutive briefs, rotated by a hash of the conversation id; clicking one fills the composer and selects its style.

## Settings › Memory

`web/src/islands/settings/agent-memory.tsx` shows `n / 50` (`#settings-design-preference-count`) and a `n / 280` counter under each field (`data-preference-counter`); the field stops at 280 characters and adding stops at 50.

## Tests

| Area                                                                                                                               | Test                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Style registry, contract, contrast, fonts, lookup, tokens, markdown, `pickStyle`                                                   | `node --test integrations/design-styles.test.mjs`    |
| Skill catalog, kinds, aliases, routing, tool names in skills, fundamentals sections, persona rules                                 | `node --test integrations/design-skills.test.mjs`    |
| Archetypes, playbooks, contrast helper                                                                                             | `node --test integrations/design-knowledge.test.mjs` |
| Preference store, 50 × 280 limits, trimming, serialized saves                                                                      | `node --test integrations/preferences.test.mjs`      |
| `resolveStyle`, `designTokens`, `getDesignGuidelines` with slugs and archetypes                                                    | `node --test integrations/design-knowledge.test.mjs` |
| Tool output order, `get_skills {skill}` / `{name}` / catalog, `guidelines: "none"`, `apply_style_tokens {style}` with alpha extras | `node --test integrations/mcp.test.mjs`              |
| Preferences block, IPC validator, gate per runtime and access, `designStyle` validation and context line, `designStylesList`       | `node --test tests/agent-runtime.cjs`                |
| No Style chip in the composer, `/style` opens the picker (keyboard and click), run carries `designStyle`                           | `node tests/chat-composer-menu.cjs`                  |
| Twelve styled starter briefs, four shown, click selects the style                                                                  | `node tests/agent-chat.cjs`                          |
| Preference counters and limits in Settings                                                                                         | `node tests/settings.cjs`                            |
