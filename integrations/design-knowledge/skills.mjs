// Job-routed workflows. Each skill is markdown an agent reads before starting that kind of job.
// Primary skills cover one whole job each; supporting skills are loaded by a primary skill when
// the work reaches them. Old names stay reachable through aliases.

const newDesign = `# Skill: new-design

Use for anything new from a prompt: a page, screen, flow, dashboard, a single component, a set of separate items (logo options, empty states, one artboard each), or variations of an existing design.

Supporting skills: load **new-design-references** when the user wants examples, inspiration or a competitive scan; **new-design-arrange** whenever you place more than one artboard; **generate-assets** when the design needs imagery beyond a stock photo; **design-library** when you create or reuse tokens; **components** when parts repeat across screens (an app shell around every page, a card or row used many times).

## 1. Pick the source of the look
In this order: (1) the user's brief, references or named style; (2) a repository behind the product, whose tokens, fonts and components win (follow code-to-design for how to read them); (3) the language already on the canvas: when existing artboards share palette, type and radii, a new screen joins them, so read two of them with get_element_code; (4) only with a free hand, choose a style (get_design_guidelines with \`brief\` suggests candidates).
As soon as a style is chosen or named, call get_design_guidelines with \`style\` (and \`domain\` for the playbook). Its treatments override the fundamentals where they differ.

## 2. Write the brief (before anything draws)
Five lines in your reply: **job** (impress or present clearly), **audience and context**, **content** (the real sections and copy), **direction** (style, palette scene, type pairing), **density and viewport**. If the request is vague, decide and state your assumptions; ask at most one question, and only when the answer changes the work.
Read get_design_tokens. Reuse matching tokens; when the file has none, create role tokens from the style with apply_style_tokens (or create_design_tokens) and use \`bg-[var(--color-…)]\` from then on.

## 3. Size the artboard
- A page or screen takes its viewport width (1440 desktop, 390 mobile) with a \`min-h-*\` floor at the viewport height, and grows with content. Never a fixed root height.
- A fixed format (slide, poster, social post) keeps its exact \`w-*\` and \`h-*\`; fit the content inside and say if it does not fit.
- A component, or one item of a set, is its own artboard at natural size, no floor. Separate items are never wrapped in a presentation board; each is its own artboard.
- A full mobile screen built from scratch opens with the status bar from the fundamentals.

## 4. Build a labelled skeleton
create_artboard with the root and every section as labelled, unstyled frames, two levels deep: sections (\`data-node-label="Hero"\`, "Pricing", "Footer") and their main blocks ("Hero Copy", "Hero Media"). Name each label after the part it will become. Use flex/grid flow and real widths; sections hug, rhythm comes from padding and gap (\`py-24\`, \`gap-12\`). take_screenshot once to judge proportions.

## 5. Fill one section at a time
1. Replace the section by id with update_elements: real copy, real numbers, icons from get_icons, photos from search_images or an intentional fallback. Replace or delete every skeleton placeholder you touch; none may survive beside real content.
2. take_screenshot of that section, not only the full page; a downscaled page hides clipping.
3. Fix clipped text, overflow, leftover labels, contrast, misalignment and broken rhythm before moving on.

## 6. Review and finish
Run design-review on the whole artboard, apply its fixes and re-screenshot. Call finish_artboard with a reviewNote. Summarise in three to five lines: direction (style, fonts, palette idea), structure, assumptions, a next step, and the designLink verbatim.

## Variations
A variation is a copy placed beside the original, never a replacement: duplicate_elements with \`newArtboard: true\`, then change the copy.
- Make at most 4. Two strong directions beat four timid ones.
- Each must differ from the others on all four axes at once: type category (serif display, grotesque, mono, condensed), color family (a different hue family, not a shade shift), layout composition (full-bleed stage, split, editorial grid, centered statement), and component styling (radius family, borders, shadows, button shape).
- Take each from a different style or a clearly different reading of the brief, and load that style with get_design_guidelines.
- Keep the content identical so the comparison is about design. If the user constrains the change ("same layout, new colors"), change only what they named.
- On a file built from a repository, keep one variation faithful to the repo's system and label the others as departures.
- If the user finds them too similar, rebuild the next round from the content, not by reshaping the previous structure.
- Label artboards "A — Name", "B — Name"; place them with new-design-arrange; run design-review on each (top three fixes); recommend one with a reason.

## Rules
- Never draw before the brief is written. One style per screen.
- No placeholder text, grey image boxes or emoji icons. No fixed section heights.
- Apply the user's saved design preferences as taste unless the brief overrides them.
`;

const editDesign = `# Skill: edit-design

Use to change an existing design beyond a one-property tweak, to fix a problem the user reports, or to give feedback on a design. A quick text, color, spacing or icon change needs no skill: apply it directly. Several side-by-side alternatives belong to new-design (Variations).

Supporting skills: **new-design-references** when real references would sharpen feedback; **design-library** when the change touches tokens; **components** when the layer you change belongs to a main component or an instance; **design-review** after a large change.

## 1. Diagnose before touching
- take_screenshot of the area and read its current code with get_element_code (get_element_tree or find_elements to locate ids). The user may have edited since your last read, so read again before the first edit of the turn.
- Say in one sentence what is wrong or what will change and which ids are involved. For a reported problem, find the cause (hierarchy, rhythm, contrast, an image that never loaded) rather than patching the symptom.
- Name the existing direction: fonts, palette, radius, spacing rhythm, tokens. Preserve it unless asked for a new one. If the design follows a named style, or the user picks a new one, call get_design_guidelines with \`style\` so edits stay inside it.

## 2. Change the minimum
- For small copy/class changes, read get_element_code and read_document, then use replace_in_element with the current revision and an exact old string occurring once. Preserve data-node-id attributes.
- Edit the smallest element that solves it, in place: \`edit\` directives merge classes, \`replace\` only for a real restructure. Never insert a new version beside the old one.
- Keep ids stable. Do not rebuild a section to change a word.
- Reuse existing tokens and sibling classes; do not invent colors or sizes. A token change restyles every element bound to it, other artboards included, so change the token itself only when the user wants it everywhere, and ask first when other designs use it.
- When a change ripples (a longer headline), check that neighbours and parents still hug and align.
- Replace fixed section heights left by older work with hug plus padding instead of nudging them.

## 3. Verify
take_screenshot of the edited area, compare with the before shot, and check that nothing else moved, clipped or changed color. When the change spans several sections, restructures the layout or replaces the hero, run design-review on the result.

## 4. Feedback mode
When the user asks for an opinion, look at a screenshot and the structure, then give one to five improvements, most important first, each as element id, the concrete change and the principle it serves (hierarchy, spacing, type, color, contrast, composition, clutter, content). Apply only the ones the user picks.

## 5. Report
List what changed (ids and plain words) and anything you noticed but left alone.

## Rules
- Do not improve unrelated parts unasked; mention them.
- If a request breaks a fundamental (10px body text), do it and note the trade-off in one line.
- If the user states a lasting preference while asking ("always…", "from now on…"), save it with save_design_preference.
`;

const designToCode = `# Skill: design-to-code

Use when the user wants a canvas design built in their repository: "implement this screen", "code the selected card", "ship this page".

Supporting skills: **design-to-code-pull-request** only when the user asked for a branch, commit or pull request; **design-library-icons** when icons need mapping to the repo's icon source. The repo's own conventions outrank any canvas style; call get_design_guidelines with \`style\` only when the user asks you to introduce one.

## 1. Read the design
- get_element_code on the narrowest element that covers the request; take_screenshot when the look matters as much as the structure.
- For whole pages, export_jsx gives every artboard of a page as Tailwind JSX with the variables header, and export_css gives class-based CSS with the tokens as :root custom properties. Use them as a spec, not as code to paste.
- get_design_tokens tells you which \`var(--…)\` names are canvas tokens and what values they hold.

## 2. Read the code it lands in
Read the checkout with your own file tools, skipping build output and \`node_modules\`. Find the route or parent that will render it, the components it already imports, and the styling source (Tailwind config or \`@theme\`, CSS custom properties, theme objects). The code as it is now is the reference; re-read files rather than recalling them.

## 3. Map before writing
- Each distinct part (button, input, card, badge, menu item) maps to an existing repo component, found by name and by role. Where the design differs, extend it with a prop or variant, or wrap it. Create a new component only when nothing fits, and say why.
- Layout wrappers use the repo's own layout idiom.
- Values go back to the repo's own form: a canvas token \`var(--color-accent)\` becomes the repo expression with that value (\`bg-primary\`, \`hsl(var(--primary))\`, a theme path); a literal like \`p-[16px]\` becomes the matching scale step (\`p-4\`). Keep a literal only when the repo has no token for it, and list those.
- Icons: \`<Icon name="lucide:search" />\` is a canvas element. Write the repo's own icon import for the same glyph (for example \`Search\` from \`lucide-react\`). Canvas token names and \`<Icon>\` never appear in shipped code.
- Replace sample arrays and fixed copy with real props, data, state, handlers and routes, plus the repo's loading, empty and error patterns.

## 4. Write and check
- Edit files in place with small, exact changes that follow the file's formatting, imports and naming. Leave them uncommitted unless asked.
- Run the repo's own checks with run_terminal_command (typecheck, lint, tests, build), using the scripts it defines.
- When a dev server is configured, check the result visually: get_dev_server, then preview_open and preview_screenshot, and compare with take_screenshot of the design. Fix differences in structure, spacing, type and color.

## 5. Report
Your edits by file, the components you reused or extended, each new component and why, values left as literals, and anything you could not verify.
`;

const codeToDesign = `# Skill: code-to-design

Use when the user gives code (a repo path, a component, pasted JSX or HTML) and wants it on the canvas, or wants a canvas copy refreshed after the code changed. The result reproduces what the code renders today.

Supporting skills: **code-to-design-library** when the job is a whole component library ("bring in our buttons, inputs and cards"); **design-library-icons** for the repo's own icons; **design-library** for token mechanics; **components** when the code reuses one component across screens (a layout shell, list rows, cards). The code is the style here; call get_design_guidelines with \`style\` only for an uplift the user asks for.

## 1. Read the source of truth
- Read the checkout with your own file tools, skipping build output and \`node_modules\`. If there is no checkout, ask where the code is.
- Map the view: entry file, sections top to bottom, imported components and which repeat, the styling source. The current code wins over READMEs, screenshots or what such a component usually looks like.
- Check the canvas (find_elements) for parts already imported from this repo and reuse them with duplicate_elements instead of rebuilding.

## 2. Bring in tokens first
- Read get_design_tokens. Reuse a token that matches by value and role. Create the missing ones with create_design_tokens using the repo's names and exact values (\`rem\` converted at the repo's root size).
- Where the repo layers semantic names over a raw palette, keep both: create the raw token, then the semantic one, then point it at the raw token with update_design_tokens \`aliasOf\`. Never flatten an alias to its value.
- Import HTML/JSX with optional \`name\` and \`placement\`: \`auto\` places roots beside existing artboards; \`preserve\` keeps source coordinates. Inline SVG becomes a sanitized image; arbitrary border, radius, outline and embedded URL backgrounds are supported. For local HTTP images, use HTML import with explicit \`allowRemote: true\`. Read returned warnings for missing assets.
- Static HTML or exported pages can come in through import_html, which turns :root custom properties into tokens. A running app the user asks to capture can come in through capture_preview_to_canvas.

## 3. Translate, do not re-imagine
- Rebuild with flex/grid flow and the same class values. Tailwind utilities copy as written; token-bound classes become \`bg-[var(--…)]\`; classes the repo defines in its own CSS (\`@apply\`, modules) are expanded into the utilities they mean.
- Responsive and state classes resolve to the viewport and state the artboard shows (\`md:grid-cols-3\` at 1440 is \`grid-cols-3\`; a disabled node shows \`opacity-50\`).
- Runtime logic becomes static content: write mapped items out with realistic data. Keep component boundaries as labelled frames (\`data-node-label\` = component name).
- Real font families via \`font-['Family_Name']\`; icons via get_icons in the set the repo uses.
- Size the artboard to the source: a page at its viewport with a \`min-h-*\` floor, a component at natural size.
- Reproduce what the code does, including values that look off. Improvements are a later, separate request.
- An asset you cannot bring in (a font, an image) stays a declared fallback, never a look-alike, and you say so.

## 4. Verify fidelity
take_screenshot section by section and compare with the code's intent (and any screenshot of the running app). Fix structure, order, spacing, type and color differences first. Run design-review in fidelity mode: findings the source itself has are reported, not fixed.

## 5. Report
What you reproduced, the repo and branch you read, tokens created, parts you built new, and anything missing.

## Optional uplift
Only if asked: propose improvements on a separate artboard, never by silently changing the faithful copy.
`;

const designLibrary = `# Skill: design-library

Use when the work is the file's design system: reading, creating, renaming, aliasing or deleting tokens, extracting tokens from an existing design, binding elements to tokens, choosing the icon set, or building a style guide or component sheet.

Supporting skills: **design-library-icons** for icons that come from a repository; **code-to-design-library** when the library is imported from code. When the system grows from a chosen or named style, call get_design_guidelines with \`style\` first and build its tokens with apply_style_tokens.

## 1. How tokens behave here
- A token is one definition with many bound uses. Changing it restyles every bound element on every page and artboard. Change a definition only when the user wants the change everywhere; ask first if other designs depend on it.
- Name by role, grouped with slashes: \`color/accent\`, \`color/text/muted\`, \`space/md\`, \`radius/lg\`, \`font/display\`. Never by appearance (\`color/blue\`).
- get_design_tokens lists every token with its CSS variable. Copy the variable exactly as listed: \`color/text/primary\` is \`var(--color-text-primary)\`.
- Reuse before you add: a token that matches by value and role is used, not duplicated. Rename or delete only when asked.

## 2. Create and alias
- create_design_tokens takes a list; type is color (default), dimension, number, fontFamily or fontWeight. apply_style_tokens creates a style's color roles and returns its font, radius and shadow classes.
- Aliases: create the raw palette token first, then the semantic token, then set update_design_tokens \`aliasOf\` so the semantic token follows the raw one. \`aliasOf: null\` detaches. Keep both layers when a source has them.
- update_design_tokens also renames tokens and whole slash folders; references follow. delete_design_tokens removes them; bound elements keep the last value as a plain value.

## 3. Bind
- Colors bind through classes: \`bg-[var(--color-surface)]\`, \`text-[var(--color-text-muted)]\`, \`border-[var(--color-border)]\`.
- Typed properties bind with bind_variables: radius, gap, padding, fontSize, lineHeight, letterSpacing, fontFamily, fontWeight, opacity, sizes and stroke width, plus fill, stroke and SVG colors. \`token: null\` unbinds and keeps the current value.
- To extract a system from an existing design: find the recurring values (a color used in several places, a repeated gap, the heading and body fonts, a shared radius), create tokens for them, then rebind each element that used the raw value.

## 4. Icons
Icons come from the offline sets in get_icons (lucide, ph, tabler). Pick one set per file and record it in the guide. There is no custom icon catalog to write to: repo-owned glyphs that no set covers come in as SVG images, as design-library-icons describes.

## 5. Style guide or component sheet
When asked for a design system, build one artboard (1440 wide) with sections: Color (swatch, role, hex, contrast pair), Type (each step with real copy), Spacing, Radius, Elevation, Components (buttons, input, select, checkbox, radio, toggle, badge, card, table row, nav item, toast, dialog).
- Token order: color roles (background, surface, foreground, muted, border, accent, accentForeground, success, warning, danger, info), then type scale and families, spacing on a 4px base with three tiers, radius steps with concentric rules, two shadow levels.
- Dark theme is its own set, not an inversion. Check foreground/background and accentForeground/accent reach 4.5:1.
- Every component shows default, hover, focus and disabled; inputs also show error. No orphan values: anything not a token is removed or tokenized.
- take_screenshot each section, run design-review with emphasis on contrast and states, and finish with a short token summary.
`;

const generateAssets = `# Skill: generate-assets

Use when a design needs imagery, artwork or texture beyond what the layout itself provides: a hero visual, background, illustration, logo mark, pattern or decorative shape. Verynize has no image-generation model: assets come from photo search, shader fills, SVG vectors and shapes built from elements. Say so plainly when the user asks for a generated picture, and offer the closest of these. Once the design's style is chosen, call get_design_guidelines with \`style\` so assets follow its imagery and palette.

Supporting skills: **new-design-arrange** when assets become separate artboards (logo options, an illustration set).

## 1. Choose the source by the slot
- **Photography** (hero, product context, people, atmosphere): search_images with an art-directed query: subject, viewpoint, light, mood, and where the quiet area for text sits. Pick one result that fits; place it with \`<img src="…" alt="…" className="w-full h-[480px] object-cover" />\`. Credit the author where the design shows credits. Do not use more photos than the layout needs.
- **Living texture or abstract hero** (product launch, AI or audio themes, ambient bands): a shader node, \`<Shader preset="aurora" />\`. Presets include aurora, mesh, waves, noise, ribbon and swirl; pass palette colors as \`data-shader-colors\` (a JSON object keyed by center, edge, ripple and background) and lower \`speed\` and \`intensity\` so it stays calm behind text.
- **Logo marks, illustrations, patterns**: inline \`<svg viewBox="0 0 24 24" className="size-12"><path d="…" fill="#…" /></svg>\`, written by hand from simple geometry. It becomes an editable vector layer (one per paint, grouped in a frame when there are several), read back as \`<svg data-vector …>\` whose fill, stroke, strokeWidth (layer pixels), strokeLinecap/Linejoin and strokeDasharray you can edit in place. Keep it flat: a few paths, one stroke weight or none, colors from the palette. Gradients, filters, masks, clip paths and text inside an SVG keep it an image (the warning says so); draw those parts with frames and fills instead.
- **Gradients and shapes**: \`bg-linear-to-br from-… via-… to-…\` in the palette's own hues, or overlapping \`<div />\` shapes with radius, borders and low-opacity fills cut from the accent and surface colors.
- **Typographic art**: a huge cropped word or number in the display face often beats a weak picture.

## 2. Keep it on brief
- Assets come from the palette scene chosen in the brief, never the generic purple-blue glow.
- Images keep their proportions and focal point; a grid of images shares one ratio.
- Text on any image or shader gets a scrim or sits in its quiet area; check contrast in take_screenshot.
- Icons are not assets: use get_icons, never drawn SVGs or emoji.

## 3. When nothing fits
If search_images returns nothing usable, retry once with a different query, then degrade with intent (shader, gradient, typography). Never leave a grey box labelled "Image", and tell the user which slots use a fallback.
`;

const designReview = `# Skill: design-review

Mandatory after a new design, after any edit that spans several sections, restructures a layout or replaces a hero, after a set of variations, and before finish_artboard. Also when the user asks for a review.

## 1. Look
take_screenshot of the full artboard, then of each section at full resolution. Read the code (get_element_code; get_element_tree or find_elements for ids) for anything suspicious. Compare against the brief and the chosen style.

## 2. Critique against the checklist
Score each item pass / fix and cite the element id.
1. **Intent:** it does what was asked and follows its brief or style; a style's treatments win, readability never yields.
2. **Hierarchy:** one focal point and one primary action per section; three emphasis levels; boldness spent once.
3. **Composition:** the first viewport is one composition; each section has one job; layout families vary.
4. **Spacing rhythm:** one rhythm per artboard; between-group space ≥ 2× within-group; consistent side padding.
5. **Typography:** style fonts rendered; body ≥ 14px (16px marketing); measure ≤ 75ch; display tracking tight.
6. **Color and contrast:** text ≥ 4.5:1 against its real backdrop; icons visible; accent only on actions; no generated-looking palette.
7. **Alignment and siblings:** shared edges; siblings share one treatment and aligned actions; grids tile with no dead cell.
8. **Content:** no lorem or leftover labels; realistic uneven numbers; typographic punctuation; short copy; no invented claims.
9. **States:** empty, loading and error states where data is involved; focus and disabled where interactive.
10. **Reduction and assets:** no card-in-card or redundant wrappers; structure tells the truth; one icon set; images art-directed; nothing clipped or overflowing.

Sort findings: **critical** (intent mismatch, unreadable text or icons, contrast below the minimum, overflow, broken images, missing content), **fundamentals** (hierarchy, clutter, rhythm, generic type), **polish** (the rest; fix only when cheap).

## 3. Fix
Pick the 1–5 highest-impact fixes, critical first. For each: the principle, the element id, the concrete change (classes or copy). Apply them with update_elements. When you were asked for a review without permission to edit, return the list instead.

## Fidelity mode
When the design reproduces the user's code, also check structure, text, tokens (\`var(--…)\`, not a literal shadowing a token) and repeated parts against the source. A problem the source itself has (low contrast, small type) is reported as a note, not fixed. Renderer differences and already reported substitutions are notes too.

## 4. Re-verify
Re-screenshot every changed section. If new problems appear, repeat steps 2–4. Stop after **3 repair iterations**; report anything still open instead of looping.

## 5. Report
One short block: what passed, what you fixed (with ids), what remains and why. Pass this as finish_artboard's reviewNote.
`;

const newDesignReferences = `# Skill: new-design-references

Use when the user asks for examples, inspiration, a competitive analysis or unconventional directions, or when real references would strengthen a critique. This job ends in a chat reply, not artboards; building a direction from it is the user's next choice.

## Sources
Use web search and browsing if your host gives you them, and cite every reference by link. Without them, say so, and mark which references come from your own knowledge. search_images can supply mood imagery but is not evidence of how a product looks.

## Shape the reply to the ask
- **Examples:** two to four named visual patterns, each with one line on what it is and its references, then which pattern dominates the category.
- **Competitive analysis:** three to five products (a leader, a challenger, one from a neighbouring category). For each, a short summary; then the shared patterns, the anti-patterns with evidence, and three to five recommendations ordered by impact.
- **Unconventional directions:** name the category and the underlying goal, then borrow from two or three visually unrelated fields that solve the same goal (a flight deck or an edit timeline for dashboard orientation). For each: what the source does, why it works, how it would look here.
- **Critique with references:** read the design first (take_screenshot, get_element_code), then tie each suggestion to a reference, as element, change and principle, most important first.

## Rules
- Three sharp references beat ten loose ones.
- Never copy a reference's assets, copy or logo into a design; take the pattern, not the pixels.
- End by offering to apply one pattern or build one direction with new-design.
`;

const newDesignArrange = `# Skill: new-design-arrange

Use whenever you place more than one artboard (variations, a flow, a set of items) or tidy existing ones.

## Coordinates
- An artboard's position is its root's \`data-component-x\` and \`data-component-y\`: the top-left corner in page pixels, x to the right, y downward. Always set both together.
- Without them, a new artboard lands 80px right of the right-most artboard at y 0. That default is right for a single design.
- Set positions on the root in create_artboard, or move an existing artboard with an \`edit\` directive in update_elements on its root that carries only those two attributes.
- Read the current rects with get_artboards before computing anything. Treat a missing size as unknown, not zero: re-read after the editor has rendered it, or let new artboards place themselves.

## Patterns
- Neighbours in one group sit 100px apart.
- **A flow** (screens in navigation order) is one row with tops aligned: next x = previous x + previous width + 100.
- **States or variants of one screen** form one column with left edges aligned: next y = previous y + previous height + 100.
- **Many same-size items without order** form a grid of three to five columns.
- **A new group** starts at least 300px below everything else, aligned with the left-most artboard. Its caption is a small separate text artboard 40px above it, never a frame wrapped around the group.

## Rules
- Nothing overlaps: check each computed rect against every existing artboard before writing it. Positions you give are applied exactly, with no automatic nudging.
- When tidying, keep the user's anchor artboard fixed and move only the group you were asked to arrange.
- After placing, call get_artboards once to confirm the final rects and report where each group sits.
`;

const designLibraryIcons = `# Skill: design-library-icons

Use when a design built from a repository needs that repository's own icons, or when the user asks to bring a repo's icon set onto the canvas.

## Find what is actually rendered
- List only the glyphs the work renders: the icon components the source imports, the names it passes to an icon wrapper, the \`.svg\` files it references. Bring in a whole set only when the user asks.
- Read icons from the repository's icon source, not from docs, screenshots or example folders.
- Icons can be stored as one \`.svg\` per glyph, as a sprite of \`<symbol>\` elements (each becomes a standalone \`<svg>\` with the sheet's shared defs and its own viewBox), or as path data rendered by a wrapper component. In the last case the wrapper decides viewBox, fill versus stroke and fill-rule; copy those, because a stroke path rendered as a fill becomes a blob.

## Bring them onto the canvas
- **Published sets:** if the repo uses lucide, Phosphor or Tabler, use get_icons with that set (lucide, ph, tabler) and the same glyph name, placed with \`<Icon name="set:name" />\`. Keep the repo's glyph names.
- **Repo-owned glyphs:** place the exact markup as an SVG image, \`<img src="data:image/svg+xml;base64,…" alt="…" />\`, sized like the source. Encode the markup unchanged; path data retyped by hand drifts. For many glyphs, write a small script outside the repository with run_terminal_command (or your own tools) to print the base64 strings.
- Single-color glyphs can follow a color token: bind their SVG color with bind_variables.
- Name each icon layer after the source glyph with rename_elements so design-to-code can map it back.

## Rules
- Icons come from one set with one stroke weight; never emoji, never a look-alike from another set.
- An icon you cannot bring in stays an empty labelled slot, and your reply says which and why. An animated icon comes in as its static frame; mention it.
`;

const designToCodePullRequest = `# Skill: design-to-code-pull-request

Use only when the user asked for a branch, a commit or a pull request for design work. Stop at the step they asked for: a commit request ends with a local commit, not a push.

## Branch and commits
- Work on the branch that is checked out. Do not create or switch branches unless asked; if the repository's conventions need another name, rename before the first push rather than publishing twice.
- Commit each logical change on its own with an imperative subject under 72 characters. Run the repo's checks with run_terminal_command before committing and report failures instead of hiding them.
- Follow the repository's own conventions (commit format, PR template, labels, contributing guide) wherever it has them.

## Pull request
- Base: an existing pull request's base when continuing it, otherwise the branch the user names, otherwise the repository's default branch.
- Push the checked-out branch under its own name without force (\`git push -u origin HEAD\` through run_terminal_command), then open it with \`gh pr create --base <base>\`. If a pull request already exists for the branch, return its link.
- Where the repo has no template, the body has three parts: **What changed** (one bullet per component, naming the artboard it came from), **Source** (the Verynize document and the base branch, new files marked), **Notes** (literals kept, parts left unmapped, substitutions).
- Redact anything in the design that looks like a credential and say so in the notes.

## Rules
- Never force-push or rewrite commits already on the remote unless the user asks.
- Never commit generated canvas artefacts (exports, screenshots) unless the user asked for them.
- Reply with the branch, the commits and the pull request link.
`;

const codeToDesignLibrary = `# Skill: code-to-design-library

Use together with code-to-design when the user wants a repository's component library on the canvas ("bring in our buttons and forms", "import packages/ui").

## Scope and inventory
- Scope from the request. On a large repo with no scope, bring in the foundation (tokens, icons) and primitives, say what you left for later, and offer to continue. Screens only when asked.
- Take the inventory first. Storybook stories, when present, are the component and variant list: each story export is a variant, with its args merged over the meta args. Also walk the component folders (\`src/components\`, \`ui\`, \`packages/*/src\`) for components without stories. A component is a repo file that exports markup; hooks, providers, utilities, pages and third-party imports are not.
- Variants come from \`cva\` or \`tv\` tables, prop unions and state selectors (\`hover:\`, \`focus-visible:\`, \`disabled:\`, \`data-state\`). A repo with a dark theme gets a light and a dark node per variant.

## Build order
1. Tokens (design-library) and repo icons (design-library-icons).
2. Primitives that import no other repo component, written from their source.
3. Each composite after everything it imports. A part used many times is built once, made a main component with create_component, and placed with create_instance; each instance's text and classes are adjusted with update_elements (those edits stay on that instance). A region whose children differ per use (\`children\`, a render prop) becomes a slot with set_slot.

## Organize
- One top-level artboard labelled "<Repo> Design Guide", a wide \`flex flex-col\` frame holding one "<Component> — Guide Section" frame per component, each with its variant and state nodes at natural size, no preview frame around them.
- Label library nodes "<Name> <Variant> - Reusable Component" in Title Case (for example "Button Primary Hover - Reusable Component") so find_elements can locate them; pages built from them are labelled "Page - <Name>".
- Screens the user asks for are their own artboards at viewport size, composed from library copies; anything a screen needs that the library lacks goes into the library first. Place them with new-design-arrange.

## Report
Counts (tokens, icons, components, variants, pages), what you left out and why, and parts with no source that you built new.
`;

const components = `# Skill: components

Use when a part repeats: an app shell (header, sidebar, content) around every screen of a product, a nav bar, a card, a list row, a button style used across artboards. A main component is the one definition; each instance is a full, linked copy that follows the main and keeps its own edits.

## When to make one
- Make a component when the same part appears on two or more screens or three or more times on one, and should change together. One-off sections stay plain layers.
- Build the part once and finish it (real copy, tokens, spacing) before making it a component; edits to the main reach every instance, so a rough main spreads roughness.
- Keep mains together on their own artboard or page ("Components"), labelled by role ("App Shell", "Pricing Card"), so they are easy to find and never mistaken for screens.

## Tools
- create_component {ids}: one frame becomes the main; several sibling layers are wrapped in a frame first.
- set_slot {id, name}: a frame inside the main becomes a slot, a content region every instance fills on its own (page content, a card body, a modal's form). Name slots by what goes in them ("Content", "Actions").
- create_instance {component, parent?, x?, y?, label?}: places an instance and returns its id and its slot ids. Without parent it becomes its own artboard.
- list_components lists mains with their slots and instances; with id it tells what a layer is (main, instance, inherited layer, slot, local layer) and which keys it overrides.
- reset_overrides {ids, all?} returns layers (or whole instances) to the main's values; on a slot it brings back the default content. detach_instance turns an instance into plain layers when it must stop following the main.

## How edits behave
- Edit the main (update_elements on its ids) to change every instance. Keys you change inside an instance become overrides and stay on that instance only; reset_overrides undoes them.
- Content added inside an instance belongs in a slot: insert into the slot id from create_instance (\`{/* insert as last child of SLOT_ID */}\`). The slot then shows that instance's own content. Layers added outside a slot stay local to that instance, and the update_elements report says so in its notes; prefer a slot.
- Deleting an inherited layer in an instance hides it there; delete it in the main to remove it everywhere.
- Duplicating a main with duplicate_elements gives an instance; duplicating an instance keeps its overrides and slot content.
- In JSX, \`data-component="true"\` marks a main, \`data-instance-of="<main id or name>"\` an instance and \`data-slot="Name"\` a slot. A new element written as \`<div data-instance-of="App Shell"><div data-slot="Content">…</div></div>\` is an instance whose Content slot holds what you wrote; other children of an instance element are ignored. A main cannot contain an instance of itself.

## App shell pattern
1. Build the shell once as an artboard: header (product name, nav), sidebar (sections), and a content frame with the page padding; flex layout, tokens, no fixed heights.
2. create_component on the shell, then set_slot on the content frame with name "Content" (leave a short default such as a heading there).
3. One instance per screen: create_instance with x/y laid out by new-design-arrange and a label per screen ("Dashboard", "Settings").
4. Fill each instance's Content slot with that screen's content; change the active nav item per screen with an edit in the instance (an override).
5. Shell changes go to the main and reach every screen; screenshot one instance after a main edit to check it still fits.
`;

const entries = [
  {
    name: "new-design",
    kind: "primary",
    summary:
      "Design something new from a prompt, a set of separate items, or up to 4 variations: brief → style → labelled skeleton → section-by-section with screenshots → review → finish.",
    supporting: [
      "new-design-references",
      "new-design-arrange",
      "generate-assets",
      "design-library",
      "components",
    ],
    body: newDesign,
  },
  {
    name: "edit-design",
    kind: "primary",
    summary:
      "Change, fix or give feedback on an existing design: diagnose from screenshot and code, change the minimum, preserve the direction, re-verify.",
    supporting: ["new-design-references", "design-library", "components", "design-review"],
    body: editDesign,
  },
  {
    name: "design-to-code",
    kind: "primary",
    summary:
      "Build a canvas design in the user's repository, reusing its components, tokens and icons, then check it with the repo's own tools.",
    supporting: ["design-to-code-pull-request", "design-library-icons"],
    body: designToCode,
  },
  {
    name: "code-to-design",
    kind: "primary",
    summary:
      "Reproduce a screen or component from the user's code on the canvas, tokens first, faithfully, then verify against the source.",
    supporting: ["code-to-design-library", "design-library-icons", "design-library", "components"],
    body: codeToDesign,
  },
  {
    name: "design-library",
    kind: "primary",
    summary:
      "Create, alias, bind, rename or extract design tokens, choose the icon set, and build a style guide or component sheet.",
    supporting: ["design-library-icons", "code-to-design-library"],
    body: designLibrary,
  },
  {
    name: "generate-assets",
    kind: "primary",
    summary:
      "Source imagery and artwork without an image model: stock photos, shader fills, hand-written SVG vectors, gradients and shapes.",
    supporting: ["new-design-arrange"],
    body: generateAssets,
  },
  {
    name: "design-review",
    kind: "supporting",
    summary:
      "Ten-point critique with 1–5 concrete fixes citing element ids; re-screenshot; max 3 repair iterations. Required before finish_artboard.",
    body: designReview,
  },
  {
    name: "new-design-references",
    kind: "supporting",
    summary:
      "Gather and cite references: examples, competitive analysis, unconventional directions, reference-backed critique.",
    body: newDesignReferences,
  },
  {
    name: "new-design-arrange",
    kind: "supporting",
    summary:
      "Place several artboards with data-component-x/y: flows in rows, variants in columns, 100px gaps, no overlaps.",
    body: newDesignArrange,
  },
  {
    name: "design-library-icons",
    kind: "supporting",
    summary:
      "Bring a repository's own icons onto the canvas: find rendered glyphs, map published sets to get_icons, embed repo SVGs unchanged.",
    body: designLibraryIcons,
  },
  {
    name: "design-to-code-pull-request",
    kind: "supporting",
    summary:
      "Commit design work and open a pull request only when asked, following the repo's conventions.",
    body: designToCodePullRequest,
  },
  {
    name: "components",
    kind: "supporting",
    summary:
      "Reusable parts: main components, linked instances with their own overrides, slots for per-instance content, and the app shell pattern (one shell main, one instance per screen).",
    body: components,
  },
  {
    name: "code-to-design-library",
    kind: "supporting",
    summary:
      "Import a repo's component library: inventory, build in import order, organize a design guide of reusable components.",
    body: codeToDesignLibrary,
  },
];

/** Old skill names that still resolve: alias → current skill. */
export const skillAliases = {
  variations: {
    target: "new-design",
    note: 'Variations are part of new-design now; follow its "Variations" section.',
  },
  "design-system": {
    target: "design-library",
    note: "design-system is now design-library; its style guide and component sheet steps are in section 5.",
  },
};

export const skills = Object.fromEntries(entries.map((e) => [e.name, e]));

const normalize = (name) =>
  String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-");

/** Resolve a skill name or alias to the canonical skill name, or null. */
export function resolveSkillName(name) {
  const key = normalize(name);
  if (skills[key]) return key;
  return skillAliases[key]?.target || null;
}

/**
 * Skill listing. Primary skills first, then supporting ones. With aliases (default) the old names are
 * appended as { name, kind: 'alias', aliasOf, summary } so existing references keep resolving.
 * @returns {{ name: string, kind: 'primary'|'supporting'|'alias', summary: string, supporting?: string[], aliasOf?: string }[]}
 */
export function listSkills({ aliases = true } = {}) {
  const out = entries.map(({ name, kind, summary, supporting }) => ({
    name,
    kind,
    summary,
    ...(supporting ? { supporting } : {}),
  }));
  if (aliases)
    for (const [name, { target }] of Object.entries(skillAliases))
      out.push({
        name,
        kind: "alias",
        aliasOf: target,
        summary: `Old name for ${target}; resolves to it.`,
      });
  return out;
}

export function getSkill(name) {
  const key = normalize(name);
  const target = resolveSkillName(key);
  if (!target)
    throw new Error(`Unknown skill "${name}". Available: ${entries.map((e) => e.name).join(", ")}`);
  const body = skills[target].body;
  return key === target ? body : `> ${skillAliases[key].note}\n\n${body}`;
}

/** Markdown for a get_skills call without a name. */
export function skillCatalog() {
  const primary = entries.filter((e) => e.kind === "primary");
  const supporting = entries.filter((e) => e.kind === "supporting");
  return `## Skills

Load the one skill that matches the job with get_skills {skill} before starting it, and follow it step by step. A quick text, color, spacing or icon tweak needs no skill.

### Primary (one per job)
${primary.map((e) => `- **${e.name}**: ${e.summary}${e.supporting.length ? ` Supporting: ${e.supporting.join(", ")}.` : ""}`).join("\n")}

### Supporting (a primary skill says when to load them)
${supporting.map((e) => `- **${e.name}**: ${e.summary}`).join("\n")}

Once a style is chosen or named, call get_design_guidelines {style}. Always run design-review before finish_artboard. Old names still work: ${Object.entries(
    skillAliases,
  )
    .map(([a, { target }]) => `${a} → ${target}`)
    .join(", ")}.`;
}
