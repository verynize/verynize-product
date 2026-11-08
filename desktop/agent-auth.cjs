const { onWindowClosed } = require("./window-cleanup.cjs");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const os = require("node:os");
const agents = require("./agents.cjs");
const { EventEmitter } = require("node:events");
// Sign-in state changes ({agent, profile}) after a completed login or a logout: the chat runtime forgets its cached
// Codex sign-in for that account (desktop/agent-runtime.cjs invalidateCodexAuth).
const accountChanges = new EventEmitter();
accountChanges.setMaxListeners(0);
function onAccountChange(listener) {
  accountChanges.on("change", listener);
  return () => accountChanges.off("change", listener);
}
function accountChanged(agent, profile) {
  accountChanges.emit("change", {
    agent,
    profile: profile && profile !== "system" ? profile : "system",
  });
}
const COMMANDS = {
  codex: { status: ["login", "status"], login: ["login"], logout: ["logout"] },
  claude: {
    status: ["auth", "status", "--json"],
    login: ["auth", "login"],
    logout: ["auth", "logout"],
  },
};
function checkAgent(value) {
  if (!value || !Object.hasOwn(COMMANDS, value)) throw Error("Choose Codex or Claude");
  return value;
}
// `extra`: a named account's CLAUDE_CONFIG_DIR / CODEX_HOME (desktop/agent-profiles.cjs); empty for the computer's own login.
function childOptions(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return {
    cwd: os.tmpdir(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  };
}
function terminate(child) {
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch {}
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {}
    }
  }, 1500);
  timer.unref();
}
function bounded(executable, args, spawnProcess = spawn, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(executable, args, childOptions(extra));
    let output = "",
      ended = false;
    const timer = setTimeout(() => {
      terminate(child);
      finish(Error("Account operation timed out"));
    }, 10000);
    const finish = (error, value) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const chunk = (data) => {
      output += data.toString();
      if (Buffer.byteLength(output) > 32768) {
        terminate(child);
        finish(Error("Account operation produced excessive output"));
      }
    };
    child.stdout.on("data", chunk);
    child.stderr.on("data", chunk);
    child.on("error", () => finish(Error("Unable to start installed agent CLI")));
    child.on("close", (code) => finish(null, { code, output }));
  });
}
class AgentAuth {
  constructor({
    discover = agents.discover,
    spawnProcess = spawn,
    emit = () => {},
    profileEnv = null,
    profileAccount = null,
    siwc = null,
  } = {}) {
    this.siwc = siwc;
    this.siwcLogins = new Set();
    this.discover = discover;
    this.spawnProcess = spawnProcess;
    this.emit = emit;
    this.profileEnv = profileEnv;
    this.profileAccount = profileAccount;
    this.pending = new Map();
    this.reserved = new Set();
  }
  /** Environment for a named account (`profile` id); {} for the computer's own login. */
  async envFor(agent, profile) {
    if (!profile || profile === "system") return {};
    if (!this.profileEnv) throw Error("Named accounts are not available");
    return this.profileEnv(agent, profile);
  }
  key(agent, profile) {
    return profile && profile !== "system" ? agent + ":" + profile : agent;
  }
  async executable(agent) {
    checkAgent(agent);
    return (await this.discover()).find((item) => item.id === agent && item.available)?.path;
  }
  async status({ agent, profile } = {}) {
    checkAgent(agent);
    if (agent === "codex" && this.siwc) {
      const executable = await this.executable(agent);
      const status = await this.siwc.status(profile || "system");
      return { agent, installed: !!executable, ...status, ...(profile ? { profile } : {}) };
    }
    const extra = await this.envFor(agent, profile);
    const named = Object.keys(extra).length > 0;
    const executable = await this.executable(agent);
    if (!executable) return { agent, installed: false, loggedIn: false, method: "unavailable" };
    const result = await bounded(executable, COMMANDS[agent].status, this.spawnProcess, extra);
    let loggedIn = result.code === 0,
      method = loggedIn ? "CLI account" : "signed out";
    if (agent === "claude") {
      try {
        const json = JSON.parse(result.output);
        loggedIn = json.loggedIn === true;
        method = loggedIn
          ? ["claude.ai", "oauth_token", "api_key", "api_key_helper", "third_party"].includes(
              json.authMethod,
            )
            ? json.authMethod
            : "CLI account"
          : "signed out";
      } catch {
        method = loggedIn ? "CLI account" : "unknown";
      }
    } else if (loggedIn) {
      if (/ChatGPT/i.test(result.output)) method = "ChatGPT";
      else if (/API key/i.test(result.output)) method = "API key";
      else if (/workload identity/i.test(result.output)) method = "Workload identity";
      else if (/access token/i.test(result.output)) method = "Access token";
    }
    if (!named) return { agent, installed: true, loggedIn, method };
    let account = null;
    if (loggedIn && this.profileAccount) {
      let parsed = null;
      if (agent === "claude") {
        try {
          parsed = JSON.parse(result.output);
        } catch {}
      }
      account = await this.profileAccount(agent, Object.values(extra)[0], {
        claudeStatus: parsed,
        executable,
        spawnProcess: this.spawnProcess,
      }).catch(() => null);
    }
    return {
      agent,
      installed: true,
      loggedIn,
      method,
      profile,
      configDir: Object.values(extra)[0],
      ...(account ? { email: account.email || "", plan: account.plan || "" } : {}),
    };
  }
  async login({ agent, profile } = {}) {
    checkAgent(agent);
    if (agent === "codex" && this.siwc) {
      if (!(await this.executable(agent))) throw Error("Codex CLI is not installed");
      const result = await this.siwc.login(profile || "system", (event) => {
        if (!["started", "waiting"].includes(event.type)) this.siwcLogins.delete(event.id);
        if (event.type === "complete") accountChanged("codex", profile);
        this.emit(event);
      });
      this.siwcLogins.add(result.id);
      return result;
    }
    const extra = await this.envFor(agent, profile);
    const slot = this.key(agent, profile);
    if (this.reserved.has(slot))
      throw Error("An account operation is already running for this agent");
    this.reserved.add(slot);
    let child, id;
    try {
      const executable = await this.executable(agent);
      if (!executable) throw Error("Agent CLI is not installed");
      id = randomUUID();
      child = this.spawnProcess(executable, COMMANDS[agent].login, childOptions(extra));
      let ended = false,
        waiting = false;
      const timer = setTimeout(() => {
        terminate(child);
        finish("error", "Sign-in timed out. Retry from the agent CLI.");
      }, 300000);
      const finish = (type, message, code) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        this.pending.delete(id);
        this.reserved.delete(slot);
        if (type === "complete") accountChanged(agent, profile);
        this.emit({
          id,
          agent,
          ...(profile && profile !== "system" ? { profile } : {}),
          type,
          message,
          ...(code !== undefined ? { code } : {}),
        });
      };
      this.pending.set(id, {
        agent,
        child,
        cancel: () => {
          terminate(child);
          finish("canceled", "Sign-in canceled. Check the current CLI account status.");
        },
      });
      this.emit({
        id,
        agent,
        ...(profile && profile !== "system" ? { profile } : {}),
        type: "started",
        message: "Starting the installed CLI browser sign-in flow.",
      });
      const progress = () => {
        if (!waiting && !ended) {
          waiting = true;
          this.emit({
            id,
            agent,
            ...(profile && profile !== "system" ? { profile } : {}),
            type: "waiting",
            message:
              "Complete sign-in in the browser opened by the CLI. If no browser opens, run the CLI login command in your terminal.",
          });
        }
      };
      child.stdout.on("data", progress);
      child.stderr.on("data", progress);
      child.on("error", () => finish("error", "Unable to start agent sign-in."));
      child.on("close", (code) =>
        finish(
          code === 0 ? "complete" : "error",
          code === 0 ? "CLI sign-in completed." : "CLI sign-in did not complete.",
          code,
        ),
      );
      return { id, agent, ...(profile && profile !== "system" ? { profile } : {}) };
    } catch (error) {
      this.reserved.delete(slot);
      if (child) terminate(child);
      throw error;
    }
  }
  cancel({ id } = {}) {
    if (typeof id !== "string") throw Error("A sign-in identifier is required");
    const active = this.pending.get(id);
    active?.cancel();
    return { canceled: !!active || !!this.siwc?.cancel(id).canceled };
  }
  async logout({ agent, profile } = {}) {
    checkAgent(agent);
    if (agent === "codex" && this.siwc) {
      accountChanged("codex", profile);
      const result = await this.siwc.logout(profile || "system");
      accountChanged("codex", profile);
      return result;
    }
    const extra = await this.envFor(agent, profile);
    const slot = this.key(agent, profile);
    if (this.reserved.has(slot)) throw Error("Cancel pending sign-in before signing out");
    this.reserved.add(slot);
    try {
      const executable = await this.executable(agent);
      if (!executable) throw Error("Agent CLI is not installed");
      const result = await bounded(executable, COMMANDS[agent].logout, this.spawnProcess, extra);
      accountChanged(agent, profile);
      if (result.code !== 0) throw Error("CLI sign-out failed");
      return { loggedOut: true };
    } finally {
      this.reserved.delete(slot);
    }
  }
  close() {
    for (const id of this.siwcLogins) this.siwc?.cancel(id);
    this.siwcLogins.clear();
    for (const operation of [...this.pending.values()]) operation.cancel();
  }
}
function registerAgentAuth(handle, parent, { profiles = null, siwc = null } = {}) {
  const auth = new AgentAuth({
    siwc,
    emit: (event) => {
      if (!parent.isDestroyed()) parent.webContents.send("desktop:auth-event", event);
    },
    ...(profiles
      ? {
          profileEnv: (agent, id) => profiles.envFor(agent, id),
          profileAccount: (agent, dir, extra) =>
            require("./agent-profiles.cjs").profileAccount(agent, dir, extra),
        }
      : {}),
  });
  handle("agentAccountStatus", (options) => auth.status(options));
  handle("startAgentLogin", (options) => auth.login(options));
  handle("cancelAgentLogin", (options) => auth.cancel(options));
  handle("agentLogout", (options) => auth.logout(options));
  onWindowClosed(parent, () => auth.close());
  return auth;
}
module.exports = {
  AgentAuth,
  registerAgentAuth,
  COMMANDS,
  bounded,
  onAccountChange,
  accountChanged,
};
