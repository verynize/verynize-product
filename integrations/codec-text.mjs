// CSS-style text inheritance for Verynize nodes.
//
// Frames store the inheritable text declarations from their classes in `textStyle` (declared values,
// e.g. {color, fontSize, lineHeightPx, letterSpacingEm}). Text nodes store fully resolved values
// in their usual fields plus `styleOwn`: the keys declared on the text element itself. Every other
// key is inherited from the nearest ancestor declaring it, falling back to tag defaults (h1, button
// label…) and finally to the document defaults. Legacy text nodes without `styleOwn` are left
// untouched.

export const TEXT_DEFAULTS = Object.freeze({
  color: "#25252e",
  token: "",
  fontSize: 16,
  lineHeight: 1.15,
  fontFamily: "system-ui",
  fontWeight: "400",
  letterSpacing: 0,
  textAlign: "left",
  textTransform: "",
  textDecoration: "",
  fontStyle: "",
  textWrap: "",
});
export const TEXT_KEYS = Object.keys(TEXT_DEFAULTS);
// Spec prop name -> textStyle key.
export const SPEC_TO_STYLE = {
  ink: "color",
  inkToken: "token",
  fontSize: "fontSize",
  lineHeight: "lineHeight",
  lineHeightPx: "lineHeightPx",
  fontFamily: "fontFamily",
  fontWeight: "fontWeight",
  letterSpacing: "letterSpacing",
  letterSpacingEm: "letterSpacingEm",
  textAlign: "textAlign",
  textTransform: "textTransform",
  textDecoration: "textDecoration",
  fontStyle: "fontStyle",
  textWrap: "textWrap",
};

const TAG_SIZE = { h1: 48, h2: 36, h3: 28, h4: 22, h5: 18, h6: 16, small: 12 };
const TAG_WEIGHT = {
  h1: "700",
  h2: "700",
  h3: "600",
  h4: "600",
  h5: "600",
  h6: "600",
  strong: "700",
  b: "700",
  button: "500",
};
/** Tag defaults (a stand-in for a UA stylesheet) used only when no ancestor declares the key. */
export function tagDefaults(node, parent) {
  const tag =
    node.htmlTag || (parent?.htmlTag === "button" && node.type === "text" ? "button" : null);
  const out = {};
  if (tag && TAG_SIZE[tag]) out.fontSize = TAG_SIZE[tag];
  if (tag && TAG_WEIGHT[tag]) out.fontWeight = TAG_WEIGHT[tag];
  return out;
}

/** Turn spec props (from parseClasses) into a declared textStyle object. */
export function styleFromSpec(spec) {
  const style = {};
  for (const [from, to] of Object.entries(SPEC_TO_STYLE))
    if (from in spec.props) style[to] = spec.props[from];
  if ("ink" in spec.props && !("inkToken" in spec.props)) style.token = "";
  if (style.lineHeightPx !== undefined) delete style.lineHeight;
  else if (style.lineHeight !== undefined) style.lineHeightPx = undefined;
  if (style.letterSpacingEm !== undefined) delete style.letterSpacing;
  else if (style.letterSpacing !== undefined) style.letterSpacingEm = undefined;
  if (spec.italic !== undefined) style.fontStyle = spec.italic ? "italic" : "";
  for (const key of Object.keys(style)) if (style[key] === undefined) delete style[key];
  return style;
}
/** Merge declared styles (later wins), keeping px/ratio and px/em pairs exclusive. */
export function mergeStyle(base, next) {
  const out = { ...(base || {}) };
  for (const [key, value] of Object.entries(next || {})) {
    if (key === "lineHeight") delete out.lineHeightPx;
    if (key === "lineHeightPx") delete out.lineHeight;
    if (key === "letterSpacing") delete out.letterSpacingEm;
    if (key === "letterSpacingEm") delete out.letterSpacing;
    out[key] = value;
  }
  return out;
}

/**
 * Resolve the inherited (computed) text style at the content of the last ancestor.
 * `ancestors` is ordered root -> parent. Returns {style, declared:Set}.
 */
export function inheritedStyle(ancestors) {
  const style = {};
  const declared = new Set();
  let fontSize = TEXT_DEFAULTS.fontSize;
  for (const a of ancestors) {
    const s = a.textStyle;
    if (!s || typeof s !== "object") continue;
    if (Number.isFinite(s.fontSize)) {
      fontSize = s.fontSize;
      style.fontSize = s.fontSize;
      declared.add("fontSize");
    }
    for (const key of [
      "color",
      "token",
      "fontFamily",
      "fontWeight",
      "textAlign",
      "textTransform",
      "textDecoration",
      "fontStyle",
      "textWrap",
    ])
      if (s[key] !== undefined) {
        style[key] = s[key];
        declared.add(key);
      }
    if (s.lineHeight !== undefined) {
      style.lineHeight = s.lineHeight;
      delete style.lineHeightPx;
      declared.add("lineHeight");
    }
    if (s.lineHeightPx !== undefined) {
      style.lineHeightPx = s.lineHeightPx;
      delete style.lineHeight;
      declared.add("lineHeight");
    }
    // em letter-spacing computes to px at the declaring element.
    if (s.letterSpacingEm !== undefined) {
      style.letterSpacing = Math.round(s.letterSpacingEm * fontSize * 100) / 100;
      declared.add("letterSpacing");
    }
    if (s.letterSpacing !== undefined) {
      style.letterSpacing = s.letterSpacing;
      declared.add("letterSpacing");
    }
  }
  return { style, declared };
}

/** The full style a text node gets from inheritance alone (ignoring its own declarations). */
export function baselineTextStyle(node, ancestors) {
  const { style, declared } = inheritedStyle(ancestors);
  const tag = tagDefaults(node, ancestors.at(-1));
  const out = { ...TEXT_DEFAULTS };
  for (const [key, value] of Object.entries(tag)) if (!declared.has(key)) out[key] = value;
  for (const key of TEXT_KEYS) if (style[key] !== undefined) out[key] = style[key];
  if (style.lineHeightPx !== undefined)
    out.lineHeight = Math.round((style.lineHeightPx / out.fontSize) * 1000) / 1000;
  return out;
}

/** Recompute inherited fields of text nodes that track `styleOwn`. */
export function cascadeText(nodes, byId) {
  const lookup = byId || new Map(nodes.map((n) => [n.id, n]));
  const ancestorsOf = (node) => {
    const out = [];
    let cur = node;
    const seen = new Set();
    while (cur.parentId && lookup.has(cur.parentId) && !seen.has(cur.parentId)) {
      seen.add(cur.parentId);
      cur = lookup.get(cur.parentId);
      out.unshift(cur);
    }
    return out;
  };
  for (const node of nodes) {
    if (node.type !== "text" || !Array.isArray(node.styleOwn)) continue;
    const own = new Set(node.styleOwn);
    const base = baselineTextStyle(node, ancestorsOf(node));
    for (const key of TEXT_KEYS) {
      if (own.has(key) || (key === "token" && own.has("color"))) continue;
      if (key === "lineHeight" && own.has("fontSize") && !own.has("lineHeight")) {
        // A size declared on the text without a leading keeps the inherited px leading or ratio.
        const { style } = inheritedStyle(ancestorsOf(node));
        if (style.lineHeightPx !== undefined) {
          node.lineHeight = Math.round((style.lineHeightPx / node.fontSize) * 1000) / 1000;
          continue;
        }
      }
      if (key === "fontStyle") continue; // italic is represented by whole-text runs
      node[key] = base[key];
    }
  }
}
