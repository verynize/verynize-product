// Composer indicators (web/src/islands/chat/tools-popover.tsx, usage-ring.tsx): what a chat's agent reports
// about itself right now.
//
// - MCP servers ("Tools"): while a chat's run is open, the agent runtime's own answer — Claude Agent SDK
//   `mcpServerStatus()`, Codex app-server `mcpServerStatus/list` (codex-cli 0.165). Before the agent starts,
//   the configured list: Verynize's own design server plus the user's servers from desktop/agent-tools.cjs
//   (config files only, no CLI is run), all "not started".
// - Context breakdown: Claude `getContextUsage({detail:'summary'})` while the run is open (no token-count calls).
//
// Status events streamed during a run (`mcp-status`) come from desktop/agent-runtime-events.cjs.
const settings = require("./agent-settings.cjs");
const { AgentTools } = require("./agent-tools.cjs");
const { mcpServers } = require("./agent-runtime-events.cjs");

const TIMEOUT = 15000;
const AGENTS = ["claude", "codex"];
const BUILT_IN = settings.MCP_SERVER_NAME;

const timed = (promise, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(Error(label + " timed out")), TIMEOUT);
      t.unref?.();
    }),
  ]);
const builtInFirst = (servers) => {
  const out = servers.map((s) => (s.name === BUILT_IN ? { ...s, builtIn: true } : s));
  return [...out.filter((s) => s.builtIn), ...out.filter((s) => !s.builtIn)];
};

/** Codex `mcpServerStatus/list` response -> [{name, status, error?}]. */
const codexServers = (response) => mcpServers(Array.isArray(response?.data) ? response.data : []);

/** Claude `getContextUsage()` response -> {totalTokens, maxTokens, percentage, categories:[{id?, name, tokens, kind}]}. */
function contextBreakdown(value) {
  if (!value || typeof value !== "object") return null;
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const categories = (Array.isArray(value.categories) ? value.categories : [])
    .filter(
      (c) =>
        c &&
        typeof c.name === "string" &&
        n(c.tokens) !== undefined &&
        c.tokens > 0 &&
        c.kind !== "deferred" &&
        !c.isDeferred,
    )
    .map((c) => ({
      ...(typeof c.id === "string" ? { id: c.id } : {}),
      name: c.name.slice(0, 80),
      tokens: c.tokens,
      kind: ["used", "free", "buffer"].includes(c.kind) ? c.kind : "used",
    }));
  const maxTokens = n(value.rawMaxTokens) ?? n(value.maxTokens);
  return {
    totalTokens: n(value.totalTokens) ?? 0,
    ...(maxTokens ? { maxTokens } : {}),
    ...(n(value.percentage) !== undefined ? { percentage: value.percentage } : {}),
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    categories,
  };
}

class AgentLiveStatus {
  constructor({ getRuntime = () => null, tools = new AgentTools() } = {}) {
    Object.assign(this, { getRuntime, tools });
  }
  run(chatId) {
    if (typeof chatId !== "string" || !chatId) return null;
    const runs = this.getRuntime()?.runs;
    return runs
      ? [...runs.values()].find((r) => r.chatId === chatId && !r.done && !r.helper) || null
      : null;
  }
  /** {agent, live, servers:[{name, status, error?, builtIn?}], error?}. */
  async mcp({ agent, chatId } = {}) {
    const run = this.run(chatId);
    if (run && typeof run.mcpStatus === "function") {
      try {
        const raw = await timed(
          Promise.resolve().then(() => run.mcpStatus()),
          "MCP status",
        );
        return {
          agent: run.agent,
          live: true,
          servers: builtInFirst(run.agent === "codex" ? codexServers(raw) : mcpServers(raw)),
        };
      } catch (error) {
        return {
          ...(await this.configured(run.agent)),
          error: String(error?.message || error).slice(0, 200),
        };
      }
    }
    return this.configured(AGENTS.includes(agent) ? agent : "claude");
  }
  async configured(agent) {
    let servers = [];
    try {
      servers = (await this.tools.listServers({ agent, check: false })).servers || [];
    } catch {}
    const listed = servers
      .filter((s) => s?.name && s.name !== BUILT_IN)
      .map((s) => ({
        name: String(s.name),
        status: s.enabled === false || s.status === "disabled" ? "disabled" : "not-started",
      }));
    return {
      agent,
      live: false,
      servers: [{ name: BUILT_IN, status: "not-started", builtIn: true }, ...listed],
    };
  }
  /** Context breakdown of the chat's open Claude run, or null. */
  async context({ chatId } = {}) {
    const run = this.run(chatId);
    if (!run || typeof run.contextUsage !== "function") return null;
    try {
      return contextBreakdown(
        await timed(
          Promise.resolve().then(() => run.contextUsage()),
          "Context usage",
        ),
      );
    } catch {
      return null;
    }
  }
}

function registerAgentLiveStatus(handle, { getRuntime } = {}) {
  const status = new AgentLiveStatus({ getRuntime });
  handle("agentLiveMcpStatus", (options) => status.mcp(options || {}));
  handle("agentLiveContext", (options) => status.context(options || {}));
  return status;
}

module.exports = { AgentLiveStatus, registerAgentLiveStatus, codexServers, contextBreakdown };
