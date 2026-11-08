// Neo-Brutalism style. Original to Verynize.
import { shadow, radius } from "../elevation.mjs";

const ink = "#000000";

export default {
  id: "neo-brutalism",
  name: "Neo-Brutalism",
  summary:
    "Thick black outlines, unblurred offset shadows and loud flat color blocks; a zine pinned to a corkboard.",
  keywords: [
    "brutalism",
    "brutalist",
    "neo-brutalism",
    "bold",
    "loud",
    "playful",
    "zine",
    "sticker",
    "gen z",
    "creator",
    "indie",
    "punk",
    "quirky",
    "gumroad",
  ],
  scene:
    "A photocopied zine taped to a cream wall: marker-black outlines, fluorescent stickers slapped on at angles.",
  identity:
    "Deliberately unpolished and very loud. Every element wears a heavy black outline and casts a hard, unblurred shadow as if cut from card stock. Flat saturated blocks of coral, lemon and lilac fight for attention, type is heavy and often uppercase, and things are tilted a few degrees like stickers. It rejects polished SaaS restraint on purpose.",
  composition: [
    "Stack sections as full-width color blocks (cream, lemon, lilac, black) separated by a 4px black rule.",
    "Use offset splits (60/40) and stagger card rows vertically so the grid feels hand-pinned.",
    "Fill empty space with decoration — stars, arrows, giant faded words — rather than leaving it calm.",
    "Overlap badges and stickers past card corners with absolute positioning.",
  ],
  typography: {
    display: "Bricolage Grotesque",
    body: "Public Sans",
    mono: "Space Mono",
    displayWeight: 800,
    bodyWeight: 600,
    displayTracking: "-0.04em",
    scale: 1.5,
    notes: [
      "Display at 80–128px uppercase with leading-[0.88]; body never lighter than 600.",
      "Outline words by setting the text to the ground color with four 2px black text shadows (one per diagonal).",
      "Labels in Space Mono uppercase tracking-[0.18em] at 12–13px.",
    ],
  },
  alternativePairing: { display: "Archivo Black", body: "Archivo" },
  palette: {
    background: "#fff8ea",
    surface: "#ffffff",
    surfaceAlt: "#ffe45c",
    foreground: "#000000",
    muted: "#3b3b3b",
    border: "#000000",
    accent: "#ff5f5f",
    accentForeground: "#000000",
    success: "#1c7a3e",
    warning: "#a35a00",
    danger: "#c81e1e",
    info: "#2346c9",
  },
  extraTokens: [
    { name: "color/lilac", value: "#cbbcff", use: "Card headers and soft section backgrounds." },
    {
      name: "color/mint",
      value: "#86ebbd",
      use: "Third block color for tags and alternating cards.",
    },
    {
      name: "color/sky",
      value: "#8fd3ff",
      use: "Occasional fourth block color for charts or stickers.",
    },
  ],
  radius: radius(0, 0, 0, 0),
  elevation: {
    light: "top-left",
    flat: shadow([]),
    raised: shadow([[4, 4, 0, 0, ink]]),
    overlay: shadow([[10, 10, 0, 0, ink]]),
  },
  shape: [
    "Square corners everywhere; rounded-full only for pill badges, round stickers and dots.",
    "Border weights: border-2 for dividers, border-4 for every component, border-8 for hero frames.",
    "Shadows are solid black offsets, 4px on controls, 8px on cards, 10–14px on hero pieces; never blurred.",
    "Pressed state slides the element onto its shadow: translate-x-[4px] translate-y-[4px] shadow-none.",
  ],
  components: [
    "Primary button: h-14 px-7 border-4 border-black bg-[#ff5f5f] text-black font-bold uppercase tracking-wide shadow-[4px_4px_0_0_#000].",
    "Secondary button: same frame in bg-[#ffe45c]; outline button in bg-white.",
    "Card: border-4 border-black bg-white shadow-[8px_8px_0_0_#000] with a lilac header strip over a border-b-4 border-black rule.",
    "Input: h-16 border-4 border-black bg-white px-4 text-lg font-bold, no rounding.",
    "Badge: rotate-3 border-2 border-black bg-[#86ebbd] px-3 py-1 text-xs font-black uppercase tracking-widest shadow-[3px_3px_0_0_#000] pinned with absolute -top-4 -right-4.",
    "Icons: stroke-[3px] line icons at 32px inside a bordered color square.",
  ],
  signatureMoves: [
    "Sticker tilts: -rotate-2, rotate-1, rotate-3 on headlines, cards and calls to action.",
    "Textured grounds: a halftone dot grid (1.5px dots every 20px) or a 40px graph-paper grid at 10% black in one absolute SVG pattern layer.",
    "A giant background word at opacity-10 behind the hero, cropped by the edge.",
    "Hollow outlined display words layered over a solid copy offset by a few pixels.",
    "Hand-placed stars, arrows and squiggles drawn as thick-stroke SVG.",
  ],
  imagery:
    "Cut-out photos with a thick black border and hard shadow, flat vector stickers, clip-art stars and arrows. Photos can be posterized or duotoned with one block color. Avoid soft lifestyle photography.",
  layout: [
    "max-w-[1200px] container, sections py-20 to py-28, gaps 32–48px.",
    "Alternate block colors every section; the closing call to action sits on black with white shadows.",
    "Grids stagger: every other card offset by 24–32px vertically.",
  ],
  density: "comfortable",
  do: [
    "Give every component the same border and shadow treatment.",
    "Use uppercase heavy type for anything that should be noticed.",
    "Tilt a few elements per screen, not everything.",
  ],
  dont: [
    "No blurred shadows, gradients or glass.",
    "No grey text on grey; keep everything black on bright.",
    "No thin 1px borders or light font weights.",
  ],
  useCases: [
    "A creator marketplace landing page selling digital downloads.",
    "A launch page for a student hackathon with schedule and prizes.",
  ],
};
