// Real Electron fetch failures and HTTP errors against the local Worker; no fetch stubs.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "@playwright/test";
import { Miniflare, cloudOptions, passwordUser } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "account-network-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
let app, proxy;
try {
  const server = (await mf.ready).origin;
  const session = await passwordUser(server, "network@example.test", "Network");
  const response = await fetch(server + "/api/me", { headers: { "x-verynize-session": session } });
  const { account } = await response.json();
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ env, args: [".", `--user-data-dir=${path.join(dir, "profile")}`] });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.accountStore);
  await page.evaluate(
    ({ server, session, account }) => {
      localStorage.setItem("verynize.cloud.account", JSON.stringify({ server, session, account }));
      window.dispatchEvent(new Event("cloud-account-changed"));
    },
    { server, session, account },
  );
  await page.waitForFunction(() => window.accountStore.ready());
  await page.evaluate(() => window.accountStore.flush());

  // Reads: no short polling, none after a write, and an unchanged feed costs a 304 without a body.
  const reads = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/me/state") && response.request().method() === "GET")
      reads.push({
        path: url.pathname + url.search,
        status: response.status(),
        etag: response.request().headers()["if-none-match"] || "",
      });
  });
  // A focus right after a read does not read again; the poll itself waits 30 s or more.
  await page.evaluate(() => window.accountStore.refresh());
  reads.length = 0;
  await new Promise((resolve) => setTimeout(resolve, 4000));
  assert.deepEqual(reads, [], "no reads while idle (the poll waits 30 s or more)");
  await page.evaluate(() => window.accountStore.put("preference:poll-test", 1));
  await page.evaluate(() => window.accountStore.flush());
  assert.deepEqual(reads, [], "a save needs no read afterwards");
  // The first read returns this window's own save and moves the cursor past it.
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.accountStore.refresh());
  assert.equal(reads.length, 3);
  for (const read of reads) assert.match(read.path, /^\/api\/me\/state\?chats=summary&since=\d+$/);
  assert.deepEqual(
    reads.map((read) => read.status),
    [200, 200, 304],
  );
  assert.equal(reads[1].path, reads[2].path);
  assert.match(reads[2].etag, /^"[0-9a-f]{32}"$/);
  console.log("PASS feed reads: no idle polling, no read after a save, 304 when unchanged");

  // Tab/window activation can deliver visibility and focus together. Concurrent explicit
  // refreshes also join the same GET rather than queuing another one behind it.
  reads.length = 0;
  await page.evaluate(() =>
    Promise.all([
      window.accountStore.refresh(),
      window.accountStore.refresh(),
      window.accountStore.refresh(),
    ]),
  );
  assert.equal(reads.length, 1, "concurrent readers share one feed request");
  await page.waitForTimeout(5100);
  reads.length = 0;
  await page.evaluate(async () => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    await window.accountStore.refresh();
  });
  assert.equal(reads.length, 1, "one feed read for a focus/visibility burst");
  console.log("PASS concurrent refresh and focus burst deduplicate feed reads");

  const writes = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/me/state/") && ["PUT", "POST"].includes(request.method()))
      writes.push({
        method: request.method(),
        path: new URL(request.url()).pathname,
        body: request.postDataJSON(),
      });
  });
  await page.evaluate(async () => {
    window.accountStore.setItem(
      "better-preferences",
      JSON.stringify({ "batch-a": 1, "batch-b": 2, "batch-c": 3 }),
    );
    await window.accountStore.flush();
  });
  assert.equal(writes.length, 1, "three preferences use exactly one network request");
  assert.equal(writes[0].path, "/api/me/state/batch");
  assert.equal(writes[0].body.writes.length, 3);
  const remote = await fetch(server + "/api/me/state/preference%3Abatch-a", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-verynize-session": session },
    body: JSON.stringify({ value: "10", revision: 1 }),
  });
  assert.equal(remote.status, 200);
  writes.length = 0;
  await page.evaluate(async () => {
    window.accountStore.setItem(
      "better-preferences",
      JSON.stringify({ "batch-a": 11, "batch-b": 12, "batch-c": 13 }),
    );
    await window.accountStore.flush();
  });
  assert.equal(writes.length, 2, "only the conflicting key needs a retry");
  assert.deepEqual(
    writes[1].body.writes.map((write) => write.key),
    ["preference:batch-a"],
  );
  const batchSaved = await (
    await fetch(server + "/api/me/state", { headers: { "x-verynize-session": session } })
  ).json();
  for (const [name, value, revision] of [
    ["a", "11", 3],
    ["b", "12", 2],
    ["c", "13", 2],
  ]) {
    const item = batchSaved.items.find((item) => item.key === "preference:batch-" + name);
    assert.equal(item.value, value);
    assert.equal(item.revision, revision);
  }
  console.log("PASS one batch for three preferences; one-key conflict preserves other writes");

  writes.length = 0;
  const guarded = await page.evaluate(async () => {
    for (let index = 0; index < 65; index++)
      window.accountStore.put("preference:split-" + index, index);
    const before = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(before);
    await window.accountStore.flush();
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    return [before.defaultPrevented, after.defaultPrevented];
  });
  assert.deepEqual(guarded, [true, false], "unload guard stays active until all writes finish");
  assert.deepEqual(
    writes.map((write) => write.body.writes.length),
    [64, 1],
  );
  console.log("PASS capped batches and pending-write unload guard");

  const attempts = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/me/state/batch") && request.method() === "POST")
      attempts.push(Date.now());
  });
  await page.context().setOffline(true);
  await page.evaluate(() => window.accountStore.put("preference:network-test", "retained"));
  await page.waitForFunction(() =>
    window.accountStore.status().error.includes("Can't reach Verynize"),
  );
  await new Promise((resolve) => setTimeout(resolve, 8500));
  assert.equal(
    attempts.length,
    4,
    "initial attempt plus exactly three retries; polling does not bypass backoff",
  );
  for (let i = 1; i < attempts.length; i++)
    assert.ok(attempts[i] - attempts[i - 1] >= 1000 * 2 ** (i - 1) - 100, "exponential backoff");
  assert.equal(await page.evaluate(() => window.accountStore.status().pending), 1);
  console.log("PASS network backoff and retained edit");

  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForFunction(
    () => !window.accountStore.status().pending && !window.accountStore.status().error,
  );
  const saved = await (
    await fetch(server + "/api/me/state", { headers: { "x-verynize-session": session } })
  ).json();
  assert.equal(
    saved.items.find((item) => item.key === "preference:network-test").value,
    '"retained"',
  );
  console.log("PASS reconnect saves the retained edit");

  // A real HTTP rollout proxy rejects just the new route; legacy PUTs reach the Worker.
  let batchStatus = 404;
  proxy = createServer(async (req, res) => {
    if (req.url === "/api/me/state/batch" && req.method === "POST") {
      req.resume();
      res.writeHead(batchStatus, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify({ error: "Older Worker" }));
      return;
    }
    const body = [];
    for await (const chunk of req) body.push(chunk);
    const upstream = await fetch(server + req.url, {
      method: req.method,
      headers: { "content-type": "application/json", "x-verynize-session": session },
      ...(["GET", "HEAD"].includes(req.method) ? {} : { body: Buffer.concat(body) }),
    });
    // fetch decodes compressed bodies; do not forward their original wire encoding/length.
    const headers = new Headers(upstream.headers);
    for (const name of ["content-encoding", "content-length", "transfer-encoding"])
      headers.delete(name);
    res.writeHead(upstream.status, Object.fromEntries(headers));
    res.end(Buffer.from(await upstream.arrayBuffer()));
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  await page.evaluate((server) => {
    const a = JSON.parse(localStorage.getItem("verynize.cloud.account"));
    a.server = server;
    localStorage.setItem("verynize.cloud.account", JSON.stringify(a));
    window.dispatchEvent(new Event("cloud-account-changed"));
  }, `http://127.0.0.1:${proxy.address().port}`);
  await page.waitForFunction(
    () => window.accountStore.ready() || window.accountStore.status().error,
  );
  assert.equal(await page.evaluate(() => window.accountStore.status().error), "");
  await page.evaluate(() => window.accountStore.flush());
  for (const status of [404, 405]) {
    batchStatus = status;
    writes.length = 0;
    await page.evaluate(async (status) => {
      window.accountStore.put("preference:rollout-a", status);
      window.accountStore.put("preference:rollout-b", status);
      await window.accountStore.flush();
    }, status);
    assert.deepEqual(
      writes.map((write) => write.method),
      ["POST", "PUT", "PUT"],
    );
  }
  await page.evaluate((server) => {
    const a = JSON.parse(localStorage.getItem("verynize.cloud.account"));
    a.server = server;
    localStorage.setItem("verynize.cloud.account", JSON.stringify(a));
    window.dispatchEvent(new Event("cloud-account-changed"));
  }, server);
  await page.waitForFunction(() => window.accountStore.ready());
  await page.evaluate(() => window.accountStore.flush());
  console.log("PASS fallback to per-key PUT on 404 and 405");

  await page.evaluate(() => {
    const a = JSON.parse(localStorage.getItem("verynize.cloud.account"));
    a.session = "invalid";
    localStorage.setItem("verynize.cloud.account", JSON.stringify(a));
    window.accountStore.put("preference:network-test", "http-error");
  });
  await page.waitForFunction(() =>
    window.accountStore.status().error.startsWith("Not saved to the database:"),
  );
  assert.doesNotMatch(await page.evaluate(() => window.accountStore.status().error), /Can't reach/);
  console.log("PASS HTTP error remains distinct");

  await page.context().setOffline(true);
  await page.evaluate(() => window.accountStore.put("preference:network-test", "cancelled"));
  await page.waitForFunction(() => window.accountStore.status().error.includes("Can't reach"));
  const before = attempts.length;
  await page.evaluate(() => {
    localStorage.removeItem("verynize.cloud.account");
    window.dispatchEvent(new Event("cloud-account-changed"));
  });
  await new Promise((resolve) => setTimeout(resolve, 1600));
  assert.equal(attempts.length, before, "sign out cancels scheduled retry");
  assert.equal(await page.evaluate(() => window.accountStore.status().pending), 0);
  console.log("PASS account change cancels retries");
} finally {
  if (app) await app.close();
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
