(() => {
  const host = document.createElement("section");
  host.id = "desktop-panel";
  host.innerHTML = `<button id="project-toggle" title="Code workspace">Code workspace</button><div id="project-workspace" hidden><span id="project-name">No repository</span><p id="project-status" role="status"></p><section class="project-agent"><div class="chat-heading"><strong>Chats</strong><button id="chat-new" title="New quick chat">＋</button><button id="chat-dock" title="Dock chat">◧</button></div><select id="chat-history" aria-label="Conversation history"></select><p id="chat-session" class="chat-session"></p><div id="chat-messages" aria-live="polite"></div><div id="chat-queue"></div><details class="agent-config"><summary id="agent-config-label">Model & access</summary><select id="project-agent" aria-label="Local agent"><option value="codex">Codex</option><option value="claude">Claude</option></select><input id="agent-model" aria-label="Model" placeholder="Agent default model" list="agent-model-list" autocomplete="off"><datalist id="agent-model-list"></datalist><div class="agent-options"><select id="agent-access" aria-label="Agent access"><option value="ask">Ask · approve each action</option><option value="edit">Edit · auto-approve file edits</option><option value="auto">Auto · reviewer approves</option><option value="full">Full · never ask</option></select><select id="agent-effort" aria-label="Reasoning effort"><option value="">Default effort</option><option>low</option><option>medium</option><option>high</option><option>xhigh</option><option>max</option></select></div><p id="project-agent-status">Checking installed tools…</p></details><textarea id="project-prompt" aria-label="Agent task" placeholder="Ask about this design or describe a change… (paste images here)"></textarea><div id="chat-attachments"></div><div class="chat-attachment-actions"><button id="chat-attach-file">＋ Open file</button><button id="chat-attach-canvas">◇ Canvas</button><button id="chat-attach-image">▣ Image</button><input type="file" id="chat-image-file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" multiple hidden></div><label><input type="checkbox" id="agent-canvas-context" checked> Send canvas context (document, page, selection ids)</label><label><input type="checkbox" id="project-context"> Include the open file in the prompt</label><div><button id="project-run">Send</button><button id="project-cancel" disabled>Stop</button><button id="project-review">Review changes</button><button id="project-apply-design">Apply canvas</button></div><p class="project-note">Runs with your installed Claude Code or Codex account. Chats without a project run in a private scratch folder.</p><details class="agent-log"><summary>Execution log</summary><pre id="project-output" aria-label="Agent output"></pre></details></section></div>`;
  document.body.append(host);
  const $ = (id) => document.getElementById(id),
    api = window.verynizePlatform.desktop;
  // Chat turns run through the platform's AgentService (web/src/lib/agent-service.ts, registered by the React bundle):
  // Claude/Codex over IPC on the desktop, the cloud backend's model API (agent `openrouter`) on the web.
  const agentService = () => {
    const svc = window.verynizePlatform.agents.service();
    if (!svc)
      throw Error(
        api ? "The agent runtime is not ready yet" : "Chat is not available in this build",
      );
    return svc;
  };
  // The web build offers only the model API, never Claude/Codex.
  if (!api) {
    const select = $("project-agent");
    select.replaceChildren(new Option("OpenRouter", "openrouter"));
    select.setAttribute("aria-label", "Chat model API");
  }
  // The file open in the Code workspace editor (web/src/islands/code), for "Include the open file" / attach file.
  let openFile = null;
  const status = (text) => {
    $("project-status").textContent = text;
    statusText = String(text || "");
    statusAt = Date.now();
    notify();
  };
  let statusText = "",
    statusAt = 0;
  // Chat state. A conversation keeps the provider session id so follow-ups resume the same session.
  // Runs are tracked per conversation (the runtime allows several at once): `active` maps chatId -> run entry,
  // `runs` maps runId -> entry so events reach the conversation that started them even after the user switches away.
  // The chat selected when the app last closed (read before the startup quick-chat selection overwrites it).
  let initialSelection = null;
  try {
    initialSelection = JSON.parse(localStorage.getItem("verynize-code-last") || "null");
  } catch {}
  const imageJobs = new Map();
  let chatFactory = null,
    projectKey = "unattached",
    conversations = [],
    conversation = null,
    attachments = [],
    frame = 0,
    inflight = 0,
    drafts = {};
  const active = new Map(),
    runs = new Map(),
    queues = new Map(),
    orphans = [],
    taskOf = new WeakMap(),
    checkpoints = new Map();
  const entryOf = (chat) => (chat ? active.get(chat.id) || null : null),
    isRunning = (chat) => !!entryOf(chat);
  const queueOf = (chat) => {
    if (!chat) return [];
    let q = queues.get(chat.id);
    if (!q) queues.set(chat.id, (q = []));
    return q;
  };
  // External renderers (the React chat island) subscribe here; while one is subscribed the legacy transcript DOM is not rendered.
  const subscribers = new Set();
  let version = 0,
    snapshot = null;
  const notify = () => {
    version++;
    for (const fn of subscribers) fn();
  };
  const ACCESS = ["ask", "edit", "auto", "full"],
    ACCESS_LABEL = { ask: "Ask", edit: "Edit", auto: "Auto", full: "Full access" },
    LEGACY_ACCESS = { "read-only": "ask", "workspace-write": "edit" };
  const normalizeAccess = (value) =>
    LEGACY_ACCESS[value] || (ACCESS.includes(value) ? value : "edit");
  let defaults = { agent: "codex", model: "", access: "edit", effort: "", instructions: "" };
  try {
    defaults = {
      ...defaults,
      ...JSON.parse((window.accountStore || localStorage).getItem("better-agent-defaults") || "{}"),
    };
  } catch {}
  defaults.access = normalizeAccess(defaults.access);
  if (!api) defaults.agent = "openrouter";
  const stats = { runs: 0, completed: 0, failed: 0 };
  try {
    Object.assign(stats, JSON.parse(localStorage.getItem("better-agent-usage") || "{}"));
  } catch {}
  const storage = window.accountStore || localStorage;
  const chatsKey = (key) => "better-agent-chats:" + key;
  const persist = () => {
    try {
      storage.setItem(chatsKey(projectKey), JSON.stringify(conversations.slice(-30)));
      localStorage.setItem("better-agent-usage", JSON.stringify(stats));
    } catch {
      status("Chat storage full; export or clear older conversations.");
    }
    window.dispatchEvent(new Event("agent-usage-changed"));
  };
  // A run can outlive a project switch: its conversation is then written into the other project's saved list.
  const persistChat = (entry) => {
    if (!entry || entry.key === projectKey) {
      persist();
      return;
    }
    try {
      const saved = JSON.parse(storage.getItem(chatsKey(entry.key)) || "[]"),
        list = Array.isArray(saved) ? saved : [],
        i = list.findIndex((c) => c?.id === entry.chat.id);
      if (i >= 0) list[i] = entry.chat;
      else list.push(entry.chat);
      storage.setItem(chatsKey(entry.key), JSON.stringify(list.slice(-30)));
      localStorage.setItem("better-agent-usage", JSON.stringify(stats));
    } catch {}
    window.dispatchEvent(new Event("agent-usage-changed"));
  };
  // Composer drafts, per conversation and project.
  const loadDrafts = () => {
    try {
      const saved = JSON.parse(storage.getItem("better-agent-drafts:" + projectKey) || "{}");
      drafts = saved && typeof saved === "object" ? saved : {};
    } catch {
      drafts = {};
    }
  };
  const setDraft = (text, chat = conversation) => {
    if (!chat) return;
    text = String(text || "");
    if (text.trim()) drafts[chat.id] = text.slice(0, 20000);
    else {
      delete drafts[chat.id];
      if (window.accountStore?.signedIn()) window.accountStore.put("draft:" + chat.id, null);
    }
    try {
      storage.setItem("better-agent-drafts:" + projectKey, JSON.stringify(drafts));
    } catch {}
  };
  const currentDefaults = () => ({
    agent: $("project-agent").value,
    model: $("agent-model").value.trim(),
    access: $("agent-access").value,
    effort: $("agent-effort").value,
    instructions: defaults.instructions || "",
  });
  // Mode for new chats (Settings › Agents): a chat started in a repository with its own mode keeps it in chat.access;
  // the composer's mode picker then changes that chat, while Settings (Default row / Default Models) change the default.
  const behavior = () => window.agentBehavior?.get?.() || {};
  const effectiveAccess = () =>
    conversation?.access && ACCESS.includes(conversation.access)
      ? conversation.access
      : defaults.access;
  const showAccess = () => {
    $("agent-access").value = effectiveAccess();
    $("agent-config-label").textContent =
      (defaults.model || defaults.agent + " default") + " · " + ACCESS_LABEL[effectiveAccess()];
  };
  const setDefaults = (value, remote = false) => {
    if (
      !remote &&
      conversation?.access &&
      value &&
      value.access &&
      !document.body.classList.contains("settings-open")
    ) {
      conversation.access = normalizeAccess(value.access);
      persist();
      value = { ...value, access: defaults.access };
    }
    defaults = { ...defaults, ...value };
    defaults.access = normalizeAccess(defaults.access);
    $("project-agent").value = defaults.agent;
    $("agent-model").value = defaults.model;
    $("agent-access").value = effectiveAccess();
    $("agent-effort").value = defaults.effort;
    $("agent-config-label").textContent =
      (defaults.model || defaults.agent + " default") + " · " + ACCESS_LABEL[effectiveAccess()];
    try {
      if (!remote) storage.setItem("better-agent-defaults", JSON.stringify(defaults));
    } catch {}
    notify();
  };
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const pretty = (value) => {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };
  const clip = (text, n) => {
    text = String(text ?? "");
    return text.length > n ? text.slice(0, n) + "…" : text;
  };
  const tail = (text, n) => (text.length > n ? "…" + text.slice(-n) : text);
  // Starter briefs for an empty chat: each names a subject, a catalog style direction, colors, fonts and a format.
  const SUGGESTIONS = [
    {
      title: "Ferry timetable poster",
      style: "neo-brutalism",
      prompt:
        "Poster (1080×1350) announcing the summer timetable of the Harbor Line ferry. Neo-brutalist: thick 4px black borders, hard offset shadows, blocky route cards for each pier. Signal yellow (#FFD400), ferry red (#E2341D) and paper white (#FAFAF5) on ink (#111111). Departure times in Space Grotesk Bold 48px, pier names in Archivo Black caps.",
    },
    {
      title: "Typeface specimen slide",
      style: "swiss-minimalist",
      prompt:
        'Presentation slide (1920×1080) introducing a grotesque typeface named "Kantor". Swiss minimalist grid with 12 columns and a strict baseline: one giant "Aa" set flush left at 480px, a waterfall of sizes on the right, captions in 11px tracked caps. Only black (#0A0A0A), white and a single vermilion rule (#E63B2E). Set in Inter Tight.',
    },
    {
      title: "Deploy log dashboard card",
      style: "terminal",
      prompt:
        'Dashboard card (640×420) showing the last five deploys of a service called "atlas-api". Terminal aesthetic: monospaced JetBrains Mono 13px, phosphor green (#39FF88) on near-black (#0B0F0C), dim gray (#5A6B60) timestamps, a blinking block cursor, an ASCII sparkline of build minutes and one amber (#FFB000) warning row.',
    },
    {
      title: "Perfume product page",
      style: "luxury",
      prompt:
        'Landing page hero (1440×900) for a fragrance called "Nuit d\'Ambre". Luxury direction: deep espresso (#1E1410) background, champagne gold (#C9A86A) hairlines, one centered bottle shot with a soft spotlight, headline in Cormorant Garamond Light 88px, body in Jost 15px with wide letter spacing, a single ghost "Discover the scent" button.',
    },
    {
      title: "Staking rewards screen",
      style: "web3",
      prompt:
        'Mobile screen (390×844) for a staking app called "Lumen Vault". Web3 style: midnight navy (#070B1F) with an aurora gradient from violet (#7B5CFF) to cyan (#20D3FF), frosted glass cards, a large APY figure in Sora SemiBold 44px, a rewards line chart, and a pill-shaped "Stake now" button with a glowing edge.',
    },
    {
      title: "Synthwave radio post",
      style: "vaporwave",
      prompt:
        'Square social post (1080×1080) for a late-night radio show called "Pastel Static". Vaporwave: hot pink (#FF71CE) to aqua (#01CDFE) sunset gradient, a wireframe grid floor, a marble bust cut-out, and a chrome-effect title in Monoton 96px. Show time in VT323 28px inside a retro window frame with a fake title bar.',
    },
    {
      title: "Lecture series flyer",
      style: "academia",
      prompt:
        "A5 flyer (1240×1748) for a public lecture series on the history of maps. Dark academia: oxblood (#5B1A18), parchment (#EFE6D2) and tarnished brass (#A78B55), a faint engraved compass rose, title in EB Garamond Italic 64px, speakers and dates in small caps Libre Caslon 14px, a thin double rule framing the page.",
    },
    {
      title: "Invoice tool landing",
      style: "saas",
      prompt:
        'SaaS landing page (1440×1024) for an invoicing tool called "Tally". Clean SaaS layout: white (#FFFFFF) and cool gray (#F4F6FA) bands, an indigo (#4F46E5) primary button, a product screenshot of an invoice editor in a soft-shadowed browser frame, three feature tiles with line icons, and a logo strip. Headings in Manrope Bold 56px, body in Inter 16px.',
    },
    {
      title: "Plant shop app home",
      style: "organic",
      prompt:
        'Mobile home screen (390×844) for a houseplant subscription app called "Fernly". Organic style: soft blob shapes, rounded 24px cards, moss (#4F6B3A), clay (#C98B6B) and oat (#F3EDE2), hand-drawn leaf doodles, plant photos in pebble-shaped masks. Greeting in Fraunces SemiBold 28px, labels in Nunito 15px, a bottom tab bar with four icons.',
    },
    {
      title: "Jazz night menu",
      style: "bauhaus",
      prompt:
        'Restaurant menu page (816×1056) for a jazz supper club called "Blue Seventh". Bauhaus composition: primary red (#D7263D), cobalt (#1B4DB1) and mustard (#F2B134) circles, squares and quarter arcs on cream (#F4EFE4), dishes in a two-column list with prices aligned right. Titles in Futura Bold caps, items in Jost 14px.',
    },
    {
      title: "Election results front page",
      style: "newsprint",
      prompt:
        'Newspaper front page (1200×1600) for a fictional city paper "The Morning Ledger" covering a mayoral election. Newsprint style: off-white (#F2EFE6) paper, black ink, a heavy masthead in Playfair Display Black 96px, six-column grid, a halftone portrait, a bar chart of the vote and one red (#B3261E) breaking-news strip. Body text in Source Serif 11px.',
    },
    {
      title: "Kids budget app card",
      style: "claymorphism",
      prompt:
        'Dashboard card (480×600) for a pocket-money app for kids called "Piggy Path". Claymorphism: puffy rounded 32px shapes with inner highlights and soft drop shadows, bubblegum pink (#FF9EC4), mint (#8FE3C1) and butter yellow (#FFE38A) on lilac (#EDE7FF). A clay piggy bank, a progress ring toward a bike goal, labels in Baloo 2 Bold 18px.',
    },
  ];

  // ---------- Canvas elements: short ids (same scheme as integrations/design-edit.mjs ensureShortIds), mentions, links ----------
  const CONS = "bcdfghjklmnprstvwz",
    VOWELS = "aeiou",
    LETTERS = "abcdefghijklmnopqrstuvwxyz",
    SHORT = /^[a-z]{3,4}$/;
  const fnv = (text) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  };
  const codeFor = (id, attempt) => {
    const h = fnv(id + ":" + attempt);
    if (attempt < 6)
      return CONS[h % 18] + VOWELS[Math.floor(h / 18) % 5] + CONS[Math.floor(h / 90) % 18];
    return [0, 1, 2, ...(attempt < 40 ? [] : [3])]
      .map((k) => LETTERS[Math.floor(h / 26 ** k) % 26])
      .join("");
  };
  const indexPage = (page) => {
    const byId = new Map(),
      code = new Map(),
      used = new Set();
    for (const node of page.nodes) {
      byId.set(node.id, node);
      let c =
        typeof node.shortId === "string" && SHORT.test(node.shortId) && !used.has(node.shortId)
          ? node.shortId
          : null;
      if (!c) {
        let attempt = 0;
        do c = codeFor(node.id, attempt++);
        while (used.has(c));
      }
      used.add(c);
      code.set(node.id, c);
    }
    const rootOf = (node) => {
      let current = node;
      const seen = new Set();
      while (current.parentId && byId.has(current.parentId) && !seen.has(current.id)) {
        seen.add(current.id);
        current = byId.get(current.parentId);
      }
      return current;
    };
    const shortOf = (node) =>
      node.parentId ? code.get(rootOf(node).id) + "." + code.get(node.id) : code.get(node.id);
    const resolve = (ref) => {
      if (byId.has(ref)) return byId.get(ref);
      const own = ref.includes(".") ? ref.slice(ref.lastIndexOf(".") + 1) : ref;
      const node = page.nodes.find((n) => code.get(n.id) === own);
      if (!node) return null;
      if (ref.includes(".") && code.get(rootOf(node).id) !== ref.slice(0, ref.indexOf(".")))
        return null;
      return node;
    };
    return { byId, shortOf, resolve };
  };
  const labelOf = (node) =>
    (typeof node.name === "string" && node.name.trim()) ||
    (typeof node.text === "string" && node.text.trim().slice(0, 40)) ||
    node.type ||
    "Element";
  const mentionOf = (node, page, index) => ({
    id: node.id,
    label: labelOf(node),
    pageId: page.id,
    type: node.type,
    shortId: index.shortOf(node),
  });
  let selectionMentions = [],
    selectionKey = null,
    manualMentions = [];
  const dismissed = new Set();
  const syncSelection = () => {
    const design = window.design;
    if (!design?.getSelection) return;
    let ids;
    try {
      ids = design.getSelection();
    } catch {
      return;
    }
    const key = ids.join(",");
    if (key === selectionKey) return;
    selectionKey = key;
    dismissed.clear();
    selectionMentions = [];
    if (ids.length)
      try {
        const doc = design.getDocument(),
          page = doc.pages.find((p) => p.id === doc.activePage);
        if (page) {
          const index = indexPage(page);
          for (const id of ids.slice(0, 20)) {
            const node = index.byId.get(id);
            if (node) selectionMentions.push(mentionOf(node, page, index));
          }
        }
      } catch {}
    notify();
  };
  const watchDesign = (tries = 0) => {
    if (window.design?.subscribe) {
      window.design.subscribe(() => syncSelection());
      syncSelection();
      return;
    }
    if (tries < 200) setTimeout(() => watchDesign(tries + 1), 100);
  };
  // Settings › Preferences › Attach selection to chat: off = the canvas selection is not added to messages.
  const attachSelection = () => window.appPreferences?.get?.().attachSelection !== false;
  window.addEventListener("app-preferences-changed", () => notify());
  const currentMentions = () => {
    const out = [],
      seen = new Set();
    for (const m of [
      ...(attachSelection() ? selectionMentions.filter((m) => !dismissed.has(m.id)) : []),
      ...manualMentions,
    ])
      if (!seen.has(m.id)) {
        seen.add(m.id);
        out.push(m);
      }
    return out;
  };
  const addMention = (mention) => {
    if (!mention || typeof mention.id !== "string") return;
    dismissed.delete(mention.id);
    if (!currentMentions().some((m) => m.id === mention.id)) {
      if (manualMentions.length >= 20) return;
      manualMentions.push({
        id: mention.id,
        label: String(mention.label || mention.id).slice(0, 80),
        pageId: String(mention.pageId || ""),
        ...(mention.type ? { type: mention.type } : {}),
        ...(mention.shortId ? { shortId: mention.shortId } : {}),
      });
    }
    notify();
  };
  const removeMention = (id) => {
    manualMentions = manualMentions.filter((m) => m.id !== id);
    if (selectionMentions.some((m) => m.id === id)) dismissed.add(id);
    notify();
  };
  // @ popover search over the open document (active page first) by name, text, short id or id.
  const searchElements = (query) => {
    try {
      const doc = window.design?.getDocument?.();
      if (!doc) return [];
      const q = String(query || "")
          .trim()
          .toLowerCase(),
        out = [];
      for (const page of [
        ...doc.pages.filter((p) => p.id === doc.activePage),
        ...doc.pages.filter((p) => p.id !== doc.activePage),
      ]) {
        const index = indexPage(page);
        const ordered = q
          ? page.nodes
          : [...page.nodes.filter((n) => !n.parentId), ...page.nodes.filter((n) => n.parentId)];
        for (const node of ordered) {
          if (out.length >= 20) return out;
          const hay = [node.name, node.text, index.shortOf(node), node.id]
            .filter((v) => typeof v === "string")
            .join(" ")
            .toLowerCase();
          if (!q || hay.includes(q)) out.push(mentionOf(node, page, index));
        }
        if (!q) break;
      }
      return out;
    } catch {
      return [];
    }
  };
  // verynize://node/<document>/<pageId>/<shortId or id> (finish_artboard designLink) -> select and zoom the element.
  const openLink = (url) => {
    const match = /^verynize:\/\/node\/(?:([^/]*)\/)?([^/]+)\/([^/?#]+)/.exec(String(url || ""));
    const design = window.design;
    if (!match || !design?.getDocument) return false;
    try {
      const pageId = decodeURIComponent(match[2]),
        ref = decodeURIComponent(match[3]),
        doc = design.getDocument();
      for (const page of [
        ...doc.pages.filter((p) => p.id === pageId),
        ...doc.pages.filter((p) => p.id !== pageId),
      ]) {
        const node = indexPage(page).resolve(ref);
        if (!node) continue;
        if (doc.activePage !== page.id) design.setActivePage?.(page.id);
        design.setSelection?.([node.id]);
        requestAnimationFrame(() => {
          try {
            design.runCommand?.("view.selection");
          } catch {}
        });
        return true;
      }
      status("That element is no longer on the canvas");
    } catch {}
    return false;
  };

  // ---------- Checkpoints (document snapshots before each user turn, for rewind) ----------
  const takeCheckpoint = (chat) => {
    try {
      const doc = window.design?.getDocument?.();
      if (!doc) return undefined;
      const id = crypto.randomUUID();
      checkpoints.set(id, { chatId: chat.id, fileId: window.fileLibrary?.currentId || "", doc });
      const mine = [...checkpoints].filter(([, c]) => c.chatId === chat.id);
      if (mine.length > 20) checkpoints.delete(mine[0][0]);
      if (checkpoints.size > 60) checkpoints.delete(checkpoints.keys().next().value);
      return id;
    } catch {
      return undefined;
    }
  };

  // ---------- Seed: compact transcript summary for a fresh provider session ----------
  const LINK_RE = /verynize:\/\/node\/[^\s"'<>)\]]+/g;
  // Earlier turns for the model API (POST /api/ai/runs `history`): plain user/assistant text, newest 50.
  const historyOf = (messages) =>
    messages
      .filter(
        (m) =>
          (m.role === "user" || m.role === "assistant") && !m.review && String(m.text || "").trim(),
      )
      .slice(-50)
      .map((m) => ({ role: m.role, text: String(m.text).slice(0, 20000) }));
  const buildSeed = (messages, turns = 10) => {
    const starts = [];
    messages.forEach((m, i) => {
      if (m.role === "user") starts.push(i);
    });
    const from = starts.length > turns ? starts[starts.length - turns] : 0,
      lines = [],
      links = new Set(),
      artboards = new Set();
    for (const m of messages.slice(from)) {
      if (m.role === "user") {
        lines.push(
          "User: " +
            clip(m.text, 1500) +
            (m.mentions?.length
              ? ` [referenced elements: ${m.mentions.map((x) => `${x.label} (${x.shortId || x.id}, page ${x.pageId})`).join(", ")}]`
              : ""),
        );
        continue;
      }
      const tools = [];
      for (const p of m.parts || []) {
        if (p.kind === "tool") {
          const input = pretty(p.input || {}),
            result = p.result === undefined ? "" : pretty(p.result);
          tools.push(
            (p.title || p.name) +
              (p.state === "error" ? " (failed)" : "") +
              (result ? ": " + clip(result.replace(/\s+/g, " "), 160) : ""),
          );
          for (const l of (input + " " + result).match(LINK_RE) || []) links.add(l);
          for (const a of input.matchAll(/"(?:artboardId|artboard)"\s*:\s*"([^"]+)"/g))
            artboards.add(a[1]);
        } else if (p.kind === "question" && p.answers)
          tools.push(
            "asked the user: " +
              (p.questions || [])
                .map((q) => `${clip(q.question, 120)} → ${p.answers[q.id] || "no answer"}`)
                .join("; "),
          );
      }
      for (const l of String(m.text || "").match(LINK_RE) || []) links.add(l);
      lines.push(
        "Assistant" +
          (m.state && m.state !== "complete" ? ` (${m.state})` : "") +
          ": " +
          clip(m.text || "", 2000) +
          (tools.length ? "\n  Tools: " + tools.slice(-12).join(" | ") : ""),
      );
    }
    if (!lines.length) return "";
    const body = tail(lines.join("\n"), 14000);
    return [
      "Summary of the earlier conversation in this chat. The previous agent session is not available, so continue from this summary and re-read the canvas with the tools before editing.",
      body,
      links.size ? "Artboard links referenced: " + [...links].slice(-20).join(", ") : "",
      artboards.size ? "Artboard ids referenced: " + [...artboards].slice(-20).join(", ") : "",
    ]
      .filter(Boolean)
      .join("\n");
  };

  // ---------- Legacy transcript DOM (used only while no React island is subscribed) ----------
  const answerPermission = (part, allow, always) => {
    if (part.state !== "pending") return;
    part.state = allow ? "allowed" : "denied";
    if (always && allow) part.always = true;
    Promise.resolve()
      .then(() =>
        agentService().respondPermission({
          requestId: part.requestId,
          allow,
          ...(always ? { always: true } : {}),
        }),
      )
      .catch((e) => status(e.message));
    notify();
    scheduleReply();
  };
  const renderPart = (part) => {
    if (part.kind === "text") return el("div", "chat-message-content", part.text);
    if (part.kind === "thinking") {
      const box = el("details", "chat-thinking");
      box.append(el("summary", null, "Thinking"), el("div", null, part.text));
      return box;
    }
    if (part.kind === "tool") {
      const card = el("details", "chat-tool " + (part.state || "running"));
      card.open = !!part.open;
      card.ontoggle = () => {
        part.open = card.open;
      };
      const summary = el("summary");
      summary.append(
        el(
          "span",
          "chat-tool-state",
          part.state === "error"
            ? "✕"
            : part.state === "done"
              ? "✓"
              : part.state === "interrupted"
                ? "■"
                : "…",
        ),
        el("span", "chat-tool-title", part.title || part.name),
      );
      card.append(summary);
      const body = el("div", "chat-tool-body");
      body.append(
        el("small", null, "Input"),
        el(
          "pre",
          null,
          !part.hasInput && part.partialInput ? part.partialInput : pretty(part.input || {}),
        ),
      );
      if (part.result !== undefined)
        body.append(
          el("small", null, part.state === "error" ? "Error" : "Result"),
          el("pre", null, part.result || "(empty)"),
        );
      card.append(body);
      return card;
    }
    if (part.kind === "permission") {
      const card = el("div", "chat-permission " + part.state);
      card.append(
        el("strong", null, "Allow " + (part.title || part.toolName) + "?"),
        el("pre", null, pretty(part.input).slice(0, 2000)),
      );
      if (part.state === "pending") {
        const allow = el("button", "chat-permission-allow", "Allow"),
          deny = el("button", "chat-permission-deny", "Deny");
        allow.onclick = () => answerPermission(part, true);
        deny.onclick = () => answerPermission(part, false);
        card.append(allow, deny);
      } else
        card.append(
          el(
            "small",
            null,
            { allowed: "Allowed", denied: "Denied", expired: "Expired" }[part.state] || part.state,
          ),
        );
      return card;
    }
    if (part.kind === "question") {
      const card = el("div", "chat-question " + (part.state || ""));
      for (const q of part.questions || [])
        card.append(
          el(
            "p",
            null,
            q.question + (part.answers ? " → " + (part.answers[q.id] || "No answer") : ""),
          ),
        );
      return card;
    }
    if (part.kind === "error") return el("div", "chat-error", part.text);
    if (part.kind === "auth") return el("div", "chat-auth", part.text);
    return el("div");
  };
  const renderMessage = (message, index) => {
    const card = el("article", "chat-message " + message.role);
    card.append(
      el(
        "small",
        null,
        message.role === "user"
          ? "You"
          : (message.agent || "Assistant") +
              (message.model ? " · " + message.model : "") +
              (message.state && message.state !== "complete" ? " · " + message.state : ""),
      ),
    );
    if (message.role === "assistant" && Array.isArray(message.parts) && message.parts.length)
      for (const part of message.parts) card.append(renderPart(part));
    else
      card.append(
        el(
          "div",
          "chat-message-content",
          message.text || (message.state === "running" ? "Working…" : ""),
        ),
      );
    if (message.images?.length)
      card.append(el("small", "chat-images", "Images: " + message.images.join(", ")));
    if (!isRunning(conversation)) {
      const restore = el("button", null, "Continue from here");
      restore.title = "Fork the saved transcript here; files are not reverted";
      restore.onclick = () => forkAt(index);
      card.append(restore);
    }
    return card;
  };
  const cloneMessage = (m) => JSON.parse(JSON.stringify(m));
  const sessionLabel = () => {
    const s = $("chat-session");
    if (!s) return;
    s.textContent = conversation?.sessionId
      ? `Continues ${conversation.sessionAgent || "agent"} session ${conversation.sessionId.slice(0, 8)}…`
      : projectKey === "unattached"
        ? "Quick chat · private scratch folder"
        : "New session in this project";
  };
  const renderHistory = () => {
    const list = $("chat-history");
    list.replaceChildren();
    for (const chat of conversations.toReversed()) {
      const option = document.createElement("option");
      option.value = chat.id;
      option.textContent = (active.has(chat.id) ? "● " : "") + chat.title;
      list.append(option);
    }
    list.value = conversation?.id || "";
    if (!subscribers.size) {
      const messages = $("chat-messages");
      messages.replaceChildren();
      for (const [index, message] of (conversation?.messages || []).entries())
        messages.append(renderMessage(message, index));
      messages.scrollTop = messages.scrollHeight;
    }
    const queued = queues.get(conversation?.id)?.length || 0;
    $("chat-queue").textContent = queued ? queued + " tasks queued" : "";
    const running = isRunning(conversation);
    $("project-run").textContent = running ? "Queue" : "Send";
    $("project-cancel").disabled = !running;
    sessionLabel();
    notify();
  };
  // Streaming updates re-render at most once per frame.
  const scheduleReply = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (subscribers.size) notify();
      else renderHistory();
    });
  };
  const switchTo = (chat) => {
    const prompt = $("project-prompt");
    if (conversation && conversation !== chat) setDraft(prompt.value, conversation);
    const changed = conversation !== chat;
    if (changed) for (const controller of imageJobs.keys()) controller.abort();
    conversation = chat;
    showAccess();
    if (changed) {
      prompt.value = drafts[chat?.id] || "";
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    }
    renderHistory();
    activate();
    try {
      localStorage.setItem(
        "verynize-code-last",
        JSON.stringify({ key: projectKey, name: projectName, chatId: chat?.id || null }),
      );
    } catch {}
  };
  // Folder a chat works in: its own worktree, else the repository root; quick chats (null) use a scratch folder.
  const rootOf = (chat, key = projectKey) =>
    chat?.worktree?.path || (key === "unattached" ? null : key);
  // The main process's active project (files, git changes, dev server, agent default cwd) follows the active chat.
  // Activations run in order; `activeRoot` is the root main confirmed (undefined while switching).
  let activeRoot,
    activation = Promise.resolve();
  const activate = () => {
    if (!api?.repositories) return;
    const root = rootOf(conversation);
    if (root === activeRoot) return;
    activeRoot = undefined;
    notify();
    activation = activation
      .then(() => api.repositories.activate(root))
      .then(
        () => {
          if (rootOf(conversation) === root) {
            activeRoot = root;
            notify();
            window.dispatchEvent(new CustomEvent("code-root-changed", { detail: { root } }));
          } else activate();
        },
        (e) => {
          status(e.message);
          if (rootOf(conversation) === root) {
            activeRoot = null;
            notify();
          }
        },
      );
  };
  let projectName = "";
  const newChat = (extra = {}) => {
    const repoMode = extra.repoId ? behavior().repoModes?.[extra.repoId] : null;
    const chat = {
      id: typeof extra.id === "string" ? extra.id : crypto.randomUUID(),
      title: projectKey === "unattached" ? "New quick chat" : "New chat",
      messages: [],
      created: Date.now(),
      ...(extra.repoId ? { repoId: extra.repoId } : {}),
      ...(ACCESS.includes(repoMode) ? { access: repoMode } : {}),
      ...(extra.worktree?.path
        ? { worktree: { path: extra.worktree.path, branch: extra.worktree.branch || null } }
        : {}),
    };
    conversations.push(chat);
    persist();
    switchTo(chat);
    return chat;
  };
  const forkAt = (index) => {
    if (!conversation || isRunning(conversation)) return;
    const copied = conversation.messages.slice(0, index + 1).map(cloneMessage);
    const chat = {
      id: crypto.randomUUID(),
      title: conversation.title + " · branch",
      messages: copied,
      created: Date.now(),
      ...(conversation.repoId ? { repoId: conversation.repoId } : {}),
      ...(conversation.worktree ? { worktree: { ...conversation.worktree } } : {}),
    };
    conversations.push(chat);
    persist();
    switchTo(chat);
    status(
      "Transcript branch created. It starts a new agent session; project files were not reverted.",
    );
  };
  const restoreMessage = (m) => {
    const copy = { ...m, state: m.state === "running" ? "interrupted" : m.state };
    if (Array.isArray(m.parts))
      copy.parts = m.parts
        .filter((p) => p && typeof p === "object")
        .map((p) =>
          p.kind === "tool" && p.state === "running"
            ? { ...p, state: "interrupted" }
            : (p.kind === "permission" || p.kind === "question") && p.state === "pending"
              ? { ...p, state: "expired" }
              : p,
        );
    return copy;
  };
  const loadChats = (root, options = {}) => {
    if (conversation) setDraft($("project-prompt").value, conversation);
    projectKey = root;
    loadDrafts();
    try {
      const saved = JSON.parse(storage.getItem(chatsKey(root)) || "[]");
      conversations = Array.isArray(saved)
        ? saved
            .filter(
              (c) =>
                c &&
                typeof c.id === "string" &&
                typeof c.title === "string" &&
                Array.isArray(c.messages),
            )
            .slice(-30)
            .map((c) => ({
              ...c,
              sessionId: typeof c.sessionId === "string" ? c.sessionId : null,
              messages: c.messages
                .filter(
                  (m) => m && ["user", "assistant"].includes(m.role) && typeof m.text === "string",
                )
                .map(restoreMessage),
            }))
        : [];
    } catch {
      conversations = [];
    }
    // Conversations still running keep their live objects.
    for (const entry of active.values())
      if (entry.key === root) {
        const i = conversations.findIndex((c) => c.id === entry.chat.id);
        if (i >= 0) conversations[i] = entry.chat;
        else conversations.push(entry.chat);
      }
    conversation = null;
    const pick = conversations.find((c) => c.id === options.select) || conversations.at(-1);
    if (pick) switchTo(pick);
    else if (options.create !== false) newChat();
    else {
      renderHistory();
      activate();
    }
  };
  window.addEventListener("account-store-changed", () => {
    const selected = conversation?.id,
      prompt = $("project-prompt"),
      typing = document.activeElement === prompt,
      typed = prompt.value,
      start = prompt.selectionStart,
      end = prompt.selectionEnd;
    if (!window.accountStore?.ready()) {
      conversations = [];
      conversation = null;
      drafts = {};
      attachments = [];
      prompt.value = "";
      setDefaults({ model: "", effort: "", access: "edit", instructions: "" }, true);
      renderAttachments();
      renderHistory();
      return;
    }
    conversation = null;
    loadChats(projectKey, { select: selected, create: false });
    if (typing && conversation?.id === selected) {
      prompt.value = typed;
      prompt.setSelectionRange(start, end);
      setDraft(typed);
    }
    const saved = JSON.parse(storage.getItem("better-agent-defaults") || "{}");
    setDefaults(saved, true);
  });
  // Chat summaries of any project key (the open one live, others from storage) for the Code workspace sidebar.
  const summaryOf = (c) => ({
    id: c.id,
    title: c.title,
    created: c.created,
    count: c.messages?.length || 0,
    ...(c.worktree?.branch ? { branch: c.worktree.branch } : {}),
    ...(c.worktree?.path ? { root: c.worktree.path } : {}),
    ...(active.has(c.id) ? { busy: true } : {}),
  });
  const chatSummaries = (key) => {
    if (key === projectKey) return conversations.map(summaryOf).reverse();
    try {
      const saved = JSON.parse(storage.getItem(chatsKey(key)) || "[]");
      return (Array.isArray(saved) ? saved : [])
        .filter((c) => c && typeof c.id === "string" && typeof c.title === "string")
        .map((c) => {
          const live = [...active.values()].find((e) => e.chat.id === c.id);
          return summaryOf(live ? live.chat : c);
        })
        .reverse();
    } catch {
      return [];
    }
  };
  const removeChat = (id) => {
    const i = conversations.findIndex((c) => c.id === id);
    if (i < 0) return false;
    if (active.has(id)) throw Error("Stop the chat before archiving it");
    const [chat] = conversations.splice(i, 1);
    if (window.accountStore?.signedIn()) window.accountStore.put("chat:" + id, null);
    queues.delete(id);
    setDraft("", chat);
    persist();
    if (conversation === chat) {
      conversation = null;
      const last = conversations.at(-1);
      if (last) switchTo(last);
      else {
        renderHistory();
        activate();
      }
    } else renderHistory();
    return true;
  };
  const agentSection = host.querySelector(".project-agent");
  const dock = document.createElement("aside");
  dock.id = "agent-chat-dock";
  dock.innerHTML =
    '<div class="chat-dock-bar"><strong>Chat</strong><button id="chat-project-files">Project files</button><button id="chat-hide">×</button></div>';
  document.body.append(dock);
  const openChat = () => {
    setCodeMode(false);
    dock.append(agentSection);
    document.body.classList.add("agent-chat-open");
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  };
  // Code mode: a full-window workspace (web/src/islands/code) hosts the chat section in its center column.
  let codeHost = null;
  // setCodeMode requests /code or /editor (web/shell-request.js); the shell router applies it with applyCodeMode.
  const setCodeMode = (on) => {
    if (document.body.classList.contains("code-mode") === !!on) return;
    window.shellRequest({ view: on ? "/code" : "/editor" }, () => applyCodeMode(on));
  };
  const applyCodeMode = (on) => {
    const body = document.body.classList;
    if (body.contains("code-mode") === !!on) return;
    body.toggle("code-mode", !!on);
    syncCodeMode(on);
  };
  // Web app: Start's Code route owns body.code-mode and the workspace; it reports the mode here (chat section host, launch restore, layout, listeners).
  const syncCodeMode = (on) => {
    if (on && codeHost) codeHost.append(agentSection);
    else if (!on) dock.append(agentSection);
    try {
      localStorage.setItem("verynize-code-mode", on ? "1" : "0");
    } catch {}
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    notify();
  };
  const openProject = () => setCodeMode(true);
  const attachCodeHost = (el) => {
    codeHost = el;
    if (el && document.body.classList.contains("code-mode")) el.append(agentSection);
    else if (!el) dock.append(agentSection);
  };
  const queueView = (q) =>
    q.map((t) => ({
      id: t.id,
      text: t.displayPrompt || t.prompt,
      ...(t.images.length ? { images: t.images.map((i) => i.name) } : {}),
      ...(t.mentions?.length ? { mentions: t.mentions } : {}),
      at: t.at,
    }));
  window.agentWorkspace = {
    closeChat: () => {
      document.body.classList.remove("agent-chat-open");
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    },
    openChat,
    openProject,
    getDefaults: currentDefaults,
    setDefaults,
    getUsage: () => ({ ...stats, queued: [...queues.values()].reduce((n, q) => n + q.length, 0) }),
    getHistory: () => JSON.parse(JSON.stringify(conversations)),
    isBusy: () => active.size > 0,
    stop: () => $("project-cancel").click(),
    activeRunId: () => entryOf(conversation)?.runId || null,
  };
  // Read/subscribe API for the React chat island (web/src/islands/chat). Snapshots are immutable copies, rebuilt once per change.
  const buildSnapshot = () => {
    const q = queues.get(conversation?.id) || [];
    return {
      version,
      projectKey,
      projectName: projectKey === "unattached" ? "" : projectName || $("project-name").textContent,
      busy: isRunning(conversation),
      queued: q.length,
      session: $("chat-session")?.textContent || "",
      conversationId: conversation?.id || null,
      conversations: conversations
        .map((c) => ({
          id: c.id,
          title: c.title,
          created: c.created,
          count: c.messages.length,
          ...(active.has(c.id) ? { busy: true } : {}),
        }))
        .reverse(),
      messages: (conversation?.messages || []).map((m) => ({
        ...m,
        parts: Array.isArray(m.parts)
          ? m.parts.map((p) => ({ ...p, ...(p.answers ? { answers: { ...p.answers } } : {}) }))
          : undefined,
      })),
      attachments: attachments.map((a) => ({
        kind: a.kind,
        name: a.name,
        ...(a.url ? { url: a.url } : {}),
      })),
      defaults: currentDefaults(),
      queue: queueView(q),
      busyChats: [...active.keys()],
      ...(conversation?.usage ? { usage: { ...conversation.usage } } : {}),
      mentions: currentMentions(),
      draft: drafts[conversation?.id] || "",
      suggestions: conversation?.messages.length ? [] : SUGGESTIONS,
      chatRoot: rootOf(conversation),
      activeRoot,
      repoId: conversation?.repoId || null,
      branch: conversation?.worktree?.branch || null,
      codeMode: document.body.classList.contains("code-mode"),
      status: statusText,
      statusAt,
      busyKeys: [...new Set([...active.values()].map((e) => e.key))],
      directories: (conversation?.dirs || []).slice(),
    };
  };
  Object.assign(window.agentWorkspace, {
    subscribe: (fn) => {
      subscribers.add(fn);
      if (subscribers.size === 1) $("chat-messages").replaceChildren();
      return () => {
        subscribers.delete(fn);
        if (!subscribers.size) renderHistory();
      };
    },
    getState: () => {
      if (!snapshot || snapshot.version !== version) snapshot = buildSnapshot();
      return snapshot;
    },
    // In a repository the Code workspace creates the chat (with its own worktree); see setChatFactory.
    newChat: () => {
      if (chatFactory && projectKey !== "unattached") return chatFactory();
      newChat();
    },
    setChatFactory: (fn) => {
      chatFactory = typeof fn === "function" ? fn : null;
    },
    createChat: (extra = {}) => newChat(extra),
    switchProject: (key, name, options = {}) => {
      if (typeof key !== "string" || !key) throw Error("Invalid project");
      projectName = key === "unattached" ? "" : String(name || key.split(/[\\/]/).pop());
      $("project-name").textContent = projectName || "No repository";
      if (key === projectKey && conversations.length) {
        const next = conversations.find((c) => c.id === options.select);
        if (next) switchTo(next);
        else {
          renderHistory();
          activate();
        }
        return;
      }
      loadChats(key, options);
    },
    chatSummaries,
    removeChat,
    rootOf: () => rootOf(conversation),
    initialSelection: () => initialSelection,
    setStatus: (text) => status(text),
    setOpenFile: (file) => {
      openFile =
        file && typeof file.path === "string"
          ? { path: file.path, text: String(file.text || "") }
          : null;
    },
    attachCodeHost,
    setCodeMode,
    applyCodeMode,
    syncCodeMode,
    actions: {
      openDesign: () => openDesign(),
      saveDesign: () => action(() => saveDesign(false))(),
      saveDesignAs: () => action(() => saveDesign(true))(),
      gitStatus: () => gitStatus(),
      createWorktree: () => createWorktree(),
      livePreview: () => livePreview(),
      captureApp: () => captureApp(),
      exportPDF: () => exportPDF(),
    },
    selectChat: (id) => {
      const next = conversations.find((c) => c.id === id);
      if (!next) return false;
      switchTo(next);
      return true;
    },
    forkAt: (index) => forkAt(index),
    answerPermission: (messageIndex, partIndex, allow, always) => {
      const part = conversation?.messages[messageIndex]?.parts?.[partIndex];
      if (part?.kind === "permission") answerPermission(part, allow, !!always);
    },
    setPartOpen: (messageIndex, partIndex, open) => {
      const part = conversation?.messages[messageIndex]?.parts?.[partIndex];
      if (part && part.open !== open) {
        part.open = open;
        notify();
      }
    },
    removeAttachment: (index) => {
      attachments.splice(index, 1);
      renderAttachments();
    },
    openLink,
    searchElements,
    addMention,
    removeMention,
    setDraft: (text) => {
      text = String(text ?? "");
      setDraft(text);
      const prompt = $("project-prompt");
      if (prompt.value !== text) prompt.value = text;
      notify();
    },
  });
  $("chat-hide").onclick = () => {
    document.body.classList.remove("agent-chat-open");
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  };
  $("chat-project-files").onclick = openProject;
  $("chat-dock").onclick = openChat;
  $("chat-new").onclick = () => newChat();
  $("chat-history").onchange = () => {
    const next = conversations.find((c) => c.id === $("chat-history").value);
    if (next) switchTo(next);
  };
  ["project-agent", "agent-model", "agent-access", "agent-effort"].forEach(
    (id) =>
      ($(id).onchange = () => {
        setDefaults(currentDefaults());
        if (id === "project-agent") loadModels();
      }),
  );
  setDefaults(defaults);
  watchDesign();
  {
    let timer = 0;
    $("project-prompt").addEventListener("input", () => {
      clearTimeout(timer);
      const chat = conversation,
        value = $("project-prompt").value;
      timer = setTimeout(() => setDraft(value, chat), 250);
    });
  }

  const action = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      status(e.message || String(e));
    }
  };
  $("project-toggle").onclick = () => setCodeMode(!document.body.classList.contains("code-mode"));
  if (!api) {
    // Web: no project files, attachments from disk or local agents. The chat itself keeps its controls and runs on the
    // model API when the platform's AgentService can (signed in, model API enabled, a cloud room open).
    $("project-agent-status").textContent =
      "Open the desktop app to use project files and local agents.";
    host
      .querySelectorAll(
        "#project-review,#project-apply-design,#chat-attach-file,#chat-attach-canvas,#chat-attach-image,#chat-image-file,#project-context",
      )
      .forEach((e) => (e.disabled = true));
  }
  // Former project-dialog actions, now in the Code workspace menus (repository row, Start preview menu) and the app menu.
  const openDesign = action(async () => {
    const result = await api.designOpen().catch((error) => {
      window.documentSafety.reportOpenFailure({
        error,
        source: "native",
        name: "Design file",
        kept: "The file was not changed.",
      });
      throw error;
    });
    if (result) {
      if (window.fileLibrary?.openNative) await window.fileLibrary.openNative(result);
      else {
        await window.documentLifecycle?.prepareSwitch({ preserveNative: true });
        window.design.setDocument(result.document);
      }
      status("Opened " + result.path);
    }
  });
  const saveDesign = async (saveAs) => {
    await window.pageLoader?.ensureAll();
    const fileId = window.fileLibrary?.currentId;
    const result = await api
      .designSave({ document: window.design.getDocument(), saveAs })
      .catch((error) => {
        /* size limits: web/storage-limits.js */ if (window.storageLimits?.isSizeError(error))
          window.storageLimits.reportError(error.message, "save");
        throw error;
      });
    if (result && !result.detached && fileId === window.fileLibrary?.currentId) {
      window.fileLibrary?.setNativePath?.(result.path);
      status("Saved " + result.path + " · MCP can edit this file");
    }
  };
  if (api) {
    document.getElementById("save-project").onclick = action(() => saveDesign(false));
    document.getElementById("open-project").onclick = openDesign;
  }
  if (api)
    api.onDesignFileChanged((event) => {
      const active = window.fileLibrary
        ?.list()
        .find((file) => file.id === window.fileLibrary.currentId);
      if (active && !active.nativePath) return;
      if (active?.nativePath && active.nativePath !== event.path) return;
      if (event.error) {
        status(event.error);
        return;
      }
      status("Design changed on disk: " + event.path);
      if (window.confirm("The design file changed outside the editor. Load its latest version?"))
        api
          .designReload()
          .then((result) => {
            window.design.setDocument(result.document);
            status("Loaded external design changes");
          })
          .catch((e) => status(e.message));
    });
  const gitStatus = action(async () => {
    status((await api.gitStatus()) || "Working tree clean");
  });
  const livePreview = action(async () => {
    const url = await window.askText("Local app URL", "http://localhost:3000");
    if (url) {
      if (window.livePreview) {
        setCodeMode(false);
        window.livePreview.show(url);
      } else await api.previewApp({ url });
    }
  });
  const captureApp = action(async () => {
    const url = await window.askText("Local app URL to capture", "http://localhost:3000");
    if (!url) return;
    const bounds = await window.askText(
      "Optional region x,y,width,height (blank for full viewport)",
      "",
    );
    if (bounds === null) return;
    let region;
    if (bounds.trim()) {
      const parts = bounds.split(",").map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)))
        throw Error("Use four comma-separated numbers");
      region = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
    }
    status("Capturing visible app elements…");
    const result = await api.previewApp({ url, capture: true, region });
    if (result.document) {
      const doc = window.design.getDocument(),
        source = result.document.pages[0].nodes,
        ids = new Map(source.map((n) => [n.id, crypto.randomUUID()]));
      doc.pages
        .find((p) => p.id === doc.activePage)
        .nodes.push(
          ...source.map((n) => ({
            ...n,
            id: ids.get(n.id),
            parentId: n.parentId ? ids.get(n.parentId) : null,
          })),
        );
      window.design.setDocument(doc);
    } else window.design.importHTML(result.html);
    status(
      "Captured app region." + (result.warnings?.length ? " " + result.warnings.join(" ") : ""),
    );
  });
  const exportPDF = action(async () => {
    if (!window.design) throw Error("Canvas is loading");
    status(
      (await api.exportPDF(window.design.exportPrintHTML())) ? "PDF saved" : "PDF export canceled",
    );
  });
  const createWorktree = action(async () => {
    const branch = await window.askText("New branch name", "design/new-idea");
    if (!branch) return;
    const result = await api.createWorktree(branch);
    status(`Created ${result.branch} at ${result.path}`);
  });
  const output = (text) => {
    const el = $("project-output");
    el.textContent = (el.textContent + text).slice(-150000);
    el.scrollTop = el.scrollHeight;
  };
  const style = document.createElement("style");
  style.textContent =
    ".chat-session{margin:4px 0;font-size:11px;color:#8d8d9c}.chat-tool,.chat-thinking{margin:6px 0;border:1px solid #3a3a44;border-radius:6px;background:#1d1d23;font-size:11px}.chat-tool summary,.chat-thinking summary{cursor:pointer;padding:5px 8px;display:flex;gap:6px;align-items:center;color:#c9c9d6}.chat-tool-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chat-tool.error .chat-tool-state{color:#ff7a7a}.chat-tool.done .chat-tool-state{color:#6fd39a}.chat-tool-body{padding:0 8px 8px}.chat-tool-body pre,.chat-permission pre{max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#111116;padding:6px;border-radius:4px;margin:4px 0}.chat-thinking>div{padding:0 8px 8px;color:#9d9daa;white-space:pre-wrap}.chat-permission{border:1px solid #8a6d2a;background:#2a2416;border-radius:6px;padding:8px;margin:6px 0;font-size:12px}.chat-permission button{margin-right:6px}.chat-permission.allowed{border-color:#2f6b47}.chat-permission.denied,.chat-permission.expired{opacity:.7}.chat-error{color:#ff8f8f;white-space:pre-wrap;font-size:12px;margin:6px 0}.chat-message-content{white-space:pre-wrap}";
  document.head.append(style);
  const ATTACH_ICON = { image: "▣ ", file: "▤ ", folder: "▥ ", figma: "◆ ", chat: "◎ " };
  const renderAttachments = () => {
    $("chat-attachments").replaceChildren();
    attachments.forEach((item, i) => {
      const button = document.createElement("button");
      button.textContent = (ATTACH_ICON[item.kind] || "") + item.name + " ×";
      button.onclick = () => {
        attachments.splice(i, 1);
        renderAttachments();
      };
      $("chat-attachments").append(button);
    });
    notify();
  };
  $("chat-attach-file").onclick = () => {
    if (!openFile) {
      status("Open a file in the Code workspace first");
      return;
    }
    attachments.push({ kind: "text", name: openFile.path, text: openFile.text.slice(0, 16000) });
    renderAttachments();
  };
  $("chat-attach-canvas").onclick = () => {
    attachments.push({
      kind: "text",
      name: "Canvas",
      text: JSON.stringify(window.design.getDocument()).slice(0, 20000),
    });
    renderAttachments();
  };
  // Images are saved under userData/agent-attachments/<chat> by the main process; only their paths are sent.

  const attachImage = async (blob) => {
    if (!api?.saveAgentImage) throw Error("Attach images in the desktop app");
    if (!conversation) newChat();
    const chatId = conversation.id,
      target = attachments;
    const pending = [...imageJobs.values()].filter((j) => j.chatId === chatId).length;
    if (target.filter((a) => a.kind === "image").length + pending >= 10)
      throw Error("Attach up to 10 images");
    const controller = new AbortController();
    imageJobs.set(controller, { chatId });
    status("Preparing image · " + (pending + 1) + " pending · Esc to cancel");
    try {
      const { src: data } = await window.imageUpload.prepare(blob, {
        purpose: "chat",
        signal: controller.signal,
      });
      const saved = await api.saveAgentImage({ chatId, name: blob.name || "pasted image", data });
      controller.signal.throwIfAborted();
      target.push({ kind: "image", name: saved.name, path: saved.path });
      if (conversation?.id === chatId) renderAttachments();
      status((blob.name || "Image") + " attached");
    } finally {
      imageJobs.delete(controller);
    }
  };
  const attachImageBatch = async (files) => {
    let done = 0;
    const errors = [];
    await Promise.all(
      [...files].map(async (file) => {
        try {
          await attachImage(file);
          done++;
        } catch (error) {
          errors.push((file.name || "Image") + ": " + error.message);
        }
        status(
          done +
            "/" +
            files.length +
            " images attached" +
            (errors.length ? " · " + errors.join("; ") : ""),
        );
      }),
    );
  };
  $("project-prompt").addEventListener("keydown", (event) => {
    if (event.key === "Escape" && imageJobs.size) {
      for (const controller of imageJobs.keys()) controller.abort();
      status("Image uploads cancelled");
    }
  });
  $("chat-attach-image").onclick = () => $("chat-image-file").click();
  $("chat-image-file").onchange = action(async () => {
    const files = [...$("chat-image-file").files];
    $("chat-image-file").value = "";
    await attachImageBatch(files);
  });
  $("project-prompt").addEventListener("paste", (event) => {
    const images = [...(event.clipboardData?.items || [])]
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (!images.length) return;
    event.preventDefault();
    action(async () => {
      await attachImageBatch(images);
    })();
  });
  // Text files are inlined (≤5 files, ≤200 KB each); a folder is attached as its file tree (≤300 entries).
  const MAX_FILE_BYTES = 200 * 1024,
    MAX_FILES = 5,
    MAX_INLINE = 60000,
    MAX_PROMPT = 190000;
  const attachText = (name, text, size) => {
    if (attachments.filter((a) => a.kind === "file").length >= MAX_FILES)
      throw Error("Attach up to 5 files");
    if ((size ?? text.length) > MAX_FILE_BYTES) throw Error(name + " is over 200 KB");
    if (text.slice(0, 4096).includes("\u0000")) throw Error(name + " is not a text file");
    attachments.push({
      kind: "file",
      name,
      text: text.length > MAX_INLINE ? text.slice(0, MAX_INLINE) + "\n… (truncated)" : text,
    });
  };
  const attachTree = (name, paths) => {
    const list = [...new Set(paths)]
      .filter((p) => !/(^|\/)(node_modules|\.git)(\/|$)/.test(p))
      .sort();
    attachments.push({
      kind: "folder",
      name,
      text:
        list.slice(0, 300).join("\n") +
        (list.length > 300 ? `\n… ${list.length - 300} more entries` : ""),
    });
  };
  const attachFiles = async (input) => {
    if (input && typeof input.length === "number") {
      await attachImageBatch([...input].filter((file) => file.type?.startsWith("image/")));
      for (const file of input) {
        if (!file.type?.startsWith("image/")) attachText(file.name, await file.text(), file.size);
      }
      renderAttachments();
      return;
    }
    const folder = !!input?.folder,
      picker = api?.pickAgentFiles || api?.pickFiles || api?.openFiles;
    if (picker) {
      const picked = await picker({ folder, multiple: true });
      const items = Array.isArray(picked) ? picked : picked?.files || (picked ? [picked] : []);
      for (const item of items) {
        if (!item) continue;
        const name = item.name || item.path || "file";
        if (Array.isArray(item.entries) || Array.isArray(item.tree))
          attachTree(name, item.entries || item.tree);
        else if (typeof item.text === "string") attachText(item.path || name, item.text, item.size);
      }
      renderAttachments();
      return;
    }
    const picker2 = document.createElement("input");
    picker2.type = "file";
    picker2.multiple = true;
    if (folder) picker2.webkitdirectory = true;
    const chosen = await new Promise((resolve) => {
      picker2.onchange = () => resolve([...picker2.files]);
      picker2.oncancel = () => resolve([]);
      picker2.click();
    });
    if (!chosen.length) return;
    if (folder) {
      attachTree(
        chosen[0].webkitRelativePath.split("/")[0] || "Folder",
        chosen.map((f) => f.webkitRelativePath || f.name),
      );
      renderAttachments();
      return;
    }
    await attachImageBatch(chosen.filter((file) => file.type.startsWith("image/")));
    for (const file of chosen) {
      if (!file.type.startsWith("image/")) attachText(file.name, await file.text(), file.size);
    }
    renderAttachments();
  };
  const attachFigma = (url) => {
    url = String(url || "").trim();
    if (!/^https:\/\/([\w-]+\.)?figma\.com\/(file|design|proto|board)\//.test(url))
      throw Error("Paste a figma.com file or design link");
    const title = decodeURIComponent(
      /\/(?:file|design|proto|board)\/[^/]+\/([^/?#]+)/.exec(url)?.[1] || "Figma file",
    ).replace(/-/g, " ");
    attachments.push({ kind: "figma", name: "Figma · " + title.slice(0, 60), url });
    renderAttachments();
  };
  // Link a chat (any repository): its transcript is attached to the next message and its worktree becomes a working directory.
  const storedChat = (id, key) => {
    if (!key || key === projectKey) return conversations.find((c) => c.id === id);
    try {
      const saved = JSON.parse(storage.getItem(chatsKey(key)) || "[]");
      return (Array.isArray(saved) ? saved : []).find(
        (c) => c && c.id === id && Array.isArray(c.messages),
      );
    } catch {
      return null;
    }
  };
  const linkChat = (id, key) => {
    const other = storedChat(id, key);
    if (!other || other === conversation) throw Error("Choose another chat");
    const text = buildSeed(other.messages);
    const dir =
      other.worktree?.path || (key && key !== "unattached" && key !== projectKey ? key : null);
    if (!text && !dir) throw Error("That chat is empty");
    if (!conversation) newChat();
    if (text)
      attachments.push({
        kind: "chat",
        name: "Chat · " + other.title.slice(0, 60),
        text,
        chatId: id,
      });
    if (dir && dir !== rootOf(conversation)) addDirectory(dir);
    renderAttachments();
    status(`Linked “${other.title.slice(0, 60)}”`);
  };
  // Extra working directories of the current chat (composer /add-dir, linked worktrees): sent as runAgent `directories`.
  const addDirectory = (dir) => {
    dir = String(dir || "");
    if (!dir.startsWith("/")) throw Error("Choose a folder");
    if (!conversation) newChat();
    const dirs = conversation.dirs || (conversation.dirs = []);
    if (!dirs.includes(dir)) {
      if (dirs.length >= 10) throw Error("A chat can have up to 10 working directories");
      dirs.push(dir);
      persist();
    }
    notify();
  };
  const removeDirectory = (dir) => {
    if (!conversation?.dirs) return;
    conversation.dirs = conversation.dirs.filter((d) => d !== dir);
    persist();
    notify();
  };
  const attachImagePaths = (list) => {
    if (!conversation) newChat();
    for (const item of Array.isArray(list) ? list : []) {
      if (!item || typeof item.path !== "string") continue;
      if (
        attachments.filter((a) => a.kind === "image").length +
          [...imageJobs.values()].filter((j) => j.chatId === conversation.id).length >=
        10
      )
        throw Error("Attach up to 10 images");
      attachments.push({
        kind: "image",
        name: String(item.name || "image").slice(0, 120),
        path: item.path,
      });
    }
    renderAttachments();
  };
  const attachTextBlock = (kind, name, text, meta = {}) => {
    text = String(text || "");
    if (!text.trim()) throw Error("Nothing to attach");
    attachments.push({
      kind,
      name: String(name).slice(0, 120),
      text:
        text.length > MAX_INLINE ? "… (earlier output omitted)\n" + text.slice(-MAX_INLINE) : text,
      ...meta,
    });
    renderAttachments();
  };
  const escapeAttr = (text) =>
    String(text).replace(
      /[&"<>]/g,
      (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c],
    );
  const attachmentBlock = (a) =>
    a.kind === "file"
      ? `<attached-file path="${escapeAttr(a.name)}">\n${a.text}\n</attached-file>`
      : a.kind === "folder"
        ? `<attached-folder path="${escapeAttr(a.name)}">\n${a.text}\n</attached-folder>`
        : a.kind === "figma"
          ? `<figma-link url="${escapeAttr(a.url)}">The user linked this Figma file. You cannot open Figma links yourself. If you need its contents, ask the user to bring it onto the canvas with Import Figma, then read it with the canvas tools.</figma-link>`
          : a.kind === "chat"
            ? `<linked-chat title="${escapeAttr(a.name)}">\n${a.text}\n</linked-chat>`
            : a.kind === "terminal"
              ? `<terminal-output cwd="${escapeAttr(a.cwd || "")}">\n${a.text}\n</terminal-output>`
              : "Attachment " + a.name + ":\n" + a.text;
  // Ids only: the agent reads content through the canvas MCP tools.
  const canvasContext = () => {
    try {
      const design = window.design;
      if (!design?.getDocument) return {};
      const doc = design.getDocument(),
        page = doc.pages?.find((p) => p.id === doc.activePage),
        library = window.fileLibrary,
        file = library?.list?.().find((f) => f.id === library.currentId);
      return {
        documentName: doc.name || file?.name || "",
        documentId: library?.currentId || "",
        documentPath: file?.nativePath || "",
        pageId: doc.activePage || "",
        pageName: page?.name || "",
        selection: attachSelection() ? design.getSelection?.() || [] : [],
      };
    } catch {
      return {};
    }
  };
  // A task captures the composer (text, attachments, mentions); canvas context is read when it actually runs.
  const composeTask = (displayPrompt) => {
    let prompt = displayPrompt;
    if ($("project-context").checked && openFile)
      prompt += `\n\nOpen file ${openFile.path}:\n${openFile.text.slice(0, 16000)}`;
    for (const attachment of attachments.filter((a) => a.kind !== "image"))
      prompt += "\n\n" + attachmentBlock(attachment);
    if (prompt.length > MAX_PROMPT)
      throw Error("Attachments exceed 190,000 characters; remove an attachment");
    const task = {
      ...currentDefaults(),
      id: crypto.randomUUID(),
      at: Date.now(),
      prompt,
      displayPrompt,
      images: attachments.filter((a) => a.kind === "image"),
      mentions: currentMentions(),
      withCanvas: $("agent-canvas-context").checked,
      designStyle: window.chatDesignStyle?.get?.() || "",
    };
    attachments = [];
    manualMentions = [];
    renderAttachments();
    return task;
  };
  const enqueue = (chat, task) => {
    const q = queueOf(chat);
    if (q.length >= 10) throw Error("Queue is full");
    q.push(task);
    renderHistory();
    status(`${q.length} queued ${q.length === 1 ? "task" : "tasks"}`);
  };
  let versionRequest = null;
  const toolsVersion = () =>
    versionRequest ||
    (versionRequest = api?.agentToolsVersion
      ? Promise.resolve()
          .then(() => api.agentToolsVersion())
          .then((v) => (typeof v === "string" ? v : v ? String(v) : ""))
          .catch(() => {
            versionRequest = null;
            return "";
          })
      : Promise.resolve(""));
  const normalizeQuestions = (list) =>
    (Array.isArray(list) ? list : []).slice(0, 10).map((q, i) => ({
      id: String(q?.id ?? "q" + (i + 1)),
      question: String(q?.question ?? ""),
      ...(q?.header ? { header: String(q.header) } : {}),
      ...(Array.isArray(q?.options)
        ? {
            options: q.options.map((o) =>
              typeof o === "string"
                ? { label: o }
                : {
                    label: String(o?.label ?? ""),
                    ...(o?.description ? { description: String(o.description) } : {}),
                  },
            ),
          }
        : {}),
      ...(q?.multiSelect ? { multiSelect: true } : {}),
    }));
  const num = (...values) => {
    for (const v of values) if (Number.isFinite(v)) return v;
    return undefined;
  };
  const normalizeUsage = (event, previous = {}) => {
    const u = { ...(event.usage && typeof event.usage === "object" ? event.usage : {}), ...event };
    const input = num(u.inputTokens, u.input_tokens),
      cached = (num(u.cache_read_input_tokens) || 0) + (num(u.cache_creation_input_tokens) || 0);
    const next = { ...previous };
    const set = (k, v) => {
      if (v !== undefined) next[k] = v;
    };
    set("inputTokens", input === undefined ? undefined : input + cached);
    set("outputTokens", num(u.outputTokens, u.output_tokens));
    set("contextWindow", num(u.contextWindow, u.modelContextWindow, u.model_context_window));
    set("costUsd", num(u.costUsd, u.total_cost_usd));
    if (Array.isArray(u.rateLimit)) next.rateLimit = u.rateLimit;
    return next;
  };
  const finalizeReply = (reply, event, last) => {
    if (reply.state === "running") {
      reply.end = Date.now();
      reply.state = event.stopped ? "stopped" : event.code === 0 ? "complete" : "failed";
    }
    for (const part of reply.parts || []) {
      if (part.kind === "tool" && part.state === "running")
        part.state = event.code === 0 ? "done" : "interrupted";
      if ((part.kind === "permission" || part.kind === "question") && part.state === "pending")
        part.state = "expired";
    }
    if (last && !reply.text && !(reply.parts || []).length)
      reply.text = event.stopped ? "Stopped." : "No response.";
  };
  const autoTitle = (entry, chat) => {
    if (chat.autoTitled) return;
    chat.autoTitled = true;
    if (!api?.agentTitle) return;
    const first = chat.messages.find((m) => m.role === "user");
    if (!first) return;
    Promise.resolve(api.agentTitle({ agent: entry.task.agent, text: first.text.slice(0, 2000) }))
      .then((result) => {
        if (result?.source === "heuristic") return;
        let title = typeof result === "string" ? result : result?.title;
        title = typeof title === "string" ? title.trim().replace(/^["']|["']$/g, "") : "";
        if (!title) return;
        chat.title = title.slice(0, 80);
        persistChat(entry);
        renderHistory();
      })
      .catch(() => {});
  };
  const finishRun = (entry, event) => {
    const chat = entry.chat;
    active.delete(chat.id);
    if (entry.runId) runs.delete(entry.runId);
    entry.replies.forEach((reply, i) =>
      finalizeReply(reply, event, i === entry.replies.length - 1),
    );
    if (event.sessionId) {
      chat.sessionId = event.sessionId;
      chat.sessionAgent = entry.task.agent;
      chat.sessionKey = entry.key;
      chat.toolsVersion = entry.version;
    }
    // agent-runtime parity: remember where this turn ended in the provider session so a later rewind can fork there.
    if (event.sessionId && event.resumeAt && entry.replies.length)
      entry.replies.at(-1).resumePoint = {
        sessionId: event.sessionId,
        at: event.resumeAt,
        agent: entry.task.agent,
        key: entry.key,
        toolsVersion: entry.version,
      };
    if (event.code === 0 || event.stopped) stats.completed++;
    else stats.failed++;
    output(`\n[${event.stopped ? "stopped" : "exit " + event.code}]\n`);
    persistChat(entry);
    renderHistory();
    window.dispatchEvent(
      new CustomEvent("code-files-changed", { detail: { root: rootOf(chat, entry.key) } }),
    );
    status(
      chat !== conversation
        ? `“${chat.title}” ${event.stopped ? "stopped" : event.code === 0 ? "finished" : entry.authRequired ? "needs sign-in" : "failed"}`
        : event.stopped
          ? "Stopped"
          : event.code === 0
            ? "Done"
            : entry.authRequired
              ? "Sign in to continue"
              : "The agent reported an error",
    );
    if (event.code === 0) autoTitle(entry, chat);
    // Stop keeps the queue (paused); "send now" stops the run and starts the chosen task.
    const q = queueOf(chat);
    let next = null;
    if (entry.nextTaskId) {
      const i = q.findIndex((t) => t.id === entry.nextTaskId);
      if (i >= 0) next = q.splice(i, 1)[0];
    } else if (!entry.userStopped && entry.key === projectKey) next = q.shift();
    if (next) runTask(next, chat);
    else renderHistory();
  };
  const lastPart = (reply, kind) => {
    let part = reply.parts.at(-1);
    if (!part || part.kind !== kind) {
      part = { kind, text: "", at: Date.now() };
      reply.parts.push(part);
    }
    return part;
  };
  const toolPart = (entry, id) => {
    for (const reply of entry.replies.toReversed()) {
      const part = reply.parts?.find((p) => p.kind === "tool" && p.id === id);
      if (part) return part;
    }
    return null;
  };
  const handleEvent = (event) => {
    const entry = runs.get(event.id);
    if (!entry) {
      if (inflight > 0 && event.id) {
        orphans.push(event);
        if (orphans.length > 2000) orphans.shift();
      }
      return;
    }
    const chat = entry.chat,
      reply = entry.reply,
      here = chat === conversation;
    if (!Array.isArray(reply.parts)) reply.parts = [];
    switch (event.type) {
      case "session":
        chat.sessionId = event.sessionId;
        chat.sessionAgent = entry.task.agent;
        chat.sessionKey = entry.key;
        chat.toolsVersion = entry.version;
        if (here) sessionLabel();
        break;
      case "status":
        if (here) status(event.text);
        output("[" + event.text + "]\n");
        break;
      case "assistant-text-delta": {
        const part = lastPart(reply, "text");
        part.text = (part.text + event.text).slice(-100000);
        reply.text = (reply.text + event.text).slice(-100000);
        output(event.text);
        break;
      }
      case "assistant-text": {
        reply.parts.push({ kind: "text", text: event.text });
        reply.text = ((reply.text ? reply.text + "\n\n" : "") + event.text).slice(-100000);
        output(event.text + "\n");
        break;
      }
      case "thinking-delta": {
        const part = lastPart(reply, "thinking");
        part.text = (part.text + event.text).slice(-20000);
        part.end = Date.now();
        break;
      }
      case "tool-call": {
        let part = toolPart(entry, event.toolCallId);
        if (!part) {
          part = {
            kind: "tool",
            id: event.toolCallId,
            name: event.toolName,
            title: event.title,
            input: event.input,
            partialInput: "",
            hasInput: !event.partial,
            state: "running",
            ...(event.parentToolCallId ? { parentToolCallId: event.parentToolCallId } : {}),
          };
          reply.parts.push(part);
        } else if (!event.partial) {
          part.input = event.input;
          part.title = event.title;
          part.hasInput = true;
        }
        if (!event.partial) {
          output("\n[" + event.title + "]\n");
          if (here) status(event.title);
        }
        break;
      }
      case "tool-input-delta": {
        const part = toolPart(entry, event.toolCallId);
        if (part && !part.hasInput)
          part.partialInput = (part.partialInput + event.partial).slice(-20000);
        break;
      }
      case "tool-result": {
        const part = toolPart(entry, event.toolCallId);
        if (part) {
          part.result = event.content;
          part.state = event.isError ? "error" : "done";
        }
        break;
      }
      case "permission-request":
        reply.parts.push({
          kind: "permission",
          requestId: event.requestId,
          toolName: event.toolName,
          title: event.title,
          input: event.input,
          state: "pending",
        });
        status((here ? "" : `“${chat.title}”: `) + "Approval needed: " + event.title);
        persistChat(entry);
        break;
      case "permission-resolved": {
        const part = entry.replies
          .flatMap((r) => r.parts || [])
          .find((p) => p.kind === "permission" && p.requestId === event.requestId);
        if (part && part.state === "pending") part.state = event.allow ? "allowed" : "expired";
        break;
      }
      case "question-request":
        reply.parts.push({
          kind: "question",
          requestId: event.requestId,
          runId: event.id,
          questions: normalizeQuestions(event.questions),
          state: "pending",
          at: Date.now(),
        });
        status((here ? "" : `“${chat.title}”: `) + "The agent has a question");
        persistChat(entry);
        break;
      case "question-resolved": {
        const part = entry.replies
          .flatMap((r) => r.parts || [])
          .find((p) => p.kind === "question" && p.requestId === event.requestId);
        if (part && part.state === "pending") {
          part.state = event.answers ? "answered" : "expired";
          if (event.answers) part.answers = event.answers;
        }
        break;
      }
      case "usage":
        reply.usage = normalizeUsage(event, reply.usage);
        chat.usage = reply.usage;
        break;
      case "error":
        if (entry.authRequired) break;
        reply.parts.push({ kind: "error", text: event.text });
        output("\n[error] " + event.text + "\n");
        break;
      // Signed-out provider account (desktop/agent-runtime.cjs requireAuth): one sign-in card per run (chat/auth-card.tsx); later errors are dropped.
      case "auth-required": {
        if (entry.authRequired) break;
        entry.authRequired = true;
        const a = event.account && typeof event.account === "object" ? event.account : {};
        reply.parts.push({
          kind: "auth",
          agent: String(event.agent || entry.task.agent),
          text: String(event.text || "").slice(0, 600),
          account: {
            id: String(a.id || "system"),
            name: String(a.name || ""),
            system: a.system !== false,
          },
        });
        output("\n[" + (event.text || "Sign-in needed") + "]\n");
        if (here) status(event.text || "Sign-in needed");
        persistChat(entry);
        break;
      }
      // Chat autonomy (desktop/agent-autonomy.cjs): the run's effective settings and automatic allow/deny/limit decisions.
      case "autonomy":
        if (event.text)
          reply.parts.push({ kind: "autonomy", text: String(event.text).slice(0, 600) });
        break;
      case "policy":
        reply.parts.push({
          kind: "policy",
          decision: String(event.decision || ""),
          toolName: String(event.toolName || ""),
          text: String(event.text || "").slice(0, 600),
        });
        output("\n[" + (event.text || event.decision) + "]\n");
        if (event.decision === "limit" && here) status(event.text);
        break;
      case "done":
        finishRun(entry, event);
        return;
    }
    scheduleReply();
  };
  // Events can arrive before run() resolves with the run id; unknown ids are buffered while a start is in flight.
  // The subscription itself is made by bindAgents (end of file) on the platform's AgentService.
  const runTask = async (task, chat) => {
    if (!chat) chat = conversation || newChat();
    if (active.has(chat.id)) {
      enqueue(chat, task);
      return;
    }
    const entry = {
      chat,
      key: projectKey,
      task,
      reply: null,
      replies: [],
      runId: null,
      version: "",
      userStopped: false,
      nextTaskId: null,
      cancelOnStart: false,
    };
    active.set(chat.id, entry);
    inflight++;
    stats.runs++;
    const prior = chat.messages.slice();
    const context = {
      ...(task.withCanvas !== false ? canvasContext() : {}),
      images: task.images.map((i) => i.path),
    };
    const userMessage = {
      role: "user",
      text: task.displayPrompt || task.prompt,
      agent: task.agent,
      at: Date.now(),
      ...(task.images.length ? { images: task.images.map((i) => i.name) } : {}),
      ...("pageId" in context ? { canvas: context.documentName || "Canvas" } : {}),
      ...(task.mentions?.length ? { mentions: task.mentions } : {}),
    };
    const checkpoint = takeCheckpoint(chat);
    if (checkpoint) userMessage.checkpoint = checkpoint;
    chat.messages.push(userMessage);
    taskOf.set(userMessage, task);
    if (chat.title === "New chat" || chat.title === "New quick chat")
      chat.title = userMessage.text.slice(0, 55);
    const reply = {
      role: "assistant",
      text: "",
      parts: [],
      agent: task.agent,
      model: task.model,
      at: Date.now(),
      state: "running",
    };
    chat.messages.push(reply);
    entry.reply = reply;
    entry.replies.push(reply);
    persistChat(entry);
    renderHistory();
    try {
      const svc = agentService(),
        web = svc.kind === "web";
      entry.version = await toolsVersion();
      // Resume only the same provider/project session created with the same canvas tool set; otherwise seed a new session.
      // The model API (web) keeps no provider session: every turn sends the earlier turns as `history` instead.
      const resume =
        !web &&
        chat.sessionId &&
        chat.sessionAgent === task.agent &&
        chat.sessionKey === entry.key &&
        (!entry.version || chat.toolsVersion === entry.version)
          ? chat.sessionId
          : "";
      const seed = resume || web ? "" : buildSeed(prior.slice(chat.seedFrom || 0)),
        seedParam = !!api?.agentToolsVersion;
      let prompt = task.prompt;
      if (seed && !seedParam)
        prompt =
          tail(
            "<previous-conversation>\n" + seed + "\n</previous-conversation>",
            Math.max(0, 195000 - prompt.length),
          ) +
          "\n\n" +
          prompt;
      if (!seedParam && task.mentions?.length)
        prompt +=
          "\n\nReferenced canvas elements: " +
          task.mentions
            .map(
              (m) =>
                `${m.label} (id ${m.id}${m.shortId ? ", short id " + m.shortId : ""}, page ${m.pageId})`,
            )
            .join("; ");
      entry.resumed = !!resume;
      // agent-runtime parity: after a rewind, fork the provider session at the kept reply (the seed stays as the fallback).
      const fork =
        !resume &&
        seedParam &&
        chat.forkFrom &&
        chat.forkFrom.agent === task.agent &&
        chat.forkFrom.key === entry.key &&
        (!entry.version || chat.forkFrom.toolsVersion === entry.version)
          ? chat.forkFrom
          : null;
      const result = await svc.run({
        ...(api?.repositories ? { root: rootOf(chat, entry.key) } : {}),
        ...(web ? { history: historyOf(prior.slice(chat.seedFrom || 0)) } : {}),
        agent: task.agent,
        model: task.model === "default" ? "" : task.model,
        access: task.access,
        effort: task.effort,
        instructions: task.instructions,
        prompt,
        chatId: chat.id,
        ...(resume ? { sessionId: resume } : {}),
        ...(fork ? { fork: { sessionId: fork.sessionId, at: fork.at } } : {}),
        ...(seed && seedParam ? { seed } : {}),
        ...(task.mentions?.length ? { mentions: task.mentions } : {}),
        ...(chat.dirs?.length ? { directories: chat.dirs.slice() } : {}),
        ...(task.designStyle ? { designStyle: task.designStyle } : {}),
        context,
      });
      entry.runId = result.id;
      runs.set(result.id, entry);
      reply.access = result.access;
      reply.runtime = result.runtime;
      inflight--;
      chat.forkFrom = null;
      if (chat === conversation)
        status(
          web
            ? "Running on the model API" + (result.model ? " · " + result.model : "")
            : (result.quickChat ? "Quick chat · scratch folder" : "Running in project") +
                " · " +
                result.runtime +
                (result.mcp ? " · canvas tools connected" : " · canvas tools not connected") +
                (resume
                  ? " · resumed session"
                  : result.rewound
                    ? " · session rewound"
                    : seed
                      ? " · new session seeded from transcript"
                      : ""),
        );
      for (const event of orphans.filter((e) => e.id === result.id)) {
        orphans.splice(orphans.indexOf(event), 1);
        handleEvent(event);
      }
      if (!inflight) orphans.length = 0;
      if (entry.cancelOnStart && active.get(chat.id) === entry)
        svc.cancel(result.id).catch((e) => status(e.message));
    } catch (e) {
      inflight--;
      if (!inflight) orphans.length = 0;
      reply.text = e.message;
      reply.state = "error";
      reply.end = Date.now();
      stats.failed++;
      active.delete(chat.id);
      persistChat(entry);
      renderHistory();
      status(e.message);
      const next = entry.nextTaskId
        ? queueOf(chat).find((t) => t.id === entry.nextTaskId)
        : entry.userStopped
          ? null
          : queueOf(chat)[0];
      if (next) {
        queueOf(chat).splice(queueOf(chat).indexOf(next), 1);
        runTask(next, chat);
      }
    }
  };
  // Steering: the runtime injects a message into the running turn; the transcript shows it and continues in a new reply.
  const trySteer = async (entry, task) => {
    if (!api?.steerAgent || !entry.runId) return false;
    let result;
    try {
      result = await api.steerAgent({
        runId: entry.runId,
        chatId: entry.chat.id,
        text: task.prompt,
        ...(task.images.length ? { images: task.images.map((i) => i.path) } : {}),
        ...(task.mentions?.length ? { mentions: task.mentions } : {}),
      });
    } catch {
      return false;
    }
    if (!result || result.queued || active.get(entry.chat.id) !== entry) return false;
    const chat = entry.chat,
      previous = entry.reply;
    if (previous.state === "running") {
      previous.state = "complete";
      previous.end = Date.now();
    }
    const userMessage = {
      role: "user",
      text: task.displayPrompt || task.prompt,
      agent: task.agent,
      at: Date.now(),
      steered: true,
      ...(task.images.length ? { images: task.images.map((i) => i.name) } : {}),
      ...(task.mentions?.length ? { mentions: task.mentions } : {}),
    };
    chat.messages.push(userMessage);
    taskOf.set(userMessage, task);
    const reply = {
      role: "assistant",
      text: "",
      parts: [],
      agent: previous.agent,
      model: previous.model,
      at: Date.now(),
      state: "running",
      access: previous.access,
      runtime: previous.runtime,
    };
    chat.messages.push(reply);
    entry.reply = reply;
    entry.replies.push(reply);
    persistChat(entry);
    renderHistory();
    return true;
  };
  const steer = async (text) => {
    text = String(text || "").trim();
    if (!text) return;
    const chat = conversation || newChat(),
      entry = entryOf(chat),
      task = composeTask(text);
    if (!entry) {
      await runTask(task, chat);
      return;
    }
    if (!(await trySteer(entry, task))) enqueue(chat, task);
  };
  const sendQueuedNow = async (id) => {
    const chat = conversation,
      q = queueOf(chat),
      task = q.find((t) => t.id === id);
    if (!task) return;
    const entry = entryOf(chat);
    if (!entry) {
      q.splice(q.indexOf(task), 1);
      renderHistory();
      await runTask(task, chat);
      return;
    }
    if (await trySteer(entry, task)) {
      const i = q.indexOf(task);
      if (i >= 0) q.splice(i, 1);
      renderHistory();
      return;
    }
    entry.nextTaskId = id;
    entry.userStopped = false;
    if (entry.runId) await agentService().cancel(entry.runId);
    else entry.cancelOnStart = true;
    status("Stopping the current turn to send the queued message");
  };
  const editQueued = (id, text) => {
    const task = queueOf(conversation).find((t) => t.id === id);
    text = String(text || "").trim();
    if (!task || !text) return;
    const suffix = task.prompt.startsWith(task.displayPrompt)
      ? task.prompt.slice(task.displayPrompt.length)
      : "";
    task.displayPrompt = text;
    task.prompt = text + suffix;
    renderHistory();
  };
  const moveQueued = (id, delta) => {
    const q = queueOf(conversation),
      i = q.findIndex((t) => t.id === id),
      j = i + (delta < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= q.length) return;
    [q[i], q[j]] = [q[j], q[i]];
    renderHistory();
  };
  const removeQueued = (id) => {
    const q = queueOf(conversation),
      i = q.findIndex((t) => t.id === id);
    if (i < 0) return;
    q.splice(i, 1);
    renderHistory();
  };
  // Rewind: restore the canvas snapshot taken before user message i (one undoable step), keep the full transcript
  // as a branch, truncate this chat before i and drop its provider session (the next run is seeded instead).
  const rewindCore = (index) => {
    const chat = conversation;
    if (!chat) return null;
    if (isRunning(chat)) throw Error("Stop the active task first");
    let i = Math.min(index, chat.messages.length - 1);
    while (i > 0 && chat.messages[i]?.role !== "user") i--;
    const message = chat.messages[i];
    if (!message || message.role !== "user") return null;
    const branch = {
      id: crypto.randomUUID(),
      title: chat.title + " · before rewind",
      messages: chat.messages.map(cloneMessage),
      created: Date.now(),
      sessionId: chat.sessionId || null,
      sessionAgent: chat.sessionAgent,
      sessionKey: chat.sessionKey,
      toolsVersion: chat.toolsVersion,
    };
    conversations.splice(conversations.indexOf(chat), 0, branch);
    let restored = false;
    const saved = message.checkpoint && checkpoints.get(message.checkpoint);
    if (
      saved &&
      saved.fileId === (window.fileLibrary?.currentId || "") &&
      window.design?.loadDocument
    ) {
      try {
        window.design.loadDocument(structuredClone(saved.doc));
        restored = true;
      } catch (e) {
        status("Could not restore the canvas: " + e.message);
      }
    }
    // agent-runtime parity: the next run forks the provider session at the last kept reply when it reported a fork point.
    const kept = chat.messages.slice(0, i),
      keptReply = kept.findLast((m) => m.role === "assistant" && !m.review);
    chat.forkFrom =
      keptReply?.resumePoint?.sessionId && keptReply.resumePoint.at
        ? { ...keptReply.resumePoint }
        : null;
    chat.messages = kept;
    chat.sessionId = null;
    persist();
    renderHistory();
    status(
      restored
        ? "Rewound the chat and canvas (undo restores the canvas)"
        : "Rewound the chat; no canvas snapshot was available for that message",
    );
    return { message, restored };
  };
  const resend = (message, text) => {
    const original = taskOf.get(message);
    const displayPrompt = text ?? message.text;
    const suffix =
      original && original.prompt.startsWith(original.displayPrompt)
        ? original.prompt.slice(original.displayPrompt.length)
        : "";
    return runTask(
      {
        ...currentDefaults(),
        id: crypto.randomUUID(),
        at: Date.now(),
        prompt: displayPrompt + suffix,
        displayPrompt,
        images: original?.images || [],
        mentions: original?.mentions || message.mentions || [],
        withCanvas: original ? original.withCanvas : !!message.canvas,
      },
      conversation,
    );
  };
  // agent-runtime parity: second opinion. The other provider reviews the latest reply (and uncommitted changes), read-only.
  const secondOpinion = async (index) => {
    const chat = conversation;
    if (!chat) return;
    if (!api?.reviewAgent) throw Error("Second opinions need the desktop agent runtime");
    if (isRunning(chat)) throw Error("Wait for the current task to finish");
    let i = Math.min(index ?? chat.messages.length - 1, chat.messages.length - 1);
    while (i > 0 && (chat.messages[i]?.role !== "assistant" || chat.messages[i].review)) i--;
    const reply = chat.messages[i];
    if (!reply || reply.role !== "assistant" || reply.review)
      throw Error("Choose a reply to review");
    const answer =
      (reply.parts || [])
        .filter((p) => p.kind === "text" && p.text)
        .map((p) => p.text)
        .join("\n\n") ||
      reply.text ||
      "";
    if (!answer.trim() || reply.state === "error") throw Error("There is no answer to review yet");
    const request = chat.messages.slice(0, i).findLast((m) => m.role === "user")?.text || "";
    const author = reply.agent === "codex" ? "codex" : "claude",
      agent = author === "codex" ? "claude" : "codex",
      label = (a) => (a === "claude" ? "Claude" : "Codex");
    const review = {
      role: "assistant",
      text: "",
      parts: [],
      agent,
      at: Date.now(),
      state: "running",
      review: { of: i, author },
    };
    chat.messages.push(review);
    persist();
    renderHistory();
    status("Asking " + label(agent) + " for a second opinion");
    try {
      const result = await api.reviewAgent({ agent, author, request, answer, includeDiff: true });
      review.agent = result.agent || agent;
      review.model = result.model || "";
      review.text = String(result.text || "");
      review.parts = [{ kind: "text", text: review.text, at: review.at }];
      review.state = "complete";
      review.review.diff = !!result.diff;
      status(
        "Second opinion from " +
          label(review.agent) +
          (result.diff ? " on the answer and uncommitted changes" : ""),
      );
    } catch (e) {
      review.text = e.message;
      review.state = "error";
      status(e.message);
    }
    review.end = Date.now();
    persist();
    renderHistory();
  };
  const copyMessage = (index) => {
    const message = conversation?.messages[index];
    if (!message) return;
    const text =
      message.text ||
      (message.parts || [])
        .filter((p) => p.kind === "text")
        .map((p) => p.text)
        .join("\n\n");
    const fallback = () => {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    };
    (navigator.clipboard?.writeText ? navigator.clipboard.writeText(text) : Promise.reject())
      .catch(fallback)
      .then(() => status("Copied"));
  };
  const answerQuestion = (messageIndex, partIndex, answers) => {
    const part = conversation?.messages[messageIndex]?.parts?.[partIndex];
    if (part?.kind !== "question" || part.state !== "pending") return;
    const clean = {};
    for (const [key, value] of Object.entries(answers || {}))
      clean[key] = Array.isArray(value) ? value.join(", ") : String(value);
    part.answers = clean;
    part.state = "answered";
    const runId = part.runId || entryOf(conversation)?.runId;
    if (api?.respondAgentQuestion)
      Promise.resolve()
        .then(() => api.respondAgentQuestion({ runId, requestId: part.requestId, answers: clean }))
        .catch((e) => status(e.message));
    else status("This agent runtime cannot receive answers");
    persist();
    renderHistory();
  };
  // Follow-ups while a turn runs (Settings › Agents › Follow-up messages): Send goes the default way (Queue or Steer);
  // ⌘↵ sends the other way. A steer the runtime cannot take falls back to the queue.
  let sendOtherWay = false;
  const followUpSteers = (other) => (behavior().followUp === "steer") !== other;
  $("project-run").onclick = action(async () => {
    const other = sendOtherWay;
    sendOtherWay = false;
    const text = $("project-prompt").value.trim();
    if (!text) throw Error("Enter a task.");
    const chat = conversation || newChat();
    const task = composeTask(text);
    $("project-prompt").value = "";
    setDraft("", chat);
    if (isRunning(chat)) {
      const entry = entryOf(chat);
      if (followUpSteers(other) && entry && (await trySteer(entry, task))) return;
      enqueue(chat, task);
      return;
    }
    await runTask(task, chat);
  });
  $("project-prompt").addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      sendOtherWay = isRunning(conversation);
      $("project-run").click();
      sendOtherWay = false;
    }
  });
  $("project-cancel").onclick = action(async () => {
    const entry = entryOf(conversation);
    if (!entry) return;
    entry.userStopped = true;
    entry.nextTaskId = null;
    if (entry.runId) await agentService().cancel(entry.runId);
    else entry.cancelOnStart = true;
    const kept = queueOf(conversation).length;
    renderHistory();
    status("Stopping agent" + (kept ? ` · ${kept} queued kept` : ""));
  });
  $("project-review").onclick = () => {
    $("project-prompt").value =
      "Review the current uncommitted Git changes. Inspect the diff and relevant source. Report correctness, security, and regression findings with file references. Do not edit files.";
    setDefaults({ ...currentDefaults(), access: "ask" });
    status("Review prompt ready. Choose an agent and run it.");
  };
  $("project-apply-design").onclick = () => {
    $("project-prompt").value =
      "Implement the attached canvas design in this project using its existing stack. Inspect source, preserve working behavior, apply the design and run checks.";
    $("chat-attach-canvas").click();
    status("Canvas attached to task. Choose an agent and run it.");
  };
  // Model picker: populated from the provider (Claude SDK supportedModels / Codex model/list); free text still allowed.
  const modelLists = new Map();
  const loadModels = async () => {
    const agent = $("project-agent").value;
    const list = $("agent-model-list");
    try {
      if (!modelLists.has(agent)) modelLists.set(agent, await agentService().models({ agent }));
      if ($("project-agent").value !== agent) return;
      list.replaceChildren();
      for (const model of modelLists.get(agent)) {
        if (model.id === "default") continue;
        const option = document.createElement("option");
        option.value = model.id;
        option.label =
          model.name + (model.description ? " — " + model.description.slice(0, 60) : "");
        list.append(option);
      }
    } catch (e) {
      modelLists.delete(agent);
      output("[model list unavailable: " + e.message + "]\n");
    }
  };
  host.querySelector(".agent-config").addEventListener("toggle", (event) => {
    if (event.target.open) loadModels();
  });
  loadChats(projectKey);
  const run =
    (fn) =>
    (...args) =>
      action(() => fn(...args))();
  Object.assign(window.agentWorkspace, {
    cancelImageUploads: () => {
      for (const controller of imageJobs.keys()) controller.abort();
    },
    attachImages: (files) =>
      action(async () => {
        await attachImageBatch(files);
      })(),
    listModels: async (agent) => {
      if (!modelLists.has(agent)) modelLists.set(agent, await agentService().models({ agent }));
      return modelLists.get(agent);
    },
    answerQuestion,
    steer: run(steer),
    queueMessage: run(async (text) => {
      text = String(text || "").trim();
      if (!text) return;
      const chat = conversation || newChat(),
        task = composeTask(text);
      if (isRunning(chat)) enqueue(chat, task);
      else await runTask(task, chat);
    }),
    editQueued,
    moveQueued,
    removeQueued,
    sendQueuedNow: run(sendQueuedNow),
    rewindTo: run((index) => {
      rewindCore(index);
    }),
    ...(api ? { secondOpinion: run(secondOpinion) } : {}),
    retry: run(async (index) => {
      const r = rewindCore(index);
      if (r) await resend(r.message);
    }),
    editMessage: run(async (index, text) => {
      text = String(text || "").trim();
      if (!text) throw Error("Enter a message");
      const r = rewindCore(index);
      if (r) await resend(r.message, text);
    }),
    copyMessage,
    attachFiles: run(attachFiles),
    attachFigma: run(attachFigma),
    linkChat: run(linkChat),
    // Composer "+" menu / slash commands (web/src/islands/chat/attach-menu.tsx, slash-commands.tsx).
    addDirectory: run(addDirectory),
    removeDirectory,
    attachImagePaths: run(attachImagePaths),
    attachText: run(attachTextBlock),
    attachedImages: () =>
      attachments
        .filter((a) => a.kind === "image" && a.path)
        .map((a) => ({ path: a.path, name: a.name })),
    clearSession: () => {
      if (!conversation) return;
      if (isRunning(conversation)) throw Error("Stop the chat first");
      conversation.sessionId = null;
      conversation.forkFrom = null;
      conversation.seedFrom = conversation.messages.length;
      persist();
      status("The next message starts a fresh agent session");
      notify();
    },
    getQueue: () => queueView(queueOf(conversation)),
  });
  // The platform's AgentService: its events reach handleEvent, and the agents it offers enable the picker's options. Rebound
  // when the service is registered or its readiness changes (web: sign in/out, the server's model API config).
  let boundService = null,
    unbindEvents = null;
  const bindAgents = () => {
    const svc = window.verynizePlatform.agents.service();
    if (svc !== boundService) {
      unbindEvents?.();
      unbindEvents = svc ? svc.subscribe((event) => handleEvent(event)) : null;
      boundService = svc;
    }
    if (!svc) return;
    modelLists.clear();
    svc
      .discover()
      .then((agents) => {
        if (svc !== boundService) return;
        if (api)
          $("project-agent-status").textContent = agents
            .map((a) => `${a.id}: ${a.available ? "installed" : "not found"}`)
            .join(" · ");
        for (const option of $("project-agent").options)
          option.disabled = !agents.find((a) => a.id === option.value)?.available;
        const first = agents.find((a) => a.available);
        if (first && !agents.find((a) => a.id === $("project-agent").value && a.available))
          $("project-agent").value = first.id;
        notify();
      })
      .catch((e) => status(e.message));
  };
  window.verynizePlatform.agents.subscribe(bindAgents);
  bindAgents();
})();
