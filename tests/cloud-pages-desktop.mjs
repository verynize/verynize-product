// Lazy pages in shared rooms, with two real Electron clients and the real room server
// (web/page-loader.js, web/cloud-panel.js, cloud/room-store.js). A multi-page room is joined with
// only its active page; switching pages shows a loading state and fetches the page; edits a
// collaborator makes on a page this client has not loaded, and edits made here while a page is
// still loading, are all kept; whole-document features load every page first; and a page that
// cannot load while the room is unreachable says so.
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";
import { _electron as electron } from "@playwright/test";
import { openSharedDesign } from "./helpers/shared-design.cjs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { moveOffCursor } = createRequire(import.meta.url)("./helpers/off-cursor.cjs");
const SHOTS = process.env.VERYNIZE_SHOTS || null;
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-cloud-pages-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
const rect = (id, extra = {}) => ({
  id,
  type: "rectangle",
  name: id,
  x: 40,
  y: 40,
  w: 120,
  h: 80,
  color: "#7c5cff",
  ...extra,
});
const page = (id, name, nodes) => ({ id, name, nodes });
const roomDocument = {
  version: 2,
  name: "Lazy pages",
  activePage: "p1",
  tokens: {},
  pages: [
    page("p1", "Cover", [rect("cover-a"), rect("cover-b", { x: 220 })]),
    page("p2", "Screens", [
      rect("screen-a"),
      rect("screen-b", { y: 200 }),
      rect("screen-c", { x: 300 }),
    ]),
    page("p3", "Flows", [rect("flow-a"), rect("flow-b", { x: 260 })]),
    page("p4", "Archive", [rect("archive-a")]),
    page("p5", "Notes", [rect("notes-a")]),
    page("p6", "Trash", [rect("trash-a"), rect("trash-b", { x: 300 })]),
  ],
};
const apps = [];
let disposed = false;
try {
  const server = (await mf.ready).origin;
  const created = await (
    await fetch(server + "/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: roomDocument }),
    })
  ).json();
  const invite = `${server}/#room=${created.id}&token=${created.token}`;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  for (const label of ["a", "b"])
    apps.push(
      await electron.launch({ env, args: [".", `--user-data-dir=${path.join(dir, label)}`] }),
    );
  let [a, b] = await Promise.all(apps.map((app) => app.firstWindow()));
  await Promise.all(apps.map(moveOffCursor));
  await Promise.all(
    [a, b].map((p) => p.waitForFunction(() => !!window.design && !!window.pageLoader)),
  );
  // b loads pages only on demand; a keeps the default background prefetch.
  await b.evaluate(() => localStorage.setItem("verynize.pages.prefetch", "off"));
  const join = async (p) => {
    p.on("dialog", (dialog) => dialog.accept(dialog.type() === "prompt" ? invite : undefined));
    await openSharedDesign(p);
    await p.locator("#cloud-invite").fill(invite);
    await p.locator("#cloud-connect").click();
    await p.waitForFunction(() =>
      document.getElementById("cloud-status").textContent.includes("Connected"),
    );
    await p.locator("#cloud-close").click();
  };
  const pages = (p) => p.evaluate(() => window.cloudWorkspace.pages());
  const nodesOf = (p, id) =>
    p.evaluate(
      (id) =>
        window.design
          .getDocument()
          .pages.find((x) => x.id === id)
          ?.nodes.map((n) => n.id),
      id,
    );
  const show = (p, id) =>
    p.evaluate((id) => {
      const view = window.design.getView();
      window.design.setView({ ...view, page: id });
      return !document.getElementById("page-loading").hidden;
    }, id);

  // ---- joining loads the active page only --------------------------------------------------
  await join(b);
  await b.waitForFunction(() => window.cloudWorkspace.pages().unloaded.length === 5);
  assert.deepEqual((await pages(b)).unloaded.sort(), ["p2", "p3", "p4", "p5", "p6"]);
  assert.deepEqual(await nodesOf(b, "p1"), ["cover-a", "cover-b"]);
  assert.deepEqual(await nodesOf(b, "p2"), [], "unloaded pages are stubs");
  assert.deepEqual(
    await b.evaluate(() => window.design.getDocument().pages.map((p) => p.name)),
    ["Cover", "Screens", "Flows", "Archive", "Notes", "Trash"],
    "the page list is complete before the pages load",
  );
  assert.equal(await b.locator("#page-loading").isHidden(), true);
  if (SHOTS) await b.screenshot({ path: path.join(SHOTS, "lazy-pages-before.png") });

  // a joins and prefetches every page after idle.
  await join(a);
  await a.waitForFunction(() => window.cloudWorkspace.pages().unloaded.length === 0, null, {
    timeout: 15000,
  });
  assert.deepEqual(await nodesOf(a, "p3"), ["flow-a", "flow-b"]);

  // ---- a collaborator edits a page b has not loaded ----------------------------------------
  await show(a, "p3");
  await a.evaluate(() => {
    window.design.updateNodes(["flow-a"], { x: 333 });
    window.design.addNode("rectangle");
  });
  await a.waitForFunction(() => window.cloudWorkspace.pendingCount() === 0);
  const aFlow = await nodesOf(a, "p3");
  assert.equal(aFlow.length, 3);
  // b received those operations but holds no nodes for p3 yet.
  await b.waitForFunction(() =>
    document.getElementById("cloud-status").textContent.includes("Synced"),
  );
  assert.deepEqual(await nodesOf(b, "p3"), []);
  assert.ok((await pages(b)).unloaded.includes("p3"));

  // ---- switching pages shows the loading state and fetches the page ------------------------
  assert.equal(await show(b, "p2"), true, "an unloaded page shows the loading overlay");
  await b.waitForFunction(() => !window.cloudWorkspace.pages().unloaded.includes("p2"));
  assert.deepEqual(await nodesOf(b, "p2"), ["screen-a", "screen-b", "screen-c"]);
  await b.waitForFunction(() => document.getElementById("page-loading").hidden);
  assert.ok((await pages(b)).unloaded.includes("p3"), "other pages stay unloaded");

  // ---- an edit made here while the page loads waits for it, then merges with remote edits --
  const during = await b.evaluate(() => {
    const view = window.design.getView();
    window.design.setView({ ...view, page: "p3" });
    const id = window.design.addNode("text", { text: "Added while loading" });
    return { id, deferred: window.cloudWorkspace.pages().deferred };
  });
  assert.ok(during.deferred >= 1, "the edit on the loading page is held");
  await b.waitForFunction(() => !window.cloudWorkspace.pages().unloaded.includes("p3"));
  await b.waitForFunction(() => window.cloudWorkspace.pendingCount() === 0);
  const bFlow = await nodesOf(b, "p3");
  for (const id of aFlow) assert.ok(bFlow.includes(id), `b sees a's layer ${id}`);
  assert.equal(bFlow.length, 4, "b keeps its own layer as well");
  assert.equal(
    await b.evaluate(
      () =>
        window.design
          .getDocument()
          .pages.find((p) => p.id === "p3")
          .nodes.find((n) => n.id === "flow-a").x,
    ),
    333,
  );
  await a.waitForFunction(
    (count) => window.design.getDocument().pages.find((p) => p.id === "p3").nodes.length === count,
    bFlow.length,
  );
  assert.deepEqual(await nodesOf(a, "p3"), bFlow);
  assert.equal((await pages(b)).deferred, 0);

  // Undo on b removes only b's own layer; a's edits on that page stay.
  await b.evaluate(() => window.design.runCommand("edit.undo"));
  await a.waitForFunction(
    () => window.design.getDocument().pages.find((p) => p.id === "p3").nodes.length === 3,
  );
  assert.deepEqual(await nodesOf(b, "p3"), aFlow);

  // ---- deleting a page that has not loaded waits for it, so undo restores its layers ------
  const removal = await b.evaluate(() => {
    window.design.setActivePage("p6");
    document.getElementById("delete-page").click(); // the Pages sidebar's Delete runs this
    return {
      pages: window.design.getDocument().pages.map((p) => p.id),
      state: window.cloudWorkspace.pages(),
    };
  });
  assert.equal(removal.pages.includes("p6"), false, "the page disappears at once");
  assert.equal(removal.state.deferred, 1, "its removal waits for the page");
  assert.ok(removal.state.requested.includes("p6"));
  await a.waitForFunction(() => !window.design.getDocument().pages.some((p) => p.id === "p6"));
  assert.equal((await pages(b)).deferred, 0);
  await b.evaluate(() => window.design.runCommand("edit.undo"));
  for (const p of [a, b])
    await p.waitForFunction(
      () =>
        window.design
          .getDocument()
          .pages.find((x) => x.id === "p6")
          ?.nodes.map((n) => n.id)
          .join() === "trash-a,trash-b",
    );

  // ---- whole-document features load the remaining pages first ------------------------------
  await b.evaluate(() => window.pageLoader.ensure(["p4"]));
  assert.deepEqual(await nodesOf(b, "p4"), ["archive-a"]);
  const shared = (p) =>
    p.evaluate(() => {
      const d = window.design.getDocument();
      delete d.activePage;
      d.pages = d.pages.filter((x) => x.id !== "p5");
      return JSON.stringify(d);
    });
  assert.equal(await shared(b), await shared(a), "both clients converge on the loaded pages");
  assert.deepEqual((await pages(b)).unloaded, ["p5"]);

  // ---- a restart keeps the loaded pages and the unloaded set (room outbox) -----------------
  await b.evaluate(() => new Promise((resolve) => setTimeout(resolve, 400))); // outbox write
  await apps[1].close();
  await show(a, "p4");
  await a.evaluate(() => window.design.updateNodes(["archive-a"], { y: 444 }));
  await a.waitForFunction(() => window.cloudWorkspace.pendingCount() === 0);
  apps[1] = await electron.launch({ env, args: [".", `--user-data-dir=${path.join(dir, "b")}`] });
  b = await apps[1].firstWindow();
  await moveOffCursor(apps[1]);
  await b.waitForFunction(
    () =>
      window.cloudWorkspace?.isConnected() &&
      document.getElementById("cloud-status").textContent.includes("Connected"),
  );
  await b.waitForFunction(
    () => window.design.getDocument().pages.find((p) => p.id === "p4")?.nodes[0]?.y === 444,
  );
  assert.deepEqual(
    (await pages(b)).unloaded,
    ["p5"],
    "pages loaded before the restart stay loaded",
  );
  assert.equal(await shared(b), await shared(a), "the restarted client catches up on loaded pages");

  // ---- a page that cannot load while the room is unreachable says so -----------------------
  await mf.dispose();
  disposed = true;
  await b.waitForFunction(() =>
    /interrupted|unavailable/.test(document.getElementById("cloud-status").textContent),
  );
  assert.equal(await show(b, "p5"), true);
  assert.match(await b.locator("#page-loading").textContent(), /when the shared room is reachable/);
  assert.deepEqual(await nodesOf(b, "p5"), []);
  if (SHOTS) await b.screenshot({ path: path.join(SHOTS, "lazy-pages-offline.png") });
  console.log(
    "PASS lazy pages: join with the active page only, loading state on page switch, remote edits on unloaded pages kept, local edits while loading held and merged, undo across the load, deleting an unloaded page then undo, ensure() before whole-document work, restart with the room outbox, offline page state",
  );
} finally {
  await Promise.all(apps.map((app) => app.close()));
  if (!disposed) await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
