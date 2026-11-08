// Flat Design style. Original to Verynize.
import { flatElevation, radius } from "../elevation.mjs";

export default {
  id: "flat-design",
  name: "Flat Design",
  summary:
    "Pure colour and shape: no shadows or textures, bold blocks of saturated colour and a strict grid.",
  keywords: [
    "flat",
    "flat design",
    "minimal",
    "clean",
    "colorful",
    "simple",
    "startup",
    "app",
    "infographic",
    "icons",
    "modern",
    "friendly",
  ],
  scene: "A screen-printed travel poster: four flat inks, crisp registration, no gloss.",
  identity:
    "Hierarchy without effects. Size, colour and type do every job that shadows, bevels and gradients used to do. Sections are poster-like blocks of solid, saturated colour with hard edges between them, and grouping comes from fill rather than lines. Cheerful, direct and digital-native; medium-loud.",
  composition: [
    "Alternate section fills: white, light grey, solid blue, solid mint or sunflower, and a dark slate block.",
    "Group by colour, not by borders: a card is a tinted rectangle on a different tinted section.",
    "Keep a strict 12-column grid and a 4px spacing base.",
    "Use oversized, low-opacity geometric shapes behind sections for movement.",
  ],
  typography: {
    display: "Lexend",
    body: "Lexend",
    mono: null,
    displayWeight: 700,
    bodyWeight: 400,
    displayTracking: "-0.02em",
    scale: 1.333,
    notes: [
      "Headlines 48–64px at 700; body 16–18px at 400.",
      "Buttons and labels 500–600; labels uppercase at tracking-[0.1em].",
    ],
  },
  alternativePairing: { display: "Outfit", body: "Outfit" },
  palette: {
    background: "#ffffff",
    surface: "#ffffff",
    surfaceAlt: "#f1f3f6",
    foreground: "#121826",
    muted: "#4b5466",
    border: "#e3e7ed",
    accent: "#1f5fd6",
    accentForeground: "#ffffff",
    success: "#0d8a60",
    warning: "#b97800",
    danger: "#d0303a",
    info: "#1f5fd6",
  },
  extraTokens: [
    { name: "color/blue-wash", value: "#eaf1fe", use: "Card fills on white sections." },
    {
      name: "color/mint",
      value: "#19b885",
      use: "Solid section blocks and stat numbers; dark text on top.",
    },
    {
      name: "color/sunflower",
      value: "#f6b40e",
      use: "Call-to-action blocks and badges; dark text on top.",
    },
    {
      name: "color/slate-block",
      value: "#1f2733",
      use: "Dark how-it-works sections and the footer.",
    },
  ],
  radius: radius(6, 8, 10, 12),
  elevation: flatElevation(),
  shape: [
    "Corners are rounded-[8px] on buttons and inputs and rounded-[10px] on cards; pills only for tags.",
    "shadow-none on everything; no blur and no realistic gradients.",
    "Edges are colour changes, not borders; the only thick borders are on inputs-on-white and outline buttons (border-[3px]).",
  ],
  components: [
    "Primary button: h-14 px-8 rounded-[8px] bg-[#1f5fd6] text-white font-semibold.",
    "Secondary button: h-14 px-8 rounded-[8px] bg-[#f1f3f6] text-[#121826] font-semibold.",
    "Outline button: h-14 px-8 rounded-[8px] border-[3px] border-[#1f5fd6] text-[#1f5fd6] bg-transparent.",
    "Card: rounded-[10px] bg-[#eaf1fe] p-6 with no border, icon in a 56px white circle with blue glyph.",
    "Input: h-14 rounded-[8px] bg-[#f1f3f6] px-4 border-0.",
    "Icons: 24px outline glyphs at 2px stroke in the section’s accent.",
  ],
  signatureMoves: [
    "Full-section colour blocks: blue hero, mint benefits, sunflower call to action, slate footer.",
    "Big decorative shapes: an absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 and a rotated square, inside a relative overflow-hidden section.",
    "Stat numbers each in a different accent colour.",
    "Long-shadow-free flat illustrations made of simple geometric pieces.",
  ],
  imagery:
    "Flat vector illustration built from simple shapes in the palette, without gradients or outlines. Photography is used rarely and placed in plain rectangles. No textures, glossy renders or skeuomorphic objects.",
  layout: [
    "max-w-7xl on a 12-column grid with sections at py-16 to py-24.",
    "Features in three or four columns; the popular pricing tier is larger and filled blue.",
    "The FAQ is the only place with lines between items.",
  ],
  density: "comfortable",
  do: [
    "Let colour fills define every group.",
    "Use high-saturation colours with enough contrast for text.",
    "Keep icons and illustrations geometric and consistent in stroke.",
  ],
  dont: [
    "No drop shadows, glows or blur.",
    "No skeuomorphic textures or bevels.",
    "No thin pastel palettes.",
  ],
  useCases: [
    "A mobile banking app landing page for students.",
    "A city recycling programme site with step-by-step guides.",
  ],
};
