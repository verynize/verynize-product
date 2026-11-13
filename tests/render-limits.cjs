const { test } = require("node:test");
const assert = require("node:assert/strict");
const { captureSize, MAX_SIDE, MAX_PIXELS } = require("../desktop/render-limits.cjs");

test("screenshots fit physical texture and area limits on standard and Retina displays", () => {
  for (const deviceScale of [1, 1.25, 2, 3]) {
    for (const [width, height, scale] of [
      [6160, 4272, 3],
      [10000, 1, 100],
      [1, 10000, 100],
      [10000, 10000, 3],
      [8191.9, 2000.1, 1],
    ]) {
      const result = captureSize(width, height, scale, deviceScale, true);
      assert.ok(result.scale > 0 && result.scale <= scale);
      assert.equal(result.requestedScale, scale);
      const w = Math.ceil(result.width * deviceScale),
        h = Math.ceil(result.height * deviceScale);
      assert.ok(w <= MAX_SIDE && h <= MAX_SIDE, JSON.stringify(result));
      assert.ok(w * h <= MAX_PIXELS, JSON.stringify(result));
    }
  }
});
test("exports keep exact scale or fail before allocating a window", () => {
  assert.deepEqual(captureSize(100, 80, 27, 2), {
    width: 2700,
    height: 2160,
    scale: 27,
    requestedScale: 27,
  });
  assert.throws(() => captureSize(6160, 4272, 3), /Lower the export scale/);
  assert.throws(() => captureSize(5000, 100, 1, 2), /8192 physical/);
  assert.throws(() => captureSize(0, 10, 1), /Invalid/);
});
