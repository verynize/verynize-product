// Botanical style. Original to Verynize.
import { softElevation, radius } from "../elevation.mjs";

const moss = "#263328";

export default {
  id: "botanical",
  name: "Botanical",
  summary:
    "Greenhouse calm: rice-paper grounds, moss-green ink, soft serif italics and arched, pebble-smooth shapes.",
  keywords: [
    "botanical",
    "organic",
    "natural",
    "wellness",
    "spa",
    "skincare",
    "plants",
    "garden",
    "ceramics",
    "sustainable",
    "herbal",
    "florist",
    "artisan",
  ],
  scene:
    "A potting bench in a glasshouse: moss, terracotta pots, linen, and morning light through misted panes.",
  identity:
    "Slow, tactile and artisanal. Colours come from leaves, clay and stone; deep moss replaces black. A high-contrast serif leads with single words in italic for a handwritten warmth, and shapes are smoothed like river stones — arches, pills and generous curves. The grid is gently broken so the page feels grown rather than built. Quiet volume.",
  composition: [
    "Stagger rows: every second card sits lower with translate-y-12 so lines feel planted, not printed.",
    "Let large headlines overlap an image or soft shape by a few pixels.",
    "Alternate image-left and image-right rows down the page.",
    "Give every section a calm opening with a short label, a serif headline and one sentence.",
  ],
  typography: {
    display: "Fraunces",
    body: "Figtree",
    mono: null,
    displayWeight: 500,
    bodyWeight: 400,
    displayTracking: "-0.02em",
    scale: 1.333,
    notes: [
      "Headlines at 48–88px; set one meaningful word in italic (Rooted in *patience*).",
      "Body at 17–18px with leading-relaxed in moss, never black.",
      "Buttons and labels are uppercase at tracking-[0.16em], 12–13px.",
    ],
  },
  alternativePairing: { display: "Playfair Display", body: "Source Sans 3" },
  palette: {
    background: "#f7f5ef",
    surface: "#fdfcf8",
    surfaceAlt: "#ebe5d8",
    foreground: moss,
    muted: "#5d665a",
    border: "#e0dacd",
    accent: "#3c5640",
    accentForeground: "#fbfaf5",
    success: "#4c7a45",
    warning: "#9a6a1c",
    danger: "#a64632",
    info: "#3f6878",
  },
  extraTokens: [
    {
      name: "color/terracotta",
      value: "#b8705a",
      use: "Occasional emphasis: a tag, an italic word, a small illustration.",
    },
    { name: "color/clay", value: "#d9c8b4", use: "Secondary fills and image placeholders." },
    { name: "color/sage", value: "#6f8266", use: "Icons, outline buttons and fine vine lines." },
  ],
  radius: radius(12, 20, 28, 40),
  elevation: softElevation(moss, { raised: [0.04, 0.05], overlay: [0.05, 0.1] }),
  shape: [
    "Cards rounded-[28px], buttons rounded-full, images either arch-topped (rounded-t-full) or rounded-[40px].",
    "Borders are 1px stone, quiet enough to disappear at a glance.",
    "Shadows are faint and moss-tinted, e.g. shadow-[0_18px_40px_-12px_rgba(38,51,40,0.10)] on lifted cards.",
    "Overlay cards over photos use bg-[#fdfcf8]/80 backdrop-blur-sm.",
  ],
  components: [
    "Primary button: h-12 px-8 rounded-full bg-[#3c5640] text-[#fbfaf5] uppercase tracking-[0.16em] text-[13px].",
    "Secondary button: h-12 px-8 rounded-full border border-[#6f8266] text-[#3c5640] bg-transparent.",
    "Card: bg-[#fdfcf8] rounded-[28px] p-10 border border-[#e0dacd], or borderless on the alt surface.",
    "Input: h-12 rounded-full bg-[#ebe5d8] px-6, or a bottom-border-only field on light sections.",
    "Icons: thin 1.5px-stroke leaves, drops and suns in sage, floating free or in 48px pale circles.",
  ],
  signatureMoves: [
    "Arch-topped photographs, the most identifying shape of the style.",
    "A paper-grain layer: one pointer-events-none absolute inset-0 SVG with a feTurbulence fractalNoise filter at opacity-[0.02].",
    "Staggered card rows with images tilted rotate-1 or -rotate-1.",
    "A thin hand-drawn vine as an absolute SVG path in sage curving between two sections.",
    "One italic serif word per headline, occasionally in terracotta.",
  ],
  imagery:
    "Natural-light photography of plants, hands, ceramics, linen and raw ingredients, slightly desaturated and warm. Botanical line illustrations in sage. No glossy product renders, neon or hard flash.",
  layout: [
    "max-w-7xl with sections at py-28 and gaps of gap-10 to gap-16.",
    "Features in three staggered columns; stats in two or four with large serif numerals.",
    "Leave wide margins so the page breathes like a garden path.",
  ],
  density: "spacious",
  do: [
    "Use moss for text and primary actions instead of black.",
    "Mix arches, pills and soft rectangles; avoid sharp corners.",
    "Keep the palette earthy and low in saturation.",
  ],
  dont: [
    "No pure black text or pure white grounds.",
    "No hard drop shadows or neon accents.",
    "No rigid, perfectly aligned card grids everywhere.",
  ],
  useCases: [
    "A small-batch botanical skincare brand’s product and ingredients page.",
    "A plant nursery offering workshops and seasonal subscriptions.",
  ],
};
