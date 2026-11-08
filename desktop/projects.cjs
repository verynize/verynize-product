const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);
class Project {
  constructor(root) {
    this.root = root;
  }
  static async open(root) {
    const real = await fs.realpath(root);
    if (!(await fs.stat(real)).isDirectory()) throw Error("Choose a folder");
    return new Project(real);
  }
  async resolve(relative, create = false) {
    if (
      typeof relative !== "string" ||
      !relative ||
      relative.includes("\0") ||
      path.isAbsolute(relative)
    )
      throw Error("Invalid relative path");
    const parts = relative.split(/[\\/]/);
    if (parts.some((p) => !p || p === ".." || p === "." || p === ".git"))
      throw Error("Path is outside the editable project");
    let target = this.root;
    for (let i = 0; i < parts.length; i++) {
      target = path.join(target, parts[i]);
      try {
        const stat = await fs.lstat(target);
        if (stat.isSymbolicLink()) throw Error("Symbolic links cannot be edited");
      } catch (e) {
        if (e.code !== "ENOENT" || !create || i !== parts.length - 1) throw e;
      }
    }
    return target;
  }
  async read(relative) {
    const target = await this.resolve(relative);
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024)
      throw Error("Only text files under 2 MB can be opened");
    const data = await fs.readFile(target);
    if (data.includes(0)) throw Error("Binary files are not editable");
    return data.toString("utf8");
  }
  async write(relative, content) {
    if (typeof content !== "string" || Buffer.byteLength(content) > 2 * 1024 * 1024)
      throw Error("Text must be under 2 MB");
    const target = await this.resolve(relative, true);
    await fs.writeFile(target, content, { flag: "w" });
    return true;
  }
  async list() {
    const result = [];
    const walk = async (dir, depth) => {
      if (depth > 8 || result.length >= 2000) return;
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (
          entry.isSymbolicLink() ||
          [".git", "node_modules", ".cloudflare", "dist", ".next"].includes(entry.name)
        )
          continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (entry.isFile()) {
          const stat = await fs.stat(full);
          result.push({ path: path.relative(this.root, full), size: stat.size });
        }
        if (result.length >= 2000) break;
      }
    };
    await walk(this.root, 0);
    return result;
  }
  async git(args) {
    const { stdout } = await exec("git", ["-C", this.root, ...args], {
      maxBuffer: 2 * 1024 * 1024,
      timeout: 30000,
    });
    return stdout;
  }
  async status() {
    return this.git(["status", "--short", "--branch"]);
  }
  // `parent`: folder for the new worktree (Settings › Agents "Verynize folder"/workspaces/<repo>); default: next to the project.
  async worktree(branch, { parent } = {}) {
    if (typeof branch !== "string" || !/^design\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,70}$/.test(branch))
      throw Error("Use a branch such as design/my-idea");
    await this.git(["rev-parse", "--verify", "HEAD"]);
    if (parent !== undefined && (typeof parent !== "string" || !path.isAbsolute(parent)))
      throw Error("Invalid worktree folder");
    if (parent) await fs.mkdir(parent, { recursive: true });
    const target = parent
      ? path.join(parent, branch.replace("/", "-"))
      : path.join(
          path.dirname(this.root),
          path.basename(this.root) + "-" + branch.replace("/", "-"),
        );
    await this.git(["worktree", "add", "-b", branch, target]);
    return { path: target, branch };
  }
  async memory() {
    try {
      return await this.read("VERYNIZE.md");
    } catch (e) {
      if (e.code === "ENOENT") return "";
      throw e;
    }
  }
}
module.exports = { Project };
