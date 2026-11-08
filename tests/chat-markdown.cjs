// Agent reply Markdown in Electron (web/src/islands/chat/markdown.tsx: react-markdown + remark-gfm) against
// tests/fixtures/fake-codex.cjs, whose "markdown sample" reply has a GFM table, task list, fenced code, line breaks,
// a bare verynize:// URL, a web autolink, a javascript: link and raw HTML.
const { _electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chat-markdown-")),
    bin = path.join(root, "bin");
  await fs.mkdir(bin);
  await fs.copyFile(path.join(__dirname, "fixtures/fake-codex.cjs"), path.join(bin, "codex"));
  await fs.chmod(path.join(bin, "codex"), 0o755);
  const env = {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    FAKE_CODEX_LOG: path.join(root, "codex.log"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  await require("./helpers/chatgpt-provider.cjs").seedChatGPTAccount(path.join(root, "profile"));
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${path.join(root, "profile")}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await waitForUiReady(page);
    await page.setViewportSize({ width: 1440, height: 870 });
    await page.waitForSelector("#project-toggle", { state: "attached" });
    await page.evaluate(() => window.agentWorkspace.openChat());
    await page.evaluate(() =>
      window.agentWorkspace.setDefaults({ agent: "codex", access: "edit" }),
    );
    await page.locator("#project-prompt").fill("markdown sample");
    await page.locator("#project-prompt").press("Enter");
    await page.waitForFunction(
      () => window.agentWorkspace.getUsage().completed === 1 && !window.agentWorkspace.isBusy(),
      null,
      { timeout: 15000 },
    );
    const reply = page.locator(".chat-message.assistant").last().locator("[data-chat-markdown]");

    // GFM table: header, rows, inline code in cells, column alignment.
    const table = reply.locator("table");
    assert.equal(await table.count(), 1, "the table renders as a <table>");
    assert.deepEqual(await table.locator("th").allTextContents(), ["Variable", "Nilai", "Dipakai"]);
    assert.deepEqual(await table.locator("tbody tr").first().locator("td").allTextContents(), [
      "font/body",
      "Instrument Sans 400",
      "Teks isi",
    ]);
    assert.equal(await table.locator("tbody td code").count(), 2);
    assert.equal(
      await table
        .locator("th")
        .nth(1)
        .evaluate((el) => getComputedStyle(el).textAlign),
      "center",
    );
    assert.doesNotMatch(await reply.textContent(), /\|---/, "no raw table syntax");

    // Inline formatting, single newlines kept as breaks, task list, fenced code (no inline-code chip inside).
    assert.equal(await reply.locator("strong").first().textContent(), "Fonts");
    assert.ok(
      (await reply.locator("p br").count()) >= 2,
      "newlines inside a paragraph are line breaks",
    );
    assert.deepEqual(
      await reply
        .locator("[role=checkbox]")
        .evaluateAll((boxes) => boxes.map((b) => b.getAttribute("aria-checked"))),
      ["true", "false"],
    );
    assert.equal(await reply.locator("pre").textContent(), "const a = 1;");
    assert.equal(await reply.locator("pre code").count(), 0);
    assert.equal(await reply.locator("del").textContent(), "old");

    // Links: verynize:// (bare) and https are links; javascript: is not; raw HTML is dropped.
    const hrefs = await reply
      .locator("a")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    assert.deepEqual(hrefs, ["verynize://node/editor/page-1/abcd", "https://example.com/docs"]);
    assert.equal(await reply.locator('a[href^="https"]').getAttribute("target"), "_blank");
    assert.match(await reply.textContent(), /bad/);
    assert.equal(await reply.locator("b").count(), 0, "raw HTML is not rendered");

    if (process.env.CHAT_MARKDOWN_SHOT) {
      await fs.mkdir(process.env.CHAT_MARKDOWN_SHOT, { recursive: true });
      await reply.screenshot({ path: path.join(process.env.CHAT_MARKDOWN_SHOT, "reply.png") });
    }
    console.log("PASS chat markdown: GFM table, task list, code, breaks, safe links, no raw HTML");
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
