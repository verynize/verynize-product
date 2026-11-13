// Bound physical capture textures, including Retina/display scaling, before creating a large window.
const MAX_SIDE = 8192;
const MAX_PIXELS = 32e6;
const outputSize = (size, scale) => Math.max(1, Math.ceil(Math.ceil(size) * scale - 1e-6));
function captureSize(width, height, requestedScale, deviceScale = 1, screenshot = false) {
  if (![width, height, requestedScale, deviceScale].every((v) => Number.isFinite(v) && v > 0))
    throw Error("Invalid capture dimensions or scale");
  const maxSide = Math.min(screenshot ? 4096 : Infinity, Math.floor(MAX_SIDE / deviceScale));
  const fits = (scale) => {
    const w = outputSize(width, scale),
      h = outputSize(height, scale);
    return (
      w <= maxSide &&
      h <= maxSide &&
      Math.ceil(w * deviceScale) * Math.ceil(h * deviceScale) <= MAX_PIXELS
    );
  };
  let scale = requestedScale;
  if (!fits(scale)) {
    if (!screenshot)
      throw Error(
        "Export exceeds the safe capture limit (8192 physical px per side or 32 megapixels). Lower the export scale or export a smaller selection.",
      );
    // Binary search includes integer rounding at both the CSS and physical pixel boundaries.
    let low = 0,
      high = scale;
    for (let i = 0; i < 60; i++) {
      const mid = (low + high) / 2;
      if (fits(mid)) low = mid;
      else high = mid;
    }
    scale = low;
    if (!scale) throw Error("Display scale exceeds the safe capture limit");
  }
  return {
    scale,
    requestedScale,
    width: outputSize(width, scale),
    height: outputSize(height, scale),
  };
}
module.exports = { captureSize, outputSize, MAX_SIDE, MAX_PIXELS };
