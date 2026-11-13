// Node-side entry for the shared component engine. The implementation lives in web/component-core.js (a classic
// script the canvas loads with a <script> tag, like web/document-core.js); importing it here registers
// globalThis.VerynizeComponents, which this module re-exports for design-tools.mjs, design-store.mjs and tests.
import "../web/component-core.js";

const api = globalThis.VerynizeComponents;
export const {
  syncComponents,
  createComponent,
  createInstance,
  detachInstance,
  resetOverrides,
  setSlot,
  componentInfo,
  componentProblems,
  wouldCycle,
  adoptCopies,
  hasComponents,
  snapshot,
  derivedId,
  live,
  NODE_LOCAL,
  ROOT_LOCAL,
} = api;
export default api;
