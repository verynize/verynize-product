const { onWindowClosed } = require("./window-cleanup.cjs");
const { BrowserWindow, dialog, webFrameMain, shell } = require("electron");
const fs = require("node:fs/promises");
function localURL(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw Error("Enter a localhost app URL, such as http://localhost:3000");
  return url.href;
}
// Explicit local-preview edits are transient DOM changes; capture turns them into design layers.
function editPreviewElement(options) {
  const key = "__verynizePreviewEdits";
  const history = window[key] || (window[key] = []);
  if (options.undo) {
    const previous = history.pop();
    if (!previous) return { undone: false };
    if (previous.element.isConnected) {
      if (previous.text !== null) previous.element.textContent = previous.text;
      if (previous.style === null) previous.element.removeAttribute("style");
      else previous.element.setAttribute("style", previous.style);
    }
    return { undone: true };
  }
  let element;
  try {
    element = document.querySelector(options.selector);
  } catch {
    throw Error("Enter a valid CSS selector");
  }
  if (!element || !(element instanceof HTMLElement))
    throw Error("No editable element matches this selector");
  if (
    element.matches("script,style,iframe,object,embed,input,textarea,select") ||
    element.closest("[contenteditable]")
  )
    throw Error("Choose a text or layout element");
  const computed = getComputedStyle(element);
  const keys = [
    "color",
    "backgroundColor",
    "fontSize",
    "fontWeight",
    "borderRadius",
    "padding",
    "margin",
    "opacity",
  ];
  if (options.inspect)
    return {
      selector: options.selector,
      tag: element.tagName.toLowerCase(),
      text: element.children.length ? null : element.textContent.slice(0, 10000),
      styles: Object.fromEntries(keys.map((key) => [key, computed[key]])),
    };
  if (options.text !== undefined && element.children.length)
    throw Error("Text editing requires an element without child elements");
  for (const [key, value] of Object.entries(options.styles || {})) {
    if (
      !keys.includes(key) ||
      typeof value !== "string" ||
      value.length > 200 ||
      /url\s*\(|expression|[{};]/i.test(value) ||
      (value &&
        !CSS.supports(
          key.replace(/[A-Z]/g, (char) => "-" + char.toLowerCase()),
          value,
        ))
    )
      throw Error("Unsupported style: " + key);
  }
  history.push({
    element,
    text: options.text !== undefined ? element.textContent : null,
    style: element.getAttribute("style"),
  });
  if (history.length > 50) history.shift();
  if (options.text !== undefined) element.textContent = options.text;
  for (const [key, value] of Object.entries(options.styles || {})) element.style[key] = value;
  return { applied: true, undoAvailable: true };
}
const { previewDom, domRequest } = require("./preview-dom.cjs");
const {
  snapshotDocument,
  finishSnapshot,
  probeInteractions,
  elementAtPoint,
  validRegion,
  captureModel,
} = require("./capture-core.cjs");
function registerPreview(handle, parent) {
  const windows = new Set();
  onWindowClosed(parent, () => {
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
  });
  handle(
    "previewApp",
    async ({ url, width = 1200, height = 800, capture = false, region = null }) => {
      const target = localURL(url);
      width = Math.max(320, Math.min(1920, Number(width) || 1200));
      height = Math.max(320, Math.min(1400, Number(height) || 800));
      if (region) {
        if (
          !["x", "y", "width", "height"].every((k) => Number.isFinite(region[k])) ||
          region.x < 0 ||
          region.y < 0 ||
          region.width < 1 ||
          region.height < 1 ||
          region.x + region.width > width ||
          region.y + region.height > height
        )
          throw Error("Capture region must lie inside the viewport");
      }
      const window = new BrowserWindow({
        width,
        height,
        useContentSize: true,
        show: !capture,
        title: "Local app preview",
        webPreferences: {
          partition: "preview-" + Date.now(),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      windows.add(window);
      window.on("closed", () => windows.delete(window));
      window.webContents.session.setPermissionRequestHandler((_w, _p, cb) => cb(false));
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      const restrict = (event, next) => {
        try {
          localURL(next);
        } catch {
          event.preventDefault();
        }
      };
      window.webContents.on("will-navigate", restrict);
      window.webContents.on("will-redirect", restrict);
      const blocked = new Set();
      if (capture)
        window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
          let allow = true;
          try {
            const u = new URL(details.url);
            allow =
              ["data:", "blob:", "about:"].includes(u.protocol) ||
              u.origin === new URL(target).origin;
          } catch {
            allow = false;
          }
          if (!allow) blocked.add("Cross-origin resource omitted");
          callback({ cancel: !allow });
        });
      try {
        await window.loadURL(target);
        if (!capture) return { opened: true };
        const snapshot = await window.webContents.executeJavaScript(
          "(" + snapshotDocument.toString() + ")(" + JSON.stringify(region) + ",{keep:true})",
        );
        await probeInteractions(window.webContents, snapshot);
        return finishSnapshot(snapshot, new URL(target).origin, [...blocked]);
      } finally {
        if (capture && !window.isDestroyed()) window.destroy();
      }
    },
  );
  handle("captureLivePreview", async ({ url, region = null, element = null, target } = {}) =>
    captureLiveFrame(parent, { url: localURL(url), region, element, name: frameName(target) }),
  );
  // Edit / Capture modes (web/preview-edit.js): hit testing, element info, staged DOM edits, direct text editing.
  handle("previewDom", async (options) =>
    previewFrame(parent).executeJavaScript(
      "(" + previewDom.toString() + ")(" + JSON.stringify(domRequest(options)) + ")",
    ),
  );
  // Region picker hover highlight: the element box under a point of the embedded preview viewport.
  handle("previewElementAt", async ({ x, y, target } = {}) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw Error("A viewport point is required");
    return previewFrame(parent, frameName(target)).executeJavaScript(
      "(" + elementAtPoint.toString() + ")(" + JSON.stringify({ x, y }) + ")",
    );
  });
  require("./capture-remote.cjs").registerRemoteCapture(handle, parent);
  const edit = async (options, inspect = false) => {
    if (!options || typeof options !== "object") throw Error("Preview edit options are required");
    if (!options.undo && (typeof options.selector !== "string" || options.selector.length > 1000))
      throw Error("A CSS selector is required");
    if (
      options.text !== undefined &&
      (typeof options.text !== "string" || options.text.length > 10000)
    )
      throw Error("Text exceeds the preview edit limit");
    return previewFrame(parent).executeJavaScript(
      "(" + editPreviewElement.toString() + ")(" + JSON.stringify({ ...options, inspect }) + ")",
    );
  };
  let inputToApp = false;
  const releaseInput = () => {
    inputToApp = false;
    if (!parent.webContents.isDestroyed()) {
      parent.webContents.setIgnoreMenuShortcuts(false);
      void parent.webContents
        .executeJavaScript("window.dispatchEvent(new Event('bd:preview-input-released'))")
        .catch(() => {});
    }
  };
  parent.webContents.on("before-input-event", (event, input) => {
    if (
      inputToApp &&
      input.type === "keyDown" &&
      input.key === "Escape" &&
      input.shift &&
      (input.meta || input.control)
    ) {
      event.preventDefault();
      releaseInput();
    }
  });
  parent.on("blur", releaseInput);
  handle("previewInput", async ({ enabled } = {}) => {
    if (typeof enabled !== "boolean") throw Error("Input mode must be a boolean");
    if (!enabled) {
      releaseInput();
      return { enabled: false };
    }
    const frame = previewFrame(parent);
    await frame.executeJavaScript(
      `(()=>{window.focus();if(!window.__verynizeInputRelease){window.__verynizeInputRelease=true;document.addEventListener('keydown',event=>{if(event.key==='Escape'&&event.shiftKey&&(event.metaKey||event.ctrlKey)){event.preventDefault();event.stopImmediatePropagation();parent.postMessage({type:'verynize-preview-release-input'},'*');}},true);}})()`,
    );
    inputToApp = true;
    parent.webContents.setIgnoreMenuShortcuts(true);
    return { enabled: true };
  });
  handle("previewOpenBrowser", ({ target } = {}) =>
    shell.openExternal(localURL(previewFrame(parent, frameName(target)).url)),
  );
  // Current address of a preview frame (the expanded tab's path field follows in-app navigation).
  handle("previewLocation", async ({ target } = {}) => ({
    url: localURL(previewFrame(parent, frameName(target)).url),
  }));
  handle("previewNavigate", async ({ direction, target, ignoreCache = false } = {}) => {
    if (!["back", "forward", "reload"].includes(direction))
      throw Error("Invalid preview navigation");
    const frame = previewFrame(parent, frameName(target));
    // ⇧-click Reload: drop the app's cached responses first, so the reload refetches every resource.
    if (direction === "reload" && ignoreCache === true) {
      const session = parent.webContents.session,
        origin = new URL(frame.url).origin;
      try {
        await session.clearData({ dataTypes: ["cache"], origins: [origin] });
      } catch {
        await session.clearCache();
      }
    }
    await frame.executeJavaScript(
      direction === "reload"
        ? "location.reload()"
        : direction === "back"
          ? "history.back()"
          : "history.forward()",
    );
    return { navigated: true };
  });
  // "Clear preview data" (preview audit PF5): the embedded preview shares the editor window's session, so the clear is
  // scoped to the app's localhost origin. Site storage goes; cookies (logins) only when asked. Cookies are host-scoped,
  // not port-scoped, so the logins variant clears the cookies of every port on that host. sessionStorage lives in the
  // page, so it is cleared there before the reload.
  handle("previewClearData", async ({ url, logins = false } = {}) => {
    if (typeof logins !== "boolean") throw Error("Invalid preview data option");
    const origin = new URL(localURL(url)).origin;
    const storages = [
      "filesystem",
      "indexdb",
      "localstorage",
      "shadercache",
      "websql",
      "serviceworkers",
      "cachestorage",
    ];
    if (logins) storages.push("cookies");
    await parent.webContents.session.clearStorageData({ origin, storages });
    const frame = parent.webContents.mainFrame.frames.find(
      (candidate) => candidate.name === PREVIEW_FRAME,
    );
    let reloaded = false;
    try {
      if (frame && new URL(frame.url).origin === origin) {
        await frame.executeJavaScript("try{sessionStorage.clear()}catch{}location.reload()");
        reloaded = true;
      }
    } catch {}
    return { cleared: true, origin, logins, reloaded };
  });
  // The frame's address follows in-app navigation (links, redirects, history.pushState) in the toolbar path field.
  const navigated = (url, pid, rid) => {
    let frame = null;
    try {
      frame = webFrameMain.fromId(pid, rid);
    } catch {}
    if (
      !frame ||
      frame.name !== PREVIEW_FRAME ||
      frame.parent !== parent.webContents.mainFrame ||
      parent.webContents.isDestroyed()
    )
      return;
    try {
      localURL(url);
    } catch {
      return;
    }
    parent.webContents.send("desktop:preview-navigated", { url });
  };
  parent.webContents.on("did-frame-navigate", (_event, url, _code, _status, isMain, pid, rid) => {
    if (!isMain) navigated(url, pid, rid);
  });
  parent.webContents.on("did-navigate-in-page", (_event, url, isMain, pid, rid) => {
    if (!isMain) navigated(url, pid, rid);
  });
  handle("previewInspect", (options) => edit(options, true));
  handle("previewEdit", (options) => edit(options));
  automations.set(parent, createPreviewAutomation(parent)); // agent shell tools (desktop/agent-shell.cjs)
  handle("exportPDF", async (html) => {
    if (typeof html !== "string" || Buffer.byteLength(html) > 5 * 1024 * 1024)
      throw Error("Design exceeds PDF size limit");
    const result = await dialog.showSaveDialog(parent, {
      defaultPath: "design.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (result.canceled) return false;
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        partition: "pdf-" + Date.now(),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        javascript: false,
      },
    });
    try {
      const locked = html.replace(
        /<head[^>]*>/i,
        "$&<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:\">",
      );
      await window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(locked));
      const pdf = await window.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
      });
      await fs.writeFile(result.filePath, pdf);
      return true;
    } finally {
      window.destroy();
    }
  });
}
async function captureLiveFrame(
  parent,
  { url, region = null, element = null, name = PREVIEW_FRAME } = {},
) {
  if (element !== null && (typeof element !== "string" || !element || element.length > 1000))
    throw Error("Invalid element path");
  const frame = parent.webContents.mainFrame.frames.find((candidate) => candidate.name === name);
  if (!frame || frame.parent !== parent.webContents.mainFrame)
    throw Error("Open the running app preview first");
  const actual = new URL(localURL(frame.url));
  if (url) {
    const expected = new URL(localURL(url));
    if (actual.origin !== expected.origin)
      throw Error("Preview navigated to a different origin; load it explicitly before capturing");
  }
  const viewport = await frame.executeJavaScript("({width:innerWidth,height:innerHeight})");
  if (region && !validRegion(region, viewport.width, viewport.height))
    throw Error("Capture region must lie inside the live viewport");
  const snapshot = await frame.executeJavaScript(
    "(" +
      snapshotDocument.toString() +
      ")(" +
      JSON.stringify(element ? null : region) +
      (element ? "," + JSON.stringify({ root: element }) : "") +
      ")",
  );
  if (frame.url !== actual.href)
    throw Error("Preview navigated during capture; retry after loading completes");
  return finishSnapshot(snapshot, actual.origin);
}
// ---------------------------------------------------------------------------------------------
// Agent automation of the embedded running-app preview (the iframe named PREVIEW_FRAME in the
// editor window). Used by the bridge-only MCP shell tools through desktop/agent-shell.cjs.
// Posture: every call re-checks that the preview frame shows a localhost URL; the only scripts run
// in the page are the fixed functions below with JSON-encoded arguments (agents never supply
// code); password values are never read back. Clicks and typing are trusted input events sent
// through the editor window's DevTools protocol input domain (webContents.sendInputEvent does not
// reach the out-of-process preview frame); if the debugger cannot attach (DevTools open), they
// fall back to synthetic DOM events inside the page and report input:"synthetic".
const PREVIEW_FRAME = "verynize-live-preview";
// The expanded "Open in a tab" preview (web/src/islands/chrome/preview-tab) is a second iframe with its own page
// state; renderer calls opt into it with {target:'tab'}. Agent automation keeps acting on the canvas frame only.
const PREVIEW_TAB_FRAME = "verynize-preview-tab";
const frameName = (target) =>
  target === undefined || target === null || target === "canvas"
    ? PREVIEW_FRAME
    : target === "tab"
      ? PREVIEW_TAB_FRAME
      : (() => {
          throw Error("Unknown preview target");
        })();
const automations = new WeakMap();
const CONSOLE_LIMIT = 500,
  CONSOLE_TEXT = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// In-page: readable outline (landmarks, headings, text, controls with selectors) or plain text.
function outlinePage(opts) {
  const maxChars = opts.maxChars,
    lines = [];
  let size = 0,
    truncated = false;
  const root = opts.selector ? document.querySelector(opts.selector) : document.body;
  if (!root) return { error: "No element matches " + opts.selector };
  const clip = (v, n) => {
    v = String(v || "")
      .replace(/\s+/g, " ")
      .trim();
    return v.length > n ? v.slice(0, n) + "…" : v;
  };
  const base = {
    url: location.href,
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight },
    scroll: {
      x: Math.round(scrollX),
      y: Math.round(scrollY),
      height: document.documentElement.scrollHeight,
    },
  };
  if (opts.mode === "text") {
    const masked = [...root.querySelectorAll("input[type=password]")];
    const text = clip(root.innerText, 1e7);
    return {
      ...base,
      text: text.length > maxChars ? text.slice(0, maxChars) : text,
      truncated: text.length > maxChars,
      passwordFields: masked.length,
    };
  }
  const unique = (s) => {
    try {
      return document.querySelectorAll(s).length === 1;
    } catch {
      return false;
    }
  };
  const selectorFor = (el) => {
    if (el.id && unique("#" + CSS.escape(el.id))) return "#" + CSS.escape(el.id);
    for (const a of ["data-testid", "data-test", "name", "aria-label", "placeholder"]) {
      const v = el.getAttribute(a);
      if (v && v.length < 80) {
        const s = el.tagName.toLowerCase() + "[" + a + '="' + v.replace(/["\\]/g, "\\$&") + '"]';
        if (unique(s)) return s;
      }
    }
    const parts = [];
    let node = el;
    while (
      node &&
      node !== document.body &&
      node !== document.documentElement &&
      parts.length < 10
    ) {
      if (node !== el && node.id && unique("#" + CSS.escape(node.id))) {
        parts.unshift("#" + CSS.escape(node.id));
        return parts.join(" > ");
      }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = parent;
    }
    return "body > " + parts.join(" > ");
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const c = getComputedStyle(el);
    return c.visibility !== "hidden" && c.display !== "none";
  };
  const labelOf = (el) => {
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText || "")
        .join(" ");
      if (t.trim()) return t;
    }
    return (
      el.getAttribute("aria-label") ||
      (el.labels && el.labels[0]?.innerText) ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      el.getAttribute("alt") ||
      ""
    );
  };
  const landmarks = {
    NAV: "navigation",
    MAIN: "main",
    HEADER: "banner",
    FOOTER: "contentinfo",
    ASIDE: "complementary",
    FORM: "form",
    DIALOG: "dialog",
  };
  const skip = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "META",
    "LINK",
    "HEAD",
    "IFRAME",
    "OBJECT",
    "EMBED",
    "CANVAS",
  ]);
  const emit = (depth, line) => {
    if (truncated) return;
    const s = "  ".repeat(Math.min(depth, 8)) + line;
    if (size + s.length + 1 > maxChars || lines.length >= 1500) {
      truncated = true;
      return;
    }
    lines.push(s);
    size += s.length + 1;
  };
  let interactive = 0;
  const walk = (el, depth, inControl) => {
    if (truncated || skip.has(el.tagName) || el.getAttribute("aria-hidden") === "true") return;
    if (!visible(el) && el !== document.body) return;
    const tag = el.tagName,
      role = el.getAttribute("role");
    let next = depth,
      control = inControl;
    const sel = () => " [" + selectorFor(el) + "]";
    if (/^H[1-6]$/.test(tag) || role === "heading") {
      emit(
        depth,
        "heading" + (tag[0] === "H" ? " " + tag[1] : "") + ' "' + clip(el.innerText, 200) + '"',
      );
      return;
    }
    if (tag === "A" && el.hasAttribute("href")) {
      interactive++;
      emit(
        depth,
        'link "' +
          clip(labelOf(el) || el.innerText, 160) +
          '" → ' +
          clip(el.getAttribute("href"), 200) +
          sel(),
      );
      return;
    }
    if (
      tag === "BUTTON" ||
      role === "button" ||
      tag === "SUMMARY" ||
      (tag === "INPUT" && ["button", "submit", "reset"].includes(el.type))
    ) {
      interactive++;
      emit(
        depth,
        'button "' +
          clip(labelOf(el) || el.innerText || el.value, 160) +
          '"' +
          (el.disabled ? " (disabled)" : "") +
          sel(),
      );
      return;
    }
    if (tag === "INPUT" || tag === "TEXTAREA") {
      if (el.type === "hidden") return;
      interactive++;
      if (el.type === "password") {
        emit(depth, 'password field "' + clip(labelOf(el), 120) + '" (value hidden)' + sel());
        return;
      }
      if (el.type === "checkbox" || el.type === "radio") {
        emit(
          depth,
          el.type +
            ' "' +
            clip(labelOf(el), 120) +
            '" ' +
            (el.checked ? "checked" : "unchecked") +
            sel(),
        );
        return;
      }
      if (el.type === "file") {
        emit(depth, 'file input "' + clip(labelOf(el), 120) + '"' + sel());
        return;
      }
      emit(
        depth,
        (tag === "TEXTAREA"
          ? "textarea"
          : "textbox" + (el.type && el.type !== "text" ? " (" + el.type + ")" : "")) +
          ' "' +
          clip(labelOf(el), 120) +
          '" value="' +
          clip(el.value, 200) +
          '"' +
          (el.disabled ? " (disabled)" : "") +
          sel(),
      );
      return;
    }
    if (tag === "SELECT") {
      interactive++;
      emit(
        depth,
        'select "' +
          clip(labelOf(el), 120) +
          '" selected="' +
          clip([...el.selectedOptions].map((o) => o.textContent).join(", "), 160) +
          '" options=' +
          el.options.length +
          sel(),
      );
      return;
    }
    if (el.isContentEditable && !el.parentElement?.isContentEditable) {
      interactive++;
      emit(
        depth,
        'editable "' + clip(labelOf(el), 80) + '" text="' + clip(el.innerText, 200) + '"' + sel(),
      );
      return;
    }
    if (tag === "IMG") {
      const alt = el.getAttribute("alt");
      if (alt) emit(depth, 'img "' + clip(alt, 160) + '"');
      return;
    }
    if (tag === "svg" || tag === "SVG") {
      const l = labelOf(el);
      if (l) emit(depth, 'img "' + clip(l, 120) + '"');
      return;
    }
    const mark =
      landmarks[tag] ||
      (role &&
      [
        "navigation",
        "main",
        "dialog",
        "alertdialog",
        "alert",
        "status",
        "tablist",
        "menu",
        "toolbar",
        "search",
      ].includes(role)
        ? role
        : null);
    if (mark && !(tag === "DIALOG" && !el.open)) {
      emit(depth, mark + (labelOf(el) ? ' "' + clip(labelOf(el), 80) + '"' : "") + ":");
      next = depth + 1;
    }
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join(" ");
    if (own.trim() && !control) emit(next, 'text "' + clip(own, 300) + '"');
    for (const child of el.children) walk(child, next, control);
  };
  walk(root, 0, false);
  return { ...base, outline: lines.join("\n"), interactive, truncated };
}

// In-page: find a target by selector or viewport point, bring it into view, report its center.
function locateTarget(t) {
  let el;
  if (t.selector) {
    try {
      el = document.querySelector(t.selector);
    } catch {
      return { error: "Invalid CSS selector: " + t.selector };
    }
    if (!el) return { missing: true };
    if (t.scroll !== false) el.scrollIntoView({ block: "center", inline: "center" });
  } else {
    if (!(t.x >= 0 && t.y >= 0 && t.x < innerWidth && t.y < innerHeight))
      return {
        error:
          "Point " +
          t.x +
          "," +
          t.y +
          " lies outside the preview viewport (" +
          innerWidth +
          "x" +
          innerHeight +
          ")",
      };
    el = document.elementFromPoint(t.x, t.y);
    if (!el) return { error: "Nothing at that point" };
  }
  const r = el.getBoundingClientRect();
  const x = t.selector ? Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1) : t.x,
    y = t.selector ? Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1) : t.y;
  const hit = document.elementFromPoint(x, y);
  const covered = t.selector && hit && hit !== el && !el.contains(hit) && !hit.contains(el);
  const name = (
    el.getAttribute("aria-label") ||
    el.innerText ||
    el.getAttribute("placeholder") ||
    (el.value && el.type !== "password" && el.value) ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return {
    x,
    y,
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    tag: el.tagName.toLowerCase(),
    name,
    disabled: !!el.disabled,
    viewport: { width: innerWidth, height: innerHeight },
    ...(covered ? { obscuredBy: hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : "") } : {}),
  };
}

// In-page fallback when trusted input is unavailable: DOM events at a viewport point / into the focused field.
function syntheticInput(o) {
  if (o.kind === "click") {
    const el = document.elementFromPoint(o.x, o.y);
    if (!el) return false;
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: o.x,
      clientY: o.y,
      button: 0,
      view: window,
    };
    for (let i = 1; i <= o.count; i++) {
      el.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerId: 1, isPrimary: true }));
      el.dispatchEvent(new MouseEvent("mousedown", { ...init, detail: i }));
      if (i === 1 && typeof el.focus === "function") el.focus();
      el.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerId: 1, isPrimary: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { ...init, detail: i }));
      el.click();
    }
    if (o.count === 2) el.dispatchEvent(new MouseEvent("dblclick", { ...init, detail: 2 }));
    return true;
  }
  const el = document.activeElement;
  if (!el) return false;
  if (o.kind === "text") {
    if (el.isContentEditable) {
      document.execCommand("insertText", false, o.text);
      return true;
    }
    if (!("value" in el)) return false;
    const proto =
      el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const start = el.selectionStart ?? el.value.length,
      end = el.selectionEnd ?? el.value.length;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(
      el,
      el.value.slice(0, start) + o.text + el.value.slice(end),
    );
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: o.text, inputType: "insertText" }),
    );
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  if (o.kind === "enter") {
    const init = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    const go = el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
    if (go && el.form && el.tagName === "INPUT") el.form.requestSubmit();
    return true;
  }
  return false;
}

// In-page: describe the focused control (password values masked); optionally select its content.
function focusedControl(o) {
  const el = document.activeElement;
  if (!el || el === document.body) return { focused: false };
  const editable =
    ("value" in el && ["INPUT", "TEXTAREA"].includes(el.tagName)) || el.isContentEditable;
  if (o && o.select && editable) {
    if (typeof el.select === "function") el.select();
    else {
      const range = document.createRange();
      range.selectNodeContents(el);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(range);
    }
  }
  const secret = el.type === "password";
  return {
    focused: true,
    editable,
    tag: el.tagName.toLowerCase(),
    type: el.type || null,
    value: secret
      ? undefined
      : String(el.isContentEditable ? el.innerText : (el.value ?? "")).slice(0, 500),
    password: secret,
  };
}

// In-page: scroll an element into view, a scroll container by deltas, or the page.
function scrollPage(o) {
  const state = (target) => ({
    scrollX: Math.round(scrollX),
    scrollY: Math.round(scrollY),
    pageHeight: document.documentElement.scrollHeight,
    viewport: { width: innerWidth, height: innerHeight },
    ...(target ? { container: target } : {}),
  });
  let el = null;
  if (o.selector) {
    try {
      el = document.querySelector(o.selector);
    } catch {
      return { error: "Invalid CSS selector: " + o.selector };
    }
    if (!el) return { error: "No element matches " + o.selector };
  }
  if (el && !o.deltaX && !o.deltaY && !o.to) {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    return state();
  }
  const scrollable = (node) => {
    for (
      let n = node;
      n && n !== document.body && n !== document.documentElement;
      n = n.parentElement
    ) {
      const c = getComputedStyle(n);
      if (
        /(auto|scroll|overlay)/.test(c.overflowY + c.overflowX) &&
        (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1)
      )
        return n;
    }
    return null;
  };
  const page = document.scrollingElement || document.documentElement;
  let box = el ? scrollable(el) || (el.scrollHeight > el.clientHeight ? el : null) : null;
  if (!box && page.scrollHeight <= innerHeight + 1 && page.scrollWidth <= innerWidth + 1)
    box = scrollable(document.elementFromPoint(innerWidth / 2, innerHeight / 2));
  const target = box || page,
    before = [target.scrollLeft, target.scrollTop];
  if (o.to === "top") target.scrollTo(0, 0);
  else if (o.to === "bottom") target.scrollTo(target.scrollLeft, target.scrollHeight);
  else target.scrollBy(o.deltaX || 0, o.deltaY || 0);
  const desc = box
    ? {
        tag: box.tagName.toLowerCase(),
        id: box.id || null,
        scrollTop: Math.round(box.scrollTop),
        scrollHeight: box.scrollHeight,
      }
    : null;
  return {
    ...state(desc),
    moved: before[0] !== target.scrollLeft || before[1] !== target.scrollTop,
    atEnd: target.scrollTop + (box ? box.clientHeight : innerHeight) >= target.scrollHeight - 1,
  };
}

function previewFrame(parent, name = PREVIEW_FRAME) {
  const frame = parent.webContents.mainFrame.frames.find((candidate) => candidate.name === name);
  if (
    !frame ||
    frame.parent !== parent.webContents.mainFrame ||
    !frame.url ||
    frame.url === "about:blank"
  )
    throw Error("The running-app preview is not open; call preview_open first");
  try {
    localURL(frame.url);
  } catch {
    throw Error(
      "The preview left localhost (" +
        String(frame.url).slice(0, 200) +
        "); open a localhost URL with preview_open",
    );
  }
  return frame;
}

function createPreviewAutomation(parent) {
  const wc = parent.webContents,
    entries = [];
  let seq = 0;
  const record = (level, text, source = "") => {
    entries.push({
      seq: ++seq,
      at: Date.now(),
      level,
      text: String(text).slice(0, CONSOLE_TEXT),
      source: String(source).slice(0, 300),
    });
    if (entries.length > CONSOLE_LIMIT) entries.shift();
  };
  const isPreview = (frame) => {
    try {
      return frame && frame.name === PREVIEW_FRAME;
    } catch {
      return false;
    }
  };
  wc.on("console-message", (event) => {
    if (!isPreview(event.frame)) return;
    const level =
      typeof event.level === "string"
        ? event.level
        : ["debug", "info", "warning", "error"][event.level] || "info";
    record(level, event.message, event.sourceId ? event.sourceId + ":" + event.lineNumber : "");
  });
  const frameOf = (pid, rid) => {
    try {
      return webFrameMain.fromId(pid, rid);
    } catch {
      return null;
    }
  };
  wc.on("did-frame-navigate", (_e, url, code, statusText, isMain, pid, rid) => {
    if (isMain || !isPreview(frameOf(pid, rid))) return;
    record(
      code >= 400 ? "error" : "info",
      "Navigated to " +
        url +
        (code ? " (" + code + (statusText ? " " + statusText : "") + ")" : ""),
      "navigation",
    );
  });
  wc.on("did-fail-load", (_e, code, description, url, isMain, pid, rid) => {
    if (isMain || code === -3 || !isPreview(frameOf(pid, rid))) return;
    record("error", "Failed to load " + url + ": " + description + " (" + code + ")", "navigation");
  });
  // The editor page: our own renderer. Fixed expressions only, with JSON-encoded values.
  const editor = (expression) => wc.executeJavaScript(expression);
  const paneState = () =>
    editor(
      `(()=>{const pane=document.getElementById('live-preview'),frame=document.getElementById('live-frame');if(!pane||!frame)return null;const r=frame.getBoundingClientRect();return {open:!pane.hidden,url:window.livePreview?.getURL?.()||'',scaleX:r.width/frame.offsetWidth,scaleY:r.height/frame.offsetHeight,rect:{x:r.left+frame.clientLeft*(r.width/frame.offsetWidth),y:r.top+frame.clientTop*(r.height/frame.offsetHeight),width:frame.clientWidth,height:frame.clientHeight}}})()`,
    );
  const run = (frame, fn, arg) =>
    frame.executeJavaScript("(" + fn.toString() + ")(" + JSON.stringify(arg ?? null) + ")");
  async function waitForLoad(expected, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      try {
        const frame = previewFrame(parent);
        const href = frame.url;
        if (!expected || new URL(href).origin === new URL(expected).origin) {
          const ready = await run(frame, () => document.readyState);
          if (ready === "complete")
            return {
              url: frame.url,
              title: await run(frame, () => document.title),
              loading: false,
            };
        }
        last = href;
      } catch {}
      await sleep(100);
    }
    return { url: last, loading: true };
  }
  async function reveal() {
    const state = await paneState();
    if (!state) throw Error("This window has no preview pane");
    if (!state.open) {
      const ok = await editor(`window.livePreview?.reveal?.()`);
      if (!ok) throw Error("The running-app preview is not open; call preview_open first");
      await sleep(150);
    }
    const now = await paneState();
    if (!now?.open || now.rect.width < 1 || now.rect.height < 1)
      throw Error("The preview pane is not visible");
    return now;
  }
  async function locate(target, timeoutMs = 3000) {
    const deadline = Date.now() + Math.max(0, Math.min(15000, timeoutMs));
    for (;;) {
      const frame = previewFrame(parent);
      const found = await run(frame, locateTarget, target);
      if (found.error) throw Error(found.error);
      if (!found.missing) return { frame, found };
      if (Date.now() >= deadline)
        throw Error(
          "No element matches " +
            target.selector +
            " in the preview (waited " +
            Math.round(timeoutMs / 1000) +
            "s); use preview_snapshot to find a selector",
        );
      await sleep(150);
    }
  }
  // Trusted input through the DevTools protocol (coordinates in editor-page CSS px). Returns false
  // when the debugger is unavailable so callers can fall back to syntheticInput.
  async function trusted(steps) {
    const d = wc.debugger;
    let mine = false;
    try {
      if (!d.isAttached()) {
        d.attach("1.3");
        mine = true;
      }
    } catch {
      return false;
    }
    try {
      for (const [method, params] of steps) await d.sendCommand(method, params);
      return true;
    } catch {
      return false;
    } finally {
      if (mine)
        try {
          d.detach();
        } catch {}
    }
  }
  async function clickAt(pane, point, clickCount = 1) {
    await editor("window.livePreview.reveal();window.livePreview.navigateMode()");
    const x = pane.rect.x + point.x * pane.scaleX,
      y = pane.rect.y + point.y * pane.scaleY;
    // A freshly loaded cross-origin preview frame can drop the first input until the browser can hit-test
    // it, so hover until the frame reports a trusted pointermove (bounded) before pressing.
    const frame = previewFrame(parent);
    const armed = await run(frame, () => {
      window.__verynizeHover = false;
      addEventListener(
        "pointermove",
        (e) => {
          if (e.isTrusted) window.__verynizeHover = true;
        },
        { capture: true },
      );
      return true;
    }).catch(() => false);
    if (armed)
      for (let i = 0, deadline = Date.now() + 1500; Date.now() < deadline; i++) {
        if (
          !(await trusted([
            ["Input.dispatchMouseEvent", { type: "mouseMoved", x: x + (i % 2 ? 0.5 : 0), y }],
          ]))
        )
          break;
        if (await run(frame, () => window.__verynizeHover === true).catch(() => false)) break;
        await sleep(50);
      }
    const steps = [["Input.dispatchMouseEvent", { type: "mouseMoved", x, y }]];
    for (let i = 1; i <= clickCount; i++)
      steps.push(
        [
          "Input.dispatchMouseEvent",
          { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: i },
        ],
        [
          "Input.dispatchMouseEvent",
          { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: i },
        ],
      );
    const ok = await trusted(steps);
    if (!ok)
      await run(previewFrame(parent), syntheticInput, {
        kind: "click",
        x: point.x,
        y: point.y,
        count: clickCount,
      });
    await sleep(50);
    return ok ? "trusted" : "synthetic";
  }
  async function typeText(text) {
    if (await trusted([["Input.insertText", { text }]])) return "trusted";
    await run(previewFrame(parent), syntheticInput, { kind: "text", text });
    return "synthetic";
  }
  async function pressEnter() {
    const key = {
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    };
    if (
      await trusted([
        ["Input.dispatchKeyEvent", { type: "keyDown", ...key, text: "\r" }],
        ["Input.dispatchKeyEvent", { type: "keyUp", ...key }],
      ])
    )
      return "trusted";
    await run(previewFrame(parent), syntheticInput, { kind: "enter" });
    return "synthetic";
  }
  async function pressBackspace() {
    const key = {
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
      nativeVirtualKeyCode: 8,
    };
    if (
      await trusted([
        ["Input.dispatchKeyEvent", { type: "keyDown", ...key }],
        ["Input.dispatchKeyEvent", { type: "keyUp", ...key }],
      ])
    )
      return;
    await run(previewFrame(parent), syntheticInput, { kind: "text", text: "" });
  }
  const targetOf = (args) =>
    args.selector
      ? { selector: String(args.selector) }
      : Number.isFinite(args.x) && Number.isFinite(args.y)
        ? { x: args.x, y: args.y }
        : null;
  return {
    async open({ url, reload = true, timeoutMs = 15000 } = {}) {
      if (url) {
        const target = localURL(url);
        let current = "";
        try {
          current = previewFrame(parent).url;
        } catch {}
        if (reload || current !== target) {
          await editor(`window.livePreview.show(${JSON.stringify(target)})`);
          await sleep(50);
        } else await reveal();
        const loaded = await waitForLoad(target, timeoutMs);
        return { ...loaded, opened: true };
      }
      await reveal();
      return { ...(await waitForLoad(null, timeoutMs)), opened: true };
    },
    async state() {
      const pane = await paneState();
      let frame = null;
      try {
        frame = previewFrame(parent);
      } catch {}
      return {
        open: !!pane?.open,
        url: frame?.url || pane?.url || null,
        viewport: pane ? { width: pane.rect.width, height: pane.rect.height } : null,
      };
    },
    async snapshot({ selector, mode = "outline", maxChars = 20000 } = {}) {
      const frame = previewFrame(parent);
      const result = await run(frame, outlinePage, {
        selector: selector || null,
        mode,
        maxChars: Math.max(1000, Math.min(60000, maxChars | 0 || 20000)),
      });
      if (result.error) throw Error(result.error);
      return result;
    },
    async screenshot({ selector, maxWidth = 1600 } = {}) {
      const pane = await reveal();
      let rect = { x: 0, y: 0, width: pane.rect.width, height: pane.rect.height };
      if (selector) {
        const { found } = await locate({ selector: String(selector) });
        const r = found.rect;
        const x = Math.max(0, r.x),
          y = Math.max(0, r.y);
        rect = {
          x,
          y,
          width: Math.min(pane.rect.width, r.x + r.width) - x,
          height: Math.min(pane.rect.height, r.y + r.height) - y,
        };
        if (rect.width < 1 || rect.height < 1)
          throw Error("The element is not inside the visible preview viewport");
      }
      await sleep(80);
      const zoom = wc.getZoomFactor() || 1;
      let image = await wc.capturePage({
        x: Math.round((pane.rect.x + rect.x * pane.scaleX) * zoom),
        y: Math.round((pane.rect.y + rect.y * pane.scaleY) * zoom),
        width: Math.max(1, Math.round(rect.width * pane.scaleX * zoom)),
        height: Math.max(1, Math.round(rect.height * pane.scaleY * zoom)),
      });
      if (image.isEmpty())
        throw Error("The preview could not be captured (is the window minimized?)");
      const limit = Math.max(200, Math.min(2400, maxWidth | 0 || 1600));
      if (image.getSize().width > limit) image = image.resize({ width: limit, quality: "good" });
      let png = image.toPNG();
      while (png.length > 4 * 1024 * 1024 && image.getSize().width > 400) {
        image = image.resize({ width: Math.round(image.getSize().width * 0.7), quality: "good" });
        png = image.toPNG();
      }
      const size = image.getSize();
      return {
        data: png.toString("base64"),
        mimeType: "image/png",
        width: size.width,
        height: size.height,
        viewport: { width: pane.rect.width, height: pane.rect.height },
        url: previewFrame(parent).url,
        ...(selector ? { selector: String(selector), region: rect } : {}),
      };
    },
    async click({ selector, x, y, doubleClick = false, timeoutMs } = {}) {
      const target = targetOf({ selector, x, y });
      if (!target) throw Error("Pass a CSS selector or x and y viewport coordinates");
      const pane = await reveal();
      const { found } = await locate(target, timeoutMs);
      if (found.disabled) throw Error("The target <" + found.tag + "> is disabled");
      const before = previewFrame(parent).url;
      const input = await clickAt(pane, found, doubleClick ? 2 : 1);
      await sleep(250);
      let after = before;
      try {
        after = previewFrame(parent).url;
      } catch {}
      return {
        clicked: {
          tag: found.tag,
          name: found.name,
          x: Math.round(found.x),
          y: Math.round(found.y),
        },
        input,
        ...(found.obscuredBy
          ? {
              warning:
                "Another element (" +
                found.obscuredBy +
                ") covers the target center; the click landed on it",
            }
          : {}),
        url: after,
        navigated: after !== before,
      };
    },
    async type({ selector, x, y, text, clear = false, submit = false, timeoutMs } = {}) {
      if (typeof text !== "string") throw Error("text is required");
      const pane = await reveal();
      const target = targetOf({ selector, x, y });
      if (target) {
        const { found } = await locate(target, timeoutMs);
        if (found.disabled) throw Error("The target <" + found.tag + "> is disabled");
        await clickAt(pane, found);
      }
      let frame = previewFrame(parent);
      const focus = await run(frame, focusedControl, { select: clear });
      if (!focus.focused || !focus.editable)
        throw Error(
          target
            ? "The target did not take keyboard focus; pass the selector of an input, textarea or editable element"
            : "Nothing editable is focused in the preview; pass a selector",
        );
      if (clear && text === "") await pressBackspace();
      let input = "trusted";
      if (text) input = await typeText(text);
      if (submit) {
        await pressEnter();
        await sleep(250);
      }
      await sleep(50);
      let state = {};
      try {
        frame = previewFrame(parent);
        state = await run(frame, focusedControl, {});
      } catch {}
      return {
        typed: text.length,
        submitted: !!submit,
        input,
        field: { tag: focus.tag, type: focus.type },
        ...(state.focused && !state.password && state.value !== undefined
          ? { value: state.value }
          : {}),
        ...(focus.password ? { note: "Password field: the value is never read back" } : {}),
        url: frame.url,
      };
    },
    async scroll({ selector, deltaX = 0, deltaY = 0, to } = {}) {
      if (!selector && !deltaX && !deltaY && !to)
        throw Error('Pass selector, deltaX/deltaY or to ("top" | "bottom")');
      await editor("window.livePreview.reveal();window.livePreview.navigateMode()");
      const result = await run(previewFrame(parent), scrollPage, {
        selector: selector || null,
        deltaX,
        deltaY,
        to: to || null,
      });
      if (result.error) throw Error(result.error);
      return result;
    },
    console({ since = 0, level, limit = 100 } = {}) {
      const order = { debug: 0, info: 1, warning: 2, error: 3 },
        min = level ? (order[level] ?? 0) : 0;
      const list = entries.filter((e) => e.seq > since && (order[e.level] ?? 1) >= min);
      const slice = list.slice(-Math.max(1, Math.min(500, limit | 0 || 100)));
      const counts = {};
      for (const e of entries) counts[e.level] = (counts[e.level] || 0) + 1;
      return {
        entries: slice.map(({ seq, level, text, source, at }) => ({
          seq,
          level,
          text,
          ...(source ? { source } : {}),
          at: new Date(at).toISOString(),
        })),
        latestSeq: seq,
        counts,
        truncated: list.length > slice.length,
        buffered: entries.length,
      };
    },
    capture: ({ region } = {}) => captureLiveFrame(parent, { region }),
  };
}

module.exports = {
  registerPreview,
  localURL,
  captureModel,
  previewAutomation: (win) => automations.get(win) || null,
};
