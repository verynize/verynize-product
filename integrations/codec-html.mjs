import { pruneImportRules } from "./import-css-prune.mjs";
import { NODE_LIMITS } from "./document-core.mjs";
// HTML + CSS import. A page (string, local file or http(s) URL) is parsed, its stylesheets resolved
// (<style>, <link rel=stylesheet>, @import; local files and http(s) with size/time limits), and the
// cascade computed for a chosen viewport (specificity, !important, @layer, inline styles, @media,
// inheritance, custom properties / var()). Each element's cascaded declarations become Tailwind
// arbitrary-property classes ([padding-top:12px]) — or its own Tailwind utilities when the page uses
// Tailwind — and the resulting JSX goes through the regular codec (createArtboards), so the real
// Tailwind v4 engine, text inheritance and flow layout are shared with the JSX path. :root custom
// properties that the page uses become colour tokens and typed variables with bindings.
//
// HTML exported by Verynize (export-html.mjs lossless mode / export-code.mjs cssCode) carries
// data-vn-node + data-vn-sig per layer: while an element's author declarations still hash to the
// signature, the exact layer is restored; once its CSS was edited, the CSS wins.
import { readFile, stat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parseStylesheet,
  parseDeclarations,
  parseSelectorList,
  matches,
  expand,
  cascade,
  INHERITED,
} from "./codec-css-cascade.mjs";
import {
  splitTop,
  substituteVars,
  cssColorToHex,
  lengthOf,
  MEDIA_DEFAULTS,
  matchMedia,
} from "./codec-css.mjs";
import { compileClass, sortClasses, resolveValue } from "./tailwind-engine.mjs";
import { cssVarForToken } from "./tailwind-map.mjs";
import { decodeEntities, isSafeTag } from "./jsx-codec.mjs";
import { createArtboards } from "./design-edit.mjs";
import { validateDocument, VARIABLE_NAME } from "./design-store.mjs";
import { sniffImageType, imageSize } from "./images.mjs";
import { sanitizeSvg } from "./assets.mjs";
import { RESIDUAL_ATTR } from "./codec-residual.mjs";
import { svgElementJsx } from "./vector-jsx.mjs";

export const IMPORT_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  totalBytes: 12 * 1024 * 1024,
  timeoutMs: 8000,
  maxSheets: 48,
  maxDepth: 8,
  maxElements: NODE_LIMITS.perDocument,
  maxImageBytes: 4 * 1024 * 1024,
});

// ---------------------------------------------------------------------------------------------
// HTML parsing (tolerant, no scripts executed)

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "noscript", "template"]);
const CLOSES_P = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);
const SELF_NEST = {
  li: ["li"],
  dt: ["dt", "dd"],
  dd: ["dt", "dd"],
  tr: ["tr"],
  td: ["td", "th"],
  th: ["td", "th"],
  option: ["option"],
  thead: ["tbody", "tfoot"],
  tbody: ["thead", "tbody"],
  tfoot: ["thead", "tbody"],
};
const MORE_ENTITIES = {
  copy: "©",
  reg: "®",
  trade: "™",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  middot: "·",
  bull: "•",
  times: "×",
  divide: "÷",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  deg: "°",
  plusmn: "±",
  rarr: "→",
  larr: "←",
  uarr: "↑",
  darr: "↓",
  check: "✓",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  zwj: "‍",
  zwnj: "‌",
  sect: "§",
  para: "¶",
  star: "☆",
  hearts: "♥",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  shy: "",
};
const decode = (text) =>
  decodeEntities(
    String(text).replace(
      /&([a-z][a-z0-9]*);/gi,
      (m, name) => MORE_ENTITIES[name.toLowerCase()] ?? m,
    ),
  );

function makeElement(tag, attrs, parent) {
  const el = { tag, attrs, children: [], parent };
  Object.defineProperty(el, "classList", {
    get() {
      return String(this.attrs.class || "")
        .split(/\s+/)
        .filter(Boolean);
    },
  });
  return el;
}

/** Parse HTML into a tree of {tag, attrs, children, parent} elements and {text} nodes. */
export function parseHtml(source) {
  if (String(source).length > 5_000_000)
    throw new Error("HTML parse stage exceeds 5000000 characters");
  const s = String(source || "").replace(/^﻿/, "");
  const root = makeElement("#document", {}, null);
  const stack = [root];
  let elementTotal = 0;
  const top = () => stack[stack.length - 1];
  const close = (tag) => {
    for (let i = stack.length - 1; i > 0; i--)
      if (stack[i].tag === tag) {
        stack.length = i;
        return true;
      }
    return false;
  };
  let i = 0;
  while (i < s.length) {
    if (s[i] === "<") {
      if (s.startsWith("<!--", i)) {
        const end = s.indexOf("-->", i + 4);
        i = end < 0 ? s.length : end + 3;
        continue;
      }
      if (s[i + 1] === "!" || s[i + 1] === "?") {
        const end = s.indexOf(">", i);
        i = end < 0 ? s.length : end + 1;
        continue;
      }
      if (s[i + 1] === "/") {
        const m = /^<\/\s*([a-zA-Z][\w:-]*)\s*[^>]*>/.exec(s.slice(i));
        if (m) {
          const tag = m[1].toLowerCase();
          if (tag === "p" && !stack.some((e) => e.tag === "p"))
            top().children.push(makeElement("p", {}, top()));
          else close(tag);
          i += m[0].length;
          continue;
        }
      }
      const m = /^<([a-zA-Z][\w:-]*)/.exec(s.slice(i));
      if (m) {
        const openingStart = i;
        const tag = m[1].toLowerCase();
        let j = i + m[0].length;
        const attrs = {};
        for (;;) {
          while (j < s.length && /\s/.test(s[j])) j++;
          if (s[j] === ">" || j >= s.length) {
            j++;
            break;
          }
          if (s[j] === "/" && s[j + 1] === ">") {
            j += 2;
            break;
          }
          if (s[j] === "/") {
            j++;
            continue;
          }
          const an = /^[^\s=>/]+/.exec(s.slice(j));
          if (!an) {
            j++;
            continue;
          }
          const name = an[0].toLowerCase();
          j += an[0].length;
          while (j < s.length && /\s/.test(s[j])) j++;
          if (s[j] !== "=") {
            attrs[name] = "";
            continue;
          }
          j++;
          while (j < s.length && /\s/.test(s[j])) j++;
          let value;
          if (s[j] === '"' || s[j] === "'") {
            const q = s[j],
              end = s.indexOf(q, j + 1);
            value = s.slice(j + 1, end < 0 ? s.length : end);
            j = end < 0 ? s.length : end + 1;
          } else {
            const v = /^[^\s>]*/.exec(s.slice(j))[0];
            value = v;
            j += v.length;
          }
          if (!(name in attrs)) attrs[name] = decode(value);
        }
        if (tag === "p" || CLOSES_P.has(tag)) {
          const pIdx = stack.findLastIndex((e) => e.tag === "p");
          if (
            pIdx > 0 &&
            !stack.slice(pIdx + 1).some((e) => ["button", "div", "section"].includes(e.tag))
          )
            stack.length = pIdx;
        }
        if (SELF_NEST[tag]) {
          const blockers = SELF_NEST[tag];
          for (let k = stack.length - 1; k > 0; k--) {
            if (blockers.includes(stack[k].tag)) {
              stack.length = k;
              break;
            }
            if (["ul", "ol", "table", "dl", "select", "div"].includes(stack[k].tag)) break;
          }
        }
        if (++elementTotal > NODE_LIMITS.perDocument + 256)
          throw new Error("HTML parse stage exceeds document element budget");
        const el = makeElement(tag, attrs, top());
        top().children.push(el);
        i = j;
        if (VOID.has(tag)) continue;
        if (RAW.has(tag)) {
          const end = s.toLowerCase().indexOf(`</${tag}`, i);
          const raw = s.slice(i, end < 0 ? s.length : end);
          if (raw)
            el.children.push({
              text: tag === "textarea" || tag === "title" ? decode(raw) : raw,
              raw: true,
            });
          const close = end < 0 ? s.length : s.indexOf(">", end);
          i = close < 0 ? s.length : close + 1;
          continue;
        }
        if (tag === "svg") {
          // Keep inline SVG as markup: it becomes an image layer.
          const end = findSvgEnd(s, i);
          el.svg = s.slice(openingStart, end);
          const close = s.indexOf(">", end);
          i = close < 0 ? s.length : close + 1;
          continue;
        }
        if (stack.length >= 256) throw new Error("HTML parse stage exceeds nesting limit 256");
        stack.push(el);
        continue;
      }
    }
    const next = s.indexOf("<", i + 1);
    const text = s.slice(i, next < 0 ? s.length : next);
    if (text) top().children.push({ text: decode(text) });
    i = next < 0 ? s.length : next;
  }
  // Implied <html> and <body> (fragments and minimal pages), so :root and body rules apply as in a browser.
  let html = root.children.find((c) => c.tag === "html");
  if (!html) {
    html = makeElement("html", {}, root);
    html.children = root.children;
    for (const c of html.children) c.parent = html;
    root.children = [html];
  }
  if (!find(html, "body")) {
    const body = makeElement("body", {}, html);
    const META = new Set([
      "head",
      "title",
      "link",
      "style",
      "meta",
      "base",
      "script",
      "noscript",
      "template",
    ]);
    const keep = [],
      moved = [];
    for (const c of html.children)
      ((c.tag && META.has(c.tag)) || (c.text !== undefined && !c.text.trim() && !moved.length)
        ? keep
        : moved
      ).push(c);
    body.children = moved;
    for (const c of moved) c.parent = body;
    html.children = [...keep, body];
  }
  return root;
}
function findSvgEnd(s, from) {
  let depth = 1,
    i = from;
  const re = /<\/?svg\b[^>]*?(\/?)>/gi;
  re.lastIndex = from;
  for (let m; (m = re.exec(s));) {
    if (m[0][1] === "/") {
      if (--depth === 0) return m.index;
    } else if (!m[1]) depth++;
    i = re.lastIndex;
  }
  return s.length;
}
const elementChildren = (el) => (el.children || []).filter((c) => c.tag);
const find = (el, tag) => {
  if (el.tag === tag) return el;
  for (const c of el.children || [])
    if (c.tag) {
      const f = find(c, tag);
      if (f) return f;
    }
  return null;
};
const all = (el, pred, out = []) => {
  for (const c of el.children || [])
    if (c.tag) {
      if (pred(c)) out.push(c);
      all(c, pred, out);
    }
  return out;
};
const textContent = (el) =>
  (el.children || [])
    .map((c) =>
      c.text !== undefined ? (c.raw ? "" : c.text) : c.tag === "br" ? "\n" : textContent(c),
    )
    .join("");

// ---------------------------------------------------------------------------------------------
// Resource loading (stylesheets, images) with limits

class Loader {
  constructor(opts, warnings) {
    this.opts = opts;
    this.warnings = warnings;
    this.total = 0;
    this.count = 0;
  }
  async load(url, { kind = "stylesheet", maxBytes = this.opts.maxBytes } = {}) {
    const u = url instanceof URL ? url : new URL(url);
    if (u.protocol === "data:") {
      const m = u.href.match(/^data:([^;,]*)(;base64)?,(.*)$/s);
      if (!m) throw new Error("invalid data URL");
      const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
      return { buf, url: u };
    }
    if (++this.count > this.opts.maxSheets * 4) throw new Error("too many external resources");
    let buf;
    if (u.protocol === "file:") {
      if (!this.opts.allowFiles) throw new Error("local files are not allowed for this import");
      const file = await realpath(fileURLToPath(u)).catch(() => fileURLToPath(u));
      const root = this.opts.root
        ? await realpath(this.opts.root).catch(() => this.opts.root)
        : null;
      if (root && path.relative(root, file).startsWith(".."))
        throw new Error(`${kind} ${u.href} is outside the import folder`);
      const info = await stat(file);
      if (!info.isFile()) throw new Error(`${kind} ${u.href} is not a file`);
      if (info.size > maxBytes) throw new Error(`${kind} ${u.href} exceeds ${maxBytes} bytes`);
      buf = await readFile(file);
    } else if (u.protocol === "http:" || u.protocol === "https:") {
      if (!this.opts.allowRemote)
        throw new Error(`remote ${kind} ${u.href} was not fetched (remote loading is off)`);
      const res = await this.opts.fetch(u.href, {
        signal: AbortSignal.timeout(this.opts.timeoutMs),
        redirect: "follow",
        headers: { accept: kind === "stylesheet" ? "text/css,*/*;q=0.1" : "image/*" },
      });
      if (!res.ok) throw new Error(`${kind} ${u.href}: HTTP ${res.status}`);
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes)
        throw new Error(`${kind} ${u.href} exceeds ${maxBytes} bytes`);
      const reader = res.body?.getReader?.();
      if (reader) {
        const chunks = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new Error(`${kind} ${u.href} exceeds ${maxBytes} bytes`);
          }
          chunks.push(Buffer.from(value));
        }
        buf = Buffer.concat(chunks);
      } else buf = Buffer.from(await res.arrayBuffer());
    } else throw new Error(`unsupported URL scheme ${u.protocol}`);
    this.total += buf.length;
    if (this.total > this.opts.totalBytes)
      throw new Error(`external resources exceed ${this.opts.totalBytes} bytes in total`);
    return { buf, url: u };
  }
}

// ---------------------------------------------------------------------------------------------
// User-agent defaults (a compact stand-in for a browser's UA stylesheet)

const UA_CSS = `
html,body,address,blockquote,center,div,figure,figcaption,footer,form,header,hr,legend,listing,main,p,plaintext,pre,xmp,dialog,article,aside,h1,h2,h3,h4,h5,h6,hgroup,nav,section,ul,ol,dl,dd,dt,menu,li,fieldset,details,summary{display:block}
head,script,style,link,meta,title,template,noscript,[hidden]{display:none}
body{margin:8px}
p,blockquote,dl,pre,ul,ol,menu{margin-top:1em;margin-bottom:1em}
figure{margin:1em 40px}
dd{margin-left:40px}
h1{font-size:2em;margin-top:.67em;margin-bottom:.67em;font-weight:bold}
h2{font-size:1.5em;margin-top:.83em;margin-bottom:.83em;font-weight:bold}
h3{font-size:1.17em;margin-top:1em;margin-bottom:1em;font-weight:bold}
h4{font-size:1em;margin-top:1.33em;margin-bottom:1.33em;font-weight:bold}
h5{font-size:.83em;margin-top:1.67em;margin-bottom:1.67em;font-weight:bold}
h6{font-size:.67em;margin-top:2.33em;margin-bottom:2.33em;font-weight:bold}
ul,ol,menu{padding-left:40px}
b,strong{font-weight:bolder}
i,em,cite,var,dfn,address{font-style:italic}
small{font-size:smaller}
code,kbd,samp,pre,tt{font-family:monospace}
a:any-link{color:#0000ee;text-decoration:underline}
u,ins{text-decoration:underline}
s,strike,del{text-decoration:line-through}
hr{border-top:1px solid #808080;margin:.5em auto}
pre{white-space:pre}
button,input,select,textarea{display:inline-block;font-size:13.333px;padding:1px 6px}
button{border:2px outset #767676;background-color:#efefef;text-align:center}
input,textarea,select{border:2px inset #767676;background-color:#ffffff}
table{display:flex;flex-direction:column}
thead,tbody,tfoot{display:flex;flex-direction:column}
tr{display:flex;flex-direction:row}
td,th{display:block;flex:1 1 0%;padding:1px}
th{font-weight:bold;text-align:center}
img,svg,video,canvas,iframe{display:inline-block}
span,a,b,strong,i,em,small,code,label,abbr,sub,sup,mark,u,s,q,cite,time,kbd,var,dfn,bdi,bdo,data,output,font{display:inline}
`;
// Tailwind's preflight (base reset), applied on top of the UA defaults when the page uses Tailwind.
const PREFLIGHT_CSS = `
*{margin:0;padding:0;border:0 solid}
html{line-height:1.5;font-family:ui-sans-serif,system-ui,sans-serif}
h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}
a{color:inherit;text-decoration:inherit}
b,strong{font-weight:bolder}
ol,ul,menu{list-style:none}
img,svg,video,canvas{display:block;max-width:100%}
button,input,select,textarea{font:inherit;color:inherit;background-color:transparent;border-radius:0}
`;
let uaRules = null,
  preflightRules = null;
const BLOCK_DISPLAY = new Set([
  "block",
  "flex",
  "grid",
  "flow-root",
  "list-item",
  "table",
  "inline-block",
  "inline-flex",
  "inline-grid",
]);

// ---------------------------------------------------------------------------------------------
// Values

const FONT_KEYWORDS = {
  "xx-small": 9,
  "x-small": 10,
  small: 13,
  medium: 16,
  large: 18,
  "x-large": 24,
  "xx-large": 32,
  "xxx-large": 48,
};
const r2 = (v) => Math.round(v * 1000) / 1000;
/** Replace relative units with px (em -> element font size, rem -> root, vw/vh -> viewport). */
function absolutize(value, { fs, rootFs, vw, vh }) {
  return String(value).replace(
    /url\([^)]*\)|"[^"]*"|'[^']*'|(-?(?:\d+\.?\d*|\.\d+))(r?em|vw|vh|vmin|vmax|svh|lvh|dvh|svw|lvw|dvw|ch|ex|lh|rlh)\b/gi,
    (m, n, unit) => {
      if (!unit) return m;
      const x = Number(n),
        u = unit.toLowerCase();
      const px =
        u === "em"
          ? x * fs
          : u === "rem"
            ? x * rootFs
            : u === "ch" || u === "ex"
              ? x * fs * 0.5
              : u === "lh"
                ? x * fs * 1.2
                : u === "rlh"
                  ? x * rootFs * 1.2
                  : /w$/.test(u)
                    ? (x * vw) / 100
                    : /h$/.test(u)
                      ? (x * vh) / 100
                      : u === "vmin"
                        ? (x * Math.min(vw, vh)) / 100
                        : (x * Math.max(vw, vh)) / 100;
      return `${r2(px)}px`;
    },
  );
}
function fontSizeOf(value, parentFs, rootFs, view) {
  const v = String(value).trim().toLowerCase();
  if (FONT_KEYWORDS[v]) return FONT_KEYWORDS[v];
  if (v === "smaller") return r2(parentFs / 1.2);
  if (v === "larger") return r2(parentFs * 1.2);
  const abs = absolutize(v, { fs: parentFs, rootFs, vw: view.width, vh: view.height });
  const len = lengthOf(abs, { fontSize: parentFs });
  if (len?.frac !== undefined && !len.px) return r2(len.frac * parentFs);
  if (len?.px !== undefined && len.frac === undefined) return r2(len.px);
  const clamp = abs.match(/^clamp\((.*)\)$/);
  if (clamp) {
    const [lo, mid, hi] = splitTop(clamp[1], ",").map((x) => lengthOf(x)?.px);
    if ([lo, hi].every(Number.isFinite))
      return r2(Math.min(hi, Math.max(lo, Number.isFinite(mid) ? mid : lo)));
  }
  return parentFs;
}
const COLOR_PROPS = new Set([
  "color",
  "background-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "text-decoration-color",
]);
// Declarations the codec represents; anything else is counted and reported once.
const SUPPORTED = new Set([
  "display",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-items",
  "align-self",
  "justify-content",
  "justify-items",
  "row-gap",
  "column-gap",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "aspect-ratio",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "translate",
  "rotate",
  "scale",
  "z-index",
  "overflow-x",
  "overflow-y",
  "opacity",
  "visibility",
  "background-color",
  "background-image",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "box-shadow",
  "mix-blend-mode",
  "outline-width",
  "outline-style",
  "outline-color",
  "outline-offset",
  "filter",
  "backdrop-filter",
  "text-shadow",
  "color",
  "font-size",
  "line-height",
  "font-family",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration-line",
  "text-overflow",
  "white-space",
  "-webkit-line-clamp",
  "text-wrap",
  // Type settings (word break, indent, smoothing).
  "word-break",
  "overflow-wrap",
  "text-indent",
  "-webkit-font-smoothing",
  "object-fit",
  "mask-image",
  "-webkit-mask-image",
]);
const IGNORABLE =
  /^(transition|animation|cursor|pointer-events|user-select|-webkit-user-select|will-change|-webkit-font-smoothing|-moz-osx-font-smoothing|box-sizing|appearance|-webkit-appearance|-moz-appearance|scroll-|touch-action|resize|list-style|font-feature-settings|font-variation-settings|font-variant|text-rendering|-webkit-tap-highlight-color|content|vertical-align|quotes|counter-|text-size-adjust|-webkit-text-size-adjust|-ms-|tab-size|word-break|overflow-wrap|hyphens|text-underline-offset|text-decoration-(?:thickness|style|color)|caret-color|accent-color|isolation|contain|backface-visibility|perspective|transform-origin|transform-style|orphans|widows|speak|unicode-bidi|direction|border-collapse|border-spacing|table-layout|caption-side|empty-cells|align-content|justify-self|order|float|clear|text-indent|word-spacing|-webkit-box-orient|forced-color-adjust|color-scheme|print-color-adjust|-webkit-print-color-adjust|object-position|background-(?:size|position|repeat|clip|origin|attachment)(?:-[xy])?|font-optical-sizing|font-kerning|font-synthesis|text-emphasis|line-break|field-sizing|container|inset-area|anchor-|position-|view-transition|interpolate-size|zoom)/;

// ---------------------------------------------------------------------------------------------

const hash = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
};
/** Signature of a set of author declarations (longhands, last wins, order-independent). */
export function declarationSignature(decls) {
  const map = new Map();
  for (const d of decls)
    for (const x of expand(d))
      map.set(
        x.property,
        `${x.value.trim().replace(/\s+/g, " ").toLowerCase()}${x.important ? "!" : ""}`,
      );
  return hash(
    [...map]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}:${v}`)
      .join(";"),
  );
}
export const styleSignature = (styleText) => declarationSignature(parseDeclarations(styleText));

const toArbitrary = (value) => String(value).replace(/_/g, "\\_").replace(/\s+/g, "_");
const escAttr = (text) =>
  String(text).replace(
    /[&"<>]/g,
    (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c],
  );
const escSingle = (text) =>
  String(text).replace(
    /[&'<>]/g,
    (c) => ({ "&": "&amp;", "'": "&#39;", "<": "&lt;", ">": "&gt;" })[c],
  );
const escText = (text) =>
  String(text).replace(
    /[&<>{}]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "{": "&#123;", "}": "&#125;" })[c],
  );
const TAG_MAP = {
  table: "div",
  thead: "div",
  tbody: "div",
  tfoot: "div",
  tr: "div",
  td: "div",
  th: "div",
  dl: "div",
  dt: "div",
  dd: "div",
  menu: "ul",
  details: "div",
  summary: "div",
  fieldset: "div",
  legend: "div",
  picture: "div",
  center: "div",
  pre: "div",
  body: "div",
  html: "div",
  dialog: "div",
  address: "div",
  hgroup: "div",
  time: "span",
  abbr: "span",
  mark: "span",
  q: "span",
  cite: "span",
  sub: "span",
  sup: "span",
  u: "span",
  s: "span",
  del: "span",
  ins: "span",
  kbd: "code",
  samp: "code",
  var: "em",
  dfn: "em",
  textarea: "div",
  select: "div",
  option: "span",
  video: "div",
  canvas: "div",
  iframe: "div",
  object: "div",
  embed: "div",
};
const SKIP = new Set([
  "head",
  "script",
  "style",
  "link",
  "meta",
  "title",
  "template",
  "noscript",
  "base",
  "source",
  "track",
  "param",
  "map",
  "area",
  "datalist",
  "slot",
  "col",
  "colgroup",
]);
const INLINE_TEXT = new Set([
  "b",
  "strong",
  "i",
  "em",
  "span",
  "a",
  "small",
  "code",
  "br",
  "u",
  "s",
  "mark",
  "sup",
  "sub",
  "label",
  "abbr",
  "cite",
  "q",
  "time",
  "kbd",
  "var",
  "dfn",
  "del",
  "ins",
  "samp",
  "bdi",
  "bdo",
  "data",
  "output",
  "font",
  "tt",
]);

/**
 * Import HTML into a Verynize document.
 * @param {string} html
 * @param {object} options
 *   baseUrl     URL or local path the page came from (resolves <link>, @import, <img>)
 *   root        folder local files must stay inside (default: the page's folder)
 *   allowRemote fetch http(s) stylesheets and images (default false)
 *   allowFiles  read local files (default true when the base is a file)
 *   viewport    {width, height, colorScheme} used for @media and vw/vh (default 1440×900, light)
 *   document, pageId  import into an existing document (default: a new one)
 *   tailwind    pass classes that compile as Tailwind v4 utilities through (default true)
 *   fetch, timeoutMs, maxBytes, totalBytes, maxSheets, maxDepth   resource limits
 * @returns {Promise<{document, pageId, roots, jsx, warnings, stats}>}
 */
export async function importHtml(html, options = {}) {
  const view = { ...MEDIA_DEFAULTS, ...(options.viewport || {}) };
  const warnings = [];
  const stats = {
    elements: 0,
    stylesheets: 0,
    rules: 0,
    skippedRules: 0,
    unsupported: new Map(),
    pseudoElements: 0,
    restored: 0,
    rederived: 0,
    tokens: 0,
    variables: 0,
    bindings: 0,
    tailwindClasses: 0,
  };
  let base = null;
  if (options.baseUrl) {
    const b = String(options.baseUrl);
    base =
      /^[a-z][a-z0-9+.-]*:/i.test(b) && !/^[a-z]:\\/i.test(b)
        ? new URL(b)
        : pathToFileURL(path.resolve(b));
  }
  const fileBase = base?.protocol === "file:";
  const opts = {
    ...IMPORT_LIMITS,
    allowRemote: false,
    allowFiles: fileBase,
    fetch: globalThis.fetch,
    ...options,
  };
  if (opts.root === undefined && fileBase) opts.root = path.dirname(fileURLToPath(base));
  const loader = new Loader(opts, warnings);
  const tree = parseHtml(html);
  const htmlEl = find(tree, "html") || tree;
  const bodyEl = find(htmlEl, "body") || htmlEl;
  const baseTag = find(htmlEl, "base");
  if (baseTag?.attrs.href) {
    try {
      base = new URL(baseTag.attrs.href, base || undefined);
    } catch {
      /* ignore */
    }
  }
  const resolveUrl = (ref) => {
    try {
      return new URL(ref, base || undefined);
    } catch {
      return null;
    }
  };

  // Verynize export metadata (variables, page settings) when present.
  const metaEl = all(htmlEl, (e) => e.tag === "script" && e.attrs.id === "verynize-meta")[0];
  let meta = null;
  if (metaEl) {
    try {
      meta = JSON.parse(
        textContent({ children: metaEl.children.map((c) => ({ ...c, raw: false })) }),
      );
    } catch {
      warnings.push("verynize-meta could not be read");
    }
  }

  // --- stylesheets
  const sheets = [];
  const layerOrder = [];
  const noteLayer = (name) => {
    if (name !== null && name !== undefined && !layerOrder.includes(name)) layerOrder.push(name);
  };
  const addSheet = async (text, url, ctx, depth) => {
    if (sheets.length >= opts.maxSheets) {
      warnings.push(`More than ${opts.maxSheets} stylesheets; the rest were skipped`);
      return;
    }
    const parsed = parseStylesheet(text, { media: ctx.media, layer: ctx.layer });
    parsed.layers.forEach(noteLayer);
    const imports = parsed.items.filter((it) => it.type === "import");
    for (const imp of imports) {
      if (depth >= opts.maxDepth) {
        warnings.push(
          `@import nesting deeper than ${opts.maxDepth} at ${url?.href || "inline style"}`,
        );
        continue;
      }
      const target = (() => {
        try {
          return new URL(imp.url, url || base || undefined);
        } catch {
          return null;
        }
      })();
      if (!target) {
        warnings.push(`@import ${imp.url} could not be resolved (no base URL)`);
        continue;
      }
      if (imp.media && !matchMedia(imp.media, view)) continue;
      const layer =
        imp.layer === null
          ? imp.ctx.layer
          : imp.layer === ""
            ? `anonymous-import-${layerOrder.length}`
            : imp.layer;
      noteLayer(layer);
      try {
        const { buf } = await loader.load(target);
        await addSheet(
          buf.toString("utf8"),
          target,
          { media: [...imp.ctx.media, ...(imp.media ? [imp.media] : [])], layer },
          depth + 1,
        );
      } catch (error) {
        warnings.push(`@import ${target.href}: ${error.message}`);
      }
    }
    for (const item of parsed.items) if (item.ctx.layer) noteLayer(item.ctx.layer);
    sheets.push({ items: parsed.items.filter((it) => it.type !== "import"), url });
    stats.stylesheets++;
  };
  let tailwindPage = false;
  for (const el of all(
    htmlEl,
    (e) => e.tag === "style" || e.tag === "link" || e.tag === "script",
  )) {
    if (el.tag === "script") {
      if (/cdn\.tailwindcss\.com|@tailwindcss\/browser/.test(el.attrs.src || ""))
        tailwindPage = true;
      continue;
    }
    if (el.tag === "style") {
      if (/tailwindcss/i.test(el.attrs.type || "")) {
        tailwindPage = true;
        continue;
      }
      if (el.attrs.type && !/css/i.test(el.attrs.type)) continue;
      if (el.attrs.media && !matchMedia(el.attrs.media, view)) continue;
      await addSheet(
        textContent({ children: el.children.map((c) => ({ ...c, raw: false })) }),
        base,
        { media: [], layer: null },
        0,
      );
      continue;
    }
    const rel = String(el.attrs.rel || "")
      .toLowerCase()
      .split(/\s+/);
    if (
      !rel.includes("stylesheet") ||
      rel.includes("alternate") ||
      el.attrs.disabled !== undefined ||
      !el.attrs.href
    )
      continue;
    if (el.attrs.media && !matchMedia(el.attrs.media, view)) continue;
    const target = resolveUrl(el.attrs.href);
    if (!target) {
      warnings.push(`<link href="${el.attrs.href}"> could not be resolved (no base URL)`);
      continue;
    }
    try {
      const { buf } = await loader.load(target);
      await addSheet(buf.toString("utf8"), target, { media: [], layer: null }, 0);
    } catch (error) {
      warnings.push(`Stylesheet ${target.href}: ${error.message}`);
    }
  }

  // A page without its own stylesheets whose classes are mostly Tailwind utilities was built with
  // Tailwind (the build step or CDN tag may be missing from a saved copy): apply preflight too.
  if (!tailwindPage && !sheets.length && opts.tailwind !== false) {
    const classes = all(htmlEl, (e) => !!e.attrs.class).flatMap((e) => e.classList);
    const known = classes.filter((cls) => compileClass(cls).kind !== "invalid").length;
    if (classes.length >= 10 && known / classes.length >= 0.6) tailwindPage = true;
  }

  const expandImport = (declaration) => {
    if (declaration.property === "border-radius" && declaration.value.includes("/"))
      warnings.push("elliptical border radius is approximated by horizontal radii");
    return expand(declaration);
  };
  // --- rules (media evaluated once for the viewport)
  let rules = [];
  const referenced = new Set();
  let order = 0;
  const layerRank = (name) =>
    name === null || name === undefined ? null : layerOrder.indexOf(name);
  for (const sheet of sheets)
    for (const item of sheet.items) {
      if (item.type !== "rule") continue;
      if (!item.ctx.media.every((q) => matchMedia(q, view))) {
        stats.skippedRules++;
        continue;
      }
      for (const m of item.selector.matchAll(/\.((?:\\.|[\w-])+)/g))
        referenced.add(m[1].replace(/\\(.)/g, "$1"));
      const selectors = parseSelectorList(item.selector);
      const decls = item.decls.flatMap(expandImport);
      rules.push({
        selectors,
        decls,
        layer: layerRank(item.ctx.layer),
        order: order++,
        sheetUrl: sheet.url,
      });
      stats.rules++;
    }
  const beforePruning = rules.length;
  if (options.pruneCss !== false)
    rules = pruneImportRules(rules, [htmlEl, ...all(htmlEl, () => true)]);
  stats.prunedRules = beforePruning - rules.length;
  if (!preflightRules)
    preflightRules = parseStylesheet(PREFLIGHT_CSS)
      .items.filter((it) => it.type === "rule")
      .map((it, i) => ({
        selectors: parseSelectorList(it.selector),
        decls: it.decls.flatMap(expand),
        order: i,
      }));
  if (!uaRules)
    uaRules = parseStylesheet(UA_CSS)
      .items.filter((it) => it.type === "rule")
      .map((it, i) => ({
        selectors: parseSelectorList(it.selector),
        decls: it.decls.flatMap(expand),
        order: i,
      }));

  // --- Tailwind classes passed through (not referenced by the page's own CSS), in Tailwind's order.
  const twCache = new WeakMap();
  const twOf = (el) => {
    if (twCache.has(el)) return twCache.get(el);
    const out = [];
    if (opts.tailwind !== false) {
      const candidates = el.classList.filter((cls) => !referenced.has(cls));
      const rank = new Map(
        (candidates.length ? sortClasses(candidates) : []).map((cls, i) => [cls, i]),
      );
      for (const cls of candidates) {
        const compiled = compileClass(cls);
        // Child-selector utilities (divide-*) style the children; space-* stays on the parent (the codec reads it as a gap).
        if (compiled.kind === "ok")
          out.push({
            cls,
            rank: rank.get(cls),
            decls: compiled.decls.flatMap(expandImport),
            children:
              compiled.childDecls.length && !/^-?space-[xy]-/.test(cls)
                ? compiled.childDecls.flatMap(expand)
                : null,
          });
        else if (compiled.kind === "variant" && (tailwindPage || compiled.plain)) {
          const applies =
            compiled.plain &&
            compiled.media.length > 0 &&
            compiled.media.every((q) => matchMedia(q, view));
          out.push({
            cls,
            rank: rank.get(cls),
            decls: applies ? compiled.decls.flatMap(expandImport) : [],
          });
        }
      }
    }
    twCache.set(el, out);
    return out;
  };

  // --- per-element cascade
  const rootStyle = {
    custom: new Map(),
    color: "#000000",
    fs: 16,
    lineHeight: "normal",
    whiteSpace: "normal",
  };
  const computedOf = new Map();
  const usedVars = new Map(); // name -> {type, value}
  const rootFsBox = { value: 16 };
  const cascadeDeadline = performance.now() + 60_000;
  const computeElement = (el, parent) => {
    if (performance.now() > cascadeDeadline)
      throw new Error(
        "HTML cascade exceeds 60000ms budget; simplify the stylesheet or import fewer boards",
      );
    const entries = [];
    const sigEntries = [];
    for (const rule of uaRules)
      for (const sel of rule.selectors)
        if (sel && matches(el, sel)) {
          for (const d of rule.decls)
            entries.push({ ...d, origin: "ua", spec: sel.spec, order: rule.order });
          break;
        }
    // Preflight lives in Tailwind's base layer: author origin, below utilities and page CSS.
    if (tailwindPage)
      for (const rule of preflightRules)
        for (const sel of rule.selectors)
          if (sel && matches(el, sel)) {
            for (const d of rule.decls)
              entries.push({
                ...d,
                origin: "author",
                preflight: true,
                spec: sel.spec,
                order: 1e5 + rule.order,
                layerRank: -2,
              });
            break;
          }
    for (const rule of rules) {
      let best = null;
      for (const sel of rule.selectors)
        if (
          sel &&
          matches(el, sel) &&
          (!best ||
            sel.spec[0] * 1e6 + sel.spec[1] * 1e3 + sel.spec[2] >
              best[0] * 1e6 + best[1] * 1e3 + best[2])
        )
          best = sel.spec;
      if (!best) {
        if (rule.selectors.some((sel) => sel?.pseudoElement && matchesIgnoringPseudo(el, sel)))
          stats.pseudoElements++;
        continue;
      }
      for (const d of rule.decls) {
        const entry = {
          ...d,
          origin: "author",
          spec: best,
          order: 1e6 + rule.order,
          layerRank: rule.layer ?? undefined,
          sheetUrl: rule.sheetUrl,
        };
        entries.push(entry);
        if (best.some(Boolean)) sigEntries.push(entry);
      }
    }
    // Tailwind utilities on the element: author origin in the lowest layer (Tailwind's @layer utilities).
    if (el.parent?.tag && elementChildren(el.parent).at(-1) !== el)
      for (const t of twOf(el.parent))
        if (t.children)
          for (const d of t.children)
            entries.push({
              ...d,
              value: resolveValue(d.value) ?? d.value,
              origin: "author",
              tw: false,
              spec: [0, 1, 0],
              order: 4e5 + (t.rank ?? 0),
              layerRank: -1,
            });
    for (const t of twOf(el))
      for (const d of t.decls)
        entries.push({
          ...d,
          value: resolveValue(d.value) ?? d.value,
          origin: "author",
          tw: true,
          spec: [0, 1, 0],
          order: 5e5 + (t.rank ?? 0),
          layerRank: -1,
        });
    if (el.attrs.style)
      for (const [i, d] of parseDeclarations(el.attrs.style).flatMap(expandImport).entries()) {
        const entry = { ...d, origin: "inline", spec: [1, 0, 0], order: 2e6 + i };
        entries.push(entry);
        sigEntries.push(entry);
      }
    const winners = cascade(entries, layerOrder.length);
    const sigWinners = cascade(sigEntries, layerOrder.length);
    const ps = parent || rootStyle;
    const custom = new Map(ps.custom);
    // Custom properties: inherited, var() inside them resolved at the declaring element.
    const own = [...winners].filter(([p]) => p.startsWith("--"));
    const rawCustom = new Map(own.map(([p, d]) => [p, d.value]));
    const resolving = new Set();
    const resolveCustom = (name) => {
      if (rawCustom.has(name)) {
        if (resolving.has(name)) return null;
        resolving.add(name);
        const v = substituteVars(rawCustom.get(name), (n) =>
          n === name ? undefined : resolveCustom(n),
        );
        resolving.delete(name);
        rawCustom.delete(name);
        if (v === null) custom.delete(name);
        else custom.set(name, v);
      }
      return custom.get(name);
    };
    for (const [p] of own) resolveCustom(p);
    const isRoot = el.tag === "html";
    const tokenRefs = new Map(); // property -> var name kept as a token reference
    const bindingRefs = new Map(); // property -> var name for typed variables
    const valueOf = (property, raw) => {
      const v = raw.trim();
      const whole = v.match(/^var\(\s*(--[\w-]+)\s*(?:,[\s\S]*)?\)$/);
      if (
        whole &&
        rootVarsSnapshot.has(whole[1]) &&
        custom.get(whole[1]) === rootVarsSnapshot.get(whole[1])
      ) {
        if (COLOR_PROPS.has(property)) tokenRefs.set(property, whole[1]);
        else bindingRefs.set(property, whole[1]);
      }
      return substituteVars(v, (n) => custom.get(n));
    };
    const style = new Map(),
      urlBases = new Map(),
      origins = new Map();
    let color = ps.color,
      fs = ps.fs;
    const get = (p) => winners.get(p);
    const keyword = (p, d) => {
      const k = d.value.trim().toLowerCase();
      if (k === "inherit" || (k === "unset" && INHERITED.has(p))) return { inherit: true };
      if (k === "initial" || k === "unset" || k === "revert" || k === "revert-layer")
        return { drop: true };
      return null;
    };
    // Font size first (em units of every other property depend on it).
    const fsDecl = get("font-size");
    if (fsDecl) {
      const kw = keyword("font-size", fsDecl);
      if (kw?.drop) fs = 16;
      else if (!kw) {
        const v = valueOf("font-size", fsDecl.value);
        if (v !== null) fs = fontSizeOf(v, ps.fs, rootFsBox.value, view);
      }
      if (!kw?.inherit) {
        style.set("font-size", `${fs}px`);
        origins.set("font-size", fsDecl.tw ? "tw" : fsDecl.origin);
      }
    }
    if (isRoot) rootFsBox.value = fs;
    const units = { fs, rootFs: rootFsBox.value, vw: view.width, vh: view.height };
    for (const [property, d] of winners) {
      if (property.startsWith("--") || property === "font-size") continue;
      const kw = keyword(property, d);
      if (kw?.drop) continue;
      if (kw?.inherit) {
        if (INHERITED.has(property)) continue; // inherits through the codec's text inheritance
        const inherited = computedOf.get(el.parent)?.style.get(property);
        if (inherited !== undefined) style.set(property, inherited);
        continue;
      }
      let value = valueOf(property, d.value);
      if (value === null) {
        warnings.push(
          `<${el.tag}>: ${property} uses an undefined custom property (${d.value.trim().slice(0, 60)})`,
        );
        continue;
      }
      if (property === "line-height" && /%$/.test(value.trim()))
        value = `${r2((parseFloat(value) / 100) * fs)}px`;
      value = absolutize(value, units);
      if (/currentcolor/i.test(value) && property !== "color")
        value = value.replace(/currentcolor/gi, color);
      if (property === "color") {
        const hex = cssColorToHex(value);
        if (hex) color = hex;
        else if (/currentcolor/i.test(value)) continue;
      }
      style.set(property, value);
      if (d.sheetUrl) urlBases.set(property, d.sheetUrl);
      origins.set(property, d.tw ? "tw" : d.preflight ? "preflight" : d.origin);
      if (d.important && d.origin !== "ua") style.set(`!${property}`, true);
    }
    const ws = style.get("white-space") ?? ps.whiteSpace;
    const display = String(style.get("display") || "inline").trim();
    const info = {
      style,
      urlBases,
      origins,
      custom,
      color,
      fs,
      whiteSpace: ws,
      display,
      tokenRefs,
      bindingRefs,
      sig: sigEntries.length ? [...sigWinners].map(([, d]) => d) : [],
    };
    computedOf.set(el, info);
    return info;
  };
  // :root custom properties (computed at <html>) are the token / variable candidates.
  let rootVarsSnapshot = new Map();
  const htmlInfo = computeElement(htmlEl, null);
  rootVarsSnapshot = new Map(htmlInfo.custom);
  computedOf.delete(htmlEl);
  const htmlComputed = computeElement(htmlEl, null);

  // --- JSX generation
  const lines = [];
  const doc = options.document ? structuredClone(options.document) : null;
  const tokens = { ...(meta?.tokens || {}), ...(doc?.tokens || {}) };
  const variables = { ...(meta?.variables || {}), ...(doc?.variables || {}) };
  const tokenName = (varName) => {
    const name = varName.slice(2);
    if (meta?.tokens) {
      const hit = Object.keys(meta.tokens).find((k) => cssVarForToken(k) === varName);
      if (hit) return hit;
    }
    return VARIABLE_NAME.test(name) ? name : null;
  };
  const useToken = (varName) => {
    const name = tokenName(varName);
    if (!name || variables[name]) return null;
    const hex = cssColorToHex(rootVarsSnapshot.get(varName) || "");
    if (!hex || hex === "transparent") return null;
    if (tokens[name] && tokens[name] !== hex && !meta?.tokens?.[name]) return null;
    if (!tokens[name]) {
      tokens[name] = hex;
      stats.tokens++;
    }
    return name;
  };
  const elementCount = { n: 0 };
  const imageCache = new Map();
  const embedImage = async (url, kind) => {
    if (imageCache.has(url.href)) return imageCache.get(url.href);
    let result = null;
    try {
      const { buf } = await loader.load(url, { kind, maxBytes: opts.maxImageBytes });
      let type = sniffImageType(buf);
      let data = buf;
      if (type === "image/svg+xml") {
        const clean = sanitizeSvg(buf.toString("utf8"));
        data = clean ? Buffer.from(clean) : null;
      }
      if (type && data)
        result = {
          src: `data:${type};base64,${data.toString("base64")}`,
          size: imageSize(data, type),
        };
      else warnings.push(`${kind} ${url.href} is not a supported image`);
    } catch (error) {
      warnings.push(`${kind} ${url.href}: ${error.message}`);
    }
    imageCache.set(url.href, result);
    return result;
  };

  const classesFor = async (el, info, { text = false } = {}) => {
    const out = [];
    const tw = twOf(el)
        .filter((t) => !t.children)
        .map((t) => t.cls),
      twProps = new Set(twOf(el).flatMap((t) => t.decls.map((d) => d.property)));
    stats.tailwindClasses += tw.length;
    const fills = [];
    for (const [property, value] of info.style) {
      if (property.startsWith("!")) continue;
      if (!SUPPORTED.has(property)) {
        if (!IGNORABLE.test(property))
          stats.unsupported.set(property, (stats.unsupported.get(property) || 0) + 1);
        continue;
      }
      let v = value;
      // Tailwind utilities (author origin, @layer utilities) beat UA defaults and lose to unlayered author CSS.
      const origin = info.origins?.get(property);
      if (
        (origin === "tw" || (origin === "ua" && twProps.has(property))) &&
        !(property === "background-image" && /url\(/i.test(v))
      )
        continue;
      // Preflight resets that equal the canvas defaults add nothing.
      if (
        origin === "preflight" &&
        (/^border-\w+-(style|color)$/.test(property) || /^0(px)?$/.test(String(v).trim()))
      )
        continue;
      if (property === "display") {
        if (v === "contents") continue;
        if (text && !/flex|grid/.test(v)) continue;
        if (v === "list-item" || v === "table" || v === "flow-root") v = "block";
        if (/^table-/.test(v)) v = "block";
        if (text && (v === "inline" || v === "inline-block")) continue;
      }
      if (property === "background-image" && /url\(/i.test(v)) {
        for (const p of ["background-position", "background-repeat"])
          if (
            info.style.has(p) &&
            !(
              (p === "background-position" && /^(center|50% 50%)$/.test(info.style.get(p))) ||
              (p === "background-repeat" && info.style.get(p) === "no-repeat")
            )
          )
            warnings.push(
              `${p}:${info.style.get(p)} is approximated by a centered cover/contain image fill`,
            );
        const urls = [...v.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)];
        for (const [, , ref] of urls) {
          const target = (() => {
            try {
              return new URL(ref, info.urlBases?.get(property) || base || undefined);
            } catch {
              return null;
            }
          })();
          const image = target && (await embedImage(target, "Background image"));
          if (image)
            fills.push({
              type: "image",
              src: image.src,
              fit: /cover/.test(info.style.get("background-size") || "")
                ? "cover"
                : /contain/.test(info.style.get("background-size") || "")
                  ? "contain"
                  : info.style.get("background-size") === "100% 100%"
                    ? "fill"
                    : info.style.get("background-size") === "auto"
                      ? "none"
                      : "cover",
            });
        }
        v =
          splitTop(v, ",")
            .filter((layer) => !/url\(/i.test(layer))
            .join(", ") || "none";
        if (v === "none") continue;
      }
      if (/url\(/i.test(v)) continue;
      const token = info.tokenRefs.get(property);
      if (token) {
        const name = useToken(token);
        if (name) v = `var(${cssVarForToken(name)})`;
      }
      out.push(
        `[${property}:${toArbitrary(v)}]${origin !== "ua" && twProps.has(property) ? "!" : ""}`,
      );
    }
    return {
      classes: [
        ...tw.filter(
          (cls) => !/\[background(?:-image)?:.*url\(/i.test(cls) && !/^bg-\[url\(/i.test(cls),
        ),
        ...out,
      ],
      fills,
    };
  };

  const bindingsFor = (info, { text = false } = {}) => {
    const refs = info.bindingRefs;
    if (!refs.size) return null;
    const bindings = {};
    const typeOf = (name, kind) => {
      const raw = rootVarsSnapshot.get(name);
      if (raw === undefined) return null;
      const varName = tokenName(name);
      if (!varName || tokens[varName]) return null;
      if (kind === "fontFamily") return { name: varName, type: "fontFamily", value: raw.trim() };
      if (kind === "fontWeight") {
        const w = { normal: "400", bold: "700" }[raw.trim()] || raw.trim();
        return /^[1-9]\d{0,2}$/.test(w) ? { name: varName, type: "fontWeight", value: w } : null;
      }
      const len = lengthOf(
        absolutize(raw.trim(), {
          fs: 16,
          rootFs: rootFsBox.value,
          vw: view.width,
          vh: view.height,
        }),
      );
      if (kind === "number")
        return len?.n !== undefined && len.px === undefined
          ? { name: varName, type: "number", value: len.n }
          : len?.px !== undefined
            ? { name: varName, type: "dimension", value: len.px }
            : null;
      return len?.px !== undefined && len.frac === undefined
        ? { name: varName, type: "dimension", value: r2(len.px) }
        : null;
    };
    const bind = (key, name, kind) => {
      const v = typeOf(name, kind);
      if (!v) return;
      const existing = variables[v.name];
      if (existing && (existing.type !== v.type || existing.value !== v.value)) return;
      if (!existing) {
        variables[v.name] = { type: v.type, value: v.value };
        stats.variables++;
      }
      bindings[key] = v.name;
      stats.bindings++;
    };
    const same = (props) => {
      const names = props.map((p) => refs.get(p));
      return names[0] && names.every((n) => n === names[0]) ? names[0] : null;
    };
    const pad = same(["padding-top", "padding-right", "padding-bottom", "padding-left"]);
    if (pad) bind("padding", pad, "dimension");
    else {
      const x = same(["padding-left", "padding-right"]),
        y = same(["padding-top", "padding-bottom"]);
      if (x) bind("paddingX", x, "dimension");
      if (y) bind("paddingY", y, "dimension");
    }
    const gap = same(["row-gap", "column-gap"]);
    if (gap) bind("gap", gap, "dimension");
    const radius = same([
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-right-radius",
      "border-bottom-left-radius",
    ]);
    if (radius) bind("radius", radius, "dimension");
    else
      [
        ["border-top-left-radius", "radiusTopLeft"],
        ["border-top-right-radius", "radiusTopRight"],
        ["border-bottom-right-radius", "radiusBottomRight"],
        ["border-bottom-left-radius", "radiusBottomLeft"],
      ].forEach(([p, k]) => {
        if (refs.get(p)) bind(k, refs.get(p), "dimension");
      });
    const stroke = same([
      "border-top-width",
      "border-right-width",
      "border-bottom-width",
      "border-left-width",
    ]);
    if (stroke) bind("strokeWidth", stroke, "dimension");
    // Text bindings only on layers that become text (frames carry inherited text styles without bindings).
    if (text)
      for (const [p, k, kind] of [
        ["font-size", "fontSize", "dimension"],
        ["letter-spacing", "letterSpacing", "dimension"],
        ["line-height", "lineHeight", "number"],
        ["font-family", "fontFamily", "fontFamily"],
        ["font-weight", "fontWeight", "fontWeight"],
      ])
        if (refs.get(p)) bind(k, refs.get(p), kind);
    for (const [p, k, kind] of [
      ["width", "w", "dimension"],
      ["height", "h", "dimension"],
      ["min-width", "minW", "dimension"],
      ["max-width", "maxW", "dimension"],
      ["min-height", "minH", "dimension"],
      ["max-height", "maxH", "dimension"],
    ])
      if (refs.get(p)) bind(k, refs.get(p), kind);
    return Object.keys(bindings).length ? bindings : null;
  };

  const label = (el) => {
    const aria = el.attrs["aria-label"] || el.attrs.title || el.attrs.alt;
    if (el.attrs["data-name"]) return el.attrs["data-name"];
    if (aria) return aria.slice(0, 80);
    const tag = el.tag === "body" ? "Body" : el.tag;
    return el.attrs.id
      ? `${tag}#${el.attrs.id}`
      : el.classList[0] && !compileClass(el.classList[0]).kind.match(/ok|variant/)
        ? `${tag}.${el.classList[0]}`
        : tag[0].toUpperCase() + tag.slice(1);
  };

  // Inline content of a text element as JSX (whitespace collapsed like CSS white-space: normal).
  const inlineJsx = async (el, info) => {
    const parts = [];
    const pre = /^pre/.test(info.whiteSpace);
    const visit = async (node, parentInfo) => {
      if (node.text !== undefined) {
        if (!node.raw) parts.push({ text: node.text, pre: /^pre/.test(parentInfo.whiteSpace) });
        return;
      }
      if (SKIP.has(node.tag)) return;
      if (node.tag === "br") {
        parts.push({ br: true });
        return;
      }
      const ci = computeElement(node, parentInfo);
      if (ci.display === "none") return;
      const tag =
        INLINE_TEXT.has(node.tag) && isSafeTag(node.tag)
          ? node.tag
          : node.tag === "b" || node.tag === "i"
            ? node.tag
            : "span";
      const { classes } = await classesFor(node, ci, { text: true });
      parts.push({
        open: `<${tag}${classes.length ? ` className="${escAttr(classes.join(" "))}"` : ""}>`,
        tag,
      });
      for (const c of node.children || []) await visit(c, ci);
      parts.push({ close: `</${tag}>` });
    };
    for (const c of el.children || []) await visit(c, info);
    // Collapse whitespace across inline boundaries.
    let out = "",
      pendingSpace = false,
      started = false;
    for (const p of parts) {
      if (p.text !== undefined) {
        if (p.pre || pre) {
          out += (pendingSpace ? " " : "") + escText(p.text).replace(/\n/g, "<br />");
          pendingSpace = false;
          started = true;
          continue;
        }
        const collapsed = p.text.replace(/[ \t\r\n\f]+/g, " ");
        for (const piece of collapsed.split(/( )/)) {
          if (piece === " ") {
            if (started) pendingSpace = true;
            continue;
          }
          if (!piece) continue;
          out += (pendingSpace ? " " : "") + escText(piece);
          pendingSpace = false;
          started = true;
        }
      } else if (p.br) {
        out += "<br />";
        pendingSpace = false;
        started = false;
      } else if (p.open) {
        if (pendingSpace) {
          out += " ";
          pendingSpace = false;
        }
        out += p.open;
      } else out += p.close;
    }
    return out.replace(/<span>(\s*)<\/span>/g, "$1");
  };
  const isInlineText = (node, parentInfo) => {
    if (node.text !== undefined) return true;
    if (!INLINE_TEXT.has(node.tag)) return false;
    const ci = computeElement(node, parentInfo);
    if (!/^inline$/.test(ci.display)) return false;
    return (node.children || []).every((c) => isInlineText(c, ci));
  };
  const hasText = (node) =>
    node.text !== undefined
      ? !node.raw && node.text.trim().length > 0
      : (node.children || []).some(hasText) || node.tag === "br";

  const emit = async (
    el,
    parentInfo,
    indent,
    { root = false, artboardAttrs = "", artboard = false } = {},
  ) => {
    if (++elementCount.n > opts.maxElements) {
      if (elementCount.n === opts.maxElements + 1) {
        if (!options.allowPartial)
          throw new Error(
            `HTML parse stage exceeds ${opts.maxElements} elements; no import committed`,
          );
        warnings.push(`More than ${opts.maxElements} elements; the rest were skipped`);
      }
      return;
    }
    if (SKIP.has(el.tag)) return;
    const info = computedOf.get(el) && root ? computedOf.get(el) : computeElement(el, parentInfo);
    // display:none from the UA (head, script…) is skipped; hidden by the page's CSS becomes a hidden layer.
    if (
      info.display === "none" &&
      !root &&
      el.attrs["data-vn-node"] === undefined &&
      info.origins.get("display") === "ua"
    )
      return;
    if (artboard) {
      // A fragment root is an artboard: an absolute px position becomes its canvas position.
      const px = (p) => {
        const m = /^(-?[\d.]+)px$/.exec(String(info.style.get(p) || "").trim());
        return m ? Number(m[1]) : null;
      };
      const x = px("left"),
        y = px("top");
      if (
        /absolute|fixed/.test(info.style.get("position") || "") &&
        x !== null &&
        y !== null &&
        options.x === undefined
      )
        artboardAttrs = ` data-component-x="${x}" data-component-y="${y}"`;
      else if (options.x !== undefined)
        artboardAttrs = ` data-component-x="${Number(options.x) || 0}" data-component-y="${Number(options.y) || 0}"`;
      for (const p of [
        "position",
        "top",
        "right",
        "bottom",
        "left",
        "margin-top",
        "margin-right",
        "margin-bottom",
        "margin-left",
      ])
        info.style.delete(p);
    }
    if (info.display === "contents") {
      for (const c of el.children || []) {
        if (c.tag) await emit(c, info, indent);
        else if (c.text?.trim()) {
          const span = makeElement("span", {}, el);
          span.children = [c];
          await emit(span, info, indent);
        }
      }
      return;
    }
    stats.elements++;
    // Verynize export: restore the exact layer while its declarations are unchanged.
    if (el.attrs["data-vn-node"] !== undefined) {
      let stored = null;
      try {
        stored = JSON.parse(el.attrs["data-vn-node"]);
      } catch {
        warnings.push(`<${el.tag}> has an unreadable data-vn-node`);
      }
      const sig = declarationSignature(
        info.sig.map((d) => ({ property: d.property, value: d.value, important: d.important })),
      );
      const textOk =
        !stored ||
        stored.type !== "text" ||
        textContent(el).replace(/\s+/g, " ").trim() ===
          String(stored.text || "")
            .replace(/\s+/g, " ")
            .trim();
      if (stored && typeof stored === "object" && sig === el.attrs["data-vn-sig"] && textOk) {
        stats.restored++;
        const type = ["frame", "rectangle", "text", "image", "shader"].includes(stored.type)
          ? stored.type
          : "frame";
        const pos = root
          ? ` data-component-x="${Number(stored.x) || 0}" data-component-y="${Number(stored.y) || 0}"`
          : "";
        const open = `${indent}<div data-node-type="${type}" data-node-label="${escAttr(
          String(stored.name || "")
            .trim()
            .slice(0, 200) || type,
        )}"${pos} ${RESIDUAL_ATTR}='${escSingle(JSON.stringify({ node: stored }))}'`;
        if (type === "text") {
          lines.push(`${open}>${escText(String(stored.text || " ").split("\n")[0] || " ")}</div>`);
          return;
        }
        if (type !== "frame") {
          lines.push(`${open} />`);
          return;
        }
        const kids = (el.children || []).filter(
          (c) => c.tag && c.attrs["data-vn-node"] !== undefined,
        );
        if (!kids.length) {
          lines.push(`${open}></div>`);
          return;
        }
        lines.push(`${open}>`);
        for (const c of kids) await emit(c, info, indent + "  ");
        lines.push(`${indent}</div>`);
        return;
      }
      if (stored) stats.rederived++;
    }
    const designType = el.attrs["data-design-type"];
    let residual = null;
    const name =
      artboard &&
      options.placement === "auto" &&
      !el.attrs["data-name"] &&
      !el.attrs.id &&
      !el.attrs["aria-label"] &&
      label(el) === el.tag[0].toUpperCase() + el.tag.slice(1)
        ? options.name || options.fallbackName || "Imported page"
        : label(el);
    let tag =
      el.tag === "svg"
        ? "img"
        : TAG_MAP[el.tag] || (isSafeTag(el.tag) || el.tag === "img" ? el.tag : "div");
    const setBindings = (text) => {
      const bindings = bindingsFor(info, { text });
      residual = bindings ? { bindings } : null;
    };
    setBindings(false);
    const common = (classes, extra = "") =>
      `${extra}${classes.length ? ` className="${escAttr(classes.join(" "))}"` : ""}${residual ? ` ${RESIDUAL_ATTR}='${escSingle(JSON.stringify(residual))}'` : ""}`;
    // Images: <img>, inline <svg>
    if (el.tag === "img" || el.tag === "svg" || (el.tag === "input" && el.attrs.type === "image")) {
      const { classes, fills } = await classesFor(el, info);
      let src = "",
        assetError = "",
        size = null,
        vectorMarkup = "";
      if (el.tag === "svg") {
        const markup = (el.svg || "").replace(/currentColor/g, info.color);
        const withNs = /xmlns=/.test(markup.slice(0, 200))
          ? markup
          : markup.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        const clean = sanitizeSvg(`${withNs}</svg>`);
        if (!clean) warnings.push("Inline SVG was rejected by the sanitizer");
        vectorMarkup = clean;
        if (clean) {
          const buf = Buffer.from(clean);
          src = `data:image/svg+xml;base64,${buf.toString("base64")}`;
          size = imageSize(buf, "image/svg+xml");
        }
      } else {
        const ref = el.attrs.src || el.attrs["data-src"] || "";
        if (/^data:image\//i.test(ref)) src = ref;
        else if (ref) {
          const target = resolveUrl(ref);
          if (
            target?.protocol === "file:" ||
            target?.protocol === "data:" ||
            (options.allowRemote && /^https?:$/.test(target?.protocol))
          ) {
            const image = await embedImage(target, "Image");
            if (image) {
              src = image.src;
              size = image.size;
            } else assetError = warnings.at(-1) || `Image ${target.href} unavailable`;
          } else if (target) {
            src = target.href;
            warnings.push(
              `Image pending: ${target.href} (remote fetching requires asset resolution)`,
            );
          } else {
            assetError = `Unresolved relative image: ${ref} (no base URL)`;
            warnings.push(assetError);
          }
        }
      }
      const sized = [];
      const w = Number(el.attrs.width),
        h = Number(el.attrs.height);
      if (!info.style.has("width")) {
        if (w > 0) sized.push(`[width:${w}px]`);
        else if (size?.width && !(h > 0)) sized.push(`[width:${size.width}px]`);
      }
      if (!info.style.has("height")) {
        if (h > 0) sized.push(`[height:${h}px]`);
        else if (size?.height && !(w > 0)) sized.push(`[height:${size.height}px]`);
        else if (w > 0 && size?.width)
          sized.push(`[height:${r2((w * size.height) / size.width)}px]`);
      }
      // Inline SVG becomes vector layers when it can (web/vector-svg.js); otherwise an SVG image.
      if (vectorMarkup) {
        const px = (prop, attr) => {
          const v = String(info.style.get(prop) || "");
          return /^[\d.]+px$/.test(v) ? parseFloat(v) : Number(attr) > 0 ? Number(attr) : undefined;
        };
        const out = svgElementJsx(vectorMarkup, {
          color: info.color,
          attrs: [
            `data-node-label="${escAttr(name)}"`,
            ...(residual ? [`${RESIDUAL_ATTR}='${escSingle(JSON.stringify(residual))}'`] : []),
          ],
          className: [...classes, ...sized].join(" "),
          label: name,
          indent,
          w: px("width", el.attrs.width),
          h: px("height", el.attrs.height),
        });
        if (out.ok) {
          lines.push(out.jsx);
          for (const w of out.warnings.slice(0, 6)) warnings.push(`Inline SVG: ${w}`);
          return;
        }
        warnings.push(`${out.reason}; kept it as an SVG image`);
      }
      lines.push(
        `${indent}<img data-node-label="${escAttr(name)}" src="${escAttr(src)}"${assetError ? ` data-asset-error="${escAttr(assetError)}"` : ""}${common([...classes, ...sized])}${fills.length ? ` data-fills="${escAttr(JSON.stringify(fills))}"` : ""} />`,
      );
      return;
    }
    if (["input", "textarea", "select"].includes(el.tag)) {
      const selected =
        el.tag === "select"
          ? el.children.find((c) => c.tag === "option" && "selected" in c.attrs) ||
            el.children.find((c) => c.tag === "option")
          : null;
      const visible =
        el.tag === "input"
          ? el.attrs.value || el.attrs.placeholder || ""
          : el.tag === "textarea"
            ? el.children.map((c) => c.text || "").join("")
            : textContent(selected || el);
      el.children = [{ text: visible }];
      el.tag = "button";
      tag = "button";
    }
    if (
      ["hr", "input", "progress", "meter"].includes(el.tag) ||
      ["video", "canvas", "iframe", "object", "embed"].includes(el.tag)
    ) {
      const { classes } = await classesFor(el, info);
      const sized = [];
      if (["video", "canvas", "iframe", "object", "embed"].includes(el.tag)) {
        if (!info.style.has("width")) sized.push(`[width:${Number(el.attrs.width) || 300}px]`);
        if (!info.style.has("height")) sized.push(`[height:${Number(el.attrs.height) || 150}px]`);
      }
      if (el.tag === "hr" && !info.style.has("height")) sized.push("[height:0px]");
      lines.push(
        `${indent}<${el.tag === "hr" ? "hr" : "div"} data-node-type="rectangle" data-node-label="${escAttr(name)}"${common([...classes, ...sized])} />`,
      );
      return;
    }
    const kids = (el.children || []).filter((c) => (c.tag ? !SKIP.has(c.tag) : !c.raw));
    // Children of flex and grid containers are blockified: each element child is its own item.
    const itemized = /flex|grid/.test(info.display);
    const textOnly =
      !root &&
      designType !== "frame" &&
      kids.length > 0 &&
      kids.some(hasText) &&
      (itemized
        ? kids.every((c) => c.text !== undefined)
        : kids.every((c) => isInlineText(c, info)));
    const { classes, fills } = await classesFor(el, info, { text: textOnly });
    const fillAttr = fills.length ? ` data-fills="${escAttr(JSON.stringify(fills))}"` : "";
    const typeAttr =
      designType && ["frame", "rectangle", "text", "image", "shader"].includes(designType)
        ? ` data-node-type="${designType}"`
        : "";
    if (textOnly) {
      if (tag !== "button") setBindings(true);
      const inner = await inlineJsx(el, info);
      const ws =
        /nowrap|pre$/.test(info.whiteSpace) && !info.style.has("white-space")
          ? ["[white-space:nowrap]"]
          : [];
      const named =
        el.attrs.id ||
        el.attrs["aria-label"] ||
        el.attrs["data-name"] ||
        (el.classList[0] && referenced.has(el.classList[0]))
          ? ` data-node-label="${escAttr(name)}"`
          : "";
      lines.push(
        `${indent}<${tag}${typeAttr}${named}${common([...classes, ...ws], artboardAttrs)}${fillAttr}>${inner || " "}</${tag}>`,
      );
      return;
    }
    const labelAttr = ` data-node-label="${escAttr(name)}"${!typeAttr && itemized ? ' data-node-type="frame"' : ""}`;
    lines.push(
      `${indent}<${tag}${typeAttr}${labelAttr}${artboardAttrs}${common(classes)}${fillAttr}>`,
    );
    // Children: runs of inline text become anonymous text blocks; elements recurse.
    let run = [];
    const flush = async () => {
      if (!run.length) return;
      if (run.some(hasText)) {
        const anon = makeElement("span", {}, el);
        anon.children = run;
        const inner = await inlineJsx(anon, info);
        if (inner.trim()) lines.push(`${indent}  <div data-node-type="text">${inner}</div>`);
      }
      run = [];
    };
    for (const c of kids) {
      if (c.text !== undefined || (!itemized && isInlineText(c, info))) {
        run.push(c);
        continue;
      }
      await flush();
      await emit(c, info, indent + "  ");
    }
    await flush();
    lines.push(`${indent}</${tag}>`);
  };

  // --- artboards
  const exported = all(bodyEl, (e) => e.attrs["data-vn-node"] !== undefined && !hasVnAncestor(e));
  if (exported.length) {
    // A Verynize export: every top-level layer is an artboard.
    const bodyInfo = computeElement(bodyEl, htmlComputed);
    for (const el of exported) {
      const parentInfo =
        el.parent && el.parent !== bodyEl ? computeElement(el.parent, bodyInfo) : bodyInfo;
      await emit(el, parentInfo, "", { root: true });
    }
  } else if (
    (options.fragment ?? !/<(?:html|head|body)[\s>]/i.test(String(html))) ||
    (options.split !== "none" && all(bodyEl, () => true).length > NODE_LIMITS.perPage)
  ) {
    // A fragment (pasted markup without <html>/<body>): each top-level element is an artboard, styled
    // with the page's own <style> rules and inheriting from the implied <html>/<body>.
    const bodyInfo = computeElement(bodyEl, htmlComputed);
    for (const c of (bodyEl.children || []).filter((c) => c.tag && !SKIP.has(c.tag)))
      await emit(c, bodyInfo, "", { artboard: true });
  } else {
    // A web page: the artboard is the viewport (<html>), with <body> inside it.
    const titleEl = find(htmlEl, "title");
    const title =
      options.name ||
      htmlEl.attrs?.["data-name"] ||
      (titleEl ? titleEl.children.map((c) => c.text || "").join("") : "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200) ||
      options.fallbackName ||
      "Imported page";
    const bodyInfo = computeElement(bodyEl, htmlComputed);
    const canvasBg = htmlComputed.style.get("background-color");
    if (!canvasBg || cssColorToHex(canvasBg) === "transparent") {
      const bodyBg = bodyInfo.style.get("background-color");
      htmlComputed.style.set(
        "background-color",
        bodyBg && cssColorToHex(bodyBg) !== "transparent" ? cssColorToHex(bodyBg) : "#ffffff",
      );
      if (bodyBg && htmlComputed.tokenRefs) {
        const t = bodyInfo.tokenRefs.get("background-color");
        if (t) htmlComputed.tokenRefs.set("background-color", t);
      }
    }
    htmlComputed.style.set("width", `${view.width}px`);
    htmlComputed.style.set("min-height", `${view.height}px`);
    htmlComputed.style.set("display", "block");
    for (const p of [
      "height",
      "max-width",
      "margin-top",
      "margin-right",
      "margin-bottom",
      "margin-left",
      "position",
    ])
      htmlComputed.style.delete(p);
    const { classes, fills } = await classesFor(
      htmlEl === tree ? makeElement("html", {}, null) : htmlEl,
      htmlComputed,
    );
    lines.push(
      `<div data-node-label="${escAttr(title)}"${
        // Into an existing document without a position: next free spot beside the other artboards.
        options.document && options.x === undefined
          ? ""
          : ` data-component-x="${Number(options.x) || 0}" data-component-y="${Number(options.y) || 0}"`
      } className="${escAttr(classes.join(" "))}"${fills.length ? ` data-fills="${escAttr(JSON.stringify(fills))}"` : ""}>`,
    );
    if (bodyEl !== htmlEl) await emit(bodyEl, htmlComputed, "  ");
    else
      for (const c of (bodyEl.children || []).filter((c) => c.tag))
        await emit(c, htmlComputed, "  ");
    lines.push("</div>");
  }
  const jsx = lines.join("\n");

  // --- document
  let target = doc;
  if (!target) {
    target = {
      version: 2,
      name: meta?.name || options.name || "Imported page",
      activePage: "page-1",
      tokens: {},
      pages: [{ id: "page-1", name: meta?.page?.name || "Page", nodes: [] }],
    };
    if (meta?.page)
      for (const key of ["width", "height", "background"])
        if (meta.page[key] !== undefined) target.pages[0][key] = meta.page[key];
  }
  target.tokens = { ...target.tokens, ...tokens };
  if (Object.keys(variables).length)
    target.variables = { ...(target.variables || {}), ...variables };
  if (meta?.aliases) target.aliases = { ...(target.aliases || {}), ...meta.aliases };
  validateDocument(target);
  const pageId = options.pageId || target.activePage || target.pages[0].id;
  if (!lines.length) throw new Error("No importable elements were found in the HTML");
  const result = createArtboards(target, pageId, jsx, {
    viewport: view,
    split: options.split || "pages",
  });
  const unsupported = [...stats.unsupported].sort((a, b) => b[1] - a[1]);
  if (unsupported.length)
    warnings.push(
      `CSS properties not represented on the canvas: ${unsupported
        .slice(0, 16)
        .map(([p, n]) => `${p} (${n})`)
        .join(", ")}${unsupported.length > 16 ? " …" : ""}`,
    );
  if (stats.pseudoElements)
    warnings.push(
      `${stats.pseudoElements} ::before/::after rule match(es) were not imported (generated content is not represented)`,
    );
  if (stats.rederived)
    warnings.push(
      `${stats.rederived} exported layer(s) had edited CSS and were rebuilt from their declarations`,
    );
  return {
    document: validateDocument(result.document),
    pageId,
    roots: result.roots,
    jsx,
    warnings: [...warnings, ...result.warnings],
    stats: { ...stats, unsupported: Object.fromEntries(unsupported) },
  };
}
const hasVnAncestor = (el) => {
  for (let p = el.parent; p; p = p.parent) if (p.attrs?.["data-vn-node"] !== undefined) return true;
  return false;
};
function matchesIgnoringPseudo(el, sel) {
  try {
    return matches(el, {
      ...sel,
      pseudoElement: false,
      parts: sel.parts.map((p) => ({ ...p, compound: { ...p.compound, pseudoElement: false } })),
    });
  } catch {
    return false;
  }
}

/** Import a page from a local path or an http(s) URL (remote requires allowRemote). */
export async function importHtmlFrom(location, options = {}) {
  const isUrl = /^https?:\/\//i.test(location);
  const opts = { ...IMPORT_LIMITS, ...options };
  if (isUrl) {
    if (!opts.allowRemote) throw new Error("Importing from a URL needs allowRemote");
    const loader = new Loader(
      { ...opts, fetch: opts.fetch || globalThis.fetch, allowRemote: true },
      [],
    );
    const { buf, url } = await loader.load(new URL(location), { kind: "page" });
    return importHtml(buf.toString("utf8"), { ...options, baseUrl: url.href });
  }
  const file = path.resolve(location);
  const info = await stat(file);
  if (info.size > opts.maxBytes) throw new Error(`${file} exceeds ${opts.maxBytes} bytes`);
  return importHtml(await readFile(file, "utf8"), { ...options, baseUrl: file });
}
