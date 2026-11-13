// xterm theme and font from the `terminal-tokens` block of web/src/styles/globals.css. Tokens may be any CSS color
// (var(), color-mix(), …); they are normalised to #rrggbb(aa) through a canvas so xterm can parse them.
import type { ITheme } from "@xterm/xterm";

const COLOR_KEYS = [
  "background",
  "foreground",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const satisfies readonly (keyof ITheme)[];

const tokenName = (key: string) =>
  "--terminal-" + key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());

let context: CanvasRenderingContext2D | null = null;
function normalizeColor(value: string): string | undefined {
  if (!value) return undefined;
  context ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!context) return value;
  context.canvas.width = context.canvas.height = 1;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = "#000000";
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return "#" + hex(r) + hex(g) + hex(b) + (a < 255 ? hex(a) : "");
}

export type TerminalAppearance = {
  theme: ITheme;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
};

/** Reads the terminal tokens as they apply to `element` (so the light theme on <html> is honoured). */
export function readTerminalAppearance(element: Element): TerminalAppearance {
  const style = getComputedStyle(element);
  const theme: ITheme = {};
  for (const key of COLOR_KEYS) {
    const color = normalizeColor(style.getPropertyValue(tokenName(key)).trim());
    if (color) theme[key] = color;
  }
  const fontSize = parseFloat(style.getPropertyValue("--terminal-font-size")) || 12;
  const lineHeight = parseFloat(style.getPropertyValue("--terminal-line-height")) || 1;
  const fontFamily =
    style.getPropertyValue("--terminal-font-family").trim() || "ui-monospace, Menlo, monospace";
  return { theme, fontFamily, fontSize, lineHeight };
}

export const sameAppearance = (a: TerminalAppearance, b: TerminalAppearance) =>
  JSON.stringify(a) === JSON.stringify(b);
