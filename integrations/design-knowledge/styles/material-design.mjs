// Material You style. Original to Verynize.
import { softElevation, radius } from "../elevation.mjs";

export default {
  id: "material-design",
  name: "Material You",
  summary:
    "Expressive tonal Material: seed-colour surfaces, pill buttons, soft blurred shapes and friendly Roboto Flex type.",
  keywords: [
    "material",
    "material design",
    "material you",
    "android",
    "google",
    "tonal",
    "app",
    "mobile",
    "friendly",
    "pill",
    "m3",
    "productivity",
  ],
  scene:
    "A phone on a pastel desk at noon: lilac wallpaper, rounded widgets, a rose-tinted floating action button.",
  identity:
    "Material You, the expressive tonal system: one seed colour generates every surface, so even the ground is softly tinted instead of white. Shapes are generous — pill buttons, large rounded containers — and depth comes mostly from stepping between tonal surfaces. Typography is Roboto Flex in its friendly default cut. Soft, colourful and personal; medium volume.",
  composition: [
    "Layer surfaces visibly: ground, blurred organic shapes, tonal containers, content.",
    "Alternate default and tonal section backgrounds; occasionally fill a whole band with primary or tertiary.",
    "Three-column card grids at gap-6 to gap-8 on a 4px base unit.",
    "Lift one featured item with -translate-y-4 and a 2px primary ring.",
  ],
  typography: {
    display: "Roboto Flex",
    body: "Roboto Flex",
    mono: "Roboto Mono",
    displayWeight: 500,
    bodyWeight: 400,
    displayTracking: "-0.01em",
    scale: 1.25,
    notes: [
      "Display 56px, headline 44px, title 22px, body 16px, label 12px at weight 500.",
      "Display line height 1.15–1.25; never heavier than 700.",
      "Labels in sentence case; avoid all-caps buttons.",
    ],
  },
  alternativePairing: { display: "Outfit", body: "Figtree" },
  palette: {
    background: "#fdf8fd",
    surface: "#f4eef8",
    surfaceAlt: "#e9e2ef",
    foreground: "#1d1b20",
    muted: "#4a4551",
    border: "#7a7482",
    accent: "#5f4bb0",
    accentForeground: "#ffffff",
    success: "#2e7d4f",
    warning: "#8a5a00",
    danger: "#b3261e",
    info: "#34618e",
  },
  extraTokens: [
    {
      name: "color/secondary-container",
      value: "#e6ddfa",
      use: "Tonal buttons, chips and selected navigation items.",
    },
    {
      name: "color/on-secondary-container",
      value: "#1f1a2e",
      use: "Text and icons on the secondary container.",
    },
    {
      name: "color/tertiary",
      value: "#84506a",
      use: "Floating action button and contrasting highlights.",
    },
    {
      name: "color/tertiary-container",
      value: "#ffd9e6",
      use: "Soft blurred shapes and tertiary chips.",
    },
  ],
  radius: radius(8, 16, 24, 32),
  elevation: softElevation("#1d1b20"),
  shape: [
    "Buttons, chips and badges rounded-full; cards rounded-[24px], nested cards rounded-[16px], featured cards rounded-[32px], hero containers rounded-[48px].",
    "Containers separate by tone, not borders; the outline role is used sparingly.",
    "Elevation is gentle: tone alone at rest, a soft shadow for cards that float, a stronger one for the FAB.",
    "The filled text field is rounded on top and square at the bottom with an underline.",
  ],
  components: [
    "Filled button: h-10 px-6 rounded-full bg-[#5f4bb0] text-white font-medium.",
    "Tonal button: h-10 px-6 rounded-full bg-[#e6ddfa] text-[#1f1a2e]; outlined: border border-[#7a7482] text-[#5f4bb0]; text button: text-[#5f4bb0] only.",
    "FAB: h-14 w-14 rounded-[16px] bg-[#84506a] text-white with the overlay shadow.",
    "Card: bg-[#f4eef8] rounded-[24px] p-6 borderless with the raised shadow.",
    "Filled field: h-14 bg-[#e9e2ef] rounded-t-[8px] border-b-2 border-[#7a7482] px-4 with a floating label.",
    "Chips: h-8 px-3 rounded-full border border-[#7a7482] text-sm, selected chips fill with the secondary container.",
  ],
  signatureMoves: [
    "Organic blurred shapes: rounded-[96px] rectangles and circles in primary, secondary and tertiary containers at 20–30%, blur-[80px], in one absolute inset-0 layer behind content.",
    "A radial tonal wash from a corner: bg-[radial-gradient(circle_at_top_right,#e6ddfa_0%,transparent_45%)].",
    "Visible tonal stepping between ground, card and inset areas.",
    "On coloured bands, translucent panels of bg-white/10 backdrop-blur-sm border border-white/10.",
  ],
  imagery:
    "Friendly illustrations in the tonal palette, rounded device mockups and people photography with soft natural colour. Crop photos with large radii. Avoid harsh black-and-white or gritty textures.",
  layout: [
    "max-w-7xl with sections at py-12 to py-24.",
    "Navigation as a top app bar or a rounded navigation rail.",
    "Full-width tonal containers for emphasis every few sections.",
  ],
  density: "comfortable",
  do: [
    "Derive every surface from one seed hue.",
    "Express state changes with opacity layers of the same colour.",
    "Keep shapes generous and consistent by component type.",
  ],
  dont: [
    "No pure white grounds.",
    "No sharp corners on interactive elements.",
    "No heavy borders around cards.",
  ],
  useCases: [
    "An Android habit-tracking app’s landing page with widget previews.",
    "A family photo-sharing service with albums and sharing settings.",
  ],
};
