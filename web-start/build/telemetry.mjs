// Build-time crash-report settings (Sentry) for the web app and its servers, shared by vite.config.ts,
// vite.node.config.ts and vite.nitro.config.ts through sharedPlugins() (start-config.mjs).
//
// - Defines read by web-start/src/telemetry.ts (browser client) and web-start/src/server-telemetry.ts (Worker):
//     __VERYNIZE_SENTRY_WEB__     {dsn, release, environment, sampleRate, tracesSampleRate}   (client bundle)
//     __VERYNIZE_SENTRY_SERVER__  {dsn, release, environment, sampleRate, tracesSampleRate}   (server bundle)
//   from SENTRY_DSN_WEB / SENTRY_DSN_SERVER, SENTRY_ENVIRONMENT, SENTRY_SAMPLE_RATE, SENTRY_TRACES_SAMPLE_RATE.
//   No DSN → the SDK never starts. The Worker also reads SENTRY_DSN_SERVER / SENTRY_ENVIRONMENT / SENTRY_RELEASE
//   from its runtime env first, so a secret set with Cloudflare works without rebuilding.
// - Release: SENTRY_RELEASE, else the deploy commit (GITHUB_SHA, WORKERS_CI_COMMIT_SHA, VERCEL_GIT_COMMIT_SHA,
//   CF_PAGES_COMMIT_SHA), else `git rev-parse HEAD`.
// - Source maps: only when SENTRY_AUTH_TOKEN is set. The build then emits hidden maps, uploads them to the
//   verynize-web and verynize-server projects (debug ids) and deletes every .map file, so none is ever deployed.
//   Without the token nothing is generated or uploaded.
// - Both only in a release build: VERYNIZE_RELEASE_BUILD=1, which scripts/env.mjs sets (npm run build, deploy,
//   deploy:check, package:mac). TanStack Start's load-env plugin copies every repo-root .env variable into
//   process.env during any `vp build` (tests, the cloud harness), so a DSN or token found there alone proves
//   nothing; the flag must therefore never be in .env, and a build refuses to start when it is.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { parseEnv } from "node:util";
import { sentryVitePlugin } from "@sentry/vite-plugin";

export const SENTRY_ORG = process.env.SENTRY_ORG || "adamabdrrahman";
const RELEASE_FLAG = "VERYNIZE_RELEASE_BUILD";

/** True only in a build started for a release (scripts/env.mjs), never from a value found in .env. */
export function releaseBuild(env = process.env, envFile = new URL("../../.env", import.meta.url)) {
  if (env[RELEASE_FLAG] !== "1") return false;
  let names = [];
  try {
    names = Object.keys(parseEnv(fs.readFileSync(envFile, "utf8")));
  } catch {}
  if (names.includes(RELEASE_FLAG))
    throw Error(
      `${RELEASE_FLAG} must not be set in .env: only scripts/env.mjs sets it (docs/telemetry.md).`,
    );
  return true;
}

/** The commit being deployed (full SHA), or "" outside a git checkout. */
export function deployRelease(env = process.env) {
  const named =
    env.SENTRY_RELEASE ||
    env.GITHUB_SHA ||
    env.WORKERS_CI_COMMIT_SHA ||
    env.VERCEL_GIT_COMMIT_SHA ||
    env.CF_PAGES_COMMIT_SHA;
  if (named) return named;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const rate = (value) => (value === undefined || value === "" ? undefined : Number(value));

function settings(dsn, env, environment) {
  return {
    dsn: (releaseBuild(env) && dsn) || "",
    release: deployRelease(env),
    environment,
    sampleRate: rate(env.SENTRY_SAMPLE_RATE),
    tracesSampleRate: rate(env.SENTRY_TRACES_SAMPLE_RATE),
  };
}

/** Upload plugin (last in the list) in a release build with SENTRY_AUTH_TOKEN; [] otherwise. */
export function sourceMapUpload({ projects, release, deleteGlobs }) {
  const authToken = releaseBuild() && process.env.SENTRY_AUTH_TOKEN;
  if (!authToken) return [];
  return [
    sentryVitePlugin({
      org: SENTRY_ORG,
      project: projects,
      authToken,
      url: process.env.SENTRY_URL || undefined,
      // Commits and the deploy record are set after a real deploy by scripts/sentry-release.mjs, not by every build.
      release: { name: release, inject: false, setCommits: false },
      sourcemaps: { filesToDeleteAfterUpload: deleteGlobs },
      telemetry: false,
      silent: true,
    }),
  ];
}

/** Defines plus, in a release build with SENTRY_AUTH_TOKEN, hidden source maps and their upload. */
export function webTelemetry(env = process.env) {
  const upload = releaseBuild(env) && !!env.SENTRY_AUTH_TOKEN;
  return [
    {
      name: "verynize:telemetry",
      // Web: SENTRY_ENVIRONMENT or the Vite mode. Server: SENTRY_ENVIRONMENT, else the runtime target decides.
      config: (_config, { mode }) => ({
        define: {
          __VERYNIZE_SENTRY_WEB__: JSON.stringify(
            settings(env.SENTRY_DSN_WEB, env, env.SENTRY_ENVIRONMENT || mode),
          ),
          __VERYNIZE_SENTRY_SERVER__: JSON.stringify(
            settings(env.SENTRY_DSN_SERVER, env, env.SENTRY_ENVIRONMENT || ""),
          ),
        },
        ...(upload ? { build: { sourcemap: "hidden" } } : {}),
      }),
    },
    ...sourceMapUpload({
      projects: ["verynize-web", "verynize-server"],
      release: deployRelease(env),
      deleteGlobs: [
        ".cloudflare/output/**/*.map",
        "dist/web-node/**/*.map",
        "dist/web-nitro/**/*.map",
        ".vercel/output/**/*.map",
      ],
    }),
  ];
}
