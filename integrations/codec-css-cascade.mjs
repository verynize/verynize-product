// A small, dependency-free CSS engine for HTML import: stylesheet parser (rules, @media, @import,
// @layer, @supports), selector matching with specificity, shorthand expansion and the cascade
// (origin, !important, layers, specificity, source order, inline styles). Values are kept as text;
// var() and unit resolution happen per element in codec-html.mjs.
import { splitTop } from "./codec-css.mjs";

// ---------------------------------------------------------------------------------------------
// Stylesheet parsing

const stripComments = (text) => String(text || "").replace(/\/\*[\s\S]*?(\*\/|$)/g, "");

/** Index of the brace closing the block that opens at `open`, respecting strings. */
function blockEnd(s, open) {
  let depth = 0,
    quote = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return s.length;
}
/** Next top-level occurrence of any char in `chars`, respecting strings and parentheses. */
function nextTop(s, from, chars) {
  let depth = 0,
    quote = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && chars.includes(c)) return i;
  }
  return -1;
}

/** Parse "a: b; c: d !important" into [{property, value, important}]. */
export function parseDeclarations(text) {
  const out = [];
  const s = stripComments(text);
  let start = 0;
  for (;;) {
    const end = nextTop(s, start, ";");
    const part = s.slice(start, end < 0 ? s.length : end).trim();
    if (part) {
      const colon = part.indexOf(":");
      if (colon > 0) {
        let property = part.slice(0, colon).trim(),
          value = part.slice(colon + 1).trim(),
          important = false;
        if (!property.startsWith("--")) property = property.toLowerCase();
        const bang = value.match(/\s*!\s*important\s*$/i);
        if (bang) {
          important = true;
          value = value.slice(0, bang.index).trim();
        }
        if (/^-?[a-z_-][\w-]*$/i.test(property) && (value || property.startsWith("--")))
          out.push({ property, value, important });
      }
    }
    if (end < 0) break;
    start = end + 1;
  }
  return out;
}

/**
 * Parse a stylesheet into a flat list of items in source order:
 *   {type:'rule', selector, decls, media:[...], layer, supports:true}
 *   {type:'import', url, media, layer}
 * Nested @media/@supports/@layer blocks are flattened, their conditions recorded on each rule.
 */
export function parseStylesheet(text, { media = [], layer = null } = {}) {
  const s = stripComments(text);
  const items = [],
    layers = [];
  const walk = (src, ctx) => {
    let i = 0;
    while (i < src.length) {
      while (i < src.length && /[\s;]/.test(src[i])) i++;
      if (i >= src.length) break;
      if (src.startsWith("<!--", i)) {
        i += 4;
        continue;
      }
      if (src.startsWith("-->", i)) {
        i += 3;
        continue;
      }
      const stop = nextTop(src, i, "{;");
      if (src[i] === "@") {
        const nameMatch = /^@([\w-]+)/.exec(src.slice(i));
        const name = nameMatch ? nameMatch[1].toLowerCase() : "";
        if (stop < 0) break;
        const prelude = src.slice(i + 1 + name.length, stop).trim();
        if (src[stop] === ";") {
          if (name === "import")
            items.push({ type: "import", ...parseImport(prelude), ctx: { ...ctx } });
          else if (name === "layer")
            for (const l of prelude
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean))
              layers.push(ctx.layer ? `${ctx.layer}.${l}` : l);
          i = stop + 1;
          continue;
        }
        const end = blockEnd(src, stop),
          inner = src.slice(stop + 1, end);
        if (name === "media") walk(inner, { ...ctx, media: [...ctx.media, prelude] });
        else if (name === "supports") {
          if (supports(prelude)) walk(inner, ctx);
        } else if (name === "layer") {
          const l = prelude
            ? ctx.layer
              ? `${ctx.layer}.${prelude}`
              : prelude
            : `${ctx.layer ? ctx.layer + "." : ""}anonymous-${layers.length}`;
          layers.push(l);
          walk(inner, { ...ctx, layer: l });
        } else if (name === "document" || name === "scope" || name === "starting-style") {
          /* not applied */
        } else items.push({ type: "at", name, prelude, ctx: { ...ctx } }); // font-face, keyframes, container, page…
        i = end + 1;
        continue;
      }
      if (stop < 0) break;
      if (src[stop] === ";") {
        i = stop + 1;
        continue;
      }
      const end = blockEnd(src, stop);
      const selector = src.slice(i, stop).trim();
      const body = src.slice(stop + 1, end);
      // CSS nesting: nested rules inside a style rule are flattened with `&` substitution.
      const { decls, nested } = splitNested(body);
      if (selector)
        items.push({ type: "rule", selector, decls: parseDeclarations(decls), ctx: { ...ctx } });
      for (const n of nested) {
        if (n.at) {
          walk(`${n.at}{${selector}{${n.body}}}`, ctx);
          continue;
        }
        const parents = splitTop(selector, ","),
          kids = splitTop(n.selector, ",");
        const combined = parents
          .flatMap((p) => kids.map((k) => (k.includes("&") ? k.replace(/&/g, p) : `${p} ${k}`)))
          .join(", ");
        walk(`${combined}{${n.body}}`, ctx);
      }
      i = end + 1;
    }
  };
  walk(s, { media, layer });
  return { items, layers };
}
function splitNested(body) {
  const nested = [];
  let decls = "",
    i = 0;
  while (i < body.length) {
    const stop = nextTop(body, i, ";{");
    if (stop < 0) {
      decls += body.slice(i);
      break;
    }
    if (body[stop] === ";") {
      decls += body.slice(i, stop + 1);
      i = stop + 1;
      continue;
    }
    const end = blockEnd(body, stop),
      head = body.slice(i, stop).trim();
    if (head.startsWith("@")) nested.push({ at: head, body: body.slice(stop + 1, end) });
    else nested.push({ selector: head, body: body.slice(stop + 1, end) });
    i = end + 1;
  }
  return { decls, nested };
}
function parseImport(prelude) {
  let rest = prelude.trim(),
    url = "";
  const m = rest.match(/^url\(\s*(['"]?)(.*?)\1\s*\)/i) || rest.match(/^(['"])(.*?)\1/);
  if (m) {
    url = m[2];
    rest = rest.slice(m[0].length).trim();
  }
  let layer = null;
  const lm = rest.match(/^layer(?:\(\s*([\w.-]+)\s*\))?/i);
  if (lm) {
    layer = lm[1] || "";
    rest = rest.slice(lm[0].length).trim();
  }
  const sm = rest.match(/^supports\((.*)\)/i);
  if (sm) rest = rest.slice(sm[0].length).trim();
  return { url, layer, media: rest };
}
/** @supports: property tests are assumed true (we read the declarations anyway); selector() true. */
function supports(prelude) {
  const t = prelude.trim().toLowerCase();
  if (/^not\s/.test(t)) return !supports(t.slice(3));
  return !/-ms-|-o-[a-z]/.test(t);
}

// ---------------------------------------------------------------------------------------------
// Selectors

const STATE = new Set([
  "hover",
  "focus",
  "active",
  "visited",
  "focus-visible",
  "focus-within",
  "target",
  "user-invalid",
  "invalid",
  "valid",
  "placeholder-shown",
  "autofill",
  "indeterminate",
  "open",
  "popover-open",
  "modal",
  "fullscreen",
  "playing",
  "paused",
  "current",
  "past",
  "future",
  "default",
  "in-range",
  "out-of-range",
  "read-only",
  "read-write",
  "required",
  "optional",
  "defined",
]);

/** Parse a selector list into [{parts:[{compound, combinator}], spec:[a,b,c]}] (null for unsupported). */
export function parseSelectorList(text) {
  return splitTop(text, ",").map((sel) => {
    try {
      return parseComplex(sel.trim());
    } catch {
      return null;
    }
  });
}
function parseComplex(sel) {
  const parts = [];
  let i = 0,
    combinator = " ";
  const s = sel;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) {
      i++;
      if (combinator !== ">" && combinator !== "+" && combinator !== "~") combinator = " ";
    }
    if (i >= s.length) break;
    if (">+~".includes(s[i])) {
      combinator = s[i];
      i++;
      continue;
    }
    const { compound, next } = parseCompound(s, i);
    if (next === i) throw new Error("bad selector");
    parts.push({ compound, combinator: parts.length ? combinator : null });
    combinator = " ";
    i = next;
  }
  if (!parts.length) throw new Error("empty");
  const spec = parts.reduce((acc, p) => add(acc, p.compound.spec), [0, 0, 0]);
  return { parts, spec, pseudoElement: parts.some((p) => p.compound.pseudoElement) };
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const max = (list) => list.reduce((m, s) => (cmpSpec(s, m) > 0 ? s : m), [0, 0, 0]);
export const cmpSpec = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const IDENT = /^(?:\\.|[\w -￿-])+/;
const unescape = (v) =>
  v.replace(/\\([0-9a-f]{1,6}\s?|.)/gi, (_, c) =>
    /^[0-9a-f]/i.test(c) && c.trim().length > 1
      ? String.fromCodePoint(parseInt(c, 16))
      : c.trim()
        ? c
        : c,
  );
function parseCompound(s, start) {
  let i = start;
  const c = {
    tag: null,
    id: null,
    classes: [],
    attrs: [],
    pseudos: [],
    spec: [0, 0, 0],
    pseudoElement: false,
    never: false,
  };
  if (s[i] === "*") i++;
  else {
    const m = IDENT.exec(s.slice(i));
    if (m && !".#[:".includes(s[i])) {
      c.tag = unescape(m[0]).toLowerCase();
      c.spec[2]++;
      i += m[0].length;
    }
  }
  if (s[i] === "|") i++;
  for (;;) {
    const ch = s[i];
    if (ch === ".") {
      const m = IDENT.exec(s.slice(i + 1));
      if (!m) throw new Error("class");
      c.classes.push(unescape(m[0]));
      c.spec[1]++;
      i += 1 + m[0].length;
      continue;
    }
    if (ch === "#") {
      const m = IDENT.exec(s.slice(i + 1));
      if (!m) throw new Error("id");
      c.id = unescape(m[0]);
      c.spec[0]++;
      i += 1 + m[0].length;
      continue;
    }
    if (ch === "[") {
      const end = s.indexOf("]", i);
      if (end < 0) throw new Error("attr");
      const body = s.slice(i + 1, end).trim();
      const m = body.match(
        /^([\w:-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*([is])?)?$/i,
      );
      if (!m) throw new Error("attr");
      c.attrs.push({
        name: m[1].toLowerCase(),
        op: m[2] || null,
        value: m[3] ?? m[4] ?? m[5] ?? "",
        ci: m[6]?.toLowerCase() === "i",
      });
      c.spec[1]++;
      i = end + 1;
      continue;
    }
    if (ch === ":") {
      const double = s[i + 1] === ":";
      const m = /^[\w-]+/.exec(s.slice(i + (double ? 2 : 1)));
      if (!m) throw new Error("pseudo");
      const name = m[0].toLowerCase();
      i += (double ? 2 : 1) + m[0].length;
      let arg = null;
      if (s[i] === "(") {
        let depth = 0,
          j = i;
        for (; j < s.length; j++) {
          if (s[j] === "(") depth++;
          else if (s[j] === ")" && --depth === 0) break;
        }
        arg = s.slice(i + 1, j);
        i = j + 1;
      }
      if (
        double ||
        [
          "before",
          "after",
          "first-line",
          "first-letter",
          "marker",
          "placeholder",
          "selection",
          "backdrop",
        ].includes(name)
      ) {
        c.pseudoElement = true;
        c.spec[2]++;
        continue;
      }
      if (["is", "matches", "any", "where", "not", "has"].includes(name)) {
        const list = (
          name === "has"
            ? splitTop(arg || "", ",").map((x) => {
                try {
                  return parseComplex(x.trim().replace(/^[>+~]\s*/, (m2) => m2));
                } catch {
                  return null;
                }
              })
            : parseSelectorList(arg || "")
        ).filter(Boolean);
        c.pseudos.push({
          name: name === "matches" || name === "any" ? "is" : name,
          list,
          relative: name === "has" ? splitTop(arg || "", ",").map((x) => x.trim()[0]) : null,
        });
        if (name !== "where") c.spec = add(c.spec, max(list.map((x) => x.spec)));
        continue;
      }
      c.spec[1]++;
      if (STATE.has(name)) {
        c.never = true;
        continue;
      }
      c.pseudos.push({ name, arg });
      continue;
    }
    break;
  }
  return { compound: c, next: i };
}

const elementChildren = (el) => (el.children || []).filter((n) => n.tag);
function nth(arg, index) {
  const a = String(arg || "")
    .trim()
    .toLowerCase()
    .split(/\s+of\s+/)[0];
  if (a === "odd") return index % 2 === 1;
  if (a === "even") return index % 2 === 0;
  const m = a.replace(/\s+/g, "").match(/^([+-]?\d*)?n([+-]\d+)?$/);
  if (!m) return Number(a) === index;
  const step =
      m[1] === undefined || m[1] === "" || m[1] === "+" ? 1 : m[1] === "-" ? -1 : Number(m[1]),
    offset = Number(m[2] || 0);
  if (step === 0) return index === offset;
  return (index - offset) / step >= 0 && Number.isInteger((index - offset) / step);
}
function matchCompound(el, c) {
  if (c.never || c.pseudoElement) return false;
  if (c.tag && el.tag !== c.tag) return false;
  if (c.id !== null && el.attrs.id !== c.id) return false;
  if (c.classes.length) {
    const list = el.classList;
    if (!c.classes.every((cls) => list.includes(cls))) return false;
  }
  for (const a of c.attrs) {
    const v = el.attrs[a.name];
    if (v === undefined) return false;
    if (!a.op) continue;
    const have = a.ci ? String(v).toLowerCase() : String(v),
      want = a.ci ? a.value.toLowerCase() : a.value;
    const ok =
      a.op === "="
        ? have === want
        : a.op === "~="
          ? have.split(/\s+/).includes(want)
          : a.op === "|="
            ? have === want || have.startsWith(want + "-")
            : a.op === "^="
              ? !!want && have.startsWith(want)
              : a.op === "$="
                ? !!want && have.endsWith(want)
                : !!want && have.includes(want);
    if (!ok) return false;
  }
  for (const p of c.pseudos) {
    const siblings = el.parent ? elementChildren(el.parent) : [el];
    const idx = siblings.indexOf(el),
      typed = siblings.filter((s) => s.tag === el.tag),
      tIdx = typed.indexOf(el);
    switch (p.name) {
      case "root":
        if (el.tag !== "html") return false;
        break;
      case "first-child":
        if (idx !== 0) return false;
        break;
      case "last-child":
        if (idx !== siblings.length - 1) return false;
        break;
      case "only-child":
        if (siblings.length !== 1) return false;
        break;
      case "first-of-type":
        if (tIdx !== 0) return false;
        break;
      case "last-of-type":
        if (tIdx !== typed.length - 1) return false;
        break;
      case "only-of-type":
        if (typed.length !== 1) return false;
        break;
      case "nth-child":
        if (!nth(p.arg, idx + 1)) return false;
        break;
      case "nth-last-child":
        if (!nth(p.arg, siblings.length - idx)) return false;
        break;
      case "nth-of-type":
        if (!nth(p.arg, tIdx + 1)) return false;
        break;
      case "nth-last-of-type":
        if (!nth(p.arg, typed.length - tIdx)) return false;
        break;
      case "empty":
        if ((el.children || []).some((n) => n.tag || (n.text && n.text.length))) return false;
        break;
      case "link":
      case "any-link":
        if (!(["a", "area"].includes(el.tag) && el.attrs.href !== undefined)) return false;
        break;
      case "checked":
        if (el.attrs.checked === undefined && el.attrs.selected === undefined) return false;
        break;
      case "disabled":
        if (el.attrs.disabled === undefined) return false;
        break;
      case "enabled":
        if (el.attrs.disabled !== undefined) return false;
        break;
      case "lang":
        if (
          !String(closestAttr(el, "lang") || "")
            .toLowerCase()
            .startsWith(
              String(p.arg || "")
                .trim()
                .toLowerCase(),
            )
        )
          return false;
        break;
      case "dir":
        if ((closestAttr(el, "dir") || "ltr") !== String(p.arg || "").trim()) return false;
        break;
      case "scope":
        if (el.tag !== "html") return false;
        break;
      case "is":
      case "where":
        if (!p.list.some((sel) => matches(el, sel))) return false;
        break;
      case "not":
        if (p.list.some((sel) => matches(el, sel))) return false;
        break;
      case "has":
        if (!p.list.some((sel, i) => hasRelative(el, sel, p.relative?.[i]))) return false;
        break;
      default:
        return false; // unknown pseudo-classes never match
    }
  }
  return true;
}
const closestAttr = (el, name) => {
  for (let e = el; e; e = e.parent) if (e.attrs?.[name] !== undefined) return e.attrs[name];
  return null;
};
function hasRelative(el, sel, lead) {
  if (lead === ">") return elementChildren(el).some((k) => matches(k, sel));
  if (lead === "+") {
    const s = el.parent ? elementChildren(el.parent) : [];
    const n = s[s.indexOf(el) + 1];
    return !!n && matches(n, sel);
  }
  if (lead === "~") {
    const s = el.parent ? elementChildren(el.parent) : [];
    return s.slice(s.indexOf(el) + 1).some((k) => matches(k, sel));
  }
  const stack = [...elementChildren(el)];
  while (stack.length) {
    const k = stack.shift();
    if (matches(k, sel)) return true;
    stack.push(...elementChildren(k));
  }
  return false;
}
/** Whether element `el` matches a parsed complex selector. */
export function matches(el, sel) {
  if (!sel || sel.pseudoElement) return false;
  const parts = sel.parts;
  const test = (node, i) => {
    if (!matchCompound(node, parts[i].compound)) return false;
    if (i === 0) return true;
    const comb = parts[i].combinator;
    if (comb === ">") return !!node.parent?.tag && test(node.parent, i - 1);
    if (comb === " ") {
      for (let p = node.parent; p && p.tag; p = p.parent) if (test(p, i - 1)) return true;
      return false;
    }
    const siblings = node.parent ? elementChildren(node.parent) : [];
    const idx = siblings.indexOf(node);
    if (comb === "+") return idx > 0 && test(siblings[idx - 1], i - 1);
    if (comb === "~") {
      for (let j = idx - 1; j >= 0; j--) if (test(siblings[j], i - 1)) return true;
      return false;
    }
    return false;
  };
  return test(el, parts.length - 1);
}

// ---------------------------------------------------------------------------------------------
// Shorthands -> longhands

const SIDES = ["top", "right", "bottom", "left"];
const four = (parts) => {
  const [t, r = t, b = t, l = r] = parts;
  return [t, r, b, l];
};
const BORDER_STYLES = new Set([
  "none",
  "hidden",
  "dotted",
  "dashed",
  "solid",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
]);
const isWidth = (v) =>
  /^(thin|medium|thick)$/i.test(v) || /^-?[\d.]+[a-z%]*$/i.test(v) || /^calc\(/i.test(v);
const WIDTH_KEYWORD = { thin: "1px", medium: "3px", thick: "5px" };
function borderParts(value) {
  const out = {};
  for (const part of splitTop(value, " ")) {
    if (BORDER_STYLES.has(part.toLowerCase())) out.style = part.toLowerCase();
    else if (isWidth(part)) out.width = WIDTH_KEYWORD[part.toLowerCase()] || part;
    else out.color = part;
  }
  return out;
}
const GLOBAL = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

/** Expand one declaration into longhand declarations the importer understands. */
export function expand(decl) {
  const { property: p, value: v, important } = decl;
  const d = (property, value) => ({ property, value, important });
  if (
    GLOBAL.has(v.trim().toLowerCase()) &&
    [
      "margin",
      "padding",
      "border",
      "inset",
      "background",
      "font",
      "border-radius",
      "gap",
      "flex",
      "outline",
      "overflow",
      "border-width",
      "border-style",
      "border-color",
      "text-decoration",
      "place-items",
    ].includes(p)
  ) {
    const longs = {
      margin: SIDES.map((s) => `margin-${s}`),
      padding: SIDES.map((s) => `padding-${s}`),
      inset: SIDES,
      gap: ["row-gap", "column-gap"],
      "border-radius": [
        "border-top-left-radius",
        "border-top-right-radius",
        "border-bottom-right-radius",
        "border-bottom-left-radius",
      ],
      overflow: ["overflow-x", "overflow-y"],
      "text-decoration": ["text-decoration-line"],
      "place-items": ["align-items", "justify-items"],
      flex: ["flex-grow", "flex-shrink", "flex-basis"],
      outline: ["outline-width", "outline-style", "outline-color"],
      background: ["background-color", "background-image"],
      font: ["font-style", "font-weight", "font-size", "line-height", "font-family"],
      "border-width": SIDES.map((s) => `border-${s}-width`),
      "border-style": SIDES.map((s) => `border-${s}-style`),
      "border-color": SIDES.map((s) => `border-${s}-color`),
      border: SIDES.flatMap((s) => [`border-${s}-width`, `border-${s}-style`, `border-${s}-color`]),
    }[p];
    return (longs || [p]).map((l) => d(l, v));
  }
  if (
    /var\(/i.test(v) &&
    !p.startsWith("--") &&
    [
      "margin",
      "padding",
      "inset",
      "border",
      "border-width",
      "border-color",
      "border-style",
      "border-radius",
      "background",
      "font",
      "gap",
      "outline",
    ].includes(p) &&
    splitTop(v, " ").length === 1 &&
    /^var\(/i.test(v.trim())
  ) {
    // A single var() for a shorthand: apply it to every longhand (exact for the common "padding: var(--x)").
    if (p === "margin" || p === "padding") return SIDES.map((s) => d(`${p}-${s}`, v));
    if (p === "inset") return SIDES.map((s) => d(s, v));
    if (p === "gap") return [d("row-gap", v), d("column-gap", v)];
    if (p === "border-radius")
      return ["top-left", "top-right", "bottom-right", "bottom-left"].map((c) =>
        d(`border-${c}-radius`, v),
      );
    if (p === "background") return [d("background-color", v)];
    if (p === "border-color") return SIDES.map((s) => d(`border-${s}-color`, v));
    if (p === "border-width") return SIDES.map((s) => d(`border-${s}-width`, v));
  }
  switch (p) {
    case "margin":
    case "padding":
      return four(splitTop(v, " ")).map((x, i) => d(`${p}-${SIDES[i]}`, x));
    case "inset":
      return four(splitTop(v, " ")).map((x, i) => d(SIDES[i], x));
    case "margin-inline":
    case "padding-inline": {
      const [a, b = a] = splitTop(v, " ");
      const base = p.split("-")[0];
      return [d(`${base}-left`, a), d(`${base}-right`, b)];
    }
    case "margin-block":
    case "padding-block": {
      const [a, b = a] = splitTop(v, " ");
      const base = p.split("-")[0];
      return [d(`${base}-top`, a), d(`${base}-bottom`, b)];
    }
    case "margin-inline-start":
    case "padding-inline-start":
      return [d(`${p.split("-")[0]}-left`, v)];
    case "margin-inline-end":
    case "padding-inline-end":
      return [d(`${p.split("-")[0]}-right`, v)];
    case "margin-block-start":
    case "padding-block-start":
      return [d(`${p.split("-")[0]}-top`, v)];
    case "margin-block-end":
    case "padding-block-end":
      return [d(`${p.split("-")[0]}-bottom`, v)];
    case "inset-inline": {
      const [a, b = a] = splitTop(v, " ");
      return [d("left", a), d("right", b)];
    }
    case "inset-block": {
      const [a, b = a] = splitTop(v, " ");
      return [d("top", a), d("bottom", b)];
    }
    case "inset-inline-start":
      return [d("left", v)];
    case "inset-inline-end":
      return [d("right", v)];
    case "gap":
    case "grid-gap": {
      const [r, c = r] = splitTop(v, " ");
      return [d("row-gap", r), d("column-gap", c)];
    }
    case "grid-row-gap":
      return [d("row-gap", v)];
    case "grid-column-gap":
      return [d("column-gap", v)];
    case "border": {
      const b = borderParts(v);
      return SIDES.flatMap((s) => [
        d(`border-${s}-width`, b.width ?? (b.style && b.style !== "none" ? "3px" : "0px")),
        d(`border-${s}-style`, b.style ?? "none"),
        d(`border-${s}-color`, b.color ?? "currentcolor"),
      ]);
    }
    case "border-top":
    case "border-right":
    case "border-bottom":
    case "border-left": {
      const b = borderParts(v);
      return [
        d(`${p}-width`, b.width ?? (b.style && b.style !== "none" ? "3px" : "0px")),
        d(`${p}-style`, b.style ?? "none"),
        d(`${p}-color`, b.color ?? "currentcolor"),
      ];
    }
    case "border-width":
      return four(splitTop(v, " ")).map((x, i) =>
        d(`border-${SIDES[i]}-width`, WIDTH_KEYWORD[x] || x),
      );
    case "border-style":
      return four(splitTop(v, " ")).map((x, i) => d(`border-${SIDES[i]}-style`, x));
    case "border-color":
      return four(splitTop(v, " ")).map((x, i) => d(`border-${SIDES[i]}-color`, x));
    case "border-inline":
    case "border-block": {
      const b = borderParts(v);
      const sides = p === "border-inline" ? ["left", "right"] : ["top", "bottom"];
      return sides.flatMap((s) => [
        d(`border-${s}-width`, b.width ?? "3px"),
        d(`border-${s}-style`, b.style ?? "none"),
        d(`border-${s}-color`, b.color ?? "currentcolor"),
      ]);
    }
    case "border-radius": {
      const [h] = v.split("/");
      const c = four(splitTop(h.trim(), " "));
      return ["top-left", "top-right", "bottom-right", "bottom-left"].map((k, i) =>
        d(`border-${k}-radius`, c[i]),
      );
    }
    case "border-start-start-radius":
      return [d("border-top-left-radius", v)];
    case "border-start-end-radius":
      return [d("border-top-right-radius", v)];
    case "border-end-end-radius":
      return [d("border-bottom-right-radius", v)];
    case "border-end-start-radius":
      return [d("border-bottom-left-radius", v)];
    case "outline": {
      const b = borderParts(v);
      return [
        d("outline-width", b.width ?? "3px"),
        d("outline-style", b.style ?? "none"),
        d("outline-color", b.color ?? "currentcolor"),
      ];
    }
    case "overflow": {
      const [x, y = x] = splitTop(v, " ");
      return [d("overflow-x", x), d("overflow-y", y)];
    }
    case "flex": {
      const t = v.trim().toLowerCase();
      if (t === "none")
        return [d("flex-grow", "0"), d("flex-shrink", "0"), d("flex-basis", "auto")];
      if (t === "auto")
        return [d("flex-grow", "1"), d("flex-shrink", "1"), d("flex-basis", "auto")];
      if (t === "initial")
        return [d("flex-grow", "0"), d("flex-shrink", "1"), d("flex-basis", "auto")];
      const parts = splitTop(v, " "),
        nums = parts.filter((x) => /^[\d.]+$/.test(x)),
        basis = parts.find((x) => !/^[\d.]+$/.test(x));
      return [
        d("flex-grow", nums[0] ?? "1"),
        d("flex-shrink", nums[1] ?? "1"),
        d("flex-basis", basis ?? (nums.length ? "0%" : "auto")),
      ];
    }
    case "flex-flow": {
      const out = [];
      for (const x of splitTop(v, " "))
        out.push(/wrap/.test(x) ? d("flex-wrap", x) : d("flex-direction", x));
      return out;
    }
    case "place-items": {
      const [a, j = a] = splitTop(v, " ");
      return [d("align-items", a), d("justify-items", j)];
    }
    case "place-content": {
      const [a, j = a] = splitTop(v, " ");
      return [d("align-content", a), d("justify-content", j)];
    }
    case "place-self": {
      const [a, j = a] = splitTop(v, " ");
      return [d("align-self", a), d("justify-self", j)];
    }
    case "background": {
      // Last layer may carry the colour; image layers become background-image.
      const layers = splitTop(v, ","),
        last = layers.at(-1) || "";
      const images = [],
        out = [];
      let color = null;
      layers.forEach((layer, i) => {
        for (const part of splitTop(layer, " ")) {
          if (/^(?:repeating-)?(?:linear|radial|conic)-gradient\(|^url\(|^image-set\(/i.test(part))
            images.push(part);
          else if (
            i === layers.length - 1 &&
            !/^(?:no-repeat|repeat(?:-x|-y)?|space|round|scroll|fixed|local|top|bottom|left|right|center|cover|contain|auto|border-box|padding-box|content-box|text|[\d.]+[a-z%]*|\/|0)$/i.test(
              part,
            )
          )
            color = part;
        }
      });
      void last;
      out.push(
        d("background-color", color ?? "transparent"),
        d("background-image", images.length ? images.join(", ") : "none"),
      );
      return out;
    }
    case "font": {
      const t = v.trim();
      if (/^(caption|icon|menu|message-box|small-caption|status-bar)$/i.test(t)) return [];
      const parts = splitTop(t, " ");
      const out = [d("font-style", "normal"), d("font-weight", "400"), d("line-height", "normal")];
      let i = 0;
      for (; i < parts.length; i++) {
        const x = parts[i].toLowerCase();
        if (x === "italic" || x === "oblique") out[0] = d("font-style", x);
        else if (/^(bold|bolder|lighter|[1-9]00)$/.test(x)) out[1] = d("font-weight", x);
        else if (x === "normal" || x === "small-caps" || /condensed|expanded/.test(x)) {
          /* font-variant / stretch */
        } else break;
      }
      const size = parts[i] || "";
      const [fs, lh] = size.split("/");
      if (fs) out.push(d("font-size", fs));
      if (lh) out[2] = d("line-height", lh);
      let rest = parts.slice(i + 1);
      if (rest[0] === "/") {
        out[2] = d("line-height", rest[1]);
        rest = rest.slice(2);
      } else if (rest[0]?.startsWith("/")) {
        out[2] = d("line-height", rest[0].slice(1));
        rest = rest.slice(1);
      }
      if (rest.length) out.push(d("font-family", rest.join(" ")));
      return out;
    }
    case "text-decoration": {
      const parts = splitTop(v, " ");
      const line = parts.filter((x) => /^(none|underline|overline|line-through)$/i.test(x));
      return [d("text-decoration-line", line.length ? line.join(" ") : "none")];
    }
    case "transform": {
      const out = [];
      if (v.trim() === "none")
        return [d("translate", "none"), d("rotate", "none"), d("scale", "none")];
      for (const fn of v.matchAll(/([a-zA-Z0-9]+)\(([^)]*)\)/g)) {
        const name = fn[1].toLowerCase(),
          args = fn[2].split(",").map((x) => x.trim());
        if (name === "translate") out.push(d("translate", `${args[0]} ${args[1] ?? "0px"}`));
        else if (name === "translatex") out.push(d("translate", `${args[0]} 0px`));
        else if (name === "translatey") out.push(d("translate", `0px ${args[0]}`));
        else if (name === "rotate" || name === "rotatez") out.push(d("rotate", args[0]));
        else if (name === "scale") out.push(d("scale", `${args[0]} ${args[1] ?? args[0]}`));
        else if (name === "scalex") out.push(d("scale", `${args[0]} 1`));
        else if (name === "scaley") out.push(d("scale", `1 ${args[0]}`));
        else out.push(d("transform", v));
      }
      return out;
    }
    case "list-style":
      return [];
    case "white-space":
      return [d("white-space", v)];
    case "-webkit-text-fill-color":
      return [];
    case "word-wrap":
      return [d("overflow-wrap", v)];
    default:
      return [d(p, v)];
  }
}

// ---------------------------------------------------------------------------------------------
// Cascade

/**
 * Cascade sorted declarations. `entries` are {property, value, important, origin:'ua'|'author'|'inline',
 * layerRank, spec, order}. Returns Map property -> winning entry.
 */
export function cascade(entries, layerCount) {
  const rank = (e) => {
    // Normal: ua < author layers (in order) < author unlayered < inline. Important reverses layers.
    if (!e.important)
      return [
        0,
        e.origin === "ua" ? 0 : e.origin === "inline" ? 3 : 1,
        e.origin === "author" ? (e.layerRank ?? layerCount) : 0,
      ];
    return [
      1,
      e.origin === "ua" ? 3 : e.origin === "inline" ? 2 : 1,
      e.origin === "author" ? layerCount - (e.layerRank ?? layerCount) : 0,
    ];
  };
  const keyed = entries.map((e) => ({ e, r: rank(e) }));
  keyed.sort(
    (a, b) =>
      a.r[0] - b.r[0] ||
      a.r[1] - b.r[1] ||
      a.r[2] - b.r[2] ||
      cmpSpec(a.e.spec || [0, 0, 0], b.e.spec || [0, 0, 0]) ||
      a.e.order - b.e.order,
  );
  const out = new Map();
  for (const { e } of keyed) out.set(e.property, e);
  return out;
}

export const INHERITED = new Set([
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "white-space",
  "visibility",
  "word-spacing",
  "text-indent",
  "cursor",
  "text-shadow",
  "text-wrap",
  "list-style-type",
  "direction",
  "font-variant",
  "tab-size",
  "overflow-wrap",
  "word-break",
  "hyphens",
  "quotes",
]);
