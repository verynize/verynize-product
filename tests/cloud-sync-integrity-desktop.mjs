// Sync integrity of the real desktop client (web/cloud-panel.js, web/room-sync.js) against local
// workerd, with faults the production room has no hook for:
// - a broadcast lost while the socket stays open: the next revision is a gap, the client resyncs
//   and holds the lost node with the later edit applied (not "Missing node" at a newer revision);
// - a lost acknowledgement, then the batch sent again over HTTP: the duplicate receipt does not
//   drop the edit; the client resyncs and keeps it;
// - a batch that interrupts the room: it is held on its own, and a small edit after it is stored
//   without resending the interrupting content;
// - a stale copy at the room's revision (3 nodes vs 4,903 after a restart): replaced by the room's.
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";
import { _electron as electron } from "@playwright/test";
import { openSharedDesign } from "./helpers/shared-design.cjs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { moveOffCursor } = createRequire(import.meta.url)("./helpers/off-cursor.cjs");
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-sync-integrity-"));
const options = await cloudOptions(path.join(dir, "state"));
const config = options.workers[0].config;
config.manifest.modules["sync-faults.js"] = {
  type: "esm",
  contents: `
  import worker, { DesignRoom as Base } from "./index.js";
  export * from "./index.js";
  export default worker;
  // Batches that add a node with this id prefix (later edits of that node are not faulted).
  const names = (ops, prefix) =>
    ops?.some((op) => op?.t === "add" && String(op.id).startsWith(prefix));
  export class DesignRoom extends Base {
    applyBatchNow(data, role, who) {
      if (names(data.ops, "poison")) this.ctx.abort("test interrupted batch");
      return super.applyBatchNow(data, role, who);
    }
    deliver(socket, message) {
      const text = typeof message === "string" ? message : JSON.stringify(message);
      if (text.startsWith('{"type":"ops"')) {
        const value = JSON.parse(text);
        // A lost broadcast: no socket receives it, and none is closed.
        if (names(value.ops, "lost-")) return true;
        // A lost acknowledgement: the sender's socket does not receive its own batch.
        if (names(value.ops, "noack-") && socket.deserializeAttachment()?.client === value.client)
          return true;
      }
      return super.deliver(socket, message);
    }
  }
`,
};
config.manifest.mainModule = "sync-faults.js";
const mf = new Miniflare(options);
const rect = (id, extra = {}) => ({
  id,
  type: "rectangle",
  name: id,
  parentId: null,
  x: 40,
  y: 40,
  w: 120,
  h: 80,
  color: "#7c5cff",
  ...extra,
});
const roomDoc = (nodes) => ({
  version: 2,
  name: "Sync integrity",
  activePage: "p1",
  tokens: {},
  pages: [{ id: "p1", name: "Page 1", nodes }],
});
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.VERYNIZE_SKIP_ONBOARDING = "1";
env.VERYNIZE_LAUNCH_EDITOR = "1";
const apps = new Set();
async function launch(profile) {
  const app = await electron.launch({
    env,
    args: [".", `--user-data-dir=${path.join(dir, profile)}`],
  });
  apps.add(app);
  const page = await app.firstWindow();
  page.setDefaultTimeout(40000);
  await moveOffCursor(app);
  await page.waitForFunction(() => !!window.design && !!window.cloudWorkspace);
  return { app, page };
}
const nodeOf = (page, id) =>
  page.evaluate(
    (id) =>
      window.design
        .getDocument()
        .pages.flatMap((p) => p.nodes)
        .find((n) => n.id === id) || null,
    id,
  );

try {
  const server = (await mf.ready).origin;
  const api = async (route, method = "GET", body, token) => {
    const response = await fetch(server + route, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return response.json();
  };
  const createRoom = (doc) => api("/api/rooms", "POST", { document: doc });
  const stored = async (room) =>
    (await api(`/api/rooms/${room.id}`, "GET", null, room.token)).document;
  async function join(page, room) {
    const invite = `${server}/#room=${room.id}&token=${room.token}`;
    page.on("dialog", (dialog) => dialog.accept(dialog.type() === "prompt" ? invite : undefined));
    await openSharedDesign(page);
    await page.locator("#cloud-invite").fill(invite);
    await page.locator("#cloud-connect").click();
    await page.waitForFunction(() =>
      document.getElementById("cloud-status").textContent.includes("Connected"),
    );
    await page.locator("#cloud-close").click();
  }

  // ---- a lost broadcast ---------------------------------------------------------------------
  const room = await createRoom(roomDoc([rect("a"), rect("b", { x: 220 })]));
  let { app, page } = await launch("a");
  await join(page, room);
  const ops = (batch, list) =>
    api(`/api/rooms/${room.id}/ops`, "POST", { client: "peer", batch, ops: list }, room.token);
  const lost = await ops(1, [{ t: "add", page: "p1", id: "lost-1", value: rect("lost-1") }]);
  assert.equal(lost.revision, 1);
  const later = await ops(2, [{ t: "node", page: "p1", id: "lost-1", key: "x", value: 50 }]);
  assert.equal(later.revision, 2);
  await page.waitForFunction(
    () => window.design.getDocument().pages[0].nodes.find((n) => n.id === "lost-1")?.x === 50,
    null,
    { timeout: 20000 },
  );

  // ---- a lost acknowledgement, then the batch sent again -------------------------------------
  await page.evaluate(() => window.design.addNode("rectangle", { id: "noack-1", x: 300 }));
  // flush() waits for the socket acknowledgement, then posts the batch again over HTTP.
  await page.evaluate(() => window.cloudWorkspace.flush().catch(() => {}));
  assert.ok(await nodeOf(page, "noack-1"), "the duplicate receipt does not drop the edit");
  await page.waitForFunction(() => window.cloudWorkspace.pendingCount() === 0, null, {
    timeout: 30000,
  });
  assert.ok(await nodeOf(page, "noack-1"), "the edit stays after the resync");
  assert.equal(
    (await stored(room)).pages[0].nodes.filter((n) => n.id === "noack-1").length,
    1,
    "applied once",
  );

  // ---- an interrupting batch, then a small edit ----------------------------------------------
  const before = (await stored(room)).pages[0].nodes.length;
  await page.evaluate(() => window.design.addNode("rectangle", { id: "poison-1", x: 500 }));
  await page.waitForFunction(
    () => /interrupted room processing/.test(document.getElementById("cloud-status").textContent),
    null,
    { timeout: 30000 },
  );
  assert.ok(await nodeOf(page, "poison-1"), "the interrupting edit stays on this device");
  await page.evaluate(() => window.design.updateNodes(["a"], { x: 77 }));
  await page.waitForFunction(
    () =>
      /Saved shared revision|kept on this device/.test(
        document.getElementById("cloud-status").textContent,
      ),
    null,
    { timeout: 30000 },
  );
  for (let i = 0; i < 100; i++) {
    if ((await stored(room)).pages[0].nodes.find((n) => n.id === "a").x === 77) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const after = await stored(room);
  assert.equal(after.pages[0].nodes.find((n) => n.id === "a").x, 77, "the small edit is stored");
  assert.equal(after.pages[0].nodes.length, before, "the interrupting node never reached the room");
  assert.equal(
    await page.evaluate(() => window.cloudWorkspace.pendingCount()),
    1,
    "only it is held",
  );
  const outbox = await page.evaluate(() => {
    const room = window.cloudWorkspace.room();
    return window.cloudWorkspace.storedOutbox(room.server, room.id);
  });
  assert.equal(outbox.retainedCode, "interrupted");
  assert.ok(outbox.retained.some((op) => op.id === "poison-1"));
  await page.evaluate(() => window.cloudWorkspace.disconnect());
  await app.close();
  apps.delete(app);

  // ---- a stale copy at the room's revision -----------------------------------------------------
  const big = await createRoom(
    roomDoc(
      Array.from({ length: 4903 }, (_, i) =>
        rect(`n${i}`, { x: (i % 70) * 20, y: Math.floor(i / 70) * 20, w: 16, h: 16 }),
      ),
    ),
  );
  ({ app, page } = await launch("s"));
  await join(page, big);
  await page.waitForFunction(() => window.design.getDocument().pages[0].nodes.length === 4903);
  // The stored outbox holds a 3-node copy at the same revision (how a stale web copy looked).
  const revision = await page.evaluate(async () => {
    const room = window.cloudWorkspace.room();
    const saved = await window.cloudWorkspace.storedOutbox(room.server, room.id);
    saved.confirmed.pages[0].nodes = saved.confirmed.pages[0].nodes.slice(0, 3);
    await new Promise((resolve, reject) => {
      const open = indexedDB.open("verynize-cloud", 1);
      open.onsuccess = () => {
        const tx = open.result.transaction("outbox", "readwrite");
        tx.objectStore("outbox").put(saved, `${room.server}|${room.id}`);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
    return saved.revision;
  });
  await app.close();
  apps.delete(app);
  ({ app, page } = await launch("s"));
  await page.waitForFunction(
    (id) => window.cloudWorkspace.room()?.id === id && window.cloudWorkspace.isConnected(),
    big.id,
  );
  await page.waitForFunction(
    () => window.design.getDocument().pages[0].nodes.length === 4903,
    null,
    {
      timeout: 40000,
    },
  );
  // The outbox is written shortly after the snapshot (debounced).
  let refreshed;
  for (let i = 0; i < 50; i++) {
    refreshed = await page.evaluate(async () => {
      const room = window.cloudWorkspace.room();
      const saved = await window.cloudWorkspace.storedOutbox(room.server, room.id);
      return { revision: saved.revision, nodes: saved.confirmed.pages[0].nodes.length };
    });
    if (refreshed.nodes === 4903) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(refreshed.revision, revision, "the room's revision did not change");
  assert.equal(refreshed.nodes, 4903, "the stale copy was replaced by the room's pages");
  console.log(
    "PASS desktop sync integrity: lost broadcast resynced, lost acknowledgement kept the edit, interrupting batch held alone while a later edit synced, stale copy at the same revision replaced",
  );
} finally {
  await Promise.all([...apps].map((app) => app.close().catch(() => {})));
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
