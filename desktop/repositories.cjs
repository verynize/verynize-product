/**
 * Repositories and per-chat worktrees (desktop main process)
 * ===========================================================
 * The Code workspace keeps several repositories open at once. Each repository chat works in its own
 * git worktree under `<workspaces>/<repo>/<slug>` on branch `<prefix>/<slug>` (cut from the repository
 * HEAD), so parallel chats never edit the same checkout. A folder that is not a committed git
 * repository (or is a subfolder of one) has no worktrees: its chats work in the folder itself.
 *
 *   new RepositoryRegistry({file, workspacesRoot, branchPrefix})
 *     workspacesRoot: a path or a function returning one (Settings › Agents "Verynize folder"/workspaces);
 *     branchPrefix: async function returning the branch prefix (default "verynize"); both are read per new worktree
 *     list()                          -> [{id,name,root,addedAt,git}]   (archived ones hidden)
 *     add(root)                       -> repository (re-adding an archived root restores it)
 *     archive(id)                     -> true            (files and worktrees stay on disk)
 *     createChatWorktree(repoId, chatId) -> {path, branch, shared}
 *     removeChatWorktree(repoId, chatId, {force}) -> true
 *     resolveRoot(candidate)          -> {root, repository, worktree|null}   only registered roots and
 *                                        worktrees recorded here are accepted (compared after realpath)
 *   registerRepositories(handle, win, {registry, getProject, setProject, Project, projectsRoot})
 *     projectsRoot: async function returning the folder new projects are created in (no parent folder dialog)
 *
 * The registry is a JSON file in userData. Git runs as `execFile` argument arrays (no shell) with a timeout
 * and GIT_TERMINAL_PROMPT=0, like projects.cjs and git-changes.cjs.
 */
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);

const ID = /^[a-zA-Z0-9-]{1,80}$/;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,60}$/;
const GITHUB = /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/;
// Worktree names: short, readable, unrelated to the chat content.
const WORDS = [
  "heron",
  "finch",
  "wren",
  "plover",
  "kestrel",
  "linnet",
  "tern",
  "robin",
  "swift",
  "lark",
  "egret",
  "ibis",
  "merlin",
  "osprey",
  "pipit",
  "siskin",
  "teal",
  "vireo",
  "warbler",
  "junco",
  "oriole",
  "tanager",
  "shrike",
  "avocet",
  "dunlin",
  "gannet",
  "puffin",
  "sparrow",
  "starling",
  "thrush",
];

const defaultWorkspaces = () =>
  process.env.VERYNIZE_WORKSPACES_DIR || path.join(os.homedir(), "Verynize", "workspaces");
const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" });
const git = (cwd, args, timeout = 30000) =>
  exec("git", ["-C", cwd, ...args], { timeout, maxBuffer: 2 * 1024 * 1024, env: gitEnv() }).then(
    (r) => r.stdout,
  );
const slugify = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "repo";
const exists = async (target) => {
  try {
    await fs.lstat(target);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
};

/** Whether `root` is the top level of a git repository with at least one commit. */
async function committedRepository(root) {
  try {
    const top = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
    if (!top || (await fs.realpath(top)) !== root) return false;
    await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

class RepositoryRegistry {
  constructor({ file, workspacesRoot = defaultWorkspaces(), branchPrefix = null } = {}) {
    if (!file) throw Error("Registry file required");
    this.file = file;
    this.workspacesRoot = workspacesRoot;
    this.branchPrefix = branchPrefix;
    this.data = null;
    this.queue = Promise.resolve();
  }
  async workspacesDir() {
    return typeof this.workspacesRoot === "function"
      ? await this.workspacesRoot()
      : this.workspacesRoot;
  }
  async prefix() {
    const value = this.branchPrefix
      ? await Promise.resolve()
          .then(() => this.branchPrefix())
          .catch(() => "")
      : "";
    return typeof value === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) &&
      !value.includes("..")
      ? value.replace(/\/+$/, "")
      : "verynize";
  }
  async load() {
    if (this.data) return this.data;
    let data = { version: 1, repositories: [], worktrees: [] };
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (parsed && Array.isArray(parsed.repositories))
        data = {
          version: 1,
          repositories: parsed.repositories.filter(
            (r) => r && ID.test(r.id) && typeof r.root === "string" && path.isAbsolute(r.root),
          ),
          worktrees: Array.isArray(parsed.worktrees)
            ? parsed.worktrees.filter(
                (w) =>
                  w &&
                  ID.test(w.repoId) &&
                  ID.test(w.chatId) &&
                  typeof w.path === "string" &&
                  path.isAbsolute(w.path),
              )
            : [],
        };
    } catch {}
    this.data = data;
    return data;
  }
  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.data, null, 2) + "\n", { mode: 0o600 });
    await fs.rename(temp, this.file);
  }
  /** Mutations run one at a time. */
  serial(fn) {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }
  view(repo) {
    return { id: repo.id, name: repo.name, root: repo.root, addedAt: repo.addedAt };
  }

  async list() {
    const data = await this.load();
    const live = data.repositories.filter((r) => !r.archived);
    return Promise.all(
      live.map(async (r) => ({ ...this.view(r), git: await committedRepository(r.root) })),
    );
  }
  async get(id) {
    if (typeof id !== "string" || !ID.test(id)) throw Error("Invalid repository");
    const repo = (await this.load()).repositories.find((r) => r.id === id && !r.archived);
    if (!repo) throw Error("That repository is not in the list");
    return repo;
  }
  add(root) {
    return this.serial(async () => {
      if (typeof root !== "string" || !path.isAbsolute(root)) throw Error("Choose a folder");
      const real = await fs.realpath(root);
      if (!(await fs.stat(real)).isDirectory()) throw Error("Choose a folder");
      const data = await this.load();
      let repo = data.repositories.find((r) => r.root === real);
      if (repo) delete repo.archived;
      else {
        repo = {
          id: crypto.randomUUID(),
          name: path.basename(real),
          root: real,
          addedAt: Date.now(),
        };
        data.repositories.push(repo);
      }
      await this.save();
      return this.view(repo);
    });
  }
  archive(id) {
    return this.serial(async () => {
      const repo = await this.get(id);
      repo.archived = true;
      await this.save();
      return true;
    });
  }
  /** Folder under the workspaces root for a repository (its name, made unique among registered repositories). */
  async workspaceDir(repo) {
    const data = await this.load(),
      base = slugify(repo.name);
    const clash = data.repositories.some((r) => r.id !== repo.id && slugify(r.name) === base);
    return path.join(await this.workspacesDir(), clash ? `${base}-${repo.id.slice(0, 6)}` : base);
  }
  createChatWorktree(repoId, chatId) {
    return this.serial(async () => {
      if (typeof chatId !== "string" || !ID.test(chatId)) throw Error("Invalid chat");
      const repo = await this.get(repoId),
        data = await this.load();
      const known = data.worktrees.find((w) => w.repoId === repo.id && w.chatId === chatId);
      if (known && (await exists(known.path)))
        return { path: known.path, branch: known.branch, shared: false };
      if (!(await committedRepository(repo.root)))
        return { path: repo.root, branch: null, shared: true };
      const parent = await this.workspaceDir(repo);
      await fs.mkdir(parent, { recursive: true });
      const prefix = await this.prefix();
      let slug = null;
      for (let attempt = 0; attempt < 40 && !slug; attempt++) {
        const word = WORDS[crypto.randomInt(WORDS.length)],
          candidate = attempt < 10 ? word : `${word}-${crypto.randomBytes(2).toString("hex")}`;
        if (await exists(path.join(parent, candidate))) continue;
        try {
          await git(repo.root, [
            "rev-parse",
            "--verify",
            "--quiet",
            `refs/heads/${prefix}/${candidate}`,
          ]);
          continue;
        } catch {}
        slug = candidate;
      }
      if (!slug) throw Error("Could not find a free worktree name");
      const target = path.join(parent, slug),
        branch = `${prefix}/${slug}`;
      await git(repo.root, ["worktree", "add", "-b", branch, "--", target, "HEAD"], 120000);
      const real = await fs.realpath(target);
      data.worktrees = data.worktrees.filter((w) => !(w.repoId === repo.id && w.chatId === chatId));
      data.worktrees.push({ repoId: repo.id, chatId, path: real, branch, createdAt: Date.now() });
      await this.save();
      return { path: real, branch, shared: false };
    });
  }
  removeChatWorktree(repoId, chatId, { force = false } = {}) {
    return this.serial(async () => {
      const repo = await this.get(repoId),
        data = await this.load();
      const record = data.worktrees.find((w) => w.repoId === repo.id && w.chatId === chatId);
      if (!record) return false;
      if (await exists(record.path)) {
        try {
          await git(repo.root, [
            "worktree",
            "remove",
            ...(force ? ["--force"] : []),
            "--",
            record.path,
          ]);
        } catch (error) {
          throw Error(
            /modified or untracked|contains modified/.test(String(error.stderr || error.message))
              ? "This chat has uncommitted changes in its worktree"
              : String(error.stderr || error.message).trim(),
          );
        }
      } else await git(repo.root, ["worktree", "prune"]).catch(() => {});
      data.worktrees = data.worktrees.filter((w) => w !== record);
      await this.save();
      return true;
    });
  }
  /** Validate a root for the active project / agent cwd: a registered repository root or one of its chat worktrees. */
  async resolveRoot(candidate) {
    if (typeof candidate !== "string" || !path.isAbsolute(candidate) || candidate.includes("\0"))
      throw Error("Invalid project folder");
    let real;
    try {
      real = await fs.realpath(candidate);
    } catch {
      throw Error("That folder no longer exists");
    }
    const data = await this.load();
    const repository = data.repositories.find((r) => !r.archived && r.root === real);
    if (repository) return { root: real, repository: this.view(repository), worktree: null };
    const worktree = data.worktrees.find((w) => w.path === real);
    const owner =
      worktree && data.repositories.find((r) => r.id === worktree.repoId && !r.archived);
    if (owner)
      return {
        root: real,
        repository: this.view(owner),
        worktree: { path: worktree.path, branch: worktree.branch, chatId: worktree.chatId },
      };
    throw Error("That folder is not an open repository or chat worktree");
  }
}

/** New folder (index.html + git init) or a GitHub clone inside `parent`. */
async function createProjectFolder(parent, { name, repository } = {}) {
  if (typeof name !== "string" || !NAME.test(name))
    throw Error("Use a project name with letters, numbers, dashes, or underscores");
  if (repository && (typeof repository !== "string" || !GITHUB.test(repository)))
    throw Error("Use an HTTPS GitHub repository URL");
  const destination = path.join(await fs.realpath(parent), name);
  if (await exists(destination)) throw Error("That folder already exists");
  if (repository)
    await exec("git", ["clone", "--", repository, destination], {
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
      env: gitEnv(),
    });
  else {
    await fs.mkdir(destination);
    await fs.writeFile(
      path.join(destination, "index.html"),
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>New project</title></head><body><h1>Make something yours.</h1></body></html>',
    );
    await exec("git", ["init", destination], { env: gitEnv() });
  }
  return destination;
}

function registerRepositories(
  handle,
  win,
  { registry, dialog, getProject, setProject, Project, projectsRoot = null },
) {
  const active = async () => {
    const project = getProject();
    if (!project) return null;
    try {
      return await registry.resolveRoot(project.root);
    } catch {
      return { root: project.root, repository: null, worktree: null };
    }
  };
  handle("repositoriesList", async () => ({
    repositories: await registry.list(),
    active: await active(),
  }));
  handle("repositoriesAddLocal", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "Open a local folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return registry.add(result.filePaths[0]);
  });
  handle("repositoriesCreate", async (options) => {
    if (!options || typeof options.name !== "string" || !NAME.test(options.name))
      throw Error("Use a project name with letters, numbers, dashes, or underscores");
    if (options.repository && !GITHUB.test(String(options.repository)))
      throw Error("Use an HTTPS GitHub repository URL");
    let parent;
    if (projectsRoot) {
      parent = await projectsRoot();
      await fs.mkdir(parent, { recursive: true });
    } else {
      const chosen = await dialog.showOpenDialog(win, {
        title: "Choose parent folder",
        properties: ["openDirectory", "createDirectory"],
      });
      if (chosen.canceled || !chosen.filePaths[0]) return null;
      parent = chosen.filePaths[0];
    }
    return registry.add(await createProjectFolder(parent, options));
  });
  handle("repositoriesArchive", (id) => registry.archive(id));
  handle("repositoriesCreateChatWorktree", (options) =>
    registry.createChatWorktree(options?.repoId, options?.chatId),
  );
  handle("repositoriesRemoveChatWorktree", (options) =>
    registry.removeChatWorktree(options?.repoId, options?.chatId, {
      force: options?.force === true,
    }),
  );
  // setActiveRoot: the project used by listFiles/readFile/writeFile, git changes, dev server and agent default cwd.
  handle("repositoriesActivate", async (root) => {
    if (root === null) {
      setProject(null);
      return null;
    }
    const resolved = await registry.resolveRoot(root);
    setProject(await Project.open(resolved.root));
    return {
      root: resolved.root,
      name: resolved.repository.name,
      repoId: resolved.repository.id,
      branch: resolved.worktree?.branch || null,
    };
  });
}

module.exports = {
  RepositoryRegistry,
  registerRepositories,
  createProjectFolder,
  committedRepository,
  defaultWorkspaces,
};
