"use strict";
// Verynize canvas engine: camera, tools, selection, smart guides, clipboard and the
// command/shortcut registry. Independent implementation; app.js passes its editor state in
// through BetterCanvas.install(editor) so this file never reaches into private globals.
(() => {
  const ZOOM_STOPS = [0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32];
  const MIN_ZOOM = ZOOM_STOPS[0],
    MAX_ZOOM = ZOOM_STOPS.at(-1);
  const SAFE = { top: 48, right: 40, bottom: 96, left: 40 };
  // Zoom to selection (⇧2) margins, measured in Wonder V3-selection (120×120 → 538 %: 64 px above and below inside the
  // 830 px tall view, minus the 56 px toolbar band) and V4-high-zoom (150×105 → 548 %: 29 px left and right).
  const SELECTION_SAFE = { top: 64, right: 29, bottom: 120, left: 29 };
  const BOARD = { x: 0, y: 0, w: 1000, h: 700 };
  const DRAW_TOOLS = new Set(["frame", "rectangle", "ellipse", "text", "shader"]);
  const TOOL_BUTTONS = {
    move: "select-tool",
    scale: "scale-tool",
    hand: "pan-tool",
    eyedropper: "eyedropper-tool",
    frame: "add-frame",
    rectangle: "rectangle",
    ellipse: "add-ellipse",
    text: "text",
    shader: "add-shader",
    pen: "pen-tool",
  };
  const STYLE_KEYS = [
    "color",
    "token",
    "gradient",
    "radius",
    "ellipse",
    "strokeWidth",
    "strokeColor",
    "shadow",
    "opacity",
    "fontSize",
    "fontFamily",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "textAlign",
    "textAlignVertical",
    "textTransform",
    "textDecoration",
    "textWrap",
    "whiteSpace",
    "wordBreak",
    "textIndent",
    "fontSmoothing",
    "truncate",
    "mask",
    "animated",
    "clipContent",
  ];
  const CLIP_MARKER = "verynize/nodes";
  // Wonder's frame tool presets (Properties panel with the Frame tool on and nothing selected): [category, [[name, w, h]]].
  const FRAME_PRESETS = [
    [
      "Phone",
      [
        ["iPhone 17", 402, 874],
        ["iPhone 18 Pro", 402, 874],
        ["iPhone Air", 420, 912],
        ["iPhone 18 Pro Max", 440, 956],
        ["iPhone Duo Folded", 466, 678],
        ["iPhone Duo Open", 626, 890],
      ],
    ],
    [
      "Tablet",
      [
        ['iPad Air 11"', 820, 1180],
        ['iPad Mini 8.3"', 744, 1133],
      ],
    ],
    [
      "Desktop",
      [
        ["MacBook Air", 1280, 832],
        ['MacBook Pro 14"', 1512, 982],
        ['MacBook Pro 16"', 1728, 1117],
        ["Desktop", 1920, 1080],
        ["TV", 3840, 2160],
      ],
    ],
    [
      "Presentation",
      [
        ["Slide 16:9", 1920, 1080],
        ["Slide 4:3", 1024, 768],
      ],
    ],
    [
      "Smartwatch",
      [
        ["Series 10 42mm", 198, 242],
        ["Series 10 46mm", 220, 268],
      ],
    ],
    [
      "Paper",
      [
        ["A4", 794, 1123],
        ["A5", 559, 794],
        ["A6", 397, 559],
      ],
    ],
    [
      "Social media",
      [
        ["OpenGraph", 1200, 630],
        ["X Post", 1200, 675],
        ["X Header", 1500, 500],
        ["Instagram Post", 1080, 1080],
        ["Instagram Story", 1080, 1920],
        ["LinkedIn Banner", 1584, 396],
      ],
    ],
  ];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const IS_MAC = /Mac/.test(navigator.platform);
  const typing = (target) =>
    !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);

  // Ink for a new text layer, also the caret colour (text-caret.js): black over a light background, white over a dark one.
  function inkAt(clientX, clientY) {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (el.closest("#canvas .layer")?.dataset.designType === "text") continue;
      const value = getComputedStyle(el).backgroundColor,
        c = (value.match(/[\d.]+/g) || []).map(Number);
      if (c.length < 3 || (c.length > 3 ? c[3] : 1) < 0.5) continue;
      const scale = value.startsWith("color(") ? 1 : 255;
      return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / scale < 0.5 ? "#ffffff" : "#000000";
    }
    return "#000000";
  }

  function install(ed) {
    const $ = (s) => document.querySelector(s);
    const { canvas, camera: cam } = ed;
    const wrap = $("#canvas-wrap"),
      workspace = $("#workspace");
    let tool = "move",
      space = false,
      autoFit = true,
      lastPage = null,
      clipboard = null,
      styleClipboard = null,
      pasteTimer = null,
      pendingInPlace = false,
      suppressPasteUntil = 0,
      menu = null;
    const drilled = new Set(),
      cameras = new Map();
    const find = (id) => window.VerynizeNodeIndex.find(ed.nodes(), id);
    const sel = () => ed.getSelection();
    const selectedNodes = () => ed.nodes().filter((n) => sel().has(n.id));
    const isFlow = (n) => !!n && n.type === "frame" && n.layout !== "free";
    // The renderer's map first: an attribute query walks the canvas (O(page) per call, several calls per pointer move).
    const elementOf = (id) => {
      const el = ed.layerOf?.(id);
      return el && canvas.contains(el)
        ? el
        : canvas.querySelector('[data-id="' + CSS.escape(id) + '"]');
    };
    const footer = (message) => {
      const f = $("#workspace footer") || $("footer");
      if (f) f.textContent = message;
    };

    // ---------- Overlay (screen-space chrome) ----------
    const overlay = document.createElement("div");
    overlay.id = "canvas-overlay";
    overlay.innerHTML =
      '<svg class="guide-layer" xmlns="http://www.w3.org/2000/svg"></svg><div class="guide-labels"></div><div class="frame-labels"></div><div class="marquee" hidden></div>';
    wrap.append(overlay);
    const guideSvg = overlay.querySelector(".guide-layer"),
      guideLabels = overlay.querySelector(".guide-labels"),
      frameLabels = overlay.querySelector(".frame-labels"),
      marqueeBox = overlay.querySelector(".marquee");
    // Frame labels by frame id (drawFrameLabels), and the viewport size they are culled against (set on resize).
    const frameLabelOf = new Map();
    let labelView = null;

    // ---------- Hover: outline what a click would select and tint its name label (Wonder S1-hover-final) ----------
    const hoverBox = document.createElement("div"),
      dropBox = document.createElement("div"),
      dropLine = document.createElement("div");
    hoverBox.className = "hover-box";
    dropBox.className = "drop-target";
    dropLine.className = "drop-line";
    hoverBox.hidden = dropBox.hidden = dropLine.hidden = true;
    overlay.append(hoverBox, dropBox, dropLine);
    // A clipping ancestor, or the layer's own Clip content, cuts off the selection ring and handles drawn inside the
    // layer (the corner handles straddle its edge), so such layers get their chrome redrawn here, over the clip.
    // Wonder S4-frame-ready: a Clip content frame shows whole 9px handles.
    const clippedSelection = document.createElement("div");
    clippedSelection.className = "clipped-selection";
    overlay.append(clippedSelection);
    function drawClippedSelection() {
      if (sel().size > 200) { clippedSelection.replaceChildren(); return; }
      // Measure every ring first, then write once: a read after each append would force a style recalc per ring.
      const boxes = [];
      for (const id of sel()) {
        const n = find(id);
        if (!n || n.hidden || n.rotation) continue;
        let p = n.parentId && find(n.parentId),
          clipped = !!n.clipContent;
        while (p && !clipped) {
          clipped = !!p.clipContent;
          p = p.parentId && find(p.parentId);
        }
        const b = clipped && screenBox(id);
        if (b) boxes.push([id, n, b]);
      }
      clippedSelection.replaceChildren();
      for (const [id, n, b] of boxes) {
        const ring = document.createElement("div");
        ring.className = "selection-ring";
        placeBox(ring, b);
        if (!n.locked)
          for (const corner of ["nw", "ne", "sw", "se"]) {
            const h = document.createElement("div");
            h.className = "handle";
            h.dataset.id = id;
            h.dataset.corner = corner;
            ring.append(h);
          }
        clippedSelection.append(ring);
      }
    }
    let hoverId = null,
      hoverPoint = null,
      rowHover = null;
    function screenBox(id) {
      const el = elementOf(id);
      if (!el) return null;
      const r = el.getBoundingClientRect(),
        v = viewport();
      if (!r.width && !r.height) return null;
      return { left: r.left - v.left, top: r.top - v.top, width: r.width, height: r.height };
    }
    function placeBox(el, b) {
      Object.assign(el.style, {
        left: b.left + "px",
        top: b.top + "px",
        width: b.width + "px",
        height: b.height + "px",
      });
    }
    function showHover(id) {
      hoverId = id || null;
      overlay.dataset.hover = hoverId || "";
      for (const label of frameLabels.children)
        label.classList.toggle("hovered", label.dataset.id === hoverId);
      // The outline turns with a rotated layer (Wonder R4-rotated-hover-100), like the selection chrome.
      const SC = window.BetterSelectionChrome,
        f = hoverId && SC.frameOf(elementOf(hoverId), find(hoverId), find, cam.zoom, viewport());
      hoverBox.hidden = !f;
      if (f) SC.placeFrame(hoverBox, f);
    }
    // Recompute the hover from the last pointer position (after a move, camera change, render or modifier change).
    function refreshHover(force = false) {
      let id = null;
      if (rowHover) id = find(rowHover) && !sel().has(rowHover) ? rowHover : null;
      else if (
        hoverPoint &&
        !space &&
        !spacingDrag &&
        (tool === "move" || tool === "scale") &&
        !workspace.classList.contains("panning") &&
        !workspace.classList.contains("moving")
      ) {
        const hit = document.elementFromPoint(hoverPoint.x, hoverPoint.y),
          label = hit?.closest?.("#canvas-overlay .frame-label");
        if (label) id = label.dataset.id;
        else if (hit && canvas.contains(hit) && !hit.closest(".handle")) {
          const el = hit.closest(".layer");
          if (el) id = clickTarget(el.dataset.id, hoverPoint.deep);
        }
        if (id && (sel().has(id) || find(id)?.locked)) id = null;
      }
      if (force || id !== hoverId) showHover(id);
      drawSpacing();
    }
    wrap.addEventListener("pointerleave", () => {
      hoverPoint = null;
      refreshHover();
    });
    // Hovering a row in the layers panel outlines its layer on the canvas.
    document.addEventListener("pointerover", (e) => {
      const row = e.target.closest?.(".layer-row[data-id]"),
        id = row?.dataset.id || null;
      if (id !== rowHover) {
        rowHover = id;
        refreshHover(true);
      }
    });

    // ---------- Spacing handles: drag the padding and gaps of the selected auto-layout frame ----------
    // Gaps are hatched bands between children; padding bands sit inside the border. Both edit live with a value badge.
    const spacingLayer = document.createElement("div");
    spacingLayer.className = "spacing-layer";
    overlay.append(spacingLayer);
    const PAD_KEYS = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
    let spacingBands = [],
      spacingKey = "",
      spacingDrag = null;
    function spacingFrame() {
      if (sel().size !== 1 || space || !(tool === "move" || tool === "scale")) return null;
      const n = find([...sel()][0]);
      return n && n.type === "frame" && isFlow(n) && !n.locked && !n.hidden ? n : null;
    }
    // Screen-space bands from the live layout: padding per side, then gaps between children (rows for wrap/grid).
    function spacingGeometry(n) {
      const el = elementOf(n.id),
        b = screenBox(n.id);
      if (!el || !b) return [];
      const z = cam.zoom,
        cs = getComputedStyle(el),
        px = (v) => parseFloat(v) || 0,
        MIN = 6,
        CORNER = 8;
      const inner = {
        left: b.left + el.clientLeft * z,
        top: b.top + el.clientTop * z,
        width: el.clientWidth * z,
        height: el.clientHeight * z,
      };
      const pad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px),
        p = pad.map((v) => Math.max(MIN, v * z));
      const long = (start, size) => ({
        start: start + CORNER,
        size: Math.max(0, size - 2 * CORNER),
      }); // keep corner handles reachable
      const h = long(inner.left, inner.width),
        v = long(inner.top, inner.height);
      const bands = [
        {
          kind: "padding",
          side: 0,
          axis: "y",
          value: pad[0],
          rect: { left: h.start, top: inner.top, width: h.size, height: p[0] },
        },
        {
          kind: "padding",
          side: 1,
          axis: "x",
          value: pad[1],
          rect: {
            left: inner.left + inner.width - p[1],
            top: v.start,
            width: p[1],
            height: v.size,
          },
        },
        {
          kind: "padding",
          side: 2,
          axis: "y",
          value: pad[2],
          rect: {
            left: h.start,
            top: inner.top + inner.height - p[2],
            width: h.size,
            height: p[2],
          },
        },
        {
          kind: "padding",
          side: 3,
          axis: "x",
          value: pad[3],
          rect: { left: inner.left, top: v.start, width: p[3], height: v.size },
        },
      ];
      const content = {
        left: inner.left + pad[3] * z,
        top: inner.top + pad[0] * z,
        width: inner.width - (pad[1] + pad[3]) * z,
        height: inner.height - (pad[0] + pad[2]) * z,
      };
      const kids = ed
        .nodes()
        .filter((k) => k.parentId === n.id && !k.hidden && k.position !== "absolute")
        .map((k) => screenBox(k.id))
        .filter(Boolean);
      const auto = n.layout === "flex" && String(n.justifyContent || "").startsWith("space-");
      const gapValue = (axis) =>
        n.layout === "block" ? Number(n.gapY) || 0 : px(axis === "x" ? cs.columnGap : cs.rowGap);
      const gap = (axis, from, to, cross) => {
        const size = Math.max(0, to - from),
          thick = Math.max(MIN, size),
          at = from + size / 2 - thick / 2;
        bands.push({
          kind: "gap",
          axis,
          auto: auto && axis === (n.direction === "column" ? "y" : "x"),
          value:
            auto && axis === (n.direction === "column" ? "y" : "x") ? size / z : gapValue(axis),
          rect:
            axis === "x"
              ? { left: at, top: cross.start, width: thick, height: cross.size }
              : { left: cross.start, top: at, width: cross.size, height: thick },
        });
      };
      const rowMain = (n.layout === "flex" && n.direction !== "column") || n.layout === "grid";
      if (!rowMain) {
        for (let i = 1; i < kids.length; i++)
          gap("y", kids[i - 1].top + kids[i - 1].height, kids[i].top, {
            start: content.left,
            size: content.width,
          });
        return bands;
      }
      // Group children into lines (a new line starts below the current one), then gaps within and between lines.
      const lines = [];
      for (const k of kids) {
        const line = lines.at(-1);
        if (line && k.top < line.bottom - 1) {
          line.kids.push(k);
          line.top = Math.min(line.top, k.top);
          line.bottom = Math.max(line.bottom, k.top + k.height);
        } else lines.push({ kids: [k], top: k.top, bottom: k.top + k.height });
      }
      const single = lines.length === 1;
      for (const line of lines) {
        const cross = single
          ? { start: content.top, size: content.height }
          : { start: line.top, size: line.bottom - line.top };
        for (let i = 1; i < line.kids.length; i++)
          gap("x", line.kids[i - 1].left + line.kids[i - 1].width, line.kids[i].left, cross);
      }
      for (let i = 1; i < lines.length; i++)
        gap("y", lines[i - 1].bottom, lines[i].top, { start: content.left, size: content.width });
      return bands;
    }
    function drawSpacing() {
      const n =
        !workspace.classList.contains("moving") && !workspace.classList.contains("panning")
          ? spacingFrame()
          : null;
      let bands = [];
      if (
        n &&
        (spacingDrag ||
          (hoverPoint &&
            (() => {
              const b = screenBox(n.id);
              return (
                b &&
                hoverPoint.x - viewport().left >= b.left &&
                hoverPoint.x - viewport().left <= b.left + b.width &&
                hoverPoint.y - viewport().top >= b.top &&
                hoverPoint.y - viewport().top <= b.top + b.height
              );
            })()))
      )
        bands = spacingGeometry(n);
      const key = JSON.stringify([bands, spacingDrag?.index]);
      if (key === spacingKey) return;
      spacingKey = key;
      spacingBands = bands;
      spacingLayer.replaceChildren();
      overlay.dataset.spacing = String(bands.length);
      bands.forEach((band, index) => {
        const el = document.createElement("div");
        el.className =
          `spacing-band spacing-${band.kind}` + (spacingDrag?.index === index ? " active" : "");
        el.dataset.index = String(index);
        el.dataset.axis = band.axis;
        el.dataset.kind = band.kind;
        if (band.kind === "padding") el.dataset.side = String(band.side);
        placeBox(el, band.rect);
        const label = band.auto ? "Auto" : String(Math.round(band.value * 100) / 100);
        el.innerHTML = `<i class="spacing-bar"></i><b class="spacing-badge">${label}</b>`;
        spacingLayer.append(el);
      });
    }
    function startSpacing(e, band, index) {
      const n = spacingFrame();
      if (!n || !band) return;
      const g = gesture(),
        start = { x: e.clientX, y: e.clientY },
        z = cam.zoom,
        el = elementOf(n.id),
        cs = el ? getComputedStyle(el) : null;
      const pads = cs
        ? [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((v) =>
            Math.round(parseFloat(v) || 0),
          )
        : [0, 0, 0, 0];
      const from = Math.round(band.value);
      // Which field a gap drag writes: the main-axis `gap` of a flex stack (or its own gapX/gapY when set), gapX/gapY on grids.
      const main = n.direction === "column" ? "y" : "x";
      const gapKey =
        n.layout === "block"
          ? "gapY"
          : n.layout === "flex" && band.axis === main
            ? n["gap" + main.toUpperCase()] !== undefined
              ? "gap" + main.toUpperCase()
              : "gap"
            : "gap" + band.axis.toUpperCase();
      spacingDrag = { index };
      workspace.dataset.spacingDrag = band.axis;
      showHover(null);
      spacingKey = "";
      drawSpacing();
      // The handle follows the pointer. Top/left padding always pushes content down/right. Bottom/right padding on a
      // hugging axis grows the frame outward (drag down/right = more); on a fixed or fill axis it eats into the content
      // (drag up/left = more).
      const hugs = (axis) =>
        window.BetterNodeStyle?.sizingMode?.(n, axis === "x" ? "w" : "h", find(n.parentId)) ===
        "hug";
      const sign =
        band.kind !== "padding" || band.side === 0 || band.side === 3 || hugs(band.axis) ? 1 : -1;
      // A drag never breaks the layout: a value that makes this frame or an ancestor overflow (beyond what already
      // overflowed), or squeezes a child below its longest word / smallest content, is refused and the last value that
      // fits stays. A grid gap counts once per track, so this is what keeps a 12-column gap from pushing cells off the
      // page. Typing a value in the inspector still allows anything.
      // Resize handles hang outside the frame and would count as overflow, so they hide for the drag.
      canvas.classList.add("spacing-measure");
      const chain = [];
      for (let a = n; a; a = find(a.parentId)) chain.push(a.id);
      const overflow = (id) => {
        const x = elementOf(id);
        return x ? [x.scrollWidth - x.clientWidth, x.scrollHeight - x.clientHeight] : [0, 0];
      };
      const baseline = new Map(chain.map((id) => [id, overflow(id)]));
      const kids = ed
        .nodes()
        .filter((k) => k.parentId === n.id && !k.hidden && k.position !== "absolute");
      canvas.classList.add("measuring-min");
      const smallest = new Map(
        kids.map((k) => {
          const x = elementOf(k.id);
          if (!x) return [k.id, 0];
          const width = x.offsetWidth,
            css = x.style.cssText;
          x.style.cssText =
            css + ";width:min-content!important;flex:none!important;min-width:0!important";
          const min = x.offsetWidth;
          x.style.cssText = css;
          return [k.id, Math.min(min, width)];
        }),
      );
      canvas.classList.remove("measuring-min");
      const fits = () =>
        chain.every((id) =>
          overflow(id).every((o, i) => o <= Math.max(0, baseline.get(id)[i]) + 1),
        ) &&
        kids.every((k) => {
          const x = elementOf(k.id);
          return !x || x.offsetWidth >= smallest.get(k.id) - 1;
        });
      let good = from;
      const apply = (value, ev) => {
        if (band.kind === "padding") {
          if (n.bindings) delete n.bindings.padding;
          if (ev.shiftKey) {
            n.padding = value;
            for (const k of PAD_KEYS) delete n[k];
          } else {
            const sides = ev.altKey ? [band.side, (band.side + 2) % 4] : [band.side];
            PAD_KEYS.forEach((k, i) => {
              n[k] = sides.includes(i) ? value : pads[i];
            });
          }
        } else {
          if (n.bindings && gapKey === "gap") delete n.bindings.gap;
          if (band.auto) n.justifyContent = "flex-start"; // dragging an auto gap makes it fixed
          n[gapKey] = value;
        }
        ed.render();
      };
      track(
        e,
        (ev) => {
          const d = band.axis === "x" ? (ev.clientX - start.x) / z : (ev.clientY - start.y) / z;
          const value = Math.max(0, Math.round(from + sign * d));
          if (!g.committed && value === from) return;
          g.commit();
          apply(value, ev);
          if (value <= good || fits()) {
            good = value;
            workspace.dataset.spacingLimit = "";
            return;
          }
          // Past the limit: step back toward the last fitting value (the largest one that still fits, between the two).
          let lo = good,
            hi = value;
          while (hi - lo > 1) {
            const mid = Math.floor((lo + hi) / 2);
            apply(mid, ev);
            if (fits()) lo = mid;
            else hi = mid;
          }
          apply(lo, ev);
          good = lo;
          workspace.dataset.spacingLimit = "1";
        },
        () => {
          canvas.classList.remove("spacing-measure");
          delete workspace.dataset.spacingLimit;
          spacingDrag = null;
          delete workspace.dataset.spacingDrag;
          spacingKey = "";
          refreshHover(true);
        },
      );
    }

    // ---------- Viewers ----------
    // A viewer or commenter in a shared room (body.cloud-read-only) looks around and selects; commands that change the
    // document are inert (web/cloud-panel.js rolls back anything else).
    function readOnly() {
      return document.body.classList.contains("cloud-read-only");
    }
    const VIEWER_COMMANDS = /^(select\.|view\.|tool\.(move|hand)$|edit\.copy(Code|Png)?$)/;
    function allowed(id) {
      return !readOnly() || VIEWER_COMMANDS.test(id);
    }

    // ---------- Camera ----------
    const viewport = () => wrap.getBoundingClientRect();
    // Compositing: a permanently promoted #canvas (will-change: transform) freezes its raster scale, so after a zoom out
    // the whole world is still drawn with tiles at the old, larger scale and Chromium runs out of tile memory ("tile
    // memory limits exceeded", content stops drawing). The layer is promoted only while the camera pans (a cheap
    // translate of existing tiles) and released once it settles; zoom changes are never promoted, so every zoom level
    // rasters at its own scale and stays crisp.
    let lastZoom = null,
      releaseTimer = 0;
    const releaseLayer = () => {
      clearTimeout(releaseTimer);
      canvas.classList.remove("camera-moving");
    };
    function applyCamera() {
      window.canvasTiles?.camera(cam);
      canvas.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`;
      if (lastZoom !== cam.zoom) releaseLayer();
      else {
        canvas.classList.add("camera-moving");
        clearTimeout(releaseTimer);
        releaseTimer = setTimeout(releaseLayer, 160);
      }
      lastZoom = cam.zoom;
      canvas.style.setProperty("--iz", String(1 / cam.zoom));
      const label = $("#zoom-reset");
      if (label) label.textContent = Math.round(cam.zoom * 100) + "%";
      if (lastPage) cameras.set(lastPage, { ...cam });
      ed.updateMeasurement();
      drawFrameLabels();
      drawClippedSelection();
      if (hoverId || spacingBands.length) refreshHover(true);
    }
    function setCamera(x, y, zoom, fitting = false) {
      cam.x = x;
      cam.y = y;
      cam.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
      autoFit = fitting;
      applyCamera();
    }
    function screenToWorld(clientX, clientY) {
      const r = viewport();
      return { x: (clientX - r.left - cam.x) / cam.zoom, y: (clientY - r.top - cam.y) / cam.zoom };
    }
    const toScreenX = (x) => x * cam.zoom + cam.x,
      toScreenY = (y) => y * cam.zoom + cam.y;
    function zoomAt(zoom, clientX, clientY) {
      const r = viewport(),
        z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
      const wx = (clientX - r.left - cam.x) / cam.zoom,
        wy = (clientY - r.top - cam.y) / cam.zoom;
      setCamera(clientX - r.left - wx * z, clientY - r.top - wy * z, z);
    }
    function zoomCenter(zoom) {
      const r = viewport();
      zoomAt(zoom, r.left + r.width / 2, r.top + r.height / 2);
    }
    function stepZoom(direction) {
      const z = cam.zoom;
      const next =
        direction > 0
          ? (ZOOM_STOPS.find((s) => s > z * 1.001) ?? MAX_ZOOM)
          : (ZOOM_STOPS.findLast((s) => s < z / 1.001) ?? MIN_ZOOM);
      zoomCenter(next);
    }
    // World-space bounds of a rendered node (axis-aligned; includes rotation and flow layout).
    function worldRect(id) {
      const el = elementOf(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      const v = viewport();
      return {
        x: (r.left - v.left - cam.x) / cam.zoom,
        y: (r.top - v.top - cam.y) / cam.zoom,
        w: r.width / cam.zoom,
        h: r.height / cam.zoom,
      };
    }
    function union(rects) {
      rects = rects.filter(Boolean);
      if (!rects.length) return null;
      const x = Math.min(...rects.map((r) => r.x)),
        y = Math.min(...rects.map((r) => r.y));
      return {
        x,
        y,
        w: Math.max(...rects.map((r) => r.x + r.w)) - x,
        h: Math.max(...rects.map((r) => r.y + r.h)) - y,
      };
    }
    function fitBounds(b, maxZoom = MAX_ZOOM, fitting = false, safe = SAFE) {
      const r = viewport();
      if (!b || !r.width || !r.height) return;
      const aw = Math.max(40, r.width - safe.left - safe.right),
        ah = Math.max(40, r.height - safe.top - safe.bottom);
      const z = clamp(
        Math.min(aw / Math.max(1, b.w), ah / Math.max(1, b.h), maxZoom),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      setCamera(
        safe.left + (aw - b.w * z) / 2 - b.x * z,
        safe.top + (ah - b.h * z) / 2 - b.y * z,
        z,
        fitting,
      );
    }
    function contentBounds() {
      const tops = ed.nodes().filter((n) => !n.parentId && !n.hidden);
      const rects = tops.map((n) => worldRect(n.id));
      if (!tops.some((n) => n.type === "frame")) rects.push(BOARD);
      return union(rects) || BOARD;
    }
    const fit = (initial = false) => fitBounds(contentBounds(), initial ? 1 : MAX_ZOOM, true);
    function zoomToSelection() {
      const b = union([...sel()].map(worldRect));
      if (b) fitBounds(b, MAX_ZOOM, false, SELECTION_SAFE);
      else fit();
    }
    function placeInView(w, h) {
      const r = viewport(),
        c = screenToWorld(r.left + r.width / 2, r.top + (r.height - SAFE.bottom + SAFE.top) / 2);
      return { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2) };
    }
    function visibleWorld() {
      const r = viewport(),
        a = screenToWorld(r.left, r.top),
        b = screenToWorld(r.right, r.bottom);
      return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    }
    const intersects = (a, b) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

    workspace.addEventListener(
      "wheel",
      (e) => {
        if (e.target.closest("#canvas-toolbar, .canvas-title, #canvas-menu, dialog")) return;
        e.preventDefault();
        let dx = e.deltaX,
          dy = e.deltaY;
        if (e.deltaMode === 1) {
          dx *= 16;
          dy *= 16;
        } else if (e.deltaMode === 2) {
          dx *= viewport().width;
          dy *= viewport().height;
        }
        if (e.ctrlKey || e.metaKey) {
          const k = Math.abs(dy) < 20 ? 8 : 1; // trackpad pinch sends small deltas
          zoomAt(cam.zoom * Math.pow(1.002, -dy * k), e.clientX, e.clientY);
        } else {
          if (e.shiftKey && !dx) {
            dx = dy;
            dy = 0;
          }
          setCamera(cam.x - dx, cam.y - dy, cam.zoom);
        }
      },
      { passive: false },
    );
    // Opening or closing a panel on the left (layers, chat dock, chats sidebar) moves the viewport's left edge: shift the
    // camera by the same amount so the artwork stays put on screen instead of sliding with the panel (panels are ≥200px
    // wide; smaller moves are start-up layout settling). While a panel edge is dragged (`html[data-panel-reflow]`, set by
    // the chrome island's panel-resize.tsx) every move of the left edge is compensated.
    let viewportLeft = null,
      panelToggledAt = -Infinity;
    new MutationObserver(() => {
      panelToggledAt = performance.now();
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    new ResizeObserver(() => {
      const left = viewport().left,
        reflow = document.documentElement.hasAttribute("data-panel-reflow");
      const moved =
        viewportLeft !== null &&
        (reflow
          ? left !== viewportLeft
          : Math.abs(left - viewportLeft) >= 100 && performance.now() - panelToggledAt < 1000);
      if (moved) {
        cam.x -= left - viewportLeft;
        autoFit = false;
      }
      viewportLeft = left;
      const size = viewport();
      labelView = { w: size.width, h: size.height };
      if (autoFit) fit(true);
      else applyCamera();
    }).observe(wrap);
    // Bring a layer into view by moving the camera (scrolling cannot reach negative world space).
    function reveal(id) {
      const b = worldRect(id);
      if (!b) return;
      const v = visibleWorld();
      if (b.x >= v.x && b.y >= v.y && b.x + b.w <= v.x + v.w && b.y + b.h <= v.y + v.h) return;
      const r = viewport();
      if (
        b.w * cam.zoom > r.width - SAFE.left - SAFE.right ||
        b.h * cam.zoom > r.height - SAFE.top - SAFE.bottom
      ) {
        fitBounds(b, cam.zoom);
        return;
      }
      setCamera(
        r.width / 2 - (b.x + b.w / 2) * cam.zoom,
        (r.height + SAFE.top - SAFE.bottom) / 2 - (b.y + b.h / 2) * cam.zoom,
        cam.zoom,
      );
    }
    // oxlint-disable-next-line unbound-method -- the native method is kept to be called below with apply(this)
    const nativeScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
      const layer = canvas.contains(this) && this !== canvas ? this.closest(".layer") : null;
      if (layer?.dataset.id) {
        reveal(layer.dataset.id);
        return;
      }
      return nativeScrollIntoView.apply(this, args);
    };
    // The viewport never scrolls natively; programmatic scrolls (e.g. scrollIntoView) become camera pans.
    for (const scroller of [wrap, workspace])
      scroller.addEventListener("scroll", () => {
        const dx = scroller.scrollLeft,
          dy = scroller.scrollTop;
        if (!dx && !dy) return;
        scroller.scrollLeft = 0;
        scroller.scrollTop = 0;
        setCamera(cam.x - dx, cam.y - dy, cam.zoom);
      });

    // ---------- Tools ----------
    function setTool(next) {
      if (readOnly() && next !== "hand") next = "move"; // viewers: Move and Hand only
      if (next === "image") {
        setTool("move");
        $("#image")?.click();
        return;
      }
      const previous = tool;
      tool = TOOL_BUTTONS[next] ? next : "move";
      workspace.dataset.tool = tool;
      for (const [name, id] of Object.entries(TOOL_BUTTONS))
        document.getElementById(id)?.classList.toggle("tool-active", name === tool);
      if (tool === "eyedropper" && previous !== "eyedropper") void openEyedropper();
    }
    // Legacy command buttons for the tools added here; the chrome island takes their ids over (toolbar / app menu).
    for (const [id, label, run] of [
      [
        "eyedropper-tool",
        "Eyedropper",
        () => setTool(tool === "eyedropper" ? "move" : "eyedropper"),
      ],
      ["add-ellipse", "Ellipse", () => insertEllipse()],
    ]) {
      if (document.getElementById(id)) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.id = id;
      b.hidden = true;
      b.textContent = label;
      b.setAttribute("aria-label", label);
      b.onclick = run;
      document.body.append(b); // not in the legacy toolbar: wonder-shell.js rebuilds that one
    }
    // A frame preset (Properties panel, Frame tool): a top-level frame of that size, named after it, centred in view and zoomed to.
    function insertFramePreset(name) {
      const preset = FRAME_PRESETS.flatMap(([, presets]) => presets).find(([n]) => n === name);
      if (!preset) return null;
      const [, w, h] = preset,
        p = placeInView(w, h);
      setTool("move");
      ed.add("frame", { name, x: p.x, y: p.y, w, h, parentId: null });
      zoomToSelection();
      return [...sel()][0] || null;
    }
    function insertEllipse(extra = {}) {
      ed.add("rectangle", { name: "Ellipse", ellipse: true, w: 200, h: 200, radius: 0, ...extra });
    }

    // ---------- Eyedropper (I): pick a screen color and apply it to the selection's fill (text: ink) ----------
    const hexOf = (value) => {
      const m = String(value).match(
        /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i,
      );
      if (m)
        return m[4] !== undefined && parseFloat(m[4]) === 0
          ? null
          : "#" + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
      return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
    };
    function applyPickedColor(hex) {
      const list = selectedNodes().filter((n) => !n.locked);
      writeSystemClipboard(hex);
      if (!list.length) {
        footer("Picked " + hex + " (copied)");
        return false;
      }
      ed.checkpoint();
      for (const n of list) {
        n.color = hex;
        n.token = "";
        if (n.type !== "text") n.gradient = "";
      }
      ed.render();
      footer("Applied " + hex);
      return true;
    }
    let eyedropperRun = 0;
    async function openEyedropper() {
      const run = ++eyedropperRun;
      if (typeof window.EyeDropper !== "function") {
        footer("Click the canvas to pick a color");
        return;
      }
      try {
        const result = await new window.EyeDropper().open();
        if (run !== eyedropperRun || tool !== "eyedropper") return;
        const hex = hexOf(result?.sRGBHex);
        if (hex) applyPickedColor(hex);
        setTool("move");
      } catch (error) {
        if (run !== eyedropperRun) return;
        // Cancelled by the user (Escape): leave the tool. Otherwise (e.g. no user activation) pick by clicking a layer.
        if (error?.name === "AbortError") setTool("move");
        else footer("Click the canvas to pick a color");
      }
    }
    // Fallback picker: the painted color of the layer under the pointer (image pixels are sampled).
    function colorAt(clientX, clientY) {
      for (const el of document.elementsFromPoint(clientX, clientY)) {
        if (!canvas.contains(el) || el === canvas) continue;
        if (el.tagName === "IMG" && el.complete && el.naturalWidth) {
          try {
            const r = el.getBoundingClientRect(),
              c = document.createElement("canvas");
            c.width = c.height = 1;
            const ctx = c.getContext("2d");
            ctx.drawImage(
              el,
              ((clientX - r.left) / r.width) * el.naturalWidth,
              ((clientY - r.top) / r.height) * el.naturalHeight,
              1,
              1,
              0,
              0,
              1,
              1,
            );
            const [red, green, blue, alpha] = ctx.getImageData(0, 0, 1, 1).data;
            if (alpha) return hexOf(`rgb(${red}, ${green}, ${blue})`);
          } catch {}
          continue;
        }
        const layer = el.closest(".layer");
        if (!layer) continue;
        const style = getComputedStyle(el),
          own =
            el === layer
              ? layer.dataset.designType === "text"
                ? hexOf(style.color)
                : hexOf(style.backgroundColor)
              : el.tagName === "SPAN"
                ? hexOf(style.color)
                : null;
        if (own) return own;
      }
      return null;
    }

    // ---------- Selection helpers ----------
    function pathTo(id) {
      const path = [];
      let n = find(id);
      while (n) {
        path.unshift(n);
        n = n.parentId ? find(n.parentId) : null;
      }
      return path;
    }
    // Deep selection: the preference, or ⌘-click (Ctrl elsewhere) for one click.
    const deepSelect = (e) =>
      window.appPreferences?.get?.().selection === "deep" ||
      !!(e && (IS_MAC ? e.metaKey : e.ctrlKey));
    function resolveHit(hitId, deep = deepSelect()) {
      if (deep) return hitId;
      const scope = new Set(drilled);
      for (const n of selectedNodes()) if (n.parentId) scope.add(n.parentId);
      const path = pathTo(hitId);
      // Top-level frames are artboards: a click inside one picks its direct child, never the artboard itself.
      if (path.length > 1 && path[0].type === "frame") scope.add(path[0].id);
      // Descend from the root while the current frame is part of the drilled/selection scope.
      let depth = 0;
      while (depth < path.length - 1 && scope.has(path[depth].id)) depth++;
      return path[depth]?.id ?? hitId;
    }
    // What a click selects: the resolved layer, or one level deeper when that layer is already selected
    // (clicking inside a selected frame selects the child under the pointer).
    function clickTarget(hitId, deep = deepSelect()) {
      const id = resolveHit(hitId, deep);
      if (deep || !sel().has(id)) return id;
      const path = pathTo(hitId),
        i = path.findIndex((n) => n.id === id);
      return path[i + 1]?.id ?? id;
    }
    const inStack = (n) => !!n && isFlow(find(n.parentId)) && n.position !== "absolute";
    // Selected nodes without any selected ancestor.
    function topSelected() {
      return window.VerynizeNodeIndex.of(ed.nodes()).topmost(selectedNodes());
    }
    function select(ids) {
      ed.setSelection(new Set(ids));
      ed.renderSelection();
    }
    function clearSelection() {
      drilled.clear();
      select([]);
    }

    // Lazy undo: only record history once a gesture actually changes something. A late gesture takes its snapshot
    // when it commits (the whole document, so a click that never commits does not pay for it); its caller commits
    // before its first change to the document.
    function gesture(late = false) {
      const before = late ? null : ed.snapshot();
      let committed = false;
      return {
        commit() {
          if (!committed) {
            ed.pushHistory(before ?? ed.snapshot());
            committed = true;
          }
        },
        get committed() {
          return committed;
        },
      };
    }

    // ---------- Pointer: pan / move / resize / marquee / draw ----------
    function track(e, move, end) {
      ed.beginGesture?.();
      const pointerId = e.pointerId,
        buttonMask = e.button === 1 ? 4 : e.button === 2 ? 2 : 1;
      let finished = false;
      const up = (ev) => {
        if (finished || (ev.pointerId !== undefined && ev.pointerId !== pointerId)) return;
        finished = true;
        window.removeEventListener("pointermove", moving);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        window.removeEventListener("blur", up);
        wrap.removeEventListener("lostpointercapture", up);
        try {
          if (wrap.hasPointerCapture(pointerId)) wrap.releasePointerCapture(pointerId);
        } catch {}
        try {
          end?.(ev);
        } finally {
          ed.endGesture?.();
        }
      };
      const moving = (ev) => {
        if (ev.pointerId !== pointerId) return;
        if (!(ev.buttons & buttonMask)) {
          up(ev);
          return;
        }
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 3) {
          try {
            if (!wrap.hasPointerCapture(pointerId)) wrap.setPointerCapture(pointerId);
          } catch {}
        }
        move(ev);
      };
      window.addEventListener("pointermove", moving);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      window.addEventListener("blur", up);
      wrap.addEventListener("lostpointercapture", up);
      // The canvas wrapper survives rerenders and keeps release events outside the iframe.
      e.preventDefault();
    }
    function startPan(e) {
      const start = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
      workspace.classList.add("panning");
      track(
        e,
        (ev) =>
          setCamera(start.cx + ev.clientX - start.x, start.cy + ev.clientY - start.y, cam.zoom),
        () => workspace.classList.remove("panning"),
      );
    }
    wrap.addEventListener("pointerdown", (e) => {
      if (textEdit?.el.contains(e.target)) return; // caret placement and selection inside the text editor
      closeMenu();
      if (e.target.closest(".frame-label")) return;
      if (space || tool === "hand" || e.button === 1) {
        startPan(e);
        return;
      }
      if (e.button !== 0) return;
      if (readOnly()) {
        viewerPointerDown(e);
        return;
      }
      if (chrome.pointerDown(e)) return;
      const spacing = e.target.closest("#canvas-overlay .spacing-band");
      if (spacing) {
        startSpacing(e, spacingBands[Number(spacing.dataset.index)], Number(spacing.dataset.index));
        return;
      }
      if (tool === "eyedropper") {
        e.preventDefault();
        const hex = colorAt(e.clientX, e.clientY);
        if (hex) {
          eyedropperRun++;
          applyPickedColor(hex);
          setTool("move");
        }
        return;
      }
      if (DRAW_TOOLS.has(tool)) {
        startDraw(e);
        return;
      }
      const handle = e.target.closest("#canvas .handle, #canvas-overlay .handle");
      if (handle) {
        startResize(
          e,
          handle.dataset.id || handle.closest(".layer").dataset.id,
          handle.dataset.corner,
        );
        return;
      }
      const el = e.target.closest("#canvas .layer");
      if (!el) {
        startMarquee(e);
        return;
      }
      const hit = el.dataset.id,
        deep = deepSelect(e),
        id = resolveHit(hit, deep);
      if (e.shiftKey) {
        const next = new Set(sel());
        if (next.has(id)) next.delete(id);
        else next.add(id);
        select(next);
        e.preventDefault();
        return;
      }
      const already = sel().has(id),
        artboard = find(id);
      // Pressing on an artboard's own background marquee-selects its children; a plain click selects the artboard.
      if (
        !already &&
        id === hit &&
        artboard &&
        !artboard.parentId &&
        artboard.type === "frame" &&
        ed.nodes().some((n) => n.parentId === id)
      ) {
        startMarquee(e, id, () => select([id]));
        return;
      }
      if (!already) select([id]);
      showHover(null);
      // A click without a drag on an already selected layer goes one level in (or collapses a multi-selection to it).
      startMove(e, () => {
        if (already) {
          const target = clickTarget(hit, deep);
          if (target !== id) {
            drilled.add(id);
            select([target]);
          } else if (sel().size > 1) select([id]);
        }
      });
    });
    // Viewers (body.cloud-read-only, web/cloud-panel.js setRole) select and marquee-select; nothing moves or resizes.
    function viewerPointerDown(e) {
      const el = e.target.closest("#canvas .layer");
      if (!el) {
        startMarquee(e);
        return;
      }
      const id = resolveHit(el.dataset.id, deepSelect(e));
      if (e.shiftKey) {
        const next = new Set(sel());
        if (next.has(id)) next.delete(id);
        else next.add(id);
        select(next);
      } else select([id]);
      e.preventDefault();
    }
    // Double-click edits a text layer that the first click of the pair had already selected; drilling in happens per click.
    let firstClickSelection = new Set();
    wrap.addEventListener("click", (e) => {
      if (e.detail <= 1) firstClickSelection = new Set(sel());
    });
    wrap.addEventListener("dblclick", (e) => {
      const el = e.target.closest("#canvas .layer");
      if (!el || readOnly()) return;
      const n = find(el.dataset.id);
      if (textEdit?.el.contains(e.target)) return; // native word selection inside the editor
      if (
        n?.type === "text" &&
        !n.locked &&
        sel().size === 1 &&
        sel().has(n.id) &&
        firstClickSelection.has(n.id)
      )
        editText({ x: e.clientX, y: e.clientY });
    });
    // ---------- In-canvas text editing (double-click, Enter, or a text layer drawn with the Text tool) ----------
    // The layer element itself becomes editable (plaintext-only: Enter types a newline, paste is plain text), so the
    // text keeps its exact canvas rendering while it is typed. Runs are rebuilt as spans that carry their style in
    // data attributes; typing inside a styled run extends it, and ⌘B / ⌘I toggle bold / italic on the selected
    // characters. Escape, ⌘Enter, blur or a press anywhere else commits text + runs as one undo step.
    let textEdit = null;
    const runStyle = (s) =>
      (s.bold ? "b" : "") +
      (s.italic ? "i" : "") +
      "|" +
      (s.color || "") +
      "|" +
      (s.fontSize || "");
    function charStylesOf(n) {
      const text = String(n.text || ""),
        runs = Array.isArray(n.textRuns) ? n.textRuns : [];
      return Array.from({ length: text.length }, (_, i) => {
        const s = {};
        for (const r of runs)
          if (r.start <= i && i < r.end) {
            if (r.bold) s.bold = true;
            if (r.italic) s.italic = true;
            if (r.color) s.color = r.color;
            if (Number.isFinite(r.fontSize)) s.fontSize = r.fontSize;
          }
        return s;
      });
    }
    function runsFrom(styles) {
      const runs = [];
      for (let i = 0; i < styles.length;) {
        const key = runStyle(styles[i]);
        let j = i + 1;
        while (j < styles.length && runStyle(styles[j]) === key) j++;
        const s = styles[i];
        if (key !== "||")
          runs.push({
            start: i,
            end: j,
            bold: !!s.bold,
            italic: !!s.italic,
            ...(s.color ? { color: s.color } : {}),
            ...(s.fontSize ? { fontSize: s.fontSize } : {}),
          });
        i = j;
      }
      return runs;
    }
    function fillEditor(el, text, styles) {
      const spans = [];
      for (let i = 0; i < text.length;) {
        const key = runStyle(styles[i] || {});
        let j = i + 1;
        while (j < text.length && runStyle(styles[j] || {}) === key) j++;
        const s = styles[i] || {},
          span = document.createElement("span");
        span.textContent = text.slice(i, j);
        if (s.bold) {
          span.dataset.runBold = "";
          span.style.fontWeight = "700";
        }
        if (s.italic) {
          span.dataset.runItalic = "";
          span.style.fontStyle = "italic";
        }
        if (s.color) {
          span.dataset.runColor = s.color;
          span.style.color = s.color;
        }
        if (s.fontSize) {
          span.dataset.runSize = String(s.fontSize);
          span.style.fontSize = s.fontSize + "px";
        }
        spans.push(span);
        i = j;
      }
      el.replaceChildren(...spans);
    }
    // Text units in document order: text nodes and <br> (one newline each). Selection handles are skipped.
    function editorUnits(el) {
      const out = [];
      const walk = (node, style) => {
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE)
            out.push({ node: child, len: child.data.length, text: child.data, style });
          else if (child.nodeType === Node.ELEMENT_NODE && !child.classList.contains("handle")) {
            if (child.tagName === "BR") {
              out.push({ node: child, len: 1, text: "\n", style });
              continue;
            }
            const d = child.dataset,
              s = { ...style };
            if ("runBold" in d) s.bold = true;
            if ("runItalic" in d) s.italic = true;
            if (d.runColor) s.color = d.runColor;
            if (d.runSize) s.fontSize = Number(d.runSize);
            if (child.tagName === "DIV" && out.length)
              out.push({ node: child, len: 1, text: "\n", style });
            walk(child, s);
          }
        }
      };
      walk(el, {});
      return out;
    }
    function readEditor(el) {
      let text = "";
      const styles = [];
      for (const u of editorUnits(el)) {
        text += u.text;
        for (let i = 0; i < u.len; i++) styles.push(u.style);
      }
      // A trailing newline the browser keeps only to show an empty last line.
      return { text, styles };
    }
    function editorOffset(el, container, offset) {
      let count = 0;
      const point = document.createRange();
      try {
        point.setStart(container, offset);
      } catch {
        return 0;
      }
      for (const u of editorUnits(el)) {
        if (u.node === container) return count + (u.node.nodeType === Node.TEXT_NODE ? offset : 0);
        if (point.comparePoint(u.node, 0) < 0) count += u.len;
        else break;
      }
      return count;
    }
    function selectEditorRange(el, start, end) {
      const units = editorUnits(el),
        at = (pos) => {
          let count = 0;
          for (const u of units) {
            if (u.node.nodeType === Node.TEXT_NODE && pos <= count + u.len)
              return [u.node, pos - count];
            count += u.len;
          }
          return [el, el.childNodes.length];
        };
      const r = document.createRange();
      r.setStart(...at(start));
      r.setEnd(...at(end));
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
    function toggleRun(prop) {
      const s = textEdit,
        selection = getSelection();
      if (!s || !selection.rangeCount) return;
      const r = selection.getRangeAt(0);
      if (!s.el.contains(r.startContainer) || !s.el.contains(r.endContainer)) return;
      const a = editorOffset(s.el, r.startContainer, r.startOffset),
        b = editorOffset(s.el, r.endContainer, r.endOffset);
      if (a === b) return;
      const { text, styles } = readEditor(s.el),
        on = !styles.slice(a, b).every((st) => st[prop]);
      for (let i = a; i < b; i++) {
        const next = { ...styles[i] };
        if (on) next[prop] = true;
        else delete next[prop];
        styles[i] = next;
      }
      fillEditor(s.el, text, styles);
      selectEditorRange(s.el, a, b);
    }
    function editText(point) {
      const list = selectedNodes(),
        n = list.length === 1 ? list[0] : null;
      if (!n || n.type !== "text" || n.locked || n.hidden || textEdit?.id === n.id) return;
      finishText(true);
      const el = elementOf(n.id);
      if (!el) return;
      fillEditor(el, String(n.text || ""), charStylesOf(n));
      try {
        el.contentEditable = "plaintext-only";
      } catch {}
      if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
      el.spellcheck = false;
      el.dataset.textEditing = "";
      clippedSelection.dataset.textEditing = ""; // selection-chrome.js hides it
      el.style.setProperty("user-select", "text");
      el.style.setProperty("-webkit-user-select", "text");
      el.style.setProperty("cursor", "text");
      const onKey = (e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          e.stopPropagation();
          finishText(true);
          return;
        }
        const mod = IS_MAC ? e.metaKey : e.ctrlKey,
          key = e.key.toLowerCase();
        if (mod && !e.altKey && !e.shiftKey && (key === "b" || key === "i")) {
          e.preventDefault();
          e.stopPropagation();
          toggleRun(key === "b" ? "bold" : "italic");
        }
      };
      const onBlur = () => {
        if (textEdit?.el === el && document.activeElement !== el) finishText(true);
      };
      const outside = (e) => {
        if (textEdit?.el === el && !el.contains(e.target)) finishText(true);
      };
      el.addEventListener("keydown", onKey);
      el.addEventListener("blur", onBlur);
      document.addEventListener("pointerdown", outside, true);
      textEdit = {
        id: n.id,
        el,
        cleanup: () => {
          el.removeEventListener("keydown", onKey);
          el.removeEventListener("blur", onBlur);
          document.removeEventListener("pointerdown", outside, true);
        },
      };
      showHover(null);
      chrome.draw(); // only the caret while typing (Wonder TX1)
      el.focus({ preventScroll: true });
      const selection = getSelection();
      const caret = point && document.caretRangeFromPoint?.(point.x, point.y);
      if (caret && el.contains(caret.startContainer)) {
        selection.removeAllRanges();
        selection.addRange(caret);
        // A double-click selects the word under the pointer, as in other editors.
        try {
          selection.modify("move", "backward", "word");
          selection.modify("extend", "forward", "word");
        } catch {}
      } else selectEditorRange(el, 0, readEditor(el).text.length);
    }
    function finishText(commit = true) {
      const s = textEdit;
      if (!s) return;
      textEdit = null;
      s.cleanup();
      const { text, styles } = readEditor(s.el);
      s.el.removeAttribute("contenteditable");
      delete s.el.dataset.textEditing;
      delete clippedSelection.dataset.textEditing;
      for (const k of ["user-select", "-webkit-user-select", "cursor"])
        s.el.style.removeProperty(k);
      if (document.activeElement === s.el) s.el.blur();
      const n = find(s.id),
        draft = draftText?.id === s.id ? draftText : null;
      if (draft) draftText = null;
      // Deleting everything in the editor can leave a lone line break behind: that is still no content.
      if (n && !/[^\n]/.test(text) && (commit || draft)) {
        removeText(n, !draft);
        return;
      }
      if (n && draft) {
        commitDraftText(n, s.el, text, runsFrom(styles), draft.before);
        return;
      }
      if (commit && n) {
        const runs = runsFrom(styles);
        if (
          text !== String(n.text || "") ||
          JSON.stringify(runs) !== JSON.stringify(runsFrom(charStylesOf(n)))
        ) {
          try {
            if (window.design?.updateNodes) {
              window.design.updateNodes([s.id], { text, textRuns: runs });
              return;
            }
          } catch (error) {
            footer(error.message || String(error));
          }
        }
      }
      ed.render(); // back to the canonical layer DOM (run spans, selection handles)
    }
    // ---------- Text tool (Wonder TX1) ----------
    // A click creates an empty layer named "Text" that hugs its content (Inter Regular 12, line height auto, letter
    // spacing 0); a drag creates a fixed box of the gesture size. The ink is black, or white over a dark background.
    // The new layer enters the undo history only once it has text (one step that removes it again); editing that
    // ends with no text removes it. Any text layer emptied in the editor is removed as one undo step.
    let draftText = null;
    function createText(r, click, parent, clientX, clientY) {
      const before = ed.snapshot();
      let x = r.x,
        y = r.y;
      if (parent) {
        const pr = worldRect(parent.id);
        if (pr) {
          x = r.x - pr.x - (parent.strokeWidth || 0);
          y = r.y - pr.y - (parent.strokeWidth || 0);
        }
      }
      const n = {
        ...ed.defaults,
        id: ed.uid(),
        type: "text",
        name: "Text",
        text: "",
        textRuns: [],
        parentId: parent?.id || null,
        x: Math.round(x),
        y: Math.round(y),
        w: click ? 1 : Math.max(1, Math.round(r.w)),
        h: click ? 14.5 : Math.max(1, Math.round(r.h)),
        color: inkAt(clientX, clientY),
        fontFamily: "Inter",
        fontWeight: "400",
        fontSize: 12,
        lineHeight: "auto",
        letterSpacing: 0,
        radius: 0,
        ...(click ? { wMode: "hug", hMode: "hug" } : { wMode: "fixed", hMode: "fixed" }),
      };
      ed.nodes().push(n);
      ed.setSelection([n.id]);
      ed.render();
      draftText = { id: n.id, before };
      editText();
    }
    function commitDraftText(n, el, text, runs, before) {
      Object.assign(n, { text, textRuns: runs });
      // Hug axes store the measured size so geometry readers (badge, agents, export) see the real box.
      const round = (v) => Math.max(1, Math.round(v * 100) / 100);
      if (n.wMode === "hug" && el.offsetWidth) n.w = round(el.offsetWidth);
      if (n.hMode === "hug" && el.offsetHeight) n.h = round(el.offsetHeight);
      ed.pushHistory(before);
      ed.render();
    }
    function removeText(n, recordUndo) {
      const before = recordUndo ? ed.snapshot() : null,
        list = ed.nodes(),
        index = list.indexOf(n);
      if (index >= 0) list.splice(index, 1);
      ed.setSelection([...sel()].filter((id) => id !== n.id));
      if (before) ed.pushHistory(before);
      ed.render();
    }
    // A render while editing (collaboration, autosave, inspector) rebuilds the layer: keep the live editor in place.
    function keepTextEditor() {
      if (!textEdit || textEdit.el.isConnected) return;
      const fresh = elementOf(textEdit.id);
      if (fresh && find(textEdit.id)) {
        fresh.replaceWith(textEdit.el);
        textEdit.el.focus({ preventScroll: true });
      } else {
        textEdit.cleanup();
        textEdit = null;
        delete clippedSelection.dataset.textEditing;
      }
    }

    let layerPreview = null; // {ids, parentId, index?} while a drag previews a new parent in the Layers tree
    const dropHits = window.VerynizeDropHits.create({ canvas, wrap, camera: cam, find });
    function guideTargets(moving) {
      const first = find(moving[0]);
      if (!first) return [];
      const excluded = new Set(moving.flatMap((id) => [...ed.descendants(id)]));
      const targets = ed
        .nodes()
        .filter(
          (n) =>
            (n.parentId || null) === (first.parentId || null) && !excluded.has(n.id) && !n.hidden,
        )
        .map((n) => worldRect(n.id))
        .filter(Boolean);
      if (first.parentId) {
        const p = worldRect(first.parentId);
        if (p) targets.push({ ...p, parent: true });
      }
      return targets;
    }
    // Drag-move. Free layers follow the pointer through x/y (with snapping). Auto-layout children follow it as a
    // translated ghost while their slot stays open and their siblings stay put (Wonder R1-row-drag-slot,
    // R1-row-small-drag); the stack takes its new order on release. Dropping over another frame re-parents the layers
    // into it (at the stack slot under the pointer when that frame is an auto layout); a top-level frame enters only a stack.
    // There is no "drop column": the tall translucent purple box in Wonder's TR7-out-during is a marquee. Its corner
    // starts in the empty gap left of the child (not on it), the child has not moved and the inspector shows Z Auto
    // (a real drag shows Z 9999, R1), and the sibling capture TR7-reorder-during ends with "2 nodes selected".
    // While the pointer is held the dragged layer has no outline, handles or size badge, only its name label when it
    // would land on the page (R1-row-drag-slot/-far, TR4-guide; CSS in selection-chrome.js). A drop that would change
    // the parent without the document changing yet (a stack child leaving its stack, a layer entering a stack) is
    // previewed in the Layers tree (R1-row-drag-out/-far, R1-row-return-during) through `bd:layer-preview`; the preview
    // is no document state, so it adds no undo step and is never saved. A drag of stack children alone changes nothing
    // before release, so Escape cancels it outright (no undo step either).
    function setLayerPreview(next) {
      if (JSON.stringify(next) === JSON.stringify(layerPreview)) return false;
      layerPreview = next;
      window.dispatchEvent(new CustomEvent("bd:layer-preview", { detail: next }));
      return true;
    }
    // Free layers follow the pointer without a render: x/y change live (snapping, drop targets and agents read them)
    // and each layer's own element is offset by a CSS translate (parent space, so it composes with rotation and the
    // translate of a centred constraint). A render on the way (nesting into a frame, a collaborator's edit) draws the
    // layer at its current x/y; the offset is then measured again from there. `s.lx/ly` = x/y at the last follow.
    function follow(list) {
      const offset = (base, d) => (base ? `calc(${base} + ${d}px)` : d + "px");
      for (const s of list) {
        if (!s.el?.isConnected || s.el.style.translate !== s.shown) {
          s.el = elementOf(s.n.id);
          if (!s.el) continue;
          s.base = s.el.style.translate === "none" ? "" : s.el.style.translate;
          s.rx = s.lx ?? s.x;
          s.ry = s.ly ?? s.y;
        }
        const [bx = "", by = bx ? "0px" : ""] = s.base ? s.base.split(" ") : [];
        s.el.style.translate = offset(bx, s.n.x - s.rx) + " " + offset(by, s.n.y - s.ry);
        s.shown = s.el.style.translate;
        s.lx = s.n.x;
        s.ly = s.n.y;
      }
    }
    // Back to the layer's own translate before the render that commits the drag.
    function unfollow(list) {
      for (const s of list)
        if (s.el?.isConnected && s.el.style.translate === s.shown) s.el.style.translate = s.base;
    }
    // While a drag runs the overlay and the selected layers carry the state its chrome reads (selection-chrome.js). Not
    // a class on #workspace: rules under one restyle every layer of the page when it toggles (1 s at 50,000 layers).
    let dragMarked = [];
    function markDrag(on) {
      workspace.classList.toggle("moving", on);
      overlay.toggleAttribute("data-moving", on);
      for (const el of dragMarked) el.removeAttribute("data-dragging");
      dragMarked = on ? [...sel()].map(elementOf).filter(Boolean) : [];
      for (const el of dragMarked) el.setAttribute("data-dragging", "");
    }
    function startMove(e, onClick) {
      let moving = topSelected()
        .filter((n) => !n.locked)
        .map((n) => n.id);
      const g = gesture(true),
        start = { x: e.clientX, y: e.clientY };
      let free = null,
        flowOnly = false,
        stacked = [],
        grab = null,
        box = null,
        targets = null,
        excluded = null,
        home,
        origin,
        drop = null,
        deferred = false,
        cancelled = false;
      const onKey = (ev) => {
        if (ev.key !== "Escape" || !deferred || cancelled) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        cancelled = true;
        window.removeEventListener("keydown", onKey, true);
        clearGhosts(stacked);
        drawGuides([]);
        drawDrop(null);
        setLayerPreview(null);
        markDrag(false);
        ed.updateMeasurement();
      };
      const begin = (ev) => {
        const picked = moving.map(find).filter(Boolean);
        deferred = !ev.altKey && picked.length > 0 && picked.every(inStack);
        if (deferred) window.addEventListener("keydown", onKey, true);
        else g.commit();
        if (ev.altKey) {
          moving = duplicateNodes(moving, 0);
          ed.render();
        } // the copies are the layers that follow
        const nodes = moving.map(find).filter(Boolean);
        free = nodes.filter((n) => !inStack(n)).map((n) => ({ n, x: n.x, y: n.y })); // anchored layers re-derive their insets from x/y (beforeRender)
        stacked = nodes.filter(inStack);
        grab = new Map(nodes.map((n) => [n.id, worldRect(n.id)]));
        box = union(free.map((s) => grab.get(s.n.id)));
        targets = free.length ? guideTargets(free.map((s) => s.n.id)) : [];
        excluded = new Set(nodes.flatMap((n) => [...ed.descendants(n.id)]));
        const parents = new Set(nodes.map((n) => n.parentId || null));
        home = origin = parents.size === 1 ? [...parents][0] : undefined;
        // A top-level frame enters a stack by a drag (Wonder R1-row-return-during) but never a free frame (unproven).
        flowOnly = nodes.some((n) => !n.parentId && n.type === "frame");
        markDrag(true);
        showHover(null);
      };
      track(
        e,
        (ev) => {
          if (!moving.length || cancelled) return;
          if (!free) {
            if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
            begin(ev);
          }
          let dx = (ev.clientX - start.x) / cam.zoom,
            dy = (ev.clientY - start.y) / cam.zoom;
          if (ev.shiftKey) {
            if (Math.abs(dx) > Math.abs(dy)) dy = 0;
            else dx = 0;
          }
          drop = dropTarget(ev, home, excluded, stacked, flowOnly);
          let guides = [];
          if (box && !drop.parent && $("#snap")?.checked !== false && !ev.metaKey && !ev.ctrlKey) {
            const snapped = snapBox({ ...box, x: box.x + dx, y: box.y + dy }, targets);
            dx += snapped.dx;
            dy += snapped.dy;
            guides = snapped.guides;
          }
          const r2 = (v) => Math.round(v * 100) / 100;
          for (const s of free) {
            s.n.x = r2(s.x + dx);
            s.n.y = r2(s.y + dy);
          }
          follow(free);
          // Free layers move into a free frame (or back onto the page) as soon as the pointer crosses into it, so the
          // frame clips them and its edges and centre lines become snap targets for the rest of the drag.
          if (drop.parent && free.length && !stacked.length && drop.index === undefined) {
            unfollow(free);
            relocate(
              free.map((s) => s.n),
              drop.parent.id === "" ? null : drop.parent.id,
            );
            // Canvas only: panels, save and subscribers see the new parent with the release's render (the Layers tree
            // previews it meanwhile, below), so a drag across frames costs the page, not the whole document.
            ed.renderCanvas();
            markDrag(true); // the render may have replaced the dragged layers' elements
            home = free[0].n.parentId || null;
            for (const s of free) {
              s.x = s.n.x - dx;
              s.y = s.n.y - dy;
              s.el = null;
              s.lx = s.n.x;
              s.ly = s.n.y;
            }
            targets = guideTargets(free.map((s) => s.n.id));
            drop = {};
          }
          const previewed = setLayerPreview(
            drop.parent
              ? {
                  ids: [...moving],
                  parentId: drop.parent.id || null,
                  ...(drop.index === undefined ? {} : { index: drop.index }),
                }
              : free.length && home !== origin
                ? { ids: [...moving], parentId: home }
                : null,
          );
          placeGhosts(stacked, grab, dx, dy);
          if (free.length || stacked.length || previewed) ed.updateMeasurement(); // the name label (and a multi-selection's box) follows the dragged layers
          if (free.some((s) => !s.n.parentId && s.n.type === "frame")) drawFrameLabels(); // artboard labels ride with their frames
          drawGuides(guides);
          drawDrop(drop);
        },
        () => {
          window.removeEventListener("keydown", onKey, true);
          if (cancelled) return;
          markDrag(false);
          if (!free) {
            onClick?.();
            return;
          }
          unfollow(free);
          drawGuides([]);
          drawDrop(null);
          setLayerPreview(null);
          if (deferred) g.commit();
          // Stack children leaving their stack land where the pointer put them (relocate measures the ghosts).
          if (drop?.parent)
            relocate(
              moving.map(find).filter(Boolean),
              drop.parent.id === "" ? null : drop.parent.id,
              drop.index,
            );
          else if (stacked.length) {
            if (drop?.index !== undefined) placeInStack(home, stacked, drop.index);
            clearGhosts(stacked);
          }
          ed.render();
        },
      );
    }
    // Where a drag lands. Stack children stay in their stack while the pointer is inside it; otherwise the deepest
    // frame under the pointer (outside the moving layers) takes them. `parent` is set only when that changes the
    // parent ({id: ''} = the page); `index` is the stack slot for auto-layout targets. `flowOnly` (a top-level frame
    // is moving) accepts only an auto-layout frame as the deepest frame under the pointer; elsewhere it stays put.
    function dropTarget(e, home, excluded, stacked, flowOnly) {
      const p = screenToWorld(e.clientX, e.clientY),
        homeNode = home ? find(home) : null;
      let target = home;
      if (!excluded || home === undefined) return {};
      if (
        !(
          isFlow(homeNode) &&
          stacked.length &&
          (() => {
            const r = worldRect(home);
            return r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
          })()
        )
      ) {
        // The full hit test walks the whole page: web/canvas-drop-hits.js repeats it only when the answer can change.
        target = dropHits.frameAt(e.clientX, e.clientY, excluded, (x, y) => {
          for (const el of document.elementsFromPoint(x, y)) {
            if (
              !canvas.contains(el) ||
              !el.classList.contains("frame-layer") ||
              excluded.has(el.dataset.id)
            )
              continue;
            const n = find(el.dataset.id);
            if (n && !n.locked && !n.hidden) return n.id;
          }
          return null;
        });
        if (flowOnly && !isFlow(find(target))) target = home;
        if (target && target !== home && cycleDrop(excluded, target)) target = home;
      }
      const node = target ? find(target) : null,
        result = {};
      if (target !== home) result.parent = node || { id: "" };
      if (isFlow(node))
        result.index = stackIndex(
          node,
          ed.nodes().filter((n) => n.parentId === node.id && !excluded.has(n.id)),
          p,
        );
      if (node && (result.parent || stacked.length)) result.frame = node.id;
      return result;
    }
    // A drag never enters a main that the dragged instances depend on (one notice per drag; answers cached per frame).
    let cycleDrops = { moving: null, refused: new Map(), told: false };
    function cycleDrop(moving, target) {
      if (cycleDrops.moving !== moving) cycleDrops = { moving, refused: new Map(), told: false };
      if (!cycleDrops.refused.has(target))
        cycleDrops.refused.set(
          target,
          !!window.VerynizeComponents?.wouldCycle(ed.design, [...moving].map(find), target),
        );
      const refused = cycleDrops.refused.get(target);
      if (refused && !cycleDrops.told) {
        cycleDrops.told = true;
        notice("A main component cannot contain an instance of itself");
      }
      return refused;
    }
    // Slot in a stack for a world point: main-axis order for single-line flex, reading order for wrap/grid/inline.
    function stackIndex(parent, kids, p) {
      const reading = parent.layout !== "flex" || parent.flexWrap,
        column = parent.direction === "column";
      let index = 0;
      kids.forEach((k, i) => {
        if (k.hidden || k.position === "absolute") return;
        const r = worldRect(k.id);
        if (!r) return;
        const before = reading
          ? p.y > r.y + r.h || (p.y >= r.y && p.x > r.x + r.w / 2)
          : column
            ? p.y > r.y + r.h / 2
            : p.x > r.x + r.w / 2;
        if (before) index = i + 1;
      });
      return index;
    }
    // Put stack children at `index` among their non-moving siblings; returns whether the order changed.
    function placeInStack(parentId, nodes, index) {
      const all = ed.nodes(),
        moving = new Set(nodes),
        siblings = all.filter((n) => (n.parentId || null) === (parentId || null));
      const rest = siblings.filter((n) => !moving.has(n)),
        next = [
          ...rest.slice(0, index),
          ...siblings.filter((n) => moving.has(n)),
          ...rest.slice(index),
        ];
      if (next.every((n, i) => n === siblings[i])) return false;
      reorderSiblings(parentId, () => next);
      return true;
    }
    // Stack children are laid out by their parent, so the dragged copy is a translate over the slot it holds.
    function placeGhosts(nodes, grab, dx, dy) {
      for (const n of nodes) {
        const el = elementOf(n.id),
          from = grab.get(n.id);
        if (!el || !from) continue;
        el.style.translate = "";
        const now = worldRect(n.id);
        if (!now) continue;
        Object.assign(el.style, {
          translate: `${from.x + dx - now.x}px ${from.y + dy - now.y}px`,
          zIndex: "1000",
          pointerEvents: "none",
        });
      }
    }
    function clearGhosts(nodes) {
      for (const n of nodes) {
        const el = elementOf(n.id);
        if (el) Object.assign(el.style, { translate: "", zIndex: "", pointerEvents: "" });
      }
    }
    // Re-parent dropped layers, keeping where they appear on screen (free parents) or taking the stack slot.
    function relocate(nodes, parentId, index) {
      const parent = find(parentId),
        flowInto = isFlow(parent),
        origin = contentOrigin(parentId),
        r2 = (v) => Math.round(v * 100) / 100;
      const at = new Map(
        nodes.map((n) => [
          n.id,
          inStack(n)
            ? worldRect(n.id)
            : {
                ...layerOrigin(n),
                w: elementOf(n.id)?.offsetWidth,
                h: elementOf(n.id)?.offsetHeight,
              },
        ]),
      );
      clearGhosts(nodes);
      const all = ed.nodes(),
        moving = new Set(nodes),
        rest = all.filter((n) => !moving.has(n));
      const siblings = rest.filter((n) => (n.parentId || null) === (parentId || null));
      const insertAt =
        flowInto && index < siblings.length
          ? rest.indexOf(siblings[index])
          : siblings.length
            ? rest.indexOf(siblings.at(-1)) + 1
            : rest.length;
      rest.splice(insertAt, 0, ...nodes);
      all.splice(0, all.length, ...rest);
      for (const n of nodes) {
        const w = at.get(n.id);
        n.parentId = parentId || null;
        if (flowInto) {
          delete n.position;
          delete n.inset;
          continue;
        }
        if (w) {
          n.x = r2(w.x - origin.x);
          n.y = r2(w.y - origin.y);
        }
        if (n.wMode === "fill") {
          n.wMode = "fixed";
          if (w?.w) n.w = w.w;
        }
        if (n.hMode === "fill") {
          n.hMode = "fixed";
          if (w?.h) n.h = w.h;
        }
      }
      ed.setSelection(new Set(nodes.map((n) => n.id)));
    }
    // Drop feedback: the receiving frame is outlined and, for a stack, a bar marks the slot (3px solid #c468f7, R1-row-return-during).
    function drawDrop(drop) {
      const target = drop?.frame,
        b = target && screenBox(target);
      dropBox.hidden = !b;
      dropLine.hidden = true;
      // Wonder R1-row-drag-slot / -return-during: the receiving frame's label takes the outline purple, like a hover.
      for (const label of frameLabels.children)
        label.classList.toggle("hovered", label.dataset.id === (target || hoverId));
      if (!b) return;
      placeBox(dropBox, b);
      if (!drop.parent) return;
      const node = find(target);
      if (!isFlow(node)) return;
      // Slots count every non-moving child; hidden and absolute ones have no box, so look past them.
      const kids = ed
        .nodes()
        .filter((n) => n.parentId === target && !sel().has(n.id))
        .map((n) => (n.hidden || n.position === "absolute" ? null : screenBox(n.id)));
      const column = node.layout === "flex" && !node.flexWrap && node.direction === "column",
        at = kids.slice(drop.index).find(Boolean),
        prev = kids.slice(0, drop.index).findLast(Boolean);
      dropLine.hidden = false;
      if (column) {
        const y =
          at && prev
            ? (prev.top + prev.height + at.top) / 2
            : at
              ? at.top - 2
              : prev
                ? prev.top + prev.height + 2
                : b.top + b.height / 2;
        placeBox(dropLine, {
          left: b.left + 4,
          top: y - 1.5,
          width: Math.max(0, b.width - 8),
          height: 3,
        });
      } else {
        const ref = at || prev,
          x =
            at && prev && Math.abs(prev.top - at.top) < 1
              ? (prev.left + prev.width + at.left) / 2
              : at
                ? at.left - 2
                : prev
                  ? prev.left + prev.width + 2
                  : b.left + b.width / 2;
        placeBox(dropLine, {
          left: x - 1.5,
          top: ref ? ref.top : b.top + 4,
          width: 3,
          height: ref ? ref.height : Math.max(0, b.height - 8),
        });
      }
    }

    // Snap a moving box to sibling/parent edges and centers, or to equal spacing.
    function snapBox(box, targets) {
      const threshold = 6 / cam.zoom,
        result = { dx: 0, dy: 0, guides: [] };
      for (const axis of ["x", "y"]) {
        const size = axis === "x" ? "w" : "h",
          cross = axis === "x" ? "y" : "x",
          crossSize = axis === "x" ? "h" : "w";
        const edges = (b) => [b[axis], b[axis] + b[size] / 2, b[axis] + b[size]];
        let best = null;
        for (const t of targets)
          for (const value of edges(t))
            for (const own of edges(box)) {
              const d = value - own;
              if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d)))
                best = { d, kind: "edge" };
            }
        // Equal spacing along this axis among targets that overlap on the cross axis.
        const row = targets
          .filter(
            (t) =>
              !t.parent &&
              t[cross] < box[cross] + box[crossSize] &&
              t[cross] + t[crossSize] > box[cross],
          )
          .sort((a, b) => a[axis] - b[axis]);
        const before = row.filter((t) => t[axis] + t[size] <= box[axis] + threshold).at(-1);
        const after = row.find((t) => t[axis] >= box[axis] + box[size] - threshold);
        const gaps = [];
        for (let i = 0; i < row.length - 1; i++) {
          const gap = row[i + 1][axis] - (row[i][axis] + row[i][size]);
          if (gap > 0) gaps.push({ gap, a: row[i], b: row[i + 1] });
        }
        const spacing = [];
        if (before && after) {
          const gap = (after[axis] - before[axis] - before[size] - box[size]) / 2;
          if (gap >= 0) spacing.push({ pos: before[axis] + before[size] + gap, gap });
        }
        for (const ref of gaps) {
          if (before)
            spacing.push({ pos: before[axis] + before[size] + ref.gap, gap: ref.gap, ref });
          if (after) spacing.push({ pos: after[axis] - ref.gap - box[size], gap: ref.gap, ref });
        }
        for (const s of spacing) {
          const d = s.pos - box[axis];
          if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d) - 0.01))
            best = { d, kind: "spacing", ...s };
        }
        if (!best) continue;
        result["d" + axis] = best.d;
        const moved = { ...box, [axis]: box[axis] + best.d };
        if (best.kind === "edge") {
          for (const t of targets)
            for (const value of edges(t))
              if (edges(moved).some((v) => Math.abs(v - value) < 0.5)) {
                const lo = Math.min(t[cross], moved[cross]),
                  hi = Math.max(t[cross] + t[crossSize], moved[cross] + moved[crossSize]);
                result.guides.push(
                  axis === "x"
                    ? { type: "line", x1: value, y1: lo, x2: value, y2: hi }
                    : { type: "line", x1: lo, y1: value, x2: hi, y2: value },
                );
              }
        } else {
          const segs = [];
          const prev = row.filter((t) => t[axis] + t[size] <= moved[axis] + 0.5).at(-1),
            next = row.find((t) => t[axis] >= moved[axis] + moved[size] - 0.5);
          if (prev && Math.abs(moved[axis] - prev[axis] - prev[size] - best.gap) < 0.5)
            segs.push([prev[axis] + prev[size], moved[axis]]);
          if (next && Math.abs(next[axis] - moved[axis] - moved[size] - best.gap) < 0.5)
            segs.push([moved[axis] + moved[size], next[axis]]);
          if (best.ref) segs.push([best.ref.a[axis] + best.ref.a[size], best.ref.b[axis]]);
          const mid = moved[cross] + moved[crossSize] / 2;
          for (const [a, b] of segs)
            result.guides.push(
              axis === "x"
                ? { type: "gap", x1: a, y1: mid, x2: b, y2: mid, label: Math.round(best.gap) }
                : { type: "gap", x1: mid, y1: a, x2: mid, y2: b, label: Math.round(best.gap) },
            );
        }
      }
      return result;
    }
    function drawGuides(guides, className = "") {
      guideSvg.replaceChildren();
      guideLabels.replaceChildren();
      overlay.dataset.guides = String(guides.length);
      for (const g of guides) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", toScreenX(g.x1));
        line.setAttribute("y1", toScreenY(g.y1));
        line.setAttribute("x2", toScreenX(g.x2));
        line.setAttribute("y2", toScreenY(g.y2));
        line.setAttribute("class", "guide guide-" + g.type + (className ? " " + className : ""));
        guideSvg.append(line);
        // Alignment guides end in small dots on the aligned points (Wonder TR4).
        if (g.type === "line")
          for (const [x, y] of [
            [g.x1, g.y1],
            [g.x2, g.y2],
          ]) {
            const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            dot.setAttribute("cx", toScreenX(x));
            dot.setAttribute("cy", toScreenY(y));
            dot.setAttribute("r", 2);
            dot.setAttribute("class", "guide-dot");
            guideSvg.append(dot);
          }
        if (g.label !== undefined) {
          const label = document.createElement("span");
          label.className = "guide-label";
          label.textContent = String(g.label);
          label.dataset.axis = Math.abs(g.x2 - g.x1) >= Math.abs(g.y2 - g.y1) ? "x" : "y";
          if (className) label.classList.add(className);
          label.style.left = (toScreenX(g.x1) + toScreenX(g.x2)) / 2 + "px";
          label.style.top = (toScreenY(g.y1) + toScreenY(g.y2)) / 2 + "px";
          guideLabels.append(label);
        }
      }
    }

    function unbindKeys(node, keys) {
      if (!node.bindings) return;
      for (const key of keys) if (key) delete node.bindings[key];
      if (!Object.keys(node.bindings).length) delete node.bindings;
    }
    // Resize, rotate and the selection chrome (label, badge, ⊕ chip, multi-selection box) live in selection-chrome.js.
    const chrome = window.BetterSelectionChrome.install({
      ed,
      cam,
      wrap,
      overlay,
      workspace,
      find,
      sel,
      track,
      gesture,
      isFlow,
      unbindKeys,
      elementOf,
      worldRect,
      drawGuides,
      showHover,
      getTool: () => tool,
      previewParent: (id) => (layerPreview?.ids.includes(id) ? layerPreview.parentId : undefined),
    });
    const baseMeasurement = ed.updateMeasurement;
    ed.updateMeasurement = () => {
      baseMeasurement();
      chrome.draw();
    };
    function startResize(e, id, corner) {
      chrome.startResize(e, id, corner);
    }

    function startMarquee(e, scope = null, onClick) {
      const additive = e.shiftKey,
        base = additive ? new Set(sel()) : new Set();
      if (!additive) {
        drilled.clear();
        if (sel().size) select([]);
      }
      const p0 = screenToWorld(e.clientX, e.clientY);
      let dragged = false;
      track(
        e,
        (ev) => {
          if (!dragged && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
          dragged = true;
          const p1 = screenToWorld(ev.clientX, ev.clientY);
          const rect = {
            x: Math.min(p0.x, p1.x),
            y: Math.min(p0.y, p1.y),
            w: Math.abs(p1.x - p0.x),
            h: Math.abs(p1.y - p0.y),
          };
          showMarquee(rect);
          const hits = ed
            .nodes()
            .filter((n) => (n.parentId || null) === scope && !n.hidden && !n.locked)
            .filter((n) => {
              const r = worldRect(n.id);
              return r && intersects(rect, r);
            })
            .map((n) => n.id);
          const next = new Set([...base, ...hits]);
          if (next.size !== sel().size || [...next].some((id) => !sel().has(id))) select(next);
        },
        () => {
          marqueeBox.hidden = true;
          if (!dragged) onClick?.();
        },
      );
    }
    function showMarquee(rect, kind = "select") {
      marqueeBox.hidden = false;
      marqueeBox.dataset.kind = kind;
      Object.assign(marqueeBox.style, {
        left: toScreenX(rect.x) + "px",
        top: toScreenY(rect.y) + "px",
        width: rect.w * cam.zoom + "px",
        height: rect.h * cam.zoom + "px",
      });
    }

    function frameAt(clientX, clientY) {
      for (const el of document.elementsFromPoint(clientX, clientY)) {
        if (!canvas.contains(el) || !el.classList.contains("frame-layer")) continue;
        const n = find(el.dataset.id);
        if (n && !n.locked && !n.hidden) return n;
      }
      return null;
    }
    function startDraw(e) {
      const kind = tool,
        p0 = screenToWorld(e.clientX, e.clientY),
        parent = frameAt(e.clientX, e.clientY);
      let last = p0;
      const rectFor = (p1, square) => {
        let w = p1.x - p0.x,
          h = p1.y - p0.y;
        if (square) {
          const m = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * m;
          h = Math.sign(h || 1) * m;
        }
        return {
          x: Math.min(p0.x, p0.x + w),
          y: Math.min(p0.y, p0.y + h),
          w: Math.abs(w),
          h: Math.abs(h),
        };
      };
      let square = false;
      track(
        e,
        (ev) => {
          last = screenToWorld(ev.clientX, ev.clientY);
          square = ev.shiftKey;
          showMarquee(rectFor(last, square), "draw");
        },
        () => {
          marqueeBox.hidden = true;
          let r = rectFor(last, square);
          if (kind === "text") {
            setTool("move");
            createText(r, r.w * cam.zoom < 3 && r.h * cam.zoom < 3, parent, e.clientX, e.clientY);
            return;
          }
          if (r.w * cam.zoom < 3 && r.h * cam.zoom < 3) {
            const size = {
              frame: [100, 100],
              rectangle: [200, 150],
              ellipse: [200, 200],
              text: [240, 60],
              shader: [480, 300],
            }[kind];
            r = { x: p0.x, y: p0.y, w: size[0], h: size[1] };
          }
          r.w = Math.max(10, r.w);
          r.h = Math.max(10, r.h);
          let x = r.x,
            y = r.y;
          if (parent) {
            const pr = worldRect(parent.id);
            if (pr) {
              x = r.x - pr.x - (parent.strokeWidth || 0);
              y = r.y - pr.y - (parent.strokeWidth || 0);
            }
          }
          const extra = {
            x: Math.round(x),
            y: Math.round(y),
            w: Math.round(r.w),
            h: Math.round(r.h),
            parentId: parent?.id || null,
          };
          if (kind === "shader") Object.assign(extra, { name: "Aurora shader", color: "#a58bdd" });
          setTool("move");
          if (kind === "ellipse") insertEllipse(extra);
          else ed.add(kind, extra);
        },
      );
    }

    // Alt-hover distance measurement.
    let lastHover = null;
    wrap.addEventListener("pointermove", (e) => {
      lastHover = e;
      if (e.buttons) return;
      hoverPoint = { x: e.clientX, y: e.clientY, deep: deepSelect(e) };
      refreshHover();
      if (e.altKey) measureTo(e);
      else if (overlay.dataset.measuring) {
        overlay.dataset.measuring = "";
        drawGuides([]);
      }
    });
    function measureTo(e) {
      if (chrome.busy()) return; // no distance guides during a resize or rotate gesture
      const a = union(topSelected().map((n) => worldRect(n.id)));
      if (!a) return;
      const el = e.target.closest?.("#canvas .layer");
      let id = el?.dataset.id;
      if (!id || sel().has(id)) id = topSelected()[0]?.parentId;
      const b = id ? worldRect(id) : null;
      overlay.dataset.measuring = "1";
      if (!b) {
        drawGuides([]);
        return;
      }
      const guides = [],
        cy = a.y + a.h / 2,
        cx = a.x + a.w / 2;
      const inside = b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h;
      const seg = (x1, y1, x2, y2) => {
        const len = Math.abs(x2 - x1) + Math.abs(y2 - y1);
        if (len > 0.01) guides.push({ type: "measure", x1, y1, x2, y2, label: Math.round(len) });
      }; // Wonder TR5: whole numbers
      const extend = (x1, y1, x2, y2) => {
        if (Math.abs(x2 - x1) + Math.abs(y2 - y1) > 0.01)
          guides.push({ type: "extend", x1, y1, x2, y2 });
      };
      if (inside) {
        seg(b.x, cy, a.x, cy);
        seg(a.x + a.w, cy, b.x + b.w, cy);
        seg(cx, b.y, cx, a.y);
        seg(cx, a.y + a.h, cx, b.y + b.h);
      } else {
        if (b.x >= a.x + a.w) seg(a.x + a.w, cy, b.x, cy);
        else if (a.x >= b.x + b.w) seg(b.x + b.w, cy, a.x, cy);
        if (b.y >= a.y + a.h) seg(cx, a.y + a.h, cx, b.y);
        else if (a.y >= b.y + b.h) seg(cx, b.y + b.h, cx, a.y);
        // Wonder (TR5): when the hovered layer sits above/below the selection, its side edges are extended (dashed) to the
        // selection's centre line and the edge offsets are labelled; the same rotated when it sits beside the selection.
        const overlapX = b.x < a.x + a.w && a.x < b.x + b.w,
          overlapY = b.y < a.y + a.h && a.y < b.y + b.h;
        if (overlapX && !overlapY) {
          const edge = b.y + b.h <= a.y ? b.y + b.h : b.y;
          if (a.x > b.x) {
            extend(b.x, edge, b.x, cy);
            seg(b.x, cy, a.x, cy);
          }
          if (b.x + b.w > a.x + a.w) {
            extend(b.x + b.w, edge, b.x + b.w, cy);
            seg(a.x + a.w, cy, b.x + b.w, cy);
          }
        } else if (overlapY && !overlapX) {
          const edge = b.x + b.w <= a.x ? b.x + b.w : b.x;
          if (a.y > b.y) {
            extend(edge, b.y, cx, b.y);
            seg(cx, b.y, cx, a.y);
          }
          if (b.y + b.h > a.y + a.h) {
            extend(edge, b.y + b.h, cx, b.y + b.h);
            seg(cx, a.y + a.h, cx, b.y + b.h);
          }
        }
      }
      drawGuides(guides, "measure");
    }

    // Name labels above top-level frames (artboards); drag a label to move its frame.
    // Placed from document geometry, not layout: a top-level frame's box is its x/y/w/h (border-box), turned about its
    // centre by its rotation, and the label sits on the top-left of that box's axis-aligned bounds. Only a rotated frame
    // whose size layout can change (hug/fill, min/max, aspect ratio) reads its laid-out size, and all reads come before
    // any write. Labels are keyed by frame id and reused, so a camera move only repositions them; labels outside the
    // viewport are detached.
    const LABEL_MAX_W = 240,
      LABEL_H = 16,
      LABEL_GAP = 18; // canvas.css .frame-label: max-width, line-height; offset above
    const laidOut = (n) =>
      ["wMode", "hMode"].some((k) => n[k] && n[k] !== "fixed") ||
      ["minW", "maxW", "minH", "maxH"].some((k) => n[k] !== undefined && n[k] !== null) ||
      n.wPct !== undefined ||
      n.hPct !== undefined ||
      Number(n.aspectRatio) > 0;
    function frameCorner(n) {
      let x = Number(n.x) || 0,
        y = Number(n.y) || 0,
        w = Number(n.w) || 0,
        h = Number(n.h) || 0;
      const a = ((Number(n.rotation) || 0) * Math.PI) / 180;
      if (!a) return { x, y, w, h };
      const el = laidOut(n) && elementOf(n.id);
      if (el) {
        w = el.offsetWidth;
        h = el.offsetHeight;
      }
      const c = Math.abs(Math.cos(a)),
        s = Math.abs(Math.sin(a)),
        bw = w * c + h * s,
        bh = w * s + h * c;
      return { x: x + (w - bw) / 2, y: y + (h - bh) / 2, w: bw, h: bh };
    }
    function frameLabelDown(e) {
      if (e.button !== 0 || space || tool === "hand") return;
      e.stopPropagation();
      const id = e.currentTarget.dataset.id;
      select(e.shiftKey ? [...sel(), id] : [id]);
      if (!e.shiftKey && !readOnly()) startMove(e);
    }
    function drawFrameLabels() {
      const selection = sel(),
        single = selection.size === 1;
      const visible = [];
      for (const n of ed.nodes()) {
        if (
          n.parentId ||
          n.type !== "frame" ||
          n.hidden ||
          n.preview ||
          n.labelHidden ||
          (single && selection.has(n.id))
        )
          continue;
        const r = frameCorner(n);
        if (!r.w && !r.h) continue;
        const left = toScreenX(r.x),
          top = toScreenY(r.y) - LABEL_GAP;
        if (
          labelView &&
          (left >= labelView.w ||
            left + LABEL_MAX_W <= 0 ||
            top >= labelView.h ||
            top + LABEL_H <= 0)
        )
          continue;
        visible.push({ n, left, top });
      }
      let shown = 0;
      for (const { n, left, top } of visible) {
        let entry = frameLabelOf.get(n.id);
        if (!entry) {
          const el = document.createElement("span");
          el.dataset.id = n.id;
          el.onpointerdown = frameLabelDown;
          frameLabelOf.set(n.id, (entry = { el }));
        }
        const el = entry.el,
          className =
            "frame-label" +
            (selection.has(n.id) ? " selected" : "") +
            (n.id === hoverId ? " hovered" : "") +
            (n.component === true ? " is-main" : n.instanceOf ? " is-instance" : "");
        if (el.className !== className) el.className = className;
        if (entry.name !== n.name) {
          el.textContent = n.name;
          entry.name = n.name;
        }
        if (entry.left !== left) {
          el.style.left = left + "px";
          entry.left = left;
        }
        if (entry.top !== top) {
          el.style.top = top + "px";
          entry.top = top;
        }
        if (frameLabels.children[shown] !== el)
          frameLabels.insertBefore(el, frameLabels.children[shown] || null);
        shown++;
      }
      while (frameLabels.children.length > shown) frameLabels.lastElementChild.remove();
      if (frameLabelOf.size > shown)
        for (const [id, entry] of frameLabelOf)
          if (!entry.el.isConnected && !find(id)) frameLabelOf.delete(id);
    }

    // ---------- Structure commands ----------
    function insertOrdered(list, items, index) {
      list.splice(index, 0, ...items);
    }
    function duplicateNodes(ids, offset = 20) {
      const all = new Set(ids.flatMap((id) => [...ed.descendants(id)])),
        mapping = new Map([...all].map((id) => [id, ed.uid()]));
      const copies = ed
        .nodes()
        .filter((n) => all.has(n.id))
        .map((n) => ({
          ...structuredClone(n),
          id: mapping.get(n.id),
          parentId: mapping.get(n.parentId) || n.parentId,
          x: n.x + (all.has(n.parentId) ? 0 : offset),
          y: n.y + (all.has(n.parentId) ? 0 : offset),
        }));
      window.VerynizeComponents?.adoptCopies(ed.design, copies, mapping); // a copy of a main is an instance of it
      ed.nodes().push(...copies);
      const result = ids.map((id) => mapping.get(id));
      hooks.duplicated?.(result);
      ed.setSelection(new Set(result));
      return result;
    }
    function frameSelection() {
      const list = topSelected();
      if (!list.length) return null;
      const parentId = list[0].parentId || null;
      if (!list.every((n) => (n.parentId || null) === parentId)) {
        footer("Frame layers that share the same parent.");
        return null;
      }
      const parent = find(parentId),
        all = ed.nodes(),
        flow = isFlow(parent);
      const local = new Map(
        list.map((n) => {
          const el = elementOf(n.id);
          return [
            n.id,
            flow && el
              ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }
              : { x: n.x, y: n.y, w: n.w, h: n.h },
          ];
        }),
      );
      const b = union([...local.values()]);
      ed.checkpoint();
      const frame = {
        ...ed.defaults,
        id: ed.uid(),
        type: "frame",
        name: "Frame",
        parentId,
        x: Math.round(b.x * 100) / 100,
        y: Math.round(b.y * 100) / 100,
        w: Math.max(1, b.w),
        h: Math.max(1, b.h),
        color: "transparent",
        text: "",
        radius: 0,
        padding: 0,
        layout: "free",
      };
      for (const n of list) {
        const r = local.get(n.id);
        n.parentId = frame.id;
        n.x = r.x - b.x;
        n.y = r.y - b.y;
      }
      const index = Math.max(...list.map((n) => all.indexOf(n)));
      insertOrdered(all, [frame], index + 1);
      ed.setSelection(new Set([frame.id]));
      ed.render();
      return frame;
    }
    function unframeSelection() {
      const frames = topSelected().filter((n) => n.type === "frame");
      if (!frames.length) return;
      ed.checkpoint();
      const released = [];
      for (const f of frames) {
        const all = ed.nodes(),
          kids = all.filter((n) => n.parentId === f.id),
          parent = find(f.parentId);
        const offsets = new Map(
          kids.map((k) => {
            const el = elementOf(k.id);
            return [k.id, el ? { x: el.offsetLeft, y: el.offsetTop } : { x: k.x, y: k.y }];
          }),
        );
        for (const k of kids) {
          const o = isFlow(f) ? offsets.get(k.id) : { x: k.x, y: k.y };
          k.x = f.x + (f.strokeWidth || 0) + o.x;
          k.y = f.y + (f.strokeWidth || 0) + o.y;
          k.parentId = f.parentId || null;
          if (!isFlow(parent) && k.wMode === "fill") k.wMode = "fixed";
          if (!isFlow(parent) && k.hMode === "fill") k.hMode = "fixed";
        }
        const kidSet = new Set(kids),
          next = [];
        for (const n of all) {
          if (n === f) next.push(...kids);
          else if (!kidSet.has(n)) next.push(n);
        }
        ed.page().nodes = next;
        released.push(...kids.map((k) => k.id));
      }
      ed.setSelection(new Set(released));
      ed.render();
    }
    function addAutoLayout() {
      let list = topSelected();
      if (!list.length) return;
      let frame = list.length === 1 && list[0].type === "frame" ? list[0] : null;
      if (frame && isFlow(frame)) return;
      if (!frame) {
        frame = frameSelection();
        if (!frame) return;
      } else ed.checkpoint();
      const kids = ed.nodes().filter((n) => n.parentId === frame.id && !n.hidden);
      const center = (n, axis) => n[axis] + n[axis === "x" ? "w" : "h"] / 2;
      const spread = (axis) =>
        kids.length
          ? Math.max(...kids.map((n) => center(n, axis))) -
            Math.min(...kids.map((n) => center(n, axis)))
          : 0;
      const direction = spread("x") >= spread("y") ? "row" : "column",
        axis = direction === "row" ? "x" : "y",
        size = axis === "x" ? "w" : "h";
      const sorted = kids.toSorted((a, b) => a[axis] - b[axis]);
      const gaps = sorted.slice(1).map((n, i) => n[axis] - sorted[i][axis] - sorted[i][size]);
      const gap = gaps.length
        ? Math.max(0, Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length))
        : 16;
      const padding = kids.length
        ? Math.max(
            0,
            Math.round(
              Math.min(
                ...kids.flatMap((n) => [n.x, n.y, frame.w - n.x - n.w, frame.h - n.y - n.h]),
              ),
            ),
          )
        : 16;
      reorderSiblings(frame.id, () => [
        ...sorted,
        ...ed.nodes().filter((n) => n.parentId === frame.id && !sorted.includes(n)),
      ]);
      Object.assign(frame, {
        layout: "flex",
        direction,
        gap,
        padding,
        alignItems: "flex-start",
        justifyContent: "flex-start",
        wMode: "hug",
        hMode: "hug",
      });
      ed.setSelection(new Set([frame.id]));
      ed.render();
    }
    function removeAutoLayout() {
      const frames = topSelected().filter(isFlow);
      if (!frames.length) return;
      ed.checkpoint();
      for (const f of frames) {
        for (const k of ed.nodes().filter((n) => n.parentId === f.id)) {
          const el = elementOf(k.id);
          if (el) {
            k.x = el.offsetLeft;
            k.y = el.offsetTop;
            if (el.offsetWidth) {
              k.w = el.offsetWidth;
              k.h = el.offsetHeight;
            }
          }
          if (k.wMode === "fill") k.wMode = "fixed";
          if (k.hMode === "fill") k.hMode = "fixed";
        }
        f.layout = "free";
        if (f.wMode === "hug") f.wMode = "fixed";
        if (f.hMode === "hug") f.hMode = "fixed";
      }
      ed.render();
    }
    function reorderSiblings(parentId, order) {
      const all = ed.nodes(),
        siblings = all.filter((n) => (n.parentId || null) === (parentId || null));
      const slots = siblings.map((n) => all.indexOf(n)),
        next = order(siblings);
      slots.forEach((slot, i) => {
        all[slot] = next[i];
      });
    }
    function arrange(mode) {
      const list = selectedNodes();
      if (!list.length) return;
      ed.checkpoint();
      for (const parentId of new Set(list.map((n) => n.parentId || null)))
        reorderSiblings(parentId, (siblings) => {
          const order = siblings.slice(),
            picked = (n) => sel().has(n.id);
          if (mode === "front")
            return [...order.filter((n) => !picked(n)), ...order.filter(picked)];
          if (mode === "back") return [...order.filter(picked), ...order.filter((n) => !picked(n))];
          if (mode === "forward") {
            for (let i = order.length - 2; i >= 0; i--)
              if (picked(order[i]) && !picked(order[i + 1]))
                [order[i], order[i + 1]] = [order[i + 1], order[i]];
          } else
            for (let i = 1; i < order.length; i++)
              if (picked(order[i]) && !picked(order[i - 1]))
                [order[i], order[i - 1]] = [order[i - 1], order[i]];
          return order;
        });
      ed.render();
    }
    function toggleFlag(key) {
      const list = selectedNodes();
      if (!list.length) return;
      ed.checkpoint();
      const value = !list.every((n) => n[key]);
      for (const n of list) {
        if (value) n[key] = true;
        else delete n[key];
      }
      ed.render();
    }
    // Normalize an angle to (-180, 180].
    const angle = (a) => {
      const r = ((((Math.round(a * 100) / 100 + 180) % 360) + 360) % 360) - 180;
      return r === -180 ? 180 : r || 0;
    };
    // Flip (⇧H / ⇧V): mirror each layer in place (flipX/flipY = negative scale). Mirroring a rotated layer on screen
    // negates its rotation. Several free-positioned siblings flip as a group: positions mirror across their bounds.
    function flip(axis) {
      const list = topSelected().filter((n) => !n.locked);
      if (!list.length) return false;
      ed.checkpoint();
      const key = axis === "x" ? "flipX" : "flipY",
        size = axis === "x" ? "w" : "h";
      const parentId = list[0].parentId || null,
        parent = find(parentId);
      if (
        list.length > 1 &&
        !isFlow(parent) &&
        list.every((n) => (n.parentId || null) === parentId)
      ) {
        const lo = Math.min(...list.map((n) => n[axis])),
          hi = Math.max(...list.map((n) => n[axis] + n[size]));
        for (const n of list) n[axis] = Math.round((lo + hi - n[axis] - n[size]) * 100) / 100;
      }
      for (const n of list) {
        if (n[key]) delete n[key];
        else n[key] = true;
        if (Number(n.rotation)) n.rotation = angle(-n.rotation);
      }
      ed.render();
      return true;
    }
    function rotate90(direction = 1) {
      const list = topSelected().filter((n) => !n.locked);
      if (!list.length) return false;
      ed.checkpoint();
      for (const n of list) n.rotation = angle((Number(n.rotation) || 0) + 90 * direction);
      ed.render();
      return true;
    }

    // ---------- Re-parent / reorder (layers panel drag & drop) ----------
    // World position of a frame's content origin (inside its border). Ancestor rotation is ignored.
    function contentOrigin(id) {
      const n = id ? find(id) : null;
      if (!n) return { x: 0, y: 0 };
      const tl = layerOrigin(n),
        el = elementOf(n.id);
      return {
        x: tl.x + (el ? el.clientLeft : Number(n.strokeWidth) || 0),
        y: tl.y + (el ? el.clientTop : Number(n.strokeWidth) || 0),
      };
    }
    function layerOrigin(n) {
      const o = contentOrigin(n.parentId),
        el = elementOf(n.id);
      if (isFlow(find(n.parentId)) && n.position !== "absolute" && el && el.offsetParent)
        return { x: o.x + el.offsetLeft, y: o.y + el.offsetTop };
      return { x: o.x + n.x, y: o.y + n.y };
    }
    /**
     * Move layers next to (`above` = in front of, `below` = behind) or `inside` (frontmost child of) a target layer,
     * as in the layers panel where the top row is frontmost. Keeps world positions when the parent changes, keeps the
     * moved layers' relative order, skips locked layers and refuses drops into a locked or moved frame. One undo step.
     * Returns the moved ids, or null when nothing could move.
     */
    function moveNodes(ids, targetId, position) {
      const all = ed.nodes(),
        target = targetId ? find(targetId) : null;
      if (!["above", "below", "inside"].includes(position) || (targetId && !target)) return null;
      const wanted = new Set(ids);
      let roots = all.filter((n) => wanted.has(n.id) && !n.locked);
      roots = window.VerynizeNodeIndex.of(all).topmost(roots);
      if (!roots.length) return null;
      const parentId =
          position === "inside" ? (target ? target.id : null) : target?.parentId || null,
        parent = find(parentId);
      if (position === "inside" && target && target.type !== "frame") return null;
      if (parent && (parent.locked || roots.some((n) => ed.descendants(n.id).has(parent.id))))
        return null;
      if (target && position !== "inside" && roots.includes(target)) {
        // Dropping next to a dragged layer: anchor on the nearest sibling that is not being moved.
        const siblings = all.filter((n) => (n.parentId || null) === parentId),
          i = siblings.indexOf(target);
        const step = position === "above" ? 1 : -1;
        let j = i;
        while (siblings[j] && roots.includes(siblings[j])) j += step;
        if (siblings[j])
          return moveNodes(ids, siblings[j].id, position === "above" ? "below" : "above");
        // Every sibling on that side moves: drop at the very front / back of the parent.
        return moveRoots(roots, parentId, position === "above" ? "front" : "back");
      }
      return moveRoots(
        roots,
        parentId,
        position === "inside" ? "front" : { target, after: position === "above" },
      );
    }
    function moveRoots(roots, parentId, where) {
      if (
        roots.some((n) => (n.parentId || null) !== (parentId || null)) &&
        refusesCycle(subtreeOf(roots), parentId)
      )
        return null;
      const before = ed.snapshot(),
        all = ed.nodes(),
        parent = find(parentId),
        origin = contentOrigin(parentId);
      const plan = roots.map((n) => {
        const world = layerOrigin(n),
          next = {
            x: Math.round((world.x - origin.x) * 100) / 100,
            y: Math.round((world.y - origin.y) * 100) / 100,
          };
        return { n, same: (n.parentId || null) === (parentId || null), ...next };
      });
      const order = all.filter((n) => !roots.includes(n));
      let index;
      if (where === "front") index = order.length;
      else if (where === "back") {
        const first = order.find((n) => (n.parentId || null) === (parentId || null));
        index = first ? order.indexOf(first) : order.length;
      } else index = order.indexOf(where.target) + (where.after ? 1 : 0);
      order.splice(index, 0, ...roots);
      const candidate = structuredClone(ed.design),
        page = candidate.pages.find((p) => p.id === ed.page().id),
        byId = new Map(page.nodes.map((n) => [n.id, n]));
      page.nodes = order.map((n) => byId.get(n.id));
      for (const step of plan) {
        const c = byId.get(step.n.id);
        c.parentId = parentId || null;
        if (!step.same) {
          c.x = step.x;
          c.y = step.y;
        }
      }
      try {
        ed.validate(candidate);
      } catch (error) {
        footer("Unable to move layers: " + error.message);
        return null;
      }
      all.splice(0, all.length, ...order);
      for (const { n, same, x, y } of plan) {
        if (same) continue;
        n.parentId = parentId || null;
        n.x = x;
        n.y = y;
        if (!isFlow(parent)) {
          if (n.wMode === "fill") n.wMode = "fixed";
          if (n.hMode === "fill") n.hMode = "fixed";
        }
      }
      ed.pushHistory(before);
      ed.setSelection(new Set(roots.map((n) => n.id)));
      ed.render();
      return roots.map((n) => n.id);
    }

    function selectInverse() {
      const scope = selectedNodes()[0]?.parentId || null;
      select(
        ed
          .nodes()
          .filter(
            (n) => (n.parentId || null) === scope && !n.hidden && !n.locked && !sel().has(n.id),
          )
          .map((n) => n.id),
      );
    }
    // Select all matching layers: same kind (type, ellipse, icon) on the page.
    function selectMatching() {
      const kind = (n) => [n.type, n.ellipse ? "ellipse" : "", n.icon ? "icon" : ""].join(":"),
        wanted = new Set(selectedNodes().map(kind));
      if (!wanted.size) return;
      select(
        ed
          .nodes()
          .filter((n) => wanted.has(kind(n)) && !n.hidden && !n.locked)
          .map((n) => n.id),
      );
    }

    // ---------- Navigation ----------
    function selectChildren() {
      const list = selectedNodes();
      if (!list.length) return;
      if (list.length === 1 && list[0].type === "text") {
        editText();
        return;
      }
      const kids = ed.nodes().filter((n) => sel().has(n.parentId) && !n.hidden);
      if (!kids.length) return;
      list.forEach((n) => drilled.add(n.id));
      select(kids.map((n) => n.id));
    }
    function selectParent() {
      const parents = [
        ...new Set(
          selectedNodes()
            .map((n) => n.parentId)
            .filter(Boolean),
        ),
      ];
      if (parents.length) {
        parents.forEach((id) => drilled.delete(id));
        select(parents);
      }
    }
    function cycleSibling(step) {
      const current = selectedNodes()[0];
      const siblings = ed
        .nodes()
        .filter(
          (n) => (n.parentId || null) === (current ? current.parentId || null : null) && !n.hidden,
        )
        .toReversed();
      if (!siblings.length) return;
      const i = current ? siblings.indexOf(current) : -1;
      select([siblings[(i + step + siblings.length) % siblings.length].id]);
    }
    function selectAll() {
      const scope = selectedNodes()[0]?.parentId || null;
      select(
        ed
          .nodes()
          .filter((n) => (n.parentId || null) === scope && !n.hidden && !n.locked)
          .map((n) => n.id),
      );
    }

    // ---------- Clipboard ----------
    function serializeSelection() {
      const roots = topSelected();
      if (!roots.length) return null;
      const ids = new Set(roots.flatMap((n) => [...ed.descendants(n.id)]));
      const list = ed
        .nodes()
        .filter((n) => ids.has(n.id))
        .map((n) => structuredClone(n));
      const tokens = {};
      for (const n of list)
        if (n.token && ed.design.tokens[n.token]) tokens[n.token] = ed.design.tokens[n.token];
      const world = {};
      for (const n of roots) {
        const r = worldRect(n.id);
        if (r) world[n.id] = { x: r.x, y: r.y };
      }
      return {
        format: CLIP_MARKER,
        version: 1,
        page: ed.page().id,
        roots: roots.map((n) => n.id),
        nodes: list,
        tokens,
        world,
      };
    }
    function writeSystemClipboard(text, extra = {}) {
      let written = false;
      const onCopy = (e) => {
        e.clipboardData.setData("text/plain", text);
        for (const [type, value] of Object.entries(extra)) e.clipboardData.setData(type, value);
        e.preventDefault();
        written = true;
      };
      document.addEventListener("copy", onCopy);
      try {
        document.execCommand("copy");
      } catch {}
      document.removeEventListener("copy", onCopy);
      if (!written) navigator.clipboard?.writeText(text).catch(() => {});
    }
    function copy() {
      const data = serializeSelection();
      if (!data) return false;
      clipboard = data;
      writeSystemClipboard(JSON.stringify(data));
      footer(`Copied ${data.roots.length} layer${data.roots.length === 1 ? "" : "s"}`);
      return true;
    }
    function cut() {
      if (copy()) $("#delete")?.click();
    }
    // Copy as PNG: 2× raster of the selection on the system clipboard. When the async clipboard API may not write
    // images (the desktop shell denies clipboard permissions), the PNG goes out as an HTML <img> with a data URL.
    async function copyAsPng() {
      if (!sel().size) return false;
      let result;
      try {
        result = await ed.exportArtwork({ format: "PNG", scale: 2, selectionOnly: true });
      } catch (error) {
        footer("Unable to copy as PNG: " + (error?.message || error));
        return false;
      }
      const size = `${result.width} × ${result.height}`;
      try {
        if (window.desktop?.writeClipboardImage)
          await window.desktop.writeClipboardImage(result.dataURL);
        else {
          const bytes = Uint8Array.from(atob(String(result.dataURL).split(",")[1] || ""), (c) =>
            c.charCodeAt(0),
          );
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) }),
          ]);
        }
        footer(`Copied ${size} PNG`);
      } catch {
        writeSystemClipboard(result.dataURL, {
          "text/html": `<img src="${result.dataURL}" width="${result.width / 2}" height="${result.height / 2}" alt="">`,
        });
        footer(`Copied ${size} PNG as an HTML image`);
      }
      return true;
    }
    // Copy as code: standalone HTML of the selection (inline styles, same renderer as export).
    async function copyAsCode() {
      if (!sel().size) return false;
      try {
        const result = await ed.exportArtwork({ format: "HTML", selectionOnly: true });
        writeSystemClipboard(result.content);
        footer("Copied selection as HTML");
        return true;
      } catch (error) {
        footer("Unable to copy as code: " + (error?.message || error));
        return false;
      }
    }
    function parseClipboard(text) {
      try {
        const data = JSON.parse(text);
        return data?.format === CLIP_MARKER &&
          Array.isArray(data.nodes) &&
          Array.isArray(data.roots)
          ? data
          : null;
      } catch {
        return null;
      }
    }
    function paste(data = clipboard, { inPlace = false } = {}) {
      if (!data) return false;
      const ids = new Map(data.nodes.map((n) => [n.id, ed.uid()])),
        roots = new Set(data.roots);
      const target =
        !inPlace &&
        sel().size === 1 &&
        selectedNodes()[0].type === "frame" &&
        !roots.has(selectedNodes()[0].id)
          ? selectedNodes()[0]
          : null;
      const copies = data.nodes.map((n) => ({
        ...structuredClone(n),
        id: ids.get(n.id),
        parentId: ids.get(n.parentId) || n.parentId || null,
      }));
      window.VerynizeComponents?.adoptCopies(ed.design, copies, ids);
      const originalOf = new Map([...ids].map(([from, to]) => [to, from]));
      const placed = copies.filter((n) => roots.has(originalOf.get(n.id)));
      for (const n of placed) {
        const original = originalOf.get(n.id);
        if (target) {
          n.parentId = target.id;
          continue;
        }
        if (n.parentId && !find(n.parentId)) {
          const w = data.world?.[original];
          n.parentId = null;
          if (w) {
            n.x = w.x;
            n.y = w.y;
          }
        }
      }
      // Normal paste lands in place when visible; otherwise it is centered in the viewport.
      const tops = placed.filter((n) => !n.parentId);
      if (!inPlace && !target && tops.length) {
        const b = union(tops.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })));
        if (!intersects(b, visibleWorld())) {
          const p = placeInView(b.w, b.h);
          for (const n of tops) {
            n.x += p.x - b.x;
            n.y += p.y - b.y;
          }
        }
      }
      if (target && refusesCycle(copies, target.id)) return false;
      const candidate = structuredClone(ed.design);
      candidate.pages.find((p) => p.id === ed.page().id).nodes.push(...structuredClone(copies));
      for (const [k, v] of Object.entries(data.tokens || {}))
        if (!candidate.tokens[k]) candidate.tokens[k] = v;
      try {
        ed.validate(candidate);
      } catch (error) {
        footer("Unable to paste: " + error.message);
        return false;
      }
      ed.checkpoint();
      for (const [k, v] of Object.entries(data.tokens || {}))
        if (!ed.design.tokens[k]) ed.design.tokens[k] = v;
      ed.nodes().push(...copies.map((n) => ({ ...ed.defaults, ...n })));
      ed.setSelection(new Set(placed.map((n) => n.id)));
      ed.render();
      return true;
    }
    function requestPaste(inPlace) {
      // Let the native paste event deliver the system clipboard; fall back to the in-app clipboard.
      clearTimeout(pasteTimer);
      pasteTimer = setTimeout(() => {
        pasteTimer = null;
        suppressPasteUntil = Date.now() + 1000;
        paste(clipboard, { inPlace });
      }, 120);
      pendingInPlace = inPlace;
    }
    document.addEventListener("paste", (e) => {
      if (
        typing(e.target) ||
        document.querySelector("dialog[open]") ||
        document.body.classList.contains("files-view")
      )
        return;
      const inPlace = pasteTimer !== null && pendingInPlace;
      clearTimeout(pasteTimer);
      pasteTimer = null;
      if (Date.now() < suppressPasteUntil) return;
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") || "";
      const data = parseClipboard(text);
      if (data) {
        clipboard = data;
        paste(data, { inPlace });
        return;
      }
      // Layers copied in Figma (binary scene in text/html), converted by web/figma-panel.js + the main process.
      const html = e.clipboardData?.getData("text/html") || "";
      if (window.figmaPaste?.accepts(html)) {
        window.figmaPaste.convert(html).then((layers) => {
          if (layers) paste(layers, { inPlace });
        });
        return;
      }
      const imageFiles = [...(e.clipboardData?.files || [])];
      try {
        window.imageUpload.batch(imageFiles);
      } catch (error) {
        footer(error.message);
        return;
      }
      if (imageFiles.length > 1) {
        const rect = document.getElementById("canvas-wrap").getBoundingClientRect();
        window.imageDrop.dropFiles(imageFiles, rect.x + rect.width / 2, rect.y + rect.height / 2);
        return;
      }
      const file = imageFiles[0];
      if (file) {
        const pageId = ed.page().id;
        window.imageUpload
          .prepare(file)
          .then((image) => {
            if (ed.page().id !== pageId) return;
            const w = Math.min(600, image.originalWidth),
              h = (w * image.originalHeight) / image.originalWidth,
              p = placeInView(w, h);
            ed.add("image", {
              name: file.name || "Pasted image",
              src: image.src,
              w,
              h,
              x: p.x,
              y: p.y,
              parentId: null,
              color: "transparent",
            });
          })
          .catch((error) => footer(error.message));
        return;
      }
      if (text.trim()) {
        const p = placeInView(320, 80);
        ed.add("text", {
          text: text.slice(0, 100000),
          name: "Pasted text",
          x: p.x,
          y: p.y,
          w: 320,
          h: 80,
          parentId: null,
        });
        return;
      }
      paste(clipboard, { inPlace });
    });
    function copyStyle() {
      const n = selectedNodes()[0];
      if (!n) return;
      styleClipboard = Object.fromEntries(STYLE_KEYS.map((k) => [k, structuredClone(n[k])]));
      footer("Copied style from " + n.name);
    }
    function pasteStyle() {
      if (!styleClipboard || !sel().size) return;
      ed.checkpoint();
      for (const n of selectedNodes())
        for (const [k, v] of Object.entries(styleClipboard))
          if (v !== undefined) n[k] = structuredClone(v);
      ed.render();
    }

    // ---------- Components (web/component-core.js; spec: design/component-audit/README.md "UI") ----------
    // The engine work is window.design.components (validated, one undo step each); this adds the canvas parts:
    // wrapping several layers before Create component, placing new instances, going to a main on another page,
    // and refusing moves that would make a main contain an instance of itself.
    const components = () => window.design?.components;
    const notice = (message) => {
      footer(message);
      window.dispatchEvent(new CustomEvent("bd:notice", { detail: { message } }));
    };
    const componentInfo = () =>
      sel().size === 1 ? components()?.info([...sel()][0]) || null : null;
    const insideMain = (n) => {
      for (let p = n && find(n.parentId); p; p = find(p.parentId))
        if (p.component === true) return true;
      return false;
    };
    /** Refuses (with a notice) placing the layers and their subtrees inside `parentId` when that makes a cycle. */
    function refusesCycle(nodes, parentId) {
      if (!parentId || !window.VerynizeComponents?.wouldCycle(ed.design, nodes, parentId))
        return false;
      notice("A main component cannot contain an instance of itself");
      return true;
    }
    const subtreeOf = (roots) =>
      roots
        .flatMap((n) => [...ed.descendants(n.id)])
        .map(find)
        .filter(Boolean);
    function createComponent() {
      const list = topSelected().filter((n) => !n.locked),
        api = components();
      if (!list.length || !api) return null;
      try {
        if (list.length === 1 && list[0].type === "frame") return api.create(list[0].id);
        // Several layers, or one that is not a frame: frame them first (Figma), in the same undo step.
        if (list.some((n) => n.sourceId))
          throw new Error("Detach the instance before making its layers a component");
        const frame = frameSelection();
        if (!frame) return null;
        frame.name = list.length === 1 ? list[0].name : "Component";
        window.VerynizeComponents.createComponent(ed.design, null, frame.id);
        ed.render();
        return frame.id;
      } catch (error) {
        notice(error.message);
        return null;
      }
    }
    function createInstance() {
      const info = componentInfo();
      if (!info?.mainId || info.missingMain || !["main", "instance"].includes(info.role))
        return null;
      const r = worldRect([...sel()][0]),
        p = r
          ? { x: Math.round(r.x + r.w + 40), y: Math.round(r.y) }
          : placeInView(find(info.mainId)?.w || 100, find(info.mainId)?.h || 100);
      try {
        return components().instance(info.mainId, { parentId: null, x: p.x, y: p.y });
      } catch (error) {
        notice(error.message);
        return null;
      }
    }
    /** Selects the main of the selected instance (switching page when it lives elsewhere) and zooms to it. */
    function goToMain(mainId = componentInfo()?.mainId) {
      if (!mainId) return false;
      const page = ed.design.pages.find((p) => p.nodes?.some((n) => n.id === mainId));
      if (!page) {
        notice("The main component is missing");
        return false;
      }
      if (page.id !== ed.page().id) window.design.setActivePage(page.id);
      select([mainId]);
      requestAnimationFrame(() => zoomToSelection());
      return true;
    }
    function resetOverrides() {
      const info = componentInfo();
      if (!info?.instanceId || !info.overrideCount) return false;
      components().reset([info.id], { all: info.role === "instance" });
      return true;
    }
    function detachInstance() {
      const info = componentInfo();
      if (info?.role !== "instance") return false;
      components().detach(info.id);
      return true;
    }
    function setSlot(on) {
      const n = selectedNodes()[0];
      if (!n) return false;
      try {
        components().setSlot(n.id, on);
      } catch (error) {
        notice(error.message);
        return false;
      }
      return true;
    }
    const canSlot = () => {
      const n = sel().size === 1 && selectedNodes()[0];
      return (
        !!n &&
        n.type === "frame" &&
        !n.sourceId &&
        !n.instanceOf &&
        n.component !== true &&
        n.slot !== true &&
        insideMain(n)
      );
    };
    const isMainSlot = () => {
      const n = sel().size === 1 && selectedNodes()[0];
      return !!n && n.slot === true && !n.sourceId;
    };
    const roleIs =
      (...roles) =>
      () =>
        roles.includes(componentInfo()?.role);

    // ---------- Command registry ----------
    const needsSelection = () => sel().size > 0;
    const commands = [
      { id: "tool.move", label: "Move", section: "Tools", keys: ["v"], run: () => setTool("move") },
      {
        id: "tool.scale",
        label: "Scale",
        section: "Tools",
        keys: ["k"],
        run: () => setTool("scale"),
      },
      { id: "tool.hand", label: "Hand", section: "Tools", keys: ["h"], run: () => setTool("hand") },
      {
        id: "tool.frame",
        label: "Frame",
        section: "Tools",
        keys: ["f"],
        run: () => setTool("frame"),
      },
      {
        id: "tool.rectangle",
        label: "Rectangle",
        section: "Tools",
        keys: ["r"],
        run: () => setTool("rectangle"),
      },
      { id: "tool.text", label: "Text", section: "Tools", keys: ["t"], run: () => setTool("text") },
      {
        id: "tool.shader",
        label: "Shader",
        section: "Tools",
        keys: ["s"],
        run: () => setTool("shader"),
      },
      {
        id: "tool.ellipse",
        label: "Ellipse",
        section: "Tools",
        keys: ["o"],
        run: () => setTool("ellipse"),
      },
      {
        id: "tool.eyedropper",
        label: "Eyedropper",
        section: "Tools",
        keys: ["i", "ctrl+c"],
        run: () => setTool(tool === "eyedropper" ? "move" : "eyedropper"),
      },
      { id: "tool.image", label: "Image", section: "Tools", keys: [], run: () => setTool("image") },
      // The toolbar Frame button arms the tool (Wonder); this keeps the one-step insert reachable.
      {
        id: "insert.frame",
        label: "Insert frame",
        section: "Tools",
        keys: [],
        run: () => ed.add("frame"),
      },
      {
        id: "edit.undo",
        label: "Undo",
        section: "Edit",
        keys: ["mod+z"],
        run: () => $("#undo")?.click(),
      },
      {
        id: "edit.redo",
        label: "Redo",
        section: "Edit",
        keys: ["mod+shift+z", "mod+y"],
        run: () => $("#redo")?.click(),
      },
      {
        id: "edit.copy",
        label: "Copy",
        section: "Edit",
        keys: ["mod+c"],
        when: needsSelection,
        run: copy,
      },
      {
        id: "edit.cut",
        label: "Cut",
        section: "Edit",
        keys: ["mod+x"],
        when: needsSelection,
        run: cut,
      },
      {
        id: "edit.paste",
        label: "Paste",
        section: "Edit",
        keys: ["mod+v"],
        native: true,
        run: () => paste(clipboard),
      },
      {
        id: "edit.pasteInPlace",
        label: "Paste in place",
        section: "Edit",
        keys: ["mod+shift+v"],
        native: true,
        run: () => paste(clipboard, { inPlace: true }),
      },
      {
        id: "edit.copyPng",
        label: "Copy as PNG",
        section: "Edit",
        keys: [],
        when: needsSelection,
        run: copyAsPng,
      },
      {
        id: "edit.copyCode",
        label: "Copy as code",
        section: "Edit",
        keys: ["mod+shift+c"],
        when: needsSelection,
        run: copyAsCode,
      },
      {
        id: "edit.copyStyle",
        label: "Copy style",
        section: "Edit",
        keys: ["mod+alt+c"],
        when: needsSelection,
        run: copyStyle,
      },
      {
        id: "edit.pasteStyle",
        label: "Paste style",
        section: "Edit",
        keys: ["mod+alt+v"],
        when: needsSelection,
        run: pasteStyle,
      },
      {
        id: "edit.duplicate",
        label: "Duplicate",
        section: "Edit",
        keys: ["mod+d"],
        when: needsSelection,
        run: () => $("#duplicate")?.click(),
      },
      {
        id: "edit.delete",
        label: "Delete",
        section: "Edit",
        keys: ["delete", "backspace"],
        when: needsSelection,
        run: () => $("#delete")?.click(),
      },
      {
        id: "select.all",
        label: "Select all",
        section: "Selection",
        keys: ["mod+a"],
        run: selectAll,
      },
      {
        id: "select.inverse",
        label: "Select inverse",
        section: "Selection",
        keys: ["mod+shift+a"],
        run: selectInverse,
      },
      {
        id: "select.matching",
        label: "Select all matching layers",
        section: "Selection",
        keys: ["mod+alt+a"],
        when: needsSelection,
        run: selectMatching,
      },
      {
        id: "select.child",
        label: "Select children",
        section: "Selection",
        keys: ["enter"],
        when: needsSelection,
        run: selectChildren,
      },
      {
        id: "select.parent",
        label: "Select parent",
        section: "Selection",
        keys: ["shift+enter", "\\"],
        when: needsSelection,
        run: selectParent,
      },
      {
        id: "select.next",
        label: "Select next sibling",
        section: "Selection",
        keys: ["tab"],
        when: needsSelection,
        run: () => cycleSibling(1),
      },
      {
        id: "select.previous",
        label: "Select previous sibling",
        section: "Selection",
        keys: ["shift+tab"],
        when: needsSelection,
        run: () => cycleSibling(-1),
      },
      {
        id: "select.escape",
        label: "Deselect",
        section: "Selection",
        keys: ["escape"],
        run: () => {
          if (menu) closeMenu();
          else if (tool !== "move") setTool("move");
          else clearSelection();
        },
      },
      {
        id: "view.zoomIn",
        label: "Zoom in",
        section: "View",
        keys: ["mod+=", "mod+shift+=", "mod+plus"],
        run: () => stepZoom(1),
      },
      {
        id: "view.zoomOut",
        label: "Zoom out",
        section: "View",
        keys: ["mod+-"],
        run: () => stepZoom(-1),
      },
      {
        id: "view.zoom100",
        label: "Zoom to 100%",
        section: "View",
        keys: ["mod+0", "shift+0"],
        run: () => zoomCenter(1),
      },
      {
        id: "view.zoom50",
        label: "Zoom to 50%",
        section: "View",
        keys: [],
        run: () => zoomCenter(0.5),
      },
      {
        id: "view.zoom200",
        label: "Zoom to 200%",
        section: "View",
        keys: [],
        run: () => zoomCenter(2),
      },
      {
        id: "view.fit",
        label: "Zoom to fit",
        section: "View",
        keys: ["shift+1"],
        run: () => fit(),
      },
      {
        id: "view.selection",
        label: "Zoom to selection",
        section: "View",
        keys: ["shift+2"],
        run: zoomToSelection,
      },
      {
        id: "transform.frame",
        label: "Frame selection",
        section: "Transform",
        keys: ["mod+g", "mod+alt+g"],
        when: needsSelection,
        run: frameSelection,
      },
      {
        id: "transform.unframe",
        label: "Unframe selection",
        section: "Transform",
        keys: ["mod+shift+g"],
        when: needsSelection,
        run: unframeSelection,
      },
      {
        id: "transform.autoLayout",
        label: "Add auto layout",
        section: "Transform",
        keys: ["shift+a"],
        when: needsSelection,
        run: addAutoLayout,
      },
      {
        id: "transform.removeAutoLayout",
        label: "Remove auto layout",
        section: "Transform",
        keys: ["alt+shift+a"],
        when: needsSelection,
        run: removeAutoLayout,
      },
      {
        id: "transform.flipH",
        label: "Flip horizontal",
        section: "Transform",
        keys: ["shift+h"],
        when: needsSelection,
        run: () => flip("x"),
      },
      {
        id: "transform.flipV",
        label: "Flip vertical",
        section: "Transform",
        keys: ["shift+v"],
        when: needsSelection,
        run: () => flip("y"),
      },
      {
        id: "transform.rotate90",
        label: "Rotate 90° right",
        section: "Transform",
        keys: ["alt+shift+r"],
        when: needsSelection,
        run: () => rotate90(1),
      },
      {
        id: "transform.rotate90ccw",
        label: "Rotate 90° left",
        section: "Transform",
        keys: ["alt+shift+l"],
        when: needsSelection,
        run: () => rotate90(-1),
      },
      // Scale ½× / 2× (formerly in the inspector's Layer section): the legacy form buttons keep the one-undo-step scaling.
      {
        id: "transform.scaleDown",
        label: "Scale ½×",
        section: "Transform",
        keys: [],
        when: needsSelection,
        run: () => $("#scale-down")?.click(),
      },
      {
        id: "transform.scaleUp",
        label: "Scale 2×",
        section: "Transform",
        keys: [],
        when: needsSelection,
        run: () => $("#scale-up")?.click(),
      },
      {
        id: "arrange.forward",
        label: "Bring forward",
        section: "Transform",
        keys: ["mod+]"],
        when: needsSelection,
        run: () => arrange("forward"),
      },
      {
        id: "arrange.backward",
        label: "Send backward",
        section: "Transform",
        keys: ["mod+["],
        when: needsSelection,
        run: () => arrange("backward"),
      },
      {
        id: "arrange.front",
        label: "Bring to front",
        section: "Transform",
        keys: ["mod+alt+]"],
        when: needsSelection,
        run: () => arrange("front"),
      },
      {
        id: "arrange.back",
        label: "Send to back",
        section: "Transform",
        keys: ["mod+alt+["],
        when: needsSelection,
        run: () => arrange("back"),
      },
      {
        id: "component.create",
        label: "Create component",
        section: "Components",
        keys: ["mod+alt+k"],
        when: needsSelection,
        run: createComponent,
      },
      {
        id: "component.instance",
        label: "Create instance",
        section: "Components",
        keys: [],
        when: () => {
          const i = componentInfo();
          return !!i && ["main", "instance"].includes(i.role) && !i.missingMain;
        },
        run: createInstance,
      },
      {
        id: "component.goToMain",
        label: "Go to main component",
        section: "Components",
        keys: [],
        when: () => {
          const i = componentInfo();
          return !!i?.instanceId && !i.missingMain;
        },
        run: () => goToMain(),
      },
      {
        id: "component.reset",
        label: "Reset overrides",
        section: "Components",
        keys: [],
        when: () => !!componentInfo()?.overrideCount,
        run: resetOverrides,
      },
      {
        id: "component.detach",
        label: "Detach instance",
        section: "Components",
        keys: ["mod+alt+b"],
        when: roleIs("instance"),
        run: detachInstance,
      },
      {
        id: "component.convertToSlot",
        label: "Convert to slot",
        section: "Components",
        keys: [],
        when: canSlot,
        run: () => setSlot(true),
      },
      {
        id: "component.removeSlot",
        label: "Remove slot",
        section: "Components",
        keys: [],
        when: isMainSlot,
        run: () => setSlot(false),
      },
      {
        id: "layer.visibility",
        label: "Show/hide",
        section: "Edit",
        keys: ["mod+shift+h"],
        when: needsSelection,
        run: () => toggleFlag("hidden"),
      },
      {
        id: "layer.lock",
        label: "Lock/unlock",
        section: "Edit",
        keys: ["mod+shift+l"],
        when: needsSelection,
        run: () => toggleFlag("locked"),
      },
      {
        id: "align.left",
        label: "Align left",
        section: "Alignment",
        keys: ["alt+a"],
        when: needsSelection,
        run: () => ed.align("left"),
      },
      {
        id: "align.right",
        label: "Align right",
        section: "Alignment",
        keys: ["alt+d"],
        when: needsSelection,
        run: () => ed.align("right"),
      },
      {
        id: "align.center",
        label: "Align horizontal centers",
        section: "Alignment",
        keys: ["alt+h"],
        when: needsSelection,
        run: () => ed.align("center"),
      },
      {
        id: "align.top",
        label: "Align top",
        section: "Alignment",
        keys: ["alt+w"],
        when: needsSelection,
        run: () => ed.align("top"),
      },
      {
        id: "align.middle",
        label: "Align vertical centers",
        section: "Alignment",
        keys: ["alt+v"],
        when: needsSelection,
        run: () => ed.align("middle"),
      },
      {
        id: "align.bottom",
        label: "Align bottom",
        section: "Alignment",
        keys: ["alt+s"],
        when: needsSelection,
        run: () => ed.align("bottom"),
      },
      {
        id: "align.distributeX",
        label: "Distribute horizontal spacing",
        section: "Alignment",
        keys: ["ctrl+alt+h"],
        when: needsSelection,
        run: () => ed.align("horizontal"),
      },
      {
        id: "align.distributeY",
        label: "Distribute vertical spacing",
        section: "Alignment",
        keys: ["ctrl+alt+v"],
        when: needsSelection,
        run: () => ed.align("vertical"),
      },
      // Inspector Scale section (Scale tool, Wonder T4 / R2): runCommand('transform.scaleBy', {id | ids, factor}).
      {
        id: "transform.scaleBy",
        label: "Scale layer",
        section: "Transform",
        keys: [],
        hidden: true,
        run: (arg) => chrome.scaleBy(arg?.ids || arg?.id, arg?.factor),
      },
      ...Array.from({ length: 10 }, (_, d) => ({
        id: "opacity." + d,
        label: `Opacity ${d ? d * 10 : 100}%`,
        section: "Shape",
        keys: [String(d)],
        when: needsSelection,
        hidden: true,
        run: () => {
          ed.checkpoint();
          selectedNodes().forEach((n) => {
            n.opacity = d ? d * 10 : 100;
          });
          ed.render();
        },
      })),
    ];
    const KEY_NAMES = {
      BracketLeft: "[",
      BracketRight: "]",
      Equal: "=",
      Minus: "-",
      Backslash: "\\",
      NumpadAdd: "plus",
      NumpadSubtract: "-",
      Enter: "enter",
      NumpadEnter: "enter",
      Tab: "tab",
      Escape: "escape",
      Delete: "delete",
      Backspace: "backspace",
    };
    function comboOf(e) {
      let key =
        KEY_NAMES[e.code] ||
        (/^Key[A-Z]$/.test(e.code)
          ? e.code.slice(3).toLowerCase()
          : /^(Digit|Numpad)\d$/.test(e.code)
            ? e.code.at(-1)
            : (e.key || "").toLowerCase());
      const mac = /Mac|iPhone|iPad/.test(navigator.platform);
      const mod = mac ? e.metaKey : e.ctrlKey,
        ctrl = mac && e.ctrlKey;
      return [mod && "mod", ctrl && "ctrl", e.altKey && "alt", e.shiftKey && "shift", key]
        .filter(Boolean)
        .join("+");
    }
    const keyIndex = new Map();
    for (const c of commands) for (const k of c.keys) keyIndex.set(k, c);
    function runCommand(id, arg) {
      const c = commands.find((x) => x.id === id);
      if (!c || !allowed(id) || (c.when && !c.when())) return false;
      c.run(arg);
      return true;
    }

    document.addEventListener("keydown", (e) => {
      if (typing(e.target) || e.defaultPrevented) return;
      if (
        document.querySelector("dialog[open]") ||
        document.body.classList.contains("files-view") ||
        document.body.classList.contains("settings-open")
      )
        return;
      if (hoverPoint && (e.key === "Meta" || e.key === "Control")) {
        hoverPoint.deep = deepSelect(e);
        refreshHover();
      }
      if (e.code === "Space") {
        space = true;
        workspace.classList.add("space-pan");
        refreshHover();
        e.preventDefault();
        return;
      }
      if (e.altKey && lastHover && !e.repeat) measureTo(lastHover);
      if (e.key.startsWith("Arrow")) {
        if (readOnly()) return;
        const list = selectedNodes().filter((n) => !n.locked);
        if (!list.length) return;
        // Auto-layout children have no x/y: arrows step them through their stack instead.
        if (list.every(inStack)) {
          e.preventDefault();
          arrange(e.key === "ArrowLeft" || e.key === "ArrowUp" ? "backward" : "forward");
          return;
        }
        e.preventDefault();
        ed.checkpoint();
        const prefs = window.appPreferences?.get?.() || {},
          delta = e.shiftKey ? prefs.largeNudge || 10 : prefs.smallNudge || 1;
        for (const n of list) {
          if (e.key === "ArrowLeft") n.x -= delta;
          if (e.key === "ArrowRight") n.x += delta;
          if (e.key === "ArrowUp") n.y -= delta;
          if (e.key === "ArrowDown") n.y += delta;
        }
        ed.render();
        return;
      }
      const command = keyIndex.get(comboOf(e));
      if (!command) return;
      if (!allowed(command.id)) {
        e.preventDefault();
        return;
      }
      if (command.when && !command.when()) return;
      if (command.native) {
        requestPaste(command.id === "edit.pasteInPlace");
        return;
      } // keep default so the native paste event fires
      e.preventDefault();
      command.run();
    });
    document.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        space = false;
        workspace.classList.remove("space-pan");
      }
      if (hoverPoint && (e.key === "Meta" || e.key === "Control" || e.code === "Space")) {
        hoverPoint.deep = deepSelect(e);
        refreshHover();
      }
      if (e.key === "Alt" && overlay.dataset.measuring) {
        overlay.dataset.measuring = "";
        drawGuides([]);
      }
    });
    window.addEventListener("blur", () => {
      space = false;
      workspace.classList.remove("space-pan");
    });

    // ---------- Context menu ----------
    function closeMenu() {
      menu?.remove();
      menu = null;
    }
    // The menu itself is the React context menu (web/src/islands/context-menu): this only retargets the selection like a
    // click would (a child of a selected frame, a frame label, or a locked layer, which is not hit-tested) and hands over.
    wrap.addEventListener("contextmenu", (e) => {
      if (textEdit?.el.contains(e.target)) return;
      e.preventDefault();
      closeMenu();
      if (readOnly()) return; // its commands edit
      const label = e.target.closest(".frame-label"),
        el = e.target.closest("#canvas .layer"),
        chrome =
          sel().size === 1 &&
          e.target.closest(
            "#canvas-overlay .rotate-zone, #canvas-overlay .resize-edge, #selection-chat-chip",
          )
            ? [...sel()][0]
            : null;
      const under = [...canvas.querySelectorAll(".layer[data-id]")]
        .filter((l) => {
          const r = l.getBoundingClientRect();
          return (
            r.width &&
            e.clientX >= r.left &&
            e.clientX <= r.right &&
            e.clientY >= r.top &&
            e.clientY <= r.bottom
          );
        })
        .map((l) => l.dataset.id)
        .reverse();
      const locked = under.find((id) => find(id)?.locked),
        above = locked && (!el || under.indexOf(locked) < under.indexOf(el.dataset.id));
      const target =
        chrome ||
        (label ? label.dataset.id : above ? locked : el ? clickTarget(el.dataset.id) : null);
      if (target && !sel().has(target)) select([target]);
      window.dispatchEvent(
        new CustomEvent("bd:canvas-menu", {
          detail: {
            x: e.clientX,
            y: e.clientY,
            point: screenToWorld(e.clientX, e.clientY),
            target,
            under,
            label: !!label,
          },
        }),
      );
    });
    // Whether the in-app clipboard holds layers (the context menus list Paste disabled otherwise).
    window.BetterCanvas.canPaste = () => !!clipboard;
    window.BetterCanvas.canPasteStyle = () => !!styleClipboard; // the menus list Paste styles only after Copy styles

    // ---------- Toolbar wiring (runs after the shell has built the toolbar) ----------
    function wireToolbar() {
      const select = document.getElementById("select-tool"),
        pan = document.getElementById("pan-tool");
      if (select) {
        select.onclick = () => setTool("move");
        select.title = "Move (V)";
      }
      if (pan) {
        pan.onclick = () => setTool(tool === "hand" ? "move" : "hand");
        pan.title = "Hand (H, or hold Space)";
      }
      if (select && !document.getElementById("scale-tool")) {
        const scale = document.createElement("button");
        scale.id = "scale-tool";
        scale.type = "button";
        scale.title = "Scale (K)";
        scale.setAttribute("aria-label", "Scale tool");
        scale.onclick = () => setTool(tool === "scale" ? "move" : "scale");
        select.after(scale);
      }
      for (const [id, key] of [
        ["add-frame", "F"],
        ["rectangle", "R"],
        ["add-ellipse", "O"],
        ["text", "T"],
        ["add-shader", "S"],
      ]) {
        const b = document.getElementById(id);
        if (b && !b.title.includes("(")) b.title += ` (${key} to draw)`;
      }
      // Frame arms the tool like Hand; its presets live in the Properties panel (inspector island).
      const frame = document.getElementById("add-frame");
      if (frame) frame.onclick = () => setTool(tool === "frame" ? "move" : "frame");
      setTool(tool);
    }
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", wireToolbar);
    else queueMicrotask(wireToolbar);
    for (const [id, fn] of [
      ["zoom-in", () => stepZoom(1)],
      ["zoom-out", () => stepZoom(-1)],
      ["zoom-reset", () => zoomCenter(1)],
      ["zoom-fit", () => fit()],
    ]) {
      const b = document.getElementById(id);
      if (b) b.onclick = fn;
    }

    // ---------- Constraints (inset anchoring) ----------
    // An anchored layer is placed by CSS insets, so a parent resize moves it without touching the model. To keep
    // x/y/w/h meaningful for everything else (snapping, layers, agents), every render reads the anchored geometry
    // back into x/y/w/h (afterRender). Before a render, a layer whose x/y/w/h no longer match that read-back was
    // edited (move, nudge, inspector, resize, undo): its insets are re-derived from the new geometry so the
    // constraint itself is preserved. Layers never read back (just loaded, or restored by undo: new objects) keep
    // their insets as written; the cache is keyed by node object for that reason.
    const NS = () => window.BetterNodeStyle;
    let synced = new WeakMap();
    const sameBox = (a, n) =>
      ["x", "y", "w", "h"].every((k) => Math.abs((Number(a[k]) || 0) - (Number(n[k]) || 0)) < 0.01);
    const anchoredLayer = (n) => !!n.parentId && !!NS()?.anchored(n, find(n.parentId));
    function bordersOf(p) {
      if (p.strokeHidden === true) return [0, 0, 0, 0];
      return Array.isArray(p.strokeWidths) && p.strokeWidths.length === 4
        ? p.strokeWidths.map((v, i) =>
            p.strokeHiddenSides?.[i] === true ? 0 : Math.max(0, Number(v) || 0),
          )
        : Array(4).fill(Math.max(0, Number(p.strokeWidth) || 0));
    }
    // The parent's padding box (CSS containing block of an absolute child) and the x/y offset of that box in the
    // child's coordinate convention: free parents measure x/y inside the border, flow parents from the border box.
    function containing(n) {
      const p = find(n.parentId),
        b = bordersOf(p),
        el = elementOf(p.id);
      const fixedW = (p.wMode || "fixed") === "fixed" && p.wPct === undefined,
        fixedH = (p.hMode || "fixed") === "fixed" && p.hPct === undefined;
      const w = fixedW || !el ? (Number(p.w) || 0) - b[1] - b[3] : el.clientWidth,
        h = fixedH || !el ? (Number(p.h) || 0) - b[0] - b[2] : el.clientHeight;
      return {
        cb: { w: Math.max(0, w), h: Math.max(0, h) },
        dx: isFlow(p) ? b[3] : 0,
        dy: isFlow(p) ? b[0] : 0,
      };
    }
    // The layer's own size where its sizing mode decides it (hug reads the rendered box).
    function ownSize(n) {
      const measured = (m) => m === "hug" || m === "auto" || m === "calc",
        el = elementOf(n.id);
      return {
        w: measured(n.wMode) && el ? el.offsetWidth : Number(n.w) || 0,
        h: measured(n.hMode) && el ? el.offsetHeight : Number(n.h) || 0,
      };
    }
    function applyPatch(n, patch) {
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined) delete n[k];
        else n[k] = v;
      }
    }
    function reanchor(n, constraints = NS().constraintsOf(n)) {
      const { cb, dx, dy } = containing(n),
        size = ownSize(n);
      applyPatch(
        n,
        NS().anchorPatch(
          n,
          constraints,
          { x: (Number(n.x) || 0) - dx, y: (Number(n.y) || 0) - dy, w: size.w, h: size.h },
          cb,
        ),
      );
    }
    function beforeRender() {
      if (!NS()) return;
      for (const n of ed.nodes()) {
        const last = synced.get(n);
        if (last && anchoredLayer(n) && !sameBox(last, n)) reanchor(n);
      }
    }
    function syncAnchored() {
      if (!NS()) return;
      synced = new WeakMap();
      const r2 = (v) => Math.round(v * 100) / 100;
      for (const n of ed.nodes()) {
        if (
          !anchoredLayer(n) ||
          !Array.isArray(n.inset) ||
          !n.inset.some((v) => v !== null && v !== undefined)
        )
          continue;
        const { cb, dx, dy } = containing(n),
          box = NS().anchoredBox(n, cb, ownSize(n));
        n.x = r2(box.x + dx);
        n.y = r2(box.y + dy);
        if (n.wMode !== "hug") n.w = r2(box.w);
        if (n.hMode !== "hug") n.h = r2(box.h);
        synced.set(n, { x: n.x, y: n.y, w: n.w, h: n.h });
      }
    }
    // Inspector: set the horizontal and/or vertical constraint of layers without moving them. One undo step.
    function setConstraints(ids, next) {
      const list = ids.map(find).filter((n) => n && !n.locked && anchorable(n));
      if (!list.length) return false;
      ed.checkpoint();
      for (const n of list) {
        const current = anchoredLayer(n) ? NS().constraintsOf(n) : { h: "start", v: "start" };
        reanchor(n, { ...current, ...next });
      }
      ed.render();
      return true;
    }
    // Constraints apply to layers positioned inside a parent: children of free frames and absolute children.
    const anchorable = (n) =>
      !!n.parentId && (!isFlow(find(n.parentId)) || n.position === "absolute");

    // ---------- Render integration ----------
    function afterRender() {
      dropHits.invalidate();
      keepTextEditor();
      syncAnchored();
      const pageId = ed.page().id;
      if (lastPage !== pageId) {
        if (lastPage) drilled.clear();
        lastPage = pageId;
        const saved = cameras.get(pageId);
        if (saved) setCamera(saved.x, saved.y, saved.zoom);
        else requestAnimationFrame(() => fit(true));
      }
      for (const id of drilled) if (!find(id)) drilled.delete(id);
      drawFrameLabels();
      drawClippedSelection();
      chrome.draw();
      refreshHover(true);
    }
    applyCamera();

    // ---------- Extensions (web/clipboard-commands.js): more commands on the same registry and shortcuts ----------
    const hooks = {};
    // Adds a command, or merges fields into an existing one (same id); the shortcut index is rebuilt.
    function register(command) {
      const existing = commands.find((c) => c.id === command.id);
      if (existing) Object.assign(existing, command);
      else commands.push({ keys: [], ...command });
      keyIndex.clear();
      for (const c of commands) for (const k of c.keys) keyIndex.set(k, c);
    }
    const context = {
      ed,
      find,
      sel,
      selectedNodes,
      topSelected,
      worldRect,
      union,
      placeInView,
      screenToWorld,
      frameAt,
      isFlow,
      inStack,
      footer,
      writeSystemClipboard,
      register,
      hooks,
      getClipboard: () => clipboard,
      paste: (data, options) => paste(data, options),
    };
    for (const extend of extensions) extend(context);

    return {
      beforeRender,
      afterRender,
      afterSelection: () => { drawFrameLabels(); drawClippedSelection(); chrome.draw(); refreshHover(true); },
      setConstraints,
      constraintsOf: (id) => {
        const n = find(id);
        return n && anchorable(n) ? NS().constraintsOf(n) : null;
      },
      reveal,
      setTool,
      getTool: () => tool,
      insertFramePreset,
      framePresets: () =>
        FRAME_PRESETS.map(([category, presets]) => ({
          category,
          presets: presets.map(([name, w, h]) => ({ name, w, h })),
        })),
      fit,
      zoomToSelection,
      stepZoom,
      zoomAt,
      zoomCenter,
      setCamera,
      screenToWorld,
      worldRect,
      placeInView,
      // scrollLeft/scrollTop stay non-negative for older readers; x/y carry the exact camera offset.
      getView: () => ({
        zoom: cam.zoom,
        scrollLeft: clamp(Math.round(-cam.x), 0, 1e7) || 0,
        scrollTop: clamp(Math.round(-cam.y), 0, 1e7) || 0,
        page: ed.page().id,
        x: cam.x || 0,
        y: cam.y || 0,
      }),
      applyView: (view) =>
        setCamera(
          Number.isFinite(view.x) ? view.x : -(Number(view.scrollLeft) || 0),
          Number.isFinite(view.y) ? view.y : -(Number(view.scrollTop) || 0),
          Number(view.zoom) || 1,
        ),
      commands: () =>
        commands
          .filter((c) => !c.hidden)
          .map(({ id, label, section, keys }) => ({ id, label, section, keys: [...keys] })),
      runCommand,
      copy,
      cut,
      paste: (options) => paste(clipboard, options),
      copyStyle,
      pasteStyle,
      frameSelection,
      unframeSelection,
      addAutoLayout,
      removeAutoLayout,
      arrange,
      moveNodes,
      flip,
      rotate90,
      copyAsPng,
      copyAsCode,
      selectInverse,
      selectMatching,
      getDrilled: () => [...drilled],
    };
  }
  const extensions = [];
  window.BetterCanvas = {
    install,
    inkAt,
    ZOOM_STOPS,
    FRAME_PRESETS,
    extend: (fn) => extensions.push(fn),
  };
})();
