// Runs in the real, sandboxed renderer. No document or DOM shortcuts.
module.exports = async function install() {
  const settle = () =>
    new Promise((resolve) =>
      setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 0),
    );
  let edits = 0;
  window.__perf = {
    settle,
    async action(kind, document) {
      const start = performance.now();
      if (kind === "load") window.design.loadDocument(document);
      if (kind === "render") window.render();
      if (kind === "edit")
        window.design.updateNodes(["n1"], { color: ++edits % 2 ? "#ab3456" : "#cd5678" });
      if (kind === "selectAll")
        window.design.setSelection(window.design.getDocument().pages[0].nodes.map((n) => n.id));
      const syncMs = performance.now() - start;
      await settle();
      return { syncMs, paintFenceMs: performance.now() - start };
    },
    async motion(kind, duration = 2000) {
      const workspace = document.querySelector("#workspace");
      const target = document.querySelector('[data-id="n1"].layer');
      const box = document.querySelector("#canvas-wrap").getBoundingClientRect();
      let x = box.left + box.width / 2,
        y = box.top + box.height / 2;
      const before =
        kind === "drag"
          ? (({ x, y, parentId }) => ({ x, y, parentId }))(
              window.design.getDocument().pages[0].nodes.find((n) => n.id === "n1"),
            )
          : window.design.getCamera();
      if (kind === "drag") {
        const r = target.getBoundingClientRect();
        x = r.x + r.width / 2;
        y = r.y + r.height / 2;
        target.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            pointerId: 99,
            button: 0,
            buttons: 1,
            clientX: x,
            clientY: y,
          }),
        );
      }
      const intervals = [],
        handlers = [];
      let last = performance.now(),
        start = last,
        count = 0;
      await new Promise((resolve) => {
        function frame(now) {
          intervals.push(now - last);
          last = now;
          if (now - start >= duration) {
            resolve();
            return;
          }
          const t = performance.now();
          if (kind === "drag")
            window.dispatchEvent(
              new PointerEvent("pointermove", {
                bubbles: true,
                pointerId: 99,
                buttons: 1,
                clientX: x + 45 + 30 * Math.sin(count / 10),
                clientY: y + 35 + 20 * Math.cos(count / 10),
              }),
            );
          else
            workspace.dispatchEvent(
              new WheelEvent("wheel", {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                deltaX: kind === "pan" ? 3 * Math.cos(count / 10) : 0,
                deltaY: kind === "zoom" ? (count % 40 < 20 ? 1 : -1) : 2 * Math.sin(count / 10),
                ctrlKey: kind === "zoom",
              }),
            );
          handlers.push(performance.now() - t);
          count++;
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      });
      if (kind === "drag")
        window.dispatchEvent(
          new PointerEvent("pointerup", {
            pointerId: 99,
            button: 0,
            buttons: 0,
            clientX: x,
            clientY: y,
          }),
        );
      await settle();
      const after =
        kind === "drag"
          ? (({ x, y, parentId }) => ({ x, y, parentId }))(
              window.design.getDocument().pages[0].nodes.find((n) => n.id === "n1"),
            )
          : window.design.getCamera();
      return {
        intervals,
        handlers,
        durationMs: last - start,
        events: count,
        before,
        after,
        changed: JSON.stringify(before) !== JSON.stringify(after),
      };
    },
  };
};
