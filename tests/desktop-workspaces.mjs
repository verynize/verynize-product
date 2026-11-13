// Organizations in the desktop UI (phase 3) against local workerd: the Files workspace switcher
// (personal workspace, create an organization, switch), sharing a room into the active workspace,
// Share › People & access showing and moving the room's workspace, and Settings › Members
// (invite, pending invitations, role change, default room access, invitations for you, leave).
import { Miniflare } from "miniflare";
import { _electron as electron } from "@playwright/test";
import { openSharedDesign } from "./helpers/shared-design.cjs";
import { waitForUiReady } from "./helpers/ui-ready.cjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { cloudOptions, passwordUser } from "./cloud-harness.mjs";

// Radix keeps a closing menu mounted during its exit animation; wait for it to go before reopening the
// switcher, and only click items inside the open menu (same fix as tests/inspector-type-bind.cjs).
async function switcherItem(page, id) {
  await page.locator("[role=menu][data-state=closed]").waitFor({ state: "detached" });
  await page.locator("#workspace-profile").click();
  await page.locator(`[role=menu][data-state=open] #${id}`).click();
}

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-workspaces-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
let app;
try {
  const server = (await mf.ready).origin;
  const api = (route, session, body) =>
    fetch(server + route, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-verynize-session": session },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).then(async (response) => {
      const text = await response.text();
      assert.ok(response.ok, `${route}: ${response.status} ${text}`);
      return text ? JSON.parse(text) : null;
    });
  // Ana (desktop) and Budi (API only) have verified email accounts.
  const password = "a long enough password";
  await passwordUser(server, "ana@example.test", "Ana", fetch, "192.0.2.10");
  const budi = await passwordUser(server, "budi@example.test", "Budi", fetch, "192.0.2.11");

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  app = await electron.launch({
    env,
    args: [".", `--user-data-dir=${path.join(dir, "profile")}`],
    timeout: 20000,
  });
  const page = await app.firstWindow({ timeout: 20000 });
  await waitForUiReady(page);
  await page.waitForFunction(() => !!window.cloudAccount && !!window.fileLibrary);
  page.on("dialog", (dialog) => dialog.accept());
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  const status = (text) =>
    page.waitForFunction(
      (text) => document.getElementById("cloud-status").textContent.includes(text),
      text,
    );

  // Signed out, the switcher offers sign-in.
  await page.evaluate(() => window.fileLibrary.showHome());
  await page.locator("#workspace-profile").click();
  await page.waitForSelector("#workspace-sign-in");
  await page.keyboard.press("Escape");

  await page.evaluate(
    ({ server, password }) =>
      window.cloudAccount.signIn({ server, email: "ana@example.test", password }),
    { server, password },
  );
  const session = await page.evaluate(
    () => JSON.parse(localStorage.getItem("verynize.cloud.account")).session,
  );
  await page.waitForFunction(() =>
    document.getElementById("workspace-profile").textContent.includes("Personal"),
  );

  // Create an organization from the switcher; it becomes the active workspace.
  await switcherItem(page, "workspace-create");
  await page.locator("#text-prompt-input").fill("Studio");
  await page.locator("#text-prompt-ok").click();
  await page.waitForFunction(() =>
    /Studio\s*Team/.test(document.getElementById("workspace-profile").textContent),
  );
  const studio = (await api("/api/auth/organization/list", session)).find(
    (org) => org.name === "Studio",
  );
  assert.ok(studio);
  assert.equal(await page.evaluate(() => window.cloudAccount.activeOrganization()), studio.id);

  // New designs are stored immediately in the active workspace.
  await page.locator("#library-new-file").click();
  await page.locator("#text-prompt-input").fill("Studio design");
  await page.locator("#text-prompt-ok").click();
  await page.waitForFunction(() => window.design.getDocument().name === "Studio design");
  await openSharedDesign(page);
  await page.waitForFunction(
    () =>
      window.cloudWorkspace.isConnected() &&
      document.getElementById("cloud-invite").value.includes("room="),
  );
  const roomId = new URLSearchParams(
    new URL(await page.locator("#cloud-invite").inputValue()).hash.slice(1),
  ).get("room");
  assert.equal((await api(`/api/rooms/${roomId}/access`, session)).organization.id, studio.id);
  await page.evaluate(() => (document.getElementById("cloud-access-section").open = true));
  await page.waitForFunction(
    () => document.getElementById("cloud-workspace-name").textContent === "Studio",
  );

  // Settings › Members: invite Budi, see the pending invitation, he accepts.
  await page.locator("#cloud-close").click();
  await page.evaluate(() => window.fileLibrary.showHome());
  await switcherItem(page, "workspace-members");
  await page.waitForSelector(`#members-page[data-organization="${studio.id}"]`);
  await page.waitForSelector('[data-org-member="ana@example.test"]');
  await page.locator("#members-invite").click();
  await page.locator("#members-invite-email").fill("budi@example.test");
  // Viewer is the default role, as in Wonder's Share.
  assert.equal(await page.locator("#members-invite-role").inputValue(), "viewer");
  await page.locator("#members-invite-send").click();
  await page.waitForSelector('[data-pending-invitation="budi@example.test"]');
  const [invitation] = await api("/api/auth/organization/list-user-invitations", budi);
  assert.equal(invitation.role, "viewer");
  await api("/api/auth/organization/accept-invitation", budi, { invitationId: invitation.id });
  // Budi now reaches the room through the organization with the invited role.
  assert.equal((await api(`/api/rooms/${roomId}`, budi)).role, "viewer");

  // A per-member role from the page; the workspace default does not override it.
  await page.locator('[data-section="account"]').click();
  await page.locator('[data-section="members"]').click();
  await page.waitForSelector('[data-org-member="budi@example.test"]');
  await page.locator('[data-org-member-role="budi@example.test"]').selectOption("editor");
  for (let i = 0; i < 40 && (await api(`/api/rooms/${roomId}`, budi)).role !== "editor"; i++)
    await page.waitForTimeout(100);
  assert.equal((await api(`/api/rooms/${roomId}`, budi)).role, "editor");
  await page.locator("#members-room-role").selectOption("viewer");
  await page.waitForTimeout(300);
  assert.equal((await api(`/api/rooms/${roomId}`, budi)).role, "editor");
  await page.locator('[data-org-member-role="budi@example.test"]').selectOption("admin");
  for (let i = 0; i < 40 && (await api(`/api/rooms/${roomId}`, budi)).role !== "owner"; i++)
    await page.waitForTimeout(100);
  assert.equal((await api(`/api/rooms/${roomId}`, budi)).role, "owner");

  // Invitations for you: Budi's team invites Ana, who accepts from Settings › Members.
  const lab = await api("/api/auth/organization/create", budi, {
    name: "Budi Lab",
    slug: "budi-lab",
  });
  await api("/api/auth/organization/invite-member", budi, {
    email: "ana@example.test",
    role: "member",
    organizationId: lab.id,
  });
  await page.locator('[data-section="account"]').click();
  await page.locator('[data-section="members"]').click();
  await page.waitForSelector("[data-accept-invitation]");
  await page.locator("[data-accept-invitation]").click();
  await page.waitForSelector(`#members-page[data-organization="${lab.id}"]`);
  assert.equal(await page.evaluate(() => window.cloudAccount.activeOrganization()), lab.id);
  await page.waitForSelector('[data-org-member="budi@example.test"]');
  // Plain members cannot invite or change roles.
  assert.equal(await page.locator("#members-invite").count(), 0);
  assert.equal(await page.locator("[data-org-member-role]").count(), 0);

  // Share › People & access moves the room to Ana's personal workspace.
  const personal = (await api("/api/me", session)).personalOrganizationId;
  await page.locator("#settings-back").click();
  await page.evaluate(() => window.fileLibrary.showEditor());
  await openSharedDesign(page);
  await page.evaluate(() => (document.getElementById("cloud-access-section").open = true));
  await page.waitForSelector("#cloud-move-row:not([hidden])");
  await page.locator("#cloud-move-organization").selectOption(personal);
  await page.locator("#cloud-move").click();
  await status("Moved to");
  assert.equal((await api(`/api/rooms/${roomId}/access`, session)).organization.id, personal);
  const budiAfterMove = await fetch(`${server}/api/rooms/${roomId}`, {
    headers: { "x-verynize-session": budi },
  });
  assert.equal(budiAfterMove.status, 401, "Studio members lose the moved room");
  await page.locator("#cloud-close").click();

  // Leaving Budi Lab from Settings › Members; the switcher falls back to another workspace.
  await page.evaluate((id) => window.cloudAccount.setActiveOrganization(id), lab.id);
  await page.evaluate(() => window.appSettings.open("members"));
  await page.waitForSelector(`#members-page[data-organization="${lab.id}"]`);
  await page.locator("#members-leave").click();
  await page.waitForFunction(
    (id) => document.getElementById("members-page")?.dataset.organization !== id,
    lab.id,
  );
  const orgs = await api("/api/auth/organization/list", session);
  assert.deepEqual(orgs.map((org) => org.id).includes(lab.id), false);

  console.log(
    "PASS desktop workspaces: switcher sign-in entry, personal workspace, create organization, rooms shared into the active workspace, Share workspace display and move, Members invite/pending/default access/role change, invitations for you, member restrictions, leave",
  );
} finally {
  await app?.close().catch(() => {});
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
