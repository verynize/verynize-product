// Maximalism style. Original to Verynize.
import { rgba, shadow, radius } from "../elevation.mjs";

const pink = "#ff3fd0";
const teal = "#16f0c4";
const lemon = "#ffe21f";

export default {
  id: "maximalism",
  name: "Maximalism",
  summary:
    "Joyful overload: five clashing neons, stacked hard shadows, layered patterns and stickers on an ultraviolet night.",
  keywords: [
    "maximalism",
    "maximalist",
    "dopamine",
    "colorful",
    "loud",
    "hyperpop",
    "y2k",
    "party",
    "gen z",
    "chaotic",
    "fun",
    "sticker",
    "vibrant",
  ],
  scene:
    "A sticker-bombed bedroom at a sleepover: ultraviolet walls, glow-in-the-dark stars, hot pink and lemon everything.",
  identity:
    "More is more. Five saturated accents rotate through every section, borders clash with the fills they sit on, patterns layer two or three deep, and shapes and stickers scatter at uneven sizes. Headlines wear stacked coloured shadows. Body text stays white and readable so the chaos remains usable. Overwhelming on purpose, and joyful about it — the loudest style available.",
  composition: [
    "Break the grid: col-span-2 beside col-span-1, every second item translate-y-8, negative margins for overlap.",
    "Lead each section with a different accent and cycle grid items through all five.",
    "Scatter five to ten floating shapes or stickers per section at deliberately uneven sizes.",
    "Put a giant background word (YES, WOW, GO) at 200–320px and opacity-20 bleeding off the edge.",
  ],
  typography: {
    display: "Syne",
    body: "Rubik",
    mono: null,
    displayWeight: 800,
    bodyWeight: 500,
    displayTracking: "-0.04em",
    scale: 1.618,
    notes: [
      "Headlines uppercase at 72–128px, mixing weights inside one line.",
      "Stacked headline shadows: [text-shadow:3px_3px_0_#8a3dff,6px_6px_0_#ff3fd0,9px_9px_0_#16f0c4]; double the offsets for the hero.",
      "One callout per page in font-['Bungee'].",
      "Body 18–20px in white; never set long text in an accent.",
    ],
  },
  alternativePairing: { display: "Unbounded", body: "DM Sans" },
  palette: {
    background: "#0e0b1f",
    surface: "#23154a",
    surfaceAlt: "#331f62",
    foreground: "#ffffff",
    muted: "#c9bfe6",
    border: pink,
    accent: pink,
    accentForeground: "#0e0b1f",
    success: teal,
    warning: lemon,
    danger: "#ff6a3d",
    info: "#a874ff",
  },
  extraTokens: [
    {
      name: "color/electric-teal",
      value: teal,
      use: "Second accent: shadows, borders, pattern ink.",
    },
    { name: "color/lemon", value: lemon, use: "Third accent: button borders, stripes, stickers." },
    {
      name: "color/tangerine",
      value: "#ff6a3d",
      use: "Fourth accent: clashing borders and badges.",
    },
    {
      name: "color/ultraviolet",
      value: "#8a3dff",
      use: "Fifth accent; the only one that takes white text.",
    },
    { name: "color/pink-glow", value: rgba(pink, 0.5), use: "Glow layers on hero elements." },
  ],
  radius: radius(12, 16, 24, 32),
  elevation: {
    light: "top-left",
    flat: shadow([]),
    raised: shadow([
      [8, 8, 0, 0, teal],
      [16, 16, 0, 0, pink],
    ]),
    overlay: shadow([
      [10, 10, 0, 0, teal],
      [20, 20, 0, 0, pink],
      [30, 30, 0, 0, lemon],
      [0, 0, 32, 0, rgba(pink, 0.5)],
    ]),
  },
  shape: [
    "Borders are border-4 by default and border-8 on featured elements, mixing solid, dashed and double within one section.",
    "Buttons rounded-full, cards rounded-[24px], containers rounded-[16px], with one clipped or squared corner here and there.",
    "Shadows stack in several accents: shadow-[8px_8px_0_#16f0c4,16px_16px_0_#ff3fd0]; hero elements add a pink glow.",
    "A border always clashes with its fill: pink fill with lemon border, teal fill with tangerine border.",
  ],
  components: [
    "Primary button: h-14 px-10 rounded-full bg-gradient-to-r from-[#ff3fd0] to-[#16f0c4] text-[#0e0b1f] border-4 border-[#ffe21f] font-black uppercase tracking-[0.12em] with the raised shadow.",
    "Secondary button: h-14 px-10 rounded-full bg-transparent border-4 border-dashed border-[#16f0c4] text-white uppercase font-bold.",
    "Card: bg-[#23154a]/85 backdrop-blur-sm border-4 border-[#ffe21f] rounded-[24px] p-10 rotate-1 with a dashed header rule in another accent.",
    "Input: h-14 rounded-full bg-[#23154a]/60 border-4 border-[#ff3fd0] px-6 text-lg font-bold.",
    "Icons: 40px thick-stroke glyphs inside accent-bordered circles filled with that accent at 20%.",
  ],
  signatureMoves: [
    'Two or three layered patterns per section, each an absolute inset-0 pointer-events-none SVG with a <pattern>: a pink dot grid (18px tile, 1.5px dots), lemon diagonal stripes (16px tile, patternTransform="rotate(45)") at 10–25%.',
    "Stacked tri-colour headline shadows.",
    "Floating stickers: stars, smileys, lightning bolts and emoji at mixed sizes and rotations.",
    "A giant faded background word bleeding off the section.",
    "Gradient headline words (pink → teal → lemon) on a third of headings, 48px and up.",
  ],
  imagery:
    "Cut-out photos with thick coloured outlines, collage, chrome 3D type, glitter, emoji and sticker sheets. Photos get duotone or neon-tinted treatments. Never minimal, muted or stock-corporate.",
  layout: [
    "Hero at max-w-none; reading copy at max-w-3xl.",
    "Sections at py-24 to py-32 with an occasional skew-x-2 band.",
    "Overlap is required: at least one element per section crosses into its neighbour.",
  ],
  density: "compact",
  do: [
    "Rotate all five accents and let them clash.",
    "Keep body text white on dark fills for legibility.",
    "Add one more layer when it starts to feel safe.",
  ],
  dont: [
    "No neutral greys or beige.",
    "No tidy, symmetric grids.",
    "No body paragraphs set in an accent colour.",
  ],
  useCases: [
    "A Gen Z snack brand launch with flavour drops and a sticker giveaway.",
    "A hyperpop artist’s tour and merch site.",
  ],
};
