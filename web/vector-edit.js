"use strict";
// Vector layers on the canvas (docs/vector-nodes.md), registered on the canvas engine of web/canvas-interactions.js
// through BetterCanvas.extend. Pointer work stays imperative: the overlay is one screen-space <svg> redrawn from the
// layer's own <svg> (getScreenCTM covers zoom, pan, rotation and flips), and the document changes once per gesture.
//
// Pen tool (P): a click places a corner anchor, a drag pulls symmetric handles (Alt moves only the outgoing one), a
// click on the first anchor closes the path, Enter or Escape finishes an open one and Backspace removes the last
// anchor. The new vector hugs its geometry, has no fill and a 2 px stroke in the canvas ink colour.
// Anchor editing (double-click a vector, or Enter with one selected): drag anchors (Shift-click adds to the
// selection), drag handles (a smooth anchor keeps its handles in line; Alt breaks them apart), click a segment to
// add an anchor there, double-click an anchor to toggle corner/smooth, Delete removes the selected anchors. Escape,
// Enter or a click outside the layer leaves. Each drag, insertion, toggle or deletion is one undo step; the box and
// viewBox are refitted to the geometry so every point stays where it is on screen.
// SVG in: pasted SVG markup and dropped or pasted .svg files become vector layers (web/vector-svg.js). Drawings a
// vector cannot represent fall through to the image path with a footer note.
// SVG out: "Copy as SVG" (edit.copySvg) writes the selected vector layers as one SVG document.
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const HIT = 7; // screen px around anchors, handles and segments
  const DRAG = 3; // screen px before a press becomes a drag
  const r3 = (v) => Math.round(v * 1000) / 1000;

  function extend(c) {
    const { ed } = c;
    const wrap = document.getElementById("canvas-wrap"),
      workspace = document.getElementById("workspace");
    if (!wrap || !workspace) return;
    const G = window.VerynizeVector,
      S = window.VerynizeVectorSvg;
    const readOnly = () => document.body.classList.contains("cloud-read-only");
    const tool = () => window.design?.getTool?.();
    const typing = (t) =>
      !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

    const overlay = document.createElementNS(NS, "svg");
    overlay.id = "vector-edit-overlay";
    overlay.setAttribute("aria-hidden", "true");
    wrap.append(overlay);
    const local = (clientX, clientY) => {
      const r = overlay.getBoundingClientRect();
      return [clientX - r.left, clientY - r.top];
    };
    const el = (tag, attrs) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      return e;
    };

    // ---------- World ↔ screen (pen) ----------
    function toClient(x, y) {
      const zoom = window.design.getCamera().zoom,
        o = c.screenToWorld(0, 0);
      return [(x - o.x) * zoom, (y - o.y) * zoom];
    }
    const toLocal = (x, y) => local(...toClient(x, y));

    // ---------- Pen ----------
    let pen = null; // {points (world), parent, origin, hover, closed}
    function penDown(e) {
      const p = c.screenToWorld(e.clientX, e.clientY);
      if (!pen) {
        const frame = c.frameAt(e.clientX, e.clientY);
        const free =
          frame &&
          (frame.layout || "free") === "free" &&
          !Number(frame.rotation) &&
          !frame.flipX &&
          !frame.flipY;
        const r = free ? c.worldRect(frame.id) : null;
        const border = free ? Number(frame.strokeWidth) || 0 : 0;
        pen = {
          points: [],
          parent: r ? frame.id : null,
          origin: r ? { x: r.x + border, y: r.y + border } : { x: 0, y: 0 },
          ink: window.BetterCanvas?.inkAt?.(e.clientX, e.clientY) || "#000000",
          hover: null,
        };
      }
      const first = pen.points[0];
      if (first && pen.points.length >= 2) {
        const [fx, fy] = toClient(first.x, first.y);
        if (Math.hypot(fx - e.clientX, fy - e.clientY) <= HIT) {
          finishPen(true);
          return;
        }
      }
      const point = { x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y };
      pen.points.push(point);
      const start = { x: e.clientX, y: e.clientY };
      let dragging = false;
      const move = (ev) => {
        if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG) return;
        dragging = true;
        const q = c.screenToWorld(ev.clientX, ev.clientY);
        point.ox = q.x;
        point.oy = q.y;
        if (!ev.altKey) {
          point.ix = 2 * point.x - q.x;
          point.iy = 2 * point.y - q.y;
        }
        draw();
      };
      const up = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        draw();
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      draw();
    }
    function finishPen(closed) {
      const drawn = pen;
      pen = null;
      draw();
      if (!drawn || drawn.points.length < 2) {
        if (drawn) c.footer("A path needs at least two anchors");
        return null;
      }
      const segs = G.fromContours([{ closed, points: drawn.points }]);
      const b = G.pathBounds(segs);
      if (!b || (b.w < 0.5 && b.h < 0.5)) return null;
      const bw = Math.max(1, b.w),
        bh = Math.max(1, b.h),
        bx = b.x - (bw - b.w) / 2,
        by = b.y - (bh - b.h) / 2;
      const d = G.serializePath(G.transformSegments(segs, [1, 0, 0, 1, -bx, -by]));
      try {
        window.design.addNode("vector", {
          name: "Vector",
          parentId: drawn.parent,
          x: r3(bx - drawn.origin.x),
          y: r3(by - drawn.origin.y),
          w: r3(bw),
          h: r3(bh),
          viewBox: [0, 0, r3(bw), r3(bh)],
          paths: [{ d }],
          fills: [],
          color: "transparent",
          radius: 0,
          strokeWidth: 2,
          strokeColor: drawn.ink,
          strokeJoin: "round",
          strokeCap: "round",
        });
      } catch (error) {
        c.footer("Unable to add the path: " + error.message);
        return null;
      }
      window.design.setTool("move");
      return [...c.sel()][0] || null;
    }

    // ---------- Anchor editing ----------
    let edit = null; // {id, pathsRef, paths: [{fillRule, contours}], selected: [{p, c, k}], drag}
    const svgOf = (id) => wrap.querySelector(`#canvas .layer[data-id="${CSS.escape(id)}"] > svg`);
    function load(node) {
      return node.paths.map((p) => ({
        fillRule: p.fillRule,
        contours: G.toContours(G.parsePath(p.d)),
      }));
    }
    function enterEdit(id) {
      const node = c.find(id);
      if (!node || node.type !== "vector" || node.locked || readOnly()) return false;
      if (!c.sel().has(id) || c.sel().size !== 1) window.design.setSelection([id]);
      edit = { id, pathsRef: node.paths, paths: load(node), selected: [], drag: null };
      document.body.classList.add("vector-editing");
      c.footer("Editing anchors: drag to move, click a segment to add, Delete removes, Esc leaves");
      draw();
      return true;
    }
    function exitEdit() {
      if (!edit) return;
      edit = null;
      document.body.classList.remove("vector-editing");
      draw();
    }
    /** user units → overlay px, through the layer's own <svg>. */
    function matrix() {
      const svg = edit && svgOf(edit.id),
        m = svg?.getScreenCTM?.();
      if (!m) return null;
      const r = overlay.getBoundingClientRect();
      return [m.a, m.b, m.c, m.d, m.e - r.left, m.f - r.top];
    }
    const pathsOut = () =>
      edit.paths
        .map((p) => {
          const segs = G.fromContours(p.contours);
          if (!segs.some((s) => s[0] !== "M" && s[0] !== "Z")) return null;
          const d = G.serializePath(segs);
          return p.fillRule ? { d, fillRule: p.fillRule } : { d };
        })
        .filter(Boolean);
    // Live preview while dragging: the layer's <path> elements are fills × paths, then the stroke × paths.
    function preview() {
      const svg = svgOf(edit.id);
      if (!svg) return;
      const ds = edit.paths.map((p) => G.serializePath(G.fromContours(p.contours)));
      svg
        .querySelectorAll("path")
        .forEach((path, i) => path.setAttribute("d", ds[i % ds.length] || "M0 0"));
    }
    function commit() {
      const node = c.find(edit.id);
      if (!node) return exitEdit();
      const paths = pathsOut();
      if (!paths.length) {
        const id = edit.id;
        exitEdit();
        window.design.setSelection([id]);
        window.design.runCommand("edit.delete");
        return;
      }
      const fitted = G.fitBox(node, paths);
      const patch = {
        paths,
        ...(fitted
          ? {
              x: r3(fitted.x),
              y: r3(fitted.y),
              w: r3(fitted.w),
              h: r3(fitted.h),
              viewBox: fitted.viewBox.map(r3),
            }
          : {}),
      };
      try {
        window.design.updateNodes([edit.id], patch);
      } catch (error) {
        c.footer("Unable to edit the path: " + error.message);
      }
      // The document holds `patch.paths` now; reload from it (refitting changed nothing in path coordinates).
      const updated = c.find(edit.id);
      if (edit && updated) {
        const selected = edit.selected;
        edit.pathsRef = updated.paths;
        edit.paths = load(updated);
        edit.selected = selected.filter((s) => edit.paths[s.p]?.contours[s.c]?.points[s.k]);
      }
      draw();
    }
    const pointOf = (s) => edit.paths[s.p].contours[s.c].points[s.k];
    const isSelected = (s) => edit.selected.some((t) => t.p === s.p && t.c === s.c && t.k === s.k);
    /** What lies under an overlay point: {kind: 'handle'|'anchor'|'segment', ...} or null. */
    function hitTest(x, y, m) {
      const at = (px, py) => G.applyPoint(m, px, py);
      // Handles of the selected anchors first: they sit on top.
      for (const s of edit.selected) {
        const pt = pointOf(s);
        for (const side of ["in", "out"]) {
          const hx = side === "in" ? pt.ix : pt.ox,
            hy = side === "in" ? pt.iy : pt.oy;
          if (hx === pt.x && hy === pt.y) continue;
          const [sx, sy] = at(hx, hy);
          if (Math.hypot(sx - x, sy - y) <= HIT) return { kind: "handle", ...s, side };
        }
      }
      for (let p = 0; p < edit.paths.length; p++)
        for (let ci = 0; ci < edit.paths[p].contours.length; ci++) {
          const pts = edit.paths[p].contours[ci].points;
          for (let k = 0; k < pts.length; k++) {
            const [sx, sy] = at(pts[k].x, pts[k].y);
            if (Math.hypot(sx - x, sy - y) <= HIT) return { kind: "anchor", p, c: ci, k };
          }
        }
      const inv = G.invert(m);
      if (!inv) return null;
      const [ux, uy] = G.applyPoint(inv, x, y);
      const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
      let best = null;
      edit.paths.forEach((path, p) => {
        const hit = G.nearestSegment(path.contours, ux, uy);
        if (hit && hit.distance * scale <= HIT && (!best || hit.distance < best.distance))
          best = { ...hit, p };
      });
      return best
        ? { kind: "segment", p: best.p, c: best.contour, k: best.index, t: best.t }
        : null;
    }
    function editDown(e) {
      const m = matrix();
      if (!m) return false;
      const [x, y] = local(e.clientX, e.clientY);
      let hit = hitTest(x, y, m);
      if (!hit) {
        const layer = e.target.closest?.("#canvas .layer");
        if (layer?.dataset.id === edit.id) {
          if (!e.shiftKey) edit.selected = [];
          draw();
          return true;
        }
        exitEdit();
        return false;
      }
      if (hit.kind === "segment") {
        const contour = edit.paths[hit.p].contours[hit.c];
        const k = G.splitAt(contour, hit.k, hit.t);
        hit = { kind: "anchor", p: hit.p, c: hit.c, k };
        edit.selected = [{ p: hit.p, c: hit.c, k }];
        startDrag(e, hit, m, true);
        return true;
      }
      if (hit.kind === "anchor") {
        const s = { p: hit.p, c: hit.c, k: hit.k };
        if (e.shiftKey) {
          edit.selected = isSelected(s)
            ? edit.selected.filter((t) => !(t.p === s.p && t.c === s.c && t.k === s.k))
            : [...edit.selected, s];
          draw();
          return true;
        }
        if (!isSelected(s)) edit.selected = [s];
      }
      startDrag(e, hit, m, false);
      return true;
    }
    function startDrag(e, hit, m, changed) {
      const inv = G.invert(m);
      const start = local(e.clientX, e.clientY),
        [ux0, uy0] = G.applyPoint(inv, ...start);
      const moving =
        hit.kind === "anchor"
          ? edit.selected.map((s) => ({ point: pointOf(s), from: { ...pointOf(s) } }))
          : [];
      const target = hit.kind === "handle" ? pointOf(hit) : null;
      const from = target ? { ...target } : null;
      const wasSmooth = target ? G.smooth(target) : false;
      let moved = false;
      const move = (ev) => {
        const here = local(ev.clientX, ev.clientY);
        if (!moved && Math.hypot(here[0] - start[0], here[1] - start[1]) < DRAG) return;
        moved = true;
        const [ux, uy] = G.applyPoint(inv, ...here),
          dx = ux - ux0,
          dy = uy - uy0;
        for (const { point, from: f } of moving)
          Object.assign(point, {
            x: f.x + dx,
            y: f.y + dy,
            ix: f.ix + dx,
            iy: f.iy + dy,
            ox: f.ox + dx,
            oy: f.oy + dy,
          });
        if (target) {
          const own = hit.side === "in" ? ["ix", "iy"] : ["ox", "oy"],
            other = hit.side === "in" ? ["ox", "oy"] : ["ix", "iy"];
          target[own[0]] = from[own[0]] + dx;
          target[own[1]] = from[own[1]] + dy;
          // A smooth anchor keeps its handles in line (the other one keeps its length) unless Alt breaks them.
          if (wasSmooth && !ev.altKey) {
            const len = Math.hypot(from[other[0]] - from.x, from[other[1]] - from.y);
            const vx = target.x - target[own[0]],
              vy = target.y - target[own[1]],
              l = Math.hypot(vx, vy) || 1;
            target[other[0]] = target.x + (vx / l) * len;
            target[other[1]] = target.y + (vy / l) * len;
          } else {
            target[other[0]] = from[other[0]];
            target[other[1]] = from[other[1]];
          }
        }
        preview();
        draw();
      };
      const up = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        if (edit) edit.drag = null;
        if (edit && (moved || changed)) commit();
        else draw();
      };
      edit.drag = true;
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      draw();
    }
    function toggleSmooth(s) {
      const contour = edit.paths[s.p].contours[s.c],
        pts = contour.points,
        pt = pts[s.k];
      if (pt.ix !== pt.x || pt.iy !== pt.y || pt.ox !== pt.x || pt.oy !== pt.y)
        Object.assign(pt, { ix: pt.x, iy: pt.y, ox: pt.x, oy: pt.y });
      else {
        // Handles along the line through the neighbours, a third of the way to each.
        const prev = pts[s.k - 1] || (contour.closed ? pts[pts.length - 1] : null),
          next = pts[s.k + 1] || (contour.closed ? pts[0] : null);
        const a = prev || pt,
          b = next || pt;
        let vx = b.x - a.x,
          vy = b.y - a.y;
        const l = Math.hypot(vx, vy) || 1;
        vx /= l;
        vy /= l;
        const lin = prev ? Math.hypot(pt.x - prev.x, pt.y - prev.y) / 3 : 0,
          lout = next ? Math.hypot(next.x - pt.x, next.y - pt.y) / 3 : 0;
        Object.assign(pt, {
          ix: pt.x - vx * lin,
          iy: pt.y - vy * lin,
          ox: pt.x + vx * lout,
          oy: pt.y + vy * lout,
        });
      }
      commit();
    }
    function deleteSelected() {
      const doomed = new Set(edit.selected.map((s) => `${s.p}:${s.c}:${s.k}`));
      edit.paths.forEach((path, p) => {
        path.contours = path.contours
          .map((contour, ci) => ({
            ...contour,
            points: contour.points.filter((_, k) => !doomed.has(`${p}:${ci}:${k}`)),
          }))
          .filter((contour) => contour.points.length >= 2);
      });
      edit.selected = [];
      commit();
    }
    // Undo, redo, remote edits or a new selection while editing: follow the document.
    function sync() {
      if (!edit || edit.drag) return;
      const node = c.find(edit.id),
        selection = c.sel();
      if (!node || node.type !== "vector" || selection.size !== 1 || !selection.has(edit.id))
        return exitEdit();
      if (node.paths !== edit.pathsRef) {
        edit.pathsRef = node.paths;
        edit.paths = load(node);
        edit.selected = [];
      }
    }

    // ---------- Overlay ----------
    let frame = 0;
    function draw() {
      overlay.replaceChildren();
      overlay.toggleAttribute("data-active", !!(pen || edit));
      if (pen) drawPen();
      if (edit) drawEdit();
      if ((pen || edit) && !frame) frame = requestAnimationFrame(tick);
    }
    // Camera moves and renders do not notify this module: follow them while a tool is active.
    let last = "";
    function tick() {
      frame = 0;
      if (pen && tool() !== "pen") finishPen(false);
      sync();
      if (!pen && !edit) return draw();
      const m = edit ? matrix() : null;
      const key = JSON.stringify([window.design.getCamera(), m]);
      if (key !== last) {
        last = key;
        draw();
      } else frame = requestAnimationFrame(tick);
    }
    function drawPen() {
      const pts = pen.points.map((p) => ({ ...p }));
      if (pen.hover && pts.length)
        pts.push({
          x: pen.hover.x,
          y: pen.hover.y,
          ix: pen.hover.x,
          iy: pen.hover.y,
          ox: pen.hover.x,
          oy: pen.hover.y,
        });
      const screen = pts.map((p) => {
        const [x, y] = toLocal(p.x, p.y),
          [ix, iy] = toLocal(p.ix, p.iy),
          [ox, oy] = toLocal(p.ox, p.oy);
        return { x, y, ix, iy, ox, oy };
      });
      if (screen.length > 1)
        overlay.append(
          el("path", {
            class: "vector-edit-path",
            d: G.serializePath(G.fromContours([{ closed: false, points: screen }])),
          }),
        );
      pen.points.forEach((_, i) => {
        const p = screen[i];
        if (i === pen.points.length - 1)
          for (const [hx, hy] of [
            [p.ix, p.iy],
            [p.ox, p.oy],
          ])
            if (hx !== p.x || hy !== p.y) {
              overlay.append(
                el("line", { class: "vector-edit-handle-line", x1: p.x, y1: p.y, x2: hx, y2: hy }),
              );
              overlay.append(el("circle", { class: "vector-edit-handle", cx: hx, cy: hy, r: 3.5 }));
            }
        overlay.append(
          el("rect", {
            class: "vector-edit-anchor" + (i === 0 && pen.points.length > 1 ? " first" : ""),
            x: p.x - 3.5,
            y: p.y - 3.5,
            width: 7,
            height: 7,
            "data-pen-anchor": i,
          }),
        );
      });
    }
    function drawEdit() {
      const m = matrix();
      if (!m) return;
      const at = (x, y) => G.applyPoint(m, x, y);
      const d = edit.paths
        .map((p) => G.serializePath(G.transformSegments(G.fromContours(p.contours), m)))
        .join("");
      overlay.append(el("path", { class: "vector-edit-path", d }));
      const shown = new Set();
      for (const s of edit.selected) {
        const pts = edit.paths[s.p].contours[s.c].points,
          n = pts.length;
        for (const k of [s.k - 1, s.k, s.k + 1]) shown.add(`${s.p}:${s.c}:${(k + n) % n}`);
      }
      edit.paths.forEach((path, p) =>
        path.contours.forEach((contour, ci) =>
          contour.points.forEach((pt, k) => {
            const [x, y] = at(pt.x, pt.y),
              key = `${p}:${ci}:${k}`;
            if (shown.has(key))
              for (const [hx, hy, side] of [
                [pt.ix, pt.iy, "in"],
                [pt.ox, pt.oy, "out"],
              ]) {
                if (hx === pt.x && hy === pt.y) continue;
                const [sx, sy] = at(hx, hy);
                overlay.append(
                  el("line", { class: "vector-edit-handle-line", x1: x, y1: y, x2: sx, y2: sy }),
                );
                overlay.append(
                  el("circle", {
                    class: "vector-edit-handle",
                    cx: sx,
                    cy: sy,
                    r: 3.5,
                    "data-handle": `${key}:${side}`,
                  }),
                );
              }
            const selected = isSelected({ p, c: ci, k });
            overlay.append(
              el("rect", {
                class: "vector-edit-anchor" + (selected ? " selected" : ""),
                x: x - 3.5,
                y: y - 3.5,
                width: 7,
                height: 7,
                "data-anchor": key,
              }),
            );
          }),
        ),
      );
    }

    // ---------- Events (capture: before the canvas engine sees them) ----------
    wrap.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== 0 || readOnly() || workspace.classList.contains("space-pan")) return;
        if (tool() === "pen" && !edit) {
          e.preventDefault();
          e.stopImmediatePropagation();
          penDown(e);
          return;
        }
        if (edit && (tool() === "move" || tool() === "scale") && editDown(e)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    wrap.addEventListener("pointermove", (e) => {
      if (!pen || e.buttons) return;
      pen.hover = c.screenToWorld(e.clientX, e.clientY);
      draw();
    });
    wrap.addEventListener(
      "dblclick",
      (e) => {
        if (readOnly() || pen) return;
        if (edit) {
          const m = matrix(),
            hit = m && hitTest(...local(e.clientX, e.clientY), m);
          if (hit?.kind === "anchor") toggleSmooth(hit);
          e.stopImmediatePropagation();
          return;
        }
        const layer = e.target.closest?.("#canvas .layer");
        if (layer?.dataset.designType === "vector" && enterEdit(layer.dataset.id))
          e.stopImmediatePropagation();
      },
      true,
    );
    window.addEventListener(
      "keydown",
      (e) => {
        if (typing(e.target) || e.metaKey || e.ctrlKey) return;
        const stop = () => {
          e.preventDefault();
          e.stopImmediatePropagation();
        };
        if (pen) {
          if (e.key === "Enter" || e.key === "Escape") {
            stop();
            finishPen(false);
            if (tool() === "pen") window.design.setTool("move");
          } else if ((e.key === "Backspace" || e.key === "Delete") && pen.points.length) {
            stop();
            pen.points.pop();
            draw();
          }
          return;
        }
        if (edit) {
          if (e.key === "Escape" || e.key === "Enter") {
            stop();
            exitEdit();
          } else if ((e.key === "Backspace" || e.key === "Delete") && edit.selected.length) {
            stop();
            deleteSelected();
          }
          return;
        }
        if (e.key === "Enter" && !readOnly() && c.sel().size === 1) {
          const node = c.find([...c.sel()][0]);
          if (node?.type === "vector" && enterEdit(node.id)) stop();
        }
      },
      true,
    );

    // ---------- SVG in ----------
    const looksLikeSvg = (text) =>
      /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text);
    /** Vector layers for `markup` centred on a world point, inside `frame` when given. Returns ids, or null to let
     * the caller fall back to an image layer. */
    function insertSvg(markup, point, name = "Vector", frame = null) {
      const result = S.importSvg(markup, { color: "#000000" });
      if (!result.ok) {
        c.footer(`${result.reason}; added as an image`);
        return null;
      }
      const size = window.imageDrop?.fitSize?.(result.width, result.height) || {
        w: result.width,
        h: result.height,
      };
      let ox = 0,
        oy = 0;
      if (frame) {
        const r = c.worldRect(frame.id),
          border = Number(frame.strokeWidth) || 0;
        if (r) {
          ox = r.x + border;
          oy = r.y + border;
        }
      }
      const nodes = S.toNodes(result, {
        name,
        x: r3(point.x - ox - size.w / 2),
        y: r3(point.y - oy - size.h / 2),
        w: size.w,
        h: size.h,
        uid: ed.uid,
        parentId: frame?.id || null,
      }).map((n) => ({ ...ed.defaults, text: "", ...n }));
      const candidate = structuredClone(ed.design);
      candidate.pages.find((p) => p.id === ed.page().id).nodes.push(...structuredClone(nodes));
      try {
        ed.validate(candidate);
      } catch (error) {
        c.footer("Unable to add the SVG: " + error.message);
        return null;
      }
      ed.checkpoint();
      ed.nodes().push(...nodes);
      ed.setSelection(new Set([nodes[0].id]));
      ed.render();
      if (result.warnings.length) c.footer(result.warnings.slice(0, 3).join("; "));
      return [nodes[0].id];
    }
    const centre = () => {
      const r = wrap.getBoundingClientRect();
      return c.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    };
    document.addEventListener(
      "paste",
      (e) => {
        if (
          typing(e.target) ||
          readOnly() ||
          document.querySelector("dialog[open]") ||
          document.body.classList.contains("files-view")
        )
          return;
        const text = e.clipboardData?.getData("text/plain") || "";
        const files = [...(e.clipboardData?.files || [])];
        const svgFile = files.length === 1 && files[0].type === "image/svg+xml" ? files[0] : null;
        if (looksLikeSvg(text)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          // Markup a vector cannot hold is kept as an SVG image, as a pasted .svg file would be.
          if (!insertSvg(text, centre(), "Pasted SVG")) {
            const file = new File([text], "Pasted SVG.svg", { type: "image/svg+xml" });
            window.imageDrop?.dropFiles([file], ...screenOf(centre()));
          }
        } else if (svgFile) {
          // Read asynchronously; the image path is skipped only once the file proved to be vectors.
          e.preventDefault();
          e.stopImmediatePropagation();
          const point = centre();
          void svgFile.text().then((markup) => {
            if (insertSvg(markup, point, svgFile.name.replace(/\.svg$/i, "") || "Pasted SVG"))
              return;
            window.imageDrop?.dropFiles([svgFile], ...screenOf(point));
          });
        }
      },
      true,
    );
    const screenOf = (point) => toClient(point.x, point.y);
    workspace.addEventListener(
      "drop",
      (e) => {
        const files = [...(e.dataTransfer?.files || [])];
        if (readOnly() || files.length !== 1 || files[0].type !== "image/svg+xml") return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const file = files[0],
          point = c.screenToWorld(e.clientX, e.clientY),
          frame = c.frameAt(e.clientX, e.clientY),
          pageId = ed.page().id;
        window.vectorEdit.lastDrop = file.text().then((markup) => {
          if (ed.page().id !== pageId) return [];
          const target = frame && c.find(frame.id) ? frame : null;
          return (
            insertSvg(markup, point, file.name.replace(/\.svg$/i, "") || "Vector", target) ||
            window.imageDrop?.dropFiles([file], e.clientX, e.clientY) ||
            []
          );
        });
      },
      true,
    );

    // ---------- SVG out ----------
    function selectionSvg() {
      const vectors = [];
      const collect = (n) => {
        if (n.hidden) return;
        if (n.type === "vector") vectors.push(n);
        else if (n.type === "frame")
          ed.nodes()
            .filter((k) => k.parentId === n.id)
            .forEach(collect);
      };
      c.selectedNodes().forEach(collect);
      if (!vectors.length) return null;
      const boxes = vectors.map((n) => ({ n, r: c.worldRect(n.id) }));
      const box = c.union(boxes.map((b) => b.r || { x: b.n.x, y: b.n.y, w: b.n.w, h: b.n.h }));
      const tokens = ed.design.tokens || {};
      const body = boxes
        .map(({ n, r }, i) => {
          const inner = G.svgMarkup(n, tokens, { standalone: true, ids: `v${i}` });
          // Position by the layer's rendered box (rotation is drawn around its centre).
          const at = r || n;
          const cx = at.x - box.x + at.w / 2,
            cy = at.y - box.y + at.h / 2;
          const turn = Number(n.rotation) || 0,
            flip = `scale(${n.flipX ? -1 : 1} ${n.flipY ? -1 : 1})`;
          return `<g transform="translate(${r3(cx)} ${r3(cy)}) rotate(${turn}) ${flip} translate(${r3(-n.w / 2)} ${r3(-n.h / 2)})"${Number(n.opacity ?? 100) < 100 ? ` opacity="${Number(n.opacity) / 100}"` : ""}>${inner.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</g>`;
        })
        .join("");
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(box.w)}" height="${r3(box.h)}" viewBox="0 0 ${r3(box.w)} ${r3(box.h)}">${body}</svg>`;
    }
    function copySvg() {
      const svg = selectionSvg();
      if (!svg) {
        c.footer("Copy as SVG needs a vector layer");
        return false;
      }
      c.writeSystemClipboard(svg);
      c.footer("SVG copied to clipboard");
      return true;
    }
    const hasVector = () =>
      c
        .selectedNodes()
        .some(
          (n) =>
            n.type === "vector" ||
            (n.type === "frame" &&
              ed.descendants(n.id).size &&
              [...ed.descendants(n.id)].some((id) => c.find(id)?.type === "vector")),
        );
    c.register({
      id: "tool.pen",
      label: "Pen",
      section: "Tools",
      keys: ["p"],
      run: () => window.design.setTool(tool() === "pen" ? "move" : "pen"),
    });
    c.register({
      id: "edit.copySvg",
      label: "Copy as SVG",
      section: "Edit",
      keys: [],
      when: hasVector,
      run: copySvg,
    });
    c.register({
      id: "vector.editAnchors",
      label: "Edit anchors",
      section: "Edit",
      keys: [],
      when: () => c.sel().size === 1 && c.find([...c.sel()][0])?.type === "vector",
      run: () => enterEdit([...c.sel()][0]),
    });

    window.vectorEdit = {
      enterEdit,
      exitEdit,
      editing: () =>
        edit
          ? {
              id: edit.id,
              selected: edit.selected.map((s) => ({ ...s })),
              anchors: edit.paths.map((p) =>
                p.contours.map((k) => k.points.map((pt) => ({ ...pt }))),
              ),
            }
          : null,
      drawing: () => (pen ? pen.points.map((p) => ({ ...p })) : null),
      anchorScreen: (p, ci, k) => {
        const m = matrix(),
          pt = edit?.paths[p]?.contours[ci]?.points[k];
        if (!m || !pt) return null;
        const [x, y] = G.applyPoint(m, pt.x, pt.y),
          r = overlay.getBoundingClientRect();
        return { x: x + r.left, y: y + r.top };
      },
      insertSvg: (markup, point, name) => insertSvg(markup, point || centre(), name),
      selectionSvg,
      finishPen,
      lastDrop: null,
    };
  }

  window.BetterCanvas?.extend(extend);
})();
