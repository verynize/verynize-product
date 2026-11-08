// Named provider accounts ("profiles") for Claude Code and Codex.
//
// Every profile owns a private configuration folder under `userData/agent-profiles/<agent>/<id>` (mode 0700).
// The provider CLI is pointed at it with its own documented variable, so each profile keeps a separate login:
//   Claude Code: CLAUDE_CONFIG_DIR=<folder>      Codex: CODEX_HOME=<folder>
// The built-in "This Mac" account (id `system`) is the user's normal ~/.claude / ~/.codex login.
//
// Verynize never reads credential files beyond display claims (email/plan, through agent-tools.cjs helpers)
// and never logs or returns tokens. The store is `userData/agent-profiles.json`:
//   {version:1, profiles:[{id, agent, name, createdAt}], defaults:{claude, codex}, chats:{<chatId>: {claude, codex}}}
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const AGENTS = ["claude", "codex"];
const SYSTEM = "system";
const ID = /^[a-z0-9]{8,40}$/;
const CHAT_ID = /^[a-zA-Z0-9-]{1,80}$/;
const MAX_PROFILES = 24;

function cleanName(value) {
  const name =
    typeof value === "string"
      ? value
          // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
          .replace(/[\u0000-\u001f]/g, " ")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 60)
      : "";
  if (!name) throw Error("Give the account a name");
  return name;
}
const checkAgent = (agent) => {
  if (!AGENTS.includes(agent)) throw Error("Choose Claude Code or Codex");
  return agent;
};
/** Environment that points a provider CLI at a profile folder. */
function profileEnv(agent, dir) {
  if (!dir) return {};
  return agent === "claude" ? { CLAUDE_CONFIG_DIR: dir } : { CODEX_HOME: dir };
}

class AgentProfiles {
  constructor({ userData } = {}) {
    if (!userData) throw Error("userData directory required");
    this.userData = userData;
    this.file = path.join(userData, "agent-profiles.json");
    this.root = path.join(userData, "agent-profiles");
    this.data = null;
    this.queue = Promise.resolve();
  }
  serial(fn) {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }
  dirOf(profile) {
    return path.join(this.root, profile.agent, profile.id);
  }
  async load() {
    if (this.data) return this.data;
    let data = { version: 1, profiles: [], defaults: { claude: SYSTEM, codex: SYSTEM }, chats: {} };
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (parsed && Array.isArray(parsed.profiles)) {
        data.profiles = parsed.profiles
          .filter(
            (p) => p && ID.test(p.id) && AGENTS.includes(p.agent) && typeof p.name === "string",
          )
          .slice(0, MAX_PROFILES);
        for (const agent of AGENTS) {
          const d = parsed.defaults?.[agent];
          if (d === SYSTEM || data.profiles.some((p) => p.id === d && p.agent === agent))
            data.defaults[agent] = d;
        }
        if (parsed.chats && typeof parsed.chats === "object")
          for (const [chatId, pick] of Object.entries(parsed.chats))
            if (CHAT_ID.test(chatId) && pick && typeof pick === "object")
              data.chats[chatId] = Object.fromEntries(
                AGENTS.filter((a) => typeof pick[a] === "string").map((a) => [a, pick[a]]),
              );
      }
    } catch {}
    this.data = data;
    return data;
  }
  async save() {
    await fs.mkdir(this.userData, { recursive: true });
    const temp = `${this.file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.data, null, 2) + "\n", { mode: 0o600 });
    await fs.rename(temp, this.file);
  }
  view(profile) {
    return {
      id: profile.id,
      agent: profile.agent,
      name: profile.name,
      createdAt: profile.createdAt,
      system: false,
    };
  }
  systemView(agent) {
    return { id: SYSTEM, agent, name: "This Mac", createdAt: 0, system: true };
  }

  /** {profiles:[…system rows first], defaults}. */
  async list() {
    const data = await this.load();
    return {
      profiles: [
        ...AGENTS.map((a) => this.systemView(a)),
        ...data.profiles.map((p) => this.view(p)),
      ],
      defaults: { ...data.defaults },
    };
  }
  add({ agent, name } = {}) {
    return this.serial(async () => {
      checkAgent(agent);
      const data = await this.load();
      if (data.profiles.length >= MAX_PROFILES)
        throw Error("Remove an account before adding another");
      const clean = cleanName(name);
      if (
        data.profiles.some(
          (p) => p.agent === agent && p.name.toLowerCase() === clean.toLowerCase(),
        ) ||
        clean.toLowerCase() === "this mac"
      )
        throw Error("An account with that name already exists");
      const profile = {
        id: crypto.randomBytes(8).toString("hex"),
        agent,
        name: clean,
        createdAt: Date.now(),
      };
      await fs.mkdir(this.dirOf(profile), { recursive: true, mode: 0o700 });
      await fs.chmod(this.dirOf(profile), 0o700);
      data.profiles.push(profile);
      await this.save();
      return this.view(profile);
    });
  }
  rename({ id, name } = {}) {
    return this.serial(async () => {
      const profile = await this.find(id);
      const clean = cleanName(name);
      const data = await this.load();
      if (
        data.profiles.some(
          (p) =>
            p !== profile &&
            p.agent === profile.agent &&
            p.name.toLowerCase() === clean.toLowerCase(),
        )
      )
        throw Error("An account with that name already exists");
      profile.name = clean;
      await this.save();
      return this.view(profile);
    });
  }
  /** Delete a profile and its private folder (its login goes with it). Chats that used it fall back to the default. */
  remove({ id } = {}) {
    return this.serial(async () => {
      const profile = await this.find(id);
      const data = await this.load();
      const dir = this.dirOf(profile);
      const relative = path.relative(this.root, dir);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
        throw Error("Refusing to remove a folder outside the account store");
      await fs.rm(dir, { recursive: true, force: true });
      data.profiles = data.profiles.filter((p) => p !== profile);
      for (const agent of AGENTS) if (data.defaults[agent] === id) data.defaults[agent] = SYSTEM;
      for (const pick of Object.values(data.chats))
        for (const agent of AGENTS) if (pick[agent] === id) delete pick[agent];
      await this.save();
      return { removed: true };
    });
  }
  setDefault({ agent, id } = {}) {
    return this.serial(async () => {
      checkAgent(agent);
      if (id !== SYSTEM) {
        const profile = await this.find(id);
        if (profile.agent !== agent) throw Error("That account belongs to another agent");
      }
      const data = await this.load();
      data.defaults[agent] = id;
      await this.save();
      return { defaults: { ...data.defaults } };
    });
  }
  /** Per-chat account choice. `id` null/undefined clears it (the default account is used). */
  setChat({ chatId, agent, id } = {}) {
    return this.serial(async () => {
      if (typeof chatId !== "string" || !CHAT_ID.test(chatId)) throw Error("Invalid chat");
      checkAgent(agent);
      if (id != null && id !== SYSTEM) {
        const profile = await this.find(id);
        if (profile.agent !== agent) throw Error("That account belongs to another agent");
      }
      const data = await this.load();
      const pick = { ...data.chats[chatId] };
      if (id == null) delete pick[agent];
      else pick[agent] = id;
      if (Object.keys(pick).length) data.chats[chatId] = pick;
      else delete data.chats[chatId];
      const keys = Object.keys(data.chats);
      if (keys.length > 2000)
        for (const key of keys.slice(0, keys.length - 2000)) delete data.chats[key];
      await this.save();
      return { chatId, accounts: { ...pick } };
    });
  }
  async chat(chatId) {
    const data = await this.load();
    return { ...data.chats[chatId] };
  }
  async find(id) {
    if (typeof id !== "string" || !ID.test(id)) throw Error("Choose an account");
    const profile = (await this.load()).profiles.find((p) => p.id === id);
    if (!profile) throw Error("That account no longer exists");
    return profile;
  }
  /**
   * The account a run uses: the explicit `id`, else the chat's pick, else the agent default.
   * Returns {id, name, agent, system, dir|null, env}. Unknown ids fall back to the default.
   */
  async resolve(agent, { id, chatId } = {}) {
    checkAgent(agent);
    const data = await this.load();
    const candidates = [id, chatId && data.chats[chatId]?.[agent], data.defaults[agent]];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (candidate === SYSTEM) return { ...this.systemView(agent), dir: null, env: {} };
      const profile = data.profiles.find((p) => p.id === candidate && p.agent === agent);
      if (profile) {
        const dir = this.dirOf(profile);
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        return { ...this.view(profile), dir, env: profileEnv(agent, dir) };
      }
    }
    return { ...this.systemView(agent), dir: null, env: {} };
  }
  /** Environment for a profile id (null/`system` = the computer's own login). */
  async envFor(agent, id) {
    if (!id || id === SYSTEM) return {};
    const profile = await this.find(id);
    if (profile.agent !== agent) throw Error("That account belongs to another agent");
    const dir = this.dirOf(profile);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    return profileEnv(agent, dir);
  }
}

/** Display account of a profile (email/plan claims only). */
async function profileAccount(agent, dir, { claudeStatus, executable, spawnProcess } = {}) {
  const tools = require("./agent-tools.cjs");
  const readJson = async (file) => {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      return null;
    }
  };
  // Codex: app-server `account/read` with the account's CODEX_HOME, auth.json claims only as a fallback.
  if (agent === "codex") return tools.codexAccount({ executable, codexHome: dir, spawnProcess });
  return tools.claudeAccountFrom(claudeStatus, await readJson(path.join(dir, ".claude.json")));
}

function registerAgentProfiles(handle, { userData, store = null, usage = null, siwc = null } = {}) {
  const profiles = store || new AgentProfiles({ userData });
  handle("agentProfilesList", () => profiles.list());
  handle("agentProfilesAdd", (options) => profiles.add(options || {}));
  handle("agentProfilesRename", (options) => profiles.rename(options || {}));
  handle("agentProfilesRemove", async (options) => {
    const profile = await profiles.find(options?.id);
    let signout;
    if (profile.agent === "codex" && siwc) {
      require("./agent-auth.cjs").accountChanged("codex", profile.id);
      signout = await siwc.logout(profile.id);
    }
    const result = await profiles.remove(options || {});
    usage?.forget?.(options?.id);
    return { ...result, ...(signout && !signout.revoked ? { message: signout.message } : {}) };
  });
  handle("agentProfilesSetDefault", (options) => profiles.setDefault(options || {}));
  handle("agentProfilesSetChat", (options) => profiles.setChat(options || {}));
  handle("agentProfilesChat", (options) =>
    profiles.chat(typeof options?.chatId === "string" ? options.chatId : ""),
  );
  return profiles;
}

module.exports = {
  AgentProfiles,
  registerAgentProfiles,
  profileEnv,
  profileAccount,
  SYSTEM,
  AGENTS,
};
