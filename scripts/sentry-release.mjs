// Tells Sentry that the web/server release was deployed (run by `npm run deploy` after `cf deploy`).
//   node scripts/env.mjs node scripts/sentry-release.mjs [--dry-run]
// - Attaches the release's commits through the Sentry GitHub integration (`--auto`), falling back to local git
//   (`--local`) when the org has no integration. Commits are what let Sentry resolve an issue from a `Fixes VERYNIZE-…`
//   line in a commit message (merge commits carry the PR description).
// - Records a deploy for SENTRY_ENVIRONMENT (default production) with the Worker's domain.
// Release and org come from web-start/build/telemetry.mjs, the same values the build uploaded source maps under.
// Without SENTRY_AUTH_TOKEN it does nothing. A Sentry failure only warns: the Worker is already deployed.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../cloudflare.config.ts";
import { SENTRY_ORG, deployRelease } from "../web-start/build/telemetry.mjs";

const dryRun = process.argv.includes("--dry-run");
if (!process.env.SENTRY_AUTH_TOKEN) {
  console.log("sentry-release: SENTRY_AUTH_TOKEN is not set, skipping");
  process.exit(0);
}
const release = deployRelease();
if (!release) {
  console.warn(
    "sentry-release: no release (not a git checkout and SENTRY_RELEASE unset), skipping",
  );
  process.exit(0);
}
const environment = process.env.SENTRY_ENVIRONMENT || "production";
const domain = config.worker?.domains?.[0];
const target = `${SENTRY_ORG}/${release}`;

const require = createRequire(import.meta.url);
// The Sentry CLI ships with @sentry/vite-plugin (package `sentry`, bin dist/bin.cjs next to its main entry).
const cli = join(dirname(require.resolve("sentry")), "bin.cjs");
const sentry = (...args) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8",
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
};
const lastLine = (text) => text.split("\n").filter(Boolean).at(-1) ?? "";

if (dryRun) {
  console.log(`sentry-release: would set commits and record a ${environment} deploy for ${target}`);
  process.exit(0);
}

let commits = sentry("release", "set-commits", target, "--auto");
if (!commits.ok) commits = sentry("release", "set-commits", target, "--local");
console[commits.ok ? "log" : "warn"](
  commits.ok
    ? `sentry-release: commits attached to ${release.slice(0, 12)}`
    : `sentry-release: could not attach commits: ${lastLine(commits.output)}`,
);

const deploy = sentry(
  "release",
  "deploy",
  target,
  environment,
  ...(domain ? ["--url", `https://${domain}`] : []),
);
console[deploy.ok ? "log" : "warn"](
  deploy.ok
    ? `sentry-release: recorded ${environment} deploy of ${release.slice(0, 12)}`
    : `sentry-release: could not record the deploy: ${lastLine(deploy.output)}`,
);
