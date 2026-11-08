// Chat agent transport: one interface for running chat turns, whatever executes them. The chat runner
// (web/desktop-panel.js) and the chat island reach the current service through `platform.agents.service()`
// (web/platform.js); web/src/lib/agent-transport.ts creates and registers it.
//
// - Desktop: Claude Code / Codex in the main process, over IPC (`window.desktop.runAgent` …, desktop/README.md).
//   The calls and their arguments are passed through unchanged.
// - Web: the cloud backend's model API runtime (`/api/ai/*`, docs/ai-runtime.md) against the open cloud room.
//   A turn is `POST /api/ai/runs` read as a streamed SSE body (fetch, not EventSource: it needs POST and the
//   session header), resumed with `GET /api/ai/runs/:id/events?after=<lastSeq>` when the connection drops.
//
// Both deliver the same events, `{id: runId, chatId, seq, type, …}` in the desktop vocabulary (desktop/README.md
// `onAgentEvent`): the web events keep their own fields and gain the desktop names the runner reads (see
// `normalizeWebEvent`).
//
// No React and no DOM here, so the module stays testable on its own.
import type { AgentEvent, DesktopApi } from "./desktop-api";
import { textOf } from "./utils";

export type { AgentEvent };
export type AgentRuntime = "desktop" | "web";
/** A runtime the chat can pick: `claude`/`codex` on the desktop, `openrouter` (model API) on the web. */
export type AgentInfo = { id: string; label?: string; available: boolean; reason?: string };
export type AgentModelInfo = { id: string; name: string; description?: string };
export type AgentHistoryItem = { role: "user" | "assistant"; text: string };
/** `runAgent` options (desktop/README.md); the web transport reads the subset `/api/ai/runs` accepts. */
export type AgentRunOptions = {
  agent: string;
  prompt: string;
  chatId: string;
  model?: string;
  access?: string;
  designStyle?: string;
  /** Web: earlier turns of the chat (the model API keeps no provider session). */
  history?: AgentHistoryItem[];
  /** Web: the turn's idempotency key; a new one is made when absent. */
  idempotencyKey?: string;
  [key: string]: unknown;
};
export type AgentRunResult = {
  id: string;
  runtime?: string;
  access?: string;
  [key: string]: unknown;
};
export type AgentPermissionAnswer = { requestId: string; allow: boolean; always?: boolean };
export type AgentListener = (event: AgentEvent) => void;

export interface AgentService {
  readonly kind: AgentRuntime;
  /** True when a turn can start now (web: signed in on this server, the model API enabled, OpenRouter connected). */
  ready(): boolean;
  /** Start one turn; resolves with the run id once the runtime accepted it. Events follow through `subscribe`. */
  run(options: AgentRunOptions): Promise<AgentRunResult>;
  cancel(runId: string): Promise<void>;
  respondPermission(answer: AgentPermissionAnswer): Promise<void>;
  subscribe(listener: AgentListener): () => void;
  models(options: { agent: string }): Promise<AgentModelInfo[]>;
  discover(): Promise<AgentInfo[]>;
}

/* ---------- desktop: IPC, unchanged ---------- */

export function createDesktopAgentService(desktop: DesktopApi): AgentService {
  return {
    kind: "desktop",
    ready: () => true,
    run: (options) => desktop.runAgent(options) as Promise<AgentRunResult>,
    cancel: async (runId) => {
      await desktop.cancelAgent(runId);
    },
    respondPermission: async (answer) => {
      await desktop.respondAgentPermission(answer);
    },
    subscribe: (listener) => desktop.onAgentEvent(listener),
    models: (options) => desktop.listAgentModels(options) as Promise<AgentModelInfo[]>,
    discover: () => desktop.discoverAgents() as Promise<AgentInfo[]>,
  };
}

/* ---------- web: /api/ai/* ---------- */

/** `GET /api/ai/config` (cloud/ai.js aiConfig). */
export type AiConfig = {
  enabled: boolean;
  provider: string;
  models: { id: string; label: string }[];
  defaultModel: string | null;
  limits?: { maxTurns: number; maxToolCalls: number };
  /**
   * Whether the signed-in account can start a run: `connected` (its own OpenRouter key), `server` (the operator's
   * opted-in shared key) or `missing`. Absent on servers from before per-account keys (then `enabled` decides).
   */
  credentials?: { openrouter: "connected" | "server" | "missing" };
};

/** True when the config lets the account start a run (runtime on and a credential to run with). */
export const canRun = (config: AiConfig | null | undefined) =>
  !!config?.enabled && config.credentials?.openrouter !== "missing";

/** What the chat says when the model API cannot run a turn. Shown verbatim (tests match them). */
export const WEB_AGENT_MESSAGES = {
  signedOut: "Sign in to use chat",
  notConfigured: "Model API not configured on this server",
  needsCredentials: "Connect your OpenRouter account",
  noRoom: "Open or share a cloud room to chat with the model API",
} as const;

export const WEB_AGENT = { id: "openrouter", label: "OpenRouter" } as const;

export type WebAgentDeps = {
  /** Authenticated request to the account's server (session header added), or null when not signed in there. */
  request(path: string, init?: RequestInit): Promise<Response> | null;
  /** The model API configuration of the signed-in account's server; null when signed out. */
  config(): Promise<AiConfig | null>;
  /** The cloud room the editor has open on this server, or null. */
  room(): string | null;
  ready(): boolean;
  /** Waits between reconnect attempts after a dropped stream (ms); the last one ends the run as failed. */
  retryDelays?: number[];
  /** The server refused a start for want of a credential (`credentials_required`): refresh the config. */
  credentialsRequired?(): void;
};

const STATUS_TEXT: Record<string, string> = {
  running: "Running",
  tool: "Using a tool",
  "awaiting-approval": "Waiting for approval",
};

/**
 * A model API event in the desktop vocabulary: `tool-call`/`permission-request` gain `toolName` and `title`,
 * `tool-input-delta` gains `partial`, `tool-result` gains `content`, `status`/`error` gain `text`, and `done`
 * reports success as `code: 0` (the desktop's exit code) with `stopped` for a cancelled run.
 */
export function normalizeWebEvent(raw: AgentEvent): AgentEvent {
  const event: AgentEvent = { ...raw };
  switch (raw.type) {
    case "tool-call":
    case "permission-request":
      event.toolName = raw.name;
      event.title = typeof raw.title === "string" && raw.title ? raw.title : raw.name;
      break;
    case "tool-input-delta":
      event.partial = raw.delta;
      break;
    case "tool-result":
      event.content =
        typeof raw.output === "string" ? raw.output : JSON.stringify(raw.output ?? "");
      break;
    case "status":
      event.text = STATUS_TEXT[String(raw.status)] ?? textOf(raw.status ?? "");
      break;
    case "error":
      event.text = textOf(raw.message ?? raw.text ?? "The model API reported an error");
      break;
    case "done":
      event.code = raw.code === "ok" ? 0 : (raw.code ?? "error");
      event.stopped = raw.stopped === true || raw.code === "cancelled";
      break;
  }
  return event;
}

/**
 * Reads an SSE body (`data: <json>\n\n` per event; `:` comment lines are keep-alives) and calls `onEvent` for each
 * parsed event. Resolves when the body ends; rejects when the connection fails.
 */
export async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: AgentEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (block: string) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(line.startsWith("data: ") ? 6 : 5))
      .join("\n");
    if (!data) return;
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (event && typeof event === "object" && typeof (event as AgentEvent).type === "string")
      onEvent(event as AgentEvent);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
      let cut;
      while ((cut = buffer.indexOf("\n\n")) >= 0) {
        flush(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
      }
    }
    if (buffer.trim()) flush(buffer);
  } finally {
    reader.releaseLock();
  }
}

async function errorMessage(response: Response, onCode?: (code: string) => void): Promise<string> {
  const data = await response.json().catch(() => null);
  if (onCode && data && typeof data === "object" && typeof data.code === "string")
    onCode(data.code);
  return (
    (data && typeof data === "object" && (data.error || data.message)) ||
    `Server returned ${response.status}`
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const newKey = () =>
  "turn-" +
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

type WebRun = {
  runId: string | null;
  chatId: string;
  lastSeq: number;
  done: boolean;
  /** Text deltas arrived since the last complete text block. */
  streamed: boolean;
};

export function createWebAgentService(deps: WebAgentDeps): AgentService {
  const listeners = new Set<AgentListener>();
  /** Pending approval request id → its run (the approvals endpoint is per run) and the call's `argsHash`, which an
   *  approval must echo (the server answers 409 when it does not match the pending call). */
  const approvals = new Map<string, { runId: string; argsHash?: string }>();
  const delays = deps.retryDelays ?? [250, 1000, 2000, 4000, 8000];

  const emit = (event: AgentEvent) => {
    for (const listener of listeners)
      try {
        listener(event);
      } catch (error) {
        console.error(error);
      }
  };
  const request = (path: string, init?: RequestInit) => {
    const pending = deps.request(path, init);
    if (!pending) throw Error(WEB_AGENT_MESSAGES.signedOut);
    return pending;
  };
  const post = (path: string, body: unknown) =>
    request(path, { method: "POST", body: JSON.stringify(body) });

  /** Closes a run the client can no longer follow: an `error` and a failed `done`, after the last seen event. */
  const abandon = (run: WebRun, message: string) => {
    if (run.done || !run.runId) return;
    run.done = true;
    const base = { id: run.runId, chatId: run.chatId };
    emit(normalizeWebEvent({ ...base, seq: ++run.lastSeq, type: "error", message }));
    emit(
      normalizeWebEvent({
        ...base,
        seq: ++run.lastSeq,
        type: "done",
        code: "error",
        stopped: false,
        sessionId: run.runId,
      }),
    );
  };

  async function start(options: AgentRunOptions): Promise<AgentRunResult> {
    const config = await deps.config();
    if (!config) throw Error(WEB_AGENT_MESSAGES.signedOut);
    if (!config.enabled) throw Error(WEB_AGENT_MESSAGES.notConfigured);
    if (!canRun(config)) throw Error(WEB_AGENT_MESSAGES.needsCredentials);
    const roomId = deps.room();
    if (!roomId) throw Error(WEB_AGENT_MESSAGES.noRoom);
    const model =
      options.model && config.models.some((entry) => entry.id === options.model)
        ? options.model
        : undefined;
    const body = {
      chatId: options.chatId,
      roomId,
      prompt: options.prompt,
      idempotencyKey: options.idempotencyKey || newKey(),
      ...(model ? { model } : {}),
      ...(options.access ? { access: options.access } : {}),
      ...(options.designStyle ? { designStyle: options.designStyle } : {}),
      ...(options.history?.length ? { history: options.history } : {}),
    };
    const run: WebRun = {
      runId: null,
      chatId: options.chatId,
      lastSeq: 0,
      done: false,
      streamed: false,
    };
    return new Promise<AgentRunResult>((resolve, reject) => {
      let accepted = false;
      const deliver = (raw: AgentEvent) => {
        if (run.done) return;
        if (!run.runId) {
          if (typeof raw.id !== "string") return;
          run.runId = raw.id;
        }
        if (typeof raw.seq === "number") {
          if (raw.seq <= run.lastSeq) return; // replayed after a reconnect
          run.lastSeq = raw.seq;
        }
        if (!accepted) {
          accepted = true;
          resolve({
            id: run.runId,
            runtime: WEB_AGENT.id,
            access: body.access ?? "ask",
            model: model ?? config.defaultModel,
            roomId,
          });
        }
        // The model API reports every text block twice, streamed (`assistant-text-delta`) and then whole
        // (`assistant-text`); on the desktop `assistant-text` means a block that was not streamed. Keep the deltas.
        if (raw.type === "assistant-text-delta") run.streamed = true;
        if (raw.type === "assistant-text") {
          const streamed = run.streamed;
          run.streamed = false;
          if (streamed) return;
        }
        const event = normalizeWebEvent(raw);
        if (event.type === "permission-request" && typeof event.requestId === "string")
          approvals.set(event.requestId, {
            runId: run.runId,
            ...(typeof event.argsHash === "string" ? { argsHash: event.argsHash } : {}),
          });
        if (event.type === "permission-resolved" && typeof event.requestId === "string")
          approvals.delete(event.requestId);
        if (event.type === "done") {
          run.done = true;
          for (const [requestId, pending] of approvals)
            if (pending.runId === run.runId) approvals.delete(requestId);
        }
        emit(event);
      };
      const fail = (message: string) => {
        if (!accepted) reject(Error(message));
        else abandon(run, message);
      };

      void (async () => {
        let attempt = 0;
        // Until the first event names the run, a retry repeats the POST: the same idempotency key replays it.
        const open = () =>
          run.runId
            ? request(`/api/ai/runs/${run.runId}/events?after=${run.lastSeq}`)
            : post("/api/ai/runs", body);
        while (!run.done) {
          let response: Response | null = null;
          try {
            response = await open();
          } catch (error) {
            if (error instanceof Error && error.message === WEB_AGENT_MESSAGES.signedOut)
              return fail(error.message);
          }
          if (response && !response.ok) {
            const message = await errorMessage(response, (code) => {
              if (code === "credentials_required") deps.credentialsRequired?.();
            });
            // The start was refused (bad input, no room access, a running turn, limits, not configured), or the
            // run is gone / no longer ours: nothing to retry. Only an unreachable backend behind a proxy is.
            if (response.status !== 502 && response.status !== 504) return fail(message);
            response = null;
          }
          if (response?.body) {
            const before = run.lastSeq;
            try {
              await readSse(response.body, deliver);
            } catch {
              /* connection dropped: reconnect below */
            }
            if (run.lastSeq > before) attempt = 0;
          }
          if (run.done) return;
          if (attempt >= delays.length)
            return fail(
              "Lost the connection to the model API. The run may still be going on the server.",
            );
          await sleep(delays[attempt++]);
        }
      })();
    });
  }

  return {
    kind: "web",
    ready: () => deps.ready(),
    run: start,
    async cancel(runId) {
      const response = await post(`/api/ai/runs/${encodeURIComponent(runId)}/cancel`, {});
      if (!response.ok) throw Error(await errorMessage(response));
    },
    async respondPermission({ requestId, allow }) {
      const pending = approvals.get(requestId);
      if (!pending) throw Error("This approval request is no longer pending");
      const response = await post(`/api/ai/runs/${encodeURIComponent(pending.runId)}/approvals`, {
        requestId,
        allow,
        ...(pending.argsHash ? { argsHash: pending.argsHash } : {}),
      });
      // 409: already decided (timeout, cancel, another tab); the run's permission-resolved event settles the card.
      if (!response.ok && response.status !== 409) throw Error(await errorMessage(response));
      approvals.delete(requestId);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async models({ agent }) {
      if (agent !== WEB_AGENT.id) return [];
      const config = await deps.config();
      return (config?.enabled ? config.models : []).map((entry) => ({
        id: entry.id,
        name: entry.label || entry.id,
      }));
    },
    async discover() {
      let config: AiConfig | null = null;
      let failure = "";
      try {
        config = await deps.config();
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      const reason =
        failure ||
        (!config
          ? WEB_AGENT_MESSAGES.signedOut
          : !config.enabled
            ? WEB_AGENT_MESSAGES.notConfigured
            : !canRun(config)
              ? WEB_AGENT_MESSAGES.needsCredentials
              : undefined);
      return [{ ...WEB_AGENT, available: !reason, ...(reason ? { reason } : {}) }];
    },
  };
}
