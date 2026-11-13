<!-- get_design_guidelines {"style": "botanical"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Botanical / Organic Serif

A botanical garden, a ceramics studio and an editorial spread in one: soft, tactile, artisanal, the calm of high-end wellness and sustainable luxury. Shapes flow like water-smoothed stones, high-contrast serifs lead, and the grid is gently broken.

**Palette.** Every color comes from nature: forest floor, clay pots, sage, stone, terracotta.

- Ground `#F9F8F4` rice paper; cards and inputs `#F2F0EB` or white; secondary fills `#DCCFC2` clay.
- Text `#2D3A31` deep forest green in place of black; borders `#E6E2DA` stone, 1px and quiet.
- Sage `#4F5C49` is the interactive color (secondary buttons, icons, highlights); terracotta `#C27B66` is the occasional emphasis.
- Tokens the examples bind: `--card` #F2F0EB, `--forest` #2D3A31, `--forest-shadow` rgba(45,58,49,0.05), `--sage` #4F5C49, `--white` #FFFFFF.

**Type.** Headings `Playfair Display` 600/700 at `text-5xl`–`text-8xl`, with single words set in italic for a personal, handwritten touch ("Grown with _care_"). Body `Source Sans 3` 400/500 at `text-lg leading-relaxed`. Button text `uppercase tracking-widest text-sm`.

**Shape and depth.** Cards `rounded-3xl`, buttons `rounded-full`, images arched (`rounded-t-full` or `rounded-[200px_200px_0_0]`) or `rounded-[40px]`. Shadows are forest-tinted and faint: `shadow-[0_4px_6px_-1px_var(--forest-shadow)]`, up to `shadow-[0_20px_40px_-10px_var(--forest-shadow)]` for lifted cards. `backdrop-blur-sm` on overlay cards such as a quote over the hero image.

**Components.** Primary button `rounded-full bg-[var(--forest)] text-[var(--white)] uppercase tracking-widest text-sm`; secondary `rounded-full border border-[var(--sage)] text-[var(--sage)]`. Cards `bg-[var(--card)] rounded-3xl p-8`–`p-10`, bordered in stone or borderless. Inputs are either a bottom border only or a `bg-[var(--card)] rounded-full` pill. Thin Feather icons in forest or sage float freely or sit in pale circles.

**Signature moves.**

- Arch-topped images, the most recognizable element of the style.
- A paper-grain overlay on the page at `opacity-[0.015]`. A noise overlay is one pointer-events-none absolute inset-0 layer over the whole artboard holding an SVG feTurbulence filter (type="fractalNoise", base frequency about 0.8, 4 octaves); the style sets its opacity and any blend mode.
- Staggered cards: every second card in a row sits lower with `translate-y-12`; images rotate a degree or two.
- Large serif headlines slightly overlap an image or background shape.
- Fine 1px vine lines curve between sections.

**Layout.** `max-w-7xl`, sections `py-24`–`py-32`, gaps `gap-8`–`gap-16`. Features in three columns, stats in two or four.
