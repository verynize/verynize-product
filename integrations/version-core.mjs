// Node-side entry for the per-artboard version history rules. The implementation lives in
// web/version-history-core.js (a classic script the canvas loads with a <script> tag); importing it
// here registers globalThis.VerynizeVersions, which this module re-exports. Restore adopts copies
// of components through web/component-core.js, so that loads first.
import "./component-core.mjs";
import "../web/version-history-core.js";

const api = globalThis.VerynizeVersions;
export const {
  IDLE_MS,
  MAX_VERSIONS,
  KEEP_RECENT,
  hash,
  isArtboard,
  groups,
  snapshot,
  snapshotHash,
  changes,
  authorKey,
  cleanAuthor,
  observe,
  idle,
  seed,
  prune,
  restore,
  checkSnapshot,
  cleanMeta,
} = api;
export default api;
