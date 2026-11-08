import { Miniflare as Workerd } from "miniflare";
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";
import { _electron as electron } from "@playwright/test";
import { openSharedDesign } from "./helpers/shared-design.cjs";
import { createRequire } from "node:module";
const { moveOffCursor } = createRequire(import.meta.url)("./helpers/off-cursor.cjs");
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "better-cloud-ui-"));
const options = await cloudOptions(path.join(dir, "state"));
const mf = new Miniflare(options);
const apps = [];
let legacyMf;
try {
  const server = (await mf.ready).origin;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VERYNIZE_CLOUD_SERVER;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  // A fresh desktop profile offers the production server (desktop/cloud-defaults.cjs), but automated runs can never reach it.
  {
    const app = await electron.launch({
      env,
      args: [".", `--user-data-dir=${path.join(dir, "fresh")}`],
    });
    apps.push(app);
    let log = "";
    app.process().stderr.on("data", (chunk) => {
      log += chunk;
    });
    const page = await app.firstWindow();
    await moveOffCursor(app);
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.uiReady === "true" &&
        document.getElementById("cloud-server")?.value === "https://verynize.gayaloo.app",
    );
    await openSharedDesign(page);
    await page.locator("#cloud-create").click();
    await page.waitForFunction(() =>
      /fetch/i.test(document.getElementById("cloud-status").textContent),
    );
    assert.equal(await page.evaluate(() => window.cloudWorkspace.isConnected()), false);
    for (let i = 0; i < 50 && !log.includes("Blocked a request to verynize.gayaloo.app"); i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.match(
      log,
      /Blocked a request to verynize\.gayaloo\.app in an automated run: POST \/api\/rooms/,
    );
    await apps.pop().close();
  }
  // Tests choose their server with VERYNIZE_CLOUD_SERVER.
  env.VERYNIZE_CLOUD_SERVER = server;
  for (const label of ["a", "b"])
    apps.push(
      await electron.launch({ env, args: [".", `--user-data-dir=${path.join(dir, label)}`] }),
    );
  const [a, b] = await Promise.all(apps.map((app) => app.firstWindow()));
  await Promise.all(apps.map(moveOffCursor));
  await Promise.all([a, b].map((page) => page.waitForFunction(() => !!window.design)));
  await a.waitForFunction(
    (server) => document.getElementById("cloud-server").value === server,
    server,
  );
  await openSharedDesign(a);
  await a.locator("#cloud-create").click();
  await a.waitForFunction(() => document.getElementById("cloud-invite").value.includes("token="));
  const invite = await a.locator("#cloud-invite").inputValue();
  b.on("dialog", async (dialog) => dialog.accept(dialog.type() === "prompt" ? invite : undefined));
  await openSharedDesign(b);
  await b.locator("#cloud-invite").fill(invite);
  await b.evaluate(() => {
    const s = document.getElementById("cloud-status");
    window.__statuses = [];
    new MutationObserver(() => window.__statuses.push(s.textContent)).observe(s, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  await b.locator("#cloud-connect").click();
  await b.waitForFunction(() =>
    document.getElementById("cloud-status").textContent.includes("Connected"),
  );
  await a.waitForFunction(
    () => document.getElementById("cloud-presence").textContent === "2 connected",
  );
  for (const page of [a, b]) {
    const room = await page.evaluate(() => ({
      room: window.cloudWorkspace.room(),
      fileId: window.fileLibrary.currentId,
    }));
    assert.ok(room.fileId);
    assert.equal(
      room.room.fileId,
      room.fileId,
      "room accessor retains the connected library file id",
    );
  }
  assert.deepEqual(
    (await b.evaluate(() => window.__statuses)).filter((text) => /Disconnected/.test(text)),
    [],
    "joining never reports Disconnected",
  );
  // The invite carries an editor link; the owner token stays private in the creator's file record. The joiner is an editor without owner powers.
  const inviteParams = new URLSearchParams(new URL(invite).hash.slice(1)),
    ownerToken = await a.evaluate(
      () => window.fileLibrary.cloudOf(window.fileLibrary.currentId).token,
    );
  assert.match(ownerToken, /^[0-9a-f]{64}$/);
  assert.notEqual(inviteParams.get("token"), ownerToken);
  assert.equal(invite.includes(ownerToken), false);
  assert.equal(await b.locator("#cloud-role").textContent(), "Editor");
  assert.equal(await b.evaluate(() => window.cloudWorkspace.role()), "editor");
  for (const id of ["cloud-owner-tools", "cloud-invite-role", "cloud-create"])
    assert.equal(await b.locator("#" + id).isHidden(), true, id);
  assert.equal(await b.locator("#cloud-invite").inputValue(), invite);
  const roomURL = server + "/api/rooms/" + inviteParams.get("room"),
    asJoiner = (route, method, body) =>
      fetch(roomURL + route, {
        method,
        headers: {
          authorization: "Bearer " + inviteParams.get("token"),
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
  for (const [route, method, body] of [
    ["/tokens/rotate", "POST"],
    ["/tokens", "POST", { role: "owner" }],
  ])
    assert.equal((await asJoiner(route, method, body)).status, 403, route);
  assert.ok(
    [401, 403].includes(
      (await asJoiner("/members", "POST", { email: "x@example.test", role: "owner" })).status,
    ),
  );
  assert.equal((await (await asJoiner("/access", "GET")).json()).links, undefined);
  // The owner can share a view-only link instead; the editor link is reused when switching back. Copy invite puts the shown link on the clipboard.
  await a.locator("#cloud-invite-role").selectOption("viewer");
  await a.waitForFunction((old) => {
    const v = document.getElementById("cloud-invite").value;
    return v.includes("token=") && v !== old;
  }, invite);
  const viewerInvite = await a.locator("#cloud-invite").inputValue(),
    viewerToken = new URLSearchParams(new URL(viewerInvite).hash.slice(1)).get("token");
  assert.equal(
    (await (await fetch(roomURL, { headers: { authorization: "Bearer " + viewerToken } })).json())
      .role,
    "viewer",
  );
  await a.locator("#cloud-invite-role").selectOption("editor");
  await a.waitForFunction(
    (invite) => document.getElementById("cloud-invite").value === invite,
    invite,
  );
  await apps[0].evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .focus(),
  );
  await a.locator("#cloud-copy").click();
  await a
    .waitForFunction(
      () => document.getElementById("cloud-status").textContent.startsWith("Invite copied"),
      null,
      { timeout: 5000 },
    )
    .catch(async (e) => {
      console.log("STATUS", await a.locator("#cloud-status").textContent());
      throw e;
    });
  assert.equal(await apps[0].evaluate(({ clipboard }) => clipboard.readText()), invite);
  assert.equal(
    (
      await (
        await fetch(roomURL + "/access", { headers: { authorization: "Bearer " + ownerToken } })
      ).json()
    ).links.filter((link) => link.role === "editor").length,
    1,
    "one editor invite link, reused",
  );
  await a.locator("#cloud-name").fill("Alice");
  await a.locator("#cloud-name").press("Tab");
  await b.locator("#cloud-name").fill("Bob");
  await b.locator("#cloud-name").press("Tab");
  await a.locator("#cloud-close").click();
  await b.locator("#cloud-close").click();
  const canvasBox = await a.locator("#canvas").boundingBox();
  await a.mouse.move(canvasBox.x + 100, canvasBox.y + 100);
  await b.waitForFunction(() =>
    document.querySelector(".collaborator-cursor")?.textContent.includes("Alice"),
  );
  assert.equal(
    await b.locator(".collaborator-cursor").evaluate((e) => parseFloat(e.style.left) > 0),
    true,
  );
  await a.locator(".app-menu-trigger:visible").first().click();
  await a.locator("#rectangle").click();
  await b.waitForFunction(() => window.design.getDocument().pages[0].nodes.length === 4);
  assert.equal((await b.evaluate(() => window.design.getDocument())).pages[0].nodes.length, 4);
  await b.evaluate(() => window.design.addNode("text"));
  await a.waitForFunction(() => window.design.getDocument().pages[0].nodes.length === 5);
  // Restart the server to force socket reconnects without losing the document.
  options.port = Number(new URL(server).port);
  await mf.setOptions(options);
  await b.waitForFunction(
    () => document.getElementById("cloud-presence").textContent === "2 connected",
  );
  await b.locator(".app-menu-trigger:visible").first().click();
  await b.locator("#rectangle").click();
  await a.waitForFunction(() => window.design.getDocument().pages[0].nodes.length === 6);
  // Simultaneous edits merge operation by operation: no conflict prompt, both clients converge.
  await a.locator(".app-menu-trigger:visible").first().click();
  await b.locator(".app-menu-trigger:visible").first().click();
  await Promise.all([a.locator("#rectangle").click(), b.locator("#rectangle").click()]);
  await Promise.all(
    [a, b].map((page) =>
      page.waitForFunction(() => window.design.getDocument().pages[0].nodes.length === 8),
    ),
  );
  const sharedDoc = (page) =>
    page.evaluate(() => {
      const d = window.design.getDocument();
      delete d.activePage;
      return JSON.stringify(d);
    });
  await a.waitForFunction(
    (expected) => {
      const d = window.design.getDocument();
      delete d.activePage;
      return JSON.stringify(d) === expected;
    },
    await sharedDoc(b),
  );
  assert.equal(await sharedDoc(a), await sharedDoc(b));
  // Concurrent edits to different properties of one layer, and to disjoint ranges of one text, both survive.
  const textId = await a.evaluate(
    () => window.design.getDocument().pages[0].nodes.find((n) => n.type === "text").id,
  );
  const rectId = await a.evaluate(
    () => window.design.getDocument().pages[0].nodes.find((n) => n.type === "rectangle").id,
  );
  await a.evaluate((id) => window.design.updateNodes([id], { text: "Shared words" }), textId);
  await b.waitForFunction(
    (id) =>
      window.design.getDocument().pages[0].nodes.find((n) => n.id === id).text === "Shared words",
    textId,
  );
  await Promise.all([
    a.evaluate(
      ([t, r]) => {
        window.design.updateNodes([t], (n) => ({ text: n.text + "!" }));
        window.design.updateNodes([r], { x: 321 });
      },
      [textId, rectId],
    ),
    b.evaluate(
      ([t, r]) => {
        window.design.updateNodes([t], (n) => ({ text: "Our " + n.text }));
        window.design.updateNodes([r], { y: 123 });
      },
      [textId, rectId],
    ),
  ]);
  for (const page of [a, b])
    await page.waitForFunction(
      ([t, r]) => {
        const nodes = window.design.getDocument().pages[0].nodes;
        const rect = nodes.find((n) => n.id === r);
        return (
          nodes.find((n) => n.id === t).text === "Our Shared words!" &&
          rect.x === 321 &&
          rect.y === 123
        );
      },
      [textId, rectId],
    );
  assert.equal(await a.locator("#cloud-conflict").evaluate((e) => e.hidden), true);
  assert.equal(await b.locator("#cloud-conflict").evaluate((e) => e.hidden), true);
  // Undo while collaborating inverts only this client's changes, rebased over collaborators' later edits.
  const rect = (page) =>
    page.evaluate(
      (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id),
      rectId,
    );
  const both = async (fn, arg) => {
    for (const page of [a, b]) await page.waitForFunction(fn, arg);
  };
  await a.evaluate((id) => window.design.updateNodes([id], { x: 500 }), rectId);
  await both(
    (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id).x === 500,
    rectId,
  );
  await b.evaluate((id) => window.design.updateNodes([id], { y: 600 }), rectId);
  await both(
    (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id).y === 600,
    rectId,
  );
  assert.equal(await a.evaluate(() => window.design.canUndo()), true);
  await a.evaluate(() => window.design.runCommand("edit.undo"));
  await both((id) => {
    const n = window.design.getDocument().pages[0].nodes.find((n) => n.id === id);
    return n.x === 321 && n.y === 600;
  }, rectId);
  await a.evaluate(() => window.design.runCommand("edit.redo"));
  await both((id) => {
    const n = window.design.getDocument().pages[0].nodes.find((n) => n.id === id);
    return n.x === 500 && n.y === 600;
  }, rectId);
  await a.evaluate((id) => window.design.updateNodes([id], { w: 111 }), rectId);
  await both(
    (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id).w === 111,
    rectId,
  );
  await b.evaluate((id) => window.design.updateNodes([id], { w: 222 }), rectId);
  await both(
    (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id).w === 222,
    rectId,
  );
  await a.evaluate(() => window.design.runCommand("edit.undo"));
  await a.waitForFunction(() =>
    document.getElementById("cloud-status").textContent.includes("nothing to undo"),
  );
  assert.equal((await rect(a)).w, 222);
  assert.equal((await rect(b)).w, 222);
  await a.evaluate(
    (id) => window.design.updateNodes([id], (n) => ({ text: n.text + " A" })),
    textId,
  );
  await both(
    (id) =>
      window.design.getDocument().pages[0].nodes.find((n) => n.id === id).text ===
      "Our Shared words! A",
    textId,
  );
  await b.evaluate(
    (id) => window.design.updateNodes([id], (n) => ({ text: "B " + n.text })),
    textId,
  );
  await both(
    (id) =>
      window.design.getDocument().pages[0].nodes.find((n) => n.id === id).text ===
      "B Our Shared words! A",
    textId,
  );
  await a.evaluate(() => window.design.runCommand("edit.undo"));
  await both(
    (id) =>
      window.design.getDocument().pages[0].nodes.find((n) => n.id === id).text ===
      "B Our Shared words!",
    textId,
  );
  assert.deepEqual([(await rect(a)).x, (await rect(b)).y], [500, 600]);
  assert.equal(await sharedDoc(a), await sharedDoc(b));
  const loser = a;
  await openSharedDesign(loser);
  await loser.locator("#cloud-publish").click();
  await loser.waitForFunction(() =>
    document.getElementById("cloud-public").textContent.includes("public="),
  );
  const publicLink = await loser.locator("#cloud-public").textContent();
  const publicId = new URLSearchParams(new URL(publicLink).hash.slice(1)).get("public");
  assert.equal((await fetch(server + "/api/public/" + publicId)).status, 200);
  await loser.locator("#cloud-unpublish").click();
  await loser.waitForFunction(() =>
    document.getElementById("cloud-status").textContent.includes("removed"),
  );
  assert.equal((await fetch(server + "/api/public/" + publicId)).status, 404);
  // Servers without operation support (the previous Worker) keep the snapshot protocol: simultaneous edits retain the losing client's work and require explicit resolution.
  const legacyOptions = await cloudOptions(path.join(dir, "legacy"));
  const legacyConfig = legacyOptions.workers[0].config;
  legacyConfig.manifest = {
    mainModule: "worker.js",
    modules: {
      "worker.js": {
        type: "esm",
        contents: await fs.readFile(
          new URL("./fixtures/cloud-worker-v1.js", import.meta.url),
          "utf8",
        ),
      },
    },
  };
  legacyConfig.env = {
    ROOM_CREATION: legacyConfig.env.ROOM_CREATION,
    ROOMS: legacyConfig.env.ROOMS,
  };
  legacyConfig.exports = { DesignRoom: { type: "durable-object", storage: "sqlite" } };
  legacyMf = new Workerd(legacyOptions);
  const legacyServer = (await legacyMf.ready).origin;
  const panel = (page, open) =>
    page.evaluate((open) => {
      const d = document.getElementById("cloud-dialog");
      if (open && !d.open) d.showModal();
      if (!open && d.open) d.close();
    }, open);
  await panel(a, true);
  await a.locator("#cloud-leave").click();
  await a.locator("#cloud-server").fill(legacyServer);
  await a.locator("#cloud-create").click();
  await a.waitForFunction(
    (server) =>
      document.getElementById("cloud-invite").value.startsWith(server) &&
      document.getElementById("cloud-invite").value.includes("token="),
    legacyServer,
  );
  const legacyInvite = await a.locator("#cloud-invite").inputValue();
  await panel(b, true);
  await b.locator("#cloud-invite").fill(legacyInvite);
  await b.locator("#cloud-connect").click();
  await b.waitForFunction(() =>
    document.getElementById("cloud-status").textContent.includes("Connected"),
  );
  await a.waitForFunction(
    () => document.getElementById("cloud-presence").textContent === "2 connected",
  );
  await panel(a, false);
  await panel(b, false);
  await a.locator(".app-menu-trigger:visible").first().click();
  await b.locator(".app-menu-trigger:visible").first().click();
  await Promise.all([a.locator("#rectangle").click(), b.locator("#rectangle").click()]);
  await Promise.race([
    a.waitForFunction(() => !document.getElementById("cloud-conflict").hidden),
    b.waitForFunction(() => !document.getElementById("cloud-conflict").hidden),
  ]);
  const legacyLoser = (await a.locator("#cloud-conflict").evaluate((e) => !e.hidden)) ? a : b;
  await panel(legacyLoser, true);
  await legacyLoser.locator("#cloud-reload").click();
  await legacyLoser.waitForFunction(() => document.getElementById("cloud-conflict").hidden);
  console.log(
    "PASS two Electron clients: production server prefilled on a fresh profile but blocked in automated runs, file-origin CORS, editor invite links (owner token private, joiner without owner powers, viewer choice, copy), invite join, presence/cursors, bidirectional sync, server-restart reconnect, operation merge without conflicts (layers, properties, text ranges), local-only undo/redo rebased over remote edits, publish/unpublish, legacy-server conflict retention/resolution",
  );
} finally {
  await Promise.all(apps.map((app) => app.close()));
  await mf.dispose();
  await legacyMf?.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
