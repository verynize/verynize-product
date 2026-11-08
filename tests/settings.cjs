const { _electron } = require("@playwright/test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "better-settings-"));
  const home = path.join(dir, "home");
  await fs.mkdir(path.join(home, ".codex", "rules"), { recursive: true });
  await fs.mkdir(path.join(home, ".claude"), { recursive: true });
  await fs.writeFile(
    path.join(home, ".codex", "rules", "default.rules"),
    'prefix_rule(pattern=["npm", "test"], decision="allow")\nprefix_rule(pattern=["git", "status"], decision="allow")\n',
  );
  await fs.writeFile(
    path.join(home, ".claude", "settings.json"),
    JSON.stringify({ model: "opus", permissions: { allow: ["Bash(npm run lint:*)"] } }, null, 2) +
      "\n",
  );
  await fs.writeFile(path.join(home, ".codex", "config.toml"), "[features]\nmemories = false\n");
  await fs.writeFile(path.join(home, ".codex", "AGENTS.md"), "Prefer small commits.");
  await fs.writeFile(
    path.join(home, ".gitconfig"),
    "[user]\n\tname = Ada Lovelace\n\temail = ada@example.com\n",
  );
  // HOME points at a fixture home: Agents › Allowed without asking and Commit author read it, never the real ~/.claude or ~/.codex.
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: path.join(home, ".codex"),
    VERYNIZE_PREFERENCES: path.join(dir, "design-preferences.json"),
    VERYNIZE_AGENT_HOME: home,
    VERYNIZE_DISABLE_AGENT_USAGE: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  // The Codex memory/instructions cards need an installed Codex CLI next to the seeded ChatGPT account. A machine without
  // one (CI) gets the process fixture on PATH; where desktop/agents.cjs finds an installed codex, nothing changes.
  const installedCodex = [
    ...(process.env.PATH || "").split(path.delimiter),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]
    .filter(path.isAbsolute)
    .some((d) => {
      try {
        require("node:fs").accessSync(path.join(d, "codex"), 1);
        return true;
      } catch {
        return false;
      }
    });
  if (!installedCodex) {
    const bin = path.join(dir, "bin");
    await fs.mkdir(bin);
    await fs.copyFile(path.join(__dirname, "fixtures/fake-codex.cjs"), path.join(bin, "codex"));
    await fs.chmod(path.join(bin, "codex"), 0o755);
    env.PATH = bin + path.delimiter + (process.env.PATH || "");
  }
  delete env.VERYNIZE_DISABLE_MCP;
  await require("./helpers/chatgpt-provider.cjs").seedChatGPTAccount(dir);
  const app = await _electron.launch({
    args: [".", `--user-data-dir=${dir}`],
    env,
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await waitForUiReady(page);
    await page.waitForSelector("#shell-settings", { state: "attached" });
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.locator("#shell-settings").click();
    await page.locator('[data-theme="light"]').click();
    assert.equal(await page.locator("html").getAttribute("data-ui-theme"), "light");
    await page.locator('[data-theme="dark"]').click();
    await page.locator('[data-pref="smallNudge"]').fill("3");
    await page.locator('[data-pref="smallNudge"]').press("Tab");
    await page.locator("#settings-nav button").filter({ hasText: "Default Models" }).click();
    await page.locator("#settings-default-model").fill("test-model");
    await page.locator("#settings-default-effort").selectOption("high");
    await page.locator("#settings-save-models").click();
    assert.equal(
      await page.evaluate(() => window.agentWorkspace.getDefaults().model),
      "test-model",
    );
    await page.locator("#settings-nav button").filter({ hasText: "Memory" }).click();
    await page.locator("#settings-memory").fill("Use accessible controls");
    await page.locator("#settings-save-memory").click();
    assert.equal(
      await page.evaluate(() => window.agentWorkspace.getDefaults().instructions),
      "Use accessible controls",
    );
    await page.locator("#settings-back").click();
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.locator("#rectangle").click();
    const before = await page.evaluate(() => window.design.getDocument().pages[0].nodes.at(-1).x);
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.evaluate(() => window.design.getDocument().pages[0].nodes.at(-1).x),
      before + 3,
    );
    await page.reload();
    await waitForUiReady(page);
    await page.waitForSelector("#shell-settings", { state: "attached" });
    assert.equal(await page.evaluate(() => window.appPreferences.get().smallNudge), 3);
    assert.equal(
      await page.evaluate(() => window.agentWorkspace.getDefaults().instructions),
      "Use accessible controls",
    );
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.locator("#shell-settings").click();
    // Design preferences (Memory): real preload IPC when the desktop exposes it, else an in-page shim of the same API.
    const nav = async (t) => page.locator("#settings-nav button").filter({ hasText: t }).click();
    const native = await page.evaluate(() => !!window.desktop?.designPreferences?.list);
    if (!native)
      await page.evaluate(() => {
        const items = [];
        let n = 0;
        const api = {
          list: async () => items.map((p) => ({ ...p })),
          save: async (text) => {
            const p = { id: "pref_" + ++n, text };
            items.push(p);
            return p;
          },
          update: async (id, text) => {
            const p = items.find((p) => p.id === id);
            if (!p) throw Error("missing");
            p.text = text;
            return p;
          },
          remove: async (id) => {
            items.splice(
              items.findIndex((p) => p.id === id),
              1,
            );
            return { deleted: true, id };
          },
        };
        try {
          Object.defineProperty(window, "desktop", {
            configurable: true,
            value: { ...window.desktop, designPreferences: api },
          });
        } catch {
          window.__shimFailed = true;
        }
      });
    const shimmed = native || !(await page.evaluate(() => window.__shimFailed));
    console.log(
      "design preferences via",
      native ? "preload IPC" : shimmed ? "in-page shim" : "fallback note",
    );
    await nav("Agents");
    await nav("Memory");
    await page.waitForSelector("#settings-design-preferences-label");
    if (shimmed) {
      await page.getByText("No saved preferences yet").waitFor();
      assert.equal(
        await page.locator("#settings-design-preference-count").innerText(),
        "0 / 50",
        "preference count shows the 50-item limit",
      );
      // 280-character limit with a live counter on add.
      await page.locator("#settings-design-preference-new").fill("x".repeat(300));
      assert.equal(
        (await page.locator("#settings-design-preference-new").inputValue()).length,
        280,
        "new preferences stop at 280 characters",
      );
      assert.equal(
        await page.locator("#settings-design-preference-new-counter").innerText(),
        "280 / 280",
      );
      await page.locator("#settings-design-preference-new").fill("Cards use 12px radius");
      await page
        .locator("#settings-design-preference-new-counter")
        .filter({ hasText: "21 / 280" })
        .waitFor();
      await page.locator("#settings-design-preference-add").click();
      await page
        .locator("[data-preference-text]")
        .filter({ hasText: "Cards use 12px radius" })
        .waitFor();
      await page
        .locator("#settings-design-preference-count")
        .filter({ hasText: "1 / 50" })
        .waitFor();
      await page.locator('[data-preference-action="edit"]').first().click();
      await page.locator("[data-preference-edit]").fill("Cards use 8px radius");
      await page
        .locator("#settings-design-preference-edit-counter")
        .filter({ hasText: "20 / 280" })
        .waitFor();
      await page.locator("[data-preference-save]").click();
      await page
        .locator("[data-preference-text]")
        .filter({ hasText: "Cards use 8px radius" })
        .waitFor();
      assert.deepEqual(
        await page.evaluate(async () =>
          (await window.desktop.designPreferences.list()).map((p) => p.text),
        ),
        ["Cards use 8px radius"],
      );
      await page.locator('[data-preference-action="delete"]').first().click();
      await page.getByText("No saved preferences yet").waitFor();
      if (native) {
        const raw = JSON.parse(
          await fs.readFile(path.join(dir, "design-preferences.json"), "utf8"),
        );
        assert.deepEqual(raw.preferences, []);
      }
    } else await page.getByText("Available in the desktop app").waitFor();
    // Memory: agent memory sections read a temp home (VERYNIZE_AGENT_HOME), never the real ~/.codex or ~/.claude.
    await page.waitForSelector("#settings-memory-repoless-label");
    await page.locator('[data-memory-card="repoless-claude"] [data-memory-empty]').waitFor();
    assert.match(
      await page.locator('[data-memory-card="repoless-claude"] [data-memory-path]').innerText(),
      /agent-memory\/[0-9a-f-]{36}$/,
    );
    assert.equal(
      await page.locator('[data-memory-card="about-codex"] [data-memory-status]').innerText(),
      "Off until you turn on features.memories",
    );
    assert.equal(
      await page.locator('[data-memory-counts="codex"]').innerText(),
      "0 conversation summaries · 0 skills",
    );
    assert.equal(
      await page.locator('[data-instructions-file="codexAgents"]').innerText(),
      "~/.codex/AGENTS.md",
    );
    await page.getByText("Read by Codex · Verynize gives it to Claude Code chats").waitFor();
    assert.equal(await page.locator("#settings-memory").count(), 1);
    // Usage: provider checks are disabled in this test (no network); the local Verynize card always renders.
    await nav("Usage");
    await page.waitForSelector("#settings-usage-label");
    await page.locator("#settings-usage-layers").waitFor();
    assert.equal(await page.locator("#settings-usage-layers").innerText(), "0");
    await page.locator('[data-usage-agent="claude"][data-usage-status="unavailable"]').waitFor();
    await page.locator('[data-usage-agent="codex"][data-usage-status="unavailable"]').waitFor();
    await page.locator("#settings-usage-refresh").click();
    await page.locator('[data-usage-agent="codex"][data-usage-status="unavailable"]').waitFor();
    // Allowed actions moved into Agents › Allowed without asking; the old section id redirects there.
    assert.equal(
      await page.locator("#settings-nav button").filter({ hasText: "Allowed actions" }).count(),
      0,
    );
    await page.evaluate(() => window.appSettings.select("permissions"));
    await page.waitForSelector("#settings-allowed-without-asking-label");
    // Agents lower half (Wonder 71): follow-ups, expanded work, response style, personality, attribution, folder, branch prefix, modes, rules.
    await nav("Agents");
    await page.locator('[data-follow-up="steer"]').click();
    await page.waitForFunction(() => window.agentBehavior.get().followUp === "steer");
    await page.locator("#settings-expand-work").click();
    await page.waitForFunction(() => window.agentBehavior.get().expandWork === true);
    await page.locator('[data-personality="none"]').click();
    await page.waitForFunction(() => window.agentBehavior.get().codexPersonality === "none");
    await page.locator("#settings-claude-style").selectOption("Explanatory");
    await page.waitForFunction(
      () => window.agentBehavior.get().claudeOutputStyle === "Explanatory",
    );
    await page.locator("#settings-credit-agent").click();
    await page.waitForFunction(() => window.agentBehavior.get().creditAgent === false);
    await page
      .locator("#settings-commit-author [data-author-name]")
      .filter({ hasText: "Ada Lovelace" })
      .waitFor();
    await page
      .locator("#settings-commit-author [data-author-email]")
      .filter({ hasText: "ada@example.com" })
      .waitFor();
    assert.equal(await page.locator("#settings-verynize-folder").textContent(), "~/Verynize");
    await page.locator("#settings-branch-prefix").fill("team/ada");
    await page.locator("#settings-branch-prefix").press("Enter");
    await page.waitForFunction(() => window.agentBehavior.get().branchPrefix === "team/ada");
    await page.locator('[data-mode-repo="default"]').click();
    await page.locator('[data-mode-option="auto"]').click();
    assert.equal(
      await page.evaluate(() => window.agentWorkspace.getDefaults().access),
      "auto",
      "the Default row is the chat defaults’ access",
    );
    const saved = JSON.parse(await fs.readFile(path.join(dir, "agent-behavior.json"), "utf8"));
    assert.deepEqual(
      [
        saved.followUp,
        saved.expandWork,
        saved.codexPersonality,
        saved.claudeOutputStyle,
        saved.creditAgent,
        saved.branchPrefix,
      ],
      ["steer", true, "none", "Explanatory", false, "team/ada"],
    );
    await page.locator('[data-allow-group="codex"] [data-allow-rule]').first().waitFor();
    assert.equal(
      await page
        .locator('[data-allow-group="codex"]')
        .getByText("Commands that start with “npm test”")
        .count(),
      1,
    );
    assert.equal(
      await page
        .locator('[data-allow-group="claude"]')
        .getByText("Commands that start with “npm run lint”")
        .count(),
      1,
    );
    const npmRule = page
      .locator('[data-allow-group="codex"] [data-allow-rule]')
      .filter({ hasText: "npm test" });
    await npmRule.locator("[data-allow-remove]").click();
    await npmRule.waitFor({ state: "detached" });
    assert.equal(
      await fs.readFile(path.join(home, ".codex", "rules", "default.rules"), "utf8"),
      'prefix_rule(pattern=["git", "status"], decision="allow")\n',
    );
    await page.locator('[data-allow-group="claude"] [data-allow-remove]').click();
    await page.locator('[data-allow-group="claude"]').waitFor({ state: "detached" });
    // Only the rule is removed. (The real `claude` CLI, run for Agents › Tools against this HOME, may rewrite other keys such as model.)
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(home, ".claude", "settings.json"), "utf8"))
        .permissions,
      { allow: [] },
    );
    await nav("Default Models");
    assert.equal(
      await page.locator("#settings-default-access").inputValue(),
      "auto",
      "Default Models › Access shows the same stored value",
    );
    // Agents › About shows the tools version pushed by the MCP bridge.
    await nav("Agents");
    await page.waitForFunction(
      () =>
        /^[0-9a-f]{12}$/.test(document.getElementById("settings-tools-version")?.textContent || ""),
      null,
      { timeout: 15000 },
    );
    await nav("Preferences");
    // Preferences › Advanced: Wonder defaults, toggles persist (data-pref contract).
    const prefs = () => page.evaluate(() => window.appPreferences.get());
    const advanced = {
      chatTabs: false,
      lineChanges: false,
      openLinksInApp: true,
      attachSelection: true,
      openPullRequest: false,
    };
    for (const [key, value] of Object.entries(advanced)) {
      assert.equal(
        await page.locator(`[data-pref="${key}"]`).getAttribute("aria-checked"),
        String(value),
        key + " default",
      );
      await page.locator(`[data-pref="${key}"]`).click();
      await page.waitForFunction(([k, v]) => window.appPreferences.get()[k] === v, [key, !value]);
    }
    // Notifications › custom MP3: the native picker (stubbed) copies the file into userData; preview plays it.
    const mp3 = path.join(dir, "ding.mp3");
    await fs.writeFile(mp3, Buffer.concat([Buffer.from("ID3"), Buffer.alloc(509)]));
    const notMp3 = path.join(dir, "notes.mp3");
    await fs.writeFile(notMp3, "plain text");
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, notMp3);
    await page.locator('[data-pref="sound"]').selectOption("choose-mp3");
    await page.getByText("That file is not an MP3").waitFor();
    assert.equal((await prefs()).sound, "none");
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, mp3);
    await page.locator('[data-pref="sound"]').selectOption("choose-mp3");
    await page.waitForFunction(
      () =>
        window.appPreferences.get().sound === "custom" &&
        window.appPreferences.get().customSoundName === "ding.mp3",
    );
    assert.equal(await page.locator('[data-pref="sound"]').inputValue(), "custom");
    assert.deepEqual(
      await fs.readFile(path.join(dir, "sounds", "custom.mp3")),
      await fs.readFile(mp3),
    );
    assert.equal(
      await page.evaluate(async () => (await window.desktop.appPreferences.readSound()).length),
      512,
    );
    await page.locator('[data-pref="sound"]').selectOption("marimba");
    assert.equal((await prefs()).sound, "marimba");
    assert.equal(
      await page.evaluate(() => window.verynizeAlerts.handle({ type: "permission-request" })),
      true,
      "needs-you events are handled",
    );
    // Attach selection to chat (now off): the canvas selection is not added to the composer; on again, it is.
    const nodeId = await page.evaluate(() => window.design.getDocument().pages[0].nodes.at(-1).id);
    await page.evaluate((id) => window.design.setSelection([id]), nodeId);
    assert.equal(
      (await page.evaluate(() => window.agentWorkspace.getState().mentions || [])).length,
      0,
      "selection not attached while off",
    );
    await page.locator('[data-pref="attachSelection"]').click();
    await page.waitForFunction(
      (id) => (window.agentWorkspace.getState().mentions || []).some((m) => m.id === id),
      nodeId,
    );
    // Design links (now off): a verynize:// link from the OS is ignored; on again, it selects the element.
    const pageId = await page.evaluate(() => window.design.getDocument().activePage);
    const link = `verynize://node/doc/${pageId}/${nodeId}`;
    const openUrl = (url) =>
      app.evaluate(({ app }, u) => app.emit("open-url", { preventDefault() {} }, u), url);
    await page.evaluate(() => window.design.setSelection([]));
    await openUrl(link);
    await page.waitForTimeout(400);
    assert.deepEqual(
      await page.evaluate(() => window.design.getSelection()),
      [],
      "links ignored while off",
    );
    await page.locator('[data-pref="openLinksInApp"]').click();
    await page.waitForFunction(() => window.appPreferences.get().openLinksInApp === true);
    await page.waitForTimeout(200);
    await openUrl(link);
    await page.waitForFunction((id) => window.design.getSelection().join() === id, nodeId);
    assert.equal(
      await page.locator("#settings-screen").isVisible(),
      false,
      "opening a link leaves settings",
    );
    await page.reload();
    await waitForUiReady(page);
    await page.waitForSelector("#shell-settings", { state: "attached" });
    const savedPrefs = await prefs();
    assert.deepEqual(
      {
        chatTabs: savedPrefs.chatTabs,
        lineChanges: savedPrefs.lineChanges,
        openLinksInApp: savedPrefs.openLinksInApp,
        attachSelection: savedPrefs.attachSelection,
        openPullRequest: savedPrefs.openPullRequest,
        sound: savedPrefs.sound,
        customSoundName: savedPrefs.customSoundName,
      },
      {
        chatTabs: true,
        lineChanges: true,
        openLinksInApp: true,
        attachSelection: true,
        openPullRequest: true,
        sound: "marimba",
        customSoundName: "ding.mp3",
      },
    );
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.locator("#shell-settings").click();
    assert.equal(await page.locator('[data-pref="chatTabs"]').getAttribute("aria-checked"), "true");
    assert.equal(
      await page.locator('[data-pref="sound"] option[value="custom"]').textContent(),
      "ding.mp3",
    );
    await page.screenshot({ path: "/tmp/better-settings.png" });
    console.log(
      "PASS reference settings UI, themes, model defaults, instructions, design preferences, tools version, custom nudges, advanced preferences, custom sound, attach selection, design links and persistence",
    );
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
