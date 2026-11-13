// In-page benchmark driver. The runner calls window.runBench(config) or window.runFidelity(config).
// Frame time = delta between consecutive requestAnimationFrame timestamps. The runner disables vsync and the frame-rate
// limit, so deltas show the real per-frame cost instead of saturating at 16.7 ms.
(function () {
  const C = window.PerfCommon;
  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const quantile = (xs, q) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))];
  };
  const summary = (xs) => ({
    frames: xs.length,
    p50: quantile(xs, 0.5),
    p95: quantile(xs, 0.95),
    max: xs.length ? Math.max(...xs) : null,
    over16: xs.length ? xs.filter((x) => x > 16.7).length / xs.length : null,
    over25: xs.length ? xs.filter((x) => x > 25).length / xs.length : null,
    mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null,
  });
  const KEYS = {
    A: ["A"],
    A2: ["A2"],
    B: ["B"],
    C: ["C"],
    D: ["D", "webgl"],
    Dgpu: ["D", "webgpu"],
    E: ["E", "webgl"],
  };

  function makeLoop(strategy, cam) {
    const loop = { cam, onFrame: null, scriptMs: 0, running: true };
    const tick = (ts) => {
      if (!loop.running) return;
      if (loop.onFrame) loop.onFrame(ts);
      const t = performance.now();
      strategy.frame(loop.cam);
      loop.scriptMs = performance.now() - t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return loop;
  }

  /** Measures `frames` frame deltas. camAt(k) gives the camera for frame k; before(k) runs ahead of the strategy frame. */
  function phase(loop, strategy, { frames, warm = 5, camAt, before, budgetMs }) {
    return new Promise((resolve) => {
      const deltas = [],
        script = [],
        missing = [];
      let k = 0,
        last = 0,
        start = performance.now();
      loop.onFrame = (ts) => {
        if (k > warm) {
          deltas.push(ts - last);
          script.push(loop.scriptMs);
          const fs = strategy.frameStats?.();
          if (fs) missing.push(fs.total ? (fs.missing + (fs.fallback || 0)) / fs.total : 0);
        }
        last = ts;
        k++;
        const done = deltas.length >= frames || performance.now() - start > budgetMs;
        if (done) {
          loop.onFrame = null;
          resolve({
            ...summary(deltas),
            scriptP50: quantile(script, 0.5),
            incompleteFrac: missing.length
              ? missing.reduce((a, b) => a + b, 0) / missing.length
              : null,
            truncated: deltas.length < frames,
          });
          return;
        }
        if (camAt) loop.cam = camAt(k);
        if (before) before(k);
      };
    });
  }
  /** Waits until the strategy has no progressive work left (tiles, thumbnails, board builds). */
  async function settle(strategy, maxMs) {
    const t0 = performance.now();
    await nextFrame();
    await nextFrame();
    while ((strategy.pending?.() || 0) > 0 && performance.now() - t0 < maxMs) await nextFrame();
    return { ms: performance.now() - t0, complete: (strategy.pending?.() || 0) === 0 };
  }

  async function runBench(cfg) {
    const { strategy: key, n, seed = 1, budgetMs = 15000 } = cfg;
    const [name, preference] = KEYS[key];
    const viewport = document.getElementById("viewport"),
      vw = viewport.clientWidth,
      vh = viewport.clientHeight;
    const images = await C.makeImages();
    const tg = performance.now();
    const scene = window.PerfScene.generate(n, seed);
    const genMs = performance.now() - tg;
    const target = scene.roots[Math.floor((scene.roots.length - 1) / 2)],
      ta = scene.abs[target];
    const camFor = (wx, wy, z) => ({ x: vw / 2 - wx * z, y: vh / 2 - wy * z, zoom: z });
    const cx = ta.x + ta.w / 2,
      cy = ta.y + ta.h / 2,
      z0 = 0.5;
    const b = scene.bounds,
      zFit = Math.max(0.02, Math.min(vw / b.w, vh / b.h) * 0.95);
    const strategy = window.PerfStrategies[name]();
    if (window.gc) window.gc();
    await sleep(200);
    const out = {
      strategy: key,
      n: scene.nodes.length,
      boards: scene.roots.length,
      genMs,
      dpr: devicePixelRatio,
      viewport: [vw, vh],
      zFit,
    };

    // 1. Time to first frame: build + two animation frames (first frame presented on the main thread).
    const t0 = performance.now();
    await strategy.init(viewport, scene, images, {
      cam: camFor(cx, cy, z0),
      preference,
      selected: target + 2,
    });
    out.initMs = performance.now() - t0;
    await nextFrame();
    await nextFrame();
    out.ttffMs = performance.now() - t0;
    out.renderer = strategy.renderer?.() || "dom/canvas2d";
    const loop = makeLoop(strategy, camFor(cx, cy, z0));
    out.firstSettle = await settle(strategy, 8000);

    // 2. Pan at 50 % zoom: 24 px/frame right, 12 px/frame down.
    const p0 = camFor(cx, cy, z0);
    out.pan = await phase(loop, strategy, {
      frames: 60,
      budgetMs,
      camAt: (k) => ({ x: p0.x - 24 * k, y: p0.y - 12 * k, zoom: z0 }),
    });
    loop.cam = p0;
    await settle(strategy, 4000);

    // 3. Zoom from 50 % out to fit-all and back, anchored at the target artboard centre.
    const zf = Math.min(zFit, z0);
    out.zoom = await phase(loop, strategy, {
      frames: 60,
      budgetMs,
      camAt: (k) => {
        const t = (k % 64) / 32,
          u = t <= 1 ? t : 2 - t;
        return camFor(cx, cy, z0 * Math.pow(zf / z0, u));
      },
    });
    loop.cam = camFor(cx, cy, z0);
    await settle(strategy, 4000);

    // 4. Overview: jump to fit-all, time until fully drawn, then pan there.
    const fit = camFor(b.x + b.w / 2, b.y + b.h / 2, zFit);
    loop.cam = fit;
    out.overviewSettle = await settle(strategy, 20000);
    out.overviewPan = await phase(loop, strategy, {
      frames: 40,
      budgetMs,
      camAt: (k) => ({ x: fit.x - 10 * k, y: fit.y, zoom: zFit }),
    });
    loop.cam = p0;
    await settle(strategy, 8000);

    // 5. Single-node edit latency: text + colour of the hero title, until the frame after the change.
    const editId = scene.nodes.findIndex(
      (nd, i) => scene.rootOf[i] === target && nd.name === "Subtitle",
    );
    const edits = [];
    for (let e = 0; e < 10; e++) {
      const nd = scene.nodes[editId];
      nd.text =
        (e % 2
          ? "Shorter edited subtitle "
          : "A longer edited subtitle that wraps onto another line for layout ") + e;
      nd.color = e % 2 ? "#b91c1c" : "#1d4ed8";
      const t = performance.now();
      strategy.edit(editId);
      await nextFrame();
      await nextFrame();
      edits.push(performance.now() - t);
      await sleep(30);
    }
    out.edit = { p50: quantile(edits, 0.5), p95: quantile(edits, 0.95), max: Math.max(...edits) };

    // 6. Drag one card (a frame with 6 children) by 3,1 world px per frame.
    const dragId = scene.nodes.findIndex(
      (nd, i) => scene.rootOf[i] === target && nd.name === "Card",
    );
    strategy.dragStart?.(dragId);
    out.drag = await phase(loop, strategy, {
      frames: 40,
      budgetMs,
      before: () => {
        const nd = scene.nodes[dragId];
        nd.x += 3;
        nd.y += 1;
        C.translateTree(scene, dragId, 3, 1);
        strategy.dragMove(dragId, 3, 1);
      },
    });
    strategy.dragEnd?.(dragId);
    loop.running = false;

    // 7. Memory after GC.
    await sleep(300);
    if (window.gc) {
      window.gc();
      await sleep(200);
    }
    out.jsHeapMB = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null;
    out.stats = strategy.stats?.() || {};
    out.domNodes = document.getElementsByTagName("*").length;
    return out;
  }

  /** Renders the fidelity screen at 100 % zoom and waits until fully drawn; the runner then takes a screenshot. */
  async function runFidelity(cfg) {
    const [name, preference] = KEYS[cfg.strategy];
    const viewport = document.getElementById("viewport");
    const images = await C.makeImages();
    const scene = window.PerfScene.fidelity();
    // Strategies without a CSS layout engine get boxes measured by the browser (A, C, D; E measures itself).
    if (!["A2", "B"].includes(cfg.strategy)) C.resolveLayout(scene, images);
    await document.fonts.ready;
    const strategy = window.PerfStrategies[name]();
    await strategy.init(viewport, scene, images, { cam: { x: 0, y: 0, zoom: 1 }, preference });
    const loop = makeLoop(strategy, { x: 0, y: 0, zoom: 1 });
    await settle(strategy, 5000);
    for (let i = 0; i < 10; i++) await nextFrame();
    await sleep(300);
    loop.running = false;
    return { renderer: strategy.renderer?.() || "dom/canvas2d", dpr: devicePixelRatio };
  }

  window.runBench = runBench;
  window.runFidelity = runFidelity;
  window.benchReady = true;
})();
