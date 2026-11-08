#!/usr/bin/env node
// CPU profile of a synthetic drag (same events as eval/canvas-perf/renderer.cjs) at N nodes.
const { _electron } = require("@playwright/test");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const root = require("node:path").resolve(__dirname, "../.."),
  n = Number(process.argv[2] || 5000),
  moves = Number(process.argv[3] || 5);
const { synthetic } = require(path.join(root, "eval/canvas-perf/bench-verynize.cjs"));
const { waitForUiReady } = require(path.join(root, "tests/helpers/ui-ready.cjs"));
void (async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dprof-")),
    env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ env, cwd: root, args: [root, `--user-data-dir=${dir}`] });
  const page = await app.firstWindow();
  await waitForUiReady(page);
  await page.evaluate(() => window.fileLibrary?.showEditor());
  await page.evaluate((doc) => window.design.loadDocument(doc), synthetic(n));
  await page.evaluate(() => {
    window.design.setCamera(40, 60, 1);
    window.design.setSelection(["n1"]);
  });
  await page.waitForTimeout(1000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  await cdp.send("Profiler.start");
  const times = await page.evaluate(async (moves) => {
    const t = document.querySelector('[data-id="n1"].layer'),
      r = t.getBoundingClientRect(),
      x = r.x + r.width / 2,
      y = r.y + r.height / 2,
      out = [];
    t.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 99,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
      }),
    );
    for (let i = 0; i < moves; i++) {
      const s = performance.now();
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 99,
          buttons: 1,
          clientX: x + 45 + i,
          clientY: y + 35,
        }),
      );
      out.push(performance.now() - s);
      await new Promise((r) => requestAnimationFrame(r));
    }
    const s = performance.now();
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 99,
        button: 0,
        buttons: 0,
        clientX: x,
        clientY: y,
      }),
    );
    out.push(performance.now() - s);
    return out;
  }, moves);
  const { profile } = await cdp.send("Profiler.stop");
  const byId = new Map(profile.nodes.map((x) => [x.id, x])),
    parent = new Map();
  for (const x of profile.nodes) for (const c of x.children || []) parent.set(c, x.id);
  const incl = new Map(),
    self = new Map();
  profile.samples.forEach((id, i) => {
    const dt = (profile.timeDeltas[i] || 0) / 1000,
      f = byId.get(id).callFrame;
    const sk = `${f.functionName || "(anon)"} ${path.basename(f.url)}:${f.lineNumber + 1}`;
    self.set(sk, (self.get(sk) || 0) + dt);
    const seen = new Set();
    for (let p = id; p !== undefined; p = parent.get(p)) {
      const cf = byId.get(p).callFrame,
        k = `${cf.functionName || "(anon)"} ${path.basename(cf.url)}:${cf.lineNumber + 1}`;
      if (!seen.has(k)) {
        seen.add(k);
        incl.set(k, (incl.get(k) || 0) + dt);
      }
    }
  });
  console.log("move ms", times.map((t) => t.toFixed(0)).join(","), "(last = pointerup)");
  console.log("-- self");
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 12))
    console.log(v.toFixed(0).padStart(7), k);
  console.log("-- inclusive");
  for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, 30))
    console.log(v.toFixed(0).padStart(7), k);
  await app.close();
})();
