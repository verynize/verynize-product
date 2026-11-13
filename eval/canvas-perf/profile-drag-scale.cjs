#!/usr/bin/env node
// Trace + CPU profile of the benchmark drag (the trajectory of eval/canvas-perf/renderer.cjs, but a fixed number of
// moves, one per animation frame, instead of a wall-clock duration) at document sizes above the schema caps. Each pointermove is wrapped in a User Timing measure, so the slow moves can be broken down into
// main-thread trace events (style, layout, hit test, scripting) and the JS functions sampled inside them.
//
//   node eval/canvas-perf/profile-drag-scale.cjs --n 20000 [--nodes-per-page 5000] [--moves 60]
//     [--output eval/canvas-perf/results/drag-scale-20000.json] [--trace]
//
// Like bench-node-cap.cjs it lifts NODE_LIMITS in web/document-core.js for the run and restores the exact source
// in a `finally` block. --trace also writes the raw trace + CPU profile as .json.gz next to the output.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const zlib = require("node:zlib");
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("../../tests/helpers/ui-ready.cjs");
const { synthetic } = require("./bench-verynize.cjs");
const install = require("./renderer.cjs");

const root = path.resolve(__dirname, "../..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const n = Number(arg("--n", "20000"));
const nodesPerPage = Number(arg("--nodes-per-page", "0"));
const count = Number(arg("--moves", "60"));
const output = path.resolve(
  arg("--output", path.join(__dirname, `results/drag-scale-${n}-${nodesPerPage || "single"}.json`)),
);
const keepTrace = process.argv.includes("--trace");
// --css "<rules>": extra style sheet added before the document loads (experiments, e.g. CSS containment).
const css = arg("--css", "");
// --node <id>: the layer to drag (default n1, the benchmark's; e.g. one late in the page).
const nodeId = arg("--node", "n1");
// --invalidations adds Blink's style invalidation tracking (which rule or element dirtied style), costly itself.
const invalidations = process.argv.includes("--invalidations");

function documentOf() {
  const doc = synthetic(n);
  // --no-images: image layers become rectangles (experiment: per-layout cost of image resources).
  if (process.argv.includes("--no-images"))
    for (const node of doc.pages[0].nodes)
      if (node.type === "image") {
        node.type = "rectangle";
        delete node.src;
      }
  const pageCount = nodesPerPage ? Math.ceil(n / nodesPerPage) : 1;
  if (pageCount > 1) {
    const nodes = doc.pages[0].nodes;
    const chunk = Math.ceil(n / pageCount / 20) * 20;
    doc.pages = Array.from({ length: pageCount }, (_, i) => ({
      id: i ? `p${i}` : "p",
      name: `Page ${i + 1}`,
      nodes: nodes.slice(i * chunk, (i + 1) * chunk),
    }));
  }
  return doc;
}

// Self and inclusive sampled time per function for samples inside [from, to] (trace clock, µs).
function cpuBreakdown(profile, windows) {
  const byId = new Map(profile.nodes.map((x) => [x.id, x]));
  const parent = new Map();
  for (const x of profile.nodes) for (const c of x.children || []) parent.set(c, x.id);
  const key = (f) =>
    `${f.functionName || "(anon)"} ${f.url ? path.basename(f.url) : ""}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
  const self = new Map(),
    incl = new Map();
  let t = profile.startTime;
  profile.samples.forEach((id, i) => {
    t += profile.timeDeltas[i] || 0;
    const dt = (profile.timeDeltas[i + 1] || 0) / 1000;
    if (!windows.some(([a, b]) => t >= a && t <= b)) return;
    const k = key(byId.get(id).callFrame);
    self.set(k, (self.get(k) || 0) + dt);
    const seen = new Set();
    for (let p = id; p !== undefined; p = parent.get(p)) {
      const pk = key(byId.get(p).callFrame);
      if (seen.has(pk)) continue;
      seen.add(pk);
      incl.set(pk, (incl.get(pk) || 0) + dt);
    }
  });
  const top = (m, k) =>
    [...m]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([name, ms]) => ({ name, ms: +ms.toFixed(1) }));
  return { self: top(self, 25), inclusive: top(incl, 45) };
}

// Main-thread trace event totals inside the windows (complete events only, nested scopes overlap).
const TRACE_NAMES = [
  "EventDispatch",
  "TimerFire",
  "FireAnimationFrame",
  "RunMicrotasks",
  "FunctionCall",
  "UpdateLayoutTree",
  "Layout",
  "HitTest",
  "PrePaint",
  "Paint",
  "Layerize",
  "ParseHTML",
  "MinorGC",
  "MajorGC",
  "V8.GC_SCAVENGER",
  "V8.GC_MARK_COMPACTOR",
];
function traceBreakdown(events, windows, mainTid) {
  const totals = {};
  for (const e of events) {
    if (e.ph !== "X" || !e.dur || e.tid !== mainTid || !TRACE_NAMES.includes(e.name)) continue;
    if (!windows.some(([a, b]) => e.ts >= a && e.ts <= b)) continue;
    totals[e.name] = +((totals[e.name] || 0) + e.dur / 1000).toFixed(1);
  }
  return totals;
}

// Runs in the renderer: press on n1, `count` pointermoves one per frame, release. Each move is a User Timing measure.
async function drag([count, id]) {
  const target = document.querySelector(`[data-id="${id}"].layer`);
  const r = target.getBoundingClientRect(),
    x = r.x + r.width / 2,
    y = r.y + r.height / 2;
  const pick = () =>
    (({ x, y, parentId }) => ({ x, y, parentId }))(
      window.design.getDocument().pages[0].nodes.find((n) => n.id === id),
    );
  const before = pick();
  const pointer = (type, clientX, clientY, buttons) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 99,
      button: 0,
      buttons,
      clientX,
      clientY,
    });
  let s = performance.now();
  target.dispatchEvent(pointer("pointerdown", x, y, 1));
  const down = performance.now() - s;
  performance.measure("drag-down", { start: s, end: s + down });
  const handlers = [];
  for (let i = 0; i < count; i++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    s = performance.now();
    window.dispatchEvent(
      pointer("pointermove", x + 45 + 30 * Math.sin(i / 10), y + 35 + 20 * Math.cos(i / 10), 1),
    );
    const e = performance.now();
    performance.measure(`drag-move-${i}`, { start: s, end: e });
    handlers.push(e - s);
  }
  s = performance.now();
  window.dispatchEvent(pointer("pointerup", x, y, 0));
  const release = performance.now() - s;
  performance.measure("drag-release", { start: s, end: s + release });
  await __perf.settle();
  return { handlers, down, release, before, after: pick() };
}

async function measure() {
  const doc = documentOf();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "verynize-dragscale-"));
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    cwd: root,
    env,
    args: [".", `--user-data-dir=${profileDir}`],
  });
  try {
    const page = await app.firstWindow();
    await waitForUiReady(page);
    await page.evaluate(() => window.fileLibrary?.showEditor());
    await page.evaluate(install);
    if (css)
      await page.evaluate((text) => {
        const style = document.createElement("style");
        style.textContent = text;
        document.head.append(style);
      }, css);
    await page.evaluate((d) => __perf.action("load", d), doc);
    // The camera puts the dragged layer's artboard where the benchmark puts n0's (40, 60 at 100%).
    await page.evaluate(async (id) => {
      const nodes = window.design.getDocument().pages[0].nodes,
        byId = new Map(nodes.map((n) => [n.id, n]));
      let board = byId.get(id);
      while (board?.parentId) board = byId.get(board.parentId);
      window.design.setCamera(40 - (board?.x || 0), 60 - (board?.y || 0), 1);
      window.design.setSelection([id]);
      await __perf.settle();
    }, nodeId);
    const cdp = await page.context().newCDPSession(page);
    const events = [];
    cdp.on("Tracing.dataCollected", (e) => events.push(...e.value));
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await cdp.send("Tracing.start", {
      categories:
        "devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,v8,disabled-by-default-v8.gc" +
        (invalidations ? ",disabled-by-default-devtools.timeline.invalidationTracking" : "") +
        (arg("--categories", "") ? "," + arg("--categories", "") : ""),
      transferMode: "ReportEvents",
    });
    await cdp.send("Profiler.start");
    const motion = await page.evaluate(drag, [count, nodeId]);
    const moves = motion.handlers;
    const { profile } = await cdp.send("Profiler.stop");
    const done = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
    await cdp.send("Tracing.end");
    await done;
    if (keepTrace)
      fs.writeFileSync(
        output.replace(/\.json$/, ".trace.json.gz"),
        zlib.gzipSync(JSON.stringify({ traceEvents: events, cpuProfile: profile })),
      );
    // Windows of each move, from the User Timing async events (b/e pairs on the renderer main thread).
    const starts = new Map(),
      windows = [],
      edges = {};
    let mainTid;
    for (const e of events) {
      if (e.name === "drag-down" || e.name === "drag-release") {
        if (e.ph === "b") edges[e.name] = [e.ts];
        if (e.ph === "e") edges[e.name]?.push(e.ts);
      }
      if (!/^drag-move-\d+$/.test(e.name)) continue;
      if (e.ph === "b") starts.set(e.name, e.ts);
      if (e.ph === "e" && starts.has(e.name)) {
        mainTid ??= e.tid;
        windows.push({ i: Number(e.name.slice(10)), from: starts.get(e.name), to: e.ts });
      }
    }
    if (mainTid === undefined)
      mainTid = events.find(
        (e) => e.name === "EventDispatch" && e.args?.data?.type === "pointermove",
      )?.tid;
    windows.sort((a, b) => a.i - b.i);
    const all = windows.map((w) => [w.from, w.to]);
    const slow = [...windows]
      .sort((a, b) => b.to - b.from - (a.to - a.from))
      .slice(0, 3)
      .map((w) => ({ i: w.i, ms: +((w.to - w.from) / 1000).toFixed(1), window: [w.from, w.to] }));
    const steady = windows.filter((w) => !slow.some((s) => s.i === w.i)).map((w) => [w.from, w.to]);
    // Main-thread work between moves (rAF callbacks, timers, React commits that the moves scheduled).
    const between = windows.slice(1).map((w, k) => [windows[k].to, w.from]);
    const q = (a, p) => [...a].sort((x, y) => x - y)[Math.max(0, Math.ceil(a.length * p) - 1)];
    return {
      n,
      nodesPerPage,
      node: nodeId,
      css,
      pages: doc.pages.length,
      activePageNodes: doc.pages[0].nodes.length,
      at: new Date().toISOString(),
      uptime: cp.execFileSync("uptime", { encoding: "utf8" }).trim(),
      loadAverage: os.loadavg(),
      commit: cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      moves: moves.map((m) => +m.toFixed(2)),
      downMs: motion.down,
      releaseMs: motion.release,
      handler: {
        count: moves.length,
        p50: q(moves, 0.5),
        p95: q(moves, 0.95),
        max: Math.max(...moves),
      },
      before: motion.before,
      after: motion.after,
      all: { trace: traceBreakdown(events, all, mainTid), cpu: cpuBreakdown(profile, all) },
      steady: {
        trace: traceBreakdown(events, steady, mainTid),
        cpu: cpuBreakdown(profile, steady),
      },
      down: edges["drag-down"]?.length === 2 && {
        trace: traceBreakdown(events, [edges["drag-down"]], mainTid),
        cpu: cpuBreakdown(profile, [edges["drag-down"]]),
      },
      release: edges["drag-release"]?.length === 2 && {
        trace: traceBreakdown(events, [edges["drag-release"]], mainTid),
        cpu: cpuBreakdown(profile, [edges["drag-release"]]),
      },
      between: {
        trace: traceBreakdown(events, between, mainTid),
        cpu: cpuBreakdown(profile, between),
      },
      slowest: slow.map((s) => ({
        i: s.i,
        ms: s.ms,
        trace: traceBreakdown(events, [s.window], mainTid),
        cpu: cpuBreakdown(profile, [s.window]),
      })),
    };
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

async function main() {
  const source = path.join(root, "web/document-core.js");
  const original = fs.readFileSync(source, "utf8");
  const pattern = /const NODE_LIMITS = Object\.freeze\(\{[\s\S]*?\}\);/;
  if (!pattern.test(original)) throw Error("Cannot locate NODE_LIMITS; no files changed");
  let result;
  try {
    fs.writeFileSync(
      source,
      original.replace(
        pattern,
        "const NODE_LIMITS = Object.freeze({ perPage: 100000, perDocument: 100000 });",
      ),
    );
    result = await measure();
  } finally {
    fs.writeFileSync(source, original);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  const { handler, slowest, steady } = result;
  console.log(
    `${n} nodes (${result.pages} pages): ${handler.count} moves, p50 ${handler.p50.toFixed(1)} p95 ${handler.p95.toFixed(1)} max ${handler.max.toFixed(1)} ms; pointerdown ${result.downMs.toFixed(1)}, pointerup ${result.releaseMs.toFixed(1)} ms; ${result.uptime}`,
  );
  console.log("steady trace", JSON.stringify(steady.trace));
  for (const s of slowest) {
    console.log(`-- slow move #${s.i} ${s.ms} ms`, JSON.stringify(s.trace));
    for (const f of s.cpu.inclusive.slice(0, 25)) console.log(String(f.ms).padStart(9), f.name);
  }
  console.log("-- between moves", JSON.stringify(result.between.trace));
  for (const f of result.between.cpu.inclusive.slice(0, 25))
    console.log(String(f.ms).padStart(9), f.name);
  console.log("-- steady inclusive");
  for (const f of steady.cpu.inclusive.slice(0, 25)) console.log(String(f.ms).padStart(9), f.name);
  console.log(output);
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
