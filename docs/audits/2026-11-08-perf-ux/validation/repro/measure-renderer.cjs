#!/usr/bin/env node
// Validation of the renderer claims in docs/audits/2026-11-08-perf-ux (findings 3 and 8). Measurement only.
// Real Electron, fresh temporary --user-data-dir per size, synthetic document from eval/canvas-perf/bench-verynize.cjs.
//
//   node docs/audits/2026-11-08-perf-ux/validation/repro/measure-renderer.cjs --sizes 1000,5000,10000 --out /abs/out.json
//   node docs/audits/2026-11-08-perf-ux/validation/repro/measure-renderer.cjs --library --hold /abs/dir --out /abs/lib.json
//
// --hold DIR: after loading, write DIR/ready and wait (max 180 s) for DIR/continue, so an outside tool
// (agent-desktop) can screenshot the visible window. --library: file-library persistence check with two files.
const fs = require("node:fs/promises");
const fss = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const root = path.resolve(__dirname, "../../../../..");
const { _electron: electron } = require(path.join(root, "node_modules/@playwright/test"));
const { waitForUiReady } = require(path.join(root, "tests/helpers/ui-ready.cjs"));
const install = require(path.join(root, "eval/canvas-perf/renderer.cjs"));
const { synthetic } = require(path.join(root, "eval/canvas-perf/bench-verynize.cjs"));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const sizes = arg("--sizes", "1000,5000,10000").split(",").map(Number);
const edits = Number(arg("--edits", "7"));
const hold = arg("--hold", null);
const libraryMode = process.argv.includes("--library");
const shots = arg("--shots", null);
const out = path.resolve(arg("--out", path.join(os.tmpdir(), "renderer-validation.json")));
const q = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.max(0, Math.ceil(s.length * p) - 1)] : null;
};
const r1 = (x) => (x == null ? x : Math.round(x * 10) / 10);
const machine = () => ({
  cpu: os.cpus()[0].model,
  logicalCpus: os.cpus().length,
  ramGiB: os.totalmem() / 2 ** 30,
  loadAverage: os.loadavg().map(r1),
  macos: cp.execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim(),
});

// Runs in the page: counting wrappers around structuredClone, JSON.stringify, localStorage.setItem and
// getBoundingClientRect. Only active while __m.on is true; `stacks` adds the two calling frames.
function instrument() {
  const m = (window.__m = { on: false, stacks: false, log: null });
  const site = () =>
    new Error().stack
      .split("\n")
      .slice(3, 5)
      .map((l) =>
        l
          .trim()
          .replace(/^at /, "")
          .replace(/app:\/\/verynize\//g, ""),
      )
      .join(" <- ");
  const reset = () =>
    (m.log = { clones: [], stringify: [], setItem: [], rects: 0, rectMs: 0, rectSites: {} });
  m.reset = reset;
  reset();
  const clone = window.structuredClone.bind(window);
  m.rawClone = clone;
  window.structuredClone = function (value, options) {
    if (!m.on) return clone(value, options);
    const t = performance.now();
    const result = clone(value, options);
    const ms = performance.now() - t;
    // A whole document, or a library file record that holds one (fileLibrary.list()).
    if (value && (Array.isArray(value.pages) || Array.isArray(value.document?.pages)))
      m.log.clones.push({
        ms,
        kind: value.pages ? "document" : "file",
        site: m.stacks ? site() : undefined,
      });
    return result;
  };
  const stringify = JSON.stringify;
  JSON.stringify = function (...a) {
    if (!m.on) return stringify.apply(JSON, a);
    const t = performance.now();
    const s = stringify.apply(JSON, a);
    const ms = performance.now() - t;
    if (s && s.length > 50000)
      m.log.stringify.push({ ms, chars: s.length, site: m.stacks ? site() : undefined });
    return s;
  };
  const setItem = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem").value;
  Storage.prototype.setItem = function (k, v) {
    if (!m.on) return setItem.call(this, k, v);
    const t = performance.now();
    setItem.call(this, k, v);
    m.log.setItem.push({ key: k, chars: String(v).length, ms: performance.now() - t });
  };
  const rect = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect").value;
  Element.prototype.getBoundingClientRect = function () {
    if (!m.on) return rect.call(this);
    const t = performance.now();
    const r = rect.call(this);
    const ms = performance.now() - t;
    m.log.rects++;
    m.log.rectMs += ms;
    if (m.stacks) {
      const k = site();
      const e = (m.log.rectSites[k] ||= { calls: 0, ms: 0 });
      e.calls++;
      e.ms += ms;
    }
    return r;
  };
  m.summary = () => {
    const sum = (a) => a.reduce((s, x) => s + x.ms, 0);
    const l = m.log;
    return {
      clones: l.clones.length,
      cloneMs: sum(l.clones),
      stringifyBig: l.stringify.length,
      stringifyMs: sum(l.stringify),
      setItem: l.setItem.map((s) => ({ key: s.key, chars: s.chars, ms: s.ms })),
      rects: l.rects,
      rectMs: l.rectMs,
      rectSites: m.stacks ? l.rectSites : undefined,
    };
  };
}

async function launch(profileDir) {
  const env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    cwd: root,
    env,
    args: [".", `--user-data-dir=${profileDir}`],
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await waitForUiReady(page);
  await page.evaluate(() => window.fileLibrary?.showEditor());
  await page.evaluate(install);
  await page.evaluate(instrument);
  return { app, page };
}
async function waitHold(tag) {
  if (!hold) return;
  await fs.mkdir(hold, { recursive: true });
  await fs.rm(path.join(hold, "continue"), { force: true });
  await fs.writeFile(path.join(hold, "ready"), tag);
  const end = Date.now() + 180000;
  while (Date.now() < end && !fss.existsSync(path.join(hold, "continue")))
    await new Promise((r) => setTimeout(r, 300));
  await fs.rm(path.join(hold, "ready"), { force: true });
  await fs.rm(path.join(hold, "continue"), { force: true });
}

// One property edit through the public API (as eval/canvas-perf/renderer.cjs "edit"), with counts split into
// the synchronous part, up to the paint fence, and the deferred 1.5 s after it (idle save, storage meter).
async function edit(page, i, stacks) {
  return page.evaluate(
    async ({ i, stacks }) => {
      const m = window.__m;
      m.reset();
      m.stacks = stacks;
      m.on = true;
      const t0 = performance.now();
      window.design.updateNodes(["n1"], { color: i % 2 ? "#ab3456" : "#cd5678" });
      const syncMs = performance.now() - t0;
      const sync = m.summary();
      const syncSites = stacks
        ? m.log.clones.map((c) => ({ site: c.site, kind: c.kind, ms: c.ms }))
        : undefined;
      const syncStringifySites = stacks ? m.log.stringify.map((c) => c.site) : undefined;
      await window.__perf.settle();
      const fenceMs = performance.now() - t0;
      const fence = m.summary();
      await new Promise((r) => setTimeout(r, 1500));
      const all = m.summary();
      const deferredSites = stacks
        ? m.log.clones.map((c) => ({ site: c.site, kind: c.kind, ms: c.ms }))
        : undefined;
      const allStringifySites = stacks
        ? m.log.stringify.map((c) => ({ site: c.site, chars: c.chars, ms: c.ms }))
        : undefined;
      m.on = false;
      return {
        syncMs,
        fenceMs,
        sync,
        fence,
        all,
        syncSites,
        syncStringifySites,
        deferredSites,
        allStringifySites,
      };
    },
    { i, stacks },
  );
}

async function measureSize(n) {
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-validate-"));
  const row = { n, machineBefore: machine() };
  let app;
  try {
    const launched = await launch(profileDir);
    app = launched.app;
    const page = launched.page;
    row.versions = await app.evaluate(() => ({
      electron: process.versions.electron,
      chrome: process.versions.chrome,
    }));
    const cdp = await page.context().newCDPSession(page);
    const doc = synthetic(n);
    row.docChars = JSON.stringify(doc).length;
    row.load = await page.evaluate((doc) => window.__perf.action("load", doc), doc);
    await page.evaluate(async () => {
      window.design.setCamera(40, 60, 1);
      await window.__perf.settle();
    });
    await page.waitForTimeout(2000);
    // Static facts from the global lexical bindings of web/app.js.
    row.subscribers = await page.evaluate(() =>
      [...subscribers].map((fn) => ({
        arity: fn.length,
        src: fn.toString().replace(/\s+/g, " ").slice(0, 90),
      })),
    );
    row.cloneCost = await page.evaluate(() => {
      const t = [];
      for (let i = 0; i < 5; i++) {
        const s = performance.now();
        window.__m.rawClone(design);
        t.push(performance.now() - s);
      }
      t.sort((a, b) => a - b);
      return { medianMs: t[2], minMs: t[0], maxMs: t[4] };
    });
    if (shots) await page.screenshot({ path: path.join(shots, `electron-${n}-loaded.png`) });
    await waitHold(`loaded ${n}`);
    // Attribution pass (stack capture), then timing passes without stacks.
    row.editAttribution = await edit(page, 0, true);
    row.edits = [];
    for (let i = 1; i <= edits; i++) row.edits.push(await edit(page, i, false));
    // Uninstrumented edits (wrappers pass straight through): sync and paint-fence time only.
    row.cleanEdits = [];
    for (let i = 0; i < 5; i++)
      row.cleanEdits.push(
        await page.evaluate(async (i) => {
          const t0 = performance.now();
          window.design.updateNodes(["n1"], { x: 20 + (i % 2) });
          const syncMs = performance.now() - t0;
          await window.__perf.settle();
          const fenceMs = performance.now() - t0;
          await new Promise((r) => setTimeout(r, 1500));
          return { syncMs, fenceMs };
        }, i),
      );
    const timed = row.edits.slice(1); // first timed edit is a warm-up
    const med = (f) => r1(q(timed.map(f), 0.5));
    row.editSummary = {
      syncMsMedian: med((e) => e.syncMs),
      fenceMsMedian: med((e) => e.fenceMs),
      syncMsRange: [
        r1(Math.min(...timed.map((e) => e.syncMs))),
        r1(Math.max(...timed.map((e) => e.syncMs))),
      ],
      syncClones: med((e) => e.sync.clones),
      syncCloneMs: med((e) => e.sync.cloneMs),
      fenceClones: med((e) => e.fence.clones),
      fenceCloneMs: med((e) => e.fence.cloneMs),
      allClones: med((e) => e.all.clones),
      allCloneMs: med((e) => e.all.cloneMs),
      syncStringifyBig: med((e) => e.sync.stringifyBig),
      syncStringifyMs: med((e) => e.sync.stringifyMs),
      allStringifyBig: med((e) => e.all.stringifyBig),
      allStringifyMs: med((e) => e.all.stringifyMs),
      cleanSyncMsMedian: r1(
        q(
          row.cleanEdits.map((e) => e.syncMs),
          0.5,
        ),
      ),
      cleanFenceMsMedian: r1(
        q(
          row.cleanEdits.map((e) => e.fenceMs),
          0.5,
        ),
      ),
      setItemsSync: timed[0].sync.setItem,
      setItemsAll: timed[0].all.setItem,
    };
    // Pan and zoom: production wheel handlers, one synthetic event per rAF for 2 s (renderer.cjs motion()).
    row.motion = {};
    for (const kind of ["pan", "zoom"]) {
      await page.evaluate(async () => {
        window.design.setCamera(40, 60, 1);
        window.design.setSelection(["n1"]);
        await window.__perf.settle();
      });
      const m = await page.evaluate((k) => window.__perf.motion(k), kind);
      row.motion[kind] = {
        events: m.events,
        changed: m.changed,
        handlerP50: r1(q(m.handlers, 0.5)),
        handlerP95: r1(q(m.handlers, 0.95)),
        rafP50: r1(q(m.intervals, 0.5)),
        rafP95: r1(q(m.intervals, 0.95)),
        over25Pct: r1((100 * m.intervals.filter((x) => x > 25).length) / m.intervals.length),
      };
    }
    // Select every node of the page (as renderer.cjs "selectAll"), counting getBoundingClientRect calls.
    await page.evaluate(async () => {
      window.design.setSelection([]);
      await window.__perf.settle();
    });
    // --rect-sites: capture the calling frames of getBoundingClientRect during select all (slower; attribution only).
    if (process.argv.includes("--rect-sites"))
      await page.evaluate(() => (window.__rectSites = true));
    row.heapBeforeSelect = (await cdp.send("Runtime.getHeapUsage")).usedSize;
    row.elementsBeforeSelect = await page.evaluate(() => document.querySelectorAll("*").length);
    row.selectAll = await page.evaluate(async () => {
      const m = window.__m;
      m.reset();
      m.stacks = !!window.__rectSites;
      m.on = true;
      const r = await window.__perf.action("selectAll");
      m.on = false;
      return { ...r, ...m.summary() };
    });
    row.heapAfterSelect = (await cdp.send("Runtime.getHeapUsage")).usedSize;
    row.domCounters = await cdp.send("Memory.getDOMCounters");
    row.connected = await page.evaluate(() => ({
      elements: document.querySelectorAll("*").length,
      canvasLayers: document.querySelectorAll("#canvas .layer").length,
      selectionBoxes: document.querySelectorAll("#canvas .layer.selected").length,
    }));
    if (shots) await page.screenshot({ path: path.join(shots, `electron-${n}-selectall.png`) });
    await waitHold(`selectall ${n}`);
  } catch (error) {
    row.error = String(error.stack || error);
    console.error(row.error);
  } finally {
    if (app) await app.close().catch(() => app.process().kill("SIGKILL"));
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
  row.machineAfter = machine();
  return row;
}

// File library: every editor render persists the whole library (all files) to localStorage.
async function measureLibrary() {
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-validate-lib-"));
  const res = { machine: machine() };
  let app;
  try {
    const { app: a, page } = await launch(profileDir);
    app = a;
    const docA = synthetic(1000),
      docB = synthetic(5000);
    docB.name = "Benchmark 5000";
    res.docChars = { a1000: JSON.stringify(docA).length, b5000: JSON.stringify(docB).length };
    await page.evaluate((d) => window.design.loadDocument(d), docA);
    await page.waitForTimeout(1500);
    res.editOneFile = await edit(page, 1, true);
    res.libraryFilesAfterA = await page.evaluate(
      () => JSON.parse(localStorage.getItem("verynize-library-v1") || "{}").files?.length,
    );
    await page.evaluate((d) => window.fileLibrary.createFromDocument(d), docB);
    await page.waitForTimeout(2500);
    res.libraryFilesAfterB = await page.evaluate(
      () => JSON.parse(localStorage.getItem("verynize-library-v1") || "{}").files?.length,
    );
    res.activeNodes = await page.evaluate(() => window.design.getDocument().pages[0].nodes.length);
    if (shots) await page.screenshot({ path: path.join(shots, "electron-library-5000.png") });
    await waitHold("library");
    res.editTwoFiles = [];
    for (let i = 2; i < 5; i++) res.editTwoFiles.push(await edit(page, i, i === 2));
  } catch (error) {
    res.error = String(error.stack || error);
    console.error(res.error);
  } finally {
    if (app) await app.close().catch(() => app.process().kill("SIGKILL"));
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
  return res;
}

void (async () => {
  process.chdir(root);
  if (shots) await fs.mkdir(shots, { recursive: true });
  const report = {
    date: new Date().toISOString(),
    commit: cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    node: process.version,
    machine: machine(),
  };
  if (libraryMode) report.library = await measureLibrary();
  else {
    report.sizes = [];
    for (const n of sizes) {
      const row = await measureSize(n);
      report.sizes.push(row);
      await fs.writeFile(out, JSON.stringify(report, null, 2));
      console.log(
        JSON.stringify({
          n,
          edit: row.editSummary,
          cloneCost: row.cloneCost,
          zoom: row.motion?.zoom,
          pan: row.motion?.pan,
          selectAll: row.selectAll && {
            fenceMs: row.selectAll.paintFenceMs,
            syncMs: row.selectAll.syncMs,
            rects: row.selectAll.rects,
          },
          heapMiB: row.heapAfterSelect && row.heapAfterSelect / 2 ** 20,
          connected: row.connected,
          error: row.error,
        }),
      );
    }
  }
  await fs.writeFile(out, JSON.stringify(report, null, 2));
  console.log(out);
})();
