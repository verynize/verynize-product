// Local deploys and packaging read the repo-root .env (scripts/env.mjs): `npm run build` (and so deploy and
// deploy:check) bakes a DSN from the file into the web client and Worker defines, exported variables win over the
// file, values are never printed, and package:mac / deploy route through the same loader.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verynize-env-build-"));
const output = path.join(root, ".cloudflare/output/v0/workers/default");
const WEB_DSN = "https://0123456789abcdef0123456789abcdef@env-web.invalid/7";
const SERVER_DSN = "https://fedcba9876543210fedcba9876543210@env-server.invalid/8";
const envFile = path.join(dir, ".env");
fs.writeFileSync(
  envFile,
  [
    "# like .env.example: inline comments after unquoted values",
    `SENTRY_DSN_WEB=${WEB_DSN}   # verynize-web`,
    `SENTRY_DSN_SERVER=${SERVER_DSN}`,
    "SENTRY_ENVIRONMENT=from-file",
    "SENTRY_AUTH_TOKEN=sntrys_from_file_never_used",
    "",
  ].join("\n"),
);
const env = { ...process.env, VERYNIZE_ENV_FILE: envFile };
for (const name of Object.keys(env)) if (name.startsWith("SENTRY_")) delete env[name];
// Exported values win: the environment beats the file, and an empty token keeps source-map upload off.
env.SENTRY_ENVIRONMENT = "exported";
env.SENTRY_AUTH_TOKEN = "";

try {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts;
  assert.match(
    scripts.build,
    /^node scripts\/env\.mjs node scripts\/build-ui\.cjs && node scripts\/env\.mjs vp build$/,
  );
  for (const name of ["deploy", "deploy:check"]) {
    assert.match(
      scripts[name],
      /^npm run build && node scripts\/env\.mjs cf deploy --prebuilt/,
      name,
    );
  }
  assert.equal(scripts["package:mac"], "node scripts/env.mjs node scripts/package-macos.cjs");

  // The loader alone: file values reach the child, exported ones win, a missing file changes nothing.
  const probe = (extra) =>
    spawnSync(
      process.execPath,
      [
        "scripts/env.mjs",
        process.execPath,
        "-e",
        "process.stdout.write(JSON.stringify([process.env.SENTRY_DSN_WEB, process.env.SENTRY_ENVIRONMENT]))",
      ],
      { cwd: root, env: { ...env, ...extra }, encoding: "utf8" },
    );
  const loaded = probe({});
  assert.equal(loaded.status, 0, loaded.stderr);
  assert.deepEqual(JSON.parse(loaded.stdout), [WEB_DSN, "exported"]);
  assert.match(loaded.stderr, /SENTRY_DSN_SERVER, SENTRY_DSN_WEB/, "names the variables it set");
  for (const secret of [WEB_DSN, SERVER_DSN, "from-file", "sntrys_from_file_never_used"])
    assert.ok(!loaded.stderr.includes(secret), "values are never printed");
  const missing = probe({ VERYNIZE_ENV_FILE: path.join(dir, "missing.env") });
  assert.equal(missing.status, 0, missing.stderr);
  assert.deepEqual(JSON.parse(missing.stdout), [null, "exported"]);
  assert.equal(missing.stderr, "");
  const failing = spawnSync(
    process.execPath,
    ["scripts/env.mjs", process.execPath, "-e", "process.exit(3)"],
    {
      cwd: root,
      env,
    },
  );
  assert.equal(failing.status, 3, "the command's exit status passes through");

  // The real build: the file's DSNs are baked into the web client and Worker defines.
  const log = execFileSync("npm", ["run", "build"], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: "pipe",
  });
  for (const secret of [WEB_DSN, SERVER_DSN, "sntrys_from_file_never_used"])
    assert.ok(!log.includes(secret), "the build log never shows a value");
  const assets = path.join(output, "assets/assets");
  const client = fs
    .readdirSync(assets)
    .filter((name) => name.endsWith(".js"))
    .map((name) => fs.readFileSync(path.join(assets, name), "utf8"))
    .find((source) => source.includes("env-web.invalid"));
  assert.ok(client, "SENTRY_DSN_WEB from .env reaches the web client define");
  assert.ok(
    client.includes(`dsn:\`${WEB_DSN}\``) || client.includes(`dsn:"${WEB_DSN}"`),
    "the whole DSN, comment stripped",
  );
  assert.match(client, /environment:[`"]exported[`"]/, "an exported variable wins over .env");
  assert.ok(!client.includes("from-file"));
  const worker = fs.readFileSync(path.join(output, "bundle/index.js"), "utf8");
  assert.ok(worker.includes(SERVER_DSN), "SENTRY_DSN_SERVER from .env is built into the Worker");
  assert.equal(
    fs.readdirSync(assets, { recursive: true }).filter((name) => String(name).endsWith(".map"))
      .length,
    0,
    "the .env token does not beat the exported empty one: no public source maps",
  );
  console.log(
    "PASS .env reaches the build defines (web client, Worker); exported values win; values never printed",
  );
} finally {
  // Never leave a build with test DSNs where `cf deploy --prebuilt` would pick it up.
  fs.rmSync(path.join(root, ".cloudflare/output"), { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}
