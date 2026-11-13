// Swiss Minimalist style. Original to Verynize.
import { shadow, radius } from "../elevation.mjs";

export default {
  id: "swiss-minimalist",
  name: "Swiss Minimalist",
  summary:
    "International Typographic Style: visible grid, giant flush-left grotesque, black rules and one signal red.",
  keywords: [
    "swiss",
    "minimalist",
    "minimal",
    "international style",
    "grid",
    "typographic",
    "modernist",
    "poster",
    "museum",
    "exhibition",
    "architecture",
    "transit",
    "objective",
    "helvetica",
  ],
  scene:
    "A 1960s exhibition poster pasted in a Zurich tram stop: white paper, black grotesque, a red circle.",
  identity:
    "Objective and architectural. The grid is the law and is shown openly with thick black rules; type is enormous, flush-left and often uppercase, and space is a structural material rather than leftover. Everything is flat — richness comes from scale contrast and faint geometric textures, never shadow. A single red is the only signal on the page.",
  composition: [
    "Draw the 12-column grid with border-2 black rules between sections and columns.",
    "Use asymmetric ratios: 8:4, 7:5 and 5:7, leaving whole columns empty as part of the design.",
    'Number real sequences with a red prefix ("01 —", "02 —") in the section label.',
    "Pair dense information blocks (tables, specs) with spacious narrative sections.",
  ],
  typography: {
    display: "Hanken Grotesk",
    body: "Hanken Grotesk",
    mono: "Spline Sans Mono",
    displayWeight: 900,
    bodyWeight: 400,
    displayTracking: "-0.05em",
    scale: 1.618,
    notes: [
      "Display at 96–160px uppercase, leading-[0.85]; words used as shapes.",
      "All text flush left, ragged right; never centered.",
      "Labels 12px uppercase tracking-[0.2em] weight 700.",
    ],
  },
  alternativePairing: { display: "Archivo", body: "Archivo" },
  palette: {
    background: "#ffffff",
    surface: "#ffffff",
    surfaceAlt: "#efefef",
    foreground: "#000000",
    muted: "#575757",
    border: "#000000",
    accent: "#d42a00",
    accentForeground: "#ffffff",
    success: "#00733a",
    warning: "#995a00",
    danger: "#a8001a",
    info: "#0040a8",
  },
  extraTokens: [
    {
      name: "color/accent-ring",
      value: "#ffd9cf",
      use: "Wide ring around compositional red circles.",
    },
  ],
  radius: radius(0, 0, 0, 0),
  elevation: {
    light: "top",
    flat: shadow([]),
    raised: shadow([]),
    overlay: shadow([[0, 0, 0, 2, "#000000"]]),
  },
  shape: [
    "Rectangles only; the single exception is a compositional circle.",
    "Thick black borders (border-2, border-4) draw the grid and divide sections.",
    "No drop shadows; the only ring is a flat wide halo around a red circle (shadow-[0_0_0_10px_#ffd9cf]).",
  ],
  components: [
    "Primary button: h-12 px-6 rounded-none bg-black text-white font-bold uppercase tracking-[0.1em] text-sm; red variant for the single key action.",
    "Secondary button: rounded-none border-2 border-black bg-white text-black with the same type.",
    "Card: border-2 border-black bg-white p-8 or bg-[#efefef] p-12; no rounding.",
    "Input: border-0 border-b-2 border-black bg-transparent py-3 text-lg, or a border-2 box.",
    "Icons: functional pictograms with stroke matched to body weight, inside border-2 black squares.",
  ],
  signatureMoves: [
    "Bauhaus-like hero composition: overlapping red circle, black rectangle and thin lines on the grid.",
    "A 2×2 tile grid where each tile carries a different faint texture (24px line grid, 16px dot matrix, 45° hatch) as SVG pattern layers at 2–4%.",
    "Oversized numerals as section anchors.",
  ],
  imagery:
    "Black-and-white photography cropped hard into grid cells, or no photography at all. Geometric compositions of circles, bars and lines in black and red.",
  layout: [
    "max-w-[1280px], 12-column grid with visible gutters; sections p-12 to p-24.",
    "Information-dense tables beside generous whitespace; the uniform grid spine runs through every section.",
  ],
  density: "comfortable",
  do: [
    "Align every edge to a column line.",
    "Use scale and weight as the only ornament.",
    "Keep red for one signal per view.",
  ],
  dont: [
    "No rounded corners, gradients or shadows.",
    "No centered text blocks.",
    "No decorative illustration or extra colors.",
  ],
  useCases: [
    "A design museum exhibition microsite with dates and tickets.",
    "A city transit authority’s service-status page.",
  ],
};
