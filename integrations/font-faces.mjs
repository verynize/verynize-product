// Embedded custom fonts (document `fontFaces`, captured by web page capture) as CSS for exports.
// Mirrors the editor-side builder in web/live-preview.js (`window.embeddedFontCss`). Faces are
// re-checked here (exports may receive unvalidated input) and only faces whose family appears in the
// exported markup are emitted, so unrelated fonts do not inflate the output.
const FAMILY = /^[^;{}<>\\"]{1,100}$/;
const WEIGHT = /^(normal|bold|[1-9]00( [1-9]00)?)$/;
const SOURCE = /^data:font\/(woff2|woff|ttf|otf);base64,[A-Za-z0-9+/=]+$/;
const RANGE = /^[\w+?, -]{1,2000}$/;
// Shared rooms store fonts as room assets (cloud/assets.js): the same URL check as the schema.
const ASSET_URL =
  /^https?:\/\/[A-Za-z0-9.:[\]-]+\/api\/rooms\/[0-9a-f-]{36}\/assets\/[0-9a-f-]{36}(\?sig=[0-9a-f]{64})?$/;

const valid = (f) =>
  f &&
  typeof f.family === "string" &&
  FAMILY.test(f.family) &&
  WEIGHT.test(String(f.weight)) &&
  ["normal", "italic", "oblique"].includes(f.style) &&
  typeof f.src === "string" &&
  (SOURCE.test(f.src) || /^asset:[a-f0-9]{64}$/.test(f.src) || ASSET_URL.test(f.src)) &&
  (f.unicodeRange === undefined ||
    (typeof f.unicodeRange === "string" && RANGE.test(f.unicodeRange)));

/** Faces of `document` that are valid and (when `markup` is given) whose family the markup mentions. */
export function usedFontFaces(document, markup) {
  const faces = Array.isArray(document?.fontFaces) ? document.fontFaces.filter(valid) : [];
  if (markup === undefined) return faces;
  const text = String(markup)
    .replace(/&quot;|&#0*34;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/_/g, " ")
    .toLowerCase();
  return faces.filter((f) => text.includes(f.family.toLowerCase()));
}

/** One @font-face rule per face (font-display:block so renders never capture the fallback). */
export function fontFaceCss(faces) {
  return faces
    .map(
      (f) =>
        `@font-face{font-family:${JSON.stringify(f.family)};font-weight:${f.weight};font-style:${f.style};font-display:block;src:url(${f.src})${f.unicodeRange ? `;unicode-range:${f.unicodeRange}` : ""}}`,
    )
    .join("\n");
}

/** CSS for the document's embedded fonts used by `markup` ('' when none). */
export function documentFontCss(document, markup) {
  return fontFaceCss(usedFontFaces(document, markup));
}
