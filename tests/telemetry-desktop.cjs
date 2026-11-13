// Desktop crash reports (desktop/telemetry.cjs, desktop/preload.cjs, web/src/telemetry.ts, Settings › Preferences ›
// Privacy) against a local ingest server standing in for Sentry (a loopback DSN: automated runs never report
// anywhere else). Off by default: errors in main and renderer send nothing. Opting in takes effect after a restart;
// then both processes' errors arrive, with emails, home paths, the username and tokens scrubbed, and a crashed render
// window becomes an event. Opting out stops sending at once. Outside automated runs, the user is asked once after setup.
const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");

const { version } = require("../package.json");
const REAL_HOME = os.homedir();
const REAL_USER = os.userInfo().username;

/** A minimal Sentry ingest: every envelope body, decompressed. */
function startIngest() {
  const envelopes = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body = Buffer.concat(chunks);
      const encoding = req.headers["content-encoding"];
      if (encoding === "gzip") body = zlib.gunzipSync(body);
      else if (encoding === "deflate") body = zlib.inflateSync(body);
      else if (encoding === "br") body = zlib.brotliDecompressSync(body);
      if (/\/envelope\/?$/.test(new URL(req.url, "http://x").pathname))
        envelopes.push(body.toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, envelopes, port: server.address().port }),
    ),
  );
}

/** Event items ({type: "event"}) across envelopes. */
function events(envelopes) {
  const out = [];
  for (const envelope of envelopes) {
    const lines = envelope.split("\n");
    for (let i = 1; i < lines.length - 1; i++) {
      let header;
      try {
        header = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (header?.type === "event") out.push(JSON.parse(lines[i + 1]));
    }
  }
  return out;
}

const messageOf = (event) => event.exception?.values?.map((value) => value.value).join(" ") ?? "";

async function waitFor(check, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw Error(`Timed out waiting for ${label}`);
}

async function launch(profile, env) {
  const app = await electron.launch({
    env,
    args: [".", `--user-data-dir=${profile}`],
    timeout: 20000,
  });
  const page = await app.firstWindow({ timeout: 20000 });
  await waitForUiReady(page);
  return { app, page };
}

async function openPrivacySettings(page) {
  await page.waitForSelector("#shell-settings", { state: "attached" });
  await page.locator(".app-menu-trigger:visible").first().click();
  await page.locator("#shell-settings").click();
  await page.locator("#settings-nav button").filter({ hasText: "Preferences" }).click();
  const toggle = page.locator("#settings-telemetry-toggle");
  await toggle.scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => !document.querySelector("#settings-telemetry-toggle")?.hasAttribute("disabled"),
  );
  return toggle;
}

/** One renderer error (uncaught, from a timer) and one main-process unhandled rejection, both full of personal data. */
async function raiseErrors(app, page, home, tag) {
  const text = `${tag} alice@example.dev /Users/alice/Designs/site.verynize.json ${home}/secret.txt ${REAL_HOME}/x token=abcd1234efgh`;
  await page.evaluate((message) => {
    setTimeout(() => {
      throw new Error(`renderer ${message}`);
    });
  }, text);
  await app.evaluate((_electron, message) => {
    setTimeout(() => {
      // Deliberately unhandled: the test checks how the main process reports it.
      void Promise.reject(new Error(`main ${message}`));
    });
  }, text);
}

(async () => {
  const ingest = await startIngest();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "telemetry-desktop-"));
  const profile = path.join(dir, "profile");
  // HOME is a fixture directory: its path is one of the literals main replaces.
  const home = path.join(dir, "home-of-telemetry-user");
  await fs.mkdir(home, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    VERYNIZE_SKIP_ONBOARDING: "1",
    VERYNIZE_LAUNCH_EDITOR: "1",
    SENTRY_DSN_DESKTOP: `http://0123456789abcdef0123456789abcdef@127.0.0.1:${ingest.port}/1`,
    SENTRY_TRACES_SAMPLE_RATE: "0",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SENTRY_ENVIRONMENT;
  let session;
  try {
    // 0. The one-time question after first-run setup (not in automated runs: VERYNIZE_SKIP_ONBOARDING).
    const interactive = { ...env };
    delete interactive.VERYNIZE_SKIP_ONBOARDING;
    for (const choice of ["deny", "allow"]) {
      const asked = path.join(dir, `profile-ask-${choice}`);
      session = await launch(asked, interactive);
      await session.page.locator("#onboarding").waitFor();
      assert.equal(await session.page.locator("#telemetry-prompt").count(), 0, "not during setup");
      await session.page.evaluate(() => localStorage.setItem("verynize.onboarding", "done"));
      await session.page.reload();
      await waitForUiReady(session.page);
      await session.page.locator("#telemetry-prompt").waitFor();
      await session.page.locator(`#telemetry-prompt-${choice}`).click();
      await session.page.locator("#telemetry-prompt").waitFor({ state: "detached" });
      assert.equal(
        JSON.parse(await fs.readFile(path.join(asked, "telemetry.json"), "utf8")).enabled,
        choice === "allow",
      );
      await session.page.reload();
      await waitForUiReady(session.page);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.equal(await session.page.locator("#telemetry-prompt").count(), 0, "asked once");
      await session.app.close();
      session = null;
    }
    assert.deepEqual(ingest.envelopes, [], "answering sends nothing in that session");

    // 1. Default: off. Errors in both processes send nothing.
    session = await launch(profile, env);
    assert.equal(await session.page.locator("#telemetry-prompt").count(), 0);
    assert.deepEqual(await session.page.evaluate(() => window.desktop.telemetry.get()), {
      enabled: false,
      active: false,
      available: true,
      restartRequired: false,
      asked: false,
    });
    assert.equal(await session.page.evaluate(() => window.verynizePlatform.can("telemetry")), true);
    await raiseErrors(session.app, session.page, home, "off");
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.deepEqual(ingest.envelopes, [], "nothing is sent before the user opts in");

    // Opting in from Settings › Preferences › Privacy; it starts after a restart.
    let toggle = await openPrivacySettings(session.page);
    assert.equal(await toggle.getAttribute("aria-checked"), "false", "off by default");
    await toggle.click();
    await session.page.waitForFunction(
      () =>
        document.querySelector("#settings-telemetry-toggle")?.getAttribute("aria-checked") ===
        "true",
    );
    await session.page.getByText("Restart Verynize to start sending reports.").waitFor();
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(profile, "telemetry.json"), "utf8")).enabled,
      true,
    );
    await session.app.close();
    session = null;
    assert.deepEqual(ingest.envelopes, [], "nothing is sent in the session that opted in");

    // 2. After a restart: main and renderer errors arrive, scrubbed.
    session = await launch(profile, env);
    assert.equal((await session.page.evaluate(() => window.desktop.telemetry.get())).active, true);
    await raiseErrors(session.app, session.page, home, "on");
    const has = (prefix) =>
      events(ingest.envelopes).some((event) => messageOf(event).startsWith(`${prefix} on `));
    await waitFor(() => has("main") && has("renderer"), "the main and renderer error events");
    const received = events(ingest.envelopes);
    const renderer = received.find((event) => messageOf(event).startsWith("renderer on "));
    const main = received.find((event) => messageOf(event).startsWith("main on "));
    assert.equal(
      renderer.tags?.["event.process"],
      "renderer",
      "renderer events come through main over IPC",
    );
    for (const event of [renderer, main]) {
      assert.equal(event.release, `verynize-desktop@${version}`);
      assert.equal(event.user, undefined);
      assert.equal(event.server_name, undefined);
      assert.match(messageOf(event), /<email>/);
      assert.match(messageOf(event), /\/Users\/<user>\/Designs/);
      assert.match(messageOf(event), /token=<redacted>/);
    }
    // Process loss: a crashed render window is an event named `render` with its reason; its page and dump stay home.
    await session.app.evaluate(async ({ BrowserWindow }) => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { partition: "render-telemetry-test" },
      });
      win.webContents.session.protocol.handle(
        "verynize-render",
        () =>
          new Response("<p>render window copy</p>", { headers: { "content-type": "text/html" } }),
      );
      await win.loadURL("verynize-render://document/");
      win.webContents.forcefullyCrashRenderer();
    });
    const textOf = (event) =>
      typeof event.message === "string" ? event.message : (event.message?.formatted ?? "");
    const lost = () =>
      events(ingest.envelopes).find((event) =>
        /^'render' process exited with '(crashed|killed)'$/.test(textOf(event)),
      );
    await waitFor(() => lost(), "the render window's crash event");
    assert.equal(lost().contexts?.electron?.crashed_process, "render");
    // forcefullyCrashRenderer() reports `killed` on macOS and `crashed` elsewhere: both are events now.
    assert.match(lost().contexts?.electron?.reason, /^(crashed|killed)$/);
    assert.equal(typeof lost().contexts.electron.exit_code, "number");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    assert.ok(
      !events(ingest.envelopes).some(
        (event) =>
          event.tags?.["event.process"] === "render" &&
          event.tags?.["event.environment"] === "native",
      ),
      "no native dump of a render window",
    );
    const raw = ingest.envelopes.join("\n");
    assert.ok(!raw.includes("render window copy"), "the render page's content never leaves");
    const forbidden = ["alice@example.dev", "/Users/alice", home, REAL_HOME, "abcd1234efgh"];
    if (REAL_USER.length >= 5) forbidden.push(REAL_USER);
    for (const value of forbidden) assert.ok(!raw.includes(value), `no envelope contains ${value}`);

    // 3. Opting out stops sending at once.
    toggle = await openPrivacySettings(session.page);
    assert.equal(await toggle.getAttribute("aria-checked"), "true");
    await toggle.click();
    await session.page.waitForFunction(
      () =>
        document.querySelector("#settings-telemetry-toggle")?.getAttribute("aria-checked") ===
        "false",
    );
    assert.equal((await session.page.evaluate(() => window.desktop.telemetry.get())).active, false);
    const before = events(ingest.envelopes).length;
    await raiseErrors(session.app, session.page, home, "opted-out");
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.equal(events(ingest.envelopes).length, before, "no event after opting out");
    console.log(`desktop crash reports: ${received.length} scrubbed events, none while off`);
  } finally {
    await session?.app.close().catch(() => {});
    ingest.server.close();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
