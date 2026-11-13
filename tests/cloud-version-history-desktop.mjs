// Version history in a shared room with two desktop clients (docs/version-history.md): the room
// captures each editor's work when another editor (a collaborator, an agent edit marked by the
// client's batch actor) takes over; the panel lists the room's versions; Restore runs through the
// client's operation queue (web/cloud-panel.js) so both clients converge, stores the replaced
// state first, and collaborative undo reverts it.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "@playwright/test";
import { openSharedDesign } from "./helpers/shared-design.cjs";

process.env.VERSION_IDLE_MS ||= "60000";
const { Miniflare, cloudOptions } = await import("./cloud-harness.mjs");
const { moveOffCursor } = createRequire(import.meta.url)("./helpers/off-cursor.cjs");
const { waitForUiReady } = createRequire(import.meta.url)("./helpers/ui-ready.cjs");

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-history-desktop-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
const apps = [];
try {
  const server = (await mf.ready).origin;
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1", VERYNIZE_CLOUD_SERVER: server };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const label of ["a", "b"])
    apps.push(
      await electron.launch({ env, args: [".", `--user-data-dir=${path.join(dir, label)}`] }),
    );
  const [a, b] = await Promise.all(apps.map((app) => app.firstWindow()));
  await Promise.all(apps.map(moveOffCursor));
  await Promise.all([a, b].map((page) => waitForUiReady(page)));
  const errors = [];
  for (const page of [a, b]) page.on("pageerror", (error) => errors.push(error.message));

  // Alice creates a room holding one artboard; Bob joins with the editor invite.
  await a.evaluate(() => {
    const doc = window.design.getDocument();
    doc.pages = [
      {
        id: "p1",
        name: "Page 1",
        nodes: [
          {
            id: "art",
            name: "Hero",
            type: "frame",
            x: 0,
            y: 0,
            w: 480,
            h: 320,
            color: "#ffffff",
            layout: "free",
          },
          {
            id: "title",
            name: "Title",
            type: "text",
            parentId: "art",
            x: 40,
            y: 40,
            w: 300,
            h: 40,
            text: "Start",
            fontSize: 24,
            color: "#111111",
          },
        ],
      },
    ];
    doc.activePage = "p1";
    window.design.setDocument(doc);
  });
  await a.waitForFunction((s) => document.getElementById("cloud-server").value === s, server);
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
  for (const [page, name] of [
    [a, "Alice"],
    [b, "Bob"],
  ]) {
    await page.locator("#cloud-name").fill(name);
    await page.locator("#cloud-name").press("Tab");
    await page.evaluate(() => document.getElementById("cloud-dialog")?.close());
  }
  await b.waitForFunction(() =>
    window.design.getDocument().pages[0].nodes.some((n) => n.id === "title"),
  );
  assert.equal(await a.evaluate(() => window.versionHistory.target().kind), "room");

  const titleOf = (page) =>
    page.evaluate(
      () => window.design.getDocument().pages[0].nodes.find((n) => n.id === "title")?.text,
    );
  const both = async (text) => {
    for (const page of [a, b])
      await page.waitForFunction(
        (t) => window.design.getDocument().pages[0].nodes.find((n) => n.id === "title")?.text === t,
        text,
      );
  };
  const synced = (page) =>
    page.waitForFunction(() => window.cloudWorkspace.pendingCount() === 0, null, {
      timeout: 10000,
    });
  const versions = (page) => page.evaluate(() => window.versionHistory.list("art"));

  // Alice, then Bob, then an agent edit from Alice's client (its batch names the agent).
  await a.evaluate(() => window.design.updateNodes(["title"], { text: "Alice" }));
  await both("Alice");
  await b.evaluate(() => window.design.updateNodes(["title"], { text: "Bob" }));
  await both("Bob");
  await synced(b);
  await a.evaluate(() =>
    window.versionHistory.as({ kind: "agent", name: "Claude" }, () =>
      window.design.updateNodes(["title"], { text: "Agent" }),
    ),
  );
  await both("Agent");
  await synced(a);
  let list = await versions(b);
  assert.deepEqual(
    list.map((v) => [v.author.kind, v.reason]),
    [
      ["user", "switch"],
      ["user", "switch"],
    ],
    JSON.stringify(list),
  );
  const [bobVersion, aliceVersion] = list;
  // Bob's version is Bob's work, stored when the agent took over.
  assert.equal(bobVersion.author.name, "Bob");

  // The panel on Bob's client shows the room's versions; Restore goes through the op queue.
  await b.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("bd:open-version-history", { detail: { artboardId: "art" } }),
    ),
  );
  const panel = b.locator("#version-history");
  await panel.waitFor();
  assert.equal(await panel.getAttribute("data-target"), "room");
  await b.waitForFunction(
    () => document.querySelectorAll("#version-history li[data-version]").length === 2,
  );
  await panel.locator(`[data-version-restore="${aliceVersion.id}"]`).click();
  await both("Alice");
  await synced(b);
  assert.equal(
    JSON.stringify(await a.evaluate(() => window.design.getDocument().pages)),
    JSON.stringify(await b.evaluate(() => window.design.getDocument().pages)),
  );
  list = await versions(a);
  assert.equal(list[0].reason, "restore", "the replaced state is stored first");
  assert.equal(list[0].author.name, "Bob");
  const replaced = await a.evaluate((id) => window.versionHistory.get(id), list[0].id);
  assert.equal(replaced.snapshot.nodes.find((n) => n.id === "title").text, "Agent");

  // Collaborative undo on Bob's client reverts the restore for everyone.
  await b.evaluate(() => window.design.runCommand("edit.undo"));
  await both("Agent");
  assert.equal(await titleOf(a), "Agent");

  assert.deepEqual(errors, []);
  console.log(
    "PASS room version history on desktop: collaborator and agent captures by the room, panel lists room versions, restore through the op queue converges both clients and stores the replaced state, undo reverts it",
  );
} finally {
  await Promise.all(apps.map((app) => app.close().catch(() => {})));
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
