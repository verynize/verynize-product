# Design styles

Named looks the agent layers on top of the design fundamentals. `get_design_guidelines {style}` returns the fundamentals, a `---` rule, then the style's guidelines. All prose and values here are original to Verynize.

Each style lives in its own module, `styles/<slug>.mjs`, with one default export. `styles/index.mjs` registers them.

## Style object

```js
import {
  rgba,
  shadow,
  softElevation,
  darkElevation,
  flatElevation,
  radius,
} from "../elevation.mjs";

export default {
  id: "neo-brutalism", // slug, kebab-case, equals the file name
  name: "Neo-Brutalism", // display name
  summary: "One line, ≤ 120 chars, used in pickers and the tool description.",
  keywords: ["…"], // ≥ 6 lowercase brief words that should suggest this style
  scene: "One sentence: the physical scene the palette and mood come from.",
  identity: "One paragraph: what the style is, its mood, how loud it is.",
  composition: ["…"], // 3–6 rules: page structure, alignment, rhythm
  typography: {
    // Google Fonts families, loaded with font-['Family_Name']
    display: "Space Grotesk",
    body: "Space Grotesk",
    mono: "Space Mono", // mono may be null
    displayWeight: 800,
    bodyWeight: 500,
    displayTracking: "-0.03em",
    scale: 1.333,
    notes: ["…"], // 2–4 rules: sizes, case, tracking, special treatments
  },
  alternativePairing: { display: "…", body: "…" },
  palette: {
    // 12 roles, all #rrggbb
    background,
    surface,
    surfaceAlt,
    foreground,
    muted,
    border,
    accent,
    accentForeground,
    success,
    warning,
    danger,
    info,
  },
  extraTokens: [
    // style-specific colors beyond the 12 roles (0–6)
    { name: "color/highlight", value: "#ffd93d", use: "Badges and alternate sections." },
  ],
  radius: radius(0, 0, 0, 0), // none, sm, md, lg, xl, full
  elevation: flatElevation(), // or softElevation(ink) / darkElevation() / { light, flat, raised, overlay } built with shadow()
  shape: ["…"], // 2–5 rules: borders, corners, depth, light direction
  components: ["…"], // 4–7 rules: buttons, cards, inputs, badges, nav, icons — with Tailwind classes
  signatureMoves: ["…"], // 3–6 moves that make the style recognisable, buildable on the Verynize canvas
  imagery: "One paragraph on photos, illustration, patterns.",
  layout: ["…"], // 2–4 rules: section structure, grid, whitespace
  density: "compact" | "comfortable" | "spacious",
  do: ["…"], // 3–5
  dont: ["…"], // 3–5
  useCases: ["…", "…"], // exactly 2 concrete briefs
};
```

## Rules

- Write every sentence yourself. Reference material describes behaviour, never wording to reuse.
- Contrast: `foreground`/`background`, `foreground`/`surface`, `accentForeground`/`accent` and `muted`/`background` are at least 4.5:1.
- Fonts come from Google Fonts. Inter, Roboto, Arial and Helvetica only appear in a style whose identity names them.
- Techniques must be buildable on the Verynize canvas: Tailwind classes the JSX codec accepts, no JavaScript, no `.map()`. Repeat items by writing them out. Patterns (dots, grids, scanlines) are an absolutely positioned SVG layer with a `<pattern>` fill, not a repeating CSS gradient.
- Tailwind examples use arbitrary values in brackets (`shadow-[4px_4px_0_0_#000]`, `rounded-[12px]`) and `font-['Family_Name']`.
