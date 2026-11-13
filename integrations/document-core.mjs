// Node-side entry for the shared document schema. The implementation lives in web/document-core.js (a classic
// script so the canvas can load it with a <script> tag, like web/node-style.js and web/shaders.js); importing it
// here registers globalThis.VerynizeDocument, which this module re-exports for design-store.mjs and tests.
// The validator calls into BetterNodeStyle, BetterShaders and VerynizeVector, so those load first.
import "./node-style.mjs";
import "./shaders.mjs";
import "./vector-geometry.mjs";
import "../web/document-core.js";

const api = globalThis.VerynizeDocument;
export const {
  NODE_LIMITS,
  WORLD_COORDINATE_LIMIT,
  WORLD_ADVISORY_LIMIT,
  pageWorldBounds,
  validateWorldBounds,
  validateWorldBoundsChange,
  nodeLimitMessage,
  validateDocument,
  normalizeDocument,
  resolveAliases,
  prepareDocument,
  documentProblems,
  validateAliases,
  isRoomAssetUrl,
  checkVariableValue,
  variableKind,
  IMAGE_FILL_TYPES,
  NODE_TYPES,
  LAYOUTS,
  VARIABLE_TYPES,
  VARIABLE_NAME,
  BINDABLE,
  RESERVED_NAMES,
} = api;
export default api;
