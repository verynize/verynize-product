// Actors on Vercel (or any set of stateless Node instances): the Durable Object semantics the
// cloud code relies on, across instances. Design and failure modes: docs/deployment-vercel.md.
//
// - Any instance can run any actor. An event (fetch, RPC call, socket message or close) is a
//   *turn*: the instance takes the actor's lease in Redis (SET NX PX + an INCR fencing token),
//   claims the actor in libSQL with that fence, catches its local copy up, runs the actor code,
//   commits the changed rows with a fenced write, then delivers the turn's socket messages and
//   releases the lease. One turn per actor at a time, everywhere: single writer per room.
// - Persist before acknowledge: results, socket sends and broadcasts leave only after the
//   commit. A holder whose lease expired and was claimed by a newer fence cannot commit
//   (actor-store.js); its turn fails, nothing it computed is sent, its sockets reconnect.
// - Sockets stay on the instance that accepted them (Vercel pins a WebSocket to one instance).
//   The room's live sockets and their attachments are a Redis hash read with the lease; sends to
//   any socket, including local ones, are published on the owning instance's channel inside the
//   MULTI that releases the lease, so every socket sees the room's messages in commit order.
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { ActorCache, FencedError } from "./actor-store.js";
import { keys } from "./redis.js";

/** The WebSocket upgrade of the HTTP request being handled (set by handler.js). */
export const pendingUpgrade = new AsyncLocalStorage();
/** Marks the Response an actor returns after accepting an upgrade. */
export const UPGRADED = Symbol("verynize.vercel.upgraded");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class RetryTurn extends Error {}

/** A socket accepted by this instance (the `ws` connection lives here). */
class LocalSocket {
  constructor(coordinator, actor, id) {
    this.coordinator = coordinator;
    this.actor = actor;
    this.id = id;
    this.ws = null;
    this.queued = [];
    this.closedByServer = false;
    this.done = false;
  }
  /** A message or close published by the turn that produced it. */
  deliver(item) {
    if (!this.ws) return void this.queued.push(item);
    if (this.ws.readyState !== 1) return;
    try {
      if (item.c) {
        this.closedByServer = true;
        this.ws.close(...item.c);
      } else this.ws.send(item.b ? Buffer.from(item.b, "base64") : item.m);
    } catch {}
  }
  attach(ws) {
    this.ws = ws;
    ws.on("message", (data, binary) =>
      this.coordinator.socketEvent(
        this,
        "webSocketMessage",
        binary ? new Uint8Array(data).buffer : data.toString("utf8"),
      ),
    );
    ws.on("close", (code, reason) => this.#ended(code, reason.toString("utf8"), true));
    ws.on("error", (error) => this.coordinator.socketEvent(this, "webSocketError", error));
    for (const item of this.queued.splice(0)) this.deliver(item);
  }
  /** Close from this instance (lost lease, stale registry, shutdown); the client reconnects. */
  terminate(code, reason) {
    if (this.ws && this.ws.readyState === 1) this.ws.close(code, reason);
    else if (!this.ws) this.abandon();
  }
  /** The upgrade never completed: forget the socket. */
  abandon() {
    this.#ended(1006, "Upgrade failed", false);
  }
  #ended(code, reason, wasClean) {
    if (this.done) return;
    this.done = true;
    this.coordinator.sockets.delete(this.id);
    this.actor.sockets.delete(this);
    // A close the actor asked for already left the registry in that turn.
    if (!this.closedByServer && !this.coordinator.closing)
      this.coordinator.socketEvent(this, "webSocketClose", code, reason, wasClean);
  }
}

/** One event of one actor under its lease: socket registry view, outbox and accepted sockets. */
class Turn {
  constructor(coordinator, actor, lease, upgrade) {
    this.coordinator = coordinator;
    this.actor = actor;
    this.upgrade = upgrade;
    this.fence = lease.fence;
    this.entries = new Map();
    for (const [id, value] of lease.sockets) {
      const split = value.indexOf("|");
      const attachment = JSON.parse(value.slice(split + 1));
      this.entries.set(id, {
        instance: value.slice(0, split),
        attachment: attachment === null ? undefined : attachment,
      });
    }
    this.proxies = new Map();
    this.closed = new Set();
    this.removed = new Set();
    this.dirty = new Set();
    this.outbox = new Map();
    this.accepted = [];
  }

  #queue(instance, item) {
    let items = this.outbox.get(instance);
    if (!items) this.outbox.set(instance, (items = []));
    items.push(item);
  }

  proxy(id) {
    let proxy = this.proxies.get(id);
    if (proxy) return proxy;
    const turn = this;
    const entry = () => turn.entries.get(id);
    proxy = {
      send(message) {
        if (turn.closed.has(id) || turn.removed.has(id)) throw new Error("WebSocket is closed");
        turn.#queue(
          entry().instance,
          typeof message === "string"
            ? { s: id, m: message }
            : { s: id, b: Buffer.from(new Uint8Array(message)).toString("base64") },
        );
      },
      close(code = 1000, reason = "") {
        if (turn.closed.has(id)) return;
        turn.closed.add(id);
        turn.removed.add(id);
        turn.#queue(entry().instance, { s: id, c: [code, reason] });
      },
      serializeAttachment(value) {
        entry().attachment = value === undefined ? undefined : structuredClone(value);
        turn.dirty.add(id);
      },
      deserializeAttachment() {
        const value = entry()?.attachment;
        return value === undefined ? null : structuredClone(value);
      },
      get readyState() {
        return turn.closed.has(id) || turn.removed.has(id) ? 3 : 1;
      },
    };
    this.proxies.set(id, proxy);
    return proxy;
  }

  sockets() {
    return [...this.entries.keys()]
      .filter((id) => !this.removed.has(id))
      .map((id) => this.proxy(id));
  }

  acceptUpgrade() {
    const upgrade = this.upgrade;
    if (!upgrade || upgrade.socket) throw new Error("No WebSocket upgrade is pending");
    const id = crypto.randomUUID();
    const local = new LocalSocket(this.coordinator, this.actor, id);
    this.coordinator.sockets.set(id, local);
    this.actor.sockets.add(local);
    this.entries.set(id, { instance: this.coordinator.instance, attachment: undefined });
    this.dirty.add(id);
    this.accepted.push(local);
    upgrade.socket = local;
    const response = new Response(null, { status: 200 });
    response[UPGRADED] = true;
    return { socket: this.proxy(id), response };
  }

  /** After the commit: deliveries, registry changes and the release, in one MULTI. */
  finish(token) {
    const set = new Map();
    for (const id of this.dirty) {
      if (this.removed.has(id)) continue;
      const entry = this.entries.get(id);
      set.set(id, `${entry.instance}|${JSON.stringify(entry.attachment ?? null)}`);
    }
    return this.coordinator.redis.finishTurn({
      actor: this.actor.key,
      token,
      publish: [...this.outbox].map(([instance, items]) => [
        keys.channel(instance),
        JSON.stringify(items),
      ]),
      set,
      remove: this.removed,
    });
  }
}

/** This instance's state for one actor: its local copy, instance and event queue. */
class LocalActor {
  constructor(namespace, name) {
    this.namespace = namespace;
    this.name = name;
    this.key = `${namespace.className}/${name}`;
    this.cache = null;
    this.instance = null;
    this.turn = null;
    this.queue = Promise.resolve();
    this.sockets = new Set();
    this.busy = 0;
    this.lastUsed = Date.now();
  }
  reset() {
    this.cache?.close();
    this.cache = null;
    this.instance = null;
  }
}

class Namespace {
  constructor(coordinator, Class, className) {
    this.coordinator = coordinator;
    this.Class = Class;
    this.className = className;
    this.env = null;
  }
  bind(env) {
    this.env = env;
  }
  getByName(name) {
    name = String(name);
    const call = (method, args) =>
      this.coordinator.run(this, name, async (instance) => {
        if (method === "fetch") return instance.fetch(...args);
        if (typeof instance[method] !== "function" || method === "constructor")
          throw new TypeError(`The RPC receiver does not implement the method "${method}".`);
        return structuredClone(await instance[method](...structuredClone(args)));
      });
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
}

export class Coordinator {
  /**
   * @param {object} options
   * @param {import("./redis.js").RedisConnection} options.redis
   * @param {import("./actor-store.js").ActorStore} options.store
   * @param {number} [options.leaseMs] how long a crashed holder blocks its actor
   * @param {number} [options.aliveMs] how long a silent instance keeps its sockets registered
   * @param {{beforeCommit?(info: {actor: string}): Promise<void>|void}} [options.hooks] tests only
   */
  constructor({
    redis,
    store,
    leaseMs = 5000,
    aliveMs = 15000,
    idleMs = 60000,
    waitMs = 20000,
    hooks = {},
  }) {
    this.redis = redis;
    this.store = store;
    this.leaseMs = leaseMs;
    this.aliveMs = aliveMs;
    this.idleMs = idleMs;
    this.waitMs = waitMs;
    this.hooks = hooks;
    this.instance = crypto.randomUUID();
    this.actors = new Map();
    this.sockets = new Map();
    this.closing = false;
    this.timers = [];
  }

  /** Connect, create the shared tables and subscribe to this instance's channel. */
  start(prepare = async () => {}) {
    this.ready ||= (async () => {
      await this.redis.ready;
      await prepare();
      await this.store.init();
      this.subscriber = await this.redis.subscriber();
      // Pub/sub is at-most-once: after the subscriber reconnects, messages sent in between are
      // gone, so this instance's sockets reconnect and resynchronize from a snapshot.
      this.subscriber.on("reconnecting", () => this.#resync());
      await this.subscriber.subscribe(keys.channel(this.instance), (message) =>
        this.#delivered(message),
      );
      await this.redis.heartbeat(this.instance, this.aliveMs);
      const beat = setInterval(
        () => this.redis.heartbeat(this.instance, this.aliveMs).catch(() => {}),
        Math.max(250, Math.floor(this.aliveMs / 3)),
      );
      const sweep = setInterval(() => this.#sweep(), 15_000);
      for (const timer of [beat, sweep]) timer.unref?.();
      this.timers.push(beat, sweep);
    })();
    return this.ready;
  }

  #resync() {
    // Deleting the current entry while iterating a Map or Set is safe.
    for (const local of this.sockets.values()) local.terminate(1012, "Reconnect");
  }

  namespace(Class, className) {
    return new Namespace(this, Class, className);
  }

  #delivered(message) {
    let items;
    try {
      items = JSON.parse(message);
    } catch {
      return;
    }
    for (const item of items) this.sockets.get(item.s)?.deliver(item);
  }

  #actor(namespace, name) {
    const key = `${namespace.className}/${name}`;
    let actor = this.actors.get(key);
    if (!actor) this.actors.set(key, (actor = new LocalActor(namespace, name)));
    return actor;
  }

  /** Run fn(instance, turn) as one turn of the actor; turns of one actor run one at a time. */
  run(namespace, name, fn) {
    const actor = this.#actor(namespace, name);
    const upgrade = pendingUpgrade.getStore();
    actor.busy++;
    const result = actor.queue.then(() => this.#turn(actor, fn, upgrade));
    actor.queue = result.catch(() => {});
    return result.finally(() => {
      actor.busy--;
      actor.lastUsed = Date.now();
    });
  }

  /** A socket event: runs as a turn; errors are logged like a Durable Object handler's. */
  socketEvent(local, method, ...args) {
    if (this.closing) return;
    const { namespace, name } = local.actor;
    this.run(namespace, name, async (instance, turn) => {
      if (!turn.entries.has(local.id)) {
        // The registry dropped this socket (its instance looked dead): make the client reconnect.
        if (method === "webSocketMessage") local.terminate(1012, "Reconnect");
        return;
      }
      if (method === "webSocketClose") turn.removed.add(local.id);
      if (typeof instance[method] === "function")
        await instance[method](turn.proxy(local.id), ...args);
    }).catch((error) => console.error(`${namespace.className} ${method} failed`, error?.message));
  }

  async #acquire(key) {
    const deadline = Date.now() + this.waitMs;
    let delay = 2;
    for (;;) {
      const lease = await this.redis.acquire(key, this.instance, this.leaseMs);
      if (lease.taken) return lease;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for the lease of ${key}`);
      await sleep(Math.max(1, Math.min(delay, lease.wait)) + Math.random() * delay);
      delay = Math.min(delay * 2, 50);
    }
  }

  /** Claim the actor with this lease's fence and bring the local copy up to its last commit. */
  async #catchUp(actor, lease) {
    const since = actor.cache ? actor.cache.seq : -1;
    const { head, rows } = await this.store.claim(actor.key, lease.fence, since);
    if (head && head.fence > lease.fence) {
      // Redis lost its counters (restart without persistence): continue above the stored fence.
      await this.redis.raiseFence(actor.key, head.fence);
      throw new RetryTurn();
    }
    if (!head) {
      if (!actor.cache || actor.cache.seq !== 0) {
        actor.reset();
        actor.cache = new ActorCache();
      }
      return;
    }
    const cache = actor.cache;
    if (
      !cache ||
      cache.seq > head.seq ||
      cache.seq < head.schemaSeq ||
      cache.seq < head.purgedSeq
    ) {
      const all =
        since === -1 ? rows.filter((row) => row.data !== null) : await this.store.rows(actor.key);
      actor.reset();
      actor.cache = new ActorCache();
      actor.cache.load(head, all);
    } else if (cache.seq !== head.seq) {
      // Other instances committed: apply their rows and restart the instance on the new state,
      // like a Durable Object evicted and recreated.
      cache.apply(rows);
      cache.seq = head.seq;
      actor.instance = null;
    }
  }

  #construct(actor) {
    const ctx = {
      id: { name: actor.name, toString: () => actor.name },
      storage: {
        sync: async () => {
          const changes = actor.cache.collect();
          if (changes) {
            const seq = await this.store.commit(
              actor.key,
              actor.turn.fence,
              actor.cache.seq,
              changes,
            );
            actor.cache.committed(seq, changes.schema);
          }
        },
        transactionSync: (fn) => actor.cache.storage.transactionSync(fn),
        get sql() {
          return actor.cache.storage;
        },
      },
      getWebSockets: () => actor.turn.sockets(),
      acceptWebSocket: () => {
        throw new Error("Create sockets with acceptWebSocket(ctx) from #cloud-runtime");
      },
      acceptUpgrade: () => actor.turn.acceptUpgrade(),
      waitUntil: () => {},
    };
    actor.instance = new actor.namespace.Class(ctx, actor.namespace.env);
  }

  async #turn(actor, fn, upgrade) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#attempt(actor, fn, upgrade);
      } catch (error) {
        if (!(error instanceof RetryTurn) || attempt >= 3) throw error;
      }
    }
  }

  async #attempt(actor, fn, upgrade) {
    const lease = await this.#acquire(actor.key);
    let token = lease.token;
    const renew = setInterval(
      () => this.redis.renew(actor.key, lease.token, this.leaseMs).catch(() => {}),
      Math.max(100, Math.floor(this.leaseMs / 3)),
    );
    let turn = null;
    let outcome = null;
    try {
      await this.#catchUp(actor, lease);
      turn = actor.turn = new Turn(this, actor, lease, upgrade);
      // The constructor's writes (schema, migrations) belong to this turn.
      if (!actor.instance) this.#construct(actor);
      try {
        outcome = { value: await fn(actor.instance, turn) };
      } catch (error) {
        outcome = { error };
      }
      await this.hooks.beforeCommit?.({ actor: actor.key });
      const changes = actor.cache.collect();
      if (changes) {
        const seq = await this.store.commit(actor.key, lease.fence, actor.cache.seq, changes);
        actor.cache.committed(seq, changes.schema);
      }
      clearInterval(renew);
      await turn.finish(token);
      token = null;
    } catch (error) {
      if (error instanceof RetryTurn) throw error;
      // Storage or coordination failed: what this turn computed is lost, so is the local copy.
      // Its sockets reconnect and resend what was not acknowledged.
      if (error instanceof FencedError) this.hooks.fenced?.({ actor: actor.key });
      console.error(`${actor.namespace.className} turn failed`, error?.message);
      actor.reset();
      for (const local of turn?.accepted || []) local.abandon();
      for (const local of actor.sockets) local.terminate(1012, "Reconnect");
      throw error;
    } finally {
      clearInterval(renew);
      if (actor.turn === turn) actor.turn = null;
      if (token) await this.redis.release(actor.key, token).catch(() => {});
    }
    if (outcome.error) throw outcome.error;
    return outcome.value;
  }

  /** Forget local copies of actors without sockets or recent turns; they reload on demand. */
  #sweep() {
    const cutoff = Date.now() - this.idleMs;
    for (const [key, actor] of this.actors)
      if (!actor.sockets.size && !actor.busy && actor.lastUsed < cutoff) {
        actor.reset();
        this.actors.delete(key);
      }
  }

  /** Shut down: close local sockets (they reconnect elsewhere) and leave the registry. */
  async close() {
    this.closing = true;
    for (const timer of this.timers) clearInterval(timer);
    for (const local of this.sockets.values()) {
      try {
        local.ws?.close(1001, "Server shutting down");
      } catch {}
    }
    try {
      await this.redis.client.del(keys.alive(this.instance));
      await this.subscriber?.quit();
    } catch {}
    await this.redis.close();
    for (const actor of this.actors.values()) actor.reset();
  }
}
