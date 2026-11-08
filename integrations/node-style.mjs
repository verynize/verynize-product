// Node-side entry for the shared node -> CSS mapping. The implementation lives in web/node-style.js
// (a classic script so the canvas can load it with a <script> tag); importing it here registers
// globalThis.BetterNodeStyle, which this module re-exports for export-html.mjs and tests.
import "../web/node-style.js";

const api = globalThis.BetterNodeStyle;
export const {
  nodeStyle,
  styleText,
  applyStyle,
  textSegments,
  sizingAllowed,
  sizingMode,
  inFlow,
  lastInFlowId,
  anchored,
  constraintsOf,
  anchorPatch,
  anchoredBox,
  safeCss,
  PALETTES,
  BLEND_MODES,
  FILTERS,
  SHADOW_TYPES,
  MASK_TYPES,
  MASK_MODES,
  MASK_REPEATS,
  MASK_COMPOSITES,
  OUTLINE_STYLES,
  effectsOf,
  validateEffects,
} = api;
// Paint stack and SVG paint helpers (fills, svgPaints).
export const {
  paintError,
  eachPaintColor,
  paintColor,
  fillsCss,
  svgPaintList,
  svgColorKey,
  recolorSvg,
  PAINT_TYPES,
  IMAGE_FITS,
} = api;
// Type settings (vertical alignment, white space, word break, indent, smoothing, line height "auto").
export const { typographyError, TEXT_ALIGN_VERTICAL, WHITE_SPACES, WORD_BREAKS, FONT_SMOOTHINGS } =
  api;
// Sizing modes (Relative / Auto / Calculate expressions) and Block alignment.
export const {
  parseCalc,
  calcValue,
  calcCss,
  sizingError,
  SIZING_MODES,
  BLOCK_ALIGN,
  trackWeight,
  gridTracks,
} = api;
export default api;
