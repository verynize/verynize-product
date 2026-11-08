// Verynize side of the preview parity audit (design/wonder/preview-audit/CHECKLIST.md).
// Drives the real Electron app with Playwright `_electron` (temp --user-data-dir, 1440×870 content, device scale
// factor 2, sRGB), adds the sandbox repository (/tmp/preview-sandbox-vz, a plain index.html site served by the
// supported Python fallback) through the Code workspace, and walks every checklist id reachable in Verynize.
// Each step saves <id>-<state>.png next to this file and records DOM metrics (rects, computed colours/fonts, text,
// open menus and their items) into metrics.json; notes.md is written from those.
//
//   npm run build:ui
//   node design/wonder/preview-audit/verynize/capture.cjs [--keep] [id-prefix ...]
//
// id-prefix args only filter which PNGs are written (the flow itself always runs, since later states depend on
// earlier ones). --keep leaves the temp profile on disk. Nothing is mocked except the agent: a deterministic fake
// `codex` (tests/fixtures/fake-codex.cjs) answers the "Set up the Preview" chat turn, and the agent's proposal is
// delivered through the real MCP bridge tool `propose_preview`, exactly as tests/code-workspace.cjs does.
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const { _electron } = require(ROOT + "/node_modules/@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");

const OUT = __dirname;
const SANDBOX = "/tmp/preview-sandbox-vz";
const PORT = 5199;
const KEEP = process.argv.includes("--keep");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const want = (file) => !only.length || only.some((p) => file.startsWith(p));
const identity = {
  GIT_AUTHOR_NAME: "Audit",
  GIT_AUTHOR_EMAIL: "audit@example.invalid",
  GIT_COMMITTER_NAME: "Audit",
  GIT_COMMITTER_EMAIL: "audit@example.invalid",
};

async function ensureSandbox() {
  try {
    await fs.access(path.join(SANDBOX, ".git"));
    return;
  } catch {}
  throw new Error(`Sandbox ${SANDBOX} is missing. Create it first (see notes.md, "Sandbox").`);
}

(async () => {
  await ensureSandbox();
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "vz-preview-audit-")));
  const profile = path.join(tmp, "profile"),
    bin = path.join(tmp, "bin"),
    workspaces = path.join(tmp, "workspaces");
  await fs.mkdir(bin, { recursive: true });
  await fs.copyFile(path.join(ROOT, "tests/fixtures/fake-codex.cjs"), path.join(bin, "codex"));
  await fs.chmod(path.join(bin, "codex"), 0o755);
  const env = {
    ...process.env,
    ...identity,
    PATH: bin + path.delimiter + process.env.PATH,
    FAKE_CODEX_LOG: path.join(tmp, "codex.log"),
    VERYNIZE_WORKSPACES_DIR: workspaces,
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
  const metrics = {};
  const errors = [];
  const log = (...a) => console.log("·", ...a);
  let blocker = null;
  try {
    const page = await app.firstWindow({ timeout: 30000 });
    page.on("pageerror", (e) => errors.push(e.message));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 870),
    );
    await page.waitForSelector("#canvas", { state: "attached" });
    await page.waitForFunction(() => !!window.livePreview && !!window.agentWorkspace);
    await page.waitForTimeout(600);

    /* ---------- helpers ---------- */
    const wait = (ms) => page.waitForTimeout(ms);
    const away = async () => {
      await page.mouse.move(1435, 450);
      await wait(150);
    };
    const esc = async () => {
      await page.keyboard.press("Escape");
      await wait(200);
    };
    const ws = () => page.evaluate(() => window.agentWorkspace.getState());
    /** DOM facts for the selectors given (first match each) plus every open menu / dialog / tooltip. */
    const measure = (selectors) =>
      page.evaluate((selectors) => {
        const vis = (el) => {
          if (!el || el.hidden) return false;
          const r = el.getBoundingClientRect(),
            cs = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
        };
        const r2 = (v) => Math.round(v * 100) / 100;
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          return { x: r2(r.left), y: r2(r.top), w: r2(r.width), h: r2(r.height) };
        };
        const text = (el) =>
          (el?.innerText || el?.value || el?.textContent || "").replace(/\s+/g, " ").trim();
        const style = (el) => {
          const s = getComputedStyle(el);
          return {
            bg: s.backgroundColor,
            color: s.color,
            border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
            radius: s.borderTopLeftRadius,
            padding: s.padding,
            font: `${s.fontWeight} ${s.fontSize}/${s.lineHeight} ${s.fontFamily.split(",")[0]}`,
            shadow: s.boxShadow === "none" ? undefined : s.boxShadow,
            opacity: s.opacity === "1" ? undefined : s.opacity,
          };
        };
        const out = { elements: {}, menus: [] };
        for (const [name, sel] of Object.entries(selectors || {})) {
          const el = document.querySelector(sel);
          if (!el) {
            out.elements[name] = null;
            continue;
          }
          out.elements[name] = {
            sel,
            visible: vis(el),
            text: text(el).slice(0, 400),
            ...rect(el),
            style: style(el),
            aria: el.getAttribute("aria-label") || undefined,
            title: el.getAttribute("title") || undefined,
            pressed: el.getAttribute("aria-pressed") || undefined,
            disabled:
              el.disabled ||
              el.getAttribute("aria-disabled") === "true" ||
              el.dataset?.disabled !== undefined ||
              undefined,
          };
        }
        const seen = new Set();
        for (const m of document.querySelectorAll(
          "[role=menu],[role=dialog],dialog[open],[role=tooltip],[data-radix-popper-content-wrapper] > *",
        )) {
          if (seen.has(m) || !vis(m)) continue;
          seen.add(m);
          const items = [];
          for (const i of m.querySelectorAll(
            "[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=separator],input,button,label,h2,h3,p,code",
          )) {
            if (!vis(i)) continue;
            if (i.getAttribute("role") === "separator") {
              items.push({ separator: true });
              continue;
            }
            items.push({
              tag: i.tagName.toLowerCase(),
              role: i.getAttribute("role") || undefined,
              text:
                text(i).slice(0, 200) ||
                i.getAttribute("aria-label") ||
                i.getAttribute("placeholder") ||
                "",
              disabled: i.disabled || i.dataset.disabled !== undefined || undefined,
              checked: i.getAttribute("aria-checked") || undefined,
              ...rect(i),
            });
          }
          out.menus.push({
            id: m.id || undefined,
            role: m.getAttribute("role") || m.tagName.toLowerCase(),
            ...rect(m),
            style: style(m),
            text: text(m).slice(0, 900),
            items,
          });
        }
        return out;
      }, selectors);
    const FRAME = {
      frame: ".canvas-preview",
      breadcrumb: ".canvas-preview .preview-breadcrumb",
      breadcrumbText: ".canvas-preview [data-part=breadcrumb]",
      local: ".canvas-preview .preview-local",
      bar: ".canvas-preview .live-preview-bar",
      back: ".canvas-preview [data-part=back]",
      forward: ".canvas-preview [data-part=forward]",
      reload: ".canvas-preview [data-part=live-reload]",
      stateText: ".canvas-preview [data-part=state]",
      path: ".canvas-preview [data-part=live-url]",
      toggle: ".canvas-preview [data-part=toggle]",
      pick: ".canvas-preview [data-part=live-pick]",
      expand: ".canvas-preview [data-part=live-expand]",
      card: ".canvas-preview .preview-setup-card",
      cardTitle: ".canvas-preview [data-part=title]",
      cardProject: ".canvas-preview [data-part=project]",
      cardMessage: ".canvas-preview [data-part=message]",
      cardStart: ".canvas-preview [data-part=start]",
      iframe: "#live-frame",
      toolbar: "#preview-toolbar",
      navigate: "#preview-navigate",
      edit: "#preview-edit",
      capture: "#live-capture",
      more: "#preview-more",
      selectionName: "#selection-name",
      selectionMeasure: "#selection-measure",
      headerStart: "#chat-start-preview",
      headerMenu: "#chat-preview-menu",
    };
    async function snap(file, selectors = FRAME, extra = {}) {
      const fact = { ...(await measure(selectors)), ...extra };
      fact.preview = await page.evaluate(() => window.livePreview.getSelectionState?.() || null);
      fact.nodes = await page.evaluate(() =>
        window.design.getDocument().pages.flatMap((p) =>
          p.nodes
            .filter((n) => !n.parentId)
            .map((n) => ({
              id: n.id,
              name: n.name,
              type: n.type,
              x: Math.round(n.x),
              y: Math.round(n.y),
              w: Math.round(n.w),
              h: Math.round(n.h),
              preview: n.preview,
            })),
        ),
      );
      fact.camera = await page.evaluate(() => window.design.getCamera());
      metrics[file] = fact;
      if (want(file)) {
        await page.screenshot({ path: path.join(OUT, file) });
        log("saved", file);
      }
    }
    const frameEl = () => page.frames().find((f) => f.name() === "verynize-live-preview");
    /** Editor-page point for a selector inside the running app (accounts for canvas zoom). */
    async function appPoint(selector, fx = 0.5, fy = 0.5) {
      const f = frameEl();
      const inner = await f.evaluate(
        ([s, fx, fy]) => {
          const r = document.querySelector(s).getBoundingClientRect();
          return { x: r.left + r.width * fx, y: r.top + r.height * fy };
        },
        [selector, fx, fy],
      );
      const outer = await page.locator("#live-frame").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, s: r.width / el.clientWidth };
      });
      return { x: outer.x + inner.x * outer.s, y: outer.y + inner.y * outer.s };
    }
    const previewId = () => page.evaluate(() => window.livePreview.getNodeId());
    const select = (id) => page.evaluate((id) => window.design.setSelection(id ? [id] : []), id);
    const focusFrame = (id, pad = 1) =>
      page.evaluate(
        ([id, pad]) => {
          const n = window.design
            .getDocument()
            .pages.flatMap((p) => p.nodes)
            .find((x) => x.id === id);
          const r = document.getElementById("canvas-wrap").getBoundingClientRect();
          const zoom = Math.min((r.width - 160) / n.w, (r.height - 220) / n.h, 1) * pad;
          window.design.setCamera((r.width - n.w * zoom) / 2 - n.x * zoom, 70 - n.y * zoom, zoom);
        },
        [id, pad],
      );
    /** Zoom 100%: put the frame point (fx, fy) at canvas-wrap point (px, py); px/py < 0 count from the right/bottom. */
    const zoomOn = (id, fx, fy, px, py) =>
      page.evaluate(
        ([id, fx, fy, px, py]) => {
          const n = window.design
            .getDocument()
            .pages.flatMap((p) => p.nodes)
            .find((x) => x.id === id);
          const r = document.getElementById("canvas-wrap").getBoundingClientRect();
          // Visible part of the canvas: the chat dock and the properties panel overlap #canvas-wrap.
          const dock = document.body.classList.contains("agent-chat-open")
            ? document.getElementById("agent-chat-dock")?.getBoundingClientRect()
            : null;
          const props = document.getElementById("properties")?.getBoundingClientRect();
          const left = Math.max(r.left, dock && dock.width ? dock.right : r.left) - r.left,
            right = Math.min(r.right, props && props.width ? props.left : r.right) - r.left;
          const sx = px === "c" ? (left + right) / 2 : px < 0 ? right + px : left + px,
            sy = py === "c" ? r.height / 2 : py < 0 ? r.height + py : py;
          window.design.setCamera(sx - (n.x + fx * n.w), sy - (n.y + fy * n.h), 1);
        },
        [id, fx, fy, px, py],
      );

    /* ---------- 0. add the sandbox repository through the Code workspace ---------- */
    await page.getByRole("radio", { name: "Code" }).click();
    await page.locator("#code-workspace").waitFor();
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, SANDBOX);
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
    const repo = await ws();
    log("repository", repo.projectName, repo.activeRoot, repo.branch);
    await page.evaluate(() =>
      window.agentWorkspace.setDefaults({ agent: "codex", access: "edit" }),
    );

    /* ---------- PS6 Code workspace Start preview (before any config) ---------- */
    await away();
    await snap("PS6-code.png", {
      ...FRAME,
      codeStart: "#code-start-preview",
      codeMenu: "#code-preview-menu",
      codeToolbar: "#code-start-preview",
    });
    await page.locator("#code-preview-menu").click();
    await wait(300);
    await snap("PS6-code-menu.png", { codeStart: "#code-start-preview" });
    await esc();

    /* ---------- PS1 chat header split button (Design mode, chat dock open) ---------- */
    await page.evaluate(() => {
      window.agentWorkspace.setCodeMode(false);
      window.agentWorkspace.openChat();
    });
    await page.locator("#chat-start-preview").waitFor();
    await wait(400);
    await away();
    await snap("PS1-idle.png");
    await page.locator("#chat-start-preview").hover();
    await wait(1200);
    await snap("PS1-hover.png");
    await page.locator("#chat-preview-menu").hover();
    await wait(1200);
    await snap("PS1-arrow-hover.png");
    await page.locator("#chat-preview-menu").click();
    await wait(300);
    await snap("PS1-menu.png");
    await esc();

    /* ---------- PS2 first start with no saved config ---------- */
    await page.locator("#chat-start-preview").click();
    await page
      .waitForFunction(
        () =>
          window.agentWorkspace.getUsage?.().completed >= 1 ||
          /Set up the Preview/.test(document.querySelector("#agent-chat-dock")?.innerText || ""),
        null,
        { timeout: 15000 },
      )
      .catch(() => {});
    await wait(2500);
    await away();
    await snap("PS2-first-start.png", { ...FRAME, dock: "#agent-chat-dock" });
    // Manual configuration dialog (Verynize-only alternative to the agent card).
    await page.locator("#chat-preview-menu").click();
    await page.locator("#chat-configure-preview").click();
    await page.locator("#preview-run-command").waitFor();
    await wait(300);
    await snap("PS2-config-dialog.png", {
      run: "#preview-run-command",
      setup: "#preview-setup-command",
      port: "#preview-port",
    });
    await esc();
    await page.locator("#preview-run-command").waitFor({ state: "hidden" });

    // The agent's proposal, delivered through the real MCP bridge tool (what the fake codex cannot do).
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } =
      await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const bridge = JSON.parse(await fs.readFile(path.join(profile, "mcp.json"), "utf8"));
    const mcp = new Client({ name: "preview-audit", version: "1" });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(bridge.url), {
        requestInit: {
          headers: { Authorization: `Bearer ${bridge.token}`, "x-verynize-access": "full" },
        },
      }),
    );
    const setupCmd = ["python3", "-u", "scripts/setup.py"];
    const runCmd = ["python3", "-u", "-m", "http.server", String(PORT), "--bind", "127.0.0.1"];
    const proposed = await mcp.callTool({
      name: "propose_preview",
      arguments: {
        command: runCmd,
        setup: setupCmd,
        port: PORT,
        chatId: (await ws()).conversationId,
        name: "Preview Sandbox",
      },
    });
    if (proposed.isError) throw Error("propose_preview failed: " + JSON.stringify(proposed));
    await page.locator("#preview-proposal").waitFor({ timeout: 10000 });
    await wait(400);
    await away();
    const CARD = {
      card: "#preview-proposal",
      heading: "#preview-proposal h3",
      sub: "#preview-proposal p",
      rows: "#preview-proposal label",
      code: "#preview-proposal code",
      editBtn: "#preview-proposal .justify-end button:first-child",
      saveBtn: "#preview-proposal .justify-end button:last-child",
      dismiss: "#preview-proposal [aria-label='Dismiss preview proposal']",
      headerStart: "#chat-start-preview",
    };
    await snap("PS2-card.png", CARD);
    await page
      .locator("#preview-proposal")
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await wait(300);
    await snap("PS2-edit.png", { ...CARD, input: "#preview-proposal input" });
    await page
      .locator("#preview-proposal")
      .getByRole("button", { name: "Done", exact: true })
      .click();

    /* ---------- PS3 startup: setup logs, then the server ---------- */
    await page
      .locator("#preview-proposal")
      .getByRole("button", { name: "Save & start preview", exact: true })
      .click();
    await page.locator(".canvas-preview").waitFor({ timeout: 10000 });
    await wait(500);
    await page.evaluate(() => window.design.setSelection([]));
    let id = await previewId();
    await focusFrame(id);
    await away();
    await snap("PS3-starting.png", { ...FRAME, ...CARD });
    await zoomOn(id, 0.5, 0.5, "c", "c");
    await wait(150);
    await snap("PS3-starting-100.png", { ...FRAME, ...CARD });
    await wait(2600);
    await snap("PS3-logs-100.png", { ...FRAME, ...CARD });
    await focusFrame(id);
    await wait(150);
    await snap("PS3-logs.png", { ...FRAME, ...CARD });
    await page.waitForFunction(
      () => document.querySelector(".canvas-preview")?.dataset.previewState === "running",
      null,
      { timeout: 30000 },
    );
    await page.waitForFunction(() => !!document.querySelector("#live-frame")?.getAttribute("src"));
    await frameEl().waitForSelector("#counter", { timeout: 15000 });
    await wait(800);

    /* ---------- PF1 running frame ---------- */
    id = await previewId();
    await select(null);
    await focusFrame(id);
    await away();
    await snap("PF1-running.png", { ...FRAME, ...CARD });
    await select(id);
    await wait(300);
    await away();
    await snap("PF1-selected.png", { ...FRAME, handles: ".canvas-preview > .handle" });

    /* ---------- PM5 add the preview frame to chat context (⌘L) ---------- */
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Meta+L");
    await wait(500);
    await away();
    await snap(
      "PM5-context.png",
      { ...FRAME, composer: "#project-prompt", composerBox: "#agent-chat-dock form" },
      {
        composerText: await page.evaluate(() =>
          (
            document.querySelector("#project-prompt")?.closest("form, section, div")?.parentElement
              ?.innerText || ""
          ).slice(0, 300),
        ),
        contextAfterCmdL: await page.evaluate(() =>
          [...document.querySelectorAll("#agent-chat-dock button, #agent-chat-dock [data-slot]")]
            .filter((e) => /Preview Sandbox/.test(e.innerText || ""))
            .map((e) => ({
              text: e.innerText.trim(),
              ...(({ x, y, width, height }) => ({ x, y, w: width, h: height }))(
                e.getBoundingClientRect(),
              ),
            })),
        ),
      },
    );

    /* ---------- PF2 frame toolbar and hover per control ---------- */
    // At fit zoom the in-frame toolbar is ~6 px text, so the toolbar is shown at 100% zoom: left end, then right end.
    const barCrop = async () => {
      const b = await page.locator(".canvas-preview .live-preview-bar").boundingBox(),
        w = await page.locator("#canvas-wrap").boundingBox();
      const x0 = Math.max(w.x, b.x - 8),
        x1 = Math.min(w.x + w.width, b.x + b.width + 8);
      return {
        x: Math.round(x0),
        y: Math.round(b.y - 36),
        width: Math.round(x1 - x0),
        height: Math.round(b.height + 44),
      };
    };
    const cropShot = async (file, clip) => {
      metrics[file] = { crop: clip, ...(await measure(FRAME)) };
      if (want(file)) {
        await page.screenshot({ path: path.join(OUT, file), clip });
        log("saved", file, "crop", JSON.stringify(clip));
      }
    };
    await snap("PF2-toolbar.png");
    await zoomOn(id, 0, 0, 40, 90);
    await wait(250);
    await away();
    await cropShot("PF2-toolbar-left.png", await barCrop());
    for (const [part, name] of [
      ["back", "back"],
      ["forward", "forward"],
      ["live-reload", "reload"],
      ["live-url", "path"],
    ]) {
      await page.locator(`.canvas-preview [data-part=${part}]`).hover();
      await wait(1300);
      await snap(`PF2-${name}-hover.png`);
    }
    await zoomOn(id, 1, 0, -40, 90);
    await wait(250);
    await away();
    await cropShot("PF2-toolbar-right.png", await barCrop());
    for (const [part, name] of [
      ["toggle", "stop"],
      ["live-pick", "pick"],
      ["live-expand", "expand"],
    ]) {
      await page.locator(`.canvas-preview [data-part=${part}]`).hover();
      await wait(1300);
      await snap(`PF2-${name}-hover.png`);
    }
    await zoomOn(id, 0, 0, 40, 90);
    await wait(250);
    // Path field: click, type a path, Enter.
    await page.locator(".canvas-preview [data-part=live-url]").click();
    await wait(200);
    await snap("PF2-path-focus.png");
    await page.locator(".canvas-preview [data-part=live-url]").fill("/about/");
    await page.keyboard.press("Enter");
    await frameEl()
      .waitForFunction(() => location.pathname === "/about/", null, { timeout: 8000 })
      .catch(() => {});
    await wait(700);
    await away();
    await snap("PF2-path-typed.png");
    // Focusing the in-canvas path input lets Chromium scroll an overflow ancestor to reveal it; record and undo that.
    metrics["PF2-path-typed.png"].scrolledAncestors = await page.evaluate(() => {
      const out = [];
      for (
        let el = document.querySelector(".canvas-preview [data-part=live-url]");
        el;
        el = el.parentElement
      )
        if (el.scrollLeft || el.scrollTop) {
          out.push({ el: el.id || el.className, left: el.scrollLeft, top: el.scrollTop });
          el.scrollLeft = 0;
          el.scrollTop = 0;
        }
      return out;
    });
    await zoomOn(id, 0, 0, 40, 90);
    await wait(250);
    await page.locator(".canvas-preview [data-part=back]").click();
    await wait(1200);
    await snap("PF2-back-result.png", FRAME, { appUrl: frameEl()?.url() });
    await page.locator(".canvas-preview [data-part=forward]").click();
    await wait(1200);
    await snap("PF2-forward-result.png", FRAME, { appUrl: frameEl()?.url() });
    await page.locator(".canvas-preview [data-part=live-url]").fill("/");
    await page.keyboard.press("Enter");
    await frameEl().waitForSelector("#counter", { timeout: 8000 });
    await wait(500);
    await focusFrame(id);

    /* ---------- PM1 contextual toolbar ---------- */
    await select(id);
    await away();
    await snap("PM1-toolbar.png");
    for (const [sel, name] of [
      ["#preview-navigate", "navigate"],
      ["#preview-edit", "edit"],
      ["#live-capture", "capture"],
      ["#preview-more", "more"],
    ]) {
      await page.locator(sel).hover();
      await wait(1300);
      await snap(`PM1-${name}-hover.png`);
    }
    await page.locator("#preview-more").click();
    await wait(300);
    await snap("PM1-more-menu.png");
    await page.locator("#preview-open-browser").hover();
    await wait(300);
    await snap("PP3-open.png");
    await esc();

    /* ---------- PM2 Navigate ---------- */
    await page.locator("#preview-navigate").click();
    await wait(200);
    for (let i = 0; i < 3; i++) {
      const p = await appPoint("#counter");
      await page.mouse.click(p.x, p.y);
      await wait(120);
    }
    await away();
    await snap("PM2-navigate.png", FRAME, {
      appCount: await frameEl().evaluate(() => document.getElementById("count").textContent),
    });
    {
      const p = await appPoint("#name");
      await page.mouse.click(p.x, p.y);
      await page.keyboard.type("Adam");
      await wait(300);
      await snap("PM2-typed.png", FRAME, {
        appEcho: await frameEl().evaluate(() => document.getElementById("echo").textContent),
        appFocus: await frameEl().evaluate(() => document.activeElement?.id),
      });
      const q = await appPoint("#hero");
      await page.mouse.move(q.x, q.y);
      await page.mouse.wheel(0, 400);
      await wait(600);
      await snap("PM2-scrolled.png", FRAME, {
        appScrollY: await frameEl().evaluate(() => scrollY),
      });
      await frameEl().evaluate(() => scrollTo(0, 0));
      await wait(200);
      const l = await appPoint("#about-link");
      await page.mouse.click(l.x, l.y);
      await frameEl()
        .waitForFunction(() => location.pathname === "/about/", null, { timeout: 8000 })
        .catch(() => {});
      await wait(700);
      await away();
      await snap("PM2-link.png", FRAME, { appUrl: frameEl()?.url() });
      await page.locator(".canvas-preview [data-part=back]").click();
      await frameEl().waitForSelector("#counter", { timeout: 8000 });
      await wait(500);
    }
    // Send all input to app (keyboard capture), then release with Cmd+Shift+Esc.
    await page.locator("#preview-more").click();
    await page.getByRole("menuitemcheckbox", { name: "Send all input to app" }).click();
    await page
      .waitForFunction(() => window.livePreview.getSelectionState()?.inputToApp === true, null, {
        timeout: 5000,
      })
      .catch(() => {});
    await wait(300);
    await page.locator("#preview-more").click();
    await wait(300);
    await snap("PM2-input-captured.png");
    await esc();
    await page.keyboard.press("Meta+Shift+Escape");
    await wait(300);

    /* ---------- PM3 Edit ---------- */
    // The selector form was replaced by the DOM Edit mode (web/preview-edit.js); its proof is capture-edit.cjs.
    if (await page.locator(".canvas-preview .preview-edit").count()) {
      await select(id);
      await page.locator("#preview-edit").click();
      await page.locator(".preview-edit:visible").waitFor();
      await wait(200);
      await away();
      const EDIT = {
        ...FRAME,
        form: ".canvas-preview .preview-edit",
        selector: ".canvas-preview .preview-edit [name=selector]",
        inspect: ".canvas-preview [data-part=inspect]",
        text: ".canvas-preview .preview-edit [name=text]",
        apply: ".canvas-preview .preview-edit [type=submit]",
        undo: ".canvas-preview [data-part=undo]",
        status: ".canvas-preview .preview-edit [role=status]",
      };
      await snap("PM3-edit.png", EDIT);
      {
        const p = await appPoint("#title");
        await page.mouse.move(p.x, p.y);
        await wait(500);
        await snap("PM3-hover.png", EDIT);
        await page.mouse.click(p.x, p.y);
        await wait(400);
        await snap("PM3-select.png", EDIT, {
          selectionAfterClick: await page.evaluate(() => window.design.getSelection()),
        });
      }
      await select(id);
      if (!(await page.locator(".preview-edit:visible").count())) {
        await page.locator("#preview-edit").click();
        await wait(200);
      }
      await page.locator(".canvas-preview .preview-edit [name=selector]").fill("#title");
      await page.locator(".canvas-preview [data-part=inspect]").click();
      await wait(500);
      await away();
      await snap("PM3-inspector.png", EDIT);
      await page.locator(".canvas-preview .preview-edit [name=text]").fill("Edited in Verynize");
      await page.locator(".canvas-preview .preview-edit [name=color]").fill("#d946ef");
      await page.locator(".canvas-preview .preview-edit [type=submit]").click();
      await wait(500);
      await away();
      await snap("PM3-edited.png", EDIT, {
        appTitle: await frameEl().evaluate(() => [
          document.getElementById("title").textContent,
          getComputedStyle(document.getElementById("title")).color,
        ]),
      });
      await page.locator(".canvas-preview [data-part=undo]").click();
      await wait(400);
      await snap("PM3-undone.png", EDIT, {
        appTitle: await frameEl().evaluate(() => [
          document.getElementById("title").textContent,
          getComputedStyle(document.getElementById("title")).color,
        ]),
      });
      // Source file untouched (edits are transient DOM changes).
      metrics["PM3-undone.png"].sourceUntouched = !(
        await fs.readFile(path.join(repo.activeRoot, "index.html"), "utf8")
      ).includes("Edited in Verynize");
    } else log("PM3: legacy edit form gone; run capture-edit.cjs for the Edit mode");

    /* ---------- PM4 Capture (whole viewport) and the region picker ---------- */
    await page.locator("#preview-navigate").click();
    await select(id);
    await wait(200);
    const before = await page.evaluate(
      () => window.design.getDocument().pages.flatMap((p) => p.nodes).length,
    );
    await page.locator("#live-capture").click();
    // Capture is a mode now: ⌘Return captures the whole viewport.
    if (await page.locator("#live-capture[aria-pressed=true]").count())
      await page.keyboard.press("Meta+Enter");
    await wait(60);
    await snap("PM4-capture.png");
    await page.waitForFunction(
      (n) => window.design.getDocument().pages.flatMap((p) => p.nodes).length > n,
      before,
      { timeout: 20000 },
    );
    await wait(800);
    await page.evaluate(() => window.design.zoomToFit());
    await wait(400);
    await away();
    await snap(
      "PM4-result.png",
      { ...FRAME, layers: "#layer-panel" },
      {
        addedNodes: await page.evaluate(
          (n) => window.design.getDocument().pages.flatMap((p) => p.nodes).length - n,
          before,
        ),
      },
    );
    await select(id);
    await focusFrame(id);
    await wait(300);
    await page.locator(".canvas-preview [data-part=live-pick]").click();
    await page.locator(".capture-picker").waitFor();
    {
      const p = await appPoint("#counter");
      await page.mouse.move(p.x, p.y, { steps: 4 });
      await wait(700);
    }
    await snap("PM4-pick.png", {
      ...FRAME,
      hint: ".capture-picker-hint",
      highlight: ".capture-picker-highlight",
      label: ".capture-picker-highlight span",
    });
    await esc();

    /* ---------- PF3 expand ---------- */
    await select(id);
    await page.locator(".canvas-preview [data-part=live-expand]").click();
    await wait(500);
    await away();
    await snap("PF3-expanded.png");
    await page.locator(".canvas-preview [data-part=live-expand]").click();
    await wait(400);

    /* ---------- PF4 resize by the bottom-right handle ---------- */
    await select(id);
    await focusFrame(id, 0.8);
    await wait(300);
    const handle = page.locator(".canvas-preview > .handle").last();
    const hb = await handle.boundingBox().catch(() => null);
    metrics.handles = await page.evaluate(() =>
      [...document.querySelectorAll(".canvas-preview > .handle")].map((h) => {
        const r = h.getBoundingClientRect();
        return {
          corner: h.dataset.corner,
          aria: h.getAttribute("aria-label"),
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
        };
      }),
    );
    if (hb) {
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await wait(300);
      await snap(
        "PF4-handle-hover.png",
        { ...FRAME },
        {
          cursor: await page.evaluate(
            ([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor,
            [hb.x + hb.width / 2, hb.y + hb.height / 2],
          ),
        },
      );
      await page.mouse.down();
      await page.mouse.move(hb.x - 110, hb.y - 60, { steps: 8 });
      await wait(300);
      await snap("PF4-resize.png");
      await page.mouse.up();
      await wait(600);
      await snap("PF4-resized.png", FRAME, {
        appViewport: await frameEl().evaluate(() => [innerWidth, innerHeight]),
      });
      await page.evaluate((id) => window.design.updateNodes([id], { w: 1200, h: 800 }), id);
      await wait(300);
    }

    /* ---------- PF5 context menu ---------- */
    {
      const b = await page.locator(".canvas-preview .live-preview-bar").boundingBox();
      await page.mouse.click(b.x + b.width * 0.5, b.y + b.height + 60, { button: "right" });
      await wait(400);
      await snap(
        "PF5-context.png",
        { ...FRAME, menu: "#canvas-menu" },
        {
          canvasMenu: await page.evaluate(() =>
            [...document.querySelectorAll("#canvas-menu button, #canvas-menu hr")]
              .filter((e) => e.offsetParent)
              .map((e) => (e.tagName === "HR" ? "—" : e.innerText.replace(/\s+/g, " ").trim())),
          ),
        },
      );
      await esc();
    }

    /* ---------- PF6 inspector, PF7 layers (chat dock closed so the layers panel shows) ---------- */
    await page.evaluate(() => window.agentWorkspace.closeChat());
    await wait(400);
    await select(id);
    await focusFrame(id);
    await wait(300);
    await away();
    await snap(
      "PF6-inspector.png",
      { ...FRAME, inspector: "#properties" },
      {
        inspectorText: await page.evaluate(() =>
          document.getElementById("properties")?.innerText.slice(0, 1500),
        ),
      },
    );
    await snap(
      "PF7-layers.png",
      { ...FRAME, row: `.layer-row[data-id="${id}"]`, rowIcon: `.layer-row[data-id="${id}"] svg` },
      {
        layerRowText: await page.evaluate(
          (id) => document.querySelector(`.layer-row[data-id="${id}"]`)?.innerText,
          id,
        ),
      },
    );

    /* ---------- PF8 second preview of the same repository (a different chat) ---------- */
    const second = await page.evaluate(
      (root) =>
        window.livePreview.ensure({
          root,
          chatId: "audit-second-chat",
          name: "Preview Sandbox › Second chat",
        }),
      repo.activeRoot,
    );
    await wait(400);
    await page.evaluate(() => window.design.setSelection([]));
    await page.evaluate(() => window.design.zoomToFit());
    await wait(400);
    await away();
    await snap("PF8-second.png");
    await page.evaluate((id) => {
      const d = window.design.getDocument();
      for (const p of d.pages) p.nodes = p.nodes.filter((n) => n.id !== id);
      window.design.setDocument(d);
    }, second);
    await wait(300);

    /* ---------- PP1 publish (Share › Publish app; nothing is published) ---------- */
    await page.evaluate(() => window.agentWorkspace.openChat());
    await wait(300);
    const share = page.locator("#cloud-toggle");
    if (await share.count()) {
      await page.evaluate(() => document.getElementById("cloud-toggle").click());
      await page.locator("#cloud-dialog").waitFor();
      await page.evaluate(() => {
        const s = document.getElementById("cloud-app-section");
        s.open = true;
        s.scrollIntoView();
      });
      await wait(1500);
      await snap("PP1-publish.png", {
        section: "#cloud-app-section",
        project: "#cloud-app-project",
        name: "#cloud-app-name",
        output: "#cloud-app-output",
        publish: "#cloud-app-publish",
        status: "#cloud-app-status",
      });
      await page.evaluate(() => document.getElementById("cloud-dialog").close());
      await wait(300);
    }

    /* ---------- PP2 stop, PS5 paused after reload ---------- */
    await select(id);
    await focusFrame(id);
    await page.locator(".canvas-preview [data-part=toggle]").click();
    await page.waitForFunction(
      () => document.querySelector(".canvas-preview")?.dataset.previewState === "paused",
      null,
      { timeout: 15000 },
    );
    await wait(4500); // header button polls every 4 s
    await away();
    await snap("PP2-stopped.png");
    await zoomOn(id, 0.5, 0.5, "c", "c");
    await wait(200);
    await snap("PP2-stopped-100.png");
    await page.reload();
    await page.waitForFunction(
      () => !!window.livePreview && !!document.querySelector(".canvas-preview"),
      null,
      { timeout: 20000 },
    );
    await wait(1200);
    id = await page.evaluate(
      () =>
        window.design
          .getDocument()
          .pages.flatMap((p) => p.nodes)
          .find((n) => n.preview)?.id,
    );
    await page.evaluate(() => window.design.setSelection([]));
    await focusFrame(id);
    await wait(400);
    await away();
    await snap("PS5-paused.png", { ...FRAME });
    await zoomOn(id, 0.5, 0.5, "c", "c");
    await wait(200);
    await snap("PS5-paused-100.png", { ...FRAME });
    await focusFrame(id);
    await select(id);
    await wait(300);
    await away();
    await snap("PS5-paused-selected.png", { ...FRAME });

    /* ---------- PS4 errors: run command exits non-zero; then a busy port ---------- */
    await page.evaluate(
      ({ root, port }) =>
        window.desktop.devServer.configure({
          root,
          command: [
            "python3",
            "-u",
            "-c",
            "import sys\nprint('Starting sandbox…')\nprint('Error: Cannot find module ./server.js', file=sys.stderr)\nsys.exit(3)",
          ],
          url: `http://localhost:${port}/`,
        }),
      { root: repo.activeRoot, port: PORT },
    );
    await page.locator(".canvas-preview [data-part=start]").click();
    await page
      .waitForFunction(
        () => document.querySelector(".canvas-preview")?.dataset.previewState === "error",
        null,
        { timeout: 20000 },
      )
      .catch(() => {});
    await wait(800);
    await away();
    await snap("PS4-error.png");
    await zoomOn(id, 0.5, 0.5, "c", "c");
    await wait(200);
    await snap("PS4-error-100.png");
    await focusFrame(id);
    const blockerServer = http.createServer((_q, r) => r.end("busy"));
    await new Promise((r) => blockerServer.listen(PORT, "127.0.0.1", r));
    blocker = blockerServer;
    await page.evaluate(
      ({ root, port }) =>
        window.desktop.devServer.configure({
          root,
          command: ["python3", "-u", "-m", "http.server", String(port), "--bind", "127.0.0.1"],
          url: `http://localhost:${port}/`,
        }),
      { root: repo.activeRoot, port: PORT },
    );
    const busyShown = () =>
      page
        .waitForFunction(
          () =>
            /already in use/.test(
              document.querySelector(".canvas-preview [data-part=message]")?.textContent || "",
            ),
          null,
          { timeout: 8000 },
        )
        .then(
          () => true,
          () => false,
        );
    await page.locator(".canvas-preview [data-part=start]").click();
    let busy = await busyShown();
    if (!busy) {
      log("busy-port message not shown after first Start; clicking the frame toolbar Start");
      await page.locator(".canvas-preview [data-part=toggle]").click();
      busy = await busyShown();
    }
    log(
      "busy-port message shown:",
      busy,
      await page.locator(".canvas-preview [data-part=message]").textContent(),
    );
    await snap("PS4-port-busy.png", FRAME, { startClicks: busy ? "ok" : "message never appeared" });
    // The frame message is repainted by the 1.5 s status poll (web/live-preview.js); record what it shows over 5 s.
    const timeline = [];
    for (let t = 0; t < 5000; t += 250) {
      timeline.push([
        t,
        await page.evaluate(() => [
          document.querySelector(".canvas-preview")?.dataset.previewState,
          document.querySelector(".canvas-preview [data-part=message]")?.textContent.slice(0, 90),
        ]),
      ]);
      await wait(250);
    }
    metrics["PS4-port-busy.png"].messageTimeline = timeline;
    await zoomOn(id, 0.5, 0.5, "c", "c");
    await wait(200);
    await snap("PS4-port-busy-100.png");

    await mcp.close().catch(() => {});
  } finally {
    metrics.pageErrors = errors;
    await fs.writeFile(path.join(OUT, "metrics.json"), JSON.stringify(metrics, null, 1) + "\n");
    if (blocker) await new Promise((r) => blocker.close(r));
    await app.close().catch(() => {});
    if (!KEEP) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    else console.log("profile kept at", tmp);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
