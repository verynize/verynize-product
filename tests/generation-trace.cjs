// Smooth raster tracing fidelity (web/trace-bitmap.js) in the real renderer: anti-aliased sources are
// traced, the SVG is rasterised back at the source size, and every colour class is compared by IoU.
// Thresholds (stated, not tuned per run): circle ≥ 0.985, scaled circle ≥ 0.98, star ≥ 0.975,
// bold glyphs ≥ 0.965, four-colour scene ≥ 0.965 per colour. Smoothness: the traced circle is one
// subpath of at most 8 cubic segments whose outline stays within 0.75 px of the true radius, and
// polygon corners survive as sharp vertices.
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-fidelity-"));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VERYNIZE_SKIP_ONBOARDING = "1";
  const app = await _electron.launch({
    env,
    args: [".", `--user-data-dir=${dir}`],
    timeout: 20000,
  });
  try {
    const page = await app.firstWindow({ timeout: 20000 });
    await page.waitForFunction(() => !!window.traceBitmap);
    const results = await page.evaluate(async () => {
      const make = (w, h, draw) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        draw(c.getContext("2d"));
        return c;
      };
      const hex = (h) => h && [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const cases = {
        circle: {
          canvas: make(160, 160, (x) => {
            x.fillStyle = "#ffffff";
            x.fillRect(0, 0, 160, 160);
            x.fillStyle = "#3366cc";
            x.beginPath();
            x.arc(80, 80, 60, 0, Math.PI * 2);
            x.fill();
          }),
          colors: ["#ffffff", "#3366cc"],
        },
        scaled: {
          canvas: make(512, 512, (x) => {
            x.fillStyle = "#fafafa";
            x.fillRect(0, 0, 512, 512);
            x.fillStyle = "#7b2cbf";
            x.beginPath();
            x.arc(256, 256, 200, 0, Math.PI * 2);
            x.fill();
          }),
          colors: ["#fafafa", "#7b2cbf"],
        },
        star: {
          canvas: make(200, 200, (x) => {
            x.fillStyle = "#e0402a";
            x.beginPath();
            for (let i = 0; i < 10; i++) {
              const r = i % 2 ? 38 : 90,
                a = -Math.PI / 2 + (i * Math.PI) / 5;
              x.lineTo(100 + r * Math.cos(a), 100 + r * Math.sin(a));
            }
            x.closePath();
            x.fill();
          }),
          colors: [null, "#e0402a"],
        },
        glyph: {
          canvas: make(240, 160, (x) => {
            x.fillStyle = "#ffffff";
            x.fillRect(0, 0, 240, 160);
            x.fillStyle = "#111111";
            x.font = "bold 120px Inter, sans-serif";
            x.textBaseline = "middle";
            x.fillText("Rg", 20, 80);
          }),
          colors: ["#ffffff", "#111111"],
        },
        scene: {
          canvas: make(240, 180, (x) => {
            x.fillStyle = "#f5f0e6";
            x.fillRect(0, 0, 240, 180);
            x.fillStyle = "#2a9d8f";
            x.fillRect(20, 20, 120, 80);
            x.fillStyle = "#e9c46a";
            x.beginPath();
            x.ellipse(150, 110, 70, 45, 0.4, 0, Math.PI * 2);
            x.fill();
            x.fillStyle = "#264653";
            x.beginPath();
            x.moveTo(40, 170);
            x.lineTo(110, 90);
            x.lineTo(130, 170);
            x.closePath();
            x.fill();
          }),
          colors: ["#f5f0e6", "#2a9d8f", "#e9c46a", "#264653"],
        },
      };
      const out = {};
      for (const [name, { canvas, colors }] of Object.entries(cases)) {
        const svg = await window.traceBitmap(canvas.toDataURL("image/png"));
        const image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
          image.src = "data:image/svg+xml;base64," + btoa(svg);
        });
        const w = canvas.width,
          h = canvas.height;
        const traced = make(w, h, (x) => x.drawImage(image, 0, 0, w, h));
        const a = canvas.getContext("2d").getImageData(0, 0, w, h).data,
          b = traced.getContext("2d").getImageData(0, 0, w, h).data;
        const palette = colors.map(hex);
        const classify = (d, i) => {
          if (d[i + 3] < 128) return palette.indexOf(null);
          let best = -1,
            distance = Infinity;
          palette.forEach((p, j) => {
            if (!p) return;
            const dd = (d[i] - p[0]) ** 2 + (d[i + 1] - p[1]) ** 2 + (d[i + 2] - p[2]) ** 2;
            if (dd < distance) {
              distance = dd;
              best = j;
            }
          });
          return best;
        };
        const inter = palette.map(() => 0),
          union = palette.map(() => 0);
        for (let i = 0; i < w * h * 4; i += 4) {
          const x = classify(a, i),
            y = classify(b, i);
          for (let k = 0; k < palette.length; k++) {
            if (x === k && y === k) inter[k]++;
            if (x === k || y === k) union[k]++;
          }
        }
        out[name] = { svg, iou: inter.map((v, k) => v / union[k]) };
      }
      // Outline accuracy of the traced circle: sample the drawn path and measure radial error.
      const holder = document.createElement("div");
      holder.innerHTML = out.circle.svg;
      document.body.append(holder);
      const shape = holder.querySelector("path");
      const total = shape.getTotalLength();
      let deviation = 0;
      for (let i = 0; i < 400; i++) {
        const p = shape.getPointAtLength((total * i) / 400);
        deviation = Math.max(deviation, Math.abs(Math.hypot(p.x - 80, p.y - 80) - 60));
      }
      holder.remove();
      out.circle.deviation = deviation;
      // Two-colour rectangle split: corners stay exact (no curves needed).
      const split = make(16, 16, (x) => {
        x.fillStyle = "#ff0000";
        x.fillRect(0, 0, 8, 16);
        x.fillStyle = "#0000ff";
        x.fillRect(8, 0, 8, 16);
      });
      out.split = { svg: await window.traceBitmap(split.toDataURL("image/png")) };
      return out;
    });
    const thresholds = { circle: 0.985, scaled: 0.98, star: 0.975, glyph: 0.965, scene: 0.965 };
    for (const [name, minimum] of Object.entries(thresholds)) {
      for (const [k, value] of results[name].iou.entries())
        assert.ok(value >= minimum, `${name} colour ${k} IoU ${value.toFixed(4)} < ${minimum}`);
      assert.doesNotMatch(results[name].svg, /<image|crispEdges/);
    }
    const circlePath = results.circle.svg.match(/<path[^>]* d="([^"]+)"/)[1];
    assert.equal((circlePath.match(/M/g) || []).length, 1, "circle is one subpath");
    const curves = (circlePath.match(/C/g) || []).length;
    assert.ok(curves >= 2 && curves <= 8, `circle uses ${curves} cubic segments`);
    assert.ok(
      results.circle.deviation <= 0.75,
      `circle outline deviates ${results.circle.deviation.toFixed(3)} px`,
    );
    // Star: ten corners kept, few segments (no staircase).
    const starPath = results.star.svg.match(/<path[^>]* d="([^"]+)"/)[1];
    const starSegments = (starPath.match(/[LC]/g) || []).length;
    assert.equal((starPath.match(/M/g) || []).length, 1);
    assert.ok(starSegments >= 10 && starSegments <= 30, `star uses ${starSegments} segments`);
    assert.match(results.split.svg, /<rect width="16" height="16" fill="#(ff0000|0000ff)"\/>/);
    assert.match(
      results.split.svg,
      /d="M\d+ \d+L\d+ \d+L\d+ \d+L\d+ \d+L\d+ \d+Z"/,
      "rectangle traced with straight edges and exact corners",
    );
    const report = Object.entries(thresholds)
      .map(([name]) => `${name} ${results[name].iou.map((v) => v.toFixed(3)).join("/")}`)
      .join(", ");
    console.log(
      `PASS smooth tracing fidelity (IoU ${report}; circle ${curves} cubics, max deviation ${results.circle.deviation.toFixed(2)} px; star ${starSegments} segments)`,
    );
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
