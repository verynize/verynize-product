// Sentry DSNs and source-map upload belong to release builds only (VERYNIZE_RELEASE_BUILD=1, set by scripts/env.mjs).
// TanStack Start copies repo-root .env into process.env during any `vp build`, so a DSN or token there must not be
// enough, and the flag itself is refused when it comes from .env.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { releaseBuild, sourceMapUpload, webTelemetry } from "../web-start/build/telemetry.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verynize-release-build-"));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const DSN = "https://0123456789abcdef0123456789abcdef@release.invalid/1";
const noEnvFile = path.join(dir, "missing.env");

const defines = (env) => {
  const [plugin] = webTelemetry(env);
  const config = plugin.config({}, { mode: "production" });
  return {
    web: JSON.parse(config.define.__VERYNIZE_SENTRY_WEB__),
    server: JSON.parse(config.define.__VERYNIZE_SENTRY_SERVER__),
    sourcemap: config.build?.sourcemap,
    plugins: webTelemetry(env).length,
  };
};

test("a DSN or token without the release flag bakes and uploads nothing", () => {
  const out = defines({ SENTRY_DSN_WEB: DSN, SENTRY_DSN_SERVER: DSN, SENTRY_AUTH_TOKEN: "x" });
  assert.equal(out.web.dsn, "");
  assert.equal(out.server.dsn, "");
  assert.equal(out.sourcemap, undefined);
  assert.equal(releaseBuild({ VERYNIZE_RELEASE_BUILD: "true" }, noEnvFile), false);
});

test("the release flag bakes the DSNs", () => {
  const out = defines({ SENTRY_DSN_WEB: DSN, SENTRY_DSN_SERVER: DSN, VERYNIZE_RELEASE_BUILD: "1" });
  assert.equal(out.web.dsn, DSN);
  assert.equal(out.server.dsn, DSN);
  assert.equal(out.sourcemap, undefined, "no token: no maps");
  assert.equal(releaseBuild({ VERYNIZE_RELEASE_BUILD: "1" }, noEnvFile), true);
});

test("source-map upload needs the flag in process.env", () => {
  const saved = { ...process.env };
  try {
    process.env.SENTRY_AUTH_TOKEN = "sntrys_test_never_used";
    delete process.env.VERYNIZE_RELEASE_BUILD;
    const options = { projects: ["verynize-web"], release: "x", deleteGlobs: [] };
    assert.deepEqual(sourceMapUpload(options), []);
  } finally {
    process.env = saved;
  }
});

test("the flag is refused when .env sets it", () => {
  const envFile = path.join(dir, ".env");
  fs.writeFileSync(envFile, "SENTRY_DSN_WEB=x\nVERYNIZE_RELEASE_BUILD=1\n");
  assert.throws(
    () => releaseBuild({ VERYNIZE_RELEASE_BUILD: "1" }, envFile),
    /must not be set in \.env/,
  );
  assert.equal(releaseBuild({}, envFile), false);
});

test("scripts/env.mjs starts its command as a release build", () => {
  const env = { ...process.env, VERYNIZE_ENV_FILE: noEnvFile };
  delete env.VERYNIZE_RELEASE_BUILD;
  const run = spawnSync(
    process.execPath,
    [
      "scripts/env.mjs",
      process.execPath,
      "-e",
      "process.stdout.write(process.env.VERYNIZE_RELEASE_BUILD)",
    ],
    { cwd: root, env, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "1");
});
