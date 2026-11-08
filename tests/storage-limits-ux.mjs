// Document size warnings in a real Electron editor (web/storage-limits.js + the storage island):
// a page at 80 % of its limit warns in the Share panel and with a toast, a page over its limit
// blocks creating a room before anything is sent, and a server that refuses a synced edit for its
// size shows the blocking size dialog instead of a generic failure, and a native save over the
// 20 MiB file limit shows the same dialog titled for saving. Screenshots go to
// $VERYNIZE_SCREENSHOTS when set.
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";
import { _electron as electron } from "@playwright/test";
import { openSharedDesign } from "./helpers/shared-design.cjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const { waitForUiReady } = createRequire(import.meta.url)("./helpers/ui-ready.cjs");
const shots = process.env.VERYNIZE_SCREENSHOTS || "";
const MiB = 1024 * 1024;
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-size-ux-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
let app;
try {
  const server = (await mf.ready).origin;
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1", VERYNIZE_LAUNCH_EDITOR: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ env, args: [".", `--user-data-dir=${path.join(dir, "profile")}`] });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 870 });
  await page.waitForFunction(() => !!window.design && !!window.storageLimits);
  await waitForUiReady(page);
  const shot = async (name, target = page) => {
    if (shots) await target.screenshot({ path: path.join(shots, name) });
  };
  // A generated document: `sizes` are the characters of text per page (several layers each,
  // the schema caps one text layer at 1,000,000 characters).
  const load = (sizes) =>
    page.evaluate((sizes) => {
      const doc = window.design.getDocument();
      doc.pages = sizes.map((size, p) => ({
        id: `page-${p + 1}`,
        name: ["Landing", "Pricing", "Blog"][p] || `Page ${p + 1}`,
        background: "#f5f3ee",
        nodes: Array.from({ length: Math.ceil(size / 500000) }, (_, i) => ({
          id: `t-${p}-${i}`,
          type: "text",
          hidden: true,
          name: `Copy ${i + 1}`,
          x: 40,
          y: 40 + i * 60,
          w: 400,
          h: 40,
          text: "Lorem ipsum ".repeat(Math.ceil(Math.min(500000, size - i * 500000) / 12)),
        })),
      }));
      doc.activePage = "page-1";
      window.design.loadDocument(doc);
    }, sizes);
  const report = () =>
    page
      .waitForFunction(
        () => {
          const r = window.storageLimits.current();
          return r && r.measuredAt > (window.__measuredBefore || 0) ? r : null;
        },
        null,
        { timeout: 15000 },
      )
      .then((handle) => handle.jsonValue());
  const mark = () =>
    page.evaluate(
      () => (window.__measuredBefore = window.storageLimits.current()?.measuredAt || 0),
    );

  // 1. Small file: the Share panel shows the size, no warning.
  await mark();
  await load([200000, 50000]);
  let measured = await report();
  assert.equal(measured.problems.length, 0);
  await openSharedDesign(page);
  await page.locator("#cloud-server").fill(server);
  const meter = page.locator("#storage-meter");
  await meter.waitFor();
  assert.equal(await meter.getAttribute("data-level"), "ok");
  assert.match(await meter.locator("[data-storage-total]").textContent(), /^\d+ KB of 20 MB$/);
  assert.equal(await page.locator('[role="meter"][aria-label="Shared file size"]').count(), 1);
  await shot("size-ok-share-panel.png");
  await page.locator("#cloud-close").click();

  // 2. A page at 80 % of the 20 MB page limit: warning in the panel (naming the page) and a toast.
  await mark();
  await load([17.5 * MiB, 50000]);
  measured = await report();
  assert.deepEqual(
    measured.problems.map((p) => [p.level, p.scope, p.pageId]),
    [
      ["warn", "document", undefined],
      ["warn", "page", "page-1"],
    ],
  );
  const toast = page.locator("[data-sonner-toast]", { hasText: "This file is" });
  await toast.waitFor({ timeout: 10000 });
  assert.match(await toast.textContent(), /of the 20 MB limit/);
  await openSharedDesign(page);
  await page.waitForFunction(
    () => document.getElementById("storage-meter")?.dataset.level === "warn",
  );
  const warning = page.locator('#storage-meter [data-storage-problem="warn"][data-scope="page"]');
  assert.match(await warning.textContent(), /Page “Landing” is 18 MB of the 20 MB page limit/);
  assert.match(await meter.textContent(), /Largest page: Landing/);
  assert.match(await meter.textContent(), /Move content to another file/);
  await shot("size-warning-share-panel.png");
  await page.locator("#cloud-close").click();
  await shot("size-warning-toast.png");

  // 3. Over the page limit: creating a room is blocked before any request reaches the server.
  await mark();
  await load([20.3 * MiB, 50000]);
  measured = await report();
  assert.equal(measured.problems[0].level, "over");
  const requests = [];
  page.on("request", (request) => {
    if (request.url().startsWith(server)) requests.push(request.url());
  });
  await openSharedDesign(page);
  await page.waitForFunction(
    () => document.getElementById("storage-meter")?.dataset.level === "over",
  );
  await page.locator("#cloud-create").click();
  const blocked = page.locator("#storage-limit-error");
  await blocked.waitFor();
  assert.match(await blocked.textContent(), /This file is 20\.\d+ MB, over the 20 MB limit/);
  assert.match(await page.locator("#cloud-status").textContent(), /over the 20 MB limit/);
  assert.deepEqual(requests, [], "nothing was sent");
  assert.equal(await page.evaluate(() => window.cloudWorkspace.isConnected()), false);
  await shot("size-over-blocked-share.png");
  await page.getByRole("button", { name: "Dismiss size error" }).click();
  await page.locator("#cloud-close").click();

  // 4. Syncing: the room accepts the file, then refuses an edit that makes it too large for the
  // server; the refusal is the blocking size dialog (the Share panel is closed).
  await mark();
  await load([19.3 * MiB]);
  await report();
  await openSharedDesign(page);
  await page.locator("#cloud-create").click();
  await page.waitForFunction(
    () => document.getElementById("cloud-status").textContent.includes("Connected"),
    null,
    { timeout: 20000 },
  );
  await page.locator("#cloud-close").click();
  await page.evaluate(() =>
    window.design.addNode("text", {
      name: "Pasted article",
      hidden: true,
      x: 600,
      y: 40,
      w: 400,
      h: 40,
      text: "Long form ".repeat(98000),
    }),
  );
  const dialog = page.locator("#storage-limit-dialog");
  await dialog.waitFor({ timeout: 20000 });
  assert.match(await dialog.textContent(), /File is too large to sync/);
  // The room refuses per page (cloud/room-store.js) and names the page.
  assert.match(await dialog.textContent(), /Page "Landing" exceeds the 20 MB page limit/);
  assert.match(await dialog.textContent(), /Your changes are kept on this device/);
  await page.waitForTimeout(900); // allow the size report and toast effect to settle
  assert.equal(await page.locator("[data-sonner-toast]").count(), 0, "one blocking notification");
  assert.ok(
    await page.evaluate(() =>
      window.design.getDocument().pages[0].nodes.some((n) => n.name === "Pasted article"),
    ),
    "rejected node remains on canvas",
  );
  const saved = await page.evaluate(async () => {
    const room = window.cloudWorkspace.room();
    return window.cloudWorkspace.storedOutbox(room.server, room.id);
  });
  assert.ok(saved.retained.length, "rejected edits persisted in IndexedDB");
  await shot("size-sync-refused-dialog.png");
  await page.getByRole("button", { name: "Close size error" }).click();
  await dialog.waitFor({ state: "detached" });

  await page.reload();
  await waitForUiReady(page);
  await page.waitForFunction(() => window.cloudWorkspace?.pendingCount() > 0, null, {
    timeout: 30000,
  });
  assert.ok(
    await page.evaluate(() =>
      window.design.getDocument().pages[0].nodes.some((n) => n.name === "Pasted article"),
    ),
    "rejected work survives reload and reconnect",
  );
  await page.evaluate(() => {
    const ids = window.design
      .getDocument()
      .pages[0].nodes.filter((n) => n.name !== "Pasted article")
      .map((n) => n.id);
    window.design.updateNodes(ids, { text: "Short copy" });
  });
  await page.waitForFunction(() => window.cloudWorkspace.pendingCount() === 0, null, {
    timeout: 30000,
  });
  const recovered = await page.evaluate(async () => {
    const room = window.cloudWorkspace.room();
    return window.cloudWorkspace.storedOutbox(room.server, room.id);
  });
  assert.ok(
    recovered.confirmed.pages[0].nodes.some((n) => n.name === "Pasted article"),
    "rejected import synced after shrinking",
  );

  // 5. Native save: a file over the 20 MiB limit of the design store is refused by the main
  // process; the refusal is the blocking size dialog for saving. The large page is not the open one.
  await openSharedDesign(page);
  await page.locator("#cloud-leave").click();
  await page.locator("#cloud-close").click();
  const target = path.join(dir, "too-large.verynize.json");
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, target);
  await page.evaluate(() => {
    const doc = window.design.getDocument();
    doc.pages = [
      { id: "small", name: "Cover", background: "#f5f3ee", nodes: [] },
      {
        id: "archive",
        name: "Archive",
        background: "#f5f3ee",
        nodes: Array.from({ length: 22 }, (_, i) => ({
          id: `a-${i}`,
          type: "text",
          hidden: true,
          name: `Archive ${i + 1}`,
          x: 0,
          y: i * 60,
          w: 400,
          h: 40,
          text: "Archived ".repeat(110000),
        })),
      },
    ];
    doc.activePage = "small";
    window.design.loadDocument(doc);
  });
  await page.evaluate(() =>
    (
      document.getElementById("legacy-save-project") || document.getElementById("save-project")
    ).click(),
  );
  await dialog.waitFor({ timeout: 30000 });
  assert.match(await dialog.textContent(), /File is too large to save/);
  assert.match(await dialog.textContent(), /Document exceeds 20 MiB/);
  assert.doesNotMatch(await dialog.textContent(), /invoking remote method/);
  await assert.rejects(fs.access(target), "nothing was written");
  await shot("size-save-refused-dialog.png");
  await page.getByRole("button", { name: "Close size error" }).click();
  await dialog.waitFor({ state: "detached" });

  console.log(
    "PASS size warnings: size in the Share panel, 80 % page warning with toast, blocking error before sharing an over-limit page (nothing sent), server size refusal retains edits across reload and retries after shrinking with one notification, native save over 20 MiB refused with the save dialog",
  );
} finally {
  await app
    ?.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) win.destroy();
    })
    .catch(() => {});
  await app?.close().catch(() => {});
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
