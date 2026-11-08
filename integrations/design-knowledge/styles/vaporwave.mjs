// Vaporwave / outrun style. Original to Verynize.
import { rgba, shadow, radius } from "../elevation.mjs";

const magenta = "#ff2bd6";
const cyan = "#22e6ff";

export default {
  id: "vaporwave",
  name: "Vaporwave",
  summary:
    "Neon outrun retro-futurism: magenta and cyan glows, a perspective grid floor, a blurred sunset sun and scanlines.",
  keywords: [
    "vaporwave",
    "outrun",
    "synthwave",
    "retrowave",
    "80s",
    "neon",
    "retro futurism",
    "arcade",
    "cyber",
    "music",
    "nightclub",
    "festival",
    "game",
    "synth",
  ],
  scene:
    "A night drive toward a striped sunset: a neon grid on the road, a chrome dashboard glowing magenta and cyan.",
  identity:
    "Maximal, glowing retro-futurism. A deep violet void hosts neon tubes of magenta and cyan, a huge blurred sunset sun, and a perspective grid stretching to the horizon. Everything emits light rather than casting shadow, headlines are wide and futuristic with sunset gradients, and controls are skewed like arcade signage. Subtlety is not the point.",
  composition: [
    "Layer the hero: grid floor at the bottom, blurred sun behind, content in front, scanlines over all.",
    "Split hero headlines across lines and fill them with the sunset gradient.",
    "Vary width by section (wide main, narrower pricing and FAQ) to keep the scroll cinematic.",
    "Alternate how-it-works steps left and right of a glowing central line.",
  ],
  typography: {
    display: "Audiowide",
    body: "Chakra Petch",
    mono: "Space Mono",
    displayWeight: 400,
    bodyWeight: 400,
    displayTracking: "0.02em",
    scale: 1.5,
    notes: [
      "Hero 72–128px uppercase, filled with an orange → magenta → cyan gradient and a magenta drop-shadow glow.",
      "Section heads 48–60px uppercase; card titles in cyan with a small cyan glow.",
      "Labels and UI copy in Space Mono uppercase tracking-[0.12em].",
    ],
  },
  alternativePairing: { display: "Orbitron", body: "Share Tech Mono" },
  palette: {
    background: "#0c0018",
    surface: "#1b0f3a",
    surfaceAlt: "#251552",
    foreground: "#ece6f5",
    muted: "#ab9fc6",
    border: "#3a2466",
    accent: magenta,
    accentForeground: "#12001f",
    success: "#3dffb0",
    warning: "#ffa31a",
    danger: "#ff3d6e",
    info: cyan,
  },
  extraTokens: [
    {
      name: "color/cyan",
      value: cyan,
      use: "Links, secondary borders, card titles and neon tube tops.",
    },
    { name: "color/sunset", value: "#ff9a1f", use: "Sun gradient start and sparing highlights." },
    { name: "color/void", value: "#050009", use: "Terminal windows and input fills." },
  ],
  radius: radius(0, 0, 0, 0),
  elevation: {
    light: "emissive",
    flat: shadow([]),
    raised: shadow([
      [0, 0, 0, 1, rgba(cyan, 0.5)],
      [0, 0, 18, 0, rgba(magenta, 0.35)],
    ]),
    overlay: shadow([
      [0, 0, 0, 1, rgba(magenta, 0.6)],
      [0, 0, 48, 0, rgba(cyan, 0.25)],
    ]),
  },
  shape: [
    "Square corners; rounded-full only for dots.",
    "Depth is light: zero-offset colored glows stacked tight-bright to wide-faint, never dark drop shadows.",
    "Neon tube cards: border border-[#ff2bd6]/30 with a brighter border-t-2 border-t-[#22e6ff].",
  ],
  components: [
    "Primary button: h-12 px-6 -skew-x-12 border-2 border-[#22e6ff] text-[#22e6ff] uppercase font-mono shadow-[0_0_18px_rgba(34,230,255,0.45)], label in a counter-skewed skew-x-12 span.",
    "Secondary button: same skew, filled bg-[#ff2bd6] text-[#12001f].",
    "Card: bg-[#1b0f3a]/80 backdrop-blur-md border border-[#ff2bd6]/30 border-t-2 border-t-[#22e6ff] p-6.",
    "Input: border-0 border-b-2 border-[#ff2bd6] bg-[#050009] text-[#22e6ff] font-mono text-lg px-3 py-2.",
    "Window: border-2 border-[#22e6ff] bg-[#050009]/80 with a title bar of three dots (magenta, cyan, sunset).",
    "Icons inside rotate-45 outlined diamonds, glyph counter-rotated.",
  ],
  signatureMoves: [
    "Outrun floor: magenta 40px line grid in an SVG pattern across the lower hero, masked to fade toward the horizon.",
    "A 600px blurred sun (blur-[100px]) in a sunset-to-magenta gradient at ~20% opacity.",
    "CRT scanlines over the whole page and a faint magenta dot pattern on panels.",
    'Testimonials styled as IRC chat lines: "<nightrider> this rules".',
  ],
  imagery:
    "Chrome text, palm silhouettes, low-poly mountains, retro computer renders and gradient-overlaid photos tinted magenta and cyan. Avoid natural daylight photography.",
  layout: [
    "max-w-[1280px] main, max-w-[1152px] pricing, max-w-[896px] FAQ; sections py-32, gaps 32–48px.",
    "Stacking order: grid floor, sun, section backgrounds, content, scanlines.",
  ],
  density: "comfortable",
  do: [
    "Make light the source of depth.",
    "Use magenta for heroic actions, cyan for navigation and detail.",
    "Commit to the full layered hero.",
  ],
  dont: [
    "No light backgrounds.",
    "No rounded friendly cards or pastel palettes.",
    "No grey drop shadows.",
  ],
  useCases: [
    "A synthwave music festival line-up and ticket page.",
    "An indie arcade game launch site.",
  ],
};
