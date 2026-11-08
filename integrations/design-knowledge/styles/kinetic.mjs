// Kinetic typography style. Original to Verynize.
import { flatElevation, radius } from "../elevation.mjs";

export default {
  id: "kinetic",
  name: "Kinetic Type",
  summary:
    "Type as architecture: viewport-wide condensed capitals, marquee bands and hard flips between black and acid lime.",
  keywords: [
    "kinetic",
    "kinetic typography",
    "festival",
    "music",
    "event",
    "poster",
    "zine",
    "marquee",
    "loud",
    "nightlife",
    "streetwear",
    "conference",
  ],
  scene:
    "Fly-posters on a club wall at midnight: black stock, towering condensed capitals, one acid-lime strip of tape.",
  identity:
    "Text is the structure and the image. Headlines are many times the body size, condensed and uppercase, stacked so tightly the lines nearly touch; marquee bands of repeated words cross the page edge to edge. Everything is flat and high-contrast with one acid accent that occasionally takes over a whole section. Energetic, brash and very loud.",
  composition: [
    "Include at least one headline sized to the viewport width.",
    "Run at least two full-bleed marquee bands with words written out repeatedly and separated by a glyph (✶).",
    "Flip whole sections between the black ground and acid lime, inverting text colour.",
    "Let elements run past the container and use uneven column widths for drama.",
  ],
  typography: {
    display: "Anton",
    body: "Space Grotesk",
    mono: null,
    displayWeight: 400,
    bodyWeight: 500,
    displayTracking: "-0.01em",
    scale: 1.618,
    notes: [
      "Hero at text-[clamp(4rem,13vw,15rem)] with leading-[0.82], uppercase; section heads around 96px.",
      "Buttons and labels in Space Grotesk bold uppercase; small labels at tracking-[0.2em].",
      "Body 18–22px, left-aligned, normal case at tracking-tight.",
      "Decorative numerals at 140–200px in the alt surface colour, read as shapes.",
    ],
  },
  alternativePairing: { display: "Bebas Neue", body: "Archivo" },
  palette: {
    background: "#0a0a0b",
    surface: "#18181b",
    surfaceAlt: "#26262a",
    foreground: "#fafaf7",
    muted: "#a3a3a9",
    border: "#3c3c42",
    accent: "#d4f20c",
    accentForeground: "#0a0a0b",
    success: "#4ade80",
    warning: "#fbbf24",
    danger: "#f8545b",
    info: "#60a5fa",
  },
  extraTokens: [
    {
      name: "color/numeral",
      value: "#26262a",
      use: "Huge decorative numerals behind cards and sections.",
    },
    { name: "color/placeholder", value: "#86868d", use: "Placeholder text in oversized inputs." },
  ],
  radius: radius(0, 0, 0, 2),
  elevation: flatElevation(),
  shape: [
    "Square corners; rounded-[2px] at most on tiny tags.",
    "Structure is border-2 in the border colour; dividers are 1px; quotes get border-l-4 in acid.",
    "Completely flat: depth comes from layered numerals, colour flips and overlapping blocks.",
    "A noise layer at opacity-[0.03] with mix-blend-overlay: one pointer-events-none absolute inset-0 SVG with feTurbulence fractalNoise.",
  ],
  components: [
    "Primary button: h-16 px-10 rounded-none bg-[#d4f20c] text-[#0a0a0b] uppercase font-bold tracking-tight text-lg.",
    "Outline button: h-16 px-10 rounded-none border-2 border-[#3c3c42] text-[#fafaf7] uppercase font-bold.",
    "Card: border-2 border-[#3c3c42] bg-[#0a0a0b] p-10 with a title of 32px and up and a giant numeral behind it.",
    "Input: h-24 bg-transparent border-0 border-b-2 border-[#3c3c42] px-0 text-4xl font-bold uppercase tracking-tight.",
    "Hairline grids: a border-coloured parent with gap-px and ground-filled cells.",
  ],
  signatureMoves: [
    "A viewport-wide hero word that bleeds off both edges.",
    "Marquee bands: full-bleed h-20 strips in acid with black uppercase words written out several times; a second band in the outline style tilted -rotate-1.",
    "Hard section flips to bg-[#d4f20c] with black type.",
    "Text over imagery using mix-blend-difference for a print-overlay look.",
  ],
  imagery:
    "High-contrast, grainy black-and-white photography of crowds, stages and streets, cropped aggressively and often overlapped by type. No illustrations, gradients or soft pastels.",
  layout: [
    "Hero at max-w-[95vw]; reading content at max-w-5xl to max-w-6xl.",
    "Sections at py-32 with subsections at py-20; breaks are full-width borders or colour flips.",
    "Three-column lineups and pricing, four-column footer.",
  ],
  density: "spacious",
  do: [
    "Make type the hero of every section.",
    "Use acid boldly but in few places: highlights, bands and one flipped section.",
    "Write in short, shouted phrases.",
  ],
  dont: [
    "No rounded corners or shadows.",
    "No more than one accent colour.",
    "No small, timid headlines.",
  ],
  useCases: [
    "A three-day electronic music festival lineup and ticketing site.",
    "A streetwear drop announcement with countdown and product grid.",
  ],
};
