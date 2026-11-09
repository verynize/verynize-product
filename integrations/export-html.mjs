// Headless HTML export. Element structure and every style declaration come from the shared
// node -> CSS mapping (web/node-style.js via ./node-style.mjs), the same code the live canvas uses,
// so exports and headless screenshots render exactly what the canvas shows.
import { readFileSync } from "node:fs";
import { validateDocument } from "./design-store.mjs";
import { nodeStyle, styleText, textSegments, lastInFlowId, safeCss } from "./node-style.mjs";
import { styleSignature } from "./codec-html.mjs";
import { svgMarkup } from "./vector-geometry.mjs";

// Lossless mode: each layer also carries its exact record (data-vn-node) and a signature of its
// declarations (data-vn-sig) so codec-html.mjs can restore it while the CSS is unchanged. Instances are
// materialized, so they export as the layers they are; their component links (web/component-core.js) point at
// ids of this document and are left out.
const LAYER_SKIP = new Set([
  "id",
  "parentId",
  "shortId",
  "measured",
  "component",
  "instanceOf",
  "sourceId",
  "overrides",
  "slot",
  "slotName",
]);
export const layerRecord = (node) =>
  JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key]) => !LAYER_SKIP.has(key))));
export const losslessAttrs = (node, style) =>
  ` data-vn-node="${escape(layerRecord(node))}" data-vn-sig="${styleSignature(style)}"`;
import { paramsAttr } from "./shaders.mjs";
import { documentFontCss } from "./font-faces.mjs";

const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const safeSrc = (src) =>
  typeof src === "string" &&
  (/^asset:[a-f0-9]{64}$/.test(src) ||
    /^data:image\/(png|jpeg|webp|gif|svg\+xml);/i.test(src) ||
    /^https?:\/\/[^\s"'<>]+$/i.test(src))
    ? src
    : "";

function richText(node) {
  return textSegments(node)
    .map(
      (seg) =>
        `<span${seg.style.length ? ` style="${escape(styleText(seg.style))}"` : ""}>${escape(seg.text)}</span>`,
    )
    .join("");
}

export function exportHTML(document, pageId, { nodeId, lossless = false } = {}) {
  validateDocument(document);
  const page = document.pages.find((p) => p.id === pageId) || (!pageId ? document.pages[0] : null);
  if (!page) throw new Error("Page not found");
  const only = nodeId ? page.nodes.find((n) => n.id === nodeId) : null;
  if (nodeId && !only) throw new Error("Node not found");
  const kids = new Map();
  for (const n of page.nodes) {
    const key = n.parentId || null;
    if (!kids.has(key)) kids.set(key, []);
    kids.get(key).push(n);
  }
  const tokens = document.tokens || {};
  const render = (node, parent, lastInFlow) => {
    const color = safeCss(
      tokens[node.token] || node.color,
      node.type === "text" ? "#25252e" : "transparent",
    );
    const {
      box,
      img,
      svgTint,
      src: recolored,
    } = nodeStyle(node, parent, {
      color,
      svgColor: tokens[node.svgColorToken] || node.svgColor,
      lastInFlow,
      tokens,
    });
    const shaderAttrs =
      node.type === "shader" || node.shaderFill === true
        ? `${node.type === "shader" ? "" : ' data-shader-fill="true"'} data-shader-preset="${escape(node.shaderPreset || "aurora")}" data-shader-speed="${escape(node.shaderSpeed ?? 1)}" data-shader-intensity="${escape(node.shaderIntensity ?? 1)}" data-shader-color="${escape(color)}"${paramsAttr(node, tokens) ? ` data-shader-params="${escape(paramsAttr(node, tokens))}"` : ""}`
        : "";
    const attrs = `${shaderAttrs} data-id="${escape(node.id)}" data-design-type="${escape(node.type)}" data-name="${escape(node.name)}"${node.icon ? ` data-icon="${escape(node.icon)}"` : ""}${lossless ? losslessAttrs(node, styleText(box)) : ""} style="${escape(styleText(box))}"`;
    let inner = "";
    if (node.type === "text") inner = richText(node);
    else if (node.type === "image") {
      const src = (node.src && recolored) || safeSrc(node.src) || safeSrc(node.srcRemote);
      if (src)
        inner = svgTint
          ? `<span role="img" aria-label="${escape(node.name)}" data-svg-color="true" style="${escape(styleText(img))}"></span>`
          : `<img src="${escape(src)}" alt="${escape(node.name)}" style="${escape(styleText(img))}">`;
    } else if (node.type === "vector") inner = svgMarkup(node, tokens);
    else if (node.type === "frame") {
      const children = kids.get(node.id) || [];
      const last = lastInFlowId(children);
      inner = children.map((c) => render(c, node, c.id === last)).join("");
    }
    return `<div${attrs}>${inner}</div>`;
  };
  const runtime = page.nodes.some((n) => n.type === "shader" || n.shaderFill === true)
    ? "<script>" +
      readFileSync(new URL("../web/shaders.js", import.meta.url), "utf8").replace(
        /<\/script/gi,
        "<\\/script",
      ) +
      ";globalThis.BetterShaders.startAll();</script>"
    : "";
  const width = only ? only.w : Number.isFinite(page.width) ? page.width : 1000,
    height = only ? only.h : Number.isFinite(page.height) ? page.height : 700;
  const body = only
    ? render({ ...only, x: 0, y: 0 }, null)
    : (kids.get(null) || []).map((n) => render(n, null)).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(document.name)} — ${escape(page.name)}</title><style>${documentFontCss(document, body)}*{box-sizing:border-box}@keyframes design-gradient{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}</style></head><body style="margin:0;font-family:system-ui"><main style="position:relative;width:${width}px;height:${height}px;overflow:hidden">${body}</main>${runtime}</body></html>`;
}
