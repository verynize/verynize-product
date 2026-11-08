// Bauhaus style. Original to Verynize.
import { shadow, radius } from "../elevation.mjs";

const ink = "#161514";

export default {
  id: "bauhaus",
  name: "Bauhaus",
  summary:
    "A Dessau workshop poster: circle, square and triangle in primary red, blue and yellow, with thick ink outlines.",
  keywords: [
    "bauhaus",
    "constructivist",
    "geometric",
    "primary colors",
    "modernist",
    "poster",
    "design school",
    "architecture",
    "workshop",
    "shapes",
    "art school",
    "exhibition",
  ],
  scene:
    "A 1925 exhibition poster pinned to a workshop wall: cream stock, black ink, and three printed primaries.",
  identity:
    "Form follows function, and function is built from three shapes. Every element is a circle, a square or a triangle, outlined in heavy ink and filled with a flat primary. Whole sections take one primary as their background, which is the most recognisable move. Asymmetric, architectural and confident — loud, but never decorative for its own sake.",
  composition: [
    "Colour-block whole sections: a blue hero, a yellow stats band, a red benefits block, a dark footer.",
    "Balance is asymmetric: large shapes overlap the grid edge and break into neighbouring sections on purpose.",
    "Every section and the navigation end with a 4px ink rule.",
    "Divide stat and feature grids with 4px ink gutters: an ink-filled grid with gap-1 whose cells carry their own colour.",
  ],
  typography: {
    display: "Jost",
    body: "Jost",
    mono: null,
    displayWeight: 800,
    bodyWeight: 500,
    displayTracking: "-0.03em",
    scale: 1.5,
    notes: [
      "Display is uppercase at 72–112px with leading-[0.9]; subheads uppercase at 36px.",
      "Body at 17–18px medium weight with leading-relaxed.",
      "Labels are bold uppercase at tracking-[0.18em], 12px.",
    ],
  },
  alternativePairing: { display: "League Spartan", body: "Work Sans" },
  palette: {
    background: "#f2efe8",
    surface: "#ffffff",
    surfaceAlt: "#e4dfd3",
    foreground: ink,
    muted: "#555149",
    border: ink,
    accent: "#c8281e",
    accentForeground: "#ffffff",
    success: "#2f7d4a",
    warning: "#a86a00",
    danger: "#b0201a",
    info: "#1d47a8",
  },
  extraTokens: [
    {
      name: "color/primary-blue",
      value: "#1d47a8",
      use: "Hero blocks, secondary buttons and the square in the logo.",
    },
    {
      name: "color/primary-yellow",
      value: "#f2bb1d",
      use: "Stats bands, highlight panels and the triangle; always with ink text.",
    },
    {
      name: "color/answer-wash",
      value: "#fbf1c8",
      use: "Opened accordion answers and light callouts.",
    },
  ],
  radius: { none: 0, sm: 0, md: 0, lg: 0, xl: 0, full: 9999 },
  elevation: {
    light: "top-left",
    flat: shadow([]),
    raised: shadow([[4, 4, 0, 0, ink]]),
    overlay: shadow([[8, 8, 0, 0, ink]]),
  },
  shape: [
    "Radius is binary: rounded-none or rounded-full, nothing in between.",
    "Outlines are border-2 on controls and border-4 on cards and section edges, always in ink.",
    "Hard offset shadows only: shadow-[4px_4px_0_0_#161514] on small elements, shadow-[8px_8px_0_0_#161514] on cards.",
    "Triangles come from [clip-path:polygon(50%_0,100%_100%,0_100%)] on a filled square.",
  ],
  components: [
    "Primary button: h-12 px-7 rounded-none bg-[#c8281e] text-white border-2 border-[#161514] uppercase font-bold tracking-[0.12em] shadow-[4px_4px_0_0_#161514]; blue, yellow (ink text) and white variants share the recipe.",
    "Card: relative bg-white border-4 border-[#161514] p-6 shadow-[8px_8px_0_0_#161514] with a 10px shape in the top-right corner, cycling circle, square, triangle across a row.",
    "Input: h-12 bg-white border-2 border-[#161514] rounded-none px-4 font-medium.",
    "Accordion: closed rows white with a border-b-4; the open row turns red with white text and its answer sits on the yellow wash.",
    "Icons: 2px-stroke outline glyphs inside 44px bordered squares or yellow circles.",
    "Step numbers sit in 45°-rotated squares with the numeral counter-rotated upright.",
  ],
  signatureMoves: [
    "A logo mark built from a red circle, a blue square and a yellow triangle placed side by side.",
    "An abstract hero composition: a large red circle, a rotate-45 blue square and a yellow triangle overlapping inside a relative 320px box.",
    "Photos alternate between rounded-full and square crops and stay grayscale.",
    "A white dot grid on coloured blocks: an absolute inset-0 pointer-events-none SVG whose <pattern> tile is 20px with one 2px-radius circle, at 25% opacity.",
    "Oversized ambient shapes at 12% opacity bleeding off section edges.",
  ],
  imagery:
    "Grayscale photography of architecture, furniture, tools and makers, cropped into circles or squares. Illustration is pure geometry in the three primaries. No gradients, textures, or soft illustration styles.",
  layout: [
    "Poster breadth: max-w-7xl with sections at py-24 px-8.",
    "Spacing on a 4/8/12/16/24/48 scale; never arbitrary.",
    "Stats in a four-column ink-ruled grid; pricing with the centre tier raised and filled in a primary.",
  ],
  density: "comfortable",
  do: [
    "Give each major section its own primary background.",
    "Outline every element in ink at the same weight.",
    "Let shapes overlap edges to create movement.",
  ],
  dont: [
    "No gradients, blur or soft shadows.",
    "No radii between 0 and full.",
    "No secondary or pastel colours outside the yellow wash.",
  ],
  useCases: [
    "A design-school open-day site with programmes, studios and an application form.",
    "A modern furniture brand launching a geometric chair collection.",
  ],
};
