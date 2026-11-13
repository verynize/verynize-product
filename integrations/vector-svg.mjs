// Node-side entry for the SVG → vector layer importer. The implementation lives in web/vector-svg.js (a classic
// script shared with the canvas paste and drop); importing it here registers globalThis.VerynizeVectorSvg.
import "./vector-geometry.mjs";
import "../web/vector-svg.js";

const api = globalThis.VerynizeVectorSvg;
export const { CAPS, importSvg, toNodes, styleFields, parseXml } = api;
export default api;
