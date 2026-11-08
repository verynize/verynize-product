// Collaboration UX with three signed-in Electron clients against local workerd (design/wonder/share-audit/CONTRACT.md
// §3 "C"), end to end with no stubbed server answers: the owner invites from the Share popover (Editor, then Viewer),
// the invitees open the copied `<server>/#room=<id>` link and get "You have an invitation" (Maybe later keeps it,
// Decline drops it, Join opens the file with the invited role), two editors co-edit live both ways, presence avatars +
// the Multiplayer tools popover ("Find someone...", "You’re the only one here.", "(you)", Follow, Hide cursors /
// Appear busy / Go invisible), account-named cursors in a per-person colour, remote selection outlines, viewer
// read-only (Move/Hand only, inert Delete/drag/keys/inspector, "View only"), the removal notice and the no-access screen.
// SHARE_COLLAB_SHOTS=<dir> saves 1440×870 @2× screenshots there.
import { _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, cloudOptions, passwordUser } from "./cloud-harness.mjs";

const require = createRequire(import.meta.url);
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");

const SHOTS = process.env.SHARE_COLLAB_SHOTS || "";
const PASSWORD = "a long enough password";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-share-collab-"));
const options = await cloudOptions(path.join(dir, "state"));
const mf = new Miniflare(options);
const apps = [];
const dialogs = [];

async function shot(page, name) {
  if (!SHOTS) return;
  await fs.mkdir(SHOTS, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, name) });
}

try {
  const server = (await mf.ready).origin;
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1", VERYNIZE_CLOUD_SERVER: server };
  delete env.ELECTRON_RUN_AS_NODE;
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
  const owner = await passwordUser(server, "owner@example.test", "Adam Owner", fetch, "192.0.2.40");
  await passwordUser(server, "other@example.test", "Olive Other", fetch, "192.0.2.41");
  await passwordUser(server, "viewer@example.test", "Vera Viewer", fetch, "192.0.2.42");
  const ownerMe = await api("/api/me", owner);
  const room = await api("/api/rooms", owner, {
    document: {
      version: 2,
      name: "Sunbird",
      activePage: "p1",
      pages: [
        {
          id: "p1",
          name: "Page 1",
          nodes: [
            {
              id: "card",
              type: "rectangle",
              name: "Card",
              x: 120,
              y: 140,
              w: 260,
              h: 180,
              color: "#ffffff",
            },
            {
              id: "note",
              type: "rectangle",
              name: "Note",
              x: 520,
              y: 220,
              w: 180,
              h: 140,
              color: "#ffffff",
            },
          ],
        },
      ],
      tokens: {},
    },
    organizationId: ownerMe.personalOrganizationId,
  });
  const outbox = async (email) =>
    (await api(`/api/dev/outbox?to=${encodeURIComponent(email)}`)).messages.filter((m) =>
      /invit/i.test(m.subject),
    );

  async function launch(label, email) {
    const app = await electron.launch({
      env,
      args: [
        ".",
        "--force-device-scale-factor=2",
        "--force-color-profile=srgb",
        `--user-data-dir=${path.join(dir, label)}`,
      ],
      timeout: 30000,
    });
    apps.push(app);
    const page = await app.firstWindow({ timeout: 30000 });
    await moveOffCursor(app);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 870),
    );
    await waitForUiReady(page);
    await page.waitForFunction(
      () => !!window.cloudWorkspace && !!window.cloudLinks && !!window.cloudPresence,
    );
    page.on("dialog", (dialog) => {
      dialogs.push(`${label}: ${dialog.message()}`);
      void dialog.dismiss();
    });
    await page.evaluate(
      ({ server, email, password }) => window.cloudAccount.signIn({ server, email, password }),
      {
        server,
        email,
        password: PASSWORD,
      },
    );
    return { app, page };
  }
  const A = await launch("a", "owner@example.test");
  const B = await launch("b", "other@example.test");
  const C = await launch("c", "viewer@example.test");
  const [a, b, c] = [A.page, B.page, C.page];
  const openLink = (page, href) =>
    page.evaluate(async (href) => {
      window.cloudLinks.open(href);
      for (let i = 0; i < 200 && !window.cloudWorkspace.room(); i++)
        await new Promise((r) => setTimeout(r, 50));
    }, href);
  const inRoom = (page) =>
    page.waitForFunction(
      (id) =>
        window.cloudWorkspace.room()?.id === id &&
        !document.body.classList.contains("files-view") &&
        /Connected|Synced/.test(document.getElementById("cloud-status").textContent),
      room.id,
      { timeout: 30000 },
    );
  const focusWindow = (app) =>
    app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.isVisible());
      win.show();
      win.focus();
    });

  // 1. A file link opens the file in the editor, without confirm(); alone, the popover says so.
  await openLink(a, `${server}/#room=${room.id}`);
  await inRoom(a);
  assert.equal(await a.evaluate(() => window.design.getDocument().name), "Sunbird");
  const tools = (page) => page.locator("#presence-tools");
  await tools(a).waitFor();
  assert.equal(await tools(a).getAttribute("aria-label"), "Multiplayer tools");
  await tools(a).click();
  const popover = (page) => page.locator("#presence-popover");
  await popover(a).waitFor();
  assert.equal(await a.locator("#presence-search").getAttribute("placeholder"), "Find someone...");
  assert.match(await popover(a).innerText(), /You’re the only one here\./);
  assert.match(await a.locator("[data-self]").innerText(), /Adam Owner\s*\(you\)/);
  assert.equal(await a.locator("[data-self] [data-status='online']").count(), 1);
  for (const label of ["Hide cursors", "Appear busy", "Go invisible"])
    assert.equal(
      await a.getByRole("button", { name: label }).getAttribute("aria-pressed"),
      "false",
    );
  await shot(a, "SC1-tools.png");
  await a.keyboard.press("Escape");

  // 2. The owner invites from the Share popover and copies the link (CONTRACT §1 share-invitations).
  const invite = async (email, role) => {
    await a.locator("#cloud-toggle").click();
    await a.locator("#share-popover").waitFor();
    const emails = a.getByRole("textbox", { name: "Emails to invite" });
    await emails.pressSequentially(`${email},`);
    await a.locator(`[data-email-chip="${email}"]:not([data-invalid])`).waitFor();
    await a.getByRole("button", { name: "Member role" }).click();
    await a.locator(`#share-role-menu [data-role="${role}"]`).click();
    await a.locator("#share-invite").click();
    const sent = a.locator("[data-share-toast]", { hasText: "Invitation sent" });
    await sent.waitFor({ timeout: 15000 });
    await sent.getByRole("button", { name: "Dismiss" }).click();
    await sent.waitFor({ state: "detached" });
    await a.keyboard.press("Escape");
    await a.locator("#share-popover").waitFor({ state: "detached" });
  };
  await invite("other@example.test", "editor");
  assert.equal((await outbox("other@example.test")).length, 1, "one invitation email");
  await focusWindow(A.app);
  await a.locator("#cloud-toggle").click();
  await a.locator("#share-copy-link").click();
  await a.locator("[data-share-toast]", { hasText: "Link copied to clipboard." }).waitFor();
  const link = await A.app.evaluate(({ clipboard }) => clipboard.readText());
  assert.equal(link, `${server}/#room=${room.id}`, "the copied link carries no token");
  await a.keyboard.press("Escape");
  await a.locator("#share-popover").waitFor({ state: "detached" });

  // 3. The invitee opens the copied link: the invitation, Maybe later keeps it, Join opens the file as Editor.
  const invitation = (page) => page.locator("#room-invitation");
  const expectInvitation = async (page, role) => {
    await invitation(page).waitFor({ timeout: 15000 });
    const text = await invitation(page).innerText();
    for (const expected of [
      "You have an invitation",
      "Join to work with your team in a shared workspace.",
      "Adam Owner's workspace",
      `Adam Owner invited you as ${role}`,
      "Decline",
      "Join",
      "Maybe later",
    ])
      assert.ok(text.includes(expected), `invitation shows “${expected}” in: ${text}`);
  };
  await openLink(b, link);
  await expectInvitation(b, "Editor");
  await shot(b, "SC5-invitation.png");
  await b.locator("#room-invitation-later").click();
  await invitation(b).waitFor({ state: "detached" });
  await b.waitForFunction(() => document.body.classList.contains("files-view"));
  assert.notEqual(
    await b.evaluate(() => window.cloudWorkspace.room()?.id),
    room.id,
    "Maybe later does not join the invited room; the personal design stays synced",
  );
  await openLink(b, link);
  await expectInvitation(b, "Editor");
  await b.locator("#room-invitation-join").click();
  await inRoom(b);
  await invitation(b).waitFor({ state: "detached" });
  await b.waitForFunction(() => window.cloudWorkspace.role() === "editor");
  assert.equal(await b.evaluate(() => document.body.classList.contains("cloud-read-only")), false);
  assert.equal(await b.locator("#view-only-pill").count(), 0);
  assert.equal(await b.evaluate(() => window.design.getDocument().name), "Sunbird");

  // 4. Presence: avatars, count, account names on cursors, per-person colours, remote selections.
  await a.waitForFunction(
    () => document.getElementById("presence-tools")?.dataset.presenceCount === "1",
  );
  assert.equal(await a.locator('[aria-label="1 collaborator active in this file"]').count(), 1);
  const canvasPoint = async (page, x, y) => {
    const box = await page.locator("#workspace").boundingBox();
    return { x: box.x + x, y: box.y + y };
  };
  const wiggle = async (page, x, y) => {
    const p = await canvasPoint(page, x, y);
    await page.mouse.move(p.x - 20, p.y - 10);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  };
  await wiggle(b, 420, 380);
  const cursor = a.locator(".collaborator-cursor");
  await a.waitForFunction(() =>
    /Olive Other/.test(document.querySelector(".collaborator-cursor")?.textContent || ""),
  );
  assert.doesNotMatch(await cursor.first().textContent(), /Designer/);
  const peerColor = await cursor.first().evaluate((el) => el.style.getPropertyValue("--peer"));
  assert.match(peerColor, /^var\(--peer-[1-8]\)$/);
  await b.evaluate(() => window.design.setSelection(["note"]));
  await a.locator('.collaborator-selection[data-node="note"]').waitFor({ timeout: 10000 });
  await tools(a).click();
  await popover(a).waitFor();
  assert.match(await popover(a).innerText(), /Currently viewing \(1\)/);
  const olive = a.locator("[data-person]");
  assert.match(await olive.innerText(), /Olive Other/);
  assert.equal(await olive.getAttribute("aria-label"), "Follow Olive Other");
  await a.locator("#presence-search").fill("zz");
  assert.match(await popover(a).innerText(), /No one matches “zz”/);
  await a.locator("#presence-search").fill("oli");
  assert.equal(await olive.count(), 1);
  await a.locator("#presence-search").fill("");
  await wiggle(b, 380, 330);
  await shot(a, "SC1-presence.png");

  // Follow: A's view centres on B's cursor.
  await wiggle(b, 700, 560);
  await olive.click();
  assert.equal(await olive.getAttribute("aria-pressed"), "true");
  await a.waitForFunction(() => {
    const person = window.cloudPresence.snapshot().people.find((p) => !p.self);
    const area = document.getElementById("workspace").getBoundingClientRect();
    const middle = window.design.screenToWorld(
      area.left + area.width / 2,
      area.top + area.height / 2,
    );
    return person?.cursor && Math.hypot(middle.x - person.cursor.x, middle.y - person.cursor.y) < 2;
  });
  await olive.click();
  assert.equal(await olive.getAttribute("aria-pressed"), "false");

  // Appear busy (broadcast, persisted per device), Go invisible, Hide cursors (local).
  await tools(b).click();
  await b.locator("#presence-busy").click();
  await a.locator("[data-person] [data-status='busy']").waitFor();
  assert.equal(
    await b.evaluate(() => JSON.parse(localStorage.getItem("verynize.presence")).busy),
    true,
  );
  await b.locator("#presence-busy").click();
  await a.locator("[data-person] [data-status='online']").waitFor();
  await b.locator("#presence-invisible").click();
  await a.waitForFunction(
    () => document.getElementById("presence-tools")?.dataset.presenceCount === "0",
  );
  await wiggle(b, 300, 300);
  await a.waitForTimeout(400);
  assert.equal(
    await a.locator(".collaborator-cursor").count(),
    0,
    "an invisible person draws no cursor",
  );
  assert.match(await popover(a).innerText(), /You’re the only one here\./);
  await b.locator("#presence-invisible").click();
  await b.keyboard.press("Escape");
  await a.waitForFunction(
    () => document.getElementById("presence-tools")?.dataset.presenceCount === "1",
  );
  await a.locator("#presence-hide-cursors").click();
  await wiggle(b, 350, 320);
  await a.waitForTimeout(400);
  assert.equal(await a.locator("#cloud-cursors").count(), 0, "Hide cursors draws none");
  await a.locator("#presence-hide-cursors").click();
  await a.keyboard.press("Escape");
  await a.locator(".collaborator-cursor").first().waitFor();

  // 5. Two editors co-edit live, both ways (Wonder Free allows one editor): drags and a new frame.
  const node = (page, id) =>
    page.evaluate(
      (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id) ?? null,
      id,
    );
  const drag = async (page, id, dx, dy) => {
    await page.evaluate(() => window.design.setSelection([]));
    const box = await page.locator(`#canvas .layer[data-id="${id}"]`).boundingBox();
    await page.mouse.move(box.x + 30, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 30 + dx, box.y + 30 + dy, { steps: 8 });
    await page.mouse.up();
  };
  // Each person frames the whole file (Follow above moved A's view).
  for (const page of [a, b]) await page.evaluate(() => window.design.runCommand("view.fit"));
  const cardBefore = await node(b, "card");
  await drag(a, "card", 60, 40);
  const cardAfter = await node(a, "card");
  assert.notEqual(cardAfter.x, cardBefore.x, "A moved the card");
  await b.waitForFunction(
    ({ x, y }) => {
      const card = window.design.getDocument().pages[0].nodes.find((n) => n.id === "card");
      return card.x === x && card.y === y;
    },
    cardAfter,
    { timeout: 10000 },
  );
  const noteBefore = await node(a, "note");
  await drag(b, "note", -50, 70);
  const noteAfter = await node(b, "note");
  assert.notEqual(noteAfter.y, noteBefore.y, "B moved the note");
  await a.waitForFunction(
    ({ x, y }) => {
      const note = window.design.getDocument().pages[0].nodes.find((n) => n.id === "note");
      return note.x === x && note.y === y;
    },
    noteAfter,
    { timeout: 10000 },
  );
  const countIn = (page) => page.evaluate(() => window.design.getDocument().pages[0].nodes.length);
  const nodesBefore = await countIn(a);
  await focusWindow(B.app);
  await b.evaluate(() => window.design.setSelection([]));
  await b.keyboard.press("f");
  const from = await canvasPoint(b, 760, 120);
  await b.mouse.move(from.x, from.y);
  await b.mouse.down();
  await b.mouse.move(from.x + 140, from.y + 100, { steps: 6 });
  await b.mouse.up();
  assert.equal(await countIn(b), nodesBefore + 1, "B drew a frame");
  await a.waitForFunction(
    (n) => window.design.getDocument().pages[0].nodes.length === n,
    nodesBefore + 1,
    {
      timeout: 10000,
    },
  );
  await b.keyboard.press("Escape");
  await wiggle(b, 820, 160);
  await shot(a, "SC2-edit.png");
  await shot(b, "SC2-edit-b.png");

  // 6. A Viewer invitation: Decline drops it (the link then has no access); a new one, joined, is read-only (B4).
  await focusWindow(A.app);
  await invite("viewer@example.test", "viewer");
  await openLink(c, link);
  await expectInvitation(c, "Viewer");
  await c.locator("#room-invitation-decline").click();
  await invitation(c).waitFor({ state: "detached" });
  await c.locator("[data-sonner-toast]", { hasText: "Invitation declined" }).waitFor();
  await c.waitForFunction(() => document.body.classList.contains("files-view"));
  await openLink(c, link);
  const denied = c.locator("#room-no-access[data-signed-in='true']");
  await denied.waitFor();
  assert.match(await denied.innerText(), /You don’t have access to this file/);
  await c.locator("#room-no-access-back").click();
  await denied.waitFor({ state: "detached" });
  await focusWindow(A.app);
  await invite("viewer@example.test", "viewer");
  await openLink(c, link);
  await expectInvitation(c, "Viewer");
  await c.locator("#room-invitation-join").click();
  await inRoom(c);
  await c.waitForFunction(() => window.cloudWorkspace.role() === "viewer");
  await c.waitForFunction(() => document.body.classList.contains("cloud-read-only"));
  await c.locator("#view-only-pill").waitFor();
  assert.equal(await c.locator("#view-only-pill").innerText(), "View only");
  assert.equal(
    await c
      .locator("#canvas-toolbar #add-frame, #canvas-toolbar #text, #canvas-toolbar #add-shader")
      .count(),
    0,
  );
  assert.equal(await c.locator("#canvas-toolbar #select-tool").count(), 1);
  assert.equal(await c.locator("#canvas-toolbar #pan-tool").count(), 1);
  const before = { card: await node(c, "card"), count: await countIn(c) };
  await c.locator('#canvas .layer[data-id="card"]').click();
  assert.deepEqual(
    await c.evaluate(() => window.design.getSelection()),
    ["card"],
    "viewers still select",
  );
  await c.keyboard.press("Delete");
  await c.keyboard.press("ArrowRight");
  await c.keyboard.press("f");
  assert.equal(await c.evaluate(() => window.design.getTool()), "move");
  const box = await c.locator('#canvas .layer[data-id="card"]').boundingBox();
  await c.mouse.move(box.x + 40, box.y + 40);
  await c.mouse.down();
  await c.mouse.move(box.x + 140, box.y + 120, { steps: 6 });
  await c.mouse.up();
  assert.equal(await countIn(c), before.count);
  assert.deepEqual(await node(c, "card"), before.card, "delete, nudge and drag are inert");
  assert.equal(
    await c.evaluate(() =>
      [...document.querySelector("#bd-inspector-root > div").children]
        .slice(1)
        .every((el) => el.inert),
    ),
    true,
    "the inspector body is inert",
  );
  assert.equal(await c.evaluate(() => window.design.runCommand("edit.delete")), false);
  await shot(c, "SC3-viewer.png");
  // The viewer still receives the editors' edits live.
  await drag(b, "note", 40, 0);
  const moved = await node(b, "note");
  await c.waitForFunction(
    (x) => window.design.getDocument().pages[0].nodes.find((n) => n.id === "note").x === x,
    moved.x,
    { timeout: 10000 },
  );

  // 7. Removal from the workspace while connected (B5): a notice on the canvas, the file detaches.
  await api("/api/auth/organization/remove-member", owner, {
    organizationId: ownerMe.personalOrganizationId,
    memberIdOrEmail: "viewer@example.test",
  });
  const toast = c.locator("[data-sonner-toast]", {
    hasText: "You no longer have access to “Sunbird”",
  });
  await toast.waitFor({ timeout: 15000 });
  await c.waitForFunction(() => !window.cloudWorkspace.isConnected());
  assert.equal(await c.evaluate(() => document.body.classList.contains("cloud-read-only")), false);
  await shot(c, "SC4-removed.png");

  // 8. Opening the link again without access: the no-access screen.
  await openLink(c, link);
  await denied.waitFor();
  assert.match(await denied.innerText(), /You don’t have access to this file/);
  assert.match(await denied.innerText(), /Sign in with another account/);
  await shot(c, "SC4-no-access.png");
  await c.locator("#room-no-access-back").click();
  await c.waitForFunction(() => document.body.classList.contains("files-view"));
  assert.equal(await denied.count(), 0);

  assert.deepEqual(dialogs, [], "no native dialogs");
  console.log(
    "PASS share collaboration: Share popover invites (Editor, Viewer) → copied link → in-app invitation (Maybe later, Decline, Join), two editors co-editing both ways, presence avatars + Multiplayer tools (only one here, (you), search, Follow, busy, invisible, hide cursors), account-named per-person cursors, remote selections, viewer read-only (Move/Hand, inert delete/nudge/drag/keys/inspector, View only) and live, workspace removal notice, no-access screen",
  );
} finally {
  for (const app of apps) await app.close().catch(() => {});
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
