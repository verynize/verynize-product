// Runs a command with the repo-root .env loaded (git-ignored; see .env.example and docs/telemetry.md). Local
// deploys and packaging read their Sentry settings from process.env, in this process and every build it spawns.
//   node scripts/env.mjs <command> [args…]    e.g. `node scripts/env.mjs vp build` (npm scripts: build, deploy,
//                                              deploy:check, package:mac)
// Variables already exported win over .env. No .env: the command runs with the environment unchanged.
// VERYNIZE_ENV_FILE names another file (tests/env-build.mjs). Only variable names are ever printed, never values.
// It also sets VERYNIZE_RELEASE_BUILD=1: only these builds bake Sentry DSNs and upload source maps
// (web-start/build/telemetry.mjs), whatever a plain `vp build` finds in .env.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = process.env.VERYNIZE_ENV_FILE || path.join(root, ".env");
const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/env.mjs <command> [args…]");
  process.exit(2);
}

let loaded = {};
if (fs.existsSync(file)) {
  try {
    loaded = parseEnv(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`Could not read ${path.relative(root, file) || file}: ${error.message}`);
    process.exit(1);
  }
  const used = Object.keys(loaded).filter((name) => !(name in process.env));
  if (used.length)
    console.error(
      `env: ${path.basename(file)} sets ${used.sort().join(", ")} (exported values win)`,
    );
}

const run = spawnSync(command, args, {
  stdio: "inherit",
  env: { ...loaded, ...process.env, VERYNIZE_RELEASE_BUILD: "1" },
});
if (run.error) {
  console.error(`env: could not run ${command}: ${run.error.message}`);
  process.exit(1);
}
process.exit(run.status ?? 1);
