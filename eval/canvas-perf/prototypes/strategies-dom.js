// DOM strategies.
//  A  naive:     nested divs in screen space; every camera change rewrites every node's style (left/top/size/font/...).
//  A2 current:   what web/canvas-interactions.js + web/app.js do today: world-space nested divs, one container
//                transform, `--iz` custom property written on every camera change, will-change only while panning,
//                and every edit/drag move rebuilds the whole canvas DOM (render() → layerElement → createElement).
//  B  optimized: world-space divs under one container transform; artboards mounted only when near the viewport
//                (grid index), `contain: strict` per artboard, keyed per-node patches for edits and drags,
//                will-change during gestures (the compositor scales the cached raster), canvas thumbnails at far zoom.
(function () {
  const C = window.PerfCommon;
  const sameCam = (a, b) => a && a.x === b.x && a.y === b.y && a.zoom === b.zoom;

  function naive() {
    let scene, images, root, els, cam;
    const css = (i, z, cx, cy) => {
      const isRoot = scene.parent[i] < 0;
      // Absolute children are placed from the parent's padding box (inside its border).
      const p = scene.parent[i],
        bw = p >= 0 ? scene.nodes[p].strokeWidth || 0 : 0;
      return C.nodeCss(scene, i, images, {
        k: z,
        flex: false,
        left: isRoot ? scene.abs[i].x + cx / z : scene.abs[i].x - scene.abs[p].x - bw,
        top: isRoot ? scene.abs[i].y + cy / z : scene.abs[i].y - scene.abs[p].y - bw,
      });
    };
    function build(i) {
      const n = scene.nodes[i],
        el = document.createElement("div");
      el.style.cssText = css(i, cam.zoom, cam.x, cam.y);
      if (n.type === "text") el.innerHTML = C.textHtml(n);
      for (const c of scene.children[i]) el.appendChild(build(c));
      els[i] = el;
      return el;
    }
    return {
      name: "A",
      label: "Naive DOM (per-node screen-space styles)",
      async init(host, s, imgs, opts) {
        scene = s;
        images = imgs;
        cam = { ...opts.cam };
        els = Array.from({ length: s.nodes.length });
        root = document.createElement("div");
        root.style.cssText = "position:absolute;inset:0;overflow:hidden;background:#f4f4f5";
        for (const r of s.roots) root.appendChild(build(r));
        host.appendChild(root);
      },
      frame(c) {
        if (sameCam(cam, c)) return;
        cam = { ...c };
        for (let i = 0; i < els.length; i++) els[i].style.cssText = css(i, cam.zoom, cam.x, cam.y);
      },
      edit(i) {
        const n = scene.nodes[i];
        els[i].style.cssText = css(i, cam.zoom, cam.x, cam.y);
        if (n.type === "text") els[i].innerHTML = C.textHtml(n);
      },
      dragMove(i) {
        els[i].style.cssText = css(i, cam.zoom, cam.x, cam.y);
      },
      stats: () => ({ domNodes: document.getElementsByTagName("*").length }),
    };
  }

  function current() {
    let scene,
      images,
      canvas,
      cam,
      lastZoom = null,
      releaseTimer = 0,
      selected = -1;
    function render() {
      // mirrors web/app.js render(): a fresh element for every node, then replace the children
      const els = Array.from({ length: scene.nodes.length });
      const fresh = scene.roots.map((r) => {
        const a = scene.abs[r];
        return C.buildDom(scene, r, images, els, { root: r, rootLeft: a.x, rootTop: a.y });
      });
      if (selected >= 0) els[selected].classList.add("selected");
      canvas.replaceChildren(...fresh);
    }
    const release = () => {
      clearTimeout(releaseTimer);
      canvas.classList.remove("camera-moving");
    };
    return {
      name: "A2",
      label: "Current Verynize pattern (container transform, --iz, full rebuild on edit)",
      async init(host, s, imgs, opts) {
        scene = s;
        images = imgs;
        const style = document.createElement("style");
        style.textContent =
          "#a2canvas{--iz:1;position:absolute;left:0;top:0;transform-origin:0 0}#a2canvas.camera-moving{will-change:transform}" +
          "#a2canvas .layer.selected{outline:calc(1px * var(--iz)) solid #3b82f6;outline-offset:calc(-.5px * var(--iz))}";
        document.head.appendChild(style);
        const wrap = document.createElement("div");
        wrap.style.cssText = "position:absolute;inset:0;overflow:hidden;background:#f4f4f5";
        canvas = document.createElement("div");
        canvas.id = "a2canvas";
        wrap.appendChild(canvas);
        host.appendChild(wrap);
        selected = opts.selected ?? -1;
        render();
        this.frame(opts.cam);
      },
      frame(c) {
        // applyCamera()
        if (sameCam(cam, c)) return;
        cam = { ...c };
        canvas.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`;
        if (lastZoom !== cam.zoom) release();
        else {
          canvas.classList.add("camera-moving");
          clearTimeout(releaseTimer);
          releaseTimer = setTimeout(release, 160);
        }
        lastZoom = cam.zoom;
        canvas.style.setProperty("--iz", String(1 / cam.zoom));
      },
      edit() {
        render();
      },
      dragMove() {
        render();
      },
      stats: () => ({ domNodes: document.getElementsByTagName("*").length }),
    };
  }

  function optimized() {
    let scene,
      images,
      world,
      cam,
      grid,
      vw,
      vh,
      dpr,
      els,
      settleTimer = 0,
      far = false;
    const built = new Map(),
      mounted = new Map(),
      thumbs = new Map(),
      thumbQueue = [],
      buildQueue = new Set();
    const LOD = 0.08; // below this zoom an artboard is a canvas thumbnail
    const BUDGET = 6; // ms of progressive work (board builds, thumbnail paints) per frame
    function placeholder(r) {
      const a = scene.abs[r],
        el = document.createElement("div");
      el.style.cssText = `position:absolute;left:${a.x}px;top:${a.y}px;width:${a.w}px;height:${a.h}px;background:${scene.nodes[r].color || "#fff"};contain:strict`;
      return el;
    }
    function board(r) {
      const a = scene.abs[r],
        el = C.buildDom(scene, r, images, els, { root: r, rootLeft: a.x, rootTop: a.y });
      el.style.contain = "strict";
      built.set(r, el);
      return el;
    }
    function paintThumb(r) {
      const a = scene.abs[r],
        s = LOD * dpr,
        c = document.createElement("canvas");
      c.style.cssText = `position:absolute;left:${a.x}px;top:${a.y}px;width:${a.w}px;height:${a.h}px`;
      c.width = Math.ceil(a.w * s);
      c.height = Math.ceil(a.h * s);
      const ctx = c.getContext("2d");
      ctx.setTransform(s, 0, 0, s, -a.x * s, -a.y * s);
      C.paintTree(ctx, scene, r, s, { images, lod: true });
      thumbs.set(r, c);
      return c;
    }
    function mount(r, el) {
      const old = mounted.get(r);
      if (old === el) return;
      if (old) old.replaceWith(el);
      else world.appendChild(el);
      mounted.set(r, el);
    }
    function cull() {
      const nowFar = cam.zoom < LOD,
        want = grid.query(C.viewRect(cam, vw, vh, Math.max(vw, vh) * 0.5));
      if (nowFar !== far) {
        for (const el of mounted.values()) el.remove();
        mounted.clear();
        far = nowFar;
      }
      for (const [r, el] of mounted)
        if (!want.has(r)) {
          el.remove();
          mounted.delete(r);
        }
      for (const r of want)
        if (!mounted.has(r)) {
          const ready = far ? thumbs.get(r) : built.get(r);
          if (ready) mount(r, ready);
          else {
            mount(r, placeholder(r));
            if (far) thumbQueue.push(r);
            else buildQueue.add(r);
          }
        }
    }
    function progress() {
      const t0 = performance.now();
      while (performance.now() - t0 < BUDGET) {
        const r = far ? thumbQueue.shift() : buildQueue.values().next().value;
        if (r === undefined) break;
        if (!far) buildQueue.delete(r);
        if (!mounted.has(r)) continue;
        mount(r, far ? thumbs.get(r) || paintThumb(r) : built.get(r) || board(r));
      }
    }
    return {
      name: "B",
      label: "Optimized DOM (container transform, culling, contain, keyed patches, raster proxies)",
      async init(host, s, imgs, opts) {
        scene = s;
        images = imgs;
        vw = host.clientWidth;
        vh = host.clientHeight;
        dpr = devicePixelRatio;
        els = Array.from({ length: s.nodes.length });
        grid = C.rootGrid(s);
        const wrap = document.createElement("div");
        wrap.style.cssText = "position:absolute;inset:0;overflow:hidden;background:#f4f4f5";
        world = document.createElement("div");
        world.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0";
        wrap.appendChild(world);
        host.appendChild(wrap);
        cam = { ...opts.cam };
        world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`;
        // First frame: build what is visible synchronously (no placeholders on open).
        far = cam.zoom < LOD;
        for (const r of grid.query(C.viewRect(cam, vw, vh, 0)))
          mount(r, far ? paintThumb(r) : board(r));
        cull();
      },
      frame(c) {
        if (!sameCam(cam, c)) {
          cam = { ...c };
          world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`;
          world.style.willChange = "transform";
          clearTimeout(settleTimer);
          settleTimer = setTimeout(() => {
            world.style.willChange = "";
          }, 160);
          cull();
        }
        progress();
      },
      edit(i) {
        const n = scene.nodes[i],
          el = els[i];
        if (thumbs.has(scene.rootOf[i])) thumbs.delete(scene.rootOf[i]); // repainted on demand
        if (!el) return;
        const a = scene.parent[i] < 0 ? scene.abs[i] : null;
        el.style.cssText = C.nodeCss(scene, i, images, a ? { left: a.x, top: a.y } : {});
        if (n.type === "text") el.innerHTML = C.textHtml(n);
      },
      dragMove(i) {
        const el = els[i],
          n = scene.nodes[i];
        el.style.left = n.x + "px";
        el.style.top = n.y + "px";
      },
      pending: () =>
        [...mounted].filter(([r, el]) => el !== (far ? thumbs.get(r) : built.get(r))).length,
      stats: () => ({
        domNodes: document.getElementsByTagName("*").length,
        mountedBoards: mounted.size,
        builtBoards: built.size,
        thumbs: thumbs.size,
        gpuEstimateBytes: [...thumbs.values()].reduce((s, c) => s + c.width * c.height * 4, 0),
      }),
    };
  }

  window.PerfStrategies = Object.assign(window.PerfStrategies || {}, {
    A: naive,
    A2: current,
    B: optimized,
  });
})();
