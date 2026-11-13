// Composer bottom-right indicators (Wonder parity): "Works with" files, Tools (MCP status) and the usage ring popover.
// Runs against tests/fixtures/fake-codex.cjs with a fixture HOME (never the real ~/.claude or ~/.codex); provider
// account usage is stubbed in the main process, so nothing touches the network.
const { _electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chat-indicators-")),
    bin = path.join(root, "bin"),
    home = path.join(root, "home");
  await fs.mkdir(bin);
  await fs.mkdir(path.join(home, ".codex"), { recursive: true });
  await fs.copyFile(path.join(__dirname, "fixtures/fake-codex.cjs"), path.join(bin, "codex"));
  await fs.chmod(path.join(bin, "codex"), 0o755);
  await fs.writeFile(path.join(home, ".codex/config.toml"), '[mcp_servers.rea]\ncommand = "rea"\n');
  const env = {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    HOME: home,
    VERYNIZE_AGENT_HOME: home,
    VERYNIZE_DISABLE_AGENT_USAGE: "1",
    FAKE_CODEX_LOG: path.join(root, "codex.log"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  delete env.CODEX_HOME;
  await require("./helpers/chatgpt-provider.cjs").seedChatGPTAccount(path.join(root, "profile"));
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${path.join(root, "profile")}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await waitForUiReady(page);
    await page.waitForSelector("#project-toggle", { state: "attached" });
    await page.evaluate(() => window.agentWorkspace.openChat());
    await page.evaluate(() =>
      window.agentWorkspace.setDefaults({ agent: "codex", access: "edit" }),
    );
    // Stub provider account usage (Settings › Usage data) and this week's AI layers in the main process.
    const resetsAt = Date.now() + 3 * 3600_000;
    await app.evaluate(({ BrowserWindow }, resetsAt) => {
      // Home renders file covers in offscreen windows; stub the editor window's handlers.
      const ipc = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().startsWith("app://verynize"),
      ).webContents.ipc;
      ipc.removeHandler("desktop:agentUsage");
      ipc.removeHandler("desktop:agentLayerUsage");
      ipc.handle("desktop:agentUsage", (_e, options) => ({
        agent: options.agent,
        status: "ready",
        email: "tester@example.com",
        plan: "Pro",
        limits: [
          { id: "codex:primary", label: "5-hour limit", usedPercent: 28, resetsAt },
          { id: "codex:secondary", label: "Weekly limit", usedPercent: 4 },
        ],
        updatedAt: Date.now(),
      }));
      ipc.handle("desktop:agentLayerUsage", () => ({
        thisWeek: 174,
        lastWeek: 20,
        total: 400,
        weekStart: Date.now() - 86400000,
        resetsAt: Date.now() + 5 * 86400000,
      }));
    }, resetsAt);
    const popover = (name) => page.locator(`[data-chat-popover="${name}"]`);
    const close = async (name) => {
      await page.keyboard.press("Escape");
      await popover(name).waitFor({ state: "detached" });
    };

    // 1. Before the agent starts: Tools lists Verynize + the configured Codex server, "Not started"; no files yet.
    assert.equal(
      await page.locator('[data-chat-indicator="works-with"]').count(),
      0,
      "no Works with before the chat touches a file",
    );
    await page.locator('[data-chat-indicator="tools"]').click();
    await page.locator('[data-chat-popover="tools"] [data-mcp-server="rea"]').waitFor();
    assert.deepEqual(
      await popover("tools")
        .locator("[data-mcp-server]")
        .evaluateAll((rows) =>
          rows.map((r) => [r.dataset.mcpServer, r.dataset.status, r.textContent]),
        ),
      [
        ["verynize", "not-started", "VerynizeNot started"],
        ["rea", "not-started", "reaNot started"],
      ],
    );
    assert.match(await popover("tools").textContent(), /The list fills in when the agent starts\./);
    await close("tools");

    // 2. A turn: the runtime streams MCP startup status, a 1M context window and a rate-limit update.
    const fileId = await page.evaluate(() => window.fileLibrary.currentId);
    const fileName = await page.evaluate(
      () => window.fileLibrary.list().find((f) => f.id === window.fileLibrary.currentId).name,
    );
    await page.locator("#project-prompt").fill("Show the indicators");
    await page.locator("#project-run").click();
    await page.waitForFunction(
      () => window.agentWorkspace.getUsage().completed === 1 && !window.agentWorkspace.isBusy(),
      null,
      { timeout: 15000 },
    );

    await page.locator('[data-chat-indicator="tools"]').click();
    await page
      .locator('[data-chat-popover="tools"] [data-mcp-server="rea"][data-status="failed"]')
      .waitFor();
    assert.deepEqual(
      await popover("tools")
        .locator("[data-mcp-server]")
        .evaluateAll((rows) => rows.map((r) => [r.dataset.mcpServer, r.dataset.status])),
      [
        ["verynize", "connected"],
        ["rea", "failed"],
      ],
    );
    assert.equal(
      await popover("tools").locator('[data-mcp-server="rea"]').getAttribute("title"),
      "spawn rea ENOENT",
    );
    // Refresh re-queries; with no run open the configured list never overwrites what the agent reported.
    await popover("tools").locator("[data-mcp-refresh]").click();
    await page.waitForFunction(() => !document.querySelector("[data-mcp-refresh]")?.disabled);
    assert.equal(
      await popover("tools").locator('[data-mcp-server="verynize"]').getAttribute("data-status"),
      "connected",
    );
    await close("tools");

    // 3. Usage ring: the most constraining value (35% live 5-hour limit vs 11% context) and the popover rows.
    assert.equal(
      await page.locator('[data-chat-indicator="usage"]').getAttribute("aria-label"),
      "Codex usage 35% used",
    );
    await page.locator('[data-chat-indicator="usage"]').click();
    await popover("usage").locator("[data-usage-email]").waitFor();
    const usage = popover("usage");
    assert.match(await usage.textContent(), /^Codex usage/);
    assert.equal(await usage.locator("[data-usage-email]").textContent(), "tester@example.com");
    assert.match(
      await usage.locator('[data-usage-row="codex:primary"]').textContent(),
      /^5-hour limit35% usedResets \d{1,2}:\d{2}\s?[AP]M$/,
    );
    assert.match(
      await usage.locator('[data-usage-row="codex:secondary"]').textContent(),
      /^Weekly limit4% used$/,
    );
    assert.equal(
      await usage
        .locator('[data-usage-row="codex:primary"] [data-slot="progress"]')
        .getAttribute("aria-valuenow"),
      "35",
    );
    assert.equal(
      await usage.locator('[data-usage-row="layers"]').count(),
      0,
      "no AI layers row in the chat usage popover",
    );
    assert.match(
      await usage.locator('[data-usage-row="context"]').textContent(),
      /Context window11% used106\.6K \/ 1\.0M tokens/,
    );
    await usage.getByRole("button", { name: "Context window" }).click();
    assert.deepEqual(
      await usage
        .locator("[data-context-breakdown] li")
        .evaluateAll((rows) => rows.map((r) => r.textContent)),
      ["Input106.6K", "Output900"],
    );
    await usage.getByRole("button", { name: "Open Settings › Usage" }).click();
    await page.waitForFunction(() => document.body.classList.contains("settings-open"));
    await page.locator("#settings-back").click();
    await page.waitForFunction(() => !document.body.classList.contains("settings-open"));

    // 4. Works with: the canvas sent as context is listed; clicking it opens it on the canvas.
    const worksWith = page.locator('[data-chat-indicator="works-with"]');
    await worksWith.waitFor();
    assert.equal(await worksWith.textContent(), "1");
    assert.equal(await worksWith.getAttribute("aria-label"), "Works with 1 file");
    await page.evaluate(async () => {
      const doc = structuredClone(window.design.getDocument());
      doc.name = "Another file";
      doc.pages = doc.pages.map((p) => ({ ...p, id: p.id + "-other", nodes: [] }));
      doc.activePage = doc.pages[0].id;
      await window.fileLibrary.createFromDocument(doc);
    });
    await page.waitForFunction((id) => window.fileLibrary.currentId !== id, fileId);
    await worksWith.click();
    assert.equal(
      await popover("works-with").locator(`[data-works-with-file="${fileId}"]`).textContent(),
      fileName,
    );
    await popover("works-with").locator(`[data-works-with-file="${fileId}"]`).click();
    await page.waitForFunction((id) => window.fileLibrary.currentId === id, fileId);

    // 5. While a run is open, Tools asks the runtime itself (Codex mcpServerStatus/list).
    await page.locator("#project-prompt").fill("slow indicators");
    await page.locator("#project-run").click();
    await page.waitForFunction(() => window.agentWorkspace.isBusy());
    await page.locator('[data-chat-indicator="tools"]').click();
    await page
      .locator('[data-chat-popover="tools"] [data-mcp-server="figma"][data-status="needs-auth"]')
      .waitFor();
    assert.deepEqual(
      await popover("tools")
        .locator("[data-mcp-server]")
        .evaluateAll((rows) => rows.map((r) => [r.dataset.mcpServer, r.dataset.status])),
      [
        ["verynize", "connected"],
        ["rea", "failed"],
        ["figma", "needs-auth"],
      ],
    );
    const list = (await fs.readFile(path.join(root, "codex.log"), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse)
      .filter((c) => c.rpc === "mcpServerStatus/list");
    assert.ok(
      list.length >= 1 && list[0].params.threadId,
      "mcpServerStatus/list is asked for the chat thread",
    );
    await close("tools");
    await page.locator("#project-cancel").click();
    await page.waitForFunction(() => !window.agentWorkspace.isBusy(), null, { timeout: 15000 });
    console.log(
      "PASS chat indicators: works with, tools status (configured, streamed, live), usage popover",
    );
  } finally {
    await app.close().catch(() => {});
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
