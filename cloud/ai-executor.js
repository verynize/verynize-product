// The model API runtime's executor (docs/ai-runtime.md): one run = one TanStack AI chat() loop
// against OpenRouter with the hosted Verynize design tools of one cloud room. Policy is enforced
// here, not in the prompt: the tool set, the room role before every tool call, the turn and tool
// call budgets and cancellation. Events use the desktop runtime's vocabulary and are stored before
// they are sent.
//
// Write tools and approvals go through `policy` (createRunPolicy): `offers(definition, name)`
// chooses the tools the model sees, `authorize(call)` runs before every tool call (role, plan and
// helper rules), `recorded(call)` returns a write's stored result instead of reapplying it,
// `approve(call)` waits for an `ask` approval once the arguments are checked, and
// `execute(call, run)` re-checks the role and runs the call at most once.
import { chat, maxIterations, toolDefinition } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { z } from "zod";
import { persona as designPersona } from "../integrations/design-knowledge/persona.mjs";
import { atLeast } from "./http.js";
import {
  HOSTED_INSTRUCTIONS,
  callHostedTool,
  hostedToolDefinitions,
  isReadOnlyTool,
} from "./design-backend.js";
import {
  PENDING_RESULT,
  appendEvent,
  approvalForCall,
  cancelRequested,
  completeToolResult,
  createApproval,
  decideApproval,
  denyPending,
  finishRun,
  getApproval,
  getToolResult,
  recordToolResult,
  renewLease,
} from "./ai-store.js";

export const DESIGN_STYLE = /^[a-z0-9-]{1,40}$/;
const TICK_MS = 1000;
const RENEW_MS = 5000;
const MAX_OUTPUT = 200_000;

/** Text of an MCP tool result for the model; images cannot be passed on in this runtime. */
export function toolOutputText(result) {
  const parts = (result?.content || []).map((part) =>
    part.type === "text"
      ? part.text
      : `[${part.type}${part.mimeType ? ` ${part.mimeType}` : ""} omitted: this runtime passes text only]`,
  );
  const text = parts.join("\n");
  return text.length > MAX_OUTPUT
    ? `${text.slice(0, MAX_OUTPUT)}\n[output truncated at ${MAX_OUTPUT} characters]`
    : text;
}

/**
 * Serialized event log of one run: each event gets the next seq, is stored, then handed to
 * `onEvent` (the live SSE stream of the request that started the run, if still connected).
 */
export function createEventLog(env, run, { startSeq = 0, onEvent = () => {} } = {}) {
  let seq = startSeq;
  let chain = Promise.resolve();
  return {
    emit: (type, fields = {}) => {
      const event = { id: run.id, chatId: run.chatId, seq: ++seq, type, ...fields };
      chain = chain.then(async () => {
        await appendEvent(env, run.id, event);
        onEvent(event);
      });
      return chain;
    },
    flush: () => chain,
  };
}

const NO_ACCESS = "You no longer have access to this room.";
const cannotEdit = (role) =>
  `Your role in this room (${role}) cannot edit; ask an owner for editor access.`;
const PLAN_REFUSAL =
  "Plan first: this run only plans. Write tools are refused until the user approves the plan; reply with a short numbered plan of the changes instead (the user starts a new run to apply it).";
const HELPER_REFUSAL = "This is a read-only helper run: it cannot change the room.";
const INTERRUPTED =
  "This tool call was started earlier but its result was not recorded (the server stopped). It is not applied again: read the room to see whether it took effect before retrying with a new call.";
const NOT_APPROVED = "This write was not approved; it was not run.";
/** Tools never offered to a run: they reach outside the run's one room. */
export const ROOM_ESCAPING = new Set(["create_document"]);
export const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const APPROVAL_POLL_MS = 400;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** JSON with object keys sorted at every level (undefined members dropped): a stable form of args. */
export function canonicalJson(value) {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}

/** SHA-256 (hex) of a tool call's name and canonical arguments: what an approval is bound to. */
export async function argsHash(name, args) {
  const bytes = new TextEncoder().encode(canonicalJson({ tool: name, args: args ?? {} }));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The OpenRouter text adapter of one run. Its requests are aborted by `signal` (the run's cancel).
 *
 * The SDK sends `request.clone()`, and on Node (undici) a cloned Request does not always follow its original's
 * abort signal (seen on the first request of a process): Stop would leave the model stream open until the
 * provider ended it. So requests are fetched with the run's own signal. `request(req)` is the only method the SDK
 * calls on its HTTP client (@openrouter/sdk lib/sdks.js). tests/cloud-ai-cancel.mjs covers it.
 */
export function openRouterAdapter(model, provider, signal, onCredentialProblem = () => {}) {
  return createOpenRouterText(model, provider.apiKey, {
    ...(provider.baseUrl ? { serverURL: provider.baseUrl } : {}),
    ...(provider.origin ? { httpReferer: provider.origin } : {}),
    appTitle: "Verynize",
    httpClient: {
      async request(request) {
        let init = { signal };
        // The credential is re-read before every model request (resolveProvider's `current`): a
        // key deleted mid-run fails this call; a replaced key is used from now on.
        if (provider.current) {
          const key = await provider.current();
          if (!key) {
            const message = credentialMessage(provider, "disconnected");
            onCredentialProblem(message);
            throw new Error(message);
          }
          if (key !== provider.apiKey) {
            const headers = new Headers(request.headers);
            headers.set("authorization", `Bearer ${key}`);
            init = { signal, headers };
          }
        }
        const response = await fetch(request, init);
        if ([401, 402, 403].includes(response.status))
          onCredentialProblem(
            credentialMessage(provider, response.status === 402 ? "credits" : "rejected"),
          );
        return response;
      },
    },
  });
}

/** What the user is told when the provider credential stops working during a run. */
export function credentialMessage(provider, problem) {
  if (provider?.source === "server")
    return problem === "credits"
      ? "The server's OpenRouter key is out of credits. Connect your own OpenRouter account in Settings."
      : "The server's OpenRouter key was rejected. Connect your own OpenRouter account in Settings.";
  if (problem === "disconnected")
    return "Your OpenRouter account was disconnected during this run. Reconnect it in Settings to continue.";
  if (problem === "credits")
    return "Your OpenRouter account is out of credits. Add credits on openrouter.ai, or reconnect another account in Settings.";
  return "Your OpenRouter key was rejected. Reconnect your OpenRouter account in Settings.";
}

/** A short label for an approval card. */
export function toolTitle(name, args = {}) {
  const ids = Array.isArray(args?.ids) ? args.ids.length : 0;
  const label = /data-node-label="([^"]{1,60})"/.exec(String(args?.code || ""))?.[1];
  const detail = label ? ` "${label}"` : ids ? ` (${ids} element${ids === 1 ? "" : "s"})` : "";
  return `Canvas · ${name}${detail}`;
}

const recordedResult = (row) =>
  row.output === PENDING_RESULT
    ? { output: INTERRUPTED, isError: true }
    : { output: row.output, isError: !!row.isError };

async function runTool(backend, name, args) {
  const result = await callHostedTool(backend, name, args);
  if (!result) return { output: `Unknown tool: ${name}`, isError: true };
  return { output: toolOutputText(result), isError: !!result.isError };
}

/**
 * The run's tool policy (docs/ai-runtime.md, "Policy"). Read tools run freely. Write tools come
 * from the same hosted table; each one needs editor in the room (checked before the call and again
 * immediately before it runs), an approval under `access: "ask"` (stored in ai_approval, decided
 * through POST /approvals from any instance and read back here after every `waitForChange`) and
 * runs at most once per (runId, toolCallId) (claimed in ai_tool_result before it runs). `plan`
 * runs refuse writes; `helper` runs are read-only (no write tool offered).
 * @param {object} options
 * @param {object} options.env bindings (DB)
 * @param {object} options.backend createRoomBackend(..., {roomId})
 * @param {object} options.run the ai_run row ({id, accountId, access})
 * @param {(type: string, fields?: object) => Promise<void>} [options.emit] the run's event log
 * @param {(status: string) => unknown} [options.setStatus]
 * @param {() => boolean | Promise<boolean>} [options.isCancelled]
 * @param {boolean} [options.plan]
 * @param {boolean} [options.helper]
 * @param {number} [options.approvalTimeoutMs]
 * @param {number} [options.pollMs]
 * @param {(ms: number) => Promise<unknown>} [options.waitForChange] waits at most `ms` for a
 *   change to the run (a decision or cancel); default: poll every `pollMs`. The AiRun Durable
 *   Object passes its notifier, woken by the approval and cancel endpoints and by its alarm.
 */
export function createRunPolicy({
  env,
  backend,
  run,
  emit = async () => {},
  setStatus = async () => {},
  isCancelled = () => false,
  plan = false,
  helper = false,
  approvalTimeoutMs = APPROVAL_TIMEOUT_MS,
  pollMs = APPROVAL_POLL_MS,
  waitForChange = (ms) => sleep(Math.min(ms, pollMs)),
}) {
  const access = run?.access || "ask";
  const isWrite = (definition) => !!definition && !isReadOnlyTool(definition);
  const writeRefusal = helper ? HELPER_REFUSAL : plan ? PLAN_REFUSAL : null;
  const resolved = (requestId, allow, reason) =>
    emit("permission-resolved", { requestId, allow, reason });

  return {
    access,
    plan,
    /** Whether write tools are offered at all (a plan run offers them and refuses each call). */
    writes: !helper,
    offers: (definition, name) =>
      !ROOM_ESCAPING.has(name) && (isReadOnlyTool(definition) || !helper),

    /**
     * Before a tool call (arguments not checked yet): the room role and the plan/helper rules.
     * @returns {Promise<{allow: true} | {allow: false, message: string, stop?: boolean}>}
     */
    async authorize({ definition }) {
      const { role } = await backend.role();
      if (!role) return { allow: false, stop: true, message: NO_ACCESS };
      if (!isWrite(definition)) return { allow: true };
      if (writeRefusal) return { allow: false, message: writeRefusal };
      if (!atLeast(role, "editor")) return { allow: false, message: cannotEdit(role) };
      return { allow: true };
    },

    /** The recorded result of a write that already ran in this run (at most once), or null. */
    async recorded({ toolCallId, definition }) {
      if (!isWrite(definition) || !toolCallId) return null;
      const row = await getToolResult(env, run.id, toolCallId);
      return row ? recordedResult(row) : null;
    },

    /**
     * After the arguments are checked, before the call runs: under `access: "ask"` a write waits
     * for the user's decision (permission-request → ai_approval → permission-resolved).
     * @returns {Promise<{allow: true} | {allow: false, message?: string, cancelled?: boolean}>}
     */
    async approve({ name, toolCallId, args, definition }) {
      if (!isWrite(definition) || access !== "ask") return { allow: true };
      const hash = await argsHash(name, args);
      let approval = await approvalForCall(env, run.id, toolCallId);
      let requestId = approval?.requestId;
      if (!approval) {
        requestId = crypto.randomUUID();
        try {
          await createApproval(env, {
            runId: run.id,
            requestId,
            accountId: run.accountId,
            toolCallId,
            toolName: name,
            argsHash: hash,
          });
        } catch (error) {
          approval = await approvalForCall(env, run.id, toolCallId);
          if (!approval) throw error;
          requestId = approval.requestId;
        }
        if (!approval)
          await emit("permission-request", {
            requestId,
            toolCallId,
            name,
            input: args ?? {},
            title: toolTitle(name, args),
            argsHash: hash,
          });
      }
      // A tool call id the model repeated is bound to the first call's arguments.
      if (approval && approval.argsHash !== hash)
        return {
          allow: false,
          message: "This tool call id was already used with other arguments; the call was not run.",
        };
      let decided = approval?.decision ? approval : null;
      const announce = !decided;
      if (!decided) {
        await setStatus("awaiting-approval");
        const deadline = Date.now() + approvalTimeoutMs;
        for (;;) {
          const row = await getApproval(env, run.id, requestId);
          if (row?.decision) {
            decided = row;
            break;
          }
          if (await isCancelled()) await decideApproval(env, run.id, requestId, false, "cancelled");
          else if (Date.now() >= deadline)
            await decideApproval(env, run.id, requestId, false, "timeout");
          else await waitForChange(Math.max(1, deadline - Date.now()));
        }
      }
      const allow = decided.decision === "allow" && decided.argsHash === hash;
      if (announce) await resolved(requestId, allow, decided.reason || "user");
      if (allow) return { allow: true };
      if (decided.reason === "cancelled") return { allow: false, cancelled: true };
      if (decided.reason === "timeout")
        return {
          allow: false,
          message: `The approval request timed out after ${Math.round(approvalTimeoutMs / 1000)} s; the call was not run (denied).`,
        };
      return {
        allow: false,
        message:
          "The user denied this tool call (denied by user); it was not run. Do not retry it unless the user asks.",
      };
    },

    /**
     * Run one call. A write re-checks the plan rules, its approval and the room role immediately
     * before it runs, claims (runId, toolCallId) and records its result; a claimed call returns the
     * recorded result instead of running again.
     * @returns {Promise<{output: string, isError: boolean, stop?: boolean}>}
     */
    async execute({ name, args, toolCallId, definition }) {
      if (!isWrite(definition)) return runTool(backend, name, args);
      if (writeRefusal) return { output: writeRefusal, isError: true };
      const prior = await getToolResult(env, run.id, toolCallId);
      if (prior) return recordedResult(prior);
      if (access === "ask") {
        const approval = await approvalForCall(env, run.id, toolCallId);
        if (
          approval?.decision !== "allow" ||
          approval.accountId !== run.accountId ||
          approval.argsHash !== (await argsHash(name, args))
        )
          return { output: NOT_APPROVED, isError: true };
      }
      const { role } = await backend.role();
      if (!role) return { output: NO_ACCESS, isError: true, stop: true };
      if (!atLeast(role, "editor")) return { output: cannotEdit(role), isError: true };
      const claimed = await recordToolResult(env, {
        runId: run.id,
        toolCallId,
        toolName: name,
        output: PENDING_RESULT,
        isError: true,
      });
      if (!claimed) return recordedResult(await getToolResult(env, run.id, toolCallId));
      let outcome;
      try {
        outcome = await runTool(backend, name, args);
      } catch (error) {
        outcome = { output: error?.message || String(error), isError: true };
      }
      await completeToolResult(env, run.id, toolCallId, outcome);
      return outcome;
    },

    /** Deny every undecided approval of the run (it is ending) and announce each. */
    async denyPending(reason = "cancelled") {
      for (const requestId of await denyPending(env, run.id, reason))
        await resolved(requestId, false, reason);
    },
  };
}

/** The system prompt: design persona, runtime facts, room context, design style, tool guide. */
export function buildSystemPrompt({ room, role, designStyle, writes, access = "ask", plan }) {
  const lines = [
    designPersona,
    `You are running in Verynize's model API chat. Canvas work goes through the Verynize design tools against one shared cloud room: "${room.title || "Untitled"}" (room id ${room.id}; your role: ${role}). Omit "document" in tool calls or pass that id; other rooms are not reachable from this chat and you cannot create rooms. Collaborators with the room open see changes live.`,
    writes
      ? `Write tools change the room for every collaborator. ${access === "ask" ? "Each write call waits for the user's approval; a denied call is not run, so do not repeat it unless the user asks." : "The user allowed writes without approval for this chat."} There is no screenshot tool; inspect elements with get_element_tree and get_element_code.`
      : "This chat can read the room but not change it: only read tools are available. When the user asks for changes, explain what you would change. There is no screenshot tool; inspect elements with get_element_tree and get_element_code.",
  ];
  if (plan)
    lines.push(
      "Plan before editing (set by the user for this run): inspect what you need with read tools and reply with a short numbered plan of the changes you intend to make. Do not call write tools: they are refused in this run. The user approves the plan by starting a new run.",
    );
  if (designStyle && DESIGN_STYLE.test(designStyle))
    lines.push(
      `Design style chosen by the user: ${designStyle}. Load it with get_design_guidelines {style: "${designStyle}"} before designing, and follow it unless the user asks otherwise.`,
    );
  lines.push(`Tool guide:\n${HOSTED_INSTRUCTIONS}`);
  return lines.join("\n\n");
}

/**
 * Run one chat turn to completion. Never throws: failures end the run with `error` + `done`.
 * @param {object} options
 * @param {object} options.env bindings (DB for state)
 * @param {object} options.run the ai_run row
 * @param {object} options.backend createRoomBackend(..., {roomId: run.roomId})
 * @param {{id: string, title: string|null}} options.room
 * @param {string} options.role the caller's role at the start
 * @param {string} options.prompt
 * @param {Array<{role: "user"|"assistant", text: string}>} [options.history]
 * @param {string} [options.designStyle]
 * @param {{maxTurns: number, maxToolCalls: number}} options.limits
 * @param {{apiKey: string, baseUrl?: string, origin?: string}} options.provider
 * @param {ReturnType<typeof createEventLog>} options.log
 * @param {boolean} [options.plan] refuse write calls (plan first)
 * @param {boolean} [options.helper] read-only helper run (no write tools)
 * @param {number} [options.approvalTimeoutMs] how long an `ask` write waits for its decision
 * @param {ReturnType<typeof createRunPolicy>} [options.policy] replaces the default policy
 * @param {AbortSignal} [options.signal] cancels the run when aborted (the AiRun Durable Object's
 *   cancel notification)
 * @param {boolean} [options.heartbeat] poll the cancel flag and renew the lease from the database
 *   on a timer (default true). The AiRun Durable Object passes false: its alarm renews the lease
 *   and the cancel endpoint notifies it.
 * @param {(ms: number) => Promise<unknown>} [options.waitForChange] see createRunPolicy
 */
export async function executeRun(options) {
  const {
    env,
    run,
    backend,
    room,
    role,
    prompt,
    history = [],
    designStyle,
    limits,
    provider,
    log,
    plan = false,
    helper = false,
    approvalTimeoutMs,
    signal,
    heartbeat = true,
    waitForChange,
  } = options;
  const emit = log.emit;
  const abortController = new AbortController();
  const state = {
    cancelled: false,
    budget: false,
    error: null,
    credentialProblem: null,
    toolCalls: 0,
    turnToolCalls: 0,
    lastTurnToolCalls: 0,
    status: null,
    inputTokens: 0,
    outputTokens: 0,
    names: new Map(),
    errors: new Map(),
    texts: new Map(),
  };
  const setStatus = (status) => {
    if (state.status === status) return;
    state.status = status;
    return emit("status", { status });
  };
  const cancel = () => {
    if (state.cancelled) return;
    state.cancelled = true;
    abortController.abort("cancelled");
  };
  const policy =
    options.policy ||
    createRunPolicy({
      env,
      backend,
      run,
      emit,
      setStatus,
      isCancelled: async () => state.cancelled || (await cancelRequested(env, run.id)),
      plan,
      helper,
      approvalTimeoutMs,
      ...(waitForChange ? { waitForChange } : {}),
    });
  if (signal?.aborted) cancel();
  signal?.addEventListener("abort", cancel, { once: true });

  // Cancel flag and lease, polled from the database so a cancel from any instance is seen (unless
  // the host renews the lease and delivers cancel itself: heartbeat false).
  let lastRenew = Date.now();
  let ticking = false;
  const ticker = heartbeat
    ? setInterval(async () => {
        if (ticking) return;
        ticking = true;
        try {
          const now = Date.now();
          const wanted =
            now - lastRenew >= RENEW_MS
              ? ((lastRenew = now), await renewLease(env, run.id, now))
              : await cancelRequested(env, run.id);
          if (wanted) cancel();
        } catch {
          // A transient database error: the next tick retries; the lease has slack.
        } finally {
          ticking = false;
        }
      }, TICK_MS)
    : null;

  let code = "ok";
  try {
    await emit("session", { sessionId: run.id, agent: "openrouter", model: run.model });
    await setStatus("running");

    const definitions = Object.entries(hostedToolDefinitions()).filter(([name, definition]) =>
      policy.offers(definition, name),
    );
    const tools = definitions.map(([name, definition]) =>
      toolDefinition({
        name,
        description: definition.description,
        inputSchema: z.object(definition.inputSchema).strict(),
      }).server(async (args, context) => {
        if (context?.abortSignal?.aborted) {
          state.errors.set(context.toolCallId, true);
          return "Cancelled.";
        }
        const { output, isError, stop } = await policy.execute(
          { name, args, toolCallId: context?.toolCallId, definition },
          run,
        );
        if (isError) state.errors.set(context?.toolCallId, true);
        // Access to the room was lost: the result goes back, then the run ends.
        if (stop) state.error ||= output;
        return output;
      }),
    );
    const byName = new Map(definitions);

    const middleware = {
      name: "verynize-policy",
      async onBeforeToolCall(_ctx, call) {
        if (state.cancelled || (await cancelRequested(env, run.id))) {
          cancel();
          return { type: "abort", reason: "cancelled" };
        }
        if (state.toolCalls >= limits.maxToolCalls) {
          state.budget = true;
          state.errors.set(call.toolCallId, true);
          return {
            type: "skip",
            result: `Tool call budget reached (${limits.maxToolCalls} per run); the run stops here.`,
          };
        }
        state.toolCalls++;
        const verdict = await policy.authorize({
          name: call.toolName,
          toolCallId: call.toolCallId,
          args: call.args,
          definition: byName.get(call.toolName),
        });
        if (!verdict.allow) {
          state.errors.set(call.toolCallId, true);
          if (verdict.stop) {
            state.error = verdict.message;
            return { type: "abort", reason: verdict.message };
          }
          return { type: "skip", result: verdict.message };
        }
        // A write that already ran in this run (repeated tool call id): its recorded result.
        const recorded = await policy.recorded?.({
          toolCallId: call.toolCallId,
          definition: byName.get(call.toolName),
        });
        if (recorded) {
          if (recorded.isError) state.errors.set(call.toolCallId, true);
          return { type: "skip", result: recorded.output };
        }
      },
      // Arguments checked: an `ask` write waits here for the user's decision.
      async onGuardToolCall(_ctx, call) {
        const verdict = (await policy.approve?.({
          name: call.toolName,
          toolCallId: call.toolCallId,
          args: call.args,
          definition: byName.get(call.toolName),
        })) || { allow: true };
        if (verdict.cancelled) {
          cancel();
          state.errors.set(call.toolCallId, true);
          return { type: "abort", reason: "cancelled" };
        }
        if (!verdict.allow) {
          state.errors.set(call.toolCallId, true);
          await setStatus("running");
          return { type: "skip", result: verdict.message };
        }
        await setStatus("tool");
      },
      onAfterToolCall(_ctx, info) {
        if (!info.ok) state.errors.set(info.toolCallId, true);
      },
      onShouldContinue() {
        if (state.budget || state.cancelled || state.error) return false;
      },
      async onIteration(_ctx, info) {
        if (info.iteration > 0) await setStatus("running");
      },
    };

    const messages = [
      ...history.map((item) => ({ role: item.role, content: item.text })),
      { role: "user", content: prompt },
    ];
    const stream = chat({
      adapter: openRouterAdapter(run.model, provider, abortController.signal, (message) => {
        state.credentialProblem ||= message;
      }),
      threadId: run.chatId,
      runId: run.id,
      systemPrompts: [
        buildSystemPrompt({
          room,
          role,
          designStyle,
          writes: policy.writes !== false,
          access: policy.access,
          plan: policy.plan,
        }),
      ],
      messages,
      tools,
      toolExecution: "sequential",
      agentLoopStrategy: maxIterations(limits.maxTurns),
      abortController,
      middleware: [middleware],
      debug: false,
    });

    for await (const chunk of stream) {
      switch (chunk.type) {
        case "TEXT_MESSAGE_CONTENT":
          if (chunk.delta) {
            state.texts.set(
              chunk.messageId,
              (state.texts.get(chunk.messageId) || "") + chunk.delta,
            );
            await emit("assistant-text-delta", { text: chunk.delta });
          }
          break;
        case "TEXT_MESSAGE_END": {
          const text = state.texts.get(chunk.messageId);
          state.texts.delete(chunk.messageId);
          if (text) await emit("assistant-text", { text });
          break;
        }
        case "REASONING_MESSAGE_CONTENT":
          if (chunk.delta) await emit("thinking-delta", { text: chunk.delta });
          break;
        case "TOOL_CALL_START":
          // The text before a tool call is complete: report it before the call, as on desktop.
          for (const [messageId, text] of state.texts) {
            state.texts.delete(messageId);
            if (text) await emit("assistant-text", { text });
          }
          state.names.set(chunk.toolCallId, chunk.toolCallName);
          state.turnToolCalls++;
          break;
        case "TOOL_CALL_ARGS":
          if (chunk.delta)
            await emit("tool-input-delta", { toolCallId: chunk.toolCallId, delta: chunk.delta });
          break;
        case "TOOL_CALL_END":
          await emit("tool-call", {
            toolCallId: chunk.toolCallId,
            name: state.names.get(chunk.toolCallId) || chunk.toolCallName || "",
            input: chunk.input ?? {},
          });
          break;
        case "TOOL_CALL_RESULT": {
          const isError = state.errors.get(chunk.toolCallId) === true;
          let output =
            typeof chunk.content === "string" ? chunk.content : JSON.stringify(chunk.content);
          if (isError)
            try {
              const parsed = JSON.parse(output);
              if (typeof parsed?.error === "string") output = parsed.error;
            } catch {}
          await emit("tool-result", {
            toolCallId: chunk.toolCallId,
            name: state.names.get(chunk.toolCallId) || "",
            output,
            isError,
          });
          break;
        }
        case "RUN_FINISHED":
          state.inputTokens += chunk.usage?.promptTokens || 0;
          state.outputTokens += chunk.usage?.completionTokens || 0;
          state.lastTurnToolCalls = state.turnToolCalls;
          state.turnToolCalls = 0;
          break;
        case "RUN_ERROR":
          state.error ||= chunk.error?.message || chunk.message || "The model request failed";
          break;
      }
    }
    if (state.cancelled) code = "cancelled";
    else if (state.error) code = "error";
    // The loop ended while the model still wanted tools: a budget stopped it.
    else if (state.budget || state.lastTurnToolCalls > 0) code = "budget";
  } catch (error) {
    if (state.cancelled) code = "cancelled";
    else {
      code = "error";
      state.error ||= error?.message || String(error);
    }
  } finally {
    if (ticker) clearInterval(ticker);
    signal?.removeEventListener("abort", cancel);
  }
  // The provider refused the credential (or it was deleted): say so plainly instead of the SDK's
  // error text.
  if (state.credentialProblem && code !== "cancelled") {
    code = "error";
    state.error = state.credentialProblem;
  }

  // Approvals still waiting when the run ends are denied (and announced before done).
  try {
    await policy.denyPending?.("cancelled");
  } catch (error) {
    console.error("ai run could not deny pending approvals", run.id, error?.message);
  }

  try {
    await log.flush().catch(() => {});
    if (state.inputTokens || state.outputTokens)
      await emit("usage", {
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        model: run.model,
      });
    if (code === "error") await emit("error", { message: state.error });
    await emit("done", { code, stopped: code === "cancelled", sessionId: run.id });
    await finishRun(env, run.id, code);
  } catch (error) {
    // The events could not be stored (the database is unreachable, or another reader finished
    // this run after its lease expired). The lease runs out and the next reader closes the run.
    console.error("ai run could not finish", run.id, error?.message);
  }
  return code;
}
