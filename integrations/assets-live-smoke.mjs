// Manual live check (hits the network; not part of the test glob):
//   node integrations/assets-live-smoke.mjs
// Uses a temporary font cache unless VERYNIZE_FONT_CACHE is set.
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureFonts, fontFaceCss, resolveFontFamily } from "./fonts.mjs";
import { searchStockPhotos, fetchImageAsDataUrl, attribution } from "./images.mjs";
import { iconToNodeImage } from "./assets.mjs";

const cacheDir =
  process.env.VERYNIZE_FONT_CACHE || (await mkdtemp(path.join(os.tmpdir(), "bd-font-smoke-")));
let failed = false;
const t0 = Date.now();
const info = await resolveFontFamily("Playfair Display", { cacheDir });
console.log(
  "font resolve:",
  info.available
    ? `${info.family} (${info.id}) weights=${info.weights?.join(",")}`
    : `MISSING ${info.reason}`,
);
const fonts = await ensureFonts(["Playfair Display"], [400, 700], {
  cacheDir,
  styles: ["normal", "italic"],
});
console.log(
  "font ensure:",
  fonts.loaded.map((l) => `${l.weight}/${l.style}:${l.source}`).join(" "),
  fonts.missing.length ? "missing=" + JSON.stringify(fonts.missing) : "",
);
const { css, faces } = await fontFaceCss(["Playfair Display"], {
  cacheDir,
  weights: [400, 700],
  styles: ["normal", "italic"],
});
console.log("font css:", faces.length, "faces,", css.length, "chars, cache", cacheDir);
if (!faces.length) failed = true;

const photos = await searchStockPhotos("mountain lake", { orientation: "landscape", count: 3 });
console.log("photos:", photos.source, photos.error || `${photos.results.length} results`);
const photo = photos.results[0];
if (photo) {
  console.log("  ", photo.url, `${photo.width}x${photo.height}`, "|", attribution(photo));
  const img = await fetchImageAsDataUrl(photo.url);
  console.log(
    "image:",
    img.ok ? `${img.mimeType} ${img.bytes}B ${img.width}x${img.height}` : `FAILED ${img.error}`,
  );
  if (!img.ok) failed = true;
} else failed = true;
console.log("icon:", iconToNodeImage("ArrowRight", { color: "#111" })?.slice(0, 40));
console.log(`done in ${Date.now() - t0}ms`, failed ? "WITH FAILURES" : "OK");
process.exitCode = failed ? 1 : 0;
