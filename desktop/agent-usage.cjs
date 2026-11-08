// Settings › Usage: plan limits of the user's own Claude Code and Codex accounts, plus Verynize's
// local AI-generated layer count.
//
// - Claude Code: the Agent SDK's structured `/usage` data (`usage_EXPERIMENTAL…({skipBehaviors})`)
//   and `accountInfo()`, read through the user's installed `claude` and its own login. No token
//   is read by Verynize; nothing secret crosses IPC.
// - Codex: `codex app-server` JSON-RPC `account/read` and `account/rateLimits/read` (codex-cli 0.165,
//   checked with `codex app-server generate-ts`).
// - Verynize: nodes added to a document by MCP tool edits (desktop/mcp-bridge.cjs), bucketed by
//   local week in userData/agent-usage.json. There is no quota.
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const agents = require("./agents.cjs");

const FETCH_TIMEOUT = 20000;
const CACHE_MS = 60000;
const WEEKS_KEPT = 12;

const num = (value) => {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};
const percent = (value) => {
  const n = num(value);
  return n === undefined ? undefined : Math.max(0, Math.min(100, Math.round(n * 10) / 10));
};
const isoMs = (value) => {
  if (typeof value !== "string" || !value) return undefined;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : undefined;
};
const epochMs = (value) => {
  const n = num(value);
  return n === undefined ? undefined : n < 1e12 ? Math.round(n * 1000) : n;
};
const titleCase = (value) =>
  String(value || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

// --- Claude --------------------------------------------------------------------------------------
const CLAUDE_PLANS = {
  pro: "Pro",
  max: "Max",
  team: "Team",
  enterprise: "Enterprise",
  free: "Free",
};
function claudePlan(subscriptionType, accountType) {
  const raw = String(subscriptionType || accountType || "")
    .toLowerCase()
    .replace(/^claude\s+/, "")
    .trim();
  if (!raw) return null;
  const key = Object.keys(CLAUDE_PLANS).find(
    (k) => raw === k || raw.startsWith(k + " ") || raw.startsWith(k + "_"),
  );
  return key ? CLAUDE_PLANS[key] : titleCase(raw);
}
const CLAUDE_WINDOWS = [
  ["five_hour", "5-hour limit"],
  ["seven_day", "Weekly limit"],
  ["seven_day_opus", "Weekly limit · Opus"],
  ["seven_day_sonnet", "Weekly limit · Sonnet"],
];

/**
 * Normalizes `accountInfo()` + the SDK `/usage` response into the card the renderer draws.
 * Returns {status, email, organization, plan, limits:[{id,label,usedPercent,resetsAt?}], extraUsage, message?}.
 */
function parseClaudeUsage({ account, usage } = {}) {
  account = account && typeof account === "object" ? account : {};
  usage = usage && typeof usage === "object" ? usage : {};
  const base = {
    agent: "claude",
    email: typeof account.email === "string" ? account.email : null,
    organization:
      typeof account.organization === "string" && account.organization
        ? account.organization
        : null,
    plan: claudePlan(usage.subscription_type, account.subscriptionType),
    limits: [],
    extraUsage: null,
  };
  if (account.apiProvider && account.apiProvider !== "firstParty")
    return {
      ...base,
      status: "unavailable",
      message: `Claude Code uses ${titleCase(account.apiProvider)} here, so claude.ai plan limits don't apply.`,
    };
  if (!base.email && !usage.subscription_type)
    return {
      ...base,
      status: "signed-out",
      message: "Sign in to Claude Code to see your plan limits.",
    };
  const limits =
    usage.rate_limits && typeof usage.rate_limits === "object" ? usage.rate_limits : null;
  if (!usage.rate_limits_available || !limits)
    return {
      ...base,
      status: "unavailable",
      message: account.apiKeySource
        ? "Claude Code uses an API key here, so plan limits don't apply."
        : "Plan limits aren't available for this account.",
    };
  const seen = new Set();
  for (const [key, label] of CLAUDE_WINDOWS) {
    const window = limits[key];
    const usedPercent = percent(window?.utilization);
    if (usedPercent === undefined) continue;
    const resetsAt = isoMs(window.resets_at);
    seen.add(label.toLowerCase());
    base.limits.push({ id: key, label, usedPercent, ...(resetsAt ? { resetsAt } : {}) });
  }
  for (const scoped of Array.isArray(limits.model_scoped) ? limits.model_scoped : []) {
    const name =
      typeof scoped?.display_name === "string" ? scoped.display_name.trim().slice(0, 60) : "";
    const usedPercent = percent(scoped?.utilization);
    if (!name || usedPercent === undefined) continue;
    const label = `Weekly limit · ${name}`;
    if (seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    const resetsAt = isoMs(scoped.resets_at);
    base.limits.push({
      id: "model:" + name.toLowerCase(),
      label,
      usedPercent,
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  const extra = limits.extra_usage;
  if (extra && typeof extra === "object") {
    const decimals = num(extra.decimal_places) ?? 2;
    const scale = 10 ** decimals;
    base.extraUsage = {
      enabled: !!extra.is_enabled,
      ...(num(extra.used_credits) !== undefined ? { used: num(extra.used_credits) / scale } : {}),
      ...(num(extra.monthly_limit) !== undefined
        ? { limit: num(extra.monthly_limit) / scale }
        : {}),
      ...(percent(extra.utilization) !== undefined
        ? { usedPercent: percent(extra.utilization) }
        : {}),
      ...(typeof extra.currency === "string" && extra.currency ? { currency: extra.currency } : {}),
    };
  }
  return { ...base, status: "ready" };
}

/** Opens an idle SDK session against the user's `claude`, reads account + usage, then closes it. */
async function fetchClaudeUsage({
  executable,
  loadSdk = () => import("@anthropic-ai/claude-agent-sdk"),
  cwd,
  timeout = FETCH_TIMEOUT,
  env = {},
} = {}) {
  const sdk = await loadSdk();
  if (typeof sdk?.query !== "function") throw Error("The Claude Agent SDK is unavailable");
  const abort = new AbortController();
  let release;
  const hold = new Promise((r) => {
    release = r;
  });
  const q = sdk.query({
    prompt: (async function* () {
      await hold;
    })(),
    options: {
      ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
      abortController: abort,
      env: agents.childEnv(env),
      cwd,
      persistSession: false,
    },
  });
  const timed = (promise, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(Error(label + " timed out")), timeout);
        t.unref?.();
      }),
    ]);
  try {
    const account = await timed(q.accountInfo(), "Claude account");
    const read = q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
    if (typeof read !== "function")
      return {
        ...parseClaudeUsage({ account }),
        status: "unavailable",
        message: "Update Claude Code to see plan limits here.",
      };
    const usage = await timed(read.call(q, { skipBehaviors: true }), "Claude usage");
    return parseClaudeUsage({ account, usage });
  } finally {
    release();
    try {
      q.close?.();
    } catch {}
    abort.abort();
  }
}

// --- Codex ---------------------------------------------------------------------------------------
const CODEX_PLANS = {
  free: "Free",
  go: "Go",
  plus: "Plus",
  pro: "Pro",
  prolite: "Pro Lite",
  team: "Team",
  business: "Business",
  enterprise: "Enterprise",
  edu: "Edu",
  education: "Edu",
};
const codexPlan = (plan) =>
  typeof plan === "string" && plan ? CODEX_PLANS[plan.toLowerCase()] || titleCase(plan) : null;
function codexWindowLabel(minutes, fallback) {
  if (!minutes) return fallback;
  if (minutes === 300) return "5-hour limit";
  if (minutes === 10080) return "Weekly limit";
  if (minutes % 1440 === 0) return `${minutes / 1440}-day limit`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour limit`;
  return `${minutes}-minute limit`;
}

/** Normalizes `account/read` + `account/rateLimits/read` results. */
function parseCodexUsage({ account, limits } = {}) {
  const acct = account?.account && typeof account.account === "object" ? account.account : null;
  const base = {
    agent: "codex",
    email: typeof acct?.email === "string" ? acct.email : null,
    organization: null,
    plan: codexPlan(acct?.planType),
    limits: [],
    credits: null,
    resetCredits: 0,
  };
  if (!acct)
    return {
      ...base,
      status: "signed-out",
      message: "Sign in to Codex with ChatGPT to see your plan limits.",
    };
  if (acct.type !== "chatgpt")
    return {
      ...base,
      status: "unavailable",
      message:
        acct.type === "apiKey"
          ? "Codex uses an API key here, so ChatGPT plan limits don't apply."
          : "Plan limits aren't available for this Codex login.",
    };
  if (!limits || typeof limits !== "object")
    return {
      ...base,
      status: "unavailable",
      message: "Plan limits aren't available for this account.",
    };
  const buckets =
    limits.rateLimitsByLimitId && typeof limits.rateLimitsByLimitId === "object"
      ? Object.values(limits.rateLimitsByLimitId).filter(Boolean)
      : [];
  if (!buckets.length && limits.rateLimits) buckets.push(limits.rateLimits);
  const seen = new Set();
  for (const snapshot of buckets) {
    if (!base.plan) base.plan = codexPlan(snapshot.planType);
    const prefix =
      snapshot.limitName && snapshot.limitId !== "codex"
        ? String(snapshot.limitName).slice(0, 60) + " · "
        : "";
    for (const [key, fallback] of [
      ["primary", "Usage limit"],
      ["secondary", "Usage limit"],
    ]) {
      const window = snapshot[key];
      const usedPercent = percent(window?.usedPercent);
      if (usedPercent === undefined) continue;
      const label = prefix + codexWindowLabel(num(window.windowDurationMins), fallback);
      if (seen.has(label)) continue;
      seen.add(label);
      const resetsAt = epochMs(window.resetsAt);
      base.limits.push({
        id: `${snapshot.limitId || "codex"}:${key}`,
        label,
        usedPercent,
        minutes: num(window.windowDurationMins) ?? null,
        ...(resetsAt ? { resetsAt } : {}),
      });
    }
    if (!base.credits && snapshot.credits && typeof snapshot.credits === "object") {
      base.credits = {
        hasCredits: !!snapshot.credits.hasCredits,
        unlimited: !!snapshot.credits.unlimited,
        ...(num(snapshot.credits.balance) !== undefined
          ? { balance: num(snapshot.credits.balance) }
          : {}),
      };
    }
  }
  base.limits.sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity)); // 5-hour before weekly
  for (const limit of base.limits) delete limit.minutes;
  base.resetCredits = num(limits.rateLimitResetCredits?.availableCount) || 0;
  return { ...base, status: "ready" };
}

/** Starts a short-lived `codex app-server`, reads the account and its limits, then stops it. */
async function fetchCodexUsage({
  executable,
  spawnProcess = spawn,
  timeout = FETCH_TIMEOUT,
  env = {},
} = {}) {
  const { JsonRpcChild } = require("./agent-runtime.cjs");
  const child = spawnProcess(executable, ["app-server"], {
    env: agents.childEnv(env),
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const rpc = new JsonRpcChild(child);
  try {
    await rpc.request(
      "initialize",
      { clientInfo: { name: "verynize", title: "Verynize", version: "0" } },
      timeout,
    );
    rpc.notify("initialized");
    const account = await rpc.request("account/read", {}, timeout);
    if (!account?.account || account.account.type !== "chatgpt")
      return parseCodexUsage({ account });
    let limits = null;
    try {
      limits = await rpc.request(
        "account/rateLimits/read",
        { excludeResetCreditDetails: true },
        timeout,
      );
    } catch (error) {
      return {
        ...parseCodexUsage({ account, limits: {} }),
        status: "error",
        limits: [],
        message: friendlyError(error),
      };
    }
    return parseCodexUsage({ account, limits });
  } finally {
    rpc.close();
  }
}

/**
 * `account/read` on a short-lived `codex app-server` for an account (`env`: a named account's CODEX_HOME). Resolves the
 * raw result ({account: {type, email?, planType?, workspaceName?} | null, requiresOpenaiAuth}); rejects when the CLI has
 * no app-server or does not answer. The supported source of the email/plan (desktop/agent-tools.cjs codexAccountFromRead).
 */
async function readCodexAccount({
  executable,
  spawnProcess = spawn,
  timeout = 8000,
  env = {},
} = {}) {
  const { JsonRpcChild } = require("./agent-runtime.cjs");
  const child = spawnProcess(executable, ["app-server"], {
    env: agents.childEnv(env),
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const rpc = new JsonRpcChild(child);
  try {
    await rpc.request(
      "initialize",
      { clientInfo: { name: "verynize", title: "Verynize", version: "0" } },
      timeout,
    );
    rpc.notify("initialized");
    return await rpc.request("account/read", { refreshToken: false }, timeout);
  } finally {
    rpc.close();
  }
}

function friendlyError(error) {
  const text = String(error?.message || error || "");
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|offline|fetch failed|timed out/i.test(
      text,
    )
  )
    return "Couldn't reach the service. Check your connection and refresh.";
  return text.replace(/\s+/g, " ").slice(0, 200) || "Couldn't read usage.";
}

// --- Verynize: AI-generated layers ---------------------------------------------------------------
/** Local Monday 00:00 of the week containing `now`, as YYYY-MM-DD. */
function weekStart(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function nextWeekStart(now = new Date()) {
  const [y, m, d] = weekStart(now).split("-").map(Number);
  return new Date(y, m - 1, d + 7).getTime();
}
/** Number of node ids in `after` that are not in `before` (documents are version-2: pages[].nodes[]). */
function countNewNodes(before, after) {
  const ids = (doc) => {
    const out = new Set();
    for (const page of Array.isArray(doc?.pages) ? doc.pages : [])
      for (const node of Array.isArray(page?.nodes) ? page.nodes : [])
        if (node && typeof node.id === "string") out.add(node.id);
    return out;
  };
  const old = ids(before);
  let added = 0;
  for (const id of ids(after)) if (!old.has(id)) added++;
  return added;
}

class LayerLog {
  constructor(file) {
    this.file = file;
    this.queue = Promise.resolve();
  }
  async read() {
    let raw = {};
    try {
      raw = JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch {}
    const weeks = {};
    if (raw?.weeks && typeof raw.weeks === "object")
      for (const [key, value] of Object.entries(raw.weeks))
        if (/^\d{4}-\d{2}-\d{2}$/.test(key) && num(value) >= 0) weeks[key] = Math.floor(num(value));
    return { weeks, total: Math.max(0, Math.floor(num(raw?.total) || 0)) };
  }
  record(count, now = new Date()) {
    if (!(count > 0)) return this.queue;
    this.queue = this.queue
      .then(async () => {
        const data = await this.read();
        const key = weekStart(now);
        data.weeks[key] = (data.weeks[key] || 0) + count;
        data.total += count;
        data.weeks = Object.fromEntries(
          Object.entries(data.weeks)
            .sort(([a], [b]) => b.localeCompare(a))
            .slice(0, WEEKS_KEPT),
        );
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(data, null, 2));
        await fs.rename(tmp, this.file);
      })
      .catch(() => {});
    return this.queue;
  }
  async summary(now = new Date()) {
    const data = await this.read();
    const key = weekStart(now);
    const [y, m, d] = key.split("-").map(Number);
    const previous = weekStart(new Date(y, m - 1, d - 7));
    return {
      thisWeek: data.weeks[key] || 0,
      lastWeek: data.weeks[previous] || 0,
      total: data.total,
      weekStart: new Date(y, m - 1, d).getTime(),
      resetsAt: nextWeekStart(now),
    };
  }
}

let layerLog = null;
/** Called by desktop/mcp-bridge.cjs after a committed agent edit. No-op until registered. */
function recordGeneratedLayers(count) {
  return layerLog ? layerLog.record(count) : Promise.resolve();
}

// --- IPC -----------------------------------------------------------------------------------------
class AgentUsage {
  // `profileEnv(agent, id)`: CLAUDE_CONFIG_DIR / CODEX_HOME of a named account (desktop/agent-profiles.cjs).
  constructor({
    userData,
    discover = agents.discover,
    claude = fetchClaudeUsage,
    codex = fetchCodexUsage,
    disabled = process.env.VERYNIZE_DISABLE_AGENT_USAGE === "1",
    profileEnv = null,
    siwc = null,
  } = {}) {
    Object.assign(this, { userData, discover, claude, codex, disabled, profileEnv, siwc });
    this.cache = new Map();
  }
  /** Forget cached limits of a removed account. */
  forget(profile) {
    for (const key of [...this.cache.keys()])
      if (key.endsWith(":" + profile)) this.cache.delete(key);
  }
  async provider(agent, { refresh = false, profile = null } = {}) {
    if (!["claude", "codex"].includes(agent)) throw Error("Choose Claude or Codex");
    const named = typeof profile === "string" && profile && profile !== "system" ? profile : null;
    const env = named ? (this.profileEnv ? await this.profileEnv(agent, named) : null) : {};
    if (!env) throw Error("Named accounts are not available");
    const cacheKey = named ? `${agent}:${named}` : agent;
    if (agent === "codex" && this.siwc) {
      const account = await this.siwc.status(named || "system");
      return {
        agent,
        status: account.loggedIn ? "unavailable" : "signed-out",
        email: account.email,
        plan: account.plan,
        limits: [],
        updatedAt: Date.now(),
        message: account.loggedIn
          ? "Using your ChatGPT plan. View limits and manage Verynize access in ChatGPT Settings → Usage."
          : "Continue with ChatGPT in Verynize to use your plan.",
      };
    }
    const cached = this.cache.get(cacheKey);
    if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
    if (cached?.pending) return cached.pending;
    const pending = (async () => {
      const updatedAt = Date.now();
      if (this.disabled)
        return {
          agent,
          status: "unavailable",
          message: "Usage checks are turned off.",
          limits: [],
          updatedAt,
        };
      const found = (await this.discover()).find((a) => a.id === agent && a.available);
      if (!found)
        return {
          agent,
          status: "missing",
          message:
            agent === "claude"
              ? "Claude Code isn't installed on this Mac."
              : "Codex isn't installed on this Mac.",
          limits: [],
          updatedAt,
        };
      try {
        const value =
          agent === "claude"
            ? await this.claude({ executable: found.path, cwd: this.userData, env })
            : await this.codex({ executable: found.path, env });
        return { ...value, ...(named ? { profile: named } : {}), updatedAt };
      } catch (error) {
        return { agent, status: "error", message: friendlyError(error), limits: [], updatedAt };
      }
    })();
    this.cache.set(cacheKey, { ...(cached || {}), pending });
    try {
      const value = await pending;
      this.cache.set(cacheKey, { at: Date.now(), value });
      return value;
    } catch (error) {
      this.cache.delete(cacheKey);
      throw error;
    }
  }
}

function registerAgentUsage(handle, { userData, profiles = null, siwc = null }) {
  layerLog = new LayerLog(path.join(userData, "agent-usage.json"));
  const usage = new AgentUsage({
    userData,
    siwc,
    ...(profiles ? { profileEnv: (agent, id) => profiles.envFor(agent, id) } : {}),
  });
  handle("agentUsage", (options) =>
    usage.provider(options?.agent, {
      refresh: !!options?.refresh,
      profile: typeof options?.profile === "string" ? options.profile : null,
    }),
  );
  handle("agentLayerUsage", () => layerLog.summary());
  return usage;
}

module.exports = {
  registerAgentUsage,
  AgentUsage,
  parseClaudeUsage,
  parseCodexUsage,
  fetchClaudeUsage,
  fetchCodexUsage,
  readCodexAccount,
  LayerLog,
  countNewNodes,
  recordGeneratedLayers,
  weekStart,
  claudePlan,
  codexPlan,
  friendlyError,
};
