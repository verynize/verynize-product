// Electron: a signed-out SIWC connection shows one auth card. Continue with ChatGPT
// completes PKCE/OIDC through a local OAuth server; Retry sends the original message
// through the Codex process fixture. No real account, model request or ~/.codex edits.
const { _electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  createChatGPTProvider,
  connectElectronProvider,
} = require("./helpers/chatgpt-provider.cjs");
const { execFileSync } = require("node:child_process");

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-sign-in-ui-"));
  const bin = path.join(root, "bin"),
    codexHome = path.join(root, "codex-home"),
    log = path.join(root, "codex.log");
  const shots = process.env.VERYNIZE_SHOTS || path.join(root, "shots");
  await fs.mkdir(bin);
  await fs.mkdir(codexHome);
  await fs.mkdir(shots, { recursive: true });
  await fs.copyFile(path.join(__dirname, "fixtures/fake-codex.cjs"), path.join(bin, "codex"));
  await fs.chmod(path.join(bin, "codex"), 0o755);
  let realCodex = null;
  try {
    realCodex =
      execFileSync("/bin/sh", ["-c", "command -v codex"], { encoding: "utf8" }).trim() || null;
  } catch {}
  const env = {
    ...process.env,
    CODEX_HOME: codexHome,
    FAKE_CODEX_LOG: log,
    VERYNIZE_SKIP_ONBOARDING: "1",
  };
  if (!realCodex) env.PATH = bin + path.delimiter + process.env.PATH;
  delete env.ELECTRON_RUN_AS_NODE;
  if (!realCodex)
    await fs.writeFile(
      path.join(codexHome, "fake-account.json"),
      JSON.stringify({ account: null, requiresOpenaiAuth: true }),
    );
  console.log(
    `Signed-out account: ${realCodex ? "real codex " + realCodex : "fake codex"} with CODEX_HOME=${codexHome}`,
  );
  const provider = await createChatGPTProvider();
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${path.join(root, "profile")}`],
    timeout: 20000,
  });
  try {
    // After the first window: an evaluate while the main process is still starting up can lose its
    // result promise ("Resulting promise was garbage collected", seen on Linux CI).
    const page = await app.firstWindow({ timeout: 20000 });
    await connectElectronProvider(app, provider);
    await waitForUiReady(page);
    await page.waitForSelector("#project-toggle", { state: "attached" });
    await page.evaluate(() => window.agentWorkspace.openChat());
    await page.evaluate(() => window.agentWorkspace.setDefaults({ agent: "codex", access: "ask" }));
    const idle = () =>
      page.waitForFunction(() => !window.agentWorkspace.isBusy(), null, { timeout: 20000 });

    // 1. Signed out: one sign-in card, no thread, no raw 401, no duplicate error.
    const started = Date.now();
    await page.locator("#project-prompt").fill("Make a poster for a jazz night");
    await page.locator("#project-run").click();
    await page.locator(".chat-auth").waitFor({ timeout: 20000 });
    await idle();
    assert.ok(
      Date.now() - started < 15000,
      "the card comes from the pre-turn check, not after the retries",
    );
    assert.equal(await page.locator(".chat-auth").count(), 1, "exactly one sign-in card");
    assert.equal(await page.locator(".chat-error").count(), 0, "no raw error next to the card");
    const signIn = page.locator(".chat-auth-signin");
    assert.ok(await signIn.isVisible(), "the card has a Sign in button");
    assert.match(await signIn.textContent(), /Continue with ChatGPT/);
    const reply = await page.locator(".chat-message.assistant").last().textContent();
    assert.doesNotMatch(reply, /401|Unauthorized|Agent failed/);
    assert.match(reply, /signed out/);
    assert.equal(await page.locator(".chat-auth").getAttribute("data-auth-account"), "system");
    const state = await page.evaluate(() => window.agentWorkspace.getState?.());
    assert.ok(
      !state || !/thr-/.test(JSON.stringify(state.session || "")),
      "no Codex session was opened",
    );
    await page
      .locator(".chat-auth")
      .screenshot({ path: path.join(shots, "codex-sign-in-card.png") });
    await page.screenshot({ path: path.join(shots, "codex-sign-in-window.png") });

    // 2. Sign in through real SIWC HTTP/PKCE/JWKS against the local provider.
    await app.evaluate((_electron, prefix) => {
      process.env.PATH = prefix + process.env.PATH;
    }, bin + path.delimiter);
    await signIn.click();
    await page
      .locator(".chat-auth-retry")
      .filter({ hasText: "Retry" })
      .last()
      .waitFor({ timeout: 10000 });
    await page.waitForFunction(
      () => document.querySelector(".chat-auth")?.classList.contains("signed-in"),
      null,
      { timeout: 10000 },
    );
    assert.match(await page.locator(".chat-auth").textContent(), /Signed in to Codex/);
    await page
      .locator(".chat-auth")
      .screenshot({ path: path.join(shots, "codex-sign-in-card-signed-in.png") });
    const calls = (await fs.readFile(log, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    assert.equal(
      calls.some((c) => c.args?.join(" ") === "login"),
      false,
      "SIWC never invokes codex login",
    );
    const credential = JSON.parse(
      await fs.readFile(path.join(root, "profile/chatgpt/account.json"), "utf8"),
    );
    assert.match(credential.client_id, /^oaiapp_local_/);
    assert.equal(provider.calls.filter((c) => c.path.endsWith("/oauth/token")).length, 1);
    await page.locator(".chat-auth-retry").last().click();
    await page.waitForFunction(
      () =>
        /Reply to/.test(
          [...document.querySelectorAll(".chat-message.assistant")].at(-1)?.textContent || "",
        ),
      null,
      { timeout: 20000 },
    );
    await idle();
    assert.equal(
      await page.locator(".chat-auth").count(),
      0,
      "Retry replaced the signed-out reply",
    );
    assert.equal(
      await page.locator(".chat-message.user").count(),
      1,
      "the same message was sent again, not duplicated",
    );
    assert.match(
      await page.locator(".chat-message.assistant").last().textContent(),
      /Reply to .*jazz night/,
    );
    const after = (await fs.readFile(log, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    // Auto-title helper turns (agent-workdirs/titles) are not chat turns (same filter as tests/agent-chat.cjs).
    assert.equal(
      after.filter(
        (c) =>
          c.rpc === "turn/start" &&
          !/agent-workdirs[/\\]titles|word title for a design chat/.test(
            JSON.stringify(c.params || {}),
          ),
      ).length,
      1,
      "one chat turn, after signing in",
    );
    await page.screenshot({ path: path.join(shots, "codex-sign-in-retried.png") });
    console.log("codex sign-in UI ok; screenshots in " + shots);
  } finally {
    await app.close();
    await provider.close();
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
