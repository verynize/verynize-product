// Node-side entry for the vector layer geometry. The implementation lives in web/vector-geometry.js (a classic
// script so the canvas can load it with a <script> tag, like web/node-style.js); importing it here registers
// globalThis.VerynizeVector, which this module re-exports for the codecs, the document schema and tests.
import "../web/vector-geometry.js";

const api = globalThis.VerynizeVector;
export const {
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
} = api;
export default api;
