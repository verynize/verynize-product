// Cloud files against local workerd: a room is a file that the desktop reopens after a restart,
// the Files home lists workspace/shared rooms; unsaved edits block switching until the server returns.
import { waitForAsync } from "./helpers/wait-for-async.cjs";
import { _electron as electron } from "@playwright/test";
import { openSharedDesign } from "./helpers/shared-design.cjs";
import { waitForUiReady } from "./helpers/ui-ready.cjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, cloudOptions, passwordUser } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-cloud-files-"));
const options = await cloudOptions(path.join(dir, "state"));
let mf = new Miniflare(options);
const apps = new Set();
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.VERYNIZE_SKIP_ONBOARDING = "1";
const password = "a long enough password";

async function launch(profile) {
  const app = await electron.launch({
    env,
    args: [".", `--user-data-dir=${path.join(dir, profile)}`],
    timeout: 20000,
  });
  apps.add(app);
  const page = await app.firstWindow({ timeout: 20000 });
  page.setDefaultTimeout(30000);
  await waitForUiReady(page);
  await page.waitForFunction(
    () =>
      !!window.design && !!window.cloudWorkspace && !!window.fileLibrary && !!window.cloudAccount,
  );
  page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  return { app, page };
}
async function quit(app) {
  await (
    await app.firstWindow()
  ).evaluate(async () => {
    await window.cloudWorkspace.flush();
    await window.accountStore.flush();
  });
  apps.delete(app);
  await app.close();
}
const room = (page) => page.evaluate(() => window.cloudWorkspace.room());
const files = (page) =>
  page.evaluate(() =>
    window.fileLibrary.list().map((f) => ({ id: f.id, name: f.name, cloud: f.cloud || null })),
  );
const synced = (page) =>
  page.waitForFunction(
    () =>
      window.cloudWorkspace.isConnected() &&
      window.cloudWorkspace.pendingCount() === 0 &&
      /Connected|Saved|Synced/.test(document.getElementById("cloud-status").textContent),
    null,
    { timeout: 40000 },
  );

try {
  let server = (await mf.ready).origin;
  options.port = Number(new URL(server).port);
  const api = (route, session, body, method) =>
    fetch(server + route, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json", "x-verynize-session": session },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).then(async (response) => {
      const text = await response.text();
      assert.ok(response.ok, `${route}: ${response.status} ${text}`);
      return text ? JSON.parse(text) : null;
    });
  const ana = await passwordUser(server, "ana@example.test", "Ana", fetch, "192.0.2.20");
  const budi = await passwordUser(server, "budi@example.test", "Budi", fetch, "192.0.2.21");
  const signIn = (page) =>
    page.evaluate(
      ({ server, password }) =>
        window.cloudAccount.signIn({ server, email: "ana@example.test", password }),
      { server, password },
    );

  // 1. Create a room from the open file: that file becomes the room's file.
  let { app, page } = await launch("a");
  await page.locator(".file-open").first().click();
  await signIn(page);
  const fileId = await page.evaluate(() => window.fileLibrary.currentId);
  const textId = await page.evaluate(() =>
    window.design.addNode("text", { name: "Headline", text: "Hello" }),
  );
  await page.waitForFunction(() => !!window.cloudWorkspace.room());
  const roomId = (await room(page)).id;
  const cloud = await page.evaluate((id) => window.fileLibrary.cloudOf(id), fileId);
  assert.equal(cloud.server, server);
  assert.equal(cloud.roomId, roomId);
  assert.ok(!cloud.detached);
  const fileCount = (await files(page)).length;
  await page.evaluate(() => window.design.addNode("rectangle", { name: "online-1" }));
  await synced(page);

  // 2. Restart opens Home; selecting the retained file reconnects without a new copy.
  await waitForAsync(
    page,
    async ({ server, roomId }) => {
      const saved = await window.cloudWorkspace.storedOutbox(server, roomId);
      return saved && saved.pending.length === 0 && saved.retained.length === 0;
    },
    { server, roomId },
  );
  await quit(app);
  ({ app, page } = await launch("a"));
  assert.equal(await page.locator("#file-home").isVisible(), true);
  assert.equal(await room(page), null, "Home does not reconnect the active room on launch");
  await page.locator(`#file-home [data-room-id="${roomId}"] .file-open`).click();
  await page.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, roomId);
  await synced(page);
  assert.equal(await page.evaluate(() => window.fileLibrary.currentId), fileId);
  assert.equal((await files(page)).length, fileCount);
  // A new file is stored in the workspace right away (a private room of its own), signed in.
  const newId = await page.evaluate(async () => {
    const doc = window.design.getDocument();
    doc.name = "New file";
    return window.fileLibrary.createFromDocument(doc);
  });
  await page.waitForFunction((id) => !!window.fileLibrary.cloudOf(id), newId);
  const newRoom = await page.evaluate((id) => window.fileLibrary.cloudOf(id), newId);
  assert.notEqual(newRoom.roomId, roomId);
  await page.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, newRoom.roomId);
  assert.equal(
    (await page.evaluate(() => window.cloudWorkspace.access())).visibility,
    "private",
    "new files start private",
  );
  // Opening another file switches rooms; reopening the first cloud file reconnects, still without a copy.
  await page.evaluate((id) => window.fileLibrary.open(id), fileId);
  await page.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, roomId);
  await synced(page);
  assert.equal((await files(page)).filter((f) => f.cloud?.roomId === roomId).length, 1);
  const localCount = (await files(page)).length;

  // 3. Files home lists workspace rooms and rooms shared with you; opening one joins it once.
  const me = await api("/api/me", ana);
  const plan = await api("/api/rooms", ana, {
    document: {
      version: 2,
      name: "Workspace plan",
      activePage: "p1",
      pages: [{ id: "p1", name: "Page 1", nodes: [] }],
      tokens: {},
    },
    organizationId: me.personalOrganizationId,
  });
  const shared = await api("/api/rooms", budi, {
    document: {
      version: 2,
      name: "Budi brief",
      activePage: "p1",
      pages: [{ id: "p1", name: "Page 1", nodes: [] }],
      tokens: {},
    },
  });
  await api(`/api/rooms/${shared.id}/members`, budi, {
    email: "ana@example.test",
    role: "viewer",
  });
  // Budi's room lives in his personal workspace, so for Ana it is a direct share.
  await page.evaluate(() => window.fileLibrary.showHome());
  const card = (id) => page.locator(`#file-home [data-room-id="${id}"]`);
  await card(plan.id).waitFor();
  await card(shared.id).waitFor();
  assert.match(await card(shared.id).textContent(), /Shared with you/);
  assert.match(await card(shared.id).textContent(), /Viewer/);
  assert.match(await card(roomId).textContent(), /Owner/);
  assert.equal(await card(roomId).count(), 1, "the local cloud file and its room are one card");
  await page.evaluate(() => {
    window.__remoteOpeningPaint = null;
    window.addEventListener("switch-loading-change", function observe(event) {
      if (event.detail.phase !== "begin" || event.detail.reason !== "home") return;
      window.removeEventListener("switch-loading-change", observe);
      requestAnimationFrame(() => {
        window.__remoteOpeningPaint = {
          home: document.body.classList.contains("files-view"),
          logo: getComputedStyle(document.getElementById("switch-loading-logo")).display,
        };
      });
    });
  });
  await card(plan.id).locator(".file-open").click();
  await page.waitForFunction(() => window.__remoteOpeningPaint !== null);
  assert.deepEqual(await page.evaluate(() => window.__remoteOpeningPaint), {
    home: false,
    logo: "flex",
  });
  await page.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, plan.id);
  assert.equal(await page.evaluate(() => window.design.getDocument().name), "Workspace plan");
  assert.equal((await files(page)).length, localCount + 1);
  const planFile = (await files(page)).find((f) => f.cloud?.roomId === plan.id);
  assert.ok(planFile);
  await page.evaluate(() => window.fileLibrary.showHome());
  await card(plan.id).waitFor();
  assert.equal(await card(plan.id).count(), 1);
  assert.equal(await card(plan.id).getAttribute("data-file-id"), planFile.id);
  await card(plan.id).locator(".file-open").click();
  await page.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, plan.id);
  assert.equal((await files(page)).length, localCount + 1, "reopening does not copy");

  console.log("Database file reopen and listing passed");
  // 4. Offline changes stay in memory, block switching, and reach the database on reconnect.
  await page.evaluate((id) => window.fileLibrary.open(id), fileId);
  await synced(page);
  assert.equal(
    await page.evaluate(() => window.fileLibrary.currentId),
    fileId,
    "open returns with the requested file active",
  );
  assert.equal((await room(page)).id, roomId);
  await mf.dispose();
  await page.evaluate((id) => {
    window.design.addNode("rectangle", { name: "offline-1" });
    window.design.updateNodes([id], (n) => ({ text: n.text + " offline" }));
  }, textId);
  assert.ok(await page.evaluate(() => window.cloudWorkspace.pendingCount() > 0));
  await waitForAsync(
    page,
    async ({ server, roomId }) => {
      const saved = await window.cloudWorkspace.storedOutbox(server, roomId);
      return saved?.pending.some((batch) => batch.ops.some((op) => op.value?.name === "offline-1"));
    },
    { server, roomId },
  );
  await assert.rejects(page.evaluate((id) => window.fileLibrary.open(id), newId));
  assert.equal(await page.evaluate(() => window.fileLibrary.currentId), fileId);
  await page.evaluate(() => window.design.addNode("rectangle", { name: "offline-2" }));
  mf = new Miniflare(options);
  server = (await mf.ready).origin;
  await synced(page);
  const remote = await api(`/api/rooms/${roomId}`, ana);
  for (const name of ["online-1", "offline-1", "offline-2"])
    assert.equal(remote.document.pages[0].nodes.filter((n) => n.name === name).length, 1);
  assert.equal(remote.document.pages[0].nodes.find((n) => n.id === textId).text, "Hello offline");

  // 5. A second device signed in as Ana opens the room from the Files home and sees the edits.
  const second = await launch("b");
  await signIn(second.page);
  await second.page.evaluate(() => window.fileLibrary.showHome());
  await second.page.locator(`#file-home [data-room-id="${roomId}"] .file-open`).click();
  await second.page.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, roomId);
  await second.page.waitForFunction((textId) => {
    const nodes = window.design.getDocument().pages[0].nodes;
    return (
      ["online-1", "offline-1", "offline-2"].every(
        (name) => nodes.filter((n) => n.name === name).length === 1,
      ) && nodes.find((n) => n.id === textId)?.text === "Hello offline"
    );
  }, textId);
  // Live edits still flow both ways.
  await second.page.evaluate(() => window.design.addNode("rectangle", { name: "from-b" }));
  await page.waitForFunction(() =>
    window.design.getDocument().pages[0].nodes.some((n) => n.name === "from-b"),
  );

  // Signed-in rejected work is also durable, including a complete process restart.
  await page.evaluate(() => {
    for (let i = 0; i < 23; i++)
      window.design.addNode("text", {
        name: `retained-${i}`,
        text: "x".repeat(950000),
        hidden: true,
      });
  });
  await waitForAsync(
    page,
    async () => {
      const room = window.cloudWorkspace.room();
      const saved = await window.cloudWorkspace.storedOutbox(room.server, room.id);
      return saved?.retained.length > 0;
    },
    null,
    { timeout: 60000 },
  );
  apps.delete(app);
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
  });
  await app.close();
  ({ app, page } = await launch("a"));
  assert.equal(await page.locator("#file-home").isVisible(), true);
  assert.equal(await room(page), null, "Home does not reconnect the active room on launch");
  await page.locator(`#file-home [data-room-id="${roomId}"] .file-open`).click();
  await page.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, roomId);
  await page.waitForFunction(
    () =>
      window.design.getDocument().pages[0].nodes.filter((n) => n.name.startsWith("retained-"))
        .length === 23,
  );
  await page.evaluate(() => {
    const ids = window.design
      .getDocument()
      .pages[0].nodes.filter((n) => n.name.startsWith("retained-"))
      .map((n) => n.id);
    window.design.updateNodes(ids, { text: "small" });
  });
  await synced(page);
  const recovered = await api(`/api/rooms/${roomId}`, ana);
  assert.equal(
    recovered.document.pages[0].nodes.filter(
      (n) => n.name.startsWith("retained-") && n.text === "small",
    ).length,
    23,
  );

  if (await page.locator("#storage-limit-dialog").isVisible())
    await page.getByRole("button", { name: "Close size error" }).click();

  // A burst of edits made while a batch is in flight joins the unsent tail batch instead of
  // waiting for one round trip per edit.
  const burst = await page.evaluate(async () => {
    const id = window.design
      .getDocument()
      .pages[0].nodes.find((n) => n.name.startsWith("retained-")).id;
    const send = WebSocket.prototype.send;
    let batches = 0;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string" && data.startsWith('{"type":"ops"')) batches++;
      return send.call(this, data);
    };
    try {
      for (let i = 0; i < 40; i++) {
        window.design.updateNodes([id], { text: `burst ${i}` });
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const until = Date.now() + 10000;
      while (window.cloudWorkspace.pendingCount() && Date.now() < until)
        await new Promise((resolve) => setTimeout(resolve, 20));
      return { batches, pending: window.cloudWorkspace.pendingCount() };
    } finally {
      WebSocket.prototype.send = send;
    }
  });
  assert.equal(burst.pending, 0);
  assert.ok(burst.batches <= 10, `40 quick edits took ${burst.batches} batches`);

  // 6. Disconnect keeps the local copy, marks it detached and forgets the stored outbox.
  await openSharedDesign(page);
  await page.locator("#cloud-leave").click();
  assert.equal(await page.evaluate(() => window.cloudWorkspace.isConnected()), false);
  await waitForAsync(
    page,
    async ({ server, roomId }) => !(await window.cloudWorkspace.storedOutbox(server, roomId)),
    { server, roomId },
  );
  const detached = await page.evaluate((id) => window.fileLibrary.cloudOf(id), fileId);
  assert.equal(detached.detached, true);
  assert.equal(await page.evaluate(() => window.fileLibrary.currentId), fileId);
  console.log(
    "PASS cloud files: create room marks the file, restart reconnects without copies, Files home lists workspace and shared rooms and joins once, in-memory offline edits block switching and reach the database exactly once, second device sees them, signed-in rejected edits survive process restart and sync after shrinking, disconnect detaches and clears the outbox",
  );
} finally {
  await Promise.all(
    [...apps].map(async (app) => {
      await app
        .evaluate(({ BrowserWindow }) => {
          for (const win of BrowserWindow.getAllWindows()) win.destroy();
        })
        .catch(() => {});
      await app.close().catch(() => {});
    }),
  );
  await mf.dispose().catch(() => {});
  await fs.rm(dir, { recursive: true, force: true });
}
