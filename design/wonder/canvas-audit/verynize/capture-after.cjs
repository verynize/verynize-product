// After-fix proof for the canvas parity audit, captured from the MERGED build (design/wonder/canvas-audit/README.md,
// "Status after the fix pass"). Every PNG in verynize/after/ comes from this one script, so all shots show the same
// UI (6-tool toolbar, Radix menus, palette, mask and thumbnail rows).
//
//   npm run build:ui
//   node design/wonder/canvas-audit/verynize/capture-after.cjs [id-prefix ...]
//
// Launch, profile, window size (1440×870 at 2×) and the shot/metrics approach follow capture.cjs. The fixtures differ:
// instead of capture.cjs's portfolio document they rebuild the Wonder "Sunbird" scratch file at the stage each Wonder
// shot was taken (../wonder/notes.md, ../wonder/notes-2026-10-31-b.md): one 300×270 white Frame for the menu and
// resize shots, then the 420×391.18 Frame (nested 100×80 Frame + "Canvas au" text) beside 120×120 shader-painted
// frames, a 100×70 frame for rotate/scale, an "Audit" page for paste and mask. Camera is 100 % with the document
// placed where Wonder's was on screen. P1-*.txt are the system clipboard after each Copy command.
// id-prefix args limit the run (e.g. CM2 P5 TR); metrics for the shots taken go to after/metrics.json.
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const { _electron } = require(ROOT + "/node_modules/@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const OUT = path.join(__dirname, "after");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const want = (file) => !only.length || only.some((p) => file.startsWith(p));
const wantAny = (...prefixes) =>
  !only.length || prefixes.some((x) => only.some((p) => p.startsWith(x) || x.startsWith(p)));

/* ---------- fixtures (document px; children relative to their parent) ---------- */
const WHITE = "#ffffff";
const frame = (id, name, x, y, w, h, extra = {}) => ({
  id,
  name,
  type: "frame",
  x,
  y,
  w,
  h,
  color: WHITE,
  radius: 0,
  layout: "free",
  clipContent: true,
  ...extra,
});
const shaderFrame = (id, name, x, y, preset, extra = {}) =>
  frame(id, name, x, y, 120, 120, {
    shaderFill: true,
    shaderPreset: preset,
    shaderSpeed: 0.4,
    color: "#f08a3c",
    ...extra,
  });
// Text drawn with the Text tool, like Wonder's "Canvas au": Inter Regular 12, line height Auto (CM3, TX1-click).
const text = (id, name, x, y, value, extra = {}) => ({
  id,
  name,
  type: "text",
  x,
  y,
  w: 59.39,
  h: 14.5,
  text: value,
  fontFamily: "Inter",
  fontWeight: "400",
  fontSize: 12,
  lineHeight: "auto",
  color: "#000000",
  radius: 0,
  wMode: "hug",
  hMode: "hug",
  ...extra,
});

// Stage 1: the first Frame Wonder drew (F drag 300×270, X65 Y−153).
const SINGLE = [frame("f1", "Frame", 65, -153, 300, 270)];
// Stage 2: the resized Frame with a nested frame and text, plus shader-painted frames on its right.
const SUN = () => [
  frame("f1", "Frame", 56, -153, 420, 391.18),
  frame("inner", "Frame", 49, 40, 100, 80, { parentId: "f1" }),
  text("canvasAu", "Canvas au", 59, 160, "Canvas au", { parentId: "f1" }),
  shaderFrame("s2", "Frame 2", 515, -133, "tidal-swirl-4"),
];
// Stage 3: later Page 1 with more shaders, the rotated 100×70 frame and its 100×70 sibling below the white Frame.
const SUNX = () => [
  ...SUN(),
  shaderFrame("s3", "Frame 3", 675, -133, "ripple-pool-2"),
  frame("rot", "Frame", 150, 300, 100, 70, { rotation: -47.19 }),
  frame("small", "Frame", 260, 300, 100, 70),
];
// "Audit" page (Wonder pass b): P3 source/target and the "!" text.
const AUDIT_P3 = [
  frame("src", "Frame", 147, -60, 100, 100),
  frame("target", "Frame", 397, -110, 300, 300),
  text("bang", "!", 317, 25, "!", { color: WHITE }),
];
const AUDIT_P5 = [
  shaderFrame("source", "Frame", 97, -110, "pixel-bloom-3", { w: 200, h: 200 }),
  frame("target", "Frame", 147, -60, 100, 100),
  text("bang", "!", 317, 25, "!", { color: WHITE }),
];

(async () => {
  await fs.mkdir(OUT, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "vp-canvas-after-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
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
  const metrics = [];
  const errors = [];
  const missed = [];
  try {
    const page = await app.firstWindow({ timeout: 30000 });
    page.on("pageerror", (e) => errors.push(e.message));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 870),
    );
    await page.waitForSelector("#canvas .layer");
    await page.waitForFunction(() => window.fileLibrary?.currentId);
    await page.waitForTimeout(800);

    /* ---------- helpers ---------- */
    const wait = (ms) => page.waitForTimeout(ms);
    const mouse = { x: 0, y: 0 };
    const move = async (x, y, steps = 1) => {
      await page.mouse.move(x, y, { steps });
      mouse.x = x;
      mouse.y = y;
    };
    // A canvas point that stays empty in every fixture (keeps keyboard focus on the canvas, no hover outline).
    const away = async () => {
      await move(1120, 700);
      await wait(150);
    };
    const esc = async () => {
      await page.keyboard.press("Escape");
      await wait(150);
    };
    const clipboard = {
      read: () => app.evaluate(({ clipboard }) => clipboard.readText()),
      clear: () => app.evaluate(({ clipboard }) => clipboard.writeText("")),
    };
    const wrap = () =>
      page.evaluate(() => {
        const r = document.querySelector("#canvas-wrap").getBoundingClientRect();
        return { x: r.left, y: r.top };
      });
    /** Document point → client point. */
    const scr = async (wx, wy) => {
      const w = await wrap();
      const c = await page.evaluate(() => window.design.getCamera());
      return { x: w.x + c.x + wx * c.zoom, y: w.y + c.y + wy * c.zoom };
    };
    /** Point inside a rendered layer (fractions of its client box). */
    const at = (id, fx = 0.5, fy = 0.5) =>
      page.evaluate(
        ([id, fx, fy]) => {
          const r = document.querySelector(`#canvas [data-id="${id}"]`).getBoundingClientRect();
          return { x: r.left + r.width * fx, y: r.top + r.height * fy };
        },
        [id, fx, fy],
      );
    const nodes = () =>
      page.evaluate(() => {
        const d = window.design.getDocument();
        return d.pages.find((p) => p.id === d.activePage).nodes;
      });
    const node = async (id) => (await nodes()).find((n) => n.id === id);

    /**
     * Load a fixture. `origin` is where document (0,0) lands on screen at `zoom` (Wonder's camera at 100 %).
     * `pages` is the page list (the active page gets `list`).
     */
    async function seed(
      list,
      {
        select = [],
        origin = [385, 403],
        zoom = 1,
        pages = ["Page 1", "Page 2"],
        active = "Page 1",
        tool = "move",
      } = {},
    ) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.evaluate(
        ([list, pages, active]) => {
          const d = window.design.getDocument();
          d.name = "Sunbird";
          d.pages = pages.map((name, i) => ({
            id: name === "Audit" ? "audit" : "p" + (i + 1),
            name,
            nodes: name === active ? list : [],
          }));
          d.activePage = d.pages.find((p) => p.name === active).id;
          delete d.thumbnailNodeId;
          window.design.setDocument(d);
          window.design.setSelection([]);
          window.design.setTool("move");
        },
        [list, pages, active],
      );
      await wait(250);
      const w = await wrap();
      await page.evaluate(
        ([x, y, z]) => window.design.setCamera(x, y, z),
        [origin[0] - w.x, origin[1] - w.y, zoom],
      );
      await wait(200);
      if (select.length) await page.evaluate((ids) => window.design.setSelection(ids), select);
      if (tool !== "move") await page.evaluate((t) => window.design.setTool(t), tool);
      await wait(200);
      await away();
    }
    const select = async (ids) => {
      await page.evaluate((ids) => window.design.setSelection(ids), ids);
      await wait(150);
    };

    const state = () =>
      page.evaluate(() => {
        const vis = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect(),
            cs = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
        };
        const text = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
        const menus = [...document.querySelectorAll("[role=menu]")].filter(vis).map((m) => ({
          id: m.id || undefined,
          w: Math.round(m.getBoundingClientRect().width),
          items: [
            ...m.querySelectorAll(
              ":scope > [role=menuitem], :scope > [role=separator], :scope > [role=group] > [role=menuitem], :scope > [role=group] > [role=separator], :scope [role=menuitem], :scope [role=separator]",
            ),
          ]
            .filter(
              (el, i, all) => all.indexOf(el) === i && el.closest("[role=menu]") === m && vis(el),
            )
            .map((el) =>
              el.getAttribute("role") === "separator"
                ? "|"
                : text(el) +
                  (el.getAttribute("aria-disabled") === "true" || el.dataset.disabled !== undefined
                    ? " (disabled)"
                    : ""),
            ),
        }));
        const dialog = [...document.querySelectorAll("[role=dialog]")]
          .filter(vis)
          .map((d) => text(d).slice(0, 600));
        const toasts = [...document.querySelectorAll("[data-sonner-toast]")].map(text);
        const tips = [...document.querySelectorAll("[role=tooltip]")].filter(vis).map(text);
        const badge = document.querySelector("#selection-measure");
        return {
          selection: window.design.getSelection(),
          tool: window.design.getTool(),
          zoom: text(document.querySelector("#zoom-menu-button")),
          badge: vis(badge) ? text(badge) : null,
          menus,
          dialog,
          toasts,
          tips,
          inspectorTitle:
            text(document.querySelector("#properties h2, #properties [data-slot=title]")) ||
            undefined,
        };
      });
    async function shot(id, name, opts = {}) {
      const file = `${id}-${name}.png`;
      if (!want(file)) return false;
      await wait(opts.settle ?? 120);
      await page.screenshot({ path: path.join(OUT, file) });
      const s = await state();
      const ns = (await nodes()).map(
        ({ id, name, type, parentId, x, y, w, h, rotation, masks, hidden, locked }) => ({
          id,
          name,
          type,
          parentId,
          x,
          y,
          w,
          h,
          rotation,
          masks,
          hidden,
          locked,
        }),
      );
      metrics.push({ file, ...s, nodes: ns, ...(opts.extra ? { extra: await opts.extra() } : {}) });
      console.log("shot", file);
      return true;
    }
    const right = async (x, y) => {
      await move(x, y);
      await page.mouse.click(x, y, { button: "right" });
      await wait(300);
    };
    const menuItem = (command) =>
      page.locator(`[data-bd-context-menu] [data-command="${command}"]`).first();
    const hoverItem = async (command) => {
      const b = await menuItem(command).boundingBox();
      if (!b) {
        missed.push("menu item " + command);
        return;
      }
      await move(b.x + 30, b.y + b.height / 2, 3);
      await wait(400);
    };
    const clickItem = async (command) => {
      const loc = menuItem(command);
      if (!(await loc.count())) {
        missed.push("menu item " + command);
        await esc();
        return false;
      }
      await loc.click();
      await wait(400);
      return true;
    };
    const rowBox = (id) =>
      page.locator(`#bd-layer-tree .layer-row[data-id="${id}"]`).first().boundingBox();
    const rightRow = async (id, fx = 0.4) => {
      const b = await rowBox(id);
      await right(b.x + b.width * fx, b.y + b.height / 2);
    };
    const pageRow = (name) => page.locator("[data-page-id]", { hasText: name }).first();
    async function drag(from, to, during, { steps = 14, mods = [] } = {}) {
      await move(from.x, from.y);
      for (const m of mods) await page.keyboard.down(m);
      await page.mouse.down();
      await move(to.x, to.y, steps);
      await wait(200);
      if (during) await during();
      await page.mouse.up();
      for (const m of mods) await page.keyboard.up(m);
      await wait(250);
    }
    const tipOpen = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("[role=tooltip]")].some(
          (t) => t.getBoundingClientRect().width > 0,
        ),
      );
    async function hoverTip(selector) {
      for (let i = 0; i < 4; i++) {
        await move(1000, 450);
        await wait(i ? 500 : 800);
        const b = await page.locator(selector).first().boundingBox();
        await move(b.x + b.width / 2, b.y + b.height / 2, 4);
        await wait(1000);
        if (await tipOpen()) return true;
      }
      missed.push("tooltip " + selector);
      return false;
    }

    /* ================= CM10 empty clipboard first (nothing copied yet in this session) ================= */
    if (wantAny("CM10")) {
      await clipboard.clear();
      await seed(SUN(), { select: ["s2"] });
      await rightRow("s2");
      await shot("CM10", "empty-clipboard");
      await esc();
    }

    /* ================= Stage 1: one 300×270 Frame ================= */
    if (
      wantAny("CM1", "CM2", "CM7", "CM8", "CM9", "S4", "T1", "T2", "T3", "T5", "T6", "TR3", "K1")
    ) {
      // Wonder had copied something earlier, so Paste rows are enabled: copy the frame once (internal clipboard).
      await seed(SINGLE, { select: ["f1"], pages: ["Page 1"] });
      await page.keyboard.press("Meta+c");
      await wait(200);
      // CM1: nothing selected, right-click empty canvas at Wonder's global (900,350) = window (900,320).
      await seed(SINGLE, { pages: ["Page 1"] });
      await right(900, 320);
      await shot("CM1", "empty");
      await esc();
      // CM2: right-click the frame body at (600,400); then each submenu.
      await seed(SINGLE, { pages: ["Page 1"] });
      await right(600, 370);
      await move(640, 410); // first row highlighted like Wonder's Add context
      const first = await menuItem("menu.addContext").boundingBox();
      if (first) {
        await move(first.x + 40, first.y + first.height / 2, 3);
        await wait(200);
      }
      await shot("CM2", "frame");
      for (const [state, command] of [
        ["copy-as", "menu.copyAs"],
        ["select-layer", "menu.selectLayer"],
        ["arrange", "menu.arrange"],
        ["layout", "menu.layout"],
      ]) {
        await hoverItem(command);
        await shot("CM2", state);
      }
      await esc();
      await esc();
      // CM7: right-click the selected Frame row.
      await seed(SINGLE, { select: ["f1"], pages: ["Page 1"] });
      await rightRow("f1", 0.3);
      await shot("CM7", "row");
      await esc();
      // CM8: right-click the Page 1 row (frame selected, as in Wonder).
      await seed(SINGLE, { select: ["f1"], pages: ["Page 1"] });
      {
        const b = await pageRow("Page 1").boundingBox();
        await right(b.x + 40, b.y + b.height / 2);
      }
      await shot("CM8", "page");
      await esc();
      // CM9: right-click the frame name label above the (unselected) artboard.
      await seed(SINGLE, { pages: ["Page 1"] });
      {
        const l = page.locator('#canvas-overlay .frame-label[data-id="f1"]').first();
        const b = await l.boundingBox();
        await right(b.x + 10, b.y + b.height / 2);
      }
      await shot("CM9", "label");
      await esc();
      // S4: the frame selected, pointer away.
      await seed(SINGLE, { select: ["f1"], pages: ["Page 1"] });
      await shot("S4", "frame");
      // TR3: Right nudges 1 px, Shift+Right 10 px.
      await seed(SINGLE, { select: ["f1"], pages: ["Page 1"] });
      await page.keyboard.press("ArrowRight");
      await wait(200);
      await shot("TR3", "nudge", { extra: async () => (await node("f1")).x });
      await page.keyboard.press("Shift+ArrowRight");
      await wait(200);
      await shot("TR3", "shift-nudge", { extra: async () => (await node("f1")).x });
      // T1 tooltips (nothing selected, Page 1 only).
      await seed(SINGLE, { pages: ["Page 1"] });
      for (const [state, sel] of [
        ["move", "#select-tool"],
        ["scale", "#scale-tool"],
        ["hand", "#pan-tool"],
        ["frame", "#add-frame"],
        ["shader", "#add-shader"],
        ["text", "#text"],
        ["view-a", "#layout-details"],
        ["view-b", "#layout-design"],
        ["plus", "#bd-view-menu-button"],
      ]) {
        if (!want(`T1-${state}.png`)) continue;
        await hoverTip(sel);
        await shot("T1", state);
      }
      await away();
      await wait(400);
      // T2: the + (views) menu. T3: Details then Design.
      await seed(SINGLE, { pages: ["Page 1"] });
      await page.click("#bd-view-menu-button");
      await wait(400);
      await shot("T2", "plus");
      await esc();
      await page.click("#layout-details");
      await wait(600);
      await away();
      await shot("T3", "details");
      await page.click("#layout-design");
      await wait(600);
      await away();
      await shot("T3", "design");
      // T5 help, T6 zoom menu.
      await page.click("#bd-canvas-help");
      await wait(400);
      await shot("T5", "help");
      await esc();
      await page.click("#zoom-menu-button");
      await wait(400);
      await shot("T6", "zoom");
      await esc();
      // K1: Help → Keyboard shortcuts.
      await page.click("#bd-canvas-help");
      await wait(400);
      await page.locator("#help-shortcuts").click();
      await wait(600);
      await shot("K1", "shortcuts");
      await esc();
      await esc();
    }

    /* ================= TR1: corner, Shift corner, Alt edge (one Frame, sequential like Wonder) ================= */
    if (wantAny("TR1")) {
      await seed([frame("f1", "Frame", 76, -153, 300, 310)], { select: ["f1"], pages: ["Page 1"] });
      let se = await at("f1", 1, 1);
      await drag({ x: se.x - 1, y: se.y - 1 }, { x: se.x + 39, y: se.y + 39 });
      await away();
      await shot("TR1", "corner", { extra: () => node("f1") });
      se = await at("f1", 1, 1);
      // Along the 340:350 diagonal, so the Shift result is Wonder's 380 x 391.18.
      await drag({ x: se.x - 1, y: se.y - 1 }, { x: se.x + 39, y: se.y + 40.18 }, null, {
        mods: ["Shift"],
      });
      await away();
      await shot("TR1", "shift", { extra: () => node("f1") });
      const e = await at("f1", 1, 0.5);
      await drag({ x: e.x - 1, y: e.y }, { x: e.x + 19, y: e.y }, null, { mods: ["Alt"] });
      await away();
      await shot("TR1", "alt", { extra: () => node("f1") });
    }

    /* ================= Stage 2: Frame + nested frame + text + shader ================= */
    if (wantAny("CM3", "CM4", "CM5", "CM6", "CM10", "S1", "S2", "S3", "TX1")) {
      // CM3: select the text, right-click it.
      await seed(SUN(), { select: ["canvasAu"] });
      {
        const p = await at("canvasAu");
        await right(p.x, p.y);
      }
      await shot("CM3", "text");
      await esc();
      // CM4: right-click the top-level shader-painted frame.
      await seed(SUN());
      {
        const p = await at("s2");
        await right(p.x, p.y);
      }
      await shot("CM4", "shader");
      await esc();
      // CM5: every top-level layer selected, right-click a selected shader.
      await seed(
        [
          ...SUN(),
          shaderFrame("s3", "Frame 3", 675, -133, "ripple-pool-2"),
          shaderFrame("s4", "Frame 4", 615, 17, "pixel-bloom-3"),
        ],
        { select: ["f1", "s2", "s3", "s4"], origin: [330, 403] },
      );
      {
        const p = await at("s3", 0.4, 0.7);
        await right(p.x, p.y);
      }
      await shot("CM5", "multi");
      await esc();
      // CM6: shader hidden (⌘⇧H) → row menu; visible again, locked (⌘⇧L) → row menu.
      await seed(SUN(), { select: ["s2"] });
      await page.keyboard.press("Meta+Shift+h");
      await wait(300);
      await rightRow("s2");
      await shot("CM6", "hidden");
      await esc();
      await page.keyboard.press("Meta+Shift+h");
      await wait(200);
      await page.keyboard.press("Meta+Shift+l");
      await wait(300);
      await rightRow("s2");
      await shot("CM6", "locked");
      await esc();
      // CM10: ⌘C the shader, right-click it on the canvas.
      await seed(SUN(), { select: ["s2"] });
      await page.keyboard.press("Meta+c");
      await wait(200);
      {
        const p = await at("s2");
        await right(p.x, p.y);
      }
      await shot("CM10", "copied");
      await esc();
      // S1: hover the unselected white Frame.
      await seed(SUN());
      {
        const p = await at("f1", 0.7, 0.8);
        await move(p.x, p.y, 4);
        await wait(250);
      }
      await shot("S1", "hover");
      // S2: click the nested 100×80 frame; second click; double-click; Escape.
      await seed(SUN());
      {
        const p = await at("inner");
        await move(p.x, p.y);
        await page.mouse.click(p.x, p.y);
        await wait(300);
        await away();
        await shot("S2", "classic");
        await move(p.x, p.y);
        await page.mouse.click(p.x, p.y);
        await wait(300);
        await away();
        await shot("S2", "drill");
        await seed(SUN());
        await move(p.x, p.y);
        await page.mouse.dblclick(p.x, p.y);
        await wait(350);
        await away();
        await shot("S2", "double");
        await page.keyboard.press("Escape");
        await wait(300);
        await shot("S2", "escape");
      }
      // S3: marquee from empty canvas (410,210)→(1050,670); Shift-click add.
      await seed(SUN());
      await drag({ x: 410, y: 210 }, { x: 1050, y: 670 });
      await away();
      await shot("S3", "marquee");
      await seed(SUN(), { select: ["f1"] });
      {
        const p = await at("s2");
        await move(p.x, p.y);
        await page.keyboard.down("Shift");
        await page.mouse.click(p.x, p.y);
        await page.keyboard.up("Shift");
        await wait(300);
        await away();
      }
      await shot("S3", "shift-add");
      // TX1 click: T, click inside the white Frame.
      await seed([
        frame("f1", "Frame", 56, -153, 420, 391.18),
        frame("inner", "Frame", 49, 40, 100, 80, { parentId: "f1" }),
        shaderFrame("s2", "Frame 2", 515, -133, "tidal-swirl-4"),
      ]);
      await page.keyboard.press("t");
      await wait(150);
      {
        const p = await scr(56 + 59, -153 + 160);
        await move(p.x, p.y);
        await page.mouse.click(p.x, p.y);
        await wait(500);
      }
      await shot("TX1", "click", {
        extra: () =>
          page.evaluate(() => {
            const el = document.querySelector("[data-text-editing]");
            if (!el) return null;
            const s = getComputedStyle(el);
            return { text: el.innerText, font: s.fontFamily, size: s.fontSize, color: s.color };
          }),
      });
      await esc();
      await esc();
      // TX1 drag: T, drag 150×60 on the dark canvas.
      await seed(SUN());
      await page.keyboard.press("t");
      await wait(150);
      {
        const a = await scr(515, 47),
          b = await scr(665, 107);
        await drag(a, b);
      }
      await shot("TX1", "drag", {
        extra: async () =>
          (await nodes())
            .filter((n) => n.type === "text")
            .map((n) => ({ name: n.name, w: n.w, h: n.h, color: n.color })),
      });
      await esc();
      await esc();
    }

    /* ================= Stage 3: Page 1 with more layers ================= */
    if (wantAny("TR2", "TR4", "TR5", "TR6", "T4", "K2", "K3", "L1", "V")) {
      const O = [270, 355];
      // TR2: draw-like 100×70 frame, drag from just outside its lower-right corner by −47.19° about the centre.
      await seed(
        [
          ...SUN(),
          shaderFrame("s3", "Frame 3", 675, -133, "ripple-pool-2"),
          frame("rot", "Frame", 150, 300, 100, 70),
        ],
        { select: ["rot"], origin: O },
      );
      {
        const c = await at("rot"),
          se = await at("rot", 1, 1);
        const start = { x: se.x + 7, y: se.y + 7 };
        const a = (-47.19 * Math.PI) / 180,
          vx = start.x - c.x,
          vy = start.y - c.y;
        const end = {
          x: c.x + vx * Math.cos(a) - vy * Math.sin(a),
          y: c.y + vx * Math.sin(a) + vy * Math.cos(a),
        };
        await drag(start, end, null, { steps: 24 });
        await away();
        await shot("TR2", "rotate", { extra: async () => (await node("rot")).rotation });
      }
      // TR4: drag the 100×70 sibling so its centre lines up with the rotated frame's centre (thin blue guide).
      await seed(SUNX(), { select: ["small"], origin: O });
      {
        const p = await at("small"),
          target = await at("rot");
        await drag(p, { x: p.x + 18, y: target.y + 2 }, () => shot("TR4", "guide"), { steps: 16 });
      }
      // TR5: rotated frame selected, Alt held over the white Frame (node-to-node distances).
      await seed(SUNX(), { select: ["rot"], origin: O });
      {
        const p = await at("f1", 0.5, 0.7);
        await move(p.x, p.y);
        await page.keyboard.down("Alt");
        await move(p.x + 2, p.y + 1);
        await wait(300);
        await shot("TR5", "alt-parent");
        await page.keyboard.up("Alt");
      }
      // TR6: Option-drag Frame 2 by (100,150) → copy "Frame 3".
      await seed(
        [
          ...SUN(),
          frame("rot", "Frame", 150, 300, 100, 70, { rotation: -47.19 }),
          frame("small", "Frame", 260, 300, 100, 70),
        ],
        { origin: O },
      );
      {
        const p = await at("s2");
        await drag(p, { x: p.x + 100, y: p.y + 150 }, null, { mods: ["Alt"], steps: 16 });
        await away();
      }
      await shot("TR6", "alt-duplicate", {
        extra: async () =>
          (await nodes())
            .filter((n) => n.name.startsWith("Frame "))
            .map((n) => ({ name: n.name, x: n.x, y: n.y })),
      });
      // T4: Scale tool on the 100×70 frame, drag its corner to 150×105.
      await seed(SUNX(), { select: ["small"], origin: O });
      await page.keyboard.press("k");
      await wait(150);
      {
        const se = await at("small", 1, 1);
        await drag({ x: se.x - 1, y: se.y - 1 }, { x: se.x + 49, y: se.y + 34 }, null, {
          steps: 16,
        });
        await away();
      }
      await shot("T4", "scale", { extra: () => node("small") });
      await page.keyboard.press("v");
      // K2 duplicate: ⌘D on Frame 2 (X515 → 515 + 120 + 40).
      await seed(
        SUNX().filter((n) => n.id !== "s3"),
        { select: ["s2"], origin: O },
      );
      await page.keyboard.press("Meta+d");
      await wait(400);
      await shot("K2", "duplicate", {
        extra: async () =>
          (await nodes())
            .filter((n) => n.name.startsWith("Frame 2") || n.id.startsWith("s2") || n.y === -133)
            .map((n) => ({ name: n.name, x: n.x, y: n.y })),
      });
      // K2 paste here: copy, right-click empty canvas (menu open with Paste here).
      await seed(SUNX(), { select: ["small"], origin: O });
      await page.keyboard.press("Meta+c");
      await wait(200);
      await right(1010, 560);
      await hoverItem("clipboard.pasteHere");
      await shot("K2", "paste-here");
      await esc();
      // K2 over / replace: copy Frame 2, select the 100×70 frame, ⌘⇧V / ⌘⇧R.
      await seed(SUNX(), { select: ["s2"], origin: O });
      await page.keyboard.press("Meta+c");
      await wait(200);
      await select(["small"]);
      await page.keyboard.press("Meta+Shift+v");
      await wait(400);
      await away();
      await shot("K2", "over", { extra: async () => (await nodes()).slice(-1) });
      await seed(SUNX(), { select: ["s2"], origin: O });
      await page.keyboard.press("Meta+c");
      await wait(200);
      await select(["small"]);
      await page.keyboard.press("Meta+Shift+r");
      await wait(400);
      await away();
      await shot("K2", "replace", {
        extra: async () => (await nodes()).map((n) => n.name + "@" + n.x + "," + n.y),
      });
      // K3: ⌘G on the top-level layers, then ⌘⇧G.
      await seed(
        [
          ...SUN(),
          shaderFrame("s3", "Frame 3", 675, -133, "ripple-pool-2"),
          shaderFrame("s4", "Frame 4", 615, 17, "pixel-bloom-3"),
        ],
        { select: ["f1", "s2", "s3", "s4"], origin: O },
      );
      await page.keyboard.press("Meta+g");
      await wait(400);
      await away();
      await shot("K3", "frame-selection", {
        extra: async () => (await nodes()).filter((n) => !n.parentId),
      });
      await page.keyboard.press("Meta+Shift+g");
      await wait(400);
      await away();
      await shot("K3", "unframe", {
        extra: async () => (await nodes()).filter((n) => !n.parentId).map((n) => n.name),
      });
      // L1: hover a row, then its lock button (tooltip "Lock layer").
      await seed(SUNX(), { origin: O });
      {
        const b = await rowBox("rot");
        await move(b.x + 60, b.y + b.height / 2);
        await wait(300);
        const lock = page
          .locator('#bd-layer-tree .layer-row[data-id="rot"] button[aria-label*="ock" i]')
          .first();
        if (await lock.count()) {
          const lb = await lock.boundingBox();
          await move(lb.x + lb.width / 2, lb.y + lb.height / 2, 3);
          await wait(1100);
        } else missed.push("L1 lock button");
        await shot("L1", "hover");
      }
      // V1: ⌘+ / ⌘− / ⇧0 with the white Frame selected.
      await seed(SUNX(), { select: ["f1"], origin: O });
      await page.keyboard.press("Meta+Equal");
      await wait(350);
      await away();
      await shot("V1", "in");
      await page.keyboard.press("Meta+Minus");
      await wait(200);
      await page.keyboard.press("Meta+Minus");
      await wait(350);
      await shot("V1", "out");
      await select([]);
      await page.keyboard.press("Shift+Digit0");
      await wait(350);
      await shot("V1", "100");
      // V2: Hand tool drag (1000,620)→(1100,670).
      await seed(SUNX(), { origin: O, select: ["s2"] });
      await page.keyboard.press("h");
      await wait(150);
      await drag({ x: 1000, y: 620 }, { x: 1100, y: 670 });
      await shot("V2", "hand");
      await page.keyboard.press("v");
      // V3: shader selected, ⇧1 fit, ⇧2 selection.
      await seed(SUNX(), { origin: O, select: ["s2"] });
      await page.keyboard.press("Shift+Digit1");
      await wait(400);
      await shot("V3", "fit");
      await page.keyboard.press("Shift+Digit2");
      await wait(400);
      await shot("V3", "selection");
      // V4: 150×105 frame, ⇧2 (Wonder 548 %).
      await seed(
        [...SUNX().filter((n) => n.id !== "small"), frame("small", "Frame", 260, 300, 150, 105)],
        { origin: O, select: ["small"] },
      );
      await page.keyboard.press("Shift+Digit2");
      await wait(400);
      await shot("V4", "high-zoom");
    }

    /* ================= TR7 / TR8: flex Frame (gap 20, padding 20) ================= */
    if (wantAny("TR7", "TR8")) {
      const FLEX = () => [
        frame("flex", "Frame", 56, -153, 880, 431.18, {
          layout: "flex",
          direction: "row",
          gap: 20,
          padding: 20,
          alignItems: "flex-start",
          wMode: "hug",
          hMode: "hug",
          color: "#ffffff00",
          clipContent: false,
        }),
        { ...frame("f1", "Frame", 0, 0, 420, 391.18), parentId: "flex" },
        { ...frame("inner", "Frame", 49, 40, 100, 80), parentId: "f1" },
        text("canvasAu", "Canvas au", 59, 160, "Canvas au", { parentId: "f1" }),
        { ...shaderFrame("s2", "Frame", 0, 0, "tidal-swirl-4"), parentId: "flex" },
        { ...shaderFrame("s3", "Frame 3", 0, 0, "ripple-pool-2"), parentId: "flex" },
        { ...shaderFrame("s4", "Frame 2", 0, 0, "pixel-bloom-3"), parentId: "flex" },
      ];
      const O = [310, 413];
      await seed(FLEX(), { origin: O, select: ["flex"], zoom: 1.07 });
      {
        const p = await at("f1", 0.5, 0.9);
        await move(p.x, p.y, 3);
        await wait(300);
      }
      await shot("TR8", "gap-padding");
      await seed(FLEX(), { origin: O, select: ["s3"], zoom: 1.07 });
      {
        const p = await at("s3"),
          q = await at("s2", 0.3, 0.5);
        await drag(p, q, () => shot("TR7", "reorder-during"), { steps: 20 });
        await away();
      }
      await shot("TR7", "reorder-after", {
        extra: async () => (await nodes()).filter((n) => n.parentId === "flex").map((n) => n.name),
      });
      await seed(FLEX(), { origin: O, select: ["s3"], zoom: 1.07 });
      {
        const p = await at("s3");
        await drag(p, { x: p.x, y: p.y + 200 }, () => shot("TR7", "out-during"), { steps: 20 });
        await away();
      }
      await shot("TR7", "out-after", { extra: async () => await node("s3") });
    }

    /* ================= L2 pages ================= */
    if (wantAny("L2")) {
      await seed(SUNX(), {
        pages: ["Page 1", "Page 2", "Page 3"],
        active: "Page 1",
        origin: [270, 355],
      });
      {
        const b = await pageRow("Page 3").boundingBox();
        await right(b.x + 40, b.y + b.height / 2);
      }
      await shot("L2", "rename");
      // Rename from the menu: the inline field with the name selected.
      if (await clickItem("page.rename").catch(() => false)) {
      } else {
        const it = page.getByRole("menuitem", { name: /Rename/ }).first();
        if (await it.count()) {
          await it.click();
          await wait(400);
        }
      }
      await shot("L2", "rename-field");
      await page.keyboard.type("Audit");
      await page.keyboard.press("Enter");
      await wait(300);
      await away();
      await shot("L2", "renamed");
      {
        const a = await pageRow("Audit").boundingBox(),
          p1 = await pageRow("Page 1").boundingBox();
        await drag(
          { x: a.x + 60, y: a.y + a.height / 2 },
          { x: p1.x + 60, y: p1.y + 3 },
          async () => {
            await shot("L2", "reorder-during");
            await shot("L2", "drag");
          },
          { steps: 14 },
        );
        await away();
        await shot("L2", "order");
      }
    }

    /* ================= P1 clipboard texts ================= */
    if (wantAny("P1")) {
      await seed(SUN(), { select: ["canvasAu"] });
      const grab = async (keys, file) => {
        await clipboard.clear();
        await away();
        await page.keyboard.press(keys);
        await wait(500);
        const t = await clipboard.read();
        if (!t) missed.push(file + " (empty clipboard)");
        await fs.writeFile(path.join(OUT, file), t);
        console.log("text", file, t.length);
      };
      if (want("P1-copy-prompt-text.txt"))
        await grab("Meta+Shift+Alt+c", "P1-copy-prompt-text.txt");
      await select(["f1"]);
      if (want("P1-copy-prompt.txt")) await grab("Meta+Shift+Alt+c", "P1-copy-prompt.txt");
      if (want("P1-copy-code.txt")) await grab("Meta+Shift+c", "P1-copy-code.txt");
      if (want("P1-copy-link.txt")) {
        await clipboard.clear();
        await rightRow("f1");
        await clickItem("clipboard.copyLink");
        await fs.writeFile(path.join(OUT, "P1-copy-link.txt"), await clipboard.read());
        console.log("text P1-copy-link.txt");
      }
      await select(["canvasAu", "inner"]);
      if (want("P1-copy-prompt-multi.txt"))
        await grab("Meta+Shift+Alt+c", "P1-copy-prompt-multi.txt");
    }

    /* ================= P2 command palette ================= */
    if (wantAny("P2")) {
      const O = [270, 355];
      await seed(SUNX(), { origin: O });
      await page.mouse.click(1120, 700);
      await wait(200);
      await page.keyboard.press("Meta+k");
      await wait(600);
      await shot("P2", "empty");
      await page.keyboard.type("select");
      await wait(400);
      await shot("P2", "select");
      await page.keyboard.press("ArrowDown");
      await wait(300);
      await shot("P2", "keyboard-focused");
      await page.keyboard.press("Meta+a");
      await page.keyboard.type("frame");
      await wait(400);
      await shot("P2", "frame");
      await page.keyboard.press("Meta+a");
      await page.keyboard.type("select");
      await wait(400);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowUp");
      await wait(200);
      await page.keyboard.press("Enter");
      await wait(500);
      await away();
      await shot("P2", "enter");
      await page.keyboard.press("Meta+k");
      await wait(500);
      await page.keyboard.press("Escape");
      await wait(400);
      await shot("P2", "escape");
    }

    /* ================= P3 paste here / paste into a frame ================= */
    if (wantAny("P3")) {
      const pagesA = ["Audit", "Page 1", "Page 2"];
      await seed(SUNX(), {
        select: ["inner"],
        pages: pagesA,
        active: "Page 1",
        origin: [498, 396],
      });
      await page.keyboard.press("Meta+c");
      await wait(200);
      await shot("P3", "source");
      await right(400, 370);
      await shot("P3", "empty-menu");
      await clickItem("clipboard.pasteHere");
      await away();
      await shot("P3", "empty-result", { extra: async () => (await nodes()).slice(-1) });
      await right(900, 520);
      await shot("P3", "inside-menu");
      await esc();
      // Audit page: copy the 100×100 source, select the 300×300 target, right-click it → Paste.
      await seed(AUDIT_P3, { select: ["src"], pages: pagesA, active: "Audit" });
      await page.keyboard.press("Meta+c");
      await wait(200);
      await select(["target"]);
      {
        const p = await at("target", 0.4, 0.4);
        await right(p.x, p.y);
      }
      await shot("P3", "normal-context");
      await clickItem("edit.paste");
      await away();
      await shot("P3", "context-paste-result", { extra: async () => (await nodes()).slice(-1) });
      // Right-click empty canvas left of the target so the menu covers it, then Paste here.
      await seed(AUDIT_P3, { select: ["src"], pages: pagesA, active: "Audit" });
      await page.keyboard.press("Meta+c");
      await wait(200);
      await select(["target"]);
      {
        const t = await at("target", 0, 0.6);
        await right(t.x - 40, t.y);
      }
      await shot("P3", "menu-over-parent");
      await clickItem("clipboard.pasteHere");
      await away();
      await shot("P3", "paste-over-parent-result", {
        extra: async () => (await nodes()).slice(-1),
      });
    }

    /* ================= P4 file thumbnail ================= */
    if (wantAny("P4")) {
      const pagesA = ["Audit", "Page 1", "Page 2"];
      await seed(SUNX(), { pages: pagesA, active: "Page 1" });
      await wait(600);
      const fileId = await page.evaluate(() => window.fileLibrary.currentId);
      const openFiles = async () => {
        await page.locator("#files-home").click();
        await page.waitForSelector(`.file-card[data-file-id="${fileId}"]`);
        await wait(900);
        await move(1300, 800);
        await wait(200);
      };
      const back = async () => {
        await page.locator(`.file-card[data-file-id="${fileId}"] .file-open`).click();
        await page.waitForSelector("#canvas-toolbar");
        await wait(700);
      };
      await openFiles();
      await shot("P4", "files-before");
      await back();
      await select(["f1", "inner", "canvasAu"].slice(0, 1));
      {
        const p = await at("f1", 0.8, 0.8);
        await right(p.x, p.y);
      }
      await shot("P4", "thumbnail-menu-before");
      await clickItem("menu.setThumbnail");
      {
        const p = await at("f1", 0.8, 0.8);
        await right(p.x, p.y);
      }
      await shot("P4", "thumbnail-menu-after", { settle: 200 });
      await esc();
      await page
        .waitForSelector("[data-sonner-toast]", { state: "detached", timeout: 15000 })
        .catch(() => {});
      await wait(300);
      await openFiles();
      await shot("P4", "files-after");
      await back();
    }

    /* ================= P5 use as mask ================= */
    if (wantAny("P5")) {
      const pagesA = ["Audit", "Page 1", "Page 2"];
      const opts = { pages: pagesA, active: "Audit" };
      await seed(AUDIT_P5, { ...opts, select: ["source", "target"] });
      await shot("P5", "overlap-siblings");
      await rightRow("target");
      await shot("P5", "mask-menu");
      await clickItem("menu.useAsMask");
      await away();
      await shot("P5", "mask-result", { extra: () => node("target") });
      const showMask = async () => {
        const m = page.locator("#mask-section").first();
        if (await m.count()) {
          await m.scrollIntoViewIfNeeded();
          await wait(250);
        } else missed.push("#mask-section");
      };
      await showMask();
      await shot("P5", "mask-inspector");
      await rightRow("target");
      await shot("P5", "mask-result-menu");
      await clickItem("menu.detachMask");
      await away();
      await shot("P5", "detach-mask", {
        extra: async () =>
          (await nodes()).map((n) => ({
            name: n.name,
            x: n.x,
            y: n.y,
            w: n.w,
            h: n.h,
            masks: n.masks,
          })),
      });
      {
        const detached = (await nodes()).find((n) => n.w === 200 && n.h === 200);
        if (detached) {
          await select([detached.id]);
          await away();
        }
        await shot("P5", "detached-layer-inspector");
      }
      await page.evaluate(() => window.design.runCommand("edit.undo"));
      await wait(300);
      await select(["target"]);
      await showMask();
      await rightRow("target");
      await shot("P5", "remove-menu");
      await clickItem("menu.removeMask");
      await away();
      await shot("P5", "remove-result", { extra: () => node("target") });
    }

    // Metrics: merge with any previous run of other ids.
    const file = path.join(OUT, "metrics.json");
    let previous = [];
    if (only.length)
      previous = JSON.parse(await fs.readFile(file, "utf8").catch(() => "[]")).filter(
        (m) => !metrics.some((n) => n.file === m.file),
      );
    const all = [...previous, ...metrics].sort((a, b) =>
      a.file.localeCompare(b.file, "en", { numeric: true }),
    );
    await fs.writeFile(file, JSON.stringify(all, null, 1));
    console.log(`done: ${metrics.length} shots`);
    if (missed.length) console.log("missed:", missed);
    if (errors.length) console.log("page errors:", errors);
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
