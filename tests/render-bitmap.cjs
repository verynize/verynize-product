const { test } = require("node:test");
const assert = require("node:assert/strict");
const { captureCoverage } = require("../desktop/render-bitmap.cjs");

test("detects allocated transparent 2160p captures, not just zero-length images", () => {
  for (const bitmap of [
    Buffer.alloc(0),
    Buffer.alloc(2700 * 2160 * 4),
    Buffer.from([255, 255, 255, 0]),
  ]) {
    const coverage = captureCoverage(bitmap);
    assert.equal(coverage.pixels, 0);
    assert.ok(coverage.mask.every((byte) => byte === 0));
  }
});

test("preserves sparse artwork anywhere, black paint and the smallest nonzero alpha", () => {
  const bitmap = Buffer.alloc(2700 * 2160 * 4);
  for (const pixel of [0, 257, 2700 * 2160 - 1]) {
    bitmap[pixel * 4 + 3] = 1;
    const coverage = captureCoverage(bitmap);
    assert.equal(coverage.pixels, 1);
    assert.equal(coverage.mask[pixel >> 3], 1 << (pixel & 7));
    assert.equal(coverage.mask.length, Math.ceil((2700 * 2160) / 8));
    bitmap[pixel * 4 + 3] = 0;
  }
  assert.equal(captureCoverage(Buffer.from([0, 0, 0, 255])).pixels, 1);
});

test("detects a missing region even when both captures contain paint", () => {
  const full = Buffer.alloc(64 * 64 * 4, 255);
  const missingTile = Buffer.from(full);
  for (let y = 32; y < 64; y++) {
    for (let x = 32; x < 64; x++) missingTile[(y * 64 + x) * 4 + 3] = 0;
  }
  const a = captureCoverage(full),
    b = captureCoverage(missingTile);
  assert.equal(a.pixels, 4096);
  assert.equal(b.pixels, 3072);
  assert.equal(a.mask.equals(b.mask), false);
});

test("compares position, not just pixel count, while permitting colour and opacity changes", () => {
  const a = captureCoverage(Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]));
  const moved = captureCoverage(Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]));
  const recoloured = captureCoverage(Buffer.from([255, 0, 0, 255, 255, 255, 255, 0]));
  assert.equal(a.pixels, moved.pixels);
  assert.equal(a.mask.equals(moved.mask), false);
  assert.equal(a.mask.equals(recoloured.mask), true);
});

test("accepts recovered coverage only after two complete frames, never two matching incomplete frames", () => {
  const { createCoverageCheck } = require("../desktop/render-bitmap.cjs");
  const full = Buffer.from([0, 0, 0, 255, 0, 0, 0, 255]);
  const partial = Buffer.from([0, 0, 0, 255, 0, 0, 0, 0]);
  const blank = Buffer.alloc(8);
  for (const frames of [
    [partial, full, full],
    [blank, full, full],
  ]) {
    const check = createCoverageCheck();
    assert.deepEqual(
      frames.map((frame) => check(frame).stable),
      [false, false, true],
    );
  }
  for (const frames of [
    [full, partial, partial],
    [blank, blank, blank],
    [full, blank, full],
  ]) {
    const check = createCoverageCheck();
    assert.deepEqual(
      frames.map((frame) => check(frame).stable),
      [false, false, false],
    );
  }
  const check = createCoverageCheck();
  assert.equal(check(full).stable, false);
  assert.equal(check(full).stable, true);
});

test("recovers when the verification capture loses a region, and refuses changing dimensions", () => {
  const { createCoverageCheck } = require("../desktop/render-bitmap.cjs");
  const full = Buffer.alloc(64, 255),
    partial = Buffer.from(full);
  partial[3] = 0;
  const check = createCoverageCheck();
  assert.deepEqual(
    [full, partial, full, full].map((frame) => check(frame).stable),
    [false, false, false, true],
  );
  const changed = createCoverageCheck();
  assert.equal(changed(full).stable, false);
  assert.equal(changed(Buffer.alloc(96, 255)).stable, false);
});
