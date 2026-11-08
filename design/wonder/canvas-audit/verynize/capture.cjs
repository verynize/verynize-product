// Verynize side of the canvas parity audit (design/wonder/canvas-audit/CHECKLIST.md).
// Drives the real Electron app with Playwright (temp --user-data-dir, 1440×870 content, device scale factor 2),
// loads one Wonder-like fixture document (an artboard with nested frames, a flex frame with children, text,
// rectangle, image, shader, a hidden and a locked layer, plus a second page), performs each checklist step and saves
// <id>-<state>.png (full window unless noted) next to this file. Every shot also records DOM metrics (open menus and
// their items/separators/shortcuts/disabled state, tooltips, selection chrome, guides, camera, tool, cursor) into
// metrics.json; notes.md is written from those.
//
//   npm run build:ui
//   node design/wonder/canvas-audit/verynize/capture.cjs [--new-only] [id-prefix ...]
//
// `--new-only` keeps every PNG that already exists; id-prefix args (e.g. CM2 T1-move TR) limit the run to files
// whose name starts with one of them. State names follow the Wonder pass in ../wonder/ so make-pairs.py pairs them.
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const { _electron } = require(ROOT + "/node_modules/@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const OUT = __dirname;
const NEW_ONLY = process.argv.includes("--new-only");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const want = (file) => !only.length || only.some((p) => file.startsWith(p));
const wantId = (prefix) =>
  !only.length || only.some((p) => p.startsWith(prefix) || prefix.startsWith(p));

const svg = (markup) => "data:image/svg+xml;base64," + Buffer.from(markup).toString("base64");
const PORTRAIT = svg(
  '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280" viewBox="0 0 280 280"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f59e0b"/><stop offset="1" stop-color="#7c2d12"/></linearGradient></defs><rect width="280" height="280" rx="24" fill="url(#g)"/><circle cx="140" cy="118" r="54" fill="#fde68a"/><rect x="62" y="186" width="156" height="70" rx="35" fill="#fde68a"/></svg>',
);

// Wonder-like fixture (the user's "Porto" file): a 1440×900 artboard with a header, a flex hero, a shader backdrop,
// free-positioned chips for snapping/spacing, a hidden note and a locked badge. A second artboard and page 2 exist
// for the frame label / pages panel ids.
const FIXTURE = [
  {
    id: "art",
    name: "Portfolio Home Desktop",
    type: "frame",
    x: 0,
    y: 0,
    w: 1440,
    h: 900,
    color: "#0d0f14",
    radius: 0,
    clipContent: true,
    layout: "free",
  },
  {
    id: "header",
    name: "Site Header",
    type: "frame",
    parentId: "art",
    x: 0,
    y: 0,
    w: 1440,
    h: 72,
    color: "#151821",
    radius: 0,
    layout: "free",
  },
  {
    id: "logo",
    name: "Logo",
    type: "text",
    parentId: "header",
    x: 40,
    y: 22,
    w: 260,
    h: 30,
    text: "Adam Abdurrahman",
    fontSize: 20,
    color: "#ffffff",
    radius: 0,
  },
  {
    id: "hero",
    name: "Hero Section",
    type: "frame",
    parentId: "art",
    x: 80,
    y: 130,
    w: 1280,
    h: 360,
    color: "#141823",
    radius: 16,
    layout: "flex",
    direction: "row",
    gap: 40,
    padding: 40,
    alignItems: "flex-start",
  },
  {
    id: "heroText",
    name: "Hero Text",
    type: "text",
    parentId: "hero",
    x: 0,
    y: 0,
    w: 560,
    h: 140,
    text: "Muhammad Adam\nAbdurrahman",
    fontSize: 56,
    fontWeight: "700",
    color: "#ffffff",
    radius: 0,
    hMode: "hug",
  },
  {
    id: "heroMedia",
    name: "Hero Media",
    type: "image",
    parentId: "hero",
    x: 0,
    y: 0,
    w: 280,
    h: 280,
    src: PORTRAIT,
    color: "#000000",
    radius: 24,
  },
  {
    id: "accent",
    name: "Accent Card",
    type: "rectangle",
    parentId: "hero",
    x: 0,
    y: 0,
    w: 200,
    h: 280,
    color: "#5eead4",
    radius: 20,
    wMode: "fill",
  },
  {
    id: "glow",
    name: "Ambient Glow Backdrop",
    type: "shader",
    parentId: "art",
    x: 80,
    y: 540,
    w: 600,
    h: 300,
    color: "#a58bdd",
    radius: 16,
    shaderPreset: "aurora",
  },
  {
    id: "about",
    name: "About",
    type: "text",
    parentId: "art",
    x: 760,
    y: 540,
    w: 400,
    h: 56,
    text: "About",
    fontSize: 44,
    fontWeight: "700",
    color: "#ffffff",
    radius: 0,
  },
  {
    id: "chipA",
    name: "Chip A",
    type: "rectangle",
    parentId: "art",
    x: 760,
    y: 640,
    w: 120,
    h: 64,
    color: "#3b82f6",
    radius: 12,
  },
  {
    id: "chipB",
    name: "Chip B",
    type: "rectangle",
    parentId: "art",
    x: 920,
    y: 640,
    w: 120,
    h: 64,
    color: "#8b5cf6",
    radius: 12,
  },
  {
    id: "chipC",
    name: "Chip C",
    type: "rectangle",
    parentId: "art",
    x: 1160,
    y: 640,
    w: 120,
    h: 64,
    color: "#ec4899",
    radius: 12,
  },
  {
    id: "hiddenNote",
    name: "Hidden note",
    type: "text",
    parentId: "art",
    x: 760,
    y: 740,
    w: 300,
    h: 40,
    text: "Hidden note",
    fontSize: 24,
    color: "#ffffff",
    radius: 0,
    hidden: true,
  },
  {
    id: "locked",
    name: "Locked badge",
    type: "rectangle",
    parentId: "art",
    x: 1160,
    y: 760,
    w: 200,
    h: 80,
    color: "#f97316",
    radius: 12,
    locked: true,
  },
  {
    id: "mac",
    name: "MacBook Air",
    type: "frame",
    x: 1560,
    y: 0,
    w: 640,
    h: 416,
    color: "#1f2937",
    radius: 0,
    layout: "free",
  },
  {
    id: "halo",
    name: "Halooo",
    type: "text",
    parentId: "mac",
    x: 40,
    y: 40,
    w: 300,
    h: 60,
    text: "Halooo",
    fontSize: 40,
    color: "#ffffff",
    radius: 0,
  },
];
const PAGE2 = [
  {
    id: "p2rect",
    name: "Rectangle",
    type: "rectangle",
    x: 0,
    y: 0,
    w: 300,
    h: 200,
    color: "#97c3b1",
    radius: 12,
  },
];

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "vp-canvas-audit-"));
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
  try {
    const page = await app.firstWindow({ timeout: 30000 });
    page.on("pageerror", (e) => errors.push(e.message));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 870),
    );
    await page.waitForSelector("#canvas .layer");
    await page.waitForTimeout(600);

    /* ---------- helpers ---------- */
    const wait = (ms) => page.waitForTimeout(ms);
    const exists = (file) =>
      fs.access(path.join(OUT, file)).then(
        () => true,
        () => false,
      );
    const mouse = { x: 0, y: 0 };
    const move = async (x, y, steps = 1) => {
      await page.mouse.move(x, y, { steps });
      mouse.x = x;
      mouse.y = y;
    };
    const away = async () => {
      await move(1430, 300);
      await wait(150);
    };
    const esc = async () => {
      await page.keyboard.press("Escape");
      await wait(120);
    };
    /** Center (or fractional point) of a canvas layer, in client px. */
    const at = (id, fx = 0.5, fy = 0.5) =>
      page.evaluate(
        ([id, fx, fy]) => {
          const r = document.querySelector(`#canvas [data-id="${id}"]`).getBoundingClientRect();
          return { x: r.left + r.width * fx, y: r.top + r.height * fy };
        },
        [id, fx, fy],
      );
    const box = (selector) =>
      page.evaluate((s) => {
        const r = document.querySelector(s)?.getBoundingClientRect();
        return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
      }, selector);
    const rowOf = (id) => `.layer-row[data-id="${id}"]`;
    async function seed({ select = [], camera = "fit", tool = "move" } = {}) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.evaluate(
        ([nodes, page2]) => {
          const d = window.design.getDocument();
          d.pages = [
            { id: "p1", name: "Page 1", nodes },
            { id: "p2", name: "Page 2", nodes: page2 },
          ];
          d.activePage = "p1";
          window.design.setDocument(d);
          window.design.setSelection([]);
          window.design.setTool("move");
        },
        [FIXTURE, PAGE2],
      );
      await wait(300);
      if (camera === "fit") await page.evaluate(() => window.design.zoomToFit());
      else if (camera) await page.evaluate((c) => window.design.setCamera(...c), camera);
      await wait(250);
      if (select.length) await page.evaluate((ids) => window.design.setSelection(ids), select);
      if (tool !== "move") await page.evaluate((t) => window.design.setTool(t), tool);
      await wait(200);
      await away();
    }
    const state = (point) =>
      page.evaluate((point) => {
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
        const text = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
        const style = (el) => {
          const s = getComputedStyle(el);
          return {
            bg: s.backgroundColor,
            border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
            radius: s.borderTopLeftRadius,
            padding: s.padding,
            font: `${s.fontWeight} ${s.fontSize}/${s.lineHeight} ${s.fontFamily.split(",")[0]}`,
            color: s.color,
            shadow: s.boxShadow,
          };
        };
        // Menus: the legacy #canvas-menu plus every Radix menu/popover/tooltip that is open.
        const seen = new Set();
        const menus = [];
        for (const m of document.querySelectorAll(
          "#canvas-menu,[role=menu],[role=dialog],dialog[open],[data-radix-popper-content-wrapper] > *",
        )) {
          if (seen.has(m) || !vis(m)) continue;
          seen.add(m);
          for (const inner of m.querySelectorAll("[role=menu]")) seen.add(inner);
          const items = [];
          for (const i of m.querySelectorAll(
            "[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],hr,[role=separator],[role=group] > [data-slot=label],dt,p,label,input,button",
          )) {
            if (!vis(i)) continue;
            if (i.tagName === "HR" || i.getAttribute("role") === "separator") {
              items.push({ separator: true, ...rect(i) });
              continue;
            }
            if (i.tagName === "BUTTON" && i.parentElement?.closest("[role=menuitem]")) continue;
            const kbd = i.querySelector("kbd,[data-slot$=shortcut],[data-shortcut]");
            const label = kbd ? text(i).replace(text(kbd), "").trim() : text(i);
            items.push({
              text: label || i.getAttribute("aria-label") || i.getAttribute("placeholder") || "",
              kbd: kbd ? text(kbd) : undefined,
              dd: i.tagName === "DT" ? text(i.nextElementSibling) : undefined,
              disabled:
                i.disabled ||
                i.getAttribute("aria-disabled") === "true" ||
                i.dataset.disabled !== undefined ||
                undefined,
              submenu: i.getAttribute("aria-haspopup") === "menu" || undefined,
              highlighted: i.dataset.highlighted !== undefined || i.matches(":hover") || undefined,
              command: i.dataset.command,
              ...rect(i),
            });
          }
          menus.push({
            id: m.id || undefined,
            role: m.getAttribute("role") || m.tagName.toLowerCase(),
            ...rect(m),
            style: style(m),
            itemStyle: m.querySelector("[role=menuitem]")
              ? style(m.querySelector("[role=menuitem]"))
              : undefined,
            text: text(m).slice(0, 900),
            items,
          });
        }
        const q = (s) => document.querySelector(s);
        const ov = (s) => [...document.querySelectorAll(s)].filter(vis).map(rect);
        const measure = q("#selection-measure"),
          name = q("#selection-name");
        const hit = point && document.elementFromPoint(point.x, point.y);
        const cam = window.design.getCamera();
        return {
          selection: window.design.getSelection(),
          tool: window.design.getTool(),
          camera: { x: r2(cam.x), y: r2(cam.y), zoom: cam.zoom },
          zoomLabel: text(q("#zoom-menu-button")),
          bodyClass: document.body.className,
          menus,
          badge: vis(measure)
            ? { text: text(measure), ...rect(measure), style: style(measure) }
            : null,
          nameLabel: vis(name) ? { text: text(name), ...rect(name) } : null,
          frameLabels: [...document.querySelectorAll("#canvas-overlay .frame-label")]
            .filter(vis)
            .map((l) => ({ text: text(l), ...rect(l) })),
          hover: ov("#canvas-overlay .hover-box"),
          hoverChildren: ov("#canvas-overlay .hover-child").length,
          handles: ov("#canvas .handle, #canvas-overlay .handle"),
          guides: [...document.querySelectorAll("#canvas-overlay .guide-layer line")].map((l) => ({
            cls: l.getAttribute("class"),
            x1: r2(+l.getAttribute("x1")),
            y1: r2(+l.getAttribute("y1")),
            x2: r2(+l.getAttribute("x2")),
            y2: r2(+l.getAttribute("y2")),
          })),
          guideLabels: [...document.querySelectorAll("#canvas-overlay .guide-label")].map(text),
          marquee: ov("#canvas-overlay .marquee"),
          drop: { box: ov("#canvas-overlay .drop-target"), line: ov("#canvas-overlay .drop-line") },
          spacingBands: [...document.querySelectorAll("#canvas-overlay .spacing-band")].map(
            (b) => ({ cls: b.className, ...rect(b) }),
          ),
          textEditing: !!q("[data-text-editing]"),
          pointer: point
            ? {
                ...point,
                target: hit
                  ? hit.id
                    ? "#" + hit.id
                    : (hit.className?.baseVal ?? hit.className)
                  : null,
                cursor: hit ? getComputedStyle(hit).cursor : null,
              }
            : null,
          focused: document.activeElement
            ? document.activeElement.id || document.activeElement.tagName
            : null,
        };
      }, point);
    const nodesNow = () =>
      page.evaluate(
        () =>
          window.design
            .getDocument()
            .pages.find((p) => p.id === window.design.getDocument().activePage)?.nodes ?? [],
      );
    /** Screenshot (full window by default; `clip` = {x,y,width,height} in CSS px) + metrics. */
    async function shot(id, name, opts = {}) {
      const file = `${id}-${name}.png`;
      if (!want(file)) return false;
      if (NEW_ONLY && (await exists(file))) {
        console.log("keep", file);
        return false;
      }
      if (opts.before) await opts.before();
      await page.screenshot({
        path: path.join(OUT, file),
        ...(opts.clip ? { clip: opts.clip } : {}),
      });
      const s = await state({ x: mouse.x, y: mouse.y });
      const nodes =
        opts.nodes === false ? undefined : (await nodesNow()).map(({ src, textRuns, ...n }) => n);
      metrics.push({
        file,
        id,
        state: name,
        clip: opts.clip || "window",
        ...s,
        nodes,
        ...(opts.extra ? { extra: await opts.extra() } : {}),
      });
      console.log("shot", file);
      return true;
    }
    const right = async (x, y) => {
      await move(x, y);
      await page.mouse.click(x, y, { button: "right" });
      await wait(250);
    };
    const hoverMenu = async (text) => {
      const item = page.locator("#canvas-menu [role=menuitem]", { hasText: text }).first();
      if (await item.count()) {
        const b = await item.boundingBox();
        await move(b.x + b.width / 2, b.y + b.height / 2);
        await wait(150);
      }
    };
    const menuOpen = () => page.evaluate(() => !!document.querySelector("#canvas-menu"));
    const closeAll = async () => {
      await esc();
      await page.mouse.click(1430, 300).catch(() => {});
      await wait(100);
    };
    /** Press, drag in steps, run `during` (screenshot) before releasing. */
    async function drag(from, to, during, { steps = 12, mods = [], button = "left" } = {}) {
      await move(from.x, from.y);
      for (const m of mods) await page.keyboard.down(m);
      await page.mouse.down({ button });
      await move(to.x, to.y, steps);
      await wait(150);
      if (during) await during();
      await page.mouse.up({ button });
      for (const m of mods) await page.keyboard.up(m);
      await wait(200);
    }
    const emptyCanvas = async () => {
      const w = await box("#canvas-wrap");
      const a = await at("art", 1, 1);
      return { x: Math.min(w.x + w.w - 60, a.x + 60), y: w.y + 30 };
    };

    /* ================= CM. Context menus ================= */
    if (wantId("CM")) {
      // CM1 / CM10: a fresh clipboard first (the app's internal clipboard is empty at launch).
      await seed();
      const blank = await emptyCanvas();
      await right(blank.x, blank.y);
      await shot("CM1", "empty");
      await shot("CM10", "empty-clipboard");
      await closeAll();

      // CM2: right-click the artboard background.
      await seed();
      const artBg = await at("art", 0.5, 0.97);
      await right(artBg.x, artBg.y);
      await shot("CM2", "frame");
      // Wonder's four submenus have no Verynize counterpart: hover the nearest flat items instead.
      for (const [state, item] of [
        ["copy-as", "Copy as PNG"],
        ["select-layer", "Select all matching layers"],
        ["arrange", "Bring to front"],
        ["layout", "Add auto layout"],
      ]) {
        if (!(await menuOpen())) await right(artBg.x, artBg.y);
        await hoverMenu(item);
        await shot("CM2", state);
      }
      await closeAll();

      // CM3 text, CM4 rectangle / image / shader (each right-clicked directly on the canvas).
      for (const [id, state, nodeId] of [
        ["CM3", "text", "about"],
        ["CM4", "rectangle", "chipA"],
        ["CM4", "image", "heroMedia"],
        ["CM4", "shader", "glow"],
      ]) {
        await seed({ select: nodeId === "heroMedia" ? ["hero"] : [] });
        const p = await at(nodeId);
        await right(p.x, p.y);
        await shot(id, state);
        await closeAll();
      }
      // CM5 multi-selection.
      await seed({ select: ["chipA", "chipB", "about"] });
      const pB = await at("chipB");
      await right(pB.x, pB.y);
      await shot("CM5", "multi");
      await closeAll();
      // CM6 hidden layer (selected from the layers panel; it has no canvas box) and locked layer (right-click on it).
      await seed({ select: ["hiddenNote"] });
      const blank2 = await emptyCanvas();
      await right(blank2.x, blank2.y);
      await shot("CM6", "hidden");
      await closeAll();
      await seed();
      const pL = await at("locked");
      await right(pL.x, pL.y);
      await shot("CM6", "locked");
      await closeAll();
      // CM7 layers panel row, CM8 pages panel row (Radix context menus).
      await seed({ select: ["hero"] });
      const row = page.locator(rowOf("hero")).first();
      if (await row.count()) {
        const b = await row.boundingBox();
        await right(b.x + b.width / 2, b.y + b.height / 2);
        await shot("CM7", "row");
        await closeAll();
      } else console.log("missing layer row");
      await seed();
      const pr = page.locator('[data-page-id="p1"]').first();
      if (await pr.count()) {
        const b = await pr.boundingBox();
        await right(b.x + b.width / 2, b.y + b.height / 2);
        await shot("CM8", "page");
        await closeAll();
      }
      // CM9 the artboard name label (only drawn while the artboard is not selected).
      await seed();
      const label = page.locator('#canvas-overlay .frame-label[data-id="art"]').first();
      if (await label.count()) {
        const b = await label.boundingBox();
        await right(b.x + 20, b.y + b.height / 2);
        await shot("CM9", "label");
        await closeAll();
      }
      // CM10 with something copied.
      await seed({ select: ["chipA"] });
      await page.keyboard.press("Meta+c");
      await wait(150);
      const blank3 = await emptyCanvas();
      await right(blank3.x, blank3.y);
      await shot("CM10", "copied");
      await closeAll();
    }

    /* ================= T. Toolbar and tools ================= */
    if (wantId("T1") || wantId("T2") || wantId("T3") || wantId("T5") || wantId("T6")) {
      await seed();
      const tip = async (selector, wait_ = 1200) => {
        const b = await box(selector);
        if (!b) return false;
        await move(b.x + b.w / 2, b.y + b.h / 2);
        await wait(wait_);
        return true;
      };
      for (const [state, sel, tool] of [
        ["move", "#select-tool", "move"],
        ["scale", "#scale-tool", "scale"],
        ["hand", "#pan-tool", "hand"],
        ["eyedropper", "#eyedropper-tool", null],
        ["frame", "#add-frame", "frame"],
        ["ellipse", "#add-ellipse", "ellipse"],
        ["shader", "#add-shader", "shader"],
        ["text", "#text", "text"],
        ["view-a", "#layout-details", null],
        ["view-b", "#layout-design", null],
        ["plus", "#bd-view-menu-button", null],
      ]) {
        if (!want(`T1-${state}.png`)) continue;
        // Radix closes the previous tooltip on leave; wait past its skip-delay window so every hover opens a fresh one.
        await move(1100, 450);
        await wait(700);
        if (tool) await page.evaluate((t) => window.design.setTool(t), tool);
        await wait(150);
        await tip(sel);
        // Every other hover lands while Radix is still closing the last tooltip; re-enter until one is open.
        for (
          let i = 0;
          i < 3 &&
          !(await page.evaluate(
            () =>
              !!document.querySelector("[data-radix-popper-content-wrapper] [data-state$=open]"),
          ));
          i++
        ) {
          await move(1100, 450);
          await wait(400);
          await tip(sel);
        }
        await shot("T1", state);
        await page.evaluate(() => window.design.setTool("move"));
      }
      await away();
      // T2 the `+` (Views) menu.
      if (want("T2-plus.png")) {
        await page.click("#bd-view-menu-button");
        await wait(300);
        await shot("T2", "plus");
        await closeAll();
      }
      // T3 the two layout toggles.
      if (want("T3-")) {
        await page.click("#layout-details");
        await wait(500);
        await away();
        await shot("T3", "details");
        await page.click("#layout-design");
        await wait(500);
        await away();
        await shot("T3", "design");
      }
      // T5 `?` help, T6 zoom label menu.
      if (want("T5-help.png")) {
        await page.click("#bd-canvas-help");
        await wait(350);
        await shot("T5", "help");
        await closeAll();
      }
      if (want("T6-zoom.png")) {
        await page.click("#zoom-menu-button");
        await wait(350);
        await shot("T6", "zoom");
        await closeAll();
      }
    }
    if (wantId("T4")) {
      // Scale tool: drag a corner of the selected hero (content and font sizes scale).
      await seed({ select: ["header"] });
      await page.keyboard.press("k");
      await wait(100);
      const se = await at("header", 1, 1);
      await drag({ x: se.x - 1, y: se.y - 1 }, { x: se.x + 80, y: se.y + 20 }, () =>
        shot("T4", "scale"),
      );
      await shot("T4", "scale-after", {
        extra: () =>
          page.evaluate(() =>
            window.design
              .getDocument()
              .pages[0].nodes.filter((n) => ["header", "logo"].includes(n.id))
              .map((n) => ({ id: n.id, w: n.w, h: n.h, fontSize: n.fontSize })),
          ),
      });
      // Shader tool: drag on empty canvas (inside the artboard → parented to it).
      await seed();
      await page.keyboard.press("s");
      await wait(100);
      const a = await at("art", 0.55, 0.08),
        b = await at("art", 0.75, 0.13);
      await drag({ x: a.x, y: a.y + 30 }, { x: b.x, y: b.y + 30 }, () => shot("T4", "shader"));
      await away();
      await shot("T4", "shader-after");
      // Text tool: click (default box) vs drag.
      await seed();
      await page.keyboard.press("t");
      await wait(100);
      const blank = await emptyCanvas();
      await move(blank.x - 200, blank.y + 20);
      await page.mouse.click(blank.x - 200, blank.y + 20);
      await wait(300);
      await shot("T4", "text-click");
      await esc();
    }

    /* ================= S. Selection ================= */
    if (wantId("S")) {
      await seed();
      let p = await at("accent");
      await move(p.x, p.y);
      await wait(200);
      await shot("S1", "hover");
      // Nested child: with the hero selected, hovering inside it outlines the child a click would pick.
      await seed({ select: ["hero"] });
      p = await at("heroMedia");
      await move(p.x, p.y);
      await wait(200);
      await shot("S1", "hover-nested");
      // ⌘ held: deep hover.
      await seed();
      p = await at("heroMedia");
      await move(p.x, p.y);
      await page.keyboard.down("Meta");
      await wait(200);
      await shot("S1", "hover-deep-cmd");
      await page.keyboard.up("Meta");
      // S2 click on a child inside the artboard (classic) → direct child of the artboard.
      await seed();
      p = await at("heroMedia");
      await move(p.x, p.y);
      await page.mouse.click(p.x, p.y);
      await wait(250);
      await away();
      await shot("S2", "classic");
      // second click (already selected) drills one level.
      await move(p.x, p.y);
      await page.mouse.click(p.x, p.y);
      await wait(250);
      await away();
      await shot("S2", "drill");
      await seed();
      await move(p.x, p.y);
      await page.mouse.click(p.x, p.y, { modifiers: ["Meta"] });
      await wait(250);
      await away();
      await shot("S2", "click-deep-cmd");
      await seed();
      await move(p.x, p.y);
      await page.mouse.dblclick(p.x, p.y);
      await wait(300);
      await away();
      await shot("S2", "double");
      await page.keyboard.press("Escape");
      await wait(250);
      await shot("S2", "escape");
      await seed({ select: ["hero"] });
      const blank = await emptyCanvas();
      await move(blank.x, blank.y);
      await page.mouse.click(blank.x, blank.y);
      await wait(250);
      await shot("S2", "empty-click");
      // S3 shift-click add/remove.
      await seed({ select: ["chipA"] });
      p = await at("chipB");
      await move(p.x, p.y);
      await page.mouse.click(p.x, p.y, { modifiers: ["Shift"] });
      await wait(250);
      await away();
      await shot("S3", "shift-add");
      await move(p.x, p.y);
      await page.mouse.click(p.x, p.y, { modifiers: ["Shift"] });
      await wait(250);
      await away();
      await shot("S3", "shift-remove");
      // Marquee from empty canvas across the artboard; and from the artboard's own background.
      await seed();
      const w = await box("#canvas-wrap"),
        art = await box('#canvas [data-id="art"]');
      await drag(
        { x: w.x + 20, y: w.y + 10 },
        { x: art.x + art.w * 0.4, y: art.y + art.h * 0.3 },
        () => shot("S3", "marquee"),
      );
      await shot("S3", "marquee-result");
      await seed();
      const c1 = await at("art", 0.5, 0.64),
        c2 = await at("art", 0.9, 0.8);
      await drag(c1, c2, () => shot("S3", "marquee-inside-frame"));
      await shot("S3", "marquee-inside-result");
      // S4 selection chrome.
      await seed({ select: ["art"] });
      await shot("S4", "frame");
      await seed({ select: ["heroText"] });
      await shot("S4", "hug");
      await seed({ select: ["accent"] });
      await shot("S4", "fill");
      await seed({ select: ["heroMedia"] });
      await shot("S4", "fixed");
      await seed({ select: ["chipA", "chipB", "about"] });
      await shot("S4", "multi-selection");
    }

    /* ================= TR. Transform ================= */
    if (wantId("TR")) {
      await seed({ select: ["chipC"] });
      let se = await at("chipC", 1, 1);
      await drag({ x: se.x - 1, y: se.y - 1 }, { x: se.x + 40, y: se.y + 18 }, () =>
        shot("TR1", "corner"),
      );
      await seed({ select: ["chipC"] });
      await drag(
        { x: se.x - 1, y: se.y - 1 },
        { x: se.x + 40, y: se.y + 4 },
        () => shot("TR1", "shift"),
        { mods: ["Shift"] },
      );
      await seed({ select: ["chipC"] });
      await drag(
        { x: se.x - 1, y: se.y - 1 },
        { x: se.x + 30, y: se.y + 15 },
        () => shot("TR1", "alt"),
        { mods: ["Alt"] },
      );
      // Edge (no edge handles in Verynize): hover the right edge midpoint and record the cursor.
      await seed({ select: ["chipC"] });
      const edge = await at("chipC", 1, 0.5);
      await move(edge.x - 1, edge.y);
      await wait(150);
      await shot("TR1", "edge-hover");
      // TR2 rotate zone just outside the NE corner, plus the inspector rotation field.
      await seed({ select: ["chipC"] });
      const ne = await at("chipC", 1, 0);
      await move(ne.x + 10, ne.y - 10);
      await wait(200);
      await shot("TR2", "hover");
      await drag({ x: ne.x + 10, y: ne.y - 10 }, { x: ne.x + 30, y: ne.y + 30 }, () =>
        shot("TR2", "rotate"),
      );
      // TR3 nudge.
      await seed({ select: ["chipC"] });
      const before = (await nodesNow()).find((n) => n.id === "chipC");
      await page.keyboard.press("ArrowRight");
      await wait(100);
      await shot("TR3", "nudge", {
        extra: async () => ({
          before: before.x,
          after: (await nodesNow()).find((n) => n.id === "chipC").x,
        }),
      });
      await page.keyboard.press("Shift+ArrowRight");
      await wait(100);
      await shot("TR3", "shift-nudge", {
        extra: async () => ({
          before: before.x,
          after: (await nodesNow()).find((n) => n.id === "chipC").x,
        }),
      });
      // TR4 smart guides: drag Chip C so its top aligns with About's bottom-ish / equal spacing with A–B (gap 40).
      await seed({ select: ["chipC"] });
      let c = await at("chipC");
      const z = (await page.evaluate(() => window.design.getCamera())).zoom;
      await drag(c, { x: c.x - 75 * z + 2, y: c.y + 3 }, () => shot("TR4", "guide"));
      await seed({ select: ["chipC"] });
      c = await at("chipC");
      await drag(c, { x: c.x + 20, y: c.y - 100 * z + 2 }, () => shot("TR4", "sibling"));
      // TR5 Alt-hover distances: selected Chip A, Alt over Chip B (node-to-node) and over the artboard (child-to-parent).
      await seed({ select: ["chipA"] });
      c = await at("chipB");
      await move(c.x, c.y);
      await page.keyboard.down("Alt");
      await move(c.x + 2, c.y + 1);
      await wait(200);
      await shot("TR5", "alt-sibling");
      await page.keyboard.up("Alt");
      const blankArt = await at("art", 0.97, 0.05);
      await move(blankArt.x, blankArt.y);
      await page.keyboard.down("Alt");
      await move(blankArt.x + 1, blankArt.y + 1);
      await wait(200);
      await shot("TR5", "alt-parent");
      await page.keyboard.up("Alt");
      // TR6 Alt-drag duplicate.
      await seed({ select: ["chipA"] });
      c = await at("chipA");
      await drag(c, { x: c.x, y: c.y + 60 }, () => shot("TR6", "alt-duplicate"), { mods: ["Alt"] });
      await shot("TR6", "alt-drag-result");
      // TR7 drag Chip A into the flex hero (drop line) and reorder Accent Card inside the stack.
      await seed({ select: ["chipA"] });
      c = await at("chipA");
      const into = await at("heroMedia", 0.85, 0.5);
      await drag(c, into, () => shot("TR7", "drag-into-flex"), { steps: 20 });
      await shot("TR7", "drag-into-flex-result");
      await seed({ select: ["hero"] });
      const acc = await at("accent");
      await page.mouse.click(acc.x, acc.y);
      await wait(200);
      const to = await at("heroText", 0.2, 0.5);
      await drag(acc, to, () => shot("TR7", "reorder-during"), { steps: 20 });
      await shot("TR7", "reorder-after");
      await seed({ select: ["chipB"] });
      c = await at("chipB");
      const outside = await at("mac", 0.5, 0.6);
      await drag(c, outside, () => shot("TR7", "out-during"), { steps: 20 });
      // TR8 padding/gap handles on the selected flex frame (hover a gap band and a padding band).
      await seed({ select: ["hero"] });
      // Bands are drawn only while the pointer is over the selected auto-layout frame.
      const heroIn = await at("hero", 0.5, 0.95);
      await move(heroIn.x, heroIn.y);
      await wait(250);
      const bands = await page.evaluate(() =>
        [...document.querySelectorAll("#canvas-overlay .spacing-band")].map((b) => {
          const r = b.getBoundingClientRect();
          return { cls: b.className, x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }),
      );
      await shot("TR8", "flex");
      const gap = bands.find((b) => b.cls.includes("gap")),
        pad = bands.find((b) => b.cls.includes("padding"));
      if (gap) {
        await move(gap.x, gap.y);
        await wait(200);
        await shot("TR8", "hover");
        await drag({ x: gap.x, y: gap.y }, { x: gap.x + 20, y: gap.y }, () =>
          shot("TR8", "gap-padding"),
        );
      }
      await seed({ select: ["hero"] });
      await move(heroIn.x, heroIn.y);
      await wait(250);
      if (pad) {
        await move(pad.x, pad.y);
        await wait(200);
        await shot("TR8", "padding-hover");
      }
    }

    /* ================= V. View / camera ================= */
    if (wantId("V")) {
      await seed({ select: ["heroMedia"] });
      await page.keyboard.press("Meta+Equal");
      await wait(250);
      await shot("V1", "in");
      await page.keyboard.press("Meta+Minus");
      await page.keyboard.press("Meta+Minus");
      await wait(250);
      await shot("V1", "out");
      await page.keyboard.press("Shift+Digit0");
      await wait(250);
      await shot("V1", "100");
      await page.keyboard.press("Shift+Digit1");
      await wait(250);
      await shot("V1", "shift1-fit");
      await page.keyboard.press("Shift+Digit2");
      await wait(250);
      await shot("V1", "shift2-selection");
      await seed();
      const p = await at("heroMedia");
      await move(p.x, p.y);
      await page.keyboard.down("Control");
      for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -8);
      await page.keyboard.up("Control");
      await wait(250);
      await shot("V1", "pinch-at-cursor");
      // V2 space-drag and hand.
      await seed();
      const a = await at("art", 0.5, 0.5);
      await move(a.x, a.y);
      await page.keyboard.down("Space");
      await wait(150);
      await shot("V2", "space-hold");
      await drag(a, { x: a.x + 120, y: a.y + 60 }, () => shot("V2", "space-drag"));
      await page.keyboard.up("Space");
      await seed({ tool: "hand" });
      await move(a.x, a.y);
      await wait(150);
      await drag(a, { x: a.x - 100, y: a.y - 40 }, () => shot("V2", "hand"));
      // V3 fit and selection results.
      await seed({ select: ["chipA"] });
      await page.evaluate(() => window.design.setCamera(-400, -300, 2));
      await wait(200);
      await page.keyboard.press("Shift+Digit1");
      await wait(250);
      await shot("V3", "fit");
      await page.keyboard.press("Shift+Digit2");
      await wait(250);
      await shot("V3", "selection");
      // V4 high zoom (no rulers / pixel grid expected).
      await seed({ select: ["chipA"] });
      const corner = await at("chipA", 0, 0);
      await page.evaluate(
        ([x, y]) => {
          const r = document.querySelector("#canvas-wrap").getBoundingClientRect();
          const c = window.design.getCamera();
          const wx = (x - r.left - c.x) / c.zoom,
            wy = (y - r.top - c.y) / c.zoom;
          window.design.setCamera(r.width / 2 - wx * 32, r.height / 2 - wy * 32, 32);
        },
        [corner.x, corner.y],
      );
      await wait(400);
      await shot("V4", "high-zoom");
    }

    /* ================= K. Keyboard and clipboard ================= */
    if (wantId("K")) {
      await seed();
      if (want("K1-shortcuts.png")) {
        await page.click("#bd-canvas-help");
        await wait(350);
        await shot("K1", "shortcuts");
        await closeAll();
      }
      if (want("K1-command-palette.png")) {
        await page.keyboard.press("Meta+k");
        await wait(500);
        await shot("K1", "command-palette");
        await esc();
        await esc();
      }
      // K2 copy/paste, duplicate offset, paste in place (⌘⇧V, Verynize's nearest to Paste over selection).
      await seed({ select: ["chipA"] });
      await page.keyboard.press("Meta+c");
      await wait(100);
      await page.keyboard.press("Meta+v");
      await wait(400);
      await away();
      await shot("K2", "paste", {
        extra: async () =>
          (await nodesNow())
            .slice(-1)
            .map((n) => ({ id: n.id, name: n.name, x: n.x, y: n.y, parentId: n.parentId })),
      });
      await seed({ select: ["chipA"] });
      await page.keyboard.press("Meta+d");
      await wait(300);
      await shot("K2", "duplicate", {
        extra: async () =>
          (await nodesNow())
            .filter((n) => n.name.startsWith("Chip A"))
            .map((n) => ({ id: n.id, x: n.x, y: n.y })),
      });
      await seed({ select: ["chipA"] });
      await page.keyboard.press("Meta+c");
      await wait(100);
      await page.evaluate(() => window.design.setSelection(["chipC"]));
      await wait(100);
      await page.keyboard.press("Meta+Shift+v");
      await wait(400);
      await shot("K2", "over", {
        extra: async () =>
          (await nodesNow())
            .slice(-2)
            .map((n) => ({ id: n.id, name: n.name, x: n.x, y: n.y, parentId: n.parentId })),
      });
      await seed({ select: ["chipA"] });
      await page.keyboard.press("Meta+c");
      await wait(100);
      await page.evaluate(() => window.design.setSelection(["chipC"]));
      await wait(100);
      await page.keyboard.press("Meta+Shift+r");
      await wait(400);
      await shot("K2", "replace", { extra: async () => (await nodesNow()).map((n) => n.id) });
      // Paste here: right-click the empty canvas and choose Paste (no "Paste here" item).
      await seed({ select: ["chipA"] });
      await page.keyboard.press("Meta+c");
      await wait(100);
      const blank = await emptyCanvas();
      await right(blank.x - 100, blank.y + 100);
      await page
        .locator('#canvas-menu [data-command="edit.paste"]')
        .click()
        .catch(() => {});
      await wait(400);
      await away();
      await shot("K2", "paste-here", {
        extra: async () =>
          (await nodesNow())
            .slice(-1)
            .map((n) => ({ id: n.id, x: n.x, y: n.y, parentId: n.parentId })),
      });
      // K3 frame / unframe / delete / hide / lock.
      await seed({ select: ["chipA", "chipB"] });
      await page.keyboard.press("Meta+g");
      await wait(300);
      await shot("K3", "frame-selection");
      await page.keyboard.press("Meta+Shift+g");
      await wait(300);
      await shot("K3", "unframe");
      await seed({ select: ["chipA"] });
      await page.keyboard.press("Meta+Shift+h");
      await wait(300);
      await shot("K3", "hide");
      await seed({ select: ["chipA"] });
      await page.keyboard.press("Meta+Shift+l");
      await wait(300);
      await shot("K3", "lock");
      await seed({ select: ["chipA"] });
      await page.keyboard.press("Backspace");
      await wait(300);
      await shot("K3", "delete");
    }

    /* ================= TX. Text on canvas ================= */
    if (wantId("TX")) {
      await seed();
      await page.keyboard.press("t");
      await wait(100);
      const blank = await emptyCanvas();
      await move(blank.x - 250, blank.y + 40);
      await page.mouse.click(blank.x - 250, blank.y + 40);
      await wait(400);
      await shot("TX1", "click", {
        extra: () =>
          page.evaluate(() => {
            const el = document.querySelector("[data-text-editing]");
            if (!el) return null;
            const s = getComputedStyle(el);
            return {
              text: el.innerText,
              font: s.fontFamily,
              size: s.fontSize,
              color: s.color,
              caret: s.caretColor,
              selection: getSelection().toString(),
            };
          }),
      });
      await page.keyboard.type("Hello");
      await wait(150);
      await page.keyboard.press("Shift+ArrowLeft");
      await page.keyboard.press("Shift+ArrowLeft");
      await wait(150);
      await shot("TX1", "selection", {
        extra: () => page.evaluate(() => getSelection().toString()),
      });
      await page.keyboard.press("Escape");
      await wait(300);
      await shot("TX1", "escape");
      await seed();
      await page.keyboard.press("t");
      await wait(100);
      const a = await at("art", 0.55, 0.05),
        b = await at("art", 0.8, 0.12);
      await drag({ x: a.x, y: a.y + 40 }, { x: b.x, y: b.y + 40 }, () => shot("TX1", "drag"));
      await shot("TX1", "drag-result");
      await esc();
    }

    /* ================= L. Layers and pages ================= */
    if (wantId("L")) {
      await seed({ select: [] });
      const row = page.locator(rowOf("hero")).first();
      if (await row.count()) {
        const b = await row.boundingBox();
        await move(b.x + b.width / 2, b.y + b.height / 2);
        await wait(200);
        await shot("L1", "hover", {
          extra: () =>
            page.evaluate(() => {
              const r = document.querySelector('.layer-row[data-id="hero"]');
              const s = getComputedStyle(r);
              return {
                h: r.getBoundingClientRect().height,
                bg: s.backgroundColor,
                buttons: [...r.querySelectorAll("button")]
                  .filter((x) => x.getBoundingClientRect().width)
                  .map((x) => x.getAttribute("aria-label")),
              };
            }),
        });
        await page.mouse.dblclick(b.x + 80, b.y + b.height / 2);
        await wait(300);
        await shot("L1", "rename");
        await esc();
        const target = page.locator(rowOf("glow")).first();
        if (await target.count()) {
          const tb = await target.boundingBox();
          await drag(
            { x: b.x + 90, y: b.y + b.height / 2 },
            { x: tb.x + 90, y: tb.y + tb.height - 3 },
            () => shot("L1", "reorder-during"),
            { steps: 16 },
          );
        }
        await seed({ select: [] });
        const chevron = page
          .locator(
            `${rowOf("hero")} button[aria-label^="Collapse"], ${rowOf("hero")} button[aria-label^="Expand"]`,
          )
          .first();
        if (await chevron.count()) {
          await chevron.click();
          await wait(250);
          await away();
          await shot("L1", "expand-collapse");
        }
      }
      // L2 pages.
      await seed();
      await page.click("#add-page");
      await wait(300);
      await away();
      await shot("L2", "add");
      await seed();
      const p1 = page.locator('[data-page-id="p1"]').first();
      if (await p1.count()) {
        await p1.dblclick();
        await wait(400);
        await shot("L2", "rename");
        await esc();
        const p2 = page.locator('[data-page-id="p2"]').first();
        const b2 = await p2.boundingBox();
        await right(b2.x + b2.width / 2, b2.y + b2.height / 2);
        const del = page.getByRole("menuitem", { name: "Delete page" });
        if (await del.count()) {
          await del.click();
          await wait(400);
        }
        await away();
        await shot("L2", "page-delete");
        await seed();
        const bb = await p1.boundingBox(),
          t2 = await page.locator('[data-page-id="p2"]').first().boundingBox();
        await drag(
          { x: bb.x + 60, y: bb.y + bb.height / 2 },
          { x: t2.x + 60, y: t2.y + t2.height - 2 },
          () => shot("L2", "reorder-during"),
          { steps: 12 },
        );
      }
    }

    const file = path.join(OUT, "metrics.json");
    let previous = [];
    if (only.length || NEW_ONLY)
      previous = JSON.parse(await fs.readFile(file, "utf8").catch(() => "[]")).filter(
        (m) => !metrics.some((n) => n.file === m.file),
      );
    // Drop entries whose PNG no longer exists (renamed states).
    previous = (
      await Promise.all(previous.map(async (m) => ((await exists(m.file)) ? m : null)))
    ).filter(Boolean);
    const all = [...previous, ...metrics].sort((a, b) =>
      a.file.localeCompare(b.file, "en", { numeric: true }),
    );
    await fs.writeFile(file, JSON.stringify(all, null, 1));
    console.log(`done: ${metrics.length} shots`);
    if (errors.length) console.log("page errors:", errors);
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
