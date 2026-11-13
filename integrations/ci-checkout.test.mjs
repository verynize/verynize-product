import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { prepareCIHistory } from "../scripts/ci-fetch-history.mjs";

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verynize-ci-checkout-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  fs.mkdirSync(source);
  git(source, "init", "-b", "main");
  git(source, "config", "user.name", "CI Test");
  git(source, "config", "user.email", "ci@example.invalid");
  git(source, "config", "uploadpack.allowFilter", "true");
  const write = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(source, name)), { recursive: true });
    fs.writeFileSync(path.join(source, name), text);
  };
  for (const name of [
    "design/reference.png",
    "docs/ci.md",
    "eval/fidelity/fixtures/doc.json",
    "tests/fixtures/doc.json",
    "web/app.js",
    ".github/workflows/tests.yml",
    "package.json",
  ])
    write(name, name);
  git(source, "add", ".");
  git(source, "commit", "-qm", "initial fixtures");
  const common = git(source, "rev-parse", "HEAD");
  git(source, "switch", "-c", "feature");
  write("web/app.js", "feature change");
  git(source, "commit", "-qam", "feature");
  const head = git(source, "rev-parse", "HEAD");
  git(source, "switch", "main");
  // The base branch advanced independently. A base..head diff would incorrectly
  // include this file; the PR diff must begin at their common ancestor.
  write("base-only.js", "base change");
  git(source, "add", ".");
  git(source, "commit", "-qm", "advance base");
  for (let i = 0; i < 40; i++) git(source, "commit", "--allow-empty", "-qm", `base ${i}`);
  const base = git(source, "rev-parse", "HEAD");
  const event = path.join(root, "event.json");
  fs.writeFileSync(
    event,
    JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: head } } }),
  );
  const clone = (name) => {
    const target = path.join(root, name);
    git(
      root,
      "clone",
      "--quiet",
      "--filter=blob:none",
      "--depth=1",
      "--no-checkout",
      "-b",
      "feature",
      pathToFileURL(source).href,
      target,
    );
    git(target, "sparse-checkout", "set", "--no-cone", "/*", "!/design/");
    git(target, "checkout", "--quiet", "feature");
    return target;
  };
  return {
    root,
    source,
    common,
    head,
    base,
    clone,
    env: {
      ...process.env,
      GH_TOKEN: "",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: event,
    },
  };
}

test("sparse checkout retains source, hidden files and fixtures without reference images", (t) => {
  const r = repository(t);
  const cwd = r.clone("sparse");
  assert.equal(fs.existsSync(path.join(cwd, "design")), false);
  for (const name of [
    "web/app.js",
    ".github/workflows/tests.yml",
    "docs/ci.md",
    "eval/fidelity/fixtures/doc.json",
    "tests/fixtures/doc.json",
    "package.json",
  ])
    assert.ok(fs.existsSync(path.join(cwd, name)), name);
  const image = git(r.source, "rev-parse", "HEAD:design/reference.png");
  assert.match(
    git(cwd, "rev-list", "--objects", "--missing=print", "HEAD"),
    new RegExp(`\\?${image}`),
    "excluded reference blob is not downloaded",
  );
});

test("bounded deepening restores the real PR merge base rather than diffing the advanced base", (t) => {
  const r = repository(t);
  const cwd = r.clone("bounded");
  const messages = [];
  const token = "ci-test-token-placeholder";
  const result = prepareCIHistory({
    cwd,
    env: { ...r.env, GH_TOKEN: token },
    log: (line) => messages.push(line),
  });
  assert.equal(result.mergeBase, r.common);
  assert.equal(git(cwd, "diff", "--name-only", result.mergeBase, r.head), "web/app.js");
  assert.ok(messages.some((line) => line.includes("32 commits")));
  assert.ok(messages.some((line) => line.includes("128 commits")));
  assert.equal(fs.existsSync(path.join(cwd, "design")), false);
  const config = git(cwd, "config", "--local", "--list");
  assert.equal(config.includes("extraheader"), false);
  assert.equal(config.includes(token), false);
  assert.equal(messages.join("\n").includes(token), false);
  const image = git(r.source, "rev-parse", "HEAD:design/reference.png");
  assert.match(
    git(cwd, "rev-list", "--objects", "--missing=print", r.base, r.head),
    new RegExp(`\\?${image}`),
    "history deepening does not download unchanged reference blobs",
  );
});

test("deep PRs fall back to complete filtered ancestry and quality fetches only the base", (t) => {
  const r = repository(t);
  const cwd = r.clone("fallback");
  const messages = [];
  assert.equal(
    prepareCIHistory({ cwd, env: r.env, deepenSteps: [1], log: (line) => messages.push(line) })
      .mergeBase,
    r.common,
  );
  assert.ok(messages.some((line) => line.includes("completing filtered history")));
  const quality = r.clone("quality");
  const result = prepareCIHistory({ cwd: quality, env: r.env, baseOnly: true, log() {} });
  assert.equal(result.base, r.base);
  assert.equal(git(quality, "rev-parse", "--is-shallow-repository"), "true");
  assert.equal(git(quality, "rev-parse", "refs/ci/base"), r.base);
});

test("full-suite events fetch nothing and malformed PR SHAs are rejected", () => {
  assert.deepEqual(
    prepareCIHistory({
      cwd: "/does-not-exist",
      env: { GITHUB_EVENT_NAME: "workflow_dispatch" },
      log() {},
    }),
    { fetched: false },
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verynize-ci-event-"));
  try {
    const event = path.join(root, "event.json");
    fs.writeFileSync(
      event,
      JSON.stringify({
        pull_request: { base: { sha: "--upload-pack=bad" }, head: { sha: "a".repeat(40) } },
      }),
    );
    assert.throws(
      () =>
        prepareCIHistory({
          env: { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event },
          log() {},
        }),
      /commit SHAs/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
