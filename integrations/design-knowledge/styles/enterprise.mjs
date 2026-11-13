// Enterprise (corporate trust) style. Original to Verynize.
import { rgba, shadow, radius } from "../elevation.mjs";

const indigo = "#4338d6";

export default {
  id: "enterprise",
  name: "Enterprise",
  summary:
    "Approachable corporate trust: crisp slate type, indigo-to-violet gradients, tinted shadows and gentle isometric depth.",
  keywords: [
    "enterprise",
    "corporate",
    "b2b",
    "saas",
    "trust",
    "business",
    "platform",
    "fintech",
    "security",
    "compliance",
    "professional",
    "workflow",
    "crm",
  ],
  scene:
    "A glass-walled boardroom on a bright morning: slate tables, white walls, and a projector beam washing the wall indigo.",
  identity:
    "Serious software that does not feel cold. Credibility comes from orderly structure, clear hierarchy and crisp sans type; warmth comes from an indigo-to-violet gradient, shadows tinted with brand colour instead of grey, and a hero product card tilted in light isometric perspective. Confident, polished and calm; medium volume.",
  composition: [
    "Two-column hero: headline, subline and two buttons on the left, a tilted product card on the right.",
    "Features run as alternating zig-zag rows of copy and screenshots.",
    "Social proof (logo row, stats) sits immediately under the hero.",
    "Close with a dark indigo call-to-action band.",
  ],
  typography: {
    display: "Manrope",
    body: "Manrope",
    mono: "JetBrains Mono",
    displayWeight: 800,
    bodyWeight: 400,
    displayTracking: "-0.025em",
    scale: 1.25,
    notes: [
      "Hero 56–64px at weight 800 and leading-[1.1]; section headings 36–40px at 700; card titles 600.",
      "Split headlines: the first words in foreground, the last one or two in an indigo-to-violet gradient (bg-clip-text text-transparent, 48px and up only).",
      "Navigation and labels at weight 500; form labels 14px semibold in a darker slate.",
    ],
  },
  alternativePairing: { display: "Plus Jakarta Sans", body: "Plus Jakarta Sans" },
  palette: {
    background: "#f7f9fc",
    surface: "#ffffff",
    surfaceAlt: "#eef2f8",
    foreground: "#0e1730",
    muted: "#5a6782",
    border: "#dfe5ef",
    accent: indigo,
    accentForeground: "#ffffff",
    success: "#0f8a63",
    warning: "#b76e00",
    danger: "#d1343f",
    info: "#2f6fe0",
  },
  extraTokens: [
    {
      name: "color/violet",
      value: "#7d3ae8",
      use: "Gradient partner of indigo on buttons and headline words.",
    },
    {
      name: "color/indigo-wash",
      value: "#eceafd",
      use: "Icon wells, soft gradient fills and selected rows.",
    },
    {
      name: "color/indigo-night",
      value: "#1b1650",
      use: "Dark final call-to-action section and footer.",
    },
    {
      name: "color/tinted-shadow",
      value: rgba(indigo, 0.12),
      use: "Every card and button shadow.",
    },
  ],
  radius: radius(6, 8, 12, 16),
  elevation: {
    light: "top",
    flat: shadow([]),
    raised: shadow([[0, 4, 18, -2, rgba(indigo, 0.1)]]),
    overlay: shadow([
      [0, 12, 28, -6, rgba(indigo, 0.16)],
      [0, 6, 10, -6, rgba(indigo, 0.1)],
    ]),
  },
  shape: [
    "Cards rounded-[12px], inputs rounded-[8px], buttons rounded-full or rounded-[8px].",
    "Shadows are tinted indigo, never neutral grey: shadow-[0_4px_18px_-2px_rgba(67,56,214,0.10)].",
    "Borders are 1px and very light; a card has a border or a shadow, rarely a heavy version of both.",
    "Isometric depth on the hero: a perspective-[2000px] parent and a card at rotate-x-[6deg] rotate-y-[-14deg].",
  ],
  components: [
    "Primary button: h-12 px-7 rounded-full bg-gradient-to-r from-[#4338d6] to-[#7d3ae8] text-white font-semibold shadow-[0_6px_16px_rgba(67,56,214,0.28)].",
    "Secondary button: h-12 px-6 rounded-[8px] bg-white border border-[#dfe5ef] text-[#2b3550] font-semibold.",
    "Card: bg-white rounded-[12px] border border-[#eef2f8] p-8 with the raised tinted shadow; emphasised cards lift with -translate-y-1.",
    "Feature icon well: h-12 w-12 rounded-[12px] bg-[#eceafd] text-[#4338d6].",
    "Input: h-11 rounded-[8px] bg-white border border-[#dfe5ef] px-4 with a 14px semibold label above.",
    "NEW badge: solid indigo pill inside a 1px gradient ring.",
  ],
  signatureMoves: [
    "A hero product card tilted in isometric perspective with a floating secondary card overlapping its corner.",
    "Ambient orbs: two or three rounded-full circles of 480–600px in indigo and violet at 25% opacity, blur-[120px], in one absolute inset-0 layer behind the hero.",
    "Gradient last-word headlines.",
    "The centre pricing tier at scale-105 with a 2px indigo ring.",
  ],
  imagery:
    "Clean product screenshots on tinted backdrops, abstract dashboard fragments and diverse team photography with natural light. Illustration, if any, is flat isometric in the indigo-violet range. Avoid generic handshake stock imagery.",
  layout: [
    "max-w-7xl px-6 with sections at py-16 to py-24.",
    "Three-column pricing, four-column stats, logo row of five or six.",
    "Keep a consistent 8px spacing grid.",
  ],
  density: "comfortable",
  do: [
    "Tint every shadow with the brand colour.",
    "Back claims with numbers, logos and compliance badges.",
    "Keep copy direct and benefit-led.",
  ],
  dont: [
    "No grey or black drop shadows.",
    "No dense, unstructured walls of features.",
    "No playful novelty fonts.",
  ],
  useCases: [
    "A security-compliance platform marketing site aimed at IT buyers.",
    "An HR and payroll SaaS homepage with pricing and customer logos.",
  ],
};
