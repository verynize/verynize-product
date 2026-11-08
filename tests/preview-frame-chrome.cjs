// Preview frame chrome (web/preview-frame-chrome.js): screen-sized browser toolbar and breadcrumb, history-aware
// Back/Forward, a path field that follows in-app navigation and accepts a typed path, tooltips, ⇧-click hard reload,
// the starting / error / paused cards (live timer, Stop while starting, exit code, no IPC prefix, no stale message from
// the previous run), stop confirmation, the embedded terminal, Fix with agent, and the Publish popover.
// PREVIEW_FRAME_SHOTS=<dir> also writes 1440×870 @2x screenshots of each state (visual parity proof).
const { _electron } = require("@playwright/test");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const { mod } = require("./helpers/keys.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");

const SHOTS = process.env.PREVIEW_FRAME_SHOTS || "";
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });

(async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "preview-frame-")));
  const profile = path.join(tmp, "profile"),
    repo = path.join(tmp, "preview-sandbox");
  await fs.mkdir(repo, { recursive: true });
  await fs.writeFile(path.join(repo, "index.html"), "<h1>Sandbox</h1>");
  let hits = 0;
  const site = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    hits++;
    if (request.url === "/") {
      response.end(
        '<body style="margin:0;font:16px system-ui;background:#f4f6fe;color:#172340"><h1 style="margin:40px">Sunbird preview sandbox</h1><a id="about" style="margin:40px" href="/about/">About</a><button id="push" onclick="history.pushState({},\'\',\'/pushed\')">Push</button></body>',
      );
    } else if (request.url === "/about/")
      response.end('<h1 id="about-title">About Sunbird</h1><a href="/">Home</a>');
    else {
      response.statusCode = 404;
      response.end("<h1>Not found</h1>");
    }
  });
  await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
  const siteURL = `http://127.0.0.1:${site.address().port}/`;
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1", VERYNIZE_LAUNCH_EDITOR: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [
    ".",
    `--user-data-dir=${profile}`,
    ...(SHOTS ? ["--force-device-scale-factor=2", "--force-color-profile=srgb"] : []),
  ];
  const app = await _electron.launch({ env, args });
  const busy = http.createServer((_q, r) => r.end("Existing app"));
  try {
    const page = await app.firstWindow();
    await moveOffCursor(app);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForFunction(
      () => !!window.livePreview?.frameInternals && !!window.livePreview.openPublish,
    );
    if (SHOTS) {
      await fs.mkdir(SHOTS, { recursive: true });
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setContentSize(1440, 870),
      );
      // Same dark canvas as the Wonder reference page, so the captures compare like for like.
      await page.evaluate(() => {
        const doc = window.design.getDocument();
        for (const p of doc.pages) p.background = "#2b2b2b";
        window.design.setDocument(doc);
      });
    }
    const shot = async (name) => {
      if (SHOTS) {
        await page.mouse.move(1435, 600);
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(SHOTS, name + ".png") });
      }
    };
    /** Frame viewport 1512×982 at 55% zoom, placed like the Wonder reference captures. */
    const frameView = async (id) =>
      page.evaluate((id) => {
        window.design.updateNodes([id], { w: 1512, h: 982 });
        const node = window.design
          .getDocument()
          .pages.flatMap((p) => p.nodes)
          .find((n) => n.id === id);
        const wrap = document.getElementById("canvas-wrap").getBoundingClientRect();
        window.design.setCamera(
          306 - wrap.left + 6 - node.x * 0.55,
          151 - wrap.top - node.y * 0.55,
          0.55,
        );
      }, id);

    // ---------- PF1 / PF2: running frame, screen-sized chrome ----------
    await page.evaluate(
      (url) => window.livePreview.show(url, { root: "", name: "App", repo: "preview-sandbox" }),
      siteURL,
    );
    const id = await page.evaluate(() => window.livePreview.getNodeId());
    const frame = `.canvas-preview[data-id="${id}"]`;
    await frameView(id);
    await page.frameLocator("#live-frame").locator("#about").waitFor();
    // A selected preview shows no name label or ⊕ chip (an overlay attribute selection-chrome.js sets, not :has()).
    await page.evaluate((id) => window.design.setSelection([id]), id);
    assert.deepEqual(
      await page.evaluate(() =>
        ["#selection-name", "#selection-chat-chip"].map(
          (s) => getComputedStyle(document.querySelector(s)).display,
        ),
      ),
      ["none", "none"],
      "no name label or chip on a selected preview",
    );
    await page.evaluate(() => window.design.setSelection([]));
    assert.equal(
      await page.evaluate(() =>
        document.querySelector("#canvas-overlay").hasAttribute("data-preview-selected"),
      ),
      false,
      "cleared with the selection",
    );
    await page.evaluate((id) => window.design.setSelection([id]), id);
    const bar = page.locator(`${frame} .pf-bar`);
    const labels = await bar
      .locator("button:visible, input:visible")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    assert.deepEqual(
      labels,
      ["Back", "Forward", "Reload", "Preview path", null, "Stop preview", "Open in a tab"],
      "toolbar order Back, Forward, Reload, path, Publish, Stop, expand",
    );
    assert.equal(await bar.locator("[data-pf=publish]").textContent(), "Publish");
    assert.equal(await page.locator("#live-url").inputValue(), "/");
    assert.equal(await page.locator("#live-reload").count(), 1);
    assert.equal(await page.locator("#live-expand").count(), 1);
    assert.equal(await page.locator(`${frame} .pf-crumb`).textContent(), "preview-sandboxLocal");
    assert.equal(
      await bar.locator("[data-pf=back]").isDisabled(),
      true,
      "Back disabled without history",
    );
    assert.equal(
      await bar.locator("[data-pf=forward]").isDisabled(),
      true,
      "Forward disabled without history",
    );
    const box55 = await bar.boundingBox(),
      body = await page.locator(frame).boundingBox();
    assert.ok(
      Math.abs(box55.height - 31) < 1.5,
      `toolbar is screen-sized at 55% (${box55.height})`,
    );
    assert.ok(box55.y + box55.height <= body.y + 1, "toolbar sits above the frame bounds");
    assert.ok(Math.abs(box55.width - (body.width + 10)) < 2, "toolbar spans the frame");
    assert.equal(
      await page.locator(`${frame} .pf-crumb`).evaluate((el) => getComputedStyle(el).color),
      await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--primary-text)";
        document.body.append(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      }),
      "selected breadcrumb is purple",
    );
    await shot("PF2-toolbar");
    await page.evaluate(() => {
      const c = window.design.getCamera();
      window.design.setCamera(c.x, c.y, 0.3);
    });
    const box30 = await bar.boundingBox();
    assert.ok(
      Math.abs(box30.height - 31) < 1.5 && box30.width < box55.width,
      "toolbar height stays constant when zooming out",
    );
    await frameView(id);
    // Tooltips
    for (const [part, text] of [
      ["back", /Back\s*⌘\[|Back\s*Ctrl\+\[/],
      ["forward", /Forward/],
      ["reload", /Reload.*⇧-click ignores cache/],
      ["path", new RegExp(siteURL.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))],
      ["publish", /Publish to the web/],
      ["expand", /Open in a tab/],
    ]) {
      for (let attempt = 0; ; attempt++) {
        await bar.locator(`[data-pf=${part}]`).hover();
        try {
          await page.locator(".pf-tooltip:not([hidden])").waitFor({ timeout: 3000 });
          break;
        } catch (error) {
          if (attempt === 2) throw error;
          await page.mouse.move(1435, 600);
        }
      }
      assert.match(await page.locator(".pf-tooltip").textContent(), text, `${part} tooltip`);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `PF2-${part}-hover.png`) });
      await page.mouse.move(1435, 600);
      await page.locator(".pf-tooltip").waitFor({ state: "hidden" });
    }
    // Path follows link navigation and pushState; Back/Forward follow history.
    await page.locator("#preview-navigate").click();
    await page
      .frameLocator("#live-frame")
      .locator("#about")
      .evaluate((link) => link.click()); // the canvas scales the frame, so click in-page
    await page.frameLocator("#live-frame").locator("#about-title").waitFor();
    await page.waitForFunction(() => document.getElementById("live-url").value === "/about/");
    assert.equal(
      await page.evaluate(() => window.livePreview.getURL().endsWith("/about/")),
      true,
      "frame URL follows in-app navigation",
    );
    await page.waitForFunction(
      (id) => !document.querySelector(`[data-id="${id}"] [data-pf=back]`).disabled,
      id,
    );
    assert.equal(await bar.locator("[data-pf=forward]").isDisabled(), true);
    await bar.locator("[data-pf=back]").click();
    await page.waitForFunction(() => document.getElementById("live-url").value === "/");
    await page.waitForFunction(
      (id) => !document.querySelector(`[data-id="${id}"] [data-pf=forward]`).disabled,
      id,
    );
    await page.evaluate((id) => {
      window.design.setSelection([]);
      window.design.setSelection([id]);
      document.activeElement?.blur?.();
    }, id);
    await page.keyboard.press(mod("]"));
    await page.waitForFunction(() => document.getElementById("live-url").value === "/about/");
    // Typed path + Enter navigates.
    await page.locator("#live-url").click();
    await page.keyboard.type("/missing");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.livePreview.getURL().endsWith("/missing"));
    assert.equal(await page.locator("#live-url").inputValue(), "/missing");
    await page.locator("#live-url").fill("/");
    await page.locator("#live-url").press("Enter");
    await page.waitForFunction(() => document.getElementById("live-url").value === "/");
    await page.frameLocator("#live-frame").locator("#push").waitFor();
    await page.locator("#preview-navigate").click();
    await page
      .frameLocator("#live-frame")
      .locator("#push")
      .evaluate((button) => button.click());
    await page.waitForFunction(() => document.getElementById("live-url").value === "/pushed");
    // ⇧-click Reload reloads ignoring the cache.
    const before = hits;
    await bar.locator("[data-pf=reload]").click({ modifiers: ["Shift"] });
    for (let i = 0; i < 40 && hits === before; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(hits > before, "shift-click Reload refetches the page");

    // ---------- PP1: publish popover ----------
    await bar.locator("[data-pf=publish]").click();
    const pop = page.locator("#preview-publish");
    await pop.waitFor();
    const popText = (await pop.textContent()).replace(/\s+/g, " ");
    for (const text of [
      "Publish to the web",
      "Not published yet",
      "Share your app",
      "Environment variables",
      "0 keys sent",
      "Publish",
    ])
      assert.ok(popText.includes(text), `publish popover shows ${text}`);
    assert.ok(!/\bPro\b/.test(popText), "no Pro gate");
    const popBox = await pop.boundingBox(),
      pubBox = await bar.locator("[data-pf=publish]").boundingBox();
    assert.ok(
      Math.abs(popBox.x + popBox.width - (pubBox.x + pubBox.width)) < 2 &&
        popBox.y > pubBox.y + pubBox.height,
      "popover opens below Publish, right aligned",
    );
    await shot("PP1-publish");
    await pop.locator("[data-pub=publish]").click();
    await page.waitForFunction(
      () => /Sign in/.test(document.querySelector("#preview-publish [role=status]").textContent),
      null,
      { timeout: 5000 },
    );
    await page.keyboard.press("Escape");
    await pop.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => window.livePreview.openPublish()), true);
    await pop.waitFor();
    await page.keyboard.press("Escape");
    await pop.waitFor({ state: "hidden" });

    // ---------- X3: terminal API ----------
    assert.equal(await page.evaluate((id) => window.livePreview.showTerminal(id), id), true);
    const terminal = page.locator(`${frame} .pf-terminal`);
    await terminal.waitFor();
    assert.match(await terminal.textContent(), /Terminal.*Copy logs.*Hide terminal/s);
    await terminal.getByText("Hide terminal").click();
    await terminal.waitFor({ state: "hidden" });
    await page.evaluate(() => window.livePreview.hide());

    // ---------- PS3 / PS4 / PS5 / PP2 with a real dev server ----------
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, repo);
    await page.evaluate(async (root) => {
      await window.desktop.repositories.addLocal();
      await window.desktop.repositories.activate(root);
    }, repo);
    const port = await freePort();
    const configure = (command, url) =>
      page.evaluate(
        ({ root, command, url }) =>
          window.desktop.devServer.configure({ root, command, ...(url ? { url } : {}) }),
        { root: repo, command, url },
      );
    const pid = await page.evaluate(
      (root) =>
        window.livePreview.ensure({ root, name: "App", chatId: "", repo: "preview-sandbox" }),
      repo,
    );
    const pf = `.canvas-preview[data-id="${pid}"]`;
    await page.evaluate((id) => window.design.setSelection([id]), pid);
    await frameView(pid);
    assert.equal(await page.locator(`${pf} .pf-crumb-text`).textContent(), "preview-sandbox");
    const worktree = await page.evaluate(() =>
      window.livePreview.ensure({
        root: "/tmp/workspaces/preview-sandbox/dipper",
        chatId: "crumb",
        repo: "preview-sandbox",
      }),
    );
    assert.equal(
      await page.locator(`.canvas-preview[data-id="${worktree}"] .pf-crumb-text`).textContent(),
      "preview-sandbox › Dipper",
      "breadcrumb shows repository › worktree",
    );
    await page.evaluate(
      ({ worktree, pid }) => {
        const doc = window.design.getDocument();
        for (const page of doc.pages) page.nodes = page.nodes.filter((n) => n.id !== worktree);
        window.design.setDocument(doc);
        window.design.setSelection([pid]);
      },
      { worktree, pid },
    );
    await frameView(pid);
    const card = page.locator(`${pf} .preview-setup-card`);
    assert.match(
      await card.textContent(),
      /Ready to start your preview.*preview-sandbox · App.*Start this preview to connect to your local app\..*Start preview/s,
    );
    // PS4: non-zero exit
    await configure([
      "node",
      "-e",
      "console.log('Starting sandbox');console.error('Error: Cannot find module ./server.js');setTimeout(()=>process.exit(7),300)",
    ]);
    await page.locator(`${pf} [data-act=start]`).click();
    await page.locator(`${pf} .pf-card[data-kind=error]`).waitFor({ timeout: 15000 });
    const errorText = (await card.textContent()).replace(/\s+/g, " ");
    for (const text of [
      "Couldn’t start your app",
      "preview-sandbox · App",
      "The start command exited before the app was ready.",
      "App stopped",
      "exit 7",
      "Show preview",
      "Not reached",
      "View logs",
      "Try again",
      "Fix with agent",
      "Sends the error and available logs to your agent.",
    ])
      assert.ok(errorText.includes(text), `error card shows ${text}: ${errorText}`);
    assert.equal(await page.locator(`${pf} .pf-status`).textContent(), "Preview failed");
    assert.equal(
      await page.locator(`${pf} [data-pf=publish]`).isVisible(),
      false,
      "error toolbar keeps only expand",
    );
    assert.equal(await page.locator(`${pf} [data-pf=expand]`).isVisible(), true);
    await shot("PS4-error");
    // A failure reported by the header's Start (bd:preview-setup-state with the start status) shows the same exit details.
    // Same sequence as web/src/islands/code/preview-state.ts startPreview: starting event, start, failed event.
    await page.evaluate(async (root) => {
      window.dispatchEvent(
        new CustomEvent("bd:preview-setup-state", {
          detail: { root, state: "starting", message: "" },
        }),
      );
      const status = await window.desktop.devServer.start({ root });
      window.dispatchEvent(
        new CustomEvent("bd:preview-setup-state", {
          detail: { root, state: "failed", message: status.tail || "boom", status },
        }),
      );
    }, repo);
    await page.waitForFunction(
      (id) =>
        /exit 7/.test(
          document.querySelector(`[data-id="${id}"] .preview-setup-card`)?.textContent || "",
        ),
      pid,
    );
    assert.match(
      (await card.textContent()).replace(/\s+/g, " "),
      /The start command exited before the app was ready\..*App stopped/,
      "header-started failures keep the exit details",
    );
    // View logs opens the terminal with the run output.
    await page.locator(`${pf} [data-act=logs]`).click();
    await page.waitForFunction(
      (id) =>
        /Cannot find module/.test(
          document.querySelector(`[data-id="${id}"] .pf-term-log`).textContent,
        ),
      pid,
    );
    await shot("X3-terminal");
    await page.evaluate((id) => window.livePreview.hideTerminal(id), pid);
    // Fix with agent: error + logs go to the chat send path.
    const fixed = await page.evaluate(
      async ({ id, root }) => {
        const original = window.agentWorkspace,
          sent = {};
        window.agentWorkspace = {
          ...original,
          getState: () => ({ ...original.getState(), activeRoot: root, conversationId: null }),
          openChat() {
            sent.opened = true;
          },
          attachText(kind, name, text) {
            Object.assign(sent, { kind, name, text });
          },
          queueMessage: async (message) => {
            sent.message = message;
          },
        };
        try {
          document.querySelector(`[data-id="${id}"] [data-act=fix]`).click();
          for (let i = 0; i < 50 && !sent.message; i++) await new Promise((r) => setTimeout(r, 50));
        } finally {
          window.agentWorkspace = original;
        }
        return sent;
      },
      { id: pid, root: repo },
    );
    assert.equal(fixed.opened, true);
    assert.match(fixed.text, /exit 7/);
    assert.match(fixed.text, /Cannot find module/);
    assert.match(fixed.message, /Preview couldn’t start/);
    // Busy port after a failed run: the busy message stays, without the IPC prefix (no stale previous-run tail).
    await new Promise((resolve) => busy.listen(port, resolve));
    await configure(["node", "-e", "setInterval(()=>{},1000)"], `http://localhost:${port}/`);
    await page.locator(`${pf} [data-act=retry]`).click();
    await page.waitForFunction(
      (id) =>
        /already in use/.test(
          document.querySelector(`[data-id="${id}"] .pf-reason`)?.textContent || "",
        ),
      pid,
      { timeout: 10000 },
    );
    for (let i = 0; i < 8; i++) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const reason = await page.locator(`${pf} .pf-reason`).textContent();
      assert.match(
        reason,
        /already in use/,
        "busy-port message is not replaced by the previous run",
      );
      assert.doesNotMatch(reason, /Error invoking remote method/);
    }
    await new Promise((resolve) => busy.close(resolve));
    // PS3: starting card with timer, command steps and a Stop that stops (not a Start).
    const server = `setTimeout(()=>require('http').createServer((q,s)=>{s.setHeader('content-type','text/html');s.end('<body style=margin:0;background:#f4f6fe><h1 style=margin:40px>Sunbird preview sandbox</h1></body>')}).listen(${port},()=>console.log('Serving on http://localhost:${port}/')),2500)`;
    await configure(["node", "-e", server]);
    await page.locator(`${pf} [data-act=retry]`).click();
    await page.locator(`${pf} .pf-card[data-kind=starting]`).waitFor();
    const startingText = (await card.textContent()).replace(/\s+/g, " ");
    for (const text of [
      "Starting your app",
      "preview-sandbox · App · 0:0",
      "Stop",
      "Starting app",
      "node -e",
      "Waiting for the app",
      "Show terminal",
    ])
      assert.ok(startingText.includes(text), `starting card shows ${text}: ${startingText}`);
    assert.ok(!/Start preview/.test(startingText), "no Start preview button while starting");
    assert.equal(await page.locator(`${pf} .pf-status`).textContent(), "Starting preview…");
    await page.waitForFunction(
      (id) => document.querySelector(`[data-id="${id}"] .pf-timer`)?.textContent === "0:01",
      pid,
      { timeout: 4000 },
    );
    await shot("PS3-starting");
    await page.locator(`${pf} .pf-head[data-state=running]`).waitFor({ timeout: 20000 });
    await page.frameLocator("#live-frame").locator("h1").waitFor();
    await shot("PF1-selected");
    await page.evaluate(() => window.design.setSelection([]));
    assert.notEqual(
      await page.locator(`${pf} .pf-crumb`).evaluate((el) => getComputedStyle(el).color),
      await page
        .locator(`${pf} .pf-local`)
        .evaluate((el) => getComputedStyle(el.parentElement.closest(".canvas-preview")).color),
      "unselected breadcrumb is gray",
    );
    await shot("PF1-running");
    await page.evaluate((id) => window.design.setSelection([id]), pid);
    // PP2: Stop asks previewEdits first; refusing keeps the app running.
    await page.evaluate(() => {
      window.__asked = 0;
      window.previewEdits = {
        ...window.previewEdits,
        confirmBeforeStop: async () => {
          window.__asked++;
          return window.__allowStop === true;
        },
      };
    });
    await page.locator(`${pf} [data-pf=toggle]`).click();
    await page.waitForFunction(() => window.__asked === 1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(
      await page.locator(`${pf} .pf-head`).getAttribute("data-state"),
      "running",
      "declined confirmation keeps the preview running",
    );
    await page.evaluate(() => {
      window.__allowStop = true;
    });
    await page.locator(`${pf} [data-pf=toggle]`).click();
    await page.locator(`${pf} .pf-card[data-kind=paused]`).waitFor({ timeout: 10000 });
    const pausedText = (await card.textContent()).replace(/\s+/g, " ");
    assert.ok(
      pausedText.includes(`Last address: localhost:${port}`),
      `paused card shows last address: ${pausedText}`,
    );
    assert.equal(await page.locator(`${pf} .pf-status`).textContent(), "Preview paused");
    assert.deepEqual(
      await page
        .locator(`${pf} .pf-actions button:visible`)
        .evaluateAll((els) => els.map((el) => el.textContent || el.getAttribute("aria-label"))),
      ["Publish", "Start", "Open in a tab"],
    );
    assert.equal(
      await page.evaluate(
        (id) => window.design.getDocument().pages.some((p) => p.nodes.some((n) => n.id === id)),
        pid,
      ),
      true,
      "frame stays after stop",
    );
    await shot("PS5-paused");
    assert.deepEqual(errors, []);
    console.log(
      "PASS preview frame chrome: screen-sized toolbar, history, path follow/typing, tooltips, hard reload, publish popover, terminal, starting/error/paused cards, stale-message race, stop confirmation, fix with agent",
    );
  } finally {
    await app.close();
    await new Promise((resolve) => site.close(resolve));
    if (busy.listening) await new Promise((resolve) => busy.close(resolve));
    await fs.rm(tmp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
