// Web3 (Bitcoin / DeFi) style. Original to Verynize.
import { rgba, shadow, radius } from "../elevation.mjs";

const orange = "#f59a23";
const gold = "#ffd42a";

export default {
  id: "web3",
  name: "Web3",
  summary:
    "Bitcoin-orange light in a near-black void: hairline grids, mono data, warm glows and gold for value.",
  keywords: [
    "web3",
    "crypto",
    "bitcoin",
    "blockchain",
    "defi",
    "wallet",
    "token",
    "exchange",
    "staking",
    "nft",
    "dao",
    "ledger",
    "mining",
    "onchain",
    "protocol",
  ],
  scene:
    "A mining rig humming in a dark vault, its status LEDs throwing orange and gold light across brushed-steel racks.",
  identity:
    "Technical and valuable, warmer than generic dark mode. The page is a near-black void where data structures glow with orange and gold rather than blue, lines are ultra-thin, numbers and labels are monospace, and grids are strict like a ledger. Light comes from the components themselves as soft colored halos. It should feel secure and precise, never casino-like.",
  composition: [
    "Hero: headline left with the last word in an orange-to-gold gradient, a glowing orb with orbital rings on the right surrounded by floating stat cards.",
    "Alternate sections between the void and the surface color instead of using hard dividers.",
    "Lay out how-it-works as a ledger: a vertical orange line fading out, with numbered circular nodes.",
    "Put a stats ticker in a thin border-y band with mono numerals.",
  ],
  typography: {
    display: "Sora",
    body: "Manrope",
    mono: "Red Hat Mono",
    displayWeight: 600,
    bodyWeight: 400,
    displayTracking: "-0.03em",
    scale: 1.333,
    notes: [
      "Hero 64–80px leading-[1.05]; gradient fill only on the final one or two words.",
      "Prices, hashes, stats, badges and nav labels in Red Hat Mono, uppercase tracking-[0.12em] for labels.",
      "Body 16px leading-relaxed in the muted slate.",
    ],
  },
  alternativePairing: { display: "Space Grotesk", body: "DM Sans" },
  palette: {
    background: "#040405",
    surface: "#101217",
    surfaceAlt: "#171a21",
    foreground: "#f8f8f6",
    muted: "#97a1b3",
    border: "#222a38",
    accent: orange,
    accentForeground: "#0a0603",
    success: "#3fd28a",
    warning: "#ffb020",
    danger: "#ff5a4f",
    info: "#5b9dff",
  },
  extraTokens: [
    {
      name: "color/ember",
      value: "#e3620f",
      use: "Deep end of the orange gradient and icon wells.",
    },
    { name: "color/gold", value: gold, use: "Value, rewards and gradient highlights." },
    { name: "color/grid-line", value: "#1c2433", use: "Blockchain grid lines at 50%." },
  ],
  radius: radius(8, 12, 16, 24),
  elevation: {
    light: "emissive",
    flat: shadow([]),
    raised: shadow([
      [0, 0, 0, 1, "rgba(255,255,255,0.08)"],
      [0, 0, 44, -12, rgba(orange, 0.14)],
    ]),
    overlay: shadow([
      [0, 0, 0, 1, rgba(orange, 0.35)],
      [0, 0, 32, -6, rgba("#e3620f", 0.45)],
    ]),
  },
  shape: [
    "Cards rounded-[16px] to rounded-[20px]; buttons rounded-full; inputs rounded-[10px] or bottom-border only.",
    "Borders 1px white at 8–12% or the slate border color.",
    "Depth is colored light: zero-offset orange or gold glows instead of drop shadows.",
    "Glass panels bg-black/40 backdrop-blur-sm over the grid for floating stats.",
  ],
  components: [
    "Primary button: h-12 px-7 rounded-full bg-gradient-to-r from-[#e3620f] to-[#f59a23] text-[#0a0603] font-bold uppercase tracking-[0.08em] shadow-[0_0_24px_-6px_rgba(227,98,15,0.6)].",
    "Outline button: rounded-full border-2 border-white/20 text-white px-7 h-12.",
    "Card: rounded-[16px] border border-white/10 bg-[#101217] p-8 with a soft orange halo; popular tier scale-105 border-[#f59a23].",
    "Input: h-12 bg-black/50 border-0 border-b-2 border-white/20 px-4 font-mono text-sm.",
    "Icon well: rounded-[12px] bg-[#e3620f]/20 border border-[#e3620f]/50 p-3 with an orange or gold line icon.",
    "Trust badge: rounded-full border border-white/10 px-3 py-1 font-mono text-xs with a live green dot.",
  ],
  signatureMoves: [
    "Blockchain grid: 1px grid-line lines every 48px in an SVG pattern layer, masked radially so it fades from the centre.",
    "Ambient orange orbs at ~10% blurred off the corners.",
    "Feature cards with orange corner brackets (border-t border-l top-left, border-r border-b bottom-right) and a large rotated icon watermark at 15%.",
    "Hero orb inside concentric orbital rings with staggered floating stat cards.",
  ],
  imagery:
    "Abstract 3D coins, nodes and orbit diagrams in orange and gold, data visualisations, and the product UI. No stock photos of people holding phones.",
  layout: [
    "max-w-[1280px] container, sections py-24, gaps 32–48px.",
    "Strict grids of three or four cards; one border-y band for the stats ticker.",
  ],
  density: "comfortable",
  do: [
    "Keep the palette strictly warm: orange, ember, gold on near-black.",
    "Set every number in mono.",
    "Tint every glow orange or gold.",
  ],
  dont: [
    "No purple or blue neon gradients.",
    "No neutral grey drop shadows.",
    "No casino-style flashing or confetti.",
  ],
  useCases: [
    "A self-custody bitcoin wallet landing page.",
    "A DeFi staking dashboard with yields and positions.",
  ],
};
