// Electron: vector layers on the canvas (docs/vector-nodes.md). A vector renders as an inline <svg> stretched over its
// box with non-scaling strokes (resize, rotation, opacity and blend apply to the box), exports to HTML and PNG/PDF, and
// shows in the layers panel and inspector (Fill, Stroke with cap / join / dash). The Pen tool draws corner and smooth
// anchors and closes on the first anchor; double-clicking a vector edits its anchors (move, handle drag with Alt,
// add on a segment, delete), each one undo step; pasted and dropped SVG become vectors (or images when they can't);
// Copy as SVG writes the selection as one SVG document (web/vector-edit.js).
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { mod } = require("./helpers/keys.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const ARROW = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff0000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-vectors-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  env.VERYNIZE_LAUNCH_EDITOR = "1";
  const app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await waitForUiReady(page);
    await page.waitForSelector("#canvas .layer");
    const nodes = () =>
      page.evaluate(() => {
        const d = window.design.getDocument();
        return d.pages.find((p) => p.id === d.activePage).nodes;
      });
    const node = async (id) => (await nodes()).find((n) => n.id === id);
    const frame = () =>
      page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
    const blur = () => page.evaluate(() => document.activeElement?.blur?.());
    const undo = async () => {
      await blur();
      await page.keyboard.press(mod("KeyZ"));
      await frame();
    };
    const redo = async () => {
      await blur();
      await page.keyboard.press(mod("Shift+KeyZ"));
      await frame();
    };
    await page.evaluate(() => {
      const d = window.design.getDocument();
      d.pages.find((p) => p.id === d.activePage).nodes = [];
      window.design.loadDocument(d);
      window.design.setSelection([]);
      window.design.setCamera(0, 0, 1);
    });
    const wrap = await page.locator("#canvas-wrap").boundingBox();
    assert.ok(
      wrap.width >= 820 && wrap.height >= 700,
      `the canvas is large enough for the gestures (${wrap.width}×${wrap.height})`,
    );
    const at = (x, y) => [wrap.x + x, wrap.y + y]; // world → client at camera (0, 0, 1)

    // ---- 1. Rendering: inline <svg>, stretched viewBox, non-scaling stroke, box geometry and effects.
    const icon = await page.evaluate(() =>
      window.design.addNode("vector", {
        name: "Arrow",
        parentId: null,
        x: 100,
        y: 100,
        w: 96,
        h: 96,
        viewBox: [0, 0, 24, 24],
        paths: [{ d: "M5 12h14" }, { d: "m12 5 7 7-7 7" }],
        fills: [],
        strokeWidth: 4,
        strokeColor: "#ff0000",
        strokeCap: "round",
        strokeJoin: "round",
      }),
    );
    const drawn = () =>
      page.evaluate((id) => {
        const el = document.querySelector(`#canvas .layer[data-id="${id}"]`),
          svg = el.querySelector(":scope > svg"),
          style = getComputedStyle(el);
        const r = el.getBoundingClientRect(),
          s = svg.getBoundingClientRect();
        return {
          type: el.dataset.designType,
          viewBox: svg.getAttribute("viewBox"),
          aspect: svg.getAttribute("preserveAspectRatio"),
          paths: [...svg.querySelectorAll("path")].map((p) => [
            p.getAttribute("d"),
            p.getAttribute("stroke"),
            p.getAttribute("stroke-width"),
            p.getAttribute("vector-effect"),
          ]),
          box: [r.width, r.height],
          svgBox: [s.width, s.height],
          background: style.backgroundColor,
          border: style.borderTopWidth,
          radius: style.borderTopLeftRadius,
          opacity: style.opacity,
          blend: style.mixBlendMode,
          transform: style.transform,
        };
      }, icon);
    let d = await drawn();
    assert.equal(d.type, "vector");
    assert.deepEqual([d.viewBox, d.aspect], ["0 0 24 24", "none"]);
    assert.deepEqual(d.paths, [
      ["M5 12h14", "#ff0000", "4", "non-scaling-stroke"],
      ["m12 5 7 7-7 7", "#ff0000", "4", "non-scaling-stroke"],
    ]);
    assert.deepEqual(d.box, [96, 96]);
    assert.deepEqual(d.svgBox, [96, 96]);
    assert.deepEqual(
      [d.background, d.border, d.radius],
      ["rgba(0, 0, 0, 0)", "0px", "0px"],
      "the box itself paints nothing",
    );
    await page.evaluate(
      (id) =>
        window.design.updateNodes([id], {
          w: 192,
          h: 48,
          rotation: 30,
          opacity: 50,
          blendMode: "multiply",
        }),
      icon,
    );
    d = await drawn();
    assert.deepEqual(
      d.svgBox.map(Math.round),
      [
        Math.round(192 * Math.cos(Math.PI / 6) + 48 * Math.sin(Math.PI / 6)),
        Math.round(192 * Math.sin(Math.PI / 6) + 48 * Math.cos(Math.PI / 6)),
      ],
      "the drawing follows the resized, rotated box",
    );
    assert.equal(d.paths[0][2], "4", "the stroke width does not scale with the box");
    assert.equal(d.opacity, "0.5");
    assert.notEqual(d.transform, "none");
    await page.evaluate(
      (id) =>
        window.design.updateNodes([id], {
          w: 96,
          h: 96,
          rotation: 0,
          opacity: 100,
          blendMode: undefined,
        }),
      icon,
    );
    console.log("PASS vectors render as stretched inline SVG with non-scaling strokes");

    // ---- 2. Layers panel icon and inspector: Fill + Stroke (cap, join, dash).
    await page.evaluate((id) => window.design.setSelection([id]), icon);
    await frame();
    assert.equal(
      (await page.locator(`[data-id="${icon}"] svg.lucide-pen-tool`).count()) >= 1,
      true,
      "layer row uses the vector icon",
    );
    await page.waitForSelector("#vector-stroke-section");
    assert.equal(await page.locator("#fill-section h3").first().textContent(), "Fill");
    assert.equal(
      await page.locator("#border-section").count(),
      0,
      "no box Border section for vectors",
    );
    await page.locator('#vector-stroke-section select[name="strokeCap"]').selectOption("square");
    await page.locator('#vector-stroke-section select[name="strokeJoin"]').selectOption("bevel");
    const dash = page.locator('#vector-stroke-section input[name="strokeDash"]');
    await dash.fill("6 3");
    await dash.press("Enter");
    await frame();
    let n = await node(icon);
    assert.deepEqual([n.strokeCap, n.strokeJoin, n.strokeDash], ["square", "bevel", [6, 3]]);
    d = await drawn();
    assert.equal(
      await page.locator(`#canvas .layer[data-id="${icon}"] path[stroke-dasharray="6 3"]`).count(),
      2,
    );
    await undo();
    assert.equal((await node(icon)).strokeDash, undefined, "each inspector edit is one undo step");
    await redo();
    console.log("PASS layers panel icon and inspector Fill / Stroke edit vectors");

    // ---- 3. Export: HTML keeps the inline SVG; PNG paints the stroke; PDF renders.
    const exported = await page.evaluate(async (id) => {
      window.design.setSelection([id]);
      const html = await window.design.exportArtwork({ format: "HTML", selectionOnly: true });
      const png = await window.design.exportArtwork({ format: "PNG", selectionOnly: true });
      const img = new Image();
      img.src = png.dataURL;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      // The arrow shaft runs along y = 12 of 24: the middle row is red, a corner is empty.
      const mid = [
        ...g.getImageData(Math.round(img.width / 2), Math.round(img.height / 2), 1, 1).data,
      ];
      const corner = [...g.getImageData(2, 2, 1, 1).data];
      let pdf = null;
      if (window.desktop?.renderPDF) {
        const out = await window.desktop.renderPDF({
          html: html.content,
          width: Math.ceil(html.width),
          height: Math.ceil(html.height),
          title: "Vector",
        });
        pdf = atob(out.dataURL.split(",")[1]).slice(0, 5);
      }
      return { html: html.content, size: [img.width, img.height], mid, corner, pdf };
    }, icon);
    assert.match(exported.html, /<svg[^>]*viewBox="0 0 24 24"[^>]*preserveAspectRatio="none"/);
    assert.ok(
      exported.mid[0] > 200 && exported.mid[1] < 60 && exported.mid[3] > 200,
      `PNG centre is the red stroke (${exported.mid.join(",")})`,
    );
    assert.equal(exported.corner[3], 0, "PNG corner is transparent");
    if (exported.pdf !== null) assert.equal(exported.pdf, "%PDF-");
    console.log("PASS vectors export to HTML, PNG and PDF");

    // ---- 4. Pen tool: corner + smooth anchors, Enter finishes, one undo step, tool back to Move.
    await page.evaluate(() => window.design.setSelection([]));
    await page.locator("#pen-tool").click();
    assert.equal(await page.evaluate(() => window.design.getTool()), "pen");
    assert.equal(await page.locator("#pen-tool").getAttribute("aria-pressed"), "true");
    await page.mouse.click(...at(400, 300));
    await page.mouse.move(...at(500, 250));
    await page.mouse.down();
    await page.mouse.move(...at(560, 250), { steps: 6 });
    await page.mouse.up();
    await page.mouse.click(...at(600, 400));
    const draft = await page.evaluate(() => window.vectorEdit.drawing());
    assert.equal(draft.length, 3);
    assert.deepEqual(
      [draft[1].ox, draft[1].oy, draft[1].ix, draft[1].iy],
      [560, 250, 440, 250],
      "dragging pulls symmetric handles",
    );
    assert.ok(
      (await page.locator("#vector-edit-overlay .vector-edit-anchor").count()) === 3,
      "the overlay draws the anchors",
    );
    const before = (await nodes()).length;
    await page.keyboard.press("Enter");
    await frame();
    let list = await nodes();
    assert.equal(list.length, before + 1);
    const pen = list.at(-1);
    assert.equal(pen.type, "vector");
    assert.deepEqual(
      [pen.x, pen.y, pen.w, pen.h],
      [400, 250, 200, 150],
      "the new vector hugs its geometry",
    );
    assert.equal(pen.paths[0].d, "M0 50C0 50 40 0 100 0C160 0 200 150 200 150");
    assert.deepEqual([pen.fills, pen.strokeWidth], [[], 2]);
    assert.equal(await page.evaluate(() => window.design.getTool()), "move");
    assert.deepEqual(await page.evaluate(() => window.design.getSelection()), [pen.id]);
    await undo();
    assert.equal((await nodes()).length, before, "undo removes the path");
    await redo();
    assert.equal((await nodes()).length, before + 1, "redo brings it back");

    // A closed path: click the first anchor again. Escape with one anchor draws nothing.
    await page.keyboard.press("p");
    assert.equal(await page.evaluate(() => window.design.getTool()), "pen", "P arms the Pen tool");
    await page.mouse.click(...at(700, 100));
    await page.mouse.click(...at(800, 100));
    await page.mouse.click(...at(750, 180));
    await page.mouse.click(...at(700, 100));
    await frame();
    list = await nodes();
    const triangle = list.at(-1);
    assert.equal(list.length, before + 2);
    assert.match(triangle.paths[0].d, /Z$/, "clicking the first anchor closes the path");
    assert.deepEqual([triangle.w, triangle.h], [100, 80]);
    await page.keyboard.press("p");
    await page.mouse.click(...at(650, 460));
    await page.keyboard.press("Backspace");
    assert.deepEqual(
      await page.evaluate(() => window.vectorEdit.drawing()),
      [],
      "Backspace removes the last anchor",
    );
    await page.mouse.click(...at(650, 460));
    await page.keyboard.press("Escape");
    assert.equal((await nodes()).length, before + 2, "one anchor draws nothing");
    assert.equal(await page.evaluate(() => window.design.getTool()), "move");
    console.log(
      "PASS pen tool draws corner and smooth anchors, closes paths and undoes in one step",
    );

    // ---- 5. Anchor editing on the pen path: move an anchor, drag handles, add a point, delete it.
    const box = await page.locator(`#canvas .layer[data-id="${pen.id}"]`).boundingBox();
    await page.mouse.click(box.x + 4, box.y + box.height / 3);
    await page.mouse.dblclick(box.x + 4, box.y + box.height / 3);
    let editing = await page.evaluate(() => window.vectorEdit.editing());
    assert.equal(editing?.id, pen.id, "double-click enters anchor editing");
    assert.equal(
      await page.evaluate(() => document.body.classList.contains("vector-editing")),
      true,
    );
    let a0 = await page.evaluate(() => window.vectorEdit.anchorScreen(0, 0, 0));
    await page.mouse.move(a0.x, a0.y);
    await page.mouse.down();
    await page.mouse.move(a0.x - 50, a0.y + 30, { steps: 5 });
    await page.mouse.up();
    await frame();
    n = await node(pen.id);
    assert.equal(n.paths[0].d, "M-50 80C-50 80 40 0 100 0C160 0 200 150 200 150");
    assert.deepEqual(
      [n.x, n.y, n.w, n.h, n.viewBox],
      [350, 250, 250, 150, [-50, 0, 250, 150]],
      "the box refits; the drawing stays put",
    );
    await undo();
    n = await node(pen.id);
    assert.equal(
      n.paths[0].d,
      "M0 50C0 50 40 0 100 0C160 0 200 150 200 150",
      "undo restores the anchor",
    );
    assert.deepEqual([n.x, n.w], [400, 200]);
    await frame();
    editing = await page.evaluate(() => window.vectorEdit.editing());
    assert.equal(editing?.id, pen.id, "editing follows undo");
    // The smooth middle anchor: select it, drag its outgoing handle; the incoming one stays in line.
    const a1 = await page.evaluate(() => window.vectorEdit.anchorScreen(0, 0, 1));
    await page.mouse.click(a1.x, a1.y);
    await frame();
    await page.mouse.move(a1.x + 60, a1.y);
    await page.mouse.down();
    await page.mouse.move(a1.x + 60, a1.y + 40, { steps: 4 });
    await page.mouse.up();
    await frame();
    let pt = (await page.evaluate(() => window.vectorEdit.editing())).anchors[0][0][1];
    assert.deepEqual([pt.ox, pt.oy], [160, 40]);
    const angleIn = Math.atan2(pt.y - pt.iy, pt.x - pt.ix),
      angleOut = Math.atan2(pt.oy - pt.y, pt.ox - pt.x);
    assert.ok(
      Math.abs(angleIn - angleOut) < 1e-3,
      "a smooth anchor keeps its handles in line (paths store 3 decimals)",
    );
    assert.ok(
      Math.abs(Math.hypot(pt.x - pt.ix, pt.y - pt.iy) - 60) < 1e-3,
      "the other handle keeps its length",
    );
    // Alt breaks the symmetry.
    const handle = { x: a1.x + 60, y: a1.y + 40 };
    await page.keyboard.down("Alt");
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x, handle.y - 80, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await frame();
    const broken = (await page.evaluate(() => window.vectorEdit.editing())).anchors[0][0][1];
    assert.deepEqual(
      [broken.ox, broken.oy, broken.ix, broken.iy].map((v) => Math.round(v * 10) / 10),
      [160, -40, pt.ix, pt.iy].map((v) => Math.round(v * 10) / 10),
      "Alt moves one handle alone",
    );
    // Click on the straight-ish first segment to add an anchor, then delete it.
    const count = (await node(pen.id)).paths[0].d.match(/[LC]/g).length;
    const onSegment = await page.evaluate((id) => {
      const svg = document.querySelector(`#canvas .layer[data-id="${id}"] > svg`),
        path = svg.querySelector("path"),
        p = path.getPointAtLength(path.getTotalLength() * 0.15),
        m = svg.getScreenCTM();
      return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
    }, pen.id);
    await page.mouse.click(onSegment.x, onSegment.y);
    await frame();
    editing = await page.evaluate(() => window.vectorEdit.editing());
    assert.equal(editing.anchors[0][0].length, 4, "a click on a segment adds an anchor");
    assert.deepEqual(editing.selected, [{ p: 0, c: 0, k: 1 }]);
    assert.equal((await node(pen.id)).paths[0].d.match(/[LC]/g).length, count + 1);
    await page.keyboard.press("Delete");
    await frame();
    assert.equal(
      (await node(pen.id)).paths[0].d.match(/[LC]/g).length,
      count,
      "Delete removes the selected anchor",
    );
    assert.ok(await node(pen.id), "the layer stays");
    await undo();
    assert.equal(
      (await node(pen.id)).paths[0].d.match(/[LC]/g).length,
      count + 1,
      "deleting is one undo step",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.evaluate(() => window.vectorEdit.editing()),
      null,
      "Escape leaves anchor editing",
    );
    assert.deepEqual(await page.evaluate(() => window.design.getSelection()), [pen.id]);
    console.log(
      "PASS anchor editing moves anchors and handles, adds and deletes points, undoes per step",
    );

    // ---- 6. Paste and drop SVG; unsupported SVG falls back to an image.
    const paste = (text) =>
      page.evaluate((markup) => {
        const dt = new DataTransfer();
        dt.setData("text/plain", markup);
        document.body.focus();
        document.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
        );
      }, text);
    let count0 = (await nodes()).length;
    await paste(ARROW);
    await frame();
    list = await nodes();
    assert.equal(list.length, count0 + 1);
    const pasted = list.at(-1);
    assert.deepEqual(
      [pasted.type, pasted.name, pasted.w, pasted.h, pasted.strokeColor, pasted.strokeCap],
      ["vector", "Pasted SVG", 24, 24, "#ff0000", "round"],
    );
    assert.deepEqual(await page.evaluate(() => window.design.getSelection()), [pasted.id]);
    await undo();
    assert.equal((await nodes()).length, count0, "a paste is one undo step");
    await paste(ARROW.replace("</svg>", "<text>A</text></svg>"));
    for (let i = 0; i < 40 && (await nodes()).length === count0; i++) await frame();
    list = await nodes();
    assert.equal(list.at(-1).type, "image", "an SVG a vector cannot hold pastes as an image");
    const dropSvg = (markup, name, x, y) =>
      page.evaluate(
        async ({ markup, name, x, y }) => {
          const dt = new DataTransfer();
          dt.items.add(new File([markup], name, { type: "image/svg+xml" }));
          const target = document.elementFromPoint(x, y);
          const init = {
            dataTransfer: dt,
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          };
          target.dispatchEvent(new DragEvent("dragover", init));
          window.vectorEdit.lastDrop = null;
          const drop = new DragEvent("drop", init);
          target.dispatchEvent(drop);
          return { prevented: drop.defaultPrevented, ids: await window.vectorEdit.lastDrop };
        },
        { markup, name, x, y },
      );
    count0 = (await nodes()).length;
    const logo = `<svg viewBox="0 0 40 20" width="80" height="40"><rect width="16" height="16" fill="#2563eb"/><circle cx="28" cy="8" r="8" fill="#f97316"/></svg>`;
    const dropped = await dropSvg(logo, "logo.svg", ...at(300, 600));
    assert.equal(dropped.prevented, true);
    list = await nodes();
    const group = list.find((x) => x.id === dropped.ids[0]);
    assert.deepEqual([group.type, group.name, group.w, group.h], ["frame", "logo", 80, 40]);
    assert.deepEqual([group.x + 40, group.y + 20], [300, 600], "centred on the drop point");
    assert.deepEqual(
      list.filter((x) => x.parentId === group.id).map((x) => [x.type, x.x, x.y, x.w, x.h]),
      [
        ["vector", 0, 0, 32, 32],
        ["vector", 40, 0, 32, 32],
      ],
    );
    const gradient = `<svg viewBox="0 0 10 10" width="10" height="10"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>`;
    const fallback = await dropSvg(gradient, "gradient.svg", ...at(500, 600));
    const image = (await nodes()).find((x) => x.id === fallback.ids?.[0]);
    assert.equal(image?.type, "image", "a gradient SVG drops as an image");
    console.log("PASS pasted and dropped SVG become vectors, unsupported SVG stays an image");

    // ---- 7. Copy as SVG.
    await app.evaluate(({ clipboard }) => clipboard.writeText(""));
    await page.evaluate((id) => {
      window.design.setSelection([id]);
      window.design.runCommand("edit.copySvg");
    }, icon);
    const svgText = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.match(
      svgText,
      /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="96" height="96" viewBox="0 0 96 96">/,
    );
    assert.match(
      svgText,
      /<path d="M20 48L76 48" fill="none" stroke="#ff0000" stroke-width="4"/,
      "baked into layer pixels",
    );
    assert.doesNotMatch(svgText, /vector-effect/);
    // It reads back as the same drawing.
    count0 = (await nodes()).length;
    await paste(svgText);
    await frame();
    const back = (await nodes()).at(-1);
    assert.deepEqual([back.type, back.w, back.h, back.strokeWidth], ["vector", 96, 96, 4]);
    console.log("PASS Copy as SVG writes a standalone SVG that pastes back");

    // ---- 8. The vector survives a reload (persistence).
    await page.reload();
    await waitForUiReady(page);
    await page.waitForSelector(`#canvas .layer[data-id="${pen.id}"] > svg path`);
    assert.equal((await node(pen.id)).type, "vector");
    console.log("PASS vector layers persist");
    assert.deepEqual(errors, [], "no page errors");
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
