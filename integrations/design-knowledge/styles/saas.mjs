// SaaS (minimalist modern) style. Original to Verynize.
import { rgba, shadow, radius } from "../elevation.mjs";

const ink = "#101828";
const blue = "#1f4ff0";

export default {
  id: "saas",
  name: "SaaS",
  summary:
    "Clean modern SaaS: airy light layout, a serif display paired with a crisp sans, and one electric blue gradient.",
  keywords: [
    "saas",
    "software",
    "b2b",
    "startup",
    "product",
    "platform",
    "analytics",
    "crm",
    "workflow",
    "automation",
    "subscription",
    "pricing",
    "integration",
    "tool",
  ],
  scene:
    "A bright product studio: white desks, slate notebooks, and one electric-blue sticky note on the whiteboard.",
  identity:
    "Clear, structured and quietly confident. Whitespace does the directing, a characterful serif display adds warmth to an otherwise precise sans interface, and colour is concentrated in a single electric blue gradient used on the few things that matter. Cards are clean and softly lifted, with a few bold details — oversized numerals, a gradient word — to avoid looking templated.",
  composition: [
    "Asymmetric hero: copy at 1.1fr, an abstract product graphic at 0.9fr.",
    "Open each section with a small pill label (dot + mono text), then a serif heading.",
    "Include one inverted slate section with a faint white dot pattern to break the light rhythm.",
    "Raise the highlighted pricing tier above its neighbours and give it the gradient border.",
  ],
  typography: {
    display: "DM Serif Display",
    body: "Plus Jakarta Sans",
    mono: "JetBrains Mono",
    displayWeight: 400,
    bodyWeight: 400,
    displayTracking: "-0.02em",
    scale: 1.333,
    notes: [
      "Hero at 72–84px leading-[1.05]; section heads 48px.",
      "The last word of key headlines takes the blue gradient via bg-clip-text, over a faint gradient highlighter bar.",
      "Section labels JetBrains Mono 12px uppercase tracking-[0.14em] in blue.",
      "Card titles Plus Jakarta Sans 600 at 18px; body 16px leading-relaxed.",
    ],
  },
  alternativePairing: { display: "Calistoga", body: "Manrope" },
  palette: {
    background: "#fafbfc",
    surface: "#ffffff",
    surfaceAlt: "#f0f3f8",
    foreground: ink,
    muted: "#5a687d",
    border: "#e2e7ef",
    accent: blue,
    accentForeground: "#ffffff",
    success: "#12805a",
    warning: "#a25d00",
    danger: "#cf2e2e",
    info: blue,
  },
  extraTokens: [
    { name: "color/accent-end", value: "#4c7dff", use: "End stop of the blue gradient." },
    {
      name: "color/accent-wash",
      value: "#e7edff",
      use: "Highlighter bars, label pills and icon backdrops.",
    },
  ],
  radius: radius(8, 12, 16, 24),
  elevation: {
    light: "top",
    flat: shadow([]),
    raised: shadow([
      [0, 1, 3, 0, rgba(ink, 0.06)],
      [0, 8, 20, -6, rgba(ink, 0.08)],
    ]),
    overlay: shadow([
      [0, 4, 14, 0, rgba(blue, 0.18)],
      [0, 24, 48, -12, rgba(ink, 0.16)],
    ]),
  },
  shape: [
    "Cards rounded-[16px] with a 1px border; buttons rounded-[12px]; labels and badges rounded-full.",
    "Gradient border on featured cards: p-[2px] rounded-[16px] bg-gradient-to-br from-[#1f4ff0] to-[#4c7dff] around a rounded-[14px] bg-white interior.",
    "Shadows are layered and diffuse; primary actions add a blue-tinted lift.",
    "One organic shape per page at most, e.g. rounded-tl-[64px] rounded-br-[64px] on an image.",
  ],
  components: [
    "Primary button: h-12 px-6 rounded-[12px] bg-gradient-to-r from-[#1f4ff0] to-[#4c7dff] text-white font-medium shadow-[0_6px_16px_rgba(31,79,240,0.28)].",
    "Secondary button: border border-[#e2e7ef] bg-white text-[#101828]; ghost in muted text.",
    "Card: rounded-[16px] border border-[#e2e7ef] bg-white p-8 with the raised shadow.",
    "Input: h-12 rounded-[10px] border border-[#e2e7ef] px-4; focus ring blue at 25%.",
    "Section label: inline-flex items-center gap-2 rounded-full border border-[#1f4ff0]/25 bg-[#1f4ff0]/5 px-4 py-1.5 with an 8px blue dot and mono text.",
    "Feature icon: 44px rounded-[12px] tile filled with the blue gradient, white line icon.",
  ],
  signatureMoves: [
    "Abstract hero graphic: a dashed ring, stacked offset cards, a 3×3 dot grid and one solid blue corner block.",
    "Faint blue ambient orbs (4–6%) in section corners so white never feels sterile.",
    "Oversized step numbers and 120px quotation marks as decorative type.",
    "Inverted slate band with a 32px white dot pattern at 4%.",
  ],
  imagery:
    "Product UI screenshots in clean frames, abstract geometric compositions in blue and slate, and occasional team photos with soft natural light. No stock handshakes.",
  layout: [
    "max-w-[1152px] container, sections py-28 to py-36, gaps 20–32px.",
    "Asymmetric two-column splits (1.1/0.9, 1.2/0.8) for hero and benefits; three columns for features.",
  ],
  density: "comfortable",
  do: [
    "Spend the gradient only on primary actions, icons and one headline word.",
    "Pair the serif display with a disciplined sans UI.",
    "Keep plenty of whitespace between sections.",
  ],
  dont: [
    "No second accent color.",
    "No dark mode by default; one inverted band is enough.",
    "No crowded hero with multiple competing calls to action.",
  ],
  useCases: [
    "A workflow automation startup’s homepage and pricing.",
    "A customer analytics platform feature page.",
  ],
};
