// Monochrome style. Original to Verynize.
import { flatElevation, radius } from "../elevation.mjs";

export default {
  id: "monochrome",
  name: "Monochrome",
  summary:
    "Strict black on white with high-contrast serif type, heavy rules and inverted panels; gallery-catalogue austerity.",
  keywords: [
    "monochrome",
    "black and white",
    "minimalist",
    "fashion",
    "gallery",
    "catalogue",
    "architecture",
    "portfolio",
    "lookbook",
    "atelier",
    "museum",
    "austere",
    "editorial luxury",
  ],
  scene:
    "A gallery catalogue laid open on a white plinth: heavy black serifs, generous margins, a single black ribbon marker.",
  identity:
    "Colour is removed entirely and nothing replaces it. A high-contrast serif carries the voice, thick black rules carry the structure, and whole sections flip to black to create emphasis. The feel is couture and archival rather than techy: calm, assured, slightly severe. Restraint is the decoration.",
  composition: [
    "Build on a 12-column grid with wide outer margins; align headings, rules and images to the same column edges.",
    "Divide major sections with a 4px or 8px black rule spanning the container; minor divisions use a 1px pale hairline.",
    "Use at least one fully inverted band (black ground, white type) per page to anchor the rhythm.",
    "Let one oversized word act as an image: 128–176px serif, sometimes cropped by the frame edge.",
  ],
  typography: {
    display: "Bodoni Moda",
    body: "Newsreader",
    mono: "DM Mono",
    displayWeight: 500,
    bodyWeight: 400,
    displayTracking: "-0.03em",
    scale: 1.5,
    notes: [
      "Headlines in sentence case with leading-[0.95]; mix in the italic for one word to add movement.",
      "Body at 18px with leading-[1.7] in Newsreader; keep measures around 64 characters.",
      "Dates, indexes and captions in DM Mono 11px uppercase with tracking-[0.2em].",
    ],
  },
  alternativePairing: { display: "Playfair Display", body: "Libre Caslon Text" },
  palette: {
    background: "#ffffff",
    surface: "#ffffff",
    surfaceAlt: "#f3f3f3",
    foreground: "#060606",
    muted: "#555555",
    border: "#e1e1e1",
    accent: "#060606",
    accentForeground: "#ffffff",
    success: "#2e4a37",
    warning: "#6b5420",
    danger: "#7c2020",
    info: "#2a3a56",
  },
  extraTokens: [
    { name: "color/inverse", value: "#060606", use: "Inverted sections and emphasis cards." },
    { name: "color/inverse-muted", value: "#a6a6a6", use: "Secondary text on inverted sections." },
  ],
  radius: radius(0, 0, 0, 0),
  elevation: flatElevation(),
  shape: [
    "Every corner is square; no rounded-* other than rounded-none.",
    "Hierarchy through border weight: 1px #e1e1e1 hairline, 1px black standard, 2px black emphasis, 4–8px black section rule.",
    "Grid-cell rules come from gap-px on a black or hairline-filled container with white cells.",
    "No shadows and no gradients; depth only from inversion and scale.",
  ],
  components: [
    "Primary button: px-8 py-4 bg-[#060606] text-white text-[13px] uppercase tracking-[0.18em] font-medium, often ending with a thin → glyph.",
    "Secondary button: border-2 border-[#060606] bg-transparent with the same type; tertiary is an underlined text link with underline-offset-4.",
    "Card: border border-[#060606] bg-white p-8; emphasis card is bg-[#060606] text-white p-8.",
    "Input: border-0 border-b-2 border-[#060606] bg-transparent py-3 text-lg with an italic muted placeholder.",
    "Pull quote: 32px italic serif with an oversized 120px opening quotation mark hung in the margin.",
    "Icons: 1.25px stroke outlines in black, optionally inside a 40px black-stroked circle.",
  ],
  signatureMoves: [
    "A thick rule interrupted by a small 12px outlined square, used under the hero.",
    "A boxed drop cap: float-left mr-3 h-16 w-16 border border-[#060606] holding a 48px Bodoni letter.",
    "Inverted statistics band with huge serif numerals and a faint vertical-line pattern in white at 3%.",
    "Pricing where the featured column runs taller than its neighbours instead of being coloured.",
  ],
  imagery:
    "Black-and-white photography only: architecture, garments, objects on seamless backgrounds, with high contrast and deep blacks. Crop hard to rectangles. No illustration, no colour photos, no icons as decoration.",
  layout: [
    "max-w-[1152px] px-8 container, sections py-32 with generous empty columns.",
    "Asymmetric spreads: 5 columns of text beside 7 of image, then flip.",
    "Lists and indexes set as tables with hairline rows and mono numbering.",
  ],
  density: "spacious",
  do: [
    "Use scale contrast aggressively; tiny mono labels next to giant serifs.",
    "Treat inversion as your only accent.",
    "Keep generous white margins around every block.",
  ],
  dont: [
    "No colour at all, not even a muted navy link.",
    "No rounded corners, shadows or gradients.",
    "No sans-serif headlines.",
  ],
  useCases: [
    "A fashion house lookbook and collection index.",
    "An architecture practice portfolio with project monographs.",
  ],
};
