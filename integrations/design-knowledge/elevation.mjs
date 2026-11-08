// Shared shape and elevation helpers for archetypes and styles. Original to Verynize.

export const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** layers: [[x, y, blur, spread, color, inset?], ...] → { css, tailwind } */
export function shadow(layers) {
  if (!layers.length) return { css: "none", tailwind: "shadow-none" };
  const parts = layers.map(
    ([x, y, blur, spread, color, inset]) =>
      `${inset ? "inset " : ""}${x}px ${y}px ${blur}px ${spread}px ${color}`,
  );
  return { css: parts.join(", "), tailwind: `shadow-[${parts.join(",").replace(/ /g, "_")}]` };
}

/** Standard two-layer light-mode recipe tinted with the archetype's ink color. */
export function softElevation(ink, { raised = [0.05, 0.07], overlay = [0.06, 0.12] } = {}) {
  return {
    light: "top",
    flat: shadow([]),
    raised: shadow([
      [0, 1, 2, 0, rgba(ink, raised[0])],
      [0, 2, 8, 0, rgba(ink, raised[1])],
    ]),
    overlay: shadow([
      [0, 2, 4, 0, rgba(ink, overlay[0])],
      [0, 16, 40, -4, rgba(ink, overlay[1])],
    ]),
  };
}

/** Dark surfaces: elevation comes from lighter fills plus a hairline; shadows only separate overlays. */
export function darkElevation(highlight = 0.05) {
  return {
    light: "top",
    flat: shadow([]),
    raised: shadow([
      [0, 1, 0, 0, `rgba(255,255,255,${highlight})`, true],
      [0, 1, 2, 0, "rgba(0,0,0,0.30)"],
    ]),
    overlay: shadow([
      [0, 0, 0, 1, "rgba(255,255,255,0.06)"],
      [0, 16, 48, -8, "rgba(0,0,0,0.55)"],
    ]),
  };
}

export const flatElevation = (overlayInk) => ({
  light: "top",
  flat: shadow([]),
  raised: shadow([]),
  overlay: overlayInk ? shadow([[0, 12, 32, -8, rgba(overlayInk, 0.14)]]) : shadow([]),
});

export const radius = (sm, md, lg, xl) => ({ none: 0, sm, md, lg, xl, full: 9999 });
