// Browser test of the Cloudflare web app (web-start) in local workerd, run twice: against
// `vp dev`, and against the deployable build (`vp build`, the output `cf deploy --prebuilt` uploads)
// served by `vp preview`. Chromium loads /editor and /settings/preferences: the legacy editor boots client-only, the
// router resolves, /api/* reaches cloud/worker.js, a room WebSocket connects to the Durable Object,
// and web/src is not served. Uses Playwright's Chromium, or installed Chrome when that is missing.
//
// Web sign-in (cloud/README.md "Web sign-in"): signed out, every editor path shows the sign-in screen and the editor
// does not boot; the server refuses the page's anonymous room requests; creating an account asks to verify the email;
// signing in with a password boots the editor at the requested path with its invite fragment, which the editor's
// link handler (web/src/islands/collab/links.ts) then opens, and the AI setup steps open for the new account; a
// published snapshot (#public=) opens without an account. The verified account is seeded into the local D1 (local
// Cloudflare email cannot be read back).
//
// File links (share-audit CONTRACT §3 "C", B7): `/#room=<id>&token=…` opens the file straight in the editor (no
// Share dialog, no confirm()), the token leaves the address bar, a room this account cannot open shows "You don’t have
// access to this file" (Back to files, Sign in with another account), and a public room opens read-only without
// signing in when the server offers public rooms. A signed-in account invited to the file's workspace gets "You have an
// invitation" instead, and Join opens the file with the invited role. In dev mode the same link checks also run in WebKit (Safari's
// engine) when Playwright's WebKit is installed (`npx playwright install webkit`).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "better-auth/crypto";
import { Miniflare } from "miniflare";
import { webkit } from "@playwright/test";
import {
  launchBrowser,
  screenshot,
  signedInContext,
  startProcess,
  freePort,
  openStarterFile,
} from "./helpers/web-app.mjs";
import { checkWebRouter } from "./helpers/web-router.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const state = await fs.mkdtemp(path.join(os.tmpdir(), "web-cloudflare-"));
const vp = (...args) => [process.execPath, ["node_modules/vite-plus/bin/vp", ...args]];
const EMAIL = "web@example.test";
// A second verified account: a signed-in non-member who is invited to the first account's workspace.
const GUEST = "guest@example.test";
const PASSWORD = "a long enough password";
// Secrets for the local Worker (the Cloudflare plugin reads them from the environment).
const SECRETS = {
  BETTER_AUTH_SECRET: "local-test-secret-not-for-production-0000",
  ASSET_SIGNING_SECRET: "local-asset-signing-secret-not-for-production",
};
const ROOM = "22222222-2222-4222-8222-222222222222";
const INVITE = `#room=${ROOM}&token=${"cd".repeat(32)}`;
const DOCUMENT = {
  version: 2,
  name: "Published",
  pages: [
    {
      id: "p1",
      name: "Page 1",
      nodes: [{ id: "card", type: "rectangle", name: "Card", x: 0, y: 0, w: 200, h: 120 }],
    },
  ],
  tokens: {},
};
let browser;
try {
  if (!(await fs.stat(path.join(root, "web/dist/ui.js")).catch(() => null)))
    execFileSync(process.execPath, ["scripts/build-ui.cjs"], { cwd: root, stdio: "pipe" });
  browser = await launchBrowser();
  await check("dev");
  execFileSync(...vp("build"), { cwd: root, stdio: "pipe" });
  await check("preview");
} finally {
  await browser?.close();
  await fs.rm(state, { recursive: true, force: true });
}

async function check(mode) {
  // Each mode is a fresh installation. Sharing account state also imports the previous
  // mode's room library (and obsolete server URLs), which triggers extra room creation
  // during sync and exhausts the production rate limit before link checks can run.
  const modeState = path.join(state, mode);
  execFileSync(process.execPath, ["scripts/db-migrate.mjs", "--local", "--persist-to", modeState], {
    cwd: root,
    stdio: "pipe",
  });
  await seedAccount(modeState);
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const server = await startProcess(...vp(mode, "--port", String(port), "--strictPort"), {
    cwd: root,
    env: { ...process.env, ...SECRETS, VERYNIZE_CF_STATE: modeState },
    ready: origin + "/",
  });
  try {
    const context = await checkApp(origin, mode);
    await checkWebRouter(browser, origin, context);
    await context.close();
  } catch (error) {
    console.error(`Cloudflare ${mode} server output:\n${server.output()}`);
    throw error;
  } finally {
    await server.stop();
  }
  console.log(
    `PASS web (Cloudflare ${mode}): sign-in screen before the editor (anonymous room refused, sign-up asks to verify, password sign-in keeps path + link fragment, AI setup opens), file links (direct open, token stripped, no-access screen, invitation modal + Join for an invited non-member, public rooms read-only without sign-in; WebKit in dev), public snapshot anonymous, client-only editor boot, rectangle added, shell routes, one router (clicks, Back/Forward, deep links, room fragment), /api via worker, room WebSocket, web/src not served`,
  );
}

/** A verified email + password account in the local D1 (what sign-up + the emailed link create). */
async function seedAccount(state) {
  const { default: config } = await import("../cloudflare.config.ts");
  // The same persisted D1 the migrations above went to and the dev server opens.
  const mf = new Miniflare({
    // `cf d1 … --persist-to` keeps Miniflare's state under v3/.
    resourcePersistencePath: path.join(state, "v3"),
    workers: [
      {
        config: {
          name: "seed",
          compatibilityDate: "2026-10-28",
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                type: "esm",
                contents: "export default {fetch(){return new Response()}}",
              },
            },
          },
          env: { DB: { type: "d1", id: config.worker.env.DB.id, name: "verynize" } },
        },
      },
    ],
  });
  try {
    const db = await mf.getD1Database("DB");
    const applied = await db.prepare("SELECT count(*) AS n FROM d1_migrations").first();
    assert.ok(applied.n > 0, "seeding the migrated local database");
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
        )
        .bind("web-user", "Web Tester", EMAIL, now, now),
      db
        .prepare(
          'INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          "web-account",
          "web-user",
          "credential",
          "web-user",
          await hashPassword(PASSWORD),
          now,
          now,
        ),
      db
        .prepare(
          'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
        )
        .bind("guest-user", "Gita Guest", GUEST, now, now),
      db
        .prepare(
          'INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          "guest-account",
          "guest-user",
          "credential",
          "guest-user",
          await hashPassword(PASSWORD),
          now,
          now,
        ),
    ]);
  } finally {
    await mf.dispose();
  }
}

async function checkApp(origin, mode) {
  // Server-side routing.
  const get = (route, init) => fetch(origin + route, { redirect: "manual", ...init });
  for (const route of ["/", "/editor", "/settings/preferences", "/code"]) {
    const response = await get(route);
    assert.equal(response.status, 200, route);
    const html = await response.text();
    assert.match(html, /<html lang="en">/, route);
    // The editor is never server-rendered: no editor markup in the document.
    assert.doesNotMatch(html, /id="canvas"/, route);
  }
  for (const route of ["/src/ui.tsx", "/src/lib/bridge.ts", "/src/islands/README.md"]) {
    const response = await get(route);
    assert.equal(response.status, 404, route);
    assert.doesNotMatch(await response.text(), /import |export /, route);
  }
  assert.equal((await get("/style.css")).status, 200);
  if (mode === "preview") {
    // The build's `_headers`: content-hashed assets are immutable, fixed names revalidate.
    const hashed = (await (await get("/")).text()).match(/\/assets\/[\w.-]+-[\w-]{8}\.js/)?.[0];
    assert.ok(hashed, "the page loads a hashed asset");
    const cacheControl = async (route) => {
      const response = await get(route);
      assert.equal(response.status, 200, route);
      return response.headers.get("cache-control") || "";
    };
    assert.equal(await cacheControl(hashed), "public, max-age=31536000, immutable");
    for (const route of ["/app.js", "/style.css", "/assets/fonts/inter-latin-400-normal.woff2"])
      assert.doesNotMatch(await cacheControl(route), /immutable/, route);
    assert.notEqual((await get("/_headers")).status, 200, "_headers is configuration, not a file");
  }
  assert.equal((await get("/dist/ui.js")).status, 200);
  assert.equal((await get("/storage-migration.html")).status, 404);
  const legacyIndex = await get("/index.html?x=1");
  assert.equal(legacyIndex.status, 302);
  assert.equal(new URL(legacyIndex.headers.get("location"), origin).href, origin + "/?x=1");
  const apiMissing = await get("/api/does-not-exist");
  assert.equal(apiMissing.status, 404);
  assert.deepEqual(await apiMissing.json(), { error: "Not found" });
  assert.equal((await get("/no-such-page")).status, 404);

  const errors = [];
  const watch = (page) => page.on("pageerror", (error) => errors.push(error.message));
  const viewport = { width: 1440, height: 870 };
  const json = { "content-type": "application/json" };
  const signedIn = await fetch(origin + "/api/auth/sign-in/email", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert.equal(signedIn.status, 200, await signedIn.clone().text());
  const session = signedIn.headers.get("set-auth-token");
  const me = await (await get("/api/me", { headers: { "x-verynize-session": session } })).json();
  assert.equal(me.account.email, EMAIL);

  // ---- signed out: the sign-in screen at the requested address, with the invite fragment ----
  const anonymous = await browser.newContext({ viewport });
  const gate = await anonymous.newPage();
  watch(gate);
  await gate.goto(origin + "/settings/preferences" + INVITE);
  await gate.waitForFunction(() => document.documentElement.dataset.webAuth === "signed-out");
  await gate.locator("#web-sign-in[data-invite='true'] #onboarding-email").waitFor();
  assert.deepEqual(
    await gate.evaluate(() => ({
      editor: document.documentElement.dataset.legacyEditor ?? null,
      chrome: !!document.querySelector("header.app-chrome"),
      cloudAccount: typeof window.cloudAccount,
    })),
    { editor: null, chrome: false, cloudAccount: "undefined" },
    "the editor does not boot while signed out",
  );
  assert.match(await gate.locator("#web-sign-in").innerText(), /design you were invited to/);
  assert.equal(await gate.locator("#onboarding-skip, #onboarding-server-edit").count(), 0);
  // The server refuses the page's anonymous room requests too.
  assert.deepEqual(
    await gate.evaluate(async (room) => {
      const created = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document: { nodes: [] } }),
      });
      const read = await fetch(`/api/rooms/${room}?x=1`, {
        headers: { authorization: `Bearer ${"cd".repeat(32)}` },
      });
      return [created.status, read.status];
    }, ROOM),
    [401, 401],
  );
  await screenshot(gate, `web-sign-in-${mode}.png`);
  // A new account must verify its email before it signs in.
  await gate.locator("#onboarding-mode").click();
  await gate.locator("#onboarding-name").fill("New Person");
  await gate.locator("#onboarding-email").fill(`new-${mode}@example.test`);
  await gate.locator("#onboarding-password").fill(PASSWORD);
  await gate.locator("#onboarding-submit").click();
  await gate.locator("#onboarding-verify").waitFor();
  await gate.locator("#onboarding-verified").click();
  // A wrong password stays on the screen.
  await gate.locator("#onboarding-email").fill(EMAIL);
  await gate.locator("#onboarding-password").fill("not the password at all");
  await gate.locator("#onboarding-submit").click();
  await gate
    .locator("#onboarding-error")
    .getByText(/incorrect/)
    .waitFor();
  assert.equal(await gate.evaluate(() => document.documentElement.dataset.webAuth), "signed-out");
  // Signed in: the editor boots where it was asked, with the invite fragment for its invite handler.
  await gate.locator("#onboarding-password").fill(PASSWORD);
  await gate.locator("#onboarding-submit").click();
  await gate.waitForFunction(() => document.documentElement.dataset.webAuth === "signed-in");
  await gate.waitForFunction(() => document.documentElement.dataset.uiReady === "true", null, {
    timeout: 20000,
  });
  assert.equal(await gate.locator("#web-sign-in").count(), 0);
  // The link opens without the Share dialog; this room does not exist, so: no access. The token left the address.
  await gate.locator("#room-no-access[data-signed-in='true']").waitFor();
  assert.deepEqual(
    await gate.evaluate(() => ({
      path: location.pathname,
      hash: location.hash,
      account: window.cloudAccount.get()?.account.email,
      dialog: !!document.getElementById("cloud-dialog")?.open,
    })),
    { path: "/settings/preferences", hash: `#room=${ROOM}`, account: EMAIL, dialog: false },
  );
  // First sign-in of this account: the AI setup steps.
  await gate.locator("#onboarding[data-step='ai'] #onboarding-ai-providers").waitFor();
  await anonymous.close();

  // ---- a published snapshot opens without an account ----
  const authed = (route, init = {}) =>
    get(route, { ...init, headers: { ...json, "x-verynize-session": session, ...init.headers } });
  const published = await (
    await authed("/api/rooms", { method: "POST", body: JSON.stringify({ document: DOCUMENT }) })
  ).json();
  const { publicId } = await (
    await authed(`/api/rooms/${published.id}/publish`, { method: "POST" })
  ).json();
  const visitor = await browser.newContext({ viewport });
  const viewer = await visitor.newPage();
  watch(viewer);
  await viewer.goto(`${origin}/#public=${publicId}`);
  await viewer.waitForFunction(() => document.documentElement.dataset.webAuth === "public");
  await viewer.locator('iframe[title="Published design"]').waitFor();
  assert.equal(await viewer.locator("#web-sign-in").count(), 0);
  assert.equal(
    await viewer.evaluate(() => localStorage.getItem("verynize.cloud.account")),
    null,
    "no account in this browser",
  );
  await visitor.close();

  // ---- signed in ----
  const context = await signedInContext(browser, origin, { session, ...me }, { viewport });
  const page = await context.newPage();
  watch(page);

  await page.goto(origin + "/editor");
  await page.waitForFunction(() => document.documentElement.dataset.legacyEditor === "ready");
  await page.waitForFunction(() => document.documentElement.dataset.uiReady === "true", null, {
    timeout: 20000,
  });
  await page.waitForFunction(() => window.shellRouter?.state.status === "idle");
  // No file of its own: a fresh profile lands on Files until the user opens or makes one.
  await page.waitForFunction(() => location.pathname === "/" && !window.fileLibrary.currentId);
  await openStarterFile(page);
  assert.equal(
    await page.evaluate(() => window.shellRouter.state.location.pathname),
    await page.evaluate(() => "/editor/" + encodeURIComponent(window.fileLibrary.currentId)),
  );
  assert.equal(await page.evaluate(() => document.body.classList.contains("files-view")), false);
  // Legacy markup sits directly in <body>, before Start's nodes, and the scripts ran in order.
  assert.equal(
    await page.evaluate(() => document.querySelector("body > header.app-chrome") !== null),
    true,
  );
  assert.equal(await page.evaluate(() => typeof window.design?.getDocument), "function");
  await page.waitForSelector("#canvas .layer");
  const layers = () => page.locator("#canvas .layer").count();
  const before = await layers();
  assert.ok(before > 0, "canvas renders the starter layers");
  await page.locator(".app-menu-trigger:visible").first().click();
  await page.locator("#rectangle").click();
  assert.equal(await layers(), before + 1);
  assert.equal(
    await page.evaluate(() =>
      window.design
        .getDocument()
        .pages.flatMap((p) => p.nodes)
        .some((n) => n.type === "rectangle"),
    ),
    true,
  );

  // Shell navigation keeps the editor mounted (one boot, same layers) and moves the URL.
  await page.evaluate(() => window.shellRouter.navigate({ to: "/" }));
  await page
    .waitForFunction(
      () => location.pathname === "/" && document.body.classList.contains("files-view"),
    )
    .catch(async (error) => {
      console.error(
        "Files route state",
        await page.evaluate(() => ({
          path: location.pathname,
          classes: document.body.className,
          active: window.fileLibrary.currentId,
          route: window.shellRouter.state.location.pathname,
        })),
      );
      throw error;
    });
  await page.goBack();
  await page.waitForFunction(
    () =>
      location.pathname === "/editor/" + encodeURIComponent(window.fileLibrary.currentId) &&
      !document.body.classList.contains("files-view"),
  );
  assert.equal(await layers(), before + 1);

  // Cloud API and room WebSocket from the page's origin.
  const socket = await page.evaluate(async () => {
    const session =
      window.cloudAccount.get() &&
      JSON.parse(localStorage.getItem("verynize.cloud.account")).session;
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json", "x-verynize-session": session },
      body: JSON.stringify({ document: { nodes: [] } }),
    });
    const room = await response.json();
    if (response.status !== 201 || !room.id || !room.token)
      throw new Error(`Room creation failed (${response.status}): ${JSON.stringify(room)}`);
    const url = new URL(
      `/api/rooms/${room.id}/socket?token=${room.token}&session=${encodeURIComponent(session)}`,
      location.href,
    );
    url.protocol = url.protocol.replace("http", "ws");
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error("no presence over the room socket")), 8000);
      ws.onerror = () => reject(new Error("room socket failed"));
      ws.onopen = () =>
        ws.send(JSON.stringify({ type: "presence", name: "Web test", cursor: { x: 1, y: 2 } }));
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type !== "presence" || !message.peers.some((peer) => peer.name === "Web test"))
          return;
        clearTimeout(timer);
        ws.close();
        resolve({ status: response.status, type: message.type });
      };
    });
  });
  assert.deepEqual(socket, { status: 201, type: "presence" });

  // A fresh load of a settings deep link opens the legacy settings overlay.
  await page.goto(origin + "/settings/preferences");
  await page.waitForFunction(() => document.documentElement.dataset.legacyEditor === "ready");
  await page.waitForFunction(() => document.documentElement.dataset.uiReady === "true", null, {
    timeout: 20000,
  });
  await page.waitForFunction(
    () =>
      window.shellRouter?.state.location.pathname === "/settings/preferences" &&
      document.body.classList.contains("settings-open"),
  );
  assert.equal(await page.locator("#settings-screen").isVisible(), true);
  assert.equal(await page.evaluate(async () => (await fetch("/src/ui.tsx")).status), 404);
  assert.deepEqual(errors, []);
  await page.close();

  await checkLinks(browser, origin, { session, me, viewport, mode, label: "chrome" });
  if (mode === "dev") {
    const safari = await webkit.launch().catch((error) => {
      console.log(`SKIP WebKit link checks: ${error.message.split("\n")[0]}`);
      return null;
    });
    if (safari)
      try {
        await checkLinks(safari, origin, { session, me, viewport, mode, label: "webkit" });
        console.log("PASS web file links in WebKit (Safari engine)");
      } finally {
        await safari.close();
      }
  }
  return context;
}

/** File links in `engine` (Chromium or WebKit): direct open, token stripping, no access, public rooms. */
async function checkLinks(engine, origin, { session, me, viewport, mode, label }) {
  // Room creation is rate limited per CF-Connecting-IP; these rooms get their own test address per run.
  const json = {
    "content-type": "application/json",
    "cf-connecting-ip": `198.51.100.${(label === "webkit" ? 20 : 10) + (mode === "dev" ? 0 : 1)}`,
  };
  const authed = (route, init = {}) =>
    fetch(origin + route, {
      ...init,
      headers: { ...json, "x-verynize-session": session, ...init.headers },
    });
  const doc = (name) => ({ ...DOCUMENT, name });
  const ownedResponse = await authed("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ document: doc(`Linked ${label}`) }),
  });
  assert.equal(ownedResponse.status, 201, await ownedResponse.clone().text());
  const owned = await ownedResponse.json();
  const tokenResponse = await authed(`/api/rooms/${owned.id}/tokens`, {
    method: "POST",
    body: JSON.stringify({ role: "editor", label: "Editor invite" }),
  });
  assert.equal(tokenResponse.status, 201, await tokenResponse.clone().text());
  const { token } = await tokenResponse.json();
  // A room this account is not a member of (an anonymous script's room).
  const stranger = await (
    await fetch(origin + "/api/rooms", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ document: doc("Not yours") }),
    })
  ).json();
  assert.ok(stranger.id, `anonymous scripts still create rooms: ${JSON.stringify(stranger)}`);

  const context = await signedInContext(
    engine,
    origin,
    { session, ...me },
    { viewport, deviceScaleFactor: 2 },
  );
  const page = await context.newPage();
  const dialogs = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  // Direct open: the editor shows the file, the token is gone from the address bar, no dialog.
  await page.goto(`${origin}/#room=${owned.id}&token=${token}`);
  await page.waitForFunction((id) => window.cloudWorkspace?.room()?.id === id, owned.id, {
    timeout: 30000,
  });
  await page.waitForFunction(
    () =>
      location.pathname === "/editor/" + encodeURIComponent(window.fileLibrary.currentId) &&
      !document.body.classList.contains("files-view"),
  );
  assert.equal(await page.evaluate(() => window.design.getDocument().name), `Linked ${label}`);
  assert.equal(await page.evaluate(() => location.hash), `#room=${owned.id}`);
  assert.equal(await page.evaluate(() => !!document.getElementById("cloud-dialog")?.open), false);
  await page.locator("#presence-tools").waitFor();
  await screenshot(page, `web-SL2-${label}-${mode}-open.png`);
  // Reloading the token-free address opens it again (the token stayed with the file).
  await page.reload();
  await page.waitForFunction((id) => window.cloudWorkspace?.room()?.id === id, owned.id, {
    timeout: 30000,
  });
  // Let the router settle on the editor address first: its history update would abort the next goto.
  await page.waitForFunction(
    () => location.pathname === "/editor/" + encodeURIComponent(window.fileLibrary.currentId),
  );

  // No access: the screen, then Back to files.
  await page.goto(`${origin}/#room=${stranger.id}`);
  const denied = page.locator("#room-no-access[data-signed-in='true']");
  await denied.waitFor({ timeout: 30000 });
  assert.match(await denied.innerText(), /You don’t have access to this file/);
  assert.match(await denied.innerText(), /Sign in with another account/);
  await screenshot(page, `web-SL2-${label}-${mode}-no-access.png`);
  await page.locator("#room-no-access-back").click();
  await page.waitForFunction(
    () =>
      document.body.classList.contains("files-view") && location.pathname === "/" && !location.hash,
  );
  assert.deepEqual(dialogs, [], `${label}: no native dialogs`);
  await context.close();

  // A signed-in non-member who was invited (Share popover → POST share-invitations, as Editor) gets the in-app
  // invitation when opening the plain link, like Wonder's; Join opens the file with that role. Afterwards the guest
  // leaves the workspace again, so the next engine/mode starts uninvited.
  const invited = await (
    await authed(`/api/rooms/${owned.id}/share-invitations`, {
      method: "POST",
      body: JSON.stringify({ emails: [GUEST], role: "editor" }),
    })
  ).json();
  assert.deepEqual(invited, { invited: [{ email: GUEST, status: "invited" }], errors: [] });
  const guestSignIn = await fetch(origin + "/api/auth/sign-in/email", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email: GUEST, password: PASSWORD }),
  });
  assert.equal(guestSignIn.status, 200, await guestSignIn.clone().text());
  const guestSession = guestSignIn.headers.get("set-auth-token");
  const guestMe = await (
    await fetch(origin + "/api/me", { headers: { "x-verynize-session": guestSession } })
  ).json();
  const guest = await signedInContext(
    engine,
    origin,
    { session: guestSession, ...guestMe },
    { viewport, deviceScaleFactor: 2 },
  );
  const invitee = await guest.newPage();
  invitee.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await invitee.goto(`${origin}/#room=${owned.id}`);
  const invitation = invitee.locator("#room-invitation");
  await invitation.waitFor({ timeout: 30000 });
  const invitationText = await invitation.innerText();
  for (const expected of [
    "You have an invitation",
    "Join to work with your team in a shared workspace.",
    "Web Tester invited you as Editor",
    "Decline",
    "Join",
    "Maybe later",
  ])
    assert.ok(invitationText.includes(expected), `${label}: invitation shows “${expected}”`);
  await screenshot(invitee, `web-SL2-${label}-${mode}-invitation.png`);
  await invitee.locator("#room-invitation-join").click();
  await invitee.waitForFunction((id) => window.cloudWorkspace?.room()?.id === id, owned.id, {
    timeout: 30000,
  });
  await invitee.waitForFunction(() => window.cloudWorkspace.role() === "editor");
  assert.equal(await invitation.count(), 0);
  assert.equal(await invitee.locator("#view-only-pill").count(), 0);
  assert.equal(await invitee.evaluate(() => window.design.getDocument().name), `Linked ${label}`);
  await screenshot(invitee, `web-SL2-${label}-${mode}-joined.png`);
  assert.deepEqual(dialogs, [], `${label}: no native dialogs`);
  await guest.close();
  const left = await authed("/api/auth/organization/remove-member", {
    method: "POST",
    body: JSON.stringify({ organizationId: me.personalOrganizationId, memberIdOrEmail: GUEST }),
  });
  assert.equal(left.status, 200, await left.clone().text());

  // Public rooms (CONTRACT §1, server workstream A) open read-only without signing in.
  const visibility = await authed(`/api/rooms/${owned.id}/visibility`, {
    method: "PUT",
    body: JSON.stringify({ visibility: "public" }),
  });
  if (!visibility.ok) {
    console.log(
      `SKIP public room link (${label}): this server has no room visibility yet (${visibility.status})`,
    );
    return;
  }
  const visitor = await engine.newContext({ viewport, deviceScaleFactor: 2 });
  const anonymous = await visitor.newPage();
  await anonymous.goto(`${origin}/#room=${owned.id}`);
  await anonymous.waitForFunction(() => document.documentElement.dataset.webAuth === "public");
  await anonymous.waitForFunction((id) => window.cloudWorkspace?.room()?.id === id, owned.id, {
    timeout: 30000,
  });
  await anonymous.locator("#view-only-pill").waitFor();
  assert.equal(await anonymous.locator("#web-sign-in").count(), 0);
  await screenshot(anonymous, `web-SL2-${label}-${mode}-public.png`);
  await visitor.close();
}
