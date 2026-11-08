// Actor storage on Vercel. The actor classes (cloud/rooms.js, accounts.js, apps.js) keep calling a
// synchronous `ctx.storage.sql`, so each instance runs them against a local in-memory SQLite copy
// of the actor (ActorCache) and mirrors it, row by row, into the shared libSQL database
// (ActorStore). Contract and design: docs/deployment-vercel.md.
//
// Shared tables (libSQL):
// - actor_heads(actor, fence, seq, schema_seq, purged_seq, schema): one row per actor. `seq`
//   counts commits; `fence` is the newest lease (Redis fencing token) that claimed the actor;
//   `schema` is the actor's CREATE statements.
// - actor_rows(actor, tbl, pk, seq, data): every row of every actor table as JSON, stamped with the
//   commit that last wrote it; `data` NULL is a deletion (tombstone), purged after a while.
//
// A turn (one event of one actor, under its Redis lease) starts with claim(): one write batch that
// records the lease's fence (only a newer fence wins) and returns the rows changed since this
// instance's copy. It ends with commit(): one write batch whose statements all require
// `fence = mine AND seq = expected`, so a holder whose lease was taken over (a newer fence
// claimed) commits nothing. Local changes are captured by temporary triggers.
import { DatabaseSync } from "node:sqlite";
import { SqlStorage } from "../node/sql-storage.js";

export const ACTOR_SCHEMA = `
CREATE TABLE IF NOT EXISTS actor_heads (actor TEXT PRIMARY KEY, fence INTEGER NOT NULL, seq INTEGER NOT NULL, schema_seq INTEGER NOT NULL DEFAULT 0, purged_seq INTEGER NOT NULL DEFAULT 0, schema TEXT);
CREATE TABLE IF NOT EXISTS actor_rows (actor TEXT NOT NULL, tbl TEXT NOT NULL, pk TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT, PRIMARY KEY (actor, tbl, pk));
CREATE INDEX IF NOT EXISTS actor_rows_seq ON actor_rows (actor, seq);
`;
/** Tombstones older than this many commits are purged; copies further behind reload in full. */
const PURGE_EVERY = 64;

/** The lease was taken over: this holder's writes were not committed. */
export class FencedError extends Error {
  constructor(actor) {
    super(`Lost the lease of ${actor}; the turn was not committed`);
    this.name = "FencedError";
  }
}

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;
const literal = (text) => `'${String(text).replace(/'/g, "''")}'`;

function encodeRow(row) {
  return JSON.stringify(row, (_key, value) =>
    value instanceof Uint8Array ? { $b: Buffer.from(value).toString("base64") } : value,
  );
}
function decodeRow(text) {
  return JSON.parse(text, (_key, value) =>
    value && typeof value === "object" && typeof value.$b === "string"
      ? new Uint8Array(Buffer.from(value.$b, "base64"))
      : value,
  );
}

/** One actor's local copy: an in-memory SQLite database, the commit it reflects and its schema. */
export class ActorCache {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    // REPLACE deletes fire the delete triggers too, so rows removed by a UNIQUE conflict are seen.
    this.db.exec("PRAGMA recursive_triggers=ON");
    this.db.exec(
      // No key: a trigger's conflict handling is overridden by its statement's (INSERT OR FAIL...).
      "CREATE TEMP TABLE vz_changes (tbl TEXT NOT NULL, pk TEXT NOT NULL)",
    );
    this.storage = new SqlStorage(this.db, {
      onError: (error) => console.error("actor storage", error?.message),
    });
    this.seq = 0;
    this.schema = "[]"; // the schema committed to libSQL, as stored in actor_heads.schema
    this.tables = new Map(); // table -> {sql, pk: [columns], prefix}
    this.triggers = 0;
  }

  schemaNow() {
    return this.db
      .prepare(
        "SELECT type, name, tbl_name AS tbl, sql FROM main.sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
      )
      .all()
      .map((row) => ({
        type: row.type,
        // sqlite_master.name is always TEXT
        name: String(row.name),
        tbl: row.tbl,
        sql: row.sql,
      }));
  }

  /** (Re)create the capture triggers of tables that are new or changed since the last call. */
  syncTriggers(schema = this.schemaNow()) {
    const tables = new Map(schema.filter((item) => item.type === "table").map((t) => [t.name, t]));
    for (const [name, known] of this.tables)
      if (tables.get(name)?.sql !== known.sql) {
        for (const kind of ["i", "u", "d"])
          this.db.exec(`DROP TRIGGER IF EXISTS temp.${known.prefix}_${kind}`);
        this.tables.delete(name);
      }
    for (const [name, table] of tables) {
      if (this.tables.has(name)) continue;
      const pk = this.db
        .prepare(`PRAGMA main.table_info(${quote(name)})`)
        .all()
        .filter((column) => column.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((column) => column.name);
      if (!pk.length) throw new Error(`Actor table ${name} needs a PRIMARY KEY`);
      const prefix = `vz_t${++this.triggers}`;
      const key = (row) => `json_array(${pk.map((column) => `${row}.${quote(column)}`).join(",")})`;
      const record = (row) => `INSERT INTO temp.vz_changes VALUES (${literal(name)}, ${key(row)});`;
      this.db.exec(`
        CREATE TEMP TRIGGER ${prefix}_i AFTER INSERT ON main.${quote(name)} BEGIN ${record("NEW")} END;
        CREATE TEMP TRIGGER ${prefix}_u AFTER UPDATE ON main.${quote(name)} BEGIN ${record("OLD")} ${record("NEW")} END;
        CREATE TEMP TRIGGER ${prefix}_d AFTER DELETE ON main.${quote(name)} BEGIN ${record("OLD")} END;
      `);
      this.tables.set(name, { sql: table.sql, pk, prefix });
    }
  }

  #where(table) {
    return this.tables
      .get(table)
      .pk.map((column) => `${quote(column)} IS ?`)
      .join(" AND ");
  }
  #read(table, pk) {
    return this.db
      .prepare(`SELECT * FROM main.${quote(table)} WHERE ${this.#where(table)}`)
      .get(...JSON.parse(pk));
  }
  #write(table, pk, data) {
    if (data === null) {
      this.db
        .prepare(`DELETE FROM main.${quote(table)} WHERE ${this.#where(table)}`)
        .run(...JSON.parse(pk));
      return;
    }
    const row = decodeRow(data);
    const columns = Object.keys(row);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO main.${quote(table)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
      )
      .run(...columns.map((column) => row[column]));
  }

  /** Rebuild from the full state in libSQL (schema statements and live rows). */
  load({ seq, schema }, rows) {
    for (const item of JSON.parse(schema || "[]")) this.db.exec(item.sql);
    this.syncTriggers();
    this.apply(rows);
    this.seq = seq;
    this.schema = schema || "[]";
  }

  /** Apply rows committed by other instances (deletions first), without recording them. */
  apply(rows) {
    for (const row of rows)
      if (row.data === null && this.tables.has(row.tbl)) this.#write(row.tbl, row.pk, null);
    for (const row of rows) if (row.data !== null) this.#write(row.tbl, row.pk, row.data);
    this.db.exec("DELETE FROM temp.vz_changes");
  }

  /**
   * What this turn changed: rows to upsert or delete, the schema when it differs from the
   * committed one, and dropped tables. Rows of tables created this turn have no trigger record
   * yet; a schema change writes those tables whole. Null when there is nothing to commit.
   */
  collect() {
    this.storage.commit();
    const schema = this.schemaNow();
    this.syncTriggers(schema);
    const changes = this.db.prepare("SELECT DISTINCT tbl, pk FROM temp.vz_changes").all();
    const schemaText = JSON.stringify(schema);
    const keys = new Map(
      changes.map((change) => [`${String(change.tbl)}\u0000${String(change.pk)}`, change]),
    );
    let dropped = [];
    if (schemaText !== this.schema) {
      // New or altered tables are written whole; tables that disappeared are removed.
      const committed = new Map(
        JSON.parse(this.schema)
          .filter((item) => item.type === "table")
          .map((item) => [item.name, item.sql]),
      );
      for (const [name, table] of this.tables) {
        if (committed.get(name) === table.sql) continue;
        const select = `SELECT json_array(${table.pk.map(quote).join(",")}) AS pk FROM main.${quote(name)}`;
        for (const { pk } of this.db.prepare(select).all())
          keys.set(`${name}\u0000${String(pk)}`, { tbl: name, pk });
      }
      dropped = [...committed.keys()].filter((name) => !this.tables.has(name));
    }
    // Tables created without rows (a probe of an unknown room) are not worth a commit.
    if (!keys.size && !dropped.length) return null;
    const writes = [];
    for (const { tbl, pk } of keys.values()) {
      if (!this.tables.has(tbl)) continue;
      const row = this.#read(tbl, pk);
      writes.push({ tbl, pk, data: row ? encodeRow(row) : null });
    }
    return { writes, schema: schemaText === this.schema ? null : schemaText, dropped };
  }

  /** The turn's changes are in libSQL: forget them and move to the new commit. */
  committed(seq, schema) {
    this.db.exec("DELETE FROM temp.vz_changes");
    this.seq = seq;
    if (schema) this.schema = schema;
  }

  close() {
    try {
      this.db.close();
    } catch {}
  }
}

/** The libSQL side: claims, catch-up reads and fenced commits. */
export class ActorStore {
  constructor(client) {
    this.client = client;
  }

  async init() {
    await this.client.executeMultiple(ACTOR_SCHEMA);
  }

  /**
   * Record the lease's fence and read what changed since `since` (-1: everything). Returns the
   * head after the claim (null for an actor never committed) and the changed rows.
   */
  async claim(actor, fence, since) {
    const [, heads, rows] = await this.client.batch(
      [
        {
          sql: "UPDATE actor_heads SET fence=? WHERE actor=? AND fence<?",
          args: [fence, actor, fence],
        },
        {
          sql: "SELECT fence, seq, schema_seq, purged_seq, schema FROM actor_heads WHERE actor=?",
          args: [actor],
        },
        {
          sql: "SELECT tbl, pk, data FROM actor_rows WHERE actor=? AND seq>? ORDER BY seq",
          args: [actor, since],
        },
      ],
      "write",
    );
    const head = heads.rows[0];
    return {
      head: head
        ? {
            fence: head.fence,
            seq: head.seq,
            schemaSeq: head.schema_seq,
            purgedSeq: head.purged_seq,
            schema: head.schema,
          }
        : null,
      rows: rows.rows.map((row) => ({ tbl: row.tbl, pk: row.pk, data: row.data })),
    };
  }

  async rows(actor) {
    const result = await this.client.execute({
      sql: "SELECT tbl, pk, data FROM actor_rows WHERE actor=? AND data IS NOT NULL",
      args: [actor],
    });
    return result.rows.map((row) => ({ tbl: row.tbl, pk: row.pk, data: row.data }));
  }

  /**
   * Commit one turn as commit number `expected + 1`. Every statement is conditional on this
   * lease's fence and the expected sequence, inside one transaction. Throws FencedError when the
   * actor was claimed by a newer lease or committed by someone else in between.
   */
  async commit(actor, fence, expected, { writes, schema, dropped }) {
    const seq = expected + 1;
    const guard = "EXISTS (SELECT 1 FROM actor_heads WHERE actor=? AND fence=? AND seq=?)";
    const guardArgs = [actor, fence, seq];
    const head = schema
      ? {
          sql: "INSERT INTO actor_heads (actor, fence, seq, schema_seq, purged_seq, schema) VALUES (?,?,?,?,0,?) ON CONFLICT(actor) DO UPDATE SET seq=excluded.seq, schema=excluded.schema, schema_seq=excluded.seq WHERE actor_heads.fence=excluded.fence AND actor_heads.seq=excluded.seq-1",
          args: [actor, fence, seq, seq, schema],
        }
      : {
          sql: "UPDATE actor_heads SET seq=? WHERE actor=? AND fence=? AND seq=?",
          args: [seq, actor, fence, expected],
        };
    const statements = [head];
    for (const table of dropped)
      statements.push({
        sql: `DELETE FROM actor_rows WHERE actor=? AND tbl=? AND ${guard}`,
        args: [actor, table, ...guardArgs],
      });
    for (const { tbl, pk, data } of writes)
      statements.push({
        sql: `INSERT INTO actor_rows (actor, tbl, pk, seq, data) SELECT ?,?,?,?,? WHERE ${guard} ON CONFLICT(actor, tbl, pk) DO UPDATE SET seq=excluded.seq, data=excluded.data`,
        args: [actor, tbl, pk, seq, data, ...guardArgs],
      });
    if (seq % PURGE_EVERY === 0)
      statements.push(
        {
          sql: `DELETE FROM actor_rows WHERE actor=? AND data IS NULL AND seq<=? AND ${guard}`,
          args: [actor, seq - PURGE_EVERY, ...guardArgs],
        },
        {
          sql: "UPDATE actor_heads SET purged_seq=? WHERE actor=? AND fence=? AND seq=?",
          args: [seq - PURGE_EVERY, actor, fence, seq],
        },
      );
    // A fresh actor (expected 0) inserts its head; the upsert's WHERE fences an existing one.
    if (!schema && expected === 0)
      statements[0] = {
        sql: "INSERT INTO actor_heads (actor, fence, seq) VALUES (?,?,1) ON CONFLICT(actor) DO UPDATE SET seq=1 WHERE actor_heads.fence=excluded.fence AND actor_heads.seq=0",
        args: [actor, fence],
      };
    const [result] = await this.client.batch(statements, "write");
    if (result.rowsAffected !== 1) throw new FencedError(actor);
    return seq;
  }
}
