/**
 * Chat composer "+" menu helpers (desktop main process)
 * =====================================================
 * Design reference collections and copying files into a chat's worktree.
 *
 *   registerChatAttachments(handle, win, {userData, dialog, resolveRoot})
 *     resolveRoot(root) -> {root}   throws unless `root` is a registered repository root or chat worktree
 *
 * IPC (all through main.cjs `handle()`):
 *   designReferencesList()                    -> [{id, name, count, createdAt}]   newest first
 *   designReferencesSave({name, images})       -> {id, name, count, createdAt}
 *       images: absolute paths of images already attached to a chat (must live under userData/agent-attachments);
 *       they are copied to userData/design-references/<id>/ and listed in userData/design-references.json.
 *   designReferencesAttach({id, chatId})       -> [{path, name}]   copies the collection's images into
 *       userData/agent-attachments/<chatId>/ so they can be sent like any other attached image
 *   designReferencesRemove(id)                 -> true
 *   worktreeAddFiles({root, folder})           -> {added: [names]} | null (cancelled)
 *       native picker (files, or one folder), then copies the selection into `root` (never overwriting: "name 2.ext");
 *       folders are copied without .git and node_modules.
 *   pickWorkingDirectory()                     -> absolute folder path | null   (composer /add-dir)
 */
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const CHAT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{5,79}$/;
const REF_ID = /^[a-f0-9-]{36}$/;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const MAX_IMAGES = 10;
const MAX_COLLECTIONS = 200;

const inside = (parent, child) =>
  child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
const cleanName = (value, limit = 80) =>
  String(value ?? "")
    // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

class ReferenceStore {
  constructor(userData) {
    this.file = path.join(userData, "design-references.json");
    this.dir = path.join(userData, "design-references");
    this.attachments = path.join(userData, "agent-attachments");
    this.queue = Promise.resolve();
  }
  serial(fn) {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.file, "utf8"));
      return Array.isArray(data?.collections)
        ? data.collections.filter((c) => c && REF_ID.test(c.id) && Array.isArray(c.images))
        : [];
    } catch {
      return [];
    }
  }
  async write(collections) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + "." + process.pid + ".tmp";
    await fs.writeFile(tmp, JSON.stringify({ version: 1, collections }, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }
  view(c) {
    return { id: c.id, name: c.name, count: c.images.length, createdAt: c.createdAt };
  }
  async list() {
    return (await this.load()).map((c) => this.view(c)).sort((a, b) => b.createdAt - a.createdAt);
  }

  save({ name, images } = {}) {
    return this.serial(async () => {
      const title = cleanName(name);
      if (!title) throw Error("Name the collection");
      if (!Array.isArray(images) || !images.length)
        throw Error("Attach images to save them as a collection");
      const root = await fs.realpath(this.attachments).catch(() => null);
      if (!root) throw Error("Attach images to save them as a collection");
      const sources = [];
      for (const file of images.slice(0, MAX_IMAGES)) {
        if (typeof file !== "string" || !path.isAbsolute(file)) continue;
        const real = await fs.realpath(file).catch(() => null);
        if (real && inside(root, real) && IMAGE_EXT.test(real)) sources.push(real);
      }
      if (!sources.length) throw Error("Only attached images can be saved as a collection");
      const collections = await this.load();
      if (collections.length >= MAX_COLLECTIONS)
        throw Error("Remove a design reference collection first");
      const id = crypto.randomUUID(),
        folder = path.join(this.dir, id);
      await fs.mkdir(folder, { recursive: true });
      const stored = [];
      for (const [i, source] of sources.entries()) {
        const file = `${String(i + 1).padStart(2, "0")}${path.extname(source).toLowerCase()}`;
        await fs.copyFile(source, path.join(folder, file));
        stored.push(file);
      }
      const entry = { id, name: title, images: stored, createdAt: Date.now() };
      collections.push(entry);
      await this.write(collections);
      return this.view(entry);
    });
  }

  async attach({ id, chatId } = {}) {
    if (typeof chatId !== "string" || !CHAT_ID.test(chatId)) throw Error("Invalid chat");
    if (typeof id !== "string" || !REF_ID.test(id)) throw Error("Unknown collection");
    const entry = (await this.load()).find((c) => c.id === id);
    if (!entry) throw Error("That collection no longer exists");
    const target = path.join(this.attachments, chatId);
    await fs.mkdir(target, { recursive: true });
    const out = [];
    for (const [i, file] of entry.images.entries()) {
      if (path.basename(file) !== file || !IMAGE_EXT.test(file)) continue;
      const dest = path.join(target, `${crypto.randomUUID()}${path.extname(file).toLowerCase()}`);
      try {
        await fs.copyFile(path.join(this.dir, id, file), dest);
      } catch {
        continue;
      }
      out.push({ path: dest, name: `${entry.name} ${i + 1}` });
    }
    if (!out.length) throw Error("That collection has no images left");
    return out;
  }

  remove(id) {
    return this.serial(async () => {
      if (typeof id !== "string" || !REF_ID.test(id)) throw Error("Unknown collection");
      const collections = await this.load();
      await this.write(collections.filter((c) => c.id !== id));
      await fs.rm(path.join(this.dir, id), { recursive: true, force: true });
      return true;
    });
  }
}

async function freeName(dir, name) {
  const ext = path.extname(name),
    stem = ext ? name.slice(0, -ext.length) : name;
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? name : `${stem} ${n}${ext}`;
    try {
      await fs.lstat(path.join(dir, candidate));
    } catch {
      return candidate;
    }
  }
  throw Error("Could not find a free file name");
}

/** Copies `sources` (files or one folder) into `root`; returns the names created. */
async function copyInto(root, sources) {
  const added = [];
  for (const source of sources) {
    const stat = await fs.stat(source);
    const name = await freeName(root, path.basename(source));
    const dest = path.join(root, name);
    if (stat.isDirectory()) {
      if (inside(source, root) || source === root) throw Error("Cannot copy a folder into itself");
      await fs.cp(source, dest, {
        recursive: true,
        errorOnExist: true,
        force: false,
        filter: (src) => !/(^|[\\/])(\.git|node_modules)$/.test(src),
      });
    } else if (stat.isFile()) await fs.copyFile(source, dest, fs.constants.COPYFILE_EXCL);
    else continue;
    added.push(name);
  }
  return added;
}

function registerChatAttachments(handle, win, { userData, dialog, resolveRoot }) {
  const store = new ReferenceStore(userData);
  handle("designReferencesList", () => store.list());
  handle("designReferencesSave", (options) => store.save(options));
  handle("designReferencesAttach", (options) => store.attach(options));
  handle("designReferencesRemove", (id) => store.remove(id));
  handle("worktreeAddFiles", async (options = {}) => {
    const { root } = await resolveRoot(options?.root);
    const folder = options?.folder === true;
    const result = await dialog.showOpenDialog(win, {
      title: folder ? "Add a folder to this worktree" : "Add files to this worktree",
      buttonLabel: "Add",
      properties: folder ? ["openDirectory"] : ["openFile", "multiSelections"],
    });
    if (result.canceled || !result.filePaths?.length) return null;
    return { added: await copyInto(root, result.filePaths.slice(0, 50)) };
  });
  handle("pickWorkingDirectory", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "Add a working directory to this chat",
      buttonLabel: "Add",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths?.length) return null;
    return fs.realpath(result.filePaths[0]);
  });
  return store;
}

module.exports = { registerChatAttachments, ReferenceStore, copyInto };
