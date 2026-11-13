// A local stand-in for OpenRouter's OpenAI-compatible chat completions endpoint
// (POST <base>/chat/completions with stream: true), for the model API runtime tests. It is the
// only fake in those tests: the backend, rooms, database and tools are real.
//
// Scenarios are chosen by a marker in the latest user message, `[scenario:<name>]`, and the turn
// within a scenario by the number of tool results already in the request (0 for the first model
// call, 1 after one tool round, …). A turn is a list of steps:
//   {text: "..."}                          assistant text, streamed in a few deltas
//   {tool: "name", args: {...}, id?}       one tool call (arguments streamed in two pieces); any
//                                          tool name, read or write (create_artboard, …); `args`
//                                          may be a function of the request body, and `id` fixes
//                                          the tool call id (the same id twice scripts a repeat)
//   {delay: ms}                            wait before the next step
//   {wait: Promise<void>}                  wait for the test to observe the preceding deltas
//   {hang: true}                           keep the stream open until the client goes away
// Every request is recorded (`requests`), so tests can assert what the backend sent (for writes:
// the tool message the model got back, e.g. a denial). `userText(body)` and `toolMessages(body)`
// read a recorded request.
//
// It also stands in for OpenRouter's key endpoints (docs/ai-runtime.md "Credentials"):
//   GET  /auth?callback_url&code_challenge&code_challenge_method=S256&state   the sign-in page:
//        approves at once and redirects (302) to callback_url?code=<code>&state=<state>
//   POST /api/v1/auth/keys {code, code_verifier, code_challenge_method}  → {key} once per code,
//        403 when the verifier does not match the challenge or the code was used
//   GET  /api/v1/key (Bearer)  → {data: {label, limit, usage, …}} for a known key, else 401
// Known keys are those in `keys` (add pasted test keys there) plus the ones issued by /auth.
// Chat completions answer 401 for a key in `rejected` and 402 for one in `noCredits`.
import { createHash } from "node:crypto";
import http from "node:http";

const sse = (res, payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

/** Text of the latest user message of a chat completions request body. */
export function userText(body) {
  const lastUser = [...(body.messages || [])].reverse().find((m) => m.role === "user");
  return typeof lastUser?.content === "string"
    ? lastUser.content
    : (lastUser?.content || []).map((part) => part.text || "").join("");
}

/** The tool result messages of a request body, as {id, content}. */
export const toolMessages = (body) =>
  (body.messages || [])
    .filter((m) => m.role === "tool")
    .map((m) => ({
      id: m.tool_call_id,
      content:
        typeof m.content === "string"
          ? m.content
          : (m.content || []).map((part) => part.text || "").join(""),
    }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {Record<string, Array<Array<object>> | ((body: object) => Array<object>)>} scenarios
 * @returns {Promise<{baseUrl: string, requests: object[], keys: Set<string>,
 *   rejected: Set<string>, noCredits: Set<string>, authRequests: object[], exchanges: object[],
 *   close(): Promise<void>}>}
 */
export async function startFakeOpenRouter(scenarios) {
  const requests = [];
  const keys = new Set();
  const rejected = new Set();
  const noCredits = new Set();
  const codes = new Map();
  const authRequests = [];
  const exchanges = [];
  let counter = 0;
  let issued = 0;
  const sendJson = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const bearer = (req) => /^Bearer (.+)$/.exec(req.headers.authorization || "")?.[1] || "";
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, "http://fake");
    if (req.method === "GET" && url.pathname === "/auth") {
      const params = Object.fromEntries(url.searchParams);
      authRequests.push(params);
      const code = `code-${++issued}-${Math.random().toString(36).slice(2)}`;
      const key = `sk-or-v1-oauth-${issued}-${Math.random().toString(36).slice(2, 10)}`;
      codes.set(code, {
        key,
        challenge: params.code_challenge,
        method: params.code_challenge_method,
      });
      keys.add(key);
      const back = new URL(params.callback_url);
      back.searchParams.set("code", code);
      if (params.state) back.searchParams.set("state", params.state);
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (req.method === "POST" && url.pathname === "/api/v1/auth/keys") {
      const body = JSON.parse(raw || "{}");
      exchanges.push(body);
      const entry = codes.get(body.code);
      codes.delete(body.code);
      const challenge = createHash("sha256")
        .update(String(body.code_verifier || ""))
        .digest("base64url");
      if (!entry || entry.method !== body.code_challenge_method || entry.challenge !== challenge)
        return sendJson(res, 403, { error: "Invalid code or code_verifier" });
      return sendJson(res, 200, { key: entry.key, user_id: "fake-user" });
    }
    if (req.method === "GET" && url.pathname === "/api/v1/key") {
      const key = bearer(req);
      if (!keys.has(key) || rejected.has(key))
        return sendJson(res, 401, { error: { message: "User not found.", code: 401 } });
      return sendJson(res, 200, {
        data: {
          label: `fake key ${key.slice(-4)}`,
          limit: 10,
          usage: 1.25,
          limit_remaining: 8.75,
          is_free_tier: false,
        },
      });
    }
    if (req.method === "POST" && req.url.endsWith("/chat/completions")) {
      const key = bearer(req);
      const refused = rejected.has(key) ? 401 : noCredits.has(key) ? 402 : 0;
      if (refused) {
        requests.push({ headers: req.headers, body: JSON.parse(raw || "{}"), refused });
        return sendJson(res, refused, {
          error: {
            message: refused === 401 ? "User not found." : "Insufficient credits",
            code: refused,
          },
        });
      }
    }
    if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "not found", code: 404 } }));
    }
    const body = JSON.parse(raw || "{}");
    requests.push({ headers: req.headers, body });
    const messages = body.messages || [];
    const name = /\[scenario:([\w-]+)\]/.exec(userText(body))?.[1] || "default";
    const scenario = scenarios[name] || scenarios.default;
    const turnIndex = messages.filter((m) => m.role === "tool").length;
    const turns = typeof scenario === "function" ? null : scenario;
    const steps =
      typeof scenario === "function"
        ? scenario(body)
        : turns?.[Math.min(turnIndex, turns.length - 1)] || [{ text: "(no script)" }];

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    let closed = false;
    res.on("close", () => (closed = true));
    const id = `gen-${++counter}`;
    const model = body.model || "fake/model";
    const base = {
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
    };
    const chunk = (delta, finishReason = null) =>
      sse(res, { ...base, choices: [{ index: 0, delta, finish_reason: finishReason }] });
    chunk({ role: "assistant", content: "" });
    let toolIndex = 0;
    for (const step of steps) {
      if (closed) return;
      if (step.delay) await sleep(step.delay);
      else if (step.wait) await step.wait;
      else if (step.hang) {
        while (!closed) await sleep(50);
        return;
      } else if (step.text !== undefined) {
        const words = String(step.text).match(/\S+\s*/g) || [""];
        for (const word of words) {
          chunk({ content: word });
          await sleep(5);
        }
      } else if (step.tool) {
        const args = JSON.stringify(
          (typeof step.args === "function" ? step.args(body) : step.args) || {},
        );
        const half = Math.ceil(args.length / 2);
        const callId = step.id || `call_${counter}_${toolIndex}`;
        chunk({
          tool_calls: [
            {
              index: toolIndex,
              id: callId,
              type: "function",
              function: { name: step.tool, arguments: args.slice(0, half) },
            },
          ],
        });
        chunk({ tool_calls: [{ index: toolIndex, function: { arguments: args.slice(half) } }] });
        toolIndex++;
      }
    }
    if (closed) return;
    chunk({}, toolIndex ? "tool_calls" : "stop");
    sse(res, {
      ...base,
      choices: [],
      usage: {
        prompt_tokens: 100 + turnIndex,
        completion_tokens: 10,
        total_tokens: 110 + turnIndex,
      },
    });
    res.write("data: [DONE]\n\n");
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    requests,
    keys,
    rejected,
    noCredits,
    authRequests,
    exchanges,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
