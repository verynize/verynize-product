// Version history of a native design file, kept in a sidecar directory next to it so the document
// stays small and its 20 MiB limit is unaffected (docs/version-history.md):
//
//   NAME.verynize.json             the document (integrations/design-store.mjs)
//   NAME.verynize.history/
//     index.json                   {format: 1, last: {[artboardId]: {author, at, hash}}, versions: [meta]}
//     <versionId>.json             one snapshot {artboardId, pageId, index, name, nodes}
//     .gitignore                   `*`, written when the folder is created (history stays out of git)
//
// The capture rules, pruning and restore are web/version-history-core.js (integrations/version-core.mjs).
// Writers (the desktop main process for edits made in the app, the stdio MCP server for headless agent
// edits) serialize through an exclusive `index.json.lock`, like DesignStore.mutate.
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as versions from "./version-core.mjs";

const SUFFIX = ".verynize.json";
const SNAPSHOT_BYTES = 20 * 1024 * 1024;
const FORMAT = 1;
const VERSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const GITIGNORE = "# Verynize version history stays local; delete this file to commit it.\n*\n";

/** The sidecar directory of a `.verynize.json` file. */
export function historyDir(file) {
  if (typeof file !== "string" || !file.endsWith(SUFFIX))
    throw new Error("Version history needs a .verynize.json file");
  return file.slice(0, -".json".length) + ".history";
}

const emptyIndex = () => ({ format: FORMAT, last: {}, versions: [] });

export class VersionSidecar {
  constructor(file, { idleMs = versions.IDLE_MS, max = versions.MAX_VERSIONS } = {}) {
    this.file = file;
    this.dir = historyDir(file);
    this.idleMs = idleMs;
    this.max = max;
  }

  async index() {
    try {
      const data = JSON.parse(await fs.readFile(path.join(this.dir, "index.json"), "utf8"));
      if (data?.format !== FORMAT || !Array.isArray(data.versions)) return emptyIndex();
      const metas = [];
      for (const meta of data.versions)
        try {
          metas.push(versions.cleanMeta(meta));
        } catch {}
      return {
        format: FORMAT,
        last: data.last && typeof data.last === "object" ? data.last : {},
        versions: metas,
      };
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return emptyIndex();
      throw error;
    }
  }

  /** Versions newest first, of one artboard or of all. */
  async list(artboardId = null) {
    const { versions: metas } = await this.index();
    return metas
      .filter((meta) => !artboardId || meta.artboardId === artboardId)
      .sort((a, b) => b.at - a.at);
  }

  /** {meta, snapshot} of one version, or null. */
  async get(id) {
    if (!VERSION_ID.test(id || "")) return null;
    const meta = (await this.index()).versions.find((entry) => entry.id === id);
    if (!meta) return null;
    try {
      const snapshot = versions.checkSnapshot(
        JSON.parse(await fs.readFile(path.join(this.dir, `${id}.json`), "utf8")),
      );
      return { meta, snapshot };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  /** Run `fn(index)` under the sidecar lock and write the index it returns. */
  async mutate(fn) {
    // A new sidecar ignores itself, so it never shows in `git status` next to a design kept in a
    // repository. Written only when the folder is created: deleting it opts into committing history.
    if (await fs.mkdir(this.dir, { recursive: true, mode: 0o700 }))
      await fs
        .writeFile(path.join(this.dir, ".gitignore"), GITIGNORE, { flag: "wx" })
        .catch(() => {});
    const lock = path.join(this.dir, "index.json.lock");
    let handle;
    for (let attempt = 0; !handle; attempt++)
      try {
        handle = await fs.open(lock, "wx", 0o600);
      } catch (error) {
        if (error.code !== "EEXIST" || attempt >= 80) throw new Error("Version history is locked");
        // A lock older than a minute belongs to a writer that died.
        const stat = await fs.stat(lock).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > 60_000) await fs.unlink(lock).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 15 + attempt * 5));
      }
    try {
      const index = await this.index();
      const out = await fn(index);
      const temp = path.join(this.dir, `index.${randomUUID()}.tmp`);
      await fs.writeFile(temp, JSON.stringify(index), { flag: "wx", mode: 0o600 });
      await fs.rename(temp, path.join(this.dir, "index.json"));
      return out;
    } finally {
      await handle.close();
      await fs.unlink(lock).catch(() => {});
    }
  }

  /** Store versions ({meta, snapshot}) and prune; returns the stored metas. */
  async add(entries, { last } = {}) {
    const clean = [];
    for (const item of entries || []) {
      const meta = versions.cleanMeta(item?.meta);
      const snapshot = versions.checkSnapshot(item?.snapshot);
      if (snapshot.artboardId !== meta.artboardId) throw new Error("Version and snapshot disagree");
      const text = JSON.stringify(snapshot);
      if (Buffer.byteLength(text) > SNAPSHOT_BYTES) throw new Error("Version exceeds 20 MiB");
      clean.push({ meta, text });
    }
    return this.mutate(async (index) => {
      for (const { meta, text } of clean) {
        if (index.versions.some((entry) => entry.id === meta.id)) continue;
        await fs.writeFile(path.join(this.dir, `${meta.id}.json`), text, { mode: 0o600 });
        index.versions.push(meta);
      }
      if (last && typeof last === "object") index.last = { ...index.last, ...last };
      await this.prune(index);
      return clean.map((entry) => entry.meta);
    });
  }

  async prune(index) {
    const drop = new Set(versions.prune(index.versions, { max: this.max }));
    if (!drop.size) return;
    index.versions = index.versions.filter((meta) => !drop.has(meta.id));
    for (const id of drop) await fs.unlink(path.join(this.dir, `${id}.json`)).catch(() => {});
  }

  /**
   * Apply the capture rules to an edit of the file (before → after) by `author`, store what they
   * capture (also artboards idle since their last edit) and remember who edited what.
   * `force` ("restore" or "finish") applies to `artboardId` only.
   */
  async observe(before, after, author, { at = Date.now(), force, artboardId, label } = {}) {
    return this.mutate(async (index) => {
      const state = versions.seed({ last: { ...index.last }, latest: {} }, index.versions);
      const captured = versions.idle(state, at, (id) => versions.snapshot(before, id), {
        idleMs: this.idleMs,
      });
      const edits = versions.changes(before, after);
      if (force && artboardId && !edits.some((edit) => edit.artboardId === artboardId))
        edits.push({
          artboardId,
          before: versions.snapshot(before, artboardId),
          after: versions.snapshot(after, artboardId),
        });
      for (const edit of edits)
        captured.push(
          ...versions.observe(
            state,
            { ...edit, author, at, ...(edit.artboardId === artboardId ? { force, label } : {}) },
            { idleMs: this.idleMs },
          ),
        );
      for (const { meta, snapshot } of captured) {
        await fs.writeFile(path.join(this.dir, `${meta.id}.json`), JSON.stringify(snapshot), {
          mode: 0o600,
        });
        index.versions.push(meta);
      }
      index.last = state.last;
      await this.prune(index);
      return captured.map((entry) => entry.meta);
    });
  }

  /** The `last` editor map (who edited each artboard last, and when). */
  async last() {
    return (await this.index()).last;
  }
}

/** The sidecar of a `.verynize.json` path (no file system access until used). */
export const sidecarFor = (file, options) => new VersionSidecar(file, options);
