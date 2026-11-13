// D. PixiJS v8 (WebGL or WebGPU). Artboards are built lazily (time-budgeted) when they enter the viewport, culled with
//    the grid index, and replaced by generated thumbnail textures at far zoom. Shapes are Graphics (round rects,
//    gradients, inside strokes, texture fills for images), shadows are cached pre-blurred textures, clipping is a stencil
//    mask only where children reach the frame edge, text is BitmapText (dynamic SDF-less atlases, single style per node).
// E. Hybrid (migration-plan design): the same painter, but boxes and word positions come from a DOM layout host
//    (real CSS layout, lazily per artboard) and text is drawn per node into a cached canvas texture from the DOM word
//    boxes, re-rasterised when the zoom bucket changes.
(function () {
  const C = window.PerfCommon;
  const LOD = 0.08,
    BUDGET = 8,
    MAX_BOARDS = 320;

  function pixi(kind) {
    return () => {
      const P = window.PIXI;
      let app,
        scene,
        images,
        vw,
        vh,
        dpr,
        cam,
        grid,
        world,
        host = null,
        words = [],
        textures = [],
        shadowCache = new Map();
      const slots = new Map(); // root → {slot, board, thumb, placeholder, used}
      const objs = []; // node → display objects positioned in the parent container
      let visible = new Set(),
        buildQueue = [],
        thumbQueue = [],
        textBucket = 1,
        gpuBytes = 0,
        rendererName = "";
      const hybrid = kind === "E";

      const color = (c) => c; // Pixi parses #rrggbb and #rrggbbaa
      function shadowTexture(n) {
        const k = `${n.w}x${n.h}r${n.radius || 0}e${n.ellipse ? 1 : 0}|${JSON.stringify(n.shadows)}`;
        let t = shadowCache.get(k);
        if (!t) {
          let pad = 0;
          for (const s of n.shadows)
            pad = Math.max(pad, s.blur * 1.5 + Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.spread));
          pad = Math.ceil(pad);
          const res = 2,
            cv = new OffscreenCanvas(
              Math.ceil((n.w + 2 * pad) * res),
              Math.ceil((n.h + 2 * pad) * res),
            ),
            g = cv.getContext("2d");
          g.setTransform(res, 0, 0, res, pad * res, pad * res);
          const fake = {
            nodes: [
              {
                ...n,
                filters: undefined,
                fills: undefined,
                color: undefined,
                strokeWidth: 0,
                type: "rectangle",
              },
            ],
            abs: [{ x: 0, y: 0, w: n.w, h: n.h }],
            children: [[]],
          };
          C.paintTree(g, fake, 0, res, { images });
          t = { texture: P.Texture.from(cv), pad };
          shadowCache.set(k, t);
          gpuBytes += cv.width * cv.height * 4;
        }
        return t;
      }
      // Pixi 8.22 FillGradient reverses the ramp whenever the gradient line has dx < 0 or dy < 0 (including -0 from
      // cos(90°)), and texture fills are forced to `repeat` addressing. Gradients and cover-cropped images are therefore
      // pre-rendered into node-sized canvas textures (same math as the Canvas 2D painter) and filled 1:1.
      const fillCache = new Map();
      function canvasFill(key, w, h, draw) {
        let t = fillCache.get(key);
        if (!t) {
          const k = Math.min(2, 2048 / Math.max(w, h)),
            tw = Math.max(2, Math.ceil(w * k)),
            th = Math.max(2, Math.ceil(h * k));
          const cv = new OffscreenCanvas(tw, th),
            g = cv.getContext("2d");
          g.setTransform(tw / w, 0, 0, th / h, 0, 0);
          draw(g);
          t = { texture: P.Texture.from(cv), tw, th };
          fillCache.set(key, t);
          gpuBytes += tw * th * 4;
        }
        return {
          texture: t.texture,
          textureSpace: "global",
          matrix: new P.Matrix().scale(w / t.tw, h / t.th),
        };
      }
      const gradientFill = (f, w, h) =>
        canvasFill(`g${w}x${h}|${JSON.stringify(f)}`, w, h, (g) => {
          g.fillStyle = C.cssGradient(g, f, 0, 0, w, h);
          g.fillRect(0, 0, w, h);
        });
      const imageFill = (src, w, h) =>
        canvasFill(`i${w}x${h}|${src}`, w, h, (g) => {
          const im = images[+src.slice(4)],
            s = Math.max(w / im.w, h / im.h),
            sw = w / s,
            sh = h / s;
          g.drawImage(im.bitmap, (im.w - sw) / 2, (im.h - sh) / 2, sw, sh, 0, 0, w, h);
        });
      function shape(g, n, w, h) {
        if (n.ellipse) g.ellipse(w / 2, h / 2, w / 2, h / 2);
        else if (n.radius) g.roundRect(0, 0, w, h, Math.min(n.radius, w / 2, h / 2));
        else g.rect(0, 0, w, h);
      }
      const fonts = new Set();
      function bitmapFont(n) {
        const name = `bm-${n.fontWeight || 400}`;
        if (!fonts.has(name)) {
          // Installed in white and tinted per node, so colours do not multiply atlases.
          P.BitmapFont.install({
            name,
            style: {
              fontFamily: n.fontFamily,
              fontWeight: String(n.fontWeight || 400),
              fontSize: 40,
              fill: "#ffffff",
            },
            chars: [[" ", "~"], "©→🎨…"],
            resolution: 2,
          });
          fonts.add(name);
        }
        return name;
      }
      function bitmapText(n, w) {
        // One style per node: runs (colour, italic, size) are not representable in a single BitmapText.
        const t = new P.BitmapText({
          text: n.text,
          style: {
            fontFamily: bitmapFont(n),
            fontSize: n.fontSize,
            wordWrap: true,
            wordWrapWidth: w,
            lineHeight: n.fontSize * 1.25,
            align: n.textAlign || "left",
          },
        });
        t.tint = n.color;
        if (n.textAlign === "center" || n.textAlign === "right") {
          const out = new P.Container();
          out.addChild(t);
          t.x = Math.max(0, n.textAlign === "center" ? (w - t.width) / 2 : w - t.width);
          return out;
        }
        return t;
      }
      function domText(i, n, w, h) {
        const res = dpr * textBucket,
          cv = new OffscreenCanvas(
            Math.max(1, Math.ceil(w * res)),
            Math.max(1, Math.ceil(h * res)),
          ),
          g = cv.getContext("2d");
        g.setTransform(res, 0, 0, res, 0, 0);
        const fake = { nodes: [n], abs: [{ x: 0, y: 0, w, h }], children: [[]] };
        C.paintTree(g, fake, 0, res, { images, words: [words[i]] });
        const sp = new P.Sprite(P.Texture.from(cv));
        sp.width = w;
        sp.height = h;
        sp.__bytes = cv.width * cv.height * 4;
        gpuBytes += sp.__bytes;
        return sp;
      }
      /** Display objects for node i, positioned relative to (ox, oy) world, appended to parent. */
      function addNode(parent, i, ox, oy) {
        const n = scene.nodes[i],
          a = scene.abs[i],
          x = a.x - ox,
          y = a.y - oy,
          list = [];
        const kids = scene.children[i];
        const target = kids.length ? new P.Container() : parent;
        const lx = kids.length ? 0 : x,
          ly = kids.length ? 0 : y;
        if (kids.length) {
          target.x = x;
          target.y = y;
          parent.addChild(target);
          list.push(target);
        }
        if (n.shadows) {
          const s = shadowTexture({ ...n, w: a.w, h: a.h }),
            sp = new P.Sprite(s.texture);
          sp.x = lx - s.pad;
          sp.y = ly - s.pad;
          sp.width = a.w + 2 * s.pad;
          sp.height = a.h + 2 * s.pad;
          target.addChild(sp);
          if (!kids.length) list.push(sp);
        }
        const hasFill = n.type === "image" || n.fills?.length || (n.color && n.type !== "text");
        if (hasFill || n.strokeWidth) {
          const g = new P.Graphics();
          g.x = lx;
          g.y = ly;
          if (n.type === "image") {
            shape(g, n, a.w, a.h);
            g.fill(imageFill(n.src, a.w, a.h));
          } else if (n.fills?.length) {
            shape(g, n, a.w, a.h);
            g.fill(gradientFill(n.fills[0], a.w, a.h));
          } else if (n.color && n.type !== "text") {
            shape(g, n, a.w, a.h);
            g.fill(color(n.color));
          }
          if (n.strokeWidth) {
            shape(g, n, a.w, a.h);
            g.stroke({ width: n.strokeWidth, color: n.strokeColor, alignment: 1 });
          }
          // Layer blur only; backdrop-filter has no core Pixi equivalent (translucent fill kept, blur lost).
          const blur = n.filters?.find((f) => !f.backdrop);
          if (blur) g.filters = [new P.BlurFilter({ strength: blur.value })];
          target.addChild(g);
          if (!kids.length) list.push(g);
        }
        if (n.type === "text") {
          const t = hybrid ? domText(i, n, a.w, a.h) : bitmapText(n, a.w);
          t.x = lx;
          t.y = ly;
          target.addChild(t);
          if (!kids.length) list.push(t);
        }
        if (kids.length) {
          let inner = target;
          // Stencil clip only where a child touches the frame edge (otherwise clipping is a no-op).
          if (
            n.clipContent &&
            kids.some((c) => {
              const b = C.paintBounds(scene, c);
              return (
                b.x < a.x + (n.radius || 0) ||
                b.y < a.y + (n.radius || 0) ||
                b.x + b.w > a.x + a.w - (n.radius || 0) ||
                b.y + b.h > a.y + a.h - (n.radius || 0)
              );
            })
          ) {
            inner = new P.Container();
            const m = new P.Graphics();
            shape(m, n, a.w, a.h);
            m.fill(0xffffff);
            inner.addChild(m);
            inner.mask = m;
            target.addChild(inner);
          }
          for (const c of kids) addNode(inner, c, a.x, a.y);
        }
        objs[i] = list;
      }
      function buildBoard(r) {
        if (hybrid) words = host.measure(r).words;
        const c = new P.Container();
        c.x = 0;
        c.y = 0;
        addNode(c, r, 0, 0);
        return c;
      }
      function slot(r) {
        let s = slots.get(r);
        if (!s) {
          const a = scene.abs[r],
            root = new P.Container(),
            ph = new P.Graphics().rect(a.x, a.y, a.w, a.h).fill(scene.nodes[r].color || "#ffffff");
          root.addChild(ph);
          world.addChild(root);
          s = { root, placeholder: ph, board: null, thumb: null, used: 0 };
          slots.set(r, s);
        }
        return s;
      }
      function makeThumb(r) {
        const s = slot(r),
          a = scene.abs[r];
        if (!s.board) {
          s.board = buildBoard(r);
          s.root.addChild(s.board);
        }
        s.board.visible = true;
        const tex = app.renderer.generateTexture({
          target: s.board,
          frame: new P.Rectangle(a.x, a.y, a.w, a.h),
          resolution: LOD * dpr,
        });
        const sp = new P.Sprite(tex);
        sp.x = a.x;
        sp.y = a.y;
        sp.width = a.w;
        sp.height = a.h;
        s.thumb = sp;
        s.root.addChild(sp);
        gpuBytes += tex.source.pixelWidth * tex.source.pixelHeight * 4;
      }
      function evictBoards() {
        const built = [...slots.entries()].filter(([, s]) => s.board);
        if (built.length <= MAX_BOARDS) return;
        built.sort((x, y) => x[1].used - y[1].used);
        for (const [r, s] of built.slice(0, built.length - MAX_BOARDS))
          if (!visible.has(r)) {
            s.board.destroy({ children: true });
            s.board = null;
          }
      }
      function update(budget) {
        const far = cam.zoom < LOD,
          want = grid.query(C.viewRect(cam, vw, vh, 64));
        for (const r of visible) if (!want.has(r)) slots.get(r).root.visible = false;
        const now = performance.now();
        for (const r of want) {
          const s = slot(r);
          s.root.visible = true;
          s.used = now;
          if (far && !s.thumb) thumbQueue.push(r);
          else if (!far && !s.board) buildQueue.push(r);
        }
        visible = want;
        const t0 = performance.now();
        const q = far ? thumbQueue : buildQueue;
        while (q.length && (budget === Infinity || performance.now() - t0 < budget)) {
          const r = q.shift(),
            s = slots.get(r);
          if (!visible.has(r)) continue;
          if (far) {
            if (!s.thumb) makeThumb(r);
          } else if (!s.board) {
            s.board = buildBoard(r);
            s.root.addChild(s.board);
          }
        }
        let missing = 0;
        for (const r of visible) {
          const s = slots.get(r);
          if (s.board) s.board.visible = !far || !s.thumb;
          if (s.thumb) s.thumb.visible = far;
          s.placeholder.visible = far ? !s.thumb : !s.board;
          if (s.placeholder.visible) missing++;
        }
        if (!far) thumbQueue = [];
        else buildQueue = [];
        evictBoards();
        frameStats = { missing, total: visible.size };
      }
      let frameStats = { missing: 0, total: 0 };
      function render() {
        world.x = cam.x;
        world.y = cam.y;
        world.scale.set(cam.zoom);
        app.renderer.render(app.stage);
      }
      function rebuildNode(i) {
        const list = objs[i];
        if (!list?.length) return;
        const parent = list[0].parent,
          at = parent.getChildIndex(list[0]);
        const p = scene.parent[i],
          ox = p >= 0 ? scene.abs[p].x : 0,
          oy = p >= 0 ? scene.abs[p].y : 0;
        for (const o of list) o.destroy({ children: true });
        const tmp = new P.Container();
        addNode(tmp, i, ox, oy);
        const fresh = [...tmp.children];
        fresh.forEach((o, k) => parent.addChildAt(o, at + k));
        objs[i] = fresh;
      }
      return {
        name: kind,
        label: hybrid
          ? "Hybrid: DOM layout host + PixiJS painter (DOM word boxes → text textures)"
          : "PixiJS v8 GPU (BitmapText, culling, thumbnails)",
        async init(hostEl, s, imgs, opts) {
          scene = s;
          images = imgs;
          vw = hostEl.clientWidth;
          vh = hostEl.clientHeight;
          dpr = devicePixelRatio;
          grid = C.rootGrid(s);
          app = new P.Application();
          await app.init({
            width: vw,
            height: vh,
            resolution: dpr,
            autoDensity: true,
            antialias: true,
            background: "#f4f4f5",
            preference: opts.preference || "webgl",
            autoStart: false,
            sharedTicker: false,
          });
          rendererName = app.renderer.name || (app.renderer.type === 2 ? "webgpu" : "webgl");
          hostEl.appendChild(app.canvas);
          textures = images.map((im) => P.Texture.from(im.bitmap));
          world = new P.Container();
          app.stage.addChild(world);
          if (hybrid) host = opts.layoutHost || new C.LayoutHost(s, images);
          cam = { ...opts.cam };
          textBucket = Math.pow(2, Math.max(-2, Math.min(1, Math.ceil(Math.log2(cam.zoom)))));
          update(Infinity);
          render();
        },
        frame(c) {
          const moved = !cam || c.x !== cam.x || c.y !== cam.y || c.zoom !== cam.zoom;
          cam = { ...c };
          if (moved || buildQueue.length || thumbQueue.length || this.dirty) {
            update(BUDGET);
            render();
            this.dirty = false;
          }
        },
        edit(i) {
          if (hybrid) {
            host.patch(i);
            words = host.measure(scene.rootOf[i]).words;
          }
          rebuildNode(i);
          const s = slots.get(scene.rootOf[i]);
          if (s?.thumb) {
            s.thumb.destroy();
            s.thumb = null;
          }
          this.dirty = true;
        },
        dragMove(i, dx, dy) {
          for (const o of objs[i] || []) {
            o.x += dx;
            o.y += dy;
          }
          this.dirty = true;
        },
        pending: () => buildQueue.length + thumbQueue.length + frameStats.missing,
        frameStats: () => frameStats,
        renderer: () => rendererName,
        stats: () => ({
          renderer: rendererName,
          builtBoards: [...slots.values()].filter((s) => s.board).length,
          thumbs: [...slots.values()].filter((s) => s.thumb).length,
          gpuEstimateBytes:
            gpuBytes +
            vw * vh * dpr * dpr * 4 * 2 +
            textures.reduce((s, t) => s + t.source.pixelWidth * t.source.pixelHeight * 4, 0),
        }),
      };
    };
  }
  window.PerfStrategies = Object.assign(window.PerfStrategies || {}, {
    D: pixi("D"),
    E: pixi("E"),
  });
})();
