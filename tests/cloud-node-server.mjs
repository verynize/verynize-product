// The Node runtime itself (npm run test:cloud:node): actor storage guarantees, and the production
// entry server/node.mjs started as an operator would (environment variables, one port).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import WebSocket from "ws";
import { openDatabase } from "../cloud/platform/node/sqlite.js";
import { SqlStorage } from "../cloud/platform/node/sql-storage.js";

const root = new URL("../", import.meta.url);
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-node-server-"));
const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---- actor storage: atomic turns and the output gate ----
{
  const file = path.join(dir, "actor.sqlite");
  const storage = new SqlStorage(openDatabase(file));
  const reader = openDatabase(file);
  storage.exec("CREATE TABLE t (k TEXT PRIMARY KEY, v INTEGER)");
  await tick();
  const sent = [];
  // One synchronous stretch: two writes, then a send.
  storage.exec("INSERT INTO t VALUES ('a', 1)");
  storage.exec("INSERT INTO t VALUES ('b', 2)");
  storage.gate(() => sent.push("ack"));
  assert.equal(
    storage.exec("SELECT COUNT(*) AS n FROM t").one().n,
    2,
    "a turn reads its own writes",
  );
  assert.equal(
    reader.prepare("SELECT COUNT(*) AS n FROM t").get().n,
    0,
    "nothing is visible before commit",
  );
  assert.deepEqual(sent, [], "the ack waits for the commit");
  await Promise.resolve();
  assert.equal(
    reader.prepare("SELECT COUNT(*) AS n FROM t").get().n,
    2,
    "committed at the next await",
  );
  assert.deepEqual(sent, ["ack"]);
  // A failed statement does not undo the turn's other writes (as on Cloudflare).
  storage.exec("UPDATE t SET v=10 WHERE k='a'");
  assert.throws(() => storage.exec("INSERT INTO t VALUES ('b', 3)"), /UNIQUE/);
  storage.commit();
  assert.equal(reader.prepare("SELECT v FROM t WHERE k='a'").get().v, 10);
  // Cursor shape.
  assert.equal(storage.exec("DELETE FROM t WHERE k='b'").rowsWritten, 1);
  assert.throws(() => storage.exec("SELECT * FROM t WHERE k='zzz'").one(), /exactly one/);
  assert.deepEqual([...storage.exec("SELECT k FROM t")], [{ k: "a" }]);
  storage.exec("CREATE TABLE b (x BLOB)");
  storage.exec("INSERT INTO b VALUES (?)", new Uint8Array([1, 2, 3]));
  assert.ok(
    storage.exec("SELECT x FROM b").one().x instanceof ArrayBuffer,
    "BLOBs read as ArrayBuffer",
  );
  storage.close();
  reader.close();
}

// ---- server/node.mjs ----
const dataDir = path.join(dir, "data");
const webRoot = path.join(dir, "web");
await fs.mkdir(path.join(webRoot, "src"), { recursive: true });
await fs.writeFile(path.join(webRoot, "index.html"), "<!doctype html><title>Verynize</title>");
await fs.writeFile(path.join(webRoot, "app.js"), "console.log('app')");
await fs.writeFile(path.join(webRoot, "src", "secret.tsx"), "export const source = 1;");
let child;
const logs = [];
async function start() {
  child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server/node.mjs"], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      PORT: "0",
      HOST: "127.0.0.1",
      DATA_DIR: dataDir,
      WEB_ROOT: webRoot,
      BETTER_AUTH_SECRET: "node-server-test-secret-not-for-production-000",
      ASSET_SIGNING_SECRET: "node-server-asset-secret-not-for-production",
      EMAIL_PROVIDER: "outbox",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  return await new Promise((resolve, reject) => {
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      logs.push(line);
      try {
        const { listening } = JSON.parse(line);
        if (listening) resolve(listening);
      } catch {}
    });
    child.once("exit", (code) => reject(new Error(`server exited (${code}): ${logs.join("")}`)));
  });
}
async function stop() {
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  assert.equal(await exited, 0, "graceful shutdown exits 0");
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages = [];
    ws.on("message", (data) => messages.push(JSON.parse(/** @type {Buffer} */ (data).toString())));
    ws.once("open", () => resolve({ ws, messages }));
    ws.once("unexpected-response", (_request, response) =>
      reject(new Error(`HTTP ${response.statusCode}`)),
    );
    ws.once("error", reject);
  });
}
const until = async (check, what) => {
  for (let i = 0; i < 200; i++) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${what}`);
};

try {
  let origin = await start();
  const page = await fetch(origin + "/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Verynize/);
  assert.equal(
    (await fetch(origin + "/app.js")).headers.get("content-type"),
    "text/javascript; charset=utf-8",
  );
  const source = await fetch(origin + "/src/secret.tsx");
  assert.doesNotMatch(await source.text(), /export const source/, "web/src is never served");
  const route = await fetch(origin + "/files/some/client/route");
  assert.equal(route.status, 200, "client routes fall back to index.html");
  assert.match(await route.text(), /<title>Verynize/);
  for (const escape of ["/%2e%2e/package.json", "/..%2fpackage.json", "/..%5cpackage.json"])
    assert.doesNotMatch(
      await (await fetch(origin + escape)).text(),
      /"name"/,
      `no file outside web/: ${escape}`,
    );
  assert.equal((await fetch(origin + "/api/nothing")).status, 404, "the API is Worker-first");

  // A spoofed CF-Connecting-IP does not escape the per-IP room-creation limit.
  const create = (ip) =>
    fetch(origin + "/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ document: { version: 2, name: "Node", pages: [] } }),
    });
  const room = await (await create("203.0.113.1")).json();
  assert.match(room.token, /^[0-9a-f]{64}$/);
  for (let i = 0; i < 9; i++) assert.equal((await create(`203.0.113.${i + 2}`)).status, 201);
  assert.equal((await create("198.51.100.7")).status, 429, "client-sent addresses are not trusted");

  // Socket on the same port; an op is acknowledged, broadcast, and survives a restart.
  const socketUrl = () =>
    `${origin.replace("http", "ws")}/api/rooms/${room.id}/socket?token=${room.token}&client=nodeclient`;
  const a = await connect(socketUrl());
  const b = await connect(socketUrl());
  await until(() => a.messages.find((m) => m.type === "snapshot"), "snapshot");
  a.ws.send(
    JSON.stringify({
      type: "ops",
      batch: 1,
      ops: [{ t: "doc", key: "name", value: "Renamed on Node" }],
    }),
  );
  const ack = await until(
    () => b.messages.find((m) => m.type === "ops" && m.batch === 1),
    "ops broadcast",
  );
  assert.equal(ack.revision, 1);
  assert.equal(
    (
      await until(
        () => b.messages.find((m) => m.type === "presence" && m.peers.length === 2),
        "presence",
      )
    ).peers.length,
    2,
  );
  const closed = new Promise((resolve) => a.ws.once("close", (code) => resolve(code)));
  await stop();
  assert.equal(await closed, 1001, "shutdown closes sockets with 1001");
  assert.ok(!logs.join("").includes(room.token), "tokens never reach the logs");
  assert.ok(!logs.join("").includes("node-server-test-secret"), "secrets never reach the logs");

  origin = await start();
  const after = await (
    await fetch(`${origin}/api/rooms/${room.id}`, {
      headers: { authorization: `Bearer ${room.token}` },
    })
  ).json();
  assert.equal(after.revision, 1);
  assert.equal(after.document.name, "Renamed on Node");
  const again = await connect(socketUrl());
  const welcome = await until(() => again.messages.find((m) => m.type === "welcome"), "welcome");
  assert.equal(welcome.acked, 1, "the client's acked batch survives the restart");
  again.ws.send(
    JSON.stringify({ type: "ops", batch: 1, ops: [{ t: "doc", key: "name", value: "Replayed" }] }),
  );
  const duplicate = await until(
    () => again.messages.find((m) => m.type === "ops"),
    "duplicate reply",
  );
  assert.equal(duplicate.duplicate, true, "a replayed batch after restart is a duplicate");
  again.ws.close();
  await stop();
  console.log(
    "PASS node server: atomic actor turns and output gate, static assets without web/src, SPA fallback, Worker-first API, untrusted client IP, sockets on one port, graceful 1001 shutdown, no secrets in logs, restart persistence and dedup",
  );
} finally {
  if (child && child.exitCode === null) child.kill("SIGKILL");
  await fs.rm(dir, { recursive: true, force: true });
}
