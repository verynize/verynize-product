// Per-actor SQL storage on Node with the semantics of a SQLite Durable Object's `ctx.storage.sql`:
//
// - `exec(query, ...bindings)` is synchronous and returns a cursor (toArray, one, iteration,
//   rowsRead, rowsWritten). Several statements without bindings run as a script.
// - Implicit transactions: the first statement of a synchronous stretch opens a transaction that
//   commits in a microtask, i.e. at the next `await` or when the event ends. Writes made between
//   two awaits are atomic, as on Cloudflare (writes are coalesced until the next await).
// - Output gate: `gate(fn)` runs fn after the open transaction has committed (immediately when
//   none is open). WebSocket sends and RPC/HTTP results go through it, so nothing is acknowledged
//   before it is durable.
import { isScript, plainRow, statementCache, toSqlite } from "./sqlite.js";

class Cursor {
  constructor(rows, rowsWritten, columnNames) {
    this.rows = rows;
    this.rowsRead = rows.length;
    this.rowsWritten = rowsWritten;
    this.columnNames = columnNames;
    this.index = 0;
  }
  next() {
    return this.index < this.rows.length
      ? { done: false, value: this.rows[this.index++] }
      : { done: true, value: undefined };
  }
  [Symbol.iterator]() {
    return this;
  }
  toArray() {
    const rest = this.rows.slice(this.index);
    this.index = this.rows.length;
    return rest;
  }
  one() {
    const rest = this.toArray();
    if (rest.length !== 1)
      throw new Error(`Expected exactly one result from SQL query, but got ${rest.length}.`);
    return rest[0];
  }
  *raw() {
    for (const row of this.toArray()) yield this.columnNames.map((name) => row[name]);
  }
}

export class SqlStorage {
  #db;
  #prepare;
  #open = false;
  #after = [];
  #onError;

  constructor(db, { onError } = {}) {
    this.#db = db;
    this.#prepare = statementCache(db);
    this.#onError = onError || ((error) => console.error("actor storage", error?.message));
  }

  exec(query, ...bindings) {
    this.#begin();
    const params = bindings.map(toSqlite);
    if (!params.length && isScript(query)) {
      this.#db.exec(query);
      return new Cursor([], 0, []);
    }
    const statement = this.#prepare(query);
    const columns = statement.columns().map((column) => column.name);
    if (columns.length) return new Cursor(statement.all(...params).map(plainRow), 0, columns);
    const { changes } = statement.run(...params);
    return new Cursor([], Number(changes), []);
  }

  get databaseSize() {
    const pages = this.#db.prepare("PRAGMA page_count").get().page_count;
    const size = this.#db.prepare("PRAGMA page_size").get().page_size;
    return Number(pages) * Number(size);
  }

  #begin() {
    if (this.#open) return;
    this.#db.exec("BEGIN");
    this.#open = true;
    queueMicrotask(() => {
      try {
        this.commit();
      } catch (error) {
        this.#onError(error);
      }
    });
  }

  /** Commit the open transaction (idempotent), then release what waited behind the gate. */
  commit() {
    if (!this.#open) return;
    this.#open = false;
    try {
      this.#db.exec("COMMIT");
    } catch (error) {
      try {
        this.#db.exec("ROLLBACK");
      } catch {}
      // Nothing that depended on the lost writes may be sent.
      this.#after = [];
      throw error;
    }
    const after = this.#after;
    this.#after = [];
    for (const fn of after) fn();
  }

  /** Run fn once everything written so far is durable. */
  gate(fn) {
    if (this.#open) this.#after.push(fn);
    else fn();
  }

  transactionSync(callback) {
    this.#begin();
    this.#db.exec("SAVEPOINT actor_sync");
    try {
      const result = callback();
      this.#db.exec("RELEASE actor_sync");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK TO actor_sync; RELEASE actor_sync");
      throw error;
    }
  }

  close() {
    try {
      this.commit();
    } finally {
      this.#db.close();
    }
  }
}
