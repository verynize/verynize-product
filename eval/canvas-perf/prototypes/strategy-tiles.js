// C. Tile-based Canvas 2D (Whimsical-style). The world is cut into 512×512 device-pixel tiles per power-of-two zoom
// level; tiles are painted with the shared Canvas 2D painter (CSS-like text layout via measureText) and cached (LRU).
// Each frame blits cached tiles to one screen canvas; missing tiles are painted within a time budget and covered by a
// scaled tile from a neighbouring level meanwhile (or left blank, counted as checkerboard). A dragged node is lifted
// out of the tiles and painted directly on the screen canvas. Text editing would use a DOM overlay (not exercised).
(function () {
  const C = window.PerfCommon;
  const TILE = 512,
    BUDGET = 8,
    MAX_TILES = 220;

  function tiles() {
    let scene,
      images,
      canvas,
      ctx,
      vw,
      vh,
      dpr,
      cam,
      grid,
      dirty = true;
    const cache = new Map(); // key → {canvas, level, tx, ty, used}
    let lifted = null,
      liftSkip = null,
      frameStats = { missing: 0, fallback: 0, total: 0 },
      painted = 0;
    const levelOf = (z) => Math.max(-8, Math.min(4, Math.ceil(Math.log2(z * 0.999))));
    const key = (l, tx, ty) => `${l}:${tx}:${ty}`;
    const tileWorld = (l) => TILE / (Math.pow(2, l) * dpr);

    function paintTile(l, tx, ty) {
      const s = Math.pow(2, l) * dpr,
        tw = tileWorld(l),
        x = tx * tw,
        y = ty * tw;
      let t = cache.get(key(l, tx, ty));
      if (!t) {
        if (cache.size >= MAX_TILES) evict();
        t = { canvas: new OffscreenCanvas(TILE, TILE), l, tx, ty, used: 0 };
        cache.set(key(l, tx, ty), t);
      }
      const g = t.canvas.getContext("2d");
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = "#f4f4f5";
      g.fillRect(0, 0, TILE, TILE);
      g.setTransform(s, 0, 0, s, -x * s, -y * s);
      const view = { x, y, w: tw, h: tw };
      for (const r of [...grid.query(view)].sort((a, b) => a - b))
        if (C.intersects(C.paintBounds(scene, r), view))
          C.paintTree(g, scene, r, s, { images, view, lod: s < 0.12, skip: liftSkip });
      t.stale = false;
      t.used = performance.now();
      painted++;
      return t;
    }
    function evict() {
      let oldest = null;
      for (const t of cache.values()) if (!oldest || t.used < oldest.used) oldest = t;
      if (oldest) cache.delete(key(oldest.l, oldest.tx, oldest.ty));
    }
    function visibleTiles(l) {
      const tw = tileWorld(l),
        v = C.viewRect(cam, vw, vh),
        out = [];
      for (let ty = Math.floor(v.y / tw); ty <= Math.floor((v.y + v.h) / tw); ty++)
        for (let tx = Math.floor(v.x / tw); tx <= Math.floor((v.x + v.w) / tw); tx++)
          out.push([tx, ty]);
      return out;
    }
    function blit(t, l, tx, ty) {
      const tw = tileWorld(l),
        k = cam.zoom * dpr;
      // Snap to device pixels so tiles meet without seams.
      const x0 = Math.round((tx * tw * cam.zoom + cam.x) * dpr),
        y0 = Math.round((ty * tw * cam.zoom + cam.y) * dpr);
      const x1 = Math.round(((tx + 1) * tw * cam.zoom + cam.x) * dpr),
        y1 = Math.round(((ty + 1) * tw * cam.zoom + cam.y) * dpr);
      void k;
      ctx.drawImage(t.canvas, x0, y0, x1 - x0, y1 - y0);
    }
    /** A cached tile from another level that covers (l, tx, ty): coarser parents first, then finer children. */
    function fallback(l, tx, ty) {
      for (let d = 1; d <= 3; d++) {
        const f = Math.pow(2, d),
          p = cache.get(key(l - d, Math.floor(tx / f), Math.floor(ty / f)));
        if (p && !p.stale) {
          const tw = tileWorld(l - d),
            sub = TILE / f,
            sx = (tx - Math.floor(tx / f) * f) * sub,
            sy = (ty - Math.floor(ty / f) * f) * sub;
          const twl = tileWorld(l);
          const x0 = Math.round((tx * twl * cam.zoom + cam.x) * dpr),
            y0 = Math.round((ty * twl * cam.zoom + cam.y) * dpr);
          const x1 = Math.round(((tx + 1) * twl * cam.zoom + cam.x) * dpr),
            y1 = Math.round(((ty + 1) * twl * cam.zoom + cam.y) * dpr);
          void tw;
          ctx.drawImage(p.canvas, sx, sy, sub, sub, x0, y0, x1 - x0, y1 - y0);
          return true;
        }
      }
      const c = cache.get(key(l + 1, tx * 2, ty * 2));
      if (c && !c.stale) {
        // finer level: draw its four children if present
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const t = cache.get(key(l + 1, tx * 2 + dx, ty * 2 + dy));
            if (t) blit(t, l + 1, tx * 2 + dx, ty * 2 + dy);
          }
        return true;
      }
      return false;
    }
    function draw(budget) {
      const l = levelOf(cam.zoom),
        list = visibleTiles(l),
        t0 = performance.now();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#f4f4f5";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = "medium";
      const cx = (-cam.x + vw / 2) / cam.zoom,
        cy = (-cam.y + vh / 2) / cam.zoom,
        tw = tileWorld(l);
      list.sort(
        (a, b) =>
          Math.hypot(a[0] * tw - cx, a[1] * tw - cy) - Math.hypot(b[0] * tw - cx, b[1] * tw - cy),
      );
      let missing = 0,
        fb = 0;
      for (const [tx, ty] of list) {
        let t = cache.get(key(l, tx, ty));
        if ((!t || t.stale) && (budget === Infinity || performance.now() - t0 < budget))
          t = paintTile(l, tx, ty);
        if (t && !t.stale) {
          t.used = performance.now();
          blit(t, l, tx, ty);
        } else if (t && t.stale) {
          blit(t, l, tx, ty);
          fb++;
        } else if (fallback(l, tx, ty)) fb++;
        else missing++;
      }
      if (lifted !== null) {
        // dragged subtree, painted live on top
        const s = cam.zoom * dpr;
        ctx.setTransform(s, 0, 0, s, cam.x * dpr, cam.y * dpr);
        C.paintTree(ctx, scene, lifted, s, { images, lod: s < 0.12 });
      }
      frameStats = { missing, fallback: fb, total: list.length };
      dirty = missing > 0 || fb > 0;
    }
    /** Marks cached tiles covering a world rect stale (all levels). */
    function invalidate(rect) {
      for (const t of cache.values()) {
        const tw = tileWorld(t.l);
        if (C.intersects(rect, { x: t.tx * tw, y: t.ty * tw, w: tw, h: tw })) t.stale = true;
      }
      dirty = true;
    }
    const subtreeBounds = (i) => {
      let b = C.paintBounds(scene, i);
      for (const c of scene.children[i]) {
        const k = subtreeBounds(c);
        const x = Math.min(b.x, k.x),
          y = Math.min(b.y, k.y);
        b = { x, y, w: Math.max(b.x + b.w, k.x + k.w) - x, h: Math.max(b.y + b.h, k.y + k.h) - y };
      }
      return b;
    };

    return {
      name: "C",
      label: "Tile-based Canvas 2D (tile cache per zoom level, budgeted painting)",
      async init(host, s, imgs, opts) {
        scene = s;
        images = imgs;
        vw = host.clientWidth;
        vh = host.clientHeight;
        dpr = devicePixelRatio;
        grid = C.rootGrid(s);
        canvas = document.createElement("canvas");
        canvas.width = vw * dpr;
        canvas.height = vh * dpr;
        canvas.style.cssText = `position:absolute;left:0;top:0;width:${vw}px;height:${vh}px`;
        host.appendChild(canvas);
        ctx = canvas.getContext("2d", { alpha: false });
        cam = { ...opts.cam };
        draw(Infinity); // first frame complete, no placeholders
      },
      frame(c) {
        const moved = !cam || c.x !== cam.x || c.y !== cam.y || c.zoom !== cam.zoom;
        cam = { ...c };
        if (moved || dirty) draw(BUDGET);
      },
      edit(i) {
        invalidate(subtreeBounds(i));
        this.repaintNow = true;
        draw(Infinity);
      },
      dragStart(i) {
        lifted = i;
        liftSkip = new Set([i]);
        invalidate(subtreeBounds(i));
        draw(Infinity);
      },
      dragMove() {
        draw(BUDGET);
      },
      dragEnd(i) {
        lifted = null;
        liftSkip = null;
        invalidate(subtreeBounds(i));
        draw(Infinity);
      },
      pending: () => frameStats.missing + frameStats.fallback,
      frameStats: () => frameStats,
      stats: () => ({
        tiles: cache.size,
        tilesPainted: painted,
        gpuEstimateBytes: cache.size * TILE * TILE * 4 + canvas.width * canvas.height * 4,
      }),
    };
  }
  window.PerfStrategies = Object.assign(window.PerfStrategies || {}, { C: tiles });
})();
