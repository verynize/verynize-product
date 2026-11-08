import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EVAL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_DIR = join(EVAL_DIR, "..");
export const APPS = ["verynize", "wonder", "pen", "figma", "figcraft"];
export const PRIMARY_APPS = ["verynize", "wonder", "pen"];

export function listBriefs() {
  return readdirSync(join(EVAL_DIR, "briefs"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(EVAL_DIR, "briefs", f), "utf8")));
}
export function loadBrief(id) {
  const brief = listBriefs().find(
    (b) => b.id === id || b.id.startsWith(id + "-") || b.id.replace(/^\d+-/, "") === id,
  );
  if (!brief)
    throw new Error(
      `Unknown brief "${id}". Known: ${listBriefs()
        .map((b) => b.id)
        .join(", ")}`,
    );
  return brief;
}
export const loadRubric = () =>
  JSON.parse(readFileSync(join(EVAL_DIR, "judge/rubric.json"), "utf8"));

/** Weighted 0-100 total from 1-10 dimension scores. */
export function weightedScore(scores, weights = loadRubric().weights) {
  let total = 0;
  for (const [k, w] of Object.entries(weights)) total += ((Number(scores?.[k]) || 0) / 10) * w;
  return Math.round(total * 10) / 10;
}
