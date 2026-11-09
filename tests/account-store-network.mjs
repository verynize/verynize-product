// Real Electron fetch failures and HTTP errors against the local Worker; no fetch stubs.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "@playwright/test";
import { Miniflare, cloudOptions, passwordUser } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "account-network-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
let app;
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

  const attempts = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/me/state/preference%3Anetwork-test") &&
      request.method() === "PUT"
    )
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
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
