// Retro (90s web) style. Original to Verynize.
import { shadow, radius } from "../elevation.mjs";

export default {
  id: "retro",
  name: "Retro",
  summary:
    "The late-90s personal homepage: silver bevelled windows, blue underlined links, NEW! badges and hit counters.",
  keywords: [
    "retro",
    "90s",
    "nineties",
    "y2k",
    "geocities",
    "windows 95",
    "old web",
    "nostalgia",
    "nostalgic",
    "webring",
    "guestbook",
    "pixel",
    "vintage computer",
    "homepage",
  ],
  scene:
    "A beige tower PC in a teenager’s bedroom, 1998: a silver desktop, a navy title bar, a counter ticking up visitors.",
  identity:
    "Gleefully dated. Grey bevelled windows, primary colors at full blast, underlined blue links, blinking-style badges and visitor counters recreate the hand-made web before templates. It is loud and a bit clumsy on purpose; the charm is committing to the cheese rather than modernising it. Nothing is translucent and nothing is subtle.",
  composition: [
    "Stack content in window panels: a raised silver frame, a navy gradient title bar, a sunken white content area.",
    "Use table-like grids with visible cell borders and equal columns.",
    "Put a scrolling-announcement strip and a hit counter near the top.",
    "Finish with a construction-stripe band for the final call to action.",
  ],
  typography: {
    display: "Anton",
    body: "Tinos",
    mono: "VT323",
    displayWeight: 400,
    bodyWeight: 400,
    displayTracking: "0em",
    scale: 1.333,
    notes: [
      "Headlines 48–88px, uppercase, with a hard 2px grey text shadow.",
      "Body 15–16px in Tinos with leading-[1.35], like a default browser serif.",
      "Counters, dates and code in VT323 at 20–24px.",
      "Links always underlined; visited purple, hover red.",
    ],
  },
  alternativePairing: { display: "Rubik Mono One", body: "Courier Prime" },
  palette: {
    background: "#bdbdbd",
    surface: "#ffffff",
    surfaceAlt: "#ffffd2",
    foreground: "#000000",
    muted: "#3a3a3a",
    border: "#7e7e7e",
    accent: "#0000e0",
    accentForeground: "#ffffff",
    success: "#008800",
    warning: "#fff000",
    danger: "#e00000",
    info: "#00007a",
  },
  extraTokens: [
    { name: "color/title-bar", value: "#00007a", use: "Start of the window title bar gradient." },
    { name: "color/title-bar-end", value: "#1a7ed0", use: "End of the window title bar gradient." },
    { name: "color/visited", value: "#7c1d9e", use: "Visited links." },
    { name: "color/bevel-light", value: "#e4e4e4", use: "Top-left bevel edge." },
    { name: "color/bevel-dark", value: "#3e3e3e", use: "Bottom-right bevel edge." },
    { name: "color/counter", value: "#26ff26", use: "Hit counter digits on black." },
  ],
  radius: radius(0, 0, 0, 0),
  elevation: {
    light: "top-left",
    flat: shadow([]),
    raised: shadow([
      [-1, -1, 0, 0, "#3e3e3e", true],
      [1, 1, 0, 0, "#e4e4e4", true],
    ]),
    overlay: shadow([
      [-1, -1, 0, 0, "#3e3e3e", true],
      [1, 1, 0, 0, "#e4e4e4", true],
      [3, 3, 0, 0, "#000000"],
    ]),
  },
  shape: [
    "Square corners only.",
    "Raised bevel: border-2 with [border-color:#ffffff_#7e7e7e_#7e7e7e_#ffffff] plus the raised inset pair; sunken reverses both.",
    "Gradients only in window title bars (and the occasional rainbow headline).",
    "Every color is opaque; no transparency or blur.",
  ],
  components: [
    "Button: py-2 px-4 bg-[#bdbdbd] font-bold uppercase tracking-wide text-black with the raised bevel; pressed state uses the sunken bevel.",
    "Blue button: bg-[#0000e0] text-white with [border-color:#5a5aff_#00007a_#00007a_#5a5aff].",
    "Window: raised silver frame p-[3px]; title bar bg-[linear-gradient(to_right,#00007a,#1a7ed0)] px-2 py-1 text-white font-bold text-sm with three tiny bevelled buttons; body sunken bg-white p-4.",
    "Input: sunken bevel, bg-white px-2 py-1 text-sm.",
    'Badge: bg-[#e00000] text-[#fff000] px-1 font-bold text-xs uppercase ("NEW!", "HOT!").',
    "Icons: 32px pixel-style glyphs in solid navy or green bevelled squares.",
  ],
  signatureMoves: [
    "Silver page with a fine 4px crosshatch SVG pattern layer, never flat grey.",
    "Rainbow gradient text on one headline word (red → yellow → green → blue → purple).",
    'Hit counter: VT323 green digits on black in a sunken frame ("You are visitor 004219").',
    "Construction stripes: 10px yellow and black bands rotated 45° in an SVG pattern.",
    "A static marquee-style strip of colored announcements and groove rules between sections.",
  ],
  imagery:
    'Low-res clip art, pixel icons, animated-GIF-style badges, "Under construction" signs and webring buttons (88×31 blocks). Photos small, framed in sunken bevels.',
  layout: [
    "Dense like an 800×600 screen: max-w-[960px], 8px rhythm, sections py-12 to py-16.",
    "Equal-column tables with visible borders for lists and features.",
  ],
  density: "compact",
  do: [
    "Bevel every button and window consistently.",
    "Underline every link.",
    "Use full-saturation primaries with confidence.",
  ],
  dont: [
    "No rounded corners, soft shadows or translucency.",
    "No modern minimal whitespace.",
    "No essential information hidden in decorative marquees.",
  ],
  useCases: [
    "A fan site for an indie video game with a guestbook and downloads.",
    "A playful agency “about us” page styled as a 1998 homepage.",
  ],
};
