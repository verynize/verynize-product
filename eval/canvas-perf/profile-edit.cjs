#!/usr/bin/env node
// CPU profile of N one-node edits in the running app, grouped by function (self time) and by inclusive time for key functions.
const { _electron } = require("@playwright/test");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const root = require("node:path").resolve(__dirname, "../.."),
  n = Number(process.argv[2] || 1000),
  stripHas = process.argv.includes("--strip-has"),
  full = process.argv.includes("--full");
const { synthetic } = require(path.join(root, "eval/canvas-perf/bench-verynize.cjs"));
const { waitForUiReady } = require(path.join(root, "tests/helpers/ui-ready.cjs"));
void (async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prof-")),
    env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ env, cwd: root, args: [root, `--user-data-dir=${dir}`] });
  const page = await app.firstWindow();
  await waitForUiReady(page);
  await page.evaluate(() => window.fileLibrary?.showEditor());
  if (full) await page.evaluate(() => localStorage.setItem("verynize.canvas-render", "full"));
  // Removes the five `:has(:focus-visible)` rules (fix 1 simulated), walking nested rules (@layer) as experiment-has.cjs does.
  if (stripHas)
    console.log(
      "removed rules",
      await page.evaluate(() => {
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
      }),
    );
  await page.evaluate((doc) => window.design.loadDocument(doc), synthetic(n));
  await page.evaluate(() => window.design.setCamera(40, 60, 1));
  await page.waitForTimeout(800);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  const times = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 10; i++) {
      const s = performance.now();
      window.design.updateNodes(["n1"], { color: i % 2 ? "#ab3456" : "#cd5678" });
      out.push(performance.now() - s);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    }
    return out;
  });
  const { profile } = await cdp.send("Profiler.stop");
  const self = new Map(),
    byId = new Map(profile.nodes.map((x) => [x.id, x])),
    parent = new Map();
  for (const x of profile.nodes) for (const c of x.children || []) parent.set(c, x.id);
  const incl = new Map();
  profile.samples.forEach((id, i) => {
    const dt = (profile.timeDeltas[i] || 0) / 1000,
      f = byId.get(id).callFrame,
      key = `${f.functionName || "(anon)"} ${path.basename(f.url)}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + dt);
    const seen = new Set();
    for (let p = id; p !== undefined; p = parent.get(p)) {
      const cf = byId.get(p).callFrame,
        k = `${cf.functionName || "(anon)"} ${path.basename(cf.url)}`;
      if (!seen.has(k)) {
        seen.add(k);
        incl.set(k, (incl.get(k) || 0) + dt);
      }
    }
  });
  times.sort((a, b) => a - b);
  console.log(
    "edit sync ms median",
    times[5].toFixed(1),
    "all",
    times.map((t) => t.toFixed(0)).join(","),
  );
  console.log("-- self (top 15, ms over 10 edits)");
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 15))
    console.log(v.toFixed(1).padStart(8), k);
  console.log("-- inclusive (selected)");
  for (const [k, v] of [...incl]
    .filter(([k]) =>
      /^(render|updateNodes|drawFrameLabels|rows|afterRender|save|structuredClone|layerElement|visit|draw|nodeStyle|updateMeasurement|worldRect|preflightChange|validate|stringify|parse|getBoundingClientRect|draw selection-chrome|beforeRender|syncAnchored|refreshHover|drawClippedSelection|reset|compare|snapshot|options|sizingMode) /.test(
        k,
      ),
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30))
    console.log(v.toFixed(1).padStart(8), k);
  await app.close();
})();
