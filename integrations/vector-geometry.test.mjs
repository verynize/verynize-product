// Vector layer geometry (web/vector-geometry.js): the SVG path grammar, normalization to M/L/C/Z, arcs, bounds,
// matrices, contours for anchor editing, refitting under rotation, and the <svg> the canvas and exports draw.
import test from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  parsePath,
  pathError,
  serializePath,
  pathBounds,
  arcToCubics,
  multiply,
  invert,
  applyPoint,
  parseTransform,
  transformSegments,
  toContours,
  fromContours,
  splitAt,
  nearestSegment,
  smooth,
  fitBox,
  svgMarkup,
} from "./vector-geometry.mjs";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const closeAll = (a, b, eps = 1e-6) => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => close(v, b[i], eps));
};

test("every command letter normalizes to absolute M/L/C/Z", () => {
  const segs = parsePath(
    "M10 10 h20 v20 H10 z m5 5 l1 1 L2 2 c1 1 2 2 3 3 s4 4 5 5 q5 5 10 0 t10 0 Q1 1 2 2 T3 3 S1 1 2 2",
  );
  assert.deepEqual(
    segs.map((s) => s[0]).join(""),
    "MLLLZMLLCCCCCCC",
    "H/V become L, S/T/Q become C",
  );
  assert.deepEqual(segs[1], ["L", 30, 10]);
  assert.deepEqual(segs[2], ["L", 30, 30]);
  assert.deepEqual(
    segs[5],
    ["M", 15, 15],
    "a relative moveto after Z starts at the closed subpath's start",
  );
  assert.deepEqual(segs[6], ["L", 16, 16]);
  // c from (2,2): (3,3) (4,4) (5,5); s reflects (4,4) about (5,5) → (6,6), then (9,9) (10,10).
  assert.deepEqual(segs[8], ["C", 3, 3, 4, 4, 5, 5]);
  assert.deepEqual(segs[9], ["C", 6, 6, 9, 9, 10, 10]);
  // q from (10,10) control (15,15) to (20,10) raised to a cubic: controls at 2/3 of the way to the quad control.
  closeAll(segs[10].slice(1), [
    10 + (2 / 3) * 5,
    10 + (2 / 3) * 5,
    20 - (2 / 3) * 5,
    10 + (2 / 3) * 5,
    20,
    10,
  ]);
  // t reflects (15,15) about (20,10) → (25,5).
  closeAll(segs[11].slice(1), [
    20 + (2 / 3) * 5,
    10 - (2 / 3) * 5,
    30 - (2 / 3) * 5,
    10 - (2 / 3) * 5,
    30,
    10,
  ]);
  // S without a preceding cubic: its first control is the current point.
  const s = parsePath("M0 0 L5 5 S10 10 20 0");
  assert.deepEqual(s[2], ["C", 5, 5, 10, 10, 20, 0]);
});

test("compact number syntax, implicit repetition and implicit lineto after moveto", () => {
  assert.deepEqual(parsePath("M0,0L.5.5-1-1"), [
    ["M", 0, 0],
    ["L", 0.5, 0.5],
    ["L", -1, -1],
  ]);
  assert.deepEqual(parsePath("M1 2 3 4 5 6"), [
    ["M", 1, 2],
    ["L", 3, 4],
    ["L", 5, 6],
  ]);
  assert.deepEqual(parsePath("m1 1 2 2"), [
    ["M", 1, 1],
    ["L", 3, 3],
  ]);
  assert.deepEqual(parsePath("M1e1 2E-1L3e+0 4"), [
    ["M", 10, 0.2],
    ["L", 3, 4],
  ]);
  // Arc flags may be written without separators.
  const arc = parsePath("M0 0a10 10 0 0110 10");
  assert.equal(arc.at(-1)[0], "C");
  closeAll(arc.at(-1).slice(5), [10, 10]);
});

test("syntax errors and caps", () => {
  assert.match(pathError(""), /nonempty/);
  assert.match(pathError("L1 1"), /moveto/);
  assert.match(pathError("M1"), /number/);
  assert.match(pathError("M1 1 Z 3"), /command/);
  assert.match(pathError("M0 0 X1 1"), /Unknown path command/);
  assert.match(pathError("M1e999 1"), /finite/);
  assert.match(pathError("M0 0 A1 1 0 2 1 3 3"), /arc flag/);
  assert.equal(pathError("M0 0L1 1"), "");
  assert.match(pathError("M0 0" + "L1 1".repeat(LIMITS.pathChars / 4)), /limited/);
  const many = "M0 0" + "L1 1".repeat(LIMITS.segments + 1);
  assert.throws(() => parsePath(many), /more than/);
});

test("arcs become cubics of at most 90° that stay on the ellipse", () => {
  // Half circle of radius 10 from (0,0) to (20,0): two quarter cubics.
  const segs = arcToCubics(0, 0, 10, 10, 0, 0, 1, 20, 0);
  assert.equal(segs.length, 2);
  // The midpoint of each cubic lies on the circle centred at (10, 0).
  let prev = [0, 0];
  for (const s of segs) {
    const p0 = prev,
      [x1, y1, x2, y2, x, y] = s.slice(1);
    const mid = [
      0.125 * p0[0] + 0.375 * x1 + 0.375 * x2 + 0.125 * x,
      0.125 * p0[1] + 0.375 * y1 + 0.375 * y2 + 0.125 * y,
    ];
    close(Math.hypot(mid[0] - 10, mid[1]), 10, 0.01);
    prev = [x, y];
  }
  closeAll(prev, [20, 0]);
  // Radii too small are scaled up (F.6.6); zero radii draw a straight line; the same point draws nothing.
  const scaled = arcToCubics(0, 0, 1, 1, 0, 0, 1, 20, 0);
  closeAll(scaled.at(-1).slice(5), [20, 0]);
  assert.deepEqual(arcToCubics(0, 0, 0, 5, 0, 0, 1, 20, 0), [["L", 20, 0]]);
  assert.deepEqual(arcToCubics(3, 3, 5, 5, 0, 0, 1, 3, 3), []);
  // The large-arc flag picks the long way round.
  const small = arcToCubics(0, 0, 10, 10, 0, 0, 1, 10, 10),
    large = arcToCubics(0, 0, 10, 10, 0, 1, 1, 10, 10);
  assert.ok(large.length > small.length);
  // Rotated ellipse: an ellipse rx 20 ry 10 rotated 90° spans 20 wide and 40 tall.
  const b = pathBounds(parsePath("M0 0A20 10 90 1 0 0 40A20 10 90 1 0 0 0Z"));
  close(b.w, 20, 0.01);
  close(b.h, 40, 0.01);
});

test("bounds include cubic extrema, not only control points", () => {
  const b = pathBounds(parsePath("M0 0C0 -10 10 -10 10 0"));
  close(b.x, 0);
  close(b.w, 10);
  close(b.y, -7.5);
  close(b.h, 7.5);
  assert.equal(pathBounds([["M", 3, 3]]), null, "a lone moveto paints nothing");
  assert.deepEqual(pathBounds(parsePath("M5 5H15V9")), { x: 5, y: 5, w: 10, h: 4 });
});

test("serialize rounds to 3 decimals and round-trips", () => {
  const d = "M0.12345 1L2.5 3.0001C1 2 3 4 5 6Z";
  assert.equal(serializePath(parsePath(d)), "M0.123 1L2.5 3C1 2 3 4 5 6Z");
  assert.deepEqual(
    parsePath(serializePath(parsePath(d))),
    parsePath("M0.123 1L2.5 3C1 2 3 4 5 6Z"),
  );
  assert.equal(serializePath([["M", -0.0001, 0]]), "M0 0", "no negative zero");
});

test("matrices: transform syntax, composition and inversion", () => {
  const m = parseTransform("translate(10 20) rotate(90) scale(2)");
  closeAll(applyPoint(m, 1, 0), [10, 22]);
  closeAll(applyPoint(parseTransform("rotate(90 5 5)"), 10, 5), [5, 10]);
  closeAll(applyPoint(parseTransform("matrix(1 0 0 1 3 4)"), 0, 0), [3, 4]);
  closeAll(applyPoint(parseTransform("skewX(45)"), 0, 10), [10, 10]);
  closeAll(applyPoint(parseTransform("scale(2,3)"), 1, 1), [2, 3]);
  const inv = invert(m);
  closeAll(applyPoint(multiply(m, inv), 7, -3), [7, -3]);
  assert.equal(invert([0, 0, 0, 0, 1, 1]), null);
  assert.throws(() => parseTransform("translate(1) bogus(2)"), /Invalid transform/);
  assert.deepEqual(transformSegments([["M", 1, 1], ["Z"]], [2, 0, 0, 2, 1, 0]), [
    ["M", 3, 2],
    ["Z"],
  ]);
});

test("contours: anchors with handles, closing curves merge into the first anchor", () => {
  const d = "M0 0C10 0 10 10 0 10C-10 10 -10 0 0 0Z";
  const contours = toContours(parsePath(d));
  assert.equal(contours.length, 1);
  assert.equal(contours[0].closed, true);
  assert.equal(contours[0].points.length, 2, "the closing curve ends on the start anchor");
  assert.deepEqual(contours[0].points[0], { x: 0, y: 0, ix: -10, iy: 0, ox: 10, oy: 0 });
  assert.equal(serializePath(fromContours(contours)), d);
  // Straight segments stay lines; an open contour has no Z.
  const open = toContours(parsePath("M0 0L10 0L10 10"));
  assert.equal(open[0].closed, false);
  assert.equal(serializePath(fromContours(open)), "M0 0L10 0L10 10");
  // A closed polygon keeps its implicit closing line.
  assert.equal(
    serializePath(fromContours(toContours(parsePath("M0 0H10V10Z")))),
    "M0 0L10 0L10 10Z",
  );
  assert.equal(smooth(contours[0].points[0]), true);
  assert.equal(smooth(open[0].points[1]), false);
});

test("splitting a segment keeps the curve's shape; nearest segment finds the press", () => {
  const contours = toContours(parsePath("M0 0C0 -10 10 -10 10 0"));
  const before = pathBounds(fromContours(contours));
  const k = splitAt(contours[0], 0, 0.5);
  assert.equal(k, 1);
  assert.equal(contours[0].points.length, 3);
  const mid = contours[0].points[1];
  closeAll([mid.x, mid.y], [5, -7.5]);
  const after = pathBounds(fromContours(contours));
  for (const key of ["x", "y", "w", "h"]) close(after[key], before[key], 1e-9);
  assert.equal(smooth(mid), true, "a split point on a curve is smooth");
  const line = toContours(parsePath("M0 0L10 0"));
  splitAt(line[0], 0, 0.25);
  assert.equal(serializePath(fromContours(line)), "M0 0L2.5 0L10 0", "lines split into lines");
  const hit = nearestSegment(toContours(parsePath("M0 0L10 0L10 10")), 10.5, 6);
  assert.deepEqual([hit.contour, hit.index], [0, 1]);
  close(hit.distance, 0.5, 1e-3);
  close(hit.t, 0.6, 1e-3);
});

test("fitBox hugs the geometry and keeps points in place under rotation and flips", () => {
  const node = { x: 100, y: 50, w: 200, h: 100, viewBox: [0, 0, 100, 50] };
  const fit = fitBox(node, [{ d: "M10 10L60 30" }]);
  // 2 px per unit: the geometry spans 50×20 units = 100×40 px from (100 + 20, 50 + 20).
  assert.deepEqual(fit, { x: 120, y: 70, w: 100, h: 40, viewBox: [10, 10, 50, 20] });
  // A point's screen position: pos + c + R·F·(local − c), with local measured in the box.
  const world = (n, ux, uy) => {
    const vb = n.viewBox,
      lx = ((ux - vb[0]) * n.w) / vb[2] - n.w / 2,
      ly = ((uy - vb[1]) * n.h) / vb[3] - n.h / 2;
    const fx = n.flipX ? -1 : 1,
      fy = n.flipY ? -1 : 1,
      r = ((n.rotation || 0) * Math.PI) / 180;
    const vx = lx * fx,
      vy = ly * fy;
    return [
      n.x + n.w / 2 + Math.cos(r) * vx - Math.sin(r) * vy,
      n.y + n.h / 2 + Math.sin(r) * vx + Math.cos(r) * vy,
    ];
  };
  for (const extra of [{ rotation: 33 }, { rotation: -120, flipX: true }, { flipY: true }]) {
    const n = { ...node, ...extra };
    const f = { ...n, ...fitBox(n, [{ d: "M10 10L60 30" }]) };
    for (const [ux, uy] of [
      [10, 10],
      [60, 30],
    ])
      closeAll(world(f, ux, uy), world(n, ux, uy), 1e-6);
  }
  // A straight horizontal line keeps one layer pixel of height.
  const flat = fitBox({ x: 0, y: 0, w: 100, h: 100, viewBox: [0, 0, 100, 100] }, [
    { d: "M0 50H80" },
  ]);
  assert.deepEqual([flat.w, flat.h], [80, 1]);
  close(flat.y, 49.5);
});

test("svgMarkup draws fills under the stroke, non-scaling, with the paint model", () => {
  const n = {
    id: "v 1",
    w: 48,
    h: 24,
    viewBox: [0, 0, 24, 12],
    paths: [{ d: "M0 0H24V12Z", fillRule: "evenodd" }, { d: "M0 0L1 1" }],
    color: "#ff0000",
    token: "brand",
    strokeWidth: 2,
    strokeColor: "#00000080",
    strokeCap: "round",
    strokeJoin: "bevel",
    strokeDash: [4, 2],
  };
  const svg = svgMarkup(n, { brand: "#00ff00" });
  assert.match(svg, /viewBox="0 0 24 12" preserveAspectRatio="none"/);
  assert.match(
    svg,
    /<path d="M0 0H24V12Z" fill="#00ff00" fill-rule="evenodd"\/>/,
    "token wins over color",
  );
  assert.match(
    svg,
    /stroke="#000000" stroke-opacity="0.502" stroke-width="2" stroke-linecap="round" stroke-linejoin="bevel" stroke-dasharray="4 2" vector-effect="non-scaling-stroke"/,
  );
  assert.equal(svg.match(/<path /g).length, 4, "two fill paths, two stroke paths");
  // fills: [] is no fill; gradients become userSpaceOnUse defs with ids derived from the node id.
  assert.doesNotMatch(svgMarkup({ ...n, fills: [] }), /fill="#/);
  const gradient = svgMarkup({
    ...n,
    strokeWidth: 0,
    fills: [
      {
        type: "linear",
        angle: 90,
        stops: [
          { position: 0, color: "#000000" },
          { position: 100, color: "#ffffff" },
        ],
      },
    ],
  });
  assert.match(
    gradient,
    /<linearGradient id="vg-v_1-f0" gradientUnits="userSpaceOnUse" x1="0" y1="6" x2="24" y2="6">/,
  );
  assert.match(gradient, /fill="url\(#vg-v_1-f0\)"/);
  // Invalid path data is never written out, and attribute text is escaped.
  assert.doesNotMatch(svgMarkup({ ...n, paths: [{ d: 'M0 0"/><script>' }] }), /script/);
  // Standalone: baked into layer pixels, strokes scale with the drawing.
  const file = svgMarkup(n, {}, { standalone: true });
  assert.match(file, /viewBox="0 0 48 24" preserveAspectRatio="none" width="48" height="24"/);
  assert.match(file, /d="M0 0L48 0L48 24Z"/);
  assert.doesNotMatch(file, /vector-effect/);
});
