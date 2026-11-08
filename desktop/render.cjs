const { onWindowClosed } = require("./window-cleanup.cjs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs/promises");
const { BrowserWindow, dialog, app, screen } = require("electron");
const { captureSize } = require("./render-limits.cjs");
const { randomUUID } = require("node:crypto");
function renderOptions(options) {
  if (
    !options ||
    typeof options.html !== "string" ||
    Buffer.byteLength(options.html) > 20 * 1024 * 1024
  )
    throw Error("Export HTML must be under 20 MB");
  const width = Number(options.width),
    height = Number(options.height),
    scale = Number(options.scale ?? 1);
  if (
    ![width, height, scale].every(Number.isFinite) ||
    width < 1 ||
    height < 1 ||
    scale < 0.01 ||
    scale > 100 ||
    width > 10000 ||
    height > 10000
  )
    throw Error("Invalid render dimensions: sides must be 1–10000 CSS px and scale 0.01–100");
  const fonts = Array.isArray(options.fonts) ? options.fonts.slice(0, 40) : null;
  return {
    html: options.html,
    width: Math.ceil(width),
    height: Math.ceil(height),
    scale,
    fonts,
    measure: options.measure !== false,
    screenshot: options.screenshot === true,
  };
}

// ---------------------------------------------------------------------------------------------
// Web fonts. The capture page runs under `font-src data:`, so every family the HTML uses is
// downloaded once into the font cache (integrations/fonts.mjs) and injected as embedded
// @font-face rules. Families that cannot be loaded are reported back as `fonts.missing`.
let fontsModule = null;
const loadFonts = () =>
  fontsModule ||
  (fontsModule = import(pathToFileURL(path.join(__dirname, "../integrations/fonts.mjs")).href));
const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&amp;/g, "&");
/** [{family, weights, styles}] for every font-family declared in inline styles / style blocks. */
function familiesFromHtml(html, splitFontStack) {
  const source = String(html),
    byFamily = new Map();
  // Attribute values are matched before entity decoding (font names arrive as &quot;Name&quot;).
  const declarations = [
    ...source.matchAll(/style\s*=\s*"([^"]*)"/gi),
    ...source.matchAll(/style\s*=\s*'([^']*)'/gi),
  ].map((m) => decode(m[1]));
  for (const m of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi))
    declarations.push(...m[1].split("}"));
  for (const block of declarations) {
    const family = /font-family\s*:\s*([^;}]+)/i.exec(block);
    if (!family) continue;
    const weight = /font-weight\s*:\s*(\d{3}|bold|normal)/i.exec(block)?.[1],
      style = /font-style\s*:\s*italic/i.test(block) ? "italic" : "normal";
    const first = splitFontStack(family[1])[0];
    if (!first) continue;
    const key = first.toLowerCase(),
      entry = byFamily.get(key) || {
        family: first,
        weights: new Set([400]),
        styles: new Set(["normal"]),
      };
    entry.weights.add(
      weight === "bold" ? 700 : weight === "normal" || !weight ? 400 : Number(weight),
    );
    entry.styles.add(style);
    byFamily.set(key, entry);
  }
  for (const m of decode(source).matchAll(/font-weight\s*:\s*(\d{3}|bold)/gi))
    for (const entry of byFamily.values()) entry.weights.add(m[1] === "bold" ? 700 : Number(m[1]));
  return [...byFamily.values()].slice(0, 40).map((e) => ({
    family: e.family,
    weights: [...e.weights].sort((a, b) => a - b),
    styles: [...e.styles],
  }));
}
// Fonts embedded by the document itself (`fontFaces`, e.g. captured web fonts) arrive as @font-face
// rules with data: sources inside the HTML. They are lifted out for consistent font loading,
// injected with insertCSS like cached fonts, and never looked up in the font cache.
function liftEmbeddedFonts(html) {
  const rules = [],
    families = new Set();
  const lean = String(html).replace(
    /@font-face\s*\{[^{}]*?src\s*:\s*url\(\s*["']?data:font\/[^{}]*\}/gi,
    (rule) => {
      rules.push(rule);
      const family = /font-family\s*:\s*(["']?)([^;"'}]+)\1/i.exec(rule)?.[2];
      if (family) families.add(family.trim().toLowerCase());
      return "";
    },
  );
  return {
    html: lean,
    css: rules.slice(0, 40).join("\n"),
    families,
    count: Math.min(40, rules.length),
  };
}
async function embedFonts(html, families, own = new Set()) {
  try {
    const fonts = await loadFonts();
    const wanted = (families || familiesFromHtml(html, fonts.splitFontStack)).filter(
      (f) => f && typeof f.family === "string",
    );
    const loadable = wanted.filter(
      (f) => !fonts.isGenericFamily(f.family) && !own.has(f.family.toLowerCase()),
    );
    if (!loadable.length) return { css: "", loaded: 0, missing: [] };
    const ensured = await fonts.ensureFonts(loadable);
    const face = await fonts.fontFaceCss(loadable, { embed: true });
    const missing = [...ensured.missing, ...face.missing].map((m) => ({
      family: m.family,
      ...(m.weight ? { weight: m.weight } : {}),
      reason: m.reason || "not loaded",
    }));
    return {
      css: face.css,
      loaded: face.faces.length,
      missing: [
        ...new Map(missing.map((m) => [m.family + "|" + (m.weight || ""), m])).values(),
      ].slice(0, 40),
    };
  } catch (error) {
    return {
      css: "",
      loaded: 0,
      missing: [{ family: "*", reason: "font loader failed: " + (error?.message || error) }],
    };
  }
}

// Per-element layout boxes of the rendered page ([data-id] elements), in CSS px of the page
// (zoom factor divided out). Text elements also report scroll/client sizes for overflow checks.
const MEASURE = `(()=>{const out={},k=parseFloat(document.documentElement.style.zoom)||1;let n=0;for(const el of document.querySelectorAll('[data-id]')){if(++n>5000)break;const r=el.getBoundingClientRect();const b={x:(r.left+scrollX)/k,y:(r.top+scrollY)/k,w:r.width/k,h:r.height/k};if(el.dataset.designType==='text'){b.scrollWidth=el.scrollWidth;b.scrollHeight=el.scrollHeight;b.clientWidth=el.clientWidth;b.clientHeight=el.clientHeight;}out[el.dataset.id]=b;}return out;})()`;

// Offscreen rasterizer shared by the export handler and the MCP bridge's take_screenshot.
// Renders are serialized so concurrent callers never share a capture window.
let renderQueue = Promise.resolve();
function renderHTML(input, parent = null) {
  const options = renderOptions(input);
  const run = () => renderNow(options, parent);
  const result = renderQueue.then(run, run);
  renderQueue = result.catch(() => {});
  return result;
}
async function renderNow(
  { html, width, height, scale: requestedScale, fonts: families, measure, screenshot },
  parent,
) {
  // Use the largest connected display factor: a hidden window may be placed on any display.
  const deviceScale = Math.max(1, ...screen.getAllDisplays().map((display) => display.scaleFactor));
  const {
    width: outputWidth,
    height: outputHeight,
    scale,
  } = captureSize(width, height, requestedScale, deviceScale, screenshot);
  // Chromium clamps page zoom at 5×; larger factors add CSS zoom on the root for the remainder.
  const pageZoom = Math.max(0.25, Math.min(scale, 4)),
    cssZoom = scale / pageZoom;
  const lifted = liftEmbeddedFonts(html);
  html = lifted.html;
  const fonts = await embedFonts(html, families, lifted.families);
  fonts.loaded += lifted.count;
  const window = new BrowserWindow({
    show: false,
    useContentSize: true,
    enableLargerThanScreen: true,
    width: outputWidth,
    height: outputHeight,
    transparent: true,
    frame: false,
    webPreferences: {
      partition: "render-" + randomUUID(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const close = () => {
    if (!window.isDestroyed()) window.destroy();
  };
  const offClosed = onWindowClosed(parent, close);
  // Some window systems clamp the constructor size to the display work area. Reapply the
  // already-bounded content size and refuse a clipped capture if the window manager rejects it.
  window.setContentSize(outputWidth, outputHeight);
  const disposePage = serveRenderPage(window, html, true);
  try {
    await window.loadURL(RENDER_URL);
    const [actualWidth, actualHeight] = window.getContentSize();
    if (actualWidth !== outputWidth || actualHeight !== outputHeight)
      throw Error(
        "The window manager cannot render this size. Lower the scale or select a smaller area.",
      );
    // Navigation establishes the page's zoom context. Set scale after loading, otherwise
    // loadURL can reset it. CSS zoom handles factors outside Chromium's page zoom range.
    window.webContents.setZoomFactor(pageZoom);
    if (cssZoom !== 1)
      await window.webContents.executeJavaScript(
        `document.documentElement.style.zoom=${JSON.stringify(String(cssZoom))}`,
      );
    // Inserted after load so cached and document fonts share the same settling path.
    if (fonts.css) await window.webContents.insertCSS(fonts.css);
    if (lifted.css) await window.webContents.insertCSS(lifted.css);
    await window.webContents.executeJavaScript(
      `Promise.race([Promise.all([document.body&&document.body.offsetHeight,...[...document.fonts].map(face=>face.load().catch(()=>{}))]).then(()=>Promise.all([document.fonts.ready,...[...document.images].map(image=>image.decode().catch(()=>{}))])).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))),new Promise(resolve=>setTimeout(resolve,4000))])`,
    );
    const boxes = measure
      ? await window.webContents.executeJavaScript(MEASURE).catch(() => null)
      : null;
    const image = await window.webContents.capturePage(
      { x: 0, y: 0, width: outputWidth, height: outputHeight },
      { stayHidden: true, stayAwake: true },
    );
    return {
      dataURL: image
        .resize({ width: outputWidth, height: outputHeight, quality: "best" })
        .toDataURL(),
      width: outputWidth,
      height: outputHeight,
      scale,
      requestedScale,
      ...(boxes && Object.keys(boxes).length ? { boxes } : {}),
      fonts: { loaded: fonts.loaded, missing: fonts.missing },
    };
  } finally {
    disposePage();
    close();
    offClosed();
  }
}
function registerRendering(handle, parent) {
  let active = false;
  registerArtworkExport(handle, parent);
  handle("renderDesign", async (input) => {
    if (active) throw Error("An export is already rendering");
    renderOptions(input);
    active = true;
    try {
      return await renderHTML(input, parent);
    } finally {
      active = false;
    }
  });
  // Editor canvas fonts: the renderer asks for embedded @font-face CSS for the families a document uses.
  handle("fontFaces", async (families) => {
    if (!Array.isArray(families)) throw Error("Expected a list of font families");
    const list = families
      .slice(0, 40)
      .filter((f) => f && typeof f.family === "string" && f.family.length <= 120)
      .map((f) => ({
        family: f.family,
        weights: (Array.isArray(f.weights) ? f.weights : [400]).filter(Number.isFinite).slice(0, 9),
        styles: (Array.isArray(f.styles) ? f.styles : ["normal"]).filter(
          (s) => s === "normal" || s === "italic",
        ),
      }));
    const fonts = await embedFonts("", list);
    return { css: fonts.css, loaded: fonts.loaded, missing: fonts.missing };
  });
}

// ---------------------------------------------------------------------------------------------
// Artwork export (inspector Export section): vector PDF of the selection, native save dialog and the
// font catalog for the font family picker.
const RENDER_URL = "verynize-render://document/";
function serveRenderPage(window, html, scripts = false) {
  const contents = window.webContents,
    session = contents.session;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (e) => e.preventDefault());
  contents.on("will-redirect", (e) => e.preventDefault());
  session.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onBeforeRequest((details, cb) =>
    cb({
      cancel:
        details.url !== RENDER_URL &&
        !details.url.startsWith("data:") &&
        !details.url.startsWith("blob:"),
    }),
  );
  session.protocol.handle(
    "verynize-render",
    (request) =>
      new Response(request.url === RENDER_URL ? html : "", {
        status: request.url === RENDER_URL ? 200 : 404,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy":
            "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:;" +
            (scripts ? " script-src 'unsafe-inline';" : ""),
        },
      }),
  );
  return () => session.protocol.unhandle("verynize-render");
}
// The PDF page runs without JavaScript, so web fonts (cached or embedded) are loaded through the
// DevTools protocol before printing; otherwise printToPDF can run before any font face has decoded.
async function settleFonts(webContents) {
  const debug = webContents.debugger;
  try {
    debug.attach("1.3");
  } catch {
    return;
  }
  try {
    await Promise.race([
      debug.sendCommand("Runtime.evaluate", {
        expression:
          "Promise.all([...document.fonts].map(f=>f.load().catch(()=>{}))).then(()=>document.fonts.ready).then(()=>new Promise(r=>requestAnimationFrame(()=>r(true))))",
        awaitPromise: true,
      }),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch {
    /* print with whatever has loaded */
  } finally {
    try {
      debug.detach();
    } catch {
      /* already detached */
    }
  }
}
async function renderPDF(input, parent = null) {
  const { width, height } = renderOptions({ ...input, scale: 1 });
  const lifted = liftEmbeddedFonts(input.html);
  const fonts = await embedFonts(lifted.html, null, lifted.families);
  fonts.loaded += lifted.count;
  const window = new BrowserWindow({
    show: false,
    width: Math.min(width, 1024),
    height: Math.min(height, 1024),
    webPreferences: {
      partition: "pdf-" + randomUUID(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
    },
  });
  const close = () => {
    if (!window.isDestroyed()) window.destroy();
  };
  const offClosed = onWindowClosed(parent, close);
  const title = String(input.title || "Export")
    .replace(/[<>&]/g, "")
    .slice(0, 120);
  const page = `<title>${title}</title><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}</style>`;
  const disposePage = serveRenderPage(window, page + lifted.html);
  try {
    await window.loadURL(RENDER_URL);
    if (fonts.css) await window.webContents.insertCSS(fonts.css);
    if (lifted.css) await window.webContents.insertCSS(lifted.css);
    await settleFonts(window.webContents);
    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      pageSize: { width: width / 96, height: height / 96 },
    });
    return {
      dataURL: "data:application/pdf;base64," + pdf.toString("base64"),
      width,
      height,
      bytes: pdf.length,
      fonts: { loaded: fonts.loaded, missing: fonts.missing },
    };
  } finally {
    disposePage();
    close();
    offClosed();
  }
}
const EXPORT_TYPES = {
  png: ["PNG image", "image/png"],
  jpg: ["JPEG image", "image/jpeg"],
  webp: ["WebP image", "image/webp"],
  svg: ["SVG image", "image/svg+xml"],
  pdf: ["PDF document", "application/pdf"],
  html: ["HTML document", "text/html"],
  css: ["CSS stylesheet", "text/css"],
  jsx: ["React component", "text/jsx"],
};
/** Validate a save request: {name, data: data URL or text, extension}. */
function saveRequest(options) {
  if (!options || typeof options.name !== "string" || typeof options.data !== "string")
    throw Error("Invalid export");
  const extension = String(options.extension || "").toLowerCase();
  if (!EXPORT_TYPES[extension]) throw Error("Unsupported export format");
  const base =
    options.name
      // oxlint-disable-next-line no-control-regex -- control characters are not allowed in file names
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
      .replace(/^[.\s-]+/, "")
      .slice(0, 120) || "export";
  let bytes;
  const data = /^data:([a-z+/.-]+);base64,([A-Za-z0-9+/=]*)$/i.exec(options.data);
  if (data) bytes = Buffer.from(data[2], "base64");
  else if (options.data.startsWith("data:")) throw Error("Unsupported data URL");
  else bytes = Buffer.from(options.data, "utf8");
  if (bytes.length > 200 * 1024 * 1024) throw Error("Export exceeds 200 MB");
  return {
    name: base.toLowerCase().endsWith("." + extension) ? base : base + "." + extension,
    extension,
    bytes,
  };
}
let catalogPromise = null;
function registerArtworkExport(handle, parent) {
  handle("renderPDF", (input) => renderPDF(input, parent));
  // Code export: Tailwind JSX from the document (codec) or HTML + CSS classes from the artwork HTML.
  handle("exportCode", async (options) => {
    if (!options || !["tailwind", "css"].includes(options.flavor))
      throw Error("Unknown code flavor");
    const code = await import(
      pathToFileURL(path.join(__dirname, "../integrations/export-code.mjs")).href
    );
    if (options.flavor === "css") {
      if (typeof options.html !== "string" || Buffer.byteLength(options.html) > 20 * 1024 * 1024)
        throw Error("Export HTML must be under 20 MB");
      return { content: code.cssCode(options.html, options.tokens || {}), extension: "html" };
    }
    if (!Array.isArray(options.nodeIds) || options.nodeIds.length > 5000)
      throw Error("Invalid export selection");
    // snippet {links, date}: the clipboard form (Copy as code / Copy prompt) with its "Made with Verynize" comment.
    const s = options.snippet,
      snippet =
        s && typeof s === "object"
          ? {
              links: (Array.isArray(s.links) ? s.links : [])
                .filter((l) => typeof l === "string")
                .slice(0, 200)
                .map((l) => l.slice(0, 2000)),
              date: typeof s.date === "string" ? s.date.slice(0, 100) : "",
            }
          : null;
    return {
      content: code.tailwindCode(options.document, options.pageId, options.nodeIds, options.name, {
        snippet,
      }),
      extension: "jsx",
    };
  });
  handle("saveExport", async (options) => {
    const { name, extension, bytes } = saveRequest(options);
    const result = await dialog.showSaveDialog(parent, {
      title: "Export",
      defaultPath: path.join(app.getPath("downloads"), name),
      filters: [{ name: EXPORT_TYPES[extension][0], extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, bytes);
    return { path: result.filePath, name: path.basename(result.filePath), bytes: bytes.length };
  });
  handle("fontCatalog", async () => {
    catalogPromise ??= loadFonts()
      .then((f) => f.fontCatalog())
      .catch(() => null);
    const result = await catalogPromise;
    if (!result || result.source === "bundled") catalogPromise = null;
    return result || { fonts: [], source: "none" };
  });
}
module.exports = {
  registerRendering,
  registerArtworkExport,
  saveRequest,
  renderPDF,
  renderOptions,
  renderHTML,
  familiesFromHtml,
  embedFonts,
};
