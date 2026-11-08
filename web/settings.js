(() => {
  const defaults = {
    theme: "dark",
    reduceMotion: false,
    smallNudge: 1,
    largeNudge: 10,
    selection: "classic",
    selectionDefault: 2,
    displayName: "Personal workspace",
    notifications: false,
    sound: "none",
    customSoundName: "",
    cloudServer: "",
    chatTabs: false,
    lineChanges: false,
    openLinksInApp: true,
    attachSelection: true,
    openPullRequest: false,
  };
  let preferences = { ...defaults };
  try {
    const stored = JSON.parse(
      (window.accountStore || localStorage).getItem("better-preferences") || "{}",
    );
    if (stored.selectionDefault !== 2) {
      delete stored.selection;
      stored.selectionDefault = 2;
    }
    preferences = { ...defaults, ...stored };
  } catch {} // v2: parent-first (classic) selection is the default; earlier saves stored the old 'deep' default
  window.addEventListener("account-store-changed", () => {
    preferences = {
      ...defaults,
      ...JSON.parse(window.accountStore.getItem("better-preferences") || "{}"),
    };
    apply();
  });
  const media = matchMedia("(prefers-color-scheme: light)");
  function apply() {
    document.documentElement.dataset.uiTheme =
      preferences.theme === "system" ? (media.matches ? "light" : "dark") : preferences.theme;
    document.documentElement.dataset.reducedMotion = String(preferences.reduceMotion);
    (window.accountStore || localStorage).setItem(
      "better-preferences",
      JSON.stringify(preferences),
    );
    window.dispatchEvent(
      new CustomEvent("app-preferences-changed", { detail: { ...preferences } }),
    );
  }
  window.appPreferences = {
    get: () => ({ ...preferences }),
    set: (changes) => {
      preferences = { ...preferences, ...changes };
      preferences.smallNudge = Math.max(0.1, Math.min(1000, Number(preferences.smallNudge) || 1));
      preferences.largeNudge = Math.max(0.1, Math.min(1000, Number(preferences.largeNudge) || 10));
      apply();
    },
  };
  media.addEventListener("change", apply);
  apply();
  const screen = document.createElement("section");
  screen.id = "settings-screen";
  screen.hidden = true;
  screen.innerHTML = `<aside class="settings-navigation"><button id="settings-back">← <span>Back to app</span></button><input id="settings-search" placeholder="Search settings…" aria-label="Search settings"><span class="settings-group">Your account</span><nav id="settings-nav"></nav><div class="settings-profile"><span class="settings-avatar">P</span><span id="settings-workspace-name"></span><small>Local</small></div><button id="settings-sharing">Share a design ↗</button></aside><main class="settings-main"><div id="settings-body"></div><p id="settings-status" role="status"></p></main>`;
  document.body.append(screen);
  const $ = (id) => document.getElementById(id),
    sections = [
      ["account", "Account", "◉"],
      ["preferences", "Preferences", "⚙"],
      ["agents", "Agents", "⌁"],
      ["accounts", "Accounts", "◎"],
      ["tools", "Tools", "⚒"],
      ["projects", "Projects", "▣"],
      ["usage", "Usage", "◷"],
      ["models", "Default Models", "◇"],
      ["connections", "Connections", "⊞"],
      ["memory", "Memory", "▤"],
    ];
  let selected = "preferences",
    renderer = null,
    lastStatus = "";
  const accounts = {};
  const status = (text) => {
    lastStatus = text;
    if (renderer) {
      renderer.status?.(text);
      return;
    }
    const el = $("settings-status");
    if (el) el.textContent = text;
  };
  const signIns = new Map();
  const escape = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  function row(title, description, control) {
    return `<div class="settings-row"><div><strong>${title}</strong>${description ? `<p>${description}</p>` : ""}</div>${control}</div>`;
  }
  function card(title, content) {
    return `<h3>${title}</h3><div class="settings-card">${content}</div>`;
  }
  function nav() {
    const query = $("settings-search").value.toLowerCase();
    $("settings-nav").replaceChildren();
    for (const [id, title, icon] of sections) {
      if (!title.toLowerCase().includes(query)) continue;
      const b = document.createElement("button");
      b.className = selected === id ? "selected" : "";
      b.innerHTML = `<span>${icon}</span>${title}`;
      b.onclick = () => window.appSettings.select(id);
      $("settings-nav").append(b);
    }
    $("settings-workspace-name").textContent = preferences.displayName;
  }

  const actions = {
    saveModels: (values) => {
      window.agentWorkspace?.setDefaults(values);
      status("Default model saved");
    },
    saveMemory: (instructions) => {
      window.agentWorkspace?.setDefaults({ instructions });
      status("Personal instructions saved");
    },
    openMemory: () => {
      close();
      window.agentWorkspace?.openProject();
      window.codeWorkspace?.openMemory?.();
    },
    saveCloud: (raw) => {
      try {
        const value = String(raw).trim();
        if (value && !["http:", "https:"].includes(new URL(value).protocol))
          throw Error("Enter an HTTP or HTTPS origin");
        window.appPreferences.set({ cloudServer: value });
        const server = document.getElementById("cloud-server");
        if (server) server.value = value;
        status("Connection saved");
        return true;
      } catch (e) {
        status(e.message);
        return false;
      }
    },
    openFigma: () => {
      close();
      document.getElementById("figma-import")?.click();
    },
    copyMcp: async () => {
      try {
        await navigator.clipboard.writeText("npm run mcp -- --root /absolute/design-folder");
        status("Command copied; replace the folder path");
      } catch (e) {
        status(e.message);
      }
    },
    openAgent: () => {
      close();
      window.agentWorkspace?.openChat();
    },
    share: () => {
      close();
      window.cloudWorkspace?.openDialog();
    },
    discoverAgents: async () =>
      window.verynizePlatform.can("agents") ? (await window.desktop.discoverAgents()) || [] : null,
    auth: async (kind, agent) => {
      const label = (text) => {
        accounts[agent] = text;
        const el = $("account-status-" + agent);
        if (el) el.textContent = text;
        renderer?.update?.();
      };
      try {
        if (kind === "check") {
          const result = await window.desktop.agentAccountStatus({ agent });
          label(result.loggedIn ? "Signed in · " + result.method : "Signed out");
          status("Account status checked");
        } else if (kind === "login") {
          if (
            agent !== "codex" &&
            !confirm(
              "This changes the machine-wide " +
                agent +
                " CLI account. Existing credentials may be replaced immediately, even if sign-in is canceled. Continue?",
            )
          )
            return;
          const result = await window.desktop.startAgentLogin({ agent });
          signIns.set(agent, result.id);
          status("Complete sign-in in your browser.");
        } else if (kind === "logout") {
          if (
            !confirm(
              agent === "codex"
                ? "Disconnect ChatGPT from Verynize on this Mac?"
                : "Sign out of the machine-wide " + agent + " CLI account?",
            )
          )
            return;
          const result = await window.desktop.agentLogout({ agent });
          label("Signed out");
          status(result.message || "Signed out");
          window.dispatchEvent(new Event("bd:agent-accounts-changed"));
        } else {
          const id = signIns.get(agent);
          if (id) await window.desktop.cancelAgentLogin({ id });
          else status("No sign-in is running");
        }
      } catch (e) {
        status(e.message);
      }
    },
  };
  const option = (value, label, current) =>
    `<option value="${value}"${value === current ? " selected" : ""}>${label}</option>`;
  // bd:view-change: the shell router mirrors open/close and the section into /settings/<section>.
  async function render(id = selected) {
    selected = id;
    if (renderer) {
      lastStatus = "";
      renderer.update?.();
      return;
    }
    nav();
    status("");
    const heading = sections.find((s) => s[0] === id)?.[1] || "Preferences";
    let html = `<h1>${heading}</h1>`;
    if (id === "preferences")
      html +=
        card(
          "Notifications",
          row(
            "When a chat finishes",
            "Choose a sound for completed tasks.",
            `<select data-pref="sound">${["none", "chime", "pop"].map((s) => option(s, s[0].toUpperCase() + s.slice(1), preferences.sound)).join("")}</select>`,
          ) +
            row(
              "Desktop notifications",
              "Alerts when an agent task finishes.",
              `<input class="settings-toggle" data-pref="notifications" type="checkbox" ${preferences.notifications ? "checked" : ""}>`,
            ),
        ) +
        card(
          "Appearance",
          row(
            "Theme",
            "System follows your device’s appearance.",
            `<div class="theme-options">${["system", "light", "dark"].map((theme) => `<button data-theme="${theme}" class="${preferences.theme === theme ? "selected" : ""}"><span class="theme-preview ${theme}"><i></i></span>${theme[0].toUpperCase() + theme.slice(1)}</button>`).join("")}</div>`,
          ) +
            row(
              "Reduce motion",
              "Pause animated gradients and use calmer transitions.",
              `<input class="settings-toggle" data-pref="reduceMotion" type="checkbox" ${preferences.reduceMotion ? "checked" : ""}>`,
            ),
        ) +
        card(
          "Canvas",
          row(
            "Selection behavior",
            "Classic selects the outermost frame. Deep selects the innermost layer.",
            `<select data-pref="selection">${option("classic", "Classic", preferences.selection)}${option("deep", "Deep", preferences.selection)}</select>`,
          ) +
            row(
              "Small nudge",
              "Arrow key distance, in pixels.",
              `<input data-pref="smallNudge" type="number" min="0.1" max="1000" step="0.1" value="${preferences.smallNudge}">`,
            ) +
            row(
              "Large nudge",
              "Arrow key distance with Shift held.",
              `<input data-pref="largeNudge" type="number" min="0.1" max="1000" step="0.1" value="${preferences.largeNudge}">`,
            ),
        );
    if (id === "account")
      html +=
        card(
          "Profile",
          row(
            "Display name",
            "Used for this local workspace and collaboration presence.",
            `<input data-pref="displayName" maxlength="80" value="${escape(preferences.displayName)}">`,
          ),
        ) +
        `<p class="settings-note">Your designs and preferences are stored on this device. Shared rooms use private invite links; a hosted account is not required.</p>`;
    if (id === "agents")
      html += `<p class="settings-intro">Use the agents installed on your Mac with their existing accounts. Claude runs through the Claude Agent SDK on your Claude Code install; Codex runs through <code>codex app-server</code> (or <code>codex exec</code> on older versions). Both get the live canvas tools when the Verynize MCP bridge is running.</p><div class="settings-card" id="settings-agent-list">Checking installed agents…</div><button id="settings-open-agent">Open agent workspace ↗</button>`;
    if (id === "usage") {
      const stats = window.agentWorkspace?.getUsage?.() || {};
      html += `<p class="settings-intro">Activity recorded on this device. Provider billing and quotas remain in your agent account.</p><div class="usage-grid">${[
        ["runs", "Tasks"],
        ["completed", "Completed"],
        ["failed", "Failed"],
        ["queued", "Queued"],
      ]
        .map(
          ([key, label]) =>
            `<div><strong>${Number(stats[key]) || 0}</strong><span>${label}</span></div>`,
        )
        .join("")}</div>`;
    }
    if (id === "models") {
      const value = window.agentWorkspace?.getDefaults?.() || {};
      html += `<h3>Your default model</h3><p class="settings-intro">Choose your agent and model. Leave the model blank to use the CLI’s configured default.</p><div class="settings-card">${row("Agent", "Provider for new tasks.", `<select id="settings-default-agent">${option("codex", "Codex", value.agent || "codex")}${option("claude", "Claude", value.agent)}</select>`)}${row("Model", "Enter a model ID supported by your account.", `<input id="settings-default-model" value="${escape(value.model || "")}" placeholder="CLI default">`)}${row("Reasoning effort", "Applied where supported by the chosen CLI.", `<select id="settings-default-effort">${["", "low", "medium", "high", "xhigh", "max"].map((v) => option(v, v || "Default", value.effort || "")).join("")}</select>`)}${row(
        "Access",
        "How much the agent may do without asking. Ask approves each action in chat; Edit auto-approves file edits; Auto lets the provider reviewer decide; Full never asks.",
        `<select id="settings-default-access">${[
          ["ask", "Ask"],
          ["edit", "Edit"],
          ["auto", "Auto"],
          ["full", "Full access"],
        ]
          .map(([v, l]) =>
            option(
              v,
              l,
              { "read-only": "ask", "workspace-write": "edit" }[value.access] ||
                value.access ||
                "edit",
            ),
          )
          .join("")}</select>`,
      )}</div><button id="settings-save-models" class="settings-primary">Save defaults</button>`;
    }
    if (id === "connections")
      html +=
        card(
          "Services",
          row(
            "Cloudflare workspace",
            "Origin serving your shared design rooms.",
            `<input id="settings-cloud" value="${escape(preferences.cloudServer)}" placeholder="https://your-app.workers.dev">`,
          ) +
            row(
              "Figma",
              "Import designs using a transient access token.",
              `<button id="settings-figma">Import file ↗</button>`,
            ) +
            row(
              "Design MCP",
              "Use the local design server from your preferred agent.",
              `<button id="settings-mcp-copy">Copy command</button>`,
            ),
        ) +
        `<button id="settings-save-cloud" class="settings-primary">Save connection</button><p class="settings-note">MCP: npm run mcp -- --root /absolute/design-folder</p>`;
    if (id === "memory") {
      const value = window.agentWorkspace?.getDefaults?.() || {};
      html += `<h3>Personal instructions</h3><p class="settings-intro">Added to new agent tasks. Project memory can override these with project-specific guidance.</p><textarea id="settings-memory" maxlength="12000" placeholder="Your preferred stack, design principles, and coding conventions…">${escape(value.instructions || "")}</textarea><button id="settings-save-memory" class="settings-primary">Save instructions</button><h3>Project memory</h3><p class="settings-intro">Stored in VERYNIZE.md in the selected project.</p><button id="settings-open-memory">Edit project memory ↗</button>`;
    }
    $("settings-body").innerHTML = html;
    screen.querySelectorAll("[data-pref]").forEach(
      (el) =>
        (el.onchange = () => {
          const key = el.dataset.pref;
          window.appPreferences.set({
            [key]:
              el.type === "checkbox"
                ? el.checked
                : el.type === "number"
                  ? Number(el.value)
                  : el.value.trim(),
          });
          nav();
          status("Preferences saved");
        }),
    );
    screen.querySelectorAll("[data-theme]").forEach(
      (el) =>
        (el.onclick = () => {
          window.appPreferences.set({ theme: el.dataset.theme });
          void render();
        }),
    );
    if (id === "agents") {
      try {
        const agents = (await window.desktop?.discoverAgents()) || [];
        if (selected !== id) return;
        $("settings-agent-list").innerHTML = agents.length
          ? agents
              .map((a) =>
                row(
                  a.id === "codex" ? "Codex" : "Claude",
                  a.available ? "Installed · uses your CLI account" : "Not found on this machine",
                  `<div class="settings-auth-controls"><span id="account-status-${a.id}" class="agent-badge ${a.available ? "ready" : ""}">${a.available ? "Installed" : "Unavailable"}</span>${a.available ? `<button data-auth="check" data-agent="${a.id}">Check account</button><button data-auth="login" data-agent="${a.id}">Sign in / switch</button><button data-auth="logout" data-agent="${a.id}">Sign out</button><button data-auth="cancel" data-agent="${a.id}">Cancel sign-in</button>` : ""}</div>`,
                ),
              )
              .join("")
          : "Desktop app required";
      } catch (e) {
        status(e.message);
      }
      screen
        .querySelectorAll("[data-auth]")
        .forEach(
          (button) =>
            (button.onclick = () => actions.auth(button.dataset.auth, button.dataset.agent)),
        );
      $("settings-open-agent")?.addEventListener("click", actions.openAgent);
    }
    $("settings-save-models")?.addEventListener("click", () =>
      actions.saveModels({
        agent: $("settings-default-agent").value,
        model: $("settings-default-model").value.trim(),
        effort: $("settings-default-effort").value,
        access: $("settings-default-access").value,
      }),
    );
    $("settings-save-memory")?.addEventListener("click", () =>
      actions.saveMemory($("settings-memory").value),
    );
    $("settings-open-memory")?.addEventListener("click", actions.openMemory);
    $("settings-save-cloud")?.addEventListener("click", () =>
      actions.saveCloud($("settings-cloud").value),
    );
    $("settings-figma")?.addEventListener("click", actions.openFigma);
    $("settings-mcp-copy")?.addEventListener("click", actions.copyMcp);
  }
  // open/close/select request /settings/<section> (web/shell-request.js); the shell router applies it with applyOpen/applyClose.
  function applyOpen(section) {
    const id = section || "preferences";
    if (!screen.hidden && selected === id) return;
    screen.hidden = false;
    document.body.classList.add("settings-open");
    void render(id);
  }
  function applyClose() {
    if (screen.hidden) return;
    screen.hidden = true;
    document.body.classList.remove("settings-open");
    renderer?.update?.();
  }
  function close() {
    window.shellRequest({ settings: null }, applyClose);
  }
  window.appSettings = {
    open: (section) => {
      window.shellRequest({ settings: section || "preferences" }, () => applyOpen(section));
    },
    close,
    select: (id) => {
      if (screen.hidden) void render(id);
      else window.shellRequest({ settings: id }, () => render(id));
    },
    applyOpen,
    applyClose,
    // Web app: Start's settings route owns the open state (#settings-screen[hidden], body.settings-open) and the section (its URL); it reports the section here so getState() stays true.
    syncSection: (id) => {
      selected = id;
      lastStatus = "";
      renderer?.update?.();
    },
    actions,
    sections: sections.map(([id, title]) => ({ id, title })),
    getState: () => ({
      open: !screen.hidden,
      section: selected,
      status: lastStatus,
      accounts: { ...accounts },
    }),
    // A UI layer (the React settings island) renders the screen itself and is notified on every state change.
    attach: (next) => {
      renderer = next;
      screen.replaceChildren();
      if (!screen.hidden) renderer.update?.();
    },
  };
  $("settings-back").onclick = close;
  $("settings-search").oninput = nav;
  $("settings-sharing").onclick = actions.share;
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === ",") {
      e.preventDefault();
      window.appSettings.open();
    } else if (
      e.key === "Escape" &&
      !e.defaultPrevented &&
      !screen.hidden &&
      !document.querySelector("dialog[open]")
    ) {
      e.preventDefault();
      close();
    }
  });
  window.addEventListener("agent-usage-changed", () => {
    if (!screen.hidden && selected === "usage") void render();
  });
  window.desktop?.onAuthEvent?.((event) => {
    status(event.message);
    if (["complete", "canceled", "error"].includes(event.type)) signIns.delete(event.agent);
  });
  const cloud = document.getElementById("cloud-server");
  if (cloud && preferences.cloudServer) cloud.value = preferences.cloudServer;
  const name = document.getElementById("cloud-name");
  if (name && preferences.displayName !== "Personal workspace")
    name.value = preferences.displayName;
  if (window.verynizePlatform.can("agents")) {
    window.desktop.onAgentEvent((event) => {
      if (window.verynizeAlerts?.handle(event)) return;
      if (event.type !== "done" || event.stopped) return;
      if (preferences.notifications && !document.hasFocus())
        void window.desktop.notifyTask?.({
          title: "Agent task finished",
          body: event.code === 0 ? "Your task completed." : "The task ended with an error.",
        });
      if (preferences.sound !== "none") {
        try {
          const audio = new AudioContext();
          const oscillator = audio.createOscillator(),
            gain = audio.createGain();
          oscillator.connect(gain);
          gain.connect(audio.destination);
          oscillator.frequency.value = preferences.sound === "chime" ? 880 : 440;
          gain.gain.setValueAtTime(0.06, audio.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.3);
          oscillator.start();
          oscillator.stop(audio.currentTime + 0.3);
          oscillator.onended = () => audio.close();
        } catch {}
      }
    });
  }
})();
