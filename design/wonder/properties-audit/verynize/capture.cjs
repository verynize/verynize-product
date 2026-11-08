// Verynize side of the Properties-panel parity audit (design/wonder/properties-audit/CHECKLIST.md).
// Drives the real Electron app with Playwright (temp --user-data-dir, 1440×870 content, deviceScaleFactor 2),
// sets up one fixture document per state, clicks the real inspector controls and saves
// <id>-<state>.png cropped to the inspector panel (#properties, plus any open menu/popover to its left).
// Every shot also records DOM metrics (header buttons, row controls, select options, canvas computed style)
// into metrics.json next to the PNGs; notes.md is written from those.
//
//   npm run build:ui
//   node design/wonder/properties-audit/verynize/capture.cjs [only-prefix ...]
const ROOT = require("node:path").resolve(__dirname, "../../../..");
const { _electron } = require(ROOT + "/node_modules/@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const OUT = __dirname;
// `--new-only` never overwrites a PNG that already exists (used for the 2026-10-31 follow-up pass).
const NEW_ONLY = process.argv.includes("--new-only");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
// Follow-up ids (notes-2026-10-31.md): D1/D2 frame tool + defaults, G1–G6 top remaining gaps, H1–H9 assumptions.
// Their names follow the Wonder pass in wonder/notes-2026-10-31.md so make-pairs.py pairs them.
const FOLLOW_UP = /^(D[12]|G[1-6]|H[1-9])-/;
const onlyFollowUp =
  only.length > 0 && only.every((p) => FOLLOW_UP.test(p.endsWith("-") ? p : p + "-"));

const TOKENS = { surface: "#111827", "surface/base": "#172033", accent: "#5EEAD4", ink: "#000000" };
const VARIABLES = {
  spacing: { type: "dimension", value: 24 },
  strength: { type: "number", value: 60 },
};
const svg = (markup) => "data:image/svg+xml;base64," + Buffer.from(markup).toString("base64");
const CARD = {
  id: "card",
  name: "Card",
  type: "frame",
  x: 100,
  y: 100,
  w: 270,
  h: 340,
  color: "#ffffff",
  radius: 0,
  clipContent: true,
};
const card = (patch = {}) => [{ ...CARD, ...patch }];

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "vp-props-audit-"));
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
  try {
    const page = await app.firstWindow({ timeout: 30000 });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 870),
    );
    await page.waitForSelector("#canvas .layer");
    await page.waitForTimeout(500);

    /* ---------- helpers ---------- */
    const exists = (file) =>
      fs.access(path.join(OUT, file)).then(
        () => true,
        () => false,
      );
    const ensureOpen = async () => {
      const closed = await page.evaluate(
        () => document.querySelector("#insp-properties > [data-scroll]")?.hidden,
      );
      if (closed) {
        await page.locator('#insp-properties [aria-expanded="false"]').first().click();
        await page.waitForTimeout(200);
      }
    };
    const load = async (nodes, select = [nodes[0]?.id].filter(Boolean)) => {
      await page.keyboard.press("Escape").catch(() => {});
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.evaluate(
        ({ nodes, select, tokens, variables }) => {
          const d = window.design.getDocument();
          d.tokens = tokens;
          d.variables = variables;
          d.pages = [{ id: "p", name: "Page 1", nodes }];
          d.activePage = "p";
          window.design.setDocument(d);
          window.design.setSelection(select);
        },
        { nodes, select, tokens: TOKENS, variables: VARIABLES },
      );
      await page.waitForTimeout(350);
      await page.evaluate(() => document.activeElement?.blur?.());
      await ensureOpen();
      await away();
    };
    const away = async () => {
      await page.mouse.move(1330, 60);
      await page.waitForTimeout(120);
    };
    const node = (id = "card") =>
      page.evaluate(
        (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id) ?? null,
        id,
      );
    const canvasStyle = (id = "card") =>
      page.evaluate((id) => {
        const el = document.querySelector(`#canvas [data-id="${id}"]`);
        if (!el) return null;
        const s = getComputedStyle(el);
        const pick = [
          "backgroundColor",
          "backgroundImage",
          "borderTopWidth",
          "borderRightWidth",
          "borderTopStyle",
          "borderTopColor",
          "outlineWidth",
          "outlineStyle",
          "outlineColor",
          "outlineOffset",
          "boxShadow",
          "filter",
          "webkitMaskImage",
          "opacity",
          "mixBlendMode",
          "rowGap",
          "columnGap",
          "width",
          "height",
          "display",
          "flexDirection",
          "flexWrap",
          "marginLeft",
          "marginTop",
          "visibility",
        ];
        return Object.fromEntries(pick.map((k) => [k, s[k]]));
      }, id);
    const click = async (selector) => {
      await page.locator(selector).first().click();
      await page.waitForTimeout(250);
    };
    const scroll = async (selector, block = "nearest") => {
      await page.evaluate(
        ({ selector, block }) => document.querySelector(selector)?.scrollIntoView({ block }),
        { selector, block },
      );
      await page.waitForTimeout(150);
    };
    /** Structured description of a section: header buttons, body rows, controls, select options. */
    const describe = (selector) =>
      page.evaluate((selector) => {
        const s = document.querySelector(selector);
        if (!s) return { missing: selector };
        const panel = document.querySelector("#properties").getBoundingClientRect();
        const r2 = (v) => Math.round(v * 100) / 100;
        const rel = (r) => ({
          x: r2(r.left - panel.left),
          y: r2(r.top - panel.top),
          w: r2(r.width),
          h: r2(r.height),
        });
        const vis = (el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.opacity !== "0";
        };
        const control = (e) => {
          const cs = getComputedStyle(e);
          const o = {
            tag: e.tagName.toLowerCase(),
            name: e.getAttribute("name") || undefined,
            label: e.getAttribute("aria-label") || undefined,
            ...rel(e.getBoundingClientRect()),
          };
          if (e.tagName !== "BUTTON") o.value = e.value;
          if (e.placeholder) o.placeholder = e.placeholder;
          if (e.disabled) o.disabled = true;
          if (e.getAttribute("aria-pressed") === "true" || e.dataset.active === "true")
            o.active = true;
          if (e.tagName === "SELECT") {
            o.selected = e.options[e.selectedIndex]?.text;
            o.options = [...e.options].map((x) => x.text + (x.disabled ? " (disabled)" : ""));
          }
          const chip = e.querySelector?.("[data-variable-chip]");
          if (chip) o.chip = chip.textContent;
          if (cs.opacity !== "1") o.opacity = cs.opacity;
          return o;
        };
        const head = s.firstElementChild;
        const headerButtons = [...head.querySelectorAll("button")].filter(vis).map(control);
        const rows = [];
        for (const body of [...s.children].slice(1).filter(vis))
          for (const c of body.children)
            if (vis(c))
              rows.push({
                ...rel(c.getBoundingClientRect()),
                text: c.innerText.replace(/\s+/g, " ").trim().slice(0, 240),
                controls: [
                  ...c.querySelectorAll(
                    "input:not([type=hidden]),select,button,[data-variable-chip]",
                  ),
                ]
                  .filter(vis)
                  .map(control),
              });
        return {
          title: head.querySelector("h3")?.innerText,
          section: rel(s.getBoundingClientRect()),
          header: rel(head.getBoundingClientRect()),
          headerButtons,
          rows,
        };
      }, selector);
    const menus = () =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll(
            "[role=menu],[role=dialog],[data-radix-popper-content-wrapper] > *",
          ),
        ]
          .filter((m) => m.getBoundingClientRect().width > 0)
          .map((m) => ({
            role: m.getAttribute("role"),
            id: m.id || undefined,
            items: [
              ...m.querySelectorAll(
                "[role=menuitem],[role=menuitemcheckbox],[role=tab],[role=option],label,h3,strong",
              ),
            ]
              .map(
                (i) =>
                  i.innerText.replace(/\s+/g, " ").trim() +
                  (i.getAttribute("aria-disabled") === "true" || i.dataset.disabled !== undefined
                    ? " (disabled)"
                    : ""),
              )
              .filter(Boolean),
            text: m.innerText.replace(/\s+/g, " ").trim().slice(0, 600),
          })),
      );
    /** Screenshot: #properties, unioned with any open popper so menus that open to the left are included. */
    const snap = async (id, state, section, opts = {}) => {
      const file = `${id}-${state}.png`;
      if (only.length && !only.some((p) => file.startsWith(p))) return;
      if (NEW_ONLY && (await exists(file))) return console.log("keep", file);
      if (section && opts.scroll !== false) await scroll(section, opts.block);
      if (opts.hover) {
        await page.hover(opts.hover);
        await page.waitForTimeout(200);
      }
      const clip = await page.evaluate(() => {
        const rects = [document.querySelector("#properties").getBoundingClientRect()];
        for (const m of document.querySelectorAll("[data-radix-popper-content-wrapper]")) {
          const r = m.getBoundingClientRect();
          if (r.width > 0) rects.push(r);
        }
        const x = Math.max(0, Math.min(...rects.map((r) => r.left)));
        const y = Math.max(0, Math.min(...rects.map((r) => r.top)));
        const right = Math.min(innerWidth, Math.max(...rects.map((r) => r.right)));
        const bottom = Math.min(innerHeight, Math.max(...rects.map((r) => r.bottom)));
        return { x, y, width: right - x, height: bottom - y };
      });
      await page.screenshot({ path: path.join(OUT, file), clip });
      const entry = {
        file,
        id,
        state,
        clip,
        section: section ? await describe(section) : null,
        menus: await menus(),
        node: await node(opts.nodeId ?? "card"),
        canvas: await canvasStyle(opts.nodeId ?? "card"),
        ...(opts.extra ? { extra: await opts.extra() } : {}),
      };
      metrics.push(entry);
      console.log("shot", file);
    };

    /* ---------- 2026-10-31 follow-up: D1/D2, G1–G6, H1–H9 (notes-2026-10-31.md) ---------- */
    const FILL = "#fill-section";
    const BORDER = "#border-section";
    const LAYOUT = "#layout-section";
    const POS = "#position-section";
    const APP = "#appearance-section";
    const want = (file) => !only.length || only.some((p) => file.startsWith(p));
    /** Non-panel shot: `rect` is "window", "canvas" (#canvas-wrap), "canvas+panel", or a selector (element box). */
    const shoot = async (id, state, rect, opts = {}) => {
      const file = `${id}-${state}.png`;
      if (!want(file)) return;
      if (NEW_ONLY && (await exists(file))) return console.log("keep", file);
      if (opts.hover) {
        await page.hover(opts.hover);
        await page.waitForTimeout(opts.hoverWait ?? 200);
      }
      const clip = await page.evaluate((rect) => {
        const box = (s) => document.querySelector(s)?.getBoundingClientRect();
        if (rect === "window") return { x: 0, y: 0, width: innerWidth, height: innerHeight };
        if (rect === "canvas") {
          const r = box("#canvas-wrap");
          return { x: r.left, y: r.top, width: r.width, height: r.height };
        }
        if (rect === "canvas+panel") {
          const r = box("#canvas-wrap");
          return { x: r.left, y: r.top, width: innerWidth - r.left, height: innerHeight - r.top };
        }
        const r = box(rect);
        return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
      }, rect);
      if (!clip) return console.log("missing", rect, file);
      await page.screenshot({ path: path.join(OUT, file), clip });
      metrics.push({
        file,
        id,
        state,
        clip,
        section: opts.section ? await describe(opts.section) : null,
        menus: await menus(),
        nodes: await page.evaluate(() => window.design.getDocument().pages[0]?.nodes ?? []),
        selection: await page.evaluate(() => [...window.design.getSelection()]),
        tool: await page.evaluate(() => window.design.getTool?.() ?? null),
        ...(opts.extra ? { extra: await opts.extra() } : {}),
      });
      console.log("shot", file);
    };
    const followUp =
      only.length === 0 || only.some((p) => FOLLOW_UP.test(p.endsWith("-") ? p : p + "-"));
    const lastNode = () =>
      page.evaluate(() => window.design.getDocument().pages[0].nodes.at(-1) ?? null);
    const newest = async () => (await lastNode())?.id;
    // A clean, empty page with nothing selected and the Move tool, as in Wonder's D1 steps.
    const emptyPage = async () => {
      await load([], []);
      await page.evaluate(() => window.design.setTool?.("move"));
      await page.mouse.click(420, 160); // empty canvas: keyboard focus on the canvas, nothing selected
      await page.waitForTimeout(150);
    };
    if (followUp) {
      /* D1 Frame tool with nothing selected: F, then click / drag / preset; plus the toolbar button path. */
      await emptyPage();
      await page.keyboard.press("f");
      await page.waitForTimeout(250);
      await snap("D1", "collapsed", "#page-section", {
        extra: () =>
          page.evaluate(() => ({
            tool: window.design.getTool(),
            nodes: window.design.getDocument().pages[0].nodes.length,
          })),
      });
      await shoot("D1", "frame-tool-window", "window");
      await shoot("D1", "frame-presets", "#frame-presets", {
        extra: () =>
          page.evaluate(() =>
            [...document.querySelectorAll("#frame-presets strong, #frame-presets button")].map(
              (e) => e.innerText.replace(/\s+/g, " "),
            ),
          ),
      });
      await page.mouse.click(420, 200);
      await page.waitForTimeout(300);
      await shoot("D1", "click-created", "window");
      await snap("D2", "click", APP, { nodeId: await newest() });
      await emptyPage();
      await page.keyboard.press("f");
      await page.mouse.move(420, 200);
      await page.mouse.down();
      await page.mouse.move(560, 300, { steps: 6 });
      await page.mouse.move(677, 393, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      await shoot("D1", "drag-created", "window");
      await snap("D2", "drag", APP, { nodeId: await newest() });
      // Zoom to the dragged frame (Shift+2), deselect, and show its corner on the canvas.
      await page.mouse.move(700, 120);
      await page.keyboard.press("Shift+Digit2");
      await page.waitForTimeout(400);
      await page.evaluate(() => window.design.setSelection([]));
      await page.waitForTimeout(250);
      await shoot("D2", "corner-zoom", "canvas", {
        extra: () =>
          page.evaluate(() => {
            const el = document.querySelector("#canvas .frame-layer");
            const s = el && getComputedStyle(el);
            return (
              s && {
                borderRadius: s.borderRadius,
                overflow: s.overflow,
                backgroundColor: s.backgroundColor,
              }
            );
          }),
      });
      await emptyPage();
      await page.keyboard.press("f");
      await page.locator('#frame-presets [data-preset="iPhone 17"]').click();
      await page.waitForTimeout(400);
      await shoot("D1", "preset-created", "window");
      await snap("D2", "preset", APP, { nodeId: await newest() });
      // The toolbar button (and the legacy #add-frame command) does not arm the tool: it inserts a frame at once.
      await emptyPage();
      await page.locator("#canvas-toolbar #add-frame").click();
      await page.waitForTimeout(400);
      await shoot("D1", "toolbar-click-created", "window");
      await snap("D2", "toolbar-click", APP, { nodeId: await newest() });

      /* G1 (B5) type-to-bind: type a variable name into W. */
      await load(card());
      await scroll(LAYOUT, "start");
      await page.locator(`${LAYOUT} [name=w]`).click();
      await page.locator(`${LAYOUT} [name=w]`).fill("spac");
      await page.waitForTimeout(250);
      await snap("G1", "width-suggestions", LAYOUT, { scroll: false });
      await page.locator(`${LAYOUT} [name=w]`).fill("spacing");
      await page.locator(`${LAYOUT} [name=w]`).press("Enter");
      await page.waitForTimeout(300);
      await snap("G1", "width-enter", LAYOUT, {
        scroll: false,
        extra: async () => ({
          w: (await node()).w,
          bindings: (await node()).bindings ?? null,
          field: await page
            .locator(`${LAYOUT} [name=w]`)
            .inputValue()
            .catch(() => null),
          toasts: await page.evaluate(() =>
            [...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.innerText),
          ),
        }),
      });

      /* G2 (A7) export selects: native <select>s; their OS popups cannot be captured, so the shots show the focused field. */
      const EXPORT = "#export-section";
      const selectInfo = (id) => () =>
        page.evaluate((id) => {
          const s = document.getElementById(id);
          return (
            s && { tag: s.tagName, value: s.value, options: [...s.options].map((o) => o.text) }
          );
        }, id);
      await load(card());
      await click(`${EXPORT} button[aria-label="Add export"]`);
      await away();
      await snap("G2", "added", EXPORT);
      await page.locator("#artwork-scale").focus();
      await snap("G2", "scale-menu", EXPORT, { scroll: false, extra: selectInfo("artwork-scale") });
      await page.locator("#artwork-format").focus();
      await snap("G2", "format-menu", EXPORT, {
        scroll: false,
        extra: selectInfo("artwork-format"),
      });
      await page.evaluate(() => document.activeElement?.blur?.());

      /* G3 (A2) border colour bound to an opaque variable (Wonder: color-1 = #000000). */
      await load(card({ strokeWidth: 1, strokeColor: "#000000", strokeToken: "ink" }));
      await snap("G3", "bound", BORDER);
      await click(`${BORDER} button[aria-label="Pick border colour"]`);
      await page
        .locator("[role=tab]", { hasText: "Variables" })
        .click()
        .catch(() => {});
      await page.waitForTimeout(200);
      await snap("G3", "variables", BORDER, { scroll: false });
      await page
        .locator("[role=tab]", { hasText: "Custom" })
        .click()
        .catch(() => {});
      await page.waitForTimeout(200);
      await snap("G3", "border-picker", BORDER, { scroll: false });
      await page.keyboard.press("Escape");

      /* G4 (C3) active-cell bars: every alignment cell, row and column direction (matrix crop, 108×56 CSS). */
      const flexKids = [
        {
          id: "c1",
          name: "A",
          type: "rectangle",
          parentId: "card",
          x: 0,
          y: 0,
          w: 60,
          h: 40,
          color: "#ff0000",
        },
        {
          id: "c2",
          name: "B",
          type: "rectangle",
          parentId: "card",
          x: 0,
          y: 0,
          w: 60,
          h: 40,
          color: "#00aa00",
        },
      ];
      const MATRIX = `${LAYOUT} [role=group][aria-label=Alignment]`;
      for (const direction of ["row", "column"]) {
        await load([
          {
            ...CARD,
            layout: "flex",
            direction,
            gap: 10,
            padding: 0,
            alignItems: "flex-start",
            justifyContent: "flex-start",
          },
          ...flexKids,
        ]);
        await scroll(LAYOUT, "start");
        if (direction === "row") await snap("G4", "flex-state", LAYOUT, { scroll: false });
        for (let r = 0; r < 3; r++)
          for (let c = 0; c < 3; c++) {
            await page.locator(`${MATRIX} [data-cell="${r}-${c}"]`).click();
            await away();
            // Wonder retook every cell as `*-verified` (its first column crops missed the matrix); save both names.
            for (const suffix of ["", "-verified"])
              await shoot("G4", `${direction}-${r + 1}${c + 1}${suffix}`, MATRIX, {
                extra: async () => {
                  const n = await node();
                  return { alignItems: n.alignItems, justifyContent: n.justifyContent };
                },
              });
          }
      }

      /* G5 (C4) grid track preview and editor at 2 / 3 / 4 columns, 4×2, and a fixed row. */
      const gridOf = (columns, rows) => [
        { ...CARD, layout: "grid", columns, ...(rows ? { rows } : {}), gap: 10, padding: 0 },
        ...[1, 2, 3, 4].map((i) => ({
          id: "g" + i,
          name: "Cell " + i,
          type: "rectangle",
          parentId: "card",
          x: 0,
          y: 0,
          w: 60,
          h: 40,
          color: "#dddddd",
        })),
      ];
      for (const [state, columns, rows] of [
        ["track-editor", 2],
        ["two-columns", 2],
        ["three-columns", 3],
        ["four-columns", 4],
        ["four-two", 4, 2],
        ["row-added", 2, 1],
      ]) {
        await load(gridOf(columns, rows));
        await scroll(LAYOUT, "start");
        if (state !== "track-editor")
          await snap("G5", `${state}-preview`, LAYOUT, { scroll: false });
        await click("#grid-tracks");
        await snap("G5", state, LAYOUT, { scroll: false });
        await page.keyboard.press("Escape");
      }

      /* G6 (A1/A4) paint picker on a solid, the gradient editor, and the bound shadow editor. */
      await load(card());
      await click(`${FILL} button[aria-label="Fill colour"]`);
      await snap("G6", "fill-picker", FILL, { scroll: false });
      await page.keyboard.press("Escape");
      await load(
        card({
          fills: [
            {
              type: "linear",
              angle: 180,
              stops: [
                { position: 0, color: "#172033" },
                { position: 100, color: "#456099" },
              ],
            },
          ],
        }),
      );
      await click(`${FILL} [data-paint="0"] button[aria-label^="Edit"]`);
      await snap("G6", "gradient-editor", FILL, { scroll: false });
      await page.keyboard.press("Escape");
      await load(
        card({
          shadows: [
            { type: "box", x: 0, y: 4, blur: 12, spread: 0, color: "#000000", token: "ink" },
          ],
        }),
      );
      await click('#shadow-section [data-shadow-edit="0"]');
      await snap("G6", "shadow-bound-editor", "#shadow-section", { scroll: false });
      await page.keyboard.press("Escape");

      /* H1 (C1) Position expand tool on a frame with a child; the tooltip is a native title (not drawn in shots). */
      const withChild = [
        { ...CARD },
        {
          id: "inner",
          name: "Inner",
          type: "frame",
          parentId: "card",
          x: 20,
          y: 20,
          w: 100,
          h: 80,
          color: "#dddddd",
        },
      ];
      const titleOf = (sel) => () =>
        page.evaluate((sel) => {
          const b = document.querySelector(sel);
          return b && { title: b.title, label: b.getAttribute("aria-label"), disabled: b.disabled };
        }, sel);
      await load(withChild, ["card"]);
      await scroll(POS, "start");
      await snap("H1", "tooltip", POS, {
        scroll: false,
        hover: "#position-fit-content",
        extra: titleOf("#position-fit-content"),
      });
      await click("#position-fit-content");
      await away();
      await snap("H1", "after-click", POS, { scroll: false });

      /* H2 (A9) Selection colors target button. */
      const COLORS = "#selection-colors-section";
      await load([
        { ...CARD, color: "#111827", token: "surface" },
        {
          id: "t1",
          name: "Title",
          type: "text",
          parentId: "card",
          x: 16,
          y: 16,
          w: 200,
          h: 24,
          text: "Hello",
          color: "#000000",
          fontSize: 18,
        },
        {
          id: "t2",
          name: "Body",
          type: "text",
          parentId: "card",
          x: 16,
          y: 60,
          w: 200,
          h: 24,
          text: "World",
          color: "#000000",
          fontSize: 14,
        },
      ]);
      await snap("H2", "selection-colors", COLORS, {
        block: "end",
        hover: `${COLORS} [data-selection-color-target]`,
      });
      const targets = page.locator(`${COLORS} [data-selection-color-target]`);
      await targets.nth((await targets.count()) - 1).click();
      await page.waitForTimeout(300);
      await away();
      await snap("H2", "target-clicked", "#position-section", {
        block: "start",
        nodeId: "t1",
        extra: () => page.evaluate(() => [...window.design.getSelection()]),
      });

      /* H3 (A9) Click to replace on a mixed multi-selection. */
      const mixed = [
        {
          ...CARD,
          fills: [
            { type: "solid", color: "#ffffff" },
            { type: "solid", color: "#00000033" },
          ],
          shadows: [{ type: "box", x: 0, y: 4, blur: 4, spread: 0, color: "#00000040" }],
        },
        {
          ...CARD,
          id: "card2",
          name: "Card 2",
          x: 420,
          fills: [{ type: "solid", color: "#ff0000" }],
        },
      ];
      const fillsOf = () =>
        page.evaluate(() =>
          window.design.getDocument().pages[0].nodes.map((n) => ({
            id: n.id,
            fills: n.fills ?? null,
            color: n.color,
            shadows: n.shadows ?? null,
          })),
        );
      await load(mixed, ["card", "card2"]);
      await snap("H3", "mixed", "#fill-mixed-section", { block: "center", extra: fillsOf });
      await page.locator("#fill-mixed-section [data-replace]").click();
      await page.waitForTimeout(300);
      await away();
      await snap("H3", "replaced", FILL, { block: "center", extra: fillsOf });

      /* H4 (A2) Border `+` in All mode, then with four sides. */
      await load(card({ strokeWidth: 1, strokeColor: "#000000" }));
      await snap("H4", "all", BORDER);
      await click(`${BORDER} button[aria-label="Add border side"]`);
      await away();
      await snap("H4", "plus-all", BORDER, {
        extra: () =>
          node().then((n) => ({
            strokeWidth: n.strokeWidth,
            strokeWidths: n.strokeWidths ?? null,
          })),
      });
      await load(card({ strokeWidth: 1, strokeColor: "#000000", strokeWidths: [1, 1, 1, 1] }));
      await snap("H4", "four-plus", BORDER, {
        extra: titleOf(`${BORDER} button[aria-label="Add border side"]`),
      });

      /* H5 (B4) constraint menu without and with an existing Scale constraint. */
      await load(withChild, ["inner"]);
      await scroll(POS, "start");
      await click(`${POS} [data-constraint-menu=h]`);
      await snap("H5", "constraint-menu", POS, { scroll: false, nodeId: "inner" });
      await page.keyboard.press("Escape");
      await page.evaluate(() => window.design.setConstraints(["inner"], { h: "scale" }));
      await page.waitForTimeout(250);
      await click(`${POS} [data-constraint-menu=h]`);
      await snap("H5", "scale-existing", POS, {
        scroll: false,
        nodeId: "inner",
        extra: () => page.evaluate(() => window.design.getConstraints("inner")),
      });
      await page.keyboard.press("Escape");

      /* H6 (A1) Fill header wavy square: hover, then open. */
      await load(card());
      await snap("H6", "tooltip", FILL, {
        hover: `${FILL} [data-fill-animated]`,
        extra: titleOf(`${FILL} [data-fill-animated]`),
      });
      await click(`${FILL} [data-fill-animated]`);
      await snap("H6", "open", FILL, { scroll: false });
      await page.keyboard.press("Escape");

      /* H7 (C2/C4) grid-mode Layout header: wrap toggle and grid icon. */
      await load(gridOf(2));
      await snap("H7", "grid-header", LAYOUT, { block: "start" });
      await snap("H7", "wrap-tooltip", LAYOUT, {
        block: "start",
        hover: `${LAYOUT} [data-grid-wrap]`,
        extra: titleOf(`${LAYOUT} [data-grid-wrap]`),
      });
      await click(`${LAYOUT} [data-grid-wrap]`);
      await away();
      await snap("H7", "wrap-off", LAYOUT, {
        block: "start",
        extra: () => node().then((n) => ({ columns: n.columns, rows: n.rows ?? null })),
      });

      /* H8 (C8) Page eye, with the canvas so the page background change is visible. */
      await load(card(), []);
      await page.evaluate(() => window.design.updatePage({ background: "#2B2B2B" }));
      await page.waitForTimeout(250);
      await shoot("H8", "before", "canvas+panel");
      await click("#page-section [data-page-visibility]");
      await away();
      await shoot("H8", "eye-hidden", "canvas+panel", {
        extra: () =>
          page.evaluate(() => ({
            page: window.design.getDocument().pages[0],
            workspaceBg: getComputedStyle(document.getElementById("workspace")).backgroundColor,
          })),
      });

      /* H9 (C3) active alignment cell: plain vs hovered. */
      await load([
        {
          ...CARD,
          layout: "flex",
          direction: "row",
          gap: 10,
          padding: 0,
          alignItems: "center",
          justifyContent: "center",
        },
        ...flexKids,
      ]);
      await scroll(LAYOUT, "start");
      await shoot("H9", "active-only", MATRIX);
      await shoot("H9", "active-verified", MATRIX);
      await shoot("H9", "hover-active", MATRIX, { hover: `${MATRIX} [data-cell="1-1"]` });
      await shoot("H9", "hover-verified", MATRIX, { hover: `${MATRIX} [data-cell="1-1"]` });
      await away();
    }

    legacy: {
      if (onlyFollowUp) break legacy;
      /* ---------- A1 Background Fill ---------- */
      await load(card({ color: "transparent" }));
      await snap("A1", "background-empty", FILL);
      await click(`${FILL} button[aria-label="Add paint"]`);
      await away();
      await snap("A1", "background-added", FILL);
      await load(card());
      await snap("A1", "background-solid", FILL);
      await snap("A1", "background-filled", FILL);
      await snap("A1", "background-hover", FILL, { hover: `${FILL} [data-paint="0"]` });
      await click(`${FILL} [data-paint-remove="0"]`);
      await away();
      await snap("A1", "background-removed", FILL);
      await load(card());
      await click(`${FILL} button[aria-label="Fill colour"]`);
      await snap("A1", "fill-picker", FILL, { scroll: false });
      await page.keyboard.press("Escape");
      await load(
        card({
          fills: [
            {
              type: "linear",
              angle: 180,
              stops: [
                { position: 0, color: "#172033" },
                { position: 100, color: "#456099" },
              ],
            },
          ],
        }),
      );
      await snap("A1", "background-gradient", FILL);
      await load(card({ color: "#111827", token: "surface" }));
      await snap("A1", "background-bound", FILL);
      await snap("A1", "background-variable-bound", FILL);
      // Binding lives in the picker's Variables tab (the header's wavy square now holds the animated gradient).
      await click(`${FILL} button[aria-label="Fill colour"]`);
      await snap("A1", "background-variable-menu", FILL, { scroll: false });
      await page.keyboard.press("Escape");
      await load(card());
      await click(`${FILL} [data-fill-animated]`);
      await snap("A1", "background-animated-tool", FILL, { scroll: false });
      await page.keyboard.press("Escape");
      await load(
        card({
          fills: [
            { type: "solid", color: "#ff0000", opacity: 50 },
            { type: "solid", color: "#ffffff" },
            {
              type: "linear",
              angle: 90,
              stops: [
                { position: 0, color: "#000000" },
                { position: 100, color: "#ffffff" },
              ],
            },
          ],
        }),
      );
      await snap("A1", "background-multiple", FILL);
      await load(
        card({
          fills: [
            { type: "solid", color: "#ff0000", hidden: true },
            { type: "solid", color: "#ffffff" },
          ],
        }),
      );
      await snap("A1", "background-hidden", FILL);

      /* ---------- A2 Border ---------- */
      const BORDER = "#border-section";
      await load(card());
      await snap("A2", "border-empty", BORDER);
      await click(`${BORDER} button[aria-label="Add border"]`);
      await away();
      await snap("A2", "border-added", BORDER);
      await snap("A2", "border-filled", BORDER);
      await snap("A2", "border-hover", BORDER, {
        hover: `${BORDER} [data-border-row] [data-field-shell]`,
      });
      // Wonder A2: the sliders tool opens the Solid / Dashed / Dotted menu; the sides tool splits All into four sides.
      await click(`${BORDER} button[aria-label="Border settings"]`);
      await snap("A2", "border-settings", BORDER, { scroll: false });
      await page.keyboard.press("Escape");
      await click(`${BORDER} button[aria-label="Independent border sides"]`);
      await away();
      await snap("A2", "border-individual-sides", BORDER);
      await snap("A2", "border-individual-sides-bottom", "#outline-section", { block: "end" });
      await load(card({ strokeWidth: 1, strokeColor: "#000000" }));
      await click(`${BORDER} button[aria-label="Pick border colour"]`);
      await snap("A2", "border-color-picker", BORDER, { scroll: false });
      await page.keyboard.press("Escape");
      await load(
        [
          { ...CARD },
          {
            id: "inner",
            name: "Inner",
            type: "frame",
            parentId: "card",
            x: 20,
            y: 20,
            w: 100,
            h: 80,
            color: "#dddddd",
            radius: 0,
          },
        ],
        ["inner"],
      );
      await click(`${BORDER} button[aria-label="Add border"]`);
      await away();
      await snap("A2", "border-child-added", BORDER, { nodeId: "inner" });
      await load(card({ strokeWidth: 1, strokeColor: "#5EEAD4", strokeToken: "accent" }));
      await snap("A2", "border-variable-bound", BORDER);
      await load(card({ strokeWidth: 1, strokeColor: "#000000", strokeHidden: true }));
      await snap("A2", "border-hidden", BORDER);
      await load(card({ strokeWidth: 1, strokeColor: "#000000" }));
      await click(`${BORDER} [data-border-tool="remove"]`);
      await away();
      await snap("A2", "border-removed", BORDER);

      /* ---------- A3 Outline ---------- */
      const OUTLINE = "#outline-section";
      await load(card());
      await snap("A3", "outline-empty", OUTLINE);
      await click(`${OUTLINE} button[aria-label="Add outline"]`);
      await away();
      await snap("A3", "outline-added", OUTLINE);
      await snap("A3", "outline-filled", OUTLINE);
      await snap("A3", "outline-hover", OUTLINE, { hover: `${OUTLINE} [name=outlineWidth]` });
      await click(`${OUTLINE} [data-effect-tool="remove"]`);
      await away();
      await snap("A3", "outline-removed", OUTLINE);

      /* ---------- A4 Shadow ---------- */
      const SHADOW = "#shadow-section";
      await load(card());
      await snap("A4", "shadow-empty", SHADOW);
      await click(`${SHADOW} button[aria-label="Add shadow"]`);
      await snap("A4", "shadow-added-editor", SHADOW, { scroll: false });
      await snap("A4", "shadow-editor", SHADOW, { scroll: false });
      await page.keyboard.press("Escape");
      await away();
      await snap("A4", "shadow-added", SHADOW);
      await snap("A4", "shadow-filled", SHADOW);
      await snap("A4", "shadow-hover", SHADOW, { hover: `${SHADOW} [data-shadow-edit="0"]` });
      await load(
        card({
          shadows: [
            { type: "box", x: 0, y: 4, blur: 12, spread: 0, color: "#00000040" },
            { type: "box", inset: true, x: 0, y: 1, blur: 2, spread: 0, color: "#ffffff33" },
            { type: "drop", x: 0, y: 8, blur: 24, spread: 0, color: "#00000066" },
          ],
        }),
      );
      await snap("A4", "shadow-multiple", SHADOW);
      await load(
        card({
          shadows: [
            { type: "box", x: 0, y: 4, blur: 12, spread: 0, color: "#5EEAD4", token: "accent" },
          ],
        }),
      );
      await snap("A4", "shadow-bound", SHADOW);
      await click(`${SHADOW} [data-shadow-edit="0"]`);
      await snap("A4", "shadow-bound-editor", SHADOW, { scroll: false });
      await page.keyboard.press("Escape");
      await load(
        card({ shadows: [{ type: "box", x: 0, y: 4, blur: 12, spread: 0, color: "#00000040" }] }),
      );
      await click(`${SHADOW} [data-shadow-row="0"] [data-effect-tool="remove"]`);
      await away();
      await snap("A4", "shadow-removed", SHADOW);

      /* ---------- A5 Filters ---------- */
      const FILTER = "#filter-section";
      await load(card());
      await snap("A5", "filters-empty", FILTER);
      await click(`${FILTER} button[aria-label="Add filter"]`);
      await away();
      await snap("A5", "filters-added", FILTER);
      await snap("A5", "filters-filled", FILTER);
      await click(`${FILTER} [title="Filter type"]`);
      await snap("A5", "filters-type-menu", FILTER, { scroll: false });
      await page.keyboard.press("Escape");
      await away();
      await snap("A5", "filters-hover", FILTER, { hover: `${FILTER} [title="Filter type"]` });
      await load(
        card({
          filters: [
            { type: "blur", value: 4 },
            { type: "brightness", value: 1.2 },
          ],
        }),
      );
      await snap("A5", "filters-multiple", FILTER);
      await click(`${FILTER} [data-effect-tool="remove"]`);
      await click(`${FILTER} [data-effect-tool="remove"]`);
      await away();
      await snap("A5", "filters-removed", FILTER);

      /* ---------- A6 Mask ---------- */
      const MASK = "#mask-section";
      await load(card());
      await snap("A6", "mask-empty", MASK);
      await click(`${MASK} button[aria-label="Add mask"]`);
      await snap("A6", "mask-added-editor", MASK, { scroll: false });
      await page.keyboard.press("Escape");
      await away();
      await snap("A6", "mask-added", MASK);
      await snap("A6", "mask-filled", MASK);
      await snap("A6", "mask-hover", MASK, { hover: `${MASK} [data-mask-edit="0"]` });
      await click(`${MASK} [data-effect-tool="remove"]`);
      await away();
      await snap("A6", "mask-removed", MASK);

      /* ---------- A7 Export ---------- */
      const EXPORT = "#export-section";
      await load(card());
      await snap("A7", "export-empty", EXPORT);
      await click(`${EXPORT} button[aria-label="Add export"]`);
      await away();
      await snap("A7", "export-added", EXPORT);
      await snap("A7", "export-filled", EXPORT);
      await snap("A7", "export-hover", EXPORT, { hover: `${EXPORT} [data-section-remove]` });
      await click(`${EXPORT} [data-section-remove]`);
      await away();
      await snap("A7", "export-removed", EXPORT);

      /* ---------- A8 Layer (removed: Export is the last section, WP-6) ---------- */
      await load(card());
      await snap("A8", "layer-frame-bottom", "#export-section", { block: "end" });
      await load([
        {
          id: "txt",
          name: "Text",
          type: "text",
          x: 100,
          y: 100,
          w: 240,
          h: 40,
          text: "Hello world",
          color: "#ffffff",
          fontSize: 24,
        },
      ]);
      await snap("A8", "layer-text-bottom", "#export-section", { block: "end", nodeId: "txt" });

      /* ---------- A9 Selection colors ---------- */
      const COLORS = "#selection-colors-section";
      const colorsProbe = () =>
        page.evaluate(() => ({
          sectionTitles: [...document.querySelectorAll("#properties section h3")].map(
            (h) => h.innerText,
          ),
          selectionColors: [
            ...document.querySelectorAll("#selection-colors-section [data-selection-color]"),
          ].map((r) => r.dataset.selectionColor),
        }));
      // Wonder A9-parent-colors: a frame bound to a variable with two black text children.
      await load([
        { ...CARD, color: "#111827", token: "surface" },
        {
          id: "t1",
          name: "Title",
          type: "text",
          parentId: "card",
          x: 16,
          y: 16,
          w: 200,
          h: 24,
          text: "Hello",
          color: "#000000",
          fontSize: 18,
        },
        {
          id: "t2",
          name: "Body",
          type: "text",
          parentId: "card",
          x: 16,
          y: 60,
          w: 200,
          h: 24,
          text: "World",
          color: "#000000",
          fontSize: 14,
        },
      ]);
      await snap("A9", "parent-colors", COLORS, { block: "end", extra: colorsProbe });
      // Wonder A9-selection-colors-multiple / -bottom: three top-level siblings (two frames and a text layer), as with
      // Cmd+A in the scratch file: white, black 20 % paint, black 25 % shadow, #666666 20 % gradient stop, a variable.
      await load(
        [
          {
            ...CARD,
            fills: [
              { type: "solid", color: "#ffffff" },
              { type: "solid", color: "#00000033" },
            ],
            shadows: [{ type: "box", x: 0, y: 4, blur: 4, spread: 0, color: "#00000040" }],
            filters: [{ type: "blur", value: 2 }],
          },
          {
            ...CARD,
            id: "card2",
            name: "Card 2",
            x: 420,
            fills: [
              {
                type: "linear",
                angle: 180,
                stops: [
                  { position: 0, color: "#00000033" },
                  { position: 100, color: "#66666633" },
                ],
              },
            ],
          },
          {
            id: "t3",
            name: "Parity audit",
            type: "text",
            x: 100,
            y: 40,
            w: 200,
            h: 24,
            text: "Parity audit",
            color: "#000000",
            token: "surface",
            fontSize: 14,
          },
        ],
        ["card", "card2", "t3"],
      );
      await snap("A9", "selection-colors-multiple", "#position-section", {
        block: "start",
        extra: colorsProbe,
      });
      await snap("A9", "selection-colors-bottom", "#export-section", {
        block: "end",
        extra: colorsProbe,
      });
      await load([
        {
          id: "icon",
          name: "Icon",
          type: "image",
          x: 100,
          y: 100,
          w: 48,
          h: 48,
          src: svg(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20H2z" fill="#ff0000"/></svg>',
          ),
        },
      ]);
      await snap("A9", "selection-colors-svg-mono", COLORS, { nodeId: "icon", extra: colorsProbe });
      await load([
        {
          id: "icon2",
          name: "Icon 2",
          type: "image",
          x: 100,
          y: 100,
          w: 48,
          h: 48,
          src: svg(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h10v20H2z" fill="#ff0000"/><path d="M12 2h10v20H12z" fill="#0000ff"/></svg>',
          ),
        },
      ]);
      await snap("A9", "selection-colors-svg-multi", COLORS, {
        nodeId: "icon2",
        extra: colorsProbe,
      });

      /* ---------- A10 Typography ---------- */
      await load([
        {
          id: "txt",
          name: "Text",
          type: "text",
          x: 100,
          y: 100,
          w: 240,
          h: 40,
          text: "Hello world",
          color: "#ffffff",
          fontSize: 24,
          fontFamily: "Inter",
          fontWeight: "400",
        },
      ]);
      await snap("A10", "typography-text", "#typography-section", {
        block: "start",
        nodeId: "txt",
      });
      await snap("A10", "typography-text-fill", "#fill-section", { block: "start", nodeId: "txt" });
      await snap("A10", "typography-hover", "#fill-section", { block: "end", nodeId: "txt" });
      await click(`#text-background-fill-section button[aria-label="Add background paint"]`);
      await away();
      await snap("A10", "typography-background-fill", "#text-background-fill-section", {
        block: "end",
        nodeId: "txt",
      });
      await load([
        {
          id: "txt",
          name: "Text",
          type: "text",
          x: 100,
          y: 100,
          w: 240,
          h: 40,
          text: "Hello world",
          color: "#ffffff",
          fontSize: 24,
          fontFamily: "Inter",
          fontWeight: "400",
        },
      ]);
      await click('#typography-section [aria-label="Type settings"]');
      await snap("A10", "typography-settings", "#typography-section", {
        scroll: false,
        nodeId: "txt",
      });
      await page.keyboard.press("Escape");

      /* ---------- A11 Appearance ---------- */
      const APP = "#appearance-section";
      await load(card());
      await snap("A11", "eye-visible", APP);
      await click("#appearance-visibility");
      await away();
      await snap("A11", "eye-hidden", APP);
      await load(card());
      await click("#blend-mode");
      await snap("A11", "drop-open", APP, { scroll: false });
      await page.evaluate(() =>
        document.querySelectorAll("[role=menu]").forEach((m) => (m.scrollTop = m.scrollHeight)),
      );
      await page.waitForTimeout(150);
      await snap("A11", "blend-menu-bottom", APP, { scroll: false });
      await page.evaluate(() =>
        document.querySelectorAll("[role=menu]").forEach((m) => (m.scrollTop = 0)),
      );
      await page.locator('[role=menuitem][data-blend="multiply"]').click();
      await away();
      await snap("A11", "appearance-blend-multiply", APP);

      /* ---------- B1 Flex gap without wrap ---------- */
      const LAYOUT = "#layout-section";
      const flexFrame = (patch = {}) => [
        {
          ...CARD,
          layout: "flex",
          direction: "row",
          gap: 8,
          padding: 16,
          alignItems: "flex-start",
          justifyContent: "flex-start",
          ...patch,
        },
        {
          id: "c1",
          name: "A",
          type: "rectangle",
          parentId: "card",
          x: 0,
          y: 0,
          w: 60,
          h: 40,
          color: "#ff0000",
        },
        {
          id: "c2",
          name: "B",
          type: "rectangle",
          parentId: "card",
          x: 0,
          y: 0,
          w: 60,
          h: 40,
          color: "#00aa00",
        },
        {
          id: "c3",
          name: "C",
          type: "rectangle",
          parentId: "card",
          x: 0,
          y: 0,
          w: 60,
          h: 40,
          color: "#0000ff",
        },
      ];
      const typeAttempt = (name) => async () => {
        const loc = page.locator(`${LAYOUT} [name=${name}]`);
        const before = await loc.inputValue();
        const disabled = await loc.isDisabled();
        await loc.click({ force: true }).catch(() => {});
        const focused = await loc.evaluate((el) => document.activeElement === el);
        const fillError = await loc.fill("37", { timeout: 1500 }).then(
          () => null,
          (e) => String(e.message).split("\n")[0],
        );
        if (focused) await loc.press("Enter");
        await page.waitForTimeout(200);
        const n = await node();
        return {
          field: name,
          disabled,
          focusedAfterClick: focused,
          fillError,
          valueBefore: before,
          valueAfter: await loc.inputValue(),
          node: { gap: n.gap, gapX: n.gapX, gapY: n.gapY },
          canvas: await canvasStyle(),
        };
      };
      await load(flexFrame({ gap: 10 }));
      await snap("B1", "before-gap", LAYOUT, { block: "start" });
      await page.locator(`${LAYOUT} [name=gap]`).fill("37");
      await page.locator(`${LAYOUT} [name=gap]`).press("Enter");
      await page.waitForTimeout(250);
      await away();
      await snap("B1", "after-gap-37", LAYOUT, { block: "start" });
      await load(flexFrame({ gap: 10 }));
      await snap("B1", "cross-gap-typed-37", LAYOUT, {
        block: "start",
        extra: typeAttempt("gapY"),
      });
      await load(flexFrame());
      await snap("B1", "gap-row-nowrap", LAYOUT, { block: "start", extra: typeAttempt("gapY") });
      await load(flexFrame({ direction: "column" }));
      await snap("B1", "gap-column-nowrap", LAYOUT, { block: "start", extra: typeAttempt("gapX") });
      await load(flexFrame({ flexWrap: true }));
      await snap("B1", "gap-row-wrap", LAYOUT, { block: "start", extra: typeAttempt("gapY") });

      /* ---------- B2 W/H sizing ---------- */
      const sizing = (child) => [
        { ...CARD, layout: "flex", direction: "column", gap: 8, padding: 16 },
        {
          id: "kid",
          name: "Kid",
          type: "frame",
          parentId: "card",
          x: 0,
          y: 0,
          w: 120,
          h: 60,
          color: "#dddddd",
          layout: "flex",
          padding: 8,
          ...child,
        },
        {
          id: "kt",
          name: "Label",
          type: "text",
          parentId: "kid",
          x: 0,
          y: 0,
          w: 60,
          h: 20,
          text: "Hi",
          color: "#111111",
          fontSize: 14,
        },
      ];
      for (const [state, child] of [
        ["fixed-selected", {}],
        ["hug-selected", { wMode: "hug", hMode: "hug" }],
        ["fill-selected", { wMode: "fill" }],
      ]) {
        await load(sizing(child), ["kid"]);
        await snap("B2", state, LAYOUT, { block: "start", nodeId: "kid" });
      }
      await load(sizing({}), ["kid"]);
      await scroll(LAYOUT, "start");
      // Wonder B2: the unit is the menu trigger (allowed modes with ✓, then that axis's Add min / Add max).
      await click(`${LAYOUT} [data-size-menu=w]`);
      await snap("B2", "wh-menu-open", LAYOUT, { scroll: false, nodeId: "kid" });
      await page.keyboard.press("Escape");
      await click(`${LAYOUT} [data-size-menu=h]`);
      await snap("B2", "height-menu", LAYOUT, { scroll: false, nodeId: "kid" });
      await page.keyboard.press("Escape");
      await click(`${LAYOUT} [data-size-menu=w]`);
      await page.locator("[role=menuitem][data-limit=minW]").click();
      await away();
      await snap("B2", "min-width-added", LAYOUT, { block: "start", nodeId: "kid" });
      await load(sizing({}), ["kid"]);
      await scroll(LAYOUT, "start");
      await click(`${LAYOUT} [data-size-menu=w]`);
      await page.locator("[role=menuitem][data-limit=maxW]").click();
      await away();
      await snap("B2", "max-width-added", LAYOUT, { block: "start", nodeId: "kid" });
      await load(sizing({}), ["kid"]);
      await scroll(LAYOUT, "start");
      await click(`${LAYOUT} [data-size-menu=h]`);
      await page.locator("[role=menuitem][data-limit=maxH]").click();
      await away();
      await snap("B2", "max-height-added", LAYOUT, { block: "start", nodeId: "kid" });
      await load(sizing({ wPct: 99 }), ["kid"]);
      await snap("B2", "relative-selected", LAYOUT, { block: "start", nodeId: "kid" });
      await load(sizing({ wMode: "calc", wCalc: "270px" }), ["kid"]);
      await snap("B2", "calculate", LAYOUT, { block: "start", nodeId: "kid" });
      // Top-level text: Fixed, Hug, Auto, Calculate; a flex text child adds Relative and Fill.
      const topText = {
        id: "tt",
        name: "Label",
        type: "text",
        x: 100,
        y: 40,
        w: 60,
        h: 20,
        text: "Hi",
        color: "#111111",
        fontSize: 14,
      };
      await load([topText], ["tt"]);
      await scroll(LAYOUT, "start");
      await click(`${LAYOUT} [data-size-menu=w]`);
      await snap("B2", "hug-menu", LAYOUT, { scroll: false, nodeId: "tt" });
      await page.keyboard.press("Escape");
      await load(
        [topText].map((n) => ({ ...n, wMode: "auto" })),
        ["tt"],
      );
      await snap("B2", "auto-selected", LAYOUT, { block: "start", nodeId: "tt" });
      await load(sizing({}), ["kt"]);
      await scroll(LAYOUT, "start");
      await click(`${LAYOUT} [data-size-menu=w]`);
      await snap("B2", "flex-child-menu", LAYOUT, { scroll: false, nodeId: "kt" });
      await page.keyboard.press("Escape");
      // A top-level frame: which sizing options are allowed.
      await load(card());
      await snap("B2", "wh-top-level", LAYOUT, { block: "start" });

      /* ---------- B3 Bound fill opacity ---------- */
      await load(card({ color: "#111827", token: "surface" }));
      await snap("B3", "variable-100", FILL);
      await click(`${FILL} button[aria-label="Fill colour"]`);
      await snap("B3", "variable-100-picker", FILL, { scroll: false });
      await page.locator("[role=tab]", { hasText: "Custom" }).click();
      await page.waitForTimeout(200);
      await snap("B3", "variable-100-picker-custom", FILL, {
        scroll: false,
        extra: async () => ({
          opacityField: await page
            .getByRole("textbox", { name: "Opacity percent" })
            .inputValue()
            .catch(() => null),
        }),
      });
      // What setting 50% in the picker's Custom tab does to the binding.
      const alpha = page.getByRole("textbox", { name: "Opacity percent" });
      await alpha.fill("50");
      await alpha.press("Enter");
      await page.waitForTimeout(250);
      await snap("B3", "variable-alpha-50-editor", FILL, { scroll: false });
      await page.keyboard.press("Escape");
      await away();
      await snap("B3", "variable-50-attempt", FILL);
      await load(
        card({ fills: [{ type: "solid", color: "#111827", token: "surface", opacity: 50 }] }),
      );
      await snap("B3", "variable-50", FILL);

      /* ---------- B4 Constraints ---------- */
      const POS = "#position-section";
      const nested = [
        { ...CARD },
        {
          id: "inner",
          name: "Inner",
          type: "frame",
          parentId: "card",
          x: 20,
          y: 20,
          w: 100,
          h: 80,
          color: "#dddddd",
        },
      ];
      await load(nested, ["card"]);
      await snap("B4", "constraints-top-level", POS, { block: "start" });
      await snap("B4", "top-level-dimmed", POS, { block: "start" });
      await load(nested, ["inner"]);
      await snap("B4", "constraints-child", POS, { block: "start", nodeId: "inner" });
      await snap("B4", "constraints-child-hover", POS, {
        block: "start",
        nodeId: "inner",
        hover: `${POS} [role=group][aria-label=Constraints]`,
      });
      await load(flexFrame(), ["c1"]);
      await snap("B4", "constraints-flex-child", POS, { block: "start", nodeId: "c1" });
      await load(
        flexFrame().map((n) =>
          n.id === "c1" ? { ...n, position: "absolute", inset: [20, null, null, 20] } : n,
        ),
        ["c1"],
      );
      await snap("B4", "nested-absolute-constraints", POS, { block: "start", nodeId: "c1" });
      await click(`${POS} [data-constraint-menu=h]`);
      await snap("B4", "constraint-menu", POS, { scroll: false, nodeId: "c1" });
      await page.keyboard.press("Escape");

      /* ---------- B5 Variable chip offset ---------- */
      const chipOffsets = () =>
        page.evaluate(() => {
          const out = {};
          for (const el of document.querySelectorAll(
            "#properties [data-bound], #properties [data-field-shell]",
          )) {
            const key = el.getAttribute("data-bound") || el.querySelector("input")?.name;
            if (!key || out[key]) continue;
            const f = el.getBoundingClientRect();
            const prefix = el.querySelector("span")?.getBoundingClientRect();
            const chip = el.querySelector("[data-variable-chip]");
            const input = el.querySelector("input");
            let textLeft = null;
            if (chip) textLeft = chip.getBoundingClientRect().left;
            else if (input) textLeft = input.getBoundingClientRect().left; // value text starts at the input's left edge
            const r = (v) => (v == null ? null : Math.round(v * 100) / 100);
            out[key] = {
              bound: !!chip,
              fieldLeft: r(f.left),
              fieldWidth: r(f.width),
              prefixLeft: prefix ? r(prefix.left - f.left) : null,
              prefixRight: prefix ? r(prefix.right - f.left) : null,
              contentLeft: r(textLeft - f.left),
              gapAfterPrefix: prefix ? r(textLeft - prefix.right) : null,
              chipHeight: chip ? r(chip.getBoundingClientRect().height) : null,
              chipText: chip?.textContent ?? null,
            };
          }
          return out;
        });
      await load(
        card({ radius: 24, opacity: 60, bindings: { radius: "spacing", opacity: "strength" } }),
      );
      await snap("B5", "numeric-variable-chip", APP, { block: "start", extra: chipOffsets });
      await load(card({ radius: 24, opacity: 60 }));
      await snap("B5", "numeric-prefix", APP, { block: "start", extra: chipOffsets });
      await snap("B5", "numeric-plain", APP, { block: "start", extra: chipOffsets });
      await page.hover(`${APP} [name=radius]`);
      await click(`${APP} [data-bind=radius]`);
      await snap("B5", "numeric-menu", APP, { scroll: false });
      await page.keyboard.press("Escape");
      await load(card());
      await scroll(LAYOUT, "start");
      await snap("B5", "width-hover", LAYOUT, { scroll: false, hover: `${LAYOUT} [name=w]` });
      await click(`${LAYOUT} [data-bind=w]`);
      await snap("B5", "width-variable-search", LAYOUT, { scroll: false });
      await page.keyboard.press("Escape");
      await load(flexFrame({ bindings: { gap: "spacing", paddingX: "spacing" } }));
      await snap("B5", "chip-bound-layout", LAYOUT, { block: "start", extra: chipOffsets });

      /* ---------- C1 Position ---------- */
      await load(nested, ["card"]);
      await snap("C1", "position-top-level", POS, { block: "start" });
      await load(nested, ["inner"]);
      await snap("C1", "position-child", POS, { block: "start", nodeId: "inner" });
      await load(
        [
          nested[0],
          nested[1],
          {
            id: "inner2",
            name: "Inner 2",
            type: "frame",
            parentId: "card",
            x: 140,
            y: 20,
            w: 100,
            h: 80,
            color: "#cccccc",
            inset: [20, 30, null, null],
          },
        ],
        ["inner", "inner2"],
      );
      await snap("C1", "position-multi-mixed", POS, { block: "start", nodeId: "inner" });

      /* ---------- C2 Display ---------- */
      for (const layout of ["free", "flex", "block", "grid"]) {
        await load(card({ layout, ...(layout === "grid" ? { columns: 2 } : {}) }));
        await snap("C2", `display-${layout === "free" ? "none" : layout}`, LAYOUT, {
          block: "start",
        });
      }
      await load([
        {
          id: "rect",
          name: "Rect",
          type: "rectangle",
          x: 100,
          y: 100,
          w: 100,
          h: 100,
          color: "#ff0000",
        },
      ]);
      await snap("C2", "display-rectangle", LAYOUT, { block: "start", nodeId: "rect" });

      /* ---------- C3 Flex ---------- */
      await load(flexFrame());
      await snap("C3", "flex-controls", LAYOUT, { block: "start" });
      await load(
        flexFrame({ direction: "column", alignItems: "center", justifyContent: "center" }),
      );
      await snap("C3", "flex-column-centered", LAYOUT, { block: "start" });
      await load(flexFrame({ justifyContent: "space-between", flexWrap: true, reverse: true }));
      await snap("C3", "flex-between-wrap-reverse", LAYOUT, { block: "start" });
      await load(flexFrame());
      await load(flexFrame({ direction: "column" }));
      await snap("C3", "flex-column", LAYOUT, { block: "start" });
      await load(flexFrame({ flexWrap: true }));
      await snap("C3", "flex-wrap-on", LAYOUT, { block: "start" });
      await load(flexFrame({ reverse: true }));
      await snap("C3", "flex-reverse-on", LAYOUT, { block: "start" });
      await load(flexFrame({ alignItems: "center", justifyContent: "center" }));
      await snap("C3", "flex-align-center", LAYOUT, { block: "start" });
      await load(flexFrame({ justifyContent: "space-between" }));
      await snap("C3", "flex-distribution", LAYOUT, { block: "start" });
      await load(flexFrame());
      await snap("C3", "flex-matrix-hover", LAYOUT, {
        block: "start",
        hover: `${LAYOUT} [role=group][aria-label=Alignment] [data-cell="1-1"]`,
      });

      /* ---------- C4 Grid ---------- */
      const grid = [
        { ...CARD, layout: "grid", columns: 3, gap: 8, gapY: 12, padding: 16 },
        ...[1, 2, 3, 4].map((i) => ({
          id: "g" + i,
          name: "Cell " + i,
          type: "rectangle",
          parentId: "card",
          x: 0,
          y: 0,
          w: 60,
          h: 40,
          color: "#dddddd",
        })),
      ];
      await load(grid);
      await snap("C4", "grid", LAYOUT, { block: "start" });
      await load([{ ...CARD, layout: "grid", columns: 1 }]);
      await snap("C4", "grid-controls", LAYOUT, { block: "start" });
      await load(grid);
      await click("#grid-tracks");
      await snap("C4", "grid-tracks-popover", LAYOUT, { scroll: false });
      await page.keyboard.press("Escape");

      /* ---------- C5 Grid child ---------- */
      await load(
        [
          ...grid.slice(0, 2).map((n) => (n.id === "g1" ? { ...n, colSpan: 2 } : n)),
          ...grid.slice(2),
        ],
        ["g1"],
      );
      await snap("C5", "grid-child", LAYOUT, { block: "start", nodeId: "g1" });

      /* ---------- C6 Padding ---------- */
      await load(flexFrame());
      await scroll(LAYOUT, "start");
      await snap("C6", "padding-collapsed", LAYOUT, { block: "end" });
      await click(`${LAYOUT} button[aria-label="Independent padding"]`);
      await away();
      await snap("C6", "padding-expanded", LAYOUT, { block: "end" });
      await load(flexFrame({ paddingTop: 4, paddingRight: 8, paddingBottom: 12, paddingLeft: 16 }));
      await snap("C6", "padding-mixed-sides", LAYOUT, { block: "end" });

      /* ---------- C7 Margin ---------- */
      await load(flexFrame(), ["c1"]);
      await snap("C7", "margin-px", LAYOUT, { block: "start", nodeId: "c1" });
      await load(
        flexFrame().map((n) => (n.id === "c1" ? { ...n, margin: [0, "auto", 0, "auto"] } : n)),
        ["c1"],
      );
      await snap("C7", "margin-auto", LAYOUT, { block: "start", nodeId: "c1" });
      await load(flexFrame(), ["c1"]);
      await scroll(LAYOUT, "start");
      await click(`${LAYOUT} [data-unit-menu]`);
      await snap("C7", "margin-unit-menu", LAYOUT, { scroll: false, nodeId: "c1" });
      await page.keyboard.press("Escape");
      await load(
        flexFrame().map((n) => (n.id === "c1" ? { ...n, margin: [0, "auto", 0, "auto"] } : n)),
        ["c1"],
      );
      await click(`${LAYOUT} button[aria-label="Independent margins"]`);
      await away();
      await snap("C7", "margin-auto-sides", LAYOUT, { block: "start", nodeId: "c1" });

      /* ---------- C8 Page ---------- */
      await load(card(), []);
      await snap("C8", "page-no-selection", "#page-section");
      await page.evaluate(() => window.design.updatePage({ background: "#1E1E1E" }));
      await page.waitForTimeout(250);
      await snap("C8", "page-custom-background", "#page-section", {
        extra: () => page.evaluate(() => window.design.getDocument().pages[0].background),
      });
    } // legacy

    const file = path.join(OUT, "metrics.json");
    let previous = [];
    if (only.length)
      previous = JSON.parse(await fs.readFile(file, "utf8").catch(() => "[]")).filter(
        (m) => !metrics.some((n) => n.file === m.file),
      );
    await fs.writeFile(file, JSON.stringify([...previous, ...metrics], null, 1));
    console.log(`done: ${metrics.length} shots`);
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
