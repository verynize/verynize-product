// Account-scoped storage for preferences, individual transcripts and library organization.
// Account records live in the shared database, with revision checks; sessions and device settings stay local.
(() => {
  const records = new Map(),
    pending = new Map(),
    snapshots = new Map(),
    listeners = new Set();
  let identity = "",
    ready = false,
    syncing = null,
    timer,
    retryTimer,
    networkAttempts = 0,
    error = "",
    starting = true,
    hydrating = false;
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
    timer = setTimeout(() => sync(), 150);
    report("");
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
        entries("chat:")
          .map(([, row]) => row)
          .filter((row) => project === "unattached" || row.project === project)
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
        if (!chat?.id) continue;
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
  async function request(path, init = {}) {
    const a = account(),
      expected = identity;
    if (!a || scope() !== expected) throw Error("The cloud account changed");
    let response;
    try {
      response = await fetch(a.server + path, {
        ...init,
        headers: { "Content-Type": "application/json", "X-Verynize-Session": a.session },
      });
    } catch (failure) {
      if (failure instanceof TypeError) Object.assign(failure, { network: true });
      throw failure;
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
    return data;
  }
  async function sync() {
    if (!identity) return;
    if (syncing) return syncing;
    const expected = identity;
    syncing = (async () => {
      try {
        if (!ready) {
          const data = await request("/api/me/state");
          if (identity !== expected) return;
          window.cloudAccount?.applyProfile(data.account);
          for (const item of data.items) records.set(item.key, item);
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
        for (const [key, change] of Array.from(pending)) {
          let item;
          try {
            ({ item } = await request("/api/me/state/" + encodeURIComponent(key), {
              method: "PUT",
              body: JSON.stringify({ value: change.value, revision: change.revision }),
            }));
          } catch (failure) {
            if (failure.status !== 409) throw failure;
            const { items } = await request("/api/me/state");
            if (identity !== expected) return;
            const remote = items.find((item) => item.key === key);
            if (!remote) throw failure;
            const latest = pending.get(key);
            if (!latest) continue;
            records.set(key, remote);
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
        if (!pending.size) {
          // Local legacy copies are removed only after the database accepted their migration.
          for (const key of Object.keys(localStorage).filter(supported))
            localStorage.removeItem(key);
        }
        const { items, account: profile } = await request("/api/me/state");
        if (identity !== expected) return;
        window.cloudAccount?.applyProfile(profile);
        let changed = false;
        for (const item of items)
          if (!pending.has(item.key) && records.get(item.key)?.revision !== item.revision) {
            records.set(item.key, item);
            changed = true;
          }
        clearTimeout(retryTimer);
        networkAttempts = 0;
        report("");
        if (changed) emit();
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
    records.clear();
    pending.clear();
    snapshots.clear();
    report("");
    emit();
    void sync();
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
        await sync();
        if (!pending.size || error) break;
      }
      if (pending.size || error) throw Error(error || "Changes have not reached the database yet.");
    },
    refresh: sync,
    status: () => ({ ready, pending: pending.size, error }),
  };
  window.addEventListener("cloud-account-changed", changedAccount);
  const reconnect = () => {
    clearTimeout(retryTimer);
    networkAttempts = 0;
    void sync();
  };
  window.addEventListener("online", reconnect);
  window.addEventListener("focus", reconnect);
  window.addEventListener("beforeunload", (event) => {
    if (pending.size) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  setInterval(() => {
    if (!document.hidden && !networkAttempts) void sync();
  }, 3000);
  // Initial read happens after the legacy consumers have installed their listeners.
  identity = scope();
  window.addEventListener("DOMContentLoaded", () => {
    starting = false;
    void sync();
  });
})();
