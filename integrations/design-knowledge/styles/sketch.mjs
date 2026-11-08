// Sketch (hand-drawn) style. Original to Verynize.
import { shadow, radius } from "../elevation.mjs";

const pencil = "#2a2a2a";

export default {
  id: "sketch",
  name: "Sketch",
  summary:
    "Hand-drawn notebook look: wobbly outlines, marker headings, sticky notes and tape, with hard pencil shadows.",
  keywords: [
    "sketch",
    "sketchy",
    "hand drawn",
    "hand-drawn",
    "doodle",
    "notebook",
    "whiteboard",
    "brainstorm",
    "wireframe",
    "scribble",
    "sticky note",
    "journal",
    "handwritten",
    "marker",
  ],
  scene:
    "A brainstorm wall: dotted notebook pages, yellow sticky notes held by tape, red marker circling the best idea.",
  identity:
    "Approachable and unfinished on purpose. Shapes have wobbly, uneven outlines, headings look written with a felt-tip, cards are taped or pinned in place and tilt slightly. The work-in-progress feel invites people to contribute rather than admire. Shadows are solid like cut paper and colour is limited to marker red, ballpoint blue and sticky-note yellow.",
  composition: [
    "Keep a contained notebook width; let decorations (arrows, tape, pins) spill past card edges.",
    "Tilt cards and notes between -2° and 2°, alternating direction between neighbours.",
    "Point to the main call to action with a dashed, curved hand-drawn arrow.",
    "Connect steps with squiggly dashed SVG lines instead of straight connectors.",
  ],
  typography: {
    display: "Caveat",
    body: "Shantell Sans",
    mono: null,
    displayWeight: 700,
    bodyWeight: 400,
    displayTracking: "0em",
    scale: 1.333,
    notes: [
      "Headings 44–64px Caveat 700; body Shantell Sans at 17–18px minimum because handwriting needs size.",
      "Links get a wavy underline (decoration-wavy) in ballpoint blue.",
      "Occasionally tilt a single punctuation glyph (an exclamation mark at rotate-12) for energy.",
    ],
  },
  alternativePairing: { display: "Kalam", body: "Patrick Hand" },
  palette: {
    background: "#fbf8f2",
    surface: "#ffffff",
    surfaceAlt: "#fff6b8",
    foreground: pencil,
    muted: "#5a564e",
    border: pencil,
    accent: "#d23630",
    accentForeground: "#ffffff",
    success: "#2f7a3a",
    warning: "#9a6200",
    danger: "#c22a24",
    info: "#2b57a0",
  },
  extraTokens: [
    { name: "color/ballpoint", value: "#2b57a0", use: "Links and secondary annotations." },
    { name: "color/tape", value: "#cfd3d8", use: "Translucent tape strips at 50–60%." },
    {
      name: "color/pencil-dot",
      value: "#e2dccf",
      use: "Notebook dot grid and erased-pencil fills.",
    },
  ],
  radius: radius(8, 12, 18, 24),
  elevation: {
    light: "top-left",
    flat: shadow([]),
    raised: shadow([[3, 3, 0, 0, pencil]]),
    overlay: shadow([[7, 7, 0, 0, pencil]]),
  },
  shape: [
    "Replace even radii with wobbly per-corner radii, alternating two variants between neighbours: rounded-[240px_18px_210px_14px/16px_220px_14px_240px] and rounded-[18px_230px_16px_200px/220px_14px_240px_16px].",
    "Borders border-2 (border-[3px] on buttons) in pencil; secondary elements and dividers border-dashed.",
    "Hard unblurred pencil shadows: 3–4px on controls, 7–8px on emphasised cards.",
    "Icon circles use an imperfect radius such as rounded-[52%_46%_54%_48%].",
  ],
  components: [
    "Button: border-[3px] border-[#2a2a2a] bg-white px-6 py-3 text-lg shadow-[4px_4px_0_0_#2a2a2a] with the first wobbly radius; primary fills marker red with white text.",
    "Card: border-2 border-[#2a2a2a] bg-white p-6 with the second wobbly radius and a tape strip (absolute -top-3 left-1/2 h-6 w-20 -translate-x-1/2 -rotate-2 bg-[#cfd3d8]/60).",
    "Sticky note: rotate-1 bg-[#fff6b8] border-2 border-[#2a2a2a] p-6 shadow-[4px_4px_0_0_#2a2a2a].",
    "Input: h-12 border-2 border-[#2a2a2a] bg-white px-4 text-lg with a wobbly radius.",
    "Pin: h-5 w-5 rounded-full border-2 border-[#2a2a2a] bg-[#d23630] at the top centre of a card.",
    "Icons: pencil line icons inside imperfect circles with border-2.",
  ],
  signatureMoves: [
    "Notebook dot grid behind everything: 1px dots every 24px in pencil-dot, as an SVG pattern layer.",
    "Dashed curved arrows (quadratic SVG path, stroke-dasharray 5 5, small arrowhead) pointing at actions.",
    "A loose red marker circle drawn around the recommended pricing tier.",
    "Overlapping avatars with -space-x-4 and hand-drawn border rings.",
  ],
  imagery:
    "Doodles, line sketches, wireframe-style mockups and annotated screenshots. Photos as polaroids taped to the page. Avoid glossy renders and gradients.",
  layout: [
    "max-w-[1024px] container (max-w-[768px] for focused flows), sections py-20, gaps 32px.",
    "Stats in irregular blobs or circled numbers rather than tidy tiles.",
  ],
  density: "comfortable",
  do: [
    "Alternate the two wobbly radii between neighbouring elements.",
    "Keep text large enough for the handwritten faces.",
    "Use tape, pins and arrows to add life.",
  ],
  dont: [
    "No perfect rounded-* corners on containers.",
    "No soft blurred shadows or gradients.",
    "No long paragraphs in the display face.",
  ],
  useCases: [
    "A collaborative whiteboard tool’s landing page.",
    "A workshop sign-up page for a design thinking course.",
  ],
};
