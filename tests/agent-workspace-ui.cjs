// Electron end-to-end: Settings › Accounts (named account + isolated browser sign-in), Settings › Tools
// (Verynize MCP server + permission default), Settings › Projects (history-preserving moves on real temp git
// repositories), the global search dialog (open a hit in the Code workspace), the chat Autonomy panel against
// tests/fixtures/fake-codex.cjs (auto-approve + transcript notice), and the template gallery / shared
// component library. Provider CLIs are scripted fixtures; no account or model is used.
const { _electron } = require("@playwright/test");
const { mod } = require("./helpers/keys.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const git = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, ...args], { env: GIT_ENV, encoding: "utf8" });

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-workspace-ui-")));
  const bin = path.join(root, "bin"),
    profile = path.join(root, "profile"),
    log = path.join(root, "codex.log"),
    claudeLog = path.join(root, "claude.log");
  await fs.mkdir(bin);
  await fs.mkdir(profile);
  await fs.copyFile(path.join(__dirname, "fixtures/fake-codex.cjs"), path.join(bin, "codex"));
  await fs.chmod(path.join(bin, "codex"), 0o755);
  // Claude Code stand-in: `auth login` signs the account in by writing its own config into CLAUDE_CONFIG_DIR.
  await fs.writeFile(
    path.join(bin, "claude"),
    `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2),dir=process.env.CLAUDE_CONFIG_DIR||'';
fs.appendFileSync(${JSON.stringify(claudeLog)},JSON.stringify({args,dir})+'\\n');
const file=dir&&path.join(dir,'.claude.json');
if(args.join(' ')==='auth status --json'){const ok=!!file&&fs.existsSync(file);console.log(JSON.stringify({loggedIn:ok,authMethod:'claude.ai',email:ok?'client@example.com':undefined,subscriptionType:ok?'pro':undefined}));process.exit(0);}
if(args.join(' ')==='auth login'){console.log('Opening your browser…');setTimeout(()=>{if(file)fs.writeFileSync(file,JSON.stringify({oauthAccount:{emailAddress:'client@example.com'}}));process.exit(0);},300);}
else if(args.join(' ')==='auth logout'){if(file)fs.rmSync(file,{force:true});process.exit(0);}
else process.exit(0);
`,
  );
  await fs.chmod(path.join(bin, "claude"), 0o755);

  // Two registered projects (real git repositories).
  const alpha = path.join(root, "alpha"),
    beta = path.join(root, "beta");
  for (const [dir, files] of [
    [
      alpha,
      { "src/app.js": 'export const marker = "orbitSearchToken";\n', "README.md": "# alpha\n" },
    ],
    [beta, { "index.html": "<h1>beta</h1>\n" }],
  ]) {
    await fs.mkdir(dir);
    git(dir, "init", "-q", "-b", "main");
    for (const [file, text] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await fs.writeFile(path.join(dir, file), text);
    }
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "initial");
  }
  await fs.writeFile(
    path.join(profile, "repositories.json"),
    JSON.stringify({
      version: 1,
      repositories: [
        { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "alpha", root: alpha, addedAt: 1 },
        { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "beta", root: beta, addedAt: 2 },
      ],
      worktrees: [],
    }),
  );

  const env = {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    FAKE_CODEX_LOG: log,
    VERYNIZE_DISABLE_AGENT_USAGE: "1",
    VERYNIZE_WORKSPACES_DIR: path.join(root, "workspaces"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  await require("./helpers/chatgpt-provider.cjs").seedChatGPTAccount(profile);
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${profile}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await page.waitForFunction(
      () => !!window.appSettings && !!window.designTemplates && !!window.agentWorkspace,
    );

    // 1. Accounts: add a named Claude Code account and sign it in through the CLI browser flow (isolated folder).
    await page.evaluate(() => window.appSettings.open("accounts"));
    await page.locator('[data-account="system"][data-agent="claude"]').waitFor();
    await page.locator("#accounts-add-name-claude").fill("Client");
    await page.locator("#accounts-add-claude").click();
    const row = page.locator('[data-agent="claude"][data-account]').filter({ hasText: "Client" });
    await row.waitFor();
    const accountId = await row.getAttribute("data-account");
    assert.match(accountId, /^[a-f0-9]{16}$/);
    const accountDir = path.join(profile, "agent-profiles", "claude", accountId);
    assert.equal((await fs.stat(accountDir)).mode & 0o777, 0o700);
    await row.locator('[data-action="signin"]').click();
    await page.waitForFunction(
      (id) => document.querySelector(`[data-account="${id}"]`)?.dataset.signedIn === "true",
      accountId,
      { timeout: 10000 },
    );
    assert.match(
      await row.locator('[data-role="account-status"]').textContent(),
      /client@example\.com/,
    );
    const claudeCalls = (await fs.readFile(claudeLog, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(
      claudeCalls.find((c) => c.args.join(" ") === "auth login").dir,
      accountDir,
      "browser sign-in ran with the isolated config folder",
    );
    assert.ok(
      claudeCalls
        .filter((c) => c.args.join(" ") === "auth status --json")
        .some((c) => c.dir === ""),
      "This Mac's login was checked without the folder",
    );
    await row.locator('[data-action="make-default"]').click();
    await page.waitForFunction(
      (id) => /Default/.test(document.querySelector(`[data-account="${id}"]`)?.textContent || ""),
      accountId,
    );
    assert.equal(
      JSON.parse(await fs.readFile(path.join(profile, "agent-profiles.json"), "utf8")).defaults
        .claude,
      accountId,
    );

    // 2. Tools: a stdio MCP server with a secret env value (never shown again) and a permission default.
    await page.locator('#settings-nav [data-section="tools"]').click();
    await page.locator('#tools-server-form [name="toolName"]').fill("notes");
    await page.locator('#tools-server-form [name="toolCommand"]').fill("notes-mcp --stdio");
    await page.locator('#tools-server-form [name="toolEnv"]').fill("NOTES_KEY=very-secret-value");
    await page.locator("#tools-server-save").click();
    await page.locator('[data-tool-server="notes"]').waitFor();
    assert.match(
      await page.locator('[data-tool-server="notes"]').textContent(),
      /notes-mcp --stdio[\s\S]*env: NOTES_KEY/,
    );
    assert.doesNotMatch(await page.locator("#settings-screen").textContent(), /very-secret-value/);
    await page.locator('[name="permissionTool"]').fill("WebFetch");
    await page.locator('[name="permissionDecision"]').selectOption("deny");
    await page.locator("#tools-permission-add").click();
    await page.locator('[data-permission="WebFetch"]').waitFor();
    const stored = JSON.parse(
      await fs.readFile(path.join(profile, "agent-tool-config.json"), "utf8"),
    );
    assert.deepEqual(
      stored.servers.map((s) => [s.name, s.command, s.args, s.env]),
      [["notes", "notes-mcp", ["--stdio"], { NOTES_KEY: "very-secret-value" }]],
    );
    assert.deepEqual(stored.permissions, [
      { tool: "WebFetch", decision: "deny", scope: "global", project: null },
    ]);
    await page.locator('[data-tool-server="notes"] [role="switch"]').click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-tool-server="notes"] [role="switch"]')
          ?.getAttribute("aria-checked") === "false",
    );

    // 3. Projects: move a file inside alpha (committed git mv), rename beta's folder.
    await page.locator('#settings-nav [data-section="projects"]').click();
    const alphaRow = page.locator('[data-project="alpha"]');
    await alphaRow.locator('[data-action="move-inside"]').click();
    await alphaRow.locator('[name="movePath"]').fill("src/app.js");
    await alphaRow.locator('[name="moveDestination"]').fill("lib/app.js");
    await alphaRow.locator('[data-action="confirm-move"]').click();
    await page.waitForFunction(
      () => !document.querySelector('[data-project="alpha"] [name="movePath"]'),
    );
    assert.equal(git(alpha, "log", "-1", "--format=%s").trim(), "Move src/app.js to lib/app.js");
    assert.deepEqual(
      git(alpha, "log", "--follow", "--format=%s", "--", "lib/app.js").trim().split("\n"),
      ["Move src/app.js to lib/app.js", "initial"],
    );
    const betaRow = page.locator('[data-project="beta"]');
    await betaRow.locator('[data-action="rename"]').click();
    await betaRow.locator('[name="projectName"]').fill("beta-site");
    await betaRow.locator('[data-action="confirm-move"]').click();
    await page.locator('[data-project="beta-site"]').waitFor();
    await fs.access(path.join(root, "beta-site", ".git"));
    const registry = JSON.parse(await fs.readFile(path.join(profile, "repositories.json"), "utf8"));
    assert.equal(
      registry.repositories.find((r) => r.name === "beta-site").root,
      path.join(root, "beta-site"),
    );

    // 4. Global search across projects; a hit opens in the Code workspace editor.
    await page.locator("#projects-search-open").click();
    await page.locator("#global-search-input").fill("orbitSearchToken");
    await page.locator("#global-search-run").click();
    const hit = page.locator('[data-search-hit="lib/app.js:1"]');
    await hit.waitFor();
    assert.equal(
      await page.locator("#global-search-results").getAttribute("data-engine"),
      "ripgrep",
    );
    assert.equal(
      await page.locator("#global-search-results").getAttribute("data-ripgrep"),
      "bundled",
      "the bundled @vscode/ripgrep is preferred",
    );
    assert.equal(await page.locator('[data-search-project="alpha"]').count(), 1);
    await hit.click();
    await page.waitForFunction(() => document.body.classList.contains("code-mode"));
    await page
      .waitForFunction(
        () => /orbitSearchToken/.test(document.querySelector("#code-editor")?.value || ""),
        null,
        { timeout: 15000 },
      )
      .catch(async (error) => {
        console.error(
          await page.evaluate(() =>
            JSON.stringify({
              s: window.agentWorkspace.getState(),
              ed: !!document.querySelector("#code-editor"),
              status: document.body.innerText.slice(0, 3000),
            }),
          ),
        );
        throw error;
      });
    await page.keyboard.press(mod("Shift+F"));
    await page.locator("#global-search").waitFor();
    await page.keyboard.press("Escape");

    // 5. Chat autonomy: auto-approve a shell command, max turns; the transcript shows the run's autonomy.
    await page.evaluate(() => {
      window.appSettings.close?.();
      window.agentWorkspace.setCodeMode?.(false);
      window.agentWorkspace.openChat();
    });
    await page.evaluate(() => window.agentWorkspace.setDefaults({ agent: "codex", access: "ask" }));
    await page.waitForFunction(() => !!window.agentWorkspace.getState().conversationId);
    await page.locator("#chat-autonomy").click();
    await page.locator("#autonomy-auto").fill("shell: ls");
    await page.locator("#autonomy-turns").fill("5");
    await page.locator("#autonomy-denied").fill("WebSearch");
    await page.locator("#autonomy-save").click();
    await page.waitForFunction(
      () => document.querySelector("#chat-autonomy")?.dataset.active === "true",
    );
    await page.locator("#project-prompt").fill("please approve listing");
    await page.locator("#project-run").click();
    await page.waitForFunction(
      () => window.agentWorkspace.getUsage().completed === 1 && !window.agentWorkspace.isBusy(),
      null,
      { timeout: 15000 },
    );
    const reply = page.locator(".chat-message.assistant").last();
    assert.match(await reply.textContent(), /declined=false/);
    assert.equal(
      await page.locator('.chat-message.assistant [data-chat-notice="autonomy"]').count(),
      1,
    );
    assert.match(
      await page.locator('[data-chat-notice="autonomy"]').textContent(),
      /Autonomy: Ask access · max 5 turns · denied: WebSearch · 1 auto-approve rule/,
    );
    await reply.locator(".chat-thinking summary").first().click();
    assert.match(
      await reply.locator('[data-chat-notice="policy"][data-decision="allow"]').textContent(),
      /Auto-approved: shell matching “ls”/,
    );
    const autonomyFile = JSON.parse(
      await fs.readFile(path.join(profile, "agent-autonomy.json"), "utf8"),
    );
    assert.deepEqual(Object.values(autonomyFile.chats)[0], {
      allowedTools: [],
      deniedTools: ["WebSearch"],
      autoApprove: [{ tool: "shell", match: "ls" }],
      maxTurns: 5,
      maxBudgetUsd: null,
      planFirst: false,
    });
    const launches = (await fs.readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse)
      .filter((l) => l.args?.[0] === "app-server" && !l.args.includes("--help"));
    assert.ok(
      launches.length >= 1 &&
        launches.every((l) => !l.args.some((a) => a.includes("mcp_servers.notes"))),
      "a disabled Verynize server is not passed",
    );

    // 6. Templates and the shared component library.
    await page.evaluate(() => {
      window.agentWorkspace.closeChat();
      window.fileLibrary.showEditor();
      const doc = window.designTemplates.create("landing");
      window.design.setDocument(doc);
    });
    const ids = await page.evaluate(() => {
      const nodes = window.design.getDocument().pages[0].nodes;
      return {
        frame: nodes.find((n) => n.name === "Desktop").id,
        button: nodes.find((n) => n.name === "Primary button").id,
      };
    });
    const prompt = async (value) => {
      await page.locator("#text-prompt-input").fill(value);
      await page.locator("#text-prompt-ok").click();
    };
    await page.evaluate((id) => window.design.setSelection([id]), ids.button);
    await page.evaluate(() => window.designTemplates.open());
    await page.locator("#component-add").click();
    await prompt("Pill button");
    await page.waitForFunction(() => window.designTemplates.library.list().length === 1);
    await page.locator('[data-template-category="components"]').click();
    const comp = page.locator("[data-component]");
    assert.equal(await comp.count(), 1);
    assert.match(await comp.textContent(), /Pill button[\s\S]*Version 1 · 1 in this file/);
    await comp.locator('[data-action="insert"]').click();
    const instance = await page.evaluate(() => window.design.getSelection()[0]);
    assert.notEqual(instance, ids.button);
    await page.evaluate((id) => window.design.updateNodes([id], { color: "#123456" }), instance);
    await page.evaluate(() => window.designTemplates.open());
    await page.locator("#component-publish").click();
    await page.waitForFunction(() => window.designTemplates.library.list()[0].version === 2);
    await page.locator("#component-update-instances").click();
    await page.waitForFunction(() =>
      /Updated 1 instance/.test(document.getElementById("template-status").textContent),
    );
    const original = await page.evaluate(
      (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id),
      ids.button,
    );
    assert.equal(original.color, "#123456");
    assert.deepEqual(original.libraryComponent.version, 2);

    // Save the selection as a template; search, categories, preview, use.
    await page.evaluate((id) => window.design.setSelection([id]), ids.frame);
    await page.locator('[data-template-category="all"]').click();
    await page.locator("#template-save-selection").click();
    await prompt("Hero block");
    await page.locator("[data-user-template]").waitFor();
    await page.locator("#template-search").fill("hero");
    assert.equal(await page.locator("[data-user-template]").isVisible(), true);
    assert.equal(await page.locator('[data-template="dashboard"]').isVisible(), false);
    await page.locator("#template-search").fill("");
    await page.locator('[data-template-category="presentation"]').click();
    assert.equal(await page.locator("[data-user-template]").isVisible(), false);
    assert.equal(await page.locator('[data-template="presentation"]').isVisible(), true);
    await page.locator('[data-template-category="mine"]').click();
    await page.locator('[data-user-template] [data-action="preview"]').click();
    assert.ok((await page.locator("#template-preview-art svg rect").count()) > 5);
    const before = await page.evaluate(() => window.fileLibrary.list().length);
    await page.locator("#template-preview-use").click();
    await page.waitForFunction((n) => window.fileLibrary.list().length === n + 1, before);
    assert.equal(await page.evaluate(() => window.design.getDocument().pages[0].nodes.length), 11);

    // Export a pack, clear the library, import it back through the file picker.
    const pack = await page.evaluate(() => window.designTemplates.exportPack());
    assert.equal(pack.format, "verynize-template-pack");
    assert.deepEqual([pack.templates.length, pack.components.length], [1, 1]);
    const packFile = path.join(root, "pack.json");
    await fs.writeFile(packFile, JSON.stringify(pack));
    await page.evaluate(() => {
      localStorage.removeItem("verynize-user-templates");
      localStorage.removeItem("verynize-component-library");
      window.designTemplates.open();
    });
    await page.locator("#template-import-file").setInputFiles(packFile);
    await page.waitForFunction(() =>
      /Imported 1 templates and 1 components/.test(
        document.getElementById("template-status").textContent,
      ),
    );
    assert.equal(await page.evaluate(() => window.designTemplates.library.list()[0].version), 2);
    // .zip pack: manifest + documents + the embedded image stored as an asset, imported back through the picker.
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await page.evaluate((src) => {
      const list = JSON.parse(localStorage.getItem("verynize-user-templates"));
      list[0].document.pages[0].nodes.push({
        id: "img-asset",
        type: "image",
        name: "Logo",
        x: 1,
        y: 1,
        w: 8,
        h: 8,
        parentId: null,
        src,
      });
      localStorage.setItem("verynize-user-templates", JSON.stringify(list));
    }, png);
    const zipBytes = await page.evaluate(async () => [
      ...(await window.designTemplates.exportZip()),
    ]);
    assert.deepEqual(zipBytes.slice(0, 2), [0x50, 0x4b]);
    const zipFile = path.join(root, "pack.zip");
    await fs.writeFile(zipFile, Buffer.from(zipBytes));
    assert.match(
      execFileSync("unzip", ["-l", zipFile], { encoding: "utf8" }),
      /manifest\.json[\s\S]*templates\/t1\.verynize\.json[\s\S]*assets\/[a-f0-9]{32}\.png/,
    );
    await page.evaluate(() => {
      localStorage.removeItem("verynize-user-templates");
      localStorage.removeItem("verynize-component-library");
      window.designTemplates.open();
    });
    await page.locator("#template-import-file").setInputFiles(zipFile);
    await page.waitForFunction(() =>
      /Imported 1 templates and 1 components/.test(
        document.getElementById("template-status").textContent,
      ),
    );
    const restored = await page.evaluate(
      () =>
        window.designTemplates
          .userTemplates()[0]
          .document.pages[0].nodes.find((n) => n.name === "Logo").src,
    );
    assert.equal(restored, png);
    await page.locator("#templates-close").click();
    console.log("agent workspace UI: accounts, tools, projects, search, autonomy, templates ok");
  } finally {
    await app.close().catch(() => {});
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
