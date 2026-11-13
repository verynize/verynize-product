/* Experimental overview renderer. Original implementation; no upstream renderer code.
 * Enable before reload: localStorage.setItem('verynize.canvasTiles', '1').
 * The default path installs no listeners, subscriptions, DOM, or caches.
 */
(() => {
  "use strict";
  try {
    if (localStorage.getItem("verynize.canvasTiles") !== "1") return;
  } catch {
    return;
  }
  const SIZE = 512,
    LIMIT = 96,
    BUDGET = 4,
    THRESHOLD = 0.25;
  const cache = new Map(),
    images = new Map();
  let scene = [],
    previous = new Map(),
    pageId,
    tokens = "",
    cam,
    surface,
    context;
  let active = false,
    raf = 0,
    timer = 0,
    lastZoom,
    revision = 0,
    started = 0;
  let metrics = { blank: 1, scaled: 0, exact: 0, refinedMs: null };
  let invalidated = 0;
  let cameraAt = 0;
  const overlap = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const bounds = (t) => ({ x: t.x * t.world, y: t.y * t.world, w: t.world, h: t.world });
  function damage(rect) {
    for (const [key, tile] of cache)
      if (overlap(rect, bounds(tile))) {
        cache.delete(key);
        invalidated++;
      }
  }
  function stop() {
    active = false;
    cancelAnimationFrame(raf);
    raf = 0;
    document.getElementById("canvas")?.classList.remove("tile-overview");
    if (surface) surface.hidden = true;
  }
  function schedule() {
    if (active && !raf) raf = requestAnimationFrame(draw);
  }
  function sync(doc) {
    // Public subscriptions supply a snapshot after layout. Read auto-layout boxes once here,
    // never from the camera hook or once per tile.
    const page = doc.pages.find((p) => p.id === doc.activePage);
    if (!page) {
      stop();
      return;
    }
    revision++;
    const tokenKey = JSON.stringify(doc.tokens);
    if (pageId !== page.id || tokens !== tokenKey) {
      cache.clear();
      previous.clear();
    }
    pageId = page.id;
    tokens = tokenKey;
    const children = new Map();
    for (const n of page.nodes) {
      const key = n.parentId || null;
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(n);
    }
    for (const siblings of children.values())
      siblings.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
    const next = new Map();
    scene = [];
    const camera = window.design.getCamera();
    let viewport;
    const elements = new Map(
      [...document.querySelectorAll("#canvas [data-id]")].map((el) => [el.dataset.id, el]),
    );
    function visit(n, parent, clips, inheritedAuto, opacity) {
      if (n.hidden) return;
      let box = { x: (parent?.x || 0) + n.x, y: (parent?.y || 0) + n.y, w: n.w, h: n.h };
      const auto =
        inheritedAuto ||
        (n.layout && n.layout !== "free") ||
        (n.wMode && n.wMode !== "fixed") ||
        (n.hMode && n.hMode !== "fixed") ||
        n.wPct !== undefined ||
        n.hPct !== undefined ||
        !!n.constraints;
      if (auto) {
        const el = elements.get(n.id);
        if (el) {
          viewport ||= document.getElementById("canvas-wrap").getBoundingClientRect();
          const r = el.getBoundingClientRect();
          box = {
            x: (r.left - viewport.left - camera.x) / camera.zoom,
            y: (r.top - viewport.top - camera.y) / camera.zoom,
            w: r.width / camera.zoom,
            h: r.height / camera.zoom,
          };
        }
      }
      const item = {
        n,
        ...box,
        clips,
        opacity: opacity * ((n.opacity ?? 100) / 100),
        color: doc.tokens?.[n.token] || n.color || "transparent",
      };
      // Conservative effect padding; invalidation covers old and new bounds.
      const pad = Math.max(
        2,
        ...(n.shadows || []).map(
          (s) => Math.abs(s.x || 0) + Math.abs(s.y || 0) + (s.blur || 0) * 3 + (s.spread || 0),
        ),
      );
      item.damage = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
      item.key = JSON.stringify([n, box, clips, item.opacity]);
      next.set(n.id, item);
      scene.push(item);
      const childClips = n.clipContent ? [...clips, { ...box, radius: n.radius || 0 }] : clips;
      for (const child of children.get(n.id) || [])
        visit(child, box, childClips, auto, item.opacity);
    }
    for (const n of children.get(null) || []) visit(n, null, [], false, 1);
    for (const [id, old] of previous) if (next.get(id)?.key !== old.key) damage(old.damage);
    for (const [id, item] of next) if (previous.get(id)?.key !== item.key) damage(item.damage);
    // Reordering changes paint order even when individual properties are identical.
    if ([...previous.keys()].join("\0") !== [...next.keys()].join("\0")) cache.clear();
    previous = next;
    if (active) {
      metrics = { blank: 1, scaled: 0, exact: 0, refinedMs: null };
      started = performance.now();
      schedule();
    }
  }
  function bitmap(src) {
    if (!src) return null;
    if (images.has(src)) return images.get(src);
    images.set(src, null);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 512 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      images.set(src, c);
      while (images.size > 64) images.delete(images.keys().next().value);
      cache.clear();
      metrics = { blank: 1, scaled: 0, exact: 0, refinedMs: null };
      schedule();
    };
    img.onerror = () => {
      images.delete(src);
      stop();
    };
    img.src = src;
    return null;
  }
  function paint(ctx, item, scale) {
    const { n, x, y, w, h } = item;
    ctx.save();
    ctx.globalAlpha = item.opacity;
    for (const clip of item.clips) {
      ctx.beginPath();
      ctx.roundRect(clip.x, clip.y, clip.w, clip.h, clip.radius || 0);
      ctx.clip();
    }
    ctx.fillStyle = item.color;
    if (n.type === "text") {
      // Keep LOD ink inside its damage box; overflow text remains a DOM detail.
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      const size = n.fontSize || 16,
        lineHeight = size * (Number(n.lineHeight) || 1.15);
      ctx.font = `${n.fontWeight || 400} ${size}px ${n.fontFamily || "system-ui"}`;
      ctx.textBaseline = "top";
      let yy = y,
        line = "";
      const flush = () => {
        const width = Math.min(w, ctx.measureText(line).width);
        const xx =
          x +
          (n.textAlign === "center" ? (w - width) / 2 : n.textAlign === "right" ? w - width : 0);
        if (size * scale < 4) ctx.fillRect(xx, yy + size * 0.25, width, size * 0.5);
        else ctx.fillText(line, xx, yy);
        yy += lineHeight;
        line = "";
      };
      for (const paragraph of String(n.text || "").split("\n")) {
        for (const word of paragraph.split(/\s+/)) {
          if (line && ctx.measureText(line + " " + word).width > w) flush();
          line += (line ? " " : "") + word;
        }
        flush();
      }
    } else {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, Math.min(n.radius || 0, w / 2, h / 2));
      const shadow = n.shadows?.find((s) => !s.hidden && !s.inset);
      if (shadow) {
        ctx.shadowColor = shadow.color || "#00000040";
        ctx.shadowBlur = Math.min(16, (shadow.blur || 0) * scale);
        ctx.shadowOffsetX = (shadow.x || 0) * scale;
        ctx.shadowOffsetY = (shadow.y || 0) * scale;
      }
      ctx.fill();
      ctx.shadowColor = "transparent";
      if (n.type === "image") {
        const image = bitmap(n.src);
        if (image) {
          ctx.save();
          ctx.clip();
          const ratio =
            n.objectFit === "cover"
              ? Math.max(w / image.width, h / image.height)
              : Math.min(w / image.width, h / image.height);
          const iw = n.objectFit === "fill" ? w : image.width * ratio,
            ih = n.objectFit === "fill" ? h : image.height * ratio;
          ctx.drawImage(image, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
          ctx.restore();
        }
      }
      if (n.strokeWidth && !n.strokeHidden) {
        ctx.lineWidth = n.strokeWidth;
        ctx.strokeStyle = n.strokeColor || "#000";
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function draw() {
    raf = 0;
    const canvas = document.getElementById("canvas");
    // Preserve CSS-only features and live DOM surfaces rather than silently flatten them.
    if (
      window.design.getSelection().length ||
      canvas.querySelector('[contenteditable="true"], iframe') ||
      scene.some(
        ({ n }) =>
          n.rotation ||
          n.flipX ||
          n.flipY ||
          n.gradient ||
          n.svgColor ||
          n.type === "shader" ||
          n.fills?.length ||
          n.filters?.length ||
          n.masks?.length ||
          n.shadow ||
          n.textRuns?.length,
      )
    ) {
      stop();
      return;
    }
    const wrap = document.getElementById("canvas-wrap"),
      dpr = devicePixelRatio;
    if (!surface) {
      surface = document.createElement("canvas");
      surface.id = "canvas-tiles";
      surface.setAttribute("aria-hidden", "true");
      surface.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:1";
      wrap.append(surface);
      context = surface.getContext("2d");
      const style = document.createElement("style");
      // Opacity retains hit testing and accessibility. Selection chrome is outside .layer.
      style.textContent = "#canvas.tile-overview > .layer { opacity:0 !important; }";
      document.head.append(style);
    }
    const width = Math.round(wrap.clientWidth * dpr),
      height = Math.round(wrap.clientHeight * dpr);
    if (surface.width !== width || surface.height !== height) {
      surface.width = width;
      surface.height = height;
      surface.style.width = wrap.clientWidth + "px";
      surface.style.height = wrap.clientHeight + "px";
    }
    surface.hidden = false;
    canvas.classList.add("tile-overview");
    context.clearRect(0, 0, width, height);
    const scale = 2 ** Math.floor(Math.log2(cam.zoom * dpr)),
      world = SIZE / scale;
    const view = {
      x: -cam.x / cam.zoom,
      y: -cam.y / cam.zoom,
      w: width / dpr / cam.zoom,
      h: height / dpr / cam.zoom,
    };
    const visibleCount =
      (Math.ceil((view.x + view.w) / world) - Math.floor(view.x / world)) *
      (Math.ceil((view.y + view.h) / world) - Math.floor(view.y / world));
    if (visibleCount > LIMIT) {
      stop();
      return;
    }
    const deadline = performance.now() + BUDGET;
    const areas = { blank: 0, scaled: 0, exact: 0 };
    for (let y = Math.floor(view.y / world); y < Math.ceil((view.y + view.h) / world); y++)
      for (let x = Math.floor(view.x / world); x < Math.ceil((view.x + view.w) / world); x++) {
        const key = `${scale}:${x}:${y}`;
        let tile = cache.get(key);
        if (!tile) {
          const c = document.createElement("canvas");
          c.width = c.height = SIZE + 4; // 2px gutter; crop at blit to prevent seams
          tile = { canvas: c, x, y, world, scale, cursor: 0, complete: false };
          cache.set(key, tile);
        }
        const rect = bounds(tile),
          ctx = tile.canvas.getContext("2d");
        ctx.setTransform(scale, 0, 0, scale, 2 - rect.x * scale, 2 - rect.y * scale);
        while (!tile.complete && performance.now() < deadline) {
          const item = scene[tile.cursor++];
          if (!item) {
            tile.complete = true;
            break;
          }
          if (overlap(item.damage, rect)) {
            if (item.n.type === "image" && item.n.src && !bitmap(item.n.src)) {
              tile.cursor--;
              break;
            }
            paint(ctx, item, scale);
          }
        }
        cache.delete(key);
        cache.set(key, tile);
        const area =
          Math.max(0, Math.min(rect.x + world, view.x + view.w) - Math.max(rect.x, view.x)) *
          Math.max(0, Math.min(rect.y + world, view.y + view.h) - Math.max(rect.y, view.y));
        let source = tile.complete ? tile : null;
        if (!source)
          source = [...cache.values()].find(
            (t) =>
              t.complete &&
              t.scale < scale &&
              t.x * t.world <= rect.x &&
              t.y * t.world <= rect.y &&
              (t.x + 1) * t.world >= rect.x + world &&
              (t.y + 1) * t.world >= rect.y + world,
          );
        const status = source === tile ? "exact" : source ? "scaled" : "blank";
        areas[status] += area;
        if (source) {
          const sx = 2 + (rect.x - source.x * source.world) * source.scale,
            sy = 2 + (rect.y - source.y * source.world) * source.scale;
          context.drawImage(
            source.canvas,
            sx,
            sy,
            world * source.scale,
            world * source.scale,
            (rect.x * cam.zoom + cam.x) * dpr,
            (rect.y * cam.zoom + cam.y) * dpr,
            world * cam.zoom * dpr,
            world * cam.zoom * dpr,
          );
        }
      }
    while (cache.size > LIMIT) cache.delete(cache.keys().next().value);
    for (const key of Object.keys(areas)) metrics[key] = areas[key] / (view.w * view.h);
    if (metrics.exact > 0.999999) metrics.refinedMs ??= performance.now() - cameraAt;
    else schedule();
  }
  window.canvasTiles = {
    camera(next) {
      const moved = !cam || cam.x !== next.x || cam.y !== next.y || cam.zoom !== next.zoom;
      if (moved) {
        cameraAt = performance.now();
        metrics = { blank: 1, scaled: 0, exact: 0, refinedMs: null };
      }
      const changed = lastZoom !== next.zoom;
      lastZoom = next.zoom;
      cam = { ...next };
      if (changed) metrics.refinedMs = null;
      if (next.zoom > THRESHOLD) {
        stop();
        return;
      }
      if (!changed && !active) return;
      if (!active) {
        started = performance.now();
        metrics.refinedMs = null;
      }
      active = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (metrics.exact > 0.999999 || performance.now() - started > 2000) stop();
        else {
          const finish = () => {
            if (!active) return;
            if (metrics.exact > 0.999999 || performance.now() - started > 2000) stop();
            else timer = setTimeout(finish, 50);
          };
          finish();
        }
      }, 220);
      schedule();
    },
    stats: () => ({
      ...metrics,
      active,
      revision,
      invalidated,
      tiles: cache.size,
      bytes: cache.size * (SIZE + 4) ** 2 * 4,
    }),
  };
  function init() {
    sync(window.design.getDocument());
    window.design.subscribe(sync);
    document.addEventListener("focusin", (e) => {
      if (e.target.isContentEditable) stop();
    });
    document.fonts?.addEventListener("loadingdone", () => {
      cache.clear();
      sync(window.design.getDocument());
    });
    window.addEventListener("resize", () => {
      cache.clear();
      stop();
    });
  }
  // Loaded immediately after app.js, whose public API is already initialized.
  init();
})();
