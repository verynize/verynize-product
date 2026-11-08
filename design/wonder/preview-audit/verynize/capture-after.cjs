// After-fix captures of the merged preview feature, one per Wonder evidence file (design/wonder/preview-audit).
// Drives the real Electron app with Playwright `_electron` at 1440×870, device scale factor 2, sRGB, on Wonder's dark
// canvas (#2b2b2b). A git copy of the Wonder sandbox (/tmp/preview-sandbox: heading, counter, input, /about link,
// image; an inline copy is used when it is missing) is added through the Code workspace, so the chat header, the
// chat worktree and the canvas frame are the real ones. The agent is the deterministic fake `codex`
// (tests/fixtures/fake-codex.cjs); the dev server is a real `python3 -m http.server` on a free port (Wonder's 8000
// may be taken). The frame is 1512×982 at (418, 246) and the camera 55%, framed like Wonder's captures.
//
//   npm run build:ui
//   node design/wonder/preview-audit/verynize/capture-after.cjs [--keep] [name-prefix ...]
//   python3 design/wonder/preview-audit/make-pairs.py
//
// Writes after/<id>-<state>.png (same names as the Wonder/Verynize pairs) and after/metrics.json (per-shot facts and
// the integration seam checks). Prefix args only filter which PNGs are written; the flow always runs in full. A step
// that fails is logged and recorded in metrics.json, and the flow continues.
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const { _electron } = require(ROOT + "/node_modules/@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { execFileSync } = require("node:child_process");

const OUT = path.join(__dirname, "after");
const SOURCE = "/tmp/preview-sandbox";
const KEEP = process.argv.includes("--keep");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const want = (name) => !only.length || only.some((p) => name.startsWith(p));
const identity = {
  GIT_AUTHOR_NAME: "Audit",
  GIT_AUTHOR_EMAIL: "audit@example.invalid",
  GIT_COMMITTER_NAME: "Audit",
  GIT_COMMITTER_EMAIL: "audit@example.invalid",
};
const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, stdio: "ignore", env: { ...process.env, ...identity } });
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
const INDEX = `<!doctype html><html><head><meta charset="utf-8"><title>Preview sandbox</title><style>body{font:18px system-ui;padding:32px;background:#f3f6ff;color:#172340}button,input,a{display:block;margin:16px 0;padding:10px}img{width:160px}</style></head><body><h1>Sunbird preview sandbox</h1><button onclick="this.textContent='Count: '+(++window.count)">Count: 0</button><input placeholder="Type a message"><a href="/about">About</a><img src="/bird.svg" alt="Sandbox bird"><script>window.count=0</script></body></html>\n`;
const BIRD = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#95b3f0"/><circle cx="78" cy="50" r="24" fill="#f6cb6b"/><path d="M98 44l22 7-22 7z" fill="#ef6f6c"/></svg>\n`;

async function makeSandbox(repo) {
  await fs.mkdir(path.join(repo, "about"), { recursive: true });
  const copy = async (rel, fallback) =>
    fs
      .copyFile(path.join(SOURCE, rel), path.join(repo, rel))
      .catch(() => fs.writeFile(path.join(repo, rel), fallback));
  await copy("index.html", INDEX);
  await copy("bird.svg", BIRD);
  await copy("about/index.html", '<!doctype html><h1>About Sunbird</h1><a href="/">Home</a>\n');
  git(repo, "init", "--initial-branch=main");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "Create isolated preview fixture");
}

(async () => {
  await fs.mkdir(OUT, { recursive: true });
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "vz-preview-after-")));
  const repo = path.join(tmp, "preview-sandbox"),
    bin = path.join(tmp, "bin"),
    profile = path.join(tmp, "profile");
  await makeSandbox(repo);
  await fs.mkdir(bin);
  await fs.copyFile(path.join(ROOT, "tests/fixtures/fake-codex.cjs"), path.join(bin, "codex"));
  await fs.chmod(path.join(bin, "codex"), 0o755);
  const env = {
    ...process.env,
    ...identity,
    PATH: bin + path.delimiter + process.env.PATH,
    VERYNIZE_WORKSPACES_DIR: path.join(tmp, "workspaces"),
    VERYNIZE_BRANCH_PREFIX: "verynize",
    VERYNIZE_SKIP_ONBOARDING: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    cwd: ROOT,
    env,
    args: [
      ".",
      "--force-device-scale-factor=2",
      "--force-color-profile=srgb",
      `--user-data-dir=${profile}`,
    ],
    timeout: 30000,
  });
  const metrics = { shots: {}, seams: {}, failures: [] };
  const errors = [];
  let page,
    root = "";
  try {
    page = await app.firstWindow({ timeout: 30000 });
    page.on("pageerror", (e) => errors.push(e.message));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 870),
    );
    await page.waitForFunction(
      () =>
        !!window.livePreview?.frameInternals &&
        !!window.agentWorkspace &&
        !!window.previewEdits &&
        !!window.previewTab,
    );
    // The starter layers (Heading, Caption, Violet card) sat just left of the preview frame and showed through at the
    // canvas edge (a violet bar and stray text next to the Layers panel). Wonder's other frames are off screen, so park
    // them 4000 px to the left; they stay in the Layers list.
    await page.evaluate(() => {
      const doc = window.design.getDocument();
      for (const p of doc.pages) {
        p.background = "#2b2b2b";
        for (const n of p.nodes) if (!n.parentId) n.x -= 4000;
      }
      window.design.setDocument(doc);
    });
    await page.waitForTimeout(500);

    /* ---------- helpers ---------- */
    const wait = (ms) => page.waitForTimeout(ms);
    const away = async (x = 1435, y = 600) => {
      await page.mouse.move(x, y);
      await wait(200);
    };
    const esc = async () => {
      await page.keyboard.press("Escape");
      await wait(250);
    };
    async function shot(name, facts = {}) {
      metrics.shots[name] = facts;
      if (!want(name)) return;
      await wait(250);
      await page.screenshot({ path: path.join(OUT, name + ".png") });
      console.log("· saved", name);
    }
    async function step(name, fn) {
      try {
        await fn();
      } catch (error) {
        console.log("✗", name, error.message.split("\n")[0]);
        metrics.failures.push({ step: name, error: error.message.split("\n")[0] });
      }
    }
    let id = "";
    const pf = () => `.canvas-preview[data-id="${id}"]`;
    const select = () => page.evaluate((id) => window.design.setSelection([id]), id);
    /** Frame 1512×982 at (418, 246), camera 55% with the frame body at screen (306, 158), as in Wonder. */
    const frameView = () =>
      page.evaluate((id) => {
        window.design.updateNodes([id], { x: 418, y: 246, w: 1512, h: 982 });
        const wrap = document.getElementById("canvas-wrap").getBoundingClientRect();
        window.design.setCamera(306 - wrap.left - 418 * 0.55, 158 - wrap.top - 246 * 0.55, 0.55);
        // Correct for any offset between the camera origin and the frame element (measured, so the shots line up).
        const r = document
            .querySelector(`.canvas-preview[data-id="${id}"]`)
            .getBoundingClientRect(),
          c = window.design.getCamera();
        window.design.setCamera(c.x + 306 - r.left, c.y + 158 - r.top, 0.55);
      }, id);
    const app_ = () => page.frames().find((f) => f.name() === "verynize-live-preview");
    /** Page point of an element inside the canvas preview (the iframe is scaled by the canvas zoom). */
    async function inApp(selector, dx = 20) {
      const box = await page.locator("#live-frame").boundingBox();
      const scale = await page
        .locator("#live-frame")
        .evaluate((el) => el.getBoundingClientRect().width / el.clientWidth);
      const r = await app_().evaluate((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }, selector);
      return {
        x: box.x + (r.x + Math.min(dx, r.w / 2)) * scale,
        y: box.y + (r.y + r.h / 2) * scale,
      };
    }
    const tip = async (locator) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await away();
        await locator.hover();
        await wait(900);
        if (
          await page
            .locator(".pf-tooltip:not([hidden]), [data-pe=preview-mode-tip], [role=tooltip]")
            .count()
        )
          return;
      }
    };
    const menuItems = () =>
      page
        .locator("[role=menu]")
        .last()
        .locator("[role=menuitem], [role=menuitemcheckbox], [role=separator]")
        .evaluateAll((els) =>
          els.map((el) =>
            el.getAttribute("role") === "separator"
              ? "|"
              : el.textContent.replace(/\s+/g, " ").trim(),
          ),
        );
    const status = () => page.evaluate((root) => window.desktop.devServer.status({ root }), root);
    /** Save a run profile and tell the preview surfaces (the header caches the last status). */
    const configure = async (command, url) => {
      await page.evaluate(
        ({ root, command, url }) =>
          window.desktop.devServer.configure({ root, command, ...(url ? { url } : {}) }),
        { root, command, url },
      );
      await page.evaluate(
        (root) =>
          window.dispatchEvent(new CustomEvent("bd:dev-server-changed", { detail: { root } })),
        root,
      );
      await wait(600);
    };

    /* ---------- repository + chat worktree through the Code workspace ---------- */
    await page.getByRole("radio", { name: "Code" }).click();
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, repo);
    await page.locator("#code-add-repository").click();
    await page.locator("#project-open").click();
    await page.waitForFunction(
      () => {
        const s = window.agentWorkspace.getState();
        return s.branch && s.activeRoot && s.activeRoot === s.chatRoot;
      },
      null,
      { timeout: 30000 },
    );
    root = (await page.evaluate(() => window.agentWorkspace.getState())).activeRoot;
    await page.evaluate(() => {
      window.agentWorkspace.setDefaults({ agent: "codex", access: "auto" });
      window.agentWorkspace.setCodeMode(false);
      window.agentWorkspace.openChat();
    });
    await page.locator("#chat-start-preview").waitFor();

    /* ---------- PS1 header split button, X1 empty Preview settings, PS2 first start ---------- */
    await step("PS1", async () => {
      await page.locator("#preview-intro").waitFor();
      await away();
      await shot("PS1-idle", { label: await page.locator("#chat-start-preview").innerText() });
      await page.locator("#chat-preview-menu").click();
      await wait(300);
      await shot("PS1-menu", { items: await menuItems() });
      await esc();
    });
    await step("X1", async () => {
      await page.locator("#chat-preview-menu").click();
      await page.locator("#chat-configure-preview").click();
      await page.locator("#preview-settings").waitFor();
      await wait(300);
      await away();
      await shot("X1-settings");
      await esc();
      await page.locator("#preview-settings").waitFor({ state: "hidden" });
    });
    await step("PS2-card", async () => {
      await page.locator("#preview-intro").getByRole("button", { name: "Start preview" }).click();
      const saved = page.locator("[data-preview-saved]").last();
      await saved.waitFor({ timeout: 15000 });
      await saved.locator("summary").click();
      await page.waitForFunction(() => !window.agentWorkspace.isBusy(), null, { timeout: 15000 });
      await away();
      await shot("PS2-card", { text: (await saved.innerText()).replace(/\s+/g, " ") });
    });

    /* ---------- PS3 starting, PS4 failure (a start command that exits 7 after a few seconds) ---------- */
    const port = await freePort();
    const url = `http://localhost:${port}/`;
    await configure(["sh", "-c", "sleep 4; exit 7"]);
    await page.locator("#chat-start-preview").click();
    await page.waitForFunction(
      (root) =>
        window.design
          .getDocument()
          .pages.some((p) => p.nodes.some((n) => n.preview?.root === root)),
      root,
      { timeout: 15000 },
    );
    id = await page.evaluate(
      (root) =>
        window.design
          .getDocument()
          .pages.flatMap((p) => p.nodes)
          .find((n) => n.preview?.root === root).id,
      root,
    );
    await page.evaluate(() => window.agentWorkspace.closeChat());
    await select();
    await frameView();
    await step("PS3", async () => {
      await page.locator(`${pf()} .pf-card[data-kind=starting]`).waitFor({ timeout: 10000 });
      await page
        .waitForFunction(
          (id) => document.querySelector(`[data-id="${id}"] .pf-timer`)?.textContent === "0:01",
          id,
          { timeout: 5000 },
        )
        .catch(() => {});
      await away();
      await shot("PS3-starting", {
        card: (await page.locator(`${pf()} .preview-setup-card`).innerText()).replace(/\s+/g, " "),
      });
    });
    await step("PS4", async () => {
      await page.locator(`${pf()} .pf-card[data-kind=error]`).waitFor({ timeout: 20000 });
      await away();
      await shot("PS4-error", {
        card: (await page.locator(`${pf()} .preview-setup-card`).innerText()).replace(/\s+/g, " "),
      });
    });

    /* ---------- running frame: PF1, PF2 ---------- */
    await configure(["python3", "-m", "http.server", String(port), "--bind", "127.0.0.1"], url);
    await page.locator(`${pf()} [data-act=retry]`).click();
    await page.locator(`${pf()} .pf-head[data-state=running]`).waitFor({ timeout: 20000 });
    for (let i = 0; i < 50 && !app_()?.url().startsWith("http"); i++) await wait(100);
    await app_().waitForSelector("h1", { timeout: 15000 });
    await wait(600);
    await select();
    await frameView();
    await step("PF1/PF2", async () => {
      await away();
      await shot("PF1-selected");
      await shot("PF2-toolbar", {
        controls: await page
          .locator(`${pf()} .pf-bar`)
          .locator("button:visible, input:visible")
          .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") || el.textContent)),
      });
      for (const part of ["back", "forward", "reload", "path", "publish", "stop", "expand"]) {
        const target = page.locator(`${pf()} [data-pf=${part === "stop" ? "toggle" : part}]`);
        await tip(target);
        await shot(`PF2-${part}-hover`, {
          tooltip: await page
            .locator(".pf-tooltip:not([hidden])")
            .textContent()
            .catch(() => null),
        });
      }
      await away();
      await page.locator("#live-url").click();
      await wait(300);
      await shot("PF2-path", { value: await page.locator("#live-url").inputValue() });
      await esc();
      await page.evaluate(() => document.activeElement?.blur?.());
    });

    /* ---------- PM1 modes, X4 more actions ---------- */
    await select();
    await frameView();
    await step("PM1/X4", async () => {
      for (const [sel, name] of [
        ["#preview-navigate", "navigate"],
        ["#preview-edit", "edit"],
        ["#live-capture", "capture"],
      ]) {
        await tip(page.locator(sel));
        await shot(`PM1-${name}-hover`, {
          tooltip: await page
            .locator("[data-pe=preview-mode-tip], [role=tooltip]")
            .first()
            .innerText()
            .catch(() => null),
        });
      }
      await away();
      await page.locator("#preview-more").click();
      await wait(300);
      await shot("X4-more-actions", { items: await menuItems() });
      await esc();
    });

    /* ---------- PM2 Navigate: counter, typing, /about link ---------- */
    await step("PM2", async () => {
      await page.locator("#preview-navigate").click();
      await wait(200);
      await away();
      await shot("PM2-navigate", {
        mode: await page.evaluate(() => window.livePreview.getSelectionState()?.mode),
      });
      const count = await inApp("button");
      await page.mouse.click(count.x, count.y);
      await wait(200);
      const input = await inApp("input");
      await page.mouse.click(input.x, input.y);
      await page.keyboard.type("Sunbird");
      await wait(300);
      await away();
      await shot("PM2-typed", {
        count: await app_().evaluate(() => document.querySelector("button").textContent),
        input: await app_().evaluate(() => document.querySelector("input").value),
      });
      const link = await inApp("a", 8);
      await page.mouse.click(link.x, link.y);
      await page.waitForFunction(
        () => /\/about\/?$/.test(document.getElementById("live-url").value),
        null,
        { timeout: 8000 },
      );
      await wait(600);
      await away();
      await shot("PM2-about", { path: await page.locator("#live-url").inputValue() });
      await page.locator(`${pf()} [data-pf=back]`).click();
      await page.waitForFunction(() => document.getElementById("live-url").value === "/", null, {
        timeout: 8000,
      });
      await wait(500);
    });

    /* ---------- PF3 expand → preview tab ---------- */
    await page.evaluate(() => window.design.setSelection([]));
    await select();
    await frameView();
    await step("PF3", async () => {
      await page.locator(`${pf()} [data-pf=expand]`).click();
      await page.locator(`[data-preview-tab="${id}"]`).waitFor({ timeout: 8000 });
      await page.waitForFunction(
        () => document.querySelector("iframe[name=verynize-preview-tab]")?.src,
      );
      await wait(1500);
      await away();
      await shot("PF3-expanded", {
        tab: (await page.locator(`[data-preview-tab="${id}"]`).innerText()).replace(/\s+/g, " "),
      });
      metrics.seams.expandOpensTab = true;
      await page.locator('#preview-tab-view [aria-label="Show on canvas"]').click();
      await wait(600);
    });

    /* ---------- PF4 screen templates, PF5 context menu, X3 terminal, PF6 inspector, PP1 publish ---------- */
    await select();
    await frameView();
    await step("PF4", async () => {
      await page.locator("#screen-template").click();
      await page.locator("#screen-template-menu").waitFor();
      await wait(300);
      await away();
      await shot("PF4-presets", {
        items: await page.locator("#screen-template-menu [data-preset]").allTextContents(),
      });
      await page.locator('#screen-template-menu [data-preset="iPhone 17"]').click();
      await page.locator("#screen-template-menu").waitFor({ state: "detached" });
      await wait(900);
      metrics.seams.phoneViewport = await app_().evaluate(() => [innerWidth, innerHeight]);
      await page.locator("#screen-template").click();
      await page.locator(`#screen-template-menu [data-preset='MacBook Pro 14"']`).click();
      await page.locator("#screen-template-menu").waitFor({ state: "detached" });
      await wait(900);
    });
    await select();
    await frameView();
    await step("PF5/X3", async () => {
      await page.evaluate(() => window.livePreview.setMode?.("select"));
      const box = await page.locator("#live-frame").boundingBox();
      await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.4, {
        button: "right",
      });
      const menu = page.locator("#canvas-menu[data-target=preview]");
      await menu.waitFor();
      await wait(300);
      await shot("PF5-context", { items: await menuItems() });
      await menu.getByRole("menuitem", { name: "Show terminal" }).click();
      await page.locator(`${pf()} .pf-terminal`).waitFor({ timeout: 5000 });
      metrics.seams.contextMenuShowsTerminal = true;
      await page
        .waitForFunction(
          (id) =>
            /Serving HTTP|GET/.test(
              document.querySelector(`[data-id="${id}"] .pf-term-log`)?.textContent || "",
            ),
          id,
          { timeout: 5000 },
        )
        .catch(() => {});
      await away();
      await shot("X3-terminal", {
        text: (await page.locator(`${pf()} .pf-terminal`).innerText())
          .replace(/\s+/g, " ")
          .slice(0, 300),
      });
      await page.evaluate((id) => window.livePreview.hideTerminal(id), id);
    });
    await select();
    await frameView();
    await step("PF6", async () => {
      await away();
      await shot("PF6-inspector", {
        inspector: (await page.locator("#properties").innerText())
          .replace(/\s+/g, " ")
          .slice(0, 400),
      });
    });
    await step("PP1", async () => {
      await page.locator(`${pf()} [data-pf=publish]`).click();
      await page.locator("#preview-publish").waitFor();
      await wait(300);
      await away();
      await shot("PP1-publish", {
        text: (await page.locator("#preview-publish").innerText()).replace(/\s+/g, " "),
      });
      await esc();
    });

    /* ---------- header while running: X5 menu, PS2-edit settings, Open in a tab, ⌘⌥P ---------- */
    await page.evaluate(() => window.agentWorkspace.openChat());
    await page.locator("#chat-start-preview").waitFor();
    await wait(400);
    await step("X5", async () => {
      await page.locator("#chat-preview-menu").click();
      await wait(300);
      await away();
      await shot("X5-running-menu", {
        items: await menuItems(),
        label: await page.locator("#chat-start-preview").innerText(),
      });
      await page.locator("#chat-preview-tab").click();
      await page.waitForFunction(
        (id) => document.querySelector(`[data-preview-tab="${id}"] button[aria-current=page]`),
        id,
        { timeout: 5000 },
      );
      metrics.seams.headerOpenInTab = true;
      await page.locator('#preview-tab-view [aria-label="Show on canvas"]').click();
      await wait(400);
      await page.evaluate(() => window.previewTab.close?.(window.design.getSelection()[0]));
      await page
        .locator(`[data-preview-tab="${id}"]`)
        .waitFor({ state: "detached", timeout: 3000 })
        .catch(() => {});
      await select();
      await page.locator("#canvas-wrap").hover();
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.keyboard.press("Meta+Alt+KeyP");
      await page.locator(`[data-preview-tab="${id}"]`).waitFor({ timeout: 5000 });
      metrics.seams.cmdAltPOpensTab = true;
      await page.locator('#preview-tab-view [aria-label="Show on canvas"]').click();
      await wait(400);
    });
    await step("PS2-edit", async () => {
      await page.locator("#chat-preview-menu").click();
      await page.locator("#chat-configure-preview").click();
      await page.locator("#preview-settings").waitFor();
      await page.waitForFunction(() => !!document.querySelector("#preview-run-command")?.value);
      await wait(300);
      await away();
      await shot("PS2-edit", { run: await page.locator("#preview-run-command").inputValue() });
      await esc();
      await page.locator("#preview-settings").waitFor({ state: "hidden" });
    });

    /* ---------- PS6 Code workspace ---------- */
    await step("PS6", async () => {
      await page.evaluate(() => window.agentWorkspace.setCodeMode(true));
      await page.locator("#preview-running-card").waitFor();
      await wait(500);
      await away();
      await shot("PS6-code", { label: await page.locator("#code-start-preview").innerText() });
      await page
        .locator("#preview-running-card")
        .getByRole("button", { name: "Show preview" })
        .click();
      await page.waitForFunction(() => !document.body.classList.contains("code-mode"));
      await page.evaluate(() => window.agentWorkspace.closeChat());
      await wait(300);
      await frameView();
      await away();
      await shot("PS6-show-preview", {
        selected: await page.evaluate(() => window.design.getSelection()),
      });
    });

    /* ---------- PM3 Edit, X2 changes, PM5 add to chat, PM4 capture ---------- */
    await page.evaluate(() => window.agentWorkspace.closeChat());
    await select();
    await frameView();
    let h1;
    await step("PM3", async () => {
      await page.locator("#preview-edit").click();
      await wait(200);
      h1 = await inApp("h1");
      await page.mouse.move(h1.x, h1.y);
      await page.waitForFunction(() => window.previewEdits.hovered()?.tag === "h1");
      await shot("PM3-hover");
      await page.mouse.click(h1.x, h1.y);
      await page.locator("#preview-element-inspector").waitFor();
      await page.locator("#live-preview .pedit-chat").hover();
      await wait(600);
      await shot("PM3-select", {
        badge: await page.locator("#live-preview .pedit-badge").textContent(),
      });
      const word = await app_().evaluate(() => {
        const n = document.querySelector("h1").firstChild,
          r = document.createRange(),
          i = n.textContent.indexOf("preview");
        r.setStart(n, i + 2);
        r.setEnd(n, i + 3);
        const b = r.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      });
      const box = await page.locator("#live-frame").boundingBox(),
        scale = await page
          .locator("#live-frame")
          .evaluate((el) => el.getBoundingClientRect().width / el.clientWidth);
      await page.mouse.dblclick(box.x + word.x * scale, box.y + word.y * scale);
      await app_().waitForFunction(() => getSelection().toString() === "preview");
      // Wonder PM3-inspector: the word "preview" selected for direct editing, the element inspector alongside.
      await shot("PM3-inspector", {
        inspector: (await page.locator("#properties").innerText())
          .replace(/\s+/g, " ")
          .slice(0, 500),
      });
      await page.keyboard.type("edited");
      await page.keyboard.press("Escape");
      await page.waitForFunction((id) => window.previewEdits.count(id) === 1, id);
      await page.mouse.click(1000, 790);
      await wait(300);
      await select();
      await away();
      await shot("PM3-edited", {
        title: await app_().evaluate(() => document.querySelector("h1").textContent),
      });
    });
    await step("X2", async () => {
      await page.locator("#live-preview [data-pe=preview-changes-badge]").click();
      await page.locator("#preview-changes").waitFor();
      await wait(300);
      await away();
      await shot("X2-changes", {
        text: (await page.locator("#preview-changes").innerText()).replace(/\s+/g, " "),
      });
      await esc();
    });
    // PF4-resize is shot here, with the staged edit's "1 change" badge, as in Wonder (its breadcrumb truncates to fit).
    await step("PF4-resize", async () => {
      await select();
      await frameView();
      await page.locator("#screen-template").click();
      await page.locator("#screen-template-menu").waitFor();
      await page.locator('#screen-template-menu [data-preset="iPhone 17"]').click();
      await page.locator("#screen-template-menu").waitFor({ state: "detached" });
      await wait(900);
      await away();
      await shot("PF4-resize", {
        viewport: await app_().evaluate(() => [innerWidth, innerHeight]),
        crumbTruncated: await page
          .locator(`${pf()} .pf-crumb-text`)
          .evaluate((el) => el.scrollWidth > el.clientWidth),
      });
      await page.locator("#screen-template").click();
      await page.locator(`#screen-template-menu [data-preset='MacBook Pro 14"']`).click();
      await page.locator("#screen-template-menu").waitFor({ state: "detached" });
      await wait(900);
    });
    await step("PM5", async () => {
      await select();
      if (!(await page.locator("#preview-edit[aria-pressed=true]").count()))
        await page.locator("#preview-edit").click();
      await page.mouse.click(h1.x, h1.y);
      await page.locator("#live-preview .pedit-picked").waitFor();
      await page.keyboard.press("Meta+L");
      await page.waitForFunction(
        () => (window.agentWorkspace.getState().mentions || []).some((m) => m.type === "element"),
        null,
        { timeout: 5000 },
      );
      await wait(600);
      await away(1100, 600);
      await shot("PM5-context", {
        mentions: await page.evaluate(() =>
          window.agentWorkspace.getState().mentions.map((m) => m.label),
        ),
      });
      await page.evaluate(() => window.agentWorkspace.closeChat());
      await wait(300);
    });
    await step("PM4", async () => {
      await select();
      await frameView();
      await page.locator("#live-capture").click();
      await page.mouse.move(h1.x, h1.y);
      await page.waitForFunction(() => window.previewEdits.target()?.tag === "h1");
      await shot("PM4-capture");
      await page.mouse.click(h1.x, h1.y);
      await page.waitForFunction(
        () => {
          const sel = window.design.getSelection();
          return (
            sel.length === 1 &&
            window.design
              .getDocument()
              .pages.some((p) => p.nodes.some((n) => n.id === sel[0] && n.type === "text"))
          );
        },
        null,
        { timeout: 15000 },
      );
      await wait(800);
      await away();
      const placed = await page.evaluate((id) => {
        const nodes = window.design.getDocument().pages.flatMap((p) => p.nodes),
          f = nodes.find((n) => n.id === id),
          t = nodes.find((n) => n.id === window.design.getSelection()[0]);
        return { frame: [f.x, f.y, f.w], text: [t.x, t.y, t.w, t.h, t.name, t.text] };
      }, id);
      metrics.seams.capturePlacement = {
        ...placed,
        gap: placed.text[0] - (placed.frame[0] + placed.frame[2]),
        topAligned: placed.text[1] === placed.frame[1],
      };
      await shot("PM4-result", placed);
    });

    /* ---------- PP2 stop with a staged edit (frame Stop and header Stop), PS5 paused ---------- */
    await page.evaluate(() => window.livePreview.setMode?.("select"));
    await select();
    await frameView();
    await step("PP2/PS5", async () => {
      if (!(await page.evaluate((id) => window.previewEdits.count(id), id)))
        throw Error("no staged edit to discard");
      await page.locator(`${pf()} [data-pf=toggle]`).click();
      await page.locator("#preview-discard-dialog").waitFor({ timeout: 5000 });
      metrics.seams.frameStopAsks = (
        await page.locator("#preview-discard-dialog").innerText()
      ).replace(/\s+/g, " ");
      await away();
      await shot("PP2-stopped");
      await page.locator("#preview-discard-keep").click();
      await page.locator("#preview-discard-dialog").waitFor({ state: "hidden" });
      metrics.seams.keepEditingKeepsRunning = (await status()).state;
      await page.evaluate(() => window.agentWorkspace.openChat());
      await page.locator("#chat-start-preview").click();
      await page.locator("#preview-discard-dialog").waitFor({ timeout: 5000 });
      metrics.seams.headerStopAsks = (
        await page.locator("#preview-discard-dialog").innerText()
      ).replace(/\s+/g, " ");
      await page.locator("#preview-discard-confirm").click();
      await page.locator(`${pf()} .pf-card[data-kind=paused]`).waitFor({ timeout: 15000 });
      await page.evaluate(() => window.agentWorkspace.closeChat());
      await select();
      await frameView();
      await away();
      await shot("PS5-paused", {
        card: (await page.locator(`${pf()} .preview-setup-card`).innerText()).replace(/\s+/g, " "),
        server: (await status()).state,
      });
    });
  } finally {
    metrics.pageErrors = errors;
    await fs.writeFile(path.join(OUT, "metrics.json"), JSON.stringify(metrics, null, 1) + "\n");
    if (root && page)
      await page.evaluate((root) => window.desktop.devServer.stop({ root }), root).catch(() => {});
    await app.close().catch(() => {});
    if (!KEEP) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    else console.log("profile kept at", tmp);
    console.log(
      metrics.failures.length ? `${metrics.failures.length} step(s) failed` : "all steps passed",
    );
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
