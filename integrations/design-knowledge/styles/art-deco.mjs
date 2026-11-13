// Art Deco style. Original to Verynize.
import { rgba, shadow, radius } from "../elevation.mjs";

const lacquer = "#0c0b0a";
const gilt = "#cfa64a";

export default {
  id: "art-deco",
  name: "Art Deco",
  summary:
    "Jazz-age glamour: black lacquer, gilt linework, stepped geometry and strict mirror symmetry.",
  keywords: [
    "art deco",
    "deco",
    "gatsby",
    "1920s",
    "roaring twenties",
    "gold",
    "glamour",
    "cocktail",
    "hotel",
    "speakeasy",
    "gala",
    "theatre",
    "vintage luxury",
  ],
  scene:
    "The lobby of a 1929 tower at night: black lacquer walls, gilt elevator doors fanned like sunrays, a cream marble floor.",
  identity:
    "Opulent machine-age geometry. Every container behaves like a small building facade: framed, symmetrical, crowned with stepped or fanned ornament drawn in thin gold lines. The mood is theatrical, with elements either lit like a marquee or lost in shadow. Loud in ornament, restrained in colour: black, cream and gold carry nearly everything.",
  composition: [
    "Build on a central vertical axis: hero, headings and calls to action are centred and decoration is mirrored left and right.",
    "Use even column counts (2 or 4) or three with a dominant centre, so symmetry always holds.",
    "Flank section titles with short gold rules, w-20 h-px on each side, never a full-width line.",
    "Add height with thin vertical gilt lines at 20% running beside tall blocks, like pilasters.",
    "Crown the hero with a stepped or fanned motif centred above the headline.",
  ],
  typography: {
    display: "Poiret One",
    body: "Tenor Sans",
    mono: null,
    displayWeight: 400,
    bodyWeight: 400,
    displayTracking: "0.18em",
    scale: 1.414,
    notes: [
      "All display text is uppercase with wide tracking; headlines 56–80px, card titles 22–26px in gilt.",
      "Body text stays cream, never gold, at 16–17px with leading-relaxed.",
      "Labels are 11–12px uppercase at tracking-[0.3em] in gilt.",
      "Number steps and tiers with Roman numerals set in the display face.",
    ],
  },
  alternativePairing: { display: "Limelight", body: "Josefin Sans" },
  palette: {
    background: lacquer,
    surface: "#17150f",
    surfaceAlt: "#221f18",
    foreground: "#f1ead6",
    muted: "#9a917f",
    border: "#3a3324",
    accent: gilt,
    accentForeground: lacquer,
    success: "#6e9e7c",
    warning: "#d9a441",
    danger: "#d0625a",
    info: "#6f95b6",
  },
  extraTokens: [
    {
      name: "color/gilt-highlight",
      value: "#efdca3",
      use: "Top stop of metallic gradients and lit edges.",
    },
    {
      name: "color/gilt-shade",
      value: "#8f6f2a",
      use: "Bottom stop of metallic gradients on buttons and borders.",
    },
    { name: "color/midnight-teal", value: "#16353d", use: "Quiet depth panels and inactive tabs." },
    {
      name: "color/gilt-glow",
      value: rgba(gilt, 0.28),
      use: "Zero-offset glow around featured frames and buttons.",
    },
  ],
  radius: radius(0, 0, 0, 2),
  elevation: {
    light: "top",
    flat: shadow([]),
    raised: shadow([[0, 0, 14, 0, rgba(gilt, 0.18)]]),
    overlay: shadow([
      [0, 0, 0, 1, rgba(gilt, 0.5)],
      [0, 0, 32, 0, rgba(gilt, 0.28)],
    ]),
  },
  shape: [
    "Corners are square; the only cut is a 45° chamfer via [clip-path:polygon(16px_0,100%_0,100%_calc(100%-16px),calc(100%-16px)_100%,0_100%,0_16px)].",
    "Borders are ornament: 1px gilt hairlines, often doubled with a 6px gap between an outer and inner frame.",
    "Depth is backlight, not drop shadow: zero-offset gilt glows such as shadow-[0_0_14px_rgba(207,166,74,0.18)].",
    "Icons and avatars sit in 45°-rotated squares with their content counter-rotated upright.",
  ],
  components: [
    "Primary button: h-12 px-8 rounded-none bg-[linear-gradient(180deg,#efdca3_0%,#cfa64a_50%,#8f6f2a_100%)] text-[#0c0b0a] uppercase tracking-[0.25em] text-[13px].",
    "Secondary button: h-12 px-8 rounded-none border border-[#cfa64a] text-[#cfa64a] bg-transparent, same tracking.",
    "Card: relative bg-[#17150f] border border-[#cfa64a]/35 p-8 with an inner frame inset-2 border border-[#cfa64a]/15 and small L-shaped corner marks.",
    "Input: h-12 bg-transparent border-0 border-b border-[#cfa64a] px-0 with a gilt uppercase label above.",
    "Badge: uppercase 10px tracking-[0.3em] text-[#cfa64a] between two w-4 h-px gilt rules.",
    "Navigation: centred logo with links split evenly to each side, all uppercase and widely tracked.",
  ],
  signatureMoves: [
    "A gilt sunburst: thin lines fanning from a point behind the hero headline, drawn as an absolute SVG of 24 rays at 10% opacity.",
    'A diagonal crosshatch over the page: an absolute inset-0 pointer-events-none SVG whose <pattern> tile is 24px with a 1px line, patternTransform="rotate(45)", in gilt at 4%.',
    "Stepped ziggurat crowns: three stacked bars narrowing upward (w-24, w-16, w-8, each h-1) centred above section titles.",
    "Double-framed grayscale photographs: gilt outside, a black gap, then the image.",
    "Diamond-framed icons in rotate-45 squares with counter-rotated glyphs.",
  ],
  imagery:
    "Grayscale or duotone photography with dramatic studio lighting: cocktail glassware, skylines, architecture, evening wear. Illustration is geometric linework in gilt — fans, chevrons, stepped towers, stylised florals. Never soft watercolour or casual snapshots.",
  layout: [
    "Sections at py-32 inside max-w-6xl; cards at p-8 to p-10.",
    "Three-tier pricing with the centre tier taller and fully framed in gilt.",
    "Mirror decoration exactly; an ornament on the left needs its twin on the right.",
  ],
  density: "spacious",
  do: [
    "Keep body copy in cream and reserve gilt for display, borders and ornament.",
    "Centre everything that carries meaning.",
    "Repeat a small set of motifs (fan, chevron, step) across the page.",
  ],
  dont: [
    "No rounded corners or pill buttons.",
    "No soft grey drop shadows.",
    "No long paragraphs in gold.",
    "No asymmetric hero layouts.",
  ],
  useCases: [
    "A members-only cocktail bar site with menus, events and reservations.",
    "A black-tie gala invitation and ticketing page.",
  ],
};
