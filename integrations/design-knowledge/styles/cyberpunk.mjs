// Cyberpunk style. Original to Verynize.
import { rgba, shadow, radius } from "../elevation.mjs";

const toxic = "#3dffa2";

export default {
  id: "cyberpunk",
  name: "Cyberpunk",
  summary:
    "A hacked neon feed: void black, toxic-green glow, chamfered panels, scanlines and RGB-split headlines.",
  keywords: [
    "cyberpunk",
    "neon",
    "glitch",
    "hacker",
    "futuristic",
    "sci-fi",
    "gaming",
    "esports",
    "synth",
    "dystopian",
    "matrix",
    "crt",
    "underground",
  ],
  scene:
    "A rain-streaked alley at 3 a.m.: a cracked CRT bolted to a wall, toxic-green text, a magenta sign buzzing overhead.",
  identity:
    "High technology, low life. The background is an absolute void, and neon does not tint surfaces — it emits light from edges and type. Panels are angular, chamfered and industrial; signal artefacts like scanlines, colour splitting and noise are treated as features. Dangerous, electric and loud.",
  composition: [
    "Hero split at least 60/40 with a terminal or HUD panel on the narrow side.",
    "Skew one feature grid with -skew-y-1 and counter-skew its contents so text stays level.",
    "Include at least one section of overlapping panels at staggered heights.",
    "For ruled stat rows, fill the grid with the border colour, set gap-px, and give every cell a surface fill.",
  ],
  typography: {
    display: "Chakra Petch",
    body: "IBM Plex Mono",
    mono: "IBM Plex Mono",
    displayWeight: 700,
    bodyWeight: 400,
    displayTracking: "0.06em",
    scale: 1.414,
    notes: [
      "Headlines uppercase at 64–96px; H2 at 40–48px.",
      "The hero headline splits colour: [text-shadow:-2px_0_#ff2bd6,2px_0_#2fd0ff].",
      "Labels are 12px uppercase at tracking-[0.24em]; body stays at leading-relaxed with slight positive tracking.",
    ],
  },
  alternativePairing: { display: "Orbitron", body: "JetBrains Mono" },
  palette: {
    background: "#07070c",
    surface: "#10101a",
    surfaceAlt: "#1a1a2b",
    foreground: "#e4e6ee",
    muted: "#9497a8",
    border: "#2a2a3f",
    accent: toxic,
    accentForeground: "#07070c",
    success: "#34e58c",
    warning: "#ffc93d",
    danger: "#ff3d6e",
    info: "#2fd0ff",
  },
  extraTokens: [
    {
      name: "color/hot-magenta",
      value: "#ff2bd6",
      use: "Secondary neon: outline buttons, colour-split shadows, alerts.",
    },
    {
      name: "color/ice-blue",
      value: "#2fd0ff",
      use: "Tertiary neon for data and the other half of the colour split.",
    },
    {
      name: "color/scanline",
      value: "rgba(0,0,0,0.32)",
      use: "Fill of the scanline pattern band.",
    },
    {
      name: "color/neon-glow",
      value: rgba(toxic, 0.45),
      use: "Outer glow layers around primary elements and glowing text.",
    },
  ],
  radius: radius(2, 2, 2, 2),
  elevation: {
    light: "emissive",
    flat: shadow([]),
    raised: shadow([
      [0, 0, 4, 0, toxic],
      [0, 0, 12, 0, rgba(toxic, 0.3)],
    ]),
    overlay: shadow([
      [0, 0, 8, 0, toxic],
      [0, 0, 24, 0, rgba(toxic, 0.4)],
      [0, 0, 48, 0, rgba(toxic, 0.18)],
    ]),
  },
  shape: [
    "Silhouettes are square with chamfered corners: [clip-path:polygon(0_12px,12px_0,calc(100%-12px)_0,100%_12px,100%_calc(100%-12px),calc(100%-12px)_100%,12px_100%,0_calc(100%-12px))].",
    "Depth is emitted light: stacked zero-offset glows such as shadow-[0_0_4px_#3dffa2,0_0_12px_rgba(61,255,162,0.3)].",
    "Glowing text uses drop-shadow-[0_0_8px_rgba(61,255,162,0.45)].",
    "Only inputs get a 2px radius; everything else is cut, not rounded.",
  ],
  components: [
    "Primary button: chamfered h-12 px-8 bg-[#3dffa2] text-[#07070c] uppercase tracking-[0.16em] font-bold with the colour-split text shadow on hover-state mockups.",
    "Secondary button: chamfered border-2 border-[#ff2bd6] text-[#ff2bd6] bg-transparent uppercase.",
    "Terminal card: bg-[#10101a] border border-[#2a2a3f] with a 32px header bar holding three small dots and a mono file name.",
    "HUD card: bg-[#1a1a2b]/40 backdrop-blur border border-[#3dffa2]/30 with four 14px corner brackets in toxic green and the raised glow.",
    "Input: h-12 bg-[#10101a] border border-[#2a2a3f] rounded-[2px] pl-8 text-[#3dffa2] with an absolute > prompt on the left.",
    "Icons: 1.5px stroke glyphs inside glowing bordered squares or hexagons.",
  ],
  signatureMoves: [
    "CRT scanlines over the hero: an absolute inset-0 pointer-events-none SVG whose <pattern> tile is 4px square with a 2px band along its lower half in the scanline colour.",
    "A circuit grid in at least one section: an SVG <pattern> of 48px tiles with 1px lines on top and left edges, toxic green at 4%.",
    "A terminal block with > prompts, real-looking commands and a static █ cursor mid-line.",
    "RGB-split hero headline using magenta and ice-blue offset text shadows.",
    "One extra texture: a noise layer (feTurbulence fractalNoise, opacity-[0.06]) or faint magenta radials in the corners.",
  ],
  imagery:
    "Night cityscapes with neon signage, rain and reflections, heavily graded toward green and magenta; HUD diagrams and wireframes drawn in neon lines. Avoid daylight, warm tones and friendly illustration.",
  layout: [
    "max-w-7xl with full-bleed sections at py-24 to py-32 and dense interiors.",
    "Pricing with the middle tier scaled up and glowing.",
    "Stats in one ruled row with mono numerals.",
  ],
  density: "compact",
  do: [
    "Keep the ground near-black so neon reads as light.",
    "Use toxic green as primary, magenta and ice blue as supporting neons.",
    "Treat glitches as deliberate, repeated motifs.",
  ],
  dont: [
    "No light mode.",
    "No soft rounded cards or pastel colours.",
    "No serif type.",
    "No grey drop shadows; glow only.",
  ],
  useCases: [
    "An esports team site with rosters, match schedules and merch drops.",
    "A launch page for an indie hacking-sim video game.",
  ],
};
