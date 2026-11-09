// A real Electron renderer and a browser using the same account and local database.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "@playwright/test";
import { Miniflare, cloudOptions, passwordUser } from "./cloud-harness.mjs";
import { waitForUiReady } from "./helpers/ui-ready.cjs";
import { freePort, startProcess, launchBrowser, readLibrary } from "./helpers/web-app.mjs";
import { execFileSync } from "node:child_process";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-database-sync-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "database")));
let app, browser, web;
try {
  const server = (await mf.ready).origin;
  const session = await passwordUser(server, "sync@example.test", "Sync");
  const api = async (route) => {
    const response = await fetch(server + route, { headers: { "x-verynize-session": session } });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1", VERYNIZE_CLOUD_SERVER: server };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ env, args: [".", "--user-data-dir=" + path.join(dir, "desktop")] });
  const desktop = await app.firstWindow();
  desktop.setDefaultTimeout(30000);
  await waitForUiReady(desktop);
  desktop.on("dialog", (dialog) => dialog.accept());
  const errors = [];
  desktop.on("pageerror", (error) => errors.push(error.message));
  // Other devices' changes are read on focus and every 30 s or more while focused: read them now.
  const reread = (client) => client.evaluate(() => window.accountStore.refresh());
  const login = (page) =>
    page.evaluate(
      (server) =>
        window.cloudAccount.signIn({
          server,
          email: "sync@example.test",
          password: "a long enough password",
        }),
      server,
    );
  await desktop.evaluate(() =>
    localStorage.setItem(
      "better-agent-chats:unattached",
      JSON.stringify([
        {
          id: "legacy-history",
          title: "Imported conversation",
          created: 1,
          messages: [
            { role: "user", text: "Make a landing page", at: 1 },
            { role: "assistant", text: "The design is ready " + "🌴".repeat(300000), at: 2 },
          ],
        },
      ]),
    ),
  );
  await login(desktop);
  await desktop.waitForFunction(() => window.accountStore.ready() && window.cloudWorkspace.room());
  await desktop.evaluate(() => window.cloudWorkspace.flush());

  if (!process.env.VERYNIZE_WEB_NODE_BUILT)
    execFileSync(
      process.execPath,
      ["node_modules/vite-plus/bin/vp", "build", "-c", "vite.node.config.ts"],
      { stdio: "pipe" },
    );
  const port = await freePort(),
    origin = `http://127.0.0.1:${port}`;
  web = await startProcess(process.execPath, ["web-start/node/server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VERYNIZE_BACKEND_URL: server },
    ready: origin,
  });
  browser = await launchBrowser();
  const context = await browser.newContext();
  const me = await api("/api/me");
  await context.addInitScript(
    ({ server, session, me }) => {
      if (window !== window.top) return;
      // Use the shared API origin, as a desktop client does. No design/chat/settings fixture data.
      localStorage.setItem(
        "verynize.cloud.account",
        JSON.stringify({
          server,
          session,
          account: me.account,
          personalOrganizationId: me.personalOrganizationId,
        }),
      );
      localStorage.setItem("verynize.web-ai-setup." + me.account.id, "done");
    },
    { server: origin, session, me },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(origin + "/");

  await waitForUiReady(page);

  await page.waitForFunction(() => window.accountStore?.ready());

  await page.waitForFunction(() =>
    window.agentWorkspace.getState().conversations.some((chat) => chat.id === "legacy-history"),
  );
  // The list holds chat summaries; selecting a chat fetches its transcript.
  assert.equal(
    await page.evaluate(
      () =>
        window.agentWorkspace.getState().conversations.find((c) => c.id === "legacy-history").count,
    ),
    2,
  );
  await page.evaluate(() => window.agentWorkspace.selectChat("legacy-history"));
  await page.waitForFunction(() => window.agentWorkspace.getState().messages.length === 2);
  assert.deepEqual(
    await page.evaluate(() =>
      window.agentWorkspace.getState().messages.map((message) => message.text),
    ),
    ["Make a landing page", "The design is ready " + "🌴".repeat(300000)],
  );
  const fileId = await desktop.evaluate(async () => {
    const document = {
      version: 2,
      name: "Shared database design",
      activePage: "p",
      pages: [{ id: "p", name: "Page", nodes: [] }],
      tokens: {},
    };
    return window.fileLibrary.createFromDocument(document);
  });
  const cloud = await desktop.evaluate((id) => window.fileLibrary.cloudOf(id), fileId);
  assert.ok(cloud, "creation resolves only after database storage");
  // Another device's new file shows on focus or the next minute's poll: ask now.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cloud-files-changed")));
  await page.locator(`[data-room-id="${cloud.roomId}"] .file-open`).waitFor();
  await page.locator(`[data-room-id="${cloud.roomId}"] .file-open`).click();
  await page.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, cloud.roomId);
  await desktop.evaluate(() =>
    window.design.addNode("text", { name: "Desktop edit", text: "Sent from desktop" }),
  );
  await page.waitForFunction(() =>
    window.design
      .getDocument()
      .pages.some((p) => p.nodes.some((n) => n.text === "Sent from desktop")),
  );
  await page.evaluate(() => window.design.addNode("rectangle", { name: "Browser edit" }));
  await desktop.waitForFunction(() =>
    window.design.getDocument().pages.some((p) => p.nodes.some((n) => n.name === "Browser edit")),
  );
  await Promise.all([desktop, page].map((p) => p.evaluate(() => window.cloudWorkspace.flush())));
  assert.ok(
    (await api("/api/rooms/" + cloud.roomId)).document.pages[0].nodes.some(
      (n) => n.name === "Browser edit",
    ),
  );

  const copied = await desktop.evaluate((id) => window.fileLibrary.duplicate(id), fileId);
  const copiedCloud = await desktop.evaluate((id) => window.fileLibrary.cloudOf(id), copied);
  assert.notEqual(copiedCloud.roomId, cloud.roomId);
  await desktop.evaluate((id) => window.fileLibrary.rename(id, "Renamed from desktop"), copied);
  assert.equal(
    (await api("/api/rooms/" + copiedCloud.roomId)).document.name,
    "Renamed from desktop",
  );

  // Preferences and actual chat creation/draft use the database, without copying browser storage.
  await desktop.evaluate(() => {
    window.appPreferences.set({ theme: "light", smallNudge: 7 });
    window.agentWorkspace.setDefaults({
      instructions: "Shared design instructions",
      model: "desktop-model-only",
    });
    window.agentWorkspace.newChat();
    window.agentWorkspace.setDraft("Draft from desktop");
  });
  await desktop.evaluate(() => window.agentBehavior.set({ followUp: "steer", expandWork: true }));
  const chatId = await desktop.evaluate(() => window.agentWorkspace.getState().conversationId);
  await desktop.evaluate(() => window.accountStore.flush());
  await reread(page);
  await page.waitForFunction(
    (id) =>
      window.agentWorkspace.getState().conversations.some((c) => c.id === id) &&
      window.appPreferences.get().smallNudge === 7,
    chatId,
  );
  await page.waitForFunction(
    () =>
      window.agentWorkspace.getDefaults().instructions === "Shared design instructions" &&
      window.agentBehavior.get().followUp === "steer",
  );
  assert.notEqual(
    await page.evaluate(() => window.agentWorkspace.getDefaults().model),
    "desktop-model-only",
  );
  await page.evaluate((id) => window.agentWorkspace.selectChat(id), chatId);
  assert.equal(
    await page.evaluate(() => window.agentWorkspace.getState().draft),
    "Draft from desktop",
  );
  await page.evaluate(() => window.appPreferences.set({ largeNudge: 42 }));
  await page.evaluate(() => window.accountStore.flush());
  await reread(desktop);
  await desktop.waitForFunction(() => window.appPreferences.get().largeNudge === 42);
  const folder = await desktop.evaluate(() => window.fileLibrary.createFolder("Shared folder"));
  await desktop.evaluate(
    ({ id, folder }) => {
      window.fileLibrary.move(id, folder);
      window.fileLibrary.setArchived(id, true);
    },
    { id: fileId, folder },
  );
  await desktop.evaluate(() => window.accountStore.flush());
  await reread(page);
  await page.waitForFunction(
    ({ folder, roomId }) =>
      window.fileLibrary.folders().some((f) => f.id === folder) &&
      window.fileLibrary
        .list()
        .some((f) => f.cloud?.roomId === roomId && f.archived && f.folder === folder),
    { folder, roomId: cloud.roomId },
  );

  // No design/transcript/preferences snapshot remains in browser storage after acknowledgement.
  for (const client of [desktop, page]) {
    assert.equal(await client.evaluate(() => localStorage.getItem("verynize-v2")), null);
    assert.equal(await client.evaluate(() => localStorage.getItem("better-preferences")), null);
    // The library lives in IndexedDB (web/library-storage.js); an older localStorage copy, if any, holds no design either.
    const noDesign = (library) =>
      library.files
        .filter((f) => f.cloud && !f.cloud.detached)
        .every((f) => f.document.pages.every((p) => p.nodes.length === 0));
    const stored = await readLibrary(client);
    assert.ok(stored.files.some((f) => f.cloud && !f.cloud.detached));
    assert.ok(noDesign(stored));
    const legacy = await client.evaluate(() =>
      JSON.parse(localStorage.getItem("verynize-library-v1")),
    );
    assert.ok(legacy === null || noDesign(legacy));
  }
  // Reload reads the room from the database, never the empty local reference.
  await page.reload();
  await waitForUiReady(page);
  await page.evaluate(
    (cloud) =>
      window.cloudWorkspace.openRoom({
        server: window.cloudAccount.get().server,
        id: cloud.roomId,
      }),
    cloud,
  );
  await page.waitForFunction(() =>
    window.design.getDocument().pages.some((p) => p.nodes.some((n) => n.name === "Browser edit")),
  );
  await desktop.evaluate(() =>
    window.cloudAccount.request("/api/me", {
      method: "PATCH",
      body: JSON.stringify({ displayName: "Synced profile name" }),
    }),
  );
  await reread(page);
  await page.waitForFunction(
    () => window.cloudAccount.get().account.displayName === "Synced profile name",
  );

  await desktop.evaluate((id) => window.agentWorkspace.removeChat(id), chatId);
  await desktop.evaluate(() => window.accountStore.flush());
  await reread(page);
  await page.waitForFunction(
    (id) => !window.agentWorkspace.getState().conversations.some((chat) => chat.id === id),
    chatId,
  );

  // Changing accounts clears the previous identity's in-memory data and file references.
  await passwordUser(server, "other-sync@example.test", "Other");
  await page.evaluate(
    (origin) =>
      window.cloudAccount.signIn({
        server: origin,
        email: "other-sync@example.test",
        password: "a long enough password",
      }),
    origin,
  );
  await page.waitForFunction(() => window.accountStore.ready());
  assert.equal(
    await page.evaluate(() =>
      window.agentWorkspace.getState().conversations.some((c) => c.id === "legacy-history"),
    ),
    false,
  );
  assert.equal(
    await page.evaluate(
      (id) => window.fileLibrary.list().some((f) => f.cloud?.roomId === id),
      cloud.roomId,
    ),
    false,
  );
  assert.notEqual(await page.evaluate(() => window.appPreferences.get().smallNudge), 7);
  assert.equal(await page.evaluate(() => window.agentBehavior.get().followUp), "queue");
  assert.equal(await page.evaluate(() => window.agentWorkspace.getDefaults().instructions), "");
  assert.deepEqual(errors, []);
  console.log(
    "PASS desktop/browser database creation, bidirectional design edits, chat/draft, preferences, folders/archive and reload",
  );
} finally {
  await browser?.close();
  if (app) {
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) win.destroy();
      })
      .catch(() => {});
    await app.close();
  }
  await web?.stop();
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
