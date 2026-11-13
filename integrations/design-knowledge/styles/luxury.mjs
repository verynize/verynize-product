// Luxury editorial style. Original to Verynize.
import { softElevation, radius } from "../elevation.mjs";

const charcoal = "#1b1a18";

export default {
  id: "luxury",
  name: "Luxury",
  summary:
    "Fashion-house editorial: high-contrast serifs at dramatic scale, warm ivory, hairlines and a whisper of antique gold.",
  keywords: [
    "luxury",
    "fashion",
    "editorial",
    "premium",
    "high-end",
    "boutique",
    "jewelry",
    "perfume",
    "hotel",
    "couture",
    "atelier",
    "elegant",
    "magazine",
  ],
  scene:
    "A heavyweight lookbook on a linen table: ivory cotton paper, charcoal ink, one gilt-edged page.",
  identity:
    "Quiet, expensive and unhurried. Type is set at dramatic scale with more empty space than feels comfortable, and the grid is asymmetric but balanced like a magazine spread. The palette is near-monochrome — ivory, taupe, charcoal — with antique gold reserved for a hairline or an italic word. Volume is low; confidence is high.",
  composition: [
    "Offset a 12-column grid with empty spacer columns; split 7/5 or 4/4/4 and anchor content bottom-left.",
    "Pair every large heading with a tiny uppercase label preceded by a short w-8 h-px rule.",
    "Use single-sided rules (border-t, border-b) rather than full boxes.",
    "Set four faint vertical gridlines across the page at column boundaries, w-px bg-[#1b1a18]/15.",
  ],
  typography: {
    display: "Bodoni Moda",
    body: "Jost",
    mono: null,
    displayWeight: 400,
    bodyWeight: 400,
    displayTracking: "-0.02em",
    scale: 1.5,
    notes: [
      "Hero 72–128px with leading-[0.92]; alternate roman and italic words for cadence (The Quiet *Season*), italic optionally in gold.",
      "Labels 10–11px uppercase at tracking-[0.28em]; buttons 12px at tracking-[0.2em].",
      "Open intro paragraphs with a Bodoni drop cap: float-left text-[72px] leading-[0.8] mr-3.",
    ],
  },
  alternativePairing: { display: "Playfair Display", body: "Hanken Grotesk" },
  palette: {
    background: "#f8f6f2",
    surface: "#ffffff",
    surfaceAlt: "#ece6dc",
    foreground: charcoal,
    muted: "#5e5a54",
    border: "#d8d2c8",
    accent: charcoal,
    accentForeground: "#f8f6f2",
    success: "#3f6f4f",
    warning: "#9a6b1f",
    danger: "#9e2f2a",
    info: "#3c5670",
  },
  extraTokens: [
    {
      name: "color/antique-gold",
      value: "#b8954a",
      use: "Hairline accents, featured top borders, italic display words.",
    },
    {
      name: "color/ink-section",
      value: "#161514",
      use: "Inverted sections with ivory text at 70–85% opacity.",
    },
  ],
  radius: radius(0, 0, 0, 0),
  elevation: softElevation(charcoal, { raised: [0.02, 0.03], overlay: [0.04, 0.1] }),
  shape: [
    "Corners are square everywhere.",
    "Lines are 1px charcoal: full strength for structural rules, 10–15% for quiet dividers.",
    "Shadows are barely there; images get an inner 1px frame shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)].",
    "A paper-grain noise layer: one pointer-events-none absolute inset-0 SVG with feTurbulence fractalNoise at opacity-[0.025].",
  ],
  components: [
    "Primary button: h-12 px-10 rounded-none bg-[#1b1a18] text-[#f8f6f2] uppercase text-[12px] tracking-[0.2em].",
    "Secondary button: h-12 px-10 rounded-none border border-[#1b1a18] bg-transparent text-[#1b1a18], same type.",
    "Card: open, border-t border-[#1b1a18] pt-8 pb-10; the featured one uses border-t-[3px] border-[#b8954a].",
    "Input: h-12 bg-transparent border-0 border-b border-[#1b1a18] px-0 with an italic Bodoni placeholder in the muted tone.",
    "Testimonial: border-l border-[#b8954a] pl-10, italic serif quote, grayscale avatar, name in small gold capitals.",
    "Icons: few, functional and hairline-thin.",
  ],
  signatureMoves: [
    "Large portrait images (aspect-[3/4] or aspect-[4/5]) in grayscale or muted colour.",
    "Vertical side labels like “Collection / No. 04” rotated -90° along an image edge.",
    "Faint vertical gridlines running the full page height.",
    "One italic gold word in the hero headline.",
  ],
  imagery:
    "Editorial fashion and still-life photography: soft daylight, deep shadows, muted or grayscale grading, generous negative space inside the frame. Never busy collages, stock smiles or saturated colour.",
  layout: [
    "Containers up to max-w-[1560px] with px-10 to px-16; sections at py-28 to py-32.",
    "Text columns capped at max-w-md to max-w-xl.",
    "Alternate ivory, taupe and inverted ink sections for rhythm.",
  ],
  density: "spacious",
  do: [
    "Leave more space than seems necessary.",
    "Keep gold to hairlines and single words.",
    "Use real product names, materials and provenance in copy.",
  ],
  dont: [
    "No rounded corners or pill buttons.",
    "No bright colour or gradients.",
    "No dense grids of small product tiles above the fold.",
  ],
  useCases: [
    "A fine-jewellery maison’s new collection lookbook.",
    "A boutique hotel’s homepage with suites and a dining story.",
  ],
};
