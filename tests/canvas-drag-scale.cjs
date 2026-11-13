// A drag costs what it moves, not what the document holds (docs/canvas-performance/drag-scale-2026-11-06.md).
// Pointer moves, including one that re-parents the dragged layer into a frame mid-drag, never serialize, clone or
// publish the whole document; the full page hit test runs only when the pointer enters or leaves a frame; a click
// that does not drag takes no undo snapshot. Release still commits one undo step, renders and saves once. The
// drop-target hit cache (web/canvas-drop-hits.js) answers exactly like the full hit test at every point of a grid
// over clipped, rounded, rotated, elliptic, locked and hidden frames.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const { synthetic } = require("../eval/canvas-perf/bench-verynize.cjs");

// Two pages of the benchmark fixture: 5,000 layers on the dragged page, 5,000 on the other.
function largeDocument() {
  const doc = synthetic(10000);
  const nodes = doc.pages[0].nodes;
  doc.pages = [
    { id: "p", name: "Page 1", nodes: nodes.slice(0, 5000) },
    { id: "p1", name: "Page 2", nodes: nodes.slice(5000) },
  ];
  return doc;
}

function frame(id, parentId, x, y, w, h, extra = {}) {
  return {
    id,
    name: id,
    type: "frame",
    parentId,
    x,
    y,
    w,
    h,
    color: "#d0d0d8",
    layout: "free",
    ...extra,
  };
}
const hitDocument = {
  version: 2,
  name: "Hits",
  activePage: "h",
  tokens: {},
  pages: [
    {
      id: "h",
      name: "Hits",
      nodes: [
        frame("A", null, 0, 0, 400, 300, { radius: 24, clipContent: true }),
        frame("A1", "A", 300, 200, 200, 150), // half outside A's clip
        frame("A2", "A", 20, 20, 100, 80, { radius: 12 }),
        frame("B", null, 450, 0, 300, 300, { rotation: 30 }),
        frame("B1", "B", 50, 50, 100, 100),
        frame("C", null, 0, 350, 300, 200, { ellipse: true }),
        frame("D", null, 400, 350, 300, 200, { locked: true }),
        frame("D1", "D", 10, 10, 100, 100),
        frame("E", null, 760, 0, 200, 200, { hidden: true }),
        {
          id: "R",
          name: "R",
          type: "rectangle",
          parentId: null,
          x: 100,
          y: 100,
          w: 300,
          h: 50,
          color: "#ff0000",
          layout: "free",
        },
      ],
    },
  ],
};

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-drag-scale-"));
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ env, args: [".", `--user-data-dir=${profile}`] });
    const page = await app.firstWindow();
    await waitForUiReady(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluate(() => window.fileLibrary.showEditor());

    // ---------- Hit cache equivalence ----------
    // A page opened for the first time is fitted on the next frame: set the camera after that.
    const load = (doc, selection) =>
      page.evaluate(
        async ([doc, selection]) => {
          window.design.loadDocument(doc);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          window.design.setCamera(40, 60, 1);
          window.design.setSelection(selection);
        },
        [doc, selection],
      );
    await load(hitDocument, []);
    await page.waitForTimeout(300);
    const grid = await page.evaluate(() => {
      const canvas = document.querySelector("#canvas"),
        wrap = document.querySelector("#canvas-wrap");
      const nodes = window.design.getDocument().pages[0].nodes,
        byId = new Map(nodes.map((n) => [n.id, n]));
      const find = (id) => byId.get(id);
      const hits = window.VerynizeDropHits.create({
        canvas,
        wrap,
        camera: window.design.getCamera(),
        find,
      });
      const hit = (x, y) => {
        for (const el of document.elementsFromPoint(x, y)) {
          if (!canvas.contains(el) || !el.classList.contains("frame-layer")) continue;
          const n = find(el.dataset.id);
          if (n && !n.locked && !n.hidden) return n.id;
        }
        return null;
      };
      const owner = new Set(),
        r = wrap.getBoundingClientRect();
      // Inside A (clipped, rounded, with nested frames) boxes describe the hit region except near edges and corners.
      const a = document.querySelector('#canvas [data-id="A"]').getBoundingClientRect();
      let points = 0,
        full = 0,
        inA = 0,
        fullInA = 0,
        last = null;
      const mismatches = [],
        seen = new Set();
      const counted = (x, y) => {
        full++;
        if (last) fullInA++;
        return hit(x, y);
      };
      // Raster order, so neighbouring points reuse answers as a drag does; fractional steps cross every edge.
      for (let y = r.top + 0.3; y < Math.min(r.bottom, r.top + 760); y += 3.7)
        for (let x = r.left + 0.3; x < Math.min(r.right, r.left + 1000); x += 3.7) {
          points++;
          last = x >= a.left && x < a.right && y >= a.top && y < a.bottom;
          if (last) inA++;
          const cached = hits.frameAt(x, y, owner, counted),
            expected = hit(x, y);
          seen.add(expected);
          if (cached !== expected && mismatches.length < 10)
            mismatches.push({ x, y, cached, expected });
        }
      return { points, full, inA, fullInA, mismatches, seen: [...seen] };
    });
    assert.deepEqual(grid.mismatches, [], "the cache answers like elementsFromPoint everywhere");
    for (const id of ["A", "A1", "A2", "B", "B1", "C", null])
      assert.ok(grid.seen.includes(id), `the grid covers ${id}`);
    for (const id of ["D", "D1", "E"])
      assert.ok(!grid.seen.includes(id), `${id} is never a target`);
    // Elsewhere (the rotated B, the ellipse C) every point is hit-tested: only part of the grid can reuse answers.
    assert.ok(grid.full < grid.points / 2, `${grid.full} full hit tests for ${grid.points} points`);
    assert.ok(
      grid.fullInA < grid.inA / 10,
      `${grid.fullInA} full hit tests for ${grid.inA} points inside A`,
    );

    // ---------- A drag in a large document ----------
    await load(largeDocument(), ["n1"]);
    await page.waitForTimeout(800); // the idle save of the load is done
    // Style work of the first move (drag start + re-parent), from a trace: how many elements Blink restyled.
    const cdp = await page.context().newCDPSession(page);
    const trace = [];
    cdp.on("Tracing.dataCollected", (e) => trace.push(...e.value));
    await cdp.send("Tracing.start", {
      categories: "devtools.timeline,blink.user_timing",
      transferMode: "ReportEvents",
    });
    const drag = await page.evaluate(async () => {
      const counts = {
        stringify: 0,
        clone: 0,
        getDocument: 0,
        subscribers: 0,
        hitTests: 0,
        previews: [],
      };
      let counting = false;
      const isDocument = (v) => !!v && typeof v === "object" && Array.isArray(v.pages);
      const { stringify } = JSON,
        clone = window.structuredClone,
        elementsFromPoint = document.elementsFromPoint.bind(document);
      // oxlint-disable-next-line typescript/unbound-method -- monkey-patch: the original is re-invoked with .call(this) or restored
      const getDocument = window.design.getDocument;
      JSON.stringify = function (v, ...rest) {
        if (counting && isDocument(v)) counts.stringify++;
        return stringify.call(this, v, ...rest);
      };
      window.structuredClone = (v, ...rest) => {
        if (counting && isDocument(v)) counts.clone++;
        return clone(v, ...rest);
      };
      window.design.getDocument = () => {
        if (counting) counts.getDocument++;
        return getDocument();
      };
      document.elementsFromPoint = (x, y) => {
        if (counting) counts.hitTests++;
        return elementsFromPoint(x, y);
      };
      const unsubscribe = window.design.subscribe(() => {
        if (counting) counts.subscribers++;
      });
      const onPreview = (e) => counting && counts.previews.push(e.detail);
      window.addEventListener("bd:layer-preview", onPreview);
      const frameRect = (id) =>
        document.querySelector(`#canvas [data-id="${id}"].layer`).getBoundingClientRect();
      const pointer = (type, clientX, clientY, buttons) =>
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          button: 0,
          buttons,
          clientX,
          clientY,
        });
      const frameDone = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const handlers = [];
      const move = async (x, y) => {
        await frameDone();
        counting = true;
        const start = performance.now();
        window.dispatchEvent(pointer("pointermove", x, y, 1));
        handlers.push(performance.now() - start);
        counting = false;
      };
      const before = getDocument().pages[0].nodes.find((n) => n.id === "n1");
      const target = document.querySelector('#canvas [data-id="n1"].layer'),
        t = target.getBoundingClientRect(),
        x0 = t.x + t.width / 2,
        y0 = t.y + t.height / 2;
      // A press that does not drag (a click) takes no snapshot of the document.
      counting = true;
      target.dispatchEvent(pointer("pointerdown", x0, y0, 1));
      const click = { ...counts };
      window.dispatchEvent(pointer("pointerup", x0, y0, 0));
      counting = false;
      await frameDone();

      counting = true;
      target.dispatchEvent(pointer("pointerdown", x0, y0, 1));
      counting = false;
      const down = { stringify: counts.stringify, clone: counts.clone };
      // n1 starts under the nested frame n10: the first move re-parents it there.
      target.getBoundingClientRect(); // style the press dirtied is not the move's
      performance.mark("first-move-start");
      await move(x0 + 40, y0 + 30);
      performance.measure("first-move", "first-move-start");
      const parentAfterFirst = getDocument().pages[0].nodes.find((n) => n.id === "n1").parentId;
      // Thirty moves well inside n10 (and n0): the frame set under the pointer does not change.
      const hitsBefore = counts.hitTests;
      for (let i = 0; i < 30; i++) await move(x0 + 60 + i * 2, y0 + 60 + (i % 5));
      const steadyHits = counts.hitTests - hitsBefore;
      // Out of n10 into the part of n0 it does not cover: back to n0.
      const n0 = frameRect("n0"),
        n10 = frameRect("n10");
      await move(n0.left + (n10.left - n0.left) / 2, n0.top + n0.height - 30);
      const parentAfterBack = getDocument().pages[0].nodes.find((n) => n.id === "n1").parentId;
      // The camera moves mid-drag (a wheel pan): the cached boxes are measured again.
      window.design.setCamera(140, 60, 1);
      await frameDone();
      const moved = frameRect("n10");
      await move(moved.left + 200, moved.top + 200);
      const parentAfterPan = getDocument().pages[0].nodes.find((n) => n.id === "n1").parentId;
      const during = { ...counts, previews: [...counts.previews] };
      counting = true;
      window.dispatchEvent(pointer("pointerup", x0, y0, 0));
      counting = false;
      const release = { stringify: counts.stringify, subscribers: counts.subscribers };
      unsubscribe();
      window.removeEventListener("bd:layer-preview", onPreview);
      JSON.stringify = stringify;
      window.structuredClone = clone;
      window.design.getDocument = getDocument;
      document.elementsFromPoint = elementsFromPoint;
      const after = getDocument().pages[0].nodes.find((n) => n.id === "n1");
      const canUndo = window.design.canUndo();
      return {
        click,
        down,
        during,
        release,
        steadyHits,
        handlers,
        parents: [parentAfterFirst, parentAfterBack, parentAfterPan],
        before: { x: before.x, y: before.y, parentId: before.parentId },
        after: { x: after.x, y: after.y, parentId: after.parentId },
        canUndo,
      };
    });
    const ended = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
    await cdp.send("Tracing.end");
    await ended;
    const span = trace.filter((e) => e.name === "first-move" && (e.ph === "b" || e.ph === "e"));
    assert.equal(span.length, 2, "the trace has the first move");
    const [from, to] = span.map((e) => e.ts).sort((a, b) => a - b);
    const restyled = trace
      .filter((e) => e.name === "UpdateLayoutTree" && e.ts >= from && e.ts <= to)
      .reduce((sum, e) => sum + (e.args?.elementCount || 0), 0);
    // A state class on an ancestor of the canvas with rules for layers (`.moving #canvas .layer…`) restyled every
    // layer of the page when a drag started.
    assert.ok(
      restyled < 500,
      `${restyled} elements restyled by the first move of a 5,000-layer page`,
    );
    assert.equal(drag.click.stringify, 0, "a click does not snapshot the document");
    assert.equal(drag.down.stringify, 0, "nor does the press that starts a drag");
    assert.deepEqual(drag.parents, ["n10", "n0", "n10"], "drop targets follow the pointer");
    assert.equal(drag.during.stringify, 1, "one undo snapshot when the drag starts, none per move");
    assert.equal(drag.during.clone, 0, "no document clone during the moves");
    assert.equal(drag.during.getDocument, 0, "nobody reads the whole document during the moves");
    assert.equal(drag.during.subscribers, 0, "subscribers hear of the drag at release only");
    assert.ok(
      drag.steadyHits <= 3,
      `${drag.steadyHits} full hit tests for 30 moves inside one frame`,
    );
    assert.deepEqual(
      drag.during.previews.filter(Boolean).at(-1),
      { ids: ["n1"], parentId: "n10" },
      "the Layers tree previews the mid-drag parent",
    );
    assert.ok(drag.release.subscribers >= 1, "the release renders and publishes the result");
    assert.equal(drag.after.parentId, "n10");
    assert.notDeepEqual(drag.after, drag.before);
    assert.equal(drag.canUndo, true);
    const sorted = [...drag.handlers].sort((a, b) => a - b);
    assert.ok(
      sorted[sorted.length >> 1] < 50,
      `median move ${sorted[sorted.length >> 1].toFixed(1)} ms at 5,000 layers (generous budget)`,
    );
    // One undo step restores the layer where it was.
    await page.evaluate(() => window.design.runCommand("edit.undo"));
    const undone = await page.evaluate(() => {
      const n = window.design.getDocument().pages[0].nodes.find((n) => n.id === "n1");
      return { x: n.x, y: n.y, parentId: n.parentId };
    });
    assert.deepEqual(undone, drag.before, "one undo step undoes the whole drag");
    assert.deepEqual(errors, []);
    console.log(
      `canvas-drag-scale: ok (${grid.full}/${grid.points} full hit tests on the grid, ${grid.fullInA}/${grid.inA} in A; median move ${sorted[sorted.length >> 1].toFixed(1)} ms; ${restyled} elements restyled by the first move)`,
    );
  } finally {
    if (app) await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
