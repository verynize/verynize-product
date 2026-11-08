// History-preserving workspace moves for registered repositories (Settings › Projects).
//
//   moveInRepository({repoId, from, to, message})
//       `git mv` of a file or folder inside one repository, committed on its own so `git log --follow`
//       continues across the rename. Registered projects nested under `from` follow the move.
//   relocateRepository({repoId, destination | name})
//       Moves or renames a whole repository folder (history is the .git folder itself and moves with it),
//       runs `git worktree repair` so chat worktrees point at the new location, and updates the registry
//       (repository root and any worktree recorded inside the old folder).
//   moveAcrossRepositories({sourceRepoId, path, targetRepoId, to, strategy})
//       strategy 'patches' (default, files and folders): `git format-patch --root -- <path>` in the source,
//       `git am --directory=<staging>` in the target, then one rename commit to `to`; if merges hid part of
//       the content, a final sync commit makes the target match the source exactly.
//       strategy 'subtree' (folders): `git subtree split --prefix` + `git subtree add --prefix` (keeps the
//       folder's full commit graph). The source then removes the path in one commit.
// Every operation requires the involved working trees to be clean and refuses while an agent runs there.
// The renderer migrates chats keyed by the old root (see `moved` in each result).
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);

const IDENTITY = {
  GIT_AUTHOR_NAME: "Verynize",
  GIT_AUTHOR_EMAIL: "verynize@localhost",
  GIT_COMMITTER_NAME: "Verynize",
  GIT_COMMITTER_EMAIL: "verynize@localhost",
};
const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" });
async function git(cwd, args, { timeout = 120000 } = {}) {
  try {
    return (
      await exec("git", ["-C", cwd, ...args], {
        timeout,
        maxBuffer: 256 * 1024 * 1024,
        env: gitEnv(),
      })
    ).stdout;
  } catch (error) {
    throw Error(
      String(error.stderr || error.message)
        .trim()
        .split("\n")
        .slice(0, 3)
        .join(" ") || "git failed",
    );
  }
}
/** Commit with the user's identity when configured, else a local Verynize identity. */
async function commit(cwd, message, extra = []) {
  let identity = {};
  try {
    await git(cwd, ["config", "user.email"]);
  } catch {
    identity = IDENTITY;
  }
  try {
    return (
      await exec("git", ["-C", cwd, "commit", "-q", "-m", message, ...extra], {
        env: { ...gitEnv(), ...identity },
        timeout: 60000,
      })
    ).stdout;
  } catch (error) {
    throw Error(
      String(error.stderr || error.message)
        .trim()
        .split("\n")[0],
    );
  }
}

function cleanRelative(value, label) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || path.isAbsolute(value))
    throw Error(`Enter the ${label} as a path inside the repository`);
  const parts = value.trim().replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || p === ".git"))
    throw Error(`The ${label} must stay inside the repository`);
  return parts.join("/");
}
async function exists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}
async function requireClean(root) {
  const status = await git(root, ["status", "--porcelain"]);
  if (status.trim())
    throw Error(`${path.basename(root)} has uncommitted changes; commit or discard them first`);
}
async function requireCommitted(root) {
  try {
    await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  } catch {
    throw Error(`${path.basename(root)} has no commits yet`);
  }
  const top = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
  if ((await fs.realpath(top)) !== root)
    throw Error(`${path.basename(root)} is not the top folder of its git repository`);
}

class RepositoryMoves {
  /**
   * `busy(root)`: true while an agent run uses that folder or one of its worktrees.
   * @param {{registry?: any, busy?: (root: string) => boolean | Promise<boolean>}} [options]
   */
  constructor({ registry, busy = () => false } = {}) {
    if (!registry) throw Error("Repository registry required");
    this.registry = registry;
    this.busy = busy;
  }
  async guard(root) {
    if (await this.busy(root)) throw Error("Stop the agents working in this repository first");
  }

  /** Rewrite registry paths under `from` to `to` (repositories and worktree records). */
  async rebase(from, to) {
    return this.registry.serial(async () => {
      const data = await this.registry.load();
      const under = (p) => p === from || p.startsWith(from + path.sep);
      const swap = (p) => to + p.slice(from.length);
      const moved = [];
      for (const repo of data.repositories)
        if (under(repo.root)) {
          moved.push({ id: repo.id, from: repo.root, to: swap(repo.root) });
          repo.root = swap(repo.root);
        }
      for (const w of data.worktrees) if (under(w.path)) w.path = swap(w.path);
      await this.registry.save();
      return moved;
    });
  }

  async moveInRepository({ repoId, from, to, message } = {}) {
    const repo = await this.registry.get(repoId);
    const root = repo.root;
    await requireCommitted(root);
    await this.guard(root);
    await requireClean(root);
    const source = cleanRelative(from, "source"),
      target = cleanRelative(to, "destination");
    if (source === target) throw Error("Choose a different destination");
    if (target.startsWith(source + "/")) throw Error("A folder cannot move into itself");
    if (!(await exists(path.join(root, source)))) throw Error(`${source} does not exist`);
    if (await exists(path.join(root, target))) throw Error(`${target} already exists`);
    const tracked = (await git(root, ["ls-files", "--", source])).trim();
    if (!tracked) throw Error(`${source} is not tracked by git`);
    await fs.mkdir(path.dirname(path.join(root, target)), { recursive: true });
    await git(root, ["mv", "--", source, target]);
    await commit(
      root,
      typeof message === "string" && message.trim()
        ? message.trim().slice(0, 200)
        : `Move ${source} to ${target}`,
    );
    const moved = await this.rebase(path.join(root, source), path.join(root, target));
    return {
      moved,
      commit: (await git(root, ["rev-parse", "HEAD"])).trim(),
      from: source,
      to: target,
    };
  }

  async relocateRepository({ repoId, destination, name } = {}) {
    const repo = await this.registry.get(repoId);
    const from = repo.root;
    await this.guard(from);
    let to;
    if (typeof name === "string" && name.trim()) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,80}$/.test(name.trim()))
        throw Error("Use letters, numbers, spaces, dots, dashes or underscores");
      to = path.join(path.dirname(from), name.trim());
    } else if (typeof destination === "string" && path.isAbsolute(destination)) {
      const parent = await fs.realpath(path.dirname(destination));
      to = path.join(parent, path.basename(destination));
    } else throw Error("Choose a new name or folder");
    if (to === from) throw Error("Choose a different name or folder");
    if (to.startsWith(from + path.sep)) throw Error("A repository cannot move into itself");
    if (await exists(to)) throw Error(`${to} already exists`);
    const isGit = await git(from, ["rev-parse", "--show-toplevel"])
      .then((top) => fs.realpath(top.trim()))
      .then((top) => top === from)
      .catch(() => false);
    if (isGit) await requireClean(from);
    try {
      await fs.rename(from, to);
    } catch (error) {
      throw Error(
        error.code === "EXDEV"
          ? "Moving to another disk is not supported; choose a folder on the same disk"
          : error.message,
      );
    }
    const data = await this.registry.load();
    const worktrees = data.worktrees
      .filter((w) => w.repoId === repo.id)
      .map((w) => (w.path.startsWith(from + path.sep) ? to + w.path.slice(from.length) : w.path));
    if (isGit)
      await git(to, [
        "worktree",
        "repair",
        ...(await Promise.all(worktrees.map(async (w) => ((await exists(w)) ? w : null)))).filter(
          Boolean,
        ),
      ]).catch(() => {});
    const moved = await this.rebase(from, to);
    await this.registry.serial(async () => {
      const r = (await this.registry.load()).repositories.find((x) => x.id === repo.id);
      if (r) {
        r.name = path.basename(to);
        await this.registry.save();
      }
    });
    return { moved, root: to, name: path.basename(to) };
  }

  async moveAcrossRepositories({
    sourceRepoId,
    path: from,
    targetRepoId,
    to,
    strategy = "patches",
  } = {}) {
    if (sourceRepoId === targetRepoId)
      throw Error("Choose two different repositories (use a move inside one repository instead)");
    const source = await this.registry.get(sourceRepoId),
      target = await this.registry.get(targetRepoId);
    for (const root of [source.root, target.root]) {
      await requireCommitted(root);
      await this.guard(root);
      await requireClean(root);
    }
    const rel = cleanRelative(from, "source"),
      dest = cleanRelative(to || from, "destination");
    const stat = await fs.lstat(path.join(source.root, rel)).catch(() => null);
    if (!stat) throw Error(`${rel} does not exist in ${source.name}`);
    if (!(await git(source.root, ["ls-files", "--", rel])).trim())
      throw Error(`${rel} is not tracked by git`);
    if (await exists(path.join(target.root, dest)))
      throw Error(`${dest} already exists in ${target.name}`);
    if (strategy === "subtree") {
      if (!stat.isDirectory())
        throw Error("The subtree strategy moves folders; use patches for a file");
      const branch = `verynize-move-${crypto.randomBytes(4).toString("hex")}`;
      await git(source.root, ["subtree", "split", `--prefix=${rel}`, "-b", branch], {
        timeout: 600000,
      });
      try {
        let identity = {};
        try {
          await git(target.root, ["config", "user.email"]);
        } catch {
          identity = IDENTITY;
        }
        await exec(
          "git",
          [
            "-C",
            target.root,
            "subtree",
            "add",
            `--prefix=${dest}`,
            source.root,
            branch,
            "-m",
            `Move ${rel} from ${source.name}`,
          ],
          { env: { ...gitEnv(), ...identity }, timeout: 600000, maxBuffer: 64 * 1024 * 1024 },
        ).catch((error) => {
          throw Error(
            String(error.stderr || error.message)
              .trim()
              .split("\n")[0],
          );
        });
      } finally {
        await git(source.root, ["branch", "-D", branch]).catch(() => {});
      }
    } else if (strategy === "patches") {
      const patches = await git(
        source.root,
        [
          "format-patch",
          "--root",
          "--stdout",
          "--full-index",
          "--binary",
          "--no-renames",
          "HEAD",
          "--",
          rel,
        ],
        { timeout: 600000 },
      );
      const staging = `.verynize-move-${crypto.randomBytes(3).toString("hex")}`;
      if (patches.trim()) {
        let identity = {};
        try {
          await git(target.root, ["config", "user.email"]);
        } catch {
          identity = IDENTITY;
        }
        try {
          await new Promise((resolve, reject) => {
            const child = require("node:child_process").spawn(
              "git",
              ["-C", target.root, "am", "--quiet", "--keep-non-patch", `--directory=${staging}`],
              { env: { ...gitEnv(), ...identity }, stdio: ["pipe", "ignore", "pipe"] },
            );
            let stderr = "";
            child.stderr.on("data", (d) => {
              stderr += d;
            });
            child.on("error", reject);
            child.on("close", (code) =>
              code === 0
                ? resolve()
                : reject(Error(stderr.trim().split("\n")[0] || "git am failed")),
            );
            child.stdin.end(patches);
          });
        } catch (error) {
          await git(target.root, ["am", "--abort"]).catch(() => {});
          throw Error(`Could not replay the history: ${error.message}`);
        }
      }
      const staged = path.join(target.root, staging, rel);
      // Content equality: if merges hid changes from format-patch, copy the source state and commit it.
      await fs.mkdir(path.dirname(staged), { recursive: true });
      const want = (await git(source.root, ["rev-parse", `HEAD:${rel}`])).trim();
      const have = await git(target.root, ["rev-parse", `HEAD:${staging}/${rel}`])
        .then((s) => s.trim())
        .catch(() => "");
      if (want !== have) {
        await fs.rm(staged, { recursive: true, force: true });
        await fs.cp(path.join(source.root, rel), staged, { recursive: true });
        await git(target.root, ["add", "-A", "--", staging]);
        await commit(target.root, `Sync ${rel} with ${source.name}`);
      }
      await fs.mkdir(path.dirname(path.join(target.root, dest)), { recursive: true });
      await git(target.root, ["mv", "--", `${staging}/${rel}`, dest]);
      await fs.rm(path.join(target.root, staging), { recursive: true, force: true });
      await commit(target.root, `Move ${rel} from ${source.name} to ${dest}`);
    } else throw Error("Choose patches or subtree");
    await git(source.root, ["rm", "-r", "-q", "--", rel]);
    await commit(source.root, `Move ${rel} to ${target.name}/${dest}`);
    const moved = await this.rebase(path.join(source.root, rel), path.join(target.root, dest));
    return {
      moved,
      strategy,
      source: { root: source.root, commit: (await git(source.root, ["rev-parse", "HEAD"])).trim() },
      target: {
        root: target.root,
        path: dest,
        commit: (await git(target.root, ["rev-parse", "HEAD"])).trim(),
      },
    };
  }
}

function registerRepositoryMoves(handle, { registry, busy, dialog, win } = {}) {
  const moves = new RepositoryMoves({ registry, busy });
  handle("repositoryMoveInside", (options) => moves.moveInRepository(options || {}));
  handle("repositoryRelocate", (options) => moves.relocateRepository(options || {}));
  handle("repositoryMoveAcross", (options) => moves.moveAcrossRepositories(options || {}));
  handle("repositoryChooseDestination", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "Choose the new parent folder",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  return moves;
}

module.exports = { RepositoryMoves, registerRepositoryMoves, cleanRelative };
