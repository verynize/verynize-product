// Claymorphism style. Original to Verynize.
import { shadow, radius } from "../elevation.mjs";

export default {
  id: "claymorphism",
  name: "Claymorphism",
  summary:
    "Squishy matte clay: puffy rounded blocks, candy colours and layered inner shadows over a lilac ground.",
  keywords: [
    "claymorphism",
    "clay",
    "3d",
    "playful",
    "puffy",
    "toy",
    "kids",
    "friendly",
    "candy",
    "soft ui",
    "bubbly",
    "edtech",
    "cute",
  ],
  scene:
    "A shelf of matte vinyl toys under soft studio light: violet, bubblegum and sky, every edge rounded by thumbs.",
  identity:
    "Interfaces made of soft modelling clay. Surfaces look dense and squeezable, lit from the top-left, with a rounded highlight on one side and a soft shadow on the other. Colours are bright but matte, corners are never sharp, and elements float a little above a pale lilac ground. Playful, optimistic and touchable; medium-loud.",
  composition: [
    "Use bento grids that mix col-span-1, col-span-2 and row-span-2 tiles.",
    "Pair a text column with an abstract stack of nested clay shapes instead of a photograph.",
    "Let badges and small shapes break out of their containers with negative offsets so things seem to hover.",
    "Place three or four huge soft colour blobs behind the content.",
  ],
  typography: {
    display: "Fredoka",
    body: "Figtree",
    mono: null,
    displayWeight: 700,
    bodyWeight: 500,
    displayTracking: "-0.02em",
    scale: 1.333,
    notes: [
      "Hero at 72–96px with leading-[1.05]; section headings 44–52px; card titles 20–24px.",
      "Gradient text (bg-gradient-to-r bg-clip-text text-transparent) only on one or two display words at 48px and above.",
      "Body 16–18px medium weight; the lightest grey allowed is the muted role.",
    ],
  },
  alternativePairing: { display: "Nunito", body: "DM Sans" },
  palette: {
    background: "#f3eff9",
    surface: "#ffffff",
    surfaceAlt: "#ebe5f3",
    foreground: "#2f2a38",
    muted: "#625c6b",
    border: "#ddd5ea",
    accent: "#6d3ddb",
    accentForeground: "#ffffff",
    success: "#118a63",
    warning: "#b8720a",
    danger: "#cc3358",
    info: "#0b85bb",
  },
  extraTokens: [
    {
      name: "color/accent-deep",
      value: "#5427b8",
      use: "Lower stop of the primary button gradient.",
    },
    {
      name: "color/bubblegum",
      value: "#e8418f",
      use: "Secondary gradients, blobs and highlight badges.",
    },
    { name: "color/sky", value: "#33b5ea", use: "Information orbs and background blobs." },
    {
      name: "color/well-shadow",
      value: "#d4cde2",
      use: "Dark half of the pressed-in shadow pair on inputs.",
    },
  ],
  radius: radius(20, 24, 32, 48),
  elevation: {
    light: "top-left",
    flat: shadow([]),
    raised: shadow([
      [14, 14, 28, 0, "rgba(150,138,176,0.22)"],
      [-8, -8, 20, 0, "rgba(255,255,255,0.9)"],
      [5, 5, 10, 0, "rgba(109,61,219,0.04)", true],
      [-5, -5, 10, 0, "rgba(255,255,255,0.9)", true],
    ]),
    overlay: shadow([
      [20, 24, 48, 0, "rgba(150,138,176,0.30)"],
      [-10, -10, 24, 0, "rgba(255,255,255,0.9)"],
      [6, 6, 12, 0, "rgba(109,61,219,0.05)", true],
    ]),
  },
  shape: [
    "Nothing is smaller than 20px radius; radii step down about 8px per nesting level (48 hero, 32 card, 24 inner image, 20 button).",
    "Light comes from the top-left: raised surfaces pair a dark offset down-right with a white one up-left, plus two inset layers for the rounded rim.",
    "Inputs and wells press in with the same pair inset: shadow-[inset_8px_8px_16px_#d4cde2,inset_-8px_-8px_16px_#ffffff].",
    "Orbs, avatars and badges are fully round.",
  ],
  components: [
    "Primary button: h-14 px-8 rounded-[20px] bg-gradient-to-br from-[#6d3ddb] to-[#5427b8] text-white font-bold shadow-[10px_10px_20px_rgba(109,61,219,0.30),-6px_-6px_14px_rgba(255,255,255,0.5),inset_3px_3px_6px_rgba(255,255,255,0.35),inset_-3px_-3px_6px_rgba(0,0,0,0.12)].",
    "Secondary button: same shape in white with text-[#6d3ddb] and a softer version of the stack.",
    "Card: bg-white/75 backdrop-blur-xl rounded-[32px] p-8 with the raised elevation so blobs glow through.",
    "Input: h-14 rounded-[20px] bg-[#ebe5f3] px-6 border-0 with the pressed-in shadow.",
    "Icon orb: 56px rounded-full with a two-stop gradient (light to saturated) that differs per card, white glyph inside.",
    "Badge: rounded-full px-4 py-1.5 bg-[#e8418f] text-white font-bold, nudged -mt-3 -mr-3 outside its card.",
  ],
  signatureMoves: [
    "Ambient blobs: three rounded-full circles of 500–700px in violet, bubblegum and sky at 12% opacity, blur-[120px], in one absolute inset-0 layer behind content.",
    "Gradient icon orbs in a different colour pair on every card.",
    "A floating clay composition: a large rounded square, a sphere and a pill stacked and overlapping with the raised shadow.",
    "Elements that overhang their parent with negative margins.",
  ],
  imagery:
    "Soft 3D renders of rounded objects in the palette, or abstract clay shapes built from layered rounded divs. Avoid photography, sharp-edged illustration and line icons with thin strokes.",
  layout: [
    "max-w-7xl with sections at py-24 and gap-6 to gap-8 bento grids.",
    "Hero inside a rounded-[48px] container on the alt surface.",
    "Keep generous padding (p-8 and up) so shapes have room to puff out.",
  ],
  density: "comfortable",
  do: [
    "Keep one top-left light source across every shadow.",
    "Vary orb gradients so tiles feel collected rather than cloned.",
    "Use bright colours as fills, not as thin lines.",
  ],
  dont: [
    "No sharp corners or radii under 20px.",
    "No flat, shadowless cards.",
    "No dark mode; clay reads on light lilac.",
  ],
  useCases: [
    "A children’s learning app landing page with lesson tiles and a parent sign-up.",
    "A playful budgeting app with savings goals shown as puffy progress cards.",
  ],
};
