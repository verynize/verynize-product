(() => {
  const entries = new Map();
  let activeId = null;
  // Frame chrome (web/preview-frame-chrome.js) registers itself here: mount(entry), paint(entry), update(entry), navigated(entry).
  let chrome = null;
  // Electron prefixes rejected IPC calls; the user only needs the reason.
  const cleanError = (error) =>
    String(error?.message || error || "").replace(
      /^Error invoking remote method '[^']+': (?:Error: )?/,
      "",
    );
  const valid = (value) => {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password
    )
      throw Error("Enter a localhost application URL");
    return url.href;
  };
  const current = () => entries.get(activeId);
  const changed = () => window.dispatchEvent(new Event("bd:preview-state"));
  function selected() {
    const ids = window.design.getSelection();
    return ids.length === 1 ? entries.get(ids[0]) : null;
  }
  function releaseInput(entry) {
    if (entry?.inputToApp) {
      entry.inputToApp = false;
      void window.desktop?.previewInput?.({ enabled: false });
    }
  }
  const project = () => {
    const s = window.agentWorkspace?.getState?.() || {};
    return {
      root: s.activeRoot || "",
      name: s.projectName || s.activeRoot?.split("/").pop() || "Local app",
      chatId: s.conversationId || "",
    };
  };
  function activate(entry) {
    for (const other of entries.values()) {
      other.el.removeAttribute("id");
      other.frame.removeAttribute("id");
      other.frame.name = "";
      for (const [key, el] of Object.entries(other.controls))
        if (key.startsWith("live-")) el.removeAttribute("id");
    }
    if (current() !== entry) releaseInput(current());
    activeId = entry.node.id;
    entry.el.id = "live-preview";
    entry.frame.id = "live-frame";
    entry.frame.name = "verynize-live-preview";
    for (const [key, el] of Object.entries(entry.controls))
      if (key.startsWith("live-")) el.id = key;
  }
  function paint(entry, state, message = "") {
    if (state !== "running") {
      releaseInput(entry);
      entry.mode = "select";
      entry.frame.style.pointerEvents = "none";
    }
    entry.state = state;
    entry.el.dataset.previewState = state;
    entry.controls.state.textContent =
      state === "running"
        ? ""
        : state === "starting"
          ? "Setting up preview…"
          : state === "error"
            ? "Preview failed"
            : "Preview paused";
    entry.controls.toggle.textContent =
      state === "running" || state === "starting" ? "⊙ Stop" : "▶ Start";
    entry.controls.title.textContent =
      state === "starting"
        ? "Starting your app"
        : state === "error"
          ? "Unable to start preview"
          : "Ready to start your preview";
    entry.controls.message.textContent =
      message ||
      (state === "starting"
        ? "Waiting for the local application to be ready…"
        : "Start this preview to connect to your local app.");
    entry.controls.placeholder.hidden = state === "running";
    entry.frame.hidden = state !== "running";
    entry.message = message;
    entry.paintSeq = (entry.paintSeq || 0) + 1;
    chrome?.paint(entry);
    changed();
  }
  function navigate(entry, url, remember = true) {
    const target = valid(url);
    activate(entry);
    if (entry.url !== target || !entry.frame.getAttribute("src")) entry.frame.src = target;
    entry.url = target;
    entry.controls["live-url"].value =
      new URL(target).pathname + new URL(target).search + new URL(target).hash;
    paint(entry, "running");
    if (remember && entry.node.preview.url !== target)
      window.design.updateNodes([entry.node.id], {
        preview: { ...entry.node.preview, url: target },
      });
  }
  async function toggle(entry) {
    activate(entry);
    const api = window.verynizePlatform.can("devServer") ? window.desktop.devServer : null;
    if (!api || !entry.node.preview.root) {
      paint(entry, "error", "Connect this preview to a repository through chat.");
      return;
    }
    // Each start is an attempt; results and status polls from an older attempt never repaint a newer one.
    const attempt = (entry.attempt = (entry.attempt || 0) + 1);
    try {
      if (entry.state === "running" || entry.state === "starting") {
        // Staged preview edits are lost on stop: the edit layer may ask first (false keeps the preview running).
        if (
          window.previewEdits?.confirmBeforeStop &&
          !(await window.previewEdits.confirmBeforeStop(entry.node.id))
        )
          return;
        await api.stop({ root: entry.node.preview.root });
        entry.settingUp = false;
        entry.frame.removeAttribute("src");
        paint(entry, "paused");
      } else {
        entry.attemptAt = Date.now();
        entry.status = null;
        entry.pending = true;
        paint(entry, "starting");
        const result = await api.start({ root: entry.node.preview.root });
        if (entry.attempt !== attempt) return;
        entry.status = result;
        if (result.state === "running" && result.url) navigate(entry, result.url);
        else if (result.state !== "starting")
          paint(entry, "error", result.error || result.tail || "The app did not start.");
      }
    } catch (error) {
      if (entry.attempt === attempt) paint(entry, "error", cleanError(error));
    } finally {
      if (entry.attempt === attempt) entry.pending = false;
    }
  }
  // Captured documents are inserted with fresh ids; embedded fonts merge into the document's fontFaces.
  function insertCaptured(captured, place) {
    const doc = window.design.getDocument(),
      page = doc.pages.find((p) => p.id === doc.activePage);
    const nodes = captured.document.pages.flatMap((p) => p.nodes),
      ids = new Map(nodes.map((n) => [n.id, crypto.randomUUID()]));
    const origin = place(page);
    page.nodes.push(
      ...nodes.map((n) => ({
        ...n,
        id: ids.get(n.id),
        parentId: n.parentId ? ids.get(n.parentId) : null,
        ...(!n.parentId ? { x: n.x + origin.x, y: n.y + origin.y } : {}),
      })),
    );
    const faces = [...(doc.fontFaces || [])],
      key = (f) => [f.family, f.weight, f.style, f.unicodeRange || "", f.src].join("|"),
      known = new Set(faces.map(key));
    for (const face of captured.document.fontFaces || [])
      if (!known.has(key(face)) && faces.length < 40) {
        faces.push(face);
        known.add(key(face));
      }
    if (faces.length) doc.fontFaces = faces;
    window.design.setDocument(doc);
    return nodes.filter((n) => !n.parentId).map((n) => ids.get(n.id));
  }
  // Select the captured layers and pan the camera to them, keeping the zoom.
  function revealCaptured(ids) {
    const doc = window.design.getDocument(),
      nodes = doc.pages
        .find((p) => p.id === doc.activePage)
        .nodes.filter((n) => ids.includes(n.id));
    if (!nodes.length) return;
    window.design.setSelection(ids);
    const x = Math.min(...nodes.map((n) => n.x)),
      y = Math.min(...nodes.map((n) => n.y)),
      w = Math.max(...nodes.map((n) => n.x + n.w)) - x,
      h = Math.max(...nodes.map((n) => n.y + n.h)) - y;
    const rect = document.getElementById("canvas-wrap").getBoundingClientRect(),
      cam = window.design.getCamera();
    // Pan sideways to the capture (Wonder PM4-result keeps the vertical position when the layer is already in view).
    const top = y * cam.zoom + cam.y,
      inView = top >= 0 && top + h * cam.zoom <= rect.height;
    window.design.setCamera(
      rect.width / 2 - (x + w / 2) * cam.zoom,
      inView ? cam.y : rect.height / 2 - (y + h / 2) * cam.zoom,
      cam.zoom,
    );
  }
  async function capture(entry, region = null, element = null) {
    activate(entry);
    const fileId = window.fileLibrary?.currentId;
    entry.capturing = true;
    changed();
    try {
      const captured = await window.desktop.captureLivePreview({
        url: entry.url,
        ...(region ? { region } : {}),
        ...(element ? { element } : {}),
      });
      if (fileId !== window.fileLibrary?.currentId) throw Error("Document changed during capture.");
      if (captured.document) {
        if (element)
          for (const n of captured.document.pages.flatMap((p) => p.nodes))
            n.name = n.type[0].toUpperCase() + n.type.slice(1);
        const ids = insertCaptured(captured, () => ({
          x: entry.node.x + entry.node.w + 100,
          y: entry.node.y,
        }));
        revealCaptured(ids);
      } else window.design.importHTML(captured.html);
      entry.controls.message.textContent = "Captured editable layers beside the preview.";
    } catch (error) {
      entry.controls.message.textContent = error.message;
    } finally {
      entry.capturing = false;
      changed();
    }
  }
  // Interactive region picker over a page rendering (live iframe or screenshot): hovering highlights the
  // element under the pointer, a click takes that element's box, a drag takes a free rectangle, Esc cancels.
  // Coordinates are page viewport CSS px (`width`×`height`), independent of the canvas zoom.
  function pickRegion(host, { width, height, elementAt }) {
    return new Promise((resolve) => {
      const layer = document.createElement("div");
      layer.className = "capture-picker";
      layer.tabIndex = -1;
      layer.innerHTML =
        '<div class="capture-picker-hint">Click an element or drag a region · Esc to cancel</div><div class="capture-picker-highlight" hidden><span></span></div><div class="capture-picker-rect" hidden></div>';
      host.append(layer);
      layer.cancel = () => finish(null);
      const [, highlight, rect] = layer.children;
      let hovered = null,
        start = null,
        pending = false,
        queued = null,
        done = false;
      const toPage = (event) => {
        const r = layer.getBoundingClientRect();
        return {
          x: Math.max(0, Math.min(width, ((event.clientX - r.left) * width) / r.width)),
          y: Math.max(0, Math.min(height, ((event.clientY - r.top) * height) / r.height)),
        };
      };
      const place = (el, box) => {
        const sx = layer.offsetWidth / width,
          sy = layer.offsetHeight / height;
        Object.assign(el.style, {
          left: box.x * sx + "px",
          top: box.y * sy + "px",
          width: box.width * sx + "px",
          height: box.height * sy + "px",
        });
        el.hidden = false;
      };
      const span = (a, b) => ({
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(a.x - b.x),
        height: Math.abs(a.y - b.y),
      });
      const finish = (box) => {
        if (done) return;
        done = true;
        layer.remove();
        document.removeEventListener("keydown", onKey, true);
        if (!box) return resolve(null);
        const x = Math.max(0, Math.floor(box.x)),
          y = Math.max(0, Math.floor(box.y));
        resolve({
          x,
          y,
          width: Math.max(1, Math.min(width - x, Math.ceil(box.x + box.width) - x)),
          height: Math.max(1, Math.min(height - y, Math.ceil(box.y + box.height) - y)),
        });
      };
      const onKey = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        }
      };
      async function probe(point) {
        if (pending) {
          queued = point;
          return;
        }
        pending = true;
        try {
          const box = await elementAt(point);
          if (!done && !start) {
            hovered = box;
            if (box) {
              place(highlight, box);
              highlight.firstChild.textContent = box.label || "";
            } else highlight.hidden = true;
          }
        } catch {
          hovered = null;
        }
        pending = false;
        if (queued) {
          const next = queued;
          queued = null;
          void probe(next);
        }
      }
      layer.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        event.preventDefault();
        layer.setPointerCapture(event.pointerId);
        start = toPage(event);
      });
      layer.addEventListener("pointermove", (event) => {
        event.stopPropagation();
        const point = toPage(event);
        if (start) {
          const box = span(start, point);
          if (box.width > 3 || box.height > 3) {
            highlight.hidden = true;
            place(rect, box);
          }
        } else void probe(point);
      });
      layer.addEventListener("pointerup", (event) => {
        if (!start) return;
        event.stopPropagation();
        const box = span(start, toPage(event));
        start = null;
        finish(box.width > 3 || box.height > 3 ? box : hovered || null);
      });
      document.addEventListener("keydown", onKey, true);
      layer.focus();
    });
  }
  async function pickAndCapture(entry) {
    activate(entry);
    if (entry.state !== "running" || !entry.url) {
      entry.controls.message.textContent = "Start the preview before picking a region.";
      return;
    }
    const wrap = entry.el.querySelector(".live-frame-wrap");
    const region = await pickRegion(wrap, {
      width: entry.frame.clientWidth,
      height: entry.frame.clientHeight,
      elementAt: (point) => window.desktop.previewElementAt(point),
    });
    if (region) await capture(entry, region);
  }
  function create(node, el) {
    el.innerHTML = `<div class="preview-breadcrumb"><span data-part="breadcrumb"></span><span class="preview-local">Local</span></div><section class="preview-surface"><div class="live-preview-bar"><button data-part="back" aria-label="Back">‹</button><button data-part="forward" aria-label="Forward">›</button><button data-part="live-reload" aria-label="Reload preview">↻</button><span data-part="state"></span><input data-part="live-url" aria-label="Preview path" value="/"/><button data-part="toggle">▶ Start</button><button data-part="live-pick" aria-label="Pick capture region" title="Capture a region">⬚</button><button data-part="live-expand" aria-label="Expand preview" aria-pressed="false">⤢</button></div><div class="live-frame-wrap"><iframe title="Running local application" sandbox="allow-scripts allow-forms allow-same-origin allow-downloads"></iframe><div class="preview-placeholder" data-part="placeholder"><div class="preview-setup-card"><strong data-part="title">Ready to start your preview</strong><small data-part="project"></small><p data-part="message">Start this preview to connect to your local app.</p><button data-part="start">▶ Start preview</button></div></div></div></section>`;
    const controls = Object.fromEntries(
      [...el.querySelectorAll("[data-part]")].map((control) => [control.dataset.part, control]),
    );
    const entry = {
      el,
      node,
      controls,
      frame: el.querySelector("iframe"),
      url: "",
      state: "paused",
      mode: "select",
      inputToApp: false,
      fileId: window.fileLibrary?.currentId ?? null,
      identity: JSON.stringify([node.preview.root, node.preview.chatId]),
    };
    entry.frame.style.pointerEvents = "none";
    entries.set(node.id, entry);
    el.classList.add("canvas-preview");
    // Toolbar inputs own pointer gestures; frame borders and resize handles retain canvas gestures.
    for (const region of el.querySelectorAll(
      ".live-preview-bar,.preview-context,.preview-placeholder",
    ))
      region.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        if (!window.design.getSelection().includes(entry.node.id))
          window.design.setSelection([entry.node.id]);
        activate(entry);
        if (event.target.closest("button,input,form")) event.stopPropagation();
      });
    el.addEventListener("pointerdown", () => activate(entry));
    controls.toggle.onclick = controls.start.onclick = () => void toggle(entry);
    controls["live-pick"].onclick = () => void pickAndCapture(entry);
    controls["live-reload"].onclick = () => {
      if (entry.url) entry.frame.src = entry.url;
    };
    controls.back.onclick = async () => {
      activate(entry);
      try {
        await window.desktop.previewNavigate({ direction: "back" });
      } catch (error) {
        controls.message.textContent = error.message;
      }
    };
    controls.forward.onclick = async () => {
      activate(entry);
      try {
        await window.desktop.previewNavigate({ direction: "forward" });
      } catch (error) {
        controls.message.textContent = error.message;
      }
    };
    controls["live-url"].onkeydown = (event) => {
      if (event.key === "Enter" && entry.url) {
        try {
          navigate(entry, new URL(event.target.value, entry.url).href);
        } catch (error) {
          controls.message.textContent = error.message;
        }
      }
    };
    // Expand opens the preview in its own app tab (window.previewTab, chrome island); the frame stays on the canvas.
    controls["live-expand"].onclick = () => {
      activate(entry);
      window.previewTab?.open(entry.node.id);
    };
    chrome?.mount(entry);
    paint(entry, "paused");
    return entry;
  }
  function renderNode(node, el) {
    const entry = entries.get(node.id) || create(node, el);
    const fileId = window.fileLibrary?.currentId ?? null;
    const identity = JSON.stringify([node.preview.root, node.preview.chatId]);
    // The shown document becoming a library file (no id yet → its id; the library loads asynchronously) is no switch.
    const switched = entry.fileId !== fileId && !(entry.fileId === null && fileId);
    if (entry.identity !== identity || switched) {
      entry.frame.removeAttribute("src");
      entry.url = "";
      entry.settingUp = false;
      entry.controls["live-url"].value = "/";
      paint(entry, "paused");
    }
    entry.fileId = fileId;
    entry.identity = identity;
    entry.node = node;
    el.classList.add("canvas-preview");
    el.style.color = "var(--shell-text,#ddd)";
    el.style.fontSize = "13px";
    el.style.fontFamily = "Inter,system-ui,sans-serif";
    el.style.overflow = "visible";
    el.style.padding = "0";
    entry.controls.breadcrumb.textContent = node.preview.name || node.name;
    entry.controls.project.textContent =
      node.preview.name || node.preview.root.split("/").pop() || "Local app";
    if (!activeId) activate(entry);
    chrome?.update(entry);
    return entry;
  }
  function focus(entry) {
    const rect = document.getElementById("canvas-wrap").getBoundingClientRect(),
      zoom = Math.max(
        0.02,
        Math.min((rect.width - 100) / entry.node.w, (rect.height - 140) / entry.node.h, 1),
      );
    window.design.setCamera(50 - entry.node.x * zoom, 60 - entry.node.y * zoom, zoom);
  }
  // The worktree's branch (last segment) when the chat has one, else its title once renamed, else the app name.
  function layerName(info, preview) {
    const s = window.agentWorkspace?.getState?.() || {};
    const chat = info.chatId && s.conversationId === info.chatId ? s : null;
    const branch = chat?.branch ? String(chat.branch).split("/").pop() : "";
    const title = (s.conversations || []).find((c) => c.id === info.chatId)?.title || "";
    // Capitalised like the breadcrumb and Wonder's layer (branch adamabd/dipper → "Dipper").
    return (
      (branch && branch[0].toUpperCase() + branch.slice(1)) ||
      (title && !/^New (quick )?chat$/.test(title) ? title : "") ||
      preview.name
    );
  }
  function ensure(options = {}) {
    const info = { ...project(), ...options };
    let doc = window.design.getDocument();
    const found = doc.pages
      .flatMap((p) => p.nodes.map((n) => ({ page: p, node: n })))
      .find(
        ({ node }) =>
          node.preview &&
          node.preview.root === info.root &&
          (node.preview.chatId || "") === (info.chatId || ""),
      );
    if (found) {
      window.design.setActivePage(found.page.id);
      activeId = found.node.id;
      if (!entries.has(activeId)) window.design.setSelection([activeId]);
      activate(entries.get(activeId));
      focus(entries.get(activeId));
      return activeId;
    }
    const nodes = doc.pages.find((p) => p.id === doc.activePage).nodes;
    const right = nodes.length ? Math.max(...nodes.map((n) => n.x + n.w)) + 100 : 80;
    // Preview audit PF4/PF7: new frames open at the default screen template (MacBook Pro 14", window.previewPresets)
    // and the layer is named after the chat's worktree.
    const size = window.previewPresets?.find((p) => p.default) || {
      name: 'MacBook Pro 14"',
      w: 1512,
      h: 982,
    };
    const repo = info.repo || window.agentWorkspace?.getState?.()?.projectName || "";
    const preview = {
      root: info.root,
      name: info.name || "Local app",
      chatId: info.chatId || "",
      template: size.name,
      ...(repo ? { repo: String(repo).slice(0, 200) } : {}),
      ...(info.url ? { url: valid(info.url) } : {}),
    };
    const id = window.design.addNode("frame", {
      name: layerName(info, preview),
      parentId: null,
      x: right,
      y: 100,
      w: size.w,
      h: size.h,
      color: "#191919",
      radius: 8,
      padding: 0,
      preview,
    });
    activate(entries.get(id));
    focus(entries.get(id));
    return id;
  }
  function show(value, options = {}) {
    const url = valid(value);
    const id = ensure({ ...options, url });
    const entry = entries.get(id);
    navigate(entry, url);
    window.design.setSelection([id]);
    const rect = document.getElementById("canvas-wrap").getBoundingClientRect(),
      zoom = Math.min((rect.width - 100) / entry.node.w, (rect.height - 140) / entry.node.h, 1);
    window.design.setCamera(50 - entry.node.x * zoom, 60 - entry.node.y * zoom, zoom);
    document.body.classList.add("live-preview-open");
  }
  function hide() {
    document.body.classList.remove("live-preview-open");
    window.design.setSelection([]);
  }
  function reveal() {
    const entry = current();
    if (!entry) return false;
    window.design.setSelection([entry.node.id]);
    return true;
  }
  function selectionState() {
    const entry = selected();
    return entry
      ? {
          nodeId: entry.node.id,
          state: entry.state,
          mode: entry.mode,
          inputToApp: entry.inputToApp,
          url: entry.url,
          capturing: !!entry.capturing,
        }
      : null;
  }
  function navigateMode() {
    const entry = selected();
    if (!entry) return;
    activate(entry);
    entry.mode = "navigate";
    entry.frame.style.pointerEvents = entry.state === "running" ? "auto" : "none";
    changed();
  }
  // Edit and Capture: the iframe stays inert; web/preview-edit.js draws the element overlay and handles input.
  function setMode(mode) {
    const entry = selected();
    if (!entry) return;
    activate(entry);
    if (mode !== "navigate") releaseInput(entry);
    if (mode === "navigate") return navigateMode();
    entry.mode = ["edit", "capture"].includes(mode) && entry.state === "running" ? mode : "select";
    entry.frame.style.pointerEvents = "none";
    changed();
  }
  function editMode() {
    setMode("edit");
  }
  async function sendAllInput() {
    const entry = selected();
    if (!entry || entry.state !== "running") return;
    activate(entry);
    const enabled = !entry.inputToApp;
    if (enabled) navigateMode();
    await window.desktop.previewInput({ enabled });
    entry.inputToApp = enabled;
    if (enabled) entry.frame.focus();
    changed();
  }
  async function openInBrowser() {
    const entry = selected();
    if (!entry || !entry.url) return;
    activate(entry);
    await window.desktop.previewOpenBrowser();
  }
  document.addEventListener(
    "pointerdown",
    (event) => {
      const entry = current();
      if (entry?.inputToApp && !event.target.closest("#preview-toolbar")) {
        releaseInput(entry);
        changed();
      }
    },
    true,
  );
  window.addEventListener("message", (event) => {
    const entry = current();
    if (
      entry?.inputToApp &&
      event.source === entry.frame.contentWindow &&
      event.data?.type === "verynize-preview-release-input"
    ) {
      releaseInput(entry);
      changed();
    }
  });
  window.addEventListener("bd:preview-input-released", () => {
    for (const entry of entries.values()) entry.inputToApp = false;
    changed();
  });
  window.livePreview = {
    show,
    hide,
    reveal,
    ensure,
    renderNode,
    getSelectionState: selectionState,
    navigateMode,
    editMode,
    setMode,
    captureMode: () => setMode("capture"),
    captureElement: (path) => {
      const entry = selected();
      return entry ? capture(entry, null, path) : Promise.resolve();
    },
    captureSelected: () => {
      const entry = selected();
      return entry ? capture(entry) : Promise.resolve();
    },
    captureRegion: () => {
      const entry = selected() || current();
      return entry ? pickAndCapture(entry) : Promise.resolve();
    },
    pickRegion,
    insertCaptured,
    sendAllInput,
    openInBrowser,
    nodeElement: (id) => entries.get(id)?.el,
    getURL: () => current()?.url || "",
    getNodeId: () => activeId,
    // Internal surface for the frame chrome module (web/preview-frame-chrome.js); not a stable API.
    frameInternals: {
      entries,
      toggle,
      navigate,
      activate,
      paint,
      valid,
      cleanError,
      current,
      setChrome(next) {
        chrome = next;
        for (const entry of entries.values()) {
          chrome.mount(entry);
          chrome.update(entry);
          chrome.paint(entry);
        }
      },
    },
  };
  window.addEventListener("bd:preview-setup-state", (event) => {
    for (const entry of entries.values())
      if (entry.node.preview.root === event.detail.root) {
        entry.settingUp = event.detail.state === "setting-up";
        if (event.detail.state !== "failed") {
          entry.attemptAt = Date.now();
          entry.status = null;
        } else if (event.detail.status) entry.status = event.detail.status;
        paint(
          entry,
          event.detail.state === "failed" ? "error" : "starting",
          event.detail.message || "",
        );
      }
  });
  window.design.subscribe((doc) => {
    const alive = new Set(
      doc.pages
        .find((p) => p.id === doc.activePage)
        .nodes.filter((n) => n.preview)
        .map((n) => n.id),
    );
    for (const [id, entry] of entries)
      if (!alive.has(id)) {
        releaseInput(entry);
        entry.frame.removeAttribute("src");
        entries.delete(id);
        if (id === activeId) activeId = null;
      }
    const chosen = selected();
    for (const entry of entries.values()) {
      if (entry !== chosen) {
        releaseInput(entry);
        entry.mode = "select";
      }
      entry.frame.style.pointerEvents =
        entry === chosen && entry.state === "running" && entry.mode === "navigate"
          ? "auto"
          : "none";
    }
    if (chosen) activate(chosen);
    changed();
  });
  // Rehydrate persisted frames, but never auto-run code when opening a document.
  window.design.setSelection(window.design.getSelection());
  setInterval(async () => {
    for (const entry of entries.values()) {
      if (
        !entry.node.preview.root ||
        !window.verynizePlatform.can("devServer") ||
        !entry.el.isConnected
      )
        continue;
      try {
        const seq = entry.paintSeq,
          state = await window.desktop.devServer.status({ root: entry.node.preview.root });
        if (!entry.el.isConnected) continue;
        // A repaint while this status was in flight (a click, a start result) wins over it.
        if (entry.paintSeq !== seq) continue;
        if (state.setup?.state === "running") {
          entry.settingUp = true;
          entry.status = state;
          paint(entry, "starting", state.setup.tail || "Running setup command…");
          continue;
        }
        if (entry.settingUp) continue;
        // A process record that predates the latest start attempt describes the previous run, not this one.
        const stale =
          entry.attemptAt &&
          (!state.startedAt || Date.parse(state.startedAt) < entry.attemptAt - 250);
        if (!(stale && entry.state === "starting")) entry.status = state;
        if (state.state === "running" && state.url && entry.state === "starting")
          navigate(entry, state.url);
        else if (
          ["stopped", "failed", "exited"].includes(state.state) &&
          ["starting", "running"].includes(entry.state) &&
          !(entry.state === "starting" && (stale || entry.pending))
        ) {
          entry.frame.removeAttribute("src");
          paint(
            entry,
            ["failed", "exited"].includes(state.state) ? "error" : "paused",
            state.error ||
              state.tail ||
              (state.state === "exited"
                ? "The preview process exited. Check the run command."
                : ""),
          );
        } else chrome?.paint(entry);
      } catch {
        /* Repository may no longer be connected; explicit Start reports the error. */
      }
    }
  }, 1500);
  const button = document.createElement("button");
  button.id = "show-live-preview";
  button.textContent = "Running app";
  button.onclick = async () => {
    const url = await window.askText(
      "Local application URL",
      current()?.url || "http://localhost:3000",
    );
    if (url) show(url);
  };
  document.getElementById("preview").after(button);
  // Embedded fonts (document.fontFaces, from web page capture) are registered in the editor page.
  // Same rules as integrations/font-faces.mjs (exports); window.embeddedFontCss(markup) feeds app.js exports.
  const fontFaceCss = (faces) =>
    faces
      .map(
        (f) =>
          `@font-face{font-family:${JSON.stringify(f.family)};font-weight:${f.weight};font-style:${f.style};font-display:block;src:url(${f.src})${f.unicodeRange ? ";unicode-range:" + f.unicodeRange : ""}}`,
      )
      .join("\n");
  window.embeddedFontCss = (markup) => {
    const faces = window.design.getDocument().fontFaces || [];
    const text =
      markup === undefined
        ? null
        : String(markup)
            .replace(/&quot;|&#0*34;/g, '"')
            .replace(/&#0*39;|&apos;/g, "'")
            .replace(/_/g, " ")
            .toLowerCase();
    return fontFaceCss(
      text === null ? faces : faces.filter((f) => text.includes(f.family.toLowerCase())),
    );
  };
  let fontKey = "";
  function syncEmbeddedFonts(doc) {
    const faces = Array.isArray(doc.fontFaces) ? doc.fontFaces : [];
    const key = faces
      .map((f) => [f.family, f.weight, f.style, f.src.length, f.src.slice(-32)].join(":"))
      .join("|");
    if (key === fontKey) return;
    fontKey = key;
    let style = document.getElementById("bd-embedded-fonts");
    if (!style) {
      style = document.createElement("style");
      style.id = "bd-embedded-fonts";
      document.head.append(style);
    }
    style.textContent = window.assetStore?.css(fontFaceCss(faces)) || fontFaceCss(faces);
  }
  window.addEventListener("assets-ready", () => { fontKey = ""; syncEmbeddedFonts(window.design.getDocument()); });
  window.design.subscribe(syncEmbeddedFonts);
  syncEmbeddedFonts(window.design.getDocument());
  // Preview layers the canvas drew before this module loaded (the launch document) get their app frame now; nothing
  // else may redraw them (the file library loads asynchronously and leaves an unchanged document alone).
  if (window.design.getSnapshot().pages.some((page) => page.nodes.some((node) => node.preview))) render();
  // Web page capture: load any http(s) page in an isolated hidden window, pick a region on its screenshot,
  // and insert editable layers with embedded images, backgrounds, fonts, source mapping and states.
  const web = document.createElement("section");
  web.innerHTML = `<dialog id="capture-web-dialog" aria-labelledby="capture-web-title"><header><strong id="capture-web-title">Capture web page</strong><button id="capture-web-close" type="button">Close</button></header><p>The page opens in an isolated hidden browser session. Its images, backgrounds and custom fonts are embedded in this file.</p><form id="capture-web-form"><label>Page URL<input id="capture-web-url" type="url" required placeholder="https://example.com" autocomplete="url"></label><label>Viewport<select id="capture-web-size"><option value="1280x800">Desktop · 1280×800</option><option value="768x1024">Tablet · 768×1024</option><option value="390x844">Mobile · 390×844</option></select></label><label class="capture-web-check"><input id="capture-web-states" type="checkbox" checked> Record hover, focus and active states</label><div class="capture-web-actions"><button id="capture-web-load" type="submit">Load page</button><button id="capture-web-full" type="button" disabled>Capture whole viewport</button></div></form><div id="capture-web-stage" hidden><img id="capture-web-shot" alt="Screenshot of the loaded page"></div><p id="capture-web-status" role="status"></p></dialog>`;
  document.body.append(web);
  const $ = (id) => document.getElementById(id),
    dialog = $("capture-web-dialog");
  let loaded = null;
  const say = (text) => {
    $("capture-web-status").textContent = text;
  };
  const viewport = () => {
    const [width, height] = $("capture-web-size").value.split("x").map(Number);
    return { width, height };
  };
  async function captureWeb(region) {
    if (!loaded) return;
    const fileId = window.fileLibrary?.currentId;
    $("capture-web-full").disabled = $("capture-web-load").disabled = true;
    say("Capturing editable layers…");
    try {
      const captured = await window.desktop.captureRemote({
        url: loaded.url,
        width: loaded.width,
        height: loaded.height,
        ...(region ? { region } : {}),
        interactions: $("capture-web-states").checked,
      });
      if (fileId !== window.fileLibrary?.currentId) throw Error("Document changed during capture.");
      insertCaptured(captured, (page) => ({
        x: page.nodes.length
          ? Math.max(...page.nodes.filter((n) => !n.parentId).map((n) => n.x + n.w)) + 100
          : 80,
        y: 80,
      }));
      const fonts = captured.document.fontFaces?.length || 0;
      say(
        "Captured " +
          (captured.document.pages[0].nodes.length - 1) +
          " layers" +
          (fonts ? " and " + fonts + " embedded font" + (fonts > 1 ? "s" : "") : "") +
          ".",
      );
      dialog.dataset.result = "captured";
      dialog.close();
    } catch (error) {
      say(error.message);
    } finally {
      $("capture-web-full").disabled = !loaded;
      $("capture-web-load").disabled = false;
    }
  }
  async function pickWeb() {
    const region = await pickRegion($("capture-web-stage"), {
      width: loaded.width,
      height: loaded.height,
      elementAt: (point) => {
        let best = null;
        for (const box of loaded?.boxes || [])
          if (
            point.x >= box.x &&
            point.y >= box.y &&
            point.x <= box.x + box.width &&
            point.y <= box.y + box.height &&
            (!best || box.width * box.height <= best.width * best.height)
          )
            best = box;
        return best;
      },
    });
    if (region && dialog.open) await captureWeb(region);
  }
  $("capture-web-form").onsubmit = async (event) => {
    event.preventDefault();
    if (!window.verynizePlatform.can("webCapture")) {
      say("Open the desktop app to capture web pages.");
      return;
    }
    const { width, height } = viewport();
    loaded = null;
    $("capture-web-full").disabled = true;
    $("capture-web-stage").hidden = true;
    $("capture-web-stage").querySelector(".capture-picker")?.cancel();
    $("capture-web-load").disabled = true;
    say("Loading page in an isolated session…");
    try {
      const probe = await window.desktop.captureRemoteProbe({
        url: $("capture-web-url").value,
        width,
        height,
      });
      loaded = { url: probe.url, width: probe.width, height: probe.height, boxes: probe.boxes };
      $("capture-web-shot").src = probe.screenshot;
      $("capture-web-stage").hidden = false;
      $("capture-web-full").disabled = false;
      say(
        "Click an element or drag a region on “" +
          (probe.title || probe.url) +
          "”, or capture the whole viewport.",
      );
      void pickWeb();
    } catch (error) {
      say(error.message);
    } finally {
      $("capture-web-load").disabled = false;
    }
  };
  $("capture-web-full").onclick = () => void captureWeb(null);
  $("capture-web-close").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    loaded = null;
    $("capture-web-stage").querySelector(".capture-picker")?.cancel();
    $("capture-web-stage").hidden = true;
  });
  const webButton = document.createElement("button");
  webButton.id = "capture-webpage";
  webButton.textContent = "Capture web page";
  webButton.onclick = () => {
    delete dialog.dataset.result;
    say("");
    dialog.showModal();
    $("capture-web-url").focus();
  };
  button.after(webButton);
  window.webCapture = { open: () => webButton.click() };
})();
