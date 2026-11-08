"use strict";
// Edit and Capture modes of the embedded running-app preview (web/preview-edit.js).
// previewDom() runs inside the localhost preview frame through webFrameMain.executeJavaScript with a
// JSON-encoded argument; the renderer never sends code. Elements are addressed by a structural CSS
// path (`#id` anchor or `tag:nth-of-type(n)` chain) so staged edits survive a reload of the page.
// Every write is transient: it changes the live DOM only and never touches source files.

/* In-page. One entry point keeps the injected surface small; `op` selects the action. */
function previewDom(options) {
  const STYLE_PROPS = [
    "width",
    "height",
    "min-width",
    "min-height",
    "padding-inline",
    "padding-block",
    "margin-inline",
    "margin-block",
    "opacity",
    "border-radius",
    "overflow",
    "font-family",
    "font-weight",
    "font-size",
    "line-height",
    "letter-spacing",
    "color",
    "background-color",
    "text-align",
  ];
  const SKIP = "script,style,link,meta,head,template,noscript";
  const state = window.__verynizeDom || (window.__verynizeDom = { editing: null });
  const round = (v) => Math.round(v * 100) / 100;
  const plainId = (id) =>
    /^[A-Za-z][\w-]*$/.test(id) && document.querySelectorAll("#" + CSS.escape(id)).length === 1;
  function pathOf(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      if (n.id && plainId(n.id)) {
        parts.unshift("#" + n.id);
        break;
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
  // Agent-facing reference (chat mentions accept [A-Za-z0-9_.:#/-] only): body/main/h1.2
  function refOf(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      if (n.id && /^[A-Za-z][\w-]*$/.test(n.id) && plainId(n.id)) {
        parts.unshift("#" + n.id);
        break;
      }
      const same = n.parentElement
        ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName)
        : [];
      parts.unshift(n.tagName.toLowerCase() + (same.length > 1 ? "." + (same.indexOf(n) + 1) : ""));
    }
    return parts.join("/").slice(-120);
  }
  function find(path) {
    if (typeof path !== "string" || !path || path.length > 1000)
      throw Error("An element path is required");
    let el = null;
    try {
      el = document.querySelector(path);
    } catch {
      throw Error("Invalid element path");
    }
    if (!el || !(el instanceof HTMLElement || el instanceof SVGElement))
      throw Error("The element is no longer on the page");
    return el;
  }
  const usable = (el) =>
    el && el.nodeType === 1 && el !== document.documentElement && !el.matches(SKIP);
  const leaf = (el) =>
    el instanceof HTMLElement &&
    !el.children.length &&
    !el.matches("input,textarea,select,img,svg,video,canvas,iframe,object,embed") &&
    !!el.textContent.trim();
  // Wonder-style sizing words: Fill (stretches to the parent), Hug (sized by content), fixed otherwise.
  function sizing(el, rect, css) {
    if (!(el instanceof HTMLElement) || css.display === "inline" || css.display === "contents")
      return { w: "Hug", h: "Hug" };
    const saved = el.getAttribute("style");
    el.style.setProperty("width", "auto", "important");
    const autoW = el.getBoundingClientRect().width;
    if (saved === null) el.removeAttribute("style");
    else el.setAttribute("style", saved);
    el.style.setProperty("height", "auto", "important");
    const autoH = el.getBoundingClientRect().height;
    if (saved === null) el.removeAttribute("style");
    else el.setAttribute("style", saved);
    const parent = el.parentElement,
      pcss = parent && getComputedStyle(parent);
    const inner = parent
      ? parent.clientWidth -
        parseFloat(pcss.paddingLeft) -
        parseFloat(pcss.paddingRight) -
        parseFloat(css.marginLeft) -
        parseFloat(css.marginRight)
      : innerWidth;
    const w =
      Math.abs(autoW - rect.width) > 0.5 ? "" : Math.abs(rect.width - inner) < 1 ? "Fill" : "Hug";
    const h = Math.abs(autoH - rect.height) > 0.5 ? "" : "Hug";
    return { w, h };
  }
  function describe(el) {
    if (!usable(el)) return null;
    const rect = el.getBoundingClientRect(),
      css = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200);
    return {
      path: pathOf(el),
      ref: refOf(el),
      tag,
      text,
      leaf: leaf(el),
      box: {
        x: round(rect.left),
        y: round(rect.top),
        width: round(rect.width),
        height: round(rect.height),
      },
      position: { x: round(rect.left + scrollX), y: round(rect.top + scrollY) },
      viewport: { width: innerWidth, height: innerHeight },
      sizing: sizing(el, rect, css),
      styles: {
        width: css.width,
        height: css.height,
        minWidth: css.minWidth,
        minHeight: css.minHeight,
        paddingLeft: css.paddingLeft,
        paddingRight: css.paddingRight,
        paddingTop: css.paddingTop,
        paddingBottom: css.paddingBottom,
        marginLeft: css.marginLeft,
        marginRight: css.marginRight,
        marginTop: css.marginTop,
        marginBottom: css.marginBottom,
        opacity: css.opacity,
        borderRadius: css.borderTopLeftRadius,
        overflow: css.overflow,
        fontFamily: css.fontFamily,
        fontWeight: css.fontWeight,
        fontSize: css.fontSize,
        lineHeight: css.lineHeight,
        letterSpacing: css.letterSpacing,
        color: css.color,
        backgroundColor: css.backgroundColor,
        textAlign: css.textAlign,
        display: css.display,
      },
      inline: Object.fromEntries(
        STYLE_PROPS.map((p) => [p, el instanceof HTMLElement ? el.style.getPropertyValue(p) : ""]),
      ),
    };
  }
  function checkStyle(prop, value) {
    if (!STYLE_PROPS.includes(prop)) throw Error("Unsupported style: " + prop);
    if (value === null || value === "") return;
    if (
      typeof value !== "string" ||
      value.length > 200 ||
      /url\s*\(|expression|[{};<>]/i.test(value) ||
      !CSS.supports(prop, value)
    )
      throw Error("Unsupported value for " + prop);
  }
  function finishText() {
    const editing = state.editing;
    if (!editing) return null;
    state.editing = null;
    const { el, before, cleanup } = editing;
    cleanup();
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-verynize-editing");
    document.getElementById("verynize-edit-style")?.remove();
    window.getSelection()?.removeAllRanges();
    const after = el.textContent;
    return { path: pathOf(el), before, after, element: describe(el) };
  }
  switch (options.op) {
    case "at": {
      let el = document.elementFromPoint(options.x, options.y);
      while (el && !usable(el)) el = el.parentElement;
      if (!el || el === document.documentElement) return null;
      return describe(el);
    }
    case "describe":
      return describe(find(options.path));
    case "relative": {
      const el = find(options.path);
      const kids = (n) =>
        [...n.children].filter((c) => usable(c) && c.getBoundingClientRect().width > 0);
      let next = null;
      if (options.dir === "parent")
        next =
          el.parentElement && el.parentElement !== document.documentElement
            ? el.parentElement
            : null;
      else if (options.dir === "top") {
        next = el;
        while (
          next.parentElement &&
          next.parentElement !== document.body &&
          next.parentElement !== document.documentElement
        )
          next = next.parentElement;
      } else if (options.dir === "child") next = kids(el)[0] || null;
      else if (options.dir === "deepest") {
        next = el;
        while (kids(next).length) next = kids(next)[0];
      } else if (options.dir === "next" || options.dir === "prev") {
        const list = el.parentElement ? kids(el.parentElement) : [];
        const i = list.indexOf(el);
        next = list[i + (options.dir === "next" ? 1 : -1)] || null;
      } else throw Error("Invalid direction");
      return next && next !== el ? describe(next) : null;
    }
    case "apply": {
      if (!Array.isArray(options.ops) || options.ops.length > 500)
        throw Error("Invalid preview edits");
      const missing = [];
      for (const op of options.ops) {
        let el;
        try {
          el = find(op.path);
        } catch {
          missing.push(op.path);
          continue;
        }
        if (op.kind === "text") {
          if (typeof op.value !== "string" || op.value.length > 10000)
            throw Error("Text exceeds the preview edit limit");
          if (!leaf(el) && el.textContent !== op.value && el.children.length)
            throw Error("Text editing requires an element without child elements");
          if (el.textContent !== op.value) el.textContent = op.value;
        } else if (op.kind === "style") {
          checkStyle(op.prop, op.value);
          if (op.value === null || op.value === "") el.style.removeProperty(op.prop);
          else el.style.setProperty(op.prop, op.value);
        } else throw Error("Invalid preview edit");
      }
      return { applied: true, missing };
    }
    case "textStart": {
      finishText();
      const el = find(options.path);
      if (!leaf(el) || el.closest("[contenteditable]"))
        throw Error("Double-click a text element to edit its text");
      const before = el.textContent;
      el.setAttribute("contenteditable", "plaintext-only");
      // Wonder PM3: no page focus ring around the edited text, and a pale purple word selection.
      el.setAttribute("data-verynize-editing", "");
      document.getElementById("verynize-edit-style")?.remove();
      const style = document.createElement("style");
      style.id = "verynize-edit-style";
      style.textContent =
        "[data-verynize-editing]{outline:none!important}[data-verynize-editing]::selection{background:rgba(162,69,211,.3)}";
      (document.head || document.documentElement).append(style);
      el.focus({ preventScroll: true });
      const range =
        typeof options.x === "number" && document.caretRangeFromPoint
          ? document.caretRangeFromPoint(options.x, options.y)
          : null;
      const selection = window.getSelection();
      selection.removeAllRanges();
      if (range && el.contains(range.startContainer)) {
        selection.addRange(range);
        selection.modify("move", "backward", "word");
        selection.modify("extend", "forward", "word");
        // Trailing spaces belong to the next word in the selection model; keep only the word itself.
        const picked = selection.toString();
        const trim = picked.length - picked.trimEnd().length;
        for (let i = 0; i < trim; i++) selection.modify("extend", "backward", "character");
      } else {
        const all = document.createRange();
        all.selectNodeContents(el);
        selection.addRange(all);
      }
      const done = () => {
        if (state.editing?.el === el)
          parent.postMessage({ type: "verynize-preview-text-done" }, "*");
      };
      const onKey = (event) => {
        if (event.key === "Escape" || (event.key === "Enter" && !event.shiftKey)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          done();
        }
      };
      const onDown = (event) => {
        if (!el.contains(event.target)) done();
      };
      el.addEventListener("keydown", onKey, true);
      document.addEventListener("pointerdown", onDown, true);
      // Blur ends the edit, but only once focus has settled (the editor focuses this frame around the call).
      setTimeout(() => {
        if (state.editing?.el === el) el.addEventListener("blur", done);
      }, 100);
      state.editing = {
        el,
        before,
        cleanup: () => {
          el.removeEventListener("keydown", onKey, true);
          el.removeEventListener("blur", done);
          document.removeEventListener("pointerdown", onDown, true);
        },
      };
      return { before, element: describe(el) };
    }
    case "textEnd":
      return finishText();
    default:
      throw Error("Unknown preview operation");
  }
}

const OPS = new Set(["at", "describe", "relative", "apply", "textStart", "textEnd"]);
/** Validate the renderer's request before it reaches the page. */
function domRequest(options) {
  if (!options || typeof options !== "object" || !OPS.has(options.op))
    throw Error("Invalid preview request");
  const out = { op: options.op };
  if (options.op === "at" || options.op === "textStart") {
    if (options.op === "at" && (!Number.isFinite(options.x) || !Number.isFinite(options.y)))
      throw Error("A viewport point is required");
    if (Number.isFinite(options.x) && Number.isFinite(options.y)) {
      out.x = options.x;
      out.y = options.y;
    }
  }
  if (["describe", "relative", "textStart"].includes(options.op)) {
    if (typeof options.path !== "string" || !options.path || options.path.length > 1000)
      throw Error("An element path is required");
    out.path = options.path;
  }
  if (options.op === "relative") {
    if (!["parent", "child", "next", "prev", "top", "deepest"].includes(options.dir))
      throw Error("Invalid direction");
    out.dir = options.dir;
  }
  if (options.op === "apply") {
    if (!Array.isArray(options.ops) || options.ops.length > 500)
      throw Error("Invalid preview edits");
    out.ops = options.ops.map((op) => {
      if (
        !op ||
        typeof op.path !== "string" ||
        op.path.length > 1000 ||
        !["text", "style"].includes(op.kind)
      )
        throw Error("Invalid preview edit");
      if (op.kind === "text" && (typeof op.value !== "string" || op.value.length > 10000))
        throw Error("Text exceeds the preview edit limit");
      if (
        op.kind === "style" &&
        (typeof op.prop !== "string" || (op.value !== null && typeof op.value !== "string"))
      )
        throw Error("Invalid preview edit");
      return {
        path: op.path,
        kind: op.kind,
        ...(op.kind === "style" ? { prop: op.prop } : {}),
        value: op.value,
      };
    });
  }
  return out;
}

module.exports = { previewDom, domRequest };
