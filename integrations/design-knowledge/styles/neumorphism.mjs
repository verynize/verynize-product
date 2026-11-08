// Neumorphism style. Original to Verynize.
import { rgba, shadow, radius } from "../elevation.mjs";

const dark = "#a6b1c3";
const light = "#ffffff";

export default {
  id: "neumorphism",
  name: "Neumorphism",
  summary:
    "Soft extruded and recessed shapes on one cool-grey surface, lit from the top left; tactile and calm.",
  keywords: [
    "neumorphism",
    "neumorphic",
    "soft ui",
    "tactile",
    "smart home",
    "controls",
    "dashboard",
    "widget",
    "calm",
    "wellness",
    "thermostat",
    "music player",
    "skeuomorphic",
  ],
  scene:
    "A ceramic control panel cast in one piece of pale grey clay, lit by a window above and to the left.",
  identity:
    "Everything appears moulded from the same soft material. Elements either swell out of the surface or are pressed into it, and those two states are drawn purely with paired light and dark shadows. Color is nearly absent; a single violet marks the primary action. The result is quiet, physical and pleasant to touch, best for small focused interfaces rather than dense content.",
  composition: [
    "Page and cards share one fill so components grow from the surface instead of sitting on it.",
    "Prefer a few large, well-spaced controls over many small ones; each needs room for its shadows.",
    "Nest depth: a raised card can hold a recessed well that holds a raised knob.",
    "Center hero content and keep supporting copy short.",
  ],
  typography: {
    display: "Manrope",
    body: "Nunito Sans",
    mono: null,
    displayWeight: 800,
    bodyWeight: 500,
    displayTracking: "-0.025em",
    scale: 1.25,
    notes: [
      "Headlines up to 64px with leading-tight in the foreground slate.",
      "Body 16px in the muted slate; never place light text on the surface.",
      "Numeric readouts (temperature, volume) at 48–72px Manrope 300 inside recessed wells.",
    ],
  },
  alternativePairing: { display: "Plus Jakarta Sans", body: "Mulish" },
  palette: {
    background: "#e3e7ee",
    surface: "#e3e7ee",
    surfaceAlt: "#d9dee7",
    foreground: "#2f3b47",
    muted: "#4f5b69",
    border: "#cdd3dd",
    accent: "#584ed6",
    accentForeground: "#ffffff",
    success: "#237e76",
    warning: "#91600f",
    danger: "#b23a35",
    info: "#3563bf",
  },
  extraTokens: [
    {
      name: "color/shadow-dark",
      value: dark,
      use: "Down-right half of every shadow pair, at 55–70% opacity.",
    },
    {
      name: "color/shadow-light",
      value: light,
      use: "Up-left half of every shadow pair, at 60–80% opacity.",
    },
    {
      name: "color/accent-glow",
      value: "#8a83ff",
      use: "Gradient end on the primary button and active rings.",
    },
  ],
  radius: radius(12, 16, 28, 36),
  elevation: {
    light: "top-left",
    flat: shadow([
      [3, 3, 6, 0, rgba(dark, 0.55), true],
      [-3, -3, 6, 0, rgba(light, 0.7), true],
    ]),
    raised: shadow([
      [8, 8, 16, 0, rgba(dark, 0.6)],
      [-8, -8, 16, 0, rgba(light, 0.75)],
    ]),
    overlay: shadow([
      [14, 14, 28, 0, rgba(dark, 0.65)],
      [-14, -14, 28, 0, rgba(light, 0.8)],
    ]),
  },
  shape: [
    "Light always comes from the top left: dark shadow down-right, light shadow up-left, on every element.",
    "Raised: shadow-[8px_8px_16px_rgba(166,177,195,0.6),-8px_-8px_16px_rgba(255,255,255,0.75)]. Pressed: the same pair inset at 6px.",
    "No borders; edges are drawn only by shadows.",
    "Cards rounded-[28px] to rounded-[36px], buttons and inputs rounded-[16px], knobs and toggles rounded-full.",
  ],
  components: [
    "Primary button: h-12 px-6 rounded-[16px] bg-gradient-to-br from-[#584ed6] to-[#8a83ff] text-white font-semibold with the raised shadow.",
    "Secondary button: rounded-[16px] bg-[#e3e7ee] text-[#2f3b47] raised; pressed state swaps to the inset pair.",
    "Card: rounded-[28px] bg-[#e3e7ee] p-8 with the raised shadow.",
    "Input: h-12 rounded-[16px] bg-[#e3e7ee] px-4 with shadow-[inset_6px_6px_12px_rgba(166,177,195,0.6),inset_-6px_-6px_12px_rgba(255,255,255,0.75)].",
    "Toggle: a recessed rounded-full track holding a raised circular thumb; active track tinted violet at 15%.",
    "Icon socket: h-14 w-14 rounded-full deep inset well with a 22px icon in the accent.",
  ],
  signatureMoves: [
    "Nested depth: raised card → inset socket → icon, so the icon looks drilled in.",
    "Concentric rings alternating raised and inset as abstract hero art.",
    "A large circular dial with an inset track and a raised knob as the hero control.",
  ],
  imagery:
    "Minimal. Use soft 3D-ish line icons and the controls themselves as the imagery. Product photos sit on rounded raised plates. Avoid busy photography that breaks the single-material illusion.",
  layout: [
    "max-w-[1200px] container, hero py-32, grid gaps of at least 40px so shadows never collide.",
    "Two or three columns at most; cards are large and roomy (p-8 to p-12).",
  ],
  density: "spacious",
  do: [
    "Keep page and component fills identical.",
    "Reserve the violet for one primary action per view.",
    "Check text contrast; put important labels in the darker foreground.",
  ],
  dont: [
    "No borders or hairlines.",
    "No dark mode version of the same recipe.",
    "No tightly packed tables or dense lists.",
  ],
  useCases: [
    "A smart-home control app with thermostat and lighting dials.",
    "A meditation timer with session stats and a single start button.",
  ],
};
