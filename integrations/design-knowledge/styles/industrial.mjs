// Industrial (skeuomorphic hardware) style. Original to Verynize.
import { shadow, radius } from "../elevation.mjs";

const dark = "#b4bccb";
const light = "#ffffff";

export default {
  id: "industrial",
  name: "Industrial",
  summary:
    "Hardware you can press: moulded grey plastic, recessed screens, safety-orange controls, LEDs and screws.",
  keywords: [
    "industrial",
    "skeuomorphic",
    "hardware",
    "device",
    "synthesizer",
    "audio",
    "machine",
    "control panel",
    "engineering",
    "tactile",
    "retro tech",
    "iot",
    "braun",
  ],
  scene:
    "A workbench under daylight lamps: a grey moulded synth, a safety-orange stop key, a green power LED, masking tape on the casing.",
  identity:
    "The interface is a physical product. Surfaces read as matte injection-moulded plastic and brushed metal, lit from the top-left, so every panel rises or sinks with a paired light and dark shadow. Function is labelled like equipment — small mono capitals, LEDs, vents, screws — and a single safety-orange marks controls that matter. Precise and playful; medium volume.",
  composition: [
    "Treat each section as a device panel bolted to a grey chassis.",
    "Hero 60/40 with a mocked-up device (bezel, inset screen, side keys, power LED) on one side; alternate sides down the page.",
    "Join process steps with recessed pipes rather than arrows.",
    "Tilt testimonial cards rotate-1 and -rotate-1 like stickers pinned to a board.",
  ],
  typography: {
    display: "Barlow",
    body: "Barlow",
    mono: "JetBrains Mono",
    displayWeight: 800,
    bodyWeight: 400,
    displayTracking: "-0.02em",
    scale: 1.25,
    notes: [
      "Hero 56–72px at 800 with an embossed edge: drop-shadow-[0_1px_0_#ffffff].",
      "Buttons, badges, inputs and metadata in JetBrains Mono, 12–13px bold uppercase at tracking-[0.06em].",
      "Every LED, knob and port gets a short mono label (PWR, SYNC, OUT).",
    ],
  },
  alternativePairing: { display: "Chivo", body: "Chivo" },
  palette: {
    background: "#dde2e9",
    surface: "#eceff3",
    surfaceAlt: "#cdd5e1",
    foreground: "#24292d",
    muted: "#4a535c",
    border: "#a7b2c2",
    accent: "#ff4f2e",
    accentForeground: "#1a1a1a",
    success: "#2b8549",
    warning: "#b06d00",
    danger: "#c8232c",
    info: "#2f6db0",
  },
  extraTokens: [
    { name: "color/shadow-dark", value: dark, use: "Lower-right half of every paired shadow." },
    {
      name: "color/shadow-light",
      value: light,
      use: "Upper-left half of every paired shadow and the embossed text edge.",
    },
    {
      name: "color/screen",
      value: "#1f2428",
      use: "Inset device screens and dark technical panels.",
    },
    { name: "color/led-green", value: "#3ee07a", use: "Status LEDs and screen readouts." },
    { name: "color/tape", value: "#f2d23a", use: "Masking-tape labels at 35% opacity." },
  ],
  radius: radius(4, 8, 16, 24),
  elevation: {
    light: "top-left",
    flat: shadow([]),
    raised: shadow([
      [8, 8, 16, 0, dark],
      [-8, -8, 16, 0, light],
    ]),
    overlay: shadow([
      [12, 12, 24, 0, dark],
      [-12, -12, 24, 0, light],
      [1, 1, 0, 0, "rgba(255,255,255,0.5)", true],
    ]),
  },
  shape: [
    "Moulded radii: 4px badges, 8px inputs and buttons, 16px cards, 24px bezels, round LEDs and knobs.",
    "One light from the top-left: raised parts pair a dark shadow down-right with a white one up-left; recessed parts use the same pair inset.",
    "Recessed wells: shadow-[inset_4px_4px_8px_#b4bccb,inset_-4px_-4px_8px_#ffffff] on inputs, screens and slots.",
    "The chassis itself casts no shadow; panels rise from it.",
  ],
  components: [
    "Primary key: h-12 px-6 rounded-[8px] bg-[#ff4f2e] text-[#1a1a1a] font-mono font-bold uppercase tracking-[0.06em] shadow-[4px_4px_8px_rgba(160,50,30,0.35),-4px_-4px_8px_rgba(255,140,120,0.35)].",
    "Secondary key: chassis-coloured with the raised paired shadow and charcoal mono label.",
    "Panel card: bg-[#dde2e9] rounded-[16px] p-8 with the raised shadow, four 6px screw heads in the corners and three vertical vent slots (h-6 w-1 rounded-full, inset shadow) top-right.",
    "Input: h-14 rounded-[8px] bg-[#cdd5e1] px-5 font-mono with the recessed shadow.",
    "Icon housing: h-14 w-14 rounded-full chassis-coloured with the overlay shadow.",
    "LED: h-2.5 w-2.5 rounded-full bg-[#3ee07a] shadow-[0_0_10px_2px_rgba(62,224,122,0.6)] next to a mono label.",
  ],
  signatureMoves: [
    "A device mock in the hero: rounded-[24px] dark bezel, recessed screen with scanlines (SVG <pattern> 4px tile with a 2px band at 25% black), glowing readout and a power LED.",
    "Recessed pipes between steps: h-3 rounded-full bg-[#cdd5e1] shadow-[inset_0_1px_3px_rgba(0,0,0,0.2)].",
    "Masking-tape labels: a skew-x-6 strip of the tape colour at 35% with a handwritten-feel mono label.",
    "A matte noise layer: one pointer-events-none absolute inset-0 SVG with feTurbulence fractalNoise at opacity-[0.22] and mix-blend-overlay.",
    "Punched holes and push pins on pricing and testimonial cards.",
  ],
  imagery:
    "Grayscale product photography of hardware, close-ups of knobs and ports, and technical drawings on a faint blueprint line grid (SVG <pattern>, 32px tiles). Avoid lifestyle stock and saturated colour photos.",
  layout: [
    "max-w-6xl with space-y-24 between sections.",
    "Two- to four-column grids at gap-6 to gap-8.",
    "Pricing as a row of panels; the recommended one has a lit LED and the orange key.",
  ],
  density: "comfortable",
  do: [
    "Keep every shadow consistent with a top-left light.",
    "Label controls like equipment.",
    "Reserve safety orange for the one action that matters.",
  ],
  dont: [
    "No flat cards without depth.",
    "No dark mode chassis; the device is light grey with dark screens inset.",
    "No more than one accent colour besides LED green.",
  ],
  useCases: [
    "A portable synthesizer’s product page with specs and a pre-order.",
    "A smart thermostat app showing schedules on a device-like panel.",
  ],
};
