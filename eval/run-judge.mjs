#!/usr/bin/env node
// Tier 2: checklist judge. Sends one screenshot + the frozen brief checklist + rubric to an
// installed CLI and stores validated JSON at eval/results/<app>/<brief>/<run>.json (keyed by judge).
//
//   node eval/run-judge.mjs --brief <id> --image <png> [--app verynize|wonder|pen|figma|figcraft]
//        [--judge claude|codex] [--model <m>] [--run <name>] [--retries 1] [--dry-run]
//
// The judge never sees the app name. Tall full-page captures are sent as an overview plus slices so
// clipping is not hidden by downscaling.
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { EVAL_DIR, REPO_DIR, APPS, loadBrief, loadRubric, weightedScore } from "./lib/briefs.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(name);
if (flag("--help") || !opt("--brief") || !opt("--image")) {
  console.log(
    "usage: node eval/run-judge.mjs --brief <id> --image <png> [--app verynize] [--judge claude|codex] [--model m] [--run name] [--retries 1] [--results-dir dir] [--dry-run]",
  );
  process.exit(flag("--help") ? 0 : 2);
}
const brief = loadBrief(opt("--brief"));
const imagePath = resolve(opt("--image"));
const app = opt("--app", inferApp(imagePath));
const judge = opt("--judge", "claude");
const model = opt("--model");
const run = opt("--run", basename(imagePath, extname(imagePath)));
const retries = Number(opt("--retries", 1));
const resultsDir = resolve(opt("--results-dir", join(EVAL_DIR, "results")));
if (!existsSync(imagePath)) throw new Error(`image not found: ${imagePath}`);
if (!APPS.includes(app)) throw new Error(`--app must be one of ${APPS.join(", ")} (got ${app})`);
if (!["claude", "codex"].includes(judge)) throw new Error("--judge must be claude or codex");

function inferApp(path) {
  const m = path.match(/results\/([^/]+)\/[^/]+\/[^/]+$/);
  return m ? m[1] : "verynize";
}

// ---------------------------------------------------------------------------------------------
// Images: candidate (+ slices when tall) and, for reconstruction/refinement, the brief's input image.
async function prepareImages() {
  const tmp = mkdtempSync(join(tmpdir(), "bd-judge-"));
  const list = [];
  let sharp = null;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    /* no slicing */
  }
  const meta = sharp ? await sharp(imagePath).metadata() : null;
  const tall = meta && meta.height > meta.width * 1.4;
  if (tall) {
    const overview = join(tmp, "overview.png");
    await sharp(imagePath).resize({ height: 1568, fit: "inside" }).png().toFile(overview);
    list.push({
      path: overview,
      caption: `Candidate, full page overview (downscaled from ${meta.width}x${meta.height})`,
    });
    const sliceH = Math.round(meta.width * 0.8),
      step = sliceH - 64;
    const count = Math.min(6, Math.ceil((meta.height - 64) / step));
    for (let i = 0; i < count; i++) {
      const top = Math.min(i * step, Math.max(0, meta.height - sliceH));
      const file = join(tmp, `slice-${i + 1}.png`);
      await sharp(imagePath)
        .extract({ left: 0, top, width: meta.width, height: Math.min(sliceH, meta.height - top) })
        .png()
        .toFile(file);
      list.push({
        path: file,
        caption: `Candidate, slice ${i + 1}/${count} at full resolution (y ${top}-${top + Math.min(sliceH, meta.height - top)})`,
      });
    }
  } else
    list.push({
      path: imagePath,
      caption: `Candidate screenshot${meta ? ` (${meta.width}x${meta.height})` : ""}`,
    });
  const extra = (brief.inputs || []).find(
    (i) => /attach/i.test(i.role) && /\.(png|jpe?g)$/i.test(i.path),
  );
  if (extra)
    list.push({
      path: join(REPO_DIR, extra.path),
      caption:
        brief.track === "refinement"
          ? "STARTING screen the candidate had to refine (not the candidate)"
          : "REFERENCE the candidate had to reconstruct (not the candidate)",
    });
  return { list, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

function buildPrompt(images) {
  const rubric = loadRubric();
  const t = readFileSync(join(EVAL_DIR, "judge/prompt.md"), "utf8");
  const vp = brief.viewport;
  const bullet = (a) => a.map((x) => `- ${x}`).join("\n");
  return t
    .replace(
      "{{IMAGES}}",
      "Attached images, in order:\n" + images.map((im, i) => `${i + 1}. ${im.caption}`).join("\n"),
    )
    .replace("{{BRIEF_ID}}", brief.id)
    .replace(
      "{{VIEWPORT}}",
      `${vp.width}x${vp.height}${vp.capture === "fullPage" ? " full page" : ""}`,
    )
    .replace("{{PROMPT}}", brief.prompt)
    .replace("{{REQUIRED}}", bullet(brief.requiredContent))
    .replace("{{CONSTRAINTS}}", bullet(brief.constraints))
    .replace(
      "{{CHECKLIST}}",
      brief.checklist
        .map((c) => `- ${c.id}${c.critical ? " [critical]" : ""}: ${c.text}`)
        .join("\n"),
    )
    .replace(
      "{{DIMENSIONS}}",
      Object.entries(rubric.dimensions)
        .map(([k, v]) => `- ${k} (weight ${rubric.weights[k]}): ${v}`)
        .join("\n"),
    )
    .replace(
      "{{ANCHORS}}",
      Object.entries(rubric.anchors)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n"),
    )
    .replace("{{CRITICAL}}", bullet(rubric.criticalDefects));
}

// ---------------------------------------------------------------------------------------------
function exec(cmd, argv, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, argv, { stdio: ["pipe", "pipe", "pipe"], cwd: tmpdir() });
    let out = "",
      err = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolvePromise(out)
        : reject(new Error(`${cmd} exited ${code}: ${err.slice(-2000) || out.slice(-2000)}`)),
    );
    child.stdin.end(input ?? "");
  });
}

async function callClaude(prompt, images) {
  const schema = readFileSync(join(EVAL_DIR, "judge/schema.json"), "utf8");
  const content = [
    ...images.map((im) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: /\.jpe?g$/i.test(im.path) ? "image/jpeg" : "image/png",
        data: readFileSync(im.path).toString("base64"),
      },
    })),
    { type: "text", text: prompt },
  ];
  const line = JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
  const argv = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--tools",
    "",
    "--no-session-persistence",
    "--json-schema",
    JSON.stringify(JSON.parse(schema)),
  ];
  if (model) argv.push("--model", model);
  const out = await exec("claude", argv, line);
  const events = out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const result = events.findLast((e) => e.type === "result");
  if (!result) throw new Error("claude produced no result event");
  if (result.is_error) throw new Error(`claude error: ${result.result || result.subtype}`);
  const usedModel = events.find((e) => e.type === "system" && e.model)?.model;
  return {
    raw: result.structured_output ?? result.result,
    meta: {
      cli: "claude",
      model: usedModel || model || null,
      costUsd: result.total_cost_usd ?? null,
      durationMs: result.duration_ms ?? null,
    },
  };
}

async function callCodex(prompt, images) {
  const tmp = mkdtempSync(join(tmpdir(), "bd-codex-"));
  try {
    const outFile = join(tmp, "last.txt");
    const argv = [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--color",
      "never",
      "--output-schema",
      join(EVAL_DIR, "judge/schema.json"),
      "-o",
      outFile,
    ];
    for (const im of images) argv.push(`--image=${im.path}`);
    if (model) argv.push("-m", model);
    argv.push("-");
    await exec("codex", argv, prompt);
    return { raw: readFileSync(outFile, "utf8"), meta: { cli: "codex", model: model || null } };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
function parseJson(raw) {
  if (raw && typeof raw === "object") return raw;
  const text = String(raw || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  const start = text.indexOf("{"),
    end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error("judge output is not JSON");
}
function validateJudgement(j, b = brief) {
  const errors = [];
  const ids = b.checklist.map((c) => c.id);
  if (!Array.isArray(j?.items)) errors.push("items must be an array");
  else {
    const seen = j.items.map((i) => i?.id);
    for (const id of ids)
      if (seen.filter((s) => s === id).length !== 1)
        errors.push(`checklist id ${id} must appear exactly once`);
    for (const i of j.items) {
      if (!ids.includes(i?.id)) errors.push(`unknown item id ${i?.id}`);
      if (typeof i?.pass !== "boolean") errors.push(`${i?.id}.pass must be boolean`);
      if (typeof i?.evidence !== "string" || !i.evidence.trim())
        errors.push(`${i?.id}.evidence must be a non-empty string`);
    }
  }
  for (const k of Object.keys(loadRubric().weights)) {
    const v = j?.scores?.[k];
    if (!Number.isInteger(v) || v < 1 || v > 10) errors.push(`scores.${k} must be an integer 1-10`);
  }
  if (!Array.isArray(j?.criticalDefects) || j.criticalDefects.some((d) => typeof d !== "string"))
    errors.push("criticalDefects must be an array of strings");
  return errors;
}

async function main() {
  const { list, cleanup } = await prepareImages();
  try {
    let prompt = buildPrompt(list);
    if (flag("--dry-run")) {
      console.log(prompt);
      console.log(
        "\nimages:",
        list.map((i) => i.path),
      );
      return;
    }
    let judgement, meta, lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res =
          judge === "claude" ? await callClaude(prompt, list) : await callCodex(prompt, list);
        meta = res.meta;
        judgement = parseJson(res.raw);
        const errors = validateJudgement(judgement);
        if (!errors.length) break;
        lastError = new Error(`invalid judgement: ${errors.join("; ")}`);
        judgement = null;
        prompt += `\n\nYour previous answer was rejected: ${errors.slice(0, 8).join("; ")}. Return corrected JSON only.`;
      } catch (error) {
        lastError = error;
        judgement = null;
      }
    }
    if (!judgement) throw lastError;
    const critical = brief.checklist.filter((c) => c.critical);
    const failedCritical = judgement.items
      .filter((i) => !i.pass && critical.some((c) => c.id === i.id))
      .map((i) => i.id);
    const record = {
      ...judgement,
      derived: {
        weightedScore: weightedScore(judgement.scores),
        checklistPassRate:
          Math.round(
            (judgement.items.filter((i) => i.pass).length / judgement.items.length) * 1000,
          ) / 1000,
        failedCriticalItems: failedCritical,
        criticalDefectCount: judgement.criticalDefects.length + failedCritical.length,
      },
      meta: {
        ...meta,
        judge,
        judgedAt: new Date().toISOString(),
        briefVersion: brief.version,
        image: imagePath.startsWith(REPO_DIR) ? imagePath.slice(REPO_DIR.length + 1) : imagePath,
        imagesSent: list.length,
      },
    };
    const dir = join(resultsDir, app, brief.id);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${run}.json`);
    const existing = existsSync(file)
      ? JSON.parse(readFileSync(file, "utf8"))
      : { app, brief: brief.id, run, judgements: {} };
    existing.judgements[judge] = record;
    writeFileSync(file, JSON.stringify(existing, null, 2) + "\n");
    console.log(
      `${app}/${brief.id}/${run} [${judge}] weighted ${record.derived.weightedScore}/100, checklist ${(record.derived.checklistPassRate * 100).toFixed(0)}%, critical ${record.derived.criticalDefectCount} -> ${file}`,
    );
  } finally {
    cleanup();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
