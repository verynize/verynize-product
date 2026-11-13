"use strict";
// Selection chrome and transform gestures (Wonder S4 / TR1 / TR2 / T4), installed by canvas-interactions.js.
// - Chrome: the name label, the size badge and the add-to-chat chip ride in a box that follows the node's rotation,
//   turned by a multiple of 90° so the text never reads more than 45° off upright (TR2-rotate-verified). A
//   multi-selection gets one union box with corner marks, the chip and a combined badge (CM5-multi-verified).
// - Gestures: invisible edge zones resize one axis (TR1), zones just outside each corner rotate around the centre
//   (TR2), and corner/edge resize keeps Shift (aspect), Alt (from the centre) and the Scale tool (T4, proportional by
//   the drag projected on the box diagonal).
// - Wonder details measured from design/wonder/canvas-audit: a selected hidden layer keeps a 1px outline of its bounds
//   and nothing else (CM6-hidden); a selected nested layer gets dashed guides to the parent edges it is constrained
//   to and no name label (S2-classic, CM3-text-menu: #c468f7 at 75%, 1px, 2.5/2 dashes); a text layer being edited
//   shows only its caret, plus the ⊕ chip for a fixed-size box (TX1-click, TX1-selection, TX1-drag).
// - While a layer is dragged (`#canvas-overlay[data-moving]`, `.layer[data-dragging]`) it shows no outline, handles, size badge or chip, only its name label
//   (R1-row-drag-slot, R1-row-drag-far, TR4-guide). Multi-selection drags keep their union box (not captured).
// Everything here is screen-space DOM in #canvas-overlay; the canvas itself stays imperative.
(() => {
  const ZONE = 18; // rotate zone size outside each corner (screen px)
  const NOTCH = 6; // the zone corner nearest the node is left to the resize handle
  const EDGE = 4; // half the edge zone thickness (straddles the edge)
  const EDGE_INSET = 6; // edge zones stop short of the corner handles
  const EDGE_MIN = 24; // boxes smaller than this on screen get corner handles only
  const BADGE_GAP = 10; // Wonder: badge 22 px high, 10 px below the box
  const NAME_OFFSET = 20; // label line box (18 px) sits just above the box
  const CHIP_SIZE = 12,
    CHIP_INSET = 4,
    CHIP_RISE = 14; // ⊕: 12 px circle, right edge 4 px inside the box, centre 14 px above
  const MIN_SIZE = 10;
  // Wonder's selection purple #c468f7 and badge #a245d3 (S4-frame-ready), tokens in canvas.css.
  const SELECT = "var(--canvas-select,#c468f7)",
    BADGE = "var(--canvas-select-badge,#a245d3)";
  const r2 = (v) => Math.round(v * 100) / 100;
  // Accumulated rotation of a node and its ancestors (degrees).
  function totalRotation(n, find) {
    let total = Number(n.rotation) || 0,
      a = n;
    while (a.parentId) {
      a = find(a.parentId);
      if (!a) break;
      total += Number(a.rotation) || 0;
    }
    return total;
  }
  // A layer's screen frame relative to the canvas viewport: centre, unrotated size and on-screen angle. The selection
  // chrome and the hover outline (Wonder S1-hover-final: the outline turns with a rotated frame) are placed from it.
  function frameOf(el, n, find, zoom, viewport) {
    if (!el || !n) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return {
      cx: r.left - viewport.left + r.width / 2,
      cy: r.top - viewport.top + r.height / 2,
      w: el.offsetWidth * zoom,
      h: el.offsetHeight * zoom,
      angle: totalRotation(n, find),
    };
  }
  const placeFrame = (el, f) =>
    Object.assign(el.style, {
      left: f.cx - f.w / 2 + "px",
      top: f.cy - f.h / 2 + "px",
      width: f.w + "px",
      height: f.h + "px",
      transform: f.angle ? `rotate(${f.angle}deg)` : "",
    });
  // Rotation in degrees, rounded to 0.01 and normalised to (−180, 180].
  function normalize(deg) {
    const r = ((((r2(deg) + 180) % 360) + 360) % 360) - 180;
    return r === -180 ? 180 : r2(r) || 0;
  }
  // The chrome turns with the node by a multiple of 90° so that its own angle stays within (−45, 45].
  function chromeAngle(deg) {
    let a = ((deg % 90) + 90) % 90;
    if (a > 45) a -= 90;
    return r2(a) || 0;
  }
  // Proportional scale factor for a corner drag: the new diagonal projected on the old one (Wonder T4: 100×70 → 150×105).
  function diagonalFactor(w0, h0, w1, h1) {
    const d = w0 * w0 + h0 * h0;
    return d ? (w1 * w0 + h1 * h0) / d : 1;
  }
  // Clip path for a corner zone (size z) with a notch of size h cut at the zone corner that touches the node corner.
  function notchedSquare(corner, z, h) {
    const px = corner.includes("e") ? 0 : z,
      py = corner.includes("s") ? 0 : z;
    const square = [
        [0, 0],
        [z, 0],
        [z, z],
        [0, z],
      ],
      i = square.findIndex(([x, y]) => x === px && y === py);
    const prev = square[(i + 3) % 4],
      next = square[(i + 1) % 4],
      unit = ([x, y]) => [Math.sign(x - px), Math.sign(y - py)];
    const [ax, ay] = unit(prev),
      [bx, by] = unit(next);
    const notch = [
      [px + ax * h, py + ay * h],
      [px + (ax + bx) * h, py + (ay + by) * h],
      [px + bx * h, py + by * h],
    ];
    const points = [...square.slice(0, i), ...notch, ...square.slice(i + 1)];
    return "polygon(" + points.map(([x, y]) => x + "px " + y + "px").join(", ") + ")";
  }
  const ROTATE_CURSOR =
    'url("data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 17a8 8 0 0 1 11-11" stroke="#fff" stroke-width="4"/><path d="M14 4l3 2-2 3M4 14l2 3 3-2" stroke="#fff" stroke-width="4"/><path d="M6 17a8 8 0 0 1 11-11" stroke="#000" stroke-width="1.5"/><path d="M14 4l3 2-2 3M4 14l2 3 3-2" stroke="#000" stroke-width="1.5"/></g></svg>',
    ) +
    '") 12 12, crosshair';
  const EDGE_CURSORS = ["ns-resize", "nesw-resize", "ew-resize", "nwse-resize"];

  const STYLE = `
#canvas-overlay .selection-chrome{position:absolute;inset:0;pointer-events:none}
#canvas-overlay .sel-box,#canvas-overlay .sel-text-box{position:absolute;transform-origin:50% 50%}
#canvas-overlay .resize-edge,#canvas-overlay .rotate-zone{position:absolute;pointer-events:auto;touch-action:none}
#canvas-overlay .rotate-zone{width:${ZONE}px;height:${ZONE}px;cursor:${ROTATE_CURSOR}}
#canvas-overlay #selection-name{position:absolute!important;left:0!important;top:${-NAME_OFFSET}px!important;transform:none!important;max-width:none}
#canvas-overlay #selection-measure{position:absolute!important;left:50%!important;top:calc(100% + ${BADGE_GAP}px)!important;transform:translateX(-50%)!important;height:22px;box-sizing:border-box;padding:0 6px!important;font:12px/22px Inter,system-ui,sans-serif!important;border-radius:4px!important;background:${BADGE}!important;color:#fff!important;white-space:nowrap;pointer-events:none;font-feature-settings:'calt' 0!important}
#canvas-overlay #selection-chat-chip{position:absolute;right:${CHIP_INSET}px;top:${-CHIP_RISE - CHIP_SIZE / 2}px;width:${CHIP_SIZE}px;height:${CHIP_SIZE}px;box-sizing:border-box;margin:0;padding:0;border:1px solid ${SELECT};border-radius:50%;background:transparent;color:${SELECT};pointer-events:auto;cursor:pointer;display:flex;align-items:center;justify-content:center}
#canvas-overlay #selection-chat-chip::before,#canvas-overlay #selection-chat-chip::after{content:'';position:absolute;left:50%;top:50%;width:6px;height:1px;background:currentColor;transform:translate(-50%,-50%)}
#canvas-overlay #selection-chat-chip::after{transform:translate(-50%,-50%) rotate(90deg)}
#canvas-overlay #selection-chat-chip:hover{background:color-mix(in srgb,${SELECT} 20%,transparent)}
#canvas-overlay .selection-union{position:absolute;box-sizing:border-box;outline:1px solid ${SELECT};outline-offset:-.5px}
#canvas-overlay .selection-union>.union-handle{position:absolute;width:9px;height:9px;box-sizing:border-box;background:#fff;border:1px solid ${SELECT}}
#canvas-overlay .selection-union>.union-handle[data-corner=nw]{left:-4.5px;top:-4.5px}
#canvas-overlay .selection-union>.union-handle[data-corner=ne]{right:-4.5px;top:-4.5px}
#canvas-overlay .selection-union>.union-handle[data-corner=sw]{left:-4.5px;bottom:-4.5px}
#canvas-overlay .selection-union>.union-handle[data-corner=se]{right:-4.5px;bottom:-4.5px}
#workspace[data-tool=scale] #canvas-overlay .selection-union>.union-handle{pointer-events:auto;touch-action:none}
#workspace[data-tool=scale] #canvas-overlay .selection-union>.union-handle::after{content:'';position:absolute;inset:-4px}
#workspace[data-tool=scale] #canvas-overlay .selection-union>.union-handle[data-corner=nw],#workspace[data-tool=scale] #canvas-overlay .selection-union>.union-handle[data-corner=se]{cursor:nwse-resize}
#workspace[data-tool=scale] #canvas-overlay .selection-union>.union-handle[data-corner=ne],#workspace[data-tool=scale] #canvas-overlay .selection-union>.union-handle[data-corner=sw]{cursor:nesw-resize}
#canvas[data-multi-select] .layer>.handle,#canvas-overlay[data-multi-select] .clipped-selection .handle{display:none!important}
#canvas-overlay .frame-label.selected{color:${SELECT}}
.transforming #canvas-overlay #selection-chat-chip,#canvas-overlay[data-moving] #selection-chat-chip{visibility:hidden}
.panning #canvas-overlay .resize-edge,.panning #canvas-overlay .rotate-zone,.space-pan #canvas-overlay .resize-edge,.space-pan #canvas-overlay .rotate-zone{pointer-events:none}
#canvas-overlay #selection-chat-chip[hidden],#canvas-overlay #selection-name[hidden],#canvas-overlay #selection-measure[hidden]{display:none!important}
#canvas-overlay .hidden-outline{position:absolute;box-sizing:border-box;outline:1px solid ${SELECT};outline-offset:-.5px;transform-origin:50% 50%}
#canvas-overlay .constraint-guides{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
#canvas-overlay .constraint-guide{stroke:${SELECT};stroke-opacity:.75;stroke-width:1;stroke-dasharray:2.5 2;shape-rendering:crispEdges}
.transforming #canvas-overlay .constraint-guides,#canvas-overlay[data-moving] .constraint-guides{display:none}
#canvas:not([data-multi-select]) .layer.selected[data-dragging]{outline:none!important}
#canvas:not([data-multi-select]) .layer.selected[data-dragging]::after,#canvas:not([data-multi-select]) .layer[data-dragging]>.handle{display:none!important}
#canvas-overlay[data-moving]:not([data-multi-select]) #selection-measure{visibility:hidden!important}
#canvas .layer.selected[data-text-editing]{outline:none!important}
#canvas .layer.selected[data-text-editing]::after,#canvas .layer[data-text-editing]>.handle{display:none!important}
#canvas-overlay .clipped-selection[data-text-editing]{display:none}
#canvas .layer.selected[data-clip-ring]:not([data-outline]){outline:none!important}
#canvas .layer.selected[data-clip-ring]::after,#canvas .layer[data-clip-ring]>.handle{display:none!important}`;

  function install(ctx) {
    const {
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
    } = ctx;
    if (!document.getElementById("selection-chrome-style")) {
      const style = document.createElement("style");
      style.id = "selection-chrome-style";
      style.textContent = STYLE;
      document.head.append(style);
    }
    const layer = document.createElement("div");
    layer.className = "selection-chrome";
    const box = document.createElement("div");
    box.className = "sel-box"; // rotates exactly with the node: gesture zones
    const textBox = document.createElement("div");
    textBox.className = "sel-text-box"; // rotates by the chrome angle: label, chip, badge
    const union = document.createElement("div");
    union.className = "selection-union";
    const hiddenOutline = document.createElement("div");
    hiddenOutline.className = "hidden-outline";
    const guides = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    guides.setAttribute("class", "constraint-guides");
    for (const corner of ["nw", "ne", "sw", "se"]) {
      const h = document.createElement("div");
      h.className = "union-handle";
      h.dataset.corner = corner;
      union.append(h);
    }
    const chip = document.createElement("button");
    chip.type = "button";
    chip.id = "selection-chat-chip";
    chip.title = "Add to chat";
    chip.setAttribute("aria-label", "Add selection to chat");
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      addToChat();
    });
    const edges = {},
      zones = {};
    for (const edge of ["n", "e", "s", "w"]) {
      const z = document.createElement("div");
      z.className = "resize-edge";
      z.dataset.edge = edge;
      edges[edge] = z;
    }
    for (const corner of ["nw", "ne", "sw", "se"]) {
      const z = document.createElement("div");
      z.className = "rotate-zone";
      z.dataset.corner = corner;
      z.style.clipPath = notchedSquare(corner, ZONE, NOTCH);
      zones[corner] = z;
    }
    box.append(...Object.values(edges), ...Object.values(zones));
    layer.append(guides, hiddenOutline, union, box, textBox);
    overlay.append(layer);
    union.hidden = box.hidden = textBox.hidden = hiddenOutline.hidden = true;
    let busy = false;
    const tool = () => ctx.getTool();

    const viewport = () => wrap.getBoundingClientRect();
    const screenFrame = (n) => frameOf(elementOf(n.id), n, find, cam.zoom, viewport());
    const place = (el, cx, cy, w, h, angle) => placeFrame(el, { cx, cy, w, h, angle });
    function topSelected() {
      const list = ed.nodes();
      return window.VerynizeNodeIndex.of(list).topmost(list.filter((n) => sel().has(n.id)));
    }

    // A hidden layer renders as display:none: lay it out for one synchronous measurement (never painted).
    function hiddenFrame(n) {
      const el = elementOf(n.id);
      if (!el) return null;
      const NS = window.BetterNodeStyle,
        parent = n.parentId ? find(n.parentId) : null;
      let display = "block";
      try {
        display =
          NS.nodeStyle({ ...n, hidden: false }, parent).box.find(([k]) => k === "display")?.[1] ||
          "block";
      } catch {}
      const prev = {
        display: el.style.getPropertyValue("display"),
        visibility: el.style.getPropertyValue("visibility"),
      };
      el.style.setProperty("display", display);
      el.style.setProperty("visibility", "hidden");
      const f = screenFrame(n);
      el.style.setProperty("display", prev.display || "none");
      if (prev.visibility) el.style.setProperty("visibility", prev.visibility);
      else el.style.removeProperty("visibility");
      return f;
    }
    // Wonder S2: dashed lines from the selected child to the parent edges it is pinned to (Left/Top → left/top edge,
    // Right/Bottom → right/bottom, Left & Right → both). Centre and Scale constraints draw none (not observed).
    function drawConstraintGuides(n) {
      guides.replaceChildren();
      const parent = n.parentId && find(n.parentId);
      if (
        !parent ||
        parent.hidden ||
        (isFlow(parent) && n.position !== "absolute") ||
        totalRotation(n, find) % 360
      )
        return;
      const childEl = elementOf(n.id),
        parentEl = elementOf(parent.id);
      if (!childEl || !parentEl) return;
      const v = viewport(),
        c = childEl.getBoundingClientRect(),
        p = parentEl.getBoundingClientRect();
      if (!c.width && !c.height) return;
      const cons = window.BetterNodeStyle?.constraintsOf?.(n) || { h: "start", v: "start" };
      const cx = c.left + c.width / 2 - v.left,
        cy = c.top + c.height / 2 - v.top;
      const line = (side, x1, y1, x2, y2) => {
        if (Math.abs(x2 - x1) + Math.abs(y2 - y1) < 1) return;
        const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
        for (const [k, val] of Object.entries({ x1, y1, x2, y2 })) l.setAttribute(k, val);
        l.setAttribute("class", "constraint-guide");
        l.dataset.side = side;
        guides.append(l);
      };
      if (cons.h === "start" || cons.h === "stretch")
        line("left", p.left - v.left, cy, c.left - v.left, cy);
      if (cons.h === "end" || cons.h === "stretch")
        line("right", c.right - v.left, cy, p.right - v.left, cy);
      if (cons.v === "start" || cons.v === "stretch")
        line("top", cx, p.top - v.top, cx, c.top - v.top);
      if (cons.v === "end" || cons.v === "stretch")
        line("bottom", cx, c.bottom - v.top, cx, p.bottom - v.top);
    }

    // ---------- Drawing ----------
    function draw() {
      const ids = [...sel()],
        multi = ids.length > 1;
      const name = document.getElementById("selection-name"),
        badge = document.getElementById("selection-measure");
      if (multi) {
        ed.canvas.dataset.multiSelect = "";
        overlay.dataset.multiSelect = "";
      } else {
        delete ed.canvas.dataset.multiSelect;
        delete overlay.dataset.multiSelect;
      }
      // A selected live preview hides the name label and chip (live-preview.css, preview-frame-chrome.css). An attribute
      // set here, not `#workspace:has(.canvas-preview.selected)`: such a rule makes every canvas mutation walk the canvas.
      overlay.toggleAttribute(
        "data-preview-selected",
        ids.some((id) => elementOf(id)?.classList.contains("canvas-preview")),
      );
      union.hidden = box.hidden = textBox.hidden = hiddenOutline.hidden = true;
      guides.replaceChildren();
      for (const el of ed.canvas.querySelectorAll("[data-clip-ring]")) delete el.dataset.clipRing;
      if (!ids.length || document.body.classList.contains("files-view")) return;
      if (multi) {
        const modelRects = window.VerynizeSelectionBounds.rects(ed.nodes(), elementOf);
        const rects = topSelected()
          .filter((n) => !n.hidden)
          .map((n) => modelRects.get(n.id))
          .filter(Boolean);
        if (!rects.length) return;
        const x = Math.min(...rects.map((r) => r.x)),
          y = Math.min(...rects.map((r) => r.y));
        const w = Math.max(...rects.map((r) => r.x + r.w)) - x,
          h = Math.max(...rects.map((r) => r.y + r.h)) - y;
        const left = x * cam.zoom + cam.x,
          top = y * cam.zoom + cam.y;
        Object.assign(union.style, {
          left: left + "px",
          top: top + "px",
          width: w * cam.zoom + "px",
          height: h * cam.zoom + "px",
        });
        union.hidden = false;
        if (name) name.hidden = true;
        if (badge) {
          badge.hidden = false;
          badge.textContent = `${r2(w)} x ${r2(h)}`;
          union.append(badge);
        }
        chip.hidden = false;
        union.append(chip);
        return;
      }
      const n = find(ids[0]);
      if (!n) return;
      // Wonder CM6-hidden: only the bounds, as an empty 1px outline (no handles, label, badge or chip).
      if (n.hidden) {
        const h = hiddenFrame(n);
        if (!h) return;
        place(hiddenOutline, h.cx, h.cy, h.w, h.h, h.angle);
        hiddenOutline.hidden = false;
        return;
      }
      const f = screenFrame(n);
      if (!f) return;
      const nodeEl = elementOf(n.id),
        editing = !!nodeEl?.hasAttribute("data-text-editing");
      // The clip-proof ring (canvas-interactions) replaces the layer's own outline: one 1.5px ring, not two.
      if (nodeEl && overlay.querySelector(".clipped-selection .selection-ring"))
        nodeEl.dataset.clipRing = "";
      if (!editing) drawConstraintGuides(n);
      // Gesture zones: only for an unlocked layer with the Move or Scale tool.
      if (!n.locked && (tool() === "move" || tool() === "scale")) {
        place(box, f.cx, f.cy, f.w, f.h, f.angle);
        const showEdges = f.w >= EDGE_MIN && f.h >= EDGE_MIN;
        for (const [edge, z] of Object.entries(edges)) {
          z.hidden = !showEdges;
          if (!showEdges) continue;
          const vertical = edge === "n" || edge === "s";
          Object.assign(
            z.style,
            vertical
              ? {
                  left: EDGE_INSET + "px",
                  width: f.w - 2 * EDGE_INSET + "px",
                  top: (edge === "n" ? -EDGE : f.h - EDGE) + "px",
                  height: 2 * EDGE + "px",
                }
              : {
                  top: EDGE_INSET + "px",
                  height: f.h - 2 * EDGE_INSET + "px",
                  left: (edge === "w" ? -EDGE : f.w - EDGE) + "px",
                  width: 2 * EDGE + "px",
                },
          );
          // The cursor follows the edge normal on screen (CSS cursors cannot rotate).
          const normal = (vertical ? 0 : 90) + f.angle,
            step = ((Math.round(normal / 45) % 4) + 4) % 4;
          z.style.cursor = EDGE_CURSORS[step];
        }
        for (const [corner, z] of Object.entries(zones)) {
          z.style.left = (corner.includes("e") ? f.w : -ZONE) + "px";
          z.style.top = (corner.includes("s") ? f.h : -ZONE) + "px";
        }
        box.hidden = false;
      }
      // Label, chip and badge: the node's frame turned by k·90° so the chrome angle stays within (−45°, 45°].
      const angle = chromeAngle(f.angle),
        quarter = ((Math.round((f.angle - angle) / 90) % 4) + 4) % 4,
        swap = quarter % 2 === 1;
      place(textBox, f.cx, f.cy, swap ? f.h : f.w, swap ? f.w : f.h, angle);
      // Wonder S2 / CM3: no label on nested or text layers. A drag previewing a new parent labels by that parent
      // (R1-row-drag-far: a stack child dragged onto the page shows its name, R1-row-return-during: one entering a stack not).
      const preview = ctx.previewParent?.(n.id),
        parentId = preview === undefined ? n.parentId : preview;
      if (name) {
        textBox.append(name);
        if (parentId || n.type === "text" || editing) name.hidden = true;
        const role = n.component === true ? "main" : n.instanceOf ? "instance" : ""; // canvas.css colours the label
        if (role) name.dataset.component = role;
        else delete name.dataset.component;
      }
      textBox.append(chip);
      chip.hidden = editing && n.wMode !== "fixed"; // TX1: a hugging text being typed shows only its caret
      if (badge) {
        textBox.append(badge);
        if (editing) badge.hidden = true;
      }
      textBox.hidden = false;
    }

    // ---------- Add to chat (⊕) ----------
    function addToChat() {
      const ids = [...sel()];
      if (!ids.length) return;
      const ws = window.agentWorkspace;
      ws?.openChat?.();
      const pageId = ed.page().id;
      for (const id of ids) {
        const n = find(id);
        if (n)
          ws?.addMention?.({
            id,
            label:
              (n.name || "").trim() ||
              String(n.text || "")
                .trim()
                .slice(0, 40) ||
              n.type,
            pageId,
            type: n.type,
          });
      }
      window.dispatchEvent(new CustomEvent("bd:add-context", { detail: { ids } }));
      requestAnimationFrame(() => document.getElementById("project-prompt")?.focus());
    }

    // ---------- Gestures ----------
    function begin() {
      busy = true;
      workspace.classList.add("transforming");
      overlay.dataset.measuring = "";
      ctx.drawGuides([]);
      ctx.showHover?.(null);
    }
    function end() {
      busy = false;
      workspace.classList.remove("transforming");
      ed.render();
    }

    function startRotate(e, id) {
      const n = find(id);
      if (!n || n.locked) return;
      const el = elementOf(id);
      if (!el) return;
      const r = el.getBoundingClientRect(),
        c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const a0 = Math.atan2(e.clientY - c.y, e.clientX - c.x),
        r0 = Number(n.rotation) || 0,
        g = gesture();
      begin();
      track(
        e,
        (ev) => {
          let deg = r0 + ((Math.atan2(ev.clientY - c.y, ev.clientX - c.x) - a0) * 180) / Math.PI;
          if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
          const next = normalize(deg);
          if (next === (Number(n.rotation) || 0)) return;
          g.commit();
          n.rotation = next;
          unbindKeys(n, ["rotation"]);
          ed.render();
        },
        end,
      );
    }

    // Corner (nw/ne/sw/se) or edge (n/e/s/w) resize. Shift keeps the aspect ratio, Alt resizes from the centre, and
    // the Scale tool scales the layer and its content proportionally.
    function startResize(e, id, handle) {
      const n = find(id);
      if (!n || n.locked) return;
      const total = totalRotation(n, find),
        scaling = tool() === "scale";
      const s = { x: n.x, y: n.y, w: n.w, h: n.h, wPct: n.wPct, hPct: n.hPct },
        start = { x: e.clientX, y: e.clientY },
        g = gesture();
      const hx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0,
        hy = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
      const content = scaling ? scaleContent(id) : [];
      begin();
      track(
        e,
        (ev) => {
          g.commit();
          const dx = (ev.clientX - start.x) / cam.zoom,
            dy = (ev.clientY - start.y) / cam.zoom,
            angle = (total * Math.PI) / 180;
          const localX = dx * Math.cos(angle) + dy * Math.sin(angle),
            localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
          const sx = hx * (n.flipX ? -1 : 1),
            sy = hy * (n.flipY ? -1 : 1),
            centered = ev.altKey ? 2 : 1; // handles flip with the layer
          let w = hx ? Math.max(MIN_SIZE, s.w + sx * localX * centered) : s.w,
            h = hy ? Math.max(MIN_SIZE, s.h + sy * localY * centered) : s.h;
          if (ev.shiftKey || scaling) {
            const f = hx && hy ? diagonalFactor(s.w, s.h, w, h) : hx ? w / s.w : h / s.h,
              min = Math.max(MIN_SIZE / s.w, MIN_SIZE / s.h);
            const k = Math.max(min, f);
            w = s.w * k;
            h = s.h * k;
          }
          const dw = w - s.w,
            dh = h - s.h,
            a = ((Number(n.rotation) || 0) * Math.PI) / 180,
            parent = find(n.parentId);
          n.w = r2(w);
          n.h = r2(h);
          // A dragged size replaces a variable-bound W/H: keep the new value, drop the binding (undo restores both).
          unbindKeys(n, [w !== s.w && "w", h !== s.h && "h"]);
          // A dragged size is Fixed (Hug / Fill / Auto / Calculate end); a Relative (%) size keeps its mode and scales.
          if (w !== s.w && n.wMode && n.wMode !== "fixed") {
            n.wMode = "fixed";
            delete n.wCalc;
          }
          if (h !== s.h && n.hMode && n.hMode !== "fixed") {
            n.hMode = "fixed";
            delete n.hCalc;
          }
          if (s.wPct !== undefined && s.w) n.wPct = r2((s.wPct * w) / s.w);
          if (s.hPct !== undefined && s.h) n.hPct = r2((s.hPct * h) / s.h);
          if (!isFlow(parent)) {
            // The opposite edge or corner stays put; an axis without a dragged side (or Alt) grows around the centre.
            const ax = ev.altKey ? 0 : sx,
              ay = ev.altKey ? 0 : sy;
            n.x = r2(s.x + (ax * dw * Math.cos(a) - ay * dh * Math.sin(a) - dw) / 2);
            n.y = r2(s.y + (ax * dw * Math.sin(a) + ay * dh * Math.cos(a) - dh) / 2);
          }
          if (scaling) applyContentScale(content, id, w / s.w);
          ed.render();
        },
        end,
      );
    }

    // The Scale tool's content snapshot: the layer and its descendants with the values a proportional scale changes.
    function scaleContent(id) {
      return [...ed.descendants(id)]
        .map(find)
        .filter(Boolean)
        .map((d) => ({
          d,
          x: d.x,
          y: d.y,
          w: d.w,
          h: d.h,
          fontSize: d.fontSize,
          radius: d.radius,
          gap: d.gap,
          padding: d.padding,
          strokeWidth: d.strokeWidth,
        }));
    }
    // Scale the snapshot by f from its original values: children move and resize with the layer; type size, radius,
    // gap, padding and border width scale everywhere (values a layer doesn't set stay unset). Scaled values drop their
    // variable bindings.
    function applyContentScale(content, id, f) {
      const by = (v) => (typeof v === "number" ? v * f : v);
      for (const c of content) {
        if (c.d.id !== id) {
          c.d.x = by(c.x);
          c.d.y = by(c.y);
          c.d.w = Math.max(1, c.w * f);
          c.d.h = Math.max(1, c.h * f);
        }
        if (typeof c.fontSize === "number")
          c.d.fontSize = Math.min(200, Math.max(8, c.fontSize * f));
        c.d.radius = by(c.radius);
        c.d.gap = by(c.gap);
        c.d.padding = by(c.padding);
        c.d.strokeWidth = by(c.strokeWidth);
        if (f !== 1)
          unbindKeys(c.d, [
            c.d.id !== id && "w",
            c.d.id !== id && "h",
            "fontSize",
            "radius",
            "gap",
            "padding",
            "strokeWidth",
          ]);
      }
    }

    // Proportional scale of several layers (Wonder R2-multi-scale-after: a 240×120 union of 100×60 and 100×120 frames
    // dragged to 360×180 gives 150×90 and 150×180 frames, the 40 px gap becoming 60): each layer scales with its
    // content, and a free layer's offset from `anchor` (a world point) scales too. Without an anchor (or inside an auto
    // layout) a layer keeps its own x/y — its top-left stays put.
    function scaleSnapshot(ids) {
      return ids
        .map(find)
        .filter((n) => n && !n.locked && n.w > 0 && n.h > 0)
        .map((n) => ({
          n,
          s: { x: n.x, y: n.y, w: n.w, h: n.h, wPct: n.wPct, hPct: n.hPct },
          r: ctx.worldRect(n.id),
          flow: isFlow(find(n.parentId)),
          content: scaleContent(n.id),
        }));
    }
    function minFactor(snaps) {
      return Math.max(0, ...snaps.map(({ s }) => Math.max(MIN_SIZE / s.w, MIN_SIZE / s.h)));
    }
    function applyScale(snaps, k, anchor) {
      for (const { n, s, r, flow, content } of snaps) {
        n.w = r2(s.w * k);
        n.h = r2(s.h * k);
        unbindKeys(n, ["w", "h"]);
        if (n.wMode && n.wMode !== "fixed") {
          n.wMode = "fixed";
          delete n.wCalc;
        }
        if (n.hMode && n.hMode !== "fixed") {
          n.hMode = "fixed";
          delete n.hCalc;
        }
        if (s.wPct !== undefined) n.wPct = r2(s.wPct * k);
        if (s.hPct !== undefined) n.hPct = r2(s.hPct * k);
        if (anchor && r && !flow) {
          n.x = r2(s.x + (r.x - anchor.x) * (k - 1));
          n.y = r2(s.y + (r.y - anchor.y) * (k - 1));
        }
        applyContentScale(content, n.id, k);
      }
    }
    // Top-level members of a set of ids (a selected layer inside another selected layer scales with it).
    function topOf(ids) {
      const set = new Set(ids);
      return ids.filter((id) => {
        for (let p = find(id)?.parentId; p; p = find(p)?.parentId) if (set.has(p)) return false;
        return true;
      });
    }
    function unionOf(snaps) {
      const rects = snaps.map((x) => x.r).filter(Boolean);
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

    // Scale the selection's union from a corner with the Scale tool (Wonder R2): the opposite corner stays put and
    // the factor is the drag projected on the union's diagonal, as for a single layer. One undo step.
    function startUnionScale(e, corner) {
      const snaps = scaleSnapshot(topOf([...sel()].filter((id) => !find(id)?.hidden))),
        u = unionOf(snaps);
      if (!snaps.length || !u || !(u.w > 0) || !(u.h > 0)) return;
      const hx = corner.includes("e") ? 1 : -1,
        hy = corner.includes("s") ? 1 : -1;
      const anchor = { x: hx > 0 ? u.x : u.x + u.w, y: hy > 0 ? u.y : u.y + u.h },
        start = { x: e.clientX, y: e.clientY },
        g = gesture(),
        min = minFactor(snaps);
      begin();
      track(
        e,
        (ev) => {
          const dx = (ev.clientX - start.x) / cam.zoom,
            dy = (ev.clientY - start.y) / cam.zoom;
          const k = Math.max(
            min,
            diagonalFactor(u.w, u.h, Math.max(1, u.w + hx * dx), Math.max(1, u.h + hy * dy)),
          );
          g.commit();
          applyScale(snaps, k, anchor);
          ed.render();
        },
        end,
      );
    }

    // Scale layers by a factor from the inspector's Scale section (Wonder T4-scale-retry / R2: W, H and %), the way
    // the Scale tool does: proportional, children and type included. One layer keeps its top-left; several scale
    // about their union's top-left. One undo step.
    function scaleBy(ids, factor) {
      const snaps = scaleSnapshot(topOf([].concat(ids || []))),
        k0 = Number(factor);
      if (!snaps.length || !(k0 > 0) || !Number.isFinite(k0)) return false;
      const k = Math.max(k0, minFactor(snaps));
      if (Math.abs(k - 1) < 1e-9) return false;
      const u = snaps.length > 1 ? unionOf(snaps) : null;
      gesture().commit();
      applyScale(snaps, k, u && { x: u.x, y: u.y });
      ed.render();
      return true;
    }

    // Pointer-down hook for the canvas: returns true when the press belongs to the selection chrome.
    function pointerDown(e) {
      if (e.button !== 0) return false; // right-click opens the layer menu instead
      if (e.target.closest?.("#selection-chat-chip")) return true; // the click runs the chip's action
      // Wonder R2-multi-scale-before: with the Scale tool the union's corners scale the whole selection.
      const handle =
        tool() === "scale" &&
        sel().size > 1 &&
        e.target.closest?.("#canvas-overlay .selection-union > .union-handle");
      if (handle) {
        startUnionScale(e, handle.dataset.corner);
        return true;
      }
      const zone = e.target.closest?.("#canvas-overlay .rotate-zone, #canvas-overlay .resize-edge");
      if (!zone) return false;
      const id = [...sel()][0];
      if (!id || sel().size !== 1) return false;
      if (zone.classList.contains("rotate-zone")) startRotate(e, id);
      else startResize(e, id, zone.dataset.edge);
      return true;
    }

    return { draw, startResize, startRotate, scaleBy, pointerDown, addToChat, busy: () => busy };
  }

  window.BetterSelectionChrome = {
    install,
    normalize,
    chromeAngle,
    diagonalFactor,
    frameOf,
    placeFrame,
  };
})();
