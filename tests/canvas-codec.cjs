// Renderer parity for codec output: JSX built by integrations/design-edit.mjs is rendered by the
// real canvas (web/app.js) and the DOM boxes are compared with the headless layout estimate.
const { _electron } = require("@playwright/test");
const { moveOffCursor } = require("./helpers/off-cursor.cjs");
const { MOD } = require("./helpers/keys.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const { createArtboards, indexPage } = await import(
    pathToFileURL(path.resolve("integrations/design-edit.mjs")).href
  );
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-codec-")),
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${dir}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await moveOffCursor(app);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForSelector("#canvas .layer");
    const blank = {
      version: 2,
      name: "Codec",
      activePage: "p1",
      pages: [{ id: "p1", name: "Page", nodes: [] }],
      tokens: {},
    };
    const { document, roots } = createArtboards(
      blank,
      "p1",
      `<section data-component-x="0" data-component-y="0" className="w-[480px] p-8 bg-[#000] text-[#fff] text-sm font-sans">
      <h1 className="text-3xl font-semibold">Block flow keeps padding</h1>
      <p>A paragraph long enough to wrap onto a second line inside the padded section, so its siblings must move down.</p>
      <div className="relative flex items-center gap-x-4 rounded-t-2xl rounded-b-md px-6 py-3 ring-1 ring-white/20 mt-4">
        <span className="uppercase tracking-widest text-xs">Tag</span><p className="flex-1 truncate">Fills the rest of the row</p>
        <span className="absolute -top-2 right-2 rounded-full bg-red-500 px-2 text-xs">New</span>
      </div>
    </section>`,
    );
    const index = indexPage(document.pages[0]);
    await page.evaluate((d) => {
      window.design.setDocument(d);
      window.design.setSelection([]);
      window.design.setCamera(0, 0, 1);
    }, document);
    await page.evaluate(() => document.fonts.ready);
    const boxes = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll("#canvas [data-id]")].map((el) => {
          const r = el.getBoundingClientRect(),
            s = getComputedStyle(el);
          return [
            el.dataset.id,
            {
              x: r.left,
              y: r.top,
              w: r.width,
              h: r.height,
              padding: s.padding,
              radius: s.borderRadius,
              shadow: s.boxShadow,
              color: s.color,
              transform: s.textTransform,
              position: s.position,
            },
          ];
        }),
      ),
    );
    const root = roots[0],
      [h1, p, row] = index.children(root.id),
      [tag, fill, badge] = index.children(row.id);
    const at = (id) => ({
      ...boxes[id],
      x: boxes[id].x - boxes[root.id].x,
      y: boxes[id].y - boxes[root.id].y,
    });
    assert.equal(boxes[root.id].padding, "32px");
    for (const child of [h1, p, row]) {
      assert.equal(Math.round(at(child.id).x), 32, "padding respected");
      assert.equal(Math.round(at(child.id).w), 416, "block children stretch");
    }
    assert.ok(
      at(p.id).y >= at(h1.id).y + at(h1.id).h - 0.5 &&
        at(row.id).y >= at(p.id).y + at(p.id).h + 15.5,
      "siblings stack without overlap",
    );
    assert.ok(at(p.id).h > 30, "paragraph wraps");
    assert.equal(boxes[p.id].color, "rgb(255, 255, 255)", "color inherited");
    assert.equal(boxes[row.id].radius, "16px 16px 6px 6px");
    assert.match(boxes[row.id].shadow, /0px 0px 0px 1px/);
    assert.equal(boxes[row.id].padding, "12px 24px");
    assert.equal(boxes[tag.id].transform, "uppercase");
    const rowBox = boxes[row.id],
      fillBox = boxes[fill.id];
    assert.ok(
      Math.abs(fillBox.x + fillBox.w - (rowBox.x + rowBox.w - 24)) < 1,
      "flex-1 fills the row",
    );
    assert.equal(boxes[badge.id].position, "absolute");
    assert.ok(
      Math.abs(boxes[badge.id].x + boxes[badge.id].w - (rowBox.x + rowBox.w - 8)) < 1 &&
        Math.abs(boxes[badge.id].y - (rowBox.y - 8)) < 1,
      "absolute badge uses its insets",
    );
    // Headless estimate vs real layout: fixed geometry exact, text-driven geometry close.
    for (const n of [h1, p, row, badge]) {
      const real = at(n.id);
      assert.ok(Math.abs(real.x - (n.parentId === root.id ? n.x : real.x)) < 1, `${n.name} x`);
    }
    const estimate = index.children(root.id).map((n) => n.y),
      real = index.children(root.id).map((n) => at(n.id).y);
    real.forEach((y, i) =>
      assert.ok(Math.abs(y - estimate[i]) < 8, `estimated y ${estimate[i]} vs rendered ${y}`),
    );
    console.log(
      "PASS codec parity: block flow padding, stretch, inheritance, per-corner radius, ring, flex-1, absolute badge, estimate within tolerance",
    );

    // Canvas vs headless export: both use web/node-style.js, so every box must match.
    const { exportHTML } = await import(
      pathToFileURL(path.resolve("integrations/export-html.mjs")).href
    );
    const second = createArtboards(
      blank,
      "p1",
      `<section data-component-x="0" data-component-y="0" className="w-[520px] p-6 space-y-3 bg-white text-zinc-900 border border-zinc-200 rounded-t-2xl">
      <h2 className="text-xl font-semibold mb-6">Margins collapse like CSS</h2>
      <p className="mt-2 text-sm">mt-2 after mb-6 gives 24px, not 32px.</p>
      <div className="max-w-[240px] mx-auto flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-100 text-indigo-600"><Icon name="lucide:arrow-right" className="size-4"/><span className="text-sm">Centered</span></div>
      <div className="relative grid grid-cols-3 gap-x-4 gap-y-2"><div className="h-[30px] bg-zinc-200"/><div className="h-[30px] bg-zinc-200"/><div className="h-[30px] bg-zinc-200"/><div className="col-span-2 h-[30px] bg-zinc-300"/><span className="absolute -top-2 right-0 text-xs">abs</span></div>
    </section>`,
    );
    const doc2 = second.document;
    await page.evaluate((d) => {
      window.design.setDocument(d);
      window.design.setSelection([]);
      window.design.setCamera(0, 0, 1);
    }, doc2);
    const canvasBoxes = await page.evaluate(() => {
      const els = [...document.querySelectorAll("#canvas [data-id]")],
        o = els[0].getBoundingClientRect();
      return els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
      });
    });
    const exportBoxes = await page.evaluate(
      (html) =>
        new Promise((resolve) => {
          const frame = document.createElement("iframe");
          frame.style.cssText = "position:fixed;left:0;top:0;width:1400px;height:900px;border:0";
          frame.srcdoc = html;
          frame.onload = () => {
            const els = [...frame.contentDocument.querySelectorAll("[data-name]")],
              o = els[0].getBoundingClientRect();
            resolve(
              els.map((el) => {
                const r = el.getBoundingClientRect();
                return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
              }),
            );
            frame.remove();
          };
          document.body.append(frame);
        }),
      exportHTML(doc2, "p1"),
    );
    assert.equal(exportBoxes.length, canvasBoxes.length, "same element count");
    canvasBoxes.forEach((c, i) => {
      const e = exportBoxes[i];
      for (const k of ["x", "y", "w", "h"])
        assert.ok(
          Math.abs(c[k] - e[k]) < 0.6,
          `element ${i} ${k}: canvas ${c[k]} vs export ${e[k]}`,
        );
    });
    const ids = indexPage(doc2.pages[0]),
      [heading, para, pill] = ids.children(second.roots[0].id);
    const order = [];
    const walk = (id) => {
      for (const c of ids.children(id)) {
        order.push(c);
        walk(c.id);
      }
    };
    order.push(second.roots[0]);
    walk(second.roots[0].id);
    const box = (n) => canvasBoxes[order.indexOf(n)];
    assert.ok(
      Math.abs(box(para).y - (box(heading).y + box(heading).h) - 24) < 0.6,
      "sibling margins collapse to max(mb-6, mt-2)",
    );
    assert.ok(
      Math.abs(box(pill).x - (box(second.roots[0]).w - 240) / 2) < 0.6 &&
        Math.abs(box(pill).w - 240) < 0.6,
      "max-w + mx-auto centers",
    );
    for (const n of [heading, para, pill])
      assert.ok(Math.abs(box(n).y - n.y) < 6, `${n.name}: estimate y ${n.y} vs canvas ${box(n).y}`);
    const icon = ids.children(pill.id)[0];
    assert.equal(icon.icon, "lucide:arrow-right");
    assert.match(
      Buffer.from(icon.src.split(",")[1], "base64").toString(),
      /stroke="#4f39f6"/,
      "icon inherits text color",
    );
    // Dragging an absolute child of a flow frame moves it by rewriting its insets.
    const grid = ids.children(second.roots[0].id)[3],
      abs = ids.children(grid.id).find((n) => n.position === "absolute");
    assert.deepEqual(abs.inset, [-8, 0, null, null]);
    await page.evaluate((id) => window.design.setSelection([id]), abs.id);
    const before = await page.evaluate((id) => {
      const r = document.querySelector(`#canvas [data-id="${id}"]`).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top };
    }, abs.id);
    await page.mouse.move(before.x, before.y);
    await page.mouse.down();
    await page.keyboard.down(MOD); // ⌘ (Ctrl off macOS): no snapping
    for (let i = 1; i <= 5; i++) await page.mouse.move(before.x - 4 * i, before.y + 2 * i);
    await page.mouse.up();
    await page.keyboard.up(MOD);
    const moved = await page.evaluate(
      (id) => window.design.getDocument().pages[0].nodes.find((n) => n.id === id),
      abs.id,
    );
    const after = await page.evaluate((id) => {
      const r = document.querySelector(`#canvas [data-id="${id}"]`).getBoundingClientRect();
      return { left: r.left, top: r.top };
    }, abs.id);
    assert.deepEqual(moved.inset, [2, 20, null, null], "top/right insets follow the drag");
    assert.ok(
      Math.abs(after.left - before.left + 20) < 1 && Math.abs(after.top - before.top - 10) < 1,
      "rendered badge moved with the pointer",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS canvas/export parity (shared node-style): margin collapse, space-y, mx-auto, grid gaps + col-span, absolute inset, icon color inheritance, absolute drag updates inset",
    );
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
