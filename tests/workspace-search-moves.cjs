// Global project search (ripgrep and the Node walker) and history-preserving workspace moves,
// against real temporary git repositories registered in a real RepositoryRegistry.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { RepositoryRegistry } = require("../desktop/repositories.cjs");
const {
  searchProjects,
  findRipgrep,
  bundledRipgrep,
  gitignoreMatcher,
  listFiles,
} = require("../desktop/project-search.cjs");
const { RepositoryMoves, cleanRelative } = require("../desktop/repository-moves.cjs");

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const git = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, ...args], { env: ENV, encoding: "utf8" });

async function tempDir(t, prefix) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
async function write(root, file, text) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), text);
}
async function repo(parent, name, files, { commits = [] } = {}) {
  const root = path.join(parent, name);
  await fs.mkdir(root);
  git(root, "init", "-q", "-b", "main");
  for (const [file, text] of Object.entries(files)) await write(root, file, text);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "initial");
  for (const [file, text, message] of commits) {
    await write(root, file, text);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", message);
  }
  return root;
}

async function searchFixture(t) {
  const parent = await tempDir(t, "search-");
  const alpha = await repo(parent, "alpha", {
    "src/app.js": 'const greeting = "Hello Orbit";\nexport default greeting;\n',
    "src/util.ts": "export function orbitSpeed() { return 7; }\n",
    ".gitignore": "dist/\n*.log\n",
    "home.verynize.json": JSON.stringify({
      version: 2,
      pages: [
        {
          id: "p1",
          name: "Landing",
          nodes: [
            {
              id: "n1",
              type: "text",
              name: "Hero title",
              text: "Welcome to Orbit studio",
              x: 0,
              y: 0,
              w: 10,
              h: 10,
            },
            { id: "n2", type: "frame", name: "Orbit card", x: 0, y: 0, w: 10, h: 10 },
          ],
        },
      ],
    }),
  });
  await write(alpha, "dist/bundle.js", "orbit in build output\n");
  await write(alpha, "debug.log", "orbit in a log\n");
  await write(alpha, "notes/untracked.md", "Orbit notes not yet committed\n");
  await fs.writeFile(
    path.join(alpha, "image.bin"),
    Buffer.from([0, 1, 2, 0x4f, 0x72, 0x62, 0x69, 0x74]),
  );
  // A folder that is not a git repository still honours its .gitignore.
  const beta = path.join(parent, "beta");
  await write(beta, ".gitignore", "secret/\n");
  await write(beta, "readme.txt", "beta mentions ORBIT once\n");
  await write(beta, "secret/keys.txt", "orbit secret\n");
  await write(beta, "node_modules/pkg/index.js", "orbit dependency\n");
  return {
    parent,
    projects: [
      { id: "a", name: "alpha", root: alpha },
      { id: "b", name: "beta", root: beta },
    ],
    alpha,
    beta,
  };
}

// bundled = @vscode/ripgrep (the default), system = rg on PATH, node = the walker fallback.
const systemRg = (() => {
  for (const dir of [
    ...String(process.env.PATH).split(":"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]) {
    const candidate = path.join(dir, "rg");
    if (dir && require("node:fs").existsSync(candidate) && !/@vscode/.test(candidate))
      return candidate;
  }
  return null;
})();
for (const variant of ["bundled", "system", "node"]) {
  const engine = variant === "node" ? "node" : "ripgrep";
  const run = (input) =>
    searchProjects(
      { ...input, engine: variant === "node" ? "node" : undefined },
      variant === "system" ? { ripgrepPath: systemRg } : {},
    );
  test(
    `project search (${variant}): every project, ignore files respected, design content matched`,
    { skip: variant === "system" && !systemRg ? "no rg on PATH" : false },
    async (t) => {
      const { projects } = await searchFixture(t);
      const result = await run({
        query: "orbit",
        projects,
      });
      assert.equal(result.engine, engine);
      assert.equal(result.ripgrep, variant === "node" ? null : variant);
      const hits = result.results.map((r) => `${r.project}:${r.path}:${r.line}`).sort();
      assert.deepEqual(hits, [
        "alpha:notes/untracked.md:1",
        "alpha:src/app.js:1",
        "alpha:src/util.ts:1",
        "beta:readme.txt:1",
      ]);
      const app = result.results.find((r) => r.path === "src/app.js");
      assert.equal(app.column, 25);
      assert.equal(app.preview, 'const greeting = "Hello Orbit";');
      assert.equal(app.root, projects[0].root);
      assert.deepEqual(
        result.design.map((d) => [d.path, d.nodeId, d.kind]),
        [
          ["home.verynize.json", "n1", "text"],
          ["home.verynize.json", "n2", "layer"],
        ],
      );
      assert.match(result.design[0].match, /Welcome to Orbit studio/);
      // Case sensitivity and regular expressions.
      const exact = await run({
        query: "Orbit",
        caseSensitive: true,
        projects,
        designFiles: false,
      });
      assert.deepEqual(
        exact.results.map((r) => r.path).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
        ["notes/untracked.md", "src/app.js"],
      );
      const re = await run({
        query: "orbit\\w+\\(",
        regex: true,
        projects,
        designFiles: false,
      });
      assert.deepEqual(
        re.results.map((r) => r.path),
        ["src/util.ts"],
      );
      const limited = await run({
        query: "orbit",
        projects,
        limit: 2,
        designFiles: false,
      });
      assert.equal(limited.results.length, 2);
      assert.equal(limited.truncated, true);
    },
  );
}

test("project search: validation, missing folders and the gitignore matcher", async (t) => {
  await assert.rejects(() => searchProjects({ query: " ", projects: [] }), /Enter text/);
  await assert.rejects(() => searchProjects({ query: "(", regex: true, projects: [] }), /invalid/);
  const result = await searchProjects({
    query: "x",
    projects: [{ name: "gone", root: "/definitely/missing/folder" }],
    engine: "node",
  });
  assert.deepEqual(result.errors, [{ project: "gone", error: "Folder is missing" }]);
  const ignore = gitignoreMatcher("build/\n*.log\n!keep.log\n/root-only.txt\ndocs/**/draft.md\n");
  assert.equal(ignore("build", true), true);
  assert.equal(ignore("build", false), false, "dir-only rule does not match a file");
  assert.equal(ignore("a/b/x.log", false), true);
  assert.equal(ignore("keep.log", false), false);
  assert.equal(ignore("root-only.txt", false), true);
  assert.equal(ignore("sub/root-only.txt", false), false);
  assert.equal(ignore("docs/a/b/draft.md", false), true);
  const { beta } = await searchFixture(t);
  assert.deepEqual(
    (await listFiles(beta)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    [".gitignore", "readme.txt"],
  );
  // The bundled @vscode/ripgrep binary is preferred over rg on PATH.
  const preferred = await findRipgrep();
  assert.equal(preferred, await bundledRipgrep());
  assert.match(preferred, /@vscode[\\/]ripgrep-[a-z0-9]+-[a-z0-9]+[\\/]bin[\\/]rg$/);
  assert.notEqual(await findRipgrep({ bundled: false }), preferred);
});

async function movesFixture(t) {
  const parent = await tempDir(t, "moves-");
  const userData = await tempDir(t, "moves-data-");
  const workspaces = path.join(parent, "workspaces");
  const registry = new RepositoryRegistry({
    file: path.join(userData, "repositories.json"),
    workspacesRoot: workspaces,
  });
  const site = await repo(
    parent,
    "site",
    {
      "src/components/button.js": "export const Button = 1;\n",
      "src/index.js": 'import "./components/button.js";\n',
      "packages/ui/package.json": '{"name":"ui"}\n',
    },
    {
      commits: [
        ["src/components/button.js", "export const Button = 2;\n", "button v2"],
        ["src/components/card.js", "export const Card = 1;\n", "add card"],
      ],
    },
  );
  const lib = await repo(parent, "lib", { "README.md": "# lib\n" });
  const siteRepo = await registry.add(site),
    libRepo = await registry.add(lib);
  const nested = await registry.add(path.join(site, "packages/ui"));
  return { parent, registry, site, lib, siteRepo, libRepo, nested, workspaces };
}
const follow = (root, file) =>
  git(root, "log", "--follow", "--format=%s", "--", file).trim().split("\n");

test("move inside a repository: git mv + commit keeps history; nested projects follow", async (t) => {
  const { registry, site, siteRepo, nested } = await movesFixture(t);
  const moves = new RepositoryMoves({ registry });
  assert.throws(() => cleanRelative("../x", "source"), /inside the repository/);
  await assert.rejects(
    () => moves.moveInRepository({ repoId: siteRepo.id, from: "src", to: "src/inner" }),
    /into itself/,
  );
  await assert.rejects(
    () => moves.moveInRepository({ repoId: siteRepo.id, from: "nope", to: "x" }),
    /does not exist/,
  );
  const result = await moves.moveInRepository({
    repoId: siteRepo.id,
    from: "src/components",
    to: "lib/components",
  });
  assert.equal(
    git(site, "log", "-1", "--format=%s").trim(),
    "Move src/components to lib/components",
  );
  assert.deepEqual(follow(site, "lib/components/button.js"), [
    "Move src/components to lib/components",
    "button v2",
    "initial",
  ]);
  assert.equal(git(site, "status", "--porcelain"), "");
  assert.equal(result.moved.length, 0);
  // Moving a folder that is itself a registered project rewrites its root.
  const second = await moves.moveInRepository({
    repoId: siteRepo.id,
    from: "packages",
    to: "modules",
  });
  assert.deepEqual(second.moved, [
    { id: nested.id, from: path.join(site, "packages/ui"), to: path.join(site, "modules/ui") },
  ]);
  assert.equal((await registry.get(nested.id)).root, path.join(site, "modules/ui"));
  // Dirty trees are refused.
  await fs.writeFile(path.join(site, "dirty.txt"), "x");
  await assert.rejects(
    () => moves.moveInRepository({ repoId: siteRepo.id, from: "lib", to: "lib2" }),
    /uncommitted/,
  );
  await fs.rm(path.join(site, "dirty.txt"));
  const busy = new RepositoryMoves({ registry, busy: (root) => root === site });
  await assert.rejects(
    () => busy.moveInRepository({ repoId: siteRepo.id, from: "lib", to: "lib2" }),
    /Stop the agents/,
  );
});

test("relocate a repository: folder renamed, registry, nested projects and chat worktrees repaired", async (t) => {
  const { parent, registry, site, siteRepo, nested } = await movesFixture(t);
  const chat = "11111111-aaaa-bbbb-cccc-222222222222";
  const worktree = await registry.createChatWorktree(siteRepo.id, chat);
  const moves = new RepositoryMoves({ registry });
  const result = await moves.relocateRepository({ repoId: siteRepo.id, name: "marketing-site" });
  const renamed = path.join(parent, "marketing-site");
  assert.equal(result.root, renamed);
  assert.deepEqual(
    result.moved.map((m) => m.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    [siteRepo.id, nested.id].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  await assert.rejects(() => fs.access(site));
  const stored = await registry.get(siteRepo.id);
  assert.equal(stored.root, renamed);
  assert.equal(stored.name, "marketing-site");
  assert.equal((await registry.get(nested.id)).root, path.join(renamed, "packages/ui"));
  // The chat worktree (outside the repository) still works against the moved repository.
  assert.equal(git(worktree.path, "rev-parse", "--abbrev-ref", "HEAD").trim(), worktree.branch);
  assert.match(
    git(renamed, "worktree", "list"),
    new RegExp(worktree.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.equal((await registry.resolveRoot(worktree.path)).repository.root, renamed);
  assert.deepEqual(follow(renamed, "src/components/button.js"), ["button v2", "initial"]);
  await assert.rejects(
    () =>
      moves.relocateRepository({ repoId: siteRepo.id, destination: path.join(renamed, "inside") }),
    /into itself/,
  );
  const elsewhere = path.join(parent, "archive");
  await fs.mkdir(elsewhere);
  const again = await moves.relocateRepository({
    repoId: siteRepo.id,
    destination: path.join(elsewhere, "site"),
  });
  assert.equal(again.root, path.join(elsewhere, "site"));
  assert.equal(
    (await registry.resolveRoot(worktree.path)).repository.root,
    path.join(elsewhere, "site"),
  );
});

for (const strategy of ["patches", "subtree"]) {
  test(`move across repositories (${strategy}): the folder arrives with its commits and leaves the source`, async (t) => {
    const { registry, site, lib, siteRepo, libRepo } = await movesFixture(t);
    const moves = new RepositoryMoves({ registry });
    const result = await moves.moveAcrossRepositories({
      sourceRepoId: siteRepo.id,
      path: "src/components",
      targetRepoId: libRepo.id,
      to: "components",
      strategy,
    });
    assert.equal(result.strategy, strategy);
    assert.equal(
      await fs.readFile(path.join(lib, "components/button.js"), "utf8"),
      "export const Button = 2;\n",
    );
    assert.equal(
      await fs.readFile(path.join(lib, "components/card.js"), "utf8"),
      "export const Card = 1;\n",
    );
    // patches: the file's own log follows it through the rename; subtree: the split commits are merged into the graph.
    const history =
      strategy === "patches"
        ? follow(lib, "components/button.js")
        : git(lib, "log", "--format=%s").trim().split("\n");
    assert.ok(
      history.includes("button v2") && history.includes("initial"),
      "the source commits are in the target history: " + history.join(" | "),
    );
    if (strategy === "subtree")
      assert.equal(
        git(lib, "show", "HEAD~0^2:button.js"),
        "export const Button = 2;\n",
        "the merged parent is the split folder history",
      );
    assert.ok(git(lib, "log", "--format=%s").includes("add card"));
    await assert.rejects(() => fs.access(path.join(site, "src/components")));
    assert.equal(
      git(site, "log", "-1", "--format=%s").trim(),
      "Move src/components to lib/components",
    );
    assert.equal(git(site, "status", "--porcelain"), "");
    assert.equal(git(lib, "status", "--porcelain"), "");
    assert.equal(git(lib, "branch", "--list", "verynize-move-*").trim(), "");
    assert.equal(git(site, "branch", "--list", "verynize-move-*").trim(), "");
  });
}

test("move across repositories: a single file with patches; refusals", async (t) => {
  const { registry, lib, siteRepo, libRepo } = await movesFixture(t);
  const moves = new RepositoryMoves({ registry });
  await assert.rejects(
    () =>
      moves.moveAcrossRepositories({
        sourceRepoId: siteRepo.id,
        path: "src/index.js",
        targetRepoId: siteRepo.id,
      }),
    /two different/,
  );
  await assert.rejects(
    () =>
      moves.moveAcrossRepositories({
        sourceRepoId: siteRepo.id,
        path: "src/index.js",
        targetRepoId: libRepo.id,
        strategy: "subtree",
      }),
    /folders/,
  );
  await assert.rejects(
    () =>
      moves.moveAcrossRepositories({
        sourceRepoId: siteRepo.id,
        path: "src/index.js",
        targetRepoId: libRepo.id,
        to: "README.md",
      }),
    /already exists/,
  );
  await moves.moveAcrossRepositories({
    sourceRepoId: siteRepo.id,
    path: "src/components/button.js",
    targetRepoId: libRepo.id,
    to: "ui/button.js",
  });
  assert.equal(
    await fs.readFile(path.join(lib, "ui/button.js"), "utf8"),
    "export const Button = 2;\n",
  );
  assert.deepEqual(follow(lib, "ui/button.js"), [
    "Move src/components/button.js from site to ui/button.js",
    "button v2",
    "initial",
  ]);
});
