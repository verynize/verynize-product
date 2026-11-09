// Undo across a collaborator's edit and after leaving the room (web/app.js `applyRemote`, web/cloud-panel.js
// `cloudHistory`): two Electron clients in one room on a local workerd.
// Local undo entries address layers by position in the page. A collaborator deleting a layer shifts the positions
// after it, so A's local entries are dropped when the remote patch lands; while connected, A's undo goes through the
// room history (by layer id, on A, B and the server). After A leaves the room nothing is left to undo locally, and
// pressing undo there writes into no layer (an old positional entry would recolour the layer that took Y's place).
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";
import { _electron as electron } from "@playwright/test";
import { openSharedDesign } from "./helpers/shared-design.cjs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { moveOffCursor } = createRequire(import.meta.url)("./helpers/off-cursor.cjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-undo-leave-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
const apps = [];
try {
  const server = (await mf.ready).origin;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  env.VERYNIZE_CLOUD_SERVER = server;
  for (const label of ["a", "b"])
    apps.push(
      await electron.launch({ env, args: [".", `--user-data-dir=${path.join(dir, label)}`] }),
    );
  const [a, b] = await Promise.all(apps.map((app) => app.firstWindow()));
  await Promise.all(apps.map(moveOffCursor));
  await Promise.all([a, b].map((page) => page.waitForFunction(() => !!window.design)));
  await a.waitForFunction((s) => document.getElementById("cloud-server").value === s, server);

  // Three layers X, Y, Z (in that order) on A, before the room exists.
  const ids = await a.evaluate(() => {
    const d = window.design;
    d.setSelection(d.getDocument().pages[0].nodes.map((n) => n.id));
    d.runCommand("edit.delete");
    const make = (name, x, color) => {
      const id = d.addNode("rectangle", { name, x, y: 160, w: 120, h: 80, color });
      d.setSelection([]);
      return id;
    };
    return {
      X: make("X", 100, "#ff0000"),
      Y: make("Y", 300, "#00ff00"),
      Z: make("Z", 500, "#0000ff"),
    };
  });

  await openSharedDesign(a);
  await a.locator("#cloud-create").click();
  await a.waitForFunction(() => document.getElementById("cloud-invite").value.includes("token="));
  const invite = await a.locator("#cloud-invite").inputValue();
  b.on("dialog", (dialog) => dialog.accept(dialog.type() === "prompt" ? invite : undefined));
  await openSharedDesign(b);
  await b.locator("#cloud-invite").fill(invite);
  await b.locator("#cloud-connect").click();
  await b.waitForFunction(() =>
    document.getElementById("cloud-status").textContent.includes("Connected"),
  );
  await a.waitForFunction(
    () => document.getElementById("cloud-presence").textContent === "2 connected",
  );
  for (const page of [a, b]) await page.locator("#cloud-close").click();

  const layers = (page) =>
    page.evaluate(() =>
      window.design
        .getDocument()
        .pages[0].nodes.map((n) => ({ id: n.id, name: n.name, color: n.color })),
    );
  const colors = (page) =>
    page.evaluate(() =>
      Object.fromEntries(window.design.getDocument().pages[0].nodes.map((n) => [n.name, n.color])),
    );
  const colorsAre = (page, expected) =>
    page.waitForFunction(
      (expected) =>
        JSON.stringify(
          Object.fromEntries(
            window.design.getDocument().pages[0].nodes.map((n) => [n.name, n.color]),
          ),
        ) === JSON.stringify(expected),
      expected,
      { timeout: 10_000 },
    );
  const saved = (page) =>
    page.waitForFunction(() =>
      /Saved shared revision/.test(document.getElementById("cloud-status").textContent),
    );
  await colorsAre(b, { X: "#ff0000", Y: "#00ff00", Z: "#0000ff" });

  // A recolours Y: a local undo entry for the layer at position 1, and a room history step.
  await a.evaluate((id) => window.design.updateNodes([id], { color: "#ffcc00" }), ids.Y);
  await colorsAre(b, { X: "#ff0000", Y: "#ffcc00", Z: "#0000ff" });
  await saved(a);

  // B deletes X: on A, Z moves to position 1.
  await b.evaluate((id) => {
    window.design.setSelection([id]);
    window.design.runCommand("edit.delete");
  }, ids.X);
  await colorsAre(a, { Y: "#ffcc00", Z: "#0000ff" });
  assert.deepEqual(
    (await layers(a)).map((n) => n.id),
    [ids.Y, ids.Z],
  );

  // Connected: undo is the room's and reverts Y by id, everywhere.
  assert.equal(await a.evaluate(() => window.cloudHistory.active()), true);
  assert.equal(await a.evaluate(() => window.design.canUndo()), true);
  await a.evaluate(() => window.design.runCommand("edit.undo"));
  for (const page of [a, b]) await colorsAre(page, { Y: "#00ff00", Z: "#0000ff" });
  const roomId = new URLSearchParams(new URL(invite).hash.slice(1)).get("room");
  const token = await a.evaluate(
    () => window.fileLibrary.cloudOf(window.fileLibrary.currentId).token,
  );
  const serverColors = async () => {
    const r = await fetch(`${server}/api/rooms/${roomId}`, {
      headers: { authorization: "Bearer " + token },
    });
    const { document } = await r.json();
    return Object.fromEntries(document.pages[0].nodes.map((n) => [n.name, n.color]));
  };
  let onServer;
  for (let tries = 0; tries < 50; tries++) {
    onServer = await serverColors();
    if (onServer.Y === "#00ff00") break;
    await sleep(200);
  }
  assert.deepEqual(
    onServer,
    { Y: "#00ff00", Z: "#0000ff" },
    "server: the room undo reverted Y only",
  );

  // A leaves the room: the local history holds nothing from before the collaborator's edit.
  await openSharedDesign(a);
  await a.locator("#cloud-leave").click();
  await a.waitForFunction(() => !window.cloudHistory.active());
  await a.locator("#cloud-close").click();
  const before = await layers(a);
  assert.equal(await a.evaluate(() => window.design.canUndo()), false, "no local undo left");
  await a.evaluate(() => window.design.runCommand("edit.undo"));
  await a.waitForTimeout(300);
  assert.deepEqual(await layers(a), before, "undo after leaving writes into no layer");
  assert.deepEqual(await colors(a), { Y: "#00ff00", Z: "#0000ff" });

  // A local edit after leaving still undoes, on the right layer.
  await a.evaluate((id) => window.design.updateNodes([id], { color: "#123456" }), ids.Z);
  assert.equal(await a.evaluate(() => window.design.canUndo()), true);
  await a.evaluate(() => window.design.runCommand("edit.undo"));
  await colorsAre(a, { Y: "#00ff00", Z: "#0000ff" });
  console.log(
    "PASS undo across a collaborator's edit: local entries dropped on the remote patch, the room history undoes by id while connected, and undo after leaving writes into no layer",
  );
} finally {
  await Promise.all(apps.map((app) => app.close()));
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
