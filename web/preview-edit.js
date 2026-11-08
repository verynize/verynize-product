"use strict";
// Edit and Capture modes of the live preview frame (Wonder PM3 / PM4 / PM5 / X2 / PP2).
// - Edit: hovering the running app outlines DOM elements, a click selects one (corner marks, "W Fill x H Hug" badge,
//   ⊕ "Add to chat ⌘L"), the inspector island shows it (web/src/islands/inspector/preview-element.tsx), a double-click
//   edits text in place. Every change is STAGED: applied to the live DOM only (desktop/preview-dom.cjs), listed by the
//   frame's amber "N changes" badge (web/src/islands/chrome/preview-changes.tsx), undoable, never written to code.
// - Capture: hovering outlines the element with a "W × H" badge and a keyboard strip; a click / Return captures it as
//   native layers beside the preview (web/live-preview.js captureElement), ⌘Return captures the whole viewport.
// The overlay lives inside the frame's .live-frame-wrap (canvas space); strokes and labels divide by the camera zoom
// (--iz on #canvas), so they stay screen-sized. The iframe stays inert (pointer-events:none) except while editing text.
(() => {
  const lp = () => window.livePreview;
  const dom = (options) => window.desktop.previewDom(options);
  const store = new Map(); // frameId → {changes, originals, past, future, hideAll}
  const layers = new Map(); // frameId → overlay parts
  let ctx = { frameId: null, mode: "select", state: "" };
  let hovered = null,
    picked = null,
    target = null,
    editing = null,
    probing = false,
    queued = null;

  const frameState = (id) => {
    if (!store.has(id))
      store.set(id, { changes: [], originals: new Map(), past: [], future: [], hideAll: false });
    return store.get(id);
  };
  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
  const short = (text, max) => (text.length > max ? text.slice(0, max) + "…" : text);
  const r2 = (v) => Math.round(v * 100) / 100;
  const emit = () => {
    window.dispatchEvent(new Event("bd:preview-edits"));
    window.dispatchEvent(new Event("bd:preview-element"));
  };

  // ---------- Overlay ----------
  function overlay(id) {
    const el = lp()?.nodeElement?.(id),
      wrap = el?.querySelector(".live-frame-wrap");
    if (!wrap) return null;
    let parts = layers.get(id);
    if (parts && parts.layer.isConnected && parts.wrap === wrap) return parts;
    const layer = document.createElement("div");
    layer.className = "pedit-layer";
    layer.hidden = true;
    layer.innerHTML =
      '<div class="pedit-box pedit-hover" hidden><span class="pedit-tag"></span></div>' +
      '<div class="pedit-box pedit-picked" hidden><i data-corner="nw"></i><i data-corner="ne"></i><i data-corner="sw"></i><i data-corner="se"></i><span class="pedit-badge"></span><button type="button" class="pedit-chat" aria-label="Add to chat"><span class="pedit-tip" role="tooltip">Add to chat<kbd>⌘L</kbd></span></button></div>' +
      '<div class="pedit-keys" role="note" aria-label="Capture shortcuts" hidden>' +
      '<span title="Previous / next sibling, parent, child"><kbd>◁</kbd><kbd>▽</kbd><kbd>△</kbd><kbd>▷</kbd></span>' +
      '<span title="Outermost section / innermost element"><kbd>⇧</kbd><b>+</b><kbd>△</kbd><kbd>▽</kbd></span>' +
      '<span title="Capture this element"><kbd>↵</kbd></span>' +
      '<span title="Capture the whole page"><kbd>⌘</kbd><b>+</b><kbd>↵</kbd></span>' +
      '<span title="Exit capture"><kbd class="pedit-esc">esc</kbd></span></div>';
    wrap.append(layer);
    parts = {
      el,
      wrap,
      layer,
      frame: wrap.querySelector("iframe"),
      hover: layer.querySelector(".pedit-hover"),
      picked: layer.querySelector(".pedit-picked"),
      keys: layer.querySelector(".pedit-keys"),
    };
    parts.badge = parts.picked.querySelector(".pedit-badge");
    parts.tag = parts.hover.querySelector(".pedit-tag");
    const chat = parts.picked.querySelector(".pedit-chat");
    chat.addEventListener("pointerdown", (event) => event.stopPropagation());
    chat.addEventListener("click", (event) => {
      event.stopPropagation();
      addToChat();
    });
    layer.addEventListener("pointermove", (event) => {
      if (event.target.closest(".pedit-chat")) {
        if (ctx.mode === "edit" && hovered) {
          hovered = null;
          draw();
        }
        return;
      }
      if (!editing) probe(id, point(parts, event));
    });
    layer.addEventListener("pointerleave", () => {
      if (ctx.mode === "edit") {
        hovered = null;
        draw();
      }
    });
    layer.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      void press(id, point(parts, event));
    });
    layer.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (ctx.mode === "edit" && picked) void startText(id, picked, point(parts, event));
    });
    layer.addEventListener("contextmenu", (event) => event.stopPropagation());
    // A reload of the app drops live DOM edits: put the staged ones back.
    parts.frame.addEventListener("load", () => {
      if (frameState(id).changes.length) setTimeout(() => void sync(id), 50);
    });
    layers.set(id, parts);
    return parts;
  }
  // Pointer → page viewport CSS px (the iframe is unscaled inside the zoomed canvas layer).
  function point(parts, event) {
    const r = parts.frame.getBoundingClientRect();
    return {
      x: ((event.clientX - r.left) * parts.frame.clientWidth) / r.width,
      y: ((event.clientY - r.top) * parts.frame.clientHeight) / r.height,
    };
  }
  function place(parts, box, element) {
    Object.assign(box.style, {
      left: parts.frame.offsetLeft + element.box.x + "px",
      top: parts.frame.offsetTop + element.box.y + "px",
      width: element.box.width + "px",
      height: element.box.height + "px",
    });
    box.hidden = false;
  }
  const sizeLabel = (e) =>
    `${r2(e.box.width)}${e.sizing?.w ? " " + e.sizing.w : ""} x ${r2(e.box.height)}${e.sizing?.h ? " " + e.sizing.h : ""}`;
  function draw() {
    for (const [id, parts] of layers) {
      const active = id === ctx.frameId && (ctx.mode === "edit" || ctx.mode === "capture");
      parts.layer.hidden = !active;
      parts.layer.dataset.mode = active ? ctx.mode : "";
      parts.layer.classList.toggle("pedit-editing", !!editing);
      if (!active) continue;
      const shown = ctx.mode === "capture" ? target || hovered : hovered;
      if (shown && !editing && (ctx.mode === "capture" || shown.path !== picked?.path)) {
        place(parts, parts.hover, shown);
        parts.tag.textContent =
          ctx.mode === "capture"
            ? `${Math.round(shown.box.width)} × ${Math.round(shown.box.height)}`
            : "";
        parts.tag.hidden = ctx.mode !== "capture";
      } else parts.hover.hidden = true;
      if (ctx.mode === "edit" && picked && !editing) {
        place(parts, parts.picked, picked);
        parts.badge.textContent = sizeLabel(picked);
      } else parts.picked.hidden = true;
      parts.keys.hidden = ctx.mode !== "capture";
    }
  }

  // ---------- Hit testing ----------
  async function probe(id, at) {
    if (probing) {
      queued = { id, at };
      return;
    }
    probing = true;
    try {
      const found = await dom({ op: "at", x: at.x, y: at.y });
      if (ctx.frameId === id && !editing) {
        hovered = found;
        if (ctx.mode === "capture") target = found;
        draw();
      }
    } catch {
      /* the page may be navigating */
    }
    probing = false;
    if (queued) {
      const next = queued;
      queued = null;
      void probe(next.id, next.at);
    }
  }
  async function press(id, at) {
    if (editing) {
      await finishText();
      return;
    }
    let found = null;
    try {
      found = await dom({ op: "at", x: at.x, y: at.y });
    } catch (error) {
      console.warn(error);
    }
    if (!found || ctx.frameId !== id) return;
    if (ctx.mode === "capture") {
      target = found;
      draw();
      await captureTarget();
      return;
    }
    if (ctx.mode !== "edit") return;
    picked = found;
    hovered = found;
    draw();
    emit();
  }

  // ---------- Direct text editing ----------
  async function startText(id, element, at) {
    if (!element.leaf) return;
    const parts = layers.get(id);
    // Focus the frame first: focusing it after the element would blur the element and end the edit at once.
    parts.frame.style.pointerEvents = "auto";
    parts.frame.focus();
    try {
      const result = await dom({ op: "textStart", path: element.path, x: at.x, y: at.y });
      editing = { id, path: element.path, before: result.before, element };
      draw();
      emit();
    } catch (error) {
      parts.frame.style.pointerEvents = "none";
      console.warn(error);
    }
  }
  async function finishText() {
    const current = editing;
    if (!current) return;
    editing = null;
    const parts = layers.get(current.id);
    if (parts) parts.frame.style.pointerEvents = "none";
    let result = null;
    try {
      result = await dom({ op: "textEnd" });
    } catch {
      /* page gone: nothing to stage */
    }
    if (result) {
      stage(current.id, {
        path: result.path,
        element: result.element || current.element,
        kind: "text",
        prop: "text",
        original: result.before,
        from: result.before,
        after: result.after,
      });
      if (result.element && ctx.frameId === current.id) picked = result.element;
    }
    draw();
    emit();
  }
  window.addEventListener("message", (event) => {
    if (event.data?.type !== "verynize-preview-text-done" || !editing) return;
    const parts = layers.get(editing.id);
    if (parts && event.source === parts.frame.contentWindow) void finishText();
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (editing && !event.target.closest?.(".pedit-layer")) void finishText();
    },
    true,
  );

  // ---------- Staged changes ----------
  const PROPS = {
    text: "Text",
    width: "Width",
    height: "Height",
    "min-width": "Min width",
    "min-height": "Min height",
    "padding-inline": "Horizontal padding",
    "padding-block": "Vertical padding",
    "margin-inline": "Horizontal margin",
    "margin-block": "Vertical margin",
    opacity: "Opacity",
    "border-radius": "Corner radius",
    overflow: "Clip content",
    "font-family": "Font",
    "font-weight": "Weight",
    "font-size": "Font size",
    "line-height": "Line height",
    "letter-spacing": "Letter spacing",
    color: "Text fill",
    "background-color": "Background",
    "text-align": "Alignment",
  };
  const snapshot = (s) => JSON.stringify(s.changes);
  function remember(s) {
    s.past.push(snapshot(s));
    if (s.past.length > 100) s.past.shift();
    s.future = [];
  }
  function stage(id, edit) {
    const s = frameState(id),
      key = edit.path + "|" + edit.prop;
    if (!s.originals.has(key))
      s.originals.set(key, {
        path: edit.path,
        kind: edit.kind,
        prop: edit.prop,
        original: edit.original,
      });
    const existing = s.changes.find((c) => c.key === key);
    const original = s.originals.get(key).original;
    if (!existing && edit.after === original) return;
    remember(s);
    if (existing) existing.after = edit.after;
    else
      s.changes.push({
        key,
        path: edit.path,
        kind: edit.kind,
        prop: edit.prop,
        label: PROPS[edit.prop] || edit.prop,
        tag: edit.element?.tag || "",
        // The element is named by its text before any staged edit (Wonder X2: h1 "<original heading>").
        text:
          s.changes.find((c) => c.path === edit.path)?.text ??
          (edit.kind === "text"
            ? edit.original.replace(/\s+/g, " ").trim()
            : edit.element?.text || ""),
        from: edit.from,
        after: edit.after,
        hidden: false,
      });
    if (edit.after === original) s.changes = s.changes.filter((c) => c.key !== key);
    void sync(id, [key]);
  }
  // Put the page in the state the staged list describes (hidden changes show the original value).
  async function sync(id, keys = null) {
    const s = frameState(id),
      ops = [];
    for (const [key, base] of s.originals) {
      if (keys && !keys.includes(key)) continue;
      const change = s.changes.find((c) => c.key === key);
      const value = change && !change.hidden && !s.hideAll ? change.after : base.original;
      ops.push({
        path: base.path,
        kind: base.kind,
        ...(base.kind === "style" ? { prop: base.prop } : {}),
        value: base.kind === "style" && value === "" ? null : value,
      });
    }
    emit();
    if (!ops.length || id !== lp()?.getNodeId?.()) return;
    try {
      await dom({ op: "apply", ops });
    } catch (error) {
      console.warn(error);
    }
    if (picked && ctx.frameId === id) {
      try {
        picked = (await dom({ op: "describe", path: picked.path })) || picked;
      } catch {
        /* element removed */
      }
    }
    draw();
    emit();
  }
  function restore(id, list) {
    const s = frameState(id);
    s.changes = JSON.parse(list);
    void sync(id);
  }
  function undo(id = ctx.frameId) {
    const s = id && store.get(id);
    if (!s?.past.length) return false;
    s.future.push(snapshot(s));
    restore(id, s.past.pop());
    return true;
  }
  function redo(id = ctx.frameId) {
    const s = id && store.get(id);
    if (!s?.future.length) return false;
    s.past.push(snapshot(s));
    restore(id, s.future.pop());
    return true;
  }
  function revert(id, key) {
    const s = frameState(id);
    if (!s.changes.some((c) => c.key === key)) return;
    remember(s);
    s.changes = s.changes.filter((c) => c.key !== key);
    void sync(id, [key]);
  }
  function revertAll(id) {
    const s = frameState(id);
    if (!s.changes.length) return;
    remember(s);
    s.changes = [];
    s.hideAll = false;
    void sync(id);
  }
  function toggleHidden(id, key) {
    const c = frameState(id).changes.find((c) => c.key === key);
    if (!c) return;
    c.hidden = !c.hidden;
    void sync(id, [key]);
  }
  function toggleHideAll(id) {
    const s = frameState(id);
    s.hideAll = !s.hideAll;
    void sync(id);
  }
  // Discarding puts the page back too (a stop that then fails must not leave unlisted edits on screen).
  function discard(id) {
    const s = store.get(id);
    if (s) {
      s.changes = [];
      s.hideAll = false;
      s.past = [];
      s.future = [];
      void sync(id).then(() => {
        if (!count(id)) store.delete(id);
      });
    }
    if (editing?.id === id) editing = null;
    if (ctx.frameId === id) {
      picked = hovered = target = null;
    }
    draw();
    emit();
  }
  function count(id) {
    return store.get(id)?.changes.length || 0;
  }

  // Stop paths (frame Stop, chat header Stop) await this; the chrome island renders the dialog.
  function confirmBeforeStop(id) {
    const n = count(id);
    if (!n) return Promise.resolve(true);
    return new Promise((resolve) => {
      const detail = {
        frameId: id,
        count: n,
        handled: false,
        resolve: (ok) => {
          if (ok) discard(id);
          resolve(!!ok);
        },
      };
      window.dispatchEvent(new CustomEvent("bd:preview-discard-confirm", { detail }));
      if (!detail.handled)
        detail.resolve(
          window.confirm(
            `Discard preview edits?\n${plural(n, "unsaved edit")} will be lost when this preview stops.`,
          ),
        );
    });
  }

  // Inspector edits on the selected DOM element (value '' clears the staged value back to the page's own).
  function setStyle(prop, value) {
    if (!picked || !ctx.frameId) return;
    const s = frameState(ctx.frameId),
      key = picked.path + "|" + prop,
      base = s.originals.get(key);
    const original = base ? base.original : picked.inline?.[prop] || "";
    stage(ctx.frameId, {
      path: picked.path,
      element: picked,
      kind: "style",
      prop,
      original,
      from: displayValue(prop, picked),
      after: value === "" ? original : value,
    });
  }
  function displayValue(prop, e) {
    const st = e.styles || {};
    return (
      {
        width: st.width,
        height: st.height,
        "min-width": st.minWidth,
        "min-height": st.minHeight,
        "padding-inline": st.paddingLeft,
        "padding-block": st.paddingTop,
        "margin-inline": st.marginLeft,
        "margin-block": st.marginTop,
        opacity: st.opacity,
        "border-radius": st.borderRadius,
        overflow: st.overflow,
        "font-family": st.fontFamily,
        "font-weight": st.fontWeight,
        "font-size": st.fontSize,
        "line-height": st.lineHeight,
        "letter-spacing": st.letterSpacing,
        color: st.color,
        "background-color": st.backgroundColor,
        "text-align": st.textAlign,
      }[prop] || ""
    );
  }

  // ---------- Add to chat (PM5) ----------
  function elementLabel(e) {
    return e.tag + (e.text ? ' "' + e.text + '"' : "");
  }
  function addToChat() {
    if (!picked) return false;
    const ws = window.agentWorkspace;
    if (!ws?.addMention) return false;
    ws.openChat?.();
    const doc = window.design.getDocument();
    ws.addMention({
      id: "preview:" + picked.ref,
      label: short(elementLabel(picked), 18),
      pageId: doc.activePage,
      type: "element",
    });
    // Wonder PM5: the composer shows only the element chip. The preview frame's own selection chip is dismissed
    // (until the canvas selection changes), so the agent is not handed the whole frame as well.
    if (ctx.frameId) ws.removeMention?.(ctx.frameId);
    requestAnimationFrame(() => document.getElementById("project-prompt")?.focus());
    return true;
  }

  // ---------- Capture (PM4) ----------
  async function captureTarget(whole = false) {
    const element = target;
    if (!whole && !element) return;
    try {
      await (whole ? lp().captureSelected() : lp().captureElement(element.path));
    } catch (error) {
      console.warn(error);
    }
  }
  async function move(dir) {
    const from = target || hovered;
    if (!from) return;
    try {
      const next = await dom({ op: "relative", path: from.path, dir });
      if (next) {
        target = next;
        draw();
      }
    } catch {
      /* page changed */
    }
  }

  // ---------- Keyboard ----------
  const typing = (el) =>
    el?.closest?.(
      'input,textarea,select,[contenteditable=""],[contenteditable=true],[role=dialog],[role=alertdialog],[role=menu]',
    );
  window.addEventListener(
    "keydown",
    (event) => {
      const mod = event.metaKey || event.ctrlKey,
        key = event.key;
      // ⌘⇧I: Inspect element (toggle Edit mode on the selected running preview).
      if (mod && event.shiftKey && !event.altKey && key.toLowerCase() === "i") {
        const sel = lp()?.getSelectionState?.();
        if (sel && sel.state === "running") {
          event.preventDefault();
          event.stopImmediatePropagation();
          lp().setMode(sel.mode === "edit" ? "select" : "edit");
        }
        return;
      }
      if (!ctx.frameId || editing || typing(event.target)) return;
      const stop = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      if (ctx.mode === "edit") {
        if (mod && !event.altKey && key.toLowerCase() === "z") {
          if (event.shiftKey ? redo() : undo()) stop();
          return;
        }
        if (mod && !event.shiftKey && key.toLowerCase() === "l" && picked) {
          if (addToChat()) stop();
          return;
        }
        if (key === "Escape") {
          stop();
          if (picked) {
            picked = null;
            draw();
            emit();
          } else lp().setMode("select");
        }
        return;
      }
      if (ctx.mode === "capture") {
        if (key === "Escape") {
          stop();
          lp().setMode("select");
          return;
        }
        if (key === "Enter") {
          stop();
          void captureTarget(mod);
          return;
        }
        const dirs = {
          ArrowUp: event.shiftKey ? "top" : "parent",
          ArrowDown: event.shiftKey ? "deepest" : "child",
          ArrowLeft: "prev",
          ArrowRight: "next",
        };
        if (dirs[key] && !mod) {
          stop();
          void move(dirs[key]);
        }
      }
    },
    true,
  );

  // ---------- Mode / selection tracking ----------
  let modeElement = null;
  function refresh() {
    const sel = lp()?.getSelectionState?.() || null;
    const next = {
      frameId: sel?.nodeId || null,
      mode: sel?.mode || "select",
      state: sel?.state || "",
    };
    for (const id of store.keys()) if (!lp()?.nodeElement?.(id)) store.delete(id);
    if (next.frameId === ctx.frameId && next.mode === ctx.mode && next.state === ctx.state) return;
    const left = next.frameId !== ctx.frameId || next.mode !== ctx.mode;
    if (left && editing) void finishText();
    if (left) {
      hovered = target = null;
      if (next.frameId !== ctx.frameId || next.mode !== "edit") picked = null;
    }
    ctx = next;
    const el = ctx.frameId && lp()?.nodeElement?.(ctx.frameId);
    if (modeElement && modeElement !== el) delete modeElement.dataset.previewMode;
    modeElement = el || null;
    if (el) {
      if (ctx.mode !== "select" && ctx.state === "running") el.dataset.previewMode = ctx.mode;
      else delete el.dataset.previewMode;
    }
    document.body.classList.toggle("preview-mode-active", !!el?.dataset.previewMode);
    if (ctx.frameId && (ctx.mode === "edit" || ctx.mode === "capture")) overlay(ctx.frameId);
    draw();
    emit();
  }
  window.addEventListener("bd:preview-state", refresh);

  window.previewEdits = {
    count,
    confirmBeforeStop,
    discard,
    changes: (id) => (store.get(id)?.changes || []).map((c) => ({ ...c })),
    hiddenAll: (id) => !!store.get(id)?.hideAll,
    toggleHidden,
    toggleHideAll,
    revert,
    revertAll,
    undo,
    redo,
    canUndo: (id = ctx.frameId) => !!store.get(id)?.past.length,
    canRedo: (id = ctx.frameId) => !!store.get(id)?.future.length,
    frames: () => [...store.keys()].filter((id) => count(id) > 0),
    selection: () =>
      picked && ctx.frameId ? { frameId: ctx.frameId, element: picked, editing: !!editing } : null,
    elementLabel,
    setStyle,
    addToChat,
    // Test and automation hooks.
    hovered: () => hovered,
    target: () => target,
    select: async (path) => {
      picked = await dom({ op: "describe", path });
      draw();
      emit();
      return picked;
    },
  };
})();
