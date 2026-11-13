// Desktop UI for cloud accounts: two real Electron clients create email + password accounts (verified through the outbox),
// edit profiles, share a room by email with roles, rotate and recover links, comment, and
// build/publish/roll back/unpublish a project app against local workerd.
import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-accounts-ui-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
const apps = [];
const project = path.join(dir, "ui-demo");
async function writeProject(label) {
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(
    path.join(project, "package.json"),
    JSON.stringify({ name: "ui-demo", private: true, scripts: { build: "node build.mjs" } }),
  );
  await fs.writeFile(
    path.join(project, "build.mjs"),
    `import fs from 'node:fs';fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.html','<!doctype html><html><head></head><body><p>${label}</p></body></html>');fs.writeFileSync('dist/app.js','console.log(1)');`,
  );
}
try {
  const server = (await mf.ready).origin;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  for (const label of ["a", "b"])
    apps.push(
      await electron.launch({ env, args: [".", `--user-data-dir=${path.join(dir, label)}`] }),
    );
  const [a, b] = await Promise.all(apps.map((app) => app.firstWindow()));
  for (const page of [a, b]) {
    await page.waitForFunction(() => !!window.design && !!window.cloudWorkspace);
    page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  }
  const panel = (page, open = true) =>
    page.evaluate((open) => {
      const d = document.getElementById("cloud-dialog");
      if (open && !d.open) d.showModal();
      if (!open && d.open) d.close();
    }, open);
  const section = (page, id) =>
    page.evaluate((id) => {
      document.getElementById(id).open = true;
    }, id);
  const statusIncludes = (page, text) =>
    page.waitForFunction(
      (text) => document.getElementById("cloud-status").textContent.includes(text),
      text,
    );
  async function signIn(page, email, password = "a long enough password") {
    await panel(page);
    await page.locator("#cloud-server").fill(server);
    await section(page, "cloud-account-section");
    await page.locator("#cloud-email").fill(email);
    // Create the account, then follow the emailed verification link as a browser would.
    await page.locator("#cloud-password").fill(password);
    await page.locator("#cloud-signup-name").fill(email.split("@")[0]);
    await page.locator("#cloud-signup").click();
    await statusIncludes(page, "Check " + email);
    assert.equal(await page.locator("#cloud-password").inputValue(), "", "password field cleared");
    // Signing in before verifying is refused and sends a new link.
    await page.locator("#cloud-password").fill(password);
    await page.locator("#cloud-signin").click();
    await statusIncludes(page, "Verify your email first");
    const { messages } = await (
      await fetch(`${server}/api/dev/outbox?to=${encodeURIComponent(email)}`)
    ).json();
    const verified = await fetch(messages.find((m) => /Verify/.test(m.subject)).link, {
      redirect: "manual",
    });
    assert.equal(verified.headers.get("location"), "/account/verified");
    await page.locator("#cloud-password").fill("not the password");
    await page.locator("#cloud-signin").click();
    await statusIncludes(page, "Email or password is incorrect");
    await page.locator("#cloud-password").fill(password);
    await page.locator("#cloud-signin").click();
    await page.waitForFunction(() => !document.getElementById("cloud-signed-in").hidden);
    assert.match(await page.locator("#cloud-account").textContent(), new RegExp(email));
    await page.waitForFunction(() => !!window.cloudWorkspace.room());
  }

  // Sign in and edit the public profile.
  await signIn(a, "alice@example.test");
  await a.locator("#cloud-handle").fill("alice-ui");
  await a.locator("#cloud-display-name").fill("Alice Interface");
  await a.locator("#cloud-profile-save").click();
  await statusIncludes(a, "/u/alice-ui");
  assert.equal(
    (await (await fetch(`${server}/api/profiles/alice-ui`)).json()).displayName,
    "Alice Interface",
  );
  await signIn(b, "bob@example.test");

  // A signed-in owner creates a room and invites Bob by email as a viewer.
  await a.waitForFunction(() => !!window.cloudWorkspace.room());
  assert.equal(await a.locator("#cloud-role").textContent(), "Owner");
  await section(a, "cloud-access-section");
  await a.locator("#cloud-member-email").fill("bob@example.test");
  await a.locator("#cloud-member-role").selectOption("viewer");
  await a.locator("#cloud-member-add").click();
  await statusIncludes(a, "bob@example.test is now viewer and was emailed");
  await a.waitForFunction(
    () => !!document.querySelector('#cloud-members select[data-member="bob@example.test"]'),
  );
  const roomId = new URLSearchParams(
    new URL(await a.locator("#cloud-invite").inputValue()).hash.slice(1),
  ).get("room");

  // Bob opens the room from his account without any link token; viewers cannot change it.
  await b.locator("#cloud-rooms-refresh").click();
  await b.locator(`[data-open-room="${roomId}"]`).click();
  await b.waitForFunction((id) => window.cloudWorkspace.room()?.id === id, roomId);
  await statusIncludes(b, "Connected");
  assert.equal(await b.locator("#cloud-role").textContent(), "Viewer");
  assert.doesNotMatch(await b.locator("#cloud-invite").inputValue(), /token=/);
  await a.waitForFunction(
    () => document.getElementById("cloud-presence").textContent === "2 connected",
  );
  const count = (page) => page.evaluate(() => window.design.getDocument().pages[0].nodes.length);
  const before = await count(a);
  await panel(b, false);
  await b.locator(".app-menu-trigger:visible").first().click();
  await b.locator("#rectangle").click();
  await b.waitForFunction((n) => window.design.getDocument().pages[0].nodes.length === n, before);
  await statusIncludes(b, "viewer in this room");
  assert.equal(await count(a), before, "viewer edits never reach the room");

  // Promoting Bob to editor takes effect live.
  await a.locator('#cloud-members select[data-member="bob@example.test"]').selectOption("editor");
  await b.waitForFunction(() => document.getElementById("cloud-role").textContent === "Editor");
  await b.locator(".app-menu-trigger:visible").first().click();
  await b.locator("#rectangle").click();
  await a.waitForFunction(
    (n) => window.design.getDocument().pages[0].nodes.length === n + 1,
    before,
  );

  // Role links, then rotation: old links stop working, Alice stays live, member Bob keeps access.
  await a.locator("#cloud-link-role").selectOption("viewer");
  await a.locator("#cloud-link-create").click();
  await a.waitForFunction(() =>
    document.getElementById("cloud-link-output").value.includes("token="),
  );
  const viewerToken = new URLSearchParams(
    new URL(await a.locator("#cloud-link-output").inputValue()).hash.slice(1),
  ).get("token");
  // The file keeps the owner link privately; the invite field shows an editor link instead.
  const ownerToken = () =>
    a.evaluate(() => window.fileLibrary.cloudOf(window.fileLibrary.currentId).token);
  const inviteToken = async () =>
    new URLSearchParams(new URL(await a.locator("#cloud-invite").inputValue()).hash.slice(1)).get(
      "token",
    );
  const oldToken = await ownerToken();
  const oldInvite = await inviteToken();
  assert.ok(oldInvite && oldInvite !== oldToken, "the invite never carries the owner token");
  assert.equal(
    (
      await fetch(`${server}/api/rooms/${roomId}`, {
        headers: { authorization: "Bearer " + viewerToken },
      })
    ).status,
    200,
  );
  await a.locator("#cloud-rotate").click();
  // Owner link, editor invite and viewer link.
  await statusIncludes(a, "Rotated links: 3 old links revoked");
  const newToken = await ownerToken();
  assert.notEqual(newToken, oldToken);
  await a.waitForFunction(
    (old) =>
      /token=/.test(document.getElementById("cloud-invite").value) &&
      !document.getElementById("cloud-invite").value.includes(old),
    oldInvite,
  );
  assert.notEqual(await inviteToken(), newToken);
  for (const token of [oldToken, oldInvite, viewerToken])
    assert.equal(
      (
        await fetch(`${server}/api/rooms/${roomId}`, {
          headers: { authorization: "Bearer " + token },
        })
      ).status,
      401,
    );
  await a.waitForFunction(
    () => document.getElementById("cloud-presence").textContent === "2 connected",
  );
  await panel(a, false);
  await a.locator(".app-menu-trigger:visible").first().click();
  await a.locator("#rectangle").click();
  await b.waitForFunction(
    (n) => window.design.getDocument().pages[0].nodes.length === n + 2,
    before,
  );

  // Comments from a member appear live for the owner.
  await panel(a);
  await section(a, "cloud-comments-section");
  await panel(b);
  await section(b, "cloud-comments-section");
  await b.locator("#cloud-comment-text").fill("Tighten the spacing here");
  await b.locator("#cloud-comment-send").click();
  await a.waitForFunction(() =>
    document.getElementById("cloud-comments").textContent.includes("Tighten the spacing here"),
  );

  // Recovery: after losing the link, the owner account mints a fresh owner link from Your rooms.
  await a.locator("#cloud-leave").click();
  await a.locator("#cloud-rooms-refresh").click();
  await a.locator(`[data-recover-room="${roomId}"]`).click();
  await statusIncludes(a, "Recovered owner access");
  const recovered = await ownerToken();
  assert.notEqual(recovered, newToken);
  assert.equal(
    (
      await fetch(`${server}/api/rooms/${roomId}`, {
        headers: { authorization: "Bearer " + newToken },
      })
    ).status,
    401,
  );
  assert.equal(await a.locator("#cloud-role").textContent(), "Owner");

  // Publish the open project's built app, publish again, roll back, then unpublish.
  await writeProject("First build");
  await apps[0].evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, project);
  await a.evaluate(() => window.desktop.openProject());
  await section(a, "cloud-app-section");
  await a.waitForFunction(() =>
    document.getElementById("cloud-app-project").textContent.includes("npm run build"),
  );
  assert.equal(await a.locator("#cloud-app-name").inputValue(), "ui-demo");
  await a.locator("#cloud-app-publish").click();
  await a.waitForFunction(() =>
    document.getElementById("cloud-app-status").textContent.startsWith("Published version 1"),
  );
  const appUrl = await a.locator("#cloud-app-url").textContent();
  assert.equal(appUrl, `${server}/apps/alice-ui/ui-demo/`);
  assert.match(await (await fetch(appUrl)).text(), /First build/);
  assert.match(
    await (await fetch(`${server}/u/alice-ui`)).text(),
    /href="\/apps\/alice-ui\/ui-demo\/"/,
  );
  await writeProject("Second build");
  await a.locator("#cloud-app-publish").click();
  await a.waitForFunction(() =>
    document.getElementById("cloud-app-status").textContent.startsWith("Published version 2"),
  );
  assert.match(await (await fetch(appUrl)).text(), /Second build/);
  await a.locator('[data-activate-version="1"]').click();
  await a.waitForFunction(
    () => document.getElementById("cloud-app-status").textContent === "Version 1 is live",
  );
  assert.match(await (await fetch(appUrl)).text(), /First build/);
  await a.locator("#cloud-app-unpublish").click();
  await a.waitForFunction(
    () => document.getElementById("cloud-app-status").textContent === "App unpublished",
  );
  assert.equal((await fetch(appUrl)).status, 404);

  // Sign out everywhere ends every session for the account.
  const session = await a.evaluate(
    () => JSON.parse(localStorage.getItem("verynize.cloud.account")).session,
  );
  await a.locator("#cloud-signout-all").click();
  await a.waitForFunction(() => !document.getElementById("cloud-signed-out").hidden);
  assert.equal(
    (await fetch(`${server}/api/me`, { headers: { "x-verynize-session": session } })).status,
    401,
  );
  console.log(
    "PASS desktop accounts: email + password sign-up, verification, sign-in, profile edit, email invite with roles, token-free member join, viewer enforcement, live promotion, role links, rotation, comments, owner recovery, project app build/publish/rollback/unpublish, sign out everywhere",
  );
} finally {
  await Promise.all(
    apps.map(async (app) => {
      await app
        .evaluate(({ BrowserWindow }) => {
          for (const win of BrowserWindow.getAllWindows()) win.destroy();
        })
        .catch(() => {});
      await app.close();
    }),
  );
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
