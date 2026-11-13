// Font sources for the font family / weight pickers (design/wonder 26–27): the Fontsource catalog served by
// desktop/render.cjs `fontCatalog` (integrations/fonts.mjs), fonts installed on this Mac (`queryLocalFonts`, needs a
// user gesture) and the built-in list as a browser fallback. Web font previews are loaded on demand through
// `desktop.fontFaces` (embedded @font-face CSS) into one <style> element.
import { FONTS } from "./model";
import { platform } from "@/lib/platform";

export type FontEntry = {
  family: string;
  kind: "bundled" | "system" | "generic" | "web" | "local";
  category?: string;
  weights: number[];
  styles?: string[];
};
const desktop = () => platform.desktop;

export const ALL_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const FALLBACK: FontEntry[] = FONTS.map((family) => ({
  family,
  kind:
    family === "Inter"
      ? "bundled"
      : /^(system-ui|monospace|serif|sans-serif)$/.test(family)
        ? "generic"
        : "system",
  weights: family === "Inter" || family === "system-ui" ? ALL_WEIGHTS : [400, 700],
}));

let catalog: Promise<FontEntry[]> | null = null;
/** Bundled + system + Fontsource families (cached for the session; retried after a failure). */
export function loadCatalog(): Promise<FontEntry[]> {
  catalog ??= (async () => {
    try {
      const result = await desktop()?.fontCatalog?.();
      if (result?.fonts?.length) return result.fonts;
    } catch {
      /* offline or browser build */
    }
    catalog = null;
    return FALLBACK;
  })();
  return catalog;
}

const STYLE_WEIGHTS: [RegExp, number][] = [
  [/hairline|thin/i, 100],
  [/extra\s*light|ultra\s*light/i, 200],
  [/semi\s*light|light/i, 300],
  [/semi\s*bold|demi\s*bold|demi/i, 600],
  [/extra\s*bold|ultra\s*bold|heavy/i, 800],
  [/black|fat/i, 900],
  [/bold/i, 700],
  [/medium/i, 500],
];
export const styleWeight = (style: string) =>
  STYLE_WEIGHTS.find(([re]) => re.test(style))?.[1] ?? 400;

let local: Promise<FontEntry[]> | null = null;
/** Installed fonts grouped by family with the weights their styles provide. Call from a user gesture. */
export function loadLocalFonts(): Promise<FontEntry[]> {
  const query = (
    window as unknown as { queryLocalFonts?: () => Promise<{ family: string; style: string }[]> }
  ).queryLocalFonts;
  if (!query) return Promise.resolve([]);
  local ??= query()
    .then((faces) => {
      const byFamily = new Map<string, { weights: Set<number>; styles: Set<string> }>();
      for (const face of faces) {
        if (!face.family || face.family.startsWith(".")) continue;
        const entry = byFamily.get(face.family) ?? { weights: new Set(), styles: new Set() };
        entry.weights.add(styleWeight(face.style));
        entry.styles.add(/italic|oblique/i.test(face.style) ? "italic" : "normal");
        byFamily.set(face.family, entry);
      }
      return [...byFamily]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([family, e]) => ({
          family,
          kind: "local" as const,
          weights: [...e.weights].sort((a, b) => a - b),
          styles: [...e.styles],
        }));
    })
    .catch(() => {
      local = null;
      return [];
    });
  return local;
}

/**
 * A family Verynize cannot offer (Wonder PM3 / PM4: "system-ui (unsupported)"): it is not in the font list (bundled,
 * system, Google and installed fonts). Unknown until the list has loaded. `generic: false` also counts CSS generic
 * keywords (system-ui, sans-serif…) as unsupported: on a live page they name whatever the browser picks, not a font
 * a design can carry.
 */
export function isUnsupportedFont(
  family: string | undefined,
  fonts: FontEntry[],
  { generic = true }: { generic?: boolean } = {},
): boolean {
  const key = (family ?? "").trim().toLowerCase();
  if (!key || !fonts.length) return false;
  return !fonts.some((f) => f.family.toLowerCase() === key && (generic || f.kind !== "generic"));
}

/** Weights available for a family (all weights when unknown). */
export function weightsFor(family: string, fonts: FontEntry[]): number[] {
  const key = family.trim().toLowerCase();
  const found = fonts.filter((f) => f.family.toLowerCase() === key);
  const weights = new Set(found.flatMap((f) => f.weights));
  return weights.size ? [...weights].sort((a, b) => a - b) : ALL_WEIGHTS;
}
export const nearestWeight = (weights: number[], weight: number) =>
  [...weights].sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight) || b - a)[0] ?? weight;

const previewed = new Set<string>();
/**
 * Load the 400 face of each web font for previews, in one `desktop.fontFaces` call (it takes up to 40 families).
 * No-op for local/system fonts and outside the desktop app; resolves once the CSS is in the page.
 */
export async function previewFonts(fonts: FontEntry[]) {
  const wanted = fonts.filter((f) => f.kind === "web" && !previewed.has(f.family)).slice(0, 40);
  const fontFaces = desktop()?.fontFaces;
  if (!wanted.length || !fontFaces) return;
  for (const f of wanted) previewed.add(f.family);
  try {
    const { css } = await fontFaces(
      wanted.map((f) => ({
        family: f.family,
        weights: [nearestWeight(f.weights, 400)],
        styles: ["normal"],
      })),
    );
    if (!css) return;
    let style = document.getElementById("bd-font-previews");
    if (!style) {
      style = document.createElement("style");
      style.id = "bd-font-previews";
      document.head.append(style);
    }
    style.append(document.createTextNode(css + "\n"));
  } catch {
    for (const f of wanted) previewed.delete(f.family);
  }
}
/** Load one web font's preview face (the highlighted row). */
export const previewFont = (font: FontEntry) => previewFonts([font]);
