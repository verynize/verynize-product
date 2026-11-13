// Starting a preview from the chat header (design/wonder/preview-audit PS1, PS2, PS6, X1, X5) in Electron with a real
// git repository, the fake Codex app-server and real processes: the first-run intro and its persisted dismissal, the
// first Start asking the agent to "Set up the Preview", the auto-mode "Preview setup / Saved by auto mode" transcript
// card, the Preview settings modal (commands, Opens at, chained setup, stop command), the split button label that
// switches to "Stop preview" at once (also during setup), the idle and running split menus, the Code workspace
// "Your app is running" card, the stop command, and propose_preview saved directly in auto access but shown as a
// review card in edit access.
// PREVIEW_HEADER_SHOTS=/dir saves 1440×870 screenshots of the states.
const { waitForAsync } = require("./helpers/wait-for-async.cjs");
const { _electron } = require("@playwright/test");
const { mod } = require("./helpers/keys.cjs");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { seedChatGPTAccount } = require("./helpers/chatgpt-provider.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const identity = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...identity },
  }).trim();
const SERVER = `const http=require('node:http');
const server=http.createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<h1>Header fixture</h1>');});
server.listen(0,'127.0.0.1',()=>console.log('Local: http://localhost:'+server.address().port+'/'));
process.on('SIGTERM',()=>process.exit(0));
`;

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "preview-header-")));
  const repo = path.join(root, "sandbox"),
    workspaces = path.join(root, "workspaces"),
    bin = path.join(root, "bin");
  const shots = process.env.PREVIEW_HEADER_SHOTS;
  await fs.mkdir(repo, { recursive: true });
  await fs.mkdir(bin);
  await fs.writeFile(path.join(repo, "index.html"), "<h1>Header fixture</h1>\n");
  await fs.writeFile(path.join(repo, "server.js"), SERVER);
  await fs.writeFile(path.join(repo, ".gitignore"), "setup.log\nstopped.txt\n");
  git(repo, "init", "--initial-branch=main");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "Initial");
  await fs.copyFile(path.join(__dirname, "fixtures/fake-codex.cjs"), path.join(bin, "codex"));
  await fs.chmod(path.join(bin, "codex"), 0o755);
  const env = {
    ...process.env,
    ...identity,
    PATH: bin + path.delimiter + process.env.PATH,
    VERYNIZE_WORKSPACES_DIR: workspaces,
    VERYNIZE_BRANCH_PREFIX: "verynize",
    VERYNIZE_SKIP_ONBOARDING: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  // Chat turns check the Codex sign-in first: a preauthorized local SIWC account, never the developer's login.
  await seedChatGPTAccount(path.join(root, "profile"));
  const app = await _electron.launch({
    env,
    args: [
      ".",
      `--user-data-dir=${path.join(root, "profile")}`,
      "--force-device-scale-factor=2",
      "--force-color-profile=srgb",
    ],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await waitForUiReady(page);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 870),
    );
    await page.waitForSelector("#project-toggle", { state: "attached" });
    const shot = async (name) => {
      if (shots) {
        await fs.mkdir(shots, { recursive: true });
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(shots, `${name}.png`) });
      }
    };
    const state = () => page.evaluate(() => window.agentWorkspace.getState());
    const label = () => page.locator("#chat-start-preview").innerText();
    const phase = () =>
      page.locator("[data-preview-phase]").first().getAttribute("data-preview-phase");
    const menuItems = () =>
      page
        .locator("[role=menu]")
        .last()
        .locator("[role=menuitem], [role=separator]")
        .evaluateAll((els) =>
          els.map((el) =>
            el.getAttribute("role") === "separator"
              ? "|"
              : [...el.childNodes]
                  .map((n) => n.textContent)
                  .join(" ")
                  .replace(/\s+/g, " ")
                  .trim(),
          ),
        );

    // Repository + chat (worktree), in design mode with the chat dock.
    await page.getByRole("radio", { name: "Code" }).click();
    await app.evaluate(
      ({ dialog }, dir) =>
        (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })),
      repo,
    );
    await page.locator("#code-add-repository").click();
    await page.locator("#project-open").click();
    await page.waitForFunction(() => {
      const s = window.agentWorkspace.getState();
      return s.branch && s.activeRoot && s.activeRoot === s.chatRoot;
    });
    const chatRoot = (await state()).activeRoot;
    await page.evaluate(() => {
      window.agentWorkspace.setDefaults({ agent: "codex", access: "auto" });
      window.agentWorkspace.setCodeMode(false);
      window.agentWorkspace.openChat();
    });
    await page.locator("#chat-start-preview").waitFor();

    // PS1: idle split button, intro card and idle menu.
    assert.equal(await label(), "Start preview");
    assert.equal(await phase(), "idle");
    const intro = page.locator("#preview-intro");
    await intro.waitFor();
    assert.match(
      await intro.innerText(),
      /Preview your app on the canvas\s+See your changes live, next to this chat\.\s+Start preview/,
    );
    assert.equal(await intro.getByRole("button", { name: "Don’t show this again" }).count(), 1);
    await shot("PS1-idle");
    await page.locator("#chat-preview-menu").click();
    assert.deepEqual(await menuItems(), ["Open in a tab ⌘⌥P", "|", "Preview settings"]);
    assert.equal(
      await page
        .locator("[role=menu]")
        .last()
        .evaluate((el) => el.offsetWidth),
      176,
      "the split menu is 176px wide",
    );
    await shot("PS1-menu");
    await page.keyboard.press("Escape");

    // PS2: first Start without a configuration sends "Set up the Preview"; in auto mode the transcript shows the saved card.
    await intro.getByRole("button", { name: "Start preview" }).click();
    await page
      .locator(".chat-message.user")
      .filter({ hasText: "Set up the Preview" })
      .waitFor({ timeout: 15000 });
    const request = page.locator(".chat-message.user").filter({ hasText: "Set up the Preview" });
    assert.equal(
      await request.locator("[data-preview-request]").count(),
      1,
      "the setup request is drawn as an app action (logo, purple)",
    );
    assert.equal(await request.locator("[data-preview-request] svg").count(), 1);
    await intro.waitFor({ state: "hidden" });
    const saved = page.locator("[data-preview-saved]").last();
    await saved.waitFor({ timeout: 15000 });
    assert.match(await saved.locator("summary").innerText(), /Preview setup\s*Saved by auto mode/);
    await saved.locator("summary").click();
    assert.match(
      await saved.innerText(),
      /python3 -m http\.server 8000\s+You can change it in Preview settings\./,
    );
    await page.waitForFunction(() => !window.agentWorkspace.isBusy());
    await shot("PS2-card");

    // propose_preview through the real MCP bridge: auto saves without a card and does not start; edit shows the card.
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } =
      await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const bridge = JSON.parse(await fs.readFile(path.join(root, "profile", "mcp.json"), "utf8"));
    const call = async (access, args) => {
      const client = new Client({ name: "preview-header-test", version: "1" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(bridge.url), {
          requestInit: {
            headers: { Authorization: `Bearer ${bridge.token}`, "x-verynize-access": access },
          },
        }),
      );
      try {
        return await client.callTool({ name: "propose_preview", arguments: args });
      } finally {
        await client.close();
      }
    };
    const chatId = (await state()).conversationId;
    const autoResult = await call("auto", {
      command: ["node", "server.js"],
      port: 5199,
      chatId,
      name: "Fixture",
    });
    assert.ok(!autoResult.isError, JSON.stringify(autoResult));
    assert.equal(JSON.parse(autoResult.content[0].text).saved, true);
    let status = await page.evaluate((root) => window.desktop.devServer.status({ root }), chatRoot);
    assert.deepEqual(
      status.config.command,
      ["node", "server.js"],
      "auto access saves the proposal as the configuration",
    );
    assert.equal(status.state, "stopped", "auto access never starts the server");
    assert.equal(status.proposal, null);
    assert.equal(
      await page.locator("#preview-proposal").count(),
      0,
      "no review card in auto access",
    );
    const editResult = await call("edit", {
      command: ["npm", "run", "dev"],
      port: 5173,
      chatId,
      name: "Fixture",
    });
    assert.ok(!editResult.isError, JSON.stringify(editResult));
    await page.locator("#preview-proposal").waitFor();
    assert.deepEqual(
      (await page.evaluate((root) => window.desktop.devServer.status({ root }), chatRoot)).config
        .command,
      ["node", "server.js"],
      "edit access keeps the review card and does not save",
    );
    await page.getByRole("button", { name: "Dismiss preview proposal" }).click();
    await page.locator("#preview-proposal").waitFor({ state: "hidden" });

    // X1: Preview settings modal.
    await page.locator("#chat-preview-menu").click();
    await page.locator("#chat-configure-preview").click();
    const settings = page.locator("#preview-settings");
    await settings.waitFor();
    await page.locator("#preview-run-command").waitFor();
    await page.waitForFunction(
      () => document.querySelector("#preview-run-command")?.value === "node server.js",
    );
    const text = await settings.innerText();
    for (const expected of [
      "sandbox",
      "Repository settings",
      "How the Preview starts, opens and stops your app in a worktree.",
      "Preview commands",
      "Each command starts a part of your app. Leave “Opens at” on Default to open the address the command prints.",
      "Name",
      "Start command",
      "Opens at",
      "Add start command",
      "Setup and stop",
      "Setup command",
      "Chain steps with &&.",
      "Stop command",
      "Runs when you stop the Preview, to end what the start command left running, like containers.",
      "Detect with agent",
      "Cancel",
      "Save",
    ])
      assert.ok(text.includes(expected), `settings show ${expected}`);
    assert.equal(
      await page.locator("#preview-opens-at").inputValue(),
      "localhost:5199",
      "Opens at shows the saved address",
    );
    assert.equal(
      await page.locator("#preview-setup-command").getAttribute("placeholder"),
      "npm install",
    );
    assert.equal(
      await page.locator("#preview-stop-command").getAttribute("placeholder"),
      "docker compose down",
    );
    assert.deepEqual(
      await settings.evaluate((el) => [el.offsetWidth, el.offsetHeight]),
      [992, 640],
    );
    await shot("X1-settings");
    // Validation, then a real configuration: default address, two chained setup steps (the second slow) and a stop command.
    await page.locator("#preview-run-command").fill("");
    await page.locator("#preview-opens-at").fill("");
    await page.locator("#preview-settings-save").click();
    await settings.getByRole("status").filter({ hasText: "Enter a start command." }).waitFor();
    await page.locator("#preview-run-command").fill("node server.js");
    await page.locator("#preview-opens-at").fill("example.com");
    await page.locator("#preview-settings-save").click();
    await settings.getByRole("status").filter({ hasText: "localhost" }).waitFor();
    await page.locator("#preview-opens-at").fill("");
    await page
      .locator("#preview-setup-command")
      .fill(
        `node -e "require('fs').appendFileSync('setup.log','a')" && node -e "setTimeout(()=>require('fs').appendFileSync('setup.log','b'),1500)"`,
      );
    await page
      .locator("#preview-stop-command")
      .fill(`node -e "require('fs').writeFileSync('stopped.txt','yes')"`);
    await shot("PS2-edit");
    await page.locator("#preview-settings-save").click();
    await settings.waitFor({ state: "hidden" });
    status = await page.evaluate((root) => window.desktop.devServer.status({ root }), chatRoot);
    assert.equal(status.config.url, undefined, "blank Opens at = Default");
    assert.equal(status.config.setupSteps.length, 2);
    assert.equal(status.config.stopSteps.length, 1);
    assert.equal(status.setupPending, true);

    // PS1/PS3: Start switches the label at once and keeps "Stop preview" with a spinner during setup.
    await page.locator("#chat-start-preview").click();
    await page.waitForFunction(
      () => document.querySelector("#chat-start-preview")?.textContent === "Stop preview",
      null,
      { timeout: 500 },
    );
    assert.equal(await phase(), "starting");
    await waitForAsync(
      page,
      (root) => window.desktop.devServer.status({ root }).then((s) => s.setup?.state === "running"),
      chatRoot,
      { timeout: 5000 },
    );
    assert.equal(await label(), "Stop preview", "still Stop preview while the setup command runs");
    assert.equal(await phase(), "starting");
    await shot("PS3-starting");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-preview-phase]")?.getAttribute("data-preview-phase") ===
        "running",
      null,
      { timeout: 20000 },
    );
    assert.equal(
      await fs.readFile(path.join(chatRoot, "setup.log"), "utf8"),
      "ab",
      "setup steps ran in order before the start",
    );
    assert.equal(await label(), "Stop preview");
    assert.equal(
      await page.locator("#chat-start-preview [data-preview-dot]").count(),
      1,
      "running shows the green dot",
    );
    assert.equal(
      await page.evaluate(() =>
        window.design
          .getDocument()
          .pages.some((p) =>
            p.nodes.some((n) => n.preview?.root === window.agentWorkspace.getState().activeRoot),
          ),
      ),
      true,
      "the canvas frame exists",
    );
    const frameName = await page.evaluate(
      () =>
        window.design
          .getDocument()
          .pages.flatMap((p) => p.nodes)
          .find((n) => n.preview?.root === window.agentWorkspace.getState().activeRoot).name,
    );
    const worktree = path.basename(chatRoot);
    assert.equal(
      frameName,
      worktree[0].toUpperCase() + worktree.slice(1),
      'the layer is the capitalised worktree name, like Wonder\'s "Dipper"',
    );
    await page.locator("#chat-preview-menu").click();
    assert.deepEqual(await menuItems(), [
      "Open in a tab ⌘⌥P",
      "Go to preview",
      "Open in browser",
      "|",
      "Preview settings",
    ]);
    await shot("X5-running-menu");
    // Open in browser → the system browser at the running address; Go to preview → the frame selected; ⌘⌥P → window.previewTab.
    await app.evaluate(({ shell }) => {
      globalThis.openedExternal = null;
      shell.openExternal = async (url) => {
        globalThis.openedExternal = url;
      };
    });
    await page.locator("#chat-preview-browser").click();
    const runningURL = (
      await page.evaluate((root) => window.desktop.devServer.status({ root }), chatRoot)
    ).url;
    assert.match(runningURL, /^http:\/\/localhost:\d+\/$/);
    for (let i = 0; i < 40 && !(await app.evaluate(() => globalThis.openedExternal)); i++)
      await page.waitForTimeout(50);
    assert.equal(await app.evaluate(() => globalThis.openedExternal), runningURL);
    await page.evaluate(() => window.design.setSelection([]));
    await page.locator("[role=menu]").waitFor({ state: "detached" });
    await page.waitForTimeout(200);
    await page.locator("#chat-preview-menu").click();
    await page.locator("#chat-preview-go").click();
    await page.waitForFunction(() => {
      const ids = window.design.getSelection();
      return (
        ids.length === 1 &&
        window.design
          .getDocument()
          .pages.some((p) => p.nodes.some((n) => n.id === ids[0] && n.preview))
      );
    });
    await page.evaluate(() => {
      window.previewTab = {
        open: (id) => {
          window.openedTab = id;
        },
      };
    });
    await page
      .locator("#project-prompt")
      .blur()
      .catch(() => {});
    await page.keyboard.press(mod("Alt+KeyP"));
    await page.waitForFunction(() => !!window.openedTab);
    assert.equal(
      await page.evaluate(
        () =>
          window.design
            .getDocument()
            .pages.flatMap((p) => p.nodes)
            .find((n) => n.id === window.openedTab)?.preview?.root,
      ),
      chatRoot,
      "⌘⌥P opens this preview in a tab",
    );

    // PS6: Code workspace "Your app is running" card → Show preview returns to the canvas frame.
    await page.evaluate(() => window.agentWorkspace.setCodeMode(true));
    const running = page.locator("#preview-running-card");
    await running.waitFor();
    assert.match(
      await running.innerText(),
      /Your app is running\s+Open the Preview on the canvas next to this chat\.\s+Show preview/,
    );
    assert.equal(await page.locator("#code-start-preview").innerText(), "Stop preview");
    await shot("PS6-code");
    await running.getByRole("button", { name: "Show preview" }).click();
    await page.waitForFunction(() => !document.body.classList.contains("code-mode"));
    await page.waitForFunction(() => {
      const ids = window.design.getSelection();
      const nodes = window.design.getDocument().pages.flatMap((p) => p.nodes);
      return ids.length === 1 && !!nodes.find((n) => n.id === ids[0])?.preview;
    });
    await shot("PS6-show-preview");

    // Stop: the stop command runs; a second start does not repeat the finished setup.
    await page.locator("#chat-start-preview").click();
    await page.waitForFunction(
      () => document.querySelector("#chat-start-preview")?.textContent === "Start preview",
      null,
      { timeout: 15000 },
    );
    // The server exits before its saved cleanup command finishes; wait for that command too.
    await waitForAsync(
      page,
      (root) =>
        window.desktop.devServer.status({ root }).then((s) => s.stopCommand?.exitCode === 0),
      chatRoot,
      { timeout: 15000 },
    );
    assert.equal(
      await fs.readFile(path.join(chatRoot, "stopped.txt"), "utf8"),
      "yes",
      "the stop command ran",
    );
    await page.locator("#chat-start-preview").click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-preview-phase]")?.getAttribute("data-preview-phase") ===
        "running",
      null,
      { timeout: 20000 },
    );
    assert.equal(
      await fs.readFile(path.join(chatRoot, "setup.log"), "utf8"),
      "ab",
      "unchanged setup does not run again",
    );
    await page.locator("#chat-start-preview").click();
    await page.waitForFunction(
      () => document.querySelector("#chat-start-preview")?.textContent === "Start preview",
      null,
      { timeout: 15000 },
    );
    // The server exits before its saved cleanup command finishes; wait for that command too.
    await waitForAsync(
      page,
      (root) =>
        window.desktop.devServer.status({ root }).then((s) => s.stopCommand?.exitCode === 0),
      chatRoot,
      { timeout: 15000 },
    );

    // The intro returns after a reload until "Don't show this again".
    await page.reload();
    await waitForUiReady(page);
    await page.waitForSelector("#project-toggle", { state: "attached" });
    await page.evaluate(() => {
      window.agentWorkspace.setCodeMode(false);
      window.agentWorkspace.openChat();
    });
    await intro.waitFor();
    await intro.getByRole("button", { name: "Don’t show this again" }).click();
    await intro.waitFor({ state: "hidden" });
    await page.reload();
    await waitForUiReady(page);
    await page.waitForSelector("#project-toggle", { state: "attached" });
    await page.evaluate(() => {
      window.agentWorkspace.setCodeMode(false);
      window.agentWorkspace.openChat();
    });
    await page.locator("#chat-start-preview").waitFor();
    await page.waitForTimeout(500);
    assert.equal(await intro.count(), 0, "dismissal persists");
    console.log(
      "PASS preview header: intro, setup request, auto-saved card, settings modal, immediate label, menus, Code card, stop command",
    );
  } finally {
    await app.close().catch(() => {});
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
