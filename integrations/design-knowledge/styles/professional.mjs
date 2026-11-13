// Professional (refined serif) style. Original to Verynize.
import { softElevation, radius } from "../elevation.mjs";

export default {
  id: "professional",
  name: "Professional",
  summary:
    "Refined serif headlines on warm ivory, hairline rules and one bronze accent; quiet, credible and editorial.",
  keywords: [
    "professional",
    "serif",
    "elegant",
    "refined",
    "consulting",
    "law",
    "legal",
    "advisory",
    "wealth",
    "finance",
    "firm",
    "architecture",
    "institute",
    "foundation",
    "credible",
  ],
  scene:
    "A partner’s study in the late afternoon: ivory stationery, a fountain pen, a bronze desk lamp.",
  identity:
    "Calm authority through typography. A graceful serif carries the headlines at normal weight, a clean sans handles reading, and thin warm rules organise the page instead of boxes and colour. One bronze accent marks labels and actions. Nothing is loud; everything feels considered, like a well-printed annual letter from a respected firm.",
  composition: [
    "Centered, narrow hero: a small mono label, a serif headline, one paragraph, one or two buttons.",
    "Separate sections with full-width 1px warm rules; wrap section labels between two flexible rules.",
    "Features in three even columns; benefits in an asymmetric 1.3fr/0.7fr split.",
    "Present statistics as large serif numerals with a small sans caption underneath.",
  ],
  typography: {
    display: "Cormorant Garamond",
    body: "Libre Franklin",
    mono: "Fragment Mono",
    displayWeight: 500,
    bodyWeight: 400,
    displayTracking: "-0.01em",
    scale: 1.333,
    notes: [
      "Hero headlines 64–80px with leading-[1.05]; section heads 40px; card titles 22px semibold.",
      "Body 16–18px with leading-[1.75] and tracking-[0.005em].",
      "Section labels in Fragment Mono 11px uppercase tracking-[0.16em] in bronze; never use mono for body.",
      "Testimonials set in 22px italic Cormorant.",
    ],
  },
  alternativePairing: { display: "Playfair Display", body: "Source Sans 3" },
  palette: {
    background: "#f9f8f5",
    surface: "#ffffff",
    surfaceAlt: "#f2efe9",
    foreground: "#1b1a18",
    muted: "#65615a",
    border: "#e4dfd6",
    accent: "#7a5b14",
    accentForeground: "#ffffff",
    success: "#3a6b48",
    warning: "#8f5d10",
    danger: "#a1352b",
    info: "#3b587d",
  },
  extraTokens: [
    {
      name: "color/gilt",
      value: "#c9a24e",
      use: "Secondary emphasis: quote marks, featured card top border.",
    },
    {
      name: "color/rule-strong",
      value: "#cdc2ae",
      use: "Emphasised rules and focused input borders.",
    },
  ],
  radius: radius(4, 6, 8, 12),
  elevation: softElevation("#1b1a18", { raised: [0.03, 0.04], overlay: [0.04, 0.08] }),
  shape: [
    "Gentle corners: rounded-[6px] on controls, rounded-[8px] on cards.",
    "1px warm borders and rules carry structure; shadows only hint at lift.",
    "Featured cards gain a 2px gilt top border instead of a heavier shadow.",
  ],
  components: [
    "Primary button: min-h-[44px] px-6 rounded-[6px] bg-[#7a5b14] text-white text-sm font-medium tracking-[0.02em] shadow-[0_4px_12px_rgba(122,91,20,0.18)].",
    "Secondary button: border border-[#1b1a18] bg-transparent; ghost buttons in muted text.",
    "Card: rounded-[8px] border border-[#e4dfd6] bg-white p-8 shadow-[0_1px_2px_rgba(27,26,24,0.04)].",
    "Input: h-12 rounded-[6px] border border-[#e4dfd6] bg-transparent px-4; focus border rule-strong.",
    "Badge: Fragment Mono 10px uppercase in bronze on a bg-[#7a5b14]/[0.06] pill.",
    "Icons: 1.25px line icons in bronze, no wells.",
  ],
  signatureMoves: [
    "Rule-wrapped section labels: flex items-center gap-4 with a flex-1 h-px rule on each side.",
    "Large gilt opening quotation mark (64px) beside italic testimonials.",
    "A faint paper noise over the page and one very soft gilt glow (2–3%) behind the hero.",
  ],
  imagery:
    "Considered photography: architecture, workspaces, portraits in natural light with warm grading. Generous white margins around images. No illustration-heavy or playful visuals.",
  layout: [
    "max-w-[1024px] container, sections py-32 to py-40, cards p-8 to p-10, gaps 32–48px.",
    "Mostly centered, stacked layouts with a few asymmetric two-column moments.",
  ],
  density: "spacious",
  do: [
    "Let the serif carry the identity at normal weight.",
    "Use rules, space and alignment instead of boxes.",
    "Keep bronze for labels, links and the main action only.",
  ],
  dont: [
    "No bold, condensed or all-caps headlines.",
    "No bright colors or gradients.",
    "No heavy shadows or rounded pills.",
  ],
  useCases: [
    "A boutique law firm’s practice areas and team pages.",
    "A private wealth advisory landing page with services and insights.",
  ],
};
