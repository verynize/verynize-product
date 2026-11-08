// Design → code loop: the changes a repo-backed chat made, reviewed and shipped from the chat dock.
// Lists changed files (status + numstat), returns bounded per-file unified diffs, commits everything,
// discards one file, pushes the current branch (never forced) and reads/creates GitHub pull requests
// through the user's own `gh`. Every command runs with execFile argument arrays (no shell) and a timeout.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { Project } = require("./projects.cjs");

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_FILES = 1000; // files reported by summary()
const DIFF_LIMIT = 512 * 1024; // characters of unified diff returned per file
const COUNT_LIMIT = 2 * 1024 * 1024; // untracked files above this size are not line-counted
const READ_TIMEOUT = 30000,
  PUSH_TIMEOUT = 120000,
  GH_TIMEOUT = 60000;

class GitChangesError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, message) => {
  throw new GitChangesError(code, message);
};

const searchDirs = () =>
  [
    ...(process.env.PATH || "").split(path.delimiter),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    path.join(os.homedir(), ".local/bin"),
  ].filter((dir) => dir && path.isAbsolute(dir));
async function findExecutable(name) {
  for (const dir of searchDirs()) {
    const candidate = path.join(dir, name);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        await fs.access(candidate, 1);
        return candidate;
      }
    } catch {}
  }
  return null;
}

function baseEnv(extra) {
  const env = { ...process.env, LC_ALL: "C", ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
const GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_LITERAL_PATHSPECS: "1",
  GIT_EDITOR: "true",
  GIT_PAGER: "cat",
  GCM_INTERACTIVE: "never",
};
const GH_ENV = {
  GH_PROMPT_DISABLED: "1",
  GH_NO_UPDATE_NOTIFIER: "1",
  GH_SPINNER_DISABLED: "1",
  NO_COLOR: "1",
  CLICOLOR: "0",
  GIT_TERMINAL_PROMPT: "0",
};

/** Runs a command; resolves {code, stdout, stderr, truncated} for any exit status, rejects only when it cannot run. */
function run(
  file,
  args,
  { cwd, timeout = READ_TIMEOUT, maxBuffer = 8 * 1024 * 1024, env, missing } = {},
) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { cwd, timeout, maxBuffer, env, windowsHide: true },
      (error, stdout, stderr) => {
        if (!error) return resolve({ code: 0, stdout, stderr, truncated: false });
        if (error.code === "ENOENT")
          return reject(
            missing || new GitChangesError("missing", `${path.basename(file)} is not installed`),
          );
        if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
          return resolve({
            code: 0,
            stdout: String(error.stdout ?? stdout ?? ""),
            stderr: String(stderr || ""),
            truncated: true,
          });
        if (error.killed || error.signal)
          return reject(
            new GitChangesError(
              "timeout",
              `${path.basename(file)} ${args[0] === "-C" ? args[2] : args[0]} timed out`,
            ),
          );
        if (typeof error.code === "number")
          return resolve({
            code: error.code,
            stdout: String(stdout || ""),
            stderr: String(stderr || ""),
            truncated: false,
          });
        reject(error);
      },
    );
    child.stdin?.end();
  });
}

const lastLines = (text, count = 3) =>
  String(text || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(-count)
    .join(" ")
    .slice(0, 400);
const stripCredentials = (url) =>
  typeof url === "string" ? url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]+@/i, "$1") : url;

/** Parses `git status --porcelain=v2 --branch -z`. */
function parseStatus(output) {
  const branch = { oid: null, head: null, upstream: null, ahead: 0, behind: 0 };
  const files = [];
  const tokens = output.split("\0");
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (!entry) continue;
    if (entry.startsWith("# ")) {
      const [, key, ...rest] = entry.split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") branch.oid = value === "(initial)" ? null : value;
      else if (key === "branch.head") branch.head = value;
      else if (key === "branch.upstream") branch.upstream = value;
      else if (key === "branch.ab") {
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) {
          branch.ahead = +m[1];
          branch.behind = +m[2];
        }
      }
      continue;
    }
    const kind = entry[0];
    if (kind === "?") {
      files.push({ path: entry.slice(2), status: "untracked", code: "?" });
      continue;
    }
    if (kind === "!") continue;
    const fields = entry.split(" ");
    const xy = fields[1] || "..";
    if (kind === "1") files.push({ path: fields.slice(8).join(" "), ...classify(xy) });
    else if (kind === "2") {
      files.push({ path: fields.slice(9).join(" "), ...classify(xy), from: tokens[i + 1] });
      i++;
    } else if (kind === "u")
      files.push({ path: fields.slice(10).join(" "), status: "conflicted", code: "U" });
  }
  return { branch, files };
}
function classify(xy) {
  if (xy.includes("D")) return { status: "deleted", code: "D" };
  if (xy[0] === "A") return { status: "added", code: "A" };
  if (xy.includes("R") || xy.includes("C")) return { status: "renamed", code: "R" };
  return { status: "modified", code: "M" };
}

/** Parses `git diff --numstat -z --no-renames`. */
function parseNumstat(output) {
  const stats = new Map();
  for (const record of output.split("\0")) {
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(record);
    if (!m) continue;
    stats.set(
      m[3],
      m[1] === "-"
        ? { added: 0, removed: 0, binary: true }
        : { added: +m[1], removed: +m[2], binary: false },
    );
  }
  return stats;
}

function classifyPushError(stderr) {
  const text = String(stderr || "");
  if (/\[rejected\]|non-fast-forward|fetch first|\[remote rejected\].*(stale|lock)/i.test(text))
    return fail(
      "push-rejected",
      "Push rejected: the remote branch has commits this branch does not. Pull or rebase first; Verynize never force-pushes.",
    );
  if (/remote rejected|pre-receive hook|declined/i.test(text))
    return fail("push-declined", `The remote declined the push: ${lastLines(text, 2)}`);
  if (
    /Authentication failed|could not read (Username|Password)|terminal prompts disabled|Permission denied \(publickey|HTTP Basic: Access denied|returned error: 403|invalid credentials/i.test(
      text,
    )
  )
    return fail(
      "push-auth-failed",
      "Push failed: git could not authenticate with the remote. Sign in with `gh auth login` or set up your Git credentials, then try again.",
    );
  if (
    /Could not resolve host|Network is unreachable|Connection (timed out|refused)|Operation timed out|unable to access/i.test(
      text,
    )
  )
    return fail(
      "push-network-failed",
      "Push failed: the remote could not be reached. Check your network connection.",
    );
  if (/does not appear to be a git repository|Repository not found|not found/i.test(text))
    return fail(
      "push-remote-unreachable",
      "Push failed: the remote repository was not found or you do not have access to it.",
    );
  if (/exceeds|too large|GH001/i.test(text))
    return fail(
      "push-file-too-large",
      `Push failed: a file is too large for the remote. ${lastLines(text, 2)}`,
    );
  return fail("push-failed", `Push failed: ${lastLines(text) || "git push exited with an error"}`);
}

class GitChanges {
  constructor(root) {
    this.root = root;
    this.project = new Project(root);
  }

  async git(args, options = {}) {
    const binary = await findExecutable("git");
    if (!binary)
      fail(
        "git-missing",
        "Git is not installed. Install the Xcode Command Line Tools (`xcode-select --install`) or Git, then try again.",
      );
    return run(binary, ["-C", this.root, ...args], {
      env: baseEnv({ ...GIT_ENV, ...options.env }),
      timeout: options.timeout || READ_TIMEOUT,
      maxBuffer: options.maxBuffer,
      cwd: this.root,
    });
  }
  async gitOk(args, options) {
    const result = await this.git(args, options);
    if (result.code !== 0)
      fail(
        options?.code || "git-failed",
        `${options?.label || "git " + args[0]} failed: ${lastLines(result.stderr || result.stdout) || "exit " + result.code}`,
      );
    return result.stdout;
  }

  /** Confirms the root is the top level of a Git work tree (status paths are repository-relative). */
  async ensureRepository() {
    const result = await this.git(["rev-parse", "--show-toplevel"]);
    if (result.code !== 0)
      fail(
        "not-a-repo",
        "This project is not a Git repository. Initialize Git or open a cloned repository to track changes.",
      );
    const top = await fs.realpath(result.stdout.trim()).catch(() => result.stdout.trim());
    if (top !== this.root)
      fail("not-repo-root", "Open the repository root folder to review and commit changes.");
  }

  async remotes() {
    return (await this.gitOk(["remote"]))
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async branchInfo(branch) {
    const remotes = await this.remotes();
    let remote = null,
      upstreamBranch = null;
    if (branch.upstream) {
      remote =
        remotes
          .filter((name) => branch.upstream.startsWith(name + "/"))
          .sort((a, b) => b.length - a.length)[0] || null;
      if (remote) upstreamBranch = branch.upstream.slice(remote.length + 1);
    }
    if (!remote) remote = remotes.includes("origin") ? "origin" : remotes[0] || null;
    let remoteUrl = null;
    if (remote) {
      const r = await this.git(["remote", "get-url", "--", remote]);
      if (r.code === 0) remoteUrl = stripCredentials(r.stdout.trim());
    }
    const detached = !branch.head || branch.head === "(detached)";
    return {
      branch: detached ? null : branch.head,
      detached,
      head: branch.oid ? branch.oid.slice(0, 12) : null,
      upstream: branch.upstream,
      upstreamBranch,
      ahead: branch.ahead,
      behind: branch.behind,
      remote,
      remoteUrl,
    };
  }

  async listFiles() {
    const status = await this.gitOk(
      ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all", "--no-renames"],
      { env: { GIT_OPTIONAL_LOCKS: "0" } },
    );
    return parseStatus(status);
  }

  async base(oid) {
    return (
      oid ||
      ((await this.git(["rev-parse", "--verify", "--quiet", "HEAD"])).code === 0
        ? "HEAD"
        : EMPTY_TREE)
    );
  }

  /** Changed files with status and +/− counts, plus branch/upstream/remote state. */
  async summary() {
    await this.ensureRepository();
    const { branch, files } = await this.listFiles();
    const base = branch.oid ? "HEAD" : EMPTY_TREE;
    const numstat = parseNumstat(
      (
        await this.gitOk(["diff", "--numstat", "-z", "--no-renames", "--no-ext-diff", base, "--"])
      ).toString(),
    );
    const listed = files.slice(0, MAX_FILES);
    for (const file of listed) {
      const stat = numstat.get(file.path);
      if (stat) Object.assign(file, stat);
      else if (file.status === "untracked")
        Object.assign(file, await this.countUntracked(file.path));
      else Object.assign(file, { added: 0, removed: 0, binary: false });
    }
    const totals = listed.reduce(
      (sum, f) => ({
        files: sum.files + 1,
        added: sum.added + f.added,
        removed: sum.removed + f.removed,
      }),
      { files: 0, added: 0, removed: 0 },
    );
    totals.files = files.length;
    return {
      root: this.root,
      ...(await this.branchInfo(branch)),
      files: listed,
      totals,
      truncated: files.length > listed.length,
    };
  }

  /** Where this branch left the default branch: merge base of HEAD with origin/HEAD, main or master (null if none). */
  async defaultBase() {
    for (const ref of [
      "refs/remotes/origin/HEAD",
      "refs/heads/main",
      "refs/heads/master",
      "refs/remotes/origin/main",
      "refs/remotes/origin/master",
    ]) {
      const result = await this.git(["merge-base", "HEAD", ref]);
      if (result.code === 0 && result.stdout.trim())
        return { ref: ref.replace(/^refs\/(heads|remotes)\//, ""), oid: result.stdout.trim() };
    }
    return null;
  }

  /** Every file this branch changed since the default branch: its commits plus uncommitted and untracked files. */
  async branchChanges() {
    await this.ensureRepository();
    const { branch, files } = await this.listFiles();
    const base = branch.oid ? await this.defaultBase() : null;
    const changed = new Map();
    if (base) {
      const tokens = (
        await this.gitOk([
          "diff",
          "--name-status",
          "-z",
          "--no-renames",
          "--no-ext-diff",
          base.oid,
          "--",
        ])
      )
        .toString()
        .split("\0");
      for (let i = 0; i + 1 < tokens.length; i += 2) {
        const letter = tokens[i][0];
        const status =
          letter === "A"
            ? "added"
            : letter === "D"
              ? "deleted"
              : letter === "U"
                ? "conflicted"
                : "modified";
        if (tokens[i + 1]) changed.set(tokens[i + 1], status);
      }
    }
    // Uncommitted entries fill in what the base diff cannot see (untracked files, a branch with no base).
    for (const file of files) if (!changed.has(file.path)) changed.set(file.path, file.status);
    const list = [...changed].map(([path, status]) => ({ path, status }));
    return {
      root: this.root,
      base: base?.ref ?? null,
      files: list.slice(0, MAX_FILES),
      truncated: list.length > MAX_FILES,
    };
  }

  async countUntracked(relative) {
    try {
      const target = path.join(this.root, relative);
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.size > COUNT_LIMIT) return { added: 0, removed: 0, binary: false };
      const data = await fs.readFile(target);
      if (data.includes(0)) return { added: 0, removed: 0, binary: true };
      const text = data.toString("utf8");
      return {
        added: text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0,
        removed: 0,
        binary: false,
      };
    } catch {
      return { added: 0, removed: 0, binary: false };
    }
  }

  async changedFile(file) {
    if (
      typeof file !== "string" ||
      !file ||
      file.includes("\0") ||
      path.isAbsolute(file) ||
      file.split(/[\\/]/).some((p) => p === "..")
    )
      fail("invalid-file", "Choose a changed file");
    const { branch, files } = await this.listFiles();
    const entry = files.find((f) => f.path === file);
    if (!entry) fail("file-not-changed", `${file} has no uncommitted changes`);
    return { entry, branch };
  }

  /** Unified diff of one changed file against HEAD (worktree + index), capped at DIFF_LIMIT characters. */
  async diff(file) {
    await this.ensureRepository();
    const { entry, branch } = await this.changedFile(file);
    const maxBuffer = DIFF_LIMIT * 2;
    let result;
    if (entry.status === "untracked") {
      // `--no-index` exits 1 when files differ, which is the expected case here.
      result = await this.git(
        ["diff", "--no-index", "--no-color", "--no-ext-diff", "--", os.devNull, file],
        { maxBuffer },
      );
      if (result.code > 1)
        fail("diff-failed", `Could not diff ${file}: ${lastLines(result.stderr)}`);
    } else {
      result = await this.git(
        [
          "diff",
          "--no-color",
          "--no-ext-diff",
          "--no-renames",
          await this.base(branch.oid),
          "--",
          file,
        ],
        { maxBuffer },
      );
      if (result.code !== 0)
        fail("diff-failed", `Could not diff ${file}: ${lastLines(result.stderr)}`);
    }
    let text = result.stdout;
    const truncated = result.truncated || text.length > DIFF_LIMIT;
    if (text.length > DIFF_LIMIT)
      text = text.slice(0, text.lastIndexOf("\n", DIFF_LIMIT) + 1 || DIFF_LIMIT);
    const binary = /^Binary files .* differ$/m.test(text);
    return { file, status: entry.status, diff: text, truncated, binary };
  }

  /** Stages everything and commits it with `message`. Hooks run; commits are never amended. */
  async commit(message) {
    if (typeof message !== "string" || !message.trim())
      fail("invalid-message", "Write a commit message");
    if (message.length > 10000)
      fail("invalid-message", "Keep the commit message under 10,000 characters");
    await this.ensureRepository();
    const { branch, files } = await this.listFiles();
    if (!files.length) fail("nothing-to-commit", "There are no changes to commit");
    if (files.some((f) => f.status === "conflicted"))
      fail("conflicts", "Resolve merge conflicts before committing");
    await this.gitOk(["add", "--all"], { label: "Staging changes" });
    const result = await this.git(
      ["commit", "--no-edit", "--cleanup=strip", "-m", message.trim()],
      { timeout: PUSH_TIMEOUT },
    );
    if (result.code !== 0) {
      const text = result.stderr + "\n" + result.stdout;
      if (/Please tell me who you are|user\.email|user\.name|empty ident/i.test(text))
        fail(
          "identity-missing",
          "Git does not know who you are. Set `git config --global user.name` and `user.email`, then commit again.",
        );
      if (/nothing to commit|no changes added/i.test(text))
        fail("nothing-to-commit", "There are no changes to commit");
      if (/hook/i.test(text) || result.stdout.trim() || result.stderr.trim())
        fail(
          "commit-failed",
          `Commit failed: ${lastLines(text, 4) || "git commit exited with " + result.code}`,
        );
      fail("commit-failed", "Commit failed");
    }
    const commit = (await this.gitOk(["rev-parse", "--short=12", "HEAD"])).trim();
    return {
      commit,
      branch: branch.head === "(detached)" ? null : branch.head,
      message: message.trim().split("\n")[0],
      files: files.length,
    };
  }

  /** Reverts one file to HEAD (or deletes it when it is new). The renderer confirms first. */
  async discard(file) {
    await this.ensureRepository();
    const { entry, branch } = await this.changedFile(file);
    if (entry.status === "conflicted")
      fail("conflicts", "Resolve the merge conflict in this file instead of discarding it");
    const remove = async () => {
      const target = await this.project.resolve(file);
      await fs.rm(target, { force: true });
    };
    if (entry.status === "untracked") {
      await remove();
      return { file, discarded: true };
    }
    const inHead = branch.oid && (await this.git(["cat-file", "-e", `HEAD:${file}`])).code === 0;
    if (inHead)
      await this.gitOk(["restore", "--source=HEAD", "--staged", "--worktree", "--", file], {
        label: "Discard",
      });
    else {
      await this.gitOk(["rm", "--cached", "--force", "--quiet", "--", file], { label: "Discard" });
      await remove().catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    }
    return { file, discarded: true };
  }

  /** Pushes the current branch to its upstream, or publishes it with --set-upstream. Never forced. */
  async push() {
    await this.ensureRepository();
    const { branch } = await this.listFiles();
    const info = await this.branchInfo(branch);
    if (info.detached) fail("detached-head", "Check out a branch before pushing");
    if (!branch.oid) fail("publish-no-commit", "Commit your changes before pushing");
    if (!info.remote)
      fail(
        "no-remote",
        "This repository has no remote. Add one (for example with `gh repo create`) to push.",
      );
    const target = info.upstreamBranch || info.branch;
    const args = [
      "push",
      "--porcelain",
      ...(info.upstreamBranch ? [] : ["--set-upstream"]),
      "--",
      info.remote,
      `refs/heads/${info.branch}:refs/heads/${target}`,
    ];
    const result = await this.git(args, { timeout: PUSH_TIMEOUT });
    if (result.code !== 0) classifyPushError(result.stderr + "\n" + result.stdout);
    return {
      branch: info.branch,
      remote: info.remote,
      upstream: `${info.remote}/${target}`,
      summary: await this.summary(),
    };
  }

  async gh(args, timeout = GH_TIMEOUT) {
    const binary = await findExecutable("gh");
    if (!binary)
      fail(
        "gh-missing",
        "GitHub CLI (gh) is not installed. Install it with `brew install gh`, then run `gh auth login`.",
      );
    return run(binary, args, { cwd: this.root, env: baseEnv(GH_ENV), timeout });
  }

  static ghProblem(text) {
    if (/gh auth login|not logged in|authentication|HTTP 401|bad credentials/i.test(text))
      return {
        gh: "unauthenticated",
        message: "GitHub CLI is not signed in. Run `gh auth login` in a terminal.",
      };
    if (
      /none of the git remotes|no git remotes|not a git repository|could not determine|not a github/i.test(
        text,
      )
    )
      return { gh: "unsupported", message: "This repository has no GitHub remote." };
    return null;
  }

  /** Open/merged/closed pull request for the current branch via `gh pr view`; `pr` is null when there is none. */
  async pullRequest() {
    await this.ensureRepository();
    const { branch } = await this.listFiles();
    if (!branch.head || branch.head === "(detached)") return { gh: "ready", pr: null };
    let result;
    try {
      result = await this.gh([
        "pr",
        "view",
        branch.head,
        "--json",
        "number,url,state,title,isDraft,baseRefName,headRefName",
      ]);
    } catch (error) {
      if (error.code === "gh-missing") return { gh: "missing", pr: null, message: error.message };
      throw error;
    }
    if (result.code === 0) {
      let data;
      try {
        data = JSON.parse(result.stdout);
      } catch {
        fail("pr-failed", "GitHub CLI returned an unreadable response");
      }
      return {
        gh: "ready",
        pr: {
          number: data.number,
          url: data.url,
          state: data.state,
          title: data.title,
          isDraft: !!data.isDraft,
          base: data.baseRefName,
          head: data.headRefName,
        },
      };
    }
    const text = result.stderr + "\n" + result.stdout;
    if (/no (open )?pull requests? found/i.test(text)) return { gh: "ready", pr: null };
    const problem = GitChanges.ghProblem(text);
    if (problem) return { ...problem, pr: null };
    fail("pr-failed", `Could not read the pull request: ${lastLines(text)}`);
  }

  /** Opens a pull request for the pushed current branch with `gh pr create` (--fill unless a title is given). */
  async createPullRequest({ title, body, base, draft } = {}) {
    await this.ensureRepository();
    const { branch } = await this.listFiles();
    const info = await this.branchInfo(branch);
    if (info.detached) fail("detached-head", "Check out a branch before opening a pull request");
    if (!info.upstream) fail("not-pushed", "Push the branch before opening a pull request");
    if (info.ahead > 0)
      fail("not-pushed", "Push your latest commits before opening a pull request");
    if (title != null && (typeof title !== "string" || title.length > 256))
      fail("invalid-title", "Use a pull request title under 256 characters");
    if (body != null && (typeof body !== "string" || body.length > 60000))
      fail("invalid-body", "Keep the pull request description under 60,000 characters");
    if (
      base != null &&
      base !== "" &&
      (typeof base !== "string" || !/^[A-Za-z0-9._/][A-Za-z0-9._/-]{0,199}$/.test(base))
    )
      fail("invalid-base", "Choose a valid base branch");
    const args = ["pr", "create", "--head", info.upstreamBranch || info.branch];
    if (title && title.trim()) args.push("--title", title.trim(), "--body", body || "");
    else args.push("--fill");
    if (base) args.push("--base", base);
    if (draft) args.push("--draft");
    const result = await this.gh(args);
    const text = result.stderr + "\n" + result.stdout;
    if (result.code !== 0) {
      if (/already exists/i.test(text)) {
        const existing = await this.pullRequest();
        if (existing.pr) return { url: existing.pr.url, pr: existing.pr, existed: true };
      }
      const problem = GitChanges.ghProblem(text);
      fail(
        problem
          ? problem.gh === "unauthenticated"
            ? "gh-unauthenticated"
            : "pr-unsupported"
          : "pr-failed",
        problem?.message || `Could not create the pull request: ${lastLines(text)}`,
      );
    }
    const url = (result.stdout.match(/https?:\/\/\S+/g) || []).pop() || null;
    const view = await this.pullRequest().catch(() => ({ pr: null }));
    return { url: view.pr?.url || url, pr: view.pr, existed: false };
  }
}

/** The project root, or one of its registered Git worktrees (realpath-compared). Anything else is rejected. */
async function resolveRoot(project, requested) {
  if (!project) fail("no-project", "Open a project folder first");
  if (requested == null || requested === "") return project.root;
  if (typeof requested !== "string" || requested.includes("\0") || !path.isAbsolute(requested))
    fail("invalid-root", "Invalid repository path");
  let real;
  try {
    real = await fs.realpath(requested);
  } catch {
    fail("invalid-root", "That repository folder does not exist");
  }
  if (real === project.root) return real;
  const listing = await new GitChanges(project.root).git(["worktree", "list", "--porcelain", "-z"]);
  if (listing.code === 0) {
    for (const record of listing.stdout.split("\0")) {
      if (!record.startsWith("worktree ")) continue;
      const candidate = await fs.realpath(record.slice(9)).catch(() => null);
      if (candidate === real) return real;
    }
  }
  fail("outside-project", "That folder is not this project or one of its worktrees");
}

function registerGitChanges(handle, { getProject }) {
  const queues = new Map(); // one mutating git operation per repository at a time
  const serial = (root, task) => {
    const previous = queues.get(root) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    queues.set(root, next);
    next
      .finally(() => {
        if (queues.get(root) === next) queues.delete(root);
      })
      .catch(() => {});
    return next;
  };
  const at = async (options) => new GitChanges(await resolveRoot(getProject(), options?.root));
  const mutate =
    (method) =>
    async (options = {}) => {
      const repo = await at(options);
      return serial(repo.root, () => method(repo, options));
    };
  const readChanges = (method) => async (options) => {
    try {
      return await (await at(options))[method]();
    } catch (error) {
      if (error.code === "not-a-repo") return { code: error.code, message: error.message };
      throw error;
    }
  };
  handle("gitChanges", readChanges("summary"));
  handle("gitBranchChanges", readChanges("branchChanges"));
  handle("gitDiff", async (options) => (await at(options)).diff(options?.file));
  handle(
    "gitCommit",
    mutate((repo, options) => repo.commit(options.message)),
  );
  handle(
    "gitDiscard",
    mutate((repo, options) => repo.discard(options.file)),
  );
  handle(
    "gitPush",
    mutate((repo) => repo.push()),
  );
  handle("gitPullRequest", async (options) => (await at(options)).pullRequest());
  handle(
    "gitCreatePullRequest",
    mutate((repo, options) => repo.createPullRequest(options)),
  );
}

module.exports = {
  GitChanges,
  GitChangesError,
  registerGitChanges,
  resolveRoot,
  parseStatus,
  parseNumstat,
  DIFF_LIMIT,
};
