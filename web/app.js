"use strict";
const $ = (s) => document.querySelector(s),
  canvas = $("#canvas"),
  form = $("#inspector"),
  uid = () => crypto.randomUUID();
const defaults = {
  type: "rectangle",
  parentId: null,
  name: "Rectangle",
  x: 120,
  y: 150,
  w: 250,
  h: 180,
  color: "#97c3b1",
  text: "",
  fontSize: 32,
  radius: 12,
  zIndex: 0,
  fontFamily: "system-ui",
  fontWeight: "400",
  textAlign: "left",
  layout: "free",
  direction: "row",
  gap: 16,
  padding: 16,
  columns: 2,
  token: "",
  gradient: "",
  mask: "",
  animated: "",
  textRuns: [],
  shaderPreset: "aurora",
  shaderSpeed: 1,
  shaderIntensity: 1,
  rotation: 0,
  opacity: 100,
  strokeWidth: 0,
  strokeColor: "#000000",
  shadow: "",
  clipContent: false,
  lineHeight: 1.15,
  letterSpacing: 0,
  alignItems: "stretch",
  justifyContent: "flex-start",
};
const initial = [
  {
    id: "welcome",
    type: "text",
    name: "Heading",
    x: 75,
    y: 75,
    w: 820,
    h: 140,
    color: "#25252e",
    text: "A little space for\nyour next big idea.",
    fontSize: 56,
    radius: 0,
  },
  {
    id: "card",
    type: "rectangle",
    name: "Violet card",
    x: 75,
    y: 270,
    w: 405,
    h: 300,
    color: "#a58bdd",
    text: "",
    fontSize: 24,
    radius: 24,
  },
  {
    id: "caption",
    type: "text",
    name: "Caption",
    x: 520,
    y: 300,
    w: 350,
    h: 180,
    color: "#55515e",
    text: "Make something yours.\n\nAdd a layer. Change its shape.\nFind a new direction.",
    fontSize: 24,
    radius: 0,
  },
].map((n) => ({ ...defaults, ...n }));
let design = {
    version: 2,
    name: "Untitled",
    activePage: "page-1",
    pages: [{ id: "page-1", name: "Desktop", background: "#f5f3ee", nodes: initial }],
    tokens: {},
  },
  selection = new Set(),
  past = [],
  future = [],
  canvasApi = null;
/* User edits (undo history writes) since launch. Loading a document is undoable but no edit: the file library (web/wonder-shell.js) only turns a document that is no library file into one after an edit. */
let editCount = 0;
past.push = function (...entries) {
  editCount++;
  return Array.prototype.push.apply(this, entries);
};
const camera = { x: 40, y: 60, zoom: 1 };
/* Document schema: web/document-core.js (window.VerynizeDocument), shared with integrations/design-store.mjs. validate() fills the editor defaults, repairs names/active page, checks the shared schema and resolves variable aliases. */
function validate(d) {
  return window.VerynizeDocument.prepareDocument(d, defaults);
}
/* web/document-safety.js: a stored document that no longer loads is kept (backed up, offered as JSON, not overwritten by save()) instead of being replaced; repairs are reported. */ window.documentSafety.configure(
  defaults,
);
try {
  const saved = localStorage.getItem("verynize-v2");
  if (saved) design = window.documentSafety.restore(saved) || design;
  else {
    const old = JSON.parse(localStorage.getItem("verynize-v1"));
    if (Array.isArray(old)) design.pages[0].nodes = old.map((n) => ({ ...defaults, ...n }));
    validate(design);
  }
} catch {}

/* One frozen snapshot shared by all subscribers; getDocument retains its mutable-copy contract. */
const commitState = window.VerynizeCommitState.store();
const subscribers = new Set();
let selectionNotify = 0;
/* Components (web/component-core.js): render() syncs instances with their mains first; in-place edits are diffed against the previous sync's result, so the sync joins the edit's undo step. */ const componentSync =
  window.VerynizeComponents.live();
const page = () => design.pages.find((p) => p.id === design.activePage),
  nodes = () => page().nodes,
  chosen = () =>
    selection.size === 1
      ? window.VerynizeNodeIndex.find(nodes(), [...selection][0])
      : nodes().find((n) => selection.has(n.id));
/* Canvas layers: web/canvas-render.js keeps one element per node, redraws only what changed (render()) and culls offscreen artboards; layerElement() builds detached trees for export. */ const canvasRender =
  window.VerynizeCanvasRender.install({
    canvas,
    camera,
    get design() {
      return design;
    },
    nodes,
    getSelection: () => selection,
  });
/* Every render saves: the document is serialized once the editor is idle (within 200 ms), and at once when the page hides or unloads. */ let saveQueued = 0;
function save() {
  if (window.documentSafety.holdSave(past.length > 0)) return;
  if (window.cloudAccount?.get()) {
    localStorage.removeItem("verynize-v2");
    return;
  }
  if (!saveQueued) saveQueued = requestIdleCallback(persist, { timeout: 200 });
}
function persist() {
  if (saveQueued) cancelIdleCallback(saveQueued);
  saveQueued = 0;
  if (window.documentSafety.holdSave(past.length > 0) || window.cloudAccount?.get()) return;
  try {
    localStorage.setItem("verynize-v2", JSON.stringify(design));
  } catch {
    $("footer").textContent = "Device storage full. Save design to preserve your changes.";
  }
}
addEventListener("pagehide", () => {
  if (saveQueued) persist();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && saveQueued) persist();
});
function checkpoint() {
  pushHistory(JSON.stringify(design));
}
function descendants(id) {
  return window.VerynizeNodeIndex.of(nodes()).descendants(id);
}
function options(select, values, current) {
  select.replaceChildren();
  for (const [value, label] of values) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    select.append(o);
  }
  select.value = current ?? "";
}
// Sizing modes: Fixed is always available; Hug for text and flow frames; Fill inside flow parents.
function sizingAllowed(n, parent, mode) {
  return window.BetterNodeStyle.sizingAllowed(n, parent, mode);
}
function sizingMode(n, axis, parent = window.VerynizeNodeIndex.find(nodes(), n.parentId)) {
  const mode = n[axis === "w" ? "wMode" : "hMode"] || "fixed";
  return sizingAllowed(n, parent, mode) ? mode : "fixed";
}
// Node -> CSS lives in web/node-style.js (shared with integrations/export-html.mjs): per-side padding, block flow, gaps, wrap, grow/shrink/basis, margins, min/max, aspect ratio, % sizes, absolute insets, per-corner radius, per-side borders, rings, text decoration/transform/truncation.
function layerElement(n, editing, parent, ctx = {}) {
  return canvasRender.layerElement(n, editing, parent, ctx);
}
let renderedPage = null,
  pageSwitchToken = null,
  presenting = false,
  presentationSerial = 0;
/* renderCanvas(): a render that redraws the canvas only (a re-parent in the middle of a drag); the rest of render() (panels, inspector, save, subscribers) runs with the next full render, which the gesture's release makes. */ let canvasOnly = false;
function renderCanvas() {
  if (presenting || canvasOnly) {
    render();
    return;
  }
  canvasOnly = true;
  try {
    render();
  } finally {
    canvasOnly = false;
  }
}
/* The canvas is not drawn behind the Files home (body.files-view): render() keeps the layers list, inspector and
   subscribers current but leaves #canvas alone, and draws it when the editor shows again. The Code workspace keeps
   drawing it: its live previews run in canvas frames. */
let canvasStale = false;
const canvasHidden = () => document.body.classList.contains("files-view");
new MutationObserver(() => {
  if (canvasStale && !canvasHidden()) render();
}).observe(document.body, { attributes: true, attributeFilter: ["class"] });
// Undo snapshots also hold the immediate rollback state. Idle renders do no bounds work.
// Gestures retain their pending edit until pointer release.
let pendingWorldEdit = null,
  worldGesture = false,
  worldGestureRendered = false,
  worldNoticeTimer;
function scheduleWorldNotice() {
  clearTimeout(worldNoticeTimer);
  worldNoticeTimer = setTimeout(() => window.documentSafety.worldBounds(page(), recenterPage), 80);
}
function pushHistory(snapshot) {
  pendingWorldEdit = { snapshot, selection: [...selection], future };
  past.push(snapshot);
  if (past.length > 100) past.shift();
  future = [];
}
function commitWorldEdit() {
  if (!pendingWorldEdit) return;
  const edit = pendingWorldEdit;
  pendingWorldEdit = null;
  try {
    componentSync.sync(design);
    window.VerynizeDocument.validateWorldBoundsChange(JSON.parse(edit.snapshot), design);
  } catch (error) {
    design = JSON.parse(edit.snapshot);
    selection = new Set(edit.selection);
    if (past.at(-1) === edit.snapshot) past.pop();
    future = edit.future;
    window.documentSafety.editRejected(error.message);
  }
  scheduleWorldNotice();
}
function recenterPage() {
  const bounds = window.VerynizeDocument.pageWorldBounds(page()).bounds;
  if (!bounds) return;
  const dx = bounds.x + bounds.w / 2,
    dy = bounds.y + bounds.h / 2;
  if (!dx && !dy) return;
  const candidate = structuredClone(design);
  for (const n of candidate.pages.find((p) => p.id === design.activePage).nodes)
    if (!n.parentId) {
      n.x -= dx;
      n.y -= dy;
    }
  validate(candidate);
  try {
    window.VerynizeDocument.validateWorldBoundsChange(design, candidate);
  } catch (error) {
    window.documentSafety.editRejected(error.message);
    return;
  }
  checkpoint();
  design = candidate;
  canvasApi.setCamera(camera.x + dx * camera.zoom, camera.y + dy * camera.zoom, camera.zoom);
  render();
}
function render(selectionOnly = false) {
  clearTimeout(selectionNotify);
  selectionNotify = 0;
  window.VerynizeLazyDocument.activate(design);
  if (!selectionOnly) commitState.invalidate();
  if (!presenting) {
    if (worldGesture) {
      worldGestureRendered = true;
      if (!canvasOnly) {
        renderCanvas();
        return;
      }
    } else commitWorldEdit();
  }
  if (!selectionOnly) componentSync.sync(design);
  if (!presenting) {
    presentationSerial++;
    $("#workspace").inert = false;
  }
  const coordinator = window.switchCoordinator,
    fileKey = window.fileLibrary?.currentId;
  const active = coordinator?.getState();
  if (
    !presenting &&
    renderedPage !== null &&
    renderedPage !== design.activePage &&
    !(active?.kind === "file" && !["end", "fail", "cancel"].includes(active.phase))
  ) {
    pageSwitchToken = coordinator?.begin({
      kind: "page",
      from: { fileKey, pageId: renderedPage },
      to: { fileKey, pageId: design.activePage },
    });
  }
  renderedPage = design.activePage;
  const retain = !presenting && window.pageLoader?.isUnloaded(design.activePage),
    deferred = !presenting && !retain && canvasHidden();
  canvasStale = deferred;
  if (!retain && !deferred) {
    if (!selectionOnly) canvasApi?.beforeRender?.();
    {
      const pg = design.pages.find((p) => p.id === design.activePage),
        ws = $("#workspace");
      ws.style.backgroundColor = (!pg?.backgroundHidden && pg?.background) || "";
      ws.classList.toggle("page-transparent", pg?.backgroundHidden === true);
    }
    if (selectionOnly) canvasRender.select();
    else canvasRender.render();
    for (const n of selectionOnly ? [] : nodes()) {
      const p = canvasRender.node(n.parentId) ?? null,
        w = sizingMode(n, "w", p),
        h = sizingMode(n, "h", p);
      if (w === "fixed" && h === "fixed" && n.wPct === undefined && n.hPct === undefined) continue;
      const el = canvasRender.elementOf(n.id);
      if (!el?.offsetWidth) continue;
      if ((w !== "fixed" || n.wPct !== undefined) && Math.abs(el.offsetWidth - n.w) > 0.5)
        n.w = Math.max(1, el.offsetWidth);
      if (
        (h !== "fixed" || n.hPct !== undefined) &&
        el.offsetHeight &&
        Math.abs(el.offsetHeight - n.h) > 0.5
      )
        n.h = Math.max(1, el.offsetHeight);
    }
    if (canvasOnly) {
      updateMeasurement();
      canvasApi?.afterRender();
      return;
    }
  }
  $("#layers").replaceChildren();
  const query = $("#layer-search").value.toLowerCase();
  function rows(parent = null, depth = 0, index = window.VerynizeNodeIndex.of(nodes())) {
    for (const n of index.children(parent).toReversed()) {
      if (!query || n.name.toLowerCase().includes(query)) {
        const b = document.createElement("button");
        b.className =
          "layer-row" +
          (selection.has(n.id) ? " active" : "") +
          (n.hidden ? " is-hidden" : "") +
          (n.locked ? " is-locked" : "");
        b.style.paddingLeft = 10 + depth * 14 + "px";
        b.textContent =
          { text: "T  ", rectangle: "▢  ", frame: "⊞  ", image: "▧  ", shader: "◉  " }[n.type] +
          n.name;
        b.onclick = (e) => {
          if (e.shiftKey) {
            if (selection.has(n.id)) selection.delete(n.id);
            else selection.add(n.id);
          } else selection = new Set([n.id]);
          render();
        };
        const toggles = document.createElement("span");
        toggles.className = "layer-row-toggles";
        for (const [key, , label] of [
          ["locked", "lock-simple", "Lock"],
          ["hidden", "eye", "Hide"],
        ]) {
          const t = document.createElement("span");
          t.className = "layer-toggle" + (n[key] ? " on" : "");
          t.dataset.toggle = key;
          t.setAttribute("role", "button");
          t.setAttribute(
            "aria-label",
            (n[key] ? (key === "hidden" ? "Show" : "Unlock") : label) + " " + n.name,
          );
          t.title = t.getAttribute("aria-label");
          t.onclick = (e) => {
            e.stopPropagation();
            checkpoint();
            if (n[key]) delete n[key];
            else n[key] = true;
            render();
          };
          toggles.append(t);
        }
        b.append(toggles);
        $("#layers").append(b);
      }
      rows(n.id, depth + 1, index);
    }
  }
  /* The sidebar island empties #layers at once (web/src/islands/sidebar/legacy.ts): building its rows is wasted. */ if (
    !$("#layers").hasAttribute("data-island-owned")
  )
    rows();
  options(
    $("#pages"),
    design.pages.map((p) => [p.id, p.name]),
    design.activePage,
  );
  $("#document-name").value = design.name;
  $("#page-title").textContent = page().name.toUpperCase() + " · 1000 × 700";
  const n = chosen();
  form.hidden = !n;
  $("#empty").hidden = !!n;
  $("#shader-settings").hidden = n?.type !== "shader";
  if (n) {
    const excluded = descendants(n.id);
    options(
      form.elements.parentId,
      [
        ["", "Canvas"],
        ...nodes()
          .filter((x) => x.type === "frame" && !excluded.has(x.id))
          .map((x) => [x.id, x.name]),
      ],
      n.parentId,
    );
    options(
      form.elements.token,
      [["", "None"], ...Object.keys(design.tokens).map((k) => [k, k])],
      n.token,
    );
    for (const input of form.elements)
      if (input.name) {
        if (input.type === "checkbox") input.checked = !!n[input.name];
        else input.value = n[input.name] ?? input.dataset.default ?? "";
      }
    const parent = nodes().find((p) => p.id === n.parentId);
    for (const axis of ["w", "h"]) {
      const select = form.elements[axis + "Mode"];
      if (!select) continue;
      for (const o of select.options) o.disabled = !sizingAllowed(n, parent, o.value);
      select.value = sizingMode(n, axis, parent);
    }
  }
  $("#undo").disabled = !(window.cloudHistory?.active()
    ? window.cloudHistory.canUndo()
    : past.length);
  $("#redo").disabled = !(window.cloudHistory?.active()
    ? window.cloudHistory.canRedo()
    : future.length);
  $("#delete-page").disabled = design.pages.length < 2;
  $("#tokens").replaceChildren();
  for (const [name, color] of Object.entries(design.tokens)) {
    const row = document.createElement("div");
    row.className = "token-row";
    const input = document.createElement("input");
    input.type = "color";
    input.value = color;
    input.setAttribute("aria-label", name);
    input.onchange = () => {
      checkpoint();
      design.tokens[name] = input.value;
      render();
    };
    const label = document.createElement("span");
    label.textContent = name;
    const del = document.createElement("button");
    del.textContent = "×";
    del.title = "Delete variable";
    del.onclick = () => {
      checkpoint();
      for (const p of design.pages)
        for (const n of p.nodes) {
          if (n.token === name) {
            n.color = color;
            n.token = "";
          }
          if (n.svgColorToken === name) {
            n.svgColor = color;
            delete n.svgColorToken;
          }
          window.BetterNodeStyle.eachPaintColor(n, (c) => {
            if (c.token === name) {
              c.color = color;
              delete c.token;
            }
          });
        }
      delete design.tokens[name];
      render();
    };
    row.append(input, label, del);
    $("#tokens").append(row);
  }
  if (!retain && !deferred) {
    updateMeasurement();
    if (selectionOnly) canvasApi?.afterSelection();
    else canvasApi?.afterRender();
  }
  if (presenting) return;
  window.pageLoader?.render(design);
  $("#workspace").inert = !!retain;
  if (!retain && pageSwitchToken) {
    coordinator?.rendered(pageSwitchToken, {
      fileKey,
      pageId: design.activePage,
      freshness: "confirmed",
    });
    coordinator?.finish(pageSwitchToken);
    pageSwitchToken = null;
  }
  if (!selectionOnly) {
    save();
    if (past.length && !worldGesture) past[past.length - 1] = window.VerynizeCommitState.compact(past.at(-1), design);
  }
  const snapshot = commitState.get(design);
  const notify = () => {
    selectionNotify = 0;
    for (const fn of subscribers) {
      try {
        fn(fn.length ? snapshot : undefined);
      } catch {}
    }
  };
  // Let the count/bounds paint before React builds the inspector and visible tree rows.
  if (selectionOnly && selection.size > 200) selectionNotify = setTimeout(notify, 0);
  else notify();
  return snapshot;
}
function add(type, extra = {}) {
  const parent = chosen()?.type === "frame" ? chosen() : null;
  const n = {
    ...defaults,
    id: uid(),
    type,
    name:
      type === "text"
        ? "Text"
        : type === "frame"
          ? "Frame"
          : type === "image"
            ? "Image"
            : type === "shader"
              ? "Shader"
              : type === "vector"
                ? "Vector"
                : "Rectangle",
    x: parent ? 20 : 120 + ((nodes().length * 15) % 300),
    y: parent ? 20 : 150 + ((nodes().length * 15) % 200),
    w: type === "frame" ? 500 : 250,
    h: type === "text" ? 80 : type === "frame" ? 360 : 180,
    color: type === "text" ? "#25252e" : type === "frame" ? "#ffffff" : "#97c3b1",
    text: type === "text" ? "Your next idea" : "",
    parentId: parent?.id || null,
    ...(type === "frame" ? { clipContent: true, radius: 0 } : {}),
    ...(type === "text" ? { lineHeight: "auto" } : {}),
    ...extra,
  };
  if (!n.parentId && extra.x === undefined && canvasApi) {
    const view = canvasApi.placeInView(n.w, n.h),
      v = $("#canvas-wrap").getBoundingClientRect(),
      a = canvasApi.screenToWorld(v.left, v.top),
      b = canvasApi.screenToWorld(v.right, v.bottom);
    if (n.x < a.x || n.y < a.y || n.x + n.w > b.x || n.y + n.h > b.y) {
      n.x = view.x;
      n.y = view.y;
    }
  }
  if (type === "image") {
    const candidate = structuredClone(design);
    candidate.pages.find((p) => p.id === page().id).nodes.push(n);
    window.imageUpload.preflight(candidate);
  }
  checkpoint();
  nodes().push(n);
  selection = new Set([n.id]);
  render();
}
$("#add-icon").onclick = () => {
  const kind = $("#icon-kind").value,
    paths = {
      star: "M50 5 63 35 96 38 72 61 79 94 50 77 21 94 28 61 4 38 37 35Z",
      heart: "M50 90C-30 35 12-15 50 22C88-15 130 35 50 90Z",
      check: "M10 50 35 75 90 20 98 28 35 91 2 58Z",
      arrow: "M5 42H65L40 17 51 6 95 50 51 94 40 83 65 58H5Z",
    };
  add("image", {
    name: kind + " icon",
    w: 64,
    h: 64,
    color: "transparent",
    src:
      "data:image/svg+xml;base64," +
      btoa(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#a58bdd" d="' +
          paths[kind] +
          '"/></svg>',
      ),
  });
};
for (const [id, factor] of [
  ["scale-down", 0.5],
  ["scale-up", 2],
])
  $("#" + id).onclick = () => {
    if (!selection.size) return;
    checkpoint();
    const ids = new Set([...selection].flatMap((id) => [...descendants(id)]));
    for (const n of nodes().filter((n) => ids.has(n.id))) {
      n.w = Math.max(10, n.w * factor);
      n.h = Math.max(10, n.h * factor);
      n.fontSize = Math.max(8, n.fontSize * factor);
      n.radius *= factor;
      n.gap *= factor;
      n.padding *= factor;
      if (ids.has(n.parentId)) {
        n.x *= factor;
        n.y *= factor;
      }
    }
    render();
  };
for (const [id, style] of [
  ["range-bold", "bold"],
  ["range-italic", "italic"],
])
  $("#" + id).onclick = () => {
    const n = chosen(),
      t = form.elements.text;
    if (n?.type !== "text" || t.selectionStart === t.selectionEnd) {
      $("footer").textContent = "Select a range in the text field first.";
      return;
    }
    checkpoint();
    n.textRuns = [
      ...(n.textRuns || []),
      {
        start: t.selectionStart,
        end: t.selectionEnd,
        bold: style === "bold",
        italic: style === "italic",
      },
    ];
    render();
  };
$("#range-style").onclick = () => {
  const n = chosen(),
    t = form.elements.text;
  if (n?.type !== "text" || t.selectionStart === t.selectionEnd) return;
  checkpoint();
  n.textRuns = [
    ...(n.textRuns || []),
    {
      start: t.selectionStart,
      end: t.selectionEnd,
      bold: false,
      italic: false,
      color: form.elements.color.value,
      fontSize: Number(form.elements.fontSize.value),
    },
  ];
  render();
};
$("#import-tokens").onclick = async () => {
  const css = await window.askText(
    "Paste CSS custom properties, for example :root { --brand: #a58bdd; }",
  );
  if (!css) return;
  const values = {};
  for (const match of css.matchAll(/--([\w-]+)\s*:\s*([^;{}]+)[;}]?/g)) {
    if (
      ["__proto__", "constructor", "prototype"].includes(match[1]) ||
      !CSS.supports("color", match[2].trim())
    )
      continue;
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.fillStyle = match[2].trim();
    const value = ctx.fillStyle;
    if (/^#[0-9a-f]{6}$/i.test(value)) values[match[1]] = value;
  }
  if (!Object.keys(values).length) {
    alert("No opaque CSS color variables found.");
    return;
  }
  checkpoint();
  Object.assign(design.tokens, values);
  render();
};
$("#add-shader").onclick = () =>
  add("shader", { name: "Aurora shader", w: 480, h: 300, color: "#a58bdd" });
$("#rectangle").onclick = () => add("rectangle");
$("#text").onclick = () => add("text");
$("#add-frame").onclick = () => add("frame");
$("#layer-search").oninput = render;
form.onsubmit = (e) => e.preventDefault();
form.onchange = (e) => {
  const n = chosen(),
    key = e.target.name;
  if (!n || !key) return;
  let value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  const numeric = [
    "x",
    "y",
    "w",
    "h",
    "fontSize",
    "radius",
    "zIndex",
    "gap",
    "padding",
    "columns",
    "shaderSpeed",
    "shaderIntensity",
    "rotation",
    "opacity",
    "strokeWidth",
    "lineHeight",
    "letterSpacing",
  ];
  if (numeric.includes(key)) {
    value = Number(value);
    if (!Number.isFinite(value)) return;
    if (["w", "h"].includes(key)) value = Math.max(10, value);
    if (["radius", "gap", "padding"].includes(key)) value = Math.max(0, value);
    if (key === "opacity") value = Math.max(0, Math.min(100, value));
    if (key === "strokeWidth") value = Math.max(0, value);
    if (key === "lineHeight") value = Math.max(0.1, value);
    if (key === "fontSize") value = Math.min(200, Math.max(8, value));
    if (key === "shaderSpeed") value = Math.max(0, Math.min(5, value));
    if (key === "shaderIntensity") value = Math.max(0, Math.min(2, value));
    if (key === "columns") value = Math.min(12, Math.max(1, Math.round(value)));
  }
  if (
    ["gradient", "mask"].includes(key) &&
    value &&
    (/url\s*\(/i.test(value) || !CSS.supports("background-image", value))
  ) {
    e.target.setCustomValidity("Enter a CSS gradient without external URLs.");
    e.target.reportValidity();
    return;
  }
  if (
    key === "shadow" &&
    value &&
    (/url\s*\(/i.test(value) || !CSS.supports("box-shadow", value))
  ) {
    e.target.setCustomValidity("Enter a CSS box shadow");
    e.target.reportValidity();
    return;
  }
  e.target.setCustomValidity("");
  checkpoint();
  if (key === "text") n.textRuns = [];
  if (key === "w" && n.wMode && n.wMode !== "fixed") n.wMode = "fixed";
  if (key === "h" && n.hMode && n.hMode !== "fixed") n.hMode = "fixed";
  if (key === "padding")
    for (const side of ["Top", "Right", "Bottom", "Left"]) delete n["padding" + side];
  if (key === "gap") {
    delete n.gapX;
    delete n.gapY;
  }
  if (key === "radius") delete n.cornerRadii;
  if (key === "strokeWidth") delete n.strokeWidths;
  if (key === "w" || key === "h") delete n[key + "Pct"];
  n[key] = key === "parentId" ? value || null : key === "name" ? value.trim() || n.type : value;
  render();
};
$("#delete").onclick = () => {
  if (!selection.size) return;
  checkpoint();
  const index = window.VerynizeNodeIndex.of(nodes());
  const roots = index.topmost(nodes().filter((node) => selection.has(node.id)));
  const removed = new Set(roots.flatMap((node) => [...index.descendants(node.id)]));
  page().nodes = nodes().filter((n) => !removed.has(n.id));
  selection.clear();
  render();
};
$("#duplicate").onclick = () => {
  if (!selection.size) return;
  checkpoint();
  const ids = new Set([...selection].flatMap((id) => [...descendants(id)])),
    mapping = new Map([...ids].map((id) => [id, uid()]));
  const copies = nodes()
    .filter((n) => ids.has(n.id))
    .map((n) => ({
      ...n,
      id: mapping.get(n.id),
      parentId: mapping.get(n.parentId) || n.parentId,
      x: n.x + (ids.has(n.parentId) ? 0 : 20),
      y: n.y + (ids.has(n.parentId) ? 0 : 20),
    }));
  window.VerynizeComponents.adoptCopies(design, copies, mapping);
  nodes().push(...copies);
  selection = new Set([...selection].map((id) => mapping.get(id)));
  render();
};
$("#undo").onclick = () => {
  if (window.cloudHistory?.undo()) return;
  if (!past.length) return;
  const applied = window.VerynizeCommitState.apply(past.pop(), design);
  future.push(applied.inverse);
  pendingWorldEdit = null;
  design = applied.document;
  scheduleWorldNotice();
  render();
};
$("#redo").onclick = () => {
  if (window.cloudHistory?.redo()) return;
  if (!future.length) return;
  const applied = window.VerynizeCommitState.apply(future.pop(), design);
  past.push(applied.inverse);
  pendingWorldEdit = null;
  design = applied.document;
  scheduleWorldNotice();
  render();
};
$("#pages").onchange = (e) => {
  design.activePage = e.target.value;
  scheduleWorldNotice();
  selection.clear();
  render();
};
$("#add-page").onclick = () => {
  checkpoint();
  const p = { id: uid(), name: "Page " + (design.pages.length + 1), nodes: [] };
  design.pages.push(p);
  design.activePage = p.id;
  selection.clear();
  render();
};
$("#rename-page").onclick = async () => {
  const name = await window.askText("Page name", page().name);
  if (name?.trim()) {
    checkpoint();
    page().name = name.trim();
    render();
  }
};
$("#delete-page").onclick = () => {
  if (design.pages.length < 2) return;
  checkpoint();
  design.pages = design.pages.filter((p) => p.id !== design.activePage);
  if (design.views) design.views = design.views.filter((v) => v.page !== design.activePage);
  design.activePage = design.pages[0].id;
  selection.clear();
  render();
};
$("#document-name").onchange = (e) => {
  checkpoint();
  design.name = e.target.value.trim() || "Untitled";
  render();
};
$("#add-token").onclick = async () => {
  const source = design;
  let suggestion = "brand";
  for (
    let i = 2;
    Object.hasOwn(design.tokens, suggestion) || Object.hasOwn(design.variables || {}, suggestion);
    i++
  )
    suggestion = "brand-" + i;
  const name = (await window.askText("Color variable name", suggestion))?.trim();
  if (!name || design !== source) return null;
  try {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_./ -]{0,99}$/.test(name) ||
      ["__proto__", "constructor", "prototype"].includes(name)
    )
      throw Error("Use letters, digits, “-”, “_”, “.”, “/” or spaces.");
    if (Object.hasOwn(design.tokens, name) || Object.hasOwn(design.variables || {}, name))
      throw Error(`A variable named “${name}” already exists.`);
    const next = structuredClone(design);
    next.tokens[name] = "#a58bdd";
    validate(next);
    checkpoint();
    design = next;
    render();
    return name;
  } catch (error) {
    $("footer").textContent = error.message;
    return null;
  }
};
for (const [id, key] of [
  ["align-left", "x"],
  ["align-top", "y"],
])
  $("#" + id).onclick = () => {
    const list = nodes().filter((n) => selection.has(n.id));
    if (!list.length) return;
    checkpoint();
    const min = Math.min(...list.map((n) => n[key]));
    list.forEach((n) => (n[key] = min));
    render();
  };
function exportHTML() {
  const metadata = JSON.stringify({ ...design, pages: [structuredClone(page())] }).replaceAll(
    "<",
    "\\u003c",
  );
  const root = document.createElement("main");
  const tops = nodes().filter((n) => !n.parentId),
    shiftX = Math.min(0, ...tops.map((n) => n.x)),
    shiftY = Math.min(0, ...tops.map((n) => n.y)),
    width = Math.max(1000, ...tops.map((n) => n.x + n.w)) - shiftX,
    height = Math.max(700, ...tops.map((n) => n.y + n.h)) - shiftY;
  root.style.cssText = `position:relative;width:${Math.ceil(width)}px;min-height:${Math.ceil(height)}px;background:#f5f3ee;overflow:hidden`;
  root.append(
    ...tops.map((n) => {
      const el = layerElement(n, false);
      if (shiftX || shiftY) {
        el.style.left = n.x - shiftX + "px";
        el.style.top = n.y - shiftY + "px";
      }
      return el;
    }),
  );
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Exported design</title><style>' +
    (window.embeddedFontCss?.(root.outerHTML) || "") +
    "*{box-sizing:border-box}body{margin:0;font-family:system-ui}main{max-width:100%}@keyframes design-gradient{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}</style></head><body>" +
    root.outerHTML +
    '<script id="verynize-document" type="application/json">' +
    metadata +
    "</script>" +
    (nodes().some((n) => n.type === "shader" || n.shaderFill === true)
      ? "<script>" + window.BetterShaders.runtimeSource() + "</script>"
      : "") +
    "</body></html>"
  );
}
function exportPrintHTML() {
  const doc = new DOMParser().parseFromString(exportHTML(), "text/html");
  doc.querySelectorAll("script").forEach((node) => node.remove());
  for (const node of doc.querySelectorAll("[data-shader-preset]")) {
    const fill = node.dataset.shaderFill === "true",
      source = canvas.querySelector(
        '[data-id="' + CSS.escape(node.dataset.id) + '"] > canvas.shader-surface',
      );
    if (source) {
      const img = doc.createElement("img");
      img.src = source.toDataURL("image/png");
      if (fill) {
        img.style.cssText =
          "position:absolute;inset:0;width:100%;height:100%;display:block;border-radius:inherit;z-index:-1";
        node.style.isolation = "isolate";
        node.prepend(img);
      } else {
        img.style.cssText = "width:100%;height:100%;display:block";
        node.replaceChildren(img);
      }
    } else if (!fill) {
      node.textContent = "Shader rendering unavailable";
    }
  }
  return "<!doctype html>" + doc.documentElement.outerHTML;
}
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("#export").onclick = () => download(exportHTML(), "verynize.html", "text/html");
$("#save-project").onclick = async () => {
  await window.pageLoader?.ensureAll();
  download(JSON.stringify(design, null, 2), "verynize.json", "application/json");
};
$("#open-project").onclick = () => $("#project-file").click();
$("#project-file").onchange = async (e) => {
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 20e6) throw Error("Design exceeds 20 MB.");
    const d = window.documentSafety.load(JSON.parse(await f.text()));
    if (window.fileLibrary?.createFromDocument) {
      await window.fileLibrary.createFromDocument(d);
    } else {
      await window.documentLifecycle?.prepareSwitch();
      checkpoint();
      pendingWorldEdit = null;
      scheduleWorldNotice();
      design = d;
      selection.clear();
      render();
    }
  } catch (err) {
    alert(err.message);
  }
  e.target.value = "";
};
/* The preview / Import HTML dialog is the settings island's (web/src/islands/settings/preview-import.tsx). */ function modal(
  importing,
) {
  window.dispatchEvent(
    new CustomEvent("bd:open-modal", { detail: { mode: importing ? "import" : "preview" } }),
  );
}
$("#preview").onclick = () => modal(false);
$("#import").onclick = () => modal(true);
function normalizeColor(value, fallback = "#25252e") {
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.fillStyle = fallback;
  if (CSS.supports("color", value)) ctx.fillStyle = value;
  return ctx.fillStyle;
}
function importHTML(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const metadata = doc.querySelector('script#verynize-document[type="application/json"]');
  if (metadata) {
    const recovered = validate(JSON.parse(metadata.textContent));
    const sourcePage =
      recovered.pages.find((p) => p.id === recovered.activePage) || recovered.pages[0];
    const ids = new Map(sourcePage.nodes.map((n) => [n.id, uid()])),
      tokenNames = new Map();
    for (const [key, value] of Object.entries(recovered.tokens)) {
      let name = key,
        i = 1;
      while (design.tokens[name] && design.tokens[name] !== value) name = key + "-import-" + i++;
      tokenNames.set(key, name);
    }
    const imported = sourcePage.nodes.map((n) => ({
      ...n,
      id: ids.get(n.id),
      parentId: ids.get(n.parentId) || null,
      token: tokenNames.get(n.token) || "",
    }));
    checkpoint();
    for (const [key, value] of Object.entries(recovered.tokens))
      design.tokens[tokenNames.get(key)] = value;
    nodes().push(...imported);
    selection = new Set(imported.length ? [imported.at(-1).id] : []);
    render();
    return imported.length;
  }
  doc.querySelectorAll("script,style,link,iframe,object,embed,meta").forEach((n) => n.remove());
  const imported = [],
    inlineTags = new Set([
      "SPAN",
      "B",
      "STRONG",
      "I",
      "EM",
      "U",
      "S",
      "SMALL",
      "MARK",
      "A",
      "BR",
      "CODE",
    ]);
  function richText(el, base) {
    let text = "",
      runs = [];
    function visit(node, inherited) {
      if (node.nodeType === 3) {
        const start = text.length;
        text += node.nodeValue;
        if (
          text.length > start &&
          (inherited.bold ||
            inherited.italic ||
            inherited.color !== base.color ||
            inherited.fontSize !== base.fontSize)
        )
          runs.push({ start, end: text.length, ...inherited });
        return;
      }
      if (node.nodeType !== 1) return;
      if (node.tagName === "BR") {
        text += "\n";
        return;
      }
      const style = node.style,
        current = { ...inherited };
      if (style.fontWeight)
        current.bold = style.fontWeight === "bold" || Number(style.fontWeight) >= 600;
      else if (["B", "STRONG"].includes(node.tagName)) current.bold = true;
      if (style.fontStyle) current.italic = style.fontStyle === "italic";
      else if (["I", "EM"].includes(node.tagName)) current.italic = true;
      if (style.color) {
        const candidate = normalizeColor(style.color, base.color);
        current.color = /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : "#25252e";
      }
      if (style.fontSize)
        current.fontSize = Math.min(200, Math.max(8, parseFloat(style.fontSize) || base.fontSize));
      node.childNodes.forEach((child) => visit(child, current));
    }
    el.childNodes.forEach((child) =>
      visit(child, {
        bold: false,
        italic: false,
        color: /^#[0-9a-f]{6}$/i.test(base.color) ? base.color : "#25252e",
        fontSize: base.fontSize,
      }),
    );
    return { text, textRuns: runs };
  }
  function walk(el, parentId = null, index = 0) {
    if (imported.length >= 500) return;
    const style = el.style,
      num = (key, fallback) =>
        Number.isFinite(parseFloat(style[key])) ? parseFloat(style[key]) : fallback,
      children = [...el.children];
    const inlineOnly = [...el.querySelectorAll("*")].every((c) => inlineTags.has(c.tagName));
    const type =
      el.dataset.designType ||
      (el.tagName === "IMG"
        ? "image"
        : el.textContent.trim() && inlineOnly
          ? "text"
          : children.length
            ? "frame"
            : el.textContent.trim()
              ? "text"
              : "rectangle");
    if (!["frame", "text", "rectangle", "image", "shader"].includes(type)) return;
    const n = {
      ...defaults,
      id: uid(),
      parentId,
      type,
      name: el.dataset.name || el.tagName.toLowerCase(),
      x: num("left", parentId ? 0 : 40),
      y: num("top", parentId ? 0 : 40 + index * 55),
      w: Math.max(10, num("width", type === "frame" ? 800 : 300)),
      h: Math.max(10, num("height", type === "frame" ? 500 : 50)),
      color: normalizeColor(
        style[type === "text" ? "color" : "backgroundColor"] ||
          (type === "text" ? "#25252e" : "#ffffff"),
      ),
      text: "",
      fontSize: Math.min(200, Math.max(8, num("fontSize", 24))),
      fontWeight: style.fontWeight || "400",
      fontFamily: style.fontFamily || "system-ui",
      textAlign: style.textAlign || "left",
      radius: num("borderRadius", 0),
      zIndex: num("zIndex", 0),
      layout: ["flex", "grid"].includes(style.display) ? style.display : "free",
      gap: num("gap", 16),
      padding: num("padding", 0),
      direction: style.flexDirection || "row",
      gradient: !style.backgroundImage.includes("url(") ? style.backgroundImage : "",
      mask: !style.maskImage.includes("url(") ? style.maskImage : "",
      columns: 2,
    };
    if (
      type === "image" &&
      /^data:image\/(png|jpeg|gif|webp|svg\+xml);/i.test(el.getAttribute("src") || "")
    )
      n.src = el.getAttribute("src");
    if (type === "text") Object.assign(n, richText(el, n));
    imported.push(n);
    if (type === "frame") children.forEach((child, i) => walk(child, n.id, i));
  }
  Array.from(doc.body.children).forEach((el, i) => walk(el, null, i));
  if (!imported.length) throw Error("No editable layers found.");
  checkpoint();
  nodes().push(...imported);
  selection = new Set([imported.at(-1).id]);
  render();
  return imported.length;
}

$("#image").onclick = () => $("#asset-file").click();
$("#asset-file").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  const pageId = page().id;
  try {
    const image = await window.imageUpload.prepare(f);
    if (page().id !== pageId) return;
    add("image", {
      name: f.name,
      src: image.src,
      w: Math.min(600, image.originalWidth),
      h: (Math.min(600, image.originalWidth) * image.originalHeight) / image.originalWidth,
      color: "transparent",
    });
  } catch (error) {
    if (!error.reported) alert(error.message);
  }
};
canvasApi = window.BetterCanvas.install({
  canvas,
  camera,
  get design() {
    return design;
  },
  page,
  nodes,
  chosen,
  getSelection: () => selection,
  setSelection: (ids) => {
    selection = new Set(ids);
  },
  render,
  renderSelection: () => render(true),
  renderCanvas,
  beginGesture: () => {
    worldGesture = true;
    worldGestureRendered = false;
  },
  endGesture: () => {
    worldGesture = false;
    if (pendingWorldEdit || worldGestureRendered) render();
    worldGestureRendered = false;
  },
  layerOf: (id) => canvasRender.layerOf(id),
  checkpoint,
  snapshot: () => JSON.stringify(design),
  pushHistory,
  descendants,
  uid,
  add,
  defaults,
  validate,
  updateMeasurement,
  exportArtwork,
  align: (mode) => alignSelection(mode),
});
window.verynize = {
  updateNodes: (ids, patch) => {
    const wanted = new Set(ids),
      targets = nodes().filter((n) => wanted.has(n.id));
    if (!targets.length) return false;
    const before = worldGesture ? window.VerynizeCommitState.freeze(structuredClone(design)) : commitState.get(design),
      old = targets.map((n) => structuredClone(n));
    for (const n of targets)
      Object.assign(n, typeof patch === "function" ? patch(structuredClone(n)) : patch);
    try {
      window.imageUpload.preflightChange(design, old, targets);
      componentSync.sync(design);
      window.VerynizeCommitValidation.schema(before, design, old, targets);
      window.VerynizeCommitValidation.world(before, design, old, targets);
    } catch (error) {
      design = structuredClone(before);
      commitState.invalidate();
      throw error;
    }
    past.push(!worldGesture && !window.VerynizeComponents.hasComponents(design)
      ? { before, page: design.activePage, nodeEdit: targets.map(node => node.id) }
      : before);
    if (past.length > 100) past.shift();
    future = [];
    scheduleWorldNotice();
    const committed = render();
    if (committed === commitState.get(design)) window.VerynizeCommitValidation.remember(committed);
    return true;
  },
  addNode: (type, extra = {}) => {
    if (!["rectangle", "text", "frame", "image", "shader", "vector"].includes(type))
      throw Error("Unsupported node type");
    add(type, extra);
    return [...selection][0];
  },
  setIcons: (icons) => {
    const before = JSON.stringify(design);
    if (icons.length) design.icons = structuredClone(icons);
    else delete design.icons;
    try {
      window.imageUpload.preflightChange(design, JSON.parse(before));
      componentSync.sync(design);
      validate(structuredClone(design));
      window.VerynizeDocument.validateWorldBoundsChange(JSON.parse(before), design);
    } catch (error) {
      design = JSON.parse(before);
      throw error;
    }
    past.push(before);
    if (past.length > 100) past.shift();
    future = [];
    scheduleWorldNotice();
    render();
    return true;
  },
  updatePage: (patch, id) => {
    const page = design.pages.find((p) => p.id === (id || design.activePage));
    if (!page) return false;
    const before = JSON.stringify(design);
    Object.assign(page, patch);
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete page[k];
    try {
      componentSync.sync(design);
      validate(structuredClone(design));
      window.VerynizeDocument.validateWorldBoundsChange(JSON.parse(before), design);
    } catch (error) {
      design = JSON.parse(before);
      throw error;
    }
    past.push(before);
    if (past.length > 100) past.shift();
    future = [];
    scheduleWorldNotice();
    render();
    return true;
  },
  setThumbnail: (id) => {
    const before = JSON.stringify(design);
    if (id) design.thumbnailNodeId = id;
    else delete design.thumbnailNodeId;
    try {
      componentSync.sync(design);
      validate(structuredClone(design));
      window.VerynizeDocument.validateWorldBoundsChange(JSON.parse(before), design);
    } catch (error) {
      design = JSON.parse(before);
      throw error;
    }
    past.push(before);
    if (past.length > 100) past.shift();
    future = [];
    scheduleWorldNotice();
    render();
    return true;
  },
  setActivePage: (id) => {
    if (!design.pages.some((p) => p.id === id) || design.activePage === id) return;
    design.activePage = id;
    scheduleWorldNotice();
    selection.clear();
    render();
  },
  canUndo: () => (window.cloudHistory?.active() ? window.cloudHistory.canUndo() : past.length > 0),
  editCount: () => editCount,
  canRedo: () =>
    window.cloudHistory?.active() ? window.cloudHistory.canRedo() : future.length > 0,
  getView: () => canvasApi.getView(),
  setView: (view) => {
    if (design.pages.some((p) => p.id === view.page) && view.page !== design.activePage) {
      design.activePage = view.page;
      scheduleWorldNotice();
      selection.clear();
      render();
    }
    canvasApi.applyView(view);
  },
  getCamera: () => ({ ...camera }),
  setCamera: (x, y, zoom) => canvasApi.setCamera(x, y, zoom),
  zoomToFit: () => canvasApi.fit(),
  setTool: (t) => canvasApi.setTool(t),
  getTool: () => canvasApi.getTool(),
  framePresets: () => canvasApi.framePresets(),
  insertFramePreset: (name) => canvasApi.insertFramePreset(name),
  commands: () => canvasApi.commands(),
  runCommand: (id, arg) => canvasApi.runCommand(id, arg),
  moveNodes: (ids, targetId, position) => canvasApi.moveNodes(ids, targetId, position),
  setConstraints: (ids, constraints) => canvasApi.setConstraints(ids, constraints),
  getConstraints: (id) => canvasApi.constraintsOf(id),
  screenToWorld: (x, y) => canvasApi.screenToWorld(x, y),
  getSelection: () => [...selection],
  setSelection: (ids) => {
    selection = new Set(ids.filter((id) => window.VerynizeNodeIndex.find(nodes(), id)));
    render(true);
  },
  exportArtwork,
  exportPrintHTML,
  getDocument: () => structuredClone(design),
  getSnapshot: () => commitState.get(design),
  loadDocument: (d) => {
    const checked = window.documentSafety.load(d);
    const edits = editCount;
    checkpoint();
    editCount = edits;
    pendingWorldEdit = null;
    scheduleWorldNotice();
    design = checked;
    selection.clear();
    render();
  },
  /* Collaborators' edits (web/remote-apply.js, from web/cloud-panel.js): patched in node by node with no undo step,
     keeping unchanged nodes, the selection and the nodes a gesture in progress holds. Returns the held ids.
     The room's own history (cloudHistory) undoes meanwhile; local entries address nodes by position, so after a
     remote patch they would rewrite collaborators' layers once the room is left, and are dropped. */
  applyRemote: (d) => {
    past.length = 0;
    future = [];
    const held = window.remoteApply.held(design, selection, worldGesture);
    const next = window.documentSafety.load(d);
    const sources = new Map(next.pages.map((page) => [page.id, page]));
    design = window.remoteApply.patch(design, next, held);
    for (const page of design.pages)
      if (sources.has(page.id)) window.VerynizeLazyDocument.adopt(page, sources.get(page.id));
    selection = new Set([...selection].filter((id) => window.VerynizeNodeIndex.find(nodes(), id)));
    scheduleWorldNotice();
    render();
    return held;
  },
  gesturing: () => worldGesture,
  /* The live nodes a pointer gesture holds (read only), or null outside one. */
  gestureNodes: () =>
    worldGesture
      ? {
          page: design.activePage,
          nodes: [...window.remoteApply.held(design, selection, true)]
            .map((id) => window.VerynizeNodeIndex.find(nodes(), id))
            .filter(Boolean),
        }
      : null,
  exportHTML,
  subscribe: (fn) => {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
  importHTML,
};
window.verynize.presentDocument = (d) => {
  const previous = design,
    selected = selection,
    previousPage = renderedPage;
  const serial = ++presentationSerial;
  presenting = true;
  try {
    design = structuredClone(d);
    selection = new Set();
    render();
  } finally {
    design = previous;
    selection = selected;
    renderedPage = previousPage;
    presenting = false;
  }
  return () => {
    if (serial !== presentationSerial) return;
    presenting = true;
    try {
      render();
    } finally {
      presenting = false;
    }
  };
};
window.verynize.setDocument = window.verynize.loadDocument;
window.verynize.components = window.VerynizeComponents.editor({
  get design() {
    return design;
  },
  checkpoint,
  render,
  sync: componentSync,
  selection: () => [...selection],
  select: (ids) => window.verynize.setSelection(ids),
});
window.design = window.verynize;
installPrecisionControls();
scheduleWorldNotice();
render();

function installPrecisionControls() {
  const appearance = document.createElement("details");
  appearance.id = "appearance-controls";
  appearance.open = true;
  appearance.innerHTML = `<summary>Appearance</summary><div class="row"><label>Rotation °<input name="rotation" type="number" step="1"></label><label>Opacity %<input name="opacity" type="number" min="0" max="100"></label></div><label><input name="clipContent" type="checkbox"> Clip content</label><div class="row"><label>Border width<input name="strokeWidth" type="number" min="0"></label><label>Border color<input name="strokeColor" type="color"></label></div><label>Shadow<input name="shadow" placeholder="0 8px 24px #0003"></label><div class="row"><label>Line height<input name="lineHeight" type="number" min="0.1" step="0.05"></label><label>Letter spacing<input name="letterSpacing" type="number" step="0.1"></label></div><label>Cross axis<select name="alignItems"><option>stretch</option><option>flex-start</option><option>center</option><option>flex-end</option></select></label><label>Main axis<select name="justifyContent"><option>flex-start</option><option>center</option><option>flex-end</option><option>space-between</option><option>space-around</option></select></label>`;
  form.append(appearance);
  const align = document.createElement("details");
  align.id = "align-tools";
  align.open = true;
  align.innerHTML = "<summary>Align & distribute</summary>";
  const grid = document.createElement("div");
  grid.className = "tool-grid";
  for (const [id, label] of [
    ["left", "Left"],
    ["center", "Center X"],
    ["right", "Right"],
    ["top", "Top"],
    ["middle", "Center Y"],
    ["bottom", "Bottom"],
    ["horizontal", "Distribute X"],
    ["vertical", "Distribute Y"],
  ]) {
    const b = document.createElement("button");
    b.type = "button";
    b.id = "precision-" + id;
    b.textContent = label;
    b.onclick = () => alignSelection(id);
    grid.append(b);
  }
  align.append(grid);
  form.append(align);
  const output = document.createElement("details");
  output.id = "artwork-export";
  output.open = true;
  output.innerHTML = `<summary>Export</summary><div class="row"><label>Scope<select id="artwork-scope"><option value="selection">Selection</option><option value="page">Page</option></select></label><label>Scale<select id="artwork-scale"><option value="1">1×</option><option value="2">2×</option><option value="3">3×</option></select></label></div><label>Format<select id="artwork-format"><option>PNG</option><option>SVG</option><option>JPG</option><option>WEBP</option><option>HTML</option></select></label><button type="button" id="artwork-download">Export artwork</button><p id="artwork-status" role="status"></p>`;
  form.append(output);
  $("#artwork-download").onclick = async () => {
    try {
      const format = $("#artwork-format").value,
        scale = Number($("#artwork-scale").value),
        result = await exportArtwork({
          format,
          scale,
          selectionOnly: $("#artwork-scope").value === "selection",
        });
      if (result.dataURL) {
        const a = document.createElement("a");
        a.href = result.dataURL;
        a.download = "design." + format.toLowerCase();
        a.click();
      } else download(result.content, "design." + format.toLowerCase(), result.mime);
      $("#artwork-status").textContent = "Exported " + result.width + " × " + result.height;
    } catch (e) {
      $("#artwork-status").textContent = e.message;
    }
  };
  for (const axis of ["w", "h"]) {
    const input = form.elements[axis],
      select = document.createElement("select");
    select.name = axis + "Mode";
    select.dataset.default = "fixed";
    select.className = "sizing-mode";
    select.setAttribute("aria-label", (axis === "w" ? "Width" : "Height") + " sizing");
    for (const [value, label] of [
      ["fixed", "Fixed"],
      ["hug", "Hug"],
      ["fill", "Fill"],
    ]) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      select.append(o);
    }
    input.after(select);
  }
  const hex = document.createElement("input");
  hex.id = "fill-hex";
  hex.placeholder = "#FFFFFF";
  hex.setAttribute("aria-label", "Fill hex color");
  form.elements.color.after(hex);
  hex.onchange = () => {
    if (!/^#[0-9a-f]{6}$/i.test(hex.value)) {
      hex.setCustomValidity("Use a six-digit hex color");
      hex.reportValidity();
      return;
    }
    hex.setCustomValidity("");
    form.elements.color.value = hex.value;
    form.elements.color.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const measure = document.createElement("div");
  measure.id = "selection-measure";
  measure.style.cssText =
    "position:absolute;pointer-events:none;z-index:10000;background:#b536da;color:white;font:11px system-ui;padding:3px 7px;border-radius:4px;white-space:nowrap;";
  $("#canvas-wrap").append(measure);
  const gallery = document.createElement("button");
  gallery.type = "button";
  gallery.id = "choose-shader";
  gallery.textContent = "Choose shader…";
  gallery.onclick = openShaderGallery;
  $("#shader-settings").append(gallery);
  form.elements.color.onclick = (e) => {
    e.preventDefault();
    openColorPicker();
  };
  const shaderSelect = form.elements.shaderPreset;
  for (const [value, label] of [
    ["ribbon", "Glass ribbon"],
    ["mesh", "Mesh flow"],
    ["swirl", "Swirl"],
  ]) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    shaderSelect.append(o);
  }
}
function updateMeasurement() {
  const n = chosen(),
    badge = $("#selection-measure");
  if (!badge) return;
  let name = $("#selection-name");
  if (!name) {
    name = document.createElement("span");
    name.id = "selection-name";
    $("#canvas-wrap").append(name);
  }
  name.hidden = badge.hidden = !n;
  if (n) {
    /* In the selection chrome's overlay (selection-chrome.js) CSS places label and badge: no layout read per pointer move. */ const placed =
        !!name.closest("#canvas-overlay"),
      drawn = canvasRender?.layerOf(n.id),
      el =
        drawn && canvas.contains(drawn)
          ? drawn
          : canvas.querySelector('[data-id="' + CSS.escape(n.id) + '"]'),
      rect = placed ? el && {} : el?.getBoundingClientRect(),
      parent = placed ? null : $("#canvas-wrap").getBoundingClientRect();
    if (rect) {
      name.textContent = n.name || n.type;
      if (!placed) {
        name.style.left = rect.left - parent.left + "px";
        name.style.top = rect.top - parent.top - 21 + "px";
      }
      const suffix = (axis) => {
        const m = sizingMode(n, axis),
          pct = n[axis + "Pct"];
        return m === "fixed" && pct !== undefined && n.parentId
          ? " " + pct + "%"
          : { hug: " Hug", fill: " Fill", calc: " Calc" }[m] || "";
      };
      badge.textContent = `${Math.round(n.w * 100) / 100}${suffix("w")} x ${Math.round(n.h * 100) / 100}${suffix("h")}`;
      if (!placed) {
        badge.style.left = rect.left - parent.left + rect.width / 2 + "px";
        badge.style.top = rect.bottom - parent.top + 7 + "px";
        badge.style.transform = "translateX(-50%)";
      }
    }
    $("#fill-hex").value = /^#[0-9a-f]{6}$/i.test(n.color) ? n.color : "";
  }
}
function alignSelection(mode) {
  const list = nodes().filter((n) => selection.has(n.id));
  if (list.length < 2) return;
  if (!list.every((n) => n.parentId === list[0].parentId)) {
    $("footer").textContent = "Align layers with the same parent.";
    return;
  }
  checkpoint();
  const horizontal = ["left", "center", "right", "horizontal"].includes(mode),
    key = horizontal ? "x" : "y",
    size = horizontal ? "w" : "h",
    min = Math.min(...list.map((n) => n[key])),
    max = Math.max(...list.map((n) => n[key] + n[size]));
  if (["horizontal", "vertical"].includes(mode)) {
    const sorted = list.toSorted((a, b) => a[key] - b[key]),
      total = sorted.reduce((sum, n) => sum + n[size], 0),
      gap = (max - min - total) / (sorted.length - 1);
    let pos = min;
    for (const n of sorted) {
      n[key] = pos;
      pos += n[size] + gap;
    }
  } else
    for (const n of list)
      n[key] = ["left", "top"].includes(mode)
        ? min
        : ["right", "bottom"].includes(mode)
          ? max - n[size]
          : (min + max - n[size]) / 2;
  render();
}
async function exportArtwork({
  format = "PNG",
  scale = 1,
  selectionOnly = true,
  screenshot = false,
} = {}) {
  scale = Math.max(1, Math.min(3, Number(scale) || 1));
  format = String(format).toUpperCase();
  let selected = selectionOnly
    ? nodes().filter((n) => selection.has(n.id))
    : nodes().filter((n) => !n.parentId);
  if (!selected.length) throw Error("Select at least one layer to export.");
  selected = window.VerynizeNodeIndex.of(nodes()).topmost(selected);
  const rects = selected.map((n) =>
      canvas.querySelector('[data-id="' + CSS.escape(n.id) + '"]').getBoundingClientRect(),
    ),
    base = canvas.getBoundingClientRect();
  const zoom = camera.zoom,
    visible = rects.filter((r) => r.width || r.height);
  if (!visible.length) throw Error("Nothing visible to export.");
  const x = Math.min(...visible.map((r) => (r.left - base.left) / zoom)),
    y = Math.min(...visible.map((r) => (r.top - base.top) / zoom)),
    w = Math.max(...visible.map((r) => (r.right - base.left) / zoom)) - x,
    h = Math.max(...visible.map((r) => (r.bottom - base.top) / zoom)) - y;
  const root = document.createElement("div");
  root.style.cssText = `position:relative;width:${w}px;height:${h}px;overflow:hidden`;
  const translated = document.createElement("div");
  translated.style.cssText = `position:absolute;left:${-x}px;top:${-y}px;width:1000px;height:700px`;
  for (const n of selected) {
    const el = layerElement(n, false);
    if (n.parentId) {
      const r = canvas
        .querySelector('[data-id="' + CSS.escape(n.id) + '"]')
        .getBoundingClientRect();
      el.style.left = (r.left - base.left) / zoom + "px";
      el.style.top = (r.top - base.top) / zoom + "px";
    }
    translated.append(el);
  }
  root.append(translated);
  const shader = selected.some((n) =>
    [...descendants(n.id)].some((id) => {
      const v = nodes().find((v) => v.id === id);
      return v?.type === "shader" || v?.shaderFill === true;
    }),
  );
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0}' +
    (window.embeddedFontCss?.(root.outerHTML) || "") +
    "</style></head><body>" +
    root.outerHTML +
    (shader ? "<script>" + window.BetterShaders.runtimeSource() + "</script>" : "") +
    "</body></html>";
  const portableMarkup = async (markup) => {
    const cloud = await (window.cloudAssets?.inlineHtml?.(markup) ?? markup);
    return window.assetStore ? window.assetStore.inlineMarkup(cloud) : cloud;
  };
  if (format === "HTML") return { content: await portableMarkup(html), mime: "text/html", width: w, height: h };
  if (format === "SVG") {
    const clone = root.cloneNode(true);
    for (const node of clone.querySelectorAll("[data-shader-preset]")) {
      const id = node.dataset.id,
        fill = node.dataset.shaderFill === "true",
        source = canvas.querySelector('[data-id="' + CSS.escape(id) + '"] > canvas.shader-surface');
      if (source) {
        const img = document.createElement("img");
        img.src = source.toDataURL("image/png");
        if (fill) {
          img.style.cssText =
            "position:absolute;inset:0;width:100%;height:100%;border-radius:inherit;z-index:-1";
          node.style.isolation = "isolate";
          node.prepend(img);
        } else {
          img.style.cssText = "width:100%;height:100%";
          node.append(img);
        }
      }
    }
    return {
      content: await portableMarkup(`<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>${window.embeddedFontCss?.(clone.outerHTML) || ""}</style>${new XMLSerializer().serializeToString(clone)}</div></foreignObject></svg>`),
      mime: "image/svg+xml",
      width: Math.ceil(w * scale),
      height: Math.ceil(h * scale),
    };
  }
  if (!window.verynizePlatform.can("rasterExport"))
    throw Error("Open the desktop app for pixel-accurate raster export.");
  /* The main process resolves room/hash assets through its per-render protocol allowlist. */ const raster =
    await window.desktop.renderDesign({
      html,
      width: Math.ceil(w - 1e-3),
      height: Math.ceil(h - 1e-3),
      scale,
      screenshot,
    });
  if (format === "PNG") return raster;
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(Error("Unable to convert raster"));
    image.src = raster.dataURL;
  });
  const bitmap = document.createElement("canvas");
  bitmap.width = raster.width;
  bitmap.height = raster.height;
  const ctx = bitmap.getContext("2d");
  if (format === "JPG") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, bitmap.width, bitmap.height);
  }
  ctx.drawImage(image, 0, 0);
  return {
    ...raster,
    dataURL: bitmap.toDataURL(format === "JPG" ? "image/jpeg" : "image/webp", 0.92),
  };
}

function openShaderGallery() {
  let cleanup = [];
  const dialog = document.createElement("dialog");
  dialog.id = "shader-gallery";
  dialog.style.cssText = "width:420px;max-width:90vw";
  dialog.innerHTML =
    '<div class="dialog-head"><strong>Choose shader</strong><button type="button">Close</button></div><div class="shader-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px"></div>';
  document.body.append(dialog);
  for (const [preset, title] of [
    ["aurora", "Aurora"],
    ["ribbon", "Glass ribbon"],
    ["mesh", "Mesh flow"],
    ["waves", "Waves"],
    ["noise", "Soft noise"],
    ["swirl", "Swirl"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.style.cssText = "padding:4px;text-align:left";
    const preview = document.createElement("div");
    preview.style.cssText =
      "position:relative;width:100%;height:90px;border-radius:7px;overflow:hidden";
    const label = document.createElement("span");
    label.textContent = title;
    label.style.cssText = "font-size:11px;display:block;padding:6px 2px";
    button.append(preview, label);
    dialog.querySelector(".shader-grid").append(button);
    button.onclick = () => {
      const n = chosen();
      if (n) {
        checkpoint();
        n.type = "shader";
        n.shaderPreset = preset;
        render();
      } else add("shader", { shaderPreset: preset, name: title + " shader" });
      dialog.close();
    };
    cleanup.push(() => {});
    requestAnimationFrame(() => {
      if (dialog.open)
        cleanup.push(
          window.BetterShaders.mount(preview, {
            preset,
            color: chosen()?.color || "#a58bdd",
            speed: 0.5,
            intensity: 1,
          }),
        );
    });
  }
  dialog.querySelector(".dialog-head button").onclick = () => dialog.close();
  dialog.addEventListener(
    "close",
    () => {
      cleanup.forEach((fn) => fn());
      dialog.remove();
    },
    { once: true },
  );
  dialog.showModal();
}
function openColorPicker() {
  const node = chosen();
  if (!node) return;
  const dialog = document.createElement("dialog");
  dialog.id = "color-dialog";
  dialog.style.cssText = "width:300px;max-width:90vw";
  dialog.innerHTML =
    '<div class="dialog-head"><strong>Color</strong><button type="button">Close</button></div><canvas id="color-field" width="256" height="200" style="width:100%;height:200px;touch-action:none;border-radius:6px;cursor:crosshair"></canvas><label>Hue<input id="color-hue" type="range" min="0" max="360" value="270"></label><label>Hex<input id="color-value" value="' +
    (/^#[0-9a-f]{6}$/i.test(node.color) ? node.color : "#a58bdd") +
    '"></label><label>Opacity<input id="color-opacity" type="range" min="0" max="100" value="' +
    node.opacity +
    '"></label>';
  document.body.append(dialog);
  let hue = 270;
  const field = dialog.querySelector("canvas"),
    ctx = field.getContext("2d");
  function paint() {
    ctx.fillStyle = `hsl(${hue},100%,50%)`;
    ctx.fillRect(0, 0, 256, 200);
    let gradient = ctx.createLinearGradient(0, 0, 256, 0);
    gradient.addColorStop(0, "white");
    gradient.addColorStop(1, "transparent");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 200);
    gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, "transparent");
    gradient.addColorStop(1, "black");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 200);
  }
  function commit(color) {
    const n = chosen();
    if (!n) return;
    n.color = color;
    n.token = "";
    dialog.querySelector("#color-value").value = color;
    render();
  }
  paint();
  field.onpointerdown = (event) => {
    checkpoint();
    field.setPointerCapture(event.pointerId);
    const move = (e) => {
      const rect = field.getBoundingClientRect(),
        x = Math.max(0, Math.min(255, Math.floor(((e.clientX - rect.left) / rect.width) * 256))),
        y = Math.max(0, Math.min(199, Math.floor(((e.clientY - rect.top) / rect.height) * 200)));
      const pixel = ctx.getImageData(x, y, 1, 1).data;
      commit(
        "#" +
          [...pixel]
            .slice(0, 3)
            .map((n) => n.toString(16).padStart(2, "0"))
            .join(""),
      );
    };
    move(event);
    field.onpointermove = move;
    field.onpointerup = () => {
      field.onpointermove = null;
      field.onpointerup = null;
    };
  };
  dialog.querySelector("#color-hue").oninput = (e) => {
    hue = Number(e.target.value);
    paint();
  };
  dialog.querySelector("#color-value").onchange = (e) => {
    if (/^#[0-9a-f]{6}$/i.test(e.target.value)) {
      checkpoint();
      commit(e.target.value);
    }
  };
  dialog.querySelector("#color-opacity").onchange = (e) => {
    checkpoint();
    chosen().opacity = Number(e.target.value);
    render();
  };
  dialog.querySelector("button").onclick = () => dialog.close();
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
}

window.addEventListener("app-preferences-changed", () => render());
