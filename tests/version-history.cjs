// Version history in the desktop editor (docs/version-history.md, web/version-history.js and the
// history island): versions captured when the editor switches between the person and an agent
// (real MCP bridge edits) and after an idle pause (shortened timer), the panel opened from the
// artboard's context menu, Preview without changing the document, Restore as one undoable edit
// that stores the replaced state first, Restore as copy, restoring a deleted artboard, and the
// NAME.verynize.history/ sidecar of a native file with the MCP list_versions / restore_version tools.
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const IDLE_MS = 1500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-version-history-"));
  const env = {
    ...process.env,
    VERYNIZE_SKIP_ONBOARDING: "1",
    VERYNIZE_LAUNCH_EDITOR: "1",
    VERYNIZE_PREFERENCES: path.join(profile, "design-preferences.json"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VERYNIZE_DISABLE_MCP;
  let app, client;
  try {
    app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`], timeout: 20000 });
    const page = await app.firstWindow({ timeout: 20000 });
    await moveOffCursor(app);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await waitForUiReady(page);
    await page.waitForSelector("#canvas");
    await page.evaluate(
      (idleMs) => window.versionHistory.configure({ idleMs, debounceMs: 50 }),
      IDLE_MS,
    );

    // The MCP bridge (desktop/mcp-bridge.cjs): agent edits commit into the open editor.
    const file = path.join(profile, "mcp.json");
    let info;
    for (let i = 0; i < 100 && !info; i++)
      try {
        info = JSON.parse(await fs.readFile(file, "utf8"));
      } catch {
        await sleep(100);
      }
    assert.ok(info, "bridge file written");
    client = new Client({ name: "version-history-test", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(info.url), {
        requestInit: { headers: { Authorization: `Bearer ${info.token}` } },
      }),
    );
    const call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, `${name}: ${result.content?.[0]?.text}`);
      return result.content[0].text;
    };
    const json = async (name, args) => JSON.parse(await call(name, args));

    const text = (id) =>
      page.evaluate((nodeId) => {
        const doc = window.design.getDocument();
        return doc.pages.flatMap((p) => p.nodes).find((n) => n.id === nodeId)?.text ?? null;
      }, id);
    const versions = (artboardId) =>
      page.evaluate((id) => window.versionHistory.list(id), artboardId);
    const settle = () => page.evaluate(() => window.versionHistory.flush());
    async function waitFor(check, label, timeout = 8000) {
      const until = Date.now() + timeout;
      for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() > until) throw new Error(`Timed out: ${label}`);
        await sleep(100);
      }
    }

    // ---- a library document (IndexedDB) ---------------------------------------------------------
    await page.evaluate(() => {
      const doc = window.design.getDocument();
      doc.pages = [
        {
          id: "p1",
          name: "Page 1",
          nodes: [
            {
              id: "art",
              name: "Hero",
              type: "frame",
              x: 0,
              y: 0,
              w: 480,
              h: 320,
              color: "#ffffff",
              layout: "free",
            },
            {
              id: "title",
              name: "Title",
              type: "text",
              parentId: "art",
              x: 40,
              y: 40,
              w: 300,
              h: 40,
              text: "Start",
              fontSize: 24,
              color: "#111111",
            },
            {
              id: "side",
              name: "Side",
              type: "frame",
              x: 600,
              y: 0,
              w: 200,
              h: 200,
              color: "#ffffff",
              layout: "free",
            },
          ],
        },
      ];
      doc.activePage = "p1";
      window.design.setDocument(doc);
      window.design.setCamera(80, 80, 1);
    });
    assert.equal((await page.evaluate(() => window.versionHistory.target())).kind, "local");
    assert.deepEqual(await versions("art"), [], "loading a document is not an edit");

    // The person edits, then the agent edits through MCP: the person's work is stored in their name.
    await page.evaluate(() => window.design.updateNodes(["title"], { text: "User one" }));
    await settle();
    assert.deepEqual(await versions("art"), [], "one editor's burst stores nothing yet");
    const title = (await json("find_elements", { queries: [{ query: "User one" }] })).matches[0].id;
    await call("update_elements", { edit: `{/* edit ${title} */}<p>Agent text</p>` });
    assert.equal(await text("title"), "Agent text");
    await settle();
    let list = await versions("art");
    assert.equal(list.length, 1, JSON.stringify(list));
    assert.equal(list[0].reason, "switch");
    assert.equal(list[0].author.kind, "user");
    const userVersion = list[0].id;

    // Back to the person: the agent's work is stored in the agent's name.
    await page.evaluate(() => window.design.updateNodes(["title"], { text: "User two" }));
    await settle();
    list = await versions("art");
    assert.equal(list.length, 2);
    assert.equal(list[0].author.kind, "agent");
    const agentVersion = list[0].id;

    // Idle: after the (shortened) pause the person's last state is stored without another edit.
    list = await waitFor(async () => {
      const current = await versions("art");
      return current.length === 3 ? current : null;
    }, "idle version");
    assert.equal(list[0].reason, "idle");
    assert.equal(list[0].author.kind, "user");

    // The panel, from the artboard's context menu.
    const box = await page.locator('#canvas [data-id="art"]').boundingBox();
    await page.mouse.click(box.x + box.width - 20, box.y + box.height - 20, { button: "right" });
    await page.locator('[data-bd-context-menu] [data-command="menu.versionHistory"]').click();
    const panel = page.locator("#version-history");
    await panel.waitFor();
    assert.equal(await panel.getAttribute("data-artboard"), "art");
    await page.waitForFunction(
      () => document.querySelectorAll("#version-history [data-version]").length === 3,
    );
    assert.deepEqual(
      await panel
        .locator("li[data-version]")
        .evaluateAll((rows) => rows.map((row) => row.dataset.reason)),
      ["idle", "switch", "switch"],
    );
    assert.equal(
      await panel.locator(`li[data-version="${agentVersion}"]`).getAttribute("data-author-kind"),
      "agent",
    );
    if (process.env.VERSION_HISTORY_SCREENSHOT)
      await page.screenshot({ path: process.env.VERSION_HISTORY_SCREENSHOT });

    // Preview: the canvas shows the agent's version, the document is unchanged.
    await panel.locator(`[data-version-preview="${agentVersion}"]`).click();
    await page.locator("#version-preview-banner").waitFor();
    await page.waitForFunction(() =>
      document.querySelector('#canvas [data-id="title"]')?.textContent.includes("Agent text"),
    );
    assert.equal(await text("title"), "User two", "preview does not change the document");
    await page.locator("#version-preview-exit").click();
    await page.locator("#version-preview-banner").waitFor({ state: "detached" });
    await page.waitForFunction(() =>
      document.querySelector('#canvas [data-id="title"]')?.textContent.includes("User two"),
    );

    // Restore: one edit; the replaced state is stored first; undo reverts it in one step.
    await panel.locator(`[data-version-restore="${userVersion}"]`).click();
    await waitFor(async () => (await text("title")) === "User one", "restored text");
    list = await waitFor(async () => {
      const current = await versions("art");
      return current[0]?.reason === "restore" ? current : null;
    }, "restore version");
    assert.equal(list.length, 4);
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.click("#undo");
    assert.equal(await text("title"), "User two", "one undo step reverts the restore");
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.click("#redo");
    assert.equal(await text("title"), "User one");

    // Restore as copy: a new artboard next to the original.
    await panel.locator(`[data-version-restore-copy="${agentVersion}"]`).click();
    const copy = await waitFor(
      () =>
        page.evaluate(() =>
          window.design.getDocument().pages[0].nodes.find((n) => n.name === "Hero (restored)"),
        ),
      "restored copy",
    );
    assert.notEqual(copy.id, "art");
    assert.equal(copy.x, 560);
    assert.equal(await text("title"), "User one", "the original artboard is unchanged");

    // A deleted artboard: its versions remain and Restore re-creates it.
    await page.evaluate(() => {
      window.design.setSelection(["art"]);
      window.design.runCommand("edit.delete");
    });
    assert.equal(await text("title"), null);
    await settle();
    await page.evaluate((id) => window.versionHistory.restore(id), agentVersion);
    assert.equal(await text("title"), "Agent text", "restore re-creates the deleted artboard");
    await page.locator("[data-version-close]").click();
    await panel.waitFor({ state: "detached" });

    // ---- a native file (sidecar next to it) ----------------------------------------------------
    await json("create_document", { name: "hist", title: "History", open: true });
    await page.waitForFunction(() => window.design.getDocument().name === "History");
    assert.equal((await page.evaluate(() => window.versionHistory.target())).kind, "native");
    const created = await json("create_artboard", {
      code: '<div data-node-label="Native" className="w-[300px] h-[200px] bg-white"><p className="text-black">Agent made</p></div>',
    });
    const board = created.trees[0].id;
    const nodeId = await page.evaluate(
      () => window.design.getDocument().pages[0].nodes.find((n) => n.type === "text").id,
    );
    const boardId = await page.evaluate(
      () => window.design.getDocument().pages[0].nodes.find((n) => !n.parentId).id,
    );
    await page.evaluate((id) => window.design.updateNodes([id], { text: "User made" }), nodeId);
    await settle();
    const sidecar = path.join(profile, "documents", "hist.verynize.history", "index.json");
    const index = await waitFor(async () => {
      try {
        const data = JSON.parse(await fs.readFile(sidecar, "utf8"));
        return data.versions.length ? data : null;
      } catch {
        return null;
      }
    }, "sidecar index");
    assert.equal(index.versions[0].author.kind, "agent");
    assert.equal(index.versions[0].artboardId, boardId);
    const disk = JSON.parse(
      await fs.readFile(path.join(profile, "documents", "hist.verynize.json"), "utf8"),
    );
    assert.ok(
      !JSON.stringify(disk).includes(index.versions[0].id),
      "versions stay out of the document",
    );

    // MCP list_versions / restore_version on the live document, undoable in one step.
    const listed = await json("list_versions", { artboard: board });
    assert.equal(listed.versions[0].version, index.versions[0].id);
    const restored = await json("restore_version", {
      artboard: board,
      version: listed.versions[0].version,
    });
    assert.equal(restored.live, true);
    assert.equal(await text(nodeId), "Agent made");
    const after = await json("list_versions", { artboard: board });
    assert.equal(after.versions[0].reason, "restore", "the replaced state is a version");
    await page.locator(".app-menu-trigger:visible").first().click();
    await page.click("#undo");
    assert.equal(await text(nodeId), "User made", "an MCP restore is one undo step");

    assert.deepEqual(errors, []);
    console.log(
      "PASS version history: user/agent switch and idle captures, context-menu panel, preview without changes, restore + undo, restore as copy, deleted artboard re-created, native sidecar, MCP list/restore live",
    );
  } finally {
    await client?.close().catch(() => {});
    await app?.close().catch(() => {});
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
