// The opt-in Nitro build of the web app (vite.nitro.config.ts, web-start/nitro/backend.mjs), with
// real processes only (`npm run test:web:nitro`):
//
// node-server preset (dist/web-nitro/server/index.mjs, its own process):
// - against the real Node backend (server/node.mjs, its own process): room creation, Better Auth
//   sign-up → emailed verification → sign-in → bearer session, and a room WebSocket end to end
//   (snapshot, ops acknowledged and broadcast to a second socket);
// - against a stub backend: several Set-Cookie headers (the real backend never sets cookies),
//   a streamed response arriving chunk by chunk, a client abort reaching the backend, a streamed
//   request body;
// - static files: exactly the web/ allowlist of web-start/build/legacy-web.mjs plus Start's chunks,
//   deep links render the shell, unknown paths 404, /index.html 302, the editor boots in Chromium;
// - no VERYNIZE_BACKEND_URL: backend paths answer 502, upgrades are refused.
//
// vercel preset: builds .vercel/output and checks config.json routes (backend paths are CDN
// rewrites to VERYNIZE_BACKEND_URL ahead of the filesystem and of Start's function).
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { publicWebFiles } from "../web-start/build/legacy-web.mjs";
import { WORKER_PATH_PATTERNS, isWorkerPath } from "../web-start/worker-paths.mjs";
import { freePort, launchBrowser, openStarterFile, signedInContext } from "./helpers/web-app.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = path.join(root, "dist/web-nitro");
const vp = path.join(root, "node_modules/vite-plus/bin/vp");
const timings = {};
const time = async (name, run) => {
  const started = performance.now();
  try {
    return await run();
  } finally {
    timings[name] = Math.round(performance.now() - started);
  }
};

if (!fs.existsSync(path.join(root, "web/dist/ui.js")))
  execFileSync(process.execPath, ["scripts/build-ui.cjs"], { cwd: root, stdio: "pipe" });
const build = (env) =>
  execFileSync(process.execPath, [vp, "build", "-c", "vite.nitro.config.ts"], {
    cwd: root,
    stdio: "pipe",
    env: { ...process.env, ...env },
  });
await time("build node-server (ms)", () => build({ NITRO_PRESET: "node-server" }));

const children = [];
/** Spawn `args` and resolve with the first stdout line matching `ready` (its first group). */
function spawnReady(args, env, ready) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { PATH: process.env.PATH, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stderr.on("data", (chunk) => (output += chunk));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ready line:\n${output}`)), 30000);
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      output += line + "\n";
      const match = line.match(ready);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once("exit", (code) => reject(new Error(`exited (${code}):\n${output}`)));
  });
}

async function startNitro(backend) {
  const port = await freePort();
  const started = performance.now();
  await spawnReady(
    ["dist/web-nitro/server/index.mjs"],
    { PORT: String(port), HOST: "127.0.0.1", ...(backend && { VERYNIZE_BACKEND_URL: backend }) },
    /Listening on: (\S+)/,
  );
  timings["nitro start to listening (ms)"] ??= Math.round(performance.now() - started);
  return `http://127.0.0.1:${port}`;
}

// ---- stub backend: cookies, streaming, abort ----
let streamRelease;
let aborted;
const abortSeen = new Promise((resolve) => (aborted = resolve));
const stub = http.createServer((req, res) => {
  if (req.url === "/api/cookies") {
    res.writeHead(200, { "set-cookie": ["a=1; Path=/", "b=2; Path=/; HttpOnly"] });
    return res.end("ok");
  }
  if (req.url === "/api/stream") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("first\n");
    streamRelease = () => res.end("second\n");
    return;
  }
  if (req.url === "/api/hang") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: open\n\n");
    res.on("close", () => aborted(performance.now()));
    return;
  }
  if (req.url === "/api/upload") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => res.end(JSON.stringify({ bytes: Buffer.concat(chunks).length })));
    return;
  }
  res.writeHead(404).end();
});
await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
const stubOrigin = `http://127.0.0.1:${stub.address().port}`;

// ---- real backend: server/node.mjs ----
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "verynize-web-nitro-"));
const backendOrigin = await spawnReady(
  ["--disable-warning=ExperimentalWarning", "server/node.mjs"],
  {
    PORT: "0",
    HOST: "127.0.0.1",
    DATA_DIR: dataDir,
    BETTER_AUTH_SECRET: "web-nitro-test-secret-not-for-production-0000",
    ASSET_SIGNING_SECRET: "web-nitro-asset-secret-not-for-production",
    EMAIL_PROVIDER: "outbox",
  },
  /"listening":"([^"]+)"/,
);

let browser;
try {
  const origin = await startNitro(backendOrigin);
  const viaStub = await startNitro(stubOrigin);
  const bare = await startNitro();
  const get = (base, route, init) => fetch(base + route, { redirect: "manual", ...init });

  // ---- static files and Start routes ----
  for (const route of ["/", "/editor", "/code", "/settings/x"]) {
    const response = await get(origin, route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get("content-type"), /text\/html/, route);
    assert.doesNotMatch(await response.text(), /id="canvas"/, `${route}: shell only`);
  }
  for (const route of ["/no-such-page", "/src/ui.tsx", "/storage-migration.html", "/README.md"])
    assert.equal((await get(origin, route)).status, 404, route);
  const index = await get(origin, "/index.html?x=1");
  assert.equal(index.status, 302);
  assert.equal(new URL(index.headers.get("location"), origin).pathname, "/");
  for (const escape of ["/%2e%2e/package.json", "/..%2fpackage.json", "/..%5cpackage.json"])
    assert.doesNotMatch(await (await get(origin, escape)).text(), /"name"/, escape);
  const css = await get(origin, "/style.css");
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);
  const font = await get(origin, "/assets/fonts/inter-latin-400-normal.woff2");
  assert.equal(font.status, 200);
  assert.equal(
    font.headers.get("cache-control"),
    "no-cache",
    "stable font names are not immutable",
  );
  // The published files are exactly the web/ allowlist plus Start's hashed client chunks.
  const published = fs
    .readdirSync(path.join(dist, "public"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(path.join(dist, "public"), path.join(entry.parentPath, entry.name)),
    )
    .map((file) => file.split(path.sep).join("/"));
  const startChunks = published.filter((file) => /^assets\/[^/]+-[\w-]{8}\.(js|css)$/.test(file));
  assert.ok(startChunks.length > 0, "Start client chunks are published");
  assert.deepEqual(
    published.filter((file) => !startChunks.includes(file)).sort(),
    publicWebFiles(path.join(root, "web")),
  );
  const chunk = await get(origin, "/" + startChunks[0]);
  assert.equal(chunk.headers.get("cache-control"), "public, max-age=31536000, immutable");

  // ---- real backend: rooms, auth, WebSocket ----
  const json = async (response, status) => {
    const text = await response.text();
    assert.equal(response.status, status, text);
    return text ? JSON.parse(text) : null;
  };
  const post = (route, body, headers = {}) =>
    get(origin, route, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const room = await json(
    await post("/api/rooms", { document: { version: 2, name: "Nitro", pages: [] } }),
    201,
  );
  assert.match(room.token, /^[0-9a-f]{64}$/);
  assert.equal((await get(origin, "/api/nothing")).status, 404, "the backend answers its 404s");

  const email = "nitro@example.com";
  const password = "correct horse battery staple";
  await json(await post("/api/auth/sign-up/email", { email, password, name: "Nitro" }), 200);
  const [verification] = (
    await json(await get(origin, "/api/dev/outbox?to=" + encodeURIComponent(email)), 200)
  ).messages;
  const link = new URL(verification.link);
  const verified = await get(origin, link.pathname + link.search);
  assert.ok([200, 302].includes(verified.status), await verified.text());
  const signIn = await post("/api/auth/sign-in/email", { email, password });
  const bearer = signIn.headers.get("set-auth-token");
  assert.equal(signIn.status, 200);
  assert.ok(bearer, "set-auth-token passes through");
  assert.match(signIn.headers.get("access-control-expose-headers"), /set-auth-token/);
  const session = await json(
    await get(origin, "/api/auth/get-session", { headers: { authorization: `Bearer ${bearer}` } }),
    200,
  );
  assert.equal(session.user.email, email);

  const connect = (url) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const messages = [];
      ws.on("message", (data) =>
        messages.push(JSON.parse(/** @type {Buffer} */ (data).toString())),
      );
      ws.once("open", () => resolve({ ws, messages }));
      ws.once("unexpected-response", (_request, response) =>
        reject(new Error(`HTTP ${response.statusCode}`)),
      );
      ws.once("error", reject);
    });
  const until = async (check, what) => {
    for (let i = 0; i < 250; i++) {
      const value = check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${what}`);
  };
  const socketUrl = (base, client) =>
    `${base.replace("http", "ws")}/api/rooms/${room.id}/socket?token=${room.token}&client=${client}`;
  const a = await time("room socket open via Nitro (ms)", () =>
    connect(socketUrl(origin, "nitroa")),
  );
  const b = await connect(socketUrl(origin, "nitrob"));
  await until(() => a.messages.find((m) => m.type === "snapshot"), "snapshot");
  a.ws.send(
    JSON.stringify({ type: "ops", batch: 1, ops: [{ t: "doc", key: "name", value: "Via Nitro" }] }),
  );
  const broadcast = await until(
    () => b.messages.find((m) => m.type === "ops" && m.batch === 1),
    "ops broadcast",
  );
  assert.equal(broadcast.revision, 1);
  await until(() => a.messages.find((m) => m.type === "ops" && m.batch === 1), "own ack");
  a.ws.close();
  b.ws.close();
  const stored = await json(
    await get(origin, `/api/rooms/${room.id}`, {
      headers: { authorization: `Bearer ${room.token}` },
    }),
    200,
  );
  assert.equal(JSON.stringify(stored).includes("Via Nitro"), true, "the op was persisted");
  // Upgrades outside backend paths are refused.
  await assert.rejects(connect(origin.replace("http", "ws") + "/editor"), /HTTP 404/);

  // ---- stub backend: cookies, streaming, abort, request body ----
  const cookies = await get(viaStub, "/api/cookies");
  assert.deepEqual(cookies.headers.getSetCookie(), ["a=1; Path=/", "b=2; Path=/; HttpOnly"]);

  const stream = await get(viaStub, "/api/stream");
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  const first = await time("first streamed chunk (ms)", () => reader.read());
  assert.equal(decoder.decode(first.value), "first\n", "the first chunk arrives before the end");
  streamRelease();
  let rest = "";
  for (let part = await reader.read(); !part.done; part = await reader.read())
    rest += decoder.decode(part.value);
  assert.equal(rest, "second\n");

  const controller = new AbortController();
  const hang = await get(viaStub, "/api/hang", { signal: controller.signal });
  const hangReader = hang.body.getReader();
  assert.match(decoder.decode((await hangReader.read()).value), /data: open/);
  const abortedAt = performance.now();
  controller.abort();
  const closedAt = await Promise.race([
    abortSeen,
    new Promise((_, reject) => setTimeout(() => reject(new Error("abort not propagated")), 5000)),
  ]);
  timings["client abort to backend close (ms)"] = Math.round(closedAt - abortedAt);

  const upload = await get(viaStub, "/api/upload", {
    method: "POST",
    body: Buffer.alloc(3 * 1024 * 1024, 1),
  });
  assert.deepEqual(await upload.json(), { bytes: 3 * 1024 * 1024 });

  // ---- no backend configured ----
  assert.equal((await get(bare, "/api/rooms")).status, 502);
  assert.equal((await get(bare, "/editor")).status, 200);
  await assert.rejects(connect(bare.replace("http", "ws") + "/api/rooms/x/socket"), /HTTP 404/);

  // ---- the editor boots (signed in: the web app shows its sign-in screen otherwise) ----
  browser = await launchBrowser();
  // A real account on the real backend, through the Nitro proxy (outbox email provider).
  const { passwordUser } = await import("./cloud-harness.mjs");
  const token = await passwordUser(origin, "nitro@example.test", "Nitro");
  const me = await (
    await get(origin, "/api/me", { headers: { "x-verynize-session": token } })
  ).json();
  const context = await signedInContext(browser, origin, { session: token, ...me });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/editor");
  await page.waitForFunction(() => document.documentElement.dataset.legacyEditor === "ready");
  await page.waitForFunction(() => document.documentElement.dataset.uiReady === "true", null, {
    timeout: 20000,
  });
  // A fresh profile has no file and lands on Files; open one to see the canvas.
  await openStarterFile(page, { detached: true });
  await page.waitForSelector("#canvas .layer");
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  for (const child of children) child.kill("SIGTERM");
  stub.closeAllConnections();
  stub.close();
}

// ---- vercel preset: build output and routes ----
const vercelOutput = path.join(root, ".vercel/output");
assert.throws(
  () => build({ NITRO_PRESET: "vercel", VERYNIZE_BACKEND_URL: "" }),
  /VERYNIZE_BACKEND_URL/,
  "the vercel preset needs the backend origin at build time",
);
const backendForVercel = "https://backend.example.test";
await time("build vercel (ms)", () =>
  build({ NITRO_PRESET: "vercel", VERYNIZE_BACKEND_URL: backendForVercel }),
);
const config = JSON.parse(fs.readFileSync(path.join(vercelOutput, "config.json"), "utf8"));
assert.equal(config.version, 3);
const filesystem = config.routes.findIndex((route) => route.handle === "filesystem");
assert.ok(filesystem > 0);
assert.deepEqual(config.routes.at(-1), { src: "/(.*)", dest: "/__server" });
const rewrites = config.routes.slice(0, filesystem).filter((route) => route.dest);
assert.equal(rewrites.length, WORKER_PATH_PATTERNS.length, "one CDN rewrite per backend pattern");
/** Where Vercel's router sends `pathname` (before the filesystem: rewrites; else Start). */
const destination = (pathname) => {
  for (const route of rewrites) {
    const match = pathname.match(new RegExp(route.src));
    if (match) return route.dest.replace(/\$(\d)/g, (_, i) => match[i] ?? "");
  }
  return "start";
};
for (const pathname of [
  "/api/rooms",
  "/api/rooms/r1/socket",
  "/api/ai/chat",
  "/u/someone",
  "/apps/a/index.html",
  "/account/settings",
  "/passkey",
  "/passkey.js",
])
  assert.equal(destination(pathname), backendForVercel + pathname, pathname);
for (const pathname of [
  "/",
  "/editor",
  "/code",
  "/settings/x",
  "/passkeys",
  "/style.css",
  "/user",
]) {
  assert.equal(isWorkerPath(pathname), false);
  assert.equal(destination(pathname), "start", pathname);
}
const staticDir = path.join(vercelOutput, "static");
for (const excluded of ["src", "index.html", "storage-migration.html"])
  assert.equal(fs.existsSync(path.join(staticDir, excluded)), false, excluded);
assert.ok(fs.existsSync(path.join(staticDir, "dist/ui.js")));
const vcConfig = JSON.parse(
  fs.readFileSync(path.join(vercelOutput, "functions/__server.func/.vc-config.json"), "utf8"),
);
assert.equal(vcConfig.launcherType, "Nodejs");
assert.equal(vcConfig.supportsResponseStreaming, true);
assert.equal(
  fs.existsSync(path.join(vercelOutput, "functions/api")),
  false,
  "the Build Output contains no api/server function: backend paths must leave the project",
);

const serverBytes = fs
  .readdirSync(path.join(dist, "server"), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .reduce((sum, entry) => sum + fs.statSync(path.join(entry.parentPath, entry.name)).size, 0);
timings["node-server bundle (KiB)"] = Math.round(serverBytes / 1024);
console.log(JSON.stringify(timings));
console.log(
  "PASS web (Nitro): node-server preset serves the web/ allowlist and Start routes, forwards backend HTTP (cookies, streaming, abort, auth) and room WebSockets to a real backend; vercel preset routes backend paths ahead of Start",
);
