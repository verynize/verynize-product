#!/usr/bin/env node
// Complete just the PR ancestry needed after a shallow, sparse CI checkout. Full-suite
// events need no history. Credentials exist only in the fetch subprocess environment.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function prepareCIHistory({
  cwd = process.cwd(),
  env = process.env,
  baseOnly = false,
  deepenSteps = [32, 128, 512, 2048],
  log = console.log,
} = {}) {
  if (env.GITHUB_EVENT_NAME !== "pull_request") {
    log("Full-suite event: shallow checkout needs no additional history.");
    return { fetched: false };
  }
  const pr = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, "utf8")).pull_request;
  const base = pr?.base?.sha;
  const head = pr?.head?.sha;
  if (![base, head].every((sha) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha || "")))
    throw new Error("PR base/head must be commit SHAs");

  const fetchEnv = { ...env, GIT_TERMINAL_PROMPT: "0" };
  if (env.GH_TOKEN) {
    const server = new URL(env.GITHUB_SERVER_URL || "https://github.com");
    const count = Number(fetchEnv.GIT_CONFIG_COUNT || 0);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid GIT_CONFIG_COUNT");
    fetchEnv.GIT_CONFIG_COUNT = String(count + 1);
    fetchEnv[`GIT_CONFIG_KEY_${count}`] = `http.${server.origin}/.extraheader`;
    fetchEnv[`GIT_CONFIG_VALUE_${count}`] =
      `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${env.GH_TOKEN}`).toString("base64")}`;
  }
  const git = (args, required = true) => {
    const result = spawnSync("git", args, { cwd, env: fetchEnv, encoding: "utf8" });
    if (required && result.status !== 0)
      throw new Error(`git ${args[0]} failed (exit ${result.status ?? "unknown"})`);
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const refs = [`+${base}:refs/ci/base`];
  if (!baseOnly) refs.push(`+${head}:refs/ci/head`);
  const fetch = (...depth) =>
    git(["fetch", "--no-tags", "--filter=blob:none", ...depth, "origin", ...refs]);

  fetch("--depth=1");
  if (baseOnly) {
    // Rename detection can lazily request old blobs in a partial clone. Populate
    // the exact later diff while the temporary fetch credentials are available.
    git(["diff", "--name-only", "--diff-filter=A", base, "HEAD"]);
    log("Fetched the PR base commit for the quality diff.");
    return { fetched: true, base };
  }
  let mergeBase = git(["merge-base", base, head], false);
  for (const depth of deepenSteps) {
    if (mergeBase) break;
    if (git(["rev-parse", "--is-shallow-repository"]) === "false") break;
    log(`Deepening PR ancestry by ${depth} commits (without history blobs).`);
    fetch(`--deepen=${depth}`);
    mergeBase = git(["merge-base", base, head], false);
  }
  if (!mergeBase && git(["rev-parse", "--is-shallow-repository"]) === "true") {
    log("PR ancestry exceeds the bounded fetch: completing filtered history.");
    fetch("--unshallow");
    mergeBase = git(["merge-base", base, head], false);
  }
  if (!mergeBase) throw new Error("PR base/head have no common ancestor");
  git(["diff", "--name-status", "-M", mergeBase, head]);
  log(`PR merge base available: ${mergeBase.slice(0, 12)}.`);
  return { fetched: true, base, head, mergeBase };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    prepareCIHistory({ baseOnly: process.argv.includes("--base-only") });
  } catch (error) {
    console.error(`ci-fetch-history: ${error.message}`);
    process.exitCode = 1;
  }
}
