"use strict";
// Custom caret for the on-canvas text editor (Wonder TX1-click, TX1-drag).
// Wonder's caret is 1.5 CSS px wide and one line tall (14.5 px for Inter 12 at 100 %: TX1-click measures 3 × 29 device
// px at 2×, starting at the text's left edge). Chromium's native caret is 1 px and cannot be widened, so the editor
// hides it (caret-color: transparent) and this module draws one in #canvas-overlay instead.
// - Position: the collapsed selection range's client rect (the editor keeps focus and its native selection); an empty
//   layer has no rect, so the caret goes to the start of the first line from the box and its alignment.
// - Size: 1.5 screen px at every zoom; the height follows the line box, so it scales with the zoom like the text
//   (Wonder R7, notes-2026-10-31-c.md: 1.5 × 14.5 px at 100 %, 1.5 × 58 px at 400 %).
// - Colour: BetterCanvas.inkAt, the rule that picks a new text's ink (black on light, white on dark).
// - Blink: 500 ms on, 500 ms off, restarted (solid) whenever the text or the caret moves.
// - Hidden for a range selection, during IME composition, and when the editor loses focus or editing ends.
(() => {
  const WIDTH = 1.5; // screen CSS px at any zoom (Wonder R7)
  const BLINK = 1000; // one on/off cycle, as Chromium's caret
  const EDITOR = "#canvas .layer[data-text-editing]";
  const STYLE = `${EDITOR}{caret-color:transparent}
#canvas-overlay .text-caret{position:absolute;left:0;top:0;transform-origin:0 50%;pointer-events:none;will-change:transform}`;
  let caret = null,
    blink = null,
    frame = 0,
    composing = false,
    away = false,
    last = "";

  function editor() {
    const el = document.activeElement;
    return !away && el?.matches?.(EDITOR) ? el : null; // like the native caret, none while the window is in the background
  }
  function ensureCaret() {
    const overlay = document.getElementById("canvas-overlay");
    if (!overlay) return null;
    if (!document.getElementById("text-caret-style")) {
      const style = document.createElement("style");
      style.id = "text-caret-style";
      style.textContent = STYLE;
      document.head.append(style);
    }
    if (!caret) {
      caret = document.createElement("div");
      caret.className = "text-caret";
      caret.setAttribute("aria-hidden", "true");
      caret.hidden = true;
    }
    if (caret.parentNode !== overlay) overlay.append(caret);
    return caret;
  }
  // Linear part of the element's accumulated CSS transforms: canvas zoom and any layer rotation.
  function transformOf(el) {
    let m = new DOMMatrix();
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      const t = getComputedStyle(node).transform;
      if (t && t !== "none") m = new DOMMatrix(t).multiply(m);
    }
    return { scale: Math.hypot(m.a, m.b) || 1, angle: Math.atan2(m.b, m.a) };
  }
  // The caret line as {x, y} (screen centre of the line), h (screen height), plus the layer's scale and angle.
  function geometry(el, range) {
    const t = transformOf(el),
      rects = [...range.getClientRects()].filter((r) => r.height > 0);
    // A collapsed range at a soft wrap can report the end of one line and the start of the next: take the later one.
    const r =
      rects.at(-1) ||
      (range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer.childNodes[range.startOffset]?.getBoundingClientRect?.()
        : null);
    if (r && r.height > 0)
      return {
        ...t,
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        h: Math.hypot(r.width, r.height),
      };
    // Empty layer: the start of the first line, from the box, its padding and its alignment (in the layer's own px).
    const cs = getComputedStyle(el),
      px = (v) => parseFloat(v) || 0;
    const w = el.offsetWidth,
      h = el.offsetHeight;
    const left = px(cs.paddingLeft) + px(cs.borderLeftWidth),
      right = px(cs.paddingRight) + px(cs.borderRightWidth);
    const top = px(cs.paddingTop) + px(cs.borderTopWidth),
      bottom = px(cs.paddingBottom) + px(cs.borderBottomWidth);
    const inner = h - top - bottom,
      size = px(cs.fontSize) || 12;
    let line = px(cs.lineHeight);
    if (!line) line = inner > 0 && inner < size * 2 ? inner : size * 1.21; // 'normal': a hugging box is one line tall
    const align = cs.textAlign,
      rtl = cs.direction === "rtl";
    const lx =
      align === "center"
        ? left + (w - left - right) / 2
        : align === "right" || (align === "end" && !rtl) || (align === "start" && rtl)
          ? w - right
          : left;
    const va = cs.alignContent,
      ly =
        top +
        (va === "center"
          ? (inner - line) / 2
          : va === "flex-end" || va === "end"
            ? inner - line
            : 0) +
        line / 2;
    const box = el.getBoundingClientRect(),
      dx = (lx - w / 2) * t.scale,
      dy = (ly - h / 2) * t.scale;
    const cos = Math.cos(t.angle),
      sin = Math.sin(t.angle);
    return {
      ...t,
      x: box.left + box.width / 2 + dx * cos - dy * sin,
      y: box.top + box.height / 2 + dx * sin + dy * cos,
      h: line * t.scale,
    };
  }
  function hide() {
    if (caret && !caret.hidden) {
      caret.hidden = true;
      delete caret.dataset.color;
    }
    last = "";
  }
  function restartBlink() {
    if (!caret) return;
    if (!blink)
      blink = caret.animate(
        [{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }],
        { duration: BLINK, iterations: Infinity },
      );
    blink.currentTime = 0;
  }
  function update() {
    const el = editor(),
      selection = getSelection();
    if (!el || composing || !selection.rangeCount || !selection.isCollapsed) return hide();
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer)) return hide();
    const c = ensureCaret();
    if (!c) return;
    const g = geometry(el, range),
      overlay = c.parentNode.getBoundingClientRect();
    const width = WIDTH,
      deg = (g.angle * 180) / Math.PI;
    const x = g.x - overlay.left,
      y = g.y - overlay.top - g.h / 2;
    const key = [x, y, g.h, width, deg].map((v) => Math.round(v * 100) / 100).join();
    if (key === last && !c.hidden) return;
    last = key;
    c.style.width = width + "px";
    c.style.height = g.h + "px";
    c.style.transform = `translate(${x}px, ${y}px)` + (deg ? ` rotate(${deg}deg)` : "");
    const color = window.BetterCanvas?.inkAt
      ? window.BetterCanvas.inkAt(g.x + width / 2, g.y)
      : "#000000";
    if (c.dataset.color !== color) {
      c.dataset.color = color;
      c.style.background = color;
    }
    if (c.hidden) {
      c.hidden = false;
      restartBlink();
    }
  }
  // While an editor has focus the caret follows every frame: typing, wraps, zoom and panning all move it.
  function loop() {
    frame = 0;
    update();
    if (editor()) frame = requestAnimationFrame(loop);
    else hide();
  }
  function wake(solid) {
    if (!editor()) {
      hide();
      return;
    }
    if (solid) {
      update();
      restartBlink();
    }
    if (!frame) frame = requestAnimationFrame(loop);
  }
  document.addEventListener("selectionchange", () => wake(true));
  document.addEventListener(
    "input",
    (e) => {
      if (e.target?.matches?.(EDITOR)) wake(true);
    },
    true,
  );
  document.addEventListener("focusin", () => wake(true));
  document.addEventListener("focusout", () => setTimeout(() => wake(false)));
  window.addEventListener("blur", (e) => {
    if (e.target === window) {
      away = true;
      hide();
    }
  });
  window.addEventListener("focus", (e) => {
    if (e.target === window) {
      away = false;
      wake(true);
    }
  });
  document.addEventListener(
    "compositionstart",
    (e) => {
      if (e.target?.matches?.(EDITOR)) {
        composing = true;
        hide();
      }
    },
    true,
  );
  document.addEventListener(
    "compositionend",
    (e) => {
      if (e.target?.matches?.(EDITOR)) {
        composing = false;
        wake(true);
      }
    },
    true,
  );
})();
