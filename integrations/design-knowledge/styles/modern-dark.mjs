// Modern Dark style. Original to Verynize.
import { rgba, shadow, radius } from "../elevation.mjs";

const indigo = "#5a64d6";

export default {
  id: "modern-dark",
  name: "Modern Dark",
  summary:
    "Near-black product chrome with layered lighting, hairline edges and a single indigo signal for tools people use all day.",
  keywords: [
    "dark",
    "dark mode",
    "developer",
    "devtool",
    "productivity",
    "linear",
    "vercel",
    "raycast",
    "issue tracker",
    "command palette",
    "premium",
    "ai tool",
    "platform",
    "changelog",
  ],
  scene:
    "A studio after hours: matte black desks, monitors dimmed low, one indigo status lamp glowing on the far wall.",
  identity:
    "A quiet, expensive-feeling dark interface. Almost everything is a shade of charcoal; hierarchy comes from how much light a surface catches, from hairline edges that read as bevels, and from type that fades from bright to dim as it descends. Indigo is the only saturated color and it is spent on actions and focus. The mood is focused and cinematic but never moody or neon.",
  composition: [
    "Open with a centered hero: a short headline, one supporting sentence, two buttons, then a product screenshot framed as a floating window.",
    "Separate sections with a 1px top border in white at 6% opacity, or a centered line that fades out at both ends.",
    "Group features in a bento grid of six columns where spans add up exactly; give one tile a 4×2 span as the anchor.",
    "Keep copy columns narrow (max-w-[640px]) even when the surrounding grid is wide.",
    "Let a few surfaces overlap the section above with a negative top margin to create depth between bands.",
  ],
  typography: {
    display: "Geist",
    body: "Geist",
    mono: "Geist Mono",
    displayWeight: 600,
    bodyWeight: 400,
    displayTracking: "-0.035em",
    scale: 1.333,
    notes: [
      "Hero headlines at 64–88px with leading-[1.02]; fill them with a top-to-bottom gradient from white to white at 65% so the bottom line dims.",
      "Body copy at 15–16px in the muted color; only titles and numbers use the bright foreground.",
      "Eyebrows and metadata in Geist Mono at 11–12px, uppercase, tracking-[0.14em].",
      "Pick out one key phrase per page with an indigo-to-lavender gradient clipped to the text.",
    ],
  },
  alternativePairing: { display: "Manrope", body: "Manrope" },
  palette: {
    background: "#07070a",
    surface: "#0d0d11",
    surfaceAlt: "#15151b",
    foreground: "#ececf1",
    muted: "#8e939d",
    border: "#1e1e26",
    accent: indigo,
    accentForeground: "#ffffff",
    success: "#46c486",
    warning: "#e0a43c",
    danger: "#ee5d5d",
    info: "#6aa5f0",
  },
  extraTokens: [
    { name: "color/deepest", value: "#030304", use: "Footer and the darkest well behind modals." },
    {
      name: "color/accent-soft",
      value: "#8f97ee",
      use: "End stop for indigo gradient text and focus rings.",
    },
    { name: "color/input", value: "#111116", use: "Text field fill, a step darker than cards." },
  ],
  radius: radius(6, 8, 16, 20),
  elevation: {
    light: "top",
    flat: shadow([]),
    raised: shadow([
      [0, 0, 0, 1, "rgba(255,255,255,0.06)"],
      [0, 2, 18, 0, "rgba(0,0,0,0.42)"],
      [0, 1, 0, 0, "rgba(255,255,255,0.05)", true],
    ]),
    overlay: shadow([
      [0, 0, 0, 1, "rgba(255,255,255,0.10)"],
      [0, 12, 40, -4, "rgba(0,0,0,0.6)"],
      [0, 0, 72, 0, rgba(indigo, 0.12)],
    ]),
  },
  shape: [
    "Cards at rounded-[16px] with a 1px border in white at 6%; buttons and inputs rounded-[8px].",
    "Instead of borders on buttons, use a 1px inset top highlight (inset 0 1px 0 white at 15%) so they look machined.",
    "Fake a gradient border with a 1px-padded wrapper: rounded-[16px] p-px bg-gradient-to-b from-[#5a64d6]/40 to-transparent around a rounded-[15px] bg-[#0d0d11] interior.",
    "Elevation reads as light, not drop: raised surfaces are a step lighter, overlays add a faint indigo halo.",
  ],
  components: [
    "Primary button: h-10 px-4 rounded-[8px] bg-[#5a64d6] text-white text-sm font-medium shadow-[0_0_0_1px_rgba(90,100,214,0.6),0_4px_14px_rgba(90,100,214,0.3),inset_0_1px_0_rgba(255,255,255,0.2)].",
    "Secondary button: bg-white/[0.05] text-[#ececf1] with shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]; ghost buttons are plain muted text.",
    "Card: rounded-[16px] border border-white/[0.06] bg-gradient-to-b from-white/[0.06] to-white/[0.015] p-6 or p-8, title text-base font-medium, body text-sm muted.",
    "Input: h-10 rounded-[8px] border border-white/10 bg-[#111116] px-3 text-sm; focus ring 2px in the soft indigo.",
    "Badge: rounded-full border border-[#5a64d6]/30 bg-[#5a64d6]/10 px-2.5 py-0.5 text-xs text-[#b8bdf5].",
    "Icon well: h-10 w-10 rounded-[12px] border border-white/[0.08] bg-white/[0.03] holding a 18px line icon in the foreground color.",
  ],
  signatureMoves: [
    "Layered backdrop: a radial base from #0f0f16 at the top to the page color, two or three blurred light pools (indigo at ~20% top-center, violet and blue fainter at the sides) and a 64px line grid at 2–3% in one absolute pattern layer.",
    "A fine fractal-noise overlay at about 2% opacity across the artboard to stop the blacks from banding.",
    "Headline that dims downward via bg-gradient-to-b text clipping, with one phrase in indigo gradient.",
    "Product screenshot in a window frame with a 1px top glow line (h-px bg-gradient-to-r from-transparent via-white/30 to-transparent).",
    "Keyboard hint chips (⌘K) in Geist Mono beside actions.",
  ],
  imagery:
    "Real product UI, cropped close and floated on the dark page with a soft indigo halo. Abstract light — blurred orbs, faint grids, gentle noise — instead of photography. If people appear, use small grayscale avatars in changelog or testimonial rows.",
  layout: [
    "max-w-[1200px] container, sections py-24 to py-32, grid gaps 16–24px.",
    "Alternate full-bleed bands of the page color with bands of the deepest color to pace long pages.",
    "Footers are dense, four to five link columns in 13px muted text.",
  ],
  density: "comfortable",
  do: [
    'Keep 90% of the screen grayscale so indigo means "act here".',
    "Use opacity steps of white (4%, 6%, 10%) for every border and fill.",
    "Show the real product early, ideally in the first viewport.",
  ],
  dont: [
    "No pure #000000 page fills; they kill the layered lighting.",
    "No rainbow gradients or more than one accent hue.",
    "No heavy drop shadows that read as black smudges on black.",
  ],
  useCases: [
    "A landing page for an issue tracker aimed at engineering teams.",
    "The changelog and pricing pages of an AI coding assistant.",
  ],
};
