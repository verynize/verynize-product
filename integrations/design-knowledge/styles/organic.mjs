// Organic style. Original to Verynize.
import { rgba, shadow, radius } from "../elevation.mjs";

const moss = "#56694a";
const clay = "#b57d55";

export default {
  id: "organic",
  name: "Organic",
  summary:
    "Moss, clay and unbleached paper with soft irregular shapes and warm serifs; handmade, slow and welcoming.",
  keywords: [
    "organic",
    "natural",
    "nature",
    "eco",
    "sustainable",
    "wellness",
    "spa",
    "skincare",
    "botanical",
    "ceramics",
    "handmade",
    "farm",
    "yoga",
    "tea",
    "artisan",
  ],
  scene:
    "A potter’s windowsill: moss in a clay pot, a linen cloth, rough paper notes weighed down by a river stone.",
  identity:
    "Calm and handmade. Nothing is perfectly straight: corners are generous and uneven, images sit in pebble-like masks, and colors are borrowed from soil, leaves and fired clay. A warm, slightly quirky serif gives headlines personality while a rounded sans keeps reading easy. The page feels slow and tactile, closer to a craft shop than a tech product.",
  composition: [
    "Vary container width per section (wide, then intimate, then text-only) to give a breathing rhythm.",
    "Stagger cards in a row with different top offsets and different corner shapes so no two look stamped.",
    "Alternate section grounds between paper, faint sand, faint stone and an occasional solid moss band.",
    "Connect process steps with a soft dashed curve drawn as an SVG path rather than straight lines.",
  ],
  typography: {
    display: "Young Serif",
    body: "Mulish",
    mono: null,
    displayWeight: 400,
    bodyWeight: 400,
    displayTracking: "-0.015em",
    scale: 1.25,
    notes: [
      "Headlines 48–72px with leading-[1.08]; sentence case, never uppercase.",
      "Body 17px with leading-[1.75] in deep loam; muted text for captions only.",
      "Small labels in Mulish 600 at 13px with tracking-[0.04em], not uppercase.",
    ],
  },
  alternativePairing: { display: "Fraunces", body: "Nunito" },
  palette: {
    background: "#faf8f1",
    surface: "#fffdf7",
    surfaceAlt: "#efe8dc",
    foreground: "#2b2a22",
    muted: "#615e51",
    border: "#dcd3c4",
    accent: moss,
    accentForeground: "#f7f6ef",
    success: "#4b743c",
    warning: "#94661a",
    danger: "#9f483c",
    info: "#46687a",
  },
  extraTokens: [
    {
      name: "color/clay",
      value: clay,
      use: "Second accent: outline buttons, tags and blob fills.",
    },
    { name: "color/sand", value: "#e7dbc6", use: "Quiet section backgrounds at 30–50%." },
    { name: "color/sage", value: "#c9d3bd", use: "Soft leafy blob and icon well fills." },
  ],
  radius: radius(12, 20, 32, 48),
  elevation: {
    light: "top",
    flat: shadow([]),
    raised: shadow([[0, 4, 20, -4, rgba(moss, 0.16)]]),
    overlay: shadow([[0, 12, 40, -10, rgba(clay, 0.26)]]),
  },
  shape: [
    "Cards rounded-[32px]; buttons, inputs and the nav are full pills.",
    "Break symmetry with one bigger corner per card, e.g. rounded-[32px] rounded-tl-[64px], moving the big corner on each sibling.",
    "Mask photos with four unequal radii such as rounded-[42%_58%_63%_37%/41%_44%_56%_59%].",
    "Shadows are diffused and tinted moss or clay, never neutral grey.",
  ],
  components: [
    "Primary button: h-12 px-8 rounded-full bg-[#56694a] text-[#f7f6ef] font-bold shadow-[0_6px_20px_-6px_rgba(86,105,74,0.35)].",
    "Outline button: rounded-full border-2 border-[#b57d55] text-[#8a5a37] px-8 h-12; ghost buttons are moss text.",
    "Card: rounded-[32px] border border-[#dcd3c4]/60 bg-[#fffdf7] p-8 with the raised moss shadow.",
    "Input: h-12 rounded-full border border-[#dcd3c4] bg-white/60 px-5 text-sm.",
    "Nav: floating pill, rounded-full border border-[#dcd3c4]/60 bg-white/70 backdrop-blur-md px-6 py-3 with a round moss logo.",
    "Icon well: h-14 w-14 rounded-[18px] bg-[#56694a]/10 with a leaf or sprout line icon in moss.",
  ],
  signatureMoves: [
    "Paper grain: a fractal-noise layer with mix-blend-multiply at 3–5% opacity across the artboard.",
    "Blurred organic blobs (300–500px, blur-3xl) in moss at 18% and clay at 14% drifting behind sections.",
    "Photos in hand-placed frames: -rotate-2 border-[6px] border-white with the clay shadow.",
    "Dashed, curving SVG paths linking steps, like a trail on a map.",
  ],
  imagery:
    "Natural-light photography of materials, hands, plants and food, warm and slightly desaturated. Pebble and blob masks, linen and paper textures, simple botanical line drawings. Avoid glossy studio product shots and cool tones.",
  layout: [
    "Main sections max-w-[1200px], intimate sections max-w-[960px], text sections max-w-[720px]; all py-28 to py-32.",
    "Grids of two to three columns with 40–48px gaps and staggered offsets.",
  ],
  density: "spacious",
  do: [
    "Let corners and shapes vary from element to element.",
    "Keep the palette earthy and warm.",
    "Give everything generous breathing room.",
  ],
  dont: [
    "No sharp right angles or hard black borders.",
    "No neon, cool blues or pure white grounds.",
    "No uppercase tracking-heavy headings.",
  ],
  useCases: [
    "An independent skincare brand’s product and ingredients page.",
    "A countryside retreat booking site with rooms and workshops.",
  ],
};
