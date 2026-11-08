#!/usr/bin/env node
// Times the pieces of a one-node commit in the running app (global lexical bindings of web/app.js).
const { _electron } = require("@playwright/test");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const root = require("node:path").resolve(__dirname, "../.."),
  sizes = (process.argv[2] || "1000,5000").split(",").map(Number);
const { synthetic } = require(path.join(root, "eval/canvas-perf/bench-verynize.cjs"));
const { waitForUiReady } = require(path.join(root, "tests/helpers/ui-ready.cjs"));
void (async () => {
  for (const n of sizes) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cost-")),
      env = { ...process.env, VERYNIZE_SKIP_ONBOARDING: "1" };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ env, cwd: root, args: [root, `--user-data-dir=${dir}`] });
    const page = await app.firstWindow();
    await waitForUiReady(page);
    await page.evaluate(() => window.fileLibrary?.showEditor());
    await page.evaluate((doc) => window.design.loadDocument(doc), synthetic(n));
    await page.waitForTimeout(500);
    const out = await page.evaluate(() => {
      const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
      const time = (fn, k = 5) => {
        const t = [];
        for (let i = 0; i < k; i++) {
          const s = performance.now();
          fn();
          t.push(performance.now() - s);
        }
        return +med(t).toFixed(2);
      };
      let str, parsed;
      const r = {};
      r.stringify = time(() => {
        str = JSON.stringify(design);
      });
      r.parse = time(() => {
        parsed = JSON.parse(str);
      });
      r.structuredClone = time(() => {
        structuredClone(design);
      });
      r.validateClone = time(() => validate(structuredClone(design)));
      r.preflightChange = time(() => window.imageUpload.preflightChange(design, parsed));
      r.save = time(() => save());
      r.subscribers = subscribers.size;
      r.subscriberClones = time(() => {
        for (const _fn of subscribers) structuredClone(design);
      });
      r.zeroArity = [...subscribers].filter((fn) => fn.length === 0).length;
      if (typeof validationCopy === "function") {
        r.validateShallowCopy = time(() => validate(validationCopy(design)));
        r.subscriberClonesNow = time(() => {
          for (const fn of subscribers) if (fn.length) structuredClone(design);
        });
        const t = [design.pages[0].nodes[1]];
        r.preflightTargets = time(() =>
          window.imageUpload.preflightChange(
            design,
            t.map((n) => structuredClone(n)),
            t,
          ),
        );
        r.persist = time(() => persist());
      }
      r.renderNoChange = time(() => render());
      let c = 0;
      r.updateNodes = time(() =>
        window.design.updateNodes(["n1"], { color: ++c % 2 ? "#ab3456" : "#cd5678" }),
      );
      r.bytes = str.length;
      return r;
    });
    console.log(n, JSON.stringify(out));
    await app.close();
  }
})();
