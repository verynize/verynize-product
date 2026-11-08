// Preview frame chrome (canvas live preview, see web/live-preview.js).
// Screen-sized browser toolbar and breadcrumb above the frame, the starting / error / paused status
// cards, the embedded terminal and the Publish popover. live-preview.js owns the process state machine
// and calls mount/update/paint through `livePreview.frameInternals.setChrome`.
(() => {
  const lp = window.livePreview,
    internals = lp?.frameInternals;
  if (!internals) return;
  const { entries, toggle, navigate, activate, cleanError, current } = internals;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const esc = (text) =>
    String(text ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const svg = (body, cls = "") =>
    `<svg class="pf-svg ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const icon = {
    back: svg('<path d="M15 6l-6 6 6 6"/>'),
    forward: svg('<path d="M9 6l6 6-6 6"/>'),
    reload: svg('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>'),
    publish: svg(
      '<path d="M12 3.5v11"/><path d="M8 7.5l4-4 4 4"/><path d="M5.5 11.5v7a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-7"/>',
    ),
    stop: svg(
      '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>',
    ),
    play: svg('<path d="M7.5 5v14l11-7z" fill="currentColor" stroke="none"/>'),
    expand: svg(
      '<path d="M14 4h6v6"/><path d="M20 4l-7 7"/><path d="M10 20H4v-6"/><path d="M4 20l7-7"/>',
    ),
    app: svg(
      '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9h17"/><path d="M10.5 12.3v4.4l3.6-2.2z"/>',
    ),
    pause: svg('<path d="M9 6.5v11M15 6.5v11"/>'),
    terminal: svg('<path d="M5 7l5 5-5 5"/><path d="M12.5 17.5H19"/>'),
    retry: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/>'),
    warning: svg(
      '<path d="M10.3 4.2a2 2 0 0 1 3.4 0l7.7 13.3A2 2 0 0 1 19.7 20.5H4.3a2 2 0 0 1-1.7-3z" fill="currentColor" stroke="none"/><path class="pf-warning-mark" d="M12 9.5v4.3M12 16.8v.2"/>',
      "pf-warning",
    ),
    copy: svg(
      '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
    ),
    globe: svg(
      '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z"/>',
    ),
    share: svg(
      '<circle cx="17.5" cy="6" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18" r="2.5"/><path d="M8.7 10.8l6.6-3.6M8.7 13.2l6.6 3.6"/>',
    ),
    env: svg(
      '<path d="M12 3.5l7.5 4.3v8.4L12 20.5l-7.5-4.3V7.8z"/><circle cx="12" cy="12" r="2.4"/>',
    ),
    chevron: svg('<path d="M9.5 6.5l5.5 5.5-5.5 5.5"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  };
  const activity =
    '<span class="pf-activity" aria-hidden="true">' + "<i></i>".repeat(9) + "</span>";

  // ---- names ----------------------------------------------------------------------------------
  const base = (path) =>
    String(path || "")
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || "";
  const title = (text) => (text ? text[0].toUpperCase() + text.slice(1) : "");
  /** Breadcrumb parts: repository, then the chat worktree (`<workspaces>/<repo>/<slug>`) when it differs. */
  function names(node) {
    const p = node.preview || {};
    let repo = p.repo || "",
      place = "";
    if (!repo && typeof p.name === "string" && p.name.includes(" › "))
      [repo, place] = p.name.split(" › ");
    const folder = base(p.root);
    repo ||= folder || p.name || "Local app";
    if (!place && folder && folder.toLowerCase() !== repo.toLowerCase()) place = title(folder);
    return { repo, place };
  }
  const address = (url) => {
    try {
      const u = new URL(url);
      return u.host;
    } catch {
      return "";
    }
  };
  const commandText = (argv) =>
    Array.isArray(argv)
      ? argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : JSON.stringify(a))).join(" ")
      : "";
  const lastURL = (entry) => entry.node.preview.url || entry.status?.config?.url || "";

  // ---- tooltips (screen space, above the control) -----------------------------------------------
  const tip = document.createElement("div");
  tip.className = "pf-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);
  let tipTimer = 0,
    tipTarget = null;
  function showTip(target) {
    const data = target.dataset;
    tip.innerHTML = `<span class="pf-tip-row"><span>${esc(data.tip)}</span>${data.tipKey ? `<kbd>${esc(data.tipKey)}</kbd>` : ""}</span>${data.tipNote ? `<span class="pf-tip-note">${esc(data.tipNote)}</span>` : ""}`;
    tip.hidden = false;
    const r = target.getBoundingClientRect(),
      t = tip.getBoundingClientRect();
    const left = Math.max(
      6,
      Math.min(innerWidth - t.width - 6, r.left + r.width / 2 - t.width / 2),
    );
    tip.style.left = left + "px";
    tip.style.top = Math.max(6, r.top - t.height - 6) + "px";
  }
  function hideTip() {
    clearTimeout(tipTimer);
    tipTarget = null;
    tip.hidden = true;
  }
  document.addEventListener("pointerover", (event) => {
    const target = event.target.closest?.("[data-tip]");
    if (target === tipTarget || (!target && tipTarget?.matches(":hover"))) return;
    hideTip();
    if (!target) return;
    tipTarget = target;
    tipTimer = setTimeout(() => {
      if (tipTarget === target && target.isConnected) showTip(target);
    }, 450);
  });
  document.addEventListener("pointerdown", hideTip, true);
  document.addEventListener("keydown", hideTip, true);

  // ---- mount -----------------------------------------------------------------------------------
  function mount(entry) {
    if (entry.chrome) return;
    const { el, controls } = entry;
    entry.legacy = { expand: controls["live-expand"], pick: controls["live-pick"] };
    el.querySelector(".preview-breadcrumb")?.remove();
    el.querySelector(".live-preview-bar")?.remove();
    const head = document.createElement("div");
    head.className = "pf-head";
    head.innerHTML = `<div class="pf-crumb"><span class="pf-crumb-icon">${icon.app}<i class="pf-dot"></i></span><span class="pf-crumb-text"></span><span class="pf-local">Local</span></div><div class="pf-bar" role="toolbar" aria-label="Preview browser"><div class="pf-nav"><button type="button" class="pf-icon" data-pf="back" aria-label="Back" data-tip="Back" data-tip-key="${mac ? "⌘[" : "Ctrl+["}">${icon.back}</button><button type="button" class="pf-icon" data-pf="forward" aria-label="Forward" data-tip="Forward" data-tip-key="${mac ? "⌘]" : "Ctrl+]"}">${icon.forward}</button><button type="button" class="pf-icon" data-pf="reload" aria-label="Reload" data-tip="Reload" data-tip-note="⇧-click ignores cache">${icon.reload}</button><input class="pf-path" data-pf="path" aria-label="Preview path" spellcheck="false" autocomplete="off" value="/"></div><span class="pf-status" data-pf="status"></span><div class="pf-actions"><button type="button" class="pf-btn" data-pf="publish" aria-haspopup="dialog" data-tip="Publish to the web">${icon.publish}<span>Publish</span></button><button type="button" class="pf-btn" data-pf="toggle" aria-label="Stop preview">${icon.stop}<span>Stop</span></button><button type="button" class="pf-icon pf-icon-box" data-pf="expand" aria-label="Open in a tab" data-tip="Open in a tab" data-tip-key="${mac ? "⌘⌥P" : "Ctrl+Alt+P"}">${icon.expand}</button></div></div>`;
    el.prepend(head);
    const part = (name) => head.querySelector(`[data-pf="${name}"]`);
    const ui = (entry.chrome = {
      head,
      crumb: head.querySelector(".pf-crumb-text"),
      back: part("back"),
      forward: part("forward"),
      reload: part("reload"),
      path: part("path"),
      status: part("status"),
      publish: part("publish"),
      toggle: part("toggle"),
      expand: part("expand"),
      cardKey: "",
    });
    // The legacy ids now live on the new controls (activate() moves them to the active frame).
    controls["live-url"] = ui.path;
    controls["live-reload"] = ui.reload;
    controls["live-expand"] = ui.expand;
    entry.hist ||= { list: [], index: -1, pending: null };
    head.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (!window.design.getSelection().includes(entry.node.id))
        window.design.setSelection([entry.node.id]);
      activate(entry);
      if (event.target.closest("button,input")) event.stopPropagation();
    });
    head.addEventListener("dblclick", (event) => {
      if (event.target.closest("button,input")) event.stopPropagation();
    });
    ui.back.onclick = () => go(entry, "back");
    ui.forward.onclick = () => go(entry, "forward");
    ui.reload.onclick = (event) => void reload(entry, event.shiftKey);
    // Clicking the path selects it whole, ready to type a new one (the first mouseup must not collapse the selection).
    let selectOnUp = false;
    ui.path.addEventListener("focus", () => {
      selectOnUp = true;
      ui.path.select();
    });
    ui.path.addEventListener("mouseup", (event) => {
      if (selectOnUp) {
        event.preventDefault();
        ui.path.select();
      }
      selectOnUp = false;
    });
    ui.path.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        ui.path.value = pathOf(entry.url);
        ui.path.blur();
      }
      if (event.key !== "Enter" || !entry.url) return;
      try {
        const typed = ui.path.value.trim() || "/";
        navigate(entry, new URL(typed, entry.url).href);
        ui.path.blur();
      } catch (error) {
        ui.path.setCustomValidity(cleanError(error));
        ui.path.reportValidity();
        ui.path.setCustomValidity("");
      }
    });
    ui.path.addEventListener("blur", () => {
      if (entry.url) ui.path.value = pathOf(entry.url);
    });
    ui.publish.onclick = () => openPublish(entry.node.id);
    ui.toggle.onclick = () => void toggle(entry);
    ui.expand.onclick = () => expand(entry);
    // Status card and terminal live in the frame body, so they scale with the canvas like the app does.
    const placeholder = controls.placeholder;
    placeholder.replaceChildren();
    placeholder.addEventListener("click", (event) => {
      const action = event.target.closest("[data-act]")?.dataset.act;
      if (action) void act(entry, action, event.target.closest("[data-act]"));
    });
    const terminal = document.createElement("section");
    terminal.className = "pf-terminal";
    terminal.hidden = true;
    terminal.setAttribute("aria-label", "Preview terminal");
    terminal.innerHTML = `<div class="pf-term-head"><span class="pf-term-title">${icon.terminal}<b>Terminal</b></span><span class="pf-term-spacer"></span><button type="button" class="pf-term-btn" data-term="copy">${icon.copy}<span>Copy logs</span></button><button type="button" class="pf-term-btn" data-term="hide">Hide terminal</button></div><pre class="pf-term-log" tabindex="0"></pre><div class="pf-term-foot"><span data-term="detected"></span></div>`;
    el.querySelector(".live-frame-wrap").append(terminal);
    terminal.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (!window.design.getSelection().includes(entry.node.id))
        window.design.setSelection([entry.node.id]);
      if (event.target.closest("button,pre")) event.stopPropagation();
    });
    terminal.querySelector("[data-term=hide]").onclick = () => hideTerminal(entry.node.id);
    terminal.querySelector("[data-term=copy]").onclick = async (event) => {
      const button = event.currentTarget,
        text = terminal.querySelector("pre").textContent;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.append(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      button.querySelector("span").textContent = "Copied";
      setTimeout(() => {
        button.querySelector("span").textContent = "Copy logs";
      }, 1200);
    };
    ui.terminal = terminal;
  }

  // ---- toolbar state ---------------------------------------------------------------------------
  const pathOf = (url) => {
    try {
      const u = new URL(url);
      return u.pathname + u.search + u.hash;
    } catch {
      return "/";
    }
  };
  function update(entry) {
    const ui = entry.chrome;
    if (!ui) return;
    const { repo, place } = names(entry.node);
    ui.crumb.textContent = place ? `${repo} › ${place}` : repo;
    ui.repo = repo;
    paint(entry);
  }
  function paintBar(entry) {
    const ui = entry.chrome,
      state = entry.state;
    ui.head.dataset.state = state;
    ui.status.textContent =
      state === "starting"
        ? "Starting preview…"
        : state === "error"
          ? "Preview failed"
          : state === "paused"
            ? "Preview paused"
            : "";
    ui.publish.hidden = state === "error";
    ui.toggle.hidden = state === "error";
    const live = state === "running" || state === "starting";
    ui.toggle.innerHTML =
      (live ? icon.stop : icon.play) + `<span>${live ? "Stop" : "Start"}</span>`;
    ui.toggle.setAttribute("aria-label", live ? "Stop preview" : "Start preview");
    const { list, index } = entry.hist;
    ui.back.disabled = !(state === "running" && index > 0);
    ui.forward.disabled = !(state === "running" && index >= 0 && index < list.length - 1);
    if (entry.url) {
      ui.path.dataset.tip = entry.url;
      if (document.activeElement !== ui.path) ui.path.value = pathOf(entry.url);
    }
  }

  // ---- status cards ----------------------------------------------------------------------------
  const elapsed = (since) => {
    const s = Math.max(0, Math.floor((Date.now() - (since || Date.now())) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  /** What went wrong, captured once per error paint (later polls must not rewrite it). */
  function failure(entry) {
    const status = entry.status,
      exited =
        status &&
        ["failed", "exited"].includes(status.state) &&
        (!entry.attemptAt ||
          !status.startedAt ||
          Date.parse(status.startedAt) >= entry.attemptAt - 250);
    const message = cleanError(entry.message || "");
    if (exited && status.exitCode !== undefined) {
      const code =
        status.exitCode === null
          ? status.signal
            ? `signal ${status.signal}`
            : "no exit code"
          : `exit ${status.exitCode}`;
      return {
        reason: status.error
          ? cleanError(status.error)
          : "The start command exited before the app was ready.",
        command: commandText(status.command),
        result: code,
        stopped: true,
      };
    }
    return {
      reason:
        message && message !== status?.tail
          ? message.split("\n").slice(-3).join("\n")
          : "The app did not start.",
      command: commandText(status?.command || status?.config?.command),
      result: "",
      stopped: false,
    };
  }
  function step(state, label, detail, detailClass = "pf-step-code") {
    const mark =
      state === "active"
        ? activity
        : state === "done"
          ? `<span class="pf-step-mark pf-done">${icon.check}</span>`
          : state === "failed"
            ? `<span class="pf-step-mark pf-failed">${icon.warning}</span>`
            : '<span class="pf-step-mark pf-pending"><i></i></span>';
    return `<li class="pf-step" data-state="${state}">${mark}<div><b>${esc(label)}</b>${detail ? `<span class="${detailClass}">${esc(detail)}</span>` : ""}</div></li>`;
  }
  function cardFor(entry) {
    const repo = esc(entry.chrome.repo || "Local app"),
      status = entry.status || {};
    if (entry.state === "starting") {
      const config = status.config || entry.startConfig?.config || null,
        settingUp = !!entry.settingUp;
      const setup = config?.setup ? commandText(config.setup) : "";
      const command = commandText(
        config?.command || status.command || entry.startConfig?.detected?.command,
      );
      const waiting = !settingUp && !!status.url && status.state === "starting";
      const steps =
        (setup ? step(settingUp ? "active" : "done", "Setting up", setup) : "") +
        step(settingUp ? "pending" : waiting ? "done" : "active", "Starting app", command) +
        step(
          waiting ? "active" : "pending",
          "Waiting for the app",
          waiting ? address(status.url) : "",
        );
      return {
        key: `starting|${setup}|${command}|${settingUp}|${waiting}|${repo}`,
        html: `<div class="preview-setup-card pf-card" data-kind="starting"><div class="pf-card-head">${activity}<div class="pf-card-title"><strong>Starting your app</strong><small>${repo} · App · <span class="pf-timer">${elapsed(entry.attemptAt)}</span></small></div><button type="button" class="pf-chip" data-act="stop">${icon.pause}<span>Stop</span></button></div><div class="pf-card-body"><ol class="pf-steps">${steps}</ol><button type="button" class="pf-link" data-act="terminal">${icon.terminal}<span>Show terminal</span></button></div></div>`,
      };
    }
    if (entry.state === "error") {
      if (entry.failureSeq !== entry.paintSeq) {
        entry.failure = failure(entry);
        entry.failureSeq = entry.paintSeq;
      }
      const f = entry.failure,
        hint = "Sends the error and available logs to your agent.";
      const steps =
        (f.stopped
          ? step(
              "failed",
              "App stopped",
              [f.command, f.result].filter(Boolean).join(" · "),
              "pf-step-code pf-error-text",
            )
          : "") + step("pending", "Show preview", "Not reached", "pf-step-note");
      return {
        key: `error|${entry.paintSeq}|${repo}|${entry.fixNote || ""}`,
        html: `<div class="preview-setup-card pf-card" data-kind="error"><div class="pf-card-head"><span class="pf-card-glyph pf-error-text">${icon.warning}</span><div class="pf-card-title"><strong>Couldn’t start your app</strong><small>${repo} · App</small></div></div><div class="pf-card-body"><p class="pf-reason">${esc(f.reason)}</p><ol class="pf-steps">${steps}</ol><div class="pf-card-actions"><button type="button" class="pf-link" data-act="logs">${icon.terminal}<span>View logs</span></button><button type="button" class="pf-link" data-act="retry">${icon.retry}<span>Try again</span></button><span class="pf-grow"></span><button type="button" class="pf-chip" data-act="fix" title="${hint}">Fix with agent</button></div><p class="pf-note" role="status">${esc(entry.fixNote || hint)}</p></div></div>`,
      };
    }
    const last = address(lastURL(entry));
    return {
      key: `paused|${last}|${repo}`,
      html: `<div class="preview-setup-card pf-card" data-kind="paused"><div class="pf-card-head"><span class="pf-card-glyph">${icon.play}</span><div class="pf-card-title"><strong>Ready to start your preview</strong><small>${repo} · App</small></div></div><div class="pf-card-body"><p class="pf-reason">Start this preview to connect to your local app.</p>${last ? `<div class="pf-address">Last address: ${esc(last)}</div>` : ""}<div class="pf-card-actions"><span class="pf-grow"></span><button type="button" class="pf-chip" data-act="start">${icon.play}<span>Start preview</span></button></div></div></div>`,
    };
  }
  /** The saved start/setup commands for the starting card (the process status arrives only once it runs). */
  function loadStartConfig(entry) {
    const key = entry.attemptAt || 0;
    if (
      entry.startConfigKey === key ||
      !entry.node.preview.root ||
      !window.verynizePlatform.can("devServer")
    )
      return;
    entry.startConfigKey = key;
    void window.desktop.devServer
      .status({ root: entry.node.preview.root })
      .then((status) => {
        entry.startConfig = { config: status.config || null, detected: status.detected || null };
        if (entry.state === "starting") paint(entry);
      })
      .catch(() => {});
  }
  function paint(entry) {
    const ui = entry.chrome;
    if (!ui) return;
    if (entry.state === "starting") loadStartConfig(entry);
    paintBar(entry);
    if (entry.state === "running") {
      ui.cardKey = "";
      entry.controls.placeholder.replaceChildren();
    } else {
      const card = cardFor(entry);
      if (card.key !== ui.cardKey) {
        ui.cardKey = card.key;
        entry.controls.placeholder.innerHTML = card.html;
      }
    }
    if (entry.state !== "error") entry.fixNote = "";
    if (entry.state === "paused" || entry.state === "error")
      entry.hist = { list: [], index: -1, pending: null };
    paintTerminal(entry);
  }

  async function act(entry, action, button) {
    activate(entry);
    if (action === "stop" || action === "start" || action === "retry") {
      if (action === "stop" && !["starting", "running"].includes(entry.state)) return;
      if (action !== "stop" && ["starting", "running"].includes(entry.state)) return;
      return toggle(entry);
    }
    if (action === "terminal" || action === "logs") return showTerminal(entry.node.id);
    if (action === "fix") {
      button.disabled = true;
      try {
        await fixWithAgent(entry);
      } finally {
        button.disabled = false;
      }
    }
  }

  // ---- fix with agent --------------------------------------------------------------------------
  async function fixWithAgent(entry) {
    const ws = window.agentWorkspace,
      p = entry.node.preview,
      note = (text) => {
        entry.fixNote = text;
        entry.chrome.cardKey = "";
        paint(entry);
      };
    if (!ws?.queueMessage || !ws.attachText)
      return note("Open the desktop app to send this to your agent.");
    const state = ws.getState?.() || {};
    if (p.chatId && state.conversationId !== p.chatId && !ws.selectChat?.(p.chatId))
      return note("Open this preview’s chat to send the error.");
    if (!p.chatId && state.activeRoot && state.activeRoot !== p.root)
      return note("Open this preview’s chat to send the error.");
    let logs = "";
    try {
      const status = await window.desktop.devServer.status({ root: p.root, tail: 120 });
      logs = [status.setup?.tail, status.tail].filter(Boolean).join("\n");
    } catch {}
    const f = entry.failure || failure(entry);
    const report = [
      `Preview of ${p.root}`,
      f.command ? `Start command: ${f.command}` : "",
      f.result ? `Result: ${f.result}` : "",
      `Error: ${f.reason}`,
      "",
      "Recent logs:",
      logs || "(no output)",
    ]
      .filter((line, i) => line || i >= 4)
      .join("\n");
    ws.openChat?.();
    ws.attachText("preview", "Preview error", report);
    await ws.queueMessage(
      "The Preview couldn’t start my app. Use the attached error and logs to find the cause, fix it, and tell me when it is ready to try again.",
    );
    note("Sent the error and logs to your agent.");
  }

  // ---- navigation and history ------------------------------------------------------------------
  async function go(entry, direction) {
    activate(entry);
    entry.hist.pending = direction;
    try {
      await window.desktop.previewNavigate({ direction });
    } catch {
      entry.hist.pending = null;
    }
  }
  async function reload(entry, ignoreCache) {
    activate(entry);
    if (!entry.url) return;
    try {
      await window.desktop.previewNavigate({ direction: "reload", ignoreCache });
    } catch {
      entry.frame.src = entry.url;
    }
  }
  function navigated(url) {
    const entry = current();
    if (!entry || entry.state !== "running") return;
    const h = entry.hist;
    if (h.pending === "back" && h.index > 0) h.index--;
    else if (h.pending === "forward" && h.index < h.list.length - 1) h.index++;
    else if (h.list[h.index] !== url) {
      h.list = h.list
        .slice(0, h.index + 1)
        .concat(url)
        .slice(-100);
      h.index = h.list.length - 1;
    }
    h.list[h.index] = url;
    h.pending = null;
    entry.url = url;
    paintBar(entry);
  }
  void window.desktop?.onPreviewNavigated?.((data) => {
    if (typeof data?.url === "string") navigated(data.url);
  });
  // Back / forward shortcuts while a running preview is the selection (not while typing).
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        !(mac ? event.metaKey : event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        !["[", "]"].includes(event.key)
      )
        return;
      if (event.target.closest?.("input,textarea,select,[contenteditable=true]")) return;
      const ids = window.design.getSelection(),
        entry = ids.length === 1 ? entries.get(ids[0]) : null;
      if (!entry || entry.state !== "running") return;
      const direction = event.key === "[" ? "back" : "forward";
      if (direction === "back" ? entry.chrome.back.disabled : entry.chrome.forward.disabled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void go(entry, direction);
    },
    true,
  );

  function expand(entry) {
    if (window.previewTab?.open) return window.previewTab.open(entry.node.id);
    // Fallback: the camera fit toggle in live-preview.js (it toggles aria-pressed on controls['live-expand'], this button).
    entry.legacy?.expand?.click();
  }

  // ---- terminal --------------------------------------------------------------------------------
  const entryFor = (id) =>
    (id && entries.get(id)) ||
    (() => {
      const ids = window.design.getSelection();
      return ids.length === 1 ? entries.get(ids[0]) : null;
    })() ||
    current();
  function paintTerminal(entry) {
    const t = entry.chrome?.terminal;
    if (!t) return;
    t.hidden = !entry.terminalOpen;
    entry.el
      .querySelector(".live-frame-wrap")
      .classList.toggle("pf-with-terminal", !!entry.terminalOpen);
    const url =
      entry.state === "running" ? entry.url : entry.termStatus?.url || entry.status?.url || "";
    t.querySelector("[data-term=detected]").textContent = url ? `Detected ${address(url)}` : "";
  }
  function showTerminal(frameId) {
    const entry = entryFor(frameId);
    if (!entry?.chrome) return false;
    entry.terminalOpen = true;
    paintTerminal(entry);
    void refreshLogs(entry);
    return true;
  }
  function hideTerminal(frameId) {
    const entry = entryFor(frameId);
    if (!entry?.chrome) return false;
    entry.terminalOpen = false;
    paintTerminal(entry);
    return true;
  }
  async function refreshLogs(entry) {
    const pre = entry.chrome.terminal.querySelector("pre");
    let text = "";
    if (!window.verynizePlatform.can("devServer"))
      text = "Logs are available in the Verynize desktop app.";
    else if (!entry.node.preview.root)
      text = "Connect this preview to a repository to see its logs.";
    else {
      try {
        const status = await window.desktop.devServer.status({
          root: entry.node.preview.root,
          tail: 300,
        });
        entry.termStatus = status;
        text =
          [status.setup?.tail, status.tail].filter(Boolean).join("\n") ||
          (status.state === "stopped" ? "The app is not running." : "Waiting for output…");
      } catch (error) {
        text = cleanError(error);
      }
    }
    if (pre.textContent !== text) {
      const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
      pre.textContent = text;
      if (atEnd) pre.scrollTop = pre.scrollHeight;
    }
    paintTerminal(entry);
  }
  setInterval(() => {
    for (const entry of entries.values()) {
      if (entry.terminalOpen && entry.el.isConnected) void refreshLogs(entry);
      if (entry.state === "starting" && entry.chrome) {
        const timer = entry.el.querySelector(".pf-timer");
        if (timer) timer.textContent = elapsed(entry.attemptAt);
      }
    }
  }, 1000);

  // ---- publish popover -------------------------------------------------------------------------
  const pop = document.createElement("div");
  pop.className = "pf-publish";
  pop.id = "preview-publish";
  pop.hidden = true;
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Publish to the web");
  pop.innerHTML = `<div class="pf-pub-head"><span class="pf-pub-glyph">${icon.globe}</span><div><strong>Publish to the web</strong><small><i class="pf-pub-dot"></i><span data-pub="state">Not published yet</span></small></div></div><div class="pf-pub-card"><span class="pf-pub-glyph">${icon.share}</span><div><b>Share your app</b><small>Build this app and share it at a public link.</small></div></div><button type="button" class="pf-pub-row" data-pub="env" aria-expanded="false">${icon.env}<span>Environment variables</span><span class="pf-grow"></span><span class="pf-pub-muted">0 keys sent</span>${icon.chevron}</button><p class="pf-pub-env" data-pub="env-note" hidden>Publishing uploads the built files only. No environment variables are sent.</p><p class="pf-pub-status" role="status" data-pub="status"></p><button type="button" class="pf-pub-primary" data-pub="publish">${icon.publish}<span>Publish</span></button>`;
  document.body.append(pop);
  const $pub = (name) => pop.querySelector(`[data-pub="${name}"]`);
  let pubEntry = null,
    pubAnchor = null;
  const $id = (id) => document.getElementById(id);
  function publishedURL() {
    const link = $id("cloud-app-url");
    return link?.textContent?.trim() || "";
  }
  function paintPublishState() {
    const url = publishedURL(),
      state = $pub("state");
    pop.dataset.published = String(!!url);
    if (url)
      state.innerHTML = `Published · <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url.replace(/^https?:\/\//, ""))}</a>`;
    else state.textContent = "Not published yet";
  }
  function placePublish() {
    if (!pubAnchor?.isConnected) return closePublish();
    const r = pubAnchor.getBoundingClientRect(),
      width = pop.offsetWidth;
    pop.style.left = Math.max(8, Math.min(innerWidth - width - 8, r.right - width)) + "px";
    pop.style.top = Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 8) + "px";
  }
  function openPublish(frameId) {
    const entry = entryFor(frameId);
    if (!entry?.chrome) return false;
    if (!pop.hidden && pubEntry === entry) {
      closePublish();
      return true;
    }
    pubEntry = entry;
    pubAnchor = entry.chrome.publish.hidden ? entry.chrome.head : entry.chrome.publish;
    $pub("status").textContent = "";
    $pub("env-note").hidden = true;
    $pub("env").setAttribute("aria-expanded", "false");
    $pub("publish").disabled = false;
    paintPublishState();
    pop.hidden = false;
    entry.chrome.publish.setAttribute("aria-expanded", "true");
    placePublish();
    $pub("publish").focus();
    return true;
  }
  function closePublish() {
    if (pop.hidden) return;
    pop.hidden = true;
    pubEntry?.chrome?.publish.setAttribute("aria-expanded", "false");
    const anchor = pubAnchor;
    pubEntry = pubAnchor = null;
    if (pop.contains(document.activeElement)) anchor?.focus?.();
  }
  $pub("env").onclick = () => {
    const note = $pub("env-note");
    note.hidden = !note.hidden;
    $pub("env").setAttribute("aria-expanded", String(!note.hidden));
    placePublish();
  };
  // Reuses Share › Publish app (web/cloud-panel.js → desktop cloudAppPublish): same account check, build and upload.
  $pub("publish").onclick = async () => {
    const say = (text) => {
      $pub("status").textContent = text;
      placePublish();
    };
    const entry = pubEntry;
    if (!entry) return;
    if (!window.verynizePlatform.can("publishApps"))
      return say("Publishing runs in the Verynize desktop app.");
    if (!window.cloudAccount?.get?.())
      return say("Sign in to your Verynize account (Share › Account) to publish.");
    const ws = window.agentWorkspace?.getState?.();
    if (ws?.activeRoot && ws.activeRoot !== entry.node.preview.root)
      return say("Open this preview’s chat to publish its app.");
    const section = $id("cloud-app-section"),
      button = $id("cloud-app-publish"),
      status = $id("cloud-app-status");
    if (!section || !button || !status) return say("Publishing is not available in this window.");
    $pub("publish").disabled = true;
    try {
      if (!section.open) section.open = true;
      for (let i = 0; i < 40 && !$id("cloud-app-name").value; i++)
        await new Promise((r) => setTimeout(r, 75));
      const before = status.textContent;
      say("Building and uploading…");
      button.click();
      for (let i = 0; i < 2400; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const now = status.textContent;
        if (now && now !== before && now !== "Building and uploading…") {
          say(now);
          break;
        }
      }
      paintPublishState();
    } finally {
      $pub("publish").disabled = false;
    }
  };
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && !pop.hidden) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closePublish();
      }
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (
        !pop.hidden &&
        !pop.contains(event.target) &&
        !event.target.closest?.("[data-pf=publish]")
      )
        closePublish();
    },
    true,
  );
  window.addEventListener("resize", () => {
    if (!pop.hidden) placePublish();
  });
  window.design.subscribe(() => {
    if (!pop.hidden) requestAnimationFrame(placePublish);
  });

  Object.assign(lp, { showTerminal, hideTerminal, openPublish, closePublish });
  internals.setChrome({ mount, update, paint, navigated });
})();
