/** Screen-space finder focus: stays crisp at any zoom without changing document layers. */
export function spotlightResult(id: string) {
  const wrap = document.getElementById("canvas-wrap");
  const canvas = document.getElementById("canvas");
  if (!wrap || !canvas) return () => {};
  const spotlight = document.createElement("div");
  spotlight.id = "find-layers-spotlight";
  spotlight.setAttribute("aria-hidden", "true");
  spotlight.hidden = true;
  wrap.append(spotlight);
  let pending = 0;
  const update = () => {
    pending = 0;
    const node = canvas.querySelector(`[data-id="${CSS.escape(id)}"]`);
    const bounds = node?.getBoundingClientRect();
    const viewport = wrap.getBoundingClientRect();
    if (!bounds || !bounds.width || !bounds.height) {
      spotlight.hidden = true;
      return;
    }
    spotlight.hidden = false;
    spotlight.toggleAttribute(
      "data-fits",
      bounds.left >= viewport.left &&
        bounds.top >= viewport.top &&
        bounds.right <= viewport.right &&
        bounds.bottom <= viewport.bottom,
    );
    spotlight.style.left = `${bounds.left - viewport.left}px`;
    spotlight.style.top = `${bounds.top - viewport.top}px`;
    spotlight.style.width = `${bounds.width}px`;
    spotlight.style.height = `${bounds.height}px`;
  };
  const schedule = () => {
    if (!pending) pending = requestAnimationFrame(update);
  };
  // Camera transforms and imperative canvas rebuilds don't trigger React renders.
  const mutations = new MutationObserver(schedule);
  mutations.observe(canvas, { attributes: true, childList: true, subtree: true });
  const resize = new ResizeObserver(schedule);
  resize.observe(wrap);
  update();
  return () => {
    cancelAnimationFrame(pending);
    mutations.disconnect();
    resize.disconnect();
    spotlight.remove();
  };
}
