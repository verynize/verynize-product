<!-- get_design_guidelines {"style": "luxury"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Luxury / Editorial

A high-end fashion magazine or a luxury house website (Vogue, Kinfolk, Aesop): exquisite type at dramatic scale, more negative space than feels comfortable, and intentional asymmetry that keeps architectural balance. Expensive paper you want to touch.

**Palette.** Monochrome with gold as the only accent.

- Ground `#F9F8F6` warm alabaster; alternate sections `#EBE5DE` taupe or inverted to `#1A1A1A`.
- Text `#1A1A1A` charcoal; secondary text `#5C5853`; on dark sections, text at 60–80% opacity.
- Lines in charcoal: full strength for strong rules, 10–20% for quiet dividers.
- Gold `#D4AF37` for underlines, italic words and fine details, never dominant.
- Tokens the examples bind: `--button-shadow` rgba(0,0,0,0.15), `--card-shadow` rgba(0,0,0,0.02), `--charcoal` #1A1A1A, `--gold` #D4AF37, `--image-frame` rgba(0,0,0,0.06), `--image-shadow` rgba(0,0,0,0.12), `--white` #FFFFFF.

**Type.** Headings `Playfair Display` 300/400 at `leading-[0.9]`–`leading-tight`, alternating regular and italic for spoken cadence ("Curated _Excellence_", italic words optionally gold). Body `Inter` 400, buttons 500. Hero `text-6xl`–`text-9xl`, sections `text-5xl`–`text-7xl`, paired with tiny uppercase labels (`text-xs`, metadata `text-[10px]`) at `tracking-[0.25em]`–`tracking-[0.3em]`. Intro paragraphs open with a Playfair drop cap `float-left text-7xl leading-[0.8] mr-3`.

**Shape and depth.** Square corners and 1px lines throughout, single-sided (`border-t`, `border-b`) rather than full boxes; short `h-px w-8` rules before labels. Shadows are whisper-soft: hero image `shadow-[0_8px_32px_var(--image-shadow)]`, cards `shadow-[0_2px_8px_var(--card-shadow)]`, images framed with `shadow-[inset_0_0_0_1px_var(--image-frame)]`. A paper-grain overlay at 2% opacity covers the page. A noise overlay is one pointer-events-none absolute inset-0 layer over the whole artboard holding an SVG feTurbulence filter (type="fractalNoise", base frequency about 0.8, 4 octaves); the style sets its opacity and any blend mode.

**Components.**

- Buttons rectangular, uppercase `text-xs tracking-[0.2em]`, `h-12 px-8`–`px-10`: primary `bg-[var(--charcoal)] text-[var(--white)] shadow-[0_4px_16px_var(--button-shadow)]` with an optional gold overlay span under a `z-10` label; secondary `border border-[var(--charcoal)]` on transparent; links underlined.
- Cards are open: `border-t border-[var(--charcoal)] p-8`–`p-12`, featured `border-t-4 border-t-[var(--gold)]`.
- Inputs: bottom border only, `h-12 px-0`, with an italic Playfair placeholder in `#5C5853`.
- Testimonials: `border-l border-l-[var(--gold)]`, extra left padding, grayscale avatar, author name in gold.
- Thin-stroke icons, few and functional.

**Signature moves.**

- Images large, portrait (`aspect-[3/4]`, `aspect-[4/5]`) and `grayscale`.
- Vertical side labels ("Editorial / Vol. 01") set in vertical writing mode on image edges.
- Four visible vertical gridlines: fixed `w-px` lines at `bg-[var(--charcoal)]/20` along the column boundaries.

**Layout.** Containers up to `max-w-[1600px]` with `px-8`–`px-16`; sections `py-24`–`py-32`; gaps `gap-12`–`gap-16`. A 12-column grid offset with an empty `col-span-1` or `col-span-5` spacer, splits of 7/5 or 4/4/4, primary content aligned bottom-left; text columns `max-w-md`–`max-w-xl`.
