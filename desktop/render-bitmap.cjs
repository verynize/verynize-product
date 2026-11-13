// NativeImage.isEmpty() does not detect transparent pixels or missing painted regions.
// Keep one bit per output pixel so consecutive captures can prove stable coverage
// without retaining two full RGBA buffers. Colour/opacity animation remains allowed
// while its footprint stays the same; even alpha 1 counts as visible paint.
function captureCoverage(bitmap) {
  const length = Math.floor(bitmap.length / 4);
  const mask = Buffer.alloc(Math.ceil(length / 8));
  let pixels = 0;
  for (let pixel = 0; pixel < length; pixel++) {
    if (bitmap[pixel * 4 + 3] !== 0) {
      mask[pixel >> 3] |= 1 << (pixel & 7);
      pixels++;
    }
  }
  return { pixels, mask };
}

// Never forget paint seen in an earlier capture: full -> partial -> partial must
// not pass merely because the last two incomplete frames happen to agree.
function createCoverageCheck() {
  let previous = null;
  let observed = null;
  return (bitmap) => {
    const current = captureCoverage(bitmap);
    const previousPixels = previous?.pixels;
    if (observed && observed.length !== current.mask.length)
      return { pixels: current.pixels, previousPixels, stable: false };
    if (!observed) observed = Buffer.from(current.mask);
    else for (let i = 0; i < observed.length; i++) observed[i] |= current.mask[i];
    const stable =
      current.pixels > 0 && !!previous?.mask.equals(current.mask) && observed.equals(current.mask);
    previous = current.pixels ? current : null;
    return { pixels: current.pixels, previousPixels, stable };
  };
}

module.exports = { captureCoverage, createCoverageCheck };
