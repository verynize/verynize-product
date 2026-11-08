// Playful Geometric style. Original to Verynize.
import { shadow, radius } from "../elevation.mjs";

const ink = "#1c2433";

export default {
  id: "playful-geometric",
  name: "Playful Geometric",
  summary:
    "Tidy content blocks surrounded by confetti circles, triangles and squiggles in candy colors with chunky outlines.",
  keywords: [
    "playful",
    "geometric",
    "memphis",
    "fun",
    "friendly",
    "colorful",
    "kids",
    "education",
    "learning",
    "onboarding",
    "community",
    "shapes",
    "confetti",
    "event",
  ],
  scene:
    "A tidy classroom pinboard: neat cards in rows, with paper circles, triangles and squiggles cut from candy-colored card scattered around them.",
  identity:
    "Orderly in the middle, exuberant at the edges. Content sits in clean outlined cards on a calm grid while the surrounding space is full of primitive shapes, patterns and bright color. Chunky outlines and small hard shadows make things feel like toys you could pick up. It is friendly and optimistic without being childish.",
  composition: [
    "Keep reading areas clean on a 12-column grid grouped into 6/6 or 4/4/4 blocks.",
    "Scatter 4–8 decorative primitives (circles, triangles, pills, squiggles) around each section, never over text.",
    "Hero: copy left, an image in a blob or arch mask right, a large sun-colored circle sitting behind the headline.",
    "Link feature cards with dashed connector lines; alternate card header colors.",
  ],
  typography: {
    display: "Fredoka",
    body: "Lexend",
    mono: null,
    displayWeight: 700,
    bodyWeight: 400,
    displayTracking: "-0.02em",
    scale: 1.25,
    notes: [
      "Headlines 48–72px with one word underlined by a hand-drawn squiggle SVG in pink or sun.",
      "Body 16–17px with leading-relaxed; labels 12px bold uppercase tracking-[0.08em].",
      "Color emphasis words in violet, pink or mint, one per heading.",
    ],
  },
  alternativePairing: { display: "Outfit", body: "Plus Jakarta Sans" },
  palette: {
    background: "#fffaf0",
    surface: "#ffffff",
    surfaceAlt: "#eef2f7",
    foreground: ink,
    muted: "#586377",
    border: "#d9e0ea",
    accent: "#6b34dc",
    accentForeground: "#ffffff",
    success: "#16815a",
    warning: "#a86500",
    danger: "#d0344a",
    info: "#2563c9",
  },
  extraTokens: [
    {
      name: "color/pink",
      value: "#f26aa9",
      use: "Confetti shapes, featured card shadow, highlight words.",
    },
    {
      name: "color/sun",
      value: "#f9b928",
      use: "Big hero circle, badges and squiggle underlines.",
    },
    { name: "color/mint", value: "#34cf96", use: "Icon circles and success confetti." },
    { name: "color/outline", value: ink, use: "Chunky 2px outlines and hard shadows." },
  ],
  radius: radius(8, 16, 24, 32),
  elevation: {
    light: "top-left",
    flat: shadow([]),
    raised: shadow([[4, 4, 0, 0, ink]]),
    overlay: shadow([[8, 8, 0, 0, ink]]),
  },
  shape: [
    "border-2 in the ink color on every interactive element and card.",
    "Mix radii on one shape for character: speech bubble rounded-[24px] rounded-bl-none, arch rounded-t-full, leaf rounded-tl-[40px] rounded-br-[40px].",
    "Hard pop shadows: 4px ink on buttons, 8px soft-border color on cards, 8px pink on the featured card.",
  ],
  components: [
    "Primary button: h-12 pl-6 pr-2 rounded-full border-2 border-[#1c2433] bg-[#6b34dc] text-white font-bold shadow-[4px_4px_0_0_#1c2433], ending in a 32px white circle holding an arrow.",
    "Secondary button: rounded-full border-2 border-[#1c2433] bg-transparent px-6 h-12 font-bold.",
    "Card: rounded-[16px] border-2 border-[#1c2433] bg-white p-6 shadow-[8px_8px_0_0_#d9e0ea] with an icon circle overlapping the top edge (-mt-12).",
    "Input: h-12 rounded-[10px] border-2 border-[#c7d0dd] bg-white px-4; focus border violet.",
    "Icon: white line icon in a 48px circle of violet, pink, sun or mint with border-2 border-[#1c2433].",
    "Badge: rotated star or pill, rotate-[-8deg] bg-[#f9b928] border-2 border-[#1c2433] font-bold text-xs.",
  ],
  signatureMoves: [
    "Confetti field of small primitives in the four candy colors around content blocks.",
    "Pattern fills inside shapes: dot grids, line grids or diagonal stripes as SVG pattern layers.",
    "Featured pricing card at scale-110 with a rotated star badge.",
    "Squiggle SVG underline beneath one headline word.",
  ],
  imagery:
    "Bright flat illustrations, people photos in blob or arch masks over dotted backdrops, simple geometric spot illustrations. Keep photos cheerful and well lit.",
  layout: [
    "max-w-[1152px] container, sections py-24, card gaps 24–32px.",
    "Large blocks: 6/6 hero, 4/4/4 features, centered call to action surrounded by shapes.",
  ],
  density: "comfortable",
  do: [
    "Keep text areas calm and decoration at the edges.",
    "Rotate the four candy colors evenly.",
    "Give every interactive element the same chunky outline.",
  ],
  dont: [
    "No decoration overlapping body text.",
    "No soft blurred shadows or glass.",
    "No muted earthy palette.",
  ],
  useCases: [
    "A coding course for teenagers with modules and pricing.",
    "A community meetup app onboarding flow.",
  ],
};
