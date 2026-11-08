// Bradley-Terry with ties counted as half a win each side (Arena-style), fitted by the
// Hunter (2004) MM algorithm, reported on an Elo-like scale (400*log10, mean 1000).

export function fitBradleyTerry(comparisons, players, { iterations = 500, prior = 0.5 } = {}) {
  // comparisons: [{a, b, score}] where score is 1 (a wins), 0 (b wins), 0.5 (tie).
  const idx = new Map(players.map((p, i) => [p, i]));
  const n = players.length;
  const wins = Array.from({ length: n }, () => 0),
    games = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (const { a, b, score } of comparisons) {
    const i = idx.get(a),
      j = idx.get(b);
    wins[i] += score;
    wins[j] += 1 - score;
    games[i][j]++;
    games[j][i]++;
  }
  // Weak prior: each pair plays one virtual tie, keeping estimates finite with sparse/unanimous data.
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      if (i !== j) {
        games[i][j] += prior;
      }
  for (let i = 0; i < n; i++) wins[i] += (prior * (n - 1)) / 2;
  let p = Array.from({ length: n }, () => 1);
  for (let it = 0; it < iterations; it++) {
    const next = p.map((pi, i) => {
      let denom = 0;
      for (let j = 0; j < n; j++) if (j !== i && games[i][j]) denom += games[i][j] / (pi + p[j]);
      return denom ? wins[i] / denom : pi;
    });
    const g = Math.exp(next.reduce((s, v) => s + Math.log(v), 0) / n);
    const normalized = next.map((v) => v / g);
    const delta = Math.max(...normalized.map((v, i) => Math.abs(v - p[i])));
    p = normalized;
    if (delta < 1e-9) break;
  }
  return Object.fromEntries(players.map((pl, i) => [pl, 1000 + 400 * Math.log10(p[i])]));
}

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const quantile = (sorted, q) => {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q,
    lo = Math.floor(pos),
    hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
export const median = (values) =>
  quantile(
    [...values].sort((a, b) => a - b),
    0.5,
  );

/** Resample comparisons (clustered by `cluster` key if given) and refit. */
export function bootstrap(comparisons, players, { samples = 1000, seed = 7, cluster = null } = {}) {
  const rand = mulberry32(seed);
  const groups = cluster
    ? Object.values(comparisons.reduce((m, c) => ((m[cluster(c)] ||= []).push(c), m), {}))
    : comparisons.map((c) => [c]);
  const draws = [];
  for (let s = 0; s < samples; s++) {
    const sample = [];
    for (let k = 0; k < groups.length; k++)
      sample.push(...groups[Math.floor(rand() * groups.length)]);
    draws.push(fitBradleyTerry(sample, players, { iterations: 200 }));
  }
  return draws;
}
