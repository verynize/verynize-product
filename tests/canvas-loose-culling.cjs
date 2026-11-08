// Retained loose-node culling: overflow, interaction exemptions, export and a repeatable pan probe.
const { _electron } = require("@playwright/test");
const { waitForUiReady } = require("./helpers/ui-ready.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "loose-cull-"));
  const env = {
    ...process.env,
    VERYNIZE_SKIP_ONBOARDING: "1",
    VERYNIZE_LAUNCH_EDITOR: "1",
    VERYNIZE_PREFERENCES: path.join(dir, "prefs.json"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ env, args: [".", `--user-data-dir=${dir}`] });
  try {
    const page = await app.firstWindow();
    await waitForUiReady(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await page.exposeFunction("__panMetrics", async () => {
      const { metrics } = await cdp.send("Performance.getMetrics");
      return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
    });
    const result = await page.evaluate(async (bench) => {
      const D = window.design;
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const rect = (id, x, y, extra = {}) => ({
        id,
        name: id,
        type: "rectangle",
        x,
        y,
        w: 100,
        h: 80,
        color: "#8844cc",
        ...extra,
      });
      const seed = (nodes) => {
        const d = D.getDocument();
        d.pages = [{ id: d.pages[0].id, name: "Culling", nodes }];
        d.activePage = d.pages[0].id;
        D.setDocument(d);
        D.setSelection([]);
        D.setCamera(100, 100, 1);
      };
      const el = (id) => document.querySelector(`#canvas [data-id="${id}"]`);
      const culled = (id) => el(id).hasAttribute("data-culled");
      if (bench) {
        seed(
          Array.from({ length: 3000 }, (_, i) =>
            rect("n" + i, (i % 100) * 400, Math.floor(i / 100) * 300, {
              type: "text",
              text: "Loose board typography " + i,
              fontSize: 20,
              wMode: "fixed",
              hMode: "fixed",
            }),
          ),
        );
        await frame();
        const before = await window.__panMetrics();
        const times = [];
        let last = await new Promise(requestAnimationFrame);
        for (let i = 0; i < 120; i++) {
          D.setCamera(100 - i * 10, 100, 1);
          const now = await new Promise(requestAnimationFrame);
          times.push(now - last);
          last = now;
        }
        const after = await window.__panMetrics();
        times.sort((a, b) => a - b);
        return {
          metrics: Object.fromEntries(
            [
              "LayoutCount",
              "RecalcStyleCount",
              "LayoutDuration",
              "RecalcStyleDuration",
              "TaskDuration",
            ].map((k) => [k, after[k] - before[k]]),
          ),
          nodes: 3000,
          frames: times.length,
          p50: times[60],
          p95: times[114],
          culled: document.querySelectorAll("#canvas > [data-culled]").length,
        };
      }
      seed([
        rect("near", 0, 0),
        rect("rect", 8000, 0),
        rect("text", 8000, 100, {
          type: "text",
          text: "Offscreen text",
          fontSize: 20,
          wMode: "fixed",
          hMode: "fixed",
        }),
        rect("image", 8000, 200, {
          type: "image",
          src:
            "data:image/svg+xml;base64," +
            btoa(
              '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="red"/></svg>',
            ),
        }),
        rect("group", 8000, 300, { type: "frame", layout: "free", clipContent: false }),
        rect("child", 0, 0, { parentId: "group" }),
        rect("overflow", 8000, 0, { type: "frame", layout: "free", clipContent: false }),
        rect("reaching", -8000, 0, { parentId: "overflow" }),
        rect("shadow", 5000, 0, {
          shadows: [{ type: "box", x: -5000, y: 0, blur: 0, spread: 0, color: "#000000" }],
        }),
        rect("stroke", 2000, 0, { outlineWidth: 1000, outlineOffset: 1000 }),
      ]);
      await frame();
      const initial = Object.fromEntries(
        ["near", "rect", "text", "image", "group", "overflow", "shadow", "stroke"].map((id) => [
          id,
          culled(id),
        ]),
      );
      const exported = await D.exportArtwork({ format: "HTML", selectionOnly: false });
      const capture = await D.exportArtwork({
        format: "PNG",
        selectionOnly: false,
        screenshot: true,
      });
      localStorage.setItem("verynize.canvas-cull", "off");
      window.render();
      const reference = await D.exportArtwork({ format: "HTML", selectionOnly: false });
      const captureReference = await D.exportArtwork({
        format: "PNG",
        selectionOnly: false,
        screenshot: true,
      });
      localStorage.removeItem("verynize.canvas-cull");
      window.render();
      D.setSelection(["child"]);
      await frame();
      const selectedAncestor = culled("group");
      D.setSelection(["rect"]);
      await frame();
      const selected = culled("rect");
      D.setSelection([]);
      el("child").setAttribute("data-dragging", "");
      await frame();
      const dragging = culled("group");
      el("child").removeAttribute("data-dragging");
      el("text").setAttribute("data-text-editing", "");
      await frame();
      const editing = culled("text");
      el("text").removeAttribute("data-text-editing");
      window.render();
      D.setCamera(-7900, 100, 1);
      await frame();
      const revealed = !culled("rect");
      const r = el("rect").getBoundingClientRect();
      const hit = document.elementsFromPoint(r.x + 50, r.y + 40).some((e) => e === el("rect"));
      return {
        initial,
        exportEqual: exported.content === reference.content,
        captureEqual: capture.dataURL === captureReference.dataURL,
        selectedAncestor,
        selected,
        dragging,
        editing,
        revealed,
        hit,
      };
    }, !!process.env.CULL_BENCH);
    if (process.env.CULL_BENCH) console.log(JSON.stringify(result));
    else {
      assert.deepEqual(result.initial, {
        near: false,
        rect: true,
        text: true,
        image: true,
        group: true,
        overflow: false,
        shadow: false,
        stroke: false,
      });
      assert.equal(result.exportEqual, true, "export is independent of culling");
      assert.equal(
        result.captureEqual,
        true,
        "desktop/agent screenshot pixels are independent of culling",
      );
      for (const key of ["selectedAncestor", "selected", "dragging", "editing"])
        assert.equal(result[key], false, key);
      assert.equal(result.revealed, true);
      assert.equal(result.hit, true);
      console.log(
        "PASS loose culling: overflow, selection/drag/text exemptions, export, pan and hit testing",
      );
    }
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
