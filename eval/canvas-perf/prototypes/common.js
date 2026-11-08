// Shared pieces for every strategy: generated images, node → CSS, DOM builder, a uniform-grid spatial index,
// a DOM layout host (browser measures boxes and word positions) and a Canvas 2D painter with CSS-like text layout.
(function () {
  const IMG_W = 520,
    IMG_H = 324;

  /** Six procedural images (no network). Each has a blob URL for the DOM and an ImageBitmap for canvases/GPU. */
  async function makeImages() {
    const out = [];
    for (let k = 0; k < 6; k++) {
      const c = new OffscreenCanvas(IMG_W, IMG_H),
        g = c.getContext("2d");
      const hue = k * 57;
      const grad = g.createLinearGradient(0, 0, IMG_W, IMG_H);
      grad.addColorStop(0, `hsl(${hue} 80% 62%)`);
      grad.addColorStop(1, `hsl(${hue + 70} 75% 38%)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, IMG_W, IMG_H);
      for (let j = 0; j < 14; j++) {
        g.fillStyle = `hsla(${hue + j * 23} 90% ${50 + (j % 3) * 15}% / .55)`;
        g.beginPath();
        g.arc(
          (j * 97 + k * 31) % IMG_W,
          (j * 53 + k * 71) % IMG_H,
          18 + ((j * 13) % 70),
          0,
          Math.PI * 2,
        );
        g.fill();
      }
      g.fillStyle = "#ffffffcc";
      g.font = '700 44px "Helvetica Neue", Arial';
      g.fillText("IMG " + k, 28, IMG_H - 32);
      const blob = await c.convertToBlob({ type: "image/png" });
      out.push({
        url: URL.createObjectURL(blob),
        bitmap: await createImageBitmap(blob),
        w: IMG_W,
        h: IMG_H,
      });
    }
    return out;
  }

  const esc = (s) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const gradientCss = (f) =>
    `linear-gradient(${f.angle}deg, ${f.stops.map((s) => `${s.color} ${s.position}%`).join(", ")})`;
  const shadowCss = (list, k = 1) =>
    list
      .map((s) => `${s.x * k}px ${s.y * k}px ${s.blur * k}px ${s.spread * k}px ${s.color}`)
      .join(", ");

  /** Text segments: the text split at run boundaries, each with its own resolved style. */
  function segments(n) {
    const t = n.text || "",
      runs = (n.textRuns || []).slice().sort((a, b) => a.start - b.start),
      segs = [];
    let at = 0;
    const base = { bold: false, italic: false, color: n.color, fontSize: n.fontSize, run: -1 };
    runs.forEach((r, ri) => {
      if (r.start > at) segs.push({ ...base, text: t.slice(at, r.start) });
      segs.push({
        text: t.slice(r.start, r.end),
        bold: r.bold,
        italic: r.italic,
        color: r.color || n.color,
        fontSize: r.fontSize || n.fontSize,
        run: ri,
      });
      at = r.end;
    });
    if (at < t.length) segs.push({ ...base, text: t.slice(at) });
    return segs;
  }
  const segFont = (n, s, k = 1) =>
    `${s.italic ? "italic " : ""}${s.bold ? 700 : n.fontWeight || 400} ${s.fontSize * k}px ${n.fontFamily}`;

  function textHtml(n) {
    if (!n.textRuns?.length) return esc(n.text || "");
    return segments(n)
      .map((s) =>
        s.run < 0
          ? esc(s.text)
          : `<span style="${s.bold ? "font-weight:700;" : ""}${s.italic ? "font-style:italic;" : ""}color:${s.color};${s.fontSize !== n.fontSize ? `font-size:${s.fontSize}px;` : ""}">${esc(s.text)}</span>`,
      )
      .join("");
  }

  /** CSS for one node in world space (k = 1) or pre-scaled screen space (naive strategy). */
  function nodeCss(scene, i, images, opt = {}) {
    const n = scene.nodes[i],
      k = opt.k || 1,
      p = scene.parent[i] >= 0 ? scene.nodes[scene.parent[i]] : null;
    const inFlow = p && p.layout && opt.flex !== false;
    const s = [];
    if (inFlow) s.push("position:relative", "flex:none");
    else {
      const x = opt.left ?? n.x,
        y = opt.top ?? n.y;
      s.push("position:absolute", `left:${x * k}px`, `top:${y * k}px`);
    }
    s.push(
      `width:${n.w * k}px`,
      n.hAuto && opt.flex !== false ? "height:auto" : `height:${(n.h ?? scene.abs[i].h) * k}px`,
      "box-sizing:border-box",
    );
    if (n.fills?.length) s.push(`background:${gradientCss(n.fills[0])}`);
    else if (n.color && n.type !== "text") s.push(`background:${n.color}`);
    if (n.type === "image") {
      const im = images[+n.src.slice(4)];
      s.push(`background:url(${im.url}) center/cover no-repeat`);
    }
    if (n.ellipse) s.push("border-radius:50%");
    else if (n.radius) s.push(`border-radius:${n.radius * k}px`);
    if (n.strokeWidth) s.push(`border:${n.strokeWidth * k}px solid ${n.strokeColor}`);
    if (n.shadows?.length) s.push(`box-shadow:${shadowCss(n.shadows, k)}`);
    for (const f of n.filters || [])
      s.push(`${f.backdrop ? "backdrop-filter" : "filter"}:blur(${f.value * k}px)`);
    if (n.clipContent) s.push("overflow:hidden");
    if (n.layout && opt.flex !== false) {
      s.push(
        "display:flex",
        `flex-direction:${n.layout}`,
        `gap:${(n.gap || 0) * k}px`,
        `padding:${(n.padding || 0) * k}px`,
      );
      if (n.alignItems) s.push(`align-items:${n.alignItems}`);
      if (n.justifyContent) s.push(`justify-content:${n.justifyContent}`);
    }
    if (n.type === "text")
      s.push(
        `font:${n.fontWeight || 400} ${n.fontSize * k}px/1.25 ${n.fontFamily}`,
        `color:${n.color}`,
        `text-align:${n.textAlign || "left"}`,
        "white-space:normal",
        "margin:0",
      );
    return s.join(";");
  }

  /** Builds the DOM subtree of node i. `els[i]` receives every element. */
  function buildDom(scene, i, images, els, opt = {}) {
    const n = scene.nodes[i],
      el = document.createElement("div");
    el.className = "layer";
    el.dataset.id = n.id;
    el.style.cssText = nodeCss(
      scene,
      i,
      images,
      opt.root === i ? { ...opt, left: opt.rootLeft, top: opt.rootTop } : opt,
    );
    if (n.type === "text") el.innerHTML = textHtml(n);
    for (const c of scene.children[i]) el.appendChild(buildDom(scene, c, images, els, opt));
    if (els) els[i] = el;
    return el;
  }

  /** Uniform grid over world rects. */
  class Grid {
    constructor(cell = 4096) {
      this.cell = cell;
      this.map = new Map();
    }
    key(cx, cy) {
      return cx * 100003 + cy;
    }
    insert(id, r) {
      const c = this.cell;
      for (let cx = Math.floor(r.x / c); cx <= Math.floor((r.x + r.w) / c); cx++)
        for (let cy = Math.floor(r.y / c); cy <= Math.floor((r.y + r.h) / c); cy++) {
          const k = this.key(cx, cy);
          let b = this.map.get(k);
          if (!b) this.map.set(k, (b = []));
          b.push(id);
        }
    }
    query(r) {
      const c = this.cell,
        out = new Set();
      for (let cx = Math.floor(r.x / c); cx <= Math.floor((r.x + r.w) / c); cx++)
        for (let cy = Math.floor(r.y / c); cy <= Math.floor((r.y + r.h) / c); cy++) {
          const b = this.map.get(this.key(cx, cy));
          if (b) for (const id of b) out.add(id);
        }
      return out;
    }
  }
  function rootGrid(scene) {
    const g = new Grid(4096);
    for (const i of scene.roots) g.insert(i, scene.abs[i]);
    return g;
  }
  const intersects = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  /** World rect visible through a camera {x, y, zoom} (screen = world * zoom + cam). */
  const viewRect = (cam, vw, vh, margin = 0) => ({
    x: (-cam.x - margin) / cam.zoom,
    y: (-cam.y - margin) / cam.zoom,
    w: (vw + 2 * margin) / cam.zoom,
    h: (vh + 2 * margin) / cam.zoom,
  });

  /**
   * DOM layout host: real CSS layout for artboards, built lazily, never painted (visibility:hidden).
   * measure(root) returns world rects for every node plus word boxes for text, read from the browser.
   */
  class LayoutHost {
    constructor(scene, images) {
      this.scene = scene;
      this.images = images;
      this.els = Array.from({ length: scene.nodes.length });
      this.built = new Set();
      this.el = document.createElement("div");
      this.el.style.cssText =
        "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;overflow:visible;z-index:-1";
      document.body.appendChild(this.el);
    }
    build(root) {
      if (this.built.has(root)) return;
      const a = this.scene.abs[root];
      const el = buildDom(this.scene, root, this.images, this.els, {
        root,
        rootLeft: a.x,
        rootTop: a.y,
      });
      el.style.contain = "layout paint style";
      this.el.appendChild(el);
      this.built.add(root);
    }
    /** Re-applies one node's CSS/text after an edit. */
    patch(i) {
      const el = this.els[i];
      if (!el) return;
      const n = this.scene.nodes[i],
        a = this.scene.parent[i] < 0 ? this.scene.abs[i] : null;
      el.style.cssText = nodeCss(this.scene, i, this.images, a ? { left: a.x, top: a.y } : {});
      el.style.visibility = "";
      if (n.type === "text") el.innerHTML = textHtml(n);
    }
    measureNode(i, out) {
      const el = this.els[i],
        r = el.getBoundingClientRect(),
        n = this.scene.nodes[i];
      out.abs[i] = { x: r.left, y: r.top, w: r.width, h: r.height };
      if (n.type === "text") out.words[i] = this.words(i, el, r);
    }
    measure(root) {
      this.build(root);
      const out = { abs: this.scene.abs, words: this.wordsCache || (this.wordsCache = []) };
      const stack = [root];
      while (stack.length) {
        const i = stack.pop();
        this.measureNode(i, out);
        stack.push(...this.scene.children[i]);
      }
      return out;
    }
    /** Word boxes relative to the text element: {text, x, y, w, h, seg}. */
    words(i, el, box) {
      const n = this.scene.nodes[i],
        segs = segments(n),
        out = [],
        range = document.createRange();
      // Text nodes appear in segment order (plain text nodes and <span> runs).
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let si = 0;
      for (let t = walker.nextNode(); t; t = walker.nextNode(), si++) {
        const seg = segs[si] || segs[segs.length - 1],
          s = t.data,
          re = /\S+/g;
        for (let m; (m = re.exec(s));) {
          range.setStart(t, m.index);
          range.setEnd(t, m.index + m[0].length);
          const rects = range.getClientRects();
          // A word wider than the box can still split across lines; keep each fragment.
          if (rects.length === 1) {
            const r = rects[0];
            out.push({
              text: m[0],
              x: r.left - box.left,
              y: r.top - box.top,
              w: r.width,
              h: r.height,
              seg,
            });
          } else
            for (let c = 0; c < m[0].length; c++) {
              range.setStart(t, m.index + c);
              range.setEnd(t, m.index + c + 1);
              const r = range.getBoundingClientRect();
              out.push({
                text: m[0][c],
                x: r.left - box.left,
                y: r.top - box.top,
                w: r.width,
                h: r.height,
                seg,
              });
            }
        }
      }
      return out;
    }
    destroy() {
      this.el.remove();
    }
  }

  /** Full-document layout through the host (fidelity scene: flex layout for strategies without a CSS engine). */
  function resolveLayout(scene, images) {
    const host = new LayoutHost(scene, images);
    let words = [];
    for (const r of scene.roots) words = host.measure(r).words;
    scene.nodes.forEach((n, i) => {
      if (n.h === undefined) n.h = scene.abs[i].h;
    });
    host.destroy();
    return words;
  }

  // ---------- Canvas 2D painter ----------
  const metricsCache = new Map();
  function fontMetrics(ctx, font) {
    let m = metricsCache.get(font);
    if (!m) {
      ctx.font = font;
      const t = ctx.measureText("Hg");
      m = { a: t.fontBoundingBoxAscent, d: t.fontBoundingBoxDescent };
      metricsCache.set(font, m);
    }
    return m;
  }
  /** CSS-like greedy wrap with line-height 1.25 and per-run fonts. Returns lines of positioned pieces (unscaled px). */
  function layoutText(ctx, n) {
    const segs = segments(n),
      lines = [];
    const baseFont = segFont(n, { bold: false, italic: false, fontSize: n.fontSize });
    let line = { items: [], w: 0, trail: 0 };
    const pushLine = () => {
      lines.push(line);
      line = { items: [], w: 0, trail: 0 };
    };
    for (const seg of segs) {
      const font = segFont(n, seg);
      ctx.font = font;
      for (const tok of seg.text.match(/\S+\s*|\s+/g) || []) {
        const word = tok.trimEnd(),
          ww = ctx.measureText(word).width,
          tw = ctx.measureText(tok).width;
        if (line.items.length && word && line.w + ww > n.w + 0.01) pushLine();
        line.items.push({ text: tok, x: line.w, font, color: seg.color, fontSize: seg.fontSize });
        line.w += tw;
        line.trail = tw - ww;
      }
    }
    if (line.items.length || !lines.length) pushLine();
    // Line boxes: strut + inline boxes with half-leading, aligned on the baseline (CSS 2.1 §10.8).
    const strut = fontMetrics(ctx, baseFont),
      lh = (f) => f * 1.25;
    let y = 0;
    for (const l of lines) {
      let above = strut.a + (lh(n.fontSize) - strut.a - strut.d) / 2,
        below = strut.d + (lh(n.fontSize) - strut.a - strut.d) / 2;
      for (const it of l.items) {
        const m = fontMetrics(ctx, it.font),
          half = (lh(it.fontSize) - m.a - m.d) / 2;
        above = Math.max(above, m.a + half);
        below = Math.max(below, m.d + half);
      }
      l.baseline = y + above;
      y += above + below;
      const visible = l.w - l.trail;
      l.dx =
        n.textAlign === "center"
          ? (n.w - visible) / 2
          : n.textAlign === "right"
            ? n.w - visible
            : 0;
    }
    return lines;
  }
  const textCache = new WeakMap();
  function textLines(ctx, n) {
    let c = textCache.get(n);
    if (!c || c.text !== n.text || c.w !== n.w || c.runs !== n.textRuns)
      textCache.set(n, (c = { text: n.text, w: n.w, runs: n.textRuns, lines: layoutText(ctx, n) }));
    return c.lines;
  }

  function shapePath(ctx, n, x, y, w, h, inset = 0, begin = true) {
    if (begin) ctx.beginPath();
    if (n.ellipse)
      ctx.ellipse(
        x + w / 2,
        y + h / 2,
        Math.max(0, w / 2 - inset),
        Math.max(0, h / 2 - inset),
        0,
        0,
        Math.PI * 2,
      );
    else if (n.radius)
      ctx.roundRect(
        x + inset,
        y + inset,
        Math.max(0, w - 2 * inset),
        Math.max(0, h - 2 * inset),
        Math.max(0, n.radius - inset),
      );
    else ctx.rect(x + inset, y + inset, Math.max(0, w - 2 * inset), Math.max(0, h - 2 * inset));
  }
  function cssGradient(ctx, f, x, y, w, h) {
    const a = (f.angle * Math.PI) / 180,
      dx = Math.sin(a),
      dy = -Math.cos(a),
      len = Math.abs(w * dx) + Math.abs(h * dy);
    const cx = x + w / 2,
      cy = y + h / 2;
    const g = ctx.createLinearGradient(
      cx - (dx * len) / 2,
      cy - (dy * len) / 2,
      cx + (dx * len) / 2,
      cy + (dy * len) / 2,
    );
    for (const s of f.stops) g.addColorStop(s.position / 100, s.color);
    return g;
  }

  /**
   * Paints node i and its subtree. ctx carries the world → device transform; `ds` is device px per world px.
   * opts: {images, view (world rect to cull against), lod, skip (Set of lifted node indices), words (DOM word boxes)}
   */
  function paintTree(ctx, scene, i, ds, opts) {
    if (opts.skip?.has(i)) return;
    const n = scene.nodes[i],
      a = scene.abs[i];
    const pad = n.shadows ? 80 : 0;
    const vis =
      !opts.view ||
      intersects({ x: a.x - pad, y: a.y - pad, w: a.w + 2 * pad, h: a.h + 2 * pad }, opts.view);
    if (!vis && n.clipContent) return;
    ctx.save();
    if (vis) paintNode(ctx, scene, i, ds, opts);
    if (scene.children[i].length) {
      if (n.clipContent) {
        shapePath(ctx, n, a.x, a.y, a.w, a.h, n.strokeWidth || 0);
        ctx.clip();
      }
      for (const c of scene.children[i]) paintTree(ctx, scene, c, ds, opts);
    }
    ctx.restore();
  }
  const FAR = 20000; // device px: shadow casters are drawn this far away so only their shadow lands in view
  function paintNode(ctx, scene, i, ds, opts) {
    const n = scene.nodes[i],
      { x, y, w, h } = scene.abs[i],
      lod = opts.lod;
    if (n.shadows && !lod) {
      for (const s of n.shadows.slice().reverse()) {
        ctx.save();
        // Box shadows never show through the box itself: clip the shape out.
        ctx.beginPath();
        ctx.rect(x - 4000, y - 4000, w + 8000, h + 8000);
        shapePath(ctx, n, x, y, w, h, 0, false);
        ctx.clip("evenodd");
        const off = FAR / ds;
        ctx.shadowColor = s.color;
        ctx.shadowBlur = s.blur * ds;
        ctx.shadowOffsetX = s.x * ds + FAR;
        ctx.shadowOffsetY = s.y * ds;
        ctx.fillStyle = "#000";
        const grow = s.spread;
        shapePath(
          ctx,
          { ...n, radius: n.radius ? Math.max(0, n.radius + grow) : 0 },
          x - off - grow,
          y - grow,
          w + 2 * grow,
          h + 2 * grow,
        );
        ctx.fill();
        ctx.restore();
      }
    }
    const backdrop = !lod && n.filters?.find((f) => f.backdrop),
      blur = !lod && n.filters?.find((f) => !f.backdrop);
    if (backdrop) {
      ctx.save();
      shapePath(ctx, n, x, y, w, h);
      ctx.clip();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = `blur(${backdrop.value * ds}px)`;
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.restore();
    }
    if (blur) ctx.filter = `blur(${blur.value * ds}px)`;
    if (n.type === "image") {
      const im = opts.images[+n.src.slice(4)];
      ctx.save();
      shapePath(ctx, n, x, y, w, h);
      ctx.clip();
      const s = Math.max(w / im.w, h / im.h),
        sw = w / s,
        sh = h / s;
      ctx.drawImage(im.bitmap, (im.w - sw) / 2, (im.h - sh) / 2, sw, sh, x, y, w, h);
      ctx.restore();
    } else if (n.fills?.length || (n.color && n.type !== "text")) {
      ctx.fillStyle = n.fills?.length ? cssGradient(ctx, n.fills[0], x, y, w, h) : n.color;
      shapePath(ctx, n, x, y, w, h);
      ctx.fill();
    }
    if (blur) ctx.filter = "none";
    if (n.strokeWidth) {
      ctx.strokeStyle = n.strokeColor;
      ctx.lineWidth = n.strokeWidth;
      shapePath(ctx, n, x, y, w, h, n.strokeWidth / 2);
      ctx.stroke();
    }
    if (n.type === "text") paintText(ctx, scene, i, ds, opts);
  }
  function paintText(ctx, scene, i, ds, opts) {
    const n = scene.nodes[i],
      { x, y } = scene.abs[i];
    if (n.fontSize * ds < 3.5) {
      // level of detail: unreadable text becomes bars
      ctx.fillStyle = n.color;
      ctx.globalAlpha *= 0.35;
      for (const l of textLines(ctx, n))
        ctx.fillRect(x + l.dx, y + l.baseline - n.fontSize * 0.7, l.w - l.trail, n.fontSize * 0.6);
      return;
    }
    ctx.textBaseline = "alphabetic";
    const words = opts.words?.[i];
    if (words) {
      // DOM-measured word boxes (hybrid): only glyph drawing is ours
      for (const wd of words) {
        const font = segFont(n, wd.seg);
        ctx.font = font;
        ctx.fillStyle = wd.seg.color;
        ctx.fillText(wd.text, x + wd.x, y + wd.y + fontMetrics(ctx, font).a);
      }
      return;
    }
    for (const l of textLines(ctx, n))
      for (const it of l.items) {
        ctx.font = it.font;
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, x + l.dx + it.x, y + l.baseline);
      }
  }

  /** Visible-content bounds of a node including its shadow, used to dirty tiles. */
  function paintBounds(scene, i) {
    const a = scene.abs[i],
      n = scene.nodes[i];
    let pad = 2;
    for (const s of n.shadows || [])
      pad = Math.max(pad, s.blur * 1.5 + Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.spread));
    for (const f of n.filters || []) pad = Math.max(pad, f.value * 3);
    return { x: a.x - pad, y: a.y - pad, w: a.w + 2 * pad, h: a.h + 2 * pad };
  }
  /** Moves a subtree's world rects. */
  function translateTree(scene, i, dx, dy) {
    const stack = [i];
    while (stack.length) {
      const k = stack.pop();
      const a = scene.abs[k];
      a.x += dx;
      a.y += dy;
      stack.push(...scene.children[k]);
    }
  }

  window.PerfCommon = {
    makeImages,
    nodeCss,
    buildDom,
    textHtml,
    segments,
    segFont,
    Grid,
    rootGrid,
    intersects,
    viewRect,
    LayoutHost,
    resolveLayout,
    paintTree,
    layoutText,
    textLines,
    fontMetrics,
    shapePath,
    cssGradient,
    paintBounds,
    translateTree,
    shadowCss,
    gradientCss,
  };
})();
