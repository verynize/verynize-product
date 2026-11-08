#!/usr/bin/env node
// Normalize an app's output into eval/results/<app>/<brief>/<run>.png at the brief viewport (1x).
//
//   node eval/capture.mjs --brief <id> --app <app> --run run-1 --png <exported.png>   (Wonder/Pen/Figma/BD app export)
//   node eval/capture.mjs --brief <id> --app <app> --run run-1 --html <export.html>   (any HTML export, rendered in Chrome)
//
// PNG input exported at 2x/3x is downscaled to the brief width. Viewport briefs are checked against
// the expected height (warning if it differs by > 2%); fullPage briefs keep the full height.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { EVAL_DIR, APPS, loadBrief } from "./lib/briefs.mjs";
import { screenshot, closeBrowser } from "./lib/render.mjs";

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!opt("--brief") || !opt("--app") || !opt("--run") || !(opt("--png") || opt("--html"))) {
  console.log(
    "usage: node eval/capture.mjs --brief <id> --app <app> --run run-1 (--png file | --html file)",
  );
  process.exit(2);
}
const brief = loadBrief(opt("--brief")),
  app = opt("--app"),
  run = opt("--run");
if (!APPS.includes(app)) throw new Error(`--app must be one of ${APPS.join(", ")}`);
if (!/^[a-z0-9._-]+$/i.test(run)) throw new Error("--run must be a simple name such as run-1");
const { width, height, capture } = brief.viewport;
const sharp = (await import("sharp")).default;
let png;
try {
  if (opt("--html"))
    png = await screenshot(readFileSync(resolve(opt("--html")), "utf8"), {
      width,
      height,
      fullPage: capture === "fullPage",
    });
  else {
    const file = resolve(opt("--png"));
    if (!existsSync(file)) throw new Error(`not found: ${file}`);
    png = await sharp(file).resize({ width, withoutEnlargement: false }).png().toBuffer();
  }
} finally {
  await closeBrowser();
}
const meta = await sharp(png).metadata();
if (capture !== "fullPage" && Math.abs(meta.height - height) / height > 0.02)
  console.warn(
    `! height ${meta.height} differs from brief viewport ${height}: export exactly the ${width}x${height} artboard`,
  );
if (capture === "fullPage" && brief.viewport.minHeight && meta.height < brief.viewport.minHeight)
  console.warn(
    `! full page is only ${meta.height}px tall (brief expects >= ${brief.viewport.minHeight})`,
  );
const dir = join(EVAL_DIR, "results", app, brief.id);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `${run}.png`), png);
console.log(`wrote eval/results/${app}/${brief.id}/${run}.png (${meta.width}x${meta.height})`);
