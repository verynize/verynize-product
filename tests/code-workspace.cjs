// Code workspace in Electron (web/src/islands/code + desktop/repositories.cjs): the Code switch shows the full-window
// workspace (no modal), a real temp git repository is added, each chat gets its own worktree + branch on disk, the
// file tree lists the worktree, a file is opened and saved, the agent (fake Codex app-server) runs in the chat's
// worktree, switching chats switches the tree root, the list survives a reload and Design returns to the canvas.
// CODE_WORKSPACE_SHOT=/path.png saves a screenshot of the populated workspace.
const { _electron } = require("@playwright/test");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
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

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "code-workspace-")));
  const repo = path.join(root, "site"),
    workspaces = path.join(root, "workspaces"),
    bin = path.join(root, "bin"),
    log = path.join(root, "codex.log");
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await fs.mkdir(bin);
  await fs.writeFile(path.join(repo, "index.html"), "<h1>Hello</h1>\n");
  await fs.writeFile(path.join(repo, "src", "app.js"), 'console.log("app");\n');
  await fs.writeFile(
    path.join(repo, "package.json"),
    '{\n  "name": "site",\n  "private": true\n}\n',
  );
  await fs.writeFile(path.join(repo, ".gitignore"), "node_modules\n");
  git(repo, "init", "--initial-branch=main");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "Initial");
  await fs.copyFile(path.join(__dirname, "fixtures/fake-codex.cjs"), path.join(bin, "codex"));
  await fs.chmod(path.join(bin, "codex"), 0o755);
  const env = {
    ...process.env,
    ...identity,
    PATH: bin + path.delimiter + process.env.PATH,
    FAKE_CODEX_LOG: log,
    VERYNIZE_WORKSPACES_DIR: workspaces,
    VERYNIZE_BRANCH_PREFIX: "verynize",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const rpc = async (method) =>
    (await fs.readFile(log, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse)
      .filter(
        (c) =>
          c.rpc === method &&
          !/agent-workdirs[\/\\]titles|word title for a design chat/.test(
            JSON.stringify(c.params || {}),
          ),
      );
  await require("./helpers/chatgpt-provider.cjs").seedChatGPTAccount(path.join(root, "profile"));
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${path.join(root, "profile")}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await moveOffCursor(app);
    await waitForUiReady(page);
    await page.setViewportSize({ width: 1440, height: 870 });
    await page.waitForSelector("#project-toggle", { state: "attached" });
    const state = () => page.evaluate(() => window.agentWorkspace.getState());

    // 0. Regression: from the Files home, the chat dock and Code mode must not sit under #file-home (z-index 45).
    const topmost = (x, y) =>
      page.evaluate(
        ([px, py]) => {
          const el = document.elementFromPoint(px, py);
          return {
            dock: !!el?.closest("#agent-chat-dock"),
            code: !!el?.closest("#code-workspace"),
            home: !!el?.closest("#file-home"),
          };
        },
        [x, y],
      );
    await page.locator("#files-home").click();
    await page.waitForFunction(() => document.body.classList.contains("files-view"));
    await page.evaluate(() => window.agentWorkspace.openChat());
    await page.waitForFunction(() => document.body.classList.contains("agent-chat-open"));
    assert.deepEqual(
      await topmost(250, 400),
      { dock: true, code: false, home: false },
      "the chat dock shows over the Files home",
    );
    assert.equal(
      (await topmost(1000, 400)).home,
      true,
      "the Files home stays visible beside the dock",
    );
    await page.getByRole("radio", { name: "Code" }).click();
    await page.locator("#code-workspace").waitFor();
    assert.deepEqual(
      await topmost(700, 400),
      { dock: false, code: true, home: false },
      "Code mode shows over the Files home",
    );
    await page.getByRole("radio", { name: "Design" }).click();
    await page.evaluate(() => window.agentWorkspace.closeChat());
    await page.evaluate(() => window.fileLibrary.showEditor());
    await page.waitForFunction(
      () =>
        !document.body.classList.contains("files-view") &&
        !document.body.classList.contains("agent-chat-open"),
    );

    // 1. The Code switch shows the workspace in the window, not a modal.
    assert.equal(await page.locator("#code-workspace").isVisible(), false);
    await page.getByRole("radio", { name: "Code" }).click();
    await page.locator("#code-workspace").waitFor();
    assert.equal(await page.locator("#project-dialog").count(), 0, "the old project modal is gone");
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.equal(await page.locator("#code-sidebar").isVisible(), true);
    assert.equal(
      await page.getByRole("radio", { name: "Code" }).getAttribute("aria-checked"),
      "true",
    );
    assert.equal(
      await page.locator("#code-chat-host #project-prompt").count(),
      1,
      "the composer is hosted in the code column",
    );
    assert.equal(
      await page.locator("#code-next-steps [data-step=connect]").getAttribute("data-done"),
      null,
    );

    // 2. Add the repository from a local folder → its first chat gets a worktree on a verynize/ branch.
    await app.evaluate(
      ({ dialog }, dir) =>
        (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })),
      repo,
    );
    await page.locator("#code-add-repository").click();
    await page.locator("#project-open").click();
    await page.locator('[data-repository="site"]').waitFor();
    await page.waitForFunction(() => {
      const s = window.agentWorkspace.getState();
      return s.branch && s.activeRoot && s.activeRoot === s.chatRoot;
    });
    const first = await state();
    assert.equal(first.projectKey, repo);
    assert.match(first.branch, /^verynize\/[a-z0-9-]+$/);
    assert.equal(path.dirname(first.chatRoot), path.join(workspaces, "site"));
    assert.equal(
      git(first.chatRoot, "rev-parse", "--abbrev-ref", "HEAD"),
      first.branch,
      "the worktree is on the chat branch",
    );
    assert.equal(
      git(first.chatRoot, "rev-parse", "HEAD"),
      git(repo, "rev-parse", "HEAD"),
      "cut from the repository HEAD",
    );
    assert.ok(git(repo, "worktree", "list").includes(first.chatRoot));
    assert.equal(await page.locator("#project-name").textContent(), "site");
    assert.match(await page.locator("#code-breadcrumb-repo").textContent(), /site/);
    assert.equal(
      await page.locator("#code-next-steps [data-step=connect]").getAttribute("data-done"),
      "true",
    );

    // 3. File tree lists the worktree; folders expand.
    const tree = page.locator(`#code-file-tree[data-root="${first.chatRoot}"]`);
    await tree.locator('[data-path="index.html"]').waitFor();
    assert.equal(await tree.locator('[data-path="src/app.js"]').count(), 0);
    await tree.locator('[data-path="src"]').click();
    await tree.locator('[data-path="src/app.js"]').waitFor();
    assert.equal(await tree.locator('[data-path=".gitignore"]').count(), 1);

    // 4. Open, edit and save a file: written to the chat's worktree only, then marked as changed.
    await tree.locator('[data-path="index.html"]').click();
    await page.waitForFunction(
      () => document.getElementById("code-editor")?.value === "<h1>Hello</h1>\n",
    );
    assert.equal(
      await page.locator("#code-chat-host").isVisible(),
      false,
      "the editor replaces the chat column",
    );
    await page.locator("#code-editor").fill("<h1>Hello worktree</h1>\n");
    await page.locator("#code-editor-save").click();
    await page.waitForFunction(
      () => document.getElementById("project-status").textContent === "Saved",
    );
    assert.equal(
      await fs.readFile(path.join(first.chatRoot, "index.html"), "utf8"),
      "<h1>Hello worktree</h1>\n",
    );
    assert.equal(
      await fs.readFile(path.join(repo, "index.html"), "utf8"),
      "<h1>Hello</h1>\n",
      "the repository checkout is untouched",
    );
    await page.waitForFunction(() =>
      /M$/.test(
        document.querySelector('#code-file-tree [data-path="index.html"]')?.textContent || "",
      ),
    );
    // Filter: All files / All changes (the branch since main, commits included) / Uncommitted, with counts.
    await page.locator("#code-file-filter").click();
    assert.deepEqual(await page.locator("[role=menuitemradio]").allInnerTexts(), [
      "All files",
      "All changes\n1",
      "Uncommitted\n1",
    ]);
    await page.getByRole("menuitemradio", { name: "Uncommitted" }).click();
    await page.waitForFunction(
      () => document.querySelectorAll("#code-file-tree [data-kind=file]").length === 1,
    );
    await page.locator("[role=menu]").waitFor({ state: "detached" });
    assert.match(await page.locator("#code-file-filter").textContent(), /^Uncommitted/);
    // A commit on the chat branch leaves Uncommitted but stays in All changes.
    git(
      first.chatRoot,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-am",
      "Edit hero",
    );
    await page.locator('[aria-label="Refresh files"]').click();
    await page.locator("#code-files").getByText("No uncommitted changes.").waitFor();
    await page.locator("#code-file-filter").click();
    await page.getByRole("menuitemradio", { name: "All changes" }).click();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("#code-file-tree [data-kind=file]")]
          .map((b) => b.dataset.path)
          .join() === "index.html",
    );
    await page.locator("[role=menu]").waitFor({ state: "detached" });
    git(first.chatRoot, "reset", "--soft", "HEAD~1"); // back to an uncommitted edit for the steps below
    await page.locator("#code-file-filter").click();
    await page.getByRole("menuitemradio", { name: "All files" }).click();
    await page.getByRole("button", { name: "Close file" }).click();
    assert.equal(await page.locator("#code-chat-host").isVisible(), true);

    // 5. The agent runs in the chat's worktree.
    await page.evaluate(() =>
      window.agentWorkspace.setDefaults({ agent: "codex", access: "edit" }),
    );
    await page.locator("#project-prompt").fill("Make the hero bigger");
    await page.locator("#project-run").click();
    await page.waitForFunction(
      () => window.agentWorkspace.getUsage().completed === 1 && !window.agentWorkspace.isBusy(),
      null,
      { timeout: 15000 },
    );
    assert.equal(
      (await rpc("thread/start")).at(-1).params.cwd,
      first.chatRoot,
      "the agent cwd is the chat worktree",
    );

    // 6. A second chat: its own worktree and branch; the tree follows the active chat.
    await page.evaluate(
      (id) => window.agentBehavior.set({ repoModes: { [id]: "full" } }),
      first.repoId,
    );
    await page.locator("#code-new-chat").click();
    await page.waitForFunction((id) => {
      const s = window.agentWorkspace.getState();
      return s.conversationId !== id && s.branch && s.activeRoot === s.chatRoot;
    }, first.conversationId);
    const second = await state();
    assert.notEqual(second.chatRoot, first.chatRoot);
    // Mode for new chats (Settings › Agents): this repository's own pick applies to its new chat, the Default stays.
    assert.equal(
      second.defaults.access,
      "full",
      "a new chat in a repository with its own mode starts in it",
    );
    assert.equal(
      JSON.parse(await page.evaluate(() => localStorage.getItem("better-agent-defaults"))).access,
      "edit",
      "the Default mode is unchanged",
    );
    assert.notEqual(second.branch, first.branch);
    await page
      .locator(`#code-file-tree[data-root="${second.chatRoot}"] [data-path="index.html"]`)
      .waitFor();
    await page
      .locator(`#code-file-tree[data-root="${second.chatRoot}"] [data-path="index.html"]`)
      .click();
    await page.waitForFunction(
      () => document.getElementById("code-editor")?.value === "<h1>Hello</h1>\n",
    );
    await page.getByRole("button", { name: "Close file" }).click();
    assert.equal(await page.locator('[data-repository="site"] [data-chat-id]').count(), 2);
    await page.locator(`[data-chat-id="${first.conversationId}"]`).click();
    await page.locator(`#code-file-tree[data-root="${first.chatRoot}"]`).waitFor();
    assert.equal((await state()).conversationId, first.conversationId);
    assert.equal(
      await page.locator(`[data-chat-id="${first.conversationId}"]`).getAttribute("aria-current"),
      "true",
    );
    assert.equal(
      (await state()).defaults.access,
      "edit",
      "chats started before the pick keep following the Default",
    );

    // 7. Quick chats have no repository and no files.
    await page.locator("#code-new-quick-chat").click();
    await page.waitForFunction(
      () =>
        window.agentWorkspace.getState().projectKey === "unattached" &&
        window.agentWorkspace.getState().activeRoot === null,
    );
    assert.match(await page.locator("#code-files").textContent(), /scratch folder/);
    await page.locator(`[data-chat-id="${first.conversationId}"]`).click();
    await page.locator(`#code-file-tree[data-root="${first.chatRoot}"]`).waitFor();

    // First preview requests the LLM setup flow; manual configuration remains available.
    await page.addInitScript(() =>
      window.addEventListener(
        "bd:setup-preview",
        (event) => {
          event.stopImmediatePropagation();
          window.previewSetupRequested = true;
        },
        { capture: true, once: true },
      ),
    );
    await page.reload();
    await waitForUiReady(page);
    await page.locator(`#code-file-tree[data-root="${first.chatRoot}"]`).waitFor();
    await page.locator("#code-start-preview").click();
    assert.equal(await page.evaluate(() => window.previewSetupRequested), true);
    await page.locator("#code-preview-menu").click();
    await page.locator("#code-configure-preview").click();
    await page.locator("#preview-run-command").waitFor();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Enter a start command." }).waitFor();
    await page.locator("#preview-run-command").fill("npm run dev");
    await page.locator("#preview-opens-at").fill("5173");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.locator("#preview-run-command").waitFor({ state: "hidden" });
    const previewConfig = await page.evaluate(() => window.desktop.devServer.status());
    assert.deepEqual(previewConfig.config.command, ["npm", "run", "dev"]);
    assert.equal(previewConfig.config.url, "http://localhost:5173/");
    assert.equal(
      (await page.evaluate(() => window.desktop.devServer.status())).root,
      first.chatRoot,
    );

    // A real MCP proposal in edit access remains pending until the user accepts its inline card (auto access saves it
    // directly: tests/preview-header.cjs).
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } =
      await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const bridgeInfo = JSON.parse(
      await fs.readFile(path.join(root, "profile", "mcp.json"), "utf8"),
    );
    const previewClient = new Client({ name: "preview-proposal-test", version: "1" });
    await previewClient.connect(
      new StreamableHTTPClientTransport(new URL(bridgeInfo.url), {
        requestInit: {
          headers: { Authorization: `Bearer ${bridgeInfo.token}`, "x-verynize-access": "edit" },
        },
      }),
    );
    try {
      const result = await previewClient.callTool({
        name: "propose_preview",
        arguments: {
          command: ["node", "-e", "process.exit(7)"],
          port: 5173,
          chatId: first.conversationId,
          name: "Fixture",
        },
      });
      assert.ok(!result.isError, JSON.stringify(result));
      await page.locator("#preview-proposal").waitFor();
      const beforeAccept = await page.evaluate(() => window.desktop.devServer.status());
      assert.deepEqual(
        beforeAccept.config.command,
        ["npm", "run", "dev"],
        "proposal does not overwrite accepted configuration",
      );
      await page.reload();
      await waitForUiReady(page);
      await page.locator("#preview-proposal").waitFor();
      assert.match(
        await page.locator("#preview-proposal").textContent(),
        /Proposed Preview configuration/,
      );
      await page
        .locator("#preview-proposal")
        .getByRole("button", { name: "Edit", exact: true })
        .click();
      await page.getByRole("textbox", { name: "Preview Port", exact: true }).fill("0");
      await page.getByRole("button", { name: "Save & start preview", exact: true }).click();
      await page
        .locator("#preview-proposal [role=status]")
        .filter({ hasText: "Port must be between" })
        .waitFor();
      await page.getByRole("textbox", { name: "Preview Port", exact: true }).fill("5173");
      await page.getByRole("button", { name: "Save & start preview", exact: true }).click();
      await page.locator("#preview-proposal [role=status]").waitFor();
      await page.waitForFunction(() =>
        /exited|failed|exit/i.test(
          document.querySelector("#preview-proposal [role=status]")?.textContent || "",
        ),
      );
      assert.equal(
        await page.locator("#preview-proposal").isVisible(),
        true,
        "failed startup preserves proposal for correction",
      );
      assert.equal(
        await page.evaluate(() =>
          window.design
            .getDocument()
            .pages.some((p) =>
              p.nodes.some(
                (n) =>
                  n.type === "frame" &&
                  n.preview?.root === window.agentWorkspace.getState().activeRoot,
              ),
            ),
        ),
        true,
        "acceptance creates persistent canvas preview",
      );
      await page.getByRole("button", { name: "Dismiss preview proposal" }).click();
      await page.locator("#preview-proposal").waitFor({ state: "hidden" });
      await page.evaluate(() => window.agentWorkspace.setCodeMode(true));
    } finally {
      await previewClient.close();
    }

    // 7b. Preferences › Advanced: line changes per worktree in the sidebar, and chat tabs sharing one worktree.
    assert.equal(
      await page.locator("[data-line-changes]").count(),
      0,
      "line changes are off by default",
    );
    assert.equal(await page.locator("#code-chat-tabs").count(), 0, "chat tabs are off by default");
    await page.evaluate(() => window.appPreferences.set({ lineChanges: true }));
    await page.waitForFunction(
      (id) =>
        document.querySelector(`[data-chat-id="${id}"] [data-line-changes]`)?.textContent ===
        "+1−1",
      first.conversationId,
    );
    await page.evaluate(() => window.appPreferences.set({ chatTabs: true }));
    await page
      .locator(`#code-chat-tabs [data-chat-tab="${first.conversationId}"][aria-selected="true"]`)
      .waitFor();
    await page.locator("#code-new-tab").click();
    await page.waitForFunction(
      ([id, root]) => {
        const s = window.agentWorkspace.getState();
        return s.conversationId !== id && s.chatRoot === root && s.activeRoot === root;
      },
      [first.conversationId, first.chatRoot],
    );
    const tab = await state();
    assert.equal(tab.branch, first.branch, "a tab works on the same branch");
    assert.equal(await page.locator("#code-chat-tabs [data-chat-tab]").count(), 2);
    assert.equal(
      await page.locator('[data-repository="site"] [data-chat-id]').count(),
      2,
      "one sidebar row per worktree",
    );
    assert.equal(
      await page.locator(`[data-chat-id="${tab.conversationId}"] [data-tab-count="2"]`).count(),
      1,
    );
    await page.locator(`#code-chat-tabs [data-chat-tab="${first.conversationId}"]`).click();
    await page.waitForFunction(
      (id) => window.agentWorkspace.getState().conversationId === id,
      first.conversationId,
    );
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(`#code-chat-tabs [data-chat-tab="${tab.conversationId}"] + button`).click();
    await page.waitForFunction(
      () => document.querySelectorAll("#code-chat-tabs [data-chat-tab]").length === 1,
    );
    await fs.access(first.chatRoot); // the shared worktree stays while a chat still uses it
    await page.evaluate(() => window.appPreferences.set({ chatTabs: false, lineChanges: false }));
    await page.locator("#code-chat-tabs").waitFor({ state: "detached" });
    assert.equal(await page.locator("[data-line-changes]").count(), 0);

    if (process.env.CODE_WORKSPACE_SHOT) {
      await page.locator(`#code-file-tree [data-path="src"]`).click();
      await page.mouse.move(700, 500);
      await page.waitForTimeout(300);
      await page.screenshot({ path: process.env.CODE_WORKSPACE_SHOT });
    }

    // 8. Design returns to the canvas; the repository list and chats persist across a reload.
    await page.getByRole("radio", { name: "Design" }).click();
    assert.equal(await page.locator("#code-workspace").isVisible(), false);
    assert.equal(await page.locator("#canvas").isVisible(), true);
    await page.reload();
    await waitForUiReady(page);
    await page.waitForSelector("#project-toggle", { state: "attached" });
    await page.getByRole("radio", { name: "Code" }).click();
    await page.locator('[data-repository="site"]').waitFor();
    await page.waitForFunction(
      (id) => window.agentWorkspace.getState().conversationId === id,
      first.conversationId,
    );
    assert.equal(await page.locator('[data-repository="site"] [data-chat-id]').count(), 2);
    await page
      .locator(`#code-file-tree[data-root="${first.chatRoot}"] [data-path="index.html"]`)
      .waitFor();

    // 9. Archiving a chat removes its worktree (after confirming uncommitted work), keeps the branch.
    page.on("dialog", (dialog) => dialog.accept());
    await page.locator(`[data-chat-id="${second.conversationId}"]`).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Archive chat" }).click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-repository="site"] [data-chat-id]').length === 1,
    );
    await assert.rejects(fs.access(second.chatRoot));
    assert.ok(git(repo, "branch", "--list", second.branch).includes(second.branch));
    console.log(
      "PASS code workspace: in-window mode switch, add repository, per-chat worktrees and branches, file tree, edit/save in worktree, agent cwd, chat switching, quick chats, line changes, chat tabs, persistence, archive",
    );
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
