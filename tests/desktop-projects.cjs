const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Project } = require("../desktop/projects.cjs");
test("project file containment, memory, listing and git worktree", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "better-project-"));
  try {
    const root = path.join(base, "project");
    await fs.mkdir(root);
    const project = await Project.open(root);
    await project.write("example.txt", "hello");
    assert.equal(await project.read("example.txt"), "hello");
    await assert.rejects(project.write("../outside", "bad"));
    await assert.rejects(project.read("/etc/hosts"));
    await assert.rejects(project.write(".git/config", "bad"));
    await fs.writeFile(path.join(base, "outside"), "private");
    await fs.symlink(path.join(base, "outside"), path.join(root, "link"));
    await assert.rejects(project.read("link"));
    await assert.rejects(project.write("link", "bad"));
    assert.equal(await fs.readFile(path.join(base, "outside"), "utf8"), "private");
    assert.deepEqual(
      (await project.list()).map((f) => f.path),
      ["example.txt"],
    );
    assert.equal(await project.memory(), "");
    await project.write("VERYNIZE.md", "Remember");
    assert.equal(await project.memory(), "Remember");
    await project.git(["init"]);
    await project.git(["add", "."]);
    await project.git([
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "Initial",
    ]);
    const result = await project.worktree("design/test");
    assert.equal(await fs.readFile(path.join(result.path, "example.txt"), "utf8"), "hello");
    assert.match(await project.status(), /^## /);
    await assert.rejects(project.worktree("../../bad"));
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
