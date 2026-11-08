#!/usr/bin/env node
// Tier 3b: score blind pairwise votes.
//
//   node eval/score-pairs.mjs [votes.json ...] [--key eval/pairwise/key.json] [--focus verynize]
//        [--samples 2000] [--margin 50] [--json out.json]
//
// Default vote files: eval/pairwise/votes/*.json (exports from review.html). Reports win/tie/loss
// per competitor (overall and per brief), Bradley-Terry ratings with 95% bootstrap CIs (resampling
// whole pairs, so reviewers who saw the same pair stay together), reviewer consistency on swapped
// repeats, and the non-inferiority gate for --focus vs every other app.
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EVAL_DIR } from "./lib/briefs.mjs";
import { fitBradleyTerry, bootstrap, quantile } from "./lib/stats.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const optionNames = ["--key", "--focus", "--samples", "--margin", "--json", "--seed"];
const files = args.filter((a, i) => !a.startsWith("--") && !optionNames.includes(args[i - 1]));
const keyFile = resolve(opt("--key", join(EVAL_DIR, "pairwise/key.json")));
const focus = opt("--focus", "verynize");
const samples = Number(opt("--samples", 2000));
const margin = Number(opt("--margin", 50));
const votesDir = join(EVAL_DIR, "pairwise/votes");
const voteFiles = files.length
  ? files.map((f) => resolve(f))
  : existsSync(votesDir)
    ? readdirSync(votesDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => join(votesDir, f))
    : [];
if (!existsSync(keyFile)) {
  console.error(`key not found: ${keyFile} (run eval/make-pairs.mjs first)`);
  process.exit(2);
}
if (!voteFiles.length) {
  console.error("no vote files (pass paths or put exports in eval/pairwise/votes/)");
  process.exit(2);
}

const key = JSON.parse(readFileSync(keyFile, "utf8"));
const pairById = Object.fromEntries(key.pairs.map((p) => [p.id, p]));
const comparisons = [],
  consistency = { agree: 0, disagree: 0 };
const reviewers = new Set();
for (const file of voteFiles) {
  const v = JSON.parse(readFileSync(file, "utf8"));
  if (v.session !== key.session) {
    console.warn(`! ${file}: session ${v.session} does not match key ${key.session}; skipped`);
    continue;
  }
  reviewers.add(v.reviewer);
  const byPair = Object.fromEntries(v.votes.map((x) => [x.pairId, x]));
  for (const vote of v.votes) {
    const pair = pairById[vote.pairId];
    if (!pair) continue;
    const L = key.images[pair.left],
      R = key.images[pair.right];
    if (pair.repeatOf) {
      const orig = byPair[pair.repeatOf];
      if (orig) {
        const flip = { A: "B", B: "A", tie: "tie" }[vote.choice];
        flip === orig.choice ? consistency.agree++ : consistency.disagree++;
      }
      continue; // repeats measure consistency only; not double-counted
    }
    const score = vote.choice === "A" ? 1 : vote.choice === "B" ? 0 : 0.5;
    comparisons.push({
      a: L.app,
      b: R.app,
      score,
      brief: pair.brief,
      pair: pair.id,
      reviewer: v.reviewer,
    });
  }
}
if (!comparisons.length) {
  console.error("no usable votes");
  process.exit(2);
}
const players = [...new Set(comparisons.flatMap((c) => [c.a, c.b]))].sort();

// Win/tie/loss from the focus app's perspective, overall and per brief.
function wtl(filter) {
  const out = {};
  for (const c of comparisons.filter(filter)) {
    let me, other, s;
    if (c.a === focus) {
      me = c.a;
      other = c.b;
      s = c.score;
    } else if (c.b === focus) {
      me = c.b;
      other = c.a;
      s = 1 - c.score;
    } else continue;
    void me;
    const r = (out[other] ||= { win: 0, tie: 0, loss: 0 });
    s === 1 ? r.win++ : s === 0 ? r.loss++ : r.tie++;
  }
  return out;
}
const overall = wtl(() => true);
const briefs = [...new Set(comparisons.map((c) => c.brief))].sort();
const perBrief = Object.fromEntries(briefs.map((b) => [b, wtl((c) => c.brief === b)]));

const ratings = fitBradleyTerry(comparisons, players);
const draws = bootstrap(comparisons, players, { samples, seed: 7, cluster: (c) => c.pair });
const ci = Object.fromEntries(
  players.map((p) => {
    const s = draws.map((d) => d[p]).sort((a, b) => a - b);
    return [p, [quantile(s, 0.025), quantile(s, 0.975)]];
  }),
);
const gate = {};
if (players.includes(focus))
  for (const other of players.filter((p) => p !== focus)) {
    const diffs = draws.map((d) => d[focus] - d[other]).sort((a, b) => a - b);
    const lo = quantile(diffs, 0.025),
      hi = quantile(diffs, 0.975);
    const verdict =
      lo > 0 ? "superior" : lo >= -margin ? "non-inferior" : hi < 0 ? "inferior" : "inconclusive";
    gate[other] = {
      diff: ratings[focus] - ratings[other],
      ci: [lo, hi],
      verdict,
      pass: verdict === "superior" || verdict === "non-inferior",
    };
  }

const r1 = (x) => Math.round(x);
console.log(
  `votes: ${comparisons.length} comparisons from ${reviewers.size} reviewer(s); swapped-repeat agreement ${consistency.agree}/${consistency.agree + consistency.disagree}`,
);
console.log(`\n${focus} vs each competitor (win / tie / loss):`);
for (const [o, r] of Object.entries(overall))
  console.log(`  vs ${o.padEnd(14)} ${r.win} / ${r.tie} / ${r.loss}`);
console.log("\nper brief:");
for (const b of briefs)
  console.log(
    `  ${b.padEnd(30)} ${Object.entries(perBrief[b])
      .map(([o, r]) => `vs ${o} ${r.win}/${r.tie}/${r.loss}`)
      .join("   ")}`,
  );
console.log("\nBradley-Terry (Elo scale, 95% bootstrap CI):");
for (const p of [...players].sort((a, b) => ratings[b] - ratings[a]))
  console.log(`  ${p.padEnd(14)} ${r1(ratings[p])}  [${r1(ci[p][0])}, ${r1(ci[p][1])}]`);
if (Object.keys(gate).length) {
  console.log(`\ngate (${focus} - competitor, 95% CI; non-inferiority margin ${margin}):`);
  for (const [o, g] of Object.entries(gate))
    console.log(
      `  vs ${o.padEnd(14)} ${g.diff >= 0 ? "+" : ""}${r1(g.diff)} [${r1(g.ci[0])}, ${r1(g.ci[1])}] ${g.verdict.toUpperCase()}${g.pass ? "" : "  <- gate fails"}`,
    );
}
if (opt("--json"))
  writeFileSync(
    resolve(opt("--json")),
    JSON.stringify(
      {
        focus,
        comparisons: comparisons.length,
        reviewers: [...reviewers],
        consistency,
        overall,
        perBrief,
        ratings,
        ci,
        gate,
        margin,
        samples,
      },
      null,
      2,
    ) + "\n",
  );
process.exitCode = Object.values(gate).every((g) => g.pass) ? 0 : 1;
