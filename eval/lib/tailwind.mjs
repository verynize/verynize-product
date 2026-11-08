// Compile Tailwind v4 CSS for an HTML string using the repo's tailwindcss package (no CLI, no
// network) and embed Inter from @fontsource so reference renders are deterministic.
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export async function tailwindCss(html) {
  const { compile } = await import("tailwindcss");
  const twDir = dirname(require.resolve("tailwindcss/package.json"));
  const compiler = await compile('@import "tailwindcss";', {
    base: twDir,
    loadStylesheet: async (id, base) => {
      const file =
        id === "tailwindcss"
          ? join(twDir, "index.css")
          : id.startsWith("tailwindcss/")
            ? join(twDir, id.slice("tailwindcss/".length))
            : join(base, id);
      return { path: file, base: dirname(file), content: readFileSync(file, "utf8") };
    },
  });
  const candidates = new Set();
  for (const m of html.matchAll(/\bclass(?:Name)?="([^"]*)"/g))
    for (const c of m[1].split(/\s+/)) if (c) candidates.add(c);
  return compiler.build([...candidates]);
}

export function interFontFaces() {
  const dir = (() => {
    try {
      return join(dirname(require.resolve("@fontsource/inter/package.json")), "files");
    } catch {
      return null;
    }
  })();
  if (!dir) return "";
  return [400, 500, 600, 700]
    .map((w) => {
      const file = join(dir, `inter-latin-${w}-normal.woff2`);
      return existsSync(file)
        ? `@font-face{font-family:'Inter';font-style:normal;font-weight:${w};src:url(data:font/woff2;base64,${readFileSync(file).toString("base64")}) format('woff2');}`
        : "";
    })
    .join("");
}

/** Return html with compiled Tailwind + Inter injected at <!-- TAILWIND --> (or end of <head>). */
export async function withTailwind(html) {
  const style = `<style>${interFontFaces()}\n${await tailwindCss(html)}</style>`;
  return html.includes("<!-- TAILWIND -->")
    ? html.replace("<!-- TAILWIND -->", style)
    : html.replace("</head>", `${style}</head>`);
}
