// Bridge-only shell tools against the real desktop app: a real MCP client drives the loopback
// bridge to start a fixture project's dev server (npm run dev), automate the embedded preview
// (snapshot, click, type, scroll, console, screenshot, capture to canvas), run terminal commands
// with the approval/access policy, run editor actions, and stop everything on quit.
const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const PAGE = `<!doctype html><html><head><title>Fixture shop</title></head><body style="margin:0;font-family:sans-serif">
<header><nav aria-label="Primary"><a href="/second">Second page</a></nav></header>
<main><h1>Fixture app</h1><p id="message">Before click</p>
<button id="change" onclick="document.getElementById('message').textContent='After click';console.log('clicked the button');console.error('fixture error after click')">Change text</button>
<form onsubmit="event.preventDefault();document.getElementById('message').textContent='Submitted '+document.getElementById('name').value">
<label for="name">Your name</label><input id="name" value="original"><input id="secret" type="password" value="never-read-this-secret"><button type="submit">Save</button></form>
<div style="height:3000px;background:linear-gradient(#fff,#cde)">Tall section</div><p id="end">The end</p></main>
<script>console.warn('fixture loaded')</script></body></html>`;
const SERVER = `const http=require('node:http'),fs=require('node:fs');fs.writeFileSync('server.pid',String(process.pid));
const page=${JSON.stringify(PAGE)};
const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(req.url==='/second'?'<h1>Second</h1>':page);});
server.listen(0,'127.0.0.1',()=>console.log('  Local:   http://localhost:'+server.address().port+'/'));
process.on('SIGTERM',()=>process.exit(0));`;

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function waitGone(pid, ms = 5000) {
  const end = Date.now() + ms;
  while (alive(pid) && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  return !alive(pid);
}

(async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "better-mcp-shell-"));
  const project = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "better-shell-project-")),
  );
  await fs.writeFile(
    path.join(project, "package.json"),
    JSON.stringify({ name: "fixture", private: true, scripts: { dev: "node server.js" } }),
  );
  await fs.writeFile(path.join(project, "server.js"), SERVER);
  const env = {
    ...process.env,
    VERYNIZE_PREFERENCES: path.join(profile, "design-preferences.json"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  delete env.VERYNIZE_DISABLE_MCP;
  delete env.VERYNIZE_SHELL_EXEC;
  let app;
  const clients = [];
  let serverPid = null;
  try {
    app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.desktop && !!window.verynize && !!window.livePreview);
    const file = path.join(profile, "mcp.json");
    let info;
    for (let i = 0; i < 100 && !info; i++) {
      try {
        info = JSON.parse(await fs.readFile(file, "utf8"));
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert.ok(info, "bridge file written in the temp profile");
    const connect = async (access) => {
      const c = new Client({ name: "shell-test-" + (access || "none"), version: "1" });
      await c.connect(
        new StreamableHTTPClientTransport(new URL(info.url), {
          requestInit: {
            headers: {
              Authorization: `Bearer ${info.token}`,
              ...(access ? { "x-verynize-access": access } : {}),
            },
          },
        }),
      );
      clients.push(c);
      return c;
    };
    const full = await connect("full"),
      plain = await connect(null),
      reader = await connect("readonly");
    const raw = (c, name, args = {}) => c.callTool({ name, arguments: args });
    const call = async (c, name, args) => {
      const r = await raw(c, name, args);
      assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`);
      return r;
    };
    const json = async (c, name, args) => JSON.parse((await call(c, name, args)).content[0].text);
    const errorOf = async (c, name, args) => {
      const r = await raw(c, name, args);
      assert.equal(r.isError, true, `${name} should fail`);
      return r.content[0].text;
    };

    assert.match(await errorOf(full, "get_dev_server"), /No project folder is open/);
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, project);
    await page.evaluate(() => window.desktop.openProject());

    // Dev server: detection, start through npm, preview opened at the detected URL.
    const before = await json(full, "get_dev_server");
    assert.equal(before.state, "stopped");
    assert.deepEqual(before.detected.command, ["npm", "run", "dev"]);
    const started = await json(full, "start_dev_server", { waitMs: 30000 });
    assert.equal(started.state, "running", started.tail);
    assert.match(started.url, /^http:\/\/localhost:\d+\/$/);
    assert.equal(started.preview?.opened, true, started.previewError);
    serverPid = Number(await fs.readFile(path.join(project, "server.pid"), "utf8"));
    await page.waitForFunction(() => !document.getElementById("live-preview").hidden);
    assert.equal((await json(full, "start_dev_server")).alreadyRunning, true);
    const log = await json(reader, "read_terminal", { id: "dev-server" });
    assert.ok(log.entries.some((e) => /Local:/.test(e.text)));

    // Read the page: outline with selectors, password never returned.
    const snap = await json(reader, "preview_snapshot");
    assert.equal(snap.title, "Fixture shop");
    assert.match(snap.outline, /heading 1 "Fixture app"/);
    assert.match(snap.outline, /button "Change text" \[#change\]/);
    assert.match(snap.outline, /textbox "Your name" value="original" \[#name\]/);
    assert.match(snap.outline, /password field .*\(value hidden\)/);
    assert.match(snap.outline, /navigation "Primary":\n\s+link "Second page" → \/second/);
    assert.doesNotMatch(JSON.stringify(snap), /never-read-this-secret/);
    const text = await json(reader, "preview_snapshot", { mode: "text" });
    assert.match(text.text, /Before click/);
    assert.doesNotMatch(JSON.stringify(text), /never-read-this-secret/);

    // Drive it with real input events.
    assert.match(
      await errorOf(reader, "preview_click", { selector: "#change" }),
      /read-only access/,
    );
    const clicked = await json(full, "preview_click", { selector: "#change" });
    assert.equal(clicked.clicked.tag, "button");
    assert.equal(clicked.navigated, false);
    assert.equal(clicked.input, "trusted", "real input events reach the preview frame");
    const frame = page.frameLocator("#live-frame");
    assert.equal(await frame.locator("#message").textContent(), "After click");
    const typed = await json(full, "preview_type", {
      selector: "#name",
      text: "Typed by agent",
      clear: true,
    });
    assert.equal(typed.value, "Typed by agent");
    assert.equal(typed.input, "trusted");
    assert.equal(await frame.locator("#name").inputValue(), "Typed by agent");
    await json(full, "preview_type", { text: " again", submit: true });
    assert.equal(await frame.locator("#message").textContent(), "Submitted Typed by agent again");
    const pw = await json(full, "preview_type", { selector: "#secret", text: "x" });
    assert.equal(pw.value, undefined);
    assert.match(pw.note, /never read back/);
    assert.match(
      await errorOf(full, "preview_click", { selector: "#missing", timeoutMs: 300 }),
      /No element matches #missing/,
    );
    const scrolled = await json(full, "preview_scroll", { deltaY: 900 });
    assert.ok(scrolled.scrollY >= 500 && scrolled.moved, JSON.stringify(scrolled));
    assert.equal((await json(full, "preview_scroll", { to: "top" })).scrollY, 0);
    assert.ok((await json(full, "preview_scroll", { selector: "#end" })).scrollY > 2000);

    const consoleLog = await json(reader, "preview_console");
    assert.ok(
      consoleLog.entries.some((e) => e.level === "info" && e.text === "clicked the button"),
      JSON.stringify(consoleLog.entries),
    );
    assert.ok(consoleLog.entries.some((e) => e.level === "warning" && e.text === "fixture loaded"));
    const errors = await json(reader, "preview_console", { level: "error", since: 0 });
    assert.ok(errors.entries.length >= 1 && errors.entries.every((e) => e.level === "error"));
    assert.equal(
      (await json(reader, "preview_console", { since: consoleLog.latestSeq })).entries.length,
      0,
      "since returns only new entries",
    );

    await json(full, "preview_scroll", { to: "top" });
    const shot = await call(reader, "preview_screenshot");
    assert.equal(shot.content[0].type, "image");
    assert.equal(shot.content[0].mimeType, "image/png");
    const png = Buffer.from(shot.content[0].data, "base64");
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    const meta = JSON.parse(shot.content[1].text);
    assert.ok(meta.width > 200 && meta.height > 200, JSON.stringify(meta));
    const elementShot = JSON.parse(
      (await call(reader, "preview_screenshot", { selector: "#change" })).content[1].text,
    );
    assert.ok(elementShot.width < meta.width && elementShot.region.width > 10);

    // Capture to canvas: one new artboard in the open editor, passwords masked.
    const before2 = await page.evaluate(() => window.verynize.getDocument().pages[0].nodes.length);
    const captured = await json(full, "capture_preview_to_canvas", { label: "Fixture capture" });
    assert.match(captured.id, /^[a-z]{3}$/);
    assert.equal(captured.live, true);
    assert.ok(captured.layers > 3);
    const doc = await page.evaluate(() => window.verynize.getDocument());
    assert.equal(doc.pages[0].nodes.length, before2 + captured.layers);
    assert.ok(doc.pages[0].nodes.some((n) => n.name === "Fixture capture" && !n.parentId));
    assert.ok(doc.pages[0].nodes.some((n) => n.text === "Fixture app"));
    assert.doesNotMatch(JSON.stringify(doc), /never-read-this-secret/);

    // Navigation stays on localhost; leaving it is refused by the tools.
    const opened = await json(full, "preview_open", { url: started.url + "second" });
    assert.equal(opened.title, "");
    assert.match(opened.url, /\/second$/);
    assert.match(await errorOf(full, "preview_open", { url: "https://example.com" }), /localhost/);
    assert.ok(
      (await json(reader, "preview_console")).entries.some(
        (e) => e.source === "navigation" && /second/.test(e.text),
      ),
    );
    await page.evaluate(() => window.livePreview.hide());
    assert.equal(
      (await json(full, "preview_open", {})).opened,
      true,
      "reopens the current preview",
    );
    assert.equal(await page.evaluate(() => document.getElementById("live-preview").hidden), false);
    await page.evaluate(() => window.livePreview.hide());

    // execute_action: editor commands by id on short ids, one undo step each.
    const actions = (await json(reader, "execute_action")).actions.map((a) => a.id);
    assert.ok(
      actions.includes("align.left") &&
        actions.includes("transform.frame") &&
        actions.includes("view.fit"),
    );
    assert.ok(
      !actions.includes("edit.paste") && !actions.includes("edit.copy"),
      "clipboard actions are not exposed",
    );
    assert.match(await errorOf(full, "execute_action", { id: "edit.paste" }), /Unknown action/);
    assert.match(await errorOf(reader, "execute_action", { id: "view.fit" }), /read-only access/);
    const a = (
      await json(full, "create_artboard", {
        code: '<div data-node-label="A" data-component-x="2000" data-component-y="0" className="w-[100px] h-[100px] bg-[#ff0000]" />',
      })
    ).trees[0].id;
    const b = (
      await json(full, "create_artboard", {
        code: '<div data-node-label="B" data-component-x="2300" data-component-y="200" className="w-[100px] h-[100px] bg-[#0000ff]" />',
      })
    ).trees[0].id;
    const aligned = await json(full, "execute_action", { id: "align.top", ids: [a, b] });
    assert.equal(aligned.ran, 1);
    assert.deepEqual(
      [...aligned.selection].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      [a, b].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    const ys = await page.evaluate(() =>
      window.verynize
        .getDocument()
        .pages[0].nodes.filter((n) => ["A", "B"].includes(n.name))
        .map((n) => n.y),
    );
    assert.deepEqual(ys, [0, 0]);
    assert.equal(
      (await json(full, "execute_action", { id: "align.top", ids: [] })).results[0].ran,
      false,
      "unavailable without a selection",
    );
    assert.equal((await json(full, "execute_action", { id: "view.fit" })).ran, 1);

    // Terminal: argv only, project folder, approval policy.
    const ran = await json(full, "run_terminal_command", {
      argv: [process.execPath, "-e", 'console.log("cwd="+process.cwd())'],
    });
    assert.equal(ran.exitCode, 0);
    assert.equal(ran.output.trim(), "cwd=" + project);
    assert.match(
      await errorOf(reader, "run_terminal_command", { argv: ["ls"] }),
      /read-only access/,
    );
    await app.evaluate(({ dialog }) => {
      globalThis.__asked = [];
      dialog.showMessageBox = async (_w, o) => {
        globalThis.__asked.push(o.detail);
        return { response: 1, checkboxChecked: false };
      };
    });
    assert.match(await errorOf(plain, "run_terminal_command", { argv: ["ls"] }), /did not allow/);
    const asked = await app.evaluate(() => globalThis.__asked);
    assert.equal(asked.length, 1);
    assert.match(asked[0], /The agent wants to run: ls/);
    assert.ok(asked[0].includes(project));
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: true });
    });
    const bg = await json(plain, "run_terminal_command", {
      argv: [process.execPath, "-e", 'setInterval(()=>console.log("tick"),50)'],
      background: true,
    });
    assert.equal(bg.state, "running");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => {
        throw Error("should not ask again");
      };
    });
    await json(plain, "run_terminal_command", { argv: [process.execPath, "-e", "0"] });
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(
      (await json(reader, "read_terminal", { id: bg.id })).entries.some((e) => e.text === "tick"),
    );
    assert.ok((await json(reader, "read_terminal")).terminals.some((t) => t.id === bg.id));
    assert.equal((await json(full, "read_terminal", { id: bg.id, stop: true })).state, "stopped");
    await app.evaluate(() => {
      process.env.VERYNIZE_SHELL_EXEC = "0";
    });
    assert.match(await errorOf(full, "run_terminal_command", { argv: ["ls"] }), /turned off/);
    await app.evaluate(() => {
      delete process.env.VERYNIZE_SHELL_EXEC;
    });

    // Stop, restart, and quit: every process group is gone after the app closes.
    assert.equal((await json(full, "stop_dev_server")).state, "stopped");
    assert.ok(await waitGone(serverPid), "stop_dev_server ended the server");
    await json(full, "start_dev_server", { open: false });
    serverPid = Number(await fs.readFile(path.join(project, "server.pid"), "utf8"));
    assert.ok(alive(serverPid));
    for (const c of clients) await c.close().catch(() => {});
    clients.length = 0;
    await app.close();
    app = null;
    assert.ok(await waitGone(serverPid), "quitting the app stops the dev server");
    console.log(
      "PASS shell tools: dev server start/stop, preview snapshot/click/type/scroll/console/screenshot/capture, terminal approval + access levels, execute_action, cleanup on quit",
    );
  } finally {
    for (const c of clients) await c.close().catch(() => {});
    if (app) await app.close().catch(() => {});
    if (serverPid && alive(serverPid))
      try {
        process.kill(serverPid, "SIGKILL");
      } catch {}
    await fs.rm(profile, { recursive: true, force: true });
    await fs.rm(project, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
