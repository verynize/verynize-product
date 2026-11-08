# Wonder skills: catalog and remaining skills

Captured live 2026-10-30 (Wonder 0.2.190) via the Wonder app agent. Each section is the verbatim `get_skills` result.

The 5 skills already in `02-skills.md` (code-to-design, design-to-code, new-design, edit-design, design-library) were fetched again in the same run and match `02-skills.md` byte for byte, so they are not repeated here.

## get_skills {}

No skill was named. Call get_skills again with the skill below that matches the task.

Loads the instructions for one design job. Call it before a design task, including building a design in code, with the skill that matches:

- code-to-design: bring a screen or component from the user's code onto the canvas, or refresh one after the code changed.
- design-to-code: build a canvas design in the user's code.
- new-design: design a new screen, component, set of items or variations from a prompt.
- edit-design: change, fix or give feedback on an existing design beyond a quick text, color, spacing or icon tweak.
- design-library: create or change the file's design tokens or icon library.
- generate-assets: generate an image or an SVG, or vectorize an image.

A skill names the supporting skills it needs; load one by name when the work reaches it.

## get_skills {"skill": "generate-assets"}

# Generate Assets

Use this skill to generate a raster image, generate an SVG, or vectorize an image. Photos and other raster images come from generate_image, a new vector drawn from a description from generate_svg, and a vector traced from one supplied image from vectorize_image; offer generate_svg when the user wants a restyle rather than a trace.

An image the user asked for is the artifact: leave quality out, so it renders at "highest", unless they want something quick, then pass "default". An image placed inside a design (placeOnCanvas false) takes its tier from its footprint: "default" for cards, avatars and inline images, "high" for a hero or a full-width band, "highest" only for a background that covers the whole design. Higher tiers are slower and only add detail: the canvas tile stays about 1024px. Pick `aspectRatio` from the slot (`16:9` hero, `1:1` avatar, `9:16` portrait). When the user wrote the prompt or brief, pass their words verbatim. Write one yourself only when they gave none, gave only a vague request, or you are filling a slot in a design. To remix or match an image, pass it in `imageUrls`. Image generation and vectorizing read a reference image themselves, so hand them the image (one the user attached or selected, one generated earlier in this conversation, a search result, or an image URL in element code), never its description, and never run fetch_image_description on it first.

Generating an SVG and vectorizing an image are for an explicit request (an SVG, a logo, a mascot or an illustration; trace, vectorize or convert this image): each takes 30 to 90 seconds and a paid model call, places its own artboard and returns the dataNodeId to continue from. A design's own icons are not generated. Icons: the file's library (import { X } from 'wonder-icons'), else react-icons, imported at the top; never emoji. An SVG prompt names the subject, one style (flat, line art, isometric, geometric, hand-drawn), the stroke or fill treatment, the colours and the composition, for example "a smiling fox mascot facing forward, flat filled shapes without strokes, two-tone orange and cream, centred". Vectorizing traces one image as it is, with no prompt. Both need a specific Title Case `title` (`Walking Bear Logo`, not `Logo`).

An empty result with no error is transient: retry once, then reword the prompt or choose another source image.

## get_skills {"skill": "new-design-references"}

# Design References

Use this when the user asks for examples, inspiration, a competitive analysis or unconventional directions, or when real references would strengthen a critique. These jobs end in a chat reply, not artboards; designing from the result is the user's next pick.

Use your host's web search and browsing tools when you have them, and cite each reference by its link; without them, say so and mark what comes from your own knowledge.

Shape the reply to the ask:

- Examples: two to four named visual patterns, each with a one-line description and its references, then which patterns dominate.
- Competitive analysis: three to five products, including a leader, a challenger and one from an adjacent category, with a short summary, the shared patterns, the anti-patterns with evidence, and three to five recommendations ordered by impact.
- Unconventional directions: name the user's category and the underlying goal, look at two or three visually unrelated categories that solve the same goal (cockpits or video timelines for dashboard orientation), and give each idea as what the source does, why it works, and how it would look here.
- Critique of the user's design: compare against references after reading the design, and tie each suggestion to a reference. Give each finding as the element, the change and the design principle it serves, most important first.

Three sharp references beat ten loose ones. End by offering to apply a pattern or build a direction.

## get_skills {"skill": "design-review"}

# Design Review

After a page with several sections, a set of variations, or a change that spans several sections, restructures the layout or replaces the hero, review the result once with design-review and fix what it finds. Use it also when the user asks for a review. Look at a current screenshot of the artboard (take_screenshot when you have none) and its code (get_element_code, with get_element_tree for ids and find_elements to locate parts), and check it against the intent and the criteria below.

Sort what you find. Critical: a mismatch with the intent or plan, invisible or unreadable text or icons, text contrast below the minimum, distorted or badly cropped images, text overflowing its container, missing content. Fundamentals: hierarchy, clutter, spacing rhythm, generic type, the anti-patterns below. Polish: everything else. Fix the critical findings and the fundamentals that matter most, and polish only when it is cheap. When the design reproduces or builds on the user's code, a finding the source itself has (text contrast below the minimum, small type, a crowded layout) is not fixed: keep it as the code has it and report it to the user as a note, never drifting from the code. When you hold the edit tools, apply the fixes to the ids from your read. When you were handed the review as a delegated task without edit tools, return the fixes, critical first, for the conversation that built the design to apply. Give each finding as the element, the change and the design principle it serves, most important first.

## Criteria

- Intent: the design does what was asked and follows its brief or the style it matched. A loaded style's own treatments win over these defaults wherever they differ: its palette and grounds, type, textures and gradients, hero art, numbering and labels, layout spine, shadows, charts, and how much boldness it spreads. Readability never yields: contrast, legible sizes and realistic content hold in every style.
- Hierarchy: Each section has one focal element, built from size, weight and color together, and one fully saturated primary action; no two equal calls to action compete.
- Colour: Lead with one dominant hue and one sharp accent, spent on function. On a tinted ground, borders, secondary text and shadows take a shade of its hue, not gray. Skip palettes that read as generated: washed pastels, purple on white, purple-blue gradients, warm off-white with terracotta, red or neon, navy or charcoal with electric purple, lime or teal, earth tones on pure white, and a saturated accent on a tinted warm ground. Hero and anchor imagery is real photography of the product, its context or atmosphere: an Unsplash photo (an img from images.unsplash.com, or a bg-[url(…)]) or a generate_image image; a flat placeholder reads as a missing asset.
- Contrast: Text, button labels and secondary text included, reaches at least 4.5:1 against what it sits on in every style; below 16px it goes higher, and icons, SVGs and shapes stand off their surface as clearly. Reduced opacity and muted color are for a few elements, not everything that is not a heading.
- Composition: The first viewport is one composition: the brand, one headline, one supporting line, one primary action and one dominant visual; stats, logo clouds and badges live below. Each section has one job, one headline and one takeaway; a section doing two jobs becomes two.
- Spacing: Hold one spacing rhythm per artboard: consistent page-edge and card padding across similar containers, and sections separated by section padding, not inner margins.
- Type: Three type tiers per section, running text in a measure of about 60 to 70 characters, and nothing at 12px or below outside dense data or deliberate uppercase labels. The family is distinctive and the punctuation typographic.
- Images: Images keep their proportions and focal point, and a grid of images shares one ratio. Text over an image stays readable.
- Icons: Icons come from one set with one stroke weight and fill convention, sized to their text and equal across siblings.
- Repeats: Repeated items in a new design (cards, rows, features) are one .map() over an inline data array in a single insert, with the layout classes on the div that wraps it.
- Overflow and alignment: no clipped or orphaned text, and grids that tile with no dead cell. Siblings (pricing tiers, product tiles, list rows) share one treatment and align their actions; only the one item a brief or style features stands out, and it keeps the same structure.
- Refinement and clutter: Every shadow and highlight on an artboard shares one light direction. Nested radii are concentric: a child inside a padded parent takes the smaller radius. Structure tells the truth: cards hold things people act on or choose (a product, a plan, a file), numbered markers appear only for a real sequence, and a heading and paragraph sit directly on the section, unless the style makes its cards or its numbering the signature. Copy that could lose a third loses it, and no layout repeats in every section.
- Content: Content is realistic and specific: plausible names, prices and figures, varied and slightly organic rather than round, with no lorem ipsum or invented precision; a design tool shown as an example is Wonder unless the brief names one. Data surfaces have their empty and error states.

## Fidelity to the source

When the design reproduces or builds on the user's code, also check it against the source:

- Structure, text and the labelled variant or state match the source.
- Values the repo tokenizes use the file token (`var(--…)`, or the font hint form), not a literal that shadows it, and the type uses the repo's real fonts.
- Repo-owned icons are bound library icons. Icons: the file's library (import { X } from 'wonder-icons'), else react-icons, imported at the top; never emoji. A glyph from an installed icon package or a set the user names (Lucide, Feather, Font Awesome, Heroicons, Phosphor, Tabler, Radix, Material, Bootstrap, Simple Icons) comes through its react-icons subpackage with its name kept, never as copied svg markup; an inline svg is only for artwork no icon set covers.
- Repeated parts appear as many times as the source renders them. Copies of a component the source code reuses, and more copies of an element already on the canvas, are built once and placed with one duplicate_elements call whose propertyOverrides vary each copy's text and className; never write the same element out by hand at each place.

A difference the renderer causes, or a substitution already reported (an unavailable font, an image that could not be imported), is a note rather than a fix.

## get_skills {"skill": "new-design-arrange"}

# Arranging Artboards

Use this when you place more than one artboard or tidy existing ones. An artboard's placement is its root's data-component-x and data-component-y, always together: the top-left corner in page pixels (x grows right, y grows down, the canvas home is 0,0 and negative values are fine), within ±125,072 on each axis. Without them a new artboard lands 100px right of the right-most one, the right default for a single design. A lone axis or a value outside ±131,072 is dropped rather than refused, and a spot on top of another artboard, checked at the size it is created at, moves right until it overlaps nothing; the result says where it landed, so place the next one from there. A scaled or rotated artboard is reported at its visual corner. Put them on the root in create_artboard, or move an artboard with an edit of its root that carries only those two attributes. On an empty page, create the first one without placement and place the rest relative to it.

Read every rect with get_artboards before computing positions. A null x, y, width or height is unknown, not zero: the editor has not measured that artboard yet, so read it again with get_artboards once it has rendered. Until then, an unknown width reaches without limit to the right and an unknown height without limit below, and when a position stays unknown on a re-read, let new artboards place themselves.

- Neighbours in a group sit 100px apart.
- Screens of one flow form one row in navigation order with their tops aligned: the next x is the previous x plus its width plus 100.
- Variants or states of one screen form one column with their left edges aligned.
- Many same-size items with no order form a grid of three to five columns.
- A new group starts at least 300px below everything else, aligned with the left-most artboard; its caption is a small text artboard 40px above it, never a frame around it.
- Nothing overlaps: check each computed rect against every existing one; a move is applied exactly as given.
- When tidying, keep the user's anchor artboard fixed and move only the group you were asked to arrange.

## get_skills {"skill": "design-library-icons"}

# Repository Icons

Import only the glyphs the work renders, listed from the source (the icon components it imports, the names it passes to an icon wrapper, the .svg files it references), from the repository's own icon source rather than docs, screenshots or example art; a whole set only when the user asks. `docs/`, `images/`, `screenshots/` and `examples/` hold documentation art. A repo with no `.svg` files keeps its icons in another shape:

- One `.svg` file per icon.
- Many complete `<svg>` or `<symbol>` glyphs in one file, such as a sprite sheet or a module of markup strings. A `<symbol>` becomes a standalone `<svg>` with the sheet's shared `<defs>` and its own `viewBox` (the sheet's when it has none).
- Path data in one file plus a component that renders it. That component decides the wrapper: its `viewBox` per size, `fill="currentColor"` or `stroke="currentColor" fill="none"` per record, and its `fill-rule`. A stroke record rendered as a fill becomes a solid blob, and data that exists only at a larger size needs that size's `viewBox`.

Read the files and pass their markup to create_icons in batches of 20. For path data, a file too large to read whole, or many files, write a short script outside the repository with the runtime the repo already uses: it loads the repo's data for the listed glyphs, wraps each as the rendering component does, and prints `[{"name": "…", "svg": "<svg …>…</svg>"}]` batches split at 20 icons or 400000 characters. Pass each batch unchanged. Icon markup goes in exactly as its source holds it: path data typed back by hand drifts. Bind an icon by the componentName the catalog returns, never one built from its name: a name collision adds a suffix and a rename changes it, so read the names back after creating, importing or renaming icons. A source asset you cannot bring in (an image, an icon, a font) stays an empty slot or a declared fallback, never a look-alike or a stock stand-in: act on each reason the result gives, and name in your reply what is still missing and why. An animated icon imports as its static frame, which your reply mentions.

## Icon sets

A glyph from an installed icon package or a set the user names (Lucide, Feather, Font Awesome, Heroicons, Phosphor, Tabler, Radix, Material, Bootstrap, Simple Icons) comes through its react-icons subpackage with its name kept, never as copied svg markup; an inline svg is only for artwork no icon set covers. Lucide `bell-dot` is `LuBellDot`:

| Set                     | Prefix | Import from       |
| ----------------------- | ------ | ----------------- |
| Lucide (`lucide-react`) | `Lu`   | `react-icons/lu`  |
| Feather                 | `Fi`   | `react-icons/fi`  |
| Font Awesome 6          | `Fa`   | `react-icons/fa6` |
| Material                | `Md`   | `react-icons/md`  |
| Bootstrap               | `Bs`   | `react-icons/bs`  |
| Heroicons v2            | `Hi`   | `react-icons/hi2` |
| Phosphor                | `Pi`   | `react-icons/pi`  |
| Tabler                  | `Tb`   | `react-icons/tb`  |
| Radix                   | `Rx`   | `react-icons/rx`  |
| Simple Icons (brands)   | `Si`   | `react-icons/si`  |

`react-icons/hi` and `react-icons/fa` are the older Heroicons v1 and Font Awesome 5, so v2 and v6 names resolve only from `hi2` and `fa6`.

## get_skills {"skill": "design-to-code-pull-request"}

# Opening a Pull Request

Use this when the user asked for a branch, commit or pull request for design work, and take the steps they asked for: a branch or commit request ends with the local branch or commit.

You are on this worktree's own branch: commit there, create or switch no branch, and rename it only for a push the user asked for. Push the checked-out branch under its own name (git push -u <remote> HEAD); if the repository's conventions need another name, rename it with git branch -m before the first push rather than publishing it under a second name.

Use an existing pull request's base when continuing it. Otherwise use the branch the user names, the `Connected repository:` line's branch, or the repository's default branch. Commit each logical change on its own, with an imperative subject under 72 characters and the trailer `Exported-from: Wonder`. When the user asked for a pull request, push the work branch without force and open it with `gh pr create --base <base>`; when one already exists for the branch, return its link.

Follow the repository's own commit and pull request conventions (title format, description template, labels, contributing guidelines) wherever it has them; Wonder's format applies only where it has none. A pull request body has `## What changed` (one bullet per component, naming the artboard it came from), `## Source` (the Wonder file and base branch, with new files marked) and `## Notes` (literals kept, unmapped parts, substitutions). Redact anything in the design that looks like a credential and say so in the notes.

## get_skills {"skill": "code-to-design-library"}

# Importing a Component Library

Use this together with code-to-design when the user wants the repo's component library on the canvas. Scope it from the request: "our buttons and forms" or `packages/ui` is the scope. On a large repo with no scope given, bring in the foundation and the primitives, say what you left for later, and offer to continue. Screens are part of the job only when the user asks for them.

Take the inventory before building. When the repo has Storybook, its stories are the component and variant list: each named story export is a variant, with its props from the story's `args` merged over the meta `args`. Walk the component folders too (`src/components`, `ui`, feature folders, `packages/*/src` in a monorepo) to catch components without stories. A component is a file of this repo that exports markup; hooks, providers, utilities, pages, tests and third-party imports are not. Variants come from `cva` or `tv` tables, prop unions and stateful selectors (`hover:`, `focus-visible:`, `disabled:`, `data-state=`), and a repo with a dark theme gets a light and a dark node per variant. A library node is labeled <Name> <Variant> - Reusable Component in Title Case (Button Primary Hover - Reusable Component), and a page composed from the library Page - <Name>. A library import may nest its nodes in one top-level <repo name> Design Guide artboard, one <Component> — Guide Section frame per component, because each node keeps its own label and size and find_elements finds every Reusable Component wherever it sits.

Build in import-graph order: the tokens and repo-owned icons first, then primitives that import no other component of the repo, then each component after everything it imports. Primitives are written from their source. Copies of a component the source code reuses, and more copies of an element already on the canvas, are built once and placed with one duplicate_elements call whose propertyOverrides vary each copy's text and className; never write the same element out by hand at each place. One `Button` serves every card and form that uses it, and a part the code repeats without extracting it (a `.map()` over cards, three sibling rows of one shape) is built at its first call site; when the copies hold different children, keep the shared chrome with a labelled empty slot such as `Card Widget Slot` and fill each copy's slot.

Organize the library in that design guide: the top-level artboard is a wide `flex flex-col` frame, each Guide Section holds its component's state nodes, and each node stays sized to the component, with no preview frame around it.

When the user asked for screens, build each as its own artboard at the viewport size, composed from the library with duplicate_elements and per-instance patches. A component a screen needs that the library lacks goes into the library first. Library nodes stay where they are; the pages are made from them.

Reply with the counts (tokens, icons, components, variants, pages), what you left out and why, and the parts with no source that you built new.
