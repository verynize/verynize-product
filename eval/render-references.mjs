#!/usr/bin/env node
// Render the frozen brief inputs to PNG so every app receives identical images:
//   eval/references/07-reference.html -> 07-reference.png (1280x800)
//   eval/references/08-start.jsx      -> 08-start.html + 08-start.png (1280x800)
// Uses tailwindcss from node_modules and headless Chrome. Re-run only if a reference changes
// (then bump the brief "version").
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withTailwind } from "./lib/tailwind.mjs";
import { screenshot, closeBrowser } from "./lib/render.mjs";

const refs = join(dirname(fileURLToPath(import.meta.url)), "references");

function jsxToHtml(jsx, title) {
  const body = jsx
    .replace(/\sclassName=/g, " class=")
    .replace(/\sdata-component-[xy]="[^"]*"/g, "")
    .replace(/<(\w+)([^>]*)\/>/g, "<$1$2></$1>");
  return `<!doctype html>\n<!-- Generated from 08-start.jsx by eval/render-references.mjs. Deliberately mediocre starting screen. -->\n<html lang="en"><head><meta charset="utf-8"><title>${title}</title>\n<!-- TAILWIND -->\n</head><body class="m-0 font-['Inter',system-ui,sans-serif]">\n${body}</body></html>\n`;
}

try {
  const ref = readFileSync(join(refs, "07-reference.html"), "utf8");
  writeFileSync(
    join(refs, "07-reference.png"),
    await screenshot(await withTailwind(ref), { width: 1280, height: 800 }),
  );
  console.log("wrote references/07-reference.png");

  const startHtml = jsxToHtml(
    readFileSync(join(refs, "08-start.jsx"), "utf8"),
    "Pinecone pricing (start)",
  );
  writeFileSync(join(refs, "08-start.html"), startHtml);
  writeFileSync(
    join(refs, "08-start.png"),
    await screenshot(await withTailwind(startHtml), { width: 1280, height: 800 }),
  );
  console.log("wrote references/08-start.html, references/08-start.png");
} finally {
  await closeBrowser();
}
