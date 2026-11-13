// Web crash reports (web-start/src/telemetry.ts) end to end: the Node build of the web app, built with a test DSN
// whose ingest requests Chromium intercepts. Off by default nothing is sent; once opted in (and reloaded) errors
// arrive scrubbed; opting out in another tab stops this tab at once.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWebServer } from "../web-start/node/server.mjs";
import { launchBrowser } from "./helpers/web-app.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = fs.mkdtempSync(path.join(os.tmpdir(), "verynize-web-telemetry-"));
if (!fs.existsSync(path.join(root, "web/dist/ui.js")))
  execFileSync(process.execPath, ["scripts/build-ui.cjs"], { cwd: root, stdio: "pipe" });
execFileSync(
  process.execPath,
  ["node_modules/vite-plus/bin/vp", "build", "-c", "vite.node.config.ts"],
  {
    cwd: root,
    stdio: "pipe",
    env: {
      ...process.env,
      WEB_NODE_OUT: dist,
      SENTRY_DSN_WEB: "https://0123456789abcdef0123456789abcdef@sentry.invalid/1",
      SENTRY_ENVIRONMENT: "test",
      SENTRY_AUTH_TOKEN: "",
      // Only release builds bake a DSN (web-start/build/telemetry.mjs).
      VERYNIZE_RELEASE_BUILD: "1",
    },
  },
);

const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const requests = [];
const events = () =>
  requests.flatMap((body) => {
    const lines = body.split("\n").filter(Boolean);
    const out = [];
    for (let i = 1; i + 1 < lines.length; i += 2)
      if (JSON.parse(lines[i]).type === "event") out.push(JSON.parse(lines[i + 1]));
    return out;
  });
const messageOf = (event) => event.exception?.values?.[0]?.value || event.message || "";
const raise = (page, message) =>
  page.evaluate((text) => {
    setTimeout(() => {
      throw new Error(text);
    });
  }, message);
async function waitFor(check, label, timeout = 15000) {
  for (const deadline = Date.now() + timeout; !check(); await sleep(100))
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
}
const runtime = (page) =>
  page.evaluate(() => {
    const telemetry = globalThis.verynizeTelemetry;
    return telemetry ? { available: telemetry.available, active: telemetry.active } : null;
  });

const web = await createWebServer({ dist });
let browser;
try {
  const origin = `http://127.0.0.1:${await listen(web)}`;
  browser = await launchBrowser();
  const context = await browser.newContext();
  await context.route("https://sentry.invalid/**", async (route) => {
    requests.push(route.request().postData() || "");
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  const open = async () => {
    const page = await context.newPage();
    await page.goto(origin + "/");
    await page.waitForFunction(() => !!globalThis.verynizeTelemetry);
    return page;
  };

  // Off by default: the build has a DSN, but nothing starts or is sent.
  const page = await open();
  assert.deepEqual(await runtime(page), { available: true, active: false });
  await raise(page, "web off alice@example.dev");
  await sleep(1500);
  assert.deepEqual(requests, [], "nothing is sent before the visitor opts in");

  // Opted in: reports start on the next load, scrubbed.
  await page.evaluate(() => localStorage.setItem("verynize:telemetry", "on"));
  await page.reload();
  await page.waitForFunction(() => globalThis.verynizeTelemetry?.active === true);
  await raise(page, "web on alice@example.dev /Users/alice/Designs?token=abcd1234efgh");
  await waitFor(
    () => events().some((event) => messageOf(event).startsWith("web on ")),
    "the opted-in error event",
  );
  const event = events().find((item) => messageOf(item).startsWith("web on "));
  assert.equal(event.environment, "test");
  assert.equal(event.user, undefined);
  assert.equal(event.tags?.surface, "web");
  assert.match(messageOf(event), /<email>/);
  assert.match(messageOf(event), /\/Users\/<user>\/Designs/);
  const raw = requests.join("\n");
  for (const value of ["alice@example.dev", "/Users/alice", "abcd1234efgh"])
    assert.ok(!raw.includes(value), `no envelope contains ${value}`);

  // Opting out in another tab (Settings writes the same localStorage key) stops this tab too.
  const other = await open();
  await other.evaluate(() => localStorage.setItem("verynize:telemetry", "off"));
  await raise(page, "web cross-tab");
  await sleep(2000);
  assert.equal(
    events().filter((item) => messageOf(item).startsWith("web cross-tab")).length,
    0,
    "no event after another tab opted out",
  );
  await page.waitForFunction(() => globalThis.verynizeTelemetry?.active === false);
  console.log(
    "PASS web crash reports: off by default, scrubbed once on, opt-out applies across tabs",
  );
} finally {
  await browser?.close();
  web.closeAllConnections?.();
  web.close();
  fs.rmSync(dist, { recursive: true, force: true });
}
