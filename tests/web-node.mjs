// Smoke test of the Node build of the web app (vite.node.config.ts + web-start/node/server.mjs):
// it serves /editor and the legacy editor boots in Chromium once signed in (signed out, the sign-in
// screen shows and the editor does not boot); web/ files are served and web/src is not; backend
// paths and room WebSocket upgrades are forwarded to VERYNIZE_BACKEND_URL (a stub backend here);
// without a backend they answer 502. The real backend's sign-in is covered by tests/web-ai-chat.mjs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createWebServer } from "../web-start/node/server.mjs";
import { launchBrowser, openStarterFile, signedInContext } from "./helpers/web-app.mjs";
import { checkWebRouter } from "./helpers/web-router.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = fileURLToPath(new URL("../dist/web-node", import.meta.url));
if (!fs.existsSync(new URL("../web/dist/ui.js", import.meta.url)))
  execFileSync(process.execPath, ["scripts/build-ui.cjs"], { cwd: root, stdio: "pipe" });
if (!process.env.TEST_WEB_NODE_BUILT)
  execFileSync(
    process.execPath,
    ["node_modules/vite-plus/bin/vp", "build", "-c", "vite.node.config.ts"],
    {
      cwd: root,
      stdio: "pipe",
    },
  );

// The signed-in account (the web app needs one) and the account reads the editor makes, answered
// like the real backend with an empty workspace.
const ACCOUNT = {
  id: "a1",
  email: "node@example.test",
  handle: "node",
  displayName: "Node",
  avatarUrl: "",
};
const ACCOUNT_API = {
  "/api/me": { account: ACCOUNT, personalOrganizationId: "org-1", aiSetupAt: 1 },
  "/api/me/rooms": { rooms: [] },
  "/api/auth/organization/list": [
    { id: "org-1", name: "Personal", slug: "personal-a1", metadata: { personal: true } },
  ],
  "/api/orgs/org-1/rooms": { role: "owner", rooms: [] },
  "/api/ai/config": { enabled: false, provider: "openrouter", models: [], defaultModel: null },
};
// Stub backend: answers the account reads above, otherwise echoes HTTP requests, and speaks just
// enough WebSocket to send one text frame.
const backend = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const account = req.method === "GET" && ACCOUNT_API[req.url];
    if (account) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(account));
    }
    res.writeHead(200, { "content-type": "application/json", "set-cookie": ["a=1", "b=2"] });
    res.end(JSON.stringify({ method: req.method, url: req.url, host: req.headers.host, body }));
  });
});
const upgraded = new Set();
backend.on("upgrade", (req, socket) => {
  upgraded.add(socket);
  const accept = createHash("sha1")
    .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const text = Buffer.from(JSON.stringify({ type: "hello", url: req.url }));
  socket.write(Buffer.concat([Buffer.from([0x81, text.length]), text]));
  socket.on("error", () => {});
});
const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

let browser;
const backendPort = await listen(backend);
const web = await createWebServer({ dist, backend: `http://127.0.0.1:${backendPort}` });
const bare = await createWebServer({ dist });
try {
  const origin = `http://127.0.0.1:${await listen(web)}`;
  const get = (route, init) => fetch(origin + route, { redirect: "manual", ...init });

  for (const route of ["/", "/editor", "/settings/preferences"]) {
    const response = await get(route);
    assert.equal(response.status, 200, route);
    assert.doesNotMatch(await response.text(), /id="canvas"/, route);
  }
  const css = await get("/style.css");
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);
  const font = await get("/assets/fonts/inter-latin-400-normal.woff2");
  assert.equal(font.status, 200);
  assert.equal(font.headers.get("cache-control"), "no-cache");
  for (const route of ["/src/ui.tsx", "/storage-migration.html", "/no-such-page"])
    assert.equal((await get(route)).status, 404, route);
  assert.equal((await get("/index.html")).status, 302);

  const echoed = await get("/api/rooms?x=1", { method: "POST", body: "payload" });
  assert.equal(echoed.status, 200);
  assert.deepEqual(echoed.headers.getSetCookie(), ["a=1", "b=2"]);
  assert.deepEqual(await echoed.json(), {
    method: "POST",
    url: "/api/rooms?x=1",
    host: `127.0.0.1:${backendPort}`,
    body: "payload",
  });
  assert.equal((await (await get("/u/someone")).json()).url, "/u/someone");

  const message = await new Promise((resolve, reject) => {
    const ws = new WebSocket(origin.replace("http", "ws") + "/api/rooms/r1/socket?token=t");
    const timer = setTimeout(
      () => reject(new Error("no message through the proxied socket")),
      5000,
    );
    ws.onerror = () => reject(new Error("proxied socket failed"));
    ws.onmessage = (event) => {
      clearTimeout(timer);
      ws.close();
      resolve(JSON.parse(event.data));
    };
  });
  assert.deepEqual(message, { type: "hello", url: "/api/rooms/r1/socket?token=t" });

  const bareOrigin = `http://127.0.0.1:${await listen(bare)}`;
  assert.equal((await fetch(bareOrigin + "/api/rooms")).status, 502);
  assert.equal((await fetch(bareOrigin + "/editor")).status, 200);

  browser = await launchBrowser();
  const errors = [];
  // Signed out: the sign-in screen, at the requested path, and no editor.
  const anonymous = await browser.newPage();
  anonymous.on("pageerror", (error) => errors.push(error.message));
  await anonymous.goto(origin + "/code");
  await anonymous.waitForFunction(() => document.documentElement.dataset.webAuth === "signed-out");
  await anonymous.locator("#web-sign-in #onboarding-email").waitFor();
  assert.equal(
    await anonymous.evaluate(() => document.documentElement.dataset.legacyEditor ?? null),
    null,
  );
  assert.equal(new URL(anonymous.url()).pathname, "/code");
  await anonymous.close();
  // Signed in.
  const context = await signedInContext(
    browser,
    origin,
    {
      session: `${"a".repeat(32)}.${"b".repeat(32)}`,
      account: ACCOUNT,
    },
    { aiSetupDone: false },
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const reads = [];
  page.on("request", (request) => {
    if (request.method() === "GET") reads.push(new URL(request.url()).pathname);
  });
  const count = (path) => reads.filter((read) => read === path).length;
  await page.goto(origin + "/editor");
  await page.waitForFunction(() => document.documentElement.dataset.legacyEditor === "ready");
  await page.waitForFunction(() => document.documentElement.dataset.uiReady === "true", null, {
    timeout: 20000,
  });
  // No file of its own: a fresh profile lands on Files until the user opens or makes one.
  await page.waitForFunction(() => location.pathname === "/" && !window.fileLibrary.currentId);
  await page.waitForFunction(() =>
    window.__bdQueryCache().some(({ key, data }) => key[3] === "rooms" && data),
  );
  await page.waitForTimeout(300);
  assert.equal(count("/api/me"), 1, "auth and onboarding share one /api/me at boot");
  assert.equal(count("/api/me/rooms"), 1, "Home loads rooms once");
  assert.equal(count("/api/orgs/org-1/rooms"), 0, "no redundant organization rooms request");
  assert.equal(count("/api/auth/organization/list"), 1, "one organization list at boot");
  await openStarterFile(page, { detached: true });
  await page.evaluate(() => window.fileLibrary.showHome());
  await page.waitForFunction(() => location.pathname === "/");
  await page.waitForTimeout(300);
  // The detached-file helper reloads the entire shell. Warm Home in that new shell,
  // then opening the existing file and returning must use the same query cache.
  const roomsAfterCreate = count("/api/me/rooms");
  const organizationsAfterCreate = count("/api/auth/organization/list");
  await page.evaluate(() => window.fileLibrary.open(window.fileLibrary.list()[0].id));
  await page.waitForFunction(() => location.pathname.startsWith("/editor/"));
  await page.evaluate(() => window.fileLibrary.showHome());
  await page.waitForFunction(() => location.pathname === "/");
  await page.waitForTimeout(300);
  assert.equal(
    count("/api/me/rooms"),
    roomsAfterCreate,
    "quick editor → Home return uses fresh rooms",
  );
  assert.equal(
    count("/api/auth/organization/list"),
    organizationsAfterCreate,
    "Home remount uses fresh organizations",
  );
  const refreshed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/me/rooms",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("cloud-files-changed")));
  await refreshed;
  assert.equal(
    count("/api/me/rooms"),
    roomsAfterCreate + 1,
    "local mutations invalidate fresh rooms immediately",
  );
  await page.evaluate(() => window.fileLibrary.open(window.fileLibrary.list()[0].id));
  assert.equal(
    await page.evaluate(() => window.shellRouter.state.location.pathname),
    await page.evaluate(() => "/editor/" + encodeURIComponent(window.fileLibrary.currentId)),
  );
  await page.waitForSelector("#canvas .layer");
  const before = await page.locator("#canvas .layer").count();
  await page.locator(".app-menu-trigger:visible").first().click();
  await page.locator("#rectangle").click();
  assert.equal(await page.locator("#canvas .layer").count(), before + 1);
  assert.deepEqual(errors, []);
  await page.close();
  await checkWebRouter(browser, origin, context);
  console.log(
    "PASS web (Node build): sign-in screen while signed out, /editor boots client-only once signed in, one router (clicks, Back/Forward, deep links, room fragment), static web/ files without web/src, /api and room WebSocket forwarded to the backend",
  );
} finally {
  await browser?.close();
  for (const socket of upgraded) socket.destroy();
  for (const server of [web, bare, backend]) {
    server.closeAllConnections?.();
    server.close();
  }
}
