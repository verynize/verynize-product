#!/usr/bin/env node
// Tier 3a: build a blind, randomized pairwise review page from eval/results/<app>/<brief>/*.png.
//
//   node eval/make-pairs.mjs [--apps verynize,wonder,pen] [--briefs 01,02] [--seed 42]
//        [--max-per-brief 12] [--repeat-swapped 0.1] [--results-dir eval/results] [--out-dir eval/pairwise]
//
// Writes eval/pairwise/review.html (self-contained, images embedded, NO app names) and
// eval/pairwise/key.json (the unblinding key; do not give it to reviewers).
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, basename, resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { EVAL_DIR, PRIMARY_APPS, listBriefs } from "./lib/briefs.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const seed = Number(opt("--seed", Date.now() % 1e9));
const appsWanted = opt("--apps", PRIMARY_APPS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const briefFilter = opt("--briefs") ? opt("--briefs").split(",") : null;
const maxPerBrief = Number(opt("--max-per-brief", 0)) || Infinity;
const repeatSwapped = Number(opt("--repeat-swapped", 0.1)); // fraction of pairs shown twice (swapped) to measure reviewer consistency

// Seeded PRNG (mulberry32) so a page can be regenerated identically.
let state = seed >>> 0;
const rand = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const resultsDir = resolve(opt("--results-dir", join(EVAL_DIR, "results")));
const outDir = resolve(opt("--out-dir", join(EVAL_DIR, "pairwise")));
const briefs = listBriefs().filter(
  (b) => !briefFilter || briefFilter.some((f) => b.id.startsWith(f)),
);
const images = new Map(); // anonId -> {app, brief, run, file}
const anon = (file) =>
  "i" +
  createHash("sha256")
    .update(String(seed) + file)
    .digest("hex")
    .slice(0, 10);

const pairs = [];
for (const brief of briefs) {
  const byApp = {};
  for (const app of appsWanted) {
    const dir = join(resultsDir, app, brief.id);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    const runs = readdirSync(dir)
      .filter((f) => /\.png$/i.test(f) && !/\.(first|draft)\.png$/i.test(f))
      .sort();
    if (runs.length) byApp[app] = runs.map((f) => join(dir, f));
  }
  const apps = Object.keys(byApp);
  const briefPairs = [];
  for (let i = 0; i < apps.length; i++)
    for (let j = i + 1; j < apps.length; j++) {
      for (const fa of byApp[apps[i]])
        for (const fb of byApp[apps[j]]) {
          const ia = anon(fa),
            ib = anon(fb);
          images.set(ia, {
            app: apps[i],
            brief: brief.id,
            run: basename(fa, ".png"),
            file: relative(EVAL_DIR, fa),
          });
          images.set(ib, {
            app: apps[j],
            brief: brief.id,
            run: basename(fb, ".png"),
            file: relative(EVAL_DIR, fb),
          });
          briefPairs.push(rand() < 0.5 ? [ia, ib] : [ib, ia]);
        }
    }
  for (const [left, right] of shuffle(briefPairs).slice(0, maxPerBrief))
    pairs.push({ brief: brief.id, left, right });
}
if (!pairs.length) {
  console.error(
    `No pairs: need PNGs for >= 2 apps under eval/results/<app>/<brief>/ (apps: ${appsWanted.join(", ")})`,
  );
  process.exit(1);
}

shuffle(pairs);
const repeats = shuffle(pairs.slice())
  .slice(0, Math.round(pairs.length * repeatSwapped))
  .map((p) => ({ ...p, left: p.right, right: p.left, repeatOf: true }));
for (const r of repeats)
  pairs.splice(Math.floor(pairs.length / 2 + rand() * (pairs.length / 2)), 0, r);
pairs.forEach((p, i) => {
  p.id = `p${String(i + 1).padStart(3, "0")}`;
});
for (const r of pairs.filter((p) => p.repeatOf))
  r.repeatOf = pairs.find((p) => !p.repeatOf && p.left === r.right && p.right === r.left)?.id;

// Embed images once each; downscale/encode with sharp if available to keep the page manageable.
let sharp = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  /* embed PNG as-is */
}
const used = [...new Set(pairs.flatMap((p) => [p.left, p.right]))];
const data = {};
for (const id of used) {
  const file = resolve(EVAL_DIR, images.get(id).file);
  if (sharp) {
    const buf = await sharp(file)
      .resize({ width: 2000, withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();
    data[id] = `data:image/webp;base64,${buf.toString("base64")}`;
  } else data[id] = `data:image/png;base64,${readFileSync(file).toString("base64")}`;
}
const briefInfo = Object.fromEntries(
  briefs
    .filter((b) => pairs.some((p) => p.brief === b.id))
    .map((b) => [b.id, { title: b.title, prompt: b.prompt, track: b.track }]),
);
const session = createHash("sha256")
  .update(`${seed}:${pairs.map((p) => p.id + p.left + p.right).join()}`)
  .digest("hex")
  .slice(0, 12);
const page = {
  session,
  seed,
  created: new Date().toISOString(),
  pairs: pairs.map(({ id, brief, left, right }) => ({ id, brief, left, right })),
  briefs: briefInfo,
};

const template = readFileSync(join(EVAL_DIR, "pairwise/review.template.html"), "utf8");
const html = template
  .replace("/*__PAGE__*/null", JSON.stringify(page))
  .replace("/*__IMAGES__*/null", JSON.stringify(data));
writeFileSync(join(outDir, "review.html"), html);
writeFileSync(
  join(outDir, "key.json"),
  JSON.stringify(
    {
      session,
      seed,
      created: page.created,
      images: Object.fromEntries(used.map((id) => [id, images.get(id)])),
      pairs,
    },
    null,
    2,
  ) + "\n",
);
const perApp = {};
for (const id of used) perApp[images.get(id).app] = (perApp[images.get(id).app] || 0) + 1;
console.log(
  `session ${session}: ${pairs.length} pairs (${repeats.length} swapped repeats) over ${Object.keys(briefInfo).length} briefs; images per app ${JSON.stringify(perApp)}`,
);
console.log(
  `wrote ${join(outDir, "review.html")} (${(html.length / 1e6).toFixed(1)} MB) and ${join(outDir, "key.json")} (keep the key away from reviewers)`,
);
