// desktop/repositories.cjs against real temporary git repositories: registry persistence, archive/restore,
// per-chat worktrees (path, branch, cut from HEAD), non-git folders, root validation and removal.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { RepositoryRegistry, createProjectFolder } = require("../desktop/repositories.cjs");

const identity = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...identity },
  }).trim();

async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "repositories-")));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const repo = path.join(base, "site"),
    plain = path.join(base, "notes"),
    fresh = path.join(base, "fresh");
  await fs.mkdir(repo);
  await fs.mkdir(plain);
  await fs.mkdir(fresh);
  git(repo, "init", "--initial-branch=main");
  await fs.writeFile(path.join(repo, "index.html"), "<h1>Hi</h1>\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "Initial");
  git(fresh, "init", "--initial-branch=main");
  await fs.writeFile(path.join(plain, "todo.txt"), "x");
  const file = path.join(base, "userData", "repositories.json"),
    workspacesRoot = path.join(base, "workspaces");
  return {
    base,
    repo,
    plain,
    fresh,
    file,
    workspacesRoot,
    registry: new RepositoryRegistry({ file, workspacesRoot }),
  };
}

test("registry adds, lists, persists, archives and restores repositories", async (t) => {
  const { repo, plain, file, workspacesRoot, registry } = await fixture(t);
  const a = await registry.add(repo),
    b = await registry.add(plain);
  assert.equal(a.name, "site");
  assert.equal(a.root, repo);
  assert.equal(
    (await registry.add(repo)).id,
    a.id,
    "adding the same root twice returns the same repository",
  );
  const listed = await registry.list();
  assert.deepEqual(
    listed.map((r) => [r.name, r.git]),
    [
      ["site", true],
      ["notes", false],
    ],
  );
  // A second registry instance reads the persisted file.
  const reopened = new RepositoryRegistry({ file, workspacesRoot });
  assert.equal((await reopened.list()).length, 2);
  await reopened.archive(b.id);
  assert.deepEqual(
    (await reopened.list()).map((r) => r.name),
    ["site"],
  );
  await assert.rejects(reopened.resolveRoot(plain), /not an open repository/);
  assert.equal((await reopened.add(plain)).id, b.id, "re-adding an archived root restores it");
  await assert.rejects(registry.add(path.join(repo, "index.html")), /Choose a folder/);
  await assert.rejects(registry.add("relative/path"), /Choose a folder/);
});

test("each chat gets its own worktree on a verynize/ branch cut from HEAD", async (t) => {
  const { repo, workspacesRoot, registry } = await fixture(t);
  const r = await registry.add(repo);
  const head = git(repo, "rev-parse", "HEAD");
  const one = await registry.createChatWorktree(r.id, "chat-one");
  const two = await registry.createChatWorktree(r.id, "chat-two");
  assert.equal(one.shared, false);
  assert.notEqual(one.path, two.path);
  assert.equal(path.dirname(one.path), path.join(await fs.realpath(workspacesRoot), "site"));
  assert.match(one.branch, /^verynize\/[a-z]+(-[0-9a-f]{4})?$/);
  assert.equal(one.branch, "verynize/" + path.basename(one.path));
  assert.equal(git(one.path, "rev-parse", "--abbrev-ref", "HEAD"), one.branch);
  assert.equal(git(one.path, "rev-parse", "HEAD"), head);
  assert.equal(await fs.readFile(path.join(one.path, "index.html"), "utf8"), "<h1>Hi</h1>\n");
  assert.ok(git(repo, "worktree", "list").includes(one.path));
  // Idempotent per chat.
  assert.deepEqual(await registry.createChatWorktree(r.id, "chat-one"), one);
  // Only registered roots and recorded worktrees are valid project roots.
  assert.equal((await registry.resolveRoot(one.path)).worktree.branch, one.branch);
  assert.equal((await registry.resolveRoot(repo)).repository.id, r.id);
  await assert.rejects(registry.resolveRoot(path.dirname(repo)), /not an open repository/);
  await assert.rejects(
    registry.resolveRoot(path.join(one.path, "..", "..")),
    /not an open repository/,
  );
  await assert.rejects(registry.resolveRoot("relative"), /Invalid/);
  await assert.rejects(registry.createChatWorktree(r.id, "../escape"), /Invalid chat/);
  await assert.rejects(registry.createChatWorktree("missing", "chat-x"), /not in the list/);

  // Removal refuses uncommitted work unless forced; the branch is kept.
  await fs.writeFile(path.join(one.path, "new.txt"), "work");
  await assert.rejects(registry.removeChatWorktree(r.id, "chat-one"), /uncommitted/);
  assert.equal(await registry.removeChatWorktree(r.id, "chat-one", { force: true }), true);
  await assert.rejects(fs.access(one.path));
  await assert.rejects(registry.resolveRoot(two.path).then(() => registry.resolveRoot(one.path)));
  assert.ok(git(repo, "branch", "--list", one.branch).includes(one.branch));
  assert.equal(await registry.removeChatWorktree(r.id, "chat-two"), true);
});

test("folders without a commit share their root", async (t) => {
  const { plain, fresh, registry } = await fixture(t);
  const p = await registry.add(plain),
    f = await registry.add(fresh);
  assert.deepEqual(await registry.createChatWorktree(p.id, "chat-a"), {
    path: plain,
    branch: null,
    shared: true,
  });
  assert.deepEqual(await registry.createChatWorktree(f.id, "chat-b"), {
    path: fresh,
    branch: null,
    shared: true,
  });
});

test("repositories with the same name get distinct workspace folders", async (t) => {
  const { base, repo, registry } = await fixture(t);
  const other = path.join(base, "other", "site");
  await fs.mkdir(other, { recursive: true });
  git(other, "init", "--initial-branch=main");
  await fs.writeFile(path.join(other, "a.txt"), "a");
  git(other, "add", ".");
  git(other, "commit", "-m", "a");
  const a = await registry.add(repo),
    b = await registry.add(other);
  const wa = await registry.createChatWorktree(a.id, "c1"),
    wb = await registry.createChatWorktree(b.id, "c2");
  assert.notEqual(path.dirname(wa.path), path.dirname(wb.path));
});

test("createProjectFolder makes a git project and refuses bad names or existing folders", async (t) => {
  const { base } = await fixture(t);
  const made = await createProjectFolder(base, { name: "my-app" });
  assert.equal(made, path.join(base, "my-app"));
  assert.match(await fs.readFile(path.join(made, "index.html"), "utf8"), /Make something yours/);
  await fs.access(path.join(made, ".git"));
  await assert.rejects(createProjectFolder(base, { name: "my-app" }), /already exists/);
  await assert.rejects(createProjectFolder(base, { name: "../x" }), /project name/);
  await assert.rejects(
    createProjectFolder(base, { name: "ok", repository: "file:///etc" }),
    /GitHub/,
  );
});
