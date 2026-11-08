// Browser test of the web chat on the model API runtime (docs/ai-runtime.md "Clients"): the Node build of the web app
// (web-start/node/server.mjs, vite.node.config.ts) in front of the real backend (cloud/worker.js on the Node runtime,
// tests/helpers/node-cloud.mjs), opened in Chromium. The LLM provider is the only fake
// (tests/helpers/fake-openrouter.mjs); the account, room, database, tools and the web transport
// (web/src/lib/agent-service.ts) are real.
//
// Web sign-in (cloud/README.md "Web sign-in"): signed out → the sign-in screen and no editor; a password sign-in boots
// the editor and the AI setup steps open (OpenRouter not connected, Claude Code / Codex desktop-only); Skip for now is
// remembered on the server (another browser does not see the steps again); Settings › Agents › AI setup reopens them;
// after OpenRouter is connected they show the connection and the summary; signing out shows the sign-in screen again.
// Checks: signed in without a room → "Open or share a cloud room…"; joined through
// the editor's #room= invite → a sent message streams assistant text into the transcript, a read tool call renders
// with its result from the room, the next turn carries the earlier ones as history, a dropped connection resumes
// through GET /api/ai/runs/:id/events?after=, Stop cancels a running turn, the model picker lists the server's
// models and never Claude/Codex; with access "Ask" picked in the composer a write tool call raises the approval card:
// Allow → POST /approvals with the request's argsHash, the edit lands in the room (backend read and the open canvas)
// and the run reports permission-resolved; Deny → the room is unchanged and the model gets the denial;
// a server whose operator set VERYNIZE_AI=off → "Model API not configured on this server".
// Credentials (docs/ai-runtime.md "Credentials"): no server key; signed in without an OpenRouter key → "Connect your
// OpenRouter account"; a pasted key is checked (rejected, then accepted); OAuth PKCE through the fake OpenRouter
// sign-in page and the backend callback returns to the editor with its #room= fragment restored; turns carry the
// account's own key; Settings › Agents shows the connection (last4, source, usage), Disconnect and Paste API key.
import { waitForAsync } from "./helpers/wait-for-async.cjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  launchBrowser,
  openStarterFile,
  screenshot,
  signedInContext as signedInBrowserContext,
} from "./helpers/web-app.mjs";
import { startFakeOpenRouter, toolMessages, userText } from "./helpers/fake-openrouter.mjs";

// cloudOptions on the Node runtime: no workerd bundle build; the Node server runs cloud/worker.js itself.
process.env.CLOUD_RUNTIME = "node";
const { cloudOptions, passwordUser } = await import("./cloud-harness.mjs");
const { NodeCloud } = await import("./helpers/node-cloud.mjs");
const { createWebServer } = await import("../web-start/node/server.mjs");

const root = fileURLToPath(new URL("../", import.meta.url));
if (!fs.existsSync(path.join(root, "web/dist/ui.js")))
  execFileSync(process.execPath, ["scripts/build-ui.cjs"], { cwd: root, stdio: "pipe" });
if (!process.env.TEST_WEB_NODE_BUILT)
  execFileSync(
    process.execPath,
    ["node_modules/vite-plus/bin/vp", "build", "-c", "vite.node.config.ts"],
    {
      cwd: root,
      stdio: "pipe",
    },
  );

const labelOf = (body) => /\[label:([\w -]+)\]/.exec(userText(body))?.[1] || "AI card";
// The browser controls when the provider continues, so slow CI cannot miss the streaming
// state and fast runs do not pay fixed 1.5s / 2.5s sleeps.
const streamGate = Promise.withResolvers();
const reconnectGate = Promise.withResolvers();
const fake = await startFakeOpenRouter({
  tree: [
    [{ text: "Let me look at the room." }, { tool: "get_element_tree", args: {} }],
    [{ text: "The room has a Hero artboard." }],
  ],
  stream: [
    [{ text: "First part arrives " }, { wait: streamGate.promise }, { text: "and then the rest." }],
  ],
  drop: [
    [
      { text: "Before the drop " },
      { wait: reconnectGate.promise },
      { text: "after the reconnect." },
    ],
  ],
  slow: [[{ text: "Working on it" }, { hang: true }]],
  // One write (create_artboard of a card named by [label:…]), then a closing text that echoes the tool result.
  write: (body) =>
    toolMessages(body).length
      ? [
          {
            text: `Write finished: ${/denied/.test(toolMessages(body)[0].content) ? "denied" : "applied"}.`,
          },
        ]
      : [
          { text: "Adding a card." },
          {
            tool: "create_artboard",
            args: {
              code: `<div data-node-label="${labelOf(body)}" className="w-[320px] bg-white p-6 flex flex-col gap-2"><p className="text-base text-slate-900">${labelOf(body)}</p></div>`,
            },
          },
        ],
  default: [[{ text: "ok" }]],
});
const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "verynize-web-ai-chat-"));
const options = await cloudOptions(path.join(temp, "state"));
const baseEnv = { ...options.workers[0].config.env };
// No server key: the account connects its own OpenRouter key (pasted, then through OAuth PKCE).
const aiEnv = {
  OPENROUTER_BASE_URL: { type: "text", value: fake.baseUrl },
  VERYNIZE_AI_MODELS: { type: "text", value: "fake/alpha=Fake Alpha,fake/beta=Fake Beta" },
};
options.workers[0].config.env = { ...baseEnv, ...aiEnv };
const backend = new NodeCloud(options);
const backendOrigin = (await backend.ready).origin;
const web = await createWebServer({
  dist: path.join(root, "dist/web-node"),
  backend: backendOrigin,
});
await new Promise((resolve) => web.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${web.address().port}`;

let browser;
try {
  // A real account and a room with one artboard, through the web server (the browser's origin).
  const token = await passwordUser(origin, "chat@example.test", "Chat");
  const api = (route, init = {}) =>
    fetch(origin + route, {
      ...init,
      headers: { "content-type": "application/json", "x-verynize-session": token, ...init.headers },
    });
  const me = await (await api("/api/me")).json();
  const created = await api("/api/rooms", {
    method: "POST",
    body: JSON.stringify({
      document: {
        version: 2,
        name: "Chat room",
        pages: [
          {
            id: "p1",
            name: "Page 1",
            nodes: [{ id: "hero", type: "rectangle", name: "Hero", x: 0, y: 0, w: 400, h: 300 }],
          },
        ],
        tokens: {},
      },
    }),
  });
  assert.ok(created.ok, await created.clone().text());
  const room = await created.json();

  browser = await launchBrowser();
  const errors = [];
  const watch = (page) =>
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
  const ready = async (page) => {
    await page.waitForFunction(() => document.documentElement.dataset.uiReady === "true", null, {
      timeout: 30000,
    });
    await page.evaluate(() => window.agentWorkspace.openChat());
  };
  const gate = (page) => page.locator("#chat-web-gate");

  // ---- signed out: the sign-in screen, then the web AI setup steps ----
  // (The chat gate's own "Sign in to use chat" state is unreachable in the web app: nothing boots signed out.)
  {
    const viewport = { width: 1440, height: 870 };
    const signInContext = await browser.newContext({ viewport });
    const page = await signInContext.newPage();
    watch(page);
    const meResponses = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === "/api/me") meResponses.push(response.status());
    });
    await page.goto(origin + "/editor");
    await page.waitForFunction(() => document.documentElement.dataset.webAuth === "signed-out");
    await page.locator("#web-sign-in #onboarding-email").waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.legacyEditor ?? null),
      null,
      "the editor does not boot while signed out",
    );
    assert.equal(await gate(page).count(), 0);
    await screenshot(page, "01-web-sign-in.png");
    const signInWithPassword = async (target) => {
      await target.locator("#onboarding-email").fill("chat@example.test");
      await target.locator("#onboarding-password").fill("a long enough password");
      await target.locator("#onboarding-submit").click();
      await target.waitForFunction(() => document.documentElement.dataset.webAuth === "signed-in");
      await target.waitForFunction(
        () => document.documentElement.dataset.uiReady === "true",
        null,
        { timeout: 30000 },
      );
    };
    await signInWithPassword(page);
    // A new account has no file and none is made for it: the editor URL lands on Files.
    await page.waitForFunction(() => location.pathname === "/" && !window.fileLibrary.currentId);

    // First sign-in of the account: the AI setup steps, OpenRouter not connected yet, Claude Code / Codex desktop-only.
    const setup = page.locator("#onboarding[data-step='ai']");
    const provider = (id) => page.locator(`#onboarding-ai-providers li[data-provider='${id}']`);
    await provider("openrouter").and(page.locator("[data-status='missing']")).waitFor();
    assert.equal(await provider("claude").getAttribute("data-status"), "desktop-only");
    assert.equal(await provider("codex").getAttribute("data-status"), "desktop-only");
    assert.match(await provider("codex").innerText(), /Desktop app only/);
    await page.locator("#onboarding-openrouter-connect-openrouter").waitFor();
    await page.locator("#onboarding-openrouter-paste-key").waitFor();
    await screenshot(page, "02-ai-setup-not-connected.png");
    assert.deepEqual(
      await page.evaluate(() => ({
        kind: window.verynizePlatform.kind,
        capabilities: Object.values(window.verynizePlatform.capabilities).some(Boolean),
        service: window.verynizePlatform.agents.service()?.kind,
        ready: window.verynizePlatform.agents.ready(),
        agents: [...document.getElementById("project-agent").options].map((o) => o.value),
      })),
      { kind: "web", capabilities: false, service: "web", ready: false, agents: ["openrouter"] },
    );
    // Skip for now: closed and remembered for the account on the server.
    await page.locator("#onboarding-ai-skip").click();
    await setup.waitFor({ state: "detached" });
    await waitForAsync(page, async () => {
      const me = await window.cloudAccount.request("/api/me");
      return typeof me.aiSetupAt === "number";
    });

    // Another browser (no local copy): the server remembers, so the steps do not open again.
    const other = await browser.newContext({ viewport });
    const second = await other.newPage();
    watch(second);
    const secondMe = [];
    second.on("response", (response) => {
      if (new URL(response.url()).pathname === "/api/me") secondMe.push(response.status());
    });
    await second.goto(origin + "/editor");
    await second.locator("#web-sign-in #onboarding-email").waitFor();
    await signInWithPassword(second);
    // The sign-in itself, then the onboarding island's check.
    await second.waitForFunction(() => document.documentElement.dataset.uiReady === "true");
    const until = Date.now() + 10000;
    while (secondMe.length < 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    assert.ok(secondMe.length >= 2, `GET /api/me after sign-in: ${secondMe.join(",")}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await second.locator("#onboarding").count(), 0, "AI setup shown once per account");

    // Settings › Agents › AI setup reopens it.
    await second.goto(origin + "/settings/agents");
    await second.waitForFunction(() => document.documentElement.dataset.uiReady === "true", null, {
      timeout: 30000,
    });
    await second.locator("#settings-ai-setup").click();
    await second.locator("#onboarding[data-step='ai'] #onboarding-ai-providers").waitFor();
    await second.locator("#onboarding-ai-skip").click();
    await second.locator("#onboarding").waitFor({ state: "detached" });

    // Signing out shows the sign-in screen again.
    await second.evaluate(() => window.cloudAccount.signOut());
    await second.waitForFunction(
      () => document.documentElement.dataset.webAuth === "signed-out",
      null,
      {
        timeout: 15000,
      },
    );
    await second.locator("#web-sign-in").waitFor();
    assert.equal(new URL(second.url()).pathname, "/settings/agents");
    await other.close();
    assert.ok(
      meResponses.every((status) => status === 200),
      `GET /api/me: ${meResponses.join(",")}`,
    );
    await signInContext.close();
  }

  // ---- signed in (same session store as cloud-panel.js) ----
  const signedInContext = () =>
    signedInBrowserContext(
      browser,
      origin,
      { session: token, ...me },
      { viewport: { width: 1440, height: 870 } },
    );
  const context = await signedInContext();
  const page = await context.newPage();
  watch(page);
  const requests = [];
  const approvalBodies = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    requests.push(`${request.method()} ${url.pathname}${url.search}`);
    if (/^\/api\/ai\/runs\/[^/]+\/approvals$/.test(url.pathname))
      approvalBodies.push(JSON.parse(request.postData() || "{}"));
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(origin + "/editor");
  await ready(page);
  // A design to chat about: the user makes one (stored as a database room); none is made on its own.
  await openStarterFile(page);
  const gateState = (state) =>
    page.waitForFunction(
      (wanted) => document.getElementById("chat-web-gate")?.dataset.state === wanted,
      state,
    );
  // No OpenRouter credential yet: Connect, or paste a key.
  await gateState("needs-credentials");
  assert.match(await gate(page).innerText(), /^Connect your OpenRouter account/);
  assert.match(await gate(page).innerText(), /separate from Claude Code and Codex/);
  assert.ok(
    requests.includes("GET /api/ai/config"),
    "the config is fetched through the query layer: " + requests.join(", "),
  );
  assert.ok(
    await page.evaluate(() =>
      window.__bdQueryCache().some((entry) => entry.key.at(-1) === "ai-config" && entry.data),
    ),
    "the ai-config query is cached under the account scope",
  );
  await page.locator("#chat-web-connect-openrouter").waitFor();
  await page.locator("#chat-web-paste-key").click();
  await page.locator("#chat-web-openrouter-key").fill("sk-or-v1-not-known-to-openrouter");
  await page.locator("#chat-web-save-key").click();
  await page
    .locator("#chat-web-key-error")
    .getByText(/OpenRouter rejected this key/)
    .waitFor();
  const PASTED = "sk-or-v1-web-pasted-key-4321";
  fake.keys.add(PASTED);
  await page.locator("#chat-web-openrouter-key").fill(PASTED);
  await page.locator("#chat-web-save-key").click();
  await page.waitForFunction(
    () => window.cloudWorkspace?.isConnected() && !document.getElementById("chat-web-gate"),
  ); // Signed-in designs already have a database room, so chat is ready.
  const credentials = async () => (await (await api("/api/ai/credentials")).json()).openrouter;
  assert.deepEqual(
    (({ connected, source, last4 }) => ({ connected, source, last4 }))(await credentials()),
    { connected: true, source: "manual", last4: "4321" },
  );
  // Disconnect (from another tab, say): the next config check brings the gate back.
  assert.ok((await api("/api/ai/credentials/openrouter", { method: "DELETE" })).ok);

  // Join the room the way a file link does: `#room=` opens the file directly (web/src/islands/collab/links.ts).
  const joinRoom = async () => {
    await ready(page);
    await page.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, room.id, {
      timeout: 30000,
    });
  };
  await page.goto(origin + `/editor#room=${room.id}`);
  await page.reload(); // a fragment-only navigation does not load the page again
  await joinRoom();
  await gateState("needs-credentials");

  // Connect OpenRouter: OAuth PKCE in this tab, through OpenRouter's sign-in page (faked) and the backend's
  // callback, back to the editor with its #room= fragment restored (kept client-side, never sent to the server).
  const editorPath = await page.evaluate(
    () => "/editor/" + encodeURIComponent(window.fileLibrary.currentId),
  );
  const authBefore = fake.authRequests.length;
  const cameBack = page.waitForURL((url) => url.searchParams.get("openrouter") === "connected", {
    timeout: 20000,
  });
  await page.locator("#chat-web-connect-openrouter").click();
  await cameBack;
  await page.waitForURL(
    (url) =>
      url.pathname === editorPath &&
      !url.searchParams.has("openrouter") &&
      url.hash === `#room=${room.id}`,
    { timeout: 20000 },
  );
  assert.equal(fake.authRequests.length, authBefore + 1, "the browser went to OpenRouter's /auth");
  const auth = fake.authRequests.at(-1);
  assert.equal(auth.callback_url, `${origin}/api/ai/credentials/openrouter/oauth/callback`);
  assert.equal(auth.code_challenge_method, "S256");
  assert.ok(!JSON.stringify(auth).includes(room.id), "the room fragment never left the browser");
  assert.ok(
    requests.some((r) => r.startsWith("GET /api/ai/credentials/openrouter/oauth/callback?code=")),
  );
  assert.ok(
    !new URL(page.url()).searchParams.has("openrouter"),
    "the outcome parameter is dropped",
  );
  await joinRoom();
  await page.locator("#project-prompt").waitFor({ state: "visible" });
  assert.equal(await gate(page).count(), 0, "no gate once signed in with a room");
  const connected = await credentials();
  assert.deepEqual([connected.connected, connected.source], [true, "oauth"]);
  const oauthKey = fake.exchanges.at(-1) && [...fake.keys].find((k) => k.endsWith(connected.last4));
  assert.ok(oauthKey?.startsWith("sk-or-v1-oauth-"), "the key issued through OAuth is stored");

  // The AI setup steps (reopened as from Settings › Agents) show the connection, then the summary.
  await page.evaluate(() => window.dispatchEvent(new Event("bd:open-onboarding")));
  await page
    .locator("#onboarding-ai-providers li[data-provider='openrouter'][data-status='connected']")
    .waitFor();
  assert.match(await page.locator("#onboarding-ai-status").innerText(), /Key ending \w{4}/);
  assert.equal(await page.locator("#onboarding-openrouter-connect-openrouter").count(), 0);
  await screenshot(page, "03-ai-setup-connected.png");
  await page.locator("#onboarding-ai-continue").click();
  await page.locator("#onboarding[data-step='ready'] #onboarding-ready-summary").waitFor();
  assert.match(
    await page.locator("#onboarding-ready-summary").innerText(),
    new RegExp(`key ending ${connected.last4}`),
  );
  await screenshot(page, "04-ai-setup-ready.png");
  await page.locator("#onboarding-ready-done").click();
  await page.locator("#onboarding").waitFor({ state: "detached" });

  const send = async (text) => {
    await page.locator("#project-prompt").fill(text);
    await page.locator("#project-prompt").press("Enter");
  };
  const lastReply = () =>
    page.evaluate(() => {
      const messages = window.agentWorkspace.getState().messages;
      return messages.findLast((m) => m.role === "assistant") || null;
    });
  const idle = () =>
    page.waitForFunction(() => !window.agentWorkspace.getState().busy, null, { timeout: 20000 });

  // Model picker: the server's models, no Claude/Codex.
  await page.locator(".agent-config summary").click();
  const menu = page.getByRole("menu");
  await menu.getByText("Fake Beta").waitFor();
  const menuText = await menu.innerText();
  assert.match(menuText, /Model API/);
  assert.match(menuText, /OpenRouter default/);
  assert.match(menuText, /Fake Alpha/);
  assert.doesNotMatch(menuText, /Claude|Codex|Effort/);
  await menu.getByText("Fake Beta").click();
  // Let the menu finish closing and restore focus before typing/pressing Enter in the composer.
  await menu.waitFor({ state: "detached" });
  assert.equal(await page.locator("#bd-agent-model-label").innerText(), "Fake Beta");

  // Streamed text: the first part is in the transcript before the rest arrives.
  await send("[scenario:stream] Say something");
  const transcript = page.locator(".chat-message.assistant").last();
  await transcript.getByText("First part arrives").waitFor({ timeout: 15000 });
  assert.doesNotMatch(
    await transcript.innerText(),
    /and then the rest/,
    "text streams before the turn ends",
  );
  assert.equal((await lastReply()).state, "running");
  streamGate.resolve();
  await transcript.getByText("and then the rest.").waitFor({ timeout: 15000 });
  await idle();
  let reply = await lastReply();
  assert.equal(reply.state, "complete");
  assert.equal(reply.agent, "openrouter");
  assert.equal(fake.requests.at(-1).body.model, "fake/beta", "the picked model is sent");
  assert.equal(
    fake.requests.at(-1).headers.authorization,
    `Bearer ${oauthKey}`,
    "the turn runs on the account's own OpenRouter key",
  );

  // A read tool call against the room renders as a tool card with the room's content in its result.
  await send("[scenario:tree] What is in this room?");
  await page
    .locator(".chat-message.assistant")
    .last()
    .getByText("The room has a Hero artboard.")
    .waitFor({ timeout: 20000 });
  await idle();
  reply = await lastReply();
  const tool = reply.parts.find((part) => part.kind === "tool");
  assert.equal(tool?.name, "get_element_tree");
  assert.equal(tool.state, "done");
  assert.match(tool.result, /Hero/);
  const card = page.locator(".chat-message.assistant").last().locator(".chat-tool");
  assert.ok((await card.count()) >= 1, "the tool call is rendered");
  // A finished turn folds its tool calls into the turn's details; the card is still rendered there.
  assert.match(await card.first().textContent(), /element.tree/i);
  // The model API keeps no session: the earlier turns travel as history.
  const sent = fake.requests.findLast((request) =>
    request.body.messages.some(
      (m) => m.role === "user" && /scenario:tree/.test(JSON.stringify(m.content)),
    ),
  );
  assert.ok(
    sent.body.messages.some(
      (m) => m.role === "user" && /scenario:stream/.test(JSON.stringify(m.content)),
    ),
    "the previous user turn is in the history",
  );

  // A dropped connection resumes from the last event through GET /events?after=.
  await send("[scenario:drop] Keep talking");
  await page
    .locator(".chat-message.assistant")
    .last()
    .getByText("Before the drop")
    .waitFor({ timeout: 15000 });
  web.closeAllConnections();
  reconnectGate.resolve();
  await page
    .locator(".chat-message.assistant")
    .last()
    .getByText("after the reconnect.")
    .waitFor({ timeout: 20000 });
  await idle();
  reply = await lastReply();
  assert.equal(reply.state, "complete");
  assert.ok(
    requests.some((line) =>
      /^GET \/api\/ai\/runs\/[0-9a-f-]{36}\/events\?after=[1-9]\d*$/.test(line),
    ),
    "reconnected with events?after=: " +
      requests.filter((line) => line.includes("/api/ai/")).join(", "),
  );
  const text = reply.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text)
    .join("");
  assert.equal(
    (text.match(/Before the drop/g) || []).length,
    1,
    "no event is applied twice: " + text,
  );

  // Stop cancels the running turn on the server.
  await send("[scenario:slow] Work for a while");
  await page
    .locator(".chat-message.assistant")
    .last()
    .getByText("Working on it")
    .waitFor({ timeout: 15000 });
  await page.locator("#project-cancel").click();
  await idle();
  reply = await lastReply();
  assert.equal(reply.state, "stopped");
  const runId = requests
    .filter((line) => /^POST \/api\/ai\/runs\/[0-9a-f-]{36}\/cancel$/.test(line))
    .at(-1)
    ?.split("/")[4];
  assert.ok(runId, "the cancel request was sent");
  const events = await api(`/api/ai/runs/${runId}/events?after=0`);
  const body = await events.text();
  assert.match(body, /"type":"done","code":"cancelled"/);

  // ---- write tools with approvals (access "Ask", picked in the composer) ----
  const roomLabels = async () => {
    const response = await api(`/api/rooms/${room.id}`);
    assert.ok(response.ok, await response.clone().text());
    const { document } = await response.json();
    return document.pages.flatMap((p) => p.nodes.filter((n) => !n.parentId)).map((n) => n.name);
  };
  const canvasLabels = () =>
    page.evaluate(() =>
      window.design
        .getDocument()
        .pages.flatMap((p) => p.nodes.filter((n) => !n.parentId))
        .map((n) => n.name),
    );
  const runEvents = async (id) => {
    const response = await api(`/api/ai/runs/${id}/events?after=0`);
    return (await response.text())
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
  };
  const lastApprovalRun = () =>
    requests
      .filter((line) => /^POST \/api\/ai\/runs\/[0-9a-f-]{36}\/approvals$/.test(line))
      .at(-1)
      ?.split("/")[4];
  assert.deepEqual(await roomLabels(), ["Hero"]);
  await page.locator("#agent-access-trigger").click();
  await page.getByRole("menuitemradio", { name: /^Ask/ }).click();
  await page.waitForFunction(() => document.getElementById("agent-access").value === "ask");
  assert.match(
    await page.locator("#agent-access-trigger").getAttribute("aria-label"),
    /Access: Ask/,
  );

  // Allow: the card appears, the approval carries the request's argsHash, the edit lands in the room and on the canvas.
  const runsBefore = requests.filter((line) => line === "POST /api/ai/runs").length;
  await send("[scenario:write] [label:Approved card] Add a card");
  const allowCard = page
    .locator(".chat-message.assistant")
    .last()
    .locator(".chat-permission.pending");
  await allowCard.waitFor({ timeout: 20000 });
  assert.match(await allowCard.innerText(), /Allow .*\?/);
  assert.match(await allowCard.innerText(), /Approved card/, "the card shows the call's input");
  assert.doesNotMatch(
    await allowCard.innerText(),
    /Always allow/,
    "no always-allow on the model API",
  );
  assert.equal(
    (await page.evaluate(() => window.agentWorkspace.getState().messages))
      .filter((m) => m.role === "assistant")
      .at(-1).state,
    "running",
  );
  assert.deepEqual(await roomLabels(), ["Hero"], "nothing is applied before the approval");
  await allowCard.locator(".chat-permission-allow").click();
  await page
    .locator(".chat-message.assistant")
    .last()
    .getByText("Write finished: applied.")
    .waitFor({ timeout: 20000 });
  await idle();
  assert.equal(requests.filter((line) => line === "POST /api/ai/runs").length, runsBefore + 1);
  const allowRunId = lastApprovalRun();
  assert.ok(
    allowRunId,
    "the approval was posted: " + requests.filter((l) => l.includes("/api/ai/")).join(", "),
  );
  const allowEvents = await runEvents(allowRunId);
  const allowRequest = allowEvents.find((e) => e.type === "permission-request");
  assert.equal(allowRequest.name, "create_artboard");
  assert.match(allowRequest.argsHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(approvalBodies.at(-1), {
    requestId: allowRequest.requestId,
    allow: true,
    argsHash: allowRequest.argsHash,
  });
  const allowResolved = allowEvents.find((e) => e.type === "permission-resolved");
  assert.deepEqual(
    {
      requestId: allowResolved.requestId,
      allow: allowResolved.allow,
      reason: allowResolved.reason,
    },
    { requestId: allowRequest.requestId, allow: true, reason: "user" },
  );
  assert.equal(allowEvents.find((e) => e.type === "tool-result").isError, false);
  assert.equal(allowEvents.at(-1).code, "ok");
  assert.deepEqual(await roomLabels(), ["Hero", "Approved card"], "the edit is in the room");
  await page.waitForFunction(
    () =>
      window.design
        .getDocument()
        .pages.some((p) => p.nodes.some((n) => n.name === "Approved card")),
    null,
    { timeout: 15000 },
  );
  reply = await lastReply();
  assert.equal(reply.state, "complete");
  const allowedPart = reply.parts.find((part) => part.kind === "permission");
  assert.equal(allowedPart?.state, "allowed");
  assert.equal(allowedPart.requestId, allowRequest.requestId);
  assert.equal(allowedPart.toolName, "create_artboard");
  assert.equal(
    reply.parts.find((part) => part.kind === "tool" && part.name === "create_artboard")?.state,
    "done",
  );
  assert.equal(
    await page
      .locator(".chat-message.assistant")
      .last()
      .locator(".chat-permission.allowed")
      .count(),
    1,
    "the answered approval is rendered as allowed",
  );
  assert.equal(fake.requests.at(-1).body.messages.at(-1).role, "tool");

  // Deny: the room is unchanged and the model gets the denial as the tool result.
  const canvasBeforeDeny = await canvasLabels();
  await send("[scenario:write] [label:Denied card] Add another card");
  const denyCard = page
    .locator(".chat-message.assistant")
    .last()
    .locator(".chat-permission.pending");
  await denyCard.waitFor({ timeout: 20000 });
  assert.match(await denyCard.innerText(), /Denied card/);
  await denyCard.locator(".chat-permission-deny").click();
  await page
    .locator(".chat-message.assistant")
    .last()
    .getByText("Write finished: denied.")
    .waitFor({ timeout: 20000 });
  await idle();
  const denyRunId = lastApprovalRun();
  assert.ok(denyRunId && denyRunId !== allowRunId, "the denial was posted for the new run");
  const denyBody = approvalBodies.at(-1);
  assert.equal(denyBody.allow, false);
  const denyEvents = await runEvents(denyRunId);
  const denyRequest = denyEvents.find((e) => e.type === "permission-request");
  assert.deepEqual(denyBody, {
    requestId: denyRequest.requestId,
    allow: false,
    argsHash: denyRequest.argsHash,
  });
  const denyResolved = denyEvents.find((e) => e.type === "permission-resolved");
  assert.deepEqual([denyResolved.allow, denyResolved.reason], [false, "user"]);
  const denyResult = denyEvents.find((e) => e.type === "tool-result");
  assert.equal(denyResult.isError, true);
  assert.match(denyResult.output, /denied by user/);
  assert.equal(denyEvents.at(-1).code, "ok");
  const sawDenial = fake.requests.findLast((request) =>
    /\[label:Denied card\]/.test(userText(request.body)),
  );
  assert.match(toolMessages(sawDenial.body)[0].content, /denied by user/);
  assert.deepEqual(await roomLabels(), ["Hero", "Approved card"], "a denied write is not applied");
  assert.deepEqual(await canvasLabels(), canvasBeforeDeny);
  reply = await lastReply();
  assert.equal(reply.state, "complete");
  assert.equal(reply.parts.find((part) => part.kind === "permission")?.state, "denied");
  assert.equal(
    await page.locator(".chat-message.assistant").last().locator(".chat-permission.denied").count(),
    1,
    "the answered approval is rendered as denied",
  );
  await page.close();

  // ---- Settings › Agents › Model API (OpenRouter): status, disconnect, paste a key ----
  {
    const settings = await context.newPage();
    watch(settings);
    await settings.goto(origin + "/settings/agents");
    await settings.waitForFunction(() => document.documentElement.dataset.uiReady === "true");
    const card = settings.locator("#settings-openrouter-card");
    await settings.locator('#settings-openrouter-card[data-status="connected"]').waitFor();
    const status = await settings.locator("#settings-openrouter-status").innerText();
    assert.match(status, new RegExp(`Key ending ${connected.last4} · connected with OpenRouter`));
    assert.match(status, /\$1\.25 of \$10\.00 used/);
    assert.ok(!status.includes(oauthKey), "the key is never shown");
    await settings.locator("#settings-openrouter-reconnect").waitFor();
    await settings.locator("#settings-openrouter-disconnect").click();
    await settings.locator('#settings-openrouter-card[data-status="missing"]').waitFor();
    assert.equal((await credentials()).connected, false);
    // Connect from Settings: the OAuth round-trip comes back to the Start-rendered /settings/agents screen with the
    // outcome parameter dropped and the section still open.
    const settingsBack = settings.waitForURL(
      (url) => url.searchParams.get("openrouter") === "connected",
      { timeout: 20000 },
    );
    await settings.locator("#settings-openrouter-connect").click();
    await settingsBack;
    await settings.waitForURL(
      (url) => url.pathname === "/settings/agents" && !url.searchParams.has("openrouter"),
      { timeout: 20000 },
    );
    await settings.locator('#settings-openrouter-card[data-status="connected"]').waitFor();
    assert.equal(
      await settings.evaluate(() => window.shellRouter?.state.location.pathname),
      "/settings/agents",
      "Start's router is on the settings section after the return",
    );
    assert.equal(
      await settings.evaluate(() => window.shellRouter?.state.location.searchStr || ""),
      "",
      "Start's location dropped the outcome parameter too",
    );
    assert.equal((await credentials()).source, "oauth");
    await settings.locator("#settings-openrouter-disconnect").click();
    await settings.locator('#settings-openrouter-card[data-status="missing"]').waitFor();
    await settings.locator("#settings-openrouter-paste").click();
    const SETTINGS_KEY = "sk-or-v1-web-settings-key-7777";
    fake.keys.add(SETTINGS_KEY);
    await settings.locator("#settings-openrouter-key").fill(SETTINGS_KEY);
    await settings.locator("#settings-openrouter-save").click();
    await settings.locator('#settings-openrouter-card[data-status="connected"]').waitFor();
    assert.match(await card.innerText(), /Key ending 7777 · pasted API key/);
    await settings.close();
  }
  await context.close();

  // ---- a server whose operator turned the model API off ----
  const worker = options.workers[0];
  await backend.setOptions({
    ...options,
    workers: [
      {
        ...worker,
        config: {
          ...worker.config,
          env: { ...baseEnv, VERYNIZE_AI: { type: "text", value: "off" } },
        },
      },
    ],
  });
  {
    const context2 = await signedInContext();
    const off = await context2.newPage();
    watch(off);
    await off.goto(origin + "/editor");
    await ready(off);
    await off.waitForFunction(
      () => document.getElementById("chat-web-gate")?.dataset.state === "not-configured",
    );
    assert.match(await gate(off).innerText(), /^Model API not configured on this server/);
    assert.equal(await off.locator("#project-prompt").isVisible(), false);
    await context2.close();
  }

  assert.deepEqual(errors, [], "no page errors");
  console.log(
    "PASS web chat (model API): sign-in screen, AI setup steps (once per account, skip, reopen, connected), sign out, needs-credentials and not-configured states, pasted key (rejected, accepted), OAuth PKCE round-trip keeping #room=, Settings OpenRouter status/disconnect/paste, room gate, streamed text, read tool call, history, reconnect with events?after=, cancel, model picker, access Ask with write approvals (allow and deny)",
  );
} finally {
  streamGate.resolve();
  reconnectGate.resolve();
  await browser?.close();
  web.closeAllConnections?.();
  await new Promise((resolve) => web.close(resolve));
  await backend.dispose();
  await fake.close();
  await fsp.rm(temp, { recursive: true, force: true });
}
