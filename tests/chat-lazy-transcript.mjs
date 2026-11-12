// Real account summaries/transcripts through workerd and an Electron renderer.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "@playwright/test";
import { Miniflare, cloudOptions, passwordUser } from "./cloud-harness.mjs";
import { waitForUiReady } from "./helpers/ui-ready.cjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chat-lazy-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
let app;
try {
  const server = (await mf.ready).origin;
  const session = await passwordUser(server, "lazy@example.test", "Lazy");
  const headers = { "x-verynize-session": session, "content-type": "application/json" };
  const { account } = await (await fetch(server + "/api/me", { headers })).json();
  for (const id of ["first", "second", "last"]) {
    const response = await fetch(server + "/api/me/state/chat:" + id, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        revision: 0,
        value: JSON.stringify({
          project: "unattached",
          chat: {
            id,
            title: id,
            created: 1,
            messages: [
              { role: "user", text: "Saved question " + id, at: 1 },
              { role: "assistant", text: "Saved answer " + id, at: 2 },
            ],
          },
        }),
      }),
    });
    assert.ok(response.ok, await response.text());
  }
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1", VERYNIZE_DISABLE_AGENT_USAGE: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ env, args: [".", "--user-data-dir=" + path.join(dir, "profile")] });
  const page = await app.firstWindow();
  page.on("dialog", (dialog) => dialog.accept());
  await waitForUiReady(page);
  const reads = [];
  page.on("request", (request) => {
    const pathname = decodeURIComponent(new URL(request.url()).pathname);
    if (request.method() === "GET" && pathname.startsWith("/api/me/state/chat:"))
      reads.push(pathname);
  });
  await page.evaluate(
    ({ server, session, account }) => {
      window.agentWorkspace.closeChat();
      localStorage.removeItem("better-agent-chats:unattached");
      localStorage.setItem("verynize.cloud.account", JSON.stringify({ server, session, account }));
      window.dispatchEvent(new Event("cloud-account-changed"));
    },
    { server, session, account },
  );
  await page.waitForFunction(
    () =>
      window.accountStore.ready() && window.agentWorkspace.getState().conversations.length === 3,
  );
  await page.evaluate(() => window.accountStore.refresh());
  assert.deepEqual(reads, [], "closed editor loads summaries only");
  await page.reload();
  await waitForUiReady(page);
  await page.waitForFunction(
    () =>
      window.accountStore.ready() && window.agentWorkspace.getState().conversations.length === 3,
  );
  assert.deepEqual(
    reads,
    [],
    "account-backed boot with a closed panel makes no transcript request",
  );
  await page.evaluate(() => window.fileLibrary.showEditor());
  const selected = await page.evaluate(() => window.agentWorkspace.getState().conversationId);
  const pending = await page.evaluate(() => {
    window.agentWorkspace.openChat();
    window.agentWorkspace.openChat();
    const state = window.agentWorkspace.getState();
    window.agentWorkspace.selectChat(state.conversationId);
    return state.transcriptPending;
  });
  assert.equal(pending, true, "loading state is published before the transcript arrives");
  await page.waitForFunction(() => !window.agentWorkspace.getState().transcriptPending);
  await page
    .locator(".chat-message.assistant")
    .filter({ hasText: "Saved answer " + selected })
    .waitFor();
  assert.equal(reads.length, 1, "opening and selection are single-flight");
  await page.evaluate(async () => {
    window.agentWorkspace.closeChat();
    await window.accountStore.refresh();
    window.agentWorkspace.openChat();
  });
  assert.equal(reads.length, 1, "reopen uses cache");

  const other = selected === "first" ? "second" : "first";
  await page.context().setOffline(true);
  await page.evaluate((id) => window.agentWorkspace.selectChat(id), other);
  await page.getByRole("button", { name: "Retry loading conversation" }).waitFor();
  assert.equal(
    await page.locator(".chat-message").count(),
    0,
    "failed loads do not show the previous chat",
  );
  await page.context().setOffline(false);
  await page.getByRole("button", { name: "Retry loading conversation" }).click();
  await page
    .locator(".chat-message.assistant")
    .filter({ hasText: "Saved answer " + other })
    .waitFor();

  const remaining = ["first", "second", "last"].find((id) => id !== selected && id !== other);
  await page.evaluate((id) => {
    window.agentWorkspace.closeChat();
    window.agentWorkspace.selectChat(id);
  }, remaining);
  await page.waitForFunction(
    (id) =>
      !window.agentWorkspace.getState().transcriptPending &&
      window.agentWorkspace.getState().conversationId === id,
    remaining,
  );
  assert.ok(
    reads.includes("/api/me/state/chat:" + remaining),
    "explicit selection fetches even while closed",
  );
  await page.evaluate(() => window.accountStore.flush());
  await page.reload();
  await waitForUiReady(page);
  await page.waitForFunction(
    () => window.accountStore.ready() && window.agentWorkspace.getState().transcriptPending,
  );
  const beforeReset = reads.length;
  await page.evaluate(() => window.agentWorkspace.clearSession());
  await page.waitForFunction(() => !window.agentWorkspace.getState().transcriptPending);
  assert.equal(
    reads.length,
    beforeReset + 1,
    "resetting a saved session loads its transcript while closed",
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.agentWorkspace
          .getHistory()
          .find((chat) => chat.id === window.agentWorkspace.getState().conversationId).seedFrom,
    ),
    2,
  );
  await page.evaluate(() => window.accountStore.flush());
  console.log(
    "PASS lazy transcripts: closed editor, loading, single-flight, cache, retry, explicit selection",
  );
} finally {
  await app?.close();
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
