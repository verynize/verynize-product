// Bold Typography style. Original to Verynize.
import { flatElevation, radius } from "../elevation.mjs";

export default {
  id: "bold-typography",
  name: "Bold Typography",
  summary:
    "Poster-scale type as the whole visual language: huge tight headlines, one hot accent, hairlines instead of boxes.",
  keywords: [
    "typography",
    "typographic",
    "bold type",
    "poster",
    "editorial",
    "manifesto",
    "agency",
    "statement",
    "big headline",
    "gallery",
    "type-driven",
    "launch",
  ],
  scene:
    "A gallery wall at night: a black print with one enormous headline and a single strip of signal-orange tape.",
  identity:
    "Type is the image. Headlines run edge to edge at many times body size, set tight and confident, and everything else steps back. A single hot accent underlines what matters. There are no illustrations, no shadows and almost no boxes — just scale, rhythm and a few rules. Loud through size, quiet in everything else.",
  composition: [
    "Keep a size ratio of at least 6:1 between the largest headline and body text on every screen.",
    "Split the 12-column grid asymmetrically, 7/5 or 8/4, with the headline on the wide side.",
    "Separate sections with full-width 1px hairlines rather than cards or background changes.",
    "Let display headlines span the full container width; break lines by meaning, not by fit.",
  ],
  typography: {
    display: "Bricolage Grotesque",
    body: "Geist",
    mono: "Geist Mono",
    displayWeight: 800,
    bodyWeight: 400,
    displayTracking: "-0.05em",
    scale: 1.618,
    notes: [
      "Hero at 112–160px with leading-[0.92]; section headings 48–64px; body 16–17px at leading-[1.6].",
      "Labels, stats and metadata in Geist Mono, 12px uppercase at tracking-[0.14em].",
      "Pull quotes switch to font-['Instrument_Serif'] italic at 40–56px for contrast.",
      "No weights below 400 anywhere.",
    ],
  },
  alternativePairing: { display: "Archivo", body: "Hanken Grotesk" },
  palette: {
    background: "#0b0b0a",
    surface: "#171716",
    surfaceAlt: "#222220",
    foreground: "#f7f6f2",
    muted: "#a6a49d",
    border: "#2b2a27",
    accent: "#ff4a1c",
    accentForeground: "#0b0b0a",
    success: "#3fb37a",
    warning: "#f0b429",
    danger: "#ff5a5a",
    info: "#6aa9ff",
  },
  extraTokens: [
    {
      name: "color/numeral",
      value: "#262624",
      use: "Oversized background numerals behind section content.",
    },
    {
      name: "color/rule-strong",
      value: "#45433f",
      use: "Emphasised borders on inputs and secondary buttons.",
    },
  ],
  radius: radius(0, 0, 0, 0),
  elevation: flatElevation(),
  shape: [
    "Every corner is square.",
    "No box shadows or text shadows; depth comes from type layered over larger type.",
    "Emphasis is a 3px accent bar or underline, never a filled box.",
    "A film-grain layer covers the page: one pointer-events-none absolute inset-0 SVG with a feTurbulence fractalNoise filter at opacity-[0.02].",
  ],
  components: [
    "Primary action is an underlined word: relative uppercase tracking-[0.1em] text-[#ff4a1c] with an absolute bottom-0 left-0 h-[3px] w-full bg-[#ff4a1c].",
    "Secondary button: h-12 px-6 border border-[#f7f6f2] bg-transparent uppercase tracking-[0.1em] text-[13px] rounded-none.",
    "Cards are rare: border border-[#2b2a27] bg-transparent p-8; the featured one is border-2 border-[#ff4a1c] with a mono tag.",
    "Input: h-14 bg-[#171716] border border-[#2b2a27] px-4 rounded-none.",
    "Icons are outline-only at 20px and used sparingly; prefer a text label.",
  ],
  signatureMoves: [
    "A giant section numeral (text-[200px] font-extrabold text-[#262624]) sitting behind the heading with a short accent bar beside it.",
    "A photo inline in the headline: a type-height image span with object-cover between two words, square-cornered, in a flex items-baseline row.",
    "A single word of the hero set in the accent colour, everything else in foreground.",
    "Hairline-ruled index lists with mono numbers on the left and large titles on the right.",
  ],
  imagery:
    "Minimal. When photos appear they are cropped hard, high-contrast, often grayscale, and sized as part of the type system — inline in a headline or as a single full-bleed band. No illustration or icons as decoration.",
  layout: [
    "Container max-w-6xl with px-12 to px-16.",
    "Sections at py-20 to py-28; hero and final call to action at py-40.",
    "Use emptiness as a design element: whole columns may stay blank beside a headline.",
  ],
  density: "spacious",
  do: [
    "Make one headline per screen dramatically larger than everything else.",
    "Use the accent on at most three elements per screen.",
    "Write short, punchy headlines that read as statements.",
  ],
  dont: [
    "No rounded corners or drop shadows.",
    "No illustration or stock imagery as filler.",
    "No timid headline sizes below 48px in heroes.",
  ],
  useCases: [
    "A creative agency homepage leading with a manifesto headline.",
    "A product launch page where the headline is the hero.",
  ],
};
