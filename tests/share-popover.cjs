// Share popover (web/src/islands/share, design/wonder/share-audit/CONTRACT.md "B") against local workerd: strings and
// their order, autofocus, Escape / outside click closing with focus back on Share, the Tab cycle, email chips and
// their validation, the role menu (Viewer, Editor, Admin, all free), the sign-in step for a local file, Copy link
// (`<server>/#room=<id>`, toast with Dismiss), the live file-header lock (B1), inviting, the visibility menu with its
// confirmations (Share popover and File menu), the legacy dialog behind Settings › Share a design (B6, B9) and what a
// viewer may do. Screenshots: VERYNIZE_SCREENSHOTS=<dir> (1440 × 870 at 2×).
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { openSharedDesign } = require("./helpers/shared-design.cjs");

const shots = process.env.VERYNIZE_SCREENSHOTS || "";
const PASSWORD = "a long enough password";

async function launch(dir, label, server) {
  const env = {
    ...process.env,
    VERYNIZE_SKIP_ONBOARDING: "1",
    VERYNIZE_LAUNCH_EDITOR: "1",
    VERYNIZE_CLOUD_SERVER: server,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    env,
    args: [
      ".",
      "--force-device-scale-factor=2",
      "--force-color-profile=srgb",
      `--user-data-dir=${path.join(dir, label)}`,
    ],
    timeout: 30000,
  });
  const page = await app.firstWindow({ timeout: 30000 });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 870),
  );
  await waitForUiReady(page, { timeout: 30000 });
  await page.waitForFunction((s) => document.getElementById("cloud-server")?.value === s, server);
  // Park the pointer on the empty canvas so hover states don't leak into screenshots.
  await page.mouse.move(700, 600);
  return { app, page };
}
const focusWindow = (app) =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.isVisible());
    win.show();
    win.focus();
  });

(async () => {
  const { Miniflare, cloudOptions, passwordUser } = await import("./cloud-harness.mjs");
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "verynize-share-popover-")),
  );
  const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
  const apps = [];
  const notes = [];
  try {
    const server = (await mf.ready).origin;
    await passwordUser(server, "ana@example.test", "Ana Owner", fetch, "192.0.2.20");
    await passwordUser(server, "budi@example.test", "Budi Viewer", fetch, "192.0.2.21");

    const A = await launch(dir, "a", server);
    apps.push(A.app);
    const page = A.page;
    const shot = async (name) => {
      if (!shots) return;
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(shots, name) });
    };
    const popover = page.locator("#share-popover");
    const share = page.locator("#cloud-toggle");
    const emails = page.getByRole("textbox", { name: "Emails to invite" });

    // ---- Open: strings in Wonder's order, focus in the email field, 384 px anchored below Share (B3).
    assert.equal(await share.textContent(), "Share");
    assert.equal(await page.locator("#presence-slot").count(), 1, "presence slot left of Share");
    assert.equal(
      await page.evaluate(() => {
        const slot = document.getElementById("presence-slot");
        return !!(
          slot.compareDocumentPosition(document.getElementById("cloud-toggle")) &
          Node.DOCUMENT_POSITION_FOLLOWING
        );
      }),
      true,
    );
    await share.click();
    await popover.waitFor();
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
      "Emails to invite",
    );
    const text = (await popover.innerText()).replace(/\s+/g, " ").trim();
    const order = [
      "Share",
      "Viewer",
      "Invite",
      "New members can access all files in",
      "Manage members",
      "File visibility",
      "Private",
      "Only members can access",
      "Copy link",
    ];
    let at = -1;
    for (const part of order) {
      const next = text.indexOf(part, at + 1);
      assert.ok(next > at, `"${part}" after the previous string in: ${text}`);
      at = next;
    }
    assert.equal(await emails.getAttribute("placeholder"), "Add emails...");
    assert.doesNotMatch(text, /Pro\b/, "no Pro text: collaboration is free");
    const [box, button] = await Promise.all([popover.boundingBox(), share.boundingBox()]);
    assert.equal(Math.round(box.width), 384);
    assert.ok(box.y >= button.y + button.height, "below the Share button, not over it (B3)");
    assert.ok(
      Math.abs(box.x + box.width - (button.x + button.width)) <= 1,
      "right-aligned with Share",
    );
    await shot("SH2-open.png");

    // ---- Tab cycles inside: emails → role → Invite → Manage members → visibility → Copy link → emails.
    const focusOrder = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      focusOrder.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          return el?.getAttribute("aria-label") || el?.textContent?.trim();
        }),
      );
    }
    assert.deepEqual(focusOrder, [
      "Member role",
      "Invite",
      "Manage members",
      "Private visibility",
      "Copy link",
      "Emails to invite",
    ]);

    // ---- Escape closes and returns focus to Share; outside click closes too.
    await page.keyboard.press("Escape");
    await popover.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.id === "cloud-toggle", null, {
      timeout: 2000,
    });
    await share.click();
    await popover.waitFor();
    await page.mouse.click(700, 500);
    await popover.waitFor({ state: "detached" });

    // ---- Email chips: Enter on empty, invalid chip, removal, valid chip from a comma.
    await share.click();
    await emails.press("Enter");
    assert.equal(
      await page.locator("#share-invite-error").textContent(),
      "Enter an email address to invite.",
    );
    assert.equal(
      await page.locator("[data-share-emails][data-invalid]").count(),
      1,
      "red ring, as Wonder",
    );
    await emails.fill("not-an-email");
    await emails.press("Enter");
    await page.locator('[data-email-chip="not-an-email"][data-invalid]').waitFor();
    assert.equal(
      await page.locator("#share-invite-error").textContent(),
      "Fix or remove the highlighted address.",
    );
    await shot("SI1-invalid.png");
    await page.getByRole("button", { name: "Remove not-an-email" }).click();
    assert.equal(await page.locator("[data-email-chip]").count(), 0);
    assert.equal(await page.locator("#share-invite-error").count(), 0);
    await emails.pressSequentially("budi@example.test,");
    await page.locator('[data-email-chip="budi@example.test"]:not([data-invalid])').waitFor();
    assert.equal(await emails.inputValue(), "");
    await shot("SI1-typed.png");

    // ---- Role menu: Viewer ✓ / Editor / Admin, all enabled, no Pro badges.
    await page.getByRole("button", { name: "Member role" }).click();
    const roles = page.locator("#share-role-menu [role=menuitemradio]");
    assert.deepEqual(await roles.allInnerTexts(), ["Viewer", "Editor", "Admin"]);
    assert.equal(
      await page.locator("#share-role-menu [aria-checked=true]").textContent(),
      "Viewer",
    );
    assert.equal(await page.locator("#share-role-menu [data-disabled]").count(), 0);
    await shot("SI2-roles.png");
    await page.locator('#share-role-menu [data-role="editor"]').click();
    assert.match(await page.getByRole("button", { name: "Member role" }).textContent(), /Editor/);
    await page.getByRole("button", { name: "Member role" }).click();
    await page.locator('#share-role-menu [data-role="viewer"]').click();

    // ---- A local file, signed out: Copy link asks to sign in, then creates the room and copies its link.
    await focusWindow(A.app);
    await page.locator("#share-copy-link").click();
    await page.locator('#share-popover[data-step="sign-in"]').waitFor();
    await page.locator("#share-sign-in-email").fill("ana@example.test");
    await page.locator("#share-sign-in-password").fill(PASSWORD);
    await page.locator("#share-sign-in button[type=submit]").click();
    const toast = page.locator("[data-share-toast]", { hasText: "Link copied to clipboard." });
    await toast.waitFor({ timeout: 20000 });
    const room = await page.evaluate(() => window.cloudWorkspace.room());
    assert.ok(room?.id, "the file became a room");
    const link = await A.app.evaluate(({ clipboard }) => clipboard.readText());
    assert.equal(link, `${server}/#room=${room.id}`);
    assert.equal(await page.evaluate(() => window.cloudWorkspace.shareLink()), link);
    assert.equal(await page.locator("#share-copy-link[data-copied]").count(), 1);
    await toast.getByRole("button", { name: "Dismiss" }).click();
    await toast.waitFor({ state: "detached" });
    // The room lives in Ana's personal workspace, private by default.
    const access = await page.evaluate(() => window.cloudWorkspace.access());
    assert.equal(access.you.role, "owner");
    assert.equal(access.visibility, "private");
    assert.match(
      (await page.locator("#share-members-note").innerText()).replace(/\s+/g, " "),
      /New members can access all files in .+\. Manage members/,
    );

    // ---- B1: the file-header lock follows the room live, and the cloud-state event says why.
    await page.waitForFunction(
      () =>
        document.getElementById("file-visibility")?.getAttribute("aria-label") ===
        "Shared file · Share settings",
    );
    const state = await page.evaluate(() => window.cloudWorkspace.state());
    assert.equal(state.connected, true);
    assert.equal(state.role, "owner");
    assert.equal(state.roomId, room.id);
    await page.waitForFunction(() =>
      window.cloudWorkspace.state().peers.some((p) => p.self && p.name === "Ana Owner"),
    );

    // ---- Invite (CONTRACT §1 share-invitations; servers without it fall back to direct room members).
    const probe = await fetch(`${server}/api/rooms/${room.id}/share-invitations`, {
      method: "POST",
      body: "{}",
    });
    const invitations = !(
      probe.status === 404 &&
      /^not found$/i.test((await probe.json().catch(() => ({}))).error || "")
    );
    if (!invitations)
      notes.push("share-invitations endpoint missing: invite used the /members fallback");
    await page.locator("#share-invite").click();
    await page
      .locator("[data-share-toast]", { hasText: "Invitation sent" })
      .waitFor({ timeout: 15000 });
    assert.equal(await page.locator("[data-email-chip]").count(), 0, "the field clears");
    await page
      .locator("[data-share-toast]", { hasText: "Invitation sent" })
      .getByRole("button", { name: "Dismiss" })
      .click();
    await page.locator("#share-copy-link").click();
    await page.mouse.move(700, 600);
    await page.locator("#share-copy-link[data-copied]").waitFor();
    await page.locator("[data-share-toast]", { hasText: "Link copied to clipboard." }).waitFor();
    await shot("SL1-copied.png");
    if (!invitations) {
      const members = (await page.evaluate(() => window.cloudWorkspace.access())).members;
      assert.ok(members.some((m) => m.email === "budi@example.test" && m.role === "viewer"));
    }

    // ---- File visibility: menu, confirmation, change (guarded on the server endpoint).
    await page.locator("#share-visibility").click();
    const options = page.locator("#share-visibility-menu [role=menuitemradio]");
    assert.deepEqual(
      (await options.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()),
      ["Private Only members can access", "Public Publicly available to everyone"],
    );
    await shot("SV1-menu.png");
    await page.locator('#share-visibility-menu [data-visibility-option="public"]').click();
    const dialog = page.locator("#share-visibility-dialog");
    await dialog.waitFor();
    assert.equal(
      (await dialog.innerText()).replace(/\s+/g, " ").trim(),
      "Make this file public? Review what changes before making this file public. Anyone with the link can view in read-only mode. No Verynize sign-in is needed to open. You can make it private again at any time. Cancel Make public",
    );
    await shot("SV2-confirm.png");
    assert.equal(await popover.isVisible(), true, "the popover stays open behind the confirmation");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(
      await page.locator("#share-visibility").getAttribute("data-visibility"),
      "private",
    );
    const visibilityProbe = await fetch(`${server}/api/rooms/${room.id}/visibility`, {
      method: "PUT",
      body: "{}",
    });
    const visibilitySupported = !(
      visibilityProbe.status === 404 &&
      /^not found$/i.test((await visibilityProbe.json().catch(() => ({}))).error || "")
    );
    if (visibilitySupported) {
      await page.locator("#share-visibility").click();
      await page.locator('#share-visibility-menu [data-visibility-option="public"]').click();
      await dialog.getByRole("button", { name: "Make public" }).click();
      await page.waitForFunction(
        () => document.getElementById("share-visibility")?.dataset.visibility === "public",
      );
      assert.match(
        await page.locator("#share-visibility").innerText(),
        /Anyone with the link\s+Publicly available to everyone/,
      );
      await page.waitForFunction(
        () => document.getElementById("file-visibility")?.textContent === "Public",
      );
      await shot("SV2-changed.png");
      // Copying keeps the same link (no token, no query).
      await A.app.evaluate(({ clipboard }) => clipboard.writeText(""));
      await page.locator("#share-copy-link").click();
      await page
        .locator("[data-share-toast]", { hasText: "Link copied to clipboard." })
        .first()
        .waitFor();
      // The previous copy's toast may still be showing, so wait for the clipboard itself.
      await A.app.evaluate(async ({ clipboard }, expected) => {
        for (let i = 0; i < 100 && clipboard.readText() !== expected; i++)
          await new Promise((resolve) => setTimeout(resolve, 50));
      }, link);
      assert.equal(await A.app.evaluate(({ clipboard }) => clipboard.readText()), link);
      // Back to private from the File menu, with Wonder's private confirmation.
      await page.keyboard.press("Escape");
      await page.locator(".app-menu-trigger:visible").first().click();
      await page.locator("#file-make-private").click();
      await dialog.waitFor();
      assert.match(
        await dialog.innerText(),
        /Make this file private\?[\s\S]*Only members of this organization will be able to open it\.[\s\S]*Existing public links will stop working and anyone currently viewing will lose access\./,
      );
      await dialog.getByRole("button", { name: "Make private" }).click();
      await page.waitForFunction(() => window.cloudWorkspace.state().visibility === "private");
    } else {
      notes.push("visibility endpoint missing: change asserted as a graceful error only");
      await page.locator("#share-visibility").click();
      await page.locator('#share-visibility-menu [data-visibility-option="public"]').click();
      await dialog.getByRole("button", { name: "Make public" }).click();
      await page.getByText("File visibility isn't available on this server yet.").waitFor();
      assert.equal(await page.evaluate(() => window.cloudWorkspace.state().visibility), "private");
      await page.keyboard.press("Escape");
      // The File menu offers the same change, confirmed the same way.
      await page.locator(".app-menu-trigger:visible").first().click();
      await page.locator("#file-make-public").click();
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /Make this file public\?/);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "detached" });
    }

    // ---- The legacy dialog: Settings › Share a design only; B6 (no claim for a member owner), B9 (no dead actions).
    await openSharedDesign(page);
    await page.locator("#cloud-access-section summary").click();
    await page.waitForFunction(() => document.getElementById("cloud-role").textContent === "Owner");
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#cloud-claim").isHidden(), true, "B6");
    assert.equal(
      await page.locator("#cloud-unpublish").isHidden(),
      true,
      "B9 Unpublish before publishing",
    );
    assert.equal(
      await page.locator("#cloud-connect").isHidden(),
      true,
      "B9 Join invite for this room",
    );
    assert.equal(await page.locator("#cloud-leave").isVisible(), true);
    // A viewer link for Budi's desktop.
    await page.locator("#cloud-invite-role").selectOption("viewer");
    await page.waitForFunction((id) => {
      const v = document.getElementById("cloud-invite").value;
      return v.includes(`room=${id}`) && v.includes("token=");
    }, room.id);
    await page.waitForTimeout(500);
    const viewerInvite = await page.locator("#cloud-invite").inputValue();
    await page.locator("#cloud-close").click();

    // ---- A viewer: invite and visibility disabled with the reason, Copy link still works.
    const B = await launch(dir, "b", server);
    apps.push(B.app);
    const b = B.page;
    await openSharedDesign(b);
    assert.equal(
      await b.locator("#cloud-leave").isHidden(),
      true,
      "B9 Disconnect while not connected",
    );
    await b.evaluate(() => {
      window.confirm = () => true;
    });
    await b.locator("#cloud-invite").fill(viewerInvite);
    await b.locator("#cloud-connect").click();
    await b.waitForFunction(() => window.cloudWorkspace.role() === "viewer");
    await b.locator("#cloud-close").click();
    await b.locator("#cloud-toggle").click();
    await b.locator("#share-popover").waitFor();
    assert.equal(await b.getByRole("textbox", { name: "Emails to invite" }).isDisabled(), true);
    assert.equal(await b.locator("#share-invite").isDisabled(), true);
    assert.match(
      await b.locator("#share-members-note").innerText(),
      /Only owners and admins can invite people\./,
    );
    assert.equal(await b.locator("#share-visibility").isDisabled(), true);
    await focusWindow(B.app);
    await b.locator("#share-copy-link").click();
    await b.locator("[data-share-toast]", { hasText: "Link copied to clipboard." }).waitFor();
    assert.equal(await B.app.evaluate(({ clipboard }) => clipboard.readText()), link);

    console.log(
      "PASS share popover: Wonder strings/order, 384 px anchored below Share, autofocus, Tab cycle, Escape/outside close with focus back on Share, chip validation, role menu (all free), sign-in for a local file, Copy link <server>/#room=<id> with toast + Dismiss, live lock (B1), invite, visibility menu + confirmations (popover and File menu), legacy dialog via Settings (B6, B9), viewer limits" +
        (notes.length ? ` [${notes.join("; ")}]` : ""),
    );
  } finally {
    await Promise.all(apps.map((app) => app.close().catch(() => {})));
    await mf.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
