// Newsprint style. Original to Verynize.
import { shadow, radius } from "../elevation.mjs";

const ink = "#121212";

export default {
  id: "newsprint",
  name: "Newsprint",
  summary:
    "A broadsheet front page on screen: towering serif headlines, ruled columns, dense copy and a single press red.",
  keywords: [
    "newspaper",
    "newsprint",
    "broadsheet",
    "news",
    "press",
    "gazette",
    "headline",
    "journalism",
    "report",
    "bulletin",
    "chronicle",
    "almanac",
    "times",
  ],
  scene:
    "The morning edition fresh off the press: off-white stock, crisp black ink, one red stamp marking the breaking story.",
  identity:
    "Authoritative and urgent. Massive serif headlines sit over strict columns divided by visible ink rules, copy is dense and justified, and metadata — edition, volume, figure numbers — is treated as decoration. It is almost purely ink on paper; red appears only to flag what is urgent. Unlike a gentle editorial blog, this is crowded and proud of it.",
  composition: [
    'A masthead band at the top: publication name, edition line ("No. 214 · Thursday Edition"), date, all framed by a double rule.',
    "Divide content into strict 12-column grids with border-r rules between columns.",
    "Lead with an 8/4 split: main story and image at 8, briefs stacked at 4.",
    "Invert at least one band to ink with paper-colored text, like a breaking-news strip.",
  ],
  typography: {
    display: "Noto Serif Display",
    body: "Source Serif 4",
    mono: "IBM Plex Mono",
    displayWeight: 800,
    bodyWeight: 400,
    displayTracking: "-0.035em",
    scale: 1.5,
    notes: [
      "Hero headlines at 96–144px with leading-[0.9] in sentence case; section heads at 48px black weight.",
      "Body 17–18px with leading-relaxed; multi-column body uses text-justify and hyphens-auto.",
      "Bylines, nav and buttons in IBM Plex Mono 11–12px uppercase tracking-[0.2em].",
      "Open lead paragraphs with a 72px float-left drop cap, optionally in the press red.",
    ],
  },
  alternativePairing: { display: "Old Standard TT", body: "Libre Caslon Text" },
  palette: {
    background: "#f7f5ef",
    surface: "#fbfaf6",
    surfaceAlt: "#ebe8de",
    foreground: ink,
    muted: "#5c5b56",
    border: ink,
    accent: "#b51212",
    accentForeground: "#ffffff",
    success: "#1f6a3a",
    warning: "#8c5a00",
    danger: "#b51212",
    info: "#1d4a8a",
  },
  extraTokens: [
    {
      name: "color/rule-soft",
      value: "#d4cfc2",
      use: "Secondary dashed rules inside lists and pricing.",
    },
    { name: "color/inverse-muted", value: "#a9a69d", use: "Secondary text on inverted ink bands." },
  ],
  radius: radius(0, 0, 0, 0),
  elevation: {
    light: "top-left",
    flat: shadow([]),
    raised: shadow([[4, 4, 0, 0, ink]]),
    overlay: shadow([[8, 8, 0, 0, ink]]),
  },
  shape: [
    "Square corners on everything.",
    "1px ink rules for cells and columns; 4px rules (border-b-4) under the masthead and between major stories.",
    "Grid cells share rules via gap-px on an ink-filled container.",
    "Mostly flat; a hard 4px ink offset is allowed on a featured card or a button hover.",
  ],
  components: [
    "Primary button: px-6 py-3 rounded-none bg-[#121212] text-[#f7f5ef] font-mono text-xs uppercase tracking-[0.2em].",
    "Outline button: border border-[#121212] with the same type; links underline-offset-4 decoration-2 decoration-[#b51212].",
    'Card: border border-[#121212] bg-[#fbfaf6] p-6 with a mono kicker, serif title and a "Fig. 2" caption.',
    "Input: border-0 border-b-2 border-[#121212] bg-transparent font-mono text-sm py-2.",
    'Badge: bg-[#b51212] text-white px-2 py-0.5 font-mono text-[11px] uppercase tracking-widest ("Breaking", "Live").',
    "Icons: thin line icons in ink inside h-12 w-12 square bordered boxes.",
  ],
  signatureMoves: [
    'Edition metadata everywhere: volume number, date, city edition, "Printed in ..." footer line.',
    "A black ticker band of stats with red badge labels, like a crawl.",
    'Grayscale photos with "Fig. 1.2" captions and a halftone dot pattern (1px dots every 14px at 10%) on placeholders.',
    "Centered ornamental dividers of three small glyphs (◆ ◆ ◆) in muted ink with wide tracking.",
  ],
  imagery:
    "Documentary photos converted to grayscale, sometimes with a light sepia cast; halftone-dotted placeholders; small engraved-style line illustrations. Always captioned.",
  layout: [
    "max-w-[1280px] px-4 container on 12 columns; tight 8px rhythm (gap-2 to gap-8).",
    "Sections py-16; cards p-6; content is dense and runs in two to four text columns.",
    "Use 5/7 and 8/4 editorial splits rather than equal thirds.",
  ],
  density: "compact",
  do: [
    "Show visible column rules.",
    "Use red only for urgency, links and the main action.",
    "Fill the page densely like a front page.",
  ],
  dont: [
    "No rounded corners or soft shadows.",
    "No color photography in the lead story.",
    "No airy hero with a single centered sentence.",
  ],
  useCases: [
    "A daily industry news digest homepage.",
    "An annual report microsite styled as a special edition.",
  ],
};
