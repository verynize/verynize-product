// Drop-target hit testing for canvas drags (web/canvas-interactions.js dropTarget).
//
// A drag drops into the first frame layer that `document.elementsFromPoint` lists under the pointer. That list is
// built by hit testing the whole page, which grows with the page (about 8 ms per pointer move at 20,000 layers), so
// a drag asks again only when the answer can change: when the pointer enters or leaves a frame. The frames' boxes are
// measured once per camera, viewport and render (one pass, visible frames only); a pointer inside a set of boxes it
// has been in before gets the answer it got then. Where boxes do not describe the hit region exactly (rotated or scaled
// frames, rounded corners, a pointer within a pixel of an edge) every move hit-tests as before.
(() => {
  const EDGE = 1; // px: closer than this to a box edge, the hit test decides

  function create({ canvas, wrap, camera, find }) {
    let boxes = null, // visible frames: {id, left, top, right, bottom (clipped by their ancestors), own, corner, exact}
      key = "",
      answers = new Map(), // signature (the boxes under the pointer) → hit-test answer, for `answersFor`
      answersFor = null;

    function viewKey(view) {
      return [
        camera.x,
        camera.y,
        camera.zoom,
        view.left,
        view.top,
        view.width,
        view.height,
        innerWidth,
        innerHeight,
      ].join();
    }

    function measure(view) {
      const out = [],
        clips = new Map(); // frame element → the rect its content is clipped to, and whether its geometry is exact
      const screen = {
        left: Math.max(view.left, 0),
        top: Math.max(view.top, 0),
        right: Math.min(view.right, innerWidth),
        bottom: Math.min(view.bottom, innerHeight),
      };
      for (const el of canvas.querySelectorAll(".frame-layer")) {
        // Inside a culled board (content-visibility: hidden) nothing is hit; measuring it would lay it out.
        if (el.parentElement?.closest("[data-culled]")) continue;
        const parent = el.parentElement?.closest(".frame-layer");
        const inherited = (parent && clips.get(parent)) || { rect: screen, exact: true };
        const r = el.getBoundingClientRect(),
          n = find(el.dataset.id);
        const rect = {
          left: Math.max(r.left, inherited.rect.left),
          top: Math.max(r.top, inherited.rect.top),
          right: Math.min(r.right, inherited.rect.right),
          bottom: Math.min(r.bottom, inherited.rect.bottom),
        };
        // A rotated or scaled layer (or one inside such a layer) covers less than its bounding box.
        const z = camera.zoom,
          square =
            Math.abs(r.width - el.offsetWidth * z) <= 0.5 &&
            Math.abs(r.height - el.offsetHeight * z) <= 0.5;
        const exact = inherited.exact && square && !n?.ellipse;
        const radius = n
          ? Math.max(
              0,
              ...[
                "radius",
                "radiusTopLeft",
                "radiusTopRight",
                "radiusBottomLeft",
                "radiusBottomRight",
              ].map((k) => Number(n[k]) || 0),
            )
          : 0;
        // A rounded clip cuts its content's corners too: those corners are inside this frame's own corner zones,
        // which frameAt treats as inexact whenever the pointer is in this frame's box.
        clips.set(el, n?.clipContent ? { rect, exact } : inherited);
        if (rect.right <= rect.left || rect.bottom <= rect.top) continue;
        const own = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        out.push({ id: el.dataset.id, ...rect, own, corner: radius * z, exact });
      }
      return out;
    }

    return {
      // After a render: layers may have moved, appeared or gone.
      invalidate() {
        boxes = null;
        answers.clear();
      },
      // `hit(x, y)` is the full hit test; `owner` identifies what it depends on besides the point (the drag's
      // excluded layers), so a new drag never reuses an answer from the previous one.
      frameAt(x, y, owner, hit) {
        const view = wrap.getBoundingClientRect(),
          k = viewKey(view);
        if (!boxes || k !== key) {
          boxes = measure(view);
          key = k;
          answers.clear();
        }
        let signature = "";
        for (const b of boxes) {
          if (x < b.left - EDGE || x >= b.right + EDGE || y < b.top - EDGE || y >= b.bottom + EDGE)
            continue;
          const near =
            Math.abs(x - b.left) < EDGE ||
            Math.abs(x - b.right) < EDGE ||
            Math.abs(y - b.top) < EDGE ||
            Math.abs(y - b.bottom) < EDGE;
          if (near) {
            signature = null;
            break;
          }
          const o = b.own,
            inCorner =
              b.corner > 0 &&
              (x < o.left + b.corner || x > o.right - b.corner) &&
              (y < o.top + b.corner || y > o.bottom - b.corner);
          if (!b.exact || inCorner) {
            signature = null;
            break;
          }
          signature += b.id + "\n";
        }
        if (owner !== answersFor) {
          answersFor = owner;
          answers.clear();
        }
        if (signature !== null && answers.has(signature)) return answers.get(signature);
        const result = hit(x, y);
        if (signature !== null) answers.set(signature, result);
        return result;
      },
    };
  }

  window.VerynizeDropHits = { create };
})();
