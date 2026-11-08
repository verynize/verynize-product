// Integrated terminal (desktop/terminal.cjs + web/src/islands/code/terminal-panel.tsx) in real Electron with real
// PTYs: create/write/resize/kill through window.desktop, the cwd guard (project, subfolder, worktree,
// ~/Verynize/workspaces, custom validator; /etc, /tmp, relative and missing paths refused), input and size limits,
// the per-window cap, and no shell or foreground job left running after the app quits. A second launch renders
// the TerminalPanel component itself (compiled into a temporary test bundle, never shipped) and drives it with
// the keyboard: tabs, typing, ⌘K, theme switch, closing, `exit`, and the no-repository empty state.
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const { crashGuard } = require("./helpers/electron-crash-reports.cjs");
const processes = new WeakMap();
const assertCleanExit = (app) => {
  assert.equal(processes.get(app).signalCode, null);
  assert.equal(processes.get(app).exitCode, 0);
};
const repo = path.join(__dirname, "..");
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
  });
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
const pgrep = (pattern) => {
  try {
    return execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
};
const waitUntil = async (test, ms, label) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`Timed out: ${label}`);
};
const errorOf = (page, fn, arg) =>
  page.evaluate(
    async ([source, value]) => {
      try {
        // oxlint-disable-next-line no-eval -- rebuilds the serialized test function inside the page
        await (0, eval)(source)(value);
        return "resolved";
      } catch (error) {
        return String(error.message);
      }
    },
    [fn.toString(), arg],
  );

/** Compiles the real TerminalPanel plus a tiny mount helper into an IIFE in `out` (test only). */
async function buildPanelBundle(dir) {
  await fs.mkdir(dir, { recursive: true });
  const entry = path.join(dir, "entry.tsx"),
    config = path.join(dir, "vite.test.config.mjs"),
    out = path.join(dir, "out");
  const abs = (file) => JSON.stringify(path.join(repo, file));
  await fs.writeFile(
    entry,
    `import { createElement } from ${JSON.stringify(require.resolve("react", { paths: [repo] }))};
import { createRoot } from ${JSON.stringify(require.resolve("react-dom/client", { paths: [repo] }))};
import { TerminalPanel } from ${abs("web/src/islands/code/terminal-panel.tsx")};
import ${abs("web/src/styles/globals.css")};
const roots = new Map();
window.__terminalPanelTest = {
  render(id, cwd) { let root = roots.get(id); if (!root) { const el = document.createElement('div'); el.id = id; el.setAttribute('data-bd', ''); el.style.cssText = 'position:fixed;right:0;bottom:0;width:560px;height:320px;z-index:5000;display:flex'; document.body.append(el); root = createRoot(el); roots.set(id, root); } root.render(createElement(TerminalPanel, { cwd })); },
  unmount(id) { roots.get(id)?.unmount(); roots.delete(id); document.getElementById(id)?.remove(); },
};
`,
  );
  const mod = (name) =>
    JSON.stringify(pathToFileURL(require.resolve(name, { paths: [repo] })).href);
  await fs.writeFile(
    config,
    `import react from ${mod("@vitejs/plugin-react")};
import tailwindcss from ${mod("@tailwindcss/vite")};
export default {
  root: ${JSON.stringify(repo)},
  plugins: [react(), tailwindcss()],
  publicDir: false,
  logLevel: 'error',
  resolve: { alias: { '@': ${abs("web/src")} } },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: { outDir: ${JSON.stringify(out)}, emptyOutDir: true, minify: false, sourcemap: false,
    lib: { entry: ${JSON.stringify(entry)}, formats: ['iife'], name: 'TerminalPanelTest', fileName: () => 'panel.js', cssFileName: 'panel' } },
};
`,
  );
  execFileSync(path.join(repo, "node_modules/.bin/vp"), ["build", "-c", config], {
    cwd: repo,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, NODE_ENV: "production" },
  });
  return { js: path.join(out, "panel.js"), css: path.join(out, "panel.css") };
}

(async () => {
  const checkReports = crashGuard();
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "code-terminal-")));
  const project = path.join(root, "project"),
    worktree = path.join(root, "project-wt"),
    home = path.join(root, "home"),
    zdot = path.join(root, "zdot");
  const workspace = path.join(home, "Verynize", "workspaces", "demo"),
    other = path.join(root, "other");
  await fs.mkdir(path.join(project, "src"), { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(other);
  await fs.mkdir(zdot);
  // Deterministic interactive zsh: no user dotfiles, plain prompt.
  await fs.writeFile(path.join(zdot, ".zshrc"), "PS1='%~ %# '\nunsetopt BEEP\n");
  // Debian/Ubuntu's /etc/zsh/zshrc runs compinit unless this is set; on a CI image with group-writable completion
  // folders it stops at "Ignore insecure directories and continue [y] or abort compinit [n]?" and eats the input.
  await fs.writeFile(path.join(zdot, ".zshenv"), "skip_global_compinit=1\n");
  git(project, "init", "--initial-branch=main");
  await fs.writeFile(path.join(project, "index.html"), "<h1>Hello</h1>\n");
  git(project, "add", ".");
  git(project, "commit", "-m", "Initial");
  git(project, "worktree", "add", "-b", "feature", worktree);
  const env = {
    ...process.env,
    ...identity,
    HOME: home,
    ZDOTDIR: zdot,
    SHELL: "/bin/zsh",
    HISTFILE: "/dev/null",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  const bundle = await buildPanelBundle(path.join(root, "bundle"));

  const launch = async () => {
    const app = await _electron.launch({
      env,
      args: [".", `--user-data-dir=${path.join(root, "profile")}`],
      cwd: repo,
      timeout: 30000,
    });
    processes.set(app, app.process());
    const page = await app.firstWindow({ timeout: 30000 });
    await page.waitForFunction(() => !!window.desktop);
    return { app, page };
  };
  const openProject = async (app, page) => {
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, project);
    assert.equal((await page.evaluate(() => window.desktop.openProject())).root, project);
  };

  const pids = [];
  // ---------------------------------------------------------------- 1. API through window.desktop
  {
    const { app, page } = await launch();
    let closed = false;
    try {
      assert.deepEqual(
        await page.evaluate(() =>
          [
            "terminalCreate",
            "terminalWrite",
            "terminalResize",
            "terminalKill",
            "onTerminalData",
            "onTerminalExit",
          ].map((name) => typeof window.desktop[name]),
        ),
        Array(6).fill("function"),
      );
      // Before a project is open only Verynize workspaces are allowed.
      assert.match(
        await errorOf(page, (cwd) => window.desktop.terminalCreate({ cwd }), project),
        /current project, one of its worktrees, or a Verynize workspace/,
      );
      await openProject(app, page);

      await page.evaluate(() => {
        const t = (window.__term = { data: {}, exits: [] });
        const off = window.desktop.onTerminalData(({ id, data }) => {
          t.data[id] = (t.data[id] || "") + data;
        });
        t.offType = typeof off;
        window.desktop.onTerminalExit((event) => t.exits.push(event));
      });
      assert.equal(await page.evaluate(() => window.__term.offType), "function");
      const output = (id) => page.evaluate((id) => window.__term.data[id] || "", id);
      const waitOutput = (id, pattern, label = String(pattern)) =>
        waitUntil(async () => pattern.test(await output(id)), 15000, label).catch(async (error) => {
          error.message += `\n--- terminal output (last 1500 chars) ---\n${JSON.stringify((await output(id)).slice(-1500))}`;
          throw error;
        });
      const write = (id, data) =>
        page.evaluate((options) => window.desktop.terminalWrite(options), { id, data });
      const shellPid = async (id) => {
        await write(id, 'echo "PID=$$"\r');
        await waitOutput(id, /\nPID=\d+/);
        const pid = Number((await output(id)).match(/\nPID=(\d+)/)[1]);
        pids.push(pid);
        return pid;
      };

      const first = await page.evaluate(
        (cwd) => window.desktop.terminalCreate({ cwd, cols: 100, rows: 30 }),
        project,
      );
      assert.equal(typeof first.id, "string");
      assert.equal(first.shell, "zsh");
      assert.equal(first.cwd, project);
      await write(first.id, "echo VERYNIZE_TERM_OK\r");
      await waitOutput(first.id, /\nVERYNIZE_TERM_OK\r\n/, "echo output");
      await write(first.id, "pwd\r");
      await waitOutput(
        first.id,
        new RegExp("\\n" + project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\r\\n"),
        "pwd is the project",
      );
      await write(
        first.id,
        'echo "$TERM $COLORTERM $TERM_PROGRAM ${ELECTRON_RUN_AS_NODE:-unset}"\r',
      );
      await waitOutput(
        first.id,
        /\nxterm-256color truecolor Verynize unset\r\n/,
        "terminal environment",
      );
      assert.equal(
        await page.evaluate(
          (id) => window.desktop.terminalResize({ id, cols: 120, rows: 40 }),
          first.id,
        ),
        true,
      );
      await write(first.id, "stty size\r");
      await waitOutput(first.id, /\n40 120\r\n/, "resized PTY");
      const firstPid = await shellPid(first.id);
      assert.ok(alive(firstPid));

      // Input and size bounds, unknown ids.
      assert.match(
        await errorOf(
          page,
          (id) => window.desktop.terminalWrite({ id, data: "x".repeat(70000) }),
          first.id,
        ),
        /at most 64 KB/,
      );
      assert.match(
        await errorOf(page, (id) => window.desktop.terminalWrite({ id, data: 42 }), first.id),
        /at most 64 KB/,
      );
      assert.match(
        await errorOf(
          page,
          (id) => window.desktop.terminalResize({ id, cols: 0, rows: 10 }),
          first.id,
        ),
        /Invalid terminal size/,
      );
      assert.match(
        await errorOf(
          page,
          (id) => window.desktop.terminalResize({ id, cols: 80.5, rows: 10 }),
          first.id,
        ),
        /Invalid terminal size/,
      );
      assert.match(
        await errorOf(page, () => window.desktop.terminalWrite({ id: "nope", data: "ls\r" })),
        /no longer running/,
      );
      assert.equal(await page.evaluate(() => window.desktop.terminalKill({ id: "nope" })), false);

      // cwd guard.
      for (const bad of [
        "/etc",
        "/tmp",
        other,
        "relative/path",
        path.join(project, "missing"),
        path.join(project, "index.html"),
        "",
        null,
        42,
      ])
        assert.match(
          await errorOf(page, (cwd) => window.desktop.terminalCreate({ cwd }), bad),
          /current project, one of its worktrees, or a Verynize workspace|Invalid terminal options/,
          `cwd ${bad} must be refused`,
        );
      const sub = await page.evaluate(
        (cwd) => window.desktop.terminalCreate({ cwd }),
        path.join(project, "src"),
      );
      assert.equal(sub.cwd, path.join(project, "src"));
      const tree = await page.evaluate((cwd) => window.desktop.terminalCreate({ cwd }), worktree);
      assert.equal(tree.cwd, worktree);
      const ws = await page.evaluate((cwd) => window.desktop.terminalCreate({ cwd }), workspace);
      assert.equal(ws.cwd, workspace);
      assert.match(
        await errorOf(
          page,
          (cwd) => window.desktop.terminalCreate({ cwd }),
          path.join(home, "Verynize", "workspaces"),
        ),
        /Verynize workspace/,
      );
      // Custom validator hook (repository registry): its answer is final; null restores the default policy.
      const terminalModule = path.join(repo, "desktop/terminal.cjs");
      await app.evaluate(
        (_electron, [file, allowed]) => {
          process.mainModule
            .require(file)
            .setTerminalCwdValidator((cwd, context) => cwd === allowed || context.defaultAllowed);
        },
        [terminalModule, other],
      );
      const custom = await page.evaluate((cwd) => window.desktop.terminalCreate({ cwd }), other);
      assert.equal(custom.cwd, other);
      await app.evaluate((_electron, file) => {
        process.mainModule.require(file).setTerminalCwdValidator(() => false);
      }, terminalModule);
      assert.match(
        await errorOf(page, (cwd) => window.desktop.terminalCreate({ cwd }), project),
        /current project/,
      );
      await app.evaluate((_electron, file) => {
        process.mainModule.require(file).setTerminalCwdValidator(null);
      }, terminalModule);
      assert.match(
        await errorOf(page, (cwd) => window.desktop.terminalCreate({ cwd }), other),
        /current project/,
      );

      // Kill: exit event, process gone.
      const subPid = await shellPid(sub.id);
      assert.equal(await page.evaluate((id) => window.desktop.terminalKill({ id }), sub.id), true);
      await waitUntil(
        () => page.evaluate((id) => window.__term.exits.some((event) => event.id === id), sub.id),
        5000,
        "exit event after kill",
      );
      await waitUntil(() => !alive(subPid), 5000, "killed shell is gone");
      pids.splice(pids.indexOf(subPid), 1);
      assert.match(
        await errorOf(page, (id) => window.desktop.terminalWrite({ id, data: "ls\r" }), sub.id),
        /no longer running/,
      );

      // `exit` typed in the shell: exit event with code 0.
      await write(tree.id, "exit\r");
      await waitUntil(
        () =>
          page.evaluate(
            (id) => window.__term.exits.some((event) => event.id === id && event.exitCode === 0),
            tree.id,
          ),
        5000,
        "exit event after `exit`",
      );

      // Cap: 8 live terminals per window (first, ws, custom are live).
      const extra = [];
      for (let i = 0; i < 5; i++)
        extra.push(await page.evaluate((cwd) => window.desktop.terminalCreate({ cwd }), project));
      assert.match(
        await errorOf(page, (cwd) => window.desktop.terminalCreate({ cwd }), project),
        /At most 8 terminals/,
      );

      // Output batching: a burst arrives complete and in order.
      await write(first.id, 'for i in $(seq 1 3000); do echo "line-$i"; done; echo BURST_DONE\r');
      await waitOutput(first.id, /\nBURST_DONE\r\n/, "burst output");
      const lines = (await output(first.id))
        .match(/\nline-\d+\r/g)
        .map((line) => Number(line.slice(6, -1)));
      assert.deepEqual(
        lines,
        Array.from({ length: 3000 }, (_, i) => i + 1),
      );

      // Shells and a foreground job that must not survive the quit.
      for (const term of [ws, custom, ...extra]) await shellPid(term.id);
      await write(extra[0].id, "sleep 98761\r");
      await waitUntil(() => pgrep("sleep 98761").length > 0, 5000, "foreground job started");
      await write(extra[1].id, "sleep 98762 &\r");
      await waitUntil(() => pgrep("sleep 98762").length > 0, 5000, "background job started");
      assert.ok(pids.every(alive));
      await app.close();
      assertCleanExit(app);
      closed = true;
      await waitUntil(() => !pids.some(alive), 5000, "every shell exits with the app");
      await waitUntil(() => !pgrep("sleep 9876[12]").length, 5000, "jobs exit with the app");
      console.log(
        "PASS terminal API: create/write/resize/kill, env, limits, cwd guard + validator hook, cap of 8, batched output, no orphans after quit",
      );
    } finally {
      if (!closed) await app.close();
      assertCleanExit(app);
    }
  }

  // ---------------------------------------------------------------- 2. TerminalPanel component
  {
    const { app, page } = await launch();
    try {
      await openProject(app, page);
      await page.addStyleTag({ content: await fs.readFile(bundle.css, "utf8") });
      await page.addScriptTag({ content: await fs.readFile(bundle.js, "utf8") });
      await page.evaluate((cwd) => window.__terminalPanelTest.render("panel-a", cwd), project);
      const panel = page.locator("#panel-a");
      const tabs = panel.getByRole("tab");
      await panel.getByRole("tab", { name: "zsh" }).waitFor({ timeout: 15000 });
      assert.equal(await tabs.count(), 1);
      const rows = panel.locator("[role=tabpanel]:not([hidden]) .xterm-rows");
      await rows.waitFor();
      await page.waitForFunction(
        () =>
          /%/.test(
            document.querySelector("#panel-a [role=tabpanel]:not([hidden]) .xterm-rows")
              ?.textContent || "",
          ),
        null,
        { timeout: 15000 },
      );
      // The auto-opened first terminal does not steal focus; clicking it does.
      await panel.locator("[role=tabpanel]:not([hidden]) .xterm").click();
      await page.keyboard.type("echo PANEL_OK");
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () =>
          (
            (
              document.querySelector("#panel-a [role=tabpanel]:not([hidden]) .xterm-rows")
                ?.textContent || ""
            ).match(/PANEL_OK/g) || []
          ).length >= 2,
        null,
        { timeout: 10000 },
      );
      // Theme from the tokens: dark surface #1c1c1c, then the light theme on html[data-ui-theme=light].
      const surface = () =>
        page.evaluate(
          () =>
            getComputedStyle(
              document.querySelector("#panel-a [role=tabpanel]:not([hidden]) .xterm-viewport"),
            ).backgroundColor,
        );
      assert.equal(await surface(), "rgb(28, 28, 28)");
      const fontFamily = await page.evaluate(
        () => getComputedStyle(document.querySelector("#panel-a .xterm-rows")).fontFamily,
      );
      assert.match(fontFamily, /ui-monospace/);
      await page.evaluate(() => document.documentElement.setAttribute("data-ui-theme", "light"));
      await waitUntil(
        async () => (await surface()) === "rgb(247, 247, 247)",
        5000,
        "light terminal theme",
      );
      await page.evaluate(() => document.documentElement.removeAttribute("data-ui-theme"));
      await waitUntil(
        async () => (await surface()) === "rgb(28, 28, 28)",
        5000,
        "dark terminal theme again",
      );
      // ⌘K clears the buffer (Terminal.app; macOS only: elsewhere Ctrl+K stays the shell's kill-line).
      await panel.locator("[role=tabpanel]:not([hidden]) .xterm").click();
      if (process.platform === "darwin") {
        await page.keyboard.press("Meta+k");
        await page.waitForFunction(
          () =>
            !/PANEL_OK/.test(
              document.querySelector("#panel-a [role=tabpanel]:not([hidden]) .xterm-rows")
                ?.textContent || "",
            ),
          null,
          { timeout: 5000 },
        );
      }
      // "+" adds a focused tab; the first tab keeps its shell while hidden.
      await panel.getByRole("button", { name: "New terminal" }).click();
      await waitUntil(
        async () => (await panel.getByRole("tab", { name: "zsh" }).count()) === 2,
        10000,
        "second tab",
      );
      assert.equal(await panel.locator("[role=tab][aria-selected=true]").count(), 1);
      assert.equal(await panel.locator("[role=tabpanel][hidden]").count(), 1);
      await page.waitForFunction(
        () =>
          /%/.test(
            document.querySelector("#panel-a [role=tabpanel]:not([hidden]) .xterm-rows")
              ?.textContent || "",
          ),
        null,
        { timeout: 15000 },
      );
      await page.keyboard.type("echo SECOND_TAB");
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () =>
          (
            (
              document.querySelector("#panel-a [role=tabpanel]:not([hidden]) .xterm-rows")
                ?.textContent || ""
            ).match(/SECOND_TAB/g) || []
          ).length >= 2,
        null,
        { timeout: 10000 },
      );
      // Close the second tab on hover; typing `exit` in the first closes it too.
      await tabs.nth(1).hover();
      await panel.getByRole("button", { name: "Close zsh" }).click();
      await waitUntil(async () => (await tabs.count()) === 1, 5000, "tab closed");
      await panel.locator("[role=tabpanel]:not([hidden]) .xterm").click();
      await page.keyboard.type("exit");
      await page.keyboard.press("Enter");
      await waitUntil(async () => (await tabs.count()) === 0, 5000, "tab closed after exit");
      await panel.getByRole("button", { name: "New terminal" }).first().waitFor();
      // No repository: empty state, no new tab.
      await page.evaluate(() => window.__terminalPanelTest.render("panel-a", null));
      await panel.getByText("Open a repository to use the terminal").waitFor();
      assert.equal(await panel.getByRole("button", { name: "New terminal" }).isDisabled(), true);
      await page.evaluate(() => window.__terminalPanelTest.unmount("panel-a"));
      console.log(
        "PASS TerminalPanel: zsh tab, typing, token theme (dark/light), ⌘K, + tab, hidden tab kept, close, exit, empty state",
      );
    } finally {
      await app.close();
      assertCleanExit(app);
    }
  }
  // Five native-exit races, followed by a window-close / delayed-quit race.
  for (let iteration = 0; iteration < 6; iteration++) {
    const { app, page } = await launch();
    let logs = "";
    processes.get(app).stdout.on("data", (data) => {
      logs += data;
    });
    try {
      await openProject(app, page);
      const shellPids = await page.evaluate(async (cwd) => {
        window.__raceOutput = "";
        window.desktop.onTerminalData((event) => {
          window.__raceOutput += event.data;
        });
        const terms = [];
        for (let i = 0; i < 8; i++) terms.push(await window.desktop.terminalCreate({ cwd }));
        return terms;
      }, project);
      // Install HUP traps and record readiness before scheduling the short-lived jobs.
      for (const term of shellPids)
        await page.evaluate(
          (id) => window.desktop.terminalWrite({ id, data: "trap '' HUP; echo READY_$$\r" }),
          term.id,
        );
      await page.waitForFunction(
        () => (window.__raceOutput.match(/READY_\d+/g) || []).length === 8,
      );
      const pids = await page.evaluate(() =>
        [...window.__raceOutput.matchAll(/READY_(\d+)/g)].map((match) => Number(match[1])),
      );
      assert.equal(
        await app.evaluate(
          (_, file) => process.mainModule.require(file).pendingExitCount(),
          path.join(repo, "desktop/terminal.cjs"),
        ),
        8,
      );
      await page.evaluate(async (terms) => {
        await Promise.all(
          terms.map(({ id }) =>
            window.desktop.terminalWrite({ id, data: "trap '' HUP; sleep 0.2; exit\r" }),
          ),
        );
      }, shellPids);
      if (iteration === 5) {
        const exited = new Promise((resolve) => processes.get(app).once("exit", resolve));
        await app.evaluate(({ BrowserWindow, app }) => {
          BrowserWindow.getAllWindows().forEach((win) => win.close());
          setTimeout(() => app.quit(), 50);
        });
        await exited;
      } else {
        await app.close();
      }
      assertCleanExit(app);
      assert.match(logs, /terminals drained/);
      await waitUntil(() => !pids.some(alive), 5000, "race shells all exit");
      checkReports();
    } finally {
      if (processes.get(app).exitCode === null && processes.get(app).signalCode === null) {
        await app.close();
        assertCleanExit(app);
      }
    }
  }
  console.log(
    "PASS five PTY quit races and window-close race: clean exits, drained callbacks, no orphan shells",
  );
  checkReports();
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
