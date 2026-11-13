const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { ChatGPTAuth, RESOURCE } = require("../desktop/chatgpt-auth.cjs");
const { AgentProfiles } = require("../desktop/agent-profiles.cjs");
const { AgentAuth } = require("../desktop/agent-auth.cjs");
const { AgentRuntime } = require("../desktop/agent-runtime.cjs");
const { createChatGPTProvider } = require("./helpers/chatgpt-provider.cjs");

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-siwc-"));
  const provider = await createChatGPTProvider();
  const profiles = new AgentProfiles({ userData: root });
  const opened = [],
    events = [];
  let now = Date.now(),
    welcomed = 0;
  const auth = new ChatGPTAuth({
    userData: root,
    profiles,
    fetchImpl: provider.fetch,
    now: () => now,
    openExternal: async (url) => {
      opened.push(url);
    },
    welcome: async () => {
      welcomed++;
    },
  });
  t.after(async () => {
    for (const attempt of auth.pending.values()) attempt.cancel();
    await provider.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  async function waitFor(predicate) {
    const deadline = Date.now() + 8000;
    while (!predicate()) {
      if (Date.now() > deadline) throw Error("Timed out waiting for sign-in");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  async function begin(slot = "system") {
    const count = opened.length;
    const result = await auth.login(slot, (event) => events.push(event));
    await waitFor(() => opened.length > count);
    return { result, url: opened.at(-1) };
  }
  async function finish(result) {
    await waitFor(() =>
      events.some((e) => e.id === result.id && ["complete", "error", "canceled"].includes(e.type)),
    );
    await waitFor(() => ![...auth.pending.values()].some((p) => p.id === result.id));
    return events.findLast((e) => e.id === result.id);
  }
  async function login(slot) {
    const attempt = await begin(slot);
    await provider.authorize(attempt.url);
    assert.equal((await finish(attempt.result)).type, "complete");
    return attempt;
  }
  return {
    root,
    provider,
    profiles,
    auth,
    opened,
    events,
    begin,
    finish,
    login,
    waitFor,
    advance: (ms) => {
      now += ms;
    },
    welcomed: () => welcomed,
  };
}

test("SIWC registers Verynize with PKCE, validates a signed identity and stores private local credentials", async (t) => {
  const f = await setup(t);
  const { url } = await f.login();
  const params = new URL(url).searchParams;
  assert.equal(params.get("client_id"), "dynamic_agent_client");
  assert.equal(params.get("agent_name_hint"), "Verynize");
  assert.equal(params.get("resource"), RESOURCE);
  assert.match(params.get("ext_agent_host_id"), /^urn:uuid:/);
  assert.match(params.get("redirect_uri"), /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  assert.equal(params.get("code_challenge_method"), "S256");
  const file = await f.auth.file();
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.dirname(file))).mode & 0o777, 0o700);
  const status = await f.auth.status();
  assert.equal(status.loggedIn, true);
  assert.equal(status.email, "local@example.com");
  assert.doesNotMatch(
    JSON.stringify([status, f.events]),
    /local-access-|refresh_token|id_token|code_verifier/,
  );
  const returning = await f.login();
  assert.equal(new URL(returning.url).searchParams.get("client_id"), status.registration);
  assert.equal(new URL(returning.url).searchParams.has("agent_name_hint"), false);
  assert.equal(
    new URL(returning.url).searchParams.get("ext_agent_host_id"),
    params.get("ext_agent_host_id"),
  );
  assert.equal(f.welcomed(), 1);
  const auth = new AgentAuth({
    siwc: f.auth,
    discover: async () => [{ id: "codex", path: "/codex", available: true }],
    spawnProcess: () => {
      throw Error("Must not call CLI auth");
    },
  });
  assert.equal((await auth.status({ agent: "codex" })).method, "Sign in with ChatGPT");
});

test("SIWC rejects invalid state, nonce, consent and mismatched returning registrations without replacing the account", async (t) => {
  const f = await setup(t);
  const attempt = await f.begin();
  assert.equal((await f.provider.authorize(attempt.url, { state: "wrong" })).status, 400);
  assert.equal((await f.auth.status()).loggedIn, false);
  await f.provider.authorize(attempt.url);
  assert.equal((await f.finish(attempt.result)).type, "complete");
  const original = await fs.readFile(await f.auth.file(), "utf8");
  for (const mode of [
    "nonce",
    "client",
    "subject",
    "consent",
    "scope",
    "issuer",
    "audience",
    "expired",
    "signature",
  ]) {
    const next = await f.begin();
    if (mode === "issuer") f.provider.settings.issuer = "https://attacker.example";
    if (mode === "audience") f.provider.settings.audience = "oaiapp_other";
    if (mode === "expired") f.provider.settings.expired = true;
    if (mode === "signature") f.provider.settings.corrupt = true;
    if (mode === "nonce") f.provider.settings.identity = { nonce: "wrong" };
    if (mode === "subject") f.provider.settings.subject = "another-user";
    if (mode === "scope") f.provider.settings.scopes = "openid email";
    await f.provider.authorize(
      next.url,
      mode === "client"
        ? { clientId: "oaiapp_other" }
        : mode === "consent"
          ? { error: "access_denied" }
          : {},
    );
    assert.equal((await f.finish(next.result)).type, "error", mode);
    assert.equal(await fs.readFile(await f.auth.file(), "utf8"), original, mode);
    f.provider.settings.identity = {};
    Object.assign(f.provider.settings, {
      issuer: null,
      audience: null,
      expired: false,
      corrupt: false,
    });
    f.provider.settings.subject = "local-user";
    f.provider.settings.scopes = require("../desktop/chatgpt-auth.cjs").SCOPES;
  }
});

test("SIWC rotates refresh tokens once across store instances, revokes on logout and preserves registration/host", async (t) => {
  const f = await setup(t);
  await f.login();
  const original = await f.auth.credentials();
  f.advance(3500000);
  const second = new ChatGPTAuth({
    userData: f.root,
    profiles: f.profiles,
    fetchImpl: f.provider.fetch,
    now: () => Date.now() + 3500000,
  });
  const records = await Promise.all([
    f.auth.credentials(),
    second.credentials(),
    f.auth.credentials(),
  ]);
  assert.equal(new Set(records.map((r) => r.refresh_token)).size, 1);
  assert.notEqual(records[0].refresh_token, original.refresh_token);
  assert.equal(
    f.provider.calls.filter((c) => c.params.get("grant_type") === "refresh_token").length,
    1,
  );
  const result = await f.auth.logout();
  assert.equal(result.revoked, true);
  assert.equal((await f.auth.status()).loggedIn, false);
  const saved = JSON.parse(await fs.readFile(await f.auth.file(), "utf8"));
  assert.equal(saved.client_id, original.client_id);
  assert.equal(saved.ext_agent_host_id, original.ext_agent_host_id);
  assert.equal(saved.access_token, undefined);
  assert.equal(saved.refresh_token, undefined);
  assert.equal(saved.id_token, undefined);
  await assert.rejects(() => f.auth.credentials(), { code: "SIWC_AUTH_REQUIRED" });
});

test("separate profiles, cancel and revoke failures do not expose or reuse another account", async (t) => {
  const f = await setup(t);
  await f.login();
  const profile = await f.profiles.add({ agent: "codex", name: "Work" });
  assert.equal((await f.auth.status(profile.id)).loggedIn, false);
  const attempt = await f.begin(profile.id);
  assert.deepEqual(f.auth.cancel(attempt.result.id), { canceled: true });
  assert.equal((await f.finish(attempt.result)).type, "canceled");
  assert.equal((await f.auth.status()).loggedIn, true);
  await f.login(profile.id);
  assert.notEqual(
    (await f.auth.status(profile.id)).registration,
    (await f.auth.status()).registration,
  );
  f.provider.settings.revokeStatus = 503;
  const result = await f.auth.logout(profile.id);
  assert.equal(result.revoked, false);
  assert.match(result.message, /not confirmed/);
  assert.equal((await f.auth.status(profile.id)).loggedIn, false);
  assert.equal((await f.auth.status()).loggedIn, true);
});

test("invalid refresh clears credentials; a temporary provider error preserves them", async (t) => {
  const f = await setup(t);
  await f.login();
  f.advance(3500000);
  f.provider.settings.refreshStatus = 503;
  await assert.rejects(() => f.auth.credentials(), /could not renew/);
  assert.equal((await f.auth.status()).loggedIn, true);
  f.provider.settings.refreshStatus = 400;
  await assert.rejects(() => f.auth.credentials(), { code: "SIWC_AUTH_REQUIRED" });
  assert.equal((await f.auth.status()).loggedIn, false);
});

test("runtime requires SIWC, supplies only the access token to Codex and restarts with renewed credentials", async (t) => {
  const f = await setup(t);
  const bin = path.join(f.root, "codex");
  await fs.copyFile(path.join(__dirname, "fixtures/fake-codex.cjs"), bin);
  await fs.chmod(bin, 0o755);
  const events = [];
  const runtime = new AgentRuntime({
    userData: f.root,
    profiles: f.profiles,
    siwc: f.auth,
    discover: async () => [{ id: "codex", path: bin, available: true }],
    getBridge: async () => null,
    loadPreferences: async () => [],
    emit: (event) => events.push(event),
  });
  t.after(() => runtime.close());
  const options = {
    agent: "codex",
    prompt: "Hello",
    access: "ask",
    chatId: "11111111-2222-3333-4444-555555555555",
  };
  await runtime.run(options);
  assert.equal(events.filter((e) => e.type === "auth-required").length, 1);
  assert.equal(runtime.codexPool.size, 0);
  await f.login();
  const first = await runtime.codexServer(bin, null);
  const oldChild = first.rpc;
  const token = (await f.auth.credentials()).access_token;
  assert.doesNotMatch(first.key, new RegExp(token));
  f.advance(3500000);
  const renewed = await runtime.codexServer(bin, null);
  assert.notEqual(renewed.rpc, oldChild);
  assert.equal(oldChild.closed, true);
  await runtime.run(options);
  await f.waitFor(() =>
    events.some((e) => e.type === "assistant-text" || e.type === "assistant-text-delta"),
  );
  assert.doesNotMatch(JSON.stringify(events), /local-access-|refresh_token|id_token/);
});

test("installed Codex sends SIWC Responses traffic over HTTP with a bearer token and no hosted tools", async (t) => {
  const { execFileSync, spawn } = require("node:child_process");
  const http = require("node:http");
  const { JsonRpcChild } = require("../desktop/agent-runtime.cjs");
  const { providerArgs } = require("../desktop/chatgpt-auth.cjs");
  let executable;
  try {
    executable = execFileSync("/bin/sh", ["-c", "command -v codex"], { encoding: "utf8" }).trim();
  } catch {
    t.skip("Codex CLI is not installed");
    return;
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "siwc-codex-wire-"));
  let captured;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (!req.url.startsWith("/responses")) return res.writeHead(404).end();
    captured = { headers: req.headers, body: JSON.parse(body) };
    const response = {
      id: "resp_local",
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model: "gpt-6.1-sol",
      output: [
        {
          type: "message",
          id: "msg_local",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "Local response", annotations: [] }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
    };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response })}\n\n`,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const args = providerArgs().map((value) => value.replace(RESOURCE, base));
  const mcp = path.join(root, "local-mcp.cjs");
  await fs.writeFile(
    mcp,
    `
const rl = require('node:readline').createInterface({input:process.stdin});
rl.on('line', line => {
  const m = JSON.parse(line); if (m.id === undefined) return;
  const result = m.method === 'initialize' ? {protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'local',version:'1'}} : m.method === 'tools/list' ? {tools:Array.from({length:40},(_,i)=>({name:'fixture_'+i,description:'Local canvas operation '+i,inputSchema:{type:'object',properties:{}}}))} : {};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
});`,
  );
  args.push(
    "-c",
    "mcp_servers.fixture.command=" + JSON.stringify(process.execPath),
    "-c",
    "mcp_servers.fixture.args=" + JSON.stringify([mcp]),
  );

  const child = spawn(executable, ["app-server", ...args], {
    env: {
      PATH: process.env.PATH,
      HOME: root,
      CODEX_HOME: root,
      VERYNIZE_CHATGPT_ACCESS_TOKEN: "local-wire-token",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rpc = new JsonRpcChild(child);
  // Consume stderr so a verbose CLI cannot fill the pipe.
  child.stderr.on("data", () => {});
  const exited = new Promise((resolve) => child.once("exit", resolve));
  t.after(async () => {
    rpc.close();
    // Codex keeps cloning plugins under HOME until it exits; removing the directory earlier races it (ENOTEMPTY).
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10000))]);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  await rpc.request("initialize", {
    clientInfo: { name: "Verynize", title: "Verynize", version: "0.0.0-test" },
  });
  rpc.notify("initialized");
  const { thread } = await rpc.request("thread/start", {
    cwd: root,
    model: "gpt-6.1-sol",
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
  });
  const mcpStatus = await rpc.request("mcpServerStatus/list", {
    threadId: thread.id,
    detail: "toolsAndAuthOnly",
  });
  const local = mcpStatus.data.find((s) => s.name === "fixture");
  assert.ok(local && Object.keys(local.tools || {}).length === 40, JSON.stringify(mcpStatus));
  const done = new Promise((resolve) => {
    const off = rpc.on((message) => {
      if (message.method === "turn/completed") {
        off();
        resolve(message.params.turn);
      }
    });
  });
  await rpc.request("turn/start", {
    threadId: thread.id,
    input: [{ type: "text", text: "Hello" }],
  });
  let timer;
  const turn = await Promise.race([
    done,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("Local Responses turn timed out")), 15000);
    }),
  ]).finally(() => clearTimeout(timer));
  assert.equal(turn.status, "completed", JSON.stringify(turn.error));
  assert.equal(captured.headers.authorization, "Bearer local-wire-token");
  assert.equal(captured.body.store, false);

  assert.equal(captured.body.stream, true);
  for (const field of [
    "background",
    "conversation",
    "max_output_tokens",
    "max_tool_calls",
    "metadata",
    "moderation",
    "multi_agent",
    "prompt",
    "prompt_cache_retention",
    "safety_identifier",
    "temperature",
    "top_logprobs",
    "top_p",
    "truncation",
    "user",
    "previous_response_id",
  ])
    assert.equal(field in captured.body, false, field);

  assert.ok(Array.isArray(captured.body.input));
  assert.ok(
    captured.body.instructions || captured.body.input.some((i) => i.role === "developer"),
    JSON.stringify({
      keys: Object.keys(captured.body),
      roles: captured.body.input.map((i) => i.role),
    }),
  );
  assert.equal(
    captured.body.input.some((i) => i.role === "system"),
    false,
  );
  assert.doesNotMatch(
    JSON.stringify(captured.body),
    /"type":"(?:tool_search|image_generation|computer_use_preview|mcp)"/,
  );
});
