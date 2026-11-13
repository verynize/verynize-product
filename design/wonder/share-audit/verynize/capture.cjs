// Verynize side of the Share parity audit (design/wonder/share-audit/CHECKLIST.md, ids SH, SI, SV, SL, SC, SW).
// Everything runs locally and in temp directories; nothing touches production or the real profile:
//   - one local server: `vp dev` (the web app + cloud/worker.js in workerd) on a free port, with a temp
//     VERYNIZE_CF_STATE, migrated D1 and two seeded, verified email + password accounts
//     (owner@example.test "Adam Owner", other@example.test "Olive Other"; example.test never receives mail);
//   - desktop A (owner) and desktop B (second account): real Electron, temp --user-data-dir each,
//     VERYNIZE_CLOUD_SERVER=<local server>, VERYNIZE_SKIP_ONBOARDING=1 (which also blocks production requests),
//     1440×870 content at device scale factor 2, sRGB;
//   - the web build in installed Google Chrome (Playwright channel "chrome"), 1440×870 @2×, prefix `web-`.
// Each state is saved as <id>-<state>.png next to this file, with DOM facts (rects, computed colours/fonts, texts,
// open dialogs and their controls) in metrics.json. notes.md is written by hand from those.
//
//   npm run build:ui
//   node design/wonder/share-audit/verynize/capture.cjs [--keep] [id-prefix ...]
//
// id-prefix args only filter which PNGs are written (the flow always runs: later states depend on earlier ones).
// --keep leaves the temp directory (server state and profiles) on disk.
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const { _electron } = require(ROOT + "/node_modules/@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const OUT = __dirname;
const KEEP = process.argv.includes("--keep");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const want = (file) => !only.length || only.some((p) => file.startsWith(p));
const PASSWORD = "a long enough password";
const OWNER = { id: "audit-owner", email: "owner@example.test", name: "Adam Owner" };
const OTHER = { id: "audit-other", email: "other@example.test", name: "Olive Other" };
const SECRETS = {
  BETTER_AUTH_SECRET: "local-test-secret-not-for-production-0000",
  ASSET_SIGNING_SECRET: "local-asset-signing-secret-not-for-production",
};
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const log = (...a) => console.log("·", ...a);
const metrics = { _meta: { captured: new Date().toISOString(), viewport: "1440x870 CSS @2x" } };
const bugs = [];
const redact = (url) => String(url || "").replace(/token=[0-9a-f]{64}/g, "token=<64 hex>");

/** DOM facts for the selectors given (first match each, visible one preferred) plus open dialogs / menus / tooltips. */
function measure(page, selectors) {
  return page.evaluate((selectors) => {
    const vis = (el) => {
      if (!el || el.hidden) return false;
      const r = el.getBoundingClientRect(),
        cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
    };
    const r2 = (v) => Math.round(v * 100) / 100;
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r2(r.left), y: r2(r.top), w: r2(r.width), h: r2(r.height) };
    };
    const text = (el) =>
      (el?.innerText || el?.value || el?.textContent || "").replace(/\s+/g, " ").trim();
    const style = (el) => {
      const s = getComputedStyle(el);
      return {
        bg: s.backgroundColor,
        color: s.color,
        border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        radius: s.borderTopLeftRadius,
        padding: s.padding,
        font: `${s.fontWeight} ${s.fontSize}/${s.lineHeight} ${s.fontFamily.split(",")[0]}`,
        shadow: s.boxShadow === "none" ? undefined : s.boxShadow,
        opacity: s.opacity === "1" ? undefined : s.opacity,
      };
    };
    const out = { elements: {}, overlays: [], focus: null };
    for (const [name, sel] of Object.entries(selectors || {})) {
      const all = [...document.querySelectorAll(sel)];
      const el = all.find(vis) || all[0];
      if (!el) {
        out.elements[name] = null;
        continue;
      }
      out.elements[name] = {
        sel,
        visible: vis(el),
        text: text(el).slice(0, 400),
        ...rect(el),
        style: style(el),
        placeholder: el.getAttribute("placeholder") || undefined,
        aria: el.getAttribute("aria-label") || undefined,
        title: el.getAttribute("title") || undefined,
        disabled: el.disabled || el.getAttribute("aria-disabled") === "true" || undefined,
        options:
          el.tagName === "SELECT"
            ? [...el.options].map((o) => ({
                value: o.value,
                text: o.text,
                selected: o.selected,
                disabled: o.disabled || undefined,
              }))
            : undefined,
        open: el.tagName === "DETAILS" || el.tagName === "DIALOG" ? el.open : undefined,
      };
    }
    const seen = new Set();
    for (const m of document.querySelectorAll(
      "[role=menu],[role=listbox],[role=dialog],dialog[open],[role=tooltip],[data-radix-popper-content-wrapper] > *,[data-sonner-toast]",
    )) {
      if (seen.has(m) || !vis(m)) continue;
      seen.add(m);
      const items = [];
      for (const i of m.querySelectorAll(
        "[role=menuitem],[role=option],[role=separator],summary,strong,input,select,textarea,button,label,h2,h3,p,li,a",
      )) {
        if (!vis(i)) continue;
        if (i.getAttribute("role") === "separator") {
          items.push({ separator: true });
          continue;
        }
        items.push({
          tag: i.tagName.toLowerCase(),
          id: i.id || undefined,
          role: i.getAttribute("role") || undefined,
          text:
            text(i).slice(0, 200) ||
            i.getAttribute("aria-label") ||
            i.getAttribute("placeholder") ||
            "",
          placeholder: i.getAttribute("placeholder") || undefined,
          disabled: i.disabled || undefined,
          ...rect(i),
        });
      }
      out.overlays.push({
        id: m.id || undefined,
        role: m.getAttribute("role") || m.tagName.toLowerCase(),
        ...rect(m),
        style: style(m),
        text: text(m).slice(0, 1500),
        items,
      });
    }
    const a = document.activeElement;
    if (a && a !== document.body)
      out.focus = {
        tag: a.tagName.toLowerCase(),
        id: a.id || undefined,
        aria: a.getAttribute("aria-label") || undefined,
        text: text(a).slice(0, 80),
      };
    return out;
  }, selectors);
}

const SHARE = {
  toggle: "#cloud-toggle",
  lockButton: 'button[aria-label^="Private file"], button[aria-label^="Shared file"]',
  accountAvatar: 'button[aria-label^="Account:"]',
  presence: "#cloud-presence",
  dialog: "#cloud-dialog",
  title: "#cloud-dialog > header > strong",
  close: "#cloud-close",
  server: "#cloud-server",
  name: "#cloud-name",
  intro: "#cloud-dialog > p",
  create: "#cloud-create",
  connect: "#cloud-connect",
  leave: "#cloud-leave",
  invite: "#cloud-invite",
  inviteRole: "#cloud-invite-role",
  copy: "#cloud-copy",
  publish: "#cloud-publish",
  unpublish: "#cloud-unpublish",
  public: "#cloud-public",
  status: "#cloud-status",
  storage: "#storage-meter",
  accountSection: "#cloud-account-section",
  accessSection: "#cloud-access-section",
  role: "#cloud-role",
  workspace: "#cloud-workspace",
  members: "#cloud-members",
  memberEmail: "#cloud-member-email",
  memberRole: "#cloud-member-role",
  memberAdd: "#cloud-member-add",
  memberSelect: "#cloud-members select",
  memberRemove: "[data-remove-member]",
  links: "#cloud-links",
  linkRole: "#cloud-link-role",
  rotate: "#cloud-rotate",
  conflict: "#cloud-conflict",
  cursor: ".collaborator-cursor",
  signIn: "#web-sign-in",
  onboarding: "#onboarding",
};

/** Helpers bound to one page; `who` prefixes nothing, it only labels metrics. */
function tools(page, who) {
  const wait = (ms) => page.waitForTimeout(ms);
  return {
    wait,
    async snap(file, extra = {}, selectors = SHARE) {
      const fact = {
        who,
        ...(await measure(page, selectors).catch((e) => ({ error: e.message }))),
        ...extra,
      };
      fact.cloud = await page
        .evaluate(() => ({
          connected: window.cloudWorkspace?.isConnected?.() ?? null,
          role: window.cloudWorkspace?.role?.() ?? null,
          status: document.getElementById("cloud-status")?.textContent ?? null,
          presence: document.getElementById("cloud-presence")?.textContent ?? null,
          readOnlyClass: document.body.classList.contains("cloud-read-only"),
          account: window.cloudAccount?.get?.()?.account?.email ?? null,
          layers: window.design?.getDocument?.().pages?.[0]?.nodes?.length ?? null,
        }))
        .catch(() => null);
      if (fact.elements?.invite) fact.elements.invite.text = redact(fact.elements.invite.text);
      metrics[file] = fact;
      if (want(file)) {
        await page.screenshot({ path: path.join(OUT, file) });
        log("saved", file);
      }
      return fact;
    },
    status: () => page.locator("#cloud-status").textContent(),
    waitStatus: (re, timeout = 15000) =>
      page.waitForFunction(
        (src) => new RegExp(src).test(document.getElementById("cloud-status")?.textContent || ""),
        re.source,
        { timeout },
      ),
    openShare: async () => {
      if (!(await page.evaluate(() => document.getElementById("cloud-dialog")?.open)))
        await page.locator("#cloud-toggle:visible").first().click();
      await wait(300);
    },
    closeShare: async () => {
      await page.evaluate(() => {
        const d = document.getElementById("cloud-dialog");
        if (d?.open) d.close();
      });
      await wait(200);
    },
    section: (id, open) =>
      page.evaluate(
        ([id, open]) => {
          const d = document.getElementById(id);
          if (d) d.open = open;
        },
        [id, open],
      ),
    away: async () => {
      await page.mouse.move(700, 860);
      await wait(150);
    },
  };
}

async function seedAccounts(state) {
  const { Miniflare } = await import("miniflare");
  const { hashPassword } = await import("better-auth/crypto");
  let d1Id = "76210bc4-d4fe-4075-a321-776c2525a828";
  try {
    d1Id = (await imp("cloudflare.config.ts")).default.worker.env.DB.id;
  } catch {}
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
      [OWNER, OTHER].flatMap((u) => [
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

async function launchDesktop(tmp, label, server) {
  const env = {
    ...process.env,
    VERYNIZE_SKIP_ONBOARDING: "1",
    VERYNIZE_BLOCK_PRODUCTION_CLOUD: "1",
    VERYNIZE_CLOUD_SERVER: server,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    cwd: ROOT,
    env,
    args: [
      ".",
      "--force-device-scale-factor=2",
      "--force-color-profile=srgb",
      `--user-data-dir=${path.join(tmp, label)}`,
    ],
    timeout: 30000,
  });
  const page = await app.firstWindow({ timeout: 30000 });
  page.on("pageerror", (e) => bugs.push(`[desktop ${label}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error")
      bugs.push(`[desktop ${label}] console.error: ${m.text().slice(0, 300)}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400)
      bugs.push(
        `[desktop ${label}] HTTP ${r.status()} ${r.request().method()} ${redact(r.url()).replace(/localhost:\d+/, "localhost:<port>")}`,
      );
  });
  page.on("dialog", (d) => {
    metrics._dialogs = [
      ...(metrics._dialogs || []),
      { who: label, type: d.type(), message: d.message() },
    ];
    d.accept().catch(() => {});
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 870),
  );
  const { waitForUiReady } = require(ROOT + "/tests/helpers/ui-ready.cjs");
  await waitForUiReady(page, { timeout: 30000 });
  await page.waitForFunction((s) => document.getElementById("cloud-server")?.value === s, server, {
    timeout: 15000,
  });
  await page.waitForTimeout(500);
  return { app, page };
}

/**
 * Harness shim, not product behaviour: `vp dev` answers CORS preflights in Vite's own middleware (it allows only
 * localhost origins), so the desktop renderer (Origin app://verynize) could never reach the Worker's OPTIONS
 * handler, which deployed Workers run first for /api/* (cloudflare.config.ts runWorkerFirst). This proxy answers
 * OPTIONS with cloud/http.js corsHeaders and forwards everything else (WebSocket upgrades included) to vp dev,
 * keeping the Host header so the Worker sees the proxy's origin as its own.
 */
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

const focusWindow = (app) =>
  app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) => w.isVisible());
    w.show();
    w.focus();
  });

void (async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "vz-share-audit-")));
  const state = path.join(tmp, "cf-state");
  const { launchBrowser, signedInContext, startProcess, freePort } = await imp(
    "tests/helpers/web-app.mjs",
  );
  let server, browser, proxy;
  const apps = [];
  try {
    /* ---------- local server: migrated D1, seeded accounts, vp dev ---------- */
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
      "local vp dev (workerd) behind a CORS-preflight proxy, http://localhost:<port>";
    log("server", origin);
    const signInApi = async (u) => {
      const r = await fetch(origin + "/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: u.email, password: PASSWORD }),
      });
      if (!r.ok) throw Error("sign-in " + u.email + ": " + r.status + " " + (await r.text()));
      const session = r.headers.get("set-auth-token");
      const me = await (
        await fetch(origin + "/api/me", { headers: { "x-verynize-session": session } })
      ).json();
      return { session, ...me };
    };
    const ownerSession = await signInApi(OWNER),
      otherSession = await signInApi(OTHER);

    /* ================= desktop A: the owner ================= */
    const A = await launchDesktop(tmp, "a", origin);
    apps.push(A.app);
    const a = A.page,
      ta = tools(a, "desktop-owner");
    await ta.away();

    // SH1: Share button in the inspector header, idle / hover / focus; the file header lock button and its tooltip.
    await ta.snap("SH1-idle.png");
    const shareBox = await a.locator("#cloud-toggle:visible").first().boundingBox();
    await a.mouse.move(shareBox.x + shareBox.width / 2, shareBox.y + shareBox.height / 2);
    await ta.wait(900);
    await ta.snap("SH1-hover.png");
    await ta.away();
    const lock = a.locator('button[aria-label^="Private file"]:visible').first();
    if (await lock.count()) {
      await lock.hover();
      await ta.wait(900);
      await ta.snap("SH1-lock-tooltip.png");
    }
    await ta.away();
    const avatar = a.locator('button[aria-label^="Account:"]:visible').first();
    if (await avatar.count()) {
      await avatar.hover();
      await ta.wait(900);
      await ta.snap("SH1-avatar-tooltip.png");
      await ta.away();
    }

    // SH2: the Share panel opened on a fresh, signed-out profile with no room.
    await a.locator("#cloud-toggle:visible").first().click();
    await ta.wait(500);
    await ta.snap("SH2-open.png");
    await a.evaluate(() => document.getElementById("cloud-dialog").scrollTo(0, 99999));
    await ta.wait(200);
    await ta.snap("SH2-open-scrolled.png");
    await a.evaluate(() => document.getElementById("cloud-dialog").scrollTo(0, 0));

    // SH3: keyboard. Focus order (Tab ×14), Enter in the invite field, Escape, click outside.
    const order = [];
    for (let i = 0; i < 14; i++) {
      order.push(
        await a.evaluate(() => {
          const e = document.activeElement;
          return e
            ? `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${e.getAttribute("aria-label") ? `[${e.getAttribute("aria-label")}]` : ""}`
            : null;
        }),
      );
      await a.keyboard.press("Tab");
    }
    metrics._focusOrder = order;
    await a.locator("#cloud-invite").click();
    await a.keyboard.type("hello");
    await a.keyboard.press("Enter");
    await ta.wait(400);
    await ta.snap("SH3-enter-in-field.png");
    await a.locator("#cloud-invite").fill("");
    await a.keyboard.press("Escape");
    await ta.wait(400);
    await ta.snap("SH3-escape.png");
    await a.locator("#cloud-toggle:visible").first().click();
    await ta.wait(400);
    await a.mouse.click(600, 450);
    await ta.wait(400);
    await ta.snap("SH3-click-outside.png");
    await ta.closeShare();

    // Sign in through Share › Account (the desktop's email + password form).
    await ta.openShare();
    await ta.section("cloud-account-section", true);
    await ta.wait(200);
    await ta.snap("SH2-account-signed-out.png");
    await a.locator("#cloud-email").fill(OWNER.email);
    await a.locator("#cloud-password").fill(PASSWORD);
    await a.locator("#cloud-signin").click();
    await a.waitForFunction(() => !document.getElementById("cloud-signed-in").hidden, null, {
      timeout: 15000,
    });
    await ta.wait(800);
    await ta.snap("SH2-account-signed-in.png");
    await ta.section("cloud-account-section", false);
    await a.locator("#cloud-name").fill("Adam Owner");
    await a.locator("#cloud-name").press("Tab");

    // Create room: the owner view of the panel (the closest state to Wonder's popover on a file).
    await a.locator("#cloud-create").click();
    await a.waitForFunction(
      () => document.getElementById("cloud-invite").value.includes("token="),
      null,
      { timeout: 20000 },
    );
    await ta.wait(800);
    const editorInvite = await a.locator("#cloud-invite").inputValue();
    const roomId = new URLSearchParams(new URL(editorInvite).hash.slice(1)).get("room");
    metrics._invite = { editor: redact(editorInvite), roomId };
    await ta.snap("SH2-open-room.png");
    await ta.closeShare();
    await ta.away();
    await ta.snap("SH1-shared-idle.png");
    await ta.openShare();

    // SL1: Copy invite → status line, clipboard.
    await focusWindow(A.app);
    await a.locator("#cloud-copy").click();
    await ta.waitStatus(/^Invite copied/);
    const copied = await A.app.evaluate(({ clipboard }) => clipboard.readText());
    await ta.snap("SL1-copied.png", {
      clipboard: redact(copied),
      clipboardEqualsField: copied === editorInvite,
    });
    await a.locator("#cloud-invite-role").selectOption("viewer");
    await a.waitForFunction((old) => {
      const v = document.getElementById("cloud-invite").value;
      return v.includes("token=") && v !== old;
    }, editorInvite);
    const viewerInvite = await a.locator("#cloud-invite").inputValue();
    metrics._invite.viewer = redact(viewerInvite);
    await ta.snap("SL1-viewer-link.png");
    await a.locator("#cloud-invite-role").selectOption("editor");
    await a.waitForFunction(
      (v) => document.getElementById("cloud-invite").value === v,
      editorInvite,
    );

    // SI: People & access. Typing one email, several, an invalid one; the role list; inviting the second account.
    await ta.section("cloud-access-section", true);
    await a.waitForFunction(
      () => document.getElementById("cloud-role").textContent === "Owner",
      null,
      { timeout: 10000 },
    );
    await ta.wait(600);
    await a.evaluate(() =>
      document.getElementById("cloud-access-section").scrollIntoView({ block: "start" }),
    );
    await ta.snap("SH2-open-access.png");
    await a.locator("#cloud-member-email").fill(OTHER.email);
    await ta.snap("SI1-typed.png");
    await a.locator("#cloud-member-email").fill(`${OTHER.email}, ${OWNER.email}`);
    await a.locator("#cloud-member-add").click();
    await ta.wait(1500);
    await ta.snap("SI1-multi.png");
    await a.locator("#cloud-member-email").fill("not-an-email");
    await a.locator("#cloud-member-add").click();
    await ta.wait(1500);
    await ta.snap("SI1-invalid.png");
    await a.locator("#cloud-member-email").fill("");
    await a.locator("#cloud-member-add").click();
    await ta.wait(600);
    await ta.snap("SI1-empty.png");
    // The role control is a native <select>: its open popup is an OS menu outside the page, so record its options.
    await a.locator("#cloud-member-role").focus();
    await ta.snap("SI2-roles.png");
    await a.locator("#cloud-member-email").fill(OTHER.email);
    await a.locator("#cloud-member-role").selectOption("viewer");
    await a.locator("#cloud-member-add").click();
    await ta.waitStatus(/is now viewer/, 20000).catch(() => {});
    await ta.wait(800);
    await ta.snap("SI3-sent.png");
    await a
      .waitForSelector(`#cloud-members [data-member="${OTHER.email}"]`, { timeout: 10000 })
      .catch(() => {});
    await a.evaluate(() =>
      document.getElementById("cloud-members").scrollIntoView({ block: "center" }),
    );
    await ta.snap("SI3-members.png");
    await a
      .locator(`#cloud-members [data-member="${OTHER.email}"]`)
      .focus()
      .catch(() => {});
    await ta.snap("SI4-row.png");
    await ta.snap("SI4-row-menu.png");
    // SI5: what the invitee sees. Room invitations go by email (local dev email binding) and land in Files › Shared.
    metrics._otherRooms = await (
      await fetch(origin + "/api/me/rooms", {
        headers: { "x-verynize-session": otherSession.session },
      })
    )
      .json()
      .catch(() => null);
    metrics._otherOrgInvitations = await (
      await fetch(origin + "/api/auth/organization/list-user-invitations", {
        headers: { "x-verynize-session": otherSession.session },
      })
    )
      .json()
      .catch(() => null);

    // SV: there is no visibility dropdown; the nearest control is Publish snapshot (a frozen public copy).
    await ta.section("cloud-access-section", false);
    await a.evaluate(() => document.getElementById("cloud-dialog").scrollTo(0, 0));
    await ta.snap("SV1-menu.png");
    await a.locator("#cloud-publish").click();
    await a.waitForFunction(
      () => document.getElementById("cloud-public").textContent.includes("public="),
      null,
      { timeout: 15000 },
    );
    await ta.wait(500);
    const publicLink = await a.locator("#cloud-public").textContent();
    metrics._publicLink = publicLink.replace(/public=[^&]+/, "public=<id>");
    await ta.snap("SV2-changed.png");

    /* ================= web (installed Chrome) ================= */
    browser = await launchBrowser();
    const ctxOpts = { viewport: { width: 1440, height: 870 }, deviceScaleFactor: 2 };
    const watch = (p, label) => {
      p.on("pageerror", (e) => bugs.push(`[web ${label}] pageerror: ${e.message}`));
      p.on("console", (m) => {
        if (m.type() === "error")
          bugs.push(`[web ${label}] console.error: ${m.text().slice(0, 300)}`);
      });
      p.on("response", (r) => {
        if (r.status() >= 400)
          bugs.push(
            `[web ${label}] HTTP ${r.status()} ${r.request().method()} ${redact(r.url()).replace(/localhost:\d+/, "localhost:<port>")}`,
          );
      });
      p.on("dialog", (d) => {
        metrics._dialogs = [
          ...(metrics._dialogs || []),
          { who: "web-" + label, type: d.type(), message: d.message() },
        ];
        d.accept().catch(() => {});
      });
    };
    // SL3 public snapshot, anonymous.
    {
      const ctx = await browser.newContext(ctxOpts),
        p = await ctx.newPage();
      watch(p, "public");
      await p.goto(publicLink);
      await p.waitForFunction(() => document.documentElement.dataset.webAuth === "public", null, {
        timeout: 30000,
      });
      await p
        .locator('iframe[title="Published design"]')
        .waitFor({ timeout: 20000 })
        .catch(() => {});
      await p.waitForTimeout(1500);
      const frame = await p
        .evaluate(() => {
          const f = document.querySelector('iframe[title="Published design"]');
          const d = f?.contentDocument;
          return f
            ? {
                sandbox: f.getAttribute("sandbox"),
                srcdocLength: f.srcdoc.length,
                bodyText: d?.body?.innerText?.slice(0, 200) ?? null,
                bodyChildren: d?.body?.children.length ?? null,
                layers: window.design?.getDocument?.().pages?.[0]?.nodes?.length ?? null,
              }
            : null;
        })
        .catch((e) => ({ error: e.message }));
      await tools(p, "web-anonymous").snap("web-SL3-public-snapshot.png", {
        publishedFrame: frame,
        url: p.url().replace(/public=[^&]+/, "public=<id>"),
      });
      await ctx.close();
    }
    // Restore visibility: unpublish.
    await a.locator("#cloud-unpublish").click();
    await ta.waitStatus(/removed/i).catch(() => {});
    await ta.wait(400);
    await ta.snap("SV2-restored.png");
    await ta.closeShare();

    // SL2 signed out.
    {
      const ctx = await browser.newContext(ctxOpts),
        p = await ctx.newPage();
      watch(p, "signedout");
      await p.goto(editorInvite);
      await p.waitForFunction(
        () => document.documentElement.dataset.webAuth === "signed-out",
        null,
        { timeout: 30000 },
      );
      await p.locator("#web-sign-in").waitFor();
      await p.waitForTimeout(800);
      await tools(p, "web-signed-out").snap("web-SL2-chrome-signedout.png", {
        url: redact(p.url()),
      });
      await ctx.close();
    }
    // SL2/SL3 as the owner, signed in on the web.
    const webOwnerCtx = await signedInContext(browser, origin, ownerSession, ctxOpts);
    const wo = await webOwnerCtx.newPage();
    watch(wo, "owner");
    const two = tools(wo, "web-owner");
    await wo.goto(editorInvite);
    await wo.waitForFunction(() => document.documentElement.dataset.uiReady === "true", null, {
      timeout: 40000,
    });
    await wo
      .waitForFunction(() => document.getElementById("cloud-dialog")?.open, null, {
        timeout: 15000,
      })
      .catch(() => {});
    await wo.waitForTimeout(800);
    await two.snap("web-SL2-chrome-owner.png", { url: redact(wo.url()) });
    await wo.locator("#cloud-connect").click();
    await two.waitStatus(/Connected/, 20000).catch(() => {});
    await wo.waitForTimeout(800);
    await two.snap("web-SL3-owner-joined.png");
    await two.closeShare();
    await wo.waitForTimeout(400);
    await two.snap("web-SH1-idle.png");
    await two.openShare();
    await two.snap("web-SH2-open.png");
    await two.closeShare();
    // SL2/SL3 as the second account on the web (editor link).
    const webOtherCtx = await signedInContext(browser, origin, otherSession, ctxOpts);
    const wx = await webOtherCtx.newPage();
    watch(wx, "other");
    const twx = tools(wx, "web-other");
    await wx.goto(editorInvite);
    await wx.waitForFunction(() => document.documentElement.dataset.uiReady === "true", null, {
      timeout: 40000,
    });
    await wx
      .waitForFunction(() => document.getElementById("cloud-dialog")?.open, null, {
        timeout: 15000,
      })
      .catch(() => {});
    await wx.waitForTimeout(800);
    await twx.snap("web-SL2-chrome-other.png");
    await wx.locator("#cloud-name").fill("Olive (web)");
    await wx.locator("#cloud-connect").click();
    await twx.waitStatus(/Connected/, 20000).catch(() => {});
    await wx.waitForTimeout(800);
    await twx.snap("web-SL3-other-joined.png");
    await twx.closeShare();
    // SC1 desktop + web: the web user moves on the canvas; the owner sees a cursor label and "N connected".
    const wbox = await wx.locator("#canvas").boundingBox();
    for (let i = 0; i < 6; i++) {
      await wx.mouse.move(wbox.x + 300 + i * 20, wbox.y + 250 + i * 10);
      await wx.waitForTimeout(120);
    }
    await a.waitForSelector(".collaborator-cursor", { timeout: 10000 }).catch(() => {});
    await ta.wait(500);
    await ta.snap("SC1-presence-web.png");
    const abox = await a.locator("#canvas").boundingBox();
    for (let i = 0; i < 6; i++) {
      await a.mouse.move(abox.x + 400 + i * 20, abox.y + 300 + i * 10);
      await ta.wait(120);
    }
    await wx.waitForSelector(".collaborator-cursor", { timeout: 10000 }).catch(() => {});
    await wx.waitForTimeout(400);
    await twx.snap("web-SC1-presence.png");
    // SC2 web → desktop: the web editor adds a rectangle.
    const before = await a.evaluate(() => window.design.getDocument().pages[0].nodes.length);
    await wx.evaluate(() => window.design.addNode("rectangle"));
    await a
      .waitForFunction((n) => window.design.getDocument().pages[0].nodes.length > n, before, {
        timeout: 10000,
      })
      .catch(() => bugs.push("SC2: a web edit did not reach the desktop within 10 s"));
    await ta.wait(500);
    await ta.snap("SC2-edit-from-web.png");
    await wx.close();
    await webOtherCtx.close();
    await wo.close();
    await webOwnerCtx.close();

    /* ================= desktop B: the second account ================= */
    const B = await launchDesktop(tmp, "b", origin);
    apps.push(B.app);
    const b = B.page,
      tb = tools(b, "desktop-other");
    await b.evaluate(
      ({ server, email, password }) => window.cloudAccount.signIn({ server, email, password }),
      { server: origin, email: OTHER.email, password: PASSWORD },
    );
    await b.evaluate(() => {
      document.getElementById("cloud-name").value = "Olive Other";
    });
    await b.evaluate(() => window.fileLibrary.showHome());
    await b
      .waitForSelector(`[data-room-id="${roomId}"]`, { timeout: 20000 })
      .catch(() =>
        bugs.push("SC: the room shared with the second account did not appear on its Files home"),
      );
    await tb.wait(800);
    await tb.snap("SI5-invitee-files.png");
    if (await b.locator(`[data-room-id="${roomId}"]`).count())
      await b.locator(`[data-room-id="${roomId}"]`).first().click();
    else
      await b.evaluate(
        ([server, id]) => window.cloudWorkspace.openRoom({ server, id }),
        [origin, roomId],
      );
    await b
      .waitForFunction(() => window.cloudWorkspace?.isConnected?.(), null, { timeout: 20000 })
      .catch(() => bugs.push("SC: the second account could not open the room"));
    await tb.wait(1200);
    await tb.snap("SC1-presence-b.png");
    // SC3 viewer: the UI still lets the viewer add a layer; it is reverted and explained only inside the Share panel.
    const vBefore = await b.evaluate(() => window.design.getDocument().pages[0].nodes.length);
    await b.locator(".app-menu-trigger:visible").first().click();
    await b
      .locator("#rectangle")
      .click()
      .catch(() => b.evaluate(() => window.design.addNode("rectangle")));
    await tb.wait(600);
    const vAfter = await b.evaluate(() => window.design.getDocument().pages[0].nodes.length);
    await tb.snap("SC3-viewer.png", { layersBefore: vBefore, layersAfter: vAfter });
    await tb.openShare();
    await tb.section("cloud-access-section", true);
    await tb.wait(800);
    await tb.snap("SC3-viewer-panel.png");
    await tb.closeShare();
    // Promote to editor live (owner's member role select), then edits both ways.
    await ta.openShare();
    await ta.section("cloud-access-section", true);
    await a.locator(`#cloud-members [data-member="${OTHER.email}"]`).selectOption("editor");
    await b
      .waitForFunction(() => window.cloudWorkspace.role() === "editor", null, { timeout: 15000 })
      .catch(() => bugs.push("SC: the role change did not reach the connected second account"));
    await ta.wait(500);
    await ta.snap("SI4-role-changed.png");
    await ta.closeShare();
    // SC1 presence between two desktops.
    const bbox = await b.locator("#canvas").boundingBox();
    for (let i = 0; i < 6; i++) {
      await b.mouse.move(bbox.x + 500 + i * 15, bbox.y + 200 + i * 15);
      await tb.wait(120);
    }
    for (let i = 0; i < 6; i++) {
      await a.mouse.move(abox.x + 300 + i * 15, abox.y + 350 + i * 10);
      await ta.wait(120);
    }
    await a.waitForSelector(".collaborator-cursor", { timeout: 10000 }).catch(() => {});
    await b.waitForSelector(".collaborator-cursor", { timeout: 10000 }).catch(() => {});
    await ta.wait(400);
    await ta.snap("SC1-presence.png");
    await tb.snap("SC1-presence-b-editor.png");
    const n0 = await a.evaluate(() => window.design.getDocument().pages[0].nodes.length);
    await b.evaluate(() => window.design.addNode("text"));
    await a
      .waitForFunction((n) => window.design.getDocument().pages[0].nodes.length > n, n0, {
        timeout: 10000,
      })
      .catch(() => bugs.push("SC2: B → A edit did not arrive"));
    await ta.wait(400);
    await ta.snap("SC2-edit.png");
    const n1 = await b.evaluate(() => window.design.getDocument().pages[0].nodes.length);
    await a.evaluate(() => window.design.addNode("rectangle"));
    await b
      .waitForFunction((n) => window.design.getDocument().pages[0].nodes.length > n, n1, {
        timeout: 10000,
      })
      .catch(() => bugs.push("SC2: A → B edit did not arrive"));
    await tb.wait(400);
    await tb.snap("SC2-edit-b.png");
    // SC4: the owner removes the second account while it is connected.
    await ta.openShare();
    await ta.section("cloud-access-section", true);
    await ta.wait(300);
    await a.locator(`#cloud-members [data-remove-member="${OTHER.email}"]`).click();
    await b
      .waitForFunction(() => !window.cloudWorkspace.isConnected(), null, { timeout: 15000 })
      .catch(() => bugs.push("SC4: the removed member stayed connected"));
    await ta.wait(600);
    await ta.snap("SC4-removed-owner.png");
    await tb.wait(400);
    await tb.snap("SC4-removed.png");
    await tb.openShare();
    await tb.snap("SC4-removed-panel.png");
    await tb.closeShare();
    await ta.closeShare();

    /* ================= SW / SL4: workspace and links settings (owner desktop) ================= */
    await a.evaluate(() => window.appSettings.open("members"));
    await a.waitForSelector("#members-page", { timeout: 15000 }).catch(() => {});
    await ta.wait(1200);
    await ta.snap(
      "SW1-members.png",
      {},
      {
        ...SHARE,
        members: "#members-page",
        invite: "#members-invite",
        roomRole: "#members-room-role",
      },
    );
    await a.evaluate(() => window.appSettings.open("preferences"));
    await ta.wait(800);
    const linkPref = a.getByText(/Open Verynize links/i).first();
    if (await linkPref.count()) await linkPref.scrollIntoViewIfNeeded();
    await ta.wait(300);
    await ta.snap("SL4-preference.png");
    await a.evaluate(() => window.appSettings.close?.());
  } catch (e) {
    bugs.push("CAPTURE ABORTED: " + (e.stack || e.message));
    console.error(e);
  } finally {
    metrics._bugsObserved = bugs;
    // Local, throwaway secrets still never land in the repo: capability tokens, public ids, the random port.
    const scrub = (text) =>
      text
        .replace(/token=[0-9a-f]+/g, "token=<redacted>")
        .replace(/public=[0-9a-f.-]+/g, "public=<id>")
        .replace(/localhost:\d+/g, "localhost:<port>");
    await fs.writeFile(
      path.join(OUT, "metrics.json"),
      scrub(JSON.stringify(metrics, null, 2)) + "\n",
    );
    await browser?.close().catch(() => {});
    for (const app of apps) await app.close().catch(() => {});
    await proxy?.close().catch(() => {});
    await server?.stop().catch(() => {});
    if (KEEP) log("kept", tmp);
    else await fs.rm(tmp, { recursive: true, force: true });
    log("bugs/errors observed:", bugs.length);
    for (const b of bugs) console.log("  !", b);
  }
})();
