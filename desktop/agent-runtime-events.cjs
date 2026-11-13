// Translators from provider-specific streams into Verynize's typed agent events.
//
// Every event sent to the renderer on `desktop:agent-event` has
// `{id, runId, chatId, conversationId, seq, type}` (id === runId, chatId === conversationId) plus:
//   session              {sessionId, model?}             provider session / thread id (for resume)
//   status               {text}                          short progress line
//   assistant-text-delta {text}                          streamed assistant text
//   assistant-text       {text}                          a complete assistant text block (non-streamed)
//   thinking-delta       {text}                          streamed reasoning / thinking
//   tool-call            {toolCallId, toolName, title, input, partial?, parentToolCallId?}
//   tool-input-delta     {toolCallId, partial}           streamed tool argument JSON
//   tool-result          {toolCallId, content, isError, parentToolCallId?}
//   permission-request   {requestId, toolName, title, input, toolCallId?, canAlwaysAllow}
//   permission-resolved  {requestId, allow, always?}
//   question-request     {requestId, toolCallId?, questions:[{id, question, header?, options?:[{label, description?}], multiSelect?}]}
//   question-resolved    {requestId, answers|null, cancelled}
//   steer                {text}                          a follow-up message was delivered into the running turn
//   usage                {usage, inputTokens?, outputTokens?, contextTokens?, contextWindow?, costUsd?, rateLimit?}
//                        `usage` is the same normalized object as the flat fields. Events can be partial
//                        (a rate-limit update carries only `rateLimit`): merge the fields that are present.
//                        rateLimit: [{label, usedPercent (0-100), resetsAt? (ms epoch)}]
//   mcp-status           {agent, servers:[{name, status, error?}], partial?}  MCP servers the agent runtime reports
//                        (Claude init `mcp_servers`, Codex `mcpServer/startupStatus/updated`). status: connected |
//                        starting | failed | needs-auth | disabled | not-started. `partial`: merge by name.
//   error                {text}
//   auth-required        {agent, text, account?:{id, name, system}}  the provider account is signed out or its sign-in
//                        was rejected (401). Sent at most once per run; the run then ends without further errors. The
//                        runtime adds `account`; the renderer shows one "Sign in" card (desktop/agent-runtime.cjs).
//   done                 {code, stopped, sessionId?}
//
// The translators are pure: they take one provider message and return an array of partial events
// (without id/chatId/seq) so they can be unit-tested with recorded fixtures. Internal control
// events (turn-complete, turn-idle, subagent-threads) are consumed by the runtime, never forwarded.

const LIMIT = 20000;
const clip = (value, limit = LIMIT) => {
  const text =
    typeof value === "string"
      ? value
      : value === undefined || value === null
        ? ""
        : safeJSON(value);
  return text.length > limit
    ? text.slice(0, limit) + `\n… (${text.length - limit} more characters)`
    : text;
};
function safeJSON(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
const boundedInput = (input) => {
  const text = safeJSON(input ?? {});
  return text.length > LIMIT ? { truncated: clip(text) } : (input ?? {});
};

function toolTitle(name, input = {}) {
  const pick =
    input.file_path ||
    input.path ||
    input.pattern ||
    input.command ||
    input.url ||
    input.query ||
    input.description ||
    "";
  const short = String(pick).replace(/\s+/g, " ").slice(0, 90);
  const label = String(name)
    .replace(/^mcp__verynize__/, "Canvas · ")
    .replace(/^mcp__([^_]+)__/, "$1 · ");
  return short ? `${label} ${short}` : label;
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) =>
        part?.type === "text" ? part.text : part?.type === "image" ? "[image]" : safeJSON(part),
      )
      .join("\n");
  return safeJSON(content);
}

// --- usage normalization ---------------------------------------------------------------------
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
function usageEvent(fields) {
  const usage = {};
  for (const [key, value] of Object.entries(fields))
    if (value !== undefined && value !== null) usage[key] = value;
  return Object.keys(usage).length ? { type: "usage", usage, ...usage } : null;
}
const epochMs = (value) => {
  const n = num(value);
  return n === undefined ? undefined : n < 1e12 ? Math.round(n * 1000) : n;
};
const CLAUDE_LIMIT_LABELS = {
  five_hour: "5-hour limit",
  seven_day: "Weekly limit",
  seven_day_opus: "Weekly Opus limit",
  seven_day_sonnet: "Weekly Sonnet limit",
  seven_day_overage_included: "Weekly limit",
  overage: "Extra usage",
};

/** Claude SDK `rate_limit_event.rate_limit_info` -> [{label, usedPercent, resetsAt?}]. */
function claudeRateLimit(info) {
  if (!info || typeof info !== "object") return [];
  const utilization = num(info.utilization);
  const usedPercent =
    utilization !== undefined
      ? Math.round((utilization <= 1 ? utilization * 100 : utilization) * 10) / 10
      : info.status === "rejected"
        ? 100
        : undefined;
  if (usedPercent === undefined) return [];
  const resetsAt = epochMs(info.resetsAt);
  return [
    {
      label: CLAUDE_LIMIT_LABELS[info.rateLimitType] || "Usage limit",
      usedPercent,
      ...(resetsAt ? { resetsAt } : {}),
    },
  ];
}

/** Claude `result` message (+ the context size of the last main-thread request) -> usage fields. */
function claudeUsage(result, lastContextTokens) {
  const u = result?.usage || {};
  const models =
    result?.modelUsage && typeof result.modelUsage === "object"
      ? Object.values(result.modelUsage)
      : [];
  const windows = models.map((m) => num(m?.contextWindow)).filter(Boolean);
  const turnInput =
    (num(u.input_tokens) || 0) +
    (num(u.cache_read_input_tokens) || 0) +
    (num(u.cache_creation_input_tokens) || 0);
  const contextTokens = lastContextTokens || undefined;
  return {
    inputTokens: contextTokens ?? (turnInput || undefined),
    outputTokens: num(u.output_tokens),
    contextTokens,
    contextWindow: windows.length ? Math.max(...windows) : undefined,
    costUsd: num(result?.total_cost_usd),
    ...(result?.num_turns ? { turns: result.num_turns } : {}),
  };
}
const claudeContextTokens = (usage) =>
  usage
    ? (num(usage.input_tokens) || 0) +
      (num(usage.cache_read_input_tokens) || 0) +
      (num(usage.cache_creation_input_tokens) || 0)
    : 0;

/** Codex `thread/tokenUsage/updated` tokenUsage -> usage fields. */
function codexUsage(tokenUsage) {
  if (!tokenUsage || typeof tokenUsage !== "object") return {};
  const last = tokenUsage.last || tokenUsage;
  return {
    inputTokens: num(last.inputTokens),
    outputTokens: num(last.outputTokens),
    contextTokens: num(last.totalTokens),
    contextWindow: num(tokenUsage.modelContextWindow),
  };
}
function codexWindowLabel(minutes, fallback) {
  if (!minutes) return fallback;
  if (minutes === 300) return "5-hour limit";
  if (minutes === 10080) return "Weekly limit";
  if (minutes % 1440 === 0) return `${minutes / 1440}-day limit`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour limit`;
  return `${minutes}-minute limit`;
}
/** Codex `account/rateLimits/updated` rateLimits snapshot -> [{label, usedPercent, resetsAt?}]. */
function codexRateLimits(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return [];
  const out = [];
  for (const [key, fallback] of [
    ["primary", "Primary limit"],
    ["secondary", "Secondary limit"],
  ]) {
    const window = snapshot[key];
    if (!window || num(window.usedPercent) === undefined) continue;
    const resetsAt = epochMs(window.resetsAt);
    out.push({
      label:
        (snapshot.limitName ? snapshot.limitName + " · " : "") +
        codexWindowLabel(num(window.windowDurationMins), fallback),
      usedPercent: window.usedPercent,
      ...(resetsAt ? { resetsAt } : {}),
    });
  }
  return out;
}

// --- MCP server status -----------------------------------------------------------------------
const MCP_STATUS = {
  connected: "connected",
  ready: "connected",
  pending: "starting",
  starting: "starting",
  failed: "failed",
  cancelled: "failed",
  "needs-auth": "needs-auth",
  authenticationRequired: "needs-auth",
  disabled: "disabled",
  notStarted: "not-started",
  "not-started": "not-started",
};
/** One provider server status ({name, status|runtimeStatus, error?}) -> {name, status, error?} or null. */
function mcpServer(entry) {
  if (!entry || typeof entry.name !== "string" || !entry.name) return null;
  let status = MCP_STATUS[entry.status ?? entry.runtimeStatus] || null;
  if (!status && entry.authStatus === "notLoggedIn") status = "needs-auth";
  const error =
    typeof entry.error === "string" && entry.error
      ? entry.error
      : typeof entry.toolsError === "string" && entry.toolsError
        ? entry.toolsError
        : "";
  return {
    name: entry.name.slice(0, 100),
    status: status || "not-started",
    ...(error ? { error: clip(error, 300) } : {}),
  };
}
const mcpServers = (list) => (Array.isArray(list) ? list.map(mcpServer).filter(Boolean) : []);

// --- Claude Agent SDK / `claude --output-format stream-json` --------------------------------
function createClaudeMapper() {
  const state = {
    streamed: false,
    blocks: new Map(),
    sessionId: null,
    sawText: false,
    contextTokens: 0,
  };
  return function map(message) {
    const out = [];
    if (!message || typeof message !== "object") return out;
    const parent = message.parent_tool_use_id || undefined;
    if (message.session_id && message.session_id !== state.sessionId) {
      state.sessionId = message.session_id;
      out.push({
        type: "session",
        sessionId: message.session_id,
        ...(message.model ? { model: message.model } : {}),
      });
    }
    if (message.type === "system") {
      if (message.subtype === "init") {
        const servers = (message.mcp_servers || []).map((s) => `${s.name}: ${s.status}`).join(", ");
        out.push({
          type: "status",
          text: `Session ready${message.model ? " · " + message.model : ""}${servers ? " · MCP " + servers : ""}`,
        });
        if (Array.isArray(message.mcp_servers))
          out.push({
            type: "mcp-status",
            agent: "claude",
            servers: mcpServers(message.mcp_servers),
          });
      } else if (message.subtype === "compact_boundary")
        out.push({ type: "status", text: "Compacting conversation" });
      else if (message.subtype === "status" && message.status)
        out.push({ type: "status", text: String(message.status) });
      else if (message.subtype === "session_state_changed" && message.state === "idle")
        out.push({ type: "turn-idle" });
      return out;
    }
    if (message.type === "rate_limit_event") {
      const event = usageEvent({ rateLimit: claudeRateLimit(message.rate_limit_info) });
      if (event && event.rateLimit.length) out.push(event);
      return out;
    }
    if (message.type === "stream_event") {
      state.streamed = true;
      if (parent) return out; // subagent token streams are summarized by their tool cards
      const event = message.event || {};
      if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        const block = event.content_block;
        state.blocks.set(event.index, block.id);
        out.push({
          type: "tool-call",
          toolCallId: block.id,
          toolName: block.name,
          title: toolTitle(block.name),
          input: {},
          partial: true,
        });
      } else if (event.type === "content_block_delta") {
        const delta = event.delta || {};
        if (delta.type === "text_delta" && delta.text) {
          state.sawText = true;
          out.push({ type: "assistant-text-delta", text: delta.text });
        } else if (delta.type === "thinking_delta" && delta.thinking)
          out.push({ type: "thinking-delta", text: delta.thinking });
        else if (delta.type === "input_json_delta" && state.blocks.has(event.index))
          out.push({
            type: "tool-input-delta",
            toolCallId: state.blocks.get(event.index),
            partial: delta.partial_json || "",
          });
      } else if (event.type === "message_start") state.blocks.clear();
      return out;
    }
    if (message.type === "assistant") {
      if (!parent && message.message?.usage)
        state.contextTokens = claudeContextTokens(message.message.usage) || state.contextTokens;
      for (const part of message.message?.content || []) {
        if (part.type === "tool_use")
          out.push({
            type: "tool-call",
            toolCallId: part.id,
            toolName: part.name,
            title: toolTitle(part.name, part.input),
            input: boundedInput(part.input),
            ...(parent ? { parentToolCallId: parent } : {}),
          });
        else if (!state.streamed && !parent && part.type === "text" && part.text) {
          state.sawText = true;
          out.push({ type: "assistant-text", text: part.text });
        } else if (!state.streamed && !parent && part.type === "thinking" && part.thinking)
          out.push({ type: "thinking-delta", text: part.thinking });
      }
      return out;
    }
    if (message.type === "user") {
      const content = message.message?.content;
      if (Array.isArray(content))
        for (const part of content)
          if (part?.type === "tool_result")
            out.push({
              type: "tool-result",
              toolCallId: part.tool_use_id,
              content: clip(resultText(part.content)),
              isError: part.is_error === true,
              ...(parent ? { parentToolCallId: parent } : {}),
            });
      return out;
    }
    if (message.type === "result") {
      if (message.usage || message.total_cost_usd !== undefined || message.modelUsage) {
        const event = usageEvent(claudeUsage(message, state.contextTokens));
        if (event) out.push(event);
      }
      if (message.is_error || (message.subtype && message.subtype !== "success")) {
        const text =
          Array.isArray(message.errors) && message.errors.length
            ? message.errors.join("\n")
            : typeof message.result === "string" && message.result
              ? message.result
              : `Agent stopped: ${message.subtype || "error"}`;
        out.push({ type: "error", text: clip(text, 4000) });
      } else if (!state.sawText && typeof message.result === "string" && message.result)
        out.push({ type: "assistant-text", text: message.result });
      out.push({
        type: "turn-complete",
        ok: !message.is_error && (!message.subtype || message.subtype === "success"),
      });
    }
    return out;
  };
}

// --- Codex app-server JSON-RPC notifications -------------------------------------------------
function codexItemCall(item) {
  switch (item?.type) {
    case "commandExecution":
      return { toolName: "shell", input: { command: item.command, cwd: item.cwd } };
    case "fileChange":
      return {
        toolName: "edit",
        input: { files: (item.changes || []).map((c) => c.path || c.file || c) },
      };
    case "mcpToolCall":
      return { toolName: `mcp__${item.server}__${item.tool}`, input: item.arguments ?? {} };
    case "dynamicToolCall":
      return {
        toolName: item.namespace ? `${item.namespace}.${item.tool}` : item.tool,
        input: item.arguments ?? {},
      };
    case "webSearch":
      return { toolName: "web_search", input: { query: item.query } };
    case "collabAgentToolCall":
      return { toolName: "agent", input: { tool: item.tool, prompt: item.prompt } };
    case "imageView":
      return { toolName: "view_image", input: { path: item.path } };
    default:
      return null;
  }
}
function codexItemResult(item) {
  switch (item?.type) {
    case "commandExecution":
      return {
        content: clip(
          item.aggregatedOutput ||
            (item.exitCode !== null && item.exitCode !== undefined ? `exit ${item.exitCode}` : ""),
        ),
        isError:
          item.status === "failed" ||
          item.status === "declined" ||
          (typeof item.exitCode === "number" && item.exitCode !== 0),
      };
    case "fileChange":
      return {
        content: clip(
          (item.changes || [])
            .map((c) => `${c.kind?.type || c.kind || "update"} ${c.path}`)
            .join("\n") || item.status,
        ),
        isError: item.status === "failed" || item.status === "declined",
      };
    case "mcpToolCall":
      return {
        content: clip(
          item.error
            ? item.error.message || item.error
            : resultText(item.result?.content ?? item.result),
        ),
        isError: !!item.error || item.status === "failed",
      };
    case "dynamicToolCall":
      return { content: clip(resultText(item.contentItems)), isError: item.success === false };
    default:
      return { content: clip(item?.status || ""), isError: item?.status === "failed" };
  }
}

/**
 * Codex app-server notifications for one thread. With `parentToolCallId` the mapper handles a
 * subagent thread spawned by a collabAgentToolCall: only its tool cards are emitted, nested under
 * the parent call, and its turn end never ends the run.
 */
function createCodexMapper({ parentToolCallId } = {}) {
  const streamedItems = new Set();
  let sawText = false,
    authRetries = 0,
    authSignaled = false;
  // A rejected sign-in: the first retry gets one status line, the second (or a final error) becomes auth-required and
  // every later retry/error of the turn is dropped, so the transcript shows one sign-in card instead of ~10 retries.
  const authRequired = () => {
    if (authSignaled) return [];
    authSignaled = true;
    return [{ type: "auth-required", agent: "codex", text: CODEX_SIGNED_OUT }];
  };
  const child = typeof parentToolCallId === "string" && parentToolCallId;
  return function map(message) {
    const out = mapOne(message);
    if (!child) return out;
    return out
      .filter(
        (e) => e.type === "tool-call" || e.type === "tool-result" || e.type === "subagent-threads",
      )
      .map((e) => (e.type === "subagent-threads" ? e : { ...e, parentToolCallId: child }));
  };
  function mapOne({ method, params = {} }) {
    const out = [];
    switch (method) {
      case "thread/started":
        if (params.thread?.id) out.push({ type: "session", sessionId: params.thread.id });
        break;
      case "turn/started":
        out.push({ type: "status", text: "Working" });
        break;
      case "item/agentMessage/delta":
        if (params.delta) {
          streamedItems.add(params.itemId);
          sawText = true;
          out.push({ type: "assistant-text-delta", text: params.delta });
        }
        break;
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
        if (params.delta) out.push({ type: "thinking-delta", text: params.delta });
        break;
      case "item/started": {
        const call = codexItemCall(params.item);
        if (call)
          out.push({
            type: "tool-call",
            toolCallId: params.item.id,
            toolName: call.toolName,
            title: toolTitle(call.toolName, call.input),
            input: boundedInput(call.input),
          });
        if (
          params.item?.type === "collabAgentToolCall" &&
          Array.isArray(params.item.receiverThreadIds) &&
          params.item.receiverThreadIds.length
        )
          out.push({
            type: "subagent-threads",
            toolCallId: params.item.id,
            threadIds: params.item.receiverThreadIds,
          });
        break;
      }
      case "item/completed": {
        const item = params.item;
        if (item?.type === "agentMessage") {
          if (!streamedItems.has(item.id) && item.text) {
            sawText = true;
            out.push({ type: "assistant-text", text: item.text });
          }
        } else if (codexItemCall(item)) {
          if (
            item.type === "collabAgentToolCall" &&
            Array.isArray(item.receiverThreadIds) &&
            item.receiverThreadIds.length
          )
            out.push({
              type: "subagent-threads",
              toolCallId: item.id,
              threadIds: item.receiverThreadIds,
            });
          out.push({ type: "tool-result", toolCallId: item.id, ...codexItemResult(item) });
        }
        break;
      }
      case "thread/tokenUsage/updated": {
        const event = params.tokenUsage && usageEvent(codexUsage(params.tokenUsage));
        if (event) out.push(event);
        break;
      }
      case "mcpServer/startupStatus/updated": {
        const server = mcpServer(params);
        if (server)
          out.push({ type: "mcp-status", agent: "codex", partial: true, servers: [server] });
        break;
      }
      case "account/rateLimits/updated": {
        const rateLimit = codexRateLimits(params.rateLimits);
        if (rateLimit.length) out.push(usageEvent({ rateLimit }));
        break;
      }
      case "error": {
        if (authSignaled) break;
        if (isAuthError(params.error)) {
          if (params.willRetry && ++authRetries < 2)
            out.push({ type: "status", text: "Codex rejected the sign-in; trying again." });
          else out.push(...authRequired());
          break;
        }
        if (!params.willRetry)
          out.push({ type: "error", text: clip(params.error?.message || "Codex error", 4000) });
        else out.push({ type: "status", text: "Retrying: " + (params.error?.message || "") });
        break;
      }
      case "turn/completed": {
        const turn = params.turn || {};
        if (turn.status === "failed" && (authSignaled || isAuthError(turn.error)))
          out.push(...authRequired());
        else if (turn.status === "failed" && turn.error?.message)
          out.push({ type: "error", text: clip(turn.error.message, 4000) });
        out.push({
          type: "turn-complete",
          ok: turn.status === "completed",
          interrupted: turn.status === "interrupted",
          sawText,
        });
        break;
      }
      case "warning":
      case "configWarning":
      case "deprecationNotice":
        if (params.message || params.summary)
          out.push({
            type: "status",
            text: String(params.message || params.summary).slice(0, 300),
          });
        break;
      default:
        break;
    }
    return out;
  }
}

// --- Codex sign-in errors ---------------------------------------------------------------------
const CODEX_SIGNED_OUT = "Codex is signed out. Sign in to Codex, then retry your message.";
// Texts Codex uses for a missing or rejected ChatGPT/API sign-in (`codex exec` errors carry no structured info).
const AUTH_TEXT =
  /\b401 Unauthorized\b|Missing bearer or basic authentication|refresh token (?:was|has been|is) (?:revoked|expired|already used|invalid)|please (?:log|sign) in again|not logged in|codex login\b/i;
/** HTTP status inside an app-server `codexErrorInfo` ({responseStreamDisconnected:{httpStatusCode}} etc.), else 0. */
function codexHttpStatus(info) {
  if (!info || typeof info !== "object") return 0;
  for (const value of Object.values(info))
    if (value && typeof value === "object" && Number.isInteger(value.httpStatusCode))
      return value.httpStatusCode;
  return 0;
}
/** App-server TurnError {message, codexErrorInfo} (or plain text from exec) that means "sign in again". */
function isAuthError(error) {
  if (!error) return false;
  if (typeof error === "string") return AUTH_TEXT.test(error);
  const info = error.codexErrorInfo;
  if (info === "unauthorized" || codexHttpStatus(info) === 401) return true;
  return typeof error.message === "string" && AUTH_TEXT.test(error.message);
}

// --- `codex exec --json` (fallback runner) ----------------------------------------------------
function createCodexExecMapper() {
  let authSignaled = false;
  return function map(data) {
    const out = [];
    if (!data || typeof data !== "object") return out;
    if (authSignaled && (data.type === "error" || data.type === "turn.failed")) return out;
    if (
      (data.type === "error" || data.type === "turn.failed") &&
      isAuthError(data.message || data.error?.message || "")
    ) {
      authSignaled = true;
      out.push({ type: "auth-required", agent: "codex", text: CODEX_SIGNED_OUT });
      return out;
    }
    const item = data.item || {};
    if (data.type === "thread.started" && data.thread_id)
      out.push({ type: "session", sessionId: data.thread_id });
    else if (
      data.type === "item.started" &&
      item.type &&
      item.type !== "agent_message" &&
      item.type !== "reasoning"
    ) {
      const input = item.command
        ? { command: item.command }
        : item.server
          ? (item.arguments ?? {})
          : item.changes
            ? { files: item.changes.map((c) => c.path) }
            : {};
      const name =
        item.type === "command_execution"
          ? "shell"
          : item.type === "mcp_tool_call"
            ? `mcp__${item.server}__${item.tool}`
            : item.type === "file_change"
              ? "edit"
              : item.type;
      out.push({
        type: "tool-call",
        toolCallId: item.id || name,
        toolName: name,
        title: toolTitle(name, input),
        input: boundedInput(input),
      });
    } else if (data.type === "item.completed") {
      if (item.type === "agent_message")
        out.push({ type: "assistant-text", text: item.text || "" });
      else if (item.type === "reasoning" && item.text)
        out.push({ type: "thinking-delta", text: item.text });
      else if (item.id)
        out.push({
          type: "tool-result",
          toolCallId: item.id,
          content: clip(item.aggregated_output || item.result || item.status || ""),
          isError:
            item.status === "failed" ||
            (typeof item.exit_code === "number" && item.exit_code !== 0),
        });
    } else if (data.type === "turn.completed" && data.usage) {
      const event = usageEvent({
        inputTokens: num(data.usage.input_tokens),
        outputTokens: num(data.usage.output_tokens),
      });
      if (event) out.push(event);
    } else if (data.type === "error" || data.type === "turn.failed")
      out.push({
        type: "error",
        text: clip(data.message || data.error?.message || "Agent failed", 4000),
      });
    return out;
  };
}

module.exports = {
  CODEX_SIGNED_OUT,
  isAuthError,
  codexHttpStatus,
  mcpServer,
  mcpServers,
  createClaudeMapper,
  createCodexMapper,
  createCodexExecMapper,
  toolTitle,
  clip,
  usageEvent,
  claudeUsage,
  claudeRateLimit,
  codexUsage,
  codexRateLimits,
};
