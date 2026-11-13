// First-run onboarding of the desktop app (web/src/islands/onboarding): create a Verynize account
// against local workerd (verification through the outbox), sign in, then "Bring your own agent"
// with a scripted Claude CLI and local SIWC provider: Claude already signed in, Codex
// connects through PKCE/OIDC from the page, Cursor coming soon. Completion is remembered; skipping works too.
import { testElectronArgs } from "./helpers/electron-args.cjs";
import { Miniflare } from "miniflare";
import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createChatGPTProvider, connectElectronProvider } from "./helpers/chatgpt-provider.cjs";
import { cloudOptions } from "./cloud-harness.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-onboarding-"));
const mf = new Miniflare(await cloudOptions(path.join(dir, "state")));
const apps = [];
const provider = await createChatGPTProvider();
try {
  const server = (await mf.ready).origin;
  const home = path.join(dir, "home");
  const bin = path.join(dir, "bin");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(bin, { recursive: true });
  const script = async (name, body) => {
    await fs.writeFile(path.join(bin, name), `#!/bin/sh\n${body}\n`);
    await fs.chmod(path.join(bin, name), 0o755);
  };
  await script(
    "claude",
    `if [ "$1" = auth ] && [ "$2" = status ]; then echo '{"loggedIn":true,"authMethod":"claude.ai","email":"ana@claude.test","subscriptionType":"pro"}'; exit 0; fi
exit 0`,
  );
  // Codex login is owned by SIWC; this fixture only advertises an installed CLI.
  await script("codex", "exit 0");
  const launch = async (profile, extra = {}) => {
    const env = { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin` };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VERYNIZE_SKIP_ONBOARDING;
    // Onboarding shows the production default but this run must never reach it (desktop/cloud-defaults.cjs).
    env.VERYNIZE_BLOCK_PRODUCTION_CLOUD = "1";
    delete env.VERYNIZE_CLOUD_SERVER;
    Object.assign(env, extra);
    const app = await electron.launch({
      executablePath: (await import("electron")).default,
      env,
      args: testElectronArgs([".", `--user-data-dir=${path.join(dir, profile)}`]),
      timeout: 20000,
    });
    apps.push(app);
    const page = await app.firstWindow({ timeout: 20000 });
    // Restrict discovery to fixture binaries; a host Homebrew install must not
    // turn the missing-agent case into a real CLI account lookup.
    await app.evaluate((_electron, bin) => {
      const require = process
        .getBuiltinModule("module")
        .createRequire(process.cwd() + "/package.json");
      const { AgentTools, providerAccounts } = require("./desktop/agent-tools.cjs");
      const fs = require("node:fs/promises"),
        path = require("node:path");
      AgentTools.prototype.accounts = function () {
        return providerAccounts({
          home: this.home,
          siwc: this.siwc,
          lookup: async (name) => {
            const file = path.join(bin, name);
            try {
              await fs.access(file, 1);
              return file;
            } catch {
              return null;
            }
          },
        });
      };
    }, bin);

    if (profile === "first") await connectElectronProvider(app, provider);
    await page.waitForFunction(() => !!window.cloudAccount);
    return { app, page };
  };

  const { page } = await launch("first");
  await page.waitForSelector("#onboarding[data-step=account]");
  // Point at the local server and create an account.
  await page.locator("#onboarding-server-edit").click();
  await page.locator("#onboarding-server").fill(server);
  await page.locator("#onboarding-email").click();
  await page.locator("#onboarding-mode").click();
  await page.locator("#onboarding-name").fill("Ana Desktop");
  await page.locator("#onboarding-email").fill("ana@example.test");
  await page.locator("#onboarding-password").fill("short");
  await page.locator("#onboarding-submit").click();
  assert.equal(
    await page.locator("#onboarding-password").evaluate((input) => input.validity.tooShort),
    true,
    "the form refuses passwords under 10 characters",
  );
  assert.equal(await page.locator("#onboarding-verify").count(), 0);
  await page.locator("#onboarding-password").fill("a long enough password");
  await page.locator("#onboarding-submit").click();
  await page.waitForSelector("#onboarding-verify");
  // Signing in before verifying explains what to do.
  await page.locator("#onboarding-verified").click();
  await page.locator("#onboarding-password").fill("a long enough password");
  await page.locator("#onboarding-submit").click();
  await page.waitForSelector("#onboarding-error");
  assert.match(await page.locator("#onboarding-error").textContent(), /Verify your email first/);
  const { messages } = await (await fetch(`${server}/api/dev/outbox?to=ana%40example.test`)).json();
  const link = new URL(messages.find((m) => /Verify/.test(m.subject)).link);
  await fetch(server + link.pathname + link.search, { redirect: "manual" });
  await page.locator("#onboarding-submit").click();
  await page.waitForSelector("#onboarding[data-step=agents]");
  const signedIn = await page.evaluate(() => window.cloudAccount.get());
  assert.equal(signedIn.account.email, "ana@example.test");
  assert.equal(signedIn.server, server);
  assert.ok(signedIn.personalOrganizationId);

  // Agents: Claude is signed in, Codex connects from here, Cursor is not available yet.
  await page.waitForSelector('[data-agent=claude] [data-status="connected"]');
  assert.match(await page.locator("[data-agent=claude]").textContent(), /ana@claude\.test/);
  assert.match(await page.locator("[data-agent=cursor]").textContent(), /Coming soon/);
  await page.locator('[data-agent=codex] [data-status="signed-out"]').click();
  await page.waitForSelector('[data-agent=codex] [data-status="connected"]', { timeout: 15000 });
  assert.equal(await page.locator("#onboarding-continue").textContent(), "Continue");
  await page.locator("#onboarding-continue").click();
  await page.waitForSelector("#onboarding", { state: "detached" });
  // Completion is remembered across reloads; wait for the new account writes first.
  await page.evaluate(async () => {
    await window.cloudWorkspace.storeFile(window.fileLibrary.currentId);
    await window.cloudWorkspace.flush();
    await window.accountStore.flush();
  });
  await page.reload();
  await page.waitForFunction(() => !!window.cloudAccount && !!window.design);
  await page.waitForTimeout(500);
  assert.equal(await page.locator("#onboarding").count(), 0);
  assert.equal(
    await page.evaluate(() => window.cloudWorkspace.account()?.email),
    "ana@example.test",
  );

  // A second profile skips the account and finds no agents connected.
  await fs.rm(path.join(bin, "claude"));
  const second = (await launch("second")).page;
  await second.waitForSelector("#onboarding[data-step=account]");
  await second.locator("#onboarding-skip").click();
  await second.waitForSelector("#onboarding[data-step=agents]");
  await second.waitForSelector('[data-agent=claude] [data-status="missing"]');
  await second.waitForSelector('[data-agent=codex] [data-status="signed-out"]');
  assert.equal(
    await second.locator("#onboarding-continue").textContent(),
    "Continue without an agent",
  );
  await second.locator("#onboarding-continue").click();
  await second.waitForSelector("#onboarding", { state: "detached" });
  assert.equal(await second.evaluate(() => window.cloudAccount.get()), null);

  // Automated runs opt out entirely.
  const skipped = (await launch("skipped", { VERYNIZE_SKIP_ONBOARDING: "1" })).page;
  await skipped.waitForFunction(() => !!window.design);
  await skipped.waitForTimeout(500);
  assert.equal(await skipped.locator("#onboarding").count(), 0);

  console.log(
    "PASS desktop onboarding: account creation with verification, sign-in, server choice, agents (signed in, connect from the page, missing CLI, coming soon), completion remembered, skip account, opt-out",
  );
} finally {
  await provider.close();
  for (const app of apps) await app.close().catch(() => {});
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
