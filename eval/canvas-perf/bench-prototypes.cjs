#!/usr/bin/env node
// Canvas renderer prototype benchmark (standalone; imports no product code).
//
//   node eval/canvas-perf/bench-prototypes.cjs [--sizes 1000,5000,13000,50000,100000] [--runs 5]
//        [--strategies A,A2,B,C,D,Dgpu,E] [--browser electron|chrome] [--budget 15000] [--out file.json]
//        [--fidelity] [--no-perf] [--vsync]
//   node eval/canvas-perf/bench-prototypes.cjs --report [--out file.json]   (markdown tables from a results file)
//
// --vsync keeps the display's vsync (results keyed `<browser>-vsync/...`): frame deltas then saturate at the refresh
// interval and `over16` reads as the share of dropped frames. Without it, vsync and the frame-rate cap are off.
//
// Strategies (eval/canvas-perf/prototypes/): A naive DOM, A2 current Verynize DOM pattern, B optimized DOM,
// C tile Canvas 2D, D PixiJS WebGL, Dgpu PixiJS WebGPU, E DOM layout host + PixiJS painter.
// Every run is a fresh Electron (or Chrome) process. Results merge into --out keyed by browser/strategy/size, so the
// command is rerunnable for a subset. Machine load (loadavg, free memory) is recorded per run because other
// benchmarks may share the machine.
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron, chromium } = require("@playwright/test");
const { PNG } = require("pngjs");

const ROOT = path.join(__dirname, "prototypes");
const arg = (name, def) => {
  const i = process.argv.indexOf("--" + name);
  return i < 0 ? def : process.argv[i + 1];
};
const flag = (name) => process.argv.includes("--" + name);
const sizes = arg("sizes", "1000,5000,13000,50000,100000").split(",").map(Number);
const runs = Number(arg("runs", "5"));
const strategies = arg("strategies", "A,A2,B,C,D,Dgpu,E").split(",");
const browser = arg("browser", "electron");
const budget = Number(arg("budget", "15000"));
const vsync = flag("vsync");
const label = browser + (vsync ? "-vsync" : "");
const date = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
const outFile = path.resolve(
  arg("out", path.join(__dirname, "results", `prototypes-${date}.json`)),
);
const fidelityDir = path.join(__dirname, "results", "fidelity");

function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file =
      url === "/pixi.min.js"
        ? path.join(ROOT, "node_modules/pixi.js/dist/pixi.min.js")
        : path.join(ROOT, url === "/" ? "index.html" : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": types[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

const machine = () => ({
  loadavg: os.loadavg().map((v) => +v.toFixed(2)),
  freeMemMB: Math.round(os.freemem() / 1048576),
});

async function open(url) {
  if (browser === "chrome") {
    const b = await chromium.launch({
      channel: "chrome",
      headless: false,
      args: [
        ...(vsync ? [] : ["--disable-gpu-vsync", "--disable-frame-rate-limit"]),
        "--enable-precise-memory-info",
        "--js-flags=--expose-gc",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--enable-unsafe-webgpu",
        "--window-position=0,0",
      ],
    });
    const page = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(url);
    return { page, close: () => b.close(), metrics: async () => null, version: b.version() };
  }
  const env = { ...process.env, BENCH_URL: url, BENCH_VSYNC: vsync ? "1" : "0" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.join(ROOT, "electron-main.cjs")], env });
  const page = await app.firstWindow();
  return {
    page,
    close: () => app.close(),
    version: await app.evaluate(
      () => process.versions.electron + " / Chromium " + process.versions.chrome,
    ),
    // Per-process working sets (KB → MB): the GPU process stands in for GPU memory.
    metrics: async () =>
      (await app.evaluate(({ app }) => app.getAppMetrics())).map((m) => ({
        type: m.type,
        mb: Math.round(m.memory.workingSetSize / 1024),
        peakMb: Math.round(m.memory.peakWorkingSetSize / 1024),
      })),
  };
}

const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number" && isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
function aggregate(list) {
  const pick = (f) => median(list.map(f));
  const ph = (k) => ({
    p50: pick((r) => r[k]?.p50),
    p95: pick((r) => r[k]?.p95),
    over16: pick((r) => r[k]?.over16),
    over25: pick((r) => r[k]?.over25),
    frames: pick((r) => r[k]?.frames),
    incompleteFrac: pick((r) => r[k]?.incompleteFrac),
    truncated: list.some((r) => r[k]?.truncated),
  });
  return {
    runs: list.length,
    ttffMs: pick((r) => r.ttffMs),
    initMs: pick((r) => r.initMs),
    firstSettleMs: pick((r) => r.firstSettle?.ms),
    pan: ph("pan"),
    zoom: ph("zoom"),
    overviewSettleMs: pick((r) => r.overviewSettle?.ms),
    overviewComplete: list.every((r) => r.overviewSettle?.complete),
    overviewPan: ph("overviewPan"),
    editP50: pick((r) => r.edit?.p50),
    editP95: pick((r) => r.edit?.p95),
    drag: ph("drag"),
    jsHeapMB: pick((r) => r.jsHeapMB),
    gpuProcMB: pick((r) => r.procs?.find((p) => p.type === "GPU")?.mb),
    rendererProcMB: pick((r) => r.procs?.find((p) => p.type === "Tab")?.mb),
    gpuEstimateMB: pick((r) =>
      r.stats?.gpuEstimateBytes != null ? r.stats.gpuEstimateBytes / 1048576 : null,
    ),
    domNodes: pick((r) => r.domNodes),
    renderer: list[0]?.renderer,
  };
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(outFile, "utf8"));
  } catch {
    return { results: {}, fidelity: {}, machines: [] };
  }
}
function save(data) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(data, null, 1));
}

async function perf(url, data) {
  for (const n of sizes)
    for (const s of strategies) {
      const key = `${label}/${s}/${n}`,
        list = [];
      for (let r = 0; r < runs; r++) {
        const before = machine(),
          t = Date.now();
        const b = await open(url);
        try {
          await b.page.waitForFunction(() => window.benchReady === true);
          const res = await b.page.evaluate((cfg) => window.runBench(cfg), {
            strategy: s,
            n,
            budgetMs: budget,
          });
          res.procs = await b.metrics();
          res.machineBefore = before;
          res.machineAfter = machine();
          res.wallMs = Date.now() - t;
          res.version = b.version;
          list.push(res);
          console.log(
            `${key} run ${r + 1}/${runs}: ttff ${res.ttffMs.toFixed(0)} ms, pan p50 ${res.pan.p50?.toFixed(1)} p95 ${res.pan.p95?.toFixed(1)}, zoom p95 ${res.zoom.p95?.toFixed(1)}, edit ${res.edit.p50.toFixed(1)}, drag p95 ${res.drag.p95?.toFixed(1)}, load ${before.loadavg[0]}`,
          );
        } catch (e) {
          console.error(`${key} run ${r + 1} failed: ${e.message.split("\n")[0]}`);
          list.push({ error: e.message.split("\n")[0], machineBefore: before });
        } finally {
          await b.close().catch(() => {});
        }
      }
      const ok = list.filter((r) => !r.error);
      data.results[key] = {
        browser: label,
        strategy: s,
        n,
        summary: ok.length ? aggregate(ok) : null,
        errors: list.filter((r) => r.error).map((r) => r.error),
        raw: list,
      };
      save(data);
    }
}

function diff(refFile, file, outPng) {
  const a = PNG.sync.read(fs.readFileSync(refFile)),
    b = PNG.sync.read(fs.readFileSync(file));
  const w = Math.min(a.width, b.width),
    h = Math.min(a.height, b.height),
    out = new PNG({ width: w, height: h });
  let d8 = 0,
    d32 = 0,
    sum = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ia = (y * a.width + x) * 4,
        ib = (y * b.width + x) * 4,
        io = (y * w + x) * 4;
      const m = Math.max(
        Math.abs(a.data[ia] - b.data[ib]),
        Math.abs(a.data[ia + 1] - b.data[ib + 1]),
        Math.abs(a.data[ia + 2] - b.data[ib + 2]),
      );
      if (m > 8) d8++;
      if (m > 32) d32++;
      sum += m;
      const g = ((a.data[ia] + a.data[ia + 1] + a.data[ia + 2]) / 3) * 0.3 + 170;
      out.data[io] = m > 32 ? 255 : g;
      out.data[io + 1] = m > 32 ? 0 : g;
      out.data[io + 2] = m > 32 ? 0 : g;
      out.data[io + 3] = 255;
    }
  fs.writeFileSync(outPng, PNG.sync.write(out));
  return {
    pixels: w * h,
    diffOver8Pct: +((100 * d8) / (w * h)).toFixed(3),
    diffOver32Pct: +((100 * d32) / (w * h)).toFixed(3),
    meanAbsDelta: +(sum / (w * h)).toFixed(3),
  };
}

async function fidelity(url, data) {
  fs.mkdirSync(fidelityDir, { recursive: true });
  const clip = { x: 0, y: 0, width: 1300, height: 880 }; // the dashboard (40,40 1200×780) plus its shadow
  const list = ["A2", ...strategies.filter((s) => s !== "A2")];
  for (const s of list) {
    const b = await open(url);
    try {
      await b.page.waitForFunction(() => window.benchReady === true);
      const info = await b.page.evaluate((cfg) => window.runFidelity(cfg), { strategy: s });
      const file = path.join(fidelityDir, `${browser}-${s}.png`);
      await b.page.screenshot({ path: file, clip });
      data.fidelity[`${browser}/${s}`] = { file: path.relative(__dirname, file), ...info };
      console.log(`fidelity ${s}: ${info.renderer}`);
    } catch (e) {
      console.error(`fidelity ${s} failed: ${e.message.split("\n")[0]}`);
      data.fidelity[`${browser}/${s}`] = { error: e.message.split("\n")[0] };
    } finally {
      await b.close().catch(() => {});
    }
  }
  const ref = path.join(fidelityDir, `${browser}-A2.png`);
  for (const s of list) {
    const f = data.fidelity[`${browser}/${s}`];
    if (!f || f.error || s === "A2") continue;
    Object.assign(f, {
      vsReference: `${browser}/A2`,
      ...diff(
        ref,
        path.join(fidelityDir, `${browser}-${s}.png`),
        path.join(fidelityDir, `${browser}-${s}-diff.png`),
      ),
    });
    console.log(
      `fidelity ${s}: ${f.diffOver32Pct}% pixels differ by >32/255, ${f.diffOver8Pct}% by >8/255`,
    );
  }
  save(data);
}

const vsyncLabel = (l) => l.endsWith("-vsync");
function report() {
  const data = load(),
    f = (v, d = 1) => (v == null ? "–" : Number(v).toFixed(d));
  const labels = [...new Set(Object.values(data.results).map((r) => r.browser))];
  for (const label of labels) {
    const rows = Object.values(data.results).filter((r) => r.browser === label && r.summary);
    const ns = [...new Set(rows.map((r) => r.n))].sort((a, b) => a - b),
      ss = [...new Set(rows.map((r) => r.strategy))];
    const get = (s, n) => rows.find((r) => r.strategy === s && r.n === n)?.summary;
    const table = (title, cell) => {
      console.log(
        `\n#### ${label}: ${title}\n\n| Strategy | ${ns.map((n) => n.toLocaleString("en")).join(" | ")} |\n| --- | ${ns.map(() => "---:").join(" | ")} |`,
      );
      for (const s of ss)
        console.log(
          `| ${s} | ${ns
            .map((n) => {
              const x = get(s, n);
              return x ? cell(x) : "–";
            })
            .join(" | ")} |`,
        );
    };
    table("time to first frame, ms", (x) => f(x.ttffMs, 0));
    // With vsync on, deltas jitter around 16.7 ms; a dropped frame is a delta above 25 ms (1.5 refresh intervals).
    const miss = (x, k) =>
      vsyncLabel(label) ? `${f(100 * x[k].over25, 0)}% > 25 ms` : `${f(100 * x[k].over16, 0)}%`;
    table(
      `pan frame ms p50 / p95 (${vsyncLabel(label) ? "dropped frames" : "% > 16.7 ms"})`,
      (x) => `${f(x.pan.p50)} / ${f(x.pan.p95)} (${miss(x, "pan")})${x.pan.truncated ? "*" : ""}`,
    );
    table(
      `zoom frame ms p50 / p95 (${vsyncLabel(label) ? "dropped frames" : "% > 16.7 ms"})`,
      (x) =>
        `${f(x.zoom.p50)} / ${f(x.zoom.p95)} (${miss(x, "zoom")})${x.zoom.truncated ? "*" : ""}`,
    );
    table(
      "fit-all: time to fully drawn ms; pan p50 / p95",
      (x) =>
        `${f(x.overviewSettleMs, 0)}${x.overviewComplete ? "" : "†"}; ${f(x.overviewPan.p50)} / ${f(x.overviewPan.p95)}${x.overviewPan.truncated ? "*" : ""}`,
    );
    table(
      "incomplete-content share while panning / zooming (tiles or boards not yet drawn)",
      (x) =>
        `${f(100 * (x.pan.incompleteFrac || 0), 0)}% / ${f(100 * (x.zoom.incompleteFrac || 0), 0)}%`,
    );
    table("single-node edit latency ms p50 / p95", (x) => `${f(x.editP50)} / ${f(x.editP95)}`);
    table(
      "drag one card: frame ms p50 / p95",
      (x) => `${f(x.drag.p50)} / ${f(x.drag.p95)}${x.drag.truncated ? "*" : ""}`,
    );
    table(
      "memory: JS heap MB / renderer process MB / GPU process MB / own GPU estimate MB",
      (x) =>
        `${f(x.jsHeapMB, 0)} / ${f(x.rendererProcMB, 0)} / ${f(x.gpuProcMB, 0)} / ${f(x.gpuEstimateMB, 0)}`,
    );
  }
  for (const [k, v] of Object.entries(data.fidelity || {}))
    console.log(
      `fidelity ${k}: ${v.error || `${v.diffOver32Pct ?? 0}% >32, ${v.diffOver8Pct ?? 0}% >8, mean Δ ${v.meanAbsDelta ?? 0} (${v.renderer})`}`,
    );
}

if (flag("report")) {
  report();
  return;
}
(async () => {
  const server = await serve(),
    url = `http://127.0.0.1:${server.address().port}/`;
  const data = load();
  data.machines = data.machines || [];
  data.machines.push({
    at: new Date().toISOString(),
    browser: label,
    cpu: os.cpus()[0].model,
    cores: os.cpus().length,
    totalMemGB: +(os.totalmem() / 2 ** 30).toFixed(1),
    platform: `${os.platform()} ${os.release()}`,
    ...machine(),
    args: process.argv.slice(2),
  });
  data.method =
    "Median of runs. Frame time = delta between consecutive rAF timestamps with vsync and frame-rate limit disabled. " +
    "ttff = strategy init + two rAFs. edit = edit call until the second rAF after it. Memory: JS heap after gc; GPU process working set from Electron app.getAppMetrics().";
  try {
    if (flag("fidelity")) await fidelity(url, data);
    if (!flag("no-perf")) await perf(url, data);
  } finally {
    server.close();
  }
  console.log("wrote", path.relative(process.cwd(), outFile));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
