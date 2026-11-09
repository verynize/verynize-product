// One SQLite Durable Object per shared design room: capability links with roles, account
// members, operation-based merging, revision-checked snapshots (legacy clients), WebSocket
// presence, comments and frozen public snapshots. The document is stored per page
// (cloud/room-store.js) and clients that ask for it load pages lazily (`lazy=1`, `sync`, `pages`).
import { DurableObject, acceptWebSocket } from "#cloud-runtime";
import "../web/cloud-ops.js";
import "../web/room-sync.js";
import { RoomStore } from "./room-store.js";
import { RoomHistory } from "./room-history.js";
import {
  BATCH_BYTES,
  BATCH_OPS,
  BATCH_TOO_LARGE,
  MESSAGE_BYTES,
  REQUEST_BYTES,
  byteSize,
} from "./limits.js";
import {
  json,
  fail,
  readBytes,
  readJson,
  randomHex,
  digestHex,
  errorResponse,
  atLeast,
  roleRank,
  ROLES,
  rpcFail,
  HttpError,
} from "./http.js";
import { reportError } from "./telemetry.js";
import { mayHoldInline, rejectInline, screenOps } from "./inline-binaries.js";

const Ops = globalThis.VerynizeOps;
const Sync = globalThis.VerynizeRoomSync;
/** What collaborators see of a socket (its attachment). */
const peerOf = (state) => ({
  id: state.id,
  name: state.name,
  role: state.role,
  pageId: state.pageId ?? null,
  cursor: state.cursor ?? null,
  handle: state.handle ?? null,
});
const CLIENT = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SOCKETS = 32;
const FUTURE_SKEW = 5 * 60 * 1000;
// Sockets that send presence version 2 (`presence=2`) get one peer per change (`peer`,
// `peerLeft`) instead of the whole list, and send `heartbeat` while idle; one silent for longer
// than this (PRESENCE_TIMEOUT_MS overrides it) is closed, so its cursor does not linger.
const PRESENCE_TIMEOUT = 90 * 1000;
const TOKEN_ROLES = ["viewer", "commenter", "editor", "owner"];
const ORG_ROLES = ["viewer", "commenter", "editor", "owner"];
// File visibility: private rooms need a link, a membership or an organization role; public rooms
// also let anyone (no token, no session) read them as a viewer.
export const VISIBILITIES = ["private", "public"];
const PAGE_ID = (id) => typeof id === "string" && id.length > 0 && id.length <= 200;
const MAX_PAGE_REQUEST = 200;
// Receipts kept per client for answering a batch sent again (its outcome, not a bare "duplicate").
const RECEIPTS_KEPT = 64;
const INTERRUPTED =
  "This batch interrupted room processing. Edits are retained on this device; retry a smaller import.";
/** The `code` of a stored batch rejection (web/room-sync.js `rejection`). */
const rejectionCode = (reason) => (reason === INTERRUPTED ? "interrupted" : "too_large");
const requireDocument = (document) => {
  if (document === null || typeof document !== "object")
    fail(400, "Document must be a JSON object or array");
  return document;
};
const bestRole = (...roles) =>
  roles.filter(Boolean).sort((a, b) => roleRank(b) - roleRank(a))[0] || null;

export class DesignRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK(id=1), token_hash TEXT NOT NULL, document TEXT NOT NULL, revision INTEGER NOT NULL, public_nonce TEXT, public_document TEXT, public_revision INTEGER);
      CREATE TABLE IF NOT EXISTS capabilities (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS members (account_id TEXT PRIMARY KEY, email TEXT NOT NULL, handle TEXT, role TEXT NOT NULL, added_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS stamps (path TEXT PRIMARY KEY, stamp TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rejected_batches (client_id TEXT, batch INTEGER, reason TEXT NOT NULL, PRIMARY KEY(client_id,batch));
      CREATE TABLE IF NOT EXISTS pending_batches (client_id TEXT, batch INTEGER, started_at INTEGER NOT NULL, PRIMARY KEY(client_id,batch));
      CREATE TABLE IF NOT EXISTS clients (client_id TEXT PRIMARY KEY, last_batch INTEGER NOT NULL, seen_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS batch_receipts (client_id TEXT NOT NULL, batch INTEGER NOT NULL, revision INTEGER NOT NULL, applied INTEGER NOT NULL, PRIMARY KEY(client_id,batch));
      CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, author TEXT NOT NULL, account_id TEXT, page_id TEXT, node_id TEXT, text TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.clock = Ops.createClock("server");
    // Batches being applied right now, so a live duplicate waits for the first attempt.
    this.applyingBatches = new Map();
    // ROOM_NODE_STORAGE=page stores nodes as one text per page again (before rolling back).
    this.store = new RoomStore(this.sql, { rows: env?.ROOM_NODE_STORAGE !== "page" });
    // Per-artboard version history (cloud/room-history.js, docs/version-history.md).
    this.presenceTimeout = Number(env?.PRESENCE_TIMEOUT_MS) || PRESENCE_TIMEOUT;
    this.history = new RoomHistory(this.sql, { idleMs: Number(env?.VERSION_IDLE_MS) || undefined });
    this.migrateLegacyToken();
    // Rooms that kept the whole document in room.document move to per-page records once, and
    // pages stored as one node text move to node rows; all or nothing.
    ctx.storage.transactionSync(() => this.store.migrate(this.row()));
  }

  // Rooms created before roles stored one capability hash as a JSON byte array on the room row.
  // It becomes an owner capability, so existing invite links keep their full rights.
  migrateLegacyToken() {
    const row = this.row();
    if (!row || row.token_hash === "migrated") return;
    const bytes = JSON.parse(row.token_hash);
    const hex = bytes.map((n) => n.toString(16).padStart(2, "0")).join("");
    this.sql.exec(
      "INSERT OR IGNORE INTO capabilities (id,hash,role,label,created_at) VALUES (?,?,?,?,?)",
      crypto.randomUUID(),
      hex,
      "owner",
      "Original invite link",
      Date.now(),
    );
    this.sql.exec("UPDATE room SET token_hash='migrated' WHERE id=1");
  }

  row() {
    return this.sql.exec("SELECT * FROM room WHERE id=1").toArray()[0];
  }
  snapshot() {
    return { document: this.store.read(), revision: this.row().revision };
  }
  /**
   * The document with only the pages in `ids` loaded (the document's active page, or its first,
   * when none of them exists) and the others as stubs ({...properties, nodes: []}), listed in
   * `unloaded`; `pages` indexes every page ({id, bytes, nodes}).
   */
  lazySnapshot(ids = []) {
    const index = this.store.index();
    const state = this.store.load(this.lazyPages(ids, index));
    return {
      document: state.doc,
      revision: this.row().revision,
      unloaded: [...state.stubs],
      pages: index,
    };
  }
  /** The pages a lazy snapshot loads: the existing ones of `ids`, else the active or first page. */
  lazyPages(ids = [], index = this.store.index()) {
    const known = new Set(index.map((page) => page.id));
    const wanted = new Set(ids.filter((id) => known.has(id)));
    if (!wanted.size && index.length) {
      const active = this.store.metadata()?.activePage;
      wanted.add(known.has(active) ? active : index[0].id);
    }
    return wanted;
  }
  /** Whole pages by id, in the requested order, and the ids that do not exist. */
  readPages(ids) {
    const pages = [],
      missing = [];
    for (const id of ids.slice(0, MAX_PAGE_REQUEST)) {
      const page = PAGE_ID(id) ? this.store.page(id) : null;
      if (page) pages.push(page);
      else missing.push(id);
    }
    return { revision: this.row().revision, pages, missing };
  }
  title() {
    return this.store.title();
  }
  /** "private" (default) or "public", kept in the meta table. */
  visibility() {
    const value = this.sql
      .exec("SELECT value FROM meta WHERE key='visibility'")
      .toArray()[0]?.value;
    return value === "public" ? "public" : "private";
  }
  /** RPC for the router: whether the room exists and is public (anonymous reads allowed). */
  publicRoom() {
    return !!this.row() && this.visibility() === "public";
  }
  /** Role from links, membership and organization, plus viewer on public rooms. */
  effectiveRole(...roles) {
    const role = bestRole(...roles);
    return role || (this.visibility() === "public" ? "viewer" : null);
  }

  async issueToken(role, label) {
    if (!TOKEN_ROLES.includes(role)) fail(400, "Unknown role");
    const secret = randomHex(32),
      id = crypto.randomUUID();
    this.sql.exec(
      "INSERT INTO capabilities (id,hash,role,label,created_at) VALUES (?,?,?,?,?)",
      id,
      await digestHex(secret),
      role,
      typeof label === "string" ? label.slice(0, 80) : null,
      Date.now(),
    );
    return { id, token: secret, role };
  }

  /**
   * Role granted by a capability token, the signed-in account's membership and/or its
   * organization (x-verynize-org-role, computed by the router from D1; clients cannot send it).
   */
  async access(request, url) {
    const header = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
    const secret = /^[0-9a-f]{64}$/.test(header) ? header : url.searchParams.get("token") || "";
    let capability = null;
    if (/^[0-9a-f]{64}$/.test(secret))
      capability =
        this.sql
          .exec("SELECT id,role FROM capabilities WHERE hash=?", await digestHex(secret))
          .toArray()[0] || null;
    let account = null;
    try {
      account = JSON.parse(request.headers.get("x-verynize-account") || "null");
    } catch {}
    const member = account?.id
      ? this.sql.exec("SELECT role FROM members WHERE account_id=?", account.id).toArray()[0]
      : null;
    const org = request.headers.get("x-verynize-org-role");
    const orgRole = ORG_ROLES.includes(org) ? org : null;
    const granted = bestRole(capability?.role, member?.role, orgRole);
    return {
      role: this.effectiveRole(granted),
      // True when only the room's public visibility lets this caller in.
      publicOnly: !granted && this.visibility() === "public",
      member: member?.role || null,
      capability: capability?.id || null,
      account,
      orgRole,
    };
  }

  async create(data, account) {
    if (this.row()) fail(409, "Room exists");
    rejectInline(this.env, requireDocument(data.document));
    this.store.replace(data.document);
    this.sql.exec("INSERT INTO room (id,token_hash,document,revision) VALUES (1,'migrated','',0)");
    const issued = await this.issueToken("owner", "Original invite link");
    if (account?.id) this.addMember(account, "owner");
    return json({ token: issued.token, revision: 0, role: "owner", title: this.title() }, 201);
  }

  addMember(account, role) {
    this.sql.exec(
      "INSERT OR REPLACE INTO members (account_id,email,handle,role,added_at) VALUES (?,?,?,?,?)",
      account.id,
      account.email || "",
      account.handle || null,
      role,
      Date.now(),
    );
  }

  broadcast(value, except) {
    const message = JSON.stringify(value);
    for (const socket of this.ctx.getWebSockets())
      if (socket !== except) this.deliver(socket, message);
  }
  /**
   * Send one message to one socket. A socket that cannot take it is closed, so its client
   * reconnects and resyncs instead of silently missing an operation or an acknowledgement.
   */
  deliver(socket, message) {
    try {
      socket.send(typeof message === "string" ? message : JSON.stringify(message));
      return true;
    } catch (error) {
      console.warn("[room-socket] send failed:", error?.message || error);
      try {
        socket.close(1011, "Message delivery failed");
      } catch {}
      return false;
    }
  }

  stampStore() {
    const cache = new Map(),
      dirty = new Set();
    let cleared = false;
    return {
      get: (path) => {
        if (!cache.has(path))
          cache.set(
            path,
            cleared
              ? undefined
              : this.sql.exec("SELECT stamp FROM stamps WHERE path=?", path).toArray()[0]?.stamp,
          );
        return cache.get(path);
      },
      set: (path, stamp) => {
        cache.set(path, stamp);
        dirty.add(path);
      },
      clear: () => {
        cleared = true;
        cache.clear();
        dirty.clear();
        this.sql.exec("DELETE FROM stamps");
      },
      flush: () => {
        for (const path of dirty)
          this.sql.exec(
            "INSERT OR REPLACE INTO stamps (path,stamp) VALUES (?,?)",
            path,
            cache.get(path),
          );
      },
    };
  }

  /** Legacy whole-document write: revision-checked, then stamped so later operations order after it. */
  update(document, baseRevision) {
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0)
      fail(400, "baseRevision must be a nonnegative integer");
    rejectInline(this.env, requireDocument(document));
    const row = this.row();
    if (row.revision !== baseRevision)
      return json({ error: "Revision conflict", ...this.snapshot() }, 409);
    const stamp = this.clock.next();
    const store = this.stampStore();
    const state = this.store.load(null);
    Ops.apply(
      state.doc,
      Ops.diff(state.doc, document).map((op) => ({ ...op, s: stamp })),
      { stamps: store },
    );
    // Only the pages that differ are rewritten; limits are checked before anything is stored.
    this.store.commit(state, document);
    store.flush();
    this.sql.exec("UPDATE room SET revision=revision+1 WHERE id=1 AND revision=?", baseRevision);
    const result = this.snapshot();
    this.broadcast({ type: "snapshot", ...result });
    return json(result);
  }

  rejectedBatches(client) {
    return this.sql
      .exec("SELECT batch FROM rejected_batches WHERE client_id=?", client || "")
      .toArray()
      .map((row) => row.batch);
  }
  /** The rejection `code` of each rejected batch of a client: {batch: code}. */
  rejectedCodes(client) {
    return Object.fromEntries(
      this.sql
        .exec("SELECT batch,reason FROM rejected_batches WHERE client_id=?", client || "")
        .toArray()
        .map((row) => [row.batch, rejectionCode(row.reason)]),
    );
  }
  /** What a snapshot tells a client about its batches. */
  batchState(client) {
    return {
      rejectedBatches: this.rejectedBatches(client),
      rejectedCodes: this.rejectedCodes(client),
    };
  }
  /**
   * Digests (web/room-sync.js) of the pages in `ids` and of the settings at the current revision,
   * for a client that claims to hold them (`sync` at the room's revision). Cached per revision.
   */
  contentDigests(ids) {
    if (this.store.layout !== "pages") return {};
    const revision = this.row().revision;
    if (this.digestCache?.revision !== revision)
      this.digestCache = { revision, pages: new Map(), meta: null };
    const cache = this.digestCache;
    const digests = {};
    for (const id of ids) {
      if (!cache.pages.has(id)) {
        const page = this.store.page(id);
        cache.pages.set(id, page ? Sync.pageDigest(page) : null);
      }
      if (cache.pages.get(id)) digests[id] = cache.pages.get(id);
    }
    cache.meta ??= Sync.metaDigest(this.store.metadata());
    return { digests, metaDigest: cache.meta };
  }

  /**
   * The refusal of a client batch above the batch limits (web/room-limits.js), or null. One
   * operation may exceed BATCH_BYTES on its own (up to the message limit); several may not, so
   * applying a batch never holds more than a few megabytes. Nothing is stored: the client keeps
   * the batch and splits the change (`code`: BATCH_TOO_LARGE).
   */
  batchTooLarge(data, bytes) {
    const count = Array.isArray(data?.ops) ? data.ops.length : 0;
    if (count < 2 || bytes <= BATCH_BYTES) return null;
    return {
      type: "ops",
      client: data.client,
      batch: data.batch,
      revision: this.row().revision,
      ops: [],
      rejected: count,
      tooLarge: true,
      retained: true,
      code: BATCH_TOO_LARGE,
      error: `An operation batch is limited to ${BATCH_BYTES / 1024 / 1024} MB; split the change into smaller batches`,
    };
  }

  /**
   * Apply one client batch of operations. Returns the message describing the outcome. `who`
   * ({id, name}) is the editor the version history records (with the batch's optional `actor`).
   */
  async applyBatch(data, role, who = null, baseRevision = null) {
    const client = data?.client,
      batch = data?.batch,
      ops = data?.ops;
    if (typeof client !== "string" || !CLIENT.test(client)) fail(400, "Invalid client id");
    if (!Number.isSafeInteger(batch) || batch < 1) fail(400, "Invalid batch number");
    if (!Array.isArray(ops) || ops.length > BATCH_OPS)
      fail(400, `A batch holds 1–${BATCH_OPS} operations`);
    // A live duplicate waits for its first request; only a marker from an interrupted
    // invocation is poison. sync() is a durability boundary, not an acknowledgement.
    const key = `${client}/${batch}`;
    const running = this.applyingBatches.get(key);
    if (running) {
      await running;
      return this.applyBatch(data, role, who, baseRevision);
    }
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    this.applyingBatches.set(key, pending);
    try {
      const last = () =>
        this.sql.exec("SELECT last_batch FROM clients WHERE client_id=?", client).toArray()[0]
          ?.last_batch ?? 0;
      if (baseRevision !== null && this.row().revision !== baseRevision)
        return { conflict: true, revision: this.row().revision };
      if (batch <= last()) return this.applyBatchNow(data, role, who);
      const poisoned =
        this.sql
          .exec("SELECT batch FROM pending_batches WHERE client_id=? AND batch=?", client, batch)
          .toArray().length > 0;
      if (!poisoned && atLeast(role, "editor")) {
        this.sql.exec("INSERT INTO pending_batches VALUES (?,?,?)", client, batch, Date.now());
        // SQLite implicit transactions/output gates alone don't persist a marker before
        // synchronous CPU work. https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#sync
        await this.ctx.storage.sync();
      }
      // sync can yield: reload the revision and duplicate state before making any edits.
      const finish = () => {
        if (batch <= last()) {
          this.sql.exec("DELETE FROM pending_batches WHERE client_id=? AND batch=?", client, batch);
          return this.applyBatchNow(data, role, who);
        }
        if (baseRevision !== null && this.row().revision !== baseRevision) {
          this.sql.exec("DELETE FROM pending_batches WHERE client_id=? AND batch=?", client, batch);
          return { conflict: true, revision: this.row().revision };
        }
        let result;
        if (poisoned) {
          const reason = INTERRUPTED;
          this.sql.exec(
            "INSERT OR REPLACE INTO rejected_batches VALUES (?,?,?)",
            client,
            batch,
            reason,
          );
          result = {
            type: "ops",
            client,
            batch,
            revision: this.row().revision,
            ops: [],
            rejected: ops.length,
            tooLarge: true,
            retained: true,
            code: "interrupted",
            error: reason,
          };
        } else result = this.applyBatchNow(data, role, who);
        // The outcome answers this batch if it is sent again (a lost acknowledgement).
        this.sql.exec(
          "INSERT OR REPLACE INTO batch_receipts (client_id,batch,revision,applied) VALUES (?,?,?,?)",
          client,
          batch,
          result.revision,
          result.ops.length,
        );
        this.sql.exec(
          "DELETE FROM batch_receipts WHERE client_id=? AND batch<=?",
          client,
          batch - RECEIPTS_KEPT,
        );
        // These writes share the document/stamp transaction. Never ack the durable marker.
        this.sql.exec(
          "INSERT OR REPLACE INTO clients (client_id,last_batch,seen_at) VALUES (?,?,?)",
          client,
          batch,
          Date.now(),
        );
        this.sql.exec("DELETE FROM rejected_batches WHERE client_id=? AND batch<?", client, batch);
        this.sql.exec("DELETE FROM pending_batches WHERE client_id=? AND batch<=?", client, batch);
        return result;
      };
      return this.ctx.storage.transactionSync(finish);
    } finally {
      this.applyingBatches.delete(key);
      release();
    }
  }

  /** Synchronous apply: the caller commits the outcome and acknowledgement atomically. */
  applyBatchNow(data, role, who) {
    const { client, batch, ops } = data;
    const revision = this.row().revision;
    const last =
      this.sql.exec("SELECT last_batch FROM clients WHERE client_id=?", client).toArray()[0]
        ?.last_batch ?? 0;
    if (batch <= last) {
      const reason = this.sql
        .exec("SELECT reason FROM rejected_batches WHERE client_id=? AND batch=?", client, batch)
        .toArray()[0]?.reason;
      // The original outcome: the revision that carried the batch's operations and how many
      // applied. Without a receipt (older batch) the client must resync to see them.
      const receipt = this.sql
        .exec(
          "SELECT revision,applied FROM batch_receipts WHERE client_id=? AND batch=?",
          client,
          batch,
        )
        .toArray()[0];
      return {
        type: "ops",
        client,
        batch,
        revision,
        ops: [],
        rejected: reason ? ops.length : 0,
        duplicate: true,
        ...(receipt
          ? { appliedRevision: receipt.revision, applied: receipt.applied }
          : { resync: true }),
        ...(reason
          ? { tooLarge: true, retained: true, code: rejectionCode(reason), error: reason }
          : {}),
      };
    }
    if (!atLeast(role, "editor"))
      return {
        type: "ops",
        client,
        batch,
        revision,
        ops: [],
        rejected: ops.length,
        error: "Your role in this room cannot edit",
      };
    const limit = Date.now() + FUTURE_SKEW;
    // Large inline binaries never reach room storage (cloud/inline-binaries.js).
    const screened = screenOps(this.env, ops);
    if (screened.rejected.length)
      this.sql.exec(
        "INSERT OR IGNORE INTO rejected_batches VALUES (?,?,?)",
        client,
        batch,
        String(screened.rejected[0]?.reason || "Some edits were rejected"),
      );
    const stamped = screened.ops.map((op) => {
      const parsed = Ops.decode(op?.s);
      // Missing or far-future stamps would win forever; the server restamps them.
      const s = parsed && parsed.wall <= limit ? op.s : this.clock.next();
      this.clock.observe(s);
      return { ...op, s };
    });
    const store = this.stampStore();
    // Only the pages the batch touches are read and written; the others stay stubs.
    const touched = Ops.touchedPages(stamped);
    const state = this.store.load(touched.all ? null : touched.pages);
    // The operations come from a freshly parsed message: their values join the document uncopied.
    const result = Ops.apply(state.doc, stamped, {
      owned: true,
      stamps: store,
      normalize: true,
      stamp: this.clock.next(),
      external: (id) => state.stubs.has(this.store.nodePage(id)),
    });
    result.rejected.unshift(...screened.rejected.map((item) => ({ ...item, code: "too_large" })));
    if (!result.applied.length)
      return {
        type: "ops",
        client,
        batch,
        revision,
        ops: [],
        rejected: result.rejected.length,
        reasons: result.rejected.slice(0, 20),
      };
    try {
      this.store.commit(state, result.doc);
    } catch (error) {
      if (error?.status !== 413) throw error;
      this.sql.exec(
        "INSERT OR IGNORE INTO rejected_batches VALUES (?,?,?)",
        client,
        batch,
        error.message,
      );
      return {
        type: "ops",
        client,
        batch,
        revision,
        ops: [],
        rejected: ops.length,
        error: error.message,
        tooLarge: true,
        retained: true,
        code: "too_large",
      };
    }
    store.flush();
    this.sql.exec("UPDATE room SET revision=revision+1 WHERE id=1");
    this.recordHistory(state, result, data.actor, who);
    return {
      type: "ops",
      client,
      batch,
      revision: revision + 1,
      ops: result.applied,
      rejected: result.rejected.length,
      reasons: result.rejected.slice(0, 20),
    };
  }

  /** The version history's author of a batch: the agent the client names, else the person. */
  historyAuthor(actor, who) {
    const text = (value) =>
      typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : null;
    const id = text(who?.id) || "anonymous";
    if (actor?.kind === "agent") {
      const name = text(actor.name) || "Agent";
      return { kind: "agent", name, id: `${id}:agent:${name}` };
    }
    return { kind: "user", name: text(who?.name) || "Guest", id };
  }

  /** Version history of an applied batch; history problems never fail the edit. */
  recordHistory(state, result, actor, who) {
    try {
      if (!Ops.isStructured(result.doc)) return;
      const pages = result.doc.pages.map((page) => page.id).filter((id) => !state.stubs.has(id));
      const nodeLevel = result.applied.every((op) =>
        ["add", "remove", "node", "text"].includes(op.t),
      );
      const restoring =
        typeof actor?.restore === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(actor.restore)
          ? this.sql
              .exec("SELECT artboard_id FROM history_versions WHERE id=?", actor.restore)
              .toArray()[0]
          : null;
      this.history.observe(state.doc, result.doc, {
        pages,
        nodes: nodeLevel ? result.applied.map((op) => op.id) : null,
        author: this.historyAuthor(actor, who),
        ...(restoring
          ? { force: "restore", artboardId: restoring.artboard_id, label: "Before restore" }
          : {}),
      });
      this.scheduleHistory();
    } catch (error) {
      console.error("[room-history]", error?.message || error);
    }
  }

  /** Wake up when the next artboard has been idle long enough to store its last state. */
  scheduleHistory(at = Date.now() + this.history.idleMs + 1000) {
    if (this.historyAlarm && this.historyAlarm <= at && this.historyAlarm > Date.now()) return;
    this.historyAlarm = at;
    Promise.resolve(this.ctx.storage.setAlarm(at)).catch(() => {});
  }

  async alarm() {
    this.historyAlarm = null;
    try {
      const now = Date.now();
      const due = this.history.due(now);
      if (due.length) {
        const pages = [
          ...new Set(due.map((row) => this.store.nodePage(row.artboardId)).filter(Boolean)),
        ];
        const doc = pages.length ? this.store.load(new Set(pages)).doc : null;
        this.history.idle(now, (id) =>
          doc ? globalThis.VerynizeVersions.snapshot(doc, id) : null,
        );
      }
      const next = this.history.nextDue();
      if (next) this.scheduleHistory(Math.max(next, Date.now() + 1000));
    } catch (error) {
      console.error("[room-history]", error?.message || error);
    }
  }

  /** Store the current state of an artboard as a version (manual or finish_artboard). */
  captureVersion(artboardId, author, reason, label) {
    const page = this.store.nodePage(artboardId);
    if (!page) fail(404, "Artboard not found");
    return this.history.capture(this.store.load(new Set([page])).doc, artboardId, {
      author,
      reason,
      label: typeof label === "string" ? label.slice(0, 120) : undefined,
    });
  }

  /** Hosted MCP (cloud/design-backend.js): versions of an artboard, or the artboards with versions. */
  historyList({ accountId, orgRole, artboardId } = {}) {
    if (!this.row() || !this.memberRole(accountId, orgRole))
      rpcFail(404, "Room not found, or you have no access to it");
    return this.history.list(typeof artboardId === "string" ? artboardId : null);
  }

  historyGet({ accountId, orgRole, id } = {}) {
    if (!this.row() || !this.memberRole(accountId, orgRole))
      rpcFail(404, "Room not found, or you have no access to it");
    return this.history.get(id);
  }

  historyCapture({ accountId, orgRole, artboardId, reason, label } = {}) {
    const role = this.row() ? this.memberRole(accountId, orgRole) : null;
    if (!role) rpcFail(404, "Room not found, or you have no access to it");
    if (!atLeast(role, "editor")) rpcFail(403, `Your role in this room (${role}) cannot edit`);
    try {
      return this.captureVersion(
        artboardId,
        this.historyAuthor({ kind: "agent" }, { id: `mcp-${accountId}` }),
        reason === "finish" ? "finish" : "manual",
        label,
      );
    } catch (error) {
      rpcFail(error?.status || 400, error?.message || "Capture failed");
    }
  }

  /** Role of a signed-in account here: its membership and/or organization role (no links). */
  memberRole(accountId, orgRole) {
    const member = accountId
      ? this.sql.exec("SELECT role FROM members WHERE account_id=?", accountId).toArray()[0]
      : null;
    return bestRole(member?.role, ORG_ROLES.includes(orgRole) ? orgRole : null);
  }

  /** Hosted MCP read (cloud/mcp.js): the snapshot and the caller's role. */
  agentRead({ accountId, orgRole } = {}) {
    const role = this.row() ? this.memberRole(accountId, orgRole) : null;
    if (!role) rpcFail(404, "Room not found, or you have no access to it");
    return { ...this.snapshot(), role, title: this.title() };
  }

  /**
   * The caller's current role (null without access) and the title, without the document: the
   * model API runtime (cloud/ai.js) re-checks it before every tool call of a run.
   */
  agentRole({ accountId, orgRole } = {}) {
    const role = this.row() ? this.memberRole(accountId, orgRole) || null : null;
    return { role, title: role ? this.title() : null };
  }

  /**
   * Hosted MCP write (cloud/mcp.js): a server-originated batch, computed by the Worker as a diff
   * from `baseRevision`, applied with the caller's role and broadcast to live sockets as `ops`.
   * A newer revision returns {conflict:true} so the caller recomputes its edit.
   */
  async agentApply({ accountId, orgRole, baseRevision, ops, actor } = {}) {
    const row = this.row();
    const role = row ? this.memberRole(accountId, orgRole) : null;
    if (!role) rpcFail(404, "Room not found, or you have no access to it");
    if (!atLeast(role, "editor"))
      rpcFail(403, `Your role in this room (${role}) cannot edit; ask an owner for editor access`);
    if (row.revision !== baseRevision) return { conflict: true, revision: row.revision };
    const client = `mcp-${String(accountId)
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 56)}`;
    const last =
      this.sql.exec("SELECT last_batch FROM clients WHERE client_id=?", client).toArray()[0]
        ?.last_batch ?? 0;
    const message = await this.applyBatch(
      { client, batch: last + 1, ops, actor: { ...actor, kind: "agent" } },
      role,
      { id: client, name: "Agent" },
      baseRevision,
    );
    if (message.conflict) return message;
    if (message.error) rpcFail(403, message.error);
    if (message.ops.length) this.broadcast(message);
    return {
      applied: message.ops.length,
      rejected: message.rejected,
      reasons: message.reasons || [],
      ...this.snapshot(),
    };
  }

  /**
   * Room migration (cloud/inline-binaries.js migrateRoomInline): the document with the pages that
   * may still hold large inline binaries loaded (the others are stubs), or null. `ids` limits the
   * scan to some pages (lazy loading; empty: the page a lazy snapshot opens on), null scans all.
   * Pages found clean are not rescanned during this activation (writes reject inline binaries),
   * and a page that cannot be migrated is offered once per revision, not on every open.
   */
  inlineSnapshot(ids = null) {
    const row = this.row();
    if (!row) return null;
    this.inlineClean ??= new Set();
    this.inlineOffered ??= new Map();
    const fresh = (key) =>
      !this.inlineClean.has(key) && this.inlineOffered.get(key) !== row.revision;
    const check = (key, text) => {
      if (mayHoldInline(text)) return true;
      this.inlineClean.add(key);
      return false;
    };
    const offer = (keys) => {
      for (const key of keys) this.inlineOffered.set(key, row.revision);
    };
    if (this.store.layout !== "pages") {
      if (!fresh("w") || !check("w", this.store.text("w"))) return null;
      offer(["w"]);
      return { document: this.store.read(), revision: row.revision };
    }
    const index = this.store.index().map((page) => page.id);
    const scan = ids === null ? index : [...this.lazyPages(ids)];
    const dirty = new Set(
      scan.filter(
        (id) =>
          fresh(id) && check(id, this.store.text("h:" + id) + "\n" + this.store.nodesText(id)),
      ),
    );
    const meta = fresh("m") && check("m", this.store.text("m"));
    if (!dirty.size && !meta) return null;
    offer([...dirty, ...(meta ? ["m"] : [])]);
    return { document: this.store.load(dirty).doc, revision: row.revision };
  }
  /** Apply the asset URL swap of a migration as a server batch; a newer revision is a conflict. */
  async migrateInline({ baseRevision, ops } = {}) {
    const row = this.row();
    if (!row) rpcFail(404, "Room not found");
    if (row.revision !== baseRevision) return { conflict: true, revision: row.revision };
    const client = "server-assets";
    const last =
      this.sql.exec("SELECT last_batch FROM clients WHERE client_id=?", client).toArray()[0]
        ?.last_batch ?? 0;
    const message = await this.applyBatch(
      { client, batch: last + 1, ops },
      "owner",
      null,
      baseRevision,
    );
    if (message.conflict) return message;
    if (message.ops.length) this.broadcast(message);
    return { applied: message.ops.length, rejected: message.rejected, revision: message.revision };
  }

  accessSummary(role, publicOnly = false) {
    const members = this.sql
      .exec("SELECT account_id,email,handle,role,added_at FROM members ORDER BY added_at")
      .toArray()
      .map((row) => ({
        accountId: row.account_id,
        email: row.email,
        handle: row.handle,
        role: row.role,
      }));
    // Visitors of a public room see the file, never who it is shared with.
    const result = {
      role,
      members: publicOnly ? [] : members,
      title: this.title(),
      visibility: this.visibility(),
    };
    if (role === "owner")
      result.links = this.sql
        .exec("SELECT id,role,label,created_at FROM capabilities ORDER BY created_at")
        .toArray()
        .map((row) => ({
          id: row.id,
          role: row.role,
          label: row.label || "",
          createdAt: row.created_at,
        }));
    return result;
  }

  /**
   * Re-evaluate every live socket after links, members or visibility change; revoked peers are
   * disconnected (`revoked` with `reason` "private" when the room just stopped being public).
   */
  refreshSockets(reason = "removed") {
    for (const socket of this.ctx.getWebSockets()) {
      const state = socket.deserializeAttachment() || {};
      const capability = state.capability
        ? this.sql.exec("SELECT role FROM capabilities WHERE id=?", state.capability).toArray()[0]
        : null;
      const member = state.accountId
        ? this.sql.exec("SELECT role FROM members WHERE account_id=?", state.accountId).toArray()[0]
        : null;
      const role = this.effectiveRole(capability?.role, member?.role, state.orgRole);
      if (!role) {
        try {
          socket.send(
            JSON.stringify({
              type: "revoked",
              reason,
              error:
                reason === "private"
                  ? "This file is now private"
                  : "Your access to this room was revoked",
            }),
          );
          socket.close(4401, "Access revoked");
        } catch {}
        continue;
      }
      if (role !== state.role) {
        socket.serializeAttachment({
          ...state,
          role,
          capability: capability ? state.capability : null,
        });
        this.deliver(socket, { type: "role", role });
      }
    }
    this.broadcast({ type: "presence", peers: this.peers() });
  }

  async fetch(request) {
    try {
      const url = new URL(request.url),
        action = url.pathname,
        method = request.method;
      const row = this.row();
      if (action === "/create" && method === "POST") {
        let account = null;
        try {
          account = JSON.parse(request.headers.get("x-verynize-account") || "null");
        } catch {}
        return await this.create(await readJson(request, REQUEST_BYTES), account);
      }
      if (action === "/public" && method === "GET") {
        if (!row || !row.public_nonce || url.searchParams.get("nonce") !== row.public_nonce)
          return json({ error: "Not found" }, 404);
        return json({ document: this.store.published(row), revision: row.public_revision });
      }
      if (!row) return json({ error: "Unauthorized" }, 401);
      const { role, capability, account, orgRole, publicOnly, member } = await this.access(
        request,
        url,
      );
      if (!role) return json({ error: "Unauthorized" }, 401);
      const need = (wanted) => {
        if (!atLeast(role, wanted)) fail(403, `This needs the ${wanted} role; you are a ${role}`);
      };

      if (action === "/socket" && method === "GET") {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
          return json({ error: "WebSocket upgrade required" }, 426);
        if (this.ctx.getWebSockets().length >= MAX_SOCKETS)
          return json({ error: "Room connection limit reached" }, 429);
        const client = CLIENT.test(url.searchParams.get("client") || "")
          ? url.searchParams.get("client")
          : null;
        const acked = client
          ? (this.sql.exec("SELECT last_batch FROM clients WHERE client_id=?", client).toArray()[0]
              ?.last_batch ?? 0)
          : 0;
        const { socket: server, response } = acceptWebSocket(this.ctx);
        const id = crypto.randomUUID();
        const lazy = url.searchParams.get("lazy") === "1";
        server.serializeAttachment({
          id,
          name: account?.displayName || "Guest",
          role,
          capability,
          orgRole,
          accountId: account?.id || null,
          handle: account?.handle || null,
          client,
          lazy,
          presence: url.searchParams.get("presence") === "2" ? 2 : 1,
          seen: Date.now(),
        });
        // Lazy clients answer the welcome with `sync` (the pages they hold) and get a snapshot
        // of those pages only; other clients get the whole document at once.
        server.send(
          JSON.stringify({
            type: "welcome",
            id,
            protocol: Ops.PROTOCOL,
            presence: 2,
            role,
            acked,
            ...(lazy ? { lazyPages: true } : {}),
          }),
        );
        if (!lazy)
          server.send(
            JSON.stringify({
              type: "snapshot",
              ...this.snapshot(),
              acked,
              ...this.batchState(client),
            }),
          );
        this.pruneSilent();
        this.presenceChanged(server, true);
        return response;
      }
      if (action === "/room" && method === "GET")
        return json({
          ...(url.searchParams.get("lazy") === "1"
            ? this.lazySnapshot(url.searchParams.getAll("page"))
            : this.snapshot()),
          role,
          protocol: Ops.PROTOCOL,
          title: this.title(),
        });
      if (action === "/pages" && method === "GET")
        return json(this.readPages(url.searchParams.getAll("id")));
      if (action === "/room" && method === "PUT") {
        need("editor");
        const data = await readJson(request, REQUEST_BYTES);
        return this.update(data.document, data.baseRevision);
      }
      if (action === "/ops" && method === "POST") {
        const body = await readBytes(request, MESSAGE_BYTES);
        let data;
        try {
          data = JSON.parse(new TextDecoder().decode(body));
        } catch {
          fail(400, "Body must be JSON");
        }
        const message =
          this.batchTooLarge(data, body.byteLength) ||
          (await this.applyBatch(data, role, {
            id: account?.id || capability,
            name: account?.displayName || account?.handle,
          }));
        if (message.ops.length) this.broadcast(message);
        return json(message, message.tooLarge ? 413 : message.error ? 403 : 200);
      }
      if (action === "/publish" && method === "POST") {
        need("editor");
        const nonce = randomHex(32);
        this.store.publish();
        this.sql.exec(
          "UPDATE room SET public_nonce=?,public_document=NULL,public_revision=revision WHERE id=1",
          nonce,
        );
        return json({ nonce, revision: this.row().revision, title: this.title() });
      }
      if (action === "/publish" && method === "DELETE") {
        need("editor");
        this.sql.exec(
          "UPDATE room SET public_nonce=NULL,public_document=NULL,public_revision=NULL WHERE id=1",
        );
        this.store.unpublish();
        return json({ unpublished: true });
      }
      // Version history (docs/version-history.md): viewers list and preview, editors capture.
      // Visitors of a public room see the current document only, not earlier (deleted) content.
      if ((action === "/versions" || action.startsWith("/versions/")) && publicOnly)
        fail(403, "Version history needs access to this file");
      if (action === "/versions" && method === "GET") {
        const artboard = url.searchParams.get("artboard");
        return json(
          artboard
            ? { artboardId: artboard, versions: this.history.list(artboard) }
            : { artboards: this.history.list() },
        );
      }
      if (action === "/versions" && method === "POST") {
        need("editor");
        const data = await readJson(request, 16 * 1024);
        if (typeof data.artboard !== "string") fail(400, "artboard required");
        const author = this.historyAuthor(null, {
          id: account?.id || capability,
          name: account?.displayName || account?.handle,
        });
        return json({ versions: this.captureVersion(data.artboard, author, "manual", data.label) });
      }
      const versionPath = action.match(/^\/versions\/([A-Za-z0-9_-]{1,64})$/);
      if (versionPath && method === "GET") {
        const found = this.history.get(versionPath[1]);
        if (!found) return json({ error: "Version not found" }, 404);
        return json({ version: found.meta, snapshot: found.snapshot });
      }
      if (action === "/access" && method === "GET")
        return json({
          ...this.accessSummary(role, publicOnly),
          // For the router's `you` (cloud/worker.js): direct membership role, signed-in or not.
          member,
          publicOnly,
        });
      if (action === "/visibility" && method === "PUT") {
        need("owner");
        const data = await readJson(request, 16 * 1024);
        if (!VISIBILITIES.includes(data.visibility))
          fail(400, "Visibility must be private or public");
        const previous = this.visibility();
        this.sql.exec(
          "INSERT OR REPLACE INTO meta (key,value) VALUES ('visibility',?)",
          data.visibility,
        );
        if (previous !== data.visibility) {
          this.broadcast({ type: "visibility", visibility: data.visibility });
          // Sockets that were only here because the room was public lose access now.
          if (data.visibility === "private") this.refreshSockets("private");
        }
        return json({ visibility: data.visibility, title: this.title() });
      }
      if (action === "/members" && method === "POST") {
        need("owner");
        const data = await readJson(request);
        const target = data.account;
        if (!target?.id || !["viewer", "commenter", "editor", "owner"].includes(data.role))
          fail(400, "Choose an account and a role");
        const previous =
          this.sql.exec("SELECT role FROM members WHERE account_id=?", target.id).toArray()[0]
            ?.role || null;
        this.addMember(target, data.role);
        this.refreshSockets();
        return json({
          member: {
            accountId: target.id,
            email: target.email,
            handle: target.handle,
            role: data.role,
          },
          // The role before this call, null for a new member: only new members are emailed.
          previousRole: previous,
          title: this.title(),
        });
      }
      const memberMatch = action.match(/^\/members\/([0-9a-f-]{36})$/);
      if (memberMatch && method === "DELETE") {
        if (account?.id !== memberMatch[1]) need("owner"); // anyone may leave; owners may remove others
        const owners = this.sql.exec("SELECT account_id FROM members WHERE role='owner'").toArray();
        const ownerLinks = this.sql
          .exec("SELECT COUNT(*) AS n FROM capabilities WHERE role='owner'")
          .one().n;
        const lastOwner = owners.length === 1 && owners[0].account_id === memberMatch[1];
        // The last owner account never removes itself, even while an owner link exists.
        if (lastOwner && account?.id === memberMatch[1])
          fail(409, "You are the last owner. Add another owner before leaving.");
        if (lastOwner && !ownerLinks) fail(409, "Add another owner before removing the last one");
        this.sql.exec("DELETE FROM members WHERE account_id=?", memberMatch[1]);
        this.refreshSockets();
        return json({ removed: memberMatch[1] });
      }
      if (action === "/claim" && method === "POST") {
        need("owner");
        if (!account?.id) fail(401, "Sign in to attach this room to your account");
        this.addMember(account, "owner");
        return json({ role: "owner", title: this.title() });
      }
      if (action === "/tokens" && method === "POST") {
        need("owner");
        const data = await readJson(request);
        return json(await this.issueToken(data.role, data.label), 201);
      }
      if (action === "/tokens/rotate" && method === "POST") {
        need("owner");
        // Every capability link stops working; account members keep their access.
        const revoked = this.sql.exec("SELECT COUNT(*) AS n FROM capabilities").one().n;
        this.sql.exec("DELETE FROM capabilities");
        const issued = await this.issueToken("owner", "Rotated owner link");
        this.refreshSockets();
        return json({ token: issued.token, role: "owner", revoked });
      }
      const tokenMatch = action.match(/^\/tokens\/([0-9a-f-]{36})$/);
      if (tokenMatch && method === "DELETE") {
        need("owner");
        this.sql.exec("DELETE FROM capabilities WHERE id=?", tokenMatch[1]);
        this.refreshSockets();
        return json({ revoked: tokenMatch[1] });
      }
      if (action === "/comments" && method === "GET") {
        return json({
          comments: this.sql
            .exec(
              "SELECT id,author,page_id,node_id,text,created_at FROM comments ORDER BY created_at DESC LIMIT 200",
            )
            .toArray()
            .map((c) => ({
              id: c.id,
              author: c.author,
              pageId: c.page_id,
              nodeId: c.node_id,
              text: c.text,
              createdAt: c.created_at,
            })),
        });
      }
      if (action === "/comments" && method === "POST") {
        need("commenter");
        const data = await readJson(request, 64 * 1024);
        const text = typeof data.text === "string" ? data.text.trim() : "";
        if (!text || text.length > 4000) fail(400, "Comments use 1–4000 characters");
        const comment = {
          id: crypto.randomUUID(),
          author:
            account?.displayName ||
            (typeof data.author === "string" && data.author.trim().slice(0, 80)) ||
            "Guest",
          pageId: typeof data.pageId === "string" ? data.pageId.slice(0, 200) : null,
          nodeId: typeof data.nodeId === "string" ? data.nodeId.slice(0, 200) : null,
          text,
          createdAt: Date.now(),
        };
        this.sql.exec(
          "INSERT INTO comments (id,author,account_id,page_id,node_id,text,created_at) VALUES (?,?,?,?,?,?,?)",
          comment.id,
          comment.author,
          account?.id || null,
          comment.pageId,
          comment.nodeId,
          comment.text,
          comment.createdAt,
        );
        this.broadcast({ type: "comment", comment });
        return json({ comment }, 201);
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      if (!(error instanceof HttpError)) reportError(error, "room");
      return errorResponse(error);
    }
  }

  /** Account ids of the live sockets, so the router can recompute their organization roles. */
  connectedAccounts() {
    const ids = new Set();
    for (const socket of this.ctx.getWebSockets()) {
      const id = socket.deserializeAttachment()?.accountId;
      if (id) ids.add(id);
    }
    return [...ids];
  }

  /**
   * Organization roles changed ({accountId: role|null}): live sockets of those accounts are
   * re-evaluated and downgraded, promoted or disconnected like after a membership change.
   */
  applyOrgRoles(roles) {
    for (const socket of this.ctx.getWebSockets()) {
      const state = socket.deserializeAttachment() || {};
      if (!state.accountId || !Object.hasOwn(roles, state.accountId)) continue;
      const next = ORG_ROLES.includes(roles[state.accountId]) ? roles[state.accountId] : null;
      socket.serializeAttachment({ ...state, orgRole: next });
    }
    this.refreshSockets();
    return { updated: true };
  }

  peers() {
    return this.ctx
      .getWebSockets()
      .map((ws) => ws.deserializeAttachment())
      .filter((state) => state && !state.gone)
      .map(peerOf);
  }

  /**
   * Announce the presence of `ws` after it joined (`joined`: it gets the whole list) or changed.
   * Presence-2 sockets get the one peer, older ones the whole list, as before.
   */
  presenceChanged(ws, joined = false) {
    const peer = JSON.stringify({ type: "peer", peer: peerOf(ws.deserializeAttachment()) });
    let list = null;
    for (const socket of this.ctx.getWebSockets()) {
      const state = socket.deserializeAttachment();
      if (state?.gone) continue;
      const delta = socket !== ws || !joined;
      const message =
        delta && state?.presence === 2
          ? peer
          : (list ??= JSON.stringify({ type: "presence", peers: this.peers() }));
      this.deliver(socket, message);
    }
  }

  /** Announce that the peers in `ids` left; `except` is a socket that is closing. */
  presenceLeft(ids, except) {
    const gone = new Set(ids);
    let list = null;
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      const state = socket.deserializeAttachment();
      if (state?.gone) continue;
      const message =
        state?.presence === 2
          ? JSON.stringify({ type: "peerLeft", ids: [...gone] })
          : (list ??= JSON.stringify({
              type: "presence",
              peers: this.peers().filter((peer) => !gone.has(peer.id)),
            }));
      this.deliver(socket, message);
    }
  }

  /**
   * Close presence-2 sockets whose heartbeat stopped (a connection that died without a close).
   * Runs on heartbeats and when a socket joins.
   */
  pruneSilent(now = Date.now()) {
    const ids = [];
    for (const socket of this.ctx.getWebSockets()) {
      const state = socket.deserializeAttachment();
      if (state?.presence !== 2 || state.gone || now - (state.seen || 0) <= this.presenceTimeout)
        continue;
      ids.push(state.id);
      try {
        socket.serializeAttachment({ ...state, gone: true });
        socket.close(4408, "Presence heartbeat timed out");
      } catch {}
    }
    if (ids.length) this.presenceLeft(ids);
  }

  async webSocketMessage(ws, message) {
    try {
      const size = typeof message === "string" ? byteSize(message) : Infinity;
      if (size > MESSAGE_BYTES) throw Error("Invalid message size");
      const data = JSON.parse(message);
      const state = ws.deserializeAttachment() || {};
      // A socket closed for a stopped heartbeat: whatever it still sends is ignored.
      if (state.gone) return;
      if (data.type === "update") {
        if (!atLeast(state.role, "editor")) throw Error("Your role in this room cannot edit");
        const response = this.update(data.document, data.baseRevision);
        if (response.status !== 200)
          this.deliver(ws, { type: "conflict", ...(await response.json()) });
      } else if (data.type === "ops") {
        const batch = { ...data, client: state.client || data.client };
        const result =
          this.batchTooLarge(batch, size) ||
          (await this.applyBatch(batch, state.role, {
            id: state.accountId || state.client || state.id,
            name: state.name,
          }));
        if (result.ops.length) this.broadcast(result);
        else this.deliver(ws, result);
      } else if (data.type === "sync") {
        // A lazy client's snapshot: the pages it holds (or the active page), unless its revision
        // is current. `acked` drops the batches the room already applied.
        const acked = state.client
          ? (this.sql
              .exec("SELECT last_batch FROM clients WHERE client_id=?", state.client)
              .toArray()[0]?.last_batch ?? 0)
          : 0;
        const revision = this.row().revision;
        const pages = Array.isArray(data.pages)
          ? data.pages.filter(PAGE_ID).slice(0, MAX_PAGE_REQUEST)
          : [];
        // `same` carries what the client checks its copy against: the page index (node counts)
        // and digests of the pages it holds (web/room-sync.js `divergence`).
        this.deliver(
          ws,
          Number.isSafeInteger(data.revision) && data.revision === revision
            ? {
                type: "snapshot",
                same: true,
                revision,
                acked,
                ...this.batchState(state.client),
                pages: this.store.index(),
                ...this.contentDigests(pages),
              }
            : {
                type: "snapshot",
                ...this.lazySnapshot(pages),
                acked,
                ...this.batchState(state.client),
              },
        );
      } else if (data.type === "pages") {
        // Pages arrive on the socket that carries the operations, so a page reflects every
        // operation sent before it and the operations after it apply on top. One message per
        // page keeps each under the page limit.
        const ids = Array.isArray(data.ids) ? data.ids : [];
        const { revision, pages, missing } = this.readPages(ids);
        for (const page of pages) this.deliver(ws, { type: "pages", revision, pages: [page] });
        if (missing.length || !pages.length)
          this.deliver(ws, { type: "pages", revision, pages: [], missing });
      } else if (data.type === "presence") {
        const presence = {
          name: typeof data.name === "string" ? data.name.slice(0, 80) : "Guest",
          pageId: typeof data.pageId === "string" ? data.pageId.slice(0, 120) : null,
          cursor:
            data.cursor && Number.isFinite(data.cursor.x) && Number.isFinite(data.cursor.y)
              ? { x: data.cursor.x, y: data.cursor.y }
              : null,
        };
        ws.serializeAttachment({ ...state, ...presence, seen: Date.now() });
        this.presenceChanged(ws);
      } else if (data.type === "heartbeat") {
        // Nothing is broadcast: the socket is alive, and silent ones are closed.
        const now = Date.now();
        ws.serializeAttachment({ ...state, seen: now });
        this.pruneSilent(now);
      } else throw Error("Unknown message type");
    } catch (error) {
      this.deliver(ws, { type: "error", error: error.message });
    }
  }

  webSocketClose(ws) {
    const state = ws.deserializeAttachment();
    if (state?.id && !state.gone) this.presenceLeft([state.id], ws);
  }

  webSocketError(ws) {
    try {
      ws.close(1011, "Connection error");
    } catch {}
  }
}

export { ROLES };
