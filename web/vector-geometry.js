// Vector layer geometry and rendering (docs/vector-nodes.md). DOM-free and shared: the canvas loads it as a classic
// <script> before web/document-core.js, Node imports it through integrations/vector-geometry.mjs. Registers
// globalThis.VerynizeVector.
//
// A vector layer stores SVG path data (`paths: [{d, fillRule?}]`) in the coordinates of its `viewBox` [x, y, w, h],
// drawn stretched over the layer box (preserveAspectRatio none), so resizing a layer never rewrites its paths.
// Strokes are in layer pixels and do not scale with the box (vector-effect: non-scaling-stroke).
//
// Paths
//   parsePath(d)             every SVG path command, absolute or relative → normalized segments, absolute and of four
//                            kinds only: ["M", x, y] ["L", x, y] ["C", x1, y1, x2, y2, x, y] ["Z"]. H/V become lines,
//                            S/T reflect the previous control point, Q is raised to a cubic and arcs become cubics of
//                            at most 90°. Throws on a syntax error or past LIMITS.segments.
//   pathError(d)             '' or the reason the path data is invalid (cached; used by the document schema).
//   serializePath(segments)  compact absolute path data, rounded to 3 decimals.
//   pathBounds(segments)     exact bounds {x, y, w, h} (cubic extrema), null for an empty path.
// Matrices [a, b, c, d, e, f] (x' = a·x + c·y + e, y' = b·x + d·y + f)
//   multiply(m, n), invert(m), applyPoint(m, x, y), parseTransform(svgTransformAttribute), transformSegments(s, m)
// Editing (web/vector-edit.js)
//   toContours(segments) / fromContours(contours)   anchors {x, y, ix, iy, ox, oy} with absolute in/out handles (equal
//                                                   to the anchor for a corner) per contour {closed, points}
//   splitAt(contour, index, t), nearestSegment(contours, x, y), smooth(point)
//   fitBox(node, paths)      the layer box and viewBox that hug the geometry, keeping every point where it is on screen
// Rendering
//   svgMarkup(node, tokens, {standalone})   the <svg> drawn inside the layer element (canvas, HTML export, PNG/PDF)
(function (root) {
  "use strict";
  // Per layer. Path data is text in the document, so the caps bound storage and parsing on every edit.
  const LIMITS = Object.freeze({
    paths: 500,
    pathChars: 200000,
    totalChars: 500000,
    segments: 50000,
  });
  const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  const SEPARATOR = /[\s,]/;
  const FILL_RULES = ["nonzero", "evenodd"];
  const CAPS = ["butt", "round", "square"];
  const JOINS = ["miter", "round", "bevel"];
  const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

  // ---------- Path data ----------
  /** Raw commands [letter, ...numbers] in source order (relative letters kept). */
  function readCommands(d) {
    if (typeof d !== "string") throw new Error("Path data must be a string");
    const n = d.length,
      out = [];
    let i = 0,
      previous = null;
    const skip = () => {
      while (i < n && SEPARATOR.test(d[i])) i++;
    };
    const number = () => {
      skip();
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(d);
      if (!m) throw new Error(`Expected a number at ${i} in path data`);
      i = NUMBER.lastIndex;
      const value = Number(m[0]);
      if (!Number.isFinite(value) || Math.abs(value) > 1e7)
        throw new Error("Path coordinates must be finite numbers");
      return value;
    };
    const flag = () => {
      skip();
      const c = d[i];
      if (c !== "0" && c !== "1") throw new Error(`Expected an arc flag at ${i} in path data`);
      i++;
      return c === "1" ? 1 : 0;
    };
    skip();
    while (i < n) {
      let letter = d[i];
      if (/[a-z]/i.test(letter)) {
        if (!Object.hasOwn(ARGS, letter.toUpperCase()))
          throw new Error(`Unknown path command ${letter}`);
        i++;
      } else {
        if (!previous || previous.toUpperCase() === "Z")
          throw new Error(`Expected a path command at ${i} in path data`);
        letter = previous === "M" ? "L" : previous === "m" ? "l" : previous;
      }
      if (!out.length && letter.toUpperCase() !== "M")
        throw new Error("Path data must start with a moveto (M)");
      const kind = letter.toUpperCase(),
        command = [letter];
      if (kind === "A")
        command.push(number(), number(), number(), flag(), flag(), number(), number());
      else for (let k = 0; k < ARGS[kind]; k++) command.push(number());
      out.push(command);
      if (out.length > LIMITS.segments)
        throw new Error(`Path data has more than ${LIMITS.segments} commands`);
      previous = letter;
      skip();
    }
    return out;
  }

  /** Endpoint arc → cubic segments (SVG implementation notes, F.6.5), each spanning at most 90°. */
  function arcToCubics(x1, y1, rx, ry, angle, large, sweep, x2, y2) {
    if (x1 === x2 && y1 === y2) return [];
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (!rx || !ry) return [["L", x2, y2]];
    const phi = (angle * Math.PI) / 180,
      cos = Math.cos(phi),
      sin = Math.sin(phi);
    const dx = (x1 - x2) / 2,
      dy = (y1 - y2) / 2;
    const px = cos * dx + sin * dy,
      py = -sin * dx + cos * dy;
    const scale = (px * px) / (rx * rx) + (py * py) / (ry * ry);
    if (scale > 1) {
      rx *= Math.sqrt(scale);
      ry *= Math.sqrt(scale);
    }
    const num = rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px,
      den = rx * rx * py * py + ry * ry * px * px;
    const coef = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
    const cpx = (coef * rx * py) / ry,
      cpy = (-coef * ry * px) / rx;
    const cx = cos * cpx - sin * cpy + (x1 + x2) / 2,
      cy = sin * cpx + cos * cpy + (y1 + y2) / 2;
    const ux = (px - cpx) / rx,
      uy = (py - cpy) / ry,
      vx = (-px - cpx) / rx,
      vy = (-py - cpy) / ry;
    const start = Math.atan2(uy, ux);
    let sweepAngle = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
    else if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;
    const count = Math.max(1, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2) - 1e-9)),
      step = sweepAngle / count,
      k = (4 / 3) * Math.tan(step / 4);
    const map = (ex, ey) => [
      cx + rx * ex * cos - ry * ey * sin,
      cy + rx * ex * sin + ry * ey * cos,
    ];
    const out = [];
    for (let s = 0; s < count; s++) {
      const a = start + s * step,
        b = a + step;
      const ca = Math.cos(a),
        sa = Math.sin(a),
        cb = Math.cos(b),
        sb = Math.sin(b);
      const c1 = map(ca - k * sa, sa + k * ca),
        c2 = map(cb + k * sb, sb - k * cb),
        end = s === count - 1 ? [x2, y2] : map(cb, sb);
      out.push(["C", c1[0], c1[1], c2[0], c2[1], end[0], end[1]]);
    }
    return out;
  }

  /** Normalized absolute segments (see the header). */
  function parsePath(d) {
    const out = [];
    let x = 0,
      y = 0,
      startX = 0,
      startY = 0,
      cubic = null,
      quad = null,
      closed = false;
    for (const command of readCommands(d)) {
      const letter = command[0],
        kind = letter.toUpperCase(),
        rel = letter !== kind,
        a = command.slice(1);
      const ax = (v) => (rel ? x + v : v),
        ay = (v) => (rel ? y + v : v);
      // A drawing command right after Z starts a new subpath at the closed subpath's start.
      if (closed && kind !== "M") out.push(["M", x, y]);
      closed = false;
      let nextCubic = null,
        nextQuad = null;
      if (kind === "M") {
        x = ax(a[0]);
        y = ay(a[1]);
        startX = x;
        startY = y;
        out.push(["M", x, y]);
      } else if (kind === "L" || kind === "H" || kind === "V") {
        if (kind === "L") {
          x = ax(a[0]);
          y = ay(a[1]);
        } else if (kind === "H") x = ax(a[0]);
        else y = ay(a[0]);
        out.push(["L", x, y]);
      } else if (kind === "C" || kind === "S") {
        let x1, y1;
        if (kind === "C") {
          x1 = ax(a[0]);
          y1 = ay(a[1]);
        } else if (cubic) {
          x1 = 2 * x - cubic[0];
          y1 = 2 * y - cubic[1];
        } else {
          x1 = x;
          y1 = y;
        }
        const o = kind === "C" ? 2 : 0;
        const x2 = ax(a[o]),
          y2 = ay(a[o + 1]),
          ex = ax(a[o + 2]),
          ey = ay(a[o + 3]);
        out.push(["C", x1, y1, x2, y2, ex, ey]);
        nextCubic = [x2, y2];
        x = ex;
        y = ey;
      } else if (kind === "Q" || kind === "T") {
        let qx, qy, ex, ey;
        if (kind === "Q") {
          qx = ax(a[0]);
          qy = ay(a[1]);
          ex = ax(a[2]);
          ey = ay(a[3]);
        } else {
          qx = quad ? 2 * x - quad[0] : x;
          qy = quad ? 2 * y - quad[1] : y;
          ex = ax(a[0]);
          ey = ay(a[1]);
        }
        out.push([
          "C",
          x + (2 / 3) * (qx - x),
          y + (2 / 3) * (qy - y),
          ex + (2 / 3) * (qx - ex),
          ey + (2 / 3) * (qy - ey),
          ex,
          ey,
        ]);
        nextQuad = [qx, qy];
        x = ex;
        y = ey;
      } else if (kind === "A") {
        const ex = ax(a[5]),
          ey = ay(a[6]);
        out.push(...arcToCubics(x, y, a[0], a[1], a[2], a[3], a[4], ex, ey));
        x = ex;
        y = ey;
      } else {
        out.push(["Z"]);
        x = startX;
        y = startY;
        closed = true;
      }
      cubic = nextCubic;
      quad = nextQuad;
      if (out.length > LIMITS.segments)
        throw new Error(`Path data has more than ${LIMITS.segments} segments`);
    }
    return out;
  }

  const errors = new Map();
  /** '' when `d` is valid path data within the limits, else the reason. Cached: the schema runs on every edit. */
  function pathError(d) {
    if (typeof d !== "string" || !d.trim()) return "Path data must be a nonempty string";
    if (d.length > LIMITS.pathChars)
      return `Path data is limited to ${LIMITS.pathChars} characters`;
    const known = errors.get(d);
    if (known !== undefined) return known;
    let error = "";
    try {
      parsePath(d);
    } catch (e) {
      error = e.message;
    }
    if (errors.size > 2000) errors.clear();
    errors.set(d, error);
    return error;
  }

  function num(value, digits = 3) {
    const f = 10 ** digits,
      r = Math.round(value * f) / f;
    return Object.is(r, -0) ? "0" : String(r);
  }
  function serializePath(segments, digits = 3) {
    let out = "";
    for (const s of segments) {
      if (s[0] === "Z") {
        out += "Z";
        continue;
      }
      out +=
        s[0] +
        s
          .slice(1)
          .map((v) => num(v, digits))
          .join(" ");
    }
    return out;
  }

  // ---------- Bounds ----------
  /** Parameters in (0, 1) where one coordinate of a cubic has an extremum. */
  function extrema(p0, p1, p2, p3) {
    const a = -p0 + 3 * p1 - 3 * p2 + p3,
      b = 2 * (p0 - 2 * p1 + p2),
      c = p1 - p0,
      out = [];
    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) > 1e-12) out.push(-c / b);
    } else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const r = Math.sqrt(disc);
        out.push((-b + r) / (2 * a), (-b - r) / (2 * a));
      }
    }
    return out.filter((t) => t > 0 && t < 1);
  }
  const cubicAt = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  };
  function pathBounds(segments) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity,
      cx = 0,
      cy = 0;
    const add = (x, y) => {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    };
    for (const s of segments) {
      if (s[0] === "M") {
        cx = s[1];
        cy = s[2];
      } else if (s[0] === "L") {
        add(cx, cy);
        add(s[1], s[2]);
        cx = s[1];
        cy = s[2];
      } else if (s[0] === "C") {
        add(cx, cy);
        add(s[5], s[6]);
        for (const t of extrema(cx, s[1], s[3], s[5]))
          add(cubicAt(cx, s[1], s[3], s[5], t), cubicAt(cy, s[2], s[4], s[6], t));
        for (const t of extrema(cy, s[2], s[4], s[6]))
          add(cubicAt(cx, s[1], s[3], s[5], t), cubicAt(cy, s[2], s[4], s[6], t));
        cx = s[5];
        cy = s[6];
      }
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  /** Union of bounds (nulls skipped). */
  function unionBounds(list) {
    const valid = list.filter(Boolean);
    if (!valid.length) return null;
    const x0 = Math.min(...valid.map((b) => b.x)),
      y0 = Math.min(...valid.map((b) => b.y)),
      x1 = Math.max(...valid.map((b) => b.x + b.w)),
      y1 = Math.max(...valid.map((b) => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // ---------- Matrices ----------
  const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);
  const multiply = (m, n) => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  function invert(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    if (!det) return null;
    return [
      m[3] / det,
      -m[1] / det,
      -m[2] / det,
      m[0] / det,
      (m[2] * m[5] - m[3] * m[4]) / det,
      (m[1] * m[4] - m[0] * m[5]) / det,
    ];
  }
  const applyPoint = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  /** SVG transform attribute → matrix; throws on syntax it does not know. */
  function parseTransform(text) {
    let m = IDENTITY.slice();
    const source = String(text || "").trim();
    if (!source) return m;
    const re = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?/gy;
    let match,
      end = 0;
    while ((match = re.exec(source))) {
      end = re.lastIndex;
      const v = match[2]
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      if (v.some((x) => !Number.isFinite(x))) throw new Error("Invalid transform");
      const rad = ((v[0] || 0) * Math.PI) / 180;
      let t;
      switch (match[1]) {
        case "matrix":
          if (v.length !== 6) throw new Error("Invalid transform");
          t = v;
          break;
        case "translate":
          t = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
          break;
        case "scale":
          t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
          break;
        case "rotate": {
          const c = Math.cos(rad),
            s = Math.sin(rad),
            cx = v[1] || 0,
            cy = v[2] || 0;
          t = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
          break;
        }
        case "skewX":
          t = [1, 0, Math.tan(rad), 1, 0, 0];
          break;
        default:
          t = [1, Math.tan(rad), 0, 1, 0, 0];
      }
      m = multiply(m, t);
    }
    if (end !== source.length) throw new Error("Invalid transform");
    return m;
  }
  function transformSegments(segments, m) {
    return segments.map((s) => {
      if (s[0] === "Z") return ["Z"];
      const out = [s[0]];
      for (let i = 1; i < s.length; i += 2) out.push(...applyPoint(m, s[i], s[i + 1]));
      return out;
    });
  }

  // ---------- Contours (editing) ----------
  const anchor = (x, y) => ({ x, y, ix: x, iy: y, ox: x, oy: y });
  const near = (a, b, c, d) => Math.abs(a - c) < 1e-9 && Math.abs(b - d) < 1e-9;
  function toContours(segments) {
    const out = [];
    let current = null;
    for (const s of segments) {
      if (s[0] === "M") {
        current = { closed: false, points: [anchor(s[1], s[2])] };
        out.push(current);
      } else if (!current) continue;
      else if (s[0] === "L") current.points.push(anchor(s[1], s[2]));
      else if (s[0] === "C") {
        const last = current.points[current.points.length - 1];
        last.ox = s[1];
        last.oy = s[2];
        const p = anchor(s[5], s[6]);
        p.ix = s[3];
        p.iy = s[4];
        current.points.push(p);
      } else {
        current.closed = true;
        const pts = current.points,
          first = pts[0],
          last = pts[pts.length - 1];
        // A closing curve that ends on the start point: that end is the start anchor's incoming handle.
        if (pts.length > 1 && near(first.x, first.y, last.x, last.y)) {
          first.ix = last.ix;
          first.iy = last.iy;
          pts.pop();
        }
      }
    }
    return out.filter((c) => c.points.length);
  }
  const corner = (p, side) =>
    side === "out" ? near(p.ox, p.oy, p.x, p.y) : near(p.ix, p.iy, p.x, p.y);
  const segmentTo = (a, b) =>
    corner(a, "out") && corner(b, "in") ? ["L", b.x, b.y] : ["C", a.ox, a.oy, b.ix, b.iy, b.x, b.y];
  function fromContours(contours) {
    const out = [];
    for (const c of contours) {
      const pts = c.points;
      if (!pts.length) continue;
      out.push(["M", pts[0].x, pts[0].y]);
      for (let i = 1; i < pts.length; i++) out.push(segmentTo(pts[i - 1], pts[i]));
      if (c.closed) {
        const back = pts.length > 1 ? segmentTo(pts[pts.length - 1], pts[0]) : null;
        if (back && back[0] === "C") out.push(back);
        out.push(["Z"]);
      }
    }
    return out;
  }
  /** The segment from point `index` to the next one as [p0, p1, p2, p3] points, or null past an open end. */
  function segmentPoints(contour, index) {
    const pts = contour.points,
      j = index + 1 < pts.length ? index + 1 : contour.closed ? 0 : -1;
    if (j < 0 || j === index) return null;
    const a = pts[index],
      b = pts[j];
    // A line as a cubic with controls at thirds, so t runs uniformly along it.
    if (corner(a, "out") && corner(b, "in"))
      return [
        [a.x, a.y],
        [a.x + (b.x - a.x) / 3, a.y + (b.y - a.y) / 3],
        [a.x + ((b.x - a.x) * 2) / 3, a.y + ((b.y - a.y) * 2) / 3],
        [b.x, b.y],
      ];
    return [
      [a.x, a.y],
      [a.ox, a.oy],
      [b.ix, b.iy],
      [b.x, b.y],
    ];
  }
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  /** Inserts an anchor at parameter t of the segment after point `index` (de Casteljau); returns its index. */
  function splitAt(contour, index, t) {
    const seg = segmentPoints(contour, index);
    if (!seg) return -1;
    const pts = contour.points,
      a = pts[index],
      j = index + 1 < pts.length ? index + 1 : 0,
      b = pts[j];
    const straight = corner(a, "out") && corner(b, "in");
    const [p0, p1, p2, p3] = seg;
    const q0 = lerp(p0, p1, t),
      q1 = lerp(p1, p2, t),
      q2 = lerp(p2, p3, t),
      r0 = lerp(q0, q1, t),
      r1 = lerp(q1, q2, t),
      s = lerp(r0, r1, t);
    const p = anchor(s[0], s[1]);
    if (!straight) {
      a.ox = q0[0];
      a.oy = q0[1];
      p.ix = r0[0];
      p.iy = r0[1];
      p.ox = r1[0];
      p.oy = r1[1];
      b.ix = q2[0];
      b.iy = q2[1];
    }
    pts.splice(index + 1, 0, p);
    return index + 1;
  }
  /** Nearest point on any segment: {contour, index, t, x, y, distance} (contour and index into `contours`). */
  function nearestSegment(contours, x, y) {
    let best = null;
    const at = (seg, t) => [
      cubicAt(seg[0][0], seg[1][0], seg[2][0], seg[3][0], t),
      cubicAt(seg[0][1], seg[1][1], seg[2][1], seg[3][1], t),
    ];
    contours.forEach((contour, ci) => {
      for (let i = 0; i < contour.points.length; i++) {
        const seg = segmentPoints(contour, i);
        if (!seg) continue;
        let bestT = 0,
          bestD = Infinity;
        const STEPS = 48;
        for (let k = 0; k <= STEPS; k++) {
          const p = at(seg, k / STEPS),
            dist = Math.hypot(p[0] - x, p[1] - y);
          if (dist < bestD) {
            bestD = dist;
            bestT = k / STEPS;
          }
        }
        // Refine around the best sample.
        let lo = Math.max(0, bestT - 1 / STEPS),
          hi = Math.min(1, bestT + 1 / STEPS);
        for (let k = 0; k < 24; k++) {
          const m1 = lo + (hi - lo) / 3,
            m2 = hi - (hi - lo) / 3;
          const d1 = Math.hypot(...at(seg, m1).map((v, n) => v - (n ? y : x))),
            d2 = Math.hypot(...at(seg, m2).map((v, n) => v - (n ? y : x)));
          if (d1 < d2) hi = m2;
          else lo = m1;
        }
        const t = (lo + hi) / 2,
          p = at(seg, t),
          dist = Math.hypot(p[0] - x, p[1] - y);
        if (!best || dist < best.distance)
          best = { contour: ci, index: i, t, x: p[0], y: p[1], distance: dist };
      }
    });
    return best;
  }
  /** True when both handles exist and are (nearly) collinear through the anchor. */
  function smooth(p) {
    if (corner(p, "in") || corner(p, "out")) return false;
    const a = Math.atan2(p.y - p.iy, p.x - p.ix),
      b = Math.atan2(p.oy - p.y, p.ox - p.x);
    let d = Math.abs(a - b);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d < 0.02;
  }

  /**
   * The box and viewBox that hug `paths` (in the layer's current viewBox units), keeping every point where it is on
   * screen: rotation and flips turn about the box centre, so a box that changes size moves its origin to match.
   * Returns {x, y, w, h, viewBox} or null for empty geometry.
   */
  function fitBox(node, paths) {
    const vb = Array.isArray(node.viewBox) ? node.viewBox : [0, 0, node.w, node.h];
    const sx = node.w / vb[2],
      sy = node.h / vb[3];
    const b = unionBounds(paths.map((p) => pathBounds(parsePath(p.d))));
    if (!b) return null;
    // A straight line has no width or height: keep at least one layer pixel on each axis.
    let bx = b.x,
      by = b.y,
      bw = b.w,
      bh = b.h;
    if (bw * sx < 1) {
      bx -= (1 / sx - bw) / 2;
      bw = 1 / sx;
    }
    if (bh * sy < 1) {
      by -= (1 / sy - bh) / 2;
      bh = 1 / sy;
    }
    const w = bw * sx,
      h = bh * sy,
      dx = (bx - vb[0]) * sx,
      dy = (by - vb[1]) * sy;
    const r = ((Number(node.rotation) || 0) * Math.PI) / 180,
      fx = node.flipX === true ? -1 : 1,
      fy = node.flipY === true ? -1 : 1;
    // pos' = pos + c - c' + R·F·(δ + c' - c)
    const vx = (dx + w / 2 - node.w / 2) * fx,
      vy = (dy + h / 2 - node.h / 2) * fy;
    const rx = Math.cos(r) * vx - Math.sin(r) * vy,
      ry = Math.sin(r) * vx + Math.cos(r) * vy;
    return {
      x: (Number(node.x) || 0) + node.w / 2 - w / 2 + rx,
      y: (Number(node.y) || 0) + node.h / 2 - h / 2 + ry,
      w,
      h,
      viewBox: [bx, by, bw, bh],
    };
  }

  // ---------- Rendering ----------
  const esc = (v) =>
    String(v).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const resolve = (c, tokens) =>
    c && c.token && tokens && HEX.test(tokens[c.token] || "") ? tokens[c.token] : c && c.color;
  /** #rrggbb[aa] × opacity → [#rrggbb, alpha]. */
  function colorOf(hex, opacity = 100) {
    if (!HEX.test(hex || "")) return null;
    const a =
      (hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1) *
      (Math.max(0, Math.min(100, Number(opacity ?? 100))) / 100);
    return [hex.slice(0, 7).toLowerCase(), Math.round(a * 1000) / 1000];
  }
  /** The visible fill paints of a layer, bottom first (index 0 of `fills` paints on top). */
  function fillPaints(n, tokens) {
    if (Array.isArray(n.fills)) return n.fills.filter((p) => p && !p.hidden).reverse();
    const color = (n.token && tokens && tokens[n.token]) || n.color;
    return HEX.test(color || "") ? [{ type: "solid", color }] : [];
  }
  /** One paint as an SVG fill value plus the <defs> it needs. */
  function paintDef(p, id, vb, n, tokens) {
    const o = p.opacity ?? 100;
    if (p.type === "solid") {
      const c = colorOf(resolve(p, tokens), o);
      return c ? { fill: c[0], opacity: c[1], def: "" } : null;
    }
    const stops = (Array.isArray(p.stops) ? [...p.stops] : [])
      .sort((a, b) => a.position - b.position)
      .map((s) => {
        const c = colorOf(resolve(s, tokens), o) || ["#000000", 0];
        return `<stop offset="${num(s.position / 100, 4)}" stop-color="${c[0]}"${c[1] < 1 ? ` stop-opacity="${c[1]}"` : ""}/>`;
      })
      .join("");
    const [x, y, w, h] = vb,
      sx = n.w / w,
      sy = n.h / h;
    if (p.type === "linear" || p.type === "conic") {
      // CSS linear-gradient(angle) over the layer box, in layer pixels, then mapped to viewBox units. A conic paint
      // has no SVG equivalent and draws as a linear gradient of its stops at the same angle.
      const angle = ((Number(p.angle ?? 180) || 0) * Math.PI) / 180,
        dx = Math.sin(angle),
        dy = -Math.cos(angle);
      const half = (Math.abs(n.w * dx) + Math.abs(n.h * dy)) / 2;
      const cx = n.w / 2,
        cy = n.h / 2;
      const u = (px) => x + px / sx,
        v = (py) => y + py / sy;
      return {
        fill: `url(#${id})`,
        opacity: 1,
        def: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(u(cx - dx * half))}" y1="${num(v(cy - dy * half))}" x2="${num(u(cx + dx * half))}" y2="${num(v(cy + dy * half))}">${stops}</linearGradient>`,
      };
    }
    if (p.type === "radial") {
      // CSS radial-gradient(ellipse farthest-corner at 50% 50%): radii √2 × half the box on each axis.
      return {
        fill: `url(#${id})`,
        opacity: 1,
        def: `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${num(x + w / 2)} ${num(y + h / 2)}) scale(${num((w / 2) * Math.SQRT2)} ${num((h / 2) * Math.SQRT2)})">${stops}</radialGradient>`,
      };
    }
    if (p.type === "image" && typeof p.src === "string") {
      // The image covers the layer box; fit uses its natural size when known (the viewBox may be stretched).
      let ix = 0,
        iy = 0,
        iw = n.w,
        ih = n.h;
      const nw = Number(p.imageWidth),
        nh = Number(p.imageHeight),
        fit = p.fit || "fill";
      if (nw > 0 && nh > 0 && fit !== "fill") {
        const s =
          fit === "cover"
            ? Math.max(n.w / nw, n.h / nh)
            : fit === "contain"
              ? Math.min(n.w / nw, n.h / nh)
              : 1;
        iw = nw * s;
        ih = nh * s;
        ix = (n.w - iw) / 2;
        iy = (n.h - ih) / 2;
      }
      return {
        fill: `url(#${id})`,
        opacity: Math.round(Math.max(0, Math.min(100, o))) / 100,
        def: `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"><image href="${esc(p.src)}" x="${num(ix / sx)}" y="${num(iy / sy)}" width="${num(iw / sx)}" height="${num(ih / sy)}" preserveAspectRatio="none"/></pattern>`,
      };
    }
    return null;
  }
  /** Stroke attributes (layer pixels, non-scaling) or '' without a visible stroke. */
  function strokeAttrs(n, tokens, scaling = false) {
    const width = Number(n.strokeWidth) || 0;
    if (width <= 0 || n.strokeHidden === true) return "";
    const c = colorOf(
      (n.strokeToken && tokens && tokens[n.strokeToken]) || n.strokeColor || "#000000",
    );
    if (!c) return "";
    let dash = Array.isArray(n.strokeDash) && n.strokeDash.length ? n.strokeDash : null;
    let cap = CAPS.includes(n.strokeCap) ? n.strokeCap : "butt";
    if (!dash && n.strokeStyle === "dashed") dash = [width * 3, width * 2];
    else if (!dash && n.strokeStyle === "dotted") {
      dash = [0, width * 2];
      cap = "round";
    }
    return (
      ` stroke="${c[0]}"${c[1] < 1 ? ` stroke-opacity="${c[1]}"` : ""} stroke-width="${num(width)}"` +
      (cap !== "butt" ? ` stroke-linecap="${cap}"` : "") +
      (JOINS.includes(n.strokeJoin) && n.strokeJoin !== "miter"
        ? ` stroke-linejoin="${n.strokeJoin}"`
        : "") +
      (Number(n.strokeMiter) > 0 && n.strokeMiter !== 4
        ? ` stroke-miterlimit="${num(n.strokeMiter)}"`
        : "") +
      (dash ? ` stroke-dasharray="${dash.map((v) => num(v)).join(" ")}"` : "") +
      (scaling ? "" : ` vector-effect="non-scaling-stroke"`)
    );
  }
  const viewBoxOf = (n) =>
    Array.isArray(n.viewBox) && n.viewBox.length === 4 && n.viewBox[2] > 0 && n.viewBox[3] > 0
      ? n.viewBox
      : [0, 0, Number(n.w) || 1, Number(n.h) || 1];
  /**
   * The <svg> for a vector layer. Inside a layer element (default) it fills the element and lets strokes overflow;
   * `standalone` writes a self-contained SVG file of the layer's size (Copy as SVG). `ids` prefixes gradient ids.
   */
  function svgMarkup(n, tokens = {}, { standalone = false, ids } = {}) {
    if (standalone) {
      // Baked into layer pixels (viewBox = the layer size), so other tools scale strokes with the drawing.
      const [x, y, w, h] = viewBoxOf(n),
        m = [n.w / w, 0, 0, n.h / h, (-x * n.w) / w, (-y * n.h) / h];
      n = {
        ...n,
        viewBox: [0, 0, n.w, n.h],
        paths: (Array.isArray(n.paths) ? n.paths : [])
          .filter((p) => p && !pathError(p.d))
          .map((p) => ({ ...p, d: serializePath(transformSegments(parsePath(p.d), m)) })),
      };
    }
    const vb = viewBoxOf(n),
      prefix = ids || "vg-" + String(n.id || "v").replace(/[^A-Za-z0-9_-]/g, "_"),
      paths = Array.isArray(n.paths)
        ? n.paths.filter((p) => p && typeof p.d === "string" && !pathError(p.d))
        : [];
    const defs = [],
      body = [];
    const rule = (p) => (p.fillRule === "evenodd" ? ` fill-rule="evenodd"` : "");
    fillPaints(n, tokens).forEach((paint, i) => {
      const d = paintDef(paint, `${prefix}-f${i}`, vb, n, tokens);
      if (!d) return;
      if (d.def) defs.push(d.def);
      for (const p of paths)
        body.push(
          `<path d="${esc(p.d)}" fill="${d.fill}"${d.opacity < 1 ? ` fill-opacity="${d.opacity}"` : ""}${rule(p)}/>`,
        );
    });
    const stroke = strokeAttrs(n, tokens, standalone);
    if (stroke) for (const p of paths) body.push(`<path d="${esc(p.d)}" fill="none"${stroke}/>`);
    const box = standalone
      ? ` width="${num(n.w)}" height="${num(n.h)}"`
      : ` width="100%" height="100%" style="position:absolute;left:0;top:0;overflow:visible;display:block" aria-hidden="true"`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map((v) => num(v, 4)).join(" ")}" preserveAspectRatio="none"${box}>${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${body.join("")}</svg>`;
  }

  root.VerynizeVector = {
    LIMITS,
    FILL_RULES,
    CAPS,
    JOINS,
    parsePath,
    pathError,
    serializePath,
    pathBounds,
    unionBounds,
    arcToCubics,
    IDENTITY,
    multiply,
    invert,
    applyPoint,
    parseTransform,
    transformSegments,
    toContours,
    fromContours,
    segmentPoints,
    splitAt,
    nearestSegment,
    smooth,
    fitBox,
    fillPaints,
    strokeAttrs,
    viewBoxOf,
    svgMarkup,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
