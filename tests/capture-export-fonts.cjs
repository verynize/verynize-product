// Captured custom fonts (document fontFaces) are used by every export: PNG/JPG/WebP (desktop/render.cjs
// renderDesign), PDF (renderPDF, rasterised with macOS sips or poppler pdftoppm for the pixel check), HTML
// (app.js artwork HTML and integrations/export-html.mjs) and code (integrations/export-code.mjs Tailwind and CSS).
// Pixel check: the captured font is Inter Bold served as "Fixture Display" with a serif fallback, so
// glyph masks of the export must match a reference rendered with Inter Bold and differ from the
// serif fallback rendered without the embedded font.
const { _electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFile } = require("node:child_process");
const exec = require("node:util").promisify(execFile);

(async () => {
  const font = await fs.readFile(
    path.join(
      __dirname,
      "..",
      "node_modules",
      "@fontsource",
      "inter",
      "files",
      "inter-latin-700-normal.woff2",
    ),
  );
  const fonts = http.createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    if (req.url === "/display.woff2") {
      res.setHeader("content-type", "font/woff2");
      res.end(font);
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => fonts.listen(0, "127.0.0.1", r));
  const F = "http://127.0.0.1:" + fonts.address().port;
  const site = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(
      `<!doctype html><html><head><title>Font export</title><style>@font-face{font-family:"Fixture Display";font-weight:700;src:url(${F}/display.woff2) format("woff2")}body{margin:0;background:#fff}h1{margin:0;padding:10px 16px;font:700 64px "Fixture Display",serif;color:#000;background:#fff;width:520px}</style></head><body><h1 id="title">Rag Quiz 47</h1></body></html>`,
    );
  });
  await new Promise((r) => site.listen(0, "127.0.0.1", r));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "capture-export-fonts-"));
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
    await page.waitForFunction(
      () => !!window.desktop?.captureRemote && !!window.livePreview?.insertCaptured,
    );
    const url = "http://127.0.0.1:" + site.address().port + "/";
    // Capture the page and insert it; select the headline text layer.
    const textId = await page.evaluate(async (target) => {
      const captured = await window.desktop.captureRemote({
        url: target,
        width: 640,
        height: 200,
        interactions: false,
      });
      window.livePreview.insertCaptured(captured, () => ({ x: 40, y: 40 }));
      const node = window.design
        .getDocument()
        .pages.flatMap((p) => p.nodes)
        .find((n) => n.text === "Rag Quiz 47");
      window.design.setSelection([node.id]);
      return node.id;
    }, url);
    const doc = await page.evaluate(() => window.design.getDocument());
    assert.deepEqual(
      doc.fontFaces.map((f) => f.family),
      ["Fixture Display"],
    );
    assert.match(
      doc.pages.flatMap((p) => p.nodes).find((n) => n.id === textId).fontFamily,
      /Fixture Display/,
    );

    const renderAll = () =>
      page.evaluate(async (id) => {
        window.design.setSelection([id]);
        const png = await window.design.exportArtwork({ format: "PNG", selectionOnly: true });
        const jpg = await window.design.exportArtwork({ format: "JPG", selectionOnly: true });
        const webp = await window.design.exportArtwork({ format: "WEBP", selectionOnly: true });
        const html = await window.design.exportArtwork({ format: "HTML", selectionOnly: true });
        const pdf = await window.desktop.renderPDF({
          html: html.content,
          width: Math.ceil(html.width - 1e-3),
          height: Math.ceil(html.height - 1e-3),
          title: "Fonts",
        });
        return {
          png: png.dataURL,
          pngFonts: png.fonts,
          jpg: jpg.dataURL,
          webp: webp.dataURL,
          html: html.content,
          pdf: pdf.dataURL,
          pdfFonts: pdf.fonts,
        };
      }, textId);
    const pdfRaster = async (dataURL, name) => {
      const file = path.join(dir, name + ".pdf"),
        out = path.join(dir, name + ".png");
      await fs.writeFile(file, Buffer.from(dataURL.split(",")[1], "base64"));
      // macOS sips; elsewhere poppler's pdftoppm at the same 72 dpi (the masks are compared with references
      // rasterised the same way, so the rasteriser cancels out).
      if (process.platform === "darwin")
        await exec("sips", ["-s", "format", "png", file, "--out", out]);
      else
        await exec("pdftoppm", [
          "-png",
          "-r",
          "72",
          "-singlefile",
          file,
          out.replace(/\.png$/, ""),
        ]);
      return "data:image/png;base64," + (await fs.readFile(out)).toString("base64");
    };
    // Override the generated @page margin so the PDF API's zero margins determine full bleed.
    const bleed = await page.evaluate(() =>
      window.desktop.renderPDF({
        html: '<style>@page { margin: auto }</style><div style="position:fixed;inset:0;background:#ff0000"></div>',
        width: 400,
        height: 200,
      }),
    );
    const corners = await page.evaluate(
      async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        return [
          [0, 0],
          [image.width - 1, 0],
          [0, image.height - 1],
          [image.width - 1, image.height - 1],
        ].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
      },
      await pdfRaster(bleed.dataURL, "zero-margins"),
    );
    assert.deepEqual(
      corners,
      Array(4).fill([255, 0, 0, 255]),
      "PDF API uses zero margins on every edge",
    );
    const captured = await renderAll();
    // Fallback: same layer without the embedded font (serif). Reference: the layer set in Inter Bold.
    await page.evaluate(() => {
      const d = window.design.getDocument();
      delete d.fontFaces;
      window.design.setDocument(d);
    });
    const fallback = await renderAll();
    await page.evaluate((id) => {
      const d = window.design.getDocument();
      d.pages.flatMap((p) => p.nodes).find((n) => n.id === id).fontFamily = "Inter";
      window.design.setDocument(d);
    }, textId);
    const reference = await renderAll();
    await page.evaluate((d) => window.design.setDocument(d), doc);

    // HTML export carries the font as embedded data; the renderer lifts it instead of a font-cache lookup.
    assert.match(
      captured.html,
      /@font-face\{font-family:"Fixture Display";font-weight:700;font-style:normal;font-display:block;src:url\(data:font\/woff2;base64,/,
    );
    assert.doesNotMatch(fallback.html, /@font-face/);
    assert.ok(
      captured.pngFonts.loaded >= 1 &&
        !captured.pngFonts.missing.some((m) => /Fixture/.test(m.family)),
      JSON.stringify(captured.pngFonts),
    );
    assert.ok(!captured.pdfFonts.missing.some((m) => /Fixture/.test(m.family)));

    const sets = {};
    for (const [name, r] of Object.entries({ captured, fallback, reference }))
      sets[name] = { png: r.png, jpg: r.jpg, webp: r.webp, pdf: await pdfRaster(r.pdf, name) };
    // Glyph masks (dark pixels) compared by IoU in the renderer (real image decoding).
    const scores = await page.evaluate(async (sets) => {
      const mask = async (src) => {
        const image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
          image.src = src;
        });
        const c = document.createElement("canvas");
        c.width = image.width;
        c.height = image.height;
        const x = c.getContext("2d");
        x.fillStyle = "#fff";
        x.fillRect(0, 0, c.width, c.height);
        x.drawImage(image, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data,
          m = new Uint8Array(c.width * c.height);
        let ink = 0;
        for (let i = 0; i < m.length; i++) {
          m[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] < 384 ? 1 : 0;
          ink += m[i];
        }
        return { m, w: c.width, h: c.height, ink };
      };
      const iou = (a, b) => {
        assertSize(a, b);
        let i = 0,
          u = 0;
        for (let k = 0; k < a.m.length; k++) {
          i += a.m[k] & b.m[k];
          u += a.m[k] | b.m[k];
        }
        return i / u;
      };
      const assertSize = (a, b) => {
        if (a.w !== b.w || a.h !== b.h) throw Error(`size ${a.w}×${a.h} vs ${b.w}×${b.h}`);
      };
      const out = {};
      for (const kind of ["png", "jpg", "webp", "pdf"]) {
        const [c, f, r] = await Promise.all([
          mask(sets.captured[kind]),
          mask(sets.fallback[kind]),
          mask(sets.reference[kind]),
        ]);
        out[kind] = {
          reference: iou(c, r),
          fallback: iou(c, f),
          ink: c.ink,
          size: c.w + "×" + c.h,
        };
      }
      return out;
    }, sets);
    for (const [kind, s] of Object.entries(scores)) {
      assert.ok(s.ink > 500, `${kind} has glyph pixels`);
      assert.ok(
        s.reference >= 0.9,
        `${kind}: captured font vs Inter Bold reference IoU ${s.reference.toFixed(3)} < 0.9`,
      );
      assert.ok(
        s.fallback <= 0.7,
        `${kind}: captured font vs serif fallback IoU ${s.fallback.toFixed(3)} > 0.7 (font not applied)`,
      );
    }

    // Headless HTML export and its render through the same renderer.
    const { exportHTML } = await import("../integrations/export-html.mjs");
    const { tailwindCode, cssCode } = await import("../integrations/export-code.mjs");
    const html = exportHTML(doc, doc.activePage);
    const face =
      /@font-face\{font-family:"Fixture Display"[^}]*src:url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)\}/.exec(
        html,
      );
    assert.ok(face, "export-html embeds the font");
    assert.deepEqual(Buffer.from(face[1], "base64"), font, "embedded bytes are the captured woff2");
    const page0 = doc.pages.find((p) => p.id === doc.activePage);
    const only = exportHTML(doc, doc.activePage, {
      nodeId: page0.nodes.find((n) => !n.parentId && n.name === "Captured region").id,
    });
    assert.match(only, /@font-face\{font-family:"Fixture Display"/);
    const noFont = exportHTML(
      {
        ...doc,
        pages: [
          {
            ...page0,
            nodes: page0.nodes.filter(
              (n) => n.text !== "Rag Quiz 47" && !n.fontFamily?.includes("Fixture"),
            ),
          },
        ],
      },
      doc.activePage,
    );
    assert.doesNotMatch(noFont, /@font-face/, "unused fonts are not emitted");
    // Code export: Tailwind component documents the @font-face rules; CSS flavour keeps them in <style>.
    const tailwind = tailwindCode(doc, doc.activePage, [textId], "Headline");
    assert.match(
      tailwind,
      /\/\* Embedded fonts used by the classes below[^]*@font-face\{font-family:"Fixture Display"[^]*data:font\/woff2;base64,/,
    );
    assert.match(tailwind, /export default function Headline/);
    assert.match(
      cssCode(captured.html, doc.tokens),
      /<style>[^]*@font-face\{font-family:"Fixture Display"/,
    );
    const bare = captured.html.replace(/@font-face\{[^}]*\}/g, "");
    assert.match(
      cssCode(bare, doc.tokens, { document: doc, pageId: doc.activePage }),
      /<style>\n@font-face\{font-family:"Fixture Display"/,
    );
    // The page HTML export of the editor carries the font too.
    assert.match(
      await page.evaluate(() => window.design.exportHTML()),
      /@font-face\{font-family:"Fixture Display"/,
    );
    const summary = Object.entries(scores)
      .map(([k, s]) => `${k} ${s.reference.toFixed(3)}/${s.fallback.toFixed(3)}`)
      .join(", ");
    console.log(
      `PASS captured woff2 font used by PNG/JPG/WebP/PDF/HTML/code exports (IoU vs Inter reference / vs fallback: ${summary})`,
    );
  } finally {
    await app.close();
    await new Promise((r) => site.close(r));
    await new Promise((r) => fonts.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
