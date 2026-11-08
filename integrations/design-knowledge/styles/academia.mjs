// Academia style. Original to Verynize.
import { rgba, shadow, radius } from "../elevation.mjs";

const walnut = "#1f1813";
const brass = "#c4a05a";

export default {
  id: "academia",
  name: "Academia",
  summary:
    "An old college reading room on screen: walnut panels, parchment type, brass fittings and measured classical ornament.",
  keywords: [
    "academia",
    "classical",
    "scholarly",
    "library",
    "university",
    "museum",
    "archive",
    "literary",
    "heritage",
    "antique",
    "dark academia",
    "manuscript",
  ],
  scene:
    "A reading room after hours: walnut shelving, a green-shaded lamp, brass rails and the oxblood spine of a rare folio.",
  identity:
    "A complete environment rather than a dark theme with a serif swapped in. Everything is warm brown, cream and old metal; there is no pure black, pure white or cool hue anywhere. Classical book typography carries the voice, brass marks every interactive thing, and ornament is rationed so the page feels learned rather than costume-like. Quiet, warm and serious, at a medium volume.",
  composition: [
    "Split the hero 7/5: a long-form headline and opening paragraph on the left, an arch-topped image on the right.",
    "Number major sections like volumes of a set (Volume I, Volume II) in small spaced capitals above each heading.",
    "Separate sections with a centred ornamental rule: a short fading line, a single glyph (❦ or ✦), and the mirrored line.",
    "Run timelines down a central spine with entries alternating left and right.",
    "Allow one flourish per container; a second ornament in the same box starts to look theatrical.",
  ],
  typography: {
    display: "EB Garamond",
    body: "Spectral",
    mono: null,
    displayWeight: 500,
    bodyWeight: 400,
    displayTracking: "-0.01em",
    scale: 1.333,
    notes: [
      "Headlines at 48–76px with leading-[1.08]; body at 17–19px with leading-relaxed and italic, not bold, for emphasis.",
      "Overlines, buttons and volume labels in font-['Marcellus_SC'] at 12–13px with tracking-[0.22em].",
      "Open the first paragraph of a section with a brass drop cap: float-left mr-3 font-['EB_Garamond'] text-[72px] leading-[0.82] text-[#c4a05a].",
      "Lists and step counters use Roman numerals in brass, never Arabic digits.",
    ],
  },
  alternativePairing: { display: "Cormorant", body: "Crimson Pro" },
  palette: {
    background: walnut,
    surface: "#2a211b",
    surfaceAlt: "#3a2f26",
    foreground: "#ece2d0",
    muted: "#a8957f",
    border: "#52443a",
    accent: brass,
    accentForeground: walnut,
    success: "#7f9a5c",
    warning: "#c98a3a",
    danger: "#b0434d",
    info: "#7f9cb0",
  },
  extraTokens: [
    {
      name: "color/brass-light",
      value: "#dcc082",
      use: "Top stop of the brass gradient on primary buttons and the drop cap highlight.",
    },
    {
      name: "color/brass-deep",
      value: "#987632",
      use: "Bottom stop of the brass gradient and pressed button states.",
    },
    {
      name: "color/oxblood",
      value: "#7a2531",
      use: "Wax-seal badges and the rare featured marker; never body text.",
    },
    {
      name: "color/lamp-shadow",
      value: "rgba(8,5,3,0.45)",
      use: "Card drop shadows and the page vignette.",
    },
  ],
  radius: radius(2, 4, 6, 8),
  elevation: {
    light: "top",
    flat: shadow([]),
    raised: shadow([[0, 6, 20, 0, "rgba(8,5,3,0.40)"]]),
    overlay: shadow([
      [0, 0, 0, 1, rgba(brass, 0.25)],
      [0, 20, 48, -6, "rgba(8,5,3,0.60)"],
    ]),
  },
  shape: [
    "Corners are a modest 4px on cards, buttons and inputs; badges and icon wells are round.",
    "Featured images take an arched top with rounded-t-full and a sepia-[0.55] filter.",
    "Engrave labels on brass with a paired text shadow: [text-shadow:0_1px_0_rgba(255,255,255,0.18),0_-1px_0_rgba(0,0,0,0.45)].",
    "Light falls from above like a desk lamp; shadows are warm, long and soft, never grey.",
  ],
  components: [
    "Primary button: h-12 px-7 rounded-[4px] bg-[linear-gradient(180deg,#dcc082_0%,#c4a05a_55%,#987632_100%)] text-[#1f1813] font-['Marcellus_SC'] text-[13px] tracking-[0.18em] with the engraved text shadow.",
    "Secondary button: h-12 px-7 rounded-[4px] border-2 border-[#c4a05a] text-[#c4a05a] bg-transparent in the same small capitals.",
    "Card: bg-[#2a211b] border border-[#52443a] rounded-[4px] p-10 shadow-[0_6px_20px_0_rgba(8,5,3,0.40)] with brass corner brackets.",
    "Input: h-12 bg-[#2a211b] border border-[#52443a] rounded-[4px] px-4 font-['Spectral'] with an italic placeholder in the muted tone.",
    "Seal badge: a 56px oxblood circle with an inner ring of brass at 40% and a small star glyph; one per page section at most.",
    "Icons are thin-stroke brass line drawings of books, quills, scrolls and laurels; no filled icon sets.",
  ],
  signatureMoves: [
    "Brass corner brackets: two absolute L-shapes per frame (top-left and bottom-right), w-8 h-8 border-t-2 border-l-2 border-[#c4a05a] and the mirrored pair, 40px on the hero.",
    "Arch-topped, sepia-toned portrait images framed with a 1px brass hairline.",
    "Ornamental dividers built from two flex-1 h-px lines fading to brass with a centred glyph on the page colour.",
    "A paper-grain noise layer: one pointer-events-none absolute inset-0 SVG with a feTurbulence fractalNoise filter at opacity-[0.04], plus a radial vignette darkening the corners.",
    "An oxblood wax seal overlapping the corner of the featured card.",
  ],
  imagery:
    "Antique engravings, marble busts, library interiors, botanical plates and handwritten manuscripts, all warmed with a sepia filter and cropped in arches or tall rectangles. Avoid modern stock photography and saturated colour; illustrations should look like steel engravings in a single brass or parchment ink.",
  layout: [
    "Sections at py-28 to py-32 inside max-w-6xl; long reading columns cap at max-w-2xl.",
    "Feature grids are three columns of framed cards at gap-8; testimonials read as quoted letters with a signature line.",
    "Leave generous margin around ornaments so they read as punctuation, not wallpaper.",
  ],
  density: "comfortable",
  do: [
    "Keep every colour warm; tint greys toward brown.",
    "Use brass for every link, button and active icon so interaction has one language.",
    "Write real scholarly copy: dates, editions, catalogue numbers, footnotes.",
  ],
  dont: [
    "No pure #000000 or #ffffff anywhere.",
    "No cool blues or neon accents beside the brass.",
    "No sans-serif headlines.",
    "No more than one ornament per card.",
  ],
  useCases: [
    "A rare-books auction house catalogue with lots, provenance notes and bidding.",
    "A humanities research institute homepage announcing a lecture series and fellowships.",
  ],
};
