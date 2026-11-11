// Account-scoped storage for preferences, individual transcripts and library organization.
// Account records live in the shared database, with revision checks; sessions and device settings stay local.
// Transcripts are not part of the account snapshot: the list holds each chat's summary and `load("chat:<id>")`
// fetches one transcript when it is opened. Later reads ask only for records changed since the last cursor
// (`?since=`, answered 304 when nothing changed), and only while the window is visible and focused.
(() => {
  const POLL_MS = 30000,
    MAX_POLL_MS = 5 * 60000,
    FOCUS_READ_MS = 5000;
  const records = new Map(),
    pending = new Map(),
    snapshots = new Map(),
    loading = new Map(),
    listeners = new Set();
  let identity = "",
    ready = false,
    syncing = null,
    syncReads = false,
    timer,
    retryTimer,
    pollTimer,
    pollDelay = POLL_MS,
    networkAttempts = 0,
    error = "",
    starting = true,
    hydrating = false,
    // null: a server without the change feed (whole snapshots, transcripts included).
    cursor = null,
    feed = { path: "", etag: "" },
    lastRead = 0,
    changes = 0;
  const account = () => {
    try {
      return JSON.parse(localStorage.getItem("verynize.cloud.account") || "null");
    } catch {
      return null;
    }
  };
  const scope = () => {
    const a = account();
    return a ? `${a.server}|${a.account.id}` : "";
  };
  const emit = () => {
    hydrating = true;
    try {
      for (const listener of listeners) listener();
      window.dispatchEvent(new CustomEvent("account-store-changed"));
    } finally {
      hydrating = false;
    }
  };
  const report = (message) => {
    error = message;
    window.dispatchEvent(
      new CustomEvent("account-sync-status", { detail: { error, pending: pending.size } }),
    );
  };
  const valueOf = (key) =>
    pending.has(key) ? pending.get(key).value : (records.get(key)?.value ?? null);
  const entries = (prefix) =>
    [...new Set([...records.keys(), ...pending.keys()])]
      .filter((key) => key.startsWith(prefix))
      .flatMap((key) => {
        const value = valueOf(key);
        if (value === null) return [];
        try {
          return [[key.slice(prefix.length), JSON.parse(value)]];
        } catch {
          return [];
        }
      });
  const put = (key, value) => {
    if (!identity || (!ready && (starting || hydrating)) || valueOf(key) === value) return;
    pending.set(key, {
      value,
      revision: pending.get(key)?.revision ?? records.get(key)?.revision ?? 0,
      base: pending.get(key)?.base ?? records.get(key)?.value ?? null,
    });
    clearTimeout(retryTimer);
    networkAttempts = 0;
    clearTimeout(timer);
    timer = setTimeout(() => sync(false), 150);
    report("");
  };
  // A chat of the list: its stored value, or, before `load`, its summary with no messages (`unloaded`).
  const chatRow = (key) => {
    try {
      const value = valueOf(key);
      if (value !== null) return JSON.parse(value);
      const summary = !pending.has(key) && records.get(key)?.summary;
      if (!summary) return null;
      const row = JSON.parse(summary);
      if (!row?.chat?.id) return null;
      return { project: row.project, chat: { ...row.chat, messages: [], unloaded: true } };
    } catch {
      return null;
    }
  };
  const supported = (key) =>
    key === "better-preferences" ||
    key === "better-agent-defaults" ||
    key.startsWith("better-agent-chats:") ||
    key.startsWith("better-agent-drafts:");
  function getItem(key) {
    if (!identity) return localStorage.getItem(key);
    if (!ready) return null;
    if (key === "better-agent-defaults") {
      const values = Object.fromEntries(entries("agent-default:"));
      const kind = window.verynizePlatform.kind;
      const agent = kind === "web" ? "openrouter" : values["agent@desktop"] || "codex";
      return JSON.stringify({
        agent,
        model: values["model@" + agent] ?? "",
        effort: values["effort@" + agent] ?? "",
        access: values.access ?? "edit",
        instructions: values.instructions ?? "",
      });
    }
    if (key === "better-preferences") {
      let device = {};
      try {
        device = JSON.parse(localStorage.getItem("verynize-device-preferences") || "{}");
      } catch {}
      return JSON.stringify({ ...device, ...Object.fromEntries(entries("preference:")) });
    }
    if (key.startsWith("better-agent-chats:")) {
      const project = key.slice("better-agent-chats:".length);
      return JSON.stringify(
        [...new Set([...records.keys(), ...pending.keys()])]
          .filter((name) => name.startsWith("chat:"))
          .map(chatRow)
          .filter((row) => row?.chat && (project === "unattached" || row.project === project))
          .map((row) => row.chat)
          .sort((a, b) => a.created - b.created),
      );
    }
    if (key.startsWith("better-agent-drafts:"))
      return JSON.stringify(Object.fromEntries(entries("draft:")));
    return localStorage.getItem(key);
  }
  function setItem(key, text) {
    if (!supported(key)) return localStorage.setItem(key, text);
    if (!identity) return localStorage.setItem(key, text);
    const previous = JSON.parse(snapshots.get(key) || "null");
    snapshots.set(key, text);
    if (!ready && (starting || hydrating)) return;
    const value = JSON.parse(text);
    if (key === "better-preferences")
      localStorage.setItem(
        "verynize-device-preferences",
        JSON.stringify({
          cloudServer: value.cloudServer || "",
          customSoundName: value.customSoundName || "",
        }),
      );
    if (key === "better-preferences" || key === "better-agent-defaults") {
      const prefix = key === "better-preferences" ? "preference:" : "agent-default:";
      for (const [name, item] of Object.entries(value)) {
        if (!ready && JSON.stringify(previous?.[name]) === JSON.stringify(item)) continue;
        // Server connection and provider availability belong to the current installation.
        if (name === "cloudServer" || name === "customSoundName") continue;
        const field =
          key === "better-agent-defaults"
            ? name === "agent"
              ? "agent@" + window.verynizePlatform.kind
              : ["model", "effort"].includes(name)
                ? name + "@" + value.agent
                : name
            : name;
        put(prefix + field, JSON.stringify(item));
      }
    } else if (key.startsWith("better-agent-chats:")) {
      const project = key.slice("better-agent-chats:".length);
      for (const chat of value) {
        // A summary without its transcript must never replace the stored chat.
        if (!chat?.id || chat.unloaded) continue;
        if (
          !ready &&
          JSON.stringify(previous?.find((c) => c.id === chat.id)) === JSON.stringify(chat)
        )
          continue;
        // Provider sessions, machine paths and permissions cannot be resumed on another machine.
        const {
          sessionId: _sessionId,
          forkFrom: _forkFrom,
          worktree: _worktree,
          dirs: _dirs,
          repoId: _repoId,
          ...transcript
        } = chat;
        const old = valueOf("chat:" + chat.id);
        const storedProject = old && JSON.parse(old).project;
        put(
          "chat:" + chat.id,
          JSON.stringify({ project: storedProject || project, chat: transcript }),
        );
      }
    } else {
      for (const [id, draft] of Object.entries(value)) put("draft:" + id, JSON.stringify(draft));
    }
  }
  // `{data, etag}`; `data` is null for 304 Not Modified (only possible with an If-None-Match `etag`).
  async function send(path, init = {}, etag = "") {
    const a = account(),
      expected = identity;
    if (!a || scope() !== expected) throw Error("The cloud account changed");
    let response;
    try {
      response = await fetch(a.server + path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          "X-Verynize-Session": a.session,
          ...(etag ? { "If-None-Match": etag } : {}),
        },
      });
    } catch (failure) {
      if (failure instanceof TypeError) Object.assign(failure, { network: true });
      throw failure;
    }
    const tag = response.headers.get("etag") || "";
    if (response.status === 304) {
      if (scope() !== expected) throw Error("The cloud account changed");
      return { data: null, etag: tag || etag };
    }
    const data = await response.json().catch((failure) => {
      if (!response.ok) return {};
      throw failure;
    });
    if (scope() !== expected) throw Error("The cloud account changed");
    if (!response.ok)
      throw Object.assign(Error(data.error || `Account sync failed (HTTP ${response.status})`), {
        status: response.status,
      });
    return { data, etag: tag };
  }
  const request = async (path, init) => (await send(path, init)).data;
  // A record from the server: chats arrive as summaries (`value` undefined) until loaded.
  const remember = (item) =>
    records.set(
      item.key,
      "summary" in item
        ? { key: item.key, revision: item.revision, summary: item.summary }
        : { key: item.key, value: item.value, revision: item.revision },
    );
  const record = (key) =>
    cursor === null
      ? request("/api/me/state").then(({ items }) => items.find((item) => item.key === key))
      : request("/api/me/state/" + encodeURIComponent(key)).then(
          ({ item }) => item,
          (failure) => {
            if (failure.status === 404) return undefined;
            throw failure;
          },
        );
  /** Fetch one record's value (a chat transcript when it is opened); emits once it arrived. */
  function load(key) {
    if (!identity) return Promise.resolve(null);
    if (loading.has(key)) return loading.get(key);
    const expected = identity;
    const promise = record(key)
      .then((item) => {
        if (identity !== expected || !item || pending.has(key)) return null;
        const known = records.get(key);
        if (typeof known?.value === "string" && known.revision >= item.revision) return known;
        remember(item);
        emit();
        return item;
      })
      .finally(() => loading.delete(key));
    loading.set(key, promise);
    return promise;
  }
  // Applies records read from the server; true when anything visible changed.
  function apply(items) {
    let changed = false;
    for (const item of items) {
      if (pending.has(item.key) || records.get(item.key)?.revision === item.revision) continue;
      // An open transcript stays readable until its new version arrived.
      if ("summary" in item && typeof records.get(item.key)?.value === "string") {
        void load(item.key).catch(() => {
          if (records.get(item.key)?.revision !== item.revision) {
            remember(item);
            emit();
          }
        });
        continue;
      }
      remember(item);
      changed = true;
    }
    return changed;
  }
  // Records changed since the cursor; a 304 means none (and an unchanged profile).
  async function readChanges(expected) {
    const path = cursor === null ? "/api/me/state" : `/api/me/state?chats=summary&since=${cursor}`;
    const { data, etag } = await send(path, {}, feed.path === path ? feed.etag : "");
    if (identity !== expected) return;
    lastRead = Date.now();
    if (!data) return;
    feed = { path, etag };
    window.cloudAccount?.applyProfile(data.account);
    if (typeof data.cursor === "number") cursor = data.cursor;
    if (apply(data.items)) {
      changes++;
      emit();
    }
  }
  // Match the server's aggregate value and request budgets; a full-size chat still fits alone.
  function writeBatches(entries) {
    const batches = [];
    let batch = [],
      bytes = 0,
      requestBytes = 14;
    const encoder = new TextEncoder();
    for (const [key, change] of entries) {
      const write = { key, value: change.value, revision: change.revision };
      const size = change.value === null ? 0 : encoder.encode(change.value).byteLength;
      const encoded = encoder.encode(JSON.stringify(write)).byteLength + 1;
      if (
        batch.length &&
        (batch.length === 64 ||
          bytes + size > 20 * 1024 * 1024 ||
          requestBytes + encoded > 40 * 1024 * 1024 + 1024)
      ) {
        batches.push(batch);
        batch = [];
        bytes = 0;
        requestBytes = 14;
      }
      batch.push([key, change]);
      bytes += size;
      requestBytes += encoded;
    }
    if (batch.length) batches.push(batch);
    return batches;
  }
  async function writeBatch(batch) {
    try {
      const { results } = await request("/api/me/state/batch", {
        method: "POST",
        body: JSON.stringify({
          writes: batch.map(([key, change]) => ({
            key,
            value: change.value,
            revision: change.revision,
          })),
        }),
      });
      return results;
    } catch (failure) {
      if (failure.status !== 404 && failure.status !== 405) throw failure;
      return null; // Older Workers still accept independent PUTs.
    }
  }
  async function sync(read = true) {
    if (!identity) return;
    // Readers share an active read. A sync that only writes still needs one follow-up read;
    // all waiting readers will join that read once it starts.
    if (syncing) return read && !syncReads ? syncing.then(() => sync(true)) : syncing;
    syncReads = read || !ready;
    const expected = identity;
    syncing = (async () => {
      try {
        let loaded = false;
        if (!ready) {
          const data = await request("/api/me/state?chats=summary");
          if (identity !== expected) return;
          loaded = true;
          lastRead = Date.now();
          window.cloudAccount?.applyProfile(data.account);
          // A server without the change feed ignores the query and sends whole records.
          cursor = typeof data.cursor === "number" ? data.cursor : null;
          feed = { path: "", etag: "" };
          for (const item of data.items) remember(item);
          for (const [key, change] of pending) {
            change.revision = records.get(key)?.revision ?? 0;
            change.base = records.get(key)?.value ?? null;
          }
          const earlyChanges = new Map(pending);
          ready = true;
          // Import legacy data once, and only where the database has no value yet.
          for (const key of Object.keys(localStorage).filter(supported)) {
            const before = new Map(pending);
            try {
              setItem(key, localStorage.getItem(key));
            } catch {}
            for (const name of pending.keys())
              if (records.has(name) && !before.has(name)) pending.delete(name);
          }
          try {
            const library = JSON.parse(localStorage.getItem("verynize-library-v1") || "{}");
            for (const folder of !library.accountId || library.accountId === account()?.account.id
              ? library.folders || []
              : [])
              if (!records.has("folder:" + folder.id))
                put("folder:" + folder.id, JSON.stringify(folder));
            for (const file of library.files || [])
              if (
                file.cloud &&
                (!file.cloud.accountId || file.cloud.accountId === account()?.account.id) &&
                !records.has("file:" + file.cloud.roomId)
              )
                put(
                  "file:" + file.cloud.roomId,
                  JSON.stringify({ folder: file.folder, archived: !!file.archived }),
                );
          } catch {}
          for (const [key, change] of earlyChanges) pending.set(key, change);
          emit();
        }
        // A snapshot: `pending` changes while each write is awaited.
        const sent = new Set(pending.values());
        for (const batch of writeBatches(Array.from(pending))) {
          const results = await writeBatch(batch);
          if (identity !== expected) return;
          for (const [key, change] of batch) {
            let item;
            try {
              if (results) {
                const result = results.find((entry) => entry.key === key);
                if (result?.conflict)
                  throw Object.assign(Error("Account state conflict"), {
                    status: 409,
                    current: { ...result.current, key },
                  });
                if (!result?.ok) throw Error("Missing account batch result");
                item = { key, value: change.value, revision: result.revision };
              } else
                ({ item } = await request("/api/me/state/" + encodeURIComponent(key), {
                  method: "PUT",
                  body: JSON.stringify({ value: change.value, revision: change.revision }),
                }));
            } catch (failure) {
              if (failure.status !== 409) throw failure;
              const remote = failure.current || (await record(key));
              if (identity !== expected) return;
              if (!remote) throw failure;
              const latest = pending.get(key);
              if (!latest) continue;
              remember(remote);
              if (latest.value === remote.value) pending.delete(key);
              else if (key.startsWith("chat:") && latest.value !== null) {
                // Two devices edited one transcript. Keep the server's history and save this
                // device's history as a separate conversation instead of losing either reply.
                const copy = JSON.parse(latest.value),
                  id = crypto.randomUUID();
                copy.chat = { ...copy.chat, id, title: `${copy.chat.title} (conflict copy)` };
                pending.delete(key);
                put("chat:" + id, JSON.stringify(copy));
              } else {
                let value = latest.value;
                if (key.startsWith("file:") && value !== null && remote.value !== null) {
                  const base = JSON.parse(latest.base || "{}"),
                    local = JSON.parse(value),
                    merged = JSON.parse(remote.value);
                  for (const field of Object.keys(local))
                    if (JSON.stringify(local[field]) !== JSON.stringify(base[field]))
                      merged[field] = local[field];
                  value = JSON.stringify(merged);
                }
                pending.set(key, { value, revision: remote.revision, base: remote.value });
              }
              emit();
              continue;
            }
            if (identity !== expected) return;
            records.set(key, item);
            if (pending.get(key) === change) pending.delete(key);
            else if (pending.has(key)) {
              pending.get(key).revision = item.revision;
              pending.get(key).base = item.value;
            }
          }
        }
        if (!pending.size) {
          // Local legacy copies are removed only after the database accepted their migration.
          for (const key of Object.keys(localStorage).filter(supported))
            localStorage.removeItem(key);
        }
        // Writes alone need no read: their responses carry the new revisions.
        if (read && !loaded) await readChanges(expected);
        if (identity !== expected) return;
        clearTimeout(retryTimer);
        networkAttempts = 0;
        report("");
        // Saves made while this sync ran, and conflicts rebased on the server's revision, go out next
        // (after `syncing` is cleared: a save during a sync only joined the one in flight).
        if ([...pending.values()].some((change) => !sent.has(change))) {
          clearTimeout(timer);
          timer = setTimeout(() => sync(false), 0);
        }
      } catch (e) {
        if (identity === expected) {
          clearTimeout(retryTimer);
          if (!e.network || !pending.size) networkAttempts = 0;
          if (e.network && pending.size && networkAttempts < 3) {
            const delay = 1000 * 2 ** networkAttempts++;
            retryTimer = setTimeout(() => {
              if (identity === expected && pending.size) void sync();
            }, delay);
          }
          report(
            e.status === 409
              ? "An item changed on another device. Your unsaved changes are still in this window."
              : e.network
                ? "Can't reach Verynize — changes are kept on this device and will retry when the connection returns. Keep this window open."
                : `Not saved to the database: ${e.message}`,
          );
        }
      }
    })().finally(() => {
      if (identity === expected) syncing = null;
    });
    return syncing;
  }
  function changedAccount() {
    const next = scope();
    if (next === identity) return;
    clearTimeout(timer);
    clearTimeout(retryTimer);
    networkAttempts = 0;
    identity = next;
    ready = false;
    syncing = null;
    cursor = null;
    feed = { path: "", etag: "" };
    records.clear();
    pending.clear();
    snapshots.clear();
    loading.clear();
    report("");
    emit();
    void sync();
    schedule(POLL_MS);
  }
  window.accountStore = {
    getItem,
    setItem,
    entries,
    put: (key, value) => {
      put(key, value === null ? null : JSON.stringify(value));
    },
    ready: () => ready,
    signedIn: () => !!identity,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    flush: async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await sync(false);
        if (!pending.size || error) break;
      }
      if (pending.size || error) throw Error(error || "Changes have not reached the database yet.");
    },
    /** Read what changed on other devices now. */
    refresh: () => sync(true),
    /** A record's full value, e.g. `load("chat:<id>")` when a chat opens; account-store-changed follows. */
    load,
    status: () => ({ ready, pending: pending.size, error }),
  };
  window.addEventListener("cloud-account-changed", changedAccount);
  // Reads only while someone looks at this window. Each read that finds nothing doubles the wait (up to
  // five minutes); a change, focus or reconnection starts again at thirty seconds.
  const watched = () => document.visibilityState === "visible" && document.hasFocus();
  function schedule(delay = pollDelay) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, delay);
  }
  async function poll() {
    pollTimer = 0;
    if (!identity || !watched()) return;
    if (!networkAttempts) {
      const before = changes;
      await sync(true);
      pollDelay = changes === before ? Math.min(MAX_POLL_MS, pollDelay * 2) : POLL_MS;
    }
    schedule();
  }
  const reconnect = () => {
    clearTimeout(retryTimer);
    networkAttempts = 0;
    pollDelay = POLL_MS;
    if (pending.size || Date.now() - lastRead > FOCUS_READ_MS) void sync(true);
    schedule();
  };
  window.addEventListener("online", reconnect);
  window.addEventListener("focus", reconnect);

  window.addEventListener("beforeunload", (event) => {
    if (pending.size) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  // Initial read happens after the legacy consumers have installed their listeners.
  identity = scope();
  window.addEventListener("DOMContentLoaded", () => {
    starting = false;
    void sync();
    schedule(POLL_MS);
  });
})();
