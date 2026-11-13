#!/usr/bin/env node
// HTML/CSS import fidelity: render a page in headless Chrome as-is, import it (integrations/codec-html.mjs),
// render the imported document's HTML export, and compare the box of every element that became a layer.
//
//   node eval/run-import-fidelity.mjs [--verbose] [--tol 2] [--min 0.9]
//
// Pages: the frozen Tailwind references (07, 08) and the self-authored CSS pages in eval/fidelity/import/
// (external stylesheets, @import, cascade, custom properties). Elements are tagged data-name="e<n>" in
// document order before both renders, so boxes pair up by name. Exit code 1 when a page matches fewer
// than --min of its layers within --tol px, or when no browser is available (reported, never "PASS").
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { measure, closeBrowser, browser } from "./lib/render.mjs";
import { withTailwind, interFontFaces } from "./lib/tailwind.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const verbose = args.includes("--verbose"),
  tol = opt("--tol", 2),
  min = opt("--min", 0.9);
const { importHtml } = await import(
  new URL("../integrations/codec-html.mjs", import.meta.url).href
);
const { exportHTML } = await import(
  new URL("../integrations/export-html.mjs", import.meta.url).href
);

/** Give every element inside <body> (outside inline SVG) a data-name in document order. */
function tag(html) {
  let n = 0,
    inSvg = 0,
    inBody = false;
  return html.replace(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g, (all, close, name, rest) => {
    const t = name.toLowerCase();
    if (t === "body") {
      inBody = !close;
      return all;
    }
    if (t === "svg") {
      if (close) inSvg--;
      else if (!rest.endsWith("/")) inSvg++;
      if (close || inSvg > 1) return all;
    } else if (inSvg) return all;
    if (
      close ||
      !inBody ||
      ["script", "style", "link", "meta", "br", "title"].includes(t) ||
      /\sdata-name=/.test(rest)
    )
      return all;
    return `<${name} data-name="e${n++}"${rest}>`;
  });
}
/** Inline local <link rel=stylesheet> and @import for the reference render (setContent has no base URL). */
function inlineCss(html, dir) {
  const read = (file, depth = 0) => {
    const path = join(dir, file);
    if (!existsSync(path) || depth > 4) return "";
    return readFileSync(path, "utf8").replace(
      /@import\s+(?:url\()?["']?([^"')\s]+)["']?\)?\s*([^;]*);/g,
      (m, ref, rest) => {
        const layer = rest.match(/^layer(?:\(([^)]*)\))?\s*/),
          media = rest.slice(layer ? layer[0].length : 0).trim();
        let css = read(ref, depth + 1);
        if (media) css = `@media ${media} {${css}}`;
        return layer ? `@layer ${layer[1] || ""} {${css}}` : css;
      },
    );
  };
  return html.replace(
    /<link\b[^>]*rel=["']?stylesheet["']?[^>]*href=["']([^"']+)["'][^>]*>/gi,
    (m, href) => `<style>${read(href)}</style>`,
  );
}

const pages = [
  {
    id: "07-reference",
    file: join(here, "references/07-reference.html"),
    width: 1280,
    height: 800,
    tailwind: true,
  },
  {
    id: "08-start",
    file: join(here, "references/08-start.html"),
    width: 1280,
    height: 800,
    tailwind: true,
  },
  ...readdirSync(join(here, "fidelity/import"))
    .filter((f) => f.endsWith(".html"))
    .sort()
    .map((f) => ({
      id: f.replace(/\.html$/, ""),
      file: join(here, "fidelity/import", f),
      width: 1280,
      height: 800,
    })),
];

if (!(await browser())) {
  console.error(
    "No Chromium available: install Google Chrome or `npx playwright install chromium`. Import fidelity NOT measured.",
  );
  process.exit(1);
}
let failed = 0;
try {
  for (const p of pages) {
    const tagged = tag(readFileSync(p.file, "utf8"));
    const reference = p.tailwind ? await withTailwind(tagged) : inlineCss(tagged, dirname(p.file));
    const before = await measure(reference, { width: p.width, height: p.height });
    const imported = await importHtml(tagged, {
      baseUrl: p.file,
      viewport: { width: p.width, height: p.height },
    });
    // Same fonts on both sides (the reference render embeds Inter), so only the conversion is measured.
    const exported = exportHTML(imported.document, imported.pageId).replace(
      "</head>",
      `<style>${interFontFaces()}</style></head>`,
    );
    const after = await measure(exported, { width: p.width + 200, height: p.height + 200 });
    const names = Object.keys(before).filter((name) => /^e\d+$/.test(name) && after[name]);
    const bad = [];
    for (const name of names) {
      const a = before[name][0],
        b = after[name][0];
      const d = Math.max(
        Math.abs(a.x - b.x),
        Math.abs(a.y - b.y),
        Math.abs(a.w - b.w),
        Math.abs(a.h - b.h),
      );
      if (d > tol) bad.push({ name, d, a, b });
    }
    const ratio = names.length ? (names.length - bad.length) / names.length : 0;
    const ok = ratio >= min;
    if (!ok) failed++;
    console.log(
      `${p.id.padEnd(24)} ${ok ? "PASS" : "FAIL"}  ${names.length - bad.length}/${names.length} layers within ${tol}px (${(ratio * 100).toFixed(1)}%), ${Object.keys(before).filter((n) => /^e\d+$/.test(n)).length} elements, ${imported.warnings.length} warning(s)`,
    );
    if (verbose)
      for (const x of bad.sort((m, n) => n.d - m.d).slice(0, 12))
        console.log(
          `    ${x.name} off by ${x.d.toFixed(1)}px  ref ${[x.a.x, x.a.y, x.a.w, x.a.h].map((v) => v.toFixed(1)).join(",")}  import ${[x.b.x, x.b.y, x.b.w, x.b.h].map((v) => v.toFixed(1)).join(",")}`,
        );
  }
} finally {
  await closeBrowser();
}
process.exitCode = failed ? 1 : 0;
