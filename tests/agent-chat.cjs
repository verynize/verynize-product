// End-to-end chat panel test in Electron against tests/fixtures/fake-codex.cjs (Codex app-server
// JSON-RPC fake). Covers quick chats in a scratch folder, streaming text, tool cards, per-turn
// canvas context, session resume, permission cards, stop, transcript branching and persistence.
const { _electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-chat-")),
    bin = path.join(root, "bin"),
    project = path.join(root, "project"),
    log = path.join(root, "codex.log");
  await fs.mkdir(bin);
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, "hello.txt"), "hello file");
  await fs.copyFile(path.join(__dirname, "fixtures/fake-codex.cjs"), path.join(bin, "codex"));
  await fs.chmod(path.join(bin, "codex"), 0o755);
  const env = {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    FAKE_CODEX_LOG: log,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  // Auto-title helper threads (agent-workdirs/titles) are excluded so assertions see chat turns only.
  const rpc = async (method) =>
    (await fs.readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse)
      .filter(
        (c) =>
          c.rpc === method &&
          !/agent-workdirs[/\\]titles|word title for a design chat/.test(
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
    await waitForUiReady(page);
    await page.waitForSelector("#project-toggle", { state: "attached" });
    await page.evaluate(() => window.agentWorkspace.openChat());
    const completed = (n) =>
      page.waitForFunction(
        (n) => window.agentWorkspace.getUsage().completed === n && !window.agentWorkspace.isBusy(),
        n,
        { timeout: 15000 },
      );

    // 1. Quick chat: no project, scratch folder, streamed reply and tool cards.
    await page.evaluate(() =>
      window.agentWorkspace.setDefaults({ agent: "codex", access: "edit" }),
    );
    await page.locator("#project-prompt").fill("Quick question");
    await page.locator("#project-run").click();
    // Streaming keeps its live chat while the panel is closed.
    await page.evaluate(() => {
      window.agentWorkspace.closeChat();
    });
    await completed(1);
    await page.evaluate(() => window.agentWorkspace.openChat());
    assert.match(
      await page.locator(".chat-message.assistant").last().textContent(),
      /Reply to .*Quick question/,
    );
    assert.ok(
      (await page.locator(".chat-message.assistant .chat-tool").count()) >= 2,
      "tool-call cards are rendered",
    );
    // Finished turns fold their tool calls under "Wondered for Ns ›" (Wonder 29/51); open it, then a tool row.
    await page.locator(".chat-message.assistant .chat-thinking summary").first().click();
    await page.locator(".chat-message.assistant .chat-tool summary").first().click();
    assert.match(
      await page.locator(".chat-message.assistant .chat-tool").first().textContent(),
      /hello\.txt/,
    );
    assert.match(await page.locator("#chat-session").textContent(), /Continues codex session/);
    const firstStart = (await rpc("thread/start"))[0].params;
    assert.match(firstStart.cwd, /agent-workdirs[/\\][0-9a-f-]{36}$/);
    const firstTurn = (await rpc("turn/start"))[0].params.input[0].text;
    assert.match(
      firstTurn,
      /^<verynize-context>[\s\S]*pageId [^\s)]+[\s\S]*<\/verynize-context>\n\nQuick question$/,
    );

    // 2. Project chat: model default, new session, then a resumed follow-up.
    await app.evaluate(
      ({ dialog }, project) =>
        (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] })),
      project,
    );
    await page.evaluate(() => window.agentWorkspace.openProject());
    await page.locator("#code-add-repository").click();
    await page.locator("#project-open").click();
    await page.waitForFunction(
      () => document.getElementById("project-name").textContent === "project",
    );
    await page.evaluate(() => window.agentWorkspace.openChat());
    await page.locator(".agent-config summary").click();
    await page.locator("#agent-model").fill("fixture-model");
    await page.locator("#agent-model").press("Tab");
    await page.locator("#project-prompt").fill("First task");
    await page.locator("#project-run").click();
    await completed(2);
    assert.equal(await page.locator(".chat-message").count(), 2);
    assert.equal((await rpc("thread/start")).at(-1).params.cwd, await fs.realpath(project));
    assert.equal((await rpc("thread/start")).at(-1).params.model, "fixture-model");
    await page.locator("#project-prompt").fill("Second task");
    await page.locator("#project-run").click();
    await completed(3);
    assert.equal((await rpc("thread/resume")).length, 1, "follow-up resumes the provider session");
    assert.doesNotMatch(
      (await rpc("turn/start")).at(-1).params.input[0].text,
      /Earlier messages/,
      "resumed turns do not resend the transcript",
    );

    // 3. Ask access: approval card round-trip.
    await page.locator("#agent-access-trigger").click();
    await page.getByRole("menuitemradio", { name: /^Ask/ }).click();
    await page.locator("#project-prompt").fill("please approve the listing");
    await page.locator("#project-run").click();
    await page.locator(".chat-permission-allow").click({ timeout: 15000 });
    await completed(4);
    assert.match(
      await page.locator(".chat-message.assistant").last().textContent(),
      /declined=false/,
    );
    assert.equal((await rpc("thread/resume")).at(-1).params.approvalPolicy, "untrusted");

    // 4. Stop interrupts the active turn.
    await page.locator("#project-prompt").fill("slow task");
    await page.locator("#project-run").click();
    await page.waitForFunction(
      () =>
        /Thinking slowly/.test(
          document.querySelector(".chat-message.assistant:last-of-type")?.textContent || "",
        ),
      null,
      { timeout: 15000 },
    );
    await page.locator("#project-cancel").click();
    await completed(5);
    assert.match(await page.locator(".chat-message.assistant").last().textContent(), /stopped/);
    assert.equal((await rpc("turn/interrupt")).length, 1);

    // 5. Branching, docking, defaults and persistence.
    const before = await page.locator(".chat-message").count();
    await page.locator(".chat-message.user button").first().click();
    assert.equal(await page.locator(".chat-message").count(), 1);
    assert.match(await page.locator("#chat-session").textContent(), /New session/);
    assert.equal(await page.locator("#agent-chat-dock").isVisible(), true);
    assert.equal(
      await page.evaluate(() => window.agentWorkspace.getDefaults().model),
      "fixture-model",
    );
    assert.equal(await page.evaluate(() => window.agentWorkspace.getDefaults().access), "ask");
    await page.reload();
    await waitForUiReady(page);
    await page.waitForSelector("#project-toggle", { state: "attached" });
    await page.evaluate(() => window.agentWorkspace.openProject());
    await page.locator("#code-add-repository").click();
    await page.locator("#project-open").click();
    await page.waitForFunction(
      () => document.getElementById("project-name").textContent === "project",
    );
    assert.equal(await page.locator(".chat-message").count(), 1);
    const history = await page.evaluate(() => window.agentWorkspace.getHistory());
    const main = history.find((c) => c.messages.length === before);
    assert.ok(
      main &&
        main.sessionId &&
        main.messages.some((m) => (m.parts || []).some((p) => p.kind === "tool")),
      "session id and tool parts persist",
    );
    console.log(
      "PASS app-server chat: quick chat scratch folder, streaming, tool cards, turn context, resume, approvals, stop, branching and persistence",
    );

    // 6. Chat parity (window.agentWorkspace API): queue CRUD, questions, stop keeps the queue, mentions, links, seeding.
    const ws = (fn) => page.evaluate(fn);
    const state = () => ws(() => window.agentWorkspace.getState());
    const sendText = async (text) => {
      await page.locator("#project-prompt").fill(text);
      await page.locator("#project-run").click();
    };
    await page.evaluate(() => window.agentWorkspace.setDefaults({ access: "edit" }));
    await ws(() => window.agentWorkspace.newChat());
    const starters = (await state()).suggestions;
    assert.equal(starters.length, 12, "empty chats offer twelve starter briefs");
    for (const item of starters)
      assert.ok(
        item.title && item.style && item.prompt.length > 120,
        `starter brief "${item.title}" names a style and is detailed`,
      );
    assert.equal(
      new Set(starters.map((item) => item.style)).size,
      12,
      "every starter brief uses a different style direction",
    );
    await page.waitForFunction(() => document.querySelectorAll("[data-suggestion]").length === 4);
    // Clicking a starter brief fills the composer and pins the brief's style (window.chatDesignStyle, sent as designStyle).
    await ws(() => window.chatDesignStyle?.set(""));
    const shownTitle = await page
      .locator("[data-suggestion]")
      .first()
      .getAttribute("data-suggestion");
    const shown = starters.find((item) => item.title === shownTitle);
    await page.locator("[data-suggestion] button").first().click();
    assert.equal(
      await page.locator("#project-prompt").inputValue(),
      shown.prompt,
      "a starter brief fills the composer",
    );
    assert.equal(
      await ws(() => window.chatDesignStyle?.get()),
      shown.style,
      "a starter brief selects its design style",
    );
    await ws(() => window.chatDesignStyle.set(""));
    await page.locator("#project-prompt").fill("");
    await ws(() => window.agentWorkspace.setDraft("draft for the new chat"));
    const draftChat = (await state()).conversationId;
    await ws(() => window.agentWorkspace.newChat());
    assert.equal(
      await page.locator("#project-prompt").inputValue(),
      "",
      "a new chat starts with an empty composer",
    );
    await page.evaluate((id) => window.agentWorkspace.selectChat(id), draftChat);
    assert.equal(
      await page.locator("#project-prompt").inputValue(),
      "draft for the new chat",
      "drafts are restored per conversation",
    );
    await page.locator("#project-prompt").fill("");

    // Mentions follow the canvas selection; @ search and verynize:// links resolve elements.
    const target = await ws(() => {
      const doc = window.design.getDocument();
      const page = doc.pages.find((p) => p.id === doc.activePage);
      const node = page.nodes.find((n) => !n.parentId) || page.nodes[0];
      return node ? { id: node.id, pageId: page.id } : null;
    });
    assert.ok(target, "the open document has an element to mention");
    await page.evaluate((id) => window.design.setSelection([id]), target.id);
    await page.waitForFunction(
      (id) => (window.agentWorkspace.getState().mentions || []).some((m) => m.id === id),
      target.id,
    );
    const mention = (await state()).mentions.find((m) => m.id === target.id);
    assert.equal(mention.pageId, target.pageId);
    assert.match(mention.shortId, /^[a-z]{3,4}$/);
    assert.ok(mention.label);
    await page.evaluate((id) => window.agentWorkspace.removeMention(id), target.id);
    assert.equal((await state()).mentions.length, 0, "a selection chip can be dismissed");
    const found = await page.evaluate(
      (q) => window.agentWorkspace.searchElements(q),
      mention.shortId,
    );
    assert.ok(
      found.some((m) => m.id === target.id),
      "searchElements finds the element by short id",
    );
    await page.evaluate(
      (m) => window.agentWorkspace.addMention(m),
      found.find((m) => m.id === target.id),
    );
    await page.evaluate(() => window.design.setSelection([]));
    assert.equal(
      await page.evaluate(
        (url) => window.agentWorkspace.openLink(url),
        `verynize://node/editor/${target.pageId}/${mention.shortId}`,
      ),
      true,
    );
    assert.deepEqual(
      await ws(() => window.design.getSelection()),
      [target.id],
      "openLink selects the linked element",
    );
    assert.equal(
      await ws(() => window.agentWorkspace.openLink("verynize://node/editor/no-page/zzzz")),
      false,
    );

    // Run a slow turn, queue three follow-ups and edit / reorder / remove them.
    await sendText("slow parity task");
    await page.waitForFunction(() => window.agentWorkspace.activeRunId());
    const parity = await state();
    assert.equal(
      parity.messages.at(-2).mentions?.[0]?.id,
      target.id,
      "mentions are stored on the user message",
    );
    assert.ok(parity.messages.at(-2).checkpoint, "user turns carry a canvas checkpoint");
    assert.deepEqual(parity.busyChats, [parity.conversationId]);
    for (const text of ["queued one", "queued two", "queued three"]) await sendText(text);
    let queue = (await state()).queue;
    assert.deepEqual(
      queue.map((q) => q.text),
      ["queued one", "queued two", "queued three"],
    );
    await page.evaluate(
      ([a, c]) => {
        window.agentWorkspace.editQueued(a, "queued one edited");
        window.agentWorkspace.moveQueued(c, -1);
      },
      [queue[0].id, queue[2].id],
    );
    assert.deepEqual(
      (await state()).queue.map((q) => q.text),
      ["queued one edited", "queued three", "queued two"],
    );
    await page.evaluate((id) => window.agentWorkspace.removeQueued(id), queue[2].id);
    queue = (await state()).queue;
    assert.deepEqual(
      queue.map((q) => q.text),
      ["queued one edited", "queued two"],
    );

    // Follow-up messages (Settings › Agents): Send goes the default way, ⌘↵ the other way. The fake app-server
    // refuses turn/steer, so a steer falls back to the queue; the request in the log shows which way it went.
    const steerCalls = async () => (await rpc("turn/steer")).length;
    const queued = (n) =>
      page.waitForFunction((count) => window.agentWorkspace.getState().queue.length === count, n);
    const steersBefore = await steerCalls();
    await page.locator("#project-prompt").fill("steered by shortcut");
    await page.locator("#project-prompt").press("ControlOrMeta+Enter");
    await queued(3);
    assert.equal(await steerCalls(), steersBefore + 1, "⌘↵ steers while Queue is the default");
    await page.evaluate(() => window.agentBehavior.set({ followUp: "steer" }));
    assert.equal(await page.locator("#project-run").getAttribute("aria-label"), "Steer message");
    await sendText("steered by default");
    await queued(4);
    assert.equal(await steerCalls(), steersBefore + 2, "Send steers when Steer is the default");
    await page.locator("#project-prompt").fill("queued by shortcut");
    await page.locator("#project-prompt").press("ControlOrMeta+Enter");
    await queued(5);
    assert.equal(await steerCalls(), steersBefore + 2, "⌘↵ queues while Steer is the default");
    await page.evaluate(() => window.agentBehavior.set({ followUp: "queue" }));
    for (const task of (await state()).queue.slice(2))
      await page.evaluate((id) => window.agentWorkspace.removeQueued(id), task.id);
    assert.deepEqual(
      (await state()).queue.map((q) => q.text),
      ["queued one edited", "queued two"],
    );

    // A runtime question becomes a question part; answering stores the answers on it.
    const runId = await ws(() => window.agentWorkspace.activeRunId());
    await app.evaluate(({ BrowserWindow }, id) => {
      for (const w of BrowserWindow.getAllWindows())
        w.webContents.send("desktop:agent-event", {
          id,
          type: "question-request",
          requestId: "q-1",
          questions: [
            {
              id: "size",
              question: "Which viewport?",
              options: [{ label: "Desktop" }, { label: "Mobile" }],
            },
          ],
        });
    }, runId);
    await page.waitForFunction(() =>
      window.agentWorkspace
        .getState()
        .messages.at(-1)
        .parts.some((p) => p.kind === "question"),
    );
    let messages = (await state()).messages;
    const qi = messages.at(-1).parts.findIndex((p) => p.kind === "question");
    assert.equal(messages.at(-1).parts[qi].state, "pending");
    await page.evaluate(
      ([mi, pi]) => window.agentWorkspace.answerQuestion(mi, pi, { size: "Mobile" }),
      [messages.length - 1, qi],
    );
    const answered = (await state()).messages.at(-1).parts[qi];
    assert.equal(answered.state, "answered");
    assert.deepEqual(answered.answers, { size: "Mobile" });
    await app.evaluate(({ BrowserWindow }, id) => {
      for (const w of BrowserWindow.getAllWindows())
        w.webContents.send("desktop:agent-event", {
          id,
          type: "usage",
          inputTokens: 1200,
          outputTokens: 80,
          contextWindow: 200000,
        });
    }, runId);
    await page.waitForFunction(
      () => window.agentWorkspace.getState().usage?.contextWindow === 200000,
    );

    // Stop keeps (and pauses) the queue; "send now" runs a queued task, then the queue continues.
    const done = (await ws(() => window.agentWorkspace.getUsage())).completed;
    await page.locator("#project-cancel").click();
    await page.waitForFunction(
      (n) =>
        window.agentWorkspace.getUsage().completed === n + 1 && !window.agentWorkspace.isBusy(),
      done,
      { timeout: 15000 },
    );
    await page.waitForTimeout(300);
    assert.equal((await state()).queue.length, 2, "stop does not clear the queue");
    assert.equal(await ws(() => window.agentWorkspace.isBusy()), false, "stop pauses the queue");
    await page.evaluate((id) => window.agentWorkspace.sendQueuedNow(id), queue[0].id);
    await page.waitForFunction(
      (n) =>
        window.agentWorkspace.getUsage().completed === n + 3 &&
        !window.agentWorkspace.isBusy() &&
        !window.agentWorkspace.getState().queue.length,
      done,
      { timeout: 20000 },
    );
    messages = (await state()).messages;
    assert.deepEqual(
      messages.filter((m) => m.role === "user").map((m) => m.text),
      ["slow parity task", "queued one edited", "queued two"],
    );

    // Rewind truncates before a user message, keeps the full transcript as a branch and drops the provider session.
    const chatsBefore = (await state()).conversations.length;
    await page.evaluate(
      (i) => window.agentWorkspace.rewindTo(i),
      messages.findIndex((m) => m.role === "user" && m.text === "queued two"),
    );
    await page.waitForFunction(
      (n) => window.agentWorkspace.getState().conversations.length === n + 1,
      chatsBefore,
    );
    const rewound = await state();
    assert.deepEqual(
      rewound.messages.filter((m) => m.role === "user").map((m) => m.text),
      ["slow parity task", "queued one edited"],
    );
    assert.ok(
      rewound.conversations.some(
        (c) => String(c.title).endsWith(" · before rewind") && c.count === messages.length,
      ),
      "the full transcript is kept as a branch",
    );
    // The next turn forks the provider thread through the kept reply's turn instead of re-seeding (thread/fork).
    const keptPoint = rewound.messages.at(-1).resumePoint;
    assert.ok(
      keptPoint && keptPoint.at && keptPoint.agent === "codex",
      "the kept reply carries its fork point",
    );
    const forksBefore = (await rpc("thread/fork")).length,
      rewindBase = (await ws(() => window.agentWorkspace.getUsage())).completed;
    await sendText("after rewind");
    await completed(rewindBase + 1);
    const forks = await rpc("thread/fork");
    assert.equal(forks.length, forksBefore + 1, "a rewound chat forks its thread");
    assert.deepEqual(
      [forks.at(-1).params.threadId, forks.at(-1).params.lastTurnId],
      [keptPoint.sessionId, keptPoint.at],
    );
    assert.equal(
      (await rpc("turn/start")).at(-1).params.input[0].text.endsWith("after rewind"),
      true,
    );
    assert.doesNotMatch(
      (await rpc("turn/start")).at(-1).params.input[0].text,
      /previous-conversation|Summary of the earlier conversation/,
      "a working fork is not seeded",
    );
    assert.match((await state()).session, /thr-fork-|Continues codex session/);

    // A tools-version change invalidates the provider session: the next run starts fresh with a transcript seed.
    await ws(() => window.agentWorkspace.newChat());
    const seedBase = (await ws(() => window.agentWorkspace.getUsage())).completed;
    await sendText("seed source turn");
    await completed(seedBase + 1);
    const chatId = (await state()).conversationId;
    const startsBefore = (await rpc("thread/start")).length,
      resumesBefore = (await rpc("thread/resume")).length;
    const storedKey = await ws(() => window.agentWorkspace.getState().projectKey);
    await page.evaluate(
      ([key, id]) => {
        const list = JSON.parse(localStorage.getItem(key));
        list.find((c) => c.id === id).toolsVersion = "stale-tools";
        localStorage.setItem(key, JSON.stringify(list));
      },
      ["better-agent-chats:" + storedKey, chatId],
    );
    await page.reload();
    await waitForUiReady(page);
    await page.waitForSelector("#project-toggle", { state: "attached" });
    await page.evaluate(() => window.agentWorkspace.openProject());
    await page.locator("#code-add-repository").click();
    await page.locator("#project-open").click();
    await page.waitForFunction(
      () => document.getElementById("project-name").textContent === "project",
    );
    await page.evaluate(() => window.agentWorkspace.openChat());
    assert.equal(await page.evaluate((id) => window.agentWorkspace.selectChat(id), chatId), true);
    const completedNow = (await ws(() => window.agentWorkspace.getUsage())).completed;
    await sendText("after a tools update");
    await completed(completedNow + 1);
    assert.equal(
      (await rpc("thread/resume")).length,
      resumesBefore,
      "a stale tools version is not resumed",
    );
    assert.equal((await rpc("thread/start")).length, startsBefore + 1);
    const seeded = (await rpc("turn/start")).at(-1).params.input[0].text;
    assert.match(
      seeded,
      /Summary of the earlier conversation[\s\S]*seed source turn[\s\S]*after a tools update$/,
      "the new session is seeded with the transcript summary",
    );
    // Expand agent work by default (Settings › Agents): turn headers and tool calls render unfolded.
    await page.evaluate(() => window.agentBehavior.set({ expandWork: true }));
    await page.waitForFunction(
      () =>
        document.querySelectorAll("details.chat-thinking[open]").length > 0 &&
        document.querySelectorAll("details.chat-tool[open]").length > 0,
    );
    await page.evaluate(() => window.agentBehavior.set({ expandWork: false }));
    console.log(
      "PASS chat parity: drafts, suggestions, selection mentions, search, verynize links, queue CRUD, questions, usage, stop keeps queue, send now, rewind branch, tools-version seeding",
    );
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
