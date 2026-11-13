// In-process actors on Node: the Durable Object semantics the cloud code relies on, for one
// server process. Contract and multi-instance notes: cloud/platform/README.md.
//
// - One instance per (class, name), created on first use with its own SQLite file
//   (<dir>/<name>.sqlite) and kept while it has sockets or recent traffic.
// - Stubs: `namespace.getByName(name)` returns `fetch(request)` plus RPC methods. RPC arguments and
//   results are structured-cloned, like Cloudflare RPC, and every result waits for the actor's
//   storage to commit (persist before acknowledging).
// - Sequencing: Node runs one event at a time and actor storage is synchronous, so the code between
//   two awaits of an event runs alone and its writes commit atomically (sql-storage.js).
// - WebSockets: the hibernation API (acceptWebSocket, getWebSockets, serializeAttachment,
//   webSocketMessage/Close/Error). Sends wait behind the storage gate, in order.
import crypto from "node:crypto";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { openDatabase } from "./sqlite.js";
import { SqlStorage } from "./sql-storage.js";

/** The WebSocket upgrade of the HTTP request being handled (set by server.js). */
export const pendingUpgrade = new AsyncLocalStorage();
/** Marks the Response an actor returns after accepting an upgrade (status 101 is not constructible). */
export const UPGRADED = Symbol("verynize.upgraded");

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const IDLE_MS = 60_000;

/** The server side of an accepted WebSocket, as an actor sees it. */
class ActorSocket {
  #actor;
  #ws = null;
  #queued = [];
  #attachment;
  #closed = false;

  constructor(actor) {
    this.#actor = actor;
  }
  serializeAttachment(value) {
    this.#attachment = value === undefined ? undefined : structuredClone(value);
  }
  deserializeAttachment() {
    return this.#attachment === undefined ? null : structuredClone(this.#attachment);
  }
  get readyState() {
    if (this.#closed) return 3;
    return this.#ws ? this.#ws.readyState : 0;
  }
  send(message) {
    if (this.#closed) throw new Error("WebSocket is closed");
    this.#actor.storage.gate(() => this.#deliver({ message }));
  }
  close(code, reason) {
    if (this.#closed) return;
    this.#closed = true;
    this.#actor.sockets.delete(this);
    this.#actor.storage.gate(() => this.#deliver({ close: [code, reason] }));
  }
  #deliver(item) {
    if (!this.#ws) return void this.#queued.push(item);
    if (this.#ws.readyState !== 1) return;
    try {
      if (item.close) this.#ws.close(...item.close);
      else this.#ws.send(item.message);
    } catch {}
  }
  /** Bind the accepted `ws` connection: queued frames go out, events reach the actor. */
  attach(ws) {
    this.#ws = ws;
    for (const item of this.#queued.splice(0)) this.#deliver(item);
    ws.on("message", (data, binary) =>
      this.#actor.event(
        "webSocketMessage",
        this,
        binary ? new Uint8Array(data).buffer : data.toString("utf8"),
      ),
    );
    ws.on("close", (code, reason) => {
      const known = this.#actor.sockets.delete(this);
      this.#closed = true;
      if (known) this.#actor.event("webSocketClose", this, code, reason.toString("utf8"), true);
    });
    ws.on("error", (error) => this.#actor.event("webSocketError", this, error));
  }
  /** The upgrade never completed (client went away): forget the socket. */
  abandon() {
    this.#closed = true;
    if (this.#actor.sockets.delete(this))
      this.#actor.event("webSocketClose", this, 1006, "Upgrade failed", false);
  }
}

class Actor {
  constructor(namespace, name) {
    this.namespace = namespace;
    this.name = name;
    this.sockets = new Set();
    this.busy = 0;
    this.lastUsed = Date.now();
    this.db = openDatabase(namespace.fileFor(name));
    this.storage = new SqlStorage(this.db, { onError: (error) => this.fail(error) });
    const actor = this;
    this.ctx = {
      id: { name, toString: () => name },
      storage: {
        sql: this.storage,
        sync: async () => actor.storage.commit(),
        transactionSync: (fn) => actor.storage.transactionSync(fn),
      },
      getWebSockets: () => [...actor.sockets],
      acceptWebSocket: () => {
        throw new Error("Create sockets with acceptWebSocket(ctx) from #cloud-runtime");
      },
      acceptUpgrade: () => actor.acceptUpgrade(),
      // Work that outlives the call (a model API run in AiRun) keeps the instance from the sweep.
      waitUntil: (promise) => {
        actor.busy++;
        Promise.resolve(promise)
          .catch(() => {})
          .finally(() => {
            actor.busy--;
            actor.lastUsed = Date.now();
          });
      },
    };
    // Alarms: one per actor, a process timer (not durable: a restart drops it, and the work it
    // watched is gone with the process too). Kept by the namespace, so eviction does not drop it.
    Object.assign(this.ctx.storage, {
      setAlarm: async (time) => namespace.setAlarm(name, Number(time)),
      getAlarm: async () => namespace.alarms.get(name)?.time ?? null,
      deleteAlarm: async () => namespace.clearAlarm(name),
    });
    this.instance = new namespace.Class(this.ctx, namespace.env);
    this.storage.commit();
  }

  acceptUpgrade() {
    const upgrade = pendingUpgrade.getStore();
    if (!upgrade || upgrade.socket) throw new Error("No WebSocket upgrade is pending");
    const socket = new ActorSocket(this);
    this.sockets.add(socket);
    upgrade.socket = socket;
    const response = new Response(null, { status: 200 });
    response[UPGRADED] = true;
    return { socket, response };
  }

  /** Run a method of the instance; its result is released once storage has committed. */
  async call(method, args) {
    this.busy++;
    this.lastUsed = Date.now();
    try {
      const result = await this.instance[method](...args);
      this.storage.commit();
      return result;
    } finally {
      this.busy--;
      this.lastUsed = Date.now();
    }
  }

  /** WebSocket events: errors are the actor's to report, like a Durable Object handler. */
  event(method, ...args) {
    if (typeof this.instance[method] !== "function") return;
    this.call(method, args).catch((error) =>
      console.error(`${this.namespace.Class.name} ${method} failed`, error?.message),
    );
  }

  /** A failed commit: the instance's memory no longer matches storage, so it is discarded. */
  fail(error) {
    console.error(`${this.namespace.Class.name} storage commit failed`, error?.message);
    for (const socket of this.sockets) {
      try {
        socket.close(1011, "Internal error");
      } catch {}
    }
    this.namespace.evict(this.name);
  }

  close() {
    for (const socket of this.sockets) {
      try {
        socket.close(1001, "Server shutting down");
      } catch {}
    }
    try {
      this.storage.close();
    } catch {}
  }
}

export class ActorNamespace {
  /**
   * @param {object} options
   * @param {Function} options.Class the Durable Object class (extends #cloud-runtime DurableObject)
   * @param {string} options.directory where each actor's SQLite file lives
   */
  constructor({ Class, directory }) {
    this.Class = Class;
    this.directory = directory;
    this.env = null;
    this.actors = new Map();
    this.alarms = new Map();
    this.sweeper = setInterval(() => this.sweep(), 15_000);
    this.sweeper.unref();
  }

  /** The environment handed to every instance (set once the whole env exists). */
  bind(env) {
    this.env = env;
  }

  fileFor(name) {
    const safe = SAFE_NAME.test(name)
      ? name
      : "h-" + crypto.createHash("sha256").update(name).digest("hex");
    return path.join(this.directory, `${safe}.sqlite`);
  }

  actor(name) {
    let actor = this.actors.get(name);
    if (!actor) {
      actor = new Actor(this, name);
      this.actors.set(name, actor);
    }
    return actor;
  }

  getByName(name) {
    name = String(name);
    const call = async (method, args) => {
      const actor = this.actor(name);
      if (method === "fetch") return actor.call("fetch", args);
      if (typeof actor.instance[method] !== "function" || method === "constructor")
        throw new TypeError(`The RPC receiver does not implement the method "${method}".`);
      return structuredClone(await actor.call(method, structuredClone(args)));
    };
    return new Proxy(
      {},
      {
        get(_target, method) {
          if (typeof method !== "string" || method === "then") return undefined;
          return (...args) => call(method, args);
        },
      },
    );
  }

  setAlarm(name, time) {
    this.clearAlarm(name);
    const timer = setTimeout(
      () => {
        this.alarms.delete(name);
        this.actor(name).event("alarm");
      },
      Math.max(0, time - Date.now()),
    );
    timer.unref?.();
    this.alarms.set(name, { time, timer });
  }

  clearAlarm(name) {
    const alarm = this.alarms.get(name);
    if (alarm) clearTimeout(alarm.timer);
    this.alarms.delete(name);
  }

  evict(name) {
    const actor = this.actors.get(name);
    if (!actor) return;
    this.actors.delete(name);
    actor.close();
  }

  /** Close actors without sockets or work after a minute; they reopen from storage on demand. */
  sweep() {
    const cutoff = Date.now() - IDLE_MS;
    for (const [name, actor] of this.actors)
      if (!actor.sockets.size && !actor.busy && actor.lastUsed < cutoff) this.evict(name);
  }

  close() {
    clearInterval(this.sweeper);
    for (const name of this.alarms.keys()) this.clearAlarm(name);
    for (const name of this.actors.keys()) this.evict(name);
  }
}
