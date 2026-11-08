// Glassmorphism style. Original to Verynize.
import { shadow, radius } from "../elevation.mjs";

export default {
  id: "glassmorphism",
  name: "Glassmorphism",
  summary:
    "Frosted panels floating over glowing colour orbs: blur, hairline edges and inner highlights on deep night grounds.",
  keywords: [
    "glassmorphism",
    "glass",
    "frosted",
    "translucent",
    "blur",
    "dashboard",
    "ethereal",
    "futuristic",
    "crypto",
    "music",
    "widget",
    "vision",
  ],
  scene:
    "Frosted cockpit glass over a nebula: violet, teal and rose light blurred through layered panes.",
  identity:
    "Depth by translucency. Panels are frosted glass that filters the saturated colour glowing behind them; light catches their top edges as a thin highlight. The ground is near-black so the orbs read as light sources. Weightless, cinematic and calm, with the volume set by the orbs rather than the UI.",
  composition: [
    "Stack layers deliberately: ground, orbs, glass content, elevated glass, floating nav, overlays.",
    "Leave gaps of gap-6 to gap-8 between panels so the orbs show through.",
    "Place orbs asymmetrically, never centred behind body text.",
  ],
  typography: {
    display: "Sora",
    body: "DM Sans",
    mono: "JetBrains Mono",
    displayWeight: 600,
    bodyWeight: 400,
    displayTracking: "-0.03em",
    scale: 1.333,
    notes: [
      "Display 72–88px at leading-none; H1 48–56px.",
      "The hero headline can fade from white to pale violet to pale teal with bg-gradient-to-r bg-clip-text text-transparent.",
      "Body text is a slightly dimmed white for comfort; captions use the muted role.",
    ],
  },
  alternativePairing: { display: "Outfit", body: "Manrope" },
  palette: {
    background: "#06060c",
    surface: "#0f0f1c",
    surfaceAlt: "#171729",
    foreground: "#f5f6fb",
    muted: "#9aa1b8",
    border: "#2a2a40",
    accent: "#6d3ff0",
    accentForeground: "#ffffff",
    success: "#3ad6a0",
    warning: "#f5b846",
    danger: "#ff5c8a",
    info: "#2cc8e8",
  },
  extraTokens: [
    { name: "color/orb-violet", value: "#7a45ff", use: "Main ambient orb, top-left." },
    {
      name: "color/orb-teal",
      value: "#14c2d6",
      use: "Second orb, bottom-right, and the gradient partner on buttons.",
    },
    { name: "color/orb-rose", value: "#f2559f", use: "Optional third orb mid-page." },
    {
      name: "color/glass-edge",
      value: "rgba(255,255,255,0.12)",
      use: "Hairline border on every glass panel.",
    },
  ],
  radius: radius(12, 16, 24, 32),
  elevation: {
    light: "top",
    flat: shadow([]),
    raised: shadow([
      [0, 8, 32, 0, "rgba(0,0,0,0.32)"],
      [0, 1, 1, 0, "rgba(255,255,255,0.10)", true],
    ]),
    overlay: shadow([
      [0, 18, 50, 0, "rgba(0,0,0,0.45)"],
      [0, 1, 1, 0, "rgba(255,255,255,0.16)", true],
    ]),
  },
  shape: [
    "Hero panels rounded-[32px], cards rounded-[24px], buttons rounded-[16px] or rounded-full, inputs rounded-[12px]; nothing structural smaller.",
    "Every glass panel has three parts: backdrop blur, a white hairline edge at 10–15%, and an inner top highlight.",
    "Glass on glass steps up both tint (white/5 → white/[0.08]) and edge (white/10 → white/15).",
    "Where an orb is bright behind text, darken that pane with a black/15 underlay.",
  ],
  components: [
    "Card: bg-white/5 backdrop-blur-xl border border-white/10 rounded-[24px] p-8 shadow-[0_8px_32px_rgba(0,0,0,0.32),inset_0_1px_1px_rgba(255,255,255,0.10)].",
    "Primary button: h-14 px-8 rounded-[16px] bg-gradient-to-r from-[#6d3ff0] to-[#0e8fa3] text-white font-semibold shadow-[0_0_24px_rgba(122,69,255,0.45)].",
    "Secondary button: h-14 px-8 rounded-[16px] bg-white/10 backdrop-blur-md border border-white/10 text-white.",
    "Input: h-14 rounded-[12px] bg-black/25 backdrop-blur-md border border-white/10 px-5 placeholder:text-white/55.",
    "Badge: rounded-full px-3 py-1 text-xs bg-white/10 backdrop-blur-sm border border-white/10.",
    "Code blocks and data tables stay on a solid surface for legibility.",
  ],
  signatureMoves: [
    "Orb backdrop: violet 600px at 40% top-left, teal 560px at 30% bottom-right, optional rose at 20% mid-page — rounded-full, blur-[140px], one absolute inset-0 layer behind everything.",
    "A floating pill navigation: absolute top-6 left-1/2 -translate-x-1/2 bg-white/5 backdrop-blur-2xl border border-white/10 rounded-full px-8 py-4.",
    "Glow rings on calls to action: shadow-[0_0_24px_rgba(122,69,255,0.45)].",
    "Stacked glass widgets overlapping at slight offsets in the hero.",
  ],
  imagery:
    "Abstract light: blurred gradients, aurora shapes, soft 3D glass objects. Product UI shown as glass widgets. Avoid flat photography, which kills the translucent effect.",
  layout: [
    "max-w-7xl px-6, sections at py-24 to py-32, cards p-8 to p-10.",
    "Two-column hero with a widget cluster on the right.",
  ],
  density: "comfortable",
  do: [
    "Always pair blur with a hairline edge and inner highlight.",
    "Keep orbs vivid enough to show through the glass.",
    "Check text contrast where orbs are brightest.",
  ],
  dont: [
    "No glass on plain flat backgrounds; it needs colour behind it.",
    "No tiny radii or hard shadows.",
    "No long body text directly over a bright orb.",
  ],
  useCases: [
    "A smart-home control dashboard with room widgets.",
    "A music streaming app landing page with now-playing cards.",
  ],
};
