***

## get_skills {"skill": "code-to-design"}

# Code to Design

Use this skill to bring a screen, view or component from the user's code onto the canvas, or to refresh one after the code changed. The result is a faithful reproduction of what the current code renders, built from the repo's own tokens, icons and images.

- A whole component library, or "bring in our buttons, inputs and cards": load code-to-design-library as well.
- Repo-owned icons the view renders: load design-library-icons for how each storage shape imports.

## Reading the code

Read the user's checkout with your own file tools (Read, Glob, Grep), skipping `node_modules/`, `dist/`, `build/`, `.next/` and `.svelte-kit/`. When no checkout is available, ask the user where the code is.

The code as it is now is the reference. A README screenshot, a mockup, or what a component usually looks like is not, and when they disagree with the code, the code wins. Every value, variant and label you write traces to a read from this session, so re-read a file whose content has left your context instead of recalling it.

## Reproducing a view

1. Map the view: its entry file, the sections it renders top to bottom, the components it imports and which of them appear more than once, and the styling source (Tailwind config or `@theme`, `:root` custom properties, theme objects). Check the canvas for reusable nodes already built from this repo as well, and place one with duplicate_elements instead of rebuilding it. A library node is labeled <Name> <Variant> - Reusable Component in Title Case (Button Primary Hover - Reusable Component), and a page composed from the library Page - <Name>. A library import may nest its nodes in one top-level <repo name> Design Guide artboard, one <Component> — Guide Section frame per component, because each node keeps its own label and size and find_elements finds every Reusable Component wherever it sits.
2. A design built from the user's code brings in the repo's own tokens and repo-owned icons it needs, with their exact values and markup, before drawing and without a separate ask. Check the file's tokens and icon catalog before adding to them, and reuse a match by value and by role instead of adding a near-duplicate or a literal beside it. Create the missing tokens with the repo's own name and exact value, a `rem` converted at the repo's root font size. A color pasted verbatim from its source, in its own format: hex ("#316FF6"), rgb(), hsl(), oklch() or a CSS named color. Where the source layers semantic names over a raw palette, keep both layers: create the raw token first, then the semantic token as its alias, never flattening the reference to its resolved value. A glyph from an installed icon package or a set the user names (Lucide, Feather, Font Awesome, Heroicons, Phosphor, Tabler, Radix, Material, Bootstrap, Simple Icons) comes through its react-icons subpackage with its name kept, never as copied svg markup; an inline svg is only for artwork no icon set covers.
3. Size the artboard to what it holds. A page or screen takes a standard viewport (1440×900 desktop, 1200×800 laptop, 390×844 mobile, or the one its source code targets) with a matching min-h-[<viewport height>px] floor on the root and grows with its content, never a fixed root h-[…]. A fixed format (a slide, a social post, a poster) keeps its size instead: its root is fixed at the format's w-[…] and h-[…] (a 16:9 slide is 1280×720), its content is fitted inside, and you say when it does not fit. A single component, or one item of a set, is its own artboard at its natural size with the component as the root, and no floor.
4. Build from the live source, translated as described below, at the cadence update_elements describes. Copies of a component the source code reuses, and more copies of an element already on the canvas, are built once and placed with one duplicate_elements call whose propertyOverrides vary each copy's text and className; never write the same element out by hand at each place. Build the first copy at its first call site.
5. Compare a screenshot of the result with the source and fix what differs in structure, order, colour, spacing and type.
6. Reply with what you reproduced, the repo and branch you read, and the parts you built new. A source asset you cannot bring in (an image, an icon, a font) stays an empty slot or a declared fallback, never a look-alike or a stock stand-in: act on each reason the result gives, and name in your reply what is still missing and why.

## Translating the source

Markup: div; span for all text; img (stock photos: images.unsplash.com); svg inside a labeled div, no text in it. Static Tailwind className (no md:/lg:). A Title Case data-node-label on every element. The canvas resolves Tailwind utilities and this file's tokens and nothing else. Colour: a file token's cssVar, created first if none holds the value; a literal or palette class only if the user asks. Other values a token holds use its cssVar too. Translate each source class by what it is:

- A Tailwind utility (`flex`, `px-7`, `items-center`, an arbitrary `[…]` size) is copied as written.
- A class bound to a repo token (`bg-primary`, `text-foreground`, `bg-[hsl(var(--background))]`, a radius or spacing step from the theme) becomes the file token's `cssVar`. Write a token by copying its cssVar exactly as the token read returns it: token brand/primary is var(--brand-primary), never var(--brand/primary), which does not resolve. Colors, spacing, sizes and radii bind in arbitrary values (bg-[var(--brand-primary)], gap-[var(--space-2)], rounded-[var(--radius-lg)]); margins stay literal because they have no binding. Font tokens take a type hint: font-[family-name:var(--font-sans)], font-[number:var(--weight-semibold)].
- A class the repo styles in its own CSS (`@layer components` with `@apply`, a CSS module, SCSS, BEM) does not exist on the canvas and would render unstyled. Read its definition and write the utilities it expands to onto the element: `button button--secondary` becomes `inline-flex h-9 items-center justify-center rounded-md px-3 bg-[var(--surface)]`.
- Type uses the repo's real font family and weights through font tokens.
- Responsive and state classes resolve to the breakpoint and state the artboard shows: at 1440px wide `md:grid-cols-3` is `grid-cols-3`, and a Disabled node flattens `disabled:opacity-50` to `opacity-50`.

Keep the source's structure, text, labels and var() references exactly as written, including its display transforms; a value that looks off is reproduced as it is. An enum value under `first-letter:uppercase` shows as `Active`. Variants and states come from the code (`cva` or `tv` maps, prop unions, stories, `hover:` and `data-state` selectors); improving a value is a later edit the user can ask for.

A repo-owned image (a logo, hero photo or illustration) is part of the reproduction. prepare_image_upload returns a single-use upload URL: PUT the original file's bytes to it and use the `imageUrl` it returns. Avatars and logos never load from external URLs.

---

## get_skills {"skill": "design-library"}

# Design Library

Use this skill when the work is the file's design tokens (variables in the UI) or its icon library: reading, creating, renaming, aliasing or deleting them, extracting them from a design, importing a repository's foundation, or binding them in designs. For a repository's own icons, load design-library-icons as well.

## The file's system

A token or library icon is one definition with many bound uses: changing it restyles every element bound to it on every page, other designs included. Change the definition only when the user wants the change everywhere, and ask first when a restyle would need a token other designs use. Check the file's tokens and icon catalog before adding to them, and reuse a match by value and by role instead of adding a near-duplicate or a literal beside it. Colour: a file token's cssVar, created first if none holds the value; a literal or palette class only if the user asks. Other values a token holds use its cssVar too. Rename or delete tokens and icons only when the user asks, and add an icon only when the user asks or a design built from their code needs it. A design built from the user's code brings in the repo's own tokens and repo-owned icons it needs, with their exact values and markup, before drawing and without a separate ask. Name for the role, grouped with `/`: `brand/primary`, `space/md`, `radius/lg`, `font/heading`, `arrows/left`, `status/warning`. Where the source layers semantic names over a raw palette, keep both layers: create the raw token first, then the semantic token as its alias, never flattening the reference to its resolved value.

Deleting a token or icon unbinds its uses: bound elements keep the last value or markup and stop updating, and tokens aliased to a deleted token fall back to its value.

## Binding in markup

Write a token by copying its cssVar exactly as the token read returns it: token brand/primary is var(--brand-primary), never var(--brand/primary), which does not resolve. Colors, spacing, sizes and radii bind in arbitrary values (bg-[var(--brand-primary)], gap-[var(--space-2)], rounded-[var(--radius-lg)]); margins stay literal because they have no binding. Font tokens take a type hint: font-[family-name:var(--font-sans)], font-[number:var(--weight-semibold)].

Bind a library icon by importing it from `wonder-icons`: `import { ArrowsLeft } from 'wonder-icons'` with `<ArrowsLeft size={16} className="text-[var(--content-primary)]" />`. Bind an icon by the componentName the catalog returns, never one built from its name: a name collision adds a suffix and a rename changes it, so read the names back after creating, importing or renaming icons. A `currentColor` icon takes the text colour around it, and a bound instance reads back as the component or as an `<svg>` with `data-wonder-icon-id`. wonder-icons imports and Wonder's own var(--…) token names exist only inside Wonder: never write them into code the user ships.

When the library has no match and the design is not built from a repository, react-icons covers generic glyphs. A glyph from an installed icon package or a set the user names (Lucide, Feather, Font Awesome, Heroicons, Phosphor, Tabler, Radix, Material, Bootstrap, Simple Icons) comes through its react-icons subpackage with its name kept, never as copied svg markup; an inline svg is only for artwork no icon set covers. design-library-icons has the table.

## Reading and changing

get_design_tokens lists the tokens with their `cssVar`. create_design_tokens applies its list in order, raw tokens before the semantic tokens that alias them; update_design_tokens changes values, aliases and names; delete_design_tokens removes. get_icons lists the icon catalog, with markup for the `names` you pass; create_icons reports `created`, `skipped` duplicates and `errors`; update_icons renames and re-keywords; delete_icons removes.

To extract tokens from an existing design, look for the values that recur (a colour in several places, a repeated spacing step, the heading and body fonts, a shared radius), create them, then rewrite each element that used a value to reference its token, so editing the token restyles the design.

When a repository value meets a file token of the same name and a different value, keep the user's token and name the conflict in your reply; a token with another name and the same value is reused.

---

## get_skills {"skill": "design-to-code"}

# Design to Code

Use this skill when the user wants a canvas design built in their code: "implement this design", "build this screen in the app", "code up the selected card".

Read the design with get_element_code on the narrowest element that covers the request, with a take_screenshot when you need the look as well as the structure. Before changing anything, read the code the feature lives in: the route or parent that will render it, the components it already imports, and the styling source.

## Reading the code

Read the user's checkout with your own file tools (Read, Glob, Grep), skipping `node_modules/`, `dist/`, `build/`, `.next/` and `.svelte-kit/`. When no checkout is available, ask the user where the code is.

The code as it is now is the reference. A README screenshot, a mockup, or what a component usually looks like is not, and when they disagree with the code, the code wins. Every value, variant and label you write traces to a read from this session, so re-read a file whose content has left your context instead of recalling it.

## Mapping the design

Map every part of the design to code before writing:

- Look up any other distinct part (a button, input, card, badge or menu item) in the repo by name and by role, starting from the feature's imports.
- Layout wrappers and sections are written in the repo's own layout idiom.

Then wire it in: real props, data, state, handlers and routes, and the repo's loading, empty and error states in place of the design's sample arrays and fixed copy. Follow the file's formatting, import style and naming, and change only the lines the design needs.

## Values and icons

Write every value in the repo's own form, never in Wonder's:

- A Wonder token reference such as `var(--brand-primary)` maps back to the repo expression its value came from, written the way the repo writes it: the theme utility (`bg-primary`), the custom property (`hsl(var(--background))`) or the theme path (`theme.palette.primary.main`). Join the file's token list with the repo's styling source to find it.
- A literal (`bg-[#2563eb]`, `p-[16px]`) maps to the repo token or scale step with that value (`bg-blue-600`, `p-4`); search the config for the value. Keep a literal only where the repo has no token for it, and list those in your reply.
- A library icon (`import { ArrowsLeft } from 'wonder-icons'`) maps to the repo's own reference for that glyph: its icon package import, its `<Icon name="…">` wrapper or its `.svg` asset. get_icons with `names` returns the markup when the name alone does not identify the glyph. A react-icons glyph maps to the same glyph in the icon package the repo uses: `LuSearch` becomes `Search` from `lucide-react`.

wonder-icons imports and Wonder's own var(--…) token names exist only inside Wonder: never write them into code the user ships. Use react-icons in the repo's code only when the repo already uses it.

## Scope

Edit the files in place with small, exact replacements and leave them uncommitted unless the user asked for a branch, commit or pull request; then load design-to-code-pull-request. Compare the result with the design and fix what differs.

Reply with your edits, the components you reused or extended, each new component with its reason, and the values left as literals.

---

## get_skills {"skill": "edit-design"}

# Edit Design

Use this skill to change an existing design beyond a quick text, colour, spacing or icon tweak (those you apply directly), to fix a visual problem the user reports, or to give feedback on a design. Several alternatives to compare side by side are variations, in new-design.

## Changing a design

A substantive change lands on the duplicate your instructions call for, and its returned tree gives the ids you edit. The user may edit between turns: before your first edit or replace of an element in a turn, read its code with get_element_code and keep what the request leaves alone. Change elements where they are (`edit` for attributes, `replace` for a restructure) rather than inserting a new version beside the old.

Restyle the elements you are changing by binding them to the file's tokens. Colour: a file token's cssVar, created first if none holds the value; a literal or palette class only if the user asks. Other values a token holds use its cssVar too. A token's value is shared by every element bound to it, the original and other designs included, so change a token itself when the user asks for the change everywhere, and ask first when a restyle would need a token other designs use. Icons: the file's library (import { X } from 'wonder-icons'), else react-icons, imported at the top; never emoji. A glyph from an installed icon package or a set the user names (Lucide, Feather, Font Awesome, Heroicons, Phosphor, Tabler, Radix, Material, Bootstrap, Simple Icons) comes through its react-icons subpackage with its name kept, never as copied svg markup; an inline svg is only for artwork no icon set covers.

For a reported problem, look at a screenshot of the area and read its code, find the cause (often hierarchy, spacing rhythm, contrast or an image that did not load) and fix that.

## Feedback and review

For feedback, look at a screenshot and the structure, then give one to five concrete improvements. Give each finding as the element, the change and the design principle it serves, most important first. The principles are hierarchy, spacing, type, colour, contrast, composition, clutter and content. Load new-design-references when real-world references would strengthen them. Apply the ones the user picks.

After a page with several sections, a set of variations, or a change that spans several sections, restructures the layout or replaces the hero, review the result once with design-review and fix what it finds.

---

## get_skills {"skill": "new-design"}

# New Design

Use this skill to design something new from a prompt: a page, screen, dashboard or flow, a single component, a set of separate items (logo options, states, illustrations, one artboard each), or variations of an existing design. For examples, inspiration or competitive research, load new-design-references; to place several artboards, load new-design-arrange.

## Choosing the look

Decide where the look comes from before building:

- A style brief from the user (a named aesthetic, adjectives, a palette, a font) leads whenever there is one.
- A repository behind this design (one connected to the file, or the checkout you work in when it holds this product's UI) supplies the tokens, fonts and components, reproduced as code-to-design describes.
- Otherwise the canvas: when its artboards share a visual language (palette, type, spacing, radii, theme), the new design adopts it even for a different kind of screen, so a login page on a canvas of dashboards looks like those dashboards. Read a few representative artboards with get_element_code for their exact values. An empty canvas, or one with no shared language, gives you a free hand.
- With a free hand, pick a design style, load it with get_design_guidelines, and commit to a short brief: register, mood, palette roles with values, type pairing, layout and imagery. A short, vague request on an empty canvas gets one design executed exceptionally rather than several done adequately, and an offer to adjust.

Colour: a file token's cssVar, created first if none holds the value; a literal or palette class only if the user asks. Other values a token holds use its cssVar too. Check the file's tokens and icon catalog before adding to them, and reuse a match by value and by role instead of adding a near-duplicate or a literal beside it. Rename or delete tokens and icons only when the user asks, and add an icon only when the user asks or a design built from their code needs it. A design built from the user's code brings in the repo's own tokens and repo-owned icons it needs, with their exact values and markup, before drawing and without a separate ask. Icons: the file's library (import { X } from 'wonder-icons'), else react-icons, imported at the top; never emoji. The design-library skill has the mechanics. Hero and anchor imagery is real photography of the product, its context or atmosphere: an Unsplash photo (an img from images.unsplash.com, or a bg-[url(…)]) or a generate_image image; a flat placeholder reads as a missing asset. Generated SVGs and vectorizing are for explicit requests; generate_image photographs are not.

## Building

The canvas is a whiteboard: one artboard holds one design. A set of separate items (options, concepts, logos, icons, illustrations, empty states, a component's states or variants, moodboard images) is one artboard per item, sized to that item and laid out side by side, never wrapped in a board, sheet, showcase or page frame and never given a page skeleton, title header or viewport. A group's caption is its own small text artboard. One frame holds several items only when the user asks for one composed piece (a slide, a poster, a diagram) or a library import's Design Guide nests them.

Size the artboard to what it holds. A page or screen takes a standard viewport (1440×900 desktop, 1200×800 laptop, 390×844 mobile, or the one its source code targets) with a matching min-h-[<viewport height>px] floor on the root and grows with its content, never a fixed root h-[…]. A fixed format (a slide, a social post, a poster) keeps its size instead: its root is fixed at the format's w-[…] and h-[…] (a 16:9 slide is 1280×720), its content is fitted inside, and you say when it does not fit. A single component, or one item of a set, is its own artboard at its natural size with the component as the root, and no floor. A full mobile screen designed from scratch starts with the phone status bar the design fundamentals describe.

A page with several sections starts as a two-level skeleton: the root holds one placeholder div per section, and each section holds placeholder divs for its parts, all sized and laid out (w-, h-, min-h-, flex, grid, gap) with no visual style and a specific Title Case label each that names the part it becomes (Plan Columns, never Plan Columns Skeleton), so the user sees the structure while you build. When unsure whether it is a component or a page, add the skeleton. The directives that build a section replace or delete its skeleton placeholders, so none survives next to real content. The result lists each id you removed or replaced. Swap the guessed placeholder sizes for real sizing as you go: text in `h-fit` rows, cards as `flex-1 h-fit`.

Repeated items in a new design (cards, rows, features) are one .map() over an inline data array in a single insert, with the layout classes on the div that wraps it. Use realistic content.

After a page with several sections, a set of variations, or a change that spans several sections, restructures the layout or replaces the hero, review the result once with design-review and fix what it finds.

## Variations

A variation is a copy of the original placed as its own artboard (duplicate_elements with newArtboard true) and changed there, so it sits beside the original for comparison and never replaces it. Make up to four, and make each a different designer's answer: a different colour family, a contrasting type category, a different layout composition and a different component styling (borders, shadows, radii), all at once, with no two variations sharing an approach. A constraint from the user ("same layout, new colours") limits the change to what they named. When the user finds the variations too similar, build the next ones fresh from the original's content instead of reshaping its structure. On a file built from a repository, keep one variation faithful to the repo's system and name the others as departures from it.
