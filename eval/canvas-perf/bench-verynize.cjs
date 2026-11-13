#!/usr/bin/env node
// Measurement only: real Electron, production public document API, isolated temporary profiles.
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const zlib = require("node:zlib");
const { _electron: electron } = require("@playwright/test");
const { waitForUiReady } = require("../../tests/helpers/ui-ready.cjs");
const install = require("./renderer.cjs");
const root = path.resolve(__dirname, "../..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const sizes = arg("--sizes", "100,500,1000,2000,5000,13000,50000").split(",").map(Number);
const requestedPages = Number(arg("--pages", "1"));
const nodesPerPage = Number(arg("--nodes-per-page", "0"));
const runs = Number(arg("--runs", "5"));
const ceilingMs = Number(arg("--ceiling-ms", "60000"));
// --skip selectAll (comma list of render,edit,pan,zoom,drag,selectAll): leave operations out, e.g. one that hits the
// ceiling at a size whose other operations should still be measured.
const skip = new Set(arg("--skip", "").split(",").filter(Boolean));
// --storage k=v[,k=v]: localStorage entries set before the document loads, e.g. verynize.canvas-render=full (full
// rebuild on every render) or verynize.canvas-cull=off (web/canvas-render.js).
const storage = arg("--storage", "")
  .split(",")
  .filter(Boolean)
  .map((e) => e.split("="));
// --strip-has: remove the five `:has(:focus-visible)` rules through CSSOM first (fix 1 simulated, as experiment-has.cjs).
const stripHas = process.argv.includes("--strip-has");
// --clip-boards: top-level frames clip their content (as frames drawn in the app do), so they can be culled.
const clipBoards = process.argv.includes("--clip-boards");
function stripFocusHas() {
  let removed = 0;
  const walk = (list) => {
    for (let i = list.cssRules.length - 1; i >= 0; i--) {
      const rule = list.cssRules[i];
      if (rule.selectorText && /:has\(:focus-visible\)/.test(rule.selectorText)) {
        list.deleteRule(i);
        removed++;
      } else if (rule.cssRules) walk(rule);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet);
    } catch {}
  }
  return removed;
}
const date = new Date().toISOString().slice(0, 10);
const output = path.resolve(arg("--output", path.join(__dirname, `results/verynize-${date}.json`)));
const quantile = (a, p) => {
  const s = [...a].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(s.length * p) - 1)] ?? null;
};
const stats = (a) => ({ p50: quantile(a, 0.5), p95: quantile(a, 0.95) });
const machine = () => ({
  at: new Date().toISOString(),
  cpu: os.cpus()[0].model,
  logicalCpus: os.cpus().length,
  ramBytes: os.totalmem(),
  freeBytes: os.freemem(),
  loadAverage: os.loadavg(),
});
function synthetic(n, { clip = false } = {}) {
  let seed = 241104;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const nodes = Array.from({ length: n }, (_, i) => {
    const k = i % 20,
      frame = k === 0 || k === 10;
    const type = frame ? "frame" : k === 19 ? "image" : k % 4 === 0 ? "text" : "rectangle";
    return {
      id: `n${i}`,
      name: `${type} ${i}`,
      type,
      parentId: k === 0 ? null : `n${i - k + (k > 10 ? 10 : 0)}`,
      x: k === 0 ? (Math.floor(i / 20) % 10) * 660 : 20 + (k % 3) * 160,
      y: k === 0 ? Math.floor(i / 200) * 520 : 20 + Math.floor((k % 10) / 3) * 95,
      w: frame ? 620 : 140,
      h: frame ? 460 : 70,
      color:
        type === "text"
          ? "#202030"
          : `#${Math.floor(random() * 0xffffff)
              .toString(16)
              .padStart(6, "0")}`,
      radius: 8,
      strokeWidth: 1,
      strokeColor: "#454552",
      layout: "free",
      ...(clip && k === 0 ? { clipContent: true } : {}),
      text: type === "text" ? `Example label ${i}` : "",
      fontSize: 16,
      ...(type === "image"
        ? {
            src:
              "data:image/svg+xml;base64," +
              Buffer.from(
                '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#91b3d5"/></svg>',
              ).toString("base64"),
          }
        : {}),
    };
  });
  return {
    version: 2,
    name: `Benchmark ${n}`,
    activePage: "p",
    pages: [{ id: "p", name: "Benchmark", nodes }],
    tokens: {},
  };
}
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Ceiling ${ceilingMs}ms: ${label}`)), ceilingMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function profile(page, cdp, kind, n) {
  const events = [];
  const listener = (e) => events.push(...e.value);
  cdp.on("Tracing.dataCollected", listener);
  await cdp.send("Performance.enable");
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,v8,cc,gpu,blink,disabled-by-default-devtools.timeline",
    transferMode: "ReportEvents",
  });
  const before = await cdp.send("Performance.getMetrics");
  await cdp.send("Profiler.start");
  const result = await bounded(
    page.evaluate(
      async (kind) =>
        ["pan", "zoom", "drag"].includes(kind) ? __perf.motion(kind) : __perf.action(kind),
      kind,
    ),
    `profile ${kind}`,
  );
  const { profile: cpu } = await cdp.send("Profiler.stop");
  const after = await cdp.send("Performance.getMetrics");
  const done = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
  await cdp.send("Tracing.end");
  await done;
  cdp.off("Tracing.dataCollected", listener);
  const artifact = path.join(path.dirname(output), `profile-${n}-${kind}.json.gz`);
  await fs.writeFile(
    artifact,
    zlib.gzipSync(JSON.stringify({ traceEvents: events, cpuProfile: cpu })),
  );
  const metrics = Object.fromEntries(
    after.metrics.map((m) => [
      m.name,
      m.value - (before.metrics.find((b) => b.name === m.name)?.value || 0),
    ]),
  );
  const times = new Map();
  (cpu.samples || []).forEach((id, i) =>
    times.set(id, (times.get(id) || 0) + (cpu.timeDeltas[i] || 0) / 1000),
  );
  const top = cpu.nodes
    .map((n) => ({ ...n.callFrame, selfMs: times.get(n.id) || 0 }))
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 25);
  const totals = {};
  for (const e of events)
    if (e.ph === "X" && e.dur) totals[e.name] = (totals[e.name] || 0) + e.dur / 1000;
  return {
    kind,
    result,
    metrics,
    top,
    traceDurationsMs: totals,
    artifact: path.relative(root, artifact),
  };
}
async function main() {
  process.chdir(root);
  const { validateDocument } = await import("../../integrations/document-core.mjs");
  const report = {
    schemaVersion: 1,
    date: new Date().toISOString(),
    commit: cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    platform: os.platform(),
    node: process.version,
    sizes,
    runs,
    requestedPages,
    nodesPerPage,
    ceilingMs,
    skipped: [...skip],
    storage,
    stripHas,
    clipBoards,
    machine: machine(),
    samples: [],
    summary: [],
    profiles: [],
    notes: [
      "paintFenceMs is two requestAnimationFrame callbacks after a zero-delay task; a paint opportunity, not a compositor presentation timestamp.",
      "Motion uses one synthetic input per rAF through production wheel/pointer handlers, 2s wall time; no OS input delivery overhead.",
      "No forced GC; heap/DOM are live counts, including retained undo history and detached nodes.",
    ],
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  const save = () => fs.writeFile(output, JSON.stringify(report, null, 2));
  let stop = false;
  for (const n of sizes) {
    if (stop) break;
    const doc = synthetic(n, { clip: clipBoards });
    const pageCount = nodesPerPage ? Math.ceil(n / nodesPerPage) : requestedPages;
    if (pageCount > 1) {
      const nodes = doc.pages[0].nodes;
      const chunk = Math.ceil(n / pageCount / 20) * 20;
      doc.pages = Array.from({ length: pageCount }, (_, i) => ({
        id: i ? `p${i}` : "p",
        name: `Page ${i + 1}`,
        nodes: nodes.slice(i * chunk, (i + 1) * chunk),
      }));
    }
    validateDocument(doc);
    const rows = [];
    for (let run = 0; run < runs; run++) {
      const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-perf-"));
      let app;
      const row = { n, run, machine: machine() };
      report.samples.push(row);
      try {
        const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
        delete env.ELECTRON_RUN_AS_NODE;
        app = await electron.launch({
          cwd: root,
          env,
          args: [".", `--user-data-dir=${profileDir}`],
          timeout: ceilingMs,
        });
        const page = await app.firstWindow();
        await waitForUiReady(page);
        await page.evaluate(() => window.fileLibrary?.showEditor());
        await page.evaluate(install);
        if (storage.length)
          await page.evaluate((entries) => {
            for (const [k, v] of entries) localStorage.setItem(k, v);
          }, storage);
        if (stripHas) row.strippedRules = await page.evaluate(stripFocusHas);
        const cdp = await page.context().newCDPSession(page);
        row.versions = await app.evaluate(() => process.versions);
        row.load = await bounded(
          page.evaluate((doc) => __perf.action("load", doc), doc),
          "load",
        );
        await bounded(
          page.evaluate(async () => {
            window.design.setCamera(40, 60, 1);
            await __perf.settle();
          }),
          "camera",
        );
        if (!skip.has("render"))
          row.render = await bounded(
            page.evaluate(() => __perf.action("render")),
            "render",
          );
        if (!skip.has("edit"))
          row.edit = await bounded(
            page.evaluate(() => __perf.action("edit")),
            "edit",
          );
        for (const kind of ["pan", "zoom", "drag"].filter((k) => !skip.has(k))) {
          await bounded(
            page.evaluate(async () => {
              window.design.setCamera(40, 60, 1);
              window.design.setSelection(["n1"]);
              await __perf.settle();
            }),
            "prepare motion",
          );
          row[kind] = await bounded(
            page.evaluate((kind) => __perf.motion(kind), kind),
            kind,
          );
          if (!row[kind].changed) throw Error(`${kind} did not change state`);
        }
        if (!skip.has("selectAll"))
          row.selectAll = await bounded(
            page.evaluate(() => __perf.action("selectAll")),
            "selectAll",
          );
        row.memory = await cdp.send("Runtime.getHeapUsage");
        row.dom = await cdp.send("Memory.getDOMCounters");
        row.connected = await page.evaluate(() => ({
          elements: document.querySelectorAll("*").length,
          canvas: document.querySelectorAll("#canvas .layer").length,
          layerRows: document.querySelectorAll("#layer-panel button").length,
        }));
        if (run === runs - 1 && !process.argv.includes("--no-profile")) {
          await bounded(
            page.evaluate(async () => {
              window.design.setSelection([]);
              await __perf.settle();
            }),
            "clear selection",
          );
          for (const kind of ["edit", "pan", "zoom", "selectAll"].filter((k) => !skip.has(k)))
            report.profiles.push({ n, ...(await profile(page, cdp, kind, n)) });
        }
        rows.push(row);
        console.log(
          JSON.stringify({
            n,
            run,
            loadMs: row.load.paintFenceMs,
            editMs: row.edit?.paintFenceMs,
            selectAllMs: row.selectAll?.paintFenceMs,
          }),
        );
      } catch (error) {
        row.error = String(error);
        report.ceiling = { n, run, error: String(error) };
        stop = true;
        console.error(row.error);
      } finally {
        if (app) {
          if (stop) app.process().kill("SIGKILL");
          else await app.close().catch(() => {});
        }
        await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
        await save();
      }
      if (stop) break;
    }
    if (rows.length) {
      const summary = { n, completedRuns: rows.length };
      for (const kind of ["load", "render", "edit", "selectAll"].filter((k) => !skip.has(k)))
        summary[kind] = {
          syncMs: stats(rows.map((r) => r[kind].syncMs)),
          paintFenceMs: stats(rows.map((r) => r[kind].paintFenceMs)),
        };
      for (const kind of ["pan", "zoom", "drag"].filter((k) => !skip.has(k)))
        summary[kind] = {
          frameP50Ms: quantile(
            rows.map((r) => quantile(r[kind].intervals, 0.5)),
            0.5,
          ),
          frameP95Ms: quantile(
            rows.map((r) => quantile(r[kind].intervals, 0.95)),
            0.5,
          ),
          over16_7Pct: quantile(
            rows.map(
              (r) =>
                (100 * r[kind].intervals.filter((x) => x > 16.7).length) / r[kind].intervals.length,
            ),
            0.5,
          ),
          handlerMs: stats(rows.flatMap((r) => r[kind].handlers)),
        };
      summary.heapUsedBytes = quantile(
        rows.map((r) => r.memory.usedSize),
        0.5,
      );
      summary.domNodes = quantile(
        rows.map((r) => r.dom.nodes),
        0.5,
      );
      summary.connectedElements = quantile(
        rows.map((r) => r.connected.elements),
        0.5,
      );
      report.summary.push(summary);
      await save();
    }
  }
  console.log(output);
}
module.exports = { synthetic, profile, bounded };
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
