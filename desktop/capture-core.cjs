// Page capture core shared by the localhost preview capture (desktop/preview.cjs) and arbitrary web
// page capture (desktop/capture-remote.cjs).
//
// Pipeline: `snapshotDocument` runs inside the captured page (stringified, JSON arguments only) and
// returns plain records: geometry, computed style, image/background URLs, @font-face rules, source
// mapping (URL + CSS selector + XPath, plus the dev source file:line on localhost apps) and the
// transition list of every element. In windows Verynize owns, `probeInteractions` then forces
// :hover/:focus/:focus-visible/:active through the DevTools protocol and records the computed style
// deltas. `finishSnapshot` embeds images, CSS backgrounds and the custom fonts the captured text uses
// as data URLs and builds the version-2 design document plus a standalone HTML rendition.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
const MAX_ASSET = 2 * 1024 * 1024,
  MAX_TOTAL = 8 * 1024 * 1024,
  MAX_FONT = 2 * 1024 * 1024,
  MAX_FONTS_TOTAL = 6 * 1024 * 1024;
const STATES = ["hover", "focus", "focus-visible", "active"];
const STATE_KEYS = [
  "color",
  "backgroundColor",
  "backgroundImage",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "boxShadow",
  "opacity",
  "transform",
  "textDecorationLine",
  "outlineColor",
  "outlineStyle",
  "outlineWidth",
  "filter",
  "fontWeight",
  "letterSpacing",
];

/* In-page: walk the DOM inside `region` (viewport CSS px) and return serialisable records. */
function snapshotDocument(region, options = {}) {
  const numBrowser = (v) => parseFloat(v) || 0;
  const warnings = [],
    records = [],
    assets = [];
  let count = 0;
  // options.root: capture one element (structural CSS path) as top-level layers, its box as the area.
  const rootEl = options.root ? document.querySelector(options.root) : null;
  if (options.root && !rootEl) throw Error("The element is no longer on the page");
  const rootBox = rootEl && rootEl.getBoundingClientRect();
  const area = rootBox
    ? {
        x: rootBox.left,
        y: rootBox.top,
        width: Math.max(1, rootBox.width),
        height: Math.max(1, rootBox.height),
      }
    : region || { x: 0, y: 0, width: innerWidth, height: innerHeight };
  const kept = options.keep ? (window.__verynizeCapture = new Map()) : null;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const styleKeys = [
    "color",
    "backgroundColor",
    "fontSize",
    "fontFamily",
    "fontWeight",
    "fontStyle",
    "textAlign",
    "borderRadius",
    "opacity",
    "borderTopWidth",
    "borderTopColor",
    "boxShadow",
    "lineHeight",
    "letterSpacing",
    "display",
    "flexDirection",
    "gap",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "alignItems",
    "justifyContent",
    "gridTemplateColumns",
    "overflow",
    "backgroundSize",
    "backgroundRepeat",
    "cursor",
  ];
  const ignored = new Set([
    "SCRIPT",
    "STYLE",
    "LINK",
    "IFRAME",
    "OBJECT",
    "EMBED",
    "NOSCRIPT",
    "META",
    "HEAD",
    "TEMPLATE",
  ]);
  const plainId = (id) =>
    /^[A-Za-z][\w-]*$/.test(id) && document.querySelectorAll("#" + CSS.escape(id)).length === 1;
  function selectorOf(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      if (n.id && plainId(n.id)) {
        parts.unshift("#" + CSS.escape(n.id));
        return parts.join(" > ");
      }
      let part = n.tagName.toLowerCase();
      const same = n.parentElement
        ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName)
        : [];
      if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(n) + 1) + ")";
      parts.unshift(part);
    }
    return parts.join(" > ");
  }
  function xpathOf(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const same = n.parentElement
        ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName)
        : [n];
      parts.unshift(n.tagName.toLowerCase() + "[" + (same.indexOf(n) + 1) + "]");
    }
    return "/" + parts.join("/");
  }
  // Dev-time source locations: explicit data attributes (Vite/Babel source plugins, click-to-component
  // inspectors) first, then the React development fiber of the element itself, then Vue's __file.
  function devSource(el) {
    for (const [file, line, column] of [
      ["data-source-file", "data-source-line", "data-source-column"],
      ["data-inspector-relative-path", "data-inspector-line", "data-inspector-column"],
      ["data-file", "data-line", "data-column"],
    ]) {
      if (el.hasAttribute(file))
        return {
          file: el.getAttribute(file),
          line: parseInt(el.getAttribute(line)) || null,
          column: parseInt(el.getAttribute(column)) || null,
          via: file,
        };
    }
    for (const name of [
      "data-source",
      "data-locator",
      "data-loc",
      "data-component-source",
      "data-source-location",
    ]) {
      const value = el.getAttribute(name),
        match = value && value.match(/^(.+?):(\d+)(?::(\d+))?$/);
      if (match)
        return { file: match[1], line: +match[2], column: match[3] ? +match[3] : null, via: name };
    }
    try {
      const key = Object.keys(el).find(
        (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
      );
      const fiber = key && el[key],
        source = fiber && (fiber._debugSource || fiber.memoizedProps?.__source);
      if (source && typeof source.fileName === "string")
        return {
          file: source.fileName,
          line: source.lineNumber || null,
          column: source.columnNumber || null,
          via: "react",
        };
      const vue = el.__vueParentComponent?.type?.__file;
      if (typeof vue === "string") return { file: vue, line: null, column: null, via: "vue" };
    } catch {
      /* page-defined getters may throw */
    }
    return null;
  }
  function transitionsOf(css) {
    const split = (v) => v.split(/,(?![^(]*\))/).map((s) => s.trim());
    const props = split(css.transitionProperty),
      durations = split(css.transitionDuration),
      timings = split(css.transitionTimingFunction),
      delays = split(css.transitionDelay);
    const seconds = (v) => (v.endsWith("ms") ? parseFloat(v) / 1000 : parseFloat(v) || 0);
    return props
      .map((property, i) => ({
        property,
        duration: seconds(durations[i % durations.length]),
        timing: timings[i % timings.length],
        delay: seconds(delays[i % delays.length]),
      }))
      .filter((t) => t.duration > 0 && t.property !== "none");
  }
  function walk(el, parent = null) {
    if (count >= 500 || ignored.has(el.tagName)) return;
    const measured = el.getBoundingClientRect();
    const rect =
      el === document.body
        ? {
            x: measured.x,
            y: measured.y,
            left: measured.left,
            top: measured.top,
            width: Math.max(measured.width, innerWidth),
            height: Math.max(measured.height, innerHeight),
            right: Math.max(measured.right, innerWidth),
            bottom: Math.max(measured.bottom, innerHeight),
          }
        : measured;
    const css = getComputedStyle(el);
    if (
      !rect.width ||
      !rect.height ||
      css.display === "none" ||
      css.visibility === "hidden" ||
      rect.bottom < area.y ||
      rect.top > area.y + area.height ||
      rect.right < area.x ||
      rect.left > area.x + area.width
    )
      return;
    const control = ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    const children = control ? [] : [...el.children].filter((child) => !ignored.has(child.tagName));
    const text = control
      ? el.type === "password"
        ? el.value
          ? "••••••"
          : ""
        : el.type === "file"
          ? ""
          : el.tagName === "SELECT"
            ? [...el.selectedOptions].map((o) => o.textContent).join(", ")
            : el.value
      : [...el.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent)
          .join("")
          .trim();
    const image = el.tagName === "IMG";
    const frame = children.length > 0;
    const backgrounds = [...css.backgroundImage.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)]
      .map((m) => m[2])
      .filter(Boolean);
    const gradient = /^(linear|radial|conic)-gradient\(/.test(css.backgroundImage)
      ? css.backgroundImage
      : "";
    if (
      !image &&
      !frame &&
      !text &&
      css.backgroundColor === "rgba(0, 0, 0, 0)" &&
      !gradient &&
      !backgrounds.length
    )
      return;
    const id = "captured-" + ++count,
      style = {};
    for (const key of styleKeys) style[key] = css[key];
    let rotation = 0;
    if (css.transform !== "none") {
      try {
        const m = new DOMMatrix(css.transform);
        rotation = (Math.atan2(m.b, m.a) * 180) / Math.PI;
        if (Math.abs(m.a * m.d - m.b * m.c - 1) > 0.05)
          warnings.push("Transformed scale/skew approximated: " + el.tagName);
      } catch {
        /* keep unrotated */
      }
    }
    const width = rotation ? el.offsetWidth : rect.width,
      height = rotation ? el.offsetHeight : rect.height;
    const box = {
      x: rect.x + (rect.width - width) / 2,
      y: rect.y + (rect.height - height) / 2,
      width,
      height,
    };
    const interactive =
      el.matches(
        "a[href],button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[tabindex]",
      ) || css.cursor === "pointer";
    const source =
      options.sources === false
        ? null
        : {
            url: location.href,
            selector: selectorOf(el),
            xpath: xpathOf(el),
            ...(local ? { dev: devSource(el) } : {}),
          };
    const item = {
      id,
      parentId: parent?.id || null,
      type: image ? "image" : frame ? "frame" : text ? "text" : "rectangle",
      name: el.getAttribute("aria-label") || el.tagName.toLowerCase(),
      x: box.x - (parent?.box.x ?? area.x),
      y: box.y - (parent?.box.y ?? area.y),
      w: width,
      h: height,
      style,
      gradient,
      rotation,
      text: frame ? "" : text,
      source,
      transitions: transitionsOf(css),
      probe: interactive,
    };
    records.push(item);
    if (kept) kept.set(id, el);
    if (image) {
      const src = el.currentSrc || el.src;
      if (src) assets.push({ id, url: src, kind: "image" });
    }
    for (const url of backgrounds.slice(0, 4))
      assets.push({ id, url: new URL(url, document.baseURI).href, kind: "background" });
    if (frame && text)
      records.push({
        id: "captured-" + ++count,
        parentId: id,
        type: "text",
        name: item.name + " text",
        x: parseFloat(css.paddingLeft) || 0,
        y: parseFloat(css.paddingTop) || 0,
        w: Math.max(1, el.clientWidth),
        h: parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.2,
        style,
        gradient: "",
        rotation: 0,
        text,
        source: null,
        transitions: [],
        probe: false,
      });
    for (const child of children)
      walk(child, {
        id,
        box: {
          ...box,
          x: box.x + numBrowser(css.borderLeftWidth),
          y: box.y + numBrowser(css.borderTopWidth),
        },
      });
  }
  // @font-face rules reachable through the CSSOM; cross-origin sheets are listed for the main process.
  const faces = [],
    sheets = [];
  function scan(list, base) {
    for (const rule of list) {
      if (rule.constructor.name === "CSSFontFaceRule" || rule.type === 5)
        faces.push({
          family: rule.style.getPropertyValue("font-family"),
          weight: rule.style.getPropertyValue("font-weight") || "400",
          style: rule.style.getPropertyValue("font-style") || "normal",
          src: rule.style.getPropertyValue("src"),
          unicodeRange: rule.style.getPropertyValue("unicode-range") || "",
          base,
        });
      else if (rule.styleSheet) visit(rule.styleSheet);
      else if (rule.cssRules) scan(rule.cssRules, base);
    }
  }
  function visit(sheet) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      if (sheet.href) sheets.push(sheet.href);
      return;
    }
    if (rules) scan(rules, sheet.href || document.baseURI);
  }
  for (const sheet of document.styleSheets) visit(sheet);
  walk(rootEl || document.body);
  function backdropOf(el) {
    for (; el; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(bg)) return bg;
    }
    return "";
  }
  if (count >= 500) warnings.push("Capture limited to 500 elements");
  warnings.push(
    "Layout captured as fixed positioned layers; responsive rules and pseudo-elements are not reconstructed",
  );
  return {
    records,
    assets,
    warnings,
    area,
    element: !!rootEl,
    // The colour the element is seen on (its own or the nearest opaque ancestor background). Element captures put it
    // behind captured text, so dark text stays readable on the canvas (Wonder PM4-result: page colour behind the h1).
    backdrop: rootEl ? backdropOf(rootEl) : "",
    title: document.title,
    url: location.href,
    fonts: { faces: faces.slice(0, 200), sheets: [...new Set(sheets)].slice(0, 20) },
  };
}

/* In-page: computed style subset of captured elements (by capture id) used to diff forced states. */
function readCaptureStates(ids, keys) {
  const out = {};
  for (const id of ids) {
    const el = window.__verynizeCapture?.get(id);
    if (!el) continue;
    const css = getComputedStyle(el),
      values = {};
    for (const key of keys) values[key] = css[key];
    out[id] = values;
  }
  return out;
}

/* In-page: visible element boxes for the region picker (smallest-box hit testing in the renderer). */
function pageBoxes() {
  const boxes = [];
  for (const el of document.body ? document.body.querySelectorAll("*") : []) {
    if (boxes.length >= 1500) break;
    if (["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE", "NOSCRIPT"].includes(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (
      r.width < 4 ||
      r.height < 4 ||
      r.bottom <= 0 ||
      r.right <= 0 ||
      r.top >= innerHeight ||
      r.left >= innerWidth
    )
      continue;
    const x = Math.max(0, r.left),
      y = Math.max(0, r.top);
    boxes.push({
      x,
      y,
      width: Math.min(innerWidth, r.right) - x,
      height: Math.min(innerHeight, r.bottom) - y,
      label: el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""),
    });
  }
  return { boxes, width: innerWidth, height: innerHeight, title: document.title };
}

/* In-page: the element under a viewport point, for the live preview hover highlight. */
function elementAtPoint(point) {
  const el = document.elementFromPoint(point.x, point.y);
  if (!el || el === document.documentElement) return null;
  const r = el.getBoundingClientRect(),
    x = Math.max(0, r.left),
    y = Math.max(0, r.top);
  return {
    x,
    y,
    width: Math.max(1, Math.min(innerWidth, r.right) - x),
    height: Math.max(1, Math.min(innerHeight, r.bottom) - y),
    label: el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""),
    viewport: { width: innerWidth, height: innerHeight },
  };
}

const num = (value, fallback = 0) =>
  Number.isFinite(parseFloat(value)) ? parseFloat(value) : fallback;

/** CSS rgb()/rgba() → #rrggbb[aa]; '' for transparent or unparsable colours. */
function cssColorHex(value) {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(
    String(value || "").trim(),
  );
  if (!m) return /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) ? value.toLowerCase() : "";
  let alpha =
    m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (alpha <= 0) return "";
  const hex = (v) =>
    Math.max(0, Math.min(255, Math.round(+v)))
      .toString(16)
      .padStart(2, "0");
  return "#" + hex(m[1]) + hex(m[2]) + hex(m[3]) + (alpha < 1 ? hex(alpha * 255) : "");
}

/** Font family names of a CSS font-family stack, unquoted and lower-cased. */
function familyNames(stack) {
  return String(stack || "")
    .split(",")
    .map((f) =>
      f
        .trim()
        .replace(/^['"]|['"]$/g, "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
}

/** @font-face blocks (and @import URLs) of a stylesheet's text, resolved against `base`. */
function parseFontFaces(cssText, base) {
  const text = String(cssText).replace(/\/\*[\s\S]*?\*\//g, "");
  const faces = [],
    imports = [];
  for (const m of text.matchAll(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/g)) {
    try {
      imports.push(new URL(m[2], base).href);
    } catch {
      /* ignore */
    }
  }
  for (const m of text.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const decl = {};
    for (const part of m[1].split(/;(?![^(]*\))/)) {
      const i = part.indexOf(":");
      if (i > 0) decl[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
    }
    if (decl["font-family"] && decl.src)
      faces.push({
        family: decl["font-family"],
        weight: decl["font-weight"] || "400",
        style: decl["font-style"] || "normal",
        src: decl.src,
        unicodeRange: decl["unicode-range"] || "",
        base,
      });
  }
  return { faces, imports };
}

/** Best downloadable source of an @font-face `src` list: woff2 > woff > truetype/opentype; never local(). */
function pickFontSource(src, base) {
  const rank = { woff2: 0, woff: 1, truetype: 2, opentype: 2, ttf: 2, otf: 2 };
  const list = [];
  for (const m of String(src).matchAll(
    /url\(\s*(['"]?)(.*?)\1\s*\)(?:\s*format\(\s*['"]?([\w-]+)['"]?\s*\))?/g,
  )) {
    let url;
    try {
      url = new URL(m[2], base).href;
    } catch {
      continue;
    }
    const format = (m[3] || url.split(/[?#]/)[0].split(".").pop() || "").toLowerCase();
    list.push({ url, rank: rank[format] ?? 3 });
  }
  return list.sort((a, b) => a.rank - b.rank)[0]?.url || null;
}

/** Font container type from the first bytes; null when the bytes are not a font. */
function fontMime(bytes) {
  const tag = Buffer.from(bytes.subarray(0, 4)).toString("latin1");
  if (tag === "wOF2") return "font/woff2";
  if (tag === "wOFF") return "font/woff";
  if (tag === "OTTO") return "font/otf";
  if (tag === "true" || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0))
    return "font/ttf";
  return null;
}

async function readLimited(response, limit, budget, total) {
  const declared = Number(response.headers.get("content-length"));
  if (declared > limit || budget.bytes + (declared || 0) > total)
    throw Error("Asset size limit exceeded");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limit || budget.bytes + size > total) {
      await response.body.cancel?.().catch(() => {});
      throw Error("Asset size limit exceeded");
    }
    chunks.push(Buffer.from(chunk));
  }
  budget.bytes += size;
  return Buffer.concat(chunks);
}

/** Fetch an http(s) asset under the capture policy (same-origin unless crossOrigin is allowed). */
async function fetchAsset(url, policy) {
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password)
    throw Error("Unsupported asset URL");
  if (!policy.crossOrigin && target.origin !== policy.origin)
    throw Error("Only same-origin images are embedded");
  const response = await (policy.fetcher || fetch)(target.href, {
    redirect: policy.crossOrigin ? "follow" : "error",
    credentials: "omit",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error("Asset returned " + response.status);
  return response;
}

async function embedImage(url, policy, budget) {
  if (/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/i.test(url)) {
    const size = Buffer.byteLength(url);
    if (size > MAX_ASSET || budget.bytes + size > MAX_TOTAL)
      throw Error("Embedded image asset limit exceeded");
    budget.bytes += size;
    return url;
  }
  const response = await fetchAsset(url, policy);
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!IMAGE_TYPES.includes(mime)) {
    await response.body?.cancel?.().catch(() => {});
    throw Error("Image format not supported");
  }
  const bytes = await readLimited(response, MAX_ASSET, budget, MAX_TOTAL);
  return "data:" + mime + ";base64," + bytes.toString("base64");
}

/** Document-safe @font-face descriptors (mirrors the fontFaces validation in web/document-core.js). */
function fontDescriptor(face) {
  const family =
    String(face.family)
      .trim()
      .replace(/^['"]|['"]$/g, "")
      .replace(/[;{}<>\\"]/g, "")
      .slice(0, 100) || "Captured font";
  const weight = String(face.weight || "400")
    .trim()
    .toLowerCase();
  const style = String(face.style || "normal")
    .trim()
    .toLowerCase()
    .split(/\s+/)[0];
  const range = String(face.unicodeRange || "").trim();
  return {
    family,
    weight: /^(normal|bold|[1-9]00( [1-9]00)?)$/.test(weight) ? weight : "400",
    style: ["normal", "italic", "oblique"].includes(style) ? style : "normal",
    ...(range && /^[\w+?, -]{1,2000}$/.test(range) ? { unicodeRange: range } : {}),
  };
}

/** Embed the @font-face fonts whose family is used by captured text. */
async function embedFonts(snapshot, policy) {
  const used = new Set(snapshot.records.flatMap((r) => familyNames(r.style?.fontFamily)));
  const faces = [...(snapshot.fonts?.faces || [])];
  const queue = [...(snapshot.fonts?.sheets || [])],
    seen = new Set();
  while (queue.length && seen.size < 20) {
    const href = queue.shift();
    if (seen.has(href)) continue;
    seen.add(href);
    try {
      const response = await fetchAsset(href, policy);
      const parsed = parseFontFaces(
        (await readLimited(response, MAX_ASSET, { bytes: 0 }, MAX_ASSET)).toString("utf8"),
        href,
      );
      faces.push(...parsed.faces);
      queue.push(...parsed.imports);
    } catch (error) {
      snapshot.warnings.push("Stylesheet not read for fonts: " + error.message);
    }
  }
  const out = [],
    budget = { bytes: 0 },
    done = new Map();
  for (const face of faces) {
    const family = familyNames(face.family)[0];
    if (!family || !used.has(family)) continue;
    const url = pickFontSource(face.src, face.base);
    if (!url) continue;
    try {
      let src = done.get(url);
      if (!src) {
        const bytes = await readLimited(
          await fetchAsset(url, policy),
          MAX_FONT,
          budget,
          MAX_FONTS_TOTAL,
        );
        const mime = fontMime(bytes);
        if (!mime) throw Error("not a font file");
        src = "data:" + mime + ";base64," + bytes.toString("base64");
        done.set(url, src);
      }
      out.push({ ...fontDescriptor(face), src, source: url });
    } catch (error) {
      snapshot.warnings.push(
        "Font not embedded (" + familyNames(face.family)[0] + "): " + error.message,
      );
    }
    if (out.length >= 40) break;
  }
  return out;
}

/** Force interaction pseudo-classes through the DevTools protocol and record computed style deltas. */
async function probeInteractions(webContents, snapshot, limit = 60) {
  const candidates = snapshot.records.filter((r) => r.probe).slice(0, limit);
  if (!candidates.length) return;
  const debug = webContents.debugger;
  try {
    debug.attach("1.3");
  } catch {
    snapshot.warnings.push("Interaction states not recorded: debugger unavailable");
    return;
  }
  const childrenOf = new Map();
  for (const r of snapshot.records)
    if (r.parentId) childrenOf.set(r.parentId, [...(childrenOf.get(r.parentId) || []), r.id]);
  const descendants = (id) => {
    const out = [],
      stack = [...(childrenOf.get(id) || [])];
    while (stack.length && out.length < 12) {
      const next = stack.shift();
      out.push(next);
      stack.push(...(childrenOf.get(next) || []));
    }
    return out;
  };
  const byId = new Map(snapshot.records.map((r) => [r.id, r]));
  try {
    await debug.sendCommand("DOM.enable");
    await debug.sendCommand("CSS.enable");
    await debug.sendCommand("DOM.getDocument", { depth: 0 });
    // Read forced states at their end values: transitions/animations are frozen while probing.
    await webContents.executeJavaScript(
      "(()=>{const s=document.createElement('style');s.id='__verynize-probe';s.textContent='*,*::before,*::after{transition:none!important;animation-play-state:paused!important}';document.documentElement.append(s);})()",
    );
    for (const record of candidates) {
      const { result } = await debug.sendCommand("Runtime.evaluate", {
        expression:
          "window.__verynizeCapture&&window.__verynizeCapture.get(" +
          JSON.stringify(record.id) +
          ")",
      });
      if (!result?.objectId) continue;
      const { nodeId } = await debug.sendCommand("DOM.requestNode", { objectId: result.objectId });
      const ids = [record.id, ...descendants(record.id)];
      const read = () =>
        webContents.executeJavaScript(
          "(" +
            readCaptureStates.toString() +
            ")(" +
            JSON.stringify(ids) +
            "," +
            JSON.stringify(STATE_KEYS) +
            ")",
        );
      const base = await read(),
        states = {};
      for (const state of STATES) {
        await debug.sendCommand("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [state] });
        const next = await read();
        await debug.sendCommand("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
        const delta = { style: {}, from: {}, descendants: [] };
        for (const id of ids) {
          const changed = {},
            before = {};
          for (const key of STATE_KEYS)
            if (base[id] && next[id] && base[id][key] !== next[id][key]) {
              changed[key] = next[id][key];
              before[key] = base[id][key];
            }
          if (!Object.keys(changed).length) continue;
          if (id === record.id) {
            delta.style = changed;
            delta.from = before;
          } else
            delta.descendants.push({
              selector: byId.get(id)?.source?.selector || "",
              name: byId.get(id)?.name || "",
              style: changed,
            });
        }
        if (Object.keys(delta.style).length || delta.descendants.length) states[state] = delta;
      }
      if (Object.keys(states).length) record.states = states;
    }
  } catch (error) {
    snapshot.warnings.push("Interaction states partially recorded: " + error.message);
  } finally {
    await webContents
      .executeJavaScript("document.getElementById('__verynize-probe')?.remove()")
      .catch(() => {});
    try {
      debug.detach();
    } catch {
      /* already detached */
    }
  }
}

const kebab = (key) => key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
/** Human-readable interaction notes for a captured node. */
function interactionNotes(item) {
  const notes = [];
  for (const [state, delta] of Object.entries(item.states || {})) {
    const changes = Object.entries(delta.style).map(
      ([k, v]) => kebab(k) + " " + (delta.from[k] ?? "") + " → " + v,
    );
    if (delta.descendants.length)
      changes.push(delta.descendants.length + " child layer(s) restyle");
    notes.push("On :" + state + ": " + changes.join("; "));
  }
  for (const t of item.transitions || [])
    notes.push(
      "Transition " +
        t.property +
        " " +
        Math.round(t.duration * 1000) +
        "ms " +
        t.timing +
        (t.delay ? " after " + Math.round(t.delay * 1000) + "ms" : ""),
    );
  return notes;
}

function fitOf(size) {
  if (size === "cover" || size === "contain") return size;
  if (/^100% 100%$/.test(size)) return "fill";
  return "cover";
}

function captureModel(snapshot) {
  const id = "capture-page";
  const nodes = snapshot.records.map((item) => {
    const c = item.style;
    const padding = [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft].map((v) =>
      num(v),
    );
    const node = {
      id: item.id,
      parentId: item.parentId || (snapshot.element ? null : "capture-region"),
      type: item.type,
      name: item.name,
      x: item.x,
      y: item.y,
      w: Math.max(1, item.w),
      h: Math.max(1, item.h),
      // Text colour as hex so the inspector shows it as an editable Text Fill (Wonder PM4: Text Fill 172340).
      color: item.type === "text" ? cssColorHex(c.color) || c.color : c.backgroundColor,
      text: item.text || "",
      fontSize: num(c.fontSize, 16),
      fontFamily: c.fontFamily,
      fontWeight: c.fontWeight,
      textAlign: c.textAlign,
      radius: num(c.borderRadius),
      opacity: num(c.opacity, 1) * 100,
      rotation: item.rotation,
      strokeWidth: num(c.borderTopWidth),
      strokeColor: c.borderTopColor,
      shadow: c.boxShadow === "none" ? "" : c.boxShadow,
      clipContent: ["hidden", "clip"].includes(c.overflow),
      // CSS `normal` is the font's own leading: the inspector's Auto (Wonder PM4), not a guessed 1.2 ratio.
      lineHeight:
        c.lineHeight === "normal"
          ? "auto"
          : num(c.lineHeight, num(c.fontSize, 16) * 1.2) / num(c.fontSize, 16),
      letterSpacing: num(c.letterSpacing),
      layout: "free",
      direction: c.flexDirection,
      gap: num(c.gap),
      padding: padding[0],
      columns: c.gridTemplateColumns === "none" ? 2 : c.gridTemplateColumns.split(" ").length,
      alignItems: c.alignItems,
      justifyContent: c.justifyContent,
      gradient: item.gradient,
      mask: "",
      animated: "",
      token: "",
      zIndex: 0,
      ...(item.src ? { src: item.src } : {}),
    };
    if (c.fontStyle === "italic") node.fontStyle = "italic";
    if (item.backgrounds?.length) {
      const solid = item.type !== "text" && cssColorHex(c.backgroundColor);
      node.fills = [
        ...item.backgrounds.map((src) => ({ type: "image", src, fit: fitOf(c.backgroundSize) })),
        ...(solid ? [{ type: "solid", color: solid }] : []),
      ];
    }
    if (item.source || item.states || item.transitions?.length) {
      node.capture = {
        ...(item.source
          ? {
              source: item.source.dev
                ? item.source
                : {
                    url: item.source.url,
                    selector: item.source.selector,
                    xpath: item.source.xpath,
                  },
            }
          : {}),
        ...(item.states ? { states: item.states } : {}),
        ...(item.transitions?.length ? { transitions: item.transitions } : {}),
      };
      const notes = interactionNotes(item);
      if (notes.length) node.capture.notes = notes;
    }
    return node;
  });
  // Wonder PM4: the layer of a captured text element lands with Clip content on.
  if (snapshot.element)
    for (const node of nodes) if (!node.parentId && node.type === "text") node.clipContent = true;
  const backdrop = snapshot.element && cssColorHex(snapshot.backdrop || "");
  if (backdrop)
    for (const node of nodes)
      if (!node.parentId && node.type === "text" && !node.backgroundFills)
        node.backgroundFills = [{ type: "solid", color: backdrop }];
  if (!snapshot.element)
    nodes.unshift({
      id: "capture-region",
      parentId: null,
      type: "frame",
      name: "Captured region",
      x: 0,
      y: 0,
      w: snapshot.area.width,
      h: snapshot.area.height,
      color: "transparent",
      text: "",
      fontSize: 16,
      radius: 0,
      clipContent: true,
      layout: "free",
      ...(snapshot.url
        ? { capture: { source: { url: snapshot.url, region: snapshot.area } } }
        : {}),
    });
  return {
    version: 2,
    name: snapshot.title || "Captured app",
    activePage: id,
    pages: [{ id, name: "Capture", nodes }],
    tokens: {},
    ...(snapshot.fontFaces?.length
      ? { fontFaces: snapshot.fontFaces.map(({ source, ...face }) => face) }
      : {}),
  };
}

function escapeHTML(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
const cssString = (value) => '"' + String(value).replace(/["\\<>\n]/g, "") + '"';
function fontFaceCSS(faces) {
  return (faces || [])
    .map(
      (f) =>
        "@font-face{font-family:" +
        cssString(f.family) +
        ";font-weight:" +
        String(f.weight).replace(/[^\w ]/g, "") +
        ";font-style:" +
        String(f.style).replace(/[^\w ]/g, "") +
        ";src:url(" +
        f.src +
        ")" +
        (f.unicodeRange
          ? ";unicode-range:" + String(f.unicodeRange).replace(/[^\w+?, -]/g, "")
          : "") +
        "}",
    )
    .join("");
}

function captureHTML(snapshot, document) {
  const draw = (id) =>
    snapshot.records
      .filter((n) => n.parentId === id)
      .map((item) => {
        const c = item.style;
        const backgrounds = (item.backgrounds || []).map((src) => "url(" + src + ")").join(",");
        const style = `position:absolute;left:${item.x}px;top:${item.y}px;width:${item.w}px;height:${item.h}px;color:${c.color};background-color:${c.backgroundColor};${backgrounds ? `background-image:${backgrounds};background-size:${c.backgroundSize};background-repeat:${c.backgroundRepeat};` : item.gradient ? `background-image:${item.gradient};` : ""}font-size:${c.fontSize};font-family:${c.fontFamily};font-weight:${c.fontWeight};border:${c.borderTopWidth} solid ${c.borderTopColor};box-shadow:${c.boxShadow};`;
        return `<div data-design-type="${item.type}" style="${escapeHTML(style)}">${escapeHTML(item.text || "")}${item.src ? '<img src="' + item.src + '">' : ""}${draw(item.id)}</div>`;
      })
      .join("");
  const fonts = fontFaceCSS(document.fontFaces);
  return (
    "<!doctype html><html><head>" +
    (fonts ? "<style>" + fonts + "</style>" : "") +
    '</head><body><main style="position:relative;width:' +
    snapshot.area.width +
    "px;height:" +
    snapshot.area.height +
    'px;overflow:hidden">' +
    draw(null) +
    '</main><script type="application/json" id="verynize-document">' +
    JSON.stringify(document).replaceAll("<", "\\u003c") +
    "</script></body></html>"
  );
}

/**
 * Embed assets and build the document. policy: {origin, crossOrigin, fetcher}. Local captures keep
 * the same-origin rule; remote page capture embeds cross-origin images, backgrounds and fonts.
 */
async function finishSnapshot(snapshot, policy, extraWarnings = []) {
  if (typeof policy === "string") policy = { origin: policy, crossOrigin: false };
  const budget = { bytes: 0 };
  for (const asset of snapshot.assets.slice(0, 40)) {
    try {
      const src = await embedImage(asset.url, policy, budget);
      const record = snapshot.records.find((n) => n.id === asset.id);
      if (asset.kind === "background") (record.backgrounds ||= []).push(src);
      else record.src = src;
    } catch (error) {
      snapshot.warnings.push(
        (asset.kind === "background" ? "CSS background image omitted: " : "") + error.message,
      );
    }
  }
  if (snapshot.assets.length > 40)
    snapshot.warnings.push("Only the first 40 images and backgrounds embedded");
  snapshot.fontFaces = await embedFonts(snapshot, policy);
  snapshot.warnings.push(...extraWarnings);
  const document = captureModel(snapshot);
  return {
    html: captureHTML(snapshot, document),
    document,
    warnings: [...new Set(snapshot.warnings)],
    region: snapshot.area,
  };
}

const validRegion = (region, width, height) =>
  ["x", "y", "width", "height"].every((k) => Number.isFinite(region[k])) &&
  region.x >= 0 &&
  region.y >= 0 &&
  region.width >= 1 &&
  region.height >= 1 &&
  region.x + region.width <= width &&
  region.y + region.height <= height;

module.exports = {
  fontDescriptor,
  snapshotDocument,
  readCaptureStates,
  pageBoxes,
  elementAtPoint,
  cssColorHex,
  familyNames,
  parseFontFaces,
  pickFontSource,
  fontMime,
  embedFonts,
  probeInteractions,
  interactionNotes,
  captureModel,
  captureHTML,
  fontFaceCSS,
  finishSnapshot,
  validRegion,
  STATE_KEYS,
};
