// Verynize "after" side of the Share parity audit (../CHECKLIST.md). Every screenshot uses the filename of the Wonder
// evidence it answers, so make-pairs.py lines them up:
//   - after/<id>.png          ← ../wonder/<id>.png            (desktop app, Electron)
//   - after/chrome-<id>.png   ← ../wonder-web/chrome-<id>.png (web build in installed Google Chrome)
//   - after/safari-<id>.png   ← ../wonder-web/safari-<id>.png (web build in Playwright WebKit, Safari's engine)
//   - after/collab/<name>.png ← ../wonder-web/collab/<name>.png (two-account flow, web build in Chrome)
// plus a few `X-*.png` shots of the deliberate differences (two editors, Safari editing), which have no Wonder pair.
// Wonder's "Do not use" files (wonder/notes.md, wonder-web/notes.md, wonder-web/collab/notes.md) have no counterpart.
//
// Everything runs locally in temp directories; nothing touches production or the real profile:
//   - one local server: `vp dev` (web app + cloud/worker.js in workerd), temp VERYNIZE_CF_STATE, migrated D1, three
//     seeded verified accounts (example.test never receives mail), behind the same CORS-preflight shim as capture.cjs
//     (harness only, see notes.md H1);
//   - the desktop owner in real Electron with a temp --user-data-dir, VERYNIZE_SKIP_ONBOARDING=1 and
//     VERYNIZE_BLOCK_PRODUCTION_CLOUD=1, 1440×870 at device scale 2, sRGB;
//   - browsers at a 1440×870 viewport, device scale 2 (Wonder's web captures include the browser's own chrome, so its
//     page area is smaller).
// Visible strings and a few measured rects per shot go to after/metrics.json.
//
//   npm run build:ui
//   node design/wonder/share-audit/verynize/capture-after.cjs [--keep]
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const { _electron, webkit } = require(ROOT + "/node_modules/@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const OUT = path.join(__dirname, "after");
const KEEP = process.argv.includes("--keep");
const PASSWORD = "a long enough password";
const OWNER = { id: "audit-owner", email: "owner@example.test", name: "Adam Owner" };
const OTHER = { id: "audit-other", email: "other@example.test", name: "Olive Other" };
const VIEWER = { id: "audit-viewer", email: "viewer@example.test", name: "Vera Viewer" };
const SECRETS = {
  BETTER_AUTH_SECRET: "local-test-secret-not-for-production-0000",
  ASSET_SIGNING_SECRET: "local-asset-signing-secret-not-for-production",
};
const VIEWPORT = { width: 1440, height: 870 };
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const log = (...a) => console.log("·", ...a);
const metrics = { _meta: { captured: new Date().toISOString(), viewport: "1440x870 CSS @2x" } };
const problems = [];

// Sunbird, like Wonder's scratch file: white frames on a #2b2b2b page, one rotated, a few with an "H" (child
// coordinates are relative to their frame).
const frame = (id, x, y, w, h, extra = {}) => ({
  id,
  type: "frame",
  name: "Frame",
  x,
  y,
  w,
  h,
  color: "#ffffff",
  ...extra,
});
const text = (id, parentId, x, y, value) => ({
  id,
  type: "text",
  name: value,
  parentId,
  x,
  y,
  w: 20,
  h: 24,
  text: value,
  color: "#000000",
  fontSize: 16,
});
const SUNBIRD = {
  version: 2,
  name: "Sunbird",
  activePage: "p1",
  pages: [
    {
      id: "p1",
      name: "Page 1",
      fill: "#2b2b2b",
      nodes: [
        frame("f1", 0, 0, 80, 48),
        frame("f2", 0, 64, 80, 72),
        frame("f3", 300, 160, 80, 96),
        text("t3", "f3", 34, 32, "H"),
        frame("f4", 330, -60, 130, 80, { rotation: -28 }),
        frame("f5", 500, 220, 120, 144),
        text("t5", "f5", 52, 16, "H"),
        frame("f6", 440, 380, 160, 80),
        text("t6", "f6", 22, 24, "H"),
      ],
    },
  ],
  tokens: {},
};

/** Visible strings of open overlays and the rects of the named elements. */
function measure(page, selectors = {}) {
  return page
    .evaluate((selectors) => {
      const vis = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect(),
          cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
      };
      const r2 = (v) => Math.round(v * 100) / 100;
      const out = { elements: {}, overlays: [] };
      for (const [name, sel] of Object.entries(selectors)) {
        const el = [...document.querySelectorAll(sel)].find(vis);
        if (!el) continue;
        const r = el.getBoundingClientRect(),
          s = getComputedStyle(el);
        out.elements[name] = {
          x: r2(r.left),
          y: r2(r.top),
          w: r2(r.width),
          h: r2(r.height),
          bg: s.backgroundColor,
          color: s.color,
          radius: s.borderTopLeftRadius,
          font: `${s.fontWeight} ${s.fontSize}`,
          text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300),
        };
      }
      for (const m of document.querySelectorAll(
        "[role=menu],[role=dialog],[role=alertdialog],[data-sonner-toast]",
      ))
        if (vis(m)) {
          const r = m.getBoundingClientRect();
          out.overlays.push({
            id: m.id || undefined,
            role: m.getAttribute("role") || "toast",
            x: r2(r.left),
            y: r2(r.top),
            w: r2(r.width),
            h: r2(r.height),
            text: (m.innerText || "").replace(/\s+/g, " ").trim().slice(0, 800),
          });
        }
      const a = document.activeElement;
      if (a && a !== document.body)
        out.focus = a.getAttribute("aria-label") || a.id || a.textContent?.trim().slice(0, 40);
      out.url = location.pathname + location.hash.replace(/token=[0-9a-f]{64}/, "token=<64 hex>");
      return out;
    }, selectors)
    .catch((e) => ({ error: e.message }));
}

const ELEMENTS = {
  share: "#cloud-toggle",
  popover: "#share-popover",
  roleMenu: "#share-role-menu",
  visibilityMenu: "#share-visibility-menu",
  visibilityDialog: "#share-visibility-dialog",
  invitation: "#room-invitation",
  noAccess: "#room-no-access",
  presence: "#presence-popover",
  lock: "#file-visibility",
  viewOnly: "#view-only-pill",
};

async function snap(page, file, extra = {}) {
  await page.waitForTimeout(300);
  const target = path.join(OUT, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await page.screenshot({ path: target });
  metrics[file] = { ...(await measure(page, ELEMENTS)), ...extra };
  log("saved", file);
}

async function seedAccounts(state) {
  const { Miniflare } = await import("miniflare");
  const { hashPassword } = await import("better-auth/crypto");
  const d1Id = (await imp("cloudflare.config.ts")).default.worker.env.DB.id;
  const mf = new Miniflare({
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
          env: { DB: { type: "d1", id: d1Id, name: "verynize" } },
        },
      },
    ],
  });
  try {
    const db = await mf.getD1Database("DB");
    const now = new Date().toISOString(),
      hash = await hashPassword(PASSWORD);
    await db.batch(
      [OWNER, OTHER, VIEWER].flatMap((u) => [
        db
          .prepare(
            'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
          )
          .bind(u.id, u.name, u.email, now, now),
        db
          .prepare(
            'INSERT INTO "account" (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(u.id + "-cred", u.id, "credential", u.id, hash, now, now),
      ]),
    );
  } finally {
    await mf.dispose();
  }
}

/** Harness shim (notes.md H1): answers CORS preflights the way deployed Workers do, forwards the rest to vp dev. */
async function corsProxy(target) {
  const http = require("node:http"),
    net = require("node:net");
  const { corsHeaders } = await imp("cloud/http.js");
  const t = new URL(target);
  const proxy = http.createServer((req, res) => {
    if (req.method === "OPTIONS" && /^\/(api|u|apps|account)\//.test(req.url)) {
      res.writeHead(204, corsHeaders);
      return res.end();
    }
    const up = http.request(
      { host: t.hostname, port: t.port, method: req.method, path: req.url, headers: req.headers },
      (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      },
    );
    up.on("error", (e) => {
      res.writeHead(502);
      res.end(String(e));
    });
    req.pipe(up);
  });
  proxy.on("upgrade", (req, socket, head) => {
    const up = net.connect(Number(t.port), t.hostname, () => {
      up.write(
        `${req.method} ${req.url} HTTP/1.1\r\n` +
          Object.entries(req.headers)
            .map(([k, v]) => `${k}: ${String(v)}`)
            .join("\r\n") +
          "\r\n\r\n",
      );
      if (head?.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  return {
    origin: `http://localhost:${proxy.address().port}`,
    close: () =>
      new Promise((r) => {
        proxy.closeAllConnections?.();
        proxy.close(r);
      }),
  };
}

const watch = (page, who) => {
  page.on("pageerror", (e) => problems.push(`[${who}] pageerror: ${e.message}`));
  page.on("dialog", (d) => {
    problems.push(`[${who}] native dialog: ${d.message()}`);
    d.dismiss().catch(() => {});
  });
};

/* ---------- shared steps (desktop and web pages expose the same islands) ---------- */

const ready = (page) =>
  page.waitForFunction(
    () =>
      document.documentElement.dataset.uiReady === "true" &&
      !!window.cloudLinks &&
      !!window.cloudPresence,
    null,
    { timeout: 30000 },
  );
const inRoom = (page, id) =>
  page.waitForFunction(
    (id) =>
      window.cloudWorkspace?.room()?.id === id &&
      window.cloudWorkspace.isConnected() &&
      !document.body.classList.contains("files-view"),
    id,
    { timeout: 30000 },
  );
const park = (page) => page.mouse.move(900, 860);
const fit = (page) => page.evaluate(() => window.design.runCommand("view.fit"));
async function openShare(page) {
  if (!(await page.locator("#share-popover").count())) await page.locator("#cloud-toggle").click();
  await page.locator("#share-popover").waitFor();
}
async function closeShare(page) {
  if (await page.locator("#share-popover").count()) await page.keyboard.press("Escape");
  await page.locator("#share-popover").waitFor({ state: "detached" });
}
async function dismissToasts(page) {
  for (const button of await page
    .locator(
      "[data-share-toast] button[aria-label=Dismiss], [data-share-toast] >> role=button[name=Dismiss]",
    )
    .all())
    await button.click().catch(() => {});
  await page
    .locator("[data-share-toast]")
    .first()
    .waitFor({ state: "detached", timeout: 8000 })
    .catch(() => {});
}
async function invite(page, email, role) {
  await openShare(page);
  await page.getByRole("textbox", { name: "Emails to invite" }).pressSequentially(`${email},`);
  await page.locator(`[data-email-chip="${email}"]`).waitFor();
  await page.getByRole("button", { name: "Member role" }).click();
  await page.locator(`#share-role-menu [data-role="${role}"]`).click();
  await page.locator("#share-invite").click();
  await page
    .locator("[data-share-toast]", { hasText: "Invitation sent" })
    .waitFor({ timeout: 15000 });
}
async function drawFrame(page, x, y, w = 120, h = 80) {
  const box = await page.locator("#workspace").boundingBox();
  await page.evaluate(() => window.design.setSelection([]));
  await page.keyboard.press("f");
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + w, box.y + y + h, { steps: 6 });
  await page.mouse.up();
  return page.evaluate(() => window.design.getSelection()[0]);
}
const layerCount = (page) => page.evaluate(() => window.design.getDocument().pages[0].nodes.length);
const waitLayers = (page, n) =>
  page.waitForFunction((n) => window.design.getDocument().pages[0].nodes.length === n, n, {
    timeout: 15000,
  });
async function openMembers(page) {
  await page.evaluate(() => window.appSettings.open("members"));
  await page.locator("#members-page").waitFor();
  await page.waitForTimeout(800);
}
async function backToApp(page) {
  await page.evaluate(() => window.appSettings.close?.());
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
}

(async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "vz-share-after-")));
  const state = path.join(tmp, "cf-state");
  const { launchBrowser, signedInContext, startProcess, freePort } = await imp(
    "tests/helpers/web-app.mjs",
  );
  let server, browser, safari, proxy;
  const apps = [];
  try {
    for (const old of await fs.readdir(OUT, { recursive: true }).catch(() => []))
      if (old.endsWith(".png")) await fs.rm(path.join(OUT, old));

    /* ---------- local server ---------- */
    execFileSync(process.execPath, ["scripts/db-migrate.mjs", "--local", "--persist-to", state], {
      cwd: ROOT,
      stdio: "pipe",
    });
    await seedAccounts(state);
    const port = await freePort();
    const devOrigin = `http://localhost:${port}`;
    server = await startProcess(
      process.execPath,
      ["node_modules/vite-plus/bin/vp", "dev", "--port", String(port), "--strictPort"],
      {
        cwd: ROOT,
        env: { ...process.env, ...SECRETS, VERYNIZE_CF_STATE: state },
        ready: devOrigin + "/",
      },
    );
    proxy = await corsProxy(devOrigin);
    const origin = proxy.origin;
    metrics._meta.server =
      "local vp dev (workerd) behind a CORS-preflight shim, http://localhost:<port>";
    const signInApi = async (u) => {
      const r = await fetch(origin + "/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: u.email, password: PASSWORD }),
      });
      if (!r.ok) throw Error(`sign-in ${u.email}: ${r.status} ${await r.text()}`);
      const session = r.headers.get("set-auth-token");
      const me = await (
        await fetch(origin + "/api/me", { headers: { "x-verynize-session": session } })
      ).json();
      return { session, ...me };
    };
    const api = async (route, session, body, method) => {
      const r = await fetch(origin + route, {
        method: method || (body === undefined ? "GET" : "POST"),
        headers: { "content-type": "application/json", "x-verynize-session": session },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const t = await r.text();
      if (!r.ok) throw Error(`${route}: ${r.status} ${t}`);
      return t ? JSON.parse(t) : null;
    };
    const owner = await signInApi(OWNER),
      other = await signInApi(OTHER),
      viewer = await signInApi(VIEWER);
    const room = await api("/api/rooms", owner.session, {
      document: SUNBIRD,
      organizationId: owner.personalOrganizationId,
    });
    const link = `${origin}/#room=${room.id}`;
    metrics._meta.link = "http://localhost:<port>/#room=<uuid>";

    /* ================= desktop owner (wonder/) ================= */
    const env = {
      ...process.env,
      VERYNIZE_SKIP_ONBOARDING: "1",
      VERYNIZE_BLOCK_PRODUCTION_CLOUD: "1",
      VERYNIZE_CLOUD_SERVER: origin,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({
      cwd: ROOT,
      env,
      args: [
        ".",
        "--force-device-scale-factor=2",
        "--force-color-profile=srgb",
        `--user-data-dir=${path.join(tmp, "desktop")}`,
      ],
      timeout: 30000,
    });
    apps.push(app);
    const a = await app.firstWindow({ timeout: 30000 });
    watch(a, "desktop");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 870),
    );
    await ready(a);
    await a.evaluate(
      ({ server, email, password }) => window.cloudAccount.signIn({ server, email, password }),
      { server: origin, email: OWNER.email, password: PASSWORD },
    );
    await a.evaluate((href) => window.cloudLinks.open(href), link);
    await inRoom(a, room.id);
    await a.evaluate(() => window.design.setSelection([]));
    await fit(a);
    await park(a);

    // SH1: hover Share.
    await a.locator("#cloud-toggle").hover();
    await a.waitForTimeout(900);
    await snap(a, "SH1-hover.png");
    // SH2: open.
    await a.locator("#cloud-toggle").click();
    await a.locator("#share-popover").waitFor();
    await park(a);
    await snap(a, "SH2-open.png");
    // SH3: Enter on empty, Escape (focus back on Share), outside click.
    await a.getByRole("textbox", { name: "Emails to invite" }).press("Enter");
    await snap(a, "SH3-empty-enter.png");
    await a.keyboard.press("Escape");
    await a.locator("#share-popover").waitFor({ state: "detached" });
    await snap(a, "SH3-escape-verified.png");
    await snap(a, "SH3-dismissed.png");
    await openShare(a);
    await a.mouse.click(900, 600);
    await a.locator("#share-popover").waitFor({ state: "detached" });
    await park(a);
    await snap(a, "SH3-outside.png");
    // SI1: invalid chip, then a valid chip.
    await openShare(a);
    const emails = a.getByRole("textbox", { name: "Emails to invite" });
    await emails.fill("not-an-email");
    await emails.press("Enter");
    await a.locator('[data-email-chip="not-an-email"][data-invalid]').waitFor();
    await snap(a, "SI1-invalid.png");
    await a.getByRole("button", { name: "Remove not-an-email" }).click();
    await emails.pressSequentially(`${VIEWER.email},`);
    await a.locator(`[data-email-chip="${VIEWER.email}"]`).waitFor();
    await snap(a, "SI1-typed.png");
    // SI2: the role menu.
    await a.getByRole("button", { name: "Member role" }).click();
    await a.locator("#share-role-menu").waitFor();
    await snap(a, "SI2-roles.png");
    await a.locator('#share-role-menu [data-role="viewer"]').click();
    // SI3: invite as Viewer (as Wonder did).
    await a.locator("#share-invite").click();
    await a
      .locator("[data-share-toast]", { hasText: "Invitation sent" })
      .waitFor({ timeout: 15000 });
    await park(a);
    await snap(a, "SI3-result.png");
    await dismissToasts(a);
    // SI5 / SI4: Manage members → the pending row, its menu, Cancel invitation, restored.
    await a.locator("#share-popover").getByText("Manage members").click();
    await a.locator(`[data-pending-invitation="${VIEWER.email}"]`).waitFor({ timeout: 15000 });
    await a.waitForTimeout(500);
    await snap(a, "SI5-pending.png");
    await a.getByRole("button", { name: `Actions for the invitation to ${VIEWER.email}` }).click();
    await a.locator(`[data-cancel-invitation="${VIEWER.email}"]`).waitFor();
    await snap(a, "SI4-row-menu.png");
    await a.locator(`[data-cancel-invitation="${VIEWER.email}"]`).click();
    await a.locator("#members-cancel-invitation-confirm").waitFor();
    await snap(a, "SI5-cancelled.png");
    await a.locator("#members-cancel-invitation-confirm").click();
    await a
      .locator(`[data-pending-invitation="${VIEWER.email}"]`)
      .waitFor({ state: "detached", timeout: 15000 });
    await a.waitForTimeout(600);
    await snap(a, "SI5-restored.png");
    await a
      .locator("[data-sonner-toast]")
      .first()
      .waitFor({ state: "detached", timeout: 15000 })
      .catch(() => {});
    await backToApp(a);
    await a
      .locator("#members-page")
      .waitFor({ state: "hidden" })
      .catch(() => {});
    // SL1: Copy link.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.show();
      w.focus();
    });
    await openShare(a);
    await a.locator("#share-copy-link").click();
    await a.locator("[data-share-toast]", { hasText: "Link copied to clipboard." }).waitFor();
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    if (copied !== link) problems.push(`copied link ${copied} is not ${link}`);
    await park(a);
    await snap(a, "SL1-copied.png", { copied: "http://localhost:<port>/#room=<uuid>" });
    await dismissToasts(a);
    // SV1 / SV2: visibility menu, Public with confirmation, Copy link while public, back to Private.
    await a.locator("#share-visibility").click();
    await a.locator("#share-visibility-menu").waitFor();
    await snap(a, "SV1-menu.png");
    await a.locator('#share-visibility-menu [data-visibility-option="public"]').click();
    const dialog = a.locator("#share-visibility-dialog");
    await dialog.waitFor();
    await park(a);
    await snap(a, "SV2-confirm.png");
    await dialog.getByRole("button", { name: "Make public" }).click();
    await a.waitForFunction(
      () => document.getElementById("share-visibility")?.dataset.visibility === "public",
    );
    await snap(a, "SV2-changed.png");
    await a.locator("#share-copy-link").click();
    await a.locator("[data-share-toast]", { hasText: "Link copied to clipboard." }).waitFor();
    await park(a);
    await snap(a, "SL1-public-copied.png");
    await dismissToasts(a);
    await a.locator("#share-visibility").click();
    await a.locator('#share-visibility-menu [data-visibility-option="private"]').click();
    await dialog.waitFor();
    await park(a);
    await snap(a, "SV2-private-confirm.png");
    await dialog.getByRole("button", { name: "Make private" }).click();
    await a.waitForFunction(
      () => document.getElementById("share-visibility")?.dataset.visibility === "private",
    );
    await snap(a, "SV2-restored.png");
    await closeShare(a);
    // SL4: the app menu's File section (Verynize has no File submenu: the menu is flat with section labels).
    await a.locator(".app-menu-trigger:visible").first().click();
    await a.locator("#file-make-public").waitFor();
    await snap(a, "SL4-file-menu.png");
    await a.locator("#file-make-public").hover();
    await snap(a, "SL4-file-submenu.png");
    await a.keyboard.press("Escape");
    // SW1: the Share popover's workspace link target (Wonder's "View Pro" has no counterpart: no plans).
    await openShare(a);
    await a.locator("#share-popover").getByText("Manage members").click();
    await a.locator("#members-page").waitFor();
    await a.waitForTimeout(600);
    await snap(a, "SW1-links.png");
    await backToApp(a);
    // SC1: Multiplayer tools alone.
    await a.locator("#presence-tools").click();
    await a.locator("#presence-popover").waitFor();
    await snap(a, "SC1-tools.png");
    await a.keyboard.press("Escape");
    await app.close();
    apps.length = 0;

    /* ================= web, Chrome (wonder-web/chrome-*) ================= */
    browser = await launchBrowser();
    const signedIn = async (engine, who) => {
      const context = await signedInContext(engine, origin, who, {
        viewport: VIEWPORT,
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      watch(page, who.account.email);
      return { context, page };
    };
    const ownerWeb = await signedIn(browser, owner);
    await ownerWeb.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    const o = ownerWeb.page;
    await o.goto(link);
    await inRoom(o, room.id);
    await ready(o);
    await fit(o);
    await park(o);
    await snap(o, "chrome-SL2-owner.png");
    await snap(o, "chrome-SL4-open-desktop.png");
    await openShare(o);
    await park(o);
    await snap(o, "chrome-SH2-open.png");
    await o.getByRole("button", { name: "Member role" }).click();
    await o.locator("#share-role-menu").waitFor();
    await snap(o, "chrome-SI2-roles.png");
    await o.keyboard.press("Escape");
    await o.locator("#share-copy-link").click();
    await o.locator("[data-share-toast]", { hasText: "Link copied to clipboard." }).waitFor();
    await park(o);
    await snap(o, "chrome-SL1-copied.png");
    await dismissToasts(o);
    await o.locator("#share-visibility").click();
    await o.locator("#share-visibility-menu").waitFor();
    await snap(o, "chrome-SV1-menu.png");
    await o.keyboard.press("Escape");
    await closeShare(o);
    await openMembers(o);
    await snap(o, "chrome-SW1-members.png");
    await backToApp(o);
    // Signed out: the sign-in wall keeps the link; Create an account.
    const visitor = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    const anon = await visitor.newPage();
    watch(anon, "anonymous");
    await anon.goto(link);
    await anon.locator("#web-sign-in").waitFor({ timeout: 30000 });
    await anon.waitForTimeout(500);
    await snap(anon, "chrome-SL2-signedout.png");
    await snap(anon, "chrome-SL2-incognito.png");
    await snap(anon, "chrome-SL3-signin.png");
    await anon
      .getByRole("button", { name: /Create an account/ })
      .first()
      .click()
      .catch(() =>
        anon
          .getByText(/Create an account/)
          .first()
          .click(),
      );
    await anon.waitForTimeout(600);
    await snap(anon, "chrome-SL2-other-signup.png");
    await visitor.close();

    /* ================= web, WebKit (wonder-web/safari-*) ================= */
    safari = await webkit.launch().catch((e) => {
      problems.push(`WebKit not available: ${e.message.split("\n")[0]}`);
      return null;
    });
    if (safari) {
      const sv = await safari.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
      const sp = await sv.newPage();
      watch(sp, "webkit anonymous");
      await sp.goto(link);
      await sp.locator("#web-sign-in").waitFor({ timeout: 30000 });
      await sp.waitForTimeout(500);
      await snap(sp, "safari-SL2-signedout.png");
      await sv.close();
      const so = await signedIn(safari, owner);
      await so.page.goto(link);
      await inRoom(so.page, room.id);
      await ready(so.page);
      await fit(so.page);
      await park(so.page);
      await snap(so.page, "safari-SL2-owner-attempt.png");
      await snap(so.page, "safari-SL2-owner.png");
      await so.context.close();
    }

    /* ================= collaboration, web in Chrome (wonder-web/collab/) ================= */
    // Olive is an existing Viewer (invited from the Share popover, joined in the app), like Wonder's Profile 1.
    await invite(o, OTHER.email, "viewer");
    await dismissToasts(o);
    await closeShare(o);
    const oliveWeb = await signedIn(browser, other);
    const ol = oliveWeb.page;
    await ol.goto(link);
    await ol.locator("#room-invitation").waitFor({ timeout: 30000 });
    await ol.locator("#room-invitation-join").click();
    await inRoom(ol, room.id);
    await ready(ol);
    await fit(ol);
    await openMembers(o);
    await snap(o, "collab/00-owner-members.png");
    await backToApp(o);
    await park(ol);
    await snap(ol, "collab/01-existing-viewer.png");
    const baseline = await layerCount(o);
    await o.bringToFront();
    const added = await drawFrame(o, 760, 160, 88, 59);
    await o.keyboard.press("Escape");
    await snap(o, "collab/02-owner-added-rectangle.png");
    await waitLayers(ol, baseline + 1);
    await snap(ol, "collab/03-viewer-live.png");
    await ol.bringToFront();
    await ol.locator(`#canvas .layer[data-id="${added}"]`).click();
    await ol.keyboard.press("Delete");
    await ol.keyboard.press("f");
    await ol.waitForTimeout(400);
    if ((await layerCount(ol)) !== baseline + 1) problems.push("a viewer's Delete removed a layer");
    await snap(ol, "collab/04-viewer-edit-blocked.png");
    await o.bringToFront();
    const wbox = await o.locator("#workspace").boundingBox();
    await o.mouse.move(wbox.x + 600, wbox.y + 300);
    await o.mouse.move(wbox.x + 640, wbox.y + 330, { steps: 4 });
    await ol
      .locator(".collaborator-cursor")
      .first()
      .waitFor({ timeout: 10000 })
      .catch(() => problems.push("viewer saw no owner cursor"));
    await snap(ol, "collab/05-viewer-owner-cursor.png");
    await o.evaluate((id) => window.design.setSelection([id]), added);
    await o.keyboard.press("Delete");
    await waitLayers(ol, baseline);
    await snap(ol, "collab/06b-deletion-confirmed.png");
    await openShare(o);
    await o.getByRole("button", { name: "Member role" }).click();
    await o.locator("#share-role-menu").waitFor();
    await snap(o, "collab/07-roles-pro.png");
    await o.keyboard.press("Escape");
    await closeShare(o);
    // Vera: signed in, not a member, no invitation → no access; invited → the in-app invitation → Join.
    const veraWeb = await signedIn(browser, viewer);
    const ve = veraWeb.page;
    await ve.goto(link);
    await ve.locator("#room-no-access[data-signed-in='true']").waitFor({ timeout: 30000 });
    await snap(ve, "collab/08-private-before-invite.png");
    await invite(o, VIEWER.email, "viewer");
    await park(o);
    await snap(o, "collab/09-invited.png");
    await dismissToasts(o);
    await closeShare(o);
    await ve.goto(link);
    await ve.reload();
    await ve.locator("#room-invitation").waitFor({ timeout: 30000 });
    await snap(ve, "collab/10-in-app-invitation.png");
    await ve.locator("#room-invitation-join").click();
    await inRoom(ve, room.id);
    await fit(ve);
    await park(ve);
    await snap(ve, "collab/11-new-viewer-open.png");
    await o.bringToFront();
    const second = await drawFrame(o, 760, 160, 88, 59);
    await o.keyboard.press("Escape");
    await waitLayers(ve, baseline + 1);
    await snap(ve, "collab/12-new-viewer-live.png");
    await ve.bringToFront();
    await ve.locator(`#canvas .layer[data-id="${second}"]`).click();
    await ve.keyboard.press("Delete");
    const sbox = await ve.locator(`#canvas .layer[data-id="${second}"]`).boundingBox();
    await ve.mouse.move(sbox.x + 20, sbox.y + 20);
    await ve.mouse.down();
    await ve.mouse.move(sbox.x + 120, sbox.y + 80, { steps: 5 });
    await ve.mouse.up();
    await snap(ve, "collab/13-new-viewer-attempt.png");
    await o.locator("#presence-tools").click();
    await o.locator("#presence-popover").waitFor();
    await o
      .waitForFunction(
        () => document.querySelectorAll("#presence-popover [data-person]").length >= 2,
        null,
        { timeout: 10000 },
      )
      .catch(() => problems.push("owner presence lists fewer than two people"));
    await snap(o, "collab/14-owner-presence.png");
    await o.keyboard.press("Escape");
    await o.evaluate((id) => window.design.setSelection([id]), second);
    await o.keyboard.press("Delete");
    await waitLayers(o, baseline);
    await openShare(o);
    await park(o);
    await snap(o, "collab/15-private-clean-canvas.png");
    await closeShare(o);
    await openMembers(o);
    await snap(o, "collab/16-three-members.png");
    await o.locator(`[data-row-menu="Actions for ${VIEWER.email}"]`).click();
    await o.locator(`[data-org-remove-member="${VIEWER.email}"]`).click();
    await o.locator("#members-remove-confirm").waitFor();
    await snap(o, "collab/17-remove-confirm.png");
    await o.locator("#members-remove-confirm").click();
    await o
      .locator(`[data-org-member="${VIEWER.email}"]`)
      .waitFor({ state: "detached", timeout: 15000 });
    await o.waitForTimeout(500);
    await snap(o, "collab/18-members-restored.png");
    await backToApp(o);
    await ve
      .locator("[data-sonner-toast]", { hasText: "You no longer have access" })
      .waitFor({ timeout: 15000 })
      .catch(() => problems.push("removed viewer saw no notice"));
    await snap(ve, "collab/19-revoked.png");
    // The room detached on removal (the address lost #room=): a reload shows the copy kept on this device.
    await ve.reload();
    await ready(ve);
    if (await ve.evaluate(() => !!window.cloudWorkspace.room()))
      problems.push("removed viewer still in the room after reload");
    await snap(ve, "collab/20-revoked-reload.png");
    await ve.goto(origin + "/");
    await ve.goto(link);
    await ve.locator("#room-no-access[data-signed-in='true']").waitFor({ timeout: 30000 });
    await snap(ve, "collab/22-revoked-final.png");
    await fit(o);
    await park(o);
    await snap(o, "collab/23-final-canvas.png");

    /* ================= deliberate differences (no Wonder pair) ================= */
    // Two editors on the free plan: Olive becomes Editor (Settings › Members role change), both edit live.
    await api("/api/auth/organization/update-member-role", owner.session, {
      organizationId: owner.personalOrganizationId,
      memberId: (
        await api(
          `/api/auth/organization/get-full-organization?organizationId=${owner.personalOrganizationId}`,
          owner.session,
        )
      ).members.find((m) => m.user.email === OTHER.email).id,
      role: "editor",
    });
    await ol.waitForFunction(() => window.cloudWorkspace.role() === "editor", null, {
      timeout: 15000,
    });
    await ol.bringToFront();
    const fromOlive = await drawFrame(ol, 760, 160, 100, 70);
    await ol.keyboard.press("Escape");
    await waitLayers(o, baseline + 1);
    await o.bringToFront();
    const obox = await o.locator(`#canvas .layer[data-id="${fromOlive}"]`).boundingBox();
    await o.mouse.move(obox.x + 20, obox.y + 20);
    await o.mouse.down();
    await o.mouse.move(obox.x + 20, obox.y + 140, { steps: 6 });
    await o.mouse.up();
    const movedY = await o.evaluate(
      (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id).y,
      fromOlive,
    );
    await ol.waitForFunction(
      ({ id, y }) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id)?.y === y,
      { id: fromOlive, y: movedY },
      { timeout: 15000 },
    );
    await snap(o, "X-two-editors-owner.png");
    await snap(ol, "X-two-editors-other.png");
    // Safari's engine edits too: Olive in WebKit draws a frame the owner receives.
    if (safari) {
      const sw = await signedIn(safari, other);
      await sw.page.goto(link);
      await inRoom(sw.page, room.id);
      await ready(sw.page);
      await fit(sw.page);
      const before = await layerCount(o);
      await drawFrame(sw.page, 560, 420, 90, 60);
      await sw.page.keyboard.press("Escape");
      await waitLayers(o, before + 1);
      await snap(sw.page, "X-safari-editor.png");
      await sw.context.close();
    }
    for (const c of [ownerWeb, oliveWeb, veraWeb]) await c.context.close();
    metrics._problems = problems;
    log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no problems");
  } finally {
    metrics._problems = problems;
    await fs.mkdir(OUT, { recursive: true });
    await fs.writeFile(path.join(OUT, "metrics.json"), JSON.stringify(metrics, null, 1) + "\n");
    for (const app of apps) await app.close().catch(() => {});
    await browser?.close().catch(() => {});
    await safari?.close().catch(() => {});
    await proxy?.close().catch(() => {});
    await server?.stop().catch(() => {});
    if (!KEEP) await fs.rm(tmp, { recursive: true, force: true });
    else log("kept", tmp);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
