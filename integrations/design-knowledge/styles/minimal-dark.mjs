// Minimal Dark (warm-accent) style. Original to Verynize.
import { rgba, shadow, radius } from "../elevation.mjs";

const ember = "#f2a33a";

export default {
  id: "minimal-dark",
  name: "Minimal Dark",
  summary:
    "Calm premium dark mode: three layered charcoals, hairline edges and a single warm ember accent that glows softly.",
  keywords: [
    "dark",
    "dark mode",
    "minimal",
    "premium",
    "productivity",
    "tool",
    "app",
    "launcher",
    "focus",
    "night",
    "sleek",
    "developer tool",
  ],
  scene:
    "A study at midnight lit by a single brass lamp: charcoal walls, black desk, a warm amber pool of light.",
  identity:
    "The restraint of the best dark-mode productivity tools, warmed up. Depth comes from three stacked charcoals that sit slightly warmer than pure black, separated by white hairlines at low opacity. One ember amber is the only colour, used rarely and allowed to glow like a lamp rather than shine like neon. Calm, nocturnal, easy on the eyes; low volume.",
  composition: [
    "Let items float with space around them rather than packing them edge to edge.",
    "Build depth by layering ground, raised panel and card tones, not by heavy shadows.",
    "Use simple two- or three-column grids at gap-6 to gap-8.",
    "Put the single ember accent where the eye should land first, and nowhere else on that screen.",
  ],
  typography: {
    display: "Onest",
    body: "Onest",
    mono: "JetBrains Mono",
    displayWeight: 600,
    bodyWeight: 400,
    displayTracking: "-0.03em",
    scale: 1.333,
    notes: [
      "Headings step 88, 64, 48, 36, 28px; body 16px; labels 12px.",
      "Hierarchy comes from size and weight; colour only separates primary from muted text.",
      "Metadata, shortcuts and code in JetBrains Mono at tracking-[0.02em].",
    ],
  },
  alternativePairing: { display: "Geist", body: "Geist" },
  palette: {
    background: "#0b0b10",
    surface: "#13131b",
    surfaceAlt: "#1b1b25",
    foreground: "#f6f6f4",
    muted: "#a2a2ab",
    border: "#26262f",
    accent: ember,
    accentForeground: "#0b0b10",
    success: "#5fbf8a",
    warning: "#e0b04a",
    danger: "#ef5f5f",
    info: "#d1b48a",
  },
  extraTokens: [
    {
      name: "color/ember-glow",
      value: rgba(ember, 0.18),
      use: "Soft glow behind the primary button, hero badge and featured card.",
    },
    {
      name: "color/hairline",
      value: "rgba(255,255,255,0.08)",
      use: "Default 1px borders on panels and inputs.",
    },
    {
      name: "color/hairline-strong",
      value: "rgba(255,255,255,0.15)",
      use: "Emphasised borders and outline buttons.",
    },
    {
      name: "color/smoke-glass",
      value: "rgba(27,27,37,0.6)",
      use: "Translucent card fill with backdrop blur.",
    },
  ],
  radius: radius(6, 8, 12, 16),
  elevation: {
    light: "top",
    flat: shadow([]),
    raised: shadow([
      [0, 1, 0, 0, "rgba(255,255,255,0.05)", true],
      [0, 8, 16, -4, "rgba(0,0,0,0.35)"],
    ]),
    overlay: shadow([
      [0, 0, 0, 1, rgba(ember, 0.3)],
      [0, 0, 28, 0, rgba(ember, 0.18)],
      [0, 20, 48, -8, "rgba(0,0,0,0.55)"],
    ]),
  },
  shape: [
    "Softly rounded: 8px on most elements, 12px on cards, 16px on the hero panel, full for avatars and pills.",
    "Borders are 1px white at 8%, 15% when emphasised.",
    "Drop shadows are low-opacity black; the signature depth is ember light: shadow-[0_0_0_1px_rgba(242,163,58,0.3),0_0_28px_rgba(242,163,58,0.18)] on the featured element.",
  ],
  components: [
    "Primary button: h-11 px-6 rounded-[8px] bg-[#f2a33a] text-[#0b0b10] font-medium shadow-[0_0_24px_rgba(242,163,58,0.18)].",
    "Outline button: h-11 px-6 rounded-[8px] border border-white/15 text-[#f6f6f4] bg-transparent; ghost buttons are text only.",
    "Card: bg-[#1b1b25]/60 backdrop-blur-[8px] border border-white/[0.08] rounded-[12px] p-6.",
    "Input: h-11 rounded-[8px] bg-[#13131b] border border-white/[0.08] px-4 placeholder:text-[#a2a2ab].",
    "Icons: 20px outline glyphs in the muted tone, ember when active.",
    "Keyboard hints: 11px mono chips with a 1px hairline border, rounded-[4px].",
  ],
  signatureMoves: [
    "Ember ambient orbs: two rounded-full circles of 600–800px in amber at 3–4% opacity, blur-[150px], top-centre and bottom-right, in one absolute inset-0 layer.",
    "A noise layer at opacity-[0.02]: one pointer-events-none absolute inset-0 SVG with feTurbulence fractalNoise.",
    "Optional 40px line grid: an SVG <pattern> with 1px lines on top and left edges in white at 2%.",
    "One ember-glowing featured element per screen.",
  ],
  imagery:
    "Product UI shown on the dark surfaces, abstract warm light leaks, night photography with tungsten tones. No cold blue gradients, neon, or bright daylight photos.",
  layout: [
    "max-w-6xl px-6 with sections at py-24.",
    "Feature grids of two or three columns; pricing with the featured card glowing ember.",
  ],
  density: "comfortable",
  do: [
    "Keep every neutral slightly warm.",
    "Use the ember accent once per screen.",
    "Let size and weight carry hierarchy.",
  ],
  dont: [
    "No cold blues or purples.",
    "No pure #000000 grounds.",
    "No heavy borders or bright fills on cards.",
  ],
  useCases: [
    "A keyboard-first app launcher’s marketing page with shortcut demos.",
    "A focus-timer and journaling app for night owls.",
  ],
};
