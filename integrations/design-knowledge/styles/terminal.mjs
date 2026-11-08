// Terminal (CLI) style. Original to Verynize.
import { rgba, shadow, radius } from "../elevation.mjs";

const phosphor = "#4dff2e";

export default {
  id: "terminal",
  name: "Terminal",
  summary:
    "A phosphor-green command line as the whole interface: monospace everything, ASCII frames, prompts and scanlines.",
  keywords: [
    "terminal",
    "cli",
    "command line",
    "shell",
    "console",
    "hacker",
    "ascii",
    "bash",
    "zsh",
    "tmux",
    "server",
    "sysadmin",
    "self-hosted",
    "homelab",
  ],
  scene:
    "A green-phosphor monitor in a dark server room, a cursor blinking after a tidy shell prompt.",
  identity:
    "The shell turned into a design language. Every character is monospace, panes are framed by thin lines or ASCII box drawing, actions read as bracketed commands, and data is shown as text — progress bars of pipes, status codes, flags. Bright phosphor green on near-black dominates; amber warns, red fails. It is functional and nostalgic, closer to a tidy server session than to movie-hacker rain.",
  composition: [
    "Arrange the page as a grid of terminal panes like a tmux split, all aligned to a character grid.",
    "Give each pane a title line drawn with characters (┌─ STATUS ───┐) or an inverted green bar.",
    "Represent charts as text: [██████····] 62%, sparkline glyphs, aligned tables.",
    "Divide sections with character rules (──────, ======).",
  ],
  typography: {
    display: "Space Mono",
    body: "IBM Plex Mono",
    mono: "IBM Plex Mono",
    displayWeight: 700,
    bodyWeight: 400,
    displayTracking: "0em",
    scale: 1.25,
    notes: [
      "Every character monospace, including nav and footer.",
      "Headers uppercase; sizes snap to a strict modular scale (14, 18, 22, 28, 36, 44).",
      "Green text gets a faint phosphor glow: [text-shadow:0_0_6px_rgba(77,255,46,0.45)].",
    ],
  },
  alternativePairing: { display: "VT323", body: "Fira Code" },
  palette: {
    background: "#0b0d0a",
    surface: "#0f120e",
    surfaceAlt: "#151a13",
    foreground: phosphor,
    muted: "#3f9e33",
    border: "#24501f",
    accent: phosphor,
    accentForeground: "#061004",
    success: "#7dff5c",
    warning: "#ffb21f",
    danger: "#ff4a3d",
    info: "#4fd6ff",
  },
  extraTokens: [
    {
      name: "color/scanline",
      value: "#000000",
      use: "CRT scanline bands at 25% opacity, 4px tile with a 2px band.",
    },
  ],
  radius: radius(0, 0, 0, 0),
  elevation: {
    light: "none",
    flat: shadow([]),
    raised: shadow([]),
    overlay: shadow([
      [0, 0, 0, 1, phosphor],
      [0, 0, 18, 0, rgba(phosphor, 0.18)],
    ]),
  },
  shape: [
    "Square corners; panes drawn with 1px solid or dashed borders in dim green.",
    "No drop shadows; the only depth is a faint phosphor glow on focused panes.",
    "CRT scanlines over the whole screen as a 4px SVG pattern of black bands at 25%.",
  ],
  components: [
    'Button as a command: "[ DEPLOY ]" in text-[#4dff2e] border border-[#4dff2e] bg-transparent px-4 py-2; inverted primary bg-[#4dff2e] text-[#061004].',
    "Pane: border border-[#24501f] bg-[#0f120e] with a title bar and p-4 mono content.",
    'Input: no box; a prompt prefix "guest@host:~$" then bg-transparent text, ending in a static █ cursor.',
    "Status tags: [OK] in green, [WARN] in amber, [ERR] in red.",
    "Icons: 16px line icons in green, or plain glyphs (>, $, ~, #).",
  ],
  signatureMoves: [
    "ASCII-art logo or banner in the hero instead of an image.",
    "Text progress bars and tables aligned to the character grid.",
    "Command flags and prompts woven into copy (--help, $ npm i, ~/projects).",
    "Blinking-style block cursor at the end of the hero headline.",
  ],
  imagery:
    "ASCII art and box-drawing diagrams only. No photography, no illustrations, no gradients.",
  layout: [
    "A rigid grid of panes (1, 2 or 3 columns) with 1px gaps in dim green; max-w-[1200px].",
    "Dense spacing, 8px rhythm; sections are panes rather than full-bleed bands.",
  ],
  density: "compact",
  do: [
    "Keep every glyph monospace.",
    "Express data as text characters.",
    "Use amber and red only for warnings and errors.",
  ],
  dont: [
    "No rounded corners or soft shadows.",
    "No Matrix-style falling characters.",
    "No proportional fonts anywhere.",
  ],
  useCases: [
    "A self-hosting tool’s landing page with install commands.",
    "A server status and uptime board.",
  ],
};
