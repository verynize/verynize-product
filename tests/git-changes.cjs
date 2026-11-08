// Changes panel backend (desktop/git-changes.cjs) against real temporary Git repositories: status/numstat,
// bounded diffs, discard, commit, push to a local bare remote (with --set-upstream, never forced), root
// containment, and pull requests through a stub `gh` placed first on PATH (the only fake here: no network).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  GitChanges,
  resolveRoot,
  registerGitChanges,
  DIFF_LIMIT,
} = require("../desktop/git-changes.cjs");
const { Project } = require("../desktop/projects.cjs");

const identity = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};
const restoreEnv = (saved) => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
};
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...identity },
  });

async function setup() {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bd-git-changes-")));
  const root = path.join(base, "repo"),
    remote = path.join(base, "remote.git");
  await fs.mkdir(root);
  git(base, "init", "--bare", "--initial-branch=main", remote);
  git(root, "init", "--initial-branch=main");
  await fs.writeFile(path.join(root, "index.html"), "<h1>One</h1>\n<p>Two</p>\n<p>Three</p>\n");
  await fs.writeFile(path.join(root, "remove-me.txt"), "bye\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "Initial");
  git(root, "remote", "add", "origin", remote);
  return { base, root, remote };
}

test("lists changes with numstat, diffs, discards, commits and pushes to a bare remote", async () => {
  const { base, root, remote } = await setup();
  const saved = { ...process.env };
  Object.assign(process.env, identity);
  try {
    const repo = new GitChanges(root);
    const clean = await repo.summary();
    assert.equal(clean.branch, "main");
    assert.equal(clean.remote, "origin");
    assert.equal(clean.upstream, null);
    assert.equal(clean.totals.files, 0);

    await fs.writeFile(
      path.join(root, "index.html"),
      "<h1>One!</h1>\n<p>Two</p>\n<p>Three</p>\n<p>Four</p>\n",
    );
    await fs.rm(path.join(root, "remove-me.txt"));
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "new file.css"), "a{}\nb{}\n");
    await fs.writeFile(path.join(root, "scratch.txt"), "temp\n");
    const changed = await repo.summary();
    const byPath = Object.fromEntries(changed.files.map((f) => [f.path, f]));
    assert.deepEqual(Object.keys(byPath).sort(), [
      "index.html",
      "remove-me.txt",
      "scratch.txt",
      "src/new file.css",
    ]);
    assert.deepEqual(
      [byPath["index.html"].status, byPath["index.html"].added, byPath["index.html"].removed],
      ["modified", 2, 1],
    );
    assert.deepEqual(
      [byPath["remove-me.txt"].status, byPath["remove-me.txt"].removed],
      ["deleted", 1],
    );
    assert.deepEqual(
      [byPath["src/new file.css"].status, byPath["src/new file.css"].added],
      ["untracked", 2],
    );
    assert.deepEqual(changed.totals, { files: 4, added: 5, removed: 2 });

    const diff = await repo.diff("index.html");
    assert.match(diff.diff, /^-<h1>One<\/h1>$/m);
    assert.match(diff.diff, /^\+<p>Four<\/p>$/m);
    assert.equal(diff.truncated, false);
    const untracked = await repo.diff("src/new file.css");
    assert.match(untracked.diff, /^\+b\{\}$/m);
    await assert.rejects(repo.diff("../outside"), /changed file/);
    await assert.rejects(repo.diff("README.md"), /no uncommitted changes/);

    // Bounded diff: a large generated file is cut at DIFF_LIMIT and flagged.
    await fs.writeFile(
      path.join(root, "big.txt"),
      "x".repeat(200) +
        "\n".repeat(1) +
        Array.from({ length: 6000 }, (_, i) => "line " + i + " " + "y".repeat(80)).join("\n"),
    );
    const big = await repo.diff("big.txt");
    assert.equal(big.truncated, true);
    assert.ok(big.diff.length <= DIFF_LIMIT);

    // Discard: untracked files are deleted, tracked files restored from HEAD.
    await repo.discard("big.txt");
    await repo.discard("scratch.txt");
    await repo.discard("remove-me.txt");
    assert.equal(await fs.readFile(path.join(root, "remove-me.txt"), "utf8"), "bye\n");
    await assert.rejects(fs.access(path.join(root, "scratch.txt")));
    await assert.rejects(repo.discard("scratch.txt"), /no uncommitted changes/);

    await assert.rejects(repo.commit("   "), /commit message/);
    const commit = await repo.commit("Apply canvas changes\n\nFrom Verynize");
    assert.match(commit.commit, /^[0-9a-f]{12}$/);
    assert.equal(commit.message, "Apply canvas changes");
    assert.equal(commit.files, 2);
    assert.equal((await repo.summary()).totals.files, 0);
    assert.match(git(root, "log", "-1", "--format=%s"), /Apply canvas changes/);
    await assert.rejects(repo.commit("Again"), /no changes/);

    // First push publishes the branch with an upstream; a later push fast-forwards it.
    const pushed = await repo.push();
    assert.equal(pushed.upstream, "origin/main");
    assert.equal(pushed.summary.ahead, 0);
    assert.equal(git(remote, "rev-parse", "main"), git(root, "rev-parse", "HEAD"));
    await fs.writeFile(path.join(root, "index.html"), "<h1>Two</h1>\n");
    await repo.commit("Second");
    assert.equal((await repo.summary()).ahead, 1);
    await repo.push();
    assert.equal(git(remote, "rev-parse", "main"), git(root, "rev-parse", "HEAD"));

    // A diverged remote is rejected, never force-pushed.
    const other = path.join(base, "other");
    git(base, "clone", remote, other);
    await fs.writeFile(path.join(other, "other.txt"), "remote\n");
    git(other, "add", ".");
    git(other, "commit", "-m", "Remote change");
    git(other, "push", "origin", "main");
    const remoteHead = git(remote, "rev-parse", "main");
    await fs.writeFile(path.join(root, "local.txt"), "local\n");
    await repo.commit("Local change");
    await assert.rejects(repo.push(), /Push rejected[\s\S]*never force-pushes/);
    assert.equal(git(remote, "rev-parse", "main"), remoteHead);
  } finally {
    restoreEnv(saved);
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("root containment: project root and its worktrees only", async () => {
  const { base, root } = await setup();
  try {
    const project = await Project.open(root);
    const worktree = await project.worktree("design/panel");
    assert.equal(await resolveRoot(project), root);
    assert.equal(await resolveRoot(project, worktree.path), await fs.realpath(worktree.path));
    await assert.rejects(resolveRoot(project, base), /not this project/);
    await assert.rejects(resolveRoot(project, "relative/path"), /Invalid repository path/);
    await assert.rejects(resolveRoot(null), /Open a project/);
    // Subfolders of a repository are refused (status paths are repository-relative).
    await fs.mkdir(path.join(root, "sub"));
    await assert.rejects(new GitChanges(path.join(root, "sub")).summary(), /repository root/);
    // Not a repository at all.
    const plain = path.join(base, "plain");
    await fs.mkdir(plain);
    await assert.rejects(new GitChanges(plain).summary(), /not a Git repository/);

    const plainHandlers = {};
    registerGitChanges((name, fn) => (plainHandlers[name] = fn), {
      getProject: () => new Project(plain),
    });
    for (const name of ["gitChanges", "gitBranchChanges"]) {
      const result = await plainHandlers[name]({});
      assert.equal(result.code, "not-a-repo");
      assert.match(result.message, /not a Git repository/);
    }
    await assert.rejects(plainHandlers.gitCommit({ message: "No repo" }), /not a Git repository/);

    // IPC registration wires every handler through the root check.
    const handlers = {};
    registerGitChanges((name, fn) => (handlers[name] = fn), { getProject: () => project });
    assert.deepEqual(Object.keys(handlers).sort(), [
      "gitBranchChanges",
      "gitChanges",
      "gitCommit",
      "gitCreatePullRequest",
      "gitDiff",
      "gitDiscard",
      "gitPullRequest",
      "gitPush",
    ]);
    assert.equal((await handlers.gitChanges({ root: worktree.path })).branch, "design/panel");
    await assert.rejects(handlers.gitCommit({ root: base, message: "x" }), /not this project/);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("pull requests through gh: missing, unauthenticated, none, create and view", async () => {
  const { base, root } = await setup();
  const saved = { ...process.env };
  try {
    const bin = path.join(base, "bin"),
      log = path.join(base, "gh.log"),
      state = path.join(base, "gh-state");
    await fs.mkdir(bin);
    // Stub gh: records argv, simulates auth state and one PR per branch. Explicit fake, no network.
    await fs.writeFile(
      path.join(bin, "gh"),
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (process.env.FAKE_GH_AUTH === 'none') { process.stderr.write('To get started with GitHub CLI, please run:  gh auth login\\n'); process.exit(4); }
const pr = { number: 7, url: 'https://github.com/acme/site/pull/7', state: 'OPEN', title: 'Canvas changes', isDraft: false, baseRefName: 'main', headRefName: args[3] || 'design/pr' };
if (args[0] === 'pr' && args[1] === 'view') {
  if (!fs.existsSync(${JSON.stringify(state)})) { process.stderr.write('no pull requests found for branch "' + args[2] + '"\\n'); process.exit(1); }
  process.stdout.write(JSON.stringify({ ...pr, headRefName: args[2] })); process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'create') {
  if (fs.existsSync(${JSON.stringify(state)})) { process.stderr.write('a pull request for branch already exists\\n'); process.exit(1); }
  fs.writeFileSync(${JSON.stringify(state)}, '1'); process.stdout.write(pr.url + '\\n'); process.exit(0);
}
process.exit(2);
`,
    );
    await fs.chmod(path.join(bin, "gh"), 0o755);
    Object.assign(process.env, identity);
    const repo = new GitChanges(root);

    // gh absent from PATH (and the usual install dirs) → reported as missing, not thrown.
    const hasSystemGh = [
      "/opt/homebrew/bin/gh",
      "/usr/local/bin/gh",
      "/usr/bin/gh",
      path.join(os.homedir(), ".local/bin/gh"),
    ].some((p) => {
      try {
        require("node:fs").accessSync(p);
        return true;
      } catch {
        return false;
      }
    });
    if (!hasSystemGh) {
      process.env.PATH = path.dirname(execFileSync("which", ["git"], { encoding: "utf8" }).trim());
      assert.equal((await repo.pullRequest()).gh, "missing");
    }

    process.env.PATH = bin + path.delimiter + saved.PATH;
    git(root, "checkout", "-b", "design/pr");
    await fs.writeFile(path.join(root, "page.html"), "<main></main>\n");
    await repo.commit("Add page");

    process.env.FAKE_GH_AUTH = "none";
    assert.equal((await repo.pullRequest()).gh, "unauthenticated");
    delete process.env.FAKE_GH_AUTH;

    assert.deepEqual(await repo.pullRequest(), { gh: "ready", pr: null });
    await assert.rejects(repo.createPullRequest({ title: "Canvas changes" }), /Push the branch/);
    await repo.push();
    await assert.rejects(repo.createPullRequest({ base: "--evil" }), /valid base/);
    const created = await repo.createPullRequest({
      title: "Canvas changes",
      body: "From the canvas",
      draft: true,
    });
    assert.equal(created.url, "https://github.com/acme/site/pull/7");
    assert.equal(created.pr.number, 7);
    const calls = (await fs.readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(
      calls.find((c) => c[1] === "create"),
      [
        "pr",
        "create",
        "--head",
        "design/pr",
        "--title",
        "Canvas changes",
        "--body",
        "From the canvas",
        "--draft",
      ],
    );
    const view = await repo.pullRequest();
    assert.equal(view.pr.head, "design/pr");
    assert.equal(view.pr.state, "OPEN");
    // Creating again returns the existing pull request.
    assert.equal((await repo.createPullRequest({})).existed, true);
    assert.deepEqual(calls.filter((c) => c[1] === "create").length, 1);
    assert.ok((await fs.readFile(log, "utf8")).includes('"--fill"'));
  } finally {
    restoreEnv(saved);
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("branch changes: commits since the default branch plus uncommitted and untracked files", async () => {
  const { base, root } = await setup();
  const saved = { ...process.env };
  Object.assign(process.env, identity);
  try {
    const repo = new GitChanges(root);
    // On main itself the merge base is HEAD, so all changes are the uncommitted ones.
    await fs.writeFile(path.join(root, "draft.txt"), "draft\n");
    assert.deepEqual(await repo.branchChanges(), {
      root,
      base: "main",
      files: [{ path: "draft.txt", status: "untracked" }],
      truncated: false,
    });
    await fs.rm(path.join(root, "draft.txt"));

    git(root, "checkout", "-b", "verynize/finch");
    await fs.writeFile(path.join(root, "committed.css"), "a{}\n");
    await fs.rm(path.join(root, "remove-me.txt"));
    git(root, "add", "--all");
    git(root, "commit", "-m", "Branch work");
    await fs.writeFile(path.join(root, "index.html"), "<h1>Changed</h1>\n");
    await fs.writeFile(path.join(root, "new.txt"), "new\n");

    const all = await repo.branchChanges();
    assert.equal(all.base, "main");
    assert.deepEqual(Object.fromEntries(all.files.map((f) => [f.path, f.status])), {
      "committed.css": "added",
      "index.html": "modified",
      "remove-me.txt": "deleted",
      "new.txt": "untracked",
    });
    assert.deepEqual(
      (await repo.summary()).files.map((f) => f.path).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      ["index.html", "new.txt"],
      "uncommitted stays the working tree only",
    );
  } finally {
    restoreEnv(saved);
    await fs.rm(base, { recursive: true, force: true });
  }
});
