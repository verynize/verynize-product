// Per-artboard version history of a room, in the room's SQLite (cloud/rooms.js). The capture rules,
// pruning and restore are web/version-history-core.js, shared with the desktop and the headless
// engine (docs/version-history.md).
//
// - `history_versions`: one row per version (id, artboard, page, time, size, metadata JSON).
// - `history_parts`: the snapshot JSON in parts of at most 256 Ki UTF-16 units (≤ 1 MiB of UTF-8),
//   because a Durable Object SQLite row holds at most 2 MB.
// - `history_last`: who edited each artboard last, when, and the hash of what they left.
//
// The room observes every applied batch (`observe`); idle artboards are captured by the room's
// alarm (`due`/`idle`). At most MAX_VERSIONS versions per artboard and HISTORY_BYTES per room are
// kept; the oldest versions beyond the budget go first, never an artboard's newest one.
import "../web/component-core.js";
import "../web/version-history-core.js";

const V = globalThis.VerynizeVersions;
const PART_CHARS = 256 * 1024;
/** Snapshot bytes kept per room (a Durable Object holds 10 GB). */
export const HISTORY_BYTES = 1024 * 1024 * 1024;
const VERSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

function chunks(text) {
  const out = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + PART_CHARS);
    const code = text.charCodeAt(end - 1);
    if (end < text.length && code >= 0xd800 && code <= 0xdbff) end--;
    out.push(text.slice(start, end));
    start = end;
  }
  return out;
}
const bytes = (text) => new TextEncoder().encode(text).length;

export class RoomHistory {
  constructor(sql, { idleMs = V.IDLE_MS, max = V.MAX_VERSIONS, budget = HISTORY_BYTES } = {}) {
    this.sql = sql;
    this.idleMs = idleMs;
    this.max = max;
    this.budget = budget;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS history_versions (id TEXT PRIMARY KEY, artboard_id TEXT NOT NULL, page_id TEXT NOT NULL, at INTEGER NOT NULL, bytes INTEGER NOT NULL, meta TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS history_versions_artboard ON history_versions (artboard_id, at);
      CREATE TABLE IF NOT EXISTS history_parts (version_id TEXT NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (version_id, part));
      CREATE TABLE IF NOT EXISTS history_last (artboard_id TEXT PRIMARY KEY, at INTEGER NOT NULL, value TEXT NOT NULL);
    `);
  }

  metas(artboardIds = null) {
    const rows = artboardIds
      ? artboardIds.flatMap((id) =>
          this.sql
            .exec("SELECT meta FROM history_versions WHERE artboard_id=? ORDER BY at DESC", id)
            .toArray(),
        )
      : this.sql.exec("SELECT meta FROM history_versions ORDER BY at DESC").toArray();
    return rows.map((row) => JSON.parse(row.meta));
  }

  /** {last, latest} of the capture rules for some artboards. */
  state(artboardIds) {
    const last = {};
    for (const id of artboardIds) {
      const row = this.sql
        .exec("SELECT value FROM history_last WHERE artboard_id=?", id)
        .toArray()[0];
      if (row) last[id] = JSON.parse(row.value);
    }
    const latest = {};
    for (const id of artboardIds) {
      const row = this.sql
        .exec("SELECT meta FROM history_versions WHERE artboard_id=? ORDER BY at DESC LIMIT 1", id)
        .toArray()[0];
      if (row) {
        const meta = JSON.parse(row.meta);
        latest[id] = { hash: meta.hash, nodes: meta.nodes };
      }
    }
    return { last, latest };
  }

  saveLast(state, artboardIds) {
    for (const id of artboardIds) {
      const last = state.last[id];
      if (last)
        this.sql.exec(
          "INSERT OR REPLACE INTO history_last (artboard_id,at,value) VALUES (?,?,?)",
          id,
          last.at,
          JSON.stringify(last),
        );
      else this.sql.exec("DELETE FROM history_last WHERE artboard_id=?", id);
    }
  }

  store(entries) {
    for (const { meta, snapshot } of entries) {
      const text = JSON.stringify(snapshot);
      this.sql.exec(
        "INSERT OR REPLACE INTO history_versions (id,artboard_id,page_id,at,bytes,meta) VALUES (?,?,?,?,?,?)",
        meta.id,
        meta.artboardId,
        meta.pageId,
        meta.at,
        bytes(text),
        JSON.stringify(meta),
      );
      this.sql.exec("DELETE FROM history_parts WHERE version_id=?", meta.id);
      chunks(text).forEach((data, part) =>
        this.sql.exec(
          "INSERT INTO history_parts (version_id,part,data) VALUES (?,?,?)",
          meta.id,
          part,
          data,
        ),
      );
    }
    if (entries.length) this.prune([...new Set(entries.map((entry) => entry.meta.artboardId))]);
    return entries.map((entry) => entry.meta);
  }

  drop(id) {
    this.sql.exec("DELETE FROM history_versions WHERE id=?", id);
    this.sql.exec("DELETE FROM history_parts WHERE version_id=?", id);
  }

  prune(artboardIds) {
    for (const id of V.prune(this.metas(artboardIds), { max: this.max })) this.drop(id);
    let total = this.sql
      .exec("SELECT COALESCE(SUM(bytes),0) AS total FROM history_versions")
      .one().total;
    if (total <= this.budget) return;
    // Over the room budget: the oldest versions go, but every artboard keeps its newest.
    const rows = this.sql
      .exec(
        "SELECT id,bytes FROM history_versions v WHERE at < (SELECT MAX(at) FROM history_versions w WHERE w.artboard_id=v.artboard_id) ORDER BY at",
      )
      .toArray();
    for (const row of rows) {
      if (total <= this.budget) break;
      this.drop(row.id);
      total -= row.bytes;
    }
  }

  /**
   * Apply the capture rules to one applied batch: `before`/`after` are the room documents around
   * it (only `pages` loaded), `nodes` the node ids it touched (null: compare whole pages).
   * `force` ("restore") applies to `artboardId` only. Returns the stored metas.
   */
  observe(
    before,
    after,
    { pages, nodes = null, author, at = Date.now(), force, artboardId, label },
  ) {
    const edits = V.changes(before, after, { pages, nodes });
    if (force && artboardId && !edits.some((edit) => edit.artboardId === artboardId)) {
      const left = V.snapshot(before, artboardId);
      if (left) edits.push({ artboardId, before: left, after: V.snapshot(after, artboardId) });
    }
    if (!edits.length) return [];
    const ids = edits.map((edit) => edit.artboardId);
    const state = this.state(ids);
    const captured = [];
    for (const edit of edits)
      captured.push(
        ...V.observe(
          state,
          { ...edit, author, at, ...(edit.artboardId === artboardId ? { force, label } : {}) },
          { idleMs: this.idleMs },
        ),
      );
    this.saveLast(state, ids);
    return this.store(captured);
  }

  /** Store the current state of an artboard (finish_artboard, a manual "save version"). */
  capture(doc, artboardId, { author, at = Date.now(), reason = "manual", label } = {}) {
    const snap = V.snapshot(doc, artboardId);
    if (!snap) return [];
    const state = this.state([artboardId]);
    const out = V.observe(
      state,
      {
        artboardId,
        before: snap,
        after: snap,
        author,
        at,
        force: reason === "finish" ? "finish" : "manual",
        label,
      },
      { idleMs: this.idleMs },
    );
    // A capture is not an edit: the artboard's last editor stays as it was.
    return this.store(out);
  }

  /** Artboards idle for idleMs whose last state is not stored yet: [{artboardId, at}]. */
  due(now = Date.now()) {
    return this.sql
      .exec("SELECT artboard_id, at, value FROM history_last ORDER BY at")
      .toArray()
      .filter((row) => {
        const last = JSON.parse(row.value);
        const latest = this.sql
          .exec(
            "SELECT meta FROM history_versions WHERE artboard_id=? ORDER BY at DESC LIMIT 1",
            row.artboard_id,
          )
          .toArray()[0];
        return !latest || JSON.parse(latest.meta).hash !== last.hash;
      })
      .map((row) => ({ artboardId: row.artboard_id, at: row.at, due: row.at + this.idleMs }))
      .filter((row) => row.due <= now || now === Infinity);
  }

  /** The next time an idle capture is due, or null. */
  nextDue() {
    const pending = this.due(Infinity);
    return pending.length ? Math.min(...pending.map((row) => row.due)) : null;
  }

  /** Capture idle artboards; `current(id)` returns the live snapshot (or null when deleted). */
  idle(now, current) {
    const ids = this.due(now).map((row) => row.artboardId);
    if (!ids.length) return [];
    const state = this.state(ids);
    // Settles each artboard (seen state, deleted ones forgotten), so the alarm does not repeat.
    const out = V.idle(state, now, current, { idleMs: this.idleMs });
    this.saveLast(state, ids);
    return this.store(out);
  }

  /** Versions newest first: of one artboard, or a summary per artboard. */
  list(artboardId = null) {
    if (artboardId) return this.metas([artboardId]);
    const byBoard = new Map();
    for (const meta of this.metas()) {
      const entry = byBoard.get(meta.artboardId);
      if (entry) entry.versions++;
      else
        byBoard.set(meta.artboardId, {
          artboardId: meta.artboardId,
          pageId: meta.pageId,
          name: meta.name,
          versions: 1,
          latest: meta,
        });
    }
    return [...byBoard.values()];
  }

  /** {meta, snapshot} of one version, or null. */
  get(id) {
    if (!VERSION_ID.test(id || "")) return null;
    const row = this.sql.exec("SELECT meta FROM history_versions WHERE id=?", id).toArray()[0];
    if (!row) return null;
    const text = this.sql
      .exec("SELECT data FROM history_parts WHERE version_id=? ORDER BY part", id)
      .toArray()
      .map((part) => part.data)
      .join("");
    return { meta: JSON.parse(row.meta), snapshot: JSON.parse(text) };
  }
}
