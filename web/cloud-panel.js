// Share & collaborate panel: rooms, live operation-based sync, presence, accounts, roles,
// link rotation, comments, design snapshots and published apps. API: cloud/README.md.
(() => {
  const Ops = window.VerynizeOps;
  // Lazy pages (web/page-loader.js): stubs until fetched, edits on them held until they load.
  const Pages = window.pageLoader;
  const LOCAL_KEYS = ["activePage"];
  const ACCOUNT_KEY = "verynize.cloud.account";
  const SESSION_TOKEN = /^(vs_[0-9a-f]{64}|[A-Za-z0-9]{16,64}\.[A-Za-z0-9+/=_%-]{16,128})$/;
  const ROLE_LABEL = { owner: "Owner", editor: "Editor", commenter: "Commenter", viewer: "Viewer" };
  const root = document.createElement("section");
  root.id = "cloud-panel";
  root.innerHTML = `<button id="cloud-toggle">Share & collaborate</button><dialog id="cloud-dialog"><header><strong>Shared design</strong><button id="cloud-close">Close</button></header>
<label>Server URL<input id="cloud-server" placeholder="https://your-app.workers.dev"></label><label>Your name<input id="cloud-name" maxlength="80" placeholder="Designer"></label>
<p>Create a private room, then share its invite link with collaborators. Invite links let people edit (or only view); owner access stays with you.</p>
<div class="cloud-actions"><button id="cloud-create">Create room</button><button id="cloud-connect">Join invite</button><button id="cloud-leave">Disconnect</button></div>
<label>Invite link<input id="cloud-invite" placeholder="Paste a private invite URL to join"></label>
<div class="cloud-actions"><select id="cloud-invite-role" aria-label="Role for people who join with the invite" hidden><option value="editor">Can edit</option><option value="viewer">Can view</option></select><button id="cloud-copy">Copy invite</button></div>
<div class="cloud-actions"><button id="cloud-publish" hidden>Publish snapshot</button><button id="cloud-unpublish" hidden>Unpublish</button></div>
<a id="cloud-public" target="_blank" rel="noopener noreferrer"></a><p id="cloud-status" role="status">Not connected</p>
<div id="cloud-conflict" hidden><p>A collaborator changed the design while you were editing. Your work has not been overwritten.</p><button id="cloud-reload">Load shared version</button><button id="cloud-overwrite">Replace shared version with mine</button></div>
<details class="cloud-section" id="cloud-account-section"><summary>Account</summary>
 <div id="cloud-signed-out"><label>Email<input id="cloud-email" type="email" autocomplete="email" placeholder="you@studio.com"></label>
  <label>Password<input id="cloud-password" type="password" autocomplete="current-password" minlength="10" maxlength="128" placeholder="At least 10 characters"></label>
  <label>Name (for a new account)<input id="cloud-signup-name" maxlength="80" autocomplete="name" placeholder="Designer"></label>
  <div class="cloud-actions"><button id="cloud-signin">Sign in</button><button id="cloud-signup">Create account</button><button id="cloud-forgot">Forgot password</button></div>
  <div class="cloud-actions"><button id="cloud-passkey-signin">Sign in with a passkey</button></div></div>
 <div id="cloud-signed-in" hidden><p id="cloud-account"></p>
  <label>Handle<input id="cloud-handle" maxlength="30" autocomplete="off"></label><label>Display name<input id="cloud-display-name" maxlength="80"></label><label>Avatar URL<input id="cloud-avatar" placeholder="https://…"></label>
  <div class="cloud-actions"><button id="cloud-profile-save">Save profile</button><button id="cloud-profile-open">View public profile</button></div>
  <div class="cloud-actions"><button id="cloud-signout">Sign out</button><button id="cloud-signout-all">Sign out everywhere</button></div>
  <p class="cloud-subhead">Passkeys</p><ul id="cloud-passkeys" class="cloud-list"></ul><div class="cloud-actions"><button id="cloud-passkey-add">Add a passkey</button></div>
  <p class="cloud-subhead">Your rooms</p><ul id="cloud-my-rooms" class="cloud-list"></ul><div class="cloud-actions"><button id="cloud-rooms-refresh">Refresh rooms</button></div></div>
</details>
<details class="cloud-section" id="cloud-access-section"><summary>People & access</summary>
 <p>Your role: <strong id="cloud-role">Not connected</strong></p>
 <p id="cloud-workspace" hidden>Workspace: <strong id="cloud-workspace-name"></strong> · members of this workspace reach the room</p>
 <ul id="cloud-members" class="cloud-list"></ul>
 <div id="cloud-owner-tools" hidden>
  <label>Invite by email<input id="cloud-member-email" type="email" placeholder="teammate@studio.com"></label>
  <div class="cloud-row"><select id="cloud-member-role" aria-label="Role for the invited person"><option value="editor">Editor</option><option value="commenter">Commenter</option><option value="viewer">Viewer</option><option value="owner">Owner</option></select><button id="cloud-member-add">Invite</button></div>
  <p class="cloud-subhead">Links</p><ul id="cloud-links" class="cloud-list"></ul>
  <div class="cloud-row"><select id="cloud-link-role" aria-label="Role for the new link"><option value="viewer">Viewer</option><option value="commenter">Commenter</option><option value="editor">Editor</option><option value="owner">Owner</option></select><button id="cloud-link-create">Create link</button></div>
  <input id="cloud-link-output" readonly aria-label="New link" hidden>
  <div class="cloud-actions"><button id="cloud-rotate">Rotate all links</button></div>
  <div class="cloud-row" id="cloud-move-row" hidden><select id="cloud-move-organization" aria-label="Workspace to move this room to"></select><button id="cloud-move">Move to workspace</button></div>
 </div>
 <div class="cloud-actions"><button id="cloud-claim" hidden>Add this room to my account</button><button id="cloud-access-refresh">Refresh</button></div>
</details>
<details class="cloud-section" id="cloud-comments-section"><summary>Comments</summary>
 <ul id="cloud-comments" class="cloud-list"></ul>
 <label>Comment<textarea id="cloud-comment-text" rows="2" maxlength="4000" placeholder="Comment on the selected layer"></textarea></label>
 <div class="cloud-actions"><button id="cloud-comment-send">Post comment</button></div>
</details>
<details class="cloud-section" id="cloud-app-section"><summary>Publish app</summary>
 <p id="cloud-app-project">Open a code project to publish its built web app.</p>
 <label>App name<input id="cloud-app-name" maxlength="63" placeholder="my-site"></label>
 <label>Output folder<input id="cloud-app-output" maxlength="200" placeholder="Detected after build (dist, build, out)"></label>
 <div class="cloud-actions"><button id="cloud-app-publish">Build & publish</button><button id="cloud-app-unpublish">Unpublish app</button></div>
 <p id="cloud-app-status" role="status"></p><a id="cloud-app-url" target="_blank" rel="noopener noreferrer"></a>
 <ul id="cloud-app-versions" class="cloud-list"></ul>
</details>
</dialog><span id="cloud-presence"></span>`;
  document.body.append(root);
  const $ = (id) => document.getElementById(id);

  // Room state. `confirmed` is the server document; `pending` holds local operation batches
  // not yet acknowledged. The editor shows confirmed + pending.
  let connection = null,
    socket = null,
    revision = 0,
    protocol = 1,
    role = null,
    applying = false;
  let confirmed = null,
    retained = [],
    pending = [],
    batchNumber = 0,
    clientId = "",
    clock = null,
    rotating = false;
  let legacyPending = false,
    inflight = null,
    conflict = false,
    timer,
    retryTimer,
    unsub,
    lazySocket = false,
    generation = 0,
    joinRequest = 0,
    retries = 0,
    lastLocal = "",
    lastLocalDoc = null,
    submitted = "";
  // B6: the signed-in account is not yet a member of the open room (from its access list).
  let claimable = false;
  let peerList = [],
    selfId = null,
    lastPointerAt = 0,
    cursor = null,
    app = null;
  const status = (text) => {
    $("cloud-status").textContent = text;
    // Size limits (web/storage-limits.js): server refusals become the size island's blocking error.
    if (window.storageLimits?.isSizeError(text))
      window.storageLimits.reportError(String(text), "sync");
  };
  const action = (fn) => async () => {
    let epoch = generation;
    try {
      const operation = fn();
      epoch = generation;
      await operation;
    } catch (e) {
      if (epoch === generation) status(e.message);
    }
  };
  const canEdit = () => role === "owner" || role === "editor";
  // Role and presence changes for the Share popover's state event (web/cloud-share.js).
  const stateChanged = () => window.dispatchEvent(new Event("cloud-panel-state"));
  const randomId = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(9)), (n) => n.toString(36).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  const shared = (doc) => {
    const copy = { ...doc };
    for (const key of LOCAL_KEYS) delete copy[key];
    return JSON.stringify(copy);
  };

  // ---- presence -------------------------------------------------------------------------------
  // Presence UI (avatars, cursors, selections, Multiplayer tools) lives in web/src/islands/collab: it receives the
  // room state here and shapes the outgoing presence message. Without it, the plain cursor labels below are drawn.
  const presenceState = () => ({
    connected: !!connection,
    server: connection?.server || null,
    roomId: connection?.id || null,
    fileId: connection?.fileId || null,
    role,
    selfId,
    peers: peerList,
  });
  function drawPeers() {
    if (window.cloudPresence) return window.cloudPresence.sync(presenceState());
    document.getElementById("cloud-cursors")?.remove();
    const canvas = document.getElementById("canvas");
    if (!canvas || !connection) return;
    const overlay = document.createElement("div");
    overlay.id = "cloud-cursors";
    Object.assign(overlay.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147483646",
    });
    const activePage = window.design.getDocument().activePage;
    for (const peer of peerList) {
      if (peer.id === selfId || !peer.cursor || (peer.pageId && peer.pageId !== activePage))
        continue;
      const marker = document.createElement("div");
      marker.className = "collaborator-cursor";
      marker.dataset.peer = peer.id;
      marker.textContent = "↖ " + peer.name;
      Object.assign(marker.style, {
        position: "absolute",
        left: peer.cursor.x + "px",
        top: peer.cursor.y + "px",
        color: "#fff",
        background: "#6953c9",
        padding: "3px 6px",
        borderRadius: "4px",
        font: "12px system-ui",
        whiteSpace: "nowrap",
      });
      overlay.append(marker);
    }
    canvas.append(overlay);
  }
  function sendPresence() {
    if (socket?.readyState !== WebSocket.OPEN) return;
    const base = {
      type: "presence",
      name: presenceName(),
      cursor,
      pageId: window.design.getDocument().activePage,
    };
    // null: "Go invisible" sends nothing (collab/presence-engine.ts).
    const message = window.cloudPresence ? window.cloudPresence.message(base) : base;
    if (message) socket.send(JSON.stringify(message));
  }
  // Signed in, collaborators see the account's name unless one was typed here (contract §2: never "Designer NNN").
  let nameEdited = false;
  const presenceName = () =>
    (!nameEdited && (account?.account.displayName || account?.account.email)) ||
    $("cloud-name").value.trim() ||
    "Designer";
  $("cloud-name").value = "Designer " + Math.floor(Math.random() * 900 + 100);
  $("cloud-name").onchange = () => {
    nameEdited = true;
    sendPresence();
  };
  window.addEventListener("cloud-account-changed", () => sendPresence());
  // The whole canvas area, not only the board: cursors follow the pointer anywhere on the page.
  const canvasArea = document.getElementById("workspace") || document.getElementById("canvas");
  canvasArea.addEventListener("pointermove", (event) => {
    if (!connection) return;
    // World coordinates (the #canvas layer's own px), the space cursors are drawn in.
    cursor = window.design.screenToWorld(event.clientX, event.clientY);
    if (Date.now() - lastPointerAt > 80) {
      lastPointerAt = Date.now();
      sendPresence();
    }
  });
  canvasArea.addEventListener("pointerleave", () => {
    cursor = null;
    sendPresence();
  });

  // ---- HTTP -----------------------------------------------------------------------------------
  function base() {
    const u = new URL($("cloud-server").value || location.origin);
    if (!["http:", "https:"].includes(u.protocol)) throw Error("Use an HTTP or HTTPS server URL");
    if (u.username || u.password) throw Error("Credentials do not belong in the server URL");
    return u.origin;
  }
  $("cloud-server").value = location.protocol.startsWith("http") ? location.origin : "";
  // Desktop (app://, no HTTP origin): the production service, or VERYNIZE_CLOUD_SERVER in tests
  // (desktop/cloud-defaults.cjs), unless a saved account, preference or room already set it.
  if (!$("cloud-server").value && window.verynizePlatform.can("cloudDefaults"))
    window.desktop
      .cloudDefaults()
      .then(({ server }) => {
        if (!$("cloud-server").value && server) $("cloud-server").value = server;
      })
      .catch(() => {});
  const loadAccount = () => {
    try {
      const value = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "null");
      // Legacy directory sessions (passkeys) or Better Auth bearer tokens (email + password).
      return value && SESSION_TOKEN.test(value.session) ? value : null;
    } catch {
      return null;
    }
  };
  let account = loadAccount();
  if (account && !$("cloud-server").value) $("cloud-server").value = account.server;
  const sessionFor = (server) => (account && account.server === server ? account.session : null);
  async function request(path, options = {}, info = connection) {
    const server = info?.server || base();
    const session = info?.session === false ? null : sessionFor(server);
    const response = await fetch(server + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(info?.token ? { Authorization: `Bearer ${info.token}` } : {}),
        ...(session ? { "X-Verynize-Session": session } : {}),
        ...options.headers,
      },
    });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      const e = new Error(
        response.status === 409 && data?.document
          ? "Shared document changed; resolve the conflict below."
          : data?.error || data?.message || `Server returned ${response.status}`,
      );
      e.status = response.status;
      e.data = data;
      throw e;
    }
    return data;
  }
  // Owners share a role-limited link (web/cloud-invite.js), never their own owner token. Others
  // share the link they joined with, or a token-free link that opens for account members. Servers
  // without roles (protocol 1) have a single room token, which stays the invite.
  const sharesLinks = () => role === "owner" && protocol >= 2;
  function updateInvite() {
    const owner = sharesLinks();
    $("cloud-invite-role").hidden = !owner;
    $("cloud-invite").value = window.cloudInvites.url(connection, owner ? null : connection.token);
    // Errors surface on Copy invite, which asks again.
    if (owner && $("cloud-dialog").open) shareInvite().catch(() => {});
  }
  async function shareInvite() {
    const info = connection;
    if (!info || !sharesLinks()) return $("cloud-invite").value;
    const href = await window.cloudInvites.create(
      info,
      $("cloud-invite-role").value,
      (path, options) => request(path, options, info),
    );
    if (connection?.id === info.id && connection.server === info.server && sharesLinks())
      $("cloud-invite").value = href;
    return href;
  }
  $("cloud-invite-role").onchange = () => {
    if (connection) updateInvite();
  };

  // ---- legacy snapshot protocol (servers without operation support) ---------------------------
  function markConflict() {
    conflict = true;
    $("cloud-conflict").hidden = false;
    status("Concurrent edits need your choice. Local work has been retained.");
  }
  function apply(doc, remote = false) {
    applying = true;
    try {
      const prior = lastLocalDoc;
      // Collaborators' edits are patched in node by node (web/remote-apply.js): a gesture, the selection and the
      // caret survive them, and the nodes a gesture holds keep their pre-gesture state here until it ends.
      const held = remote ? window.remoteApply?.apply(doc) : null;
      if (held)
        lastLocalDoc = window.remoteApply.baseline(window.design.getDocument(), prior, held);
      else {
        const selection = window.design.getSelection?.() || [];
        window.design.setDocument(doc);
        if (selection.length && window.design.setSelection) window.design.setSelection(selection);
        lastLocalDoc = window.design.getDocument();
      }
      lastLocal = shared(lastLocalDoc);
      drawPeers();
    } finally {
      applying = false;
    }
  }
  function receiveSnapshot(message) {
    if (!message.document || message.revision <= revision) return;
    const remote = JSON.stringify(message.document),
      local = JSON.stringify(window.design.getDocument());
    if (remote === local || remote === submitted) {
      revision = message.revision;
      return;
    }
    if (legacyPending || inflight) {
      markConflict();
      return;
    }
    revision = message.revision;
    apply(message.document);
    status(`Synced revision ${revision}`);
  }
  async function flush() {
    if (protocol >= 2) return flushOps();
    if (inflight) return inflight;
    if (!legacyPending || conflict || !connection) return;
    const epoch = generation,
      info = connection,
      doc = window.design.getDocument();
    submitted = JSON.stringify(doc);
    legacyPending = false;
    inflight = (async () => {
      try {
        const result = await request(
          `/api/rooms/${info.id}`,
          { method: "PUT", body: JSON.stringify({ document: doc, baseRevision: revision }) },
          info,
        );
        if (epoch !== generation) return;
        revision = Math.max(revision, result.revision);
        status(`Saved shared revision ${revision}`);
      } catch (e) {
        if (epoch !== generation) return;
        legacyPending = true;
        if (e.status === 409) markConflict();
        else status(e.message);
      } finally {
        if (epoch === generation) {
          inflight = null;
          submitted = "";
          if (legacyPending && !conflict) timer = setTimeout(flush, 1000);
        }
      }
    })();
    return inflight;
  }

  // ---- operation protocol ---------------------------------------------------------------------
  /** Editor document = confirmed server state + local unacknowledged operations. */
  function rebuild() {
    if (!confirmed) return;
    // cloud-assets: while held images upload, remote state is applied once they finish.
    if (window.cloudAssets?.holding?.()) return;
    let doc = confirmed;
    for (const batch of pending) doc = Ops.apply(doc, batch.ops).doc;
    if (retained.length) doc = Ops.apply(doc, retained).doc;
    if (Pages.deferredOps().length) doc = Ops.apply(doc, Pages.deferredOps()).doc;
    const current = window.design.getDocument();
    const next = { ...doc };
    if (Ops.isStructured(doc) && doc.pages.some((page) => page.id === current.activePage))
      next.activePage = current.activePage;
    if (shared(next) === shared(current)) {
      lastLocalDoc = current;
      lastLocal = shared(current);
      return;
    }
    try {
      apply(next, true);
    } catch (e) {
      status("Unable to apply shared changes: " + e.message);
    }
  }
  // One in-flight batch keeps a rejected prefix from being overtaken by later edits.
  async function sendPending() {
    if (socket?.readyState !== WebSocket.OPEN || retained.length || pending.some((b) => b.sent))
      return;
    const batch = pending[0];
    if (batch) {
      batch.sent = true;
      const epoch = generation;
      const saved = await saveOutbox(true);
      if (epoch !== generation || !pending.includes(batch)) return;
      if (!saved || socket?.readyState !== WebSocket.OPEN) {
        batch.sent = false;
        if (!saved) status("Unable to save local edits on this device. Keep this window open.");
        return;
      }
      socket.send(
        JSON.stringify({
          type: "ops",
          batch: batch.n,
          ops: batch.ops,
          actor: batch.actor || undefined,
        }),
      );
    }
  }
  function retryRetained() {
    if (!canEdit() || !retained.length || pending.some((b) => b.sent)) return;
    const desired = Ops.apply(confirmed, retained).doc;
    const limits = window.VerynizeRoomLimits;
    if (
      limits.bytes(desired) > limits.DOCUMENT_BYTES ||
      desired.pages?.some((page) => limits.bytes(page) > limits.PAGE_BYTES)
    )
      return;
    const ops = Ops.diff(confirmed, desired, { ignore: LOCAL_KEYS });
    const shrinks = (op) =>
      ["remove", "removePage"].includes(op.t) ||
      (op.t === "text" && limits.bytes(op.value) < limits.bytes(op.base));
    ops.sort((a, b) => Number(!shrinks(a)) - Number(!shrinks(b)));
    retained = [];
    queueOps(ops);
  }
  function queueOps(ops) {
    if (retained.length) {
      const desired = Ops.apply(Ops.apply(confirmed, retained).doc, ops).doc;
      retained = Ops.diff(confirmed, desired, { ignore: LOCAL_KEYS });
      retryRetained();
      void saveOutbox(true);
      return;
    }
    const limits = window.VerynizeRoomLimits;
    const groups = limits.batchOps(ops.map((op) => ({ ...op, s: clock.next() })));
    // Version history: a batch names its editor (an agent, a restore) when it is not the person;
    // batches of different editors never merge (web/version-history.js, cloud/room-history.js).
    const actor = window.versionHistory?.batchActor?.() || null;
    if (!groups) {
      retained = pending.flatMap((b) => b.ops).concat(ops);
      pending = [];
      status("File is too large to sync. Your edits stay on this device.");
    } else
      for (const group of groups) {
        // Edits made while a batch is in flight join the unsent tail, so a drag or typing burst
        // waits for one round trip instead of one per change.
        const last = pending[pending.length - 1],
          size = limits.bytes(group);
        if (
          last &&
          !last.sent &&
          last.size &&
          JSON.stringify(last.actor || null) === JSON.stringify(actor) &&
          last.ops.length + group.length <= 4000 &&
          last.size + size <= limits.MESSAGE_BYTES - 65536
        ) {
          // Repeated edits of one property (a drag, a slider) keep only the newest value.
          last.size += size - window.remoteApply.coalesce(last.ops, group, limits.bytes);
        } else pending.push({ n: ++batchNumber, ops: group, sent: false, size, actor });
      }
    // A fixed interval that later edits do not push back: a burst is sent while it lasts, not after it ends.
    sendSoon();
    // sendPending writes the outbox before each send; this only covers edits waiting behind it.
    void saveOutbox();
  }
  const sendSoon = window.remoteApply.throttle(() => void sendPending());
  // Gestures (web/remote-apply.js): their nodes' changes stream while the pointer moves; remote edits to those nodes
  // wait, and are reconciled from confirmed + pending once the gesture ends.
  window.remoteApply.connect({
    baseline: () => lastLocalDoc,
    stream: (ops) => {
      if (connection && protocol >= 2 && canEdit() && !applying) {
        const local = Pages.splitLocal(ops);
        if (local.length) queueOps(local);
      }
    },
    settle: () => {
      if (connection && protocol >= 2) rebuild();
    },
  });
  function localChange() {
    drawPeers();
    if (applying || !connection) return;
    const now = window.design.getDocument(),
      text = shared(now);
    if (text === lastLocal) return;
    if (protocol < 2) {
      lastLocal = text;
      legacyPending = true;
      clearTimeout(timer);
      timer = setTimeout(flush, 500);
      return;
    }
    if (!canEdit()) {
      status(
        `You are a ${ROLE_LABEL[role]?.toLowerCase() || "guest"} in this room; your edits are not shared.`,
      );
      rebuild();
      return;
    }
    // cloud-assets: embedded images upload first; their URL is sent instead of the data URI.
    if (window.cloudAssets?.hold?.(now, () => (localChange(), rebuild()))) return;
    const changes = Ops.diff(lastLocalDoc, now, { ignore: LOCAL_KEYS });
    const ops = Pages.splitLocal(changes);
    const before = lastLocalDoc;
    lastLocalDoc = now;
    lastLocal = text;
    if (changes.length) recordLocal(before, now);
    if (ops.length) queueOps(ops);
    else if (changes.length) void saveOutbox();
  }

  // ---- collaborative undo ---------------------------------------------------------------------
  // While collaborating, undo/redo step through this client's own changes only. Each step stores
  // the documents around the local change; undoing replays the inverse operations rebased over
  // the remote operations received since: properties, nodes and orders a collaborator changed
  // afterwards are left alone, and text inverses are merged range-wise into the current text.
  const HISTORY_LIMIT = 100,
    COALESCE_MS = 600;
  let undoStack = [],
    redoStack = [],
    remoteSeq = 0;
  const remotePaths = new Map(),
    remoteNodes = new Map();
  function recordLocal(from, to) {
    const last = undoStack[undoStack.length - 1];
    // A gesture (drag, typing) renders many times; consecutive changes with no remote edit in between form one step.
    if (last && last.seq === remoteSeq && Date.now() - last.at < COALESCE_MS && !last.history) {
      last.to = to;
      last.at = Date.now();
    } else {
      undoStack.push({ from, to, seq: remoteSeq, at: Date.now() });
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    }
    redoStack = [];
    refreshHistoryButtons();
  }
  function markRemote(ops) {
    if (!ops.length) return;
    remoteSeq++;
    for (const op of ops) {
      const path = Ops.pathOf(op);
      if (path) remotePaths.set(path, remoteSeq);
      if (op.id && ["add", "remove", "node", "text"].includes(op.t))
        remoteNodes.set(op.id, remoteSeq);
      if ((op.t === "add" || op.t === "addPage") && op.value)
        for (const key of Object.keys(op.value))
          remotePaths.set(
            Ops.pathOf({ ...op, t: op.t === "add" ? "node" : "page", page: op.page || op.id, key }),
            remoteSeq,
          );
    }
  }
  /** Inverse of a step, minus whatever collaborators changed after it. */
  function rebaseInverse(step, current) {
    const touched = (path) => (remotePaths.get(path) || 0) > step.seq;
    const nodeOf = (id) => {
      for (const page of current.pages || []) {
        const node = page.nodes?.find((n) => n.id === id);
        if (node) return node;
      }
      return null;
    };
    return Ops.diff(step.to, step.from, { ignore: LOCAL_KEYS }).filter((op) => {
      if (op.t === "text") {
        const value = nodeOf(op.id)?.[op.key];
        return (
          typeof value === "string" &&
          (value === op.base || Ops.mergeText(op.base, op.value, value) !== null)
        );
      }
      if (op.t === "remove") return (remoteNodes.get(op.id) || 0) <= step.seq;
      return !touched(Ops.pathOf(op));
    });
  }
  function stepHistory(from, to, label) {
    const step = from.pop();
    if (!step) {
      status(`Nothing of yours to ${label}`);
      return;
    }
    const current = window.design.getDocument();
    const ops = rebaseInverse(step, current);
    let next = Ops.apply(current, ops).doc;
    if (Ops.isStructured(next) && next.pages.some((page) => page.id === current.activePage))
      next = { ...next, activePage: current.activePage };
    const changes = Ops.diff(current, next, { ignore: LOCAL_KEYS });
    if (!changes.length) {
      status(`Collaborators already changed everything in that step; nothing to ${label}`);
      refreshHistoryButtons();
      return;
    }
    apply(next, true);
    to.push({ from: current, to: lastLocalDoc, seq: remoteSeq, at: 0, history: true });
    const send = Pages.splitLocal(changes);
    if (send.length) queueOps(send);
    else void saveOutbox();
    status(label === "undo" ? "Undid your last change" : "Redid your change");
    refreshHistoryButtons();
  }
  function refreshHistoryButtons() {
    const undo = document.getElementById("undo"),
      redo = document.getElementById("redo");
    if (!historyActive()) return;
    if (undo) undo.disabled = !undoStack.length;
    if (redo) redo.disabled = !redoStack.length;
  }
  const historyActive = () => !!connection && protocol >= 2 && canEdit() && !!Ops;
  function resetHistory() {
    undoStack = [];
    redoStack = [];
    remoteSeq = 0;
    remotePaths.clear();
    remoteNodes.clear();
  }
  window.cloudHistory = {
    active: historyActive,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undo: () => {
      if (!historyActive()) return false;
      stepHistory(undoStack, redoStack, "undo");
      return true;
    },
    redo: () => {
      if (!historyActive()) return false;
      stepHistory(redoStack, undoStack, "redo");
      return true;
    },
  };
  let pageGenerations = new Map();
  function receiveOps(message) {
    let retryAfterRejection = false;
    for (const page of confirmed?.pages || [])
      if (message.ops?.some((op) => !op.page || op.page === page.id))
        pageGenerations.set(page.id, (pageGenerations.get(page.id) || 0) + 1);
    if (message.client !== clientId && message.ops?.length) markRemote(message.ops);
    if (message.ops?.length) {
      confirmed = Ops.apply(confirmed, Pages.filterRemote(message.ops)).doc;
      pageGenerations = new Map(
        (confirmed?.pages || []).map((page) => [page.id, pageGenerations.get(page.id) || 1]),
      );
      for (const op of message.ops) if (op.s) clock.observe(op.s);
    }
    if (Number.isSafeInteger(message.revision)) revision = Math.max(revision, message.revision);
    if (message.client === clientId) {
      const sizeReason = message.reasons?.find((r) => window.storageLimits?.isSizeError(r?.reason));
      if (
        sizeReason ||
        message.tooLarge ||
        (message.error && window.storageLimits?.isSizeError(message.error))
      ) {
        // A correction may arrive while the rejected batch is still in flight.
        retryAfterRejection = pending.some((batch) => batch.n > message.batch);
        retained = pending.flatMap((batch) => batch.ops).concat(retained);
        pending = [];
      } else pending = pending.filter((batch) => batch.n > message.batch);
      if (message.error) status(message.error);
      else if (sizeReason) status(sizeReason.reason);
      else if (message.rejected)
        status(
          `${message.rejected} change${message.rejected === 1 ? " was" : "s were"} superseded by newer edits`,
        );
      else
        status(
          retained.length
            ? "Edits are not synced; kept on this device until the file fits."
            : `Saved shared revision ${revision}`,
        );
    } else if (message.ops?.length)
      status(
        retained.length
          ? "Edits are not synced; kept on this device."
          : `Synced revision ${revision}`,
      );
    rebuild();
    if (retryAfterRejection) retryRetained();
    void saveOutbox(true);
    sendSoon(); // the next batch waits for the send interval, so a burst goes out in a few batches
  }
  /**
   * Pages fetched on the socket (lazy rooms): each replaces its stub in the confirmed document and
   * in the undo steps, and the edits made on it while it loaded are sent.
   */
  function receivePages(message) {
    for (const id of message.missing || []) Pages.missing(id);
    if (!confirmed || !Ops.isStructured(confirmed)) return;
    const released = [];
    let loaded = false;
    for (const page of message.pages || []) {
      // A page that is loaded already (a repeated request) is newer here than in the message.
      if (!Pages.isUnloaded(page?.id)) continue;
      if (!confirmed.pages.some((item) => item.id === page.id)) {
        Pages.missing(page.id);
        continue;
      }
      confirmed = Pages.fill(confirmed, { ...page, nodes: page.nodes || [] });
      pageGenerations.set(page.id, (pageGenerations.get(page.id) || 0) + 1);
      for (const step of undoStack.concat(redoStack)) {
        step.from = Pages.fill(step.from, page);
        step.to = Pages.fill(step.to, page);
      }
      released.push(...Pages.received(page.id));
      loaded = true;
    }
    if (!loaded) return;
    remoteSeq++; // a loaded page ends the current undo step
    if (released.length && canEdit()) queueOps(released);
    rebuild();
    void saveOutbox();
  }
  /** Ids of the pages this client holds (lazy rooms request these again after a reconnect). */
  const loadedPages = () =>
    Ops.isStructured(confirmed)
      ? confirmed.pages.map((page) => page.id).filter((id) => !Pages.isUnloaded(id))
      : [];
  /** Make sure local operations reached the server (used before publishing). */
  async function flushOps() {
    if (retained.length)
      throw Error("Edits are kept on this device and will sync once the file fits.");
    if (!pending.length || !connection) return;
    const epoch = generation,
      info = connection;
    if (socket?.readyState === WebSocket.OPEN) {
      void sendPending();
      const until = Date.now() + 5000;
      while (pending.length && Date.now() < until && epoch === generation)
        await new Promise((resolve) => setTimeout(resolve, 50));
      if (retained.length)
        throw Error("Edits are kept on this device and will sync once the file fits.");
      if (!pending.length || epoch !== generation) return;
    }
    for (const batch of pending.slice()) {
      const result = await request(
        `/api/rooms/${info.id}/ops`,
        {
          method: "POST",
          body: JSON.stringify({
            client: clientId,
            batch: batch.n,
            ops: batch.ops,
            actor: batch.actor || undefined,
          }),
        },
        info,
      );
      if (epoch !== generation) return;
      receiveOps(result);
    }
  }

  async function flushBeforeSwitch() {
    if (!connection) return;
    const until = Date.now() + 15000;
    while (window.cloudAssets?.holding() && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (window.cloudAssets?.holding()) throw Error("Images have not reached the database yet.");
    if (Pages.deferredOps().length) await Pages.ensureAll();
    await flush();
    if (pending.length || legacyPending || conflict)
      throw Error("Changes have not reached the database. Reconnect before switching files.");
  }

  // ---- persistent outbox ----------------------------------------------------------------------
  // Per room (IndexedDB, so the file library's localStorage quota is untouched): this device's
  // client id and batch counter, the unacknowledged batches and the last confirmed document. After a
  // restart or a reconnect the same client id makes the server's `acked` say which batches it
  // applied; the rest are resent. Beyond the limits only the confirmed document is kept and the
  // file's own document is diffed against it again (whole-document fallback).
  const OUTBOX_DB = "verynize-cloud",
    OUTBOX_STORE = "outbox";
  let outboxDb = null,
    outboxTimer = null;
  const roomKey = (info) => `${info.server}|${info.id}`;
  function openOutbox() {
    outboxDb ||= new Promise((resolve, reject) => {
      const request = indexedDB.open(OUTBOX_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(OUTBOX_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(() => null);
    return outboxDb;
  }
  async function outbox(mode, run) {
    const db = await openOutbox();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(OUTBOX_STORE, mode),
          request = run(tx.objectStore(OUTBOX_STORE));
        tx.oncomplete = () => resolve(request.result ?? null);
        tx.onerror = tx.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  const readOutbox = (key) => outbox("readonly", (store) => store.get(key));
  const clearOutbox = (key) => outbox("readwrite", (store) => store.delete(key));
  function outboxState() {
    if (!connection || protocol < 2 || !confirmed || !clientId) return null;
    const batches = pending.map((batch) => ({ n: batch.n, ops: batch.ops, actor: batch.actor }));
    return {
      server: connection.server,
      id: connection.id,
      clientId,
      batch: batchNumber,
      pending: batches,
      retained,
      overflow: false,
      confirmed,
      revision,
      role,
      pages: Pages.stored(),
      savedAt: Date.now(),
    };
  }
  /** Persist the outbox soon (or now): every queued batch, acknowledgement and remote change. */
  function saveOutbox(now = false) {
    clearTimeout(outboxTimer);
    outboxTimer = null;
    if (!connection) return;
    const write = () => {
      outboxTimer = null;
      const state = outboxState();
      if (state) return outbox("readwrite", (store) => store.put(state, roomKey(state)));
    };
    if (now) return write();
    else outboxTimer = setTimeout(write, 150);
  }
  window.addEventListener("pagehide", () => {
    if (outboxTimer) void saveOutbox(true);
  });
  const library = () => window.fileLibrary || null;
  /** Mark the room's library record as detached (left, revoked) and forget its stored outbox. */
  function forgetRoom(info) {
    if (!info) return;
    // Leaving or losing access must not erase the only durable copy of rejected edits.
    if (retained.length || pending.length) void saveOutbox(true);
    else void clearOutbox(roomKey(info));
    const lib = library(),
      id = info.fileId || lib?.findCloud?.(info.server, info.id),
      cloud = id && lib?.cloudOf?.(id);
    if (cloud) lib.setCloud(id, { ...cloud, detached: true });
  }

  // ---- connection -----------------------------------------------------------------------------
  /** `leave` ends this file's link to the room (Disconnect, revocation); otherwise the file stays cloud-backed. */
  function disconnect(message = "Disconnected. Local design retained.", leave = false) {
    if (connection && confirmed) {
      const cacheKey = window.switchCache.key(connection);
      if (leave) window.switchCache.remove(cacheKey);
      else
        window.switchCache.put(cacheKey, confirmed, {
          revision,
          pageGenerations: Object.fromEntries(pageGenerations),
          unloaded: Pages.unloadedIds(),
          pinned: retained.length > 0 || pending.length > 0 || Pages.deferredOps().length > 0,
        });
    }
    if (outboxTimer && !leave) void saveOutbox(true);
    if (leave) forgetRoom(connection);
    // Leaving drops a matching #room= invite fragment, which the shell router otherwise keeps.
    if (leave && connection) window.shellNavigation?.clearRoomHash?.(connection.id);
    generation++;
    resetHistory();
    clearTimeout(timer);
    clearTimeout(retryTimer);
    sendSoon.cancel();
    unsub?.();
    unsub = null;
    const old = socket;
    socket = null;
    if (old) {
      old.onclose = null;
      old.close();
    }
    connection = null;
    lazySocket = false;
    Pages.attach(null);
    peerList = [];
    selfId = null;
    role = null;
    confirmed = null;
    pageGenerations.clear();
    pending = [];
    retained = [];
    drawPeers();
    legacyPending = false;
    inflight = null;
    submitted = "";
    conflict = false;
    retries = 0;
    $("cloud-conflict").hidden = true;
    $("cloud-presence").textContent = "";
    renderAccess(null);
    status(message);
    roomChanged();
  }
  /**
   * `cloud-access-revoked` (detail {reason, roomId, fileName}): this account lost access to the open room (removed,
   * made private, link revoked). Returns the dispatcher so callers name the file before the room is left.
   */
  function accessEnded(reason, fileId = connection?.fileId) {
    const file =
      fileId &&
      library()
        ?.list?.()
        .find((f) => f.id === fileId);
    const detail = {
      reason: reason || "removed",
      roomId: connection?.id || null,
      fileName: file?.name || window.design.getDocument().name || "Untitled",
    };
    return () => window.dispatchEvent(new CustomEvent("cloud-access-revoked", { detail }));
  }
  /** `cloud-room-changed`: the open room changed (joined, left); detail = window.cloudWorkspace.room(). */
  function roomChanged() {
    window.dispatchEvent(
      new CustomEvent("cloud-room-changed", {
        detail: connection ? { server: connection.server, id: connection.id } : null,
      }),
    );
  }
  function scheduleReconnect(epoch) {
    if (epoch !== generation || !connection) return;
    clearTimeout(retryTimer);
    const delay = Math.min(15000, 500 * 2 ** Math.min(retries++, 5));
    status(`Live connection interrupted. Reconnecting in ${Math.ceil(delay / 1000)}s…`);
    retryTimer = setTimeout(() => openSocket(epoch), delay);
  }
  function openSocket(epoch, quiet = false) {
    if (epoch !== generation || !connection) return;
    const info = connection,
      url = new URL(`/api/rooms/${info.id}/socket`, info.server);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (info.token) url.searchParams.set("token", info.token);
    if (clientId) url.searchParams.set("client", clientId);
    url.searchParams.set("lazy", "1");
    const session = sessionFor(info.server);
    if (session) url.searchParams.set("session", session);
    const ws = new WebSocket(url);
    socket = ws;
    lazySocket = false;
    ws.onopen = () => {
      if (epoch !== generation || ws !== socket) {
        ws.close();
        return;
      }
      const reconnected = retries > 0;
      retries = 0;
      sendPresence();
      if (!conflict && !quiet && reconnected) status(`Connected · revision ${revision}`);
    };
    ws.onmessage = (event) => {
      if (epoch !== generation || ws !== socket) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === "welcome") {
          selfId = message.id;
          if (message.role) setRole(message.role);
          // Lazy rooms send their snapshot after `sync`: the pages held here, or the active one.
          if (message.lazyPages) {
            lazySocket = true;
            const active = window.design.getView?.().page;
            const pages = loadedPages();
            ws.send(
              JSON.stringify({
                type: "sync",
                pages: pages.length ? pages : active ? [active] : [],
                ...(confirmed ? { revision } : {}),
              }),
            );
          }
          return;
        }
        if (message.type === "presence") {
          peerList = message.peers || [];
          $("cloud-presence").textContent = `${peerList.length} connected`;
          drawPeers();
          stateChanged();
          return;
        }
        if (message.type === "snapshot") {
          if (protocol < 2) return receiveSnapshot(message);
          let released = [];
          // `same`: the room is still at this client's revision, so its document stands.
          if (!message.same) {
            if (confirmed)
              markRemote(Ops.diff(confirmed, message.document, { ignore: LOCAL_KEYS }));
            confirmed = message.document;
            pageGenerations = new Map(
              (confirmed?.pages || []).map((page) => [
                page.id,
                (pageGenerations.get(page.id) || 0) + 1,
              ]),
            );
            released = Pages.reset(message.unloaded || [], message.pages);
          }
          revision = message.revision;
          // New servers report rejected receipts durably. With older servers an unknown
          // acknowledged outcome is conservatively retained rather than losing authored work.
          const rejected = message.rejectedBatches;
          const uncertain = pending.filter(
            (b) =>
              b.n <= (message.acked || 0) && (!Array.isArray(rejected) || rejected.includes(b.n)),
          );
          retained = uncertain.flatMap((b) => b.ops).concat(retained);
          pending = pending.filter((batch) => batch.n > (message.acked || 0));
          if (retained.length) {
            retained = retained.concat(pending.flatMap((b) => b.ops));
            pending = [];
          }
          for (const batch of pending) batch.sent = false;
          if (released.length && canEdit()) queueOps(released);
          rebuild();
          window.dispatchEvent(new CustomEvent("cloud-hydrated", { detail: { epoch } }));
          retryRetained();
          if (retained.length)
            status("Edits are not synced; kept on this device until the file fits.");
          void sendPending();
          Pages.resume();
          void saveOutbox();
          return;
        }
        if (message.type === "pages") return receivePages(message);
        if (message.type === "ops") return receiveOps(message);
        if (message.type === "role") {
          setRole(message.role);
          status(`Your role changed to ${ROLE_LABEL[message.role]}`);
          return;
        }
        if (message.type === "revoked") {
          if (!rotating) {
            const ended = accessEnded(message.reason);
            disconnect("Your access to this room was revoked. Local design retained.", true);
            ended();
          }
          return;
        }
        if (message.type === "comment") {
          addComment(message.comment, true);
          return;
        }
        if (message.type === "conflict") markConflict();
        else if (message.type === "error") status(message.error);
      } catch (e) {
        status("Unable to apply remote document: " + e.message);
      }
    };
    ws.onclose = () => {
      if (ws === socket) scheduleReconnect(epoch);
    };
    ws.onerror = () => {
      if (epoch === generation && ws === socket)
        status("Live connection unavailable; changes will retry.");
    };
  }
  /**
   * Open a room as a file. `load` opens the room's library record (creating it on first join, or
   * reusing the open one); without it the current file becomes the room's record (Create room).
   * A stored outbox is restored, and when the server is unreachable the file opens offline.
   */
  // The user-initiated room open in progress: opening the same room again joins it.
  let connecting = null;
  async function connect(info, load = true, expected, baseline = null) {
    if (connection?.id === info.id && connection?.server === info.server && expected === undefined)
      return;
    const coordinator = window.switchCoordinator;
    const own = !info.switchToken;
    const state = coordinator.getState();
    if (
      own &&
      connecting?.id === info.id &&
      connecting.server === info.server &&
      state?.token === connecting.token &&
      ["begin", "ready"].includes(state.phase)
    )
      return connecting.promise;
    let origin = info.server;
    try {
      origin = new URL(info.server).origin;
    } catch {}
    const knownFile = library()?.findCloud?.(origin, info.id) || null;
    // Opened from Files (a room link, a listed room): show the editor and its loading cover at once,
    // under the file's URL (or the room's, until its library file exists). Not over Settings: a link
    // opened there keeps Settings until the room has loaded.
    const body = document.body.classList;
    const fromHome =
      own &&
      load &&
      expected === undefined &&
      body.contains("files-view") &&
      !body.contains("settings-open");
    if (fromHome)
      window.shellRequest({ view: "/editor/" + encodeURIComponent(knownFile || info.id) }, () =>
        library()?.applyEditor?.(),
      );
    const switchToken =
      info.switchToken ||
      coordinator.begin({
        kind: "file",
        reason: fromHome ? "home" : undefined,
        room: info.id,
        from: { fileKey: library()?.currentId, pageId: window.design.getView().page },
        to: { fileKey: knownFile, pageId: null },
      });
    const current = () =>
      coordinator.getState()?.token === switchToken &&
      !["cancel", "fail", "end"].includes(coordinator.getState()?.phase);
    const run = async () => {
      try {
        if (fromHome) await coordinator.paint();
        if (!current()) return;
        await connectCore({ ...info, switchToken }, load, expected, baseline);
        if (
          coordinator.getState()?.token === switchToken &&
          coordinator.getState()?.info?.freshness !== "confirmed"
        )
          coordinator.rendered(switchToken, {
            fileKey: library()?.currentId,
            pageId: window.design.getView().page,
            freshness: "confirmed",
          });
      } catch (error) {
        const active = current();
        coordinator.fail(switchToken, error);
        // Back to Files, replacing the failed editor entry; the caller reports the error.
        if (fromHome && active) {
          if (window.shellNavigation)
            window.shellNavigation.request({ view: "/" }, { replace: true });
          else library()?.showHome?.();
        }
        throw error;
      } finally {
        if (own) coordinator.finish(switchToken);
        if (connecting?.token === switchToken) connecting = null;
      }
    };
    const promise = run();
    if (own) connecting = { server: info.server, id: info.id, token: switchToken, promise };
    return promise;
  }
  async function connectCore(info, load = true, expected, baseline = null) {
    const switchToken = info.switchToken;
    const requestId = ++joinRequest;
    if (info.storeOutgoing && account)
      await window.cloudWorkspace.storeFile?.(library()?.currentId);
    if (expected === undefined) await flushBeforeSwitch();
    if (requestId !== joinRequest) return;
    const u = new URL(info.server);
    const lib = library();
    let fileId = lib?.findCloud?.(u.origin, info.id) || null;
    const record = fileId ? lib.cloudOf(fileId) : null;
    const token = info.token || record?.token || null;
    const session = sessionFor(u.origin);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      !/^[0-9a-f-]{36}$/.test(info.id) ||
      (token ? !/^[0-9a-f]{64}$/.test(token) : !session && !info.anonymous)
    )
      throw Error(
        token || session ? "Invalid room invite" : "Sign in to open a room without a link token",
      );
    info = { id: info.id, token, server: u.origin };
    if (expected !== undefined && expected !== generation) return;
    if (expected === undefined) status("Opening file…");
    let epoch = generation;
    // Joining loads the active page first (the rest arrives on the socket). Create room keeps the
    // open document, and a detached copy is compared with the whole room, so both read it all.
    const lazy = load && !record?.detached;
    window.switchCoordinator.phase(switchToken, "flush");
    const cached =
      load && !record?.detached ? window.switchCache.get(window.switchCache.key(info)) : null;
    let releasePresentation = null;
    if (cached) {
      releasePresentation = window.design.presentDocument(cached.document);
      document.getElementById("workspace").inert = true;
      window.switchCoordinator.rendered(switchToken, {
        fileKey: fileId,
        pageId: cached.document.activePage,
        freshness: "provisional",
      });
    }
    const cancelPresentation = (event) => {
      if (event.detail.token === switchToken && event.detail.phase === "cancel") {
        releasePresentation?.();
        document.getElementById("workspace").inert = false;
      }
    };
    window.addEventListener("switch-loading-change", cancelPresentation);
    const fetching = Promise.all([
      readOutbox(roomKey(info)),
      request(`/api/rooms/${info.id}${lazy ? "?lazy=1" : ""}`, {}, info).then(
        (value) => ({ value }),
        (error) => ({ error }),
      ),
    ]);
    let stored, fetched;
    try {
      if (cached) {
        await window.switchCoordinator.paint();
        window.switchCoordinator.phase(switchToken, "cachePaint");
      }
      [stored, fetched] = await fetching;
    } finally {
      window.removeEventListener("switch-loading-change", cancelPresentation);
      releasePresentation?.();
      if (window.switchCoordinator.getState()?.token === switchToken)
        document.getElementById("workspace").inert = false;
    }
    if (
      epoch !== generation ||
      requestId !== joinRequest ||
      window.switchCoordinator.getState()?.token !== switchToken ||
      ["cancel", "fail", "end"].includes(window.switchCoordinator.getState()?.phase)
    )
      return;
    let current = fetched.value,
      offline = false;
    if (fetched.error) {
      const e = fetched.error;
      if (fileId && [401, 403, 404].includes(e.status)) {
        // Access ended (revoked, removed, deleted): the local copy stays, detached.
        window.switchCache.remove(window.switchCache.key(info));
        accessEnded("removed", fileId)();
        forgetRoom({ ...info, fileId });
        throw Object.assign(Error(`${e.message}. The local copy of this file is kept.`), {
          status: e.status,
          data: e.data,
        });
      }
      // Unreachable server: a room this device has state for opens offline and reconnects.
      if (e.status || !stored?.confirmed || !fileId) throw e;
      offline = true;
      current = { document: null, revision: stored.revision, role: stored.role, protocol: 2 };
    }
    // Keep the current room connected while fetching the next one. A failed open must not
    // strand subsequent edits in a disconnected editor. Flush edits made during the fetch too.
    if (expected === undefined) {
      await flushBeforeSwitch();
      if (epoch !== generation || requestId !== joinRequest) return;
      disconnect("Connecting…");
      epoch = generation;
    }
    // A detached copy edited since leaving stays a separate local file; the room gets a new record.
    if (load && record?.detached && !offline) {
      const file = lib.list().find((f) => f.id === fileId);
      if (file && shared(file.document) !== shared(current.document)) {
        lib.setCloud(fileId, null);
        fileId = null;
      }
    }
    const cloud = {
      server: info.server,
      roomId: info.id,
      ...(session && account?.server === info.server ? { accountId: account.account.id } : {}),
      ...(info.token ? { token: info.token } : {}),
      role: current.role || "owner",
    };
    let restoreFile = false;
    if (load && fileId) {
      if (lib.currentId !== fileId) {
        await lib.open(fileId, {
          cloudJoinEpoch: epoch,
          switchToken,
          isCurrent: () => epoch === generation && requestId === joinRequest,
        });
        if (epoch !== generation || requestId !== joinRequest) return;
      }
      lib.setCloud(fileId, cloud);
      // With stored state the file's own document is kept and rebased; otherwise the room's loads.
      restoreFile = !!stored?.confirmed || offline;
      load = !restoreFile;
    } else if (load && lib?.createFromDocument) {
      fileId = await lib.createFromDocument(current.document, {
        cloudJoinEpoch: epoch,
        switchToken,
        isCurrent: () => epoch === generation && requestId === joinRequest,
        cloud,
      });
      if (epoch !== generation || requestId !== joinRequest) return;
      load = false;
    } else if (load && window.documentLifecycle) {
      await window.documentLifecycle.prepareSwitch({ cloudJoinEpoch: epoch });
      if (epoch !== generation || requestId !== joinRequest) return;
    } else if (!load && lib?.setCloud && lib.currentId) {
      // Create room: the open file becomes the room's file.
      fileId = lib.currentId;
      lib.setCloud(fileId, cloud);
    }
    connection = { ...info, fileId };
    // Active authority lives outside the disposable inactive-room LRU.
    window.switchCache.remove(window.switchCache.key(info));
    protocol = Number.isSafeInteger(current.protocol) && Ops ? current.protocol : 1;
    const restore = protocol >= 2 && stored?.clientId ? stored : null;
    if (restoreFile && !restore && current.document) load = true;
    clientId = restore ? restore.clientId : randomId();
    clock = Ops ? Ops.createClock(clientId) : null;
    pending = restore
      ? (restore.pending || []).map((batch) => ({
          n: batch.n,
          ops: batch.ops,
          sent: false,
          actor: batch.actor || null,
        }))
      : [];
    retained = restore?.retained || [];
    batchNumber = restore ? restore.batch || 0 : 0;
    for (const batch of pending) for (const op of batch.ops) if (op.s) clock.observe(op.s);
    resetHistory();
    // Restored batches were made on the stored confirmed document. The socket snapshot replaces it
    // and drops the batches the server acknowledged for this client id.
    confirmed = restore ? restore.confirmed : current.document;
    if (restore) Pages.restore(restore.pages);
    else Pages.reset(current.unloaded || [], current.pages);
    Pages.attach({
      online: () => socket?.readyState === WebSocket.OPEN && lazySocket,
      request: (ids) => {
        if (epoch !== generation || socket?.readyState !== WebSocket.OPEN || !lazySocket) return;
        socket.send(JSON.stringify({ type: "pages", ids }));
      },
    });
    setRole(current.role || "owner");
    $("cloud-server").value = info.server;
    updateInvite();
    revision = restore ? restore.revision || 0 : current.revision;
    if (load) apply(current.document);
    lastLocalDoc = window.design.getDocument();
    lastLocal = shared(lastLocalDoc);
    unsub = window.design.subscribe(localChange);
    // Edits made while POST /rooms was in flight must also reach the new room.
    if (baseline && !load && !restore && protocol >= 2 && canEdit()) {
      const changes = Ops.diff(baseline, lastLocalDoc, { ignore: LOCAL_KEYS });
      // Preserve uploaded URLs and replay only edits made while creation was in flight.
      apply(Ops.apply(confirmed, changes).doc);
      lastLocalDoc = confirmed;
      lastLocal = shared(confirmed);
      localChange();
    }
    if (restore && (record?.detached || restore.overflow)) {
      // Only an explicitly detached copy or overflow recovery is an authored file baseline.
      // Edits the file holds beyond confirmed + pending (made while the room was closed, or not yet
      // stored when the app quit) become one more batch.
      let base = confirmed;
      for (const batch of pending) base = Ops.apply(base, batch.ops).doc;
      base = Ops.apply(base, Pages.deferredOps()).doc;
      const ops = Pages.splitLocal(Ops.diff(base, lastLocalDoc, { ignore: LOCAL_KEYS }));
      if (ops.length && canEdit()) queueOps(ops);
    }
    if (restore && !record?.detached && !restore.overflow) rebuild();
    if (protocol >= 2) void saveOutbox(true);
    const hydrated =
      cached && !offline && protocol >= 2
        ? new Promise((resolve) => {
            const done = (event) => {
              if (event.detail.epoch === epoch) {
                clearTimeout(timeout);
                window.removeEventListener("cloud-hydrated", done);
                resolve();
              }
            };
            const timeout = setTimeout(() => {
              // The room is connected and showing fetched state; the socket's own sync
              // finishes freshness, so a slow snapshot ends the switch instead of failing it.
              window.removeEventListener("cloud-hydrated", done);
              resolve();
            }, 15000);
            window.addEventListener("cloud-hydrated", done);
          })
        : null;
    openSocket(epoch);
    roomChanged();
    status(
      offline
        ? "Offline. Edits stay on this device and are sent when the room is reachable."
        : `Connected · revision ${revision}`,
    );
    if (hydrated) await hydrated;
  }
  /** Reconnect a cloud-backed file that was just opened (or reopened after a restart). */
  function reconnectFile(id, cloud) {
    if (!id || !cloud || cloud.detached) return;
    if (connection && connection.id === cloud.roomId && connection.server === cloud.server) return;
    connect({ server: cloud.server, id: cloud.roomId, token: cloud.token }).catch((e) => {
      if (library()?.currentId === id) status(e.message);
    });
  }
  let reconnectPending = false;
  window.addEventListener("library-file-opened", (event) => {
    const detail = event.detail || {};
    reconnectPending = false;
    if (detail.cloudJoinEpoch === undefined) reconnectFile(detail.id, detail.cloud);
  });
  // The open file's room connects when the user works on it: at launch anywhere but the Files home, else once the
  // user leaves the Files home (the Code workspace counts: agents edit the open file there). Opening another file
  // connects through `library-file-opened`.
  const editorHidden = () =>
    location.pathname === "/" || document.body.classList.contains("files-view");
  const reconnectOpenFile = () => {
    const lib = library(),
      id = lib?.currentId;
    if (id) reconnectFile(id, lib.cloudOf?.(id));
  };
  new MutationObserver(() => {
    if (!reconnectPending || editorHidden()) return;
    reconnectPending = false;
    // A Home click owns the destination load; do not reconnect the outgoing room.
    const switching = window.switchCoordinator.getState();
    if (switching?.kind === "file" && ["begin", "ready"].includes(switching.phase)) return;
    reconnectOpenFile();
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("DOMContentLoaded", () => {
    if (new URLSearchParams(location.hash.slice(1)).has("room")) return;
    // At launch the shell router has not applied the URL yet, so the Files home path counts too.
    if (editorHidden()) reconnectPending = true;
    else reconnectOpenFile();
  });
  window.cloudWorkspace = {
    flush: flushBeforeSwitch,
    storeDocument: (document) => storeDocument(document),
    readFile: (cloud) =>
      request(
        `/api/rooms/${cloud.roomId}`,
        {},
        { server: cloud.server, id: cloud.roomId, token: cloud.token },
      ),
    renameFile: async (cloud, name) => {
      const client = randomId();
      const result = await request(
        `/api/rooms/${cloud.roomId}/ops`,
        {
          method: "POST",
          body: JSON.stringify({
            client,
            batch: 1,
            ops: [{ t: "doc", key: "name", value: name, s: Ops.createClock(client).next() }],
          }),
        },
        { server: cloud.server, id: cloud.roomId, token: cloud.token },
      );
      if (result.rejected) throw Error("The file could not be renamed.");
      window.dispatchEvent(new CustomEvent("cloud-files-changed"));
    },
    attachRoom: (info, baseline) =>
      connect(
        { server: info.server, id: info.roomId, token: info.token },
        false,
        undefined,
        baseline,
      ),
    disconnect: () => disconnect(undefined, true),
    isConnected: () => !!connection,
    /** The open room ({server, id, fileId}) or null. */
    room: () =>
      connection
        ? { server: connection.server, id: connection.id, fileId: connection.fileId }
        : null,
    /**
     * Open a room as a file (Files home, links): its library record, created on first open. `anonymous` opens a
     * public room without a token or session (read-only).
     */
    openRoom: async (info) => {
      return connect({
        storeOutgoing: true,
        server: info.server,
        id: info.id,
        token: info.token,
        anonymous: !!info.anonymous,
        switchToken: info.switchToken,
      });
    },
    /** Room state for the presence UI (web/src/islands/collab), and a presence update after a local change. */
    presence: presenceState,
    sendPresence: () => sendPresence(),
    /** True when a session for `server` exists (a room link without a token can open). */
    hasSession: (server) => !!sessionFor(server),
    /** Unacknowledged local batches of the open room. */
    pendingCount: () => pending.length + Number(retained.length > 0),
    /** Lazy pages of the open room: {unloaded, requested, deferred} (web/page-loader.js). */
    pages: () => Pages.state(),
    /** The stored outbox of a room (client id, batches, confirmed document), for diagnostics. */
    storedOutbox: (server, id) => readOutbox(roomKey({ server, id })),
    role: () => role,
    account: () => (account ? { ...account.account } : null),
    // cloud-assets (web/cloud-assets.js): the connected room and authenticated room requests.
    request: (path, options) => request(path, options),
    // Share popover (web/cloud-share.js builds ensureRoom/access/setVisibility/invite/shareLink on these).
    createRoom: (server) => createRoom(server),
    /** The connection settings' server (the field in the legacy dialog), or "". */
    server: () => {
      try {
        return base();
      } catch {
        return "";
      }
    },
    /** Live presence of the open room: the server's peers and this socket's id. */
    peers: () => ({ selfId, peers: peerList.slice() }),
    /** The legacy "Shared design" dialog (Settings › Share a design). */
    openDialog: () => openDialog(),
  };
  window.addEventListener("beforeunload", (event) => {
    if (!pending.length && !legacyPending) return;
    event.preventDefault();
    event.returnValue = "Changes have not reached the database yet.";
  });
  window.addEventListener("document-will-change", (event) => {
    if (event.detail?.cloudJoinEpoch !== generation) disconnect();
  });

  function openDialog() {
    if (!$("cloud-dialog").open) $("cloud-dialog").showModal();
    renderAccount();
    if (connection) updateInvite();
    updateActions();
  }
  $("cloud-toggle").onclick = openDialog;
  $("cloud-close").onclick = () => $("cloud-dialog").close();
  /** Create a room from the open file in the active workspace; it becomes the room's file. */
  async function createRoom(server = base()) {
    if (connection) throw Error("Disconnect before creating another room");
    disconnect("Creating room…");
    const epoch = generation,
      document = window.design.getDocument(),
      create = (document) =>
        request(
          "/api/rooms",
          {
            method: "POST",
            body: JSON.stringify({
              document,
              // Email accounts create rooms in the workspace chosen in the file browser.
              ...(account?.server === server &&
              !account.session.startsWith("vs_") &&
              activeOrganization()
                ? { organizationId: activeOrganization() }
                : {}),
            }),
          },
          { server },
        ),
      // Embedded binaries are uploaded as room assets first (web/cloud-assets.js createRoom).
      result = window.cloudAssets
        ? await window.cloudAssets.createRoom(document, {
            server,
            create,
            request: (path, options, room) => request(path, options, { server, ...room }),
            progress: status,
          })
        : await create(document);
    if (epoch !== generation) return null;
    await connect({ server, id: result.id, token: result.token }, false, epoch, document);
    return connection && connection.id === result.id ? { server, id: result.id } : null;
  }
  /** Create a database file without changing whichever document is currently open. */
  async function storeDocument(document) {
    if (!account) throw Error("Sign in to save files to the database.");
    const identity = account;
    const server = identity.server;
    const send = (path, options, room = {}) => {
      if (account?.session !== identity.session || account?.server !== server)
        throw Error("The cloud account changed");
      return request(path, options, { server, ...room });
    };
    const create = (document) =>
      send("/api/rooms", {
        method: "POST",
        body: JSON.stringify({
          document,
          ...(activeOrganization() ? { organizationId: activeOrganization() } : {}),
        }),
      });
    const result = window.cloudAssets
      ? await window.cloudAssets.createRoom(document, {
          server,
          create,
          request: send,
          progress: status,
        })
      : await create(document);
    if (account?.session !== identity.session || account?.server !== server)
      throw Error("The cloud account changed");
    window.dispatchEvent(new CustomEvent("cloud-files-changed"));
    return { server, roomId: result.id, token: result.token, role: "owner" };
  }
  $("cloud-create").onclick = action(() => createRoom());
  // B9: Join invite only where it does something: always before joining, otherwise for another room's link.
  function joinable() {
    if (!connection) return true;
    try {
      const u = new URL($("cloud-invite").value),
        id = new URLSearchParams(u.hash.slice(1)).get("room");
      return !!id && (id !== connection.id || u.origin !== connection.server);
    } catch {
      return false;
    }
  }
  function updateActions() {
    $("cloud-connect").hidden = !joinable();
    $("cloud-leave").hidden = !connection;
  }
  $("cloud-invite").addEventListener("input", updateActions);
  updateActions();
  function parseInvite(input) {
    const u = new URL(input),
      p = new URLSearchParams(u.hash.slice(1));
    if (!p.get("room")) throw Error("Invite must contain a room");
    if (!p.get("token") && !sessionFor(u.origin))
      throw Error(
        "Invite must contain room and token, or sign in to open a room shared with your account",
      );
    return { server: u.origin, id: p.get("room"), token: p.get("token") };
  }
  $("cloud-connect").onclick = action(async () => {
    const input = $("cloud-invite").value;
    if (!input) return;
    const info = parseInvite(input);
    // A room this device already has a file for opens that file; others become a new file.
    if (
      !library()?.findCloud?.(info.server, info.id) &&
      !window.confirm("Open this shared design as a separate file?")
    )
      return;
    await connect(info);
  });
  $("cloud-leave").onclick = action(async () => {
    // The local copy stays as a detached file: load the pages it does not hold yet.
    if (connection && Pages.unloadedIds().length) {
      status("Loading every page before disconnecting…");
      await Pages.ensureAll().catch(() => {});
    }
    disconnect(undefined, true);
  });
  const openLink = (event) => {
    if (window.verynizePlatform.can("externalLinks")) {
      event.preventDefault();
      window.desktop.openExternal(event.currentTarget.href).catch((e) => status(e.message));
    }
  };
  $("cloud-public").onclick = openLink;
  $("cloud-app-url").onclick = openLink;
  $("cloud-copy").onclick = action(async () => {
    const epoch = generation;
    const href = await shareInvite();
    if (epoch !== generation) return;
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      // The desktop denies the clipboard permission (desktop/main.cjs): copy the selected field.
      const input = $("cloud-invite");
      input.value = href;
      input.select();
      if (!document.execCommand("copy")) throw Error("Select the invite link and copy it");
    }
    if (epoch !== generation) return;
    const shared = connection && sharesLinks() ? $("cloud-invite-role").value : null;
    status(
      shared
        ? `Invite copied: people who join can ${shared === "viewer" ? "view" : "edit"}`
        : "Invite copied",
    );
  });
  $("cloud-publish").onclick = action(async () => {
    if (!connection) throw Error("Create or join a room first");
    const epoch = generation,
      info = connection;
    // Edits made on pages that were still loading are sent once those pages arrive.
    if (Pages.deferredOps().length)
      await Pages.ensure(Pages.deferredOps().map((op) => op.page ?? op.id));
    if (epoch !== generation) return;
    await flush();
    if (epoch !== generation) return;
    if (inflight) await inflight;
    if (epoch !== generation) return;
    if (legacyPending || conflict || pending.length || retained.length)
      throw Error("Resolve pending edits before publishing");
    const result = await request(`/api/rooms/${info.id}/publish`, { method: "POST" }, info);
    if (epoch !== generation) return;
    const u = new URL(info.server);
    u.hash = new URLSearchParams({ public: result.publicId }).toString();
    $("cloud-public").href = u.href;
    $("cloud-public").textContent = u.href;
    $("cloud-unpublish").hidden = false;
    window.dispatchEvent(
      new CustomEvent("design-publication-changed", {
        detail: {
          published: true,
          url: u.href,
          publicId: result.publicId,
          revision: result.revision,
        },
      }),
    );
    status(
      sessionFor(info.server)
        ? "Published read-only snapshot and listed it on your profile."
        : "Published read-only snapshot. Anyone with the public link can view it.",
    );
  });
  $("cloud-unpublish").onclick = action(async () => {
    if (!connection) throw Error("Join a room first");
    const epoch = generation,
      info = connection;
    await request(`/api/rooms/${info.id}/publish`, { method: "DELETE" }, info);
    if (epoch !== generation) return;
    $("cloud-public").removeAttribute("href");
    $("cloud-public").textContent = "";
    $("cloud-unpublish").hidden = true;
    window.dispatchEvent(
      new CustomEvent("design-publication-changed", { detail: { published: false } }),
    );
    status("Public snapshot removed");
  });
  $("cloud-reload").onclick = action(async () => {
    if (!connection) throw Error("Join a room first");
    const epoch = generation,
      info = connection;
    if (inflight) await inflight;
    if (epoch !== generation) return;
    const current = await request(`/api/rooms/${info.id}`, {}, info);
    if (epoch !== generation) return;
    legacyPending = false;
    pending = [];
    retained = [];
    confirmed = current.document;
    revision = current.revision;
    apply(current.document);
    conflict = false;
    $("cloud-conflict").hidden = true;
    void saveOutbox();
    status("Loaded shared version");
  });
  $("cloud-overwrite").onclick = action(async () => {
    if (!connection) throw Error("Join a room first");
    const epoch = generation,
      info = connection;
    if (inflight) await inflight;
    if (epoch !== generation) return;
    const current = await request(`/api/rooms/${info.id}`, {}, info);
    if (epoch !== generation) return;
    revision = current.revision;
    conflict = false;
    $("cloud-conflict").hidden = true;
    if (protocol >= 2) {
      confirmed = current.document;
      pending = [];
      retained = [];
      const ops = Ops.diff(current.document, window.design.getDocument(), { ignore: LOCAL_KEYS });
      if (ops.length) queueOps(ops);
      await flushOps();
      return;
    }
    legacyPending = true;
    await flush();
  });

  // ---- roles & access -------------------------------------------------------------------------
  function setRole(next) {
    const previous = role;
    role = next;
    $("cloud-role").textContent = ROLE_LABEL[next] || "Not connected";
    $("cloud-owner-tools").hidden = next !== "owner";
    // B6: only offered once the access list shows the signed-in account is not a member yet.
    $("cloud-claim").hidden = !(
      next === "owner" &&
      connection?.token &&
      sessionFor(connection.server) &&
      claimable
    );
    document.body.classList.toggle("cloud-read-only", !!connection && !!next && !canEdit());
    drawPeers();
    // Only what this role can do: no Create room while in a room, no publishing below editor.
    $("cloud-create").hidden = !!connection;
    $("cloud-publish").hidden = !connection || !canEdit();
    // B9: Unpublish only once there is a snapshot to remove.
    $("cloud-unpublish").hidden =
      !connection || !canEdit() || !$("cloud-public").getAttribute("href");
    updateActions();
    if (connection && next !== previous) updateInvite();
    if (next !== previous) stateChanged();
  }
  function listItem(text, buttons = []) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = text;
    li.append(span);
    for (const [label, handler, extra] of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      if (extra) Object.assign(button.dataset, extra);
      button.onclick = action(handler);
      li.append(button);
    }
    return li;
  }
  function renderAccess(data) {
    const members = $("cloud-members"),
      links = $("cloud-links");
    members.replaceChildren();
    links.replaceChildren();
    claimable = false;
    if (!data) {
      setRole(null);
      return;
    }
    claimable = !!account && !(data.members || []).some((m) => m.accountId === account.account.id);
    setRole(role);
    for (const member of data.members || []) {
      const self = account && member.accountId === account.account.id;
      const buttons = [];
      if (role === "owner") {
        const select = document.createElement("select");
        select.setAttribute("aria-label", `Role for ${member.email}`);
        select.dataset.member = member.email;
        for (const value of ["owner", "editor", "commenter", "viewer"])
          select.append(new Option(ROLE_LABEL[value], value, false, value === member.role));
        select.onchange = action(() => invite(member.email, select.value));
        const li = listItem(`${member.email}${self ? " (you)" : ""}`, [
          ["Remove", () => removeMember(member.accountId), { removeMember: member.email }],
        ]);
        li.insertBefore(select, li.querySelector("button"));
        members.append(li);
        continue;
      }
      if (self) buttons.push(["Leave", () => removeMember(member.accountId)]);
      members.append(
        listItem(`${member.email} · ${ROLE_LABEL[member.role]}${self ? " (you)" : ""}`, buttons),
      );
    }
    if (!members.children.length)
      members.append(listItem("No account members yet. People with a link can still join."));
    // Organization that owns the room (cloud/orgs.js) and, for owners, where it can move.
    $("cloud-workspace").hidden = !data.organization;
    $("cloud-workspace-name").textContent = data.organization?.name || "";
    renderMoveTargets(data.organization?.id || null).catch(() => {});
    for (const link of data.links || [])
      links.append(
        listItem(`${ROLE_LABEL[link.role]} link${link.label ? " · " + link.label : ""}`, [
          ["Revoke", () => revokeLink(link.id), { revokeLink: link.role }],
        ]),
      );
  }
  async function renderMoveTargets(currentId) {
    const row = $("cloud-move-row"),
      select = $("cloud-move-organization");
    const emailSession =
      role === "owner" &&
      account &&
      !account.session.startsWith("vs_") &&
      account.server === connection?.server;
    row.hidden = true;
    if (!emailSession) return;
    const organizations = await request(
      "/api/auth/organization/list",
      {},
      { server: account.server },
    );
    select.replaceChildren(
      ...organizations
        .filter((org) => org.id !== currentId)
        .map((org) => new Option(org.name, org.id)),
    );
    row.hidden = !select.options.length;
  }
  $("cloud-move").onclick = action(async () => {
    if (!connection) throw Error("Create or join a room first");
    const target = $("cloud-move-organization").value;
    if (!target) return;
    const result = await request(`/api/rooms/${connection.id}/organization`, {
      method: "PUT",
      body: JSON.stringify({ organizationId: target }),
    });
    status(`Moved to ${result.organization.name}`);
    await refreshAccess();
  });
  async function refreshAccess() {
    if (!connection) throw Error("Create or join a room first");
    const epoch = generation,
      info = connection;
    const data = await request(`/api/rooms/${info.id}/access`, {}, info);
    if (epoch !== generation) return;
    setRole(data.role);
    renderAccess(data);
  }
  async function invite(email, memberRole) {
    if (!connection) throw Error("Create or join a room first");
    if (!sessionFor(connection.server)) throw Error("Sign in to invite people by email");
    const result = await request(`/api/rooms/${connection.id}/members`, {
      method: "POST",
      body: JSON.stringify({ email, role: memberRole }),
    });
    status(
      `${result.member.email} is now ${ROLE_LABEL[result.member.role].toLowerCase()}${result.emailed ? " and was emailed an invitation" : ""}`,
    );
    await refreshAccess();
  }
  async function removeMember(accountId) {
    await request(`/api/rooms/${connection.id}/members/${accountId}`, { method: "DELETE" });
    if (account && accountId === account.account.id && !connection.token) {
      disconnect("You left the room. Local design retained.", true);
      return;
    }
    await refreshAccess();
  }
  async function revokeLink(id) {
    await request(`/api/rooms/${connection.id}/tokens/${id}`, { method: "DELETE" });
    status("Link revoked");
    await refreshAccess();
  }
  $("cloud-access-refresh").onclick = action(refreshAccess);
  $("cloud-access-section").addEventListener("toggle", () => {
    if ($("cloud-access-section").open && connection)
      refreshAccess().catch((e) => status(e.message));
  });
  $("cloud-member-add").onclick = action(async () => {
    const email = $("cloud-member-email").value.trim();
    if (!email) throw Error("Enter an email address to invite");
    await invite(email, $("cloud-member-role").value);
    $("cloud-member-email").value = "";
  });
  $("cloud-link-create").onclick = action(async () => {
    if (!connection) throw Error("Create or join a room first");
    const info = connection,
      linkRole = $("cloud-link-role").value;
    const result = await request(
      `/api/rooms/${info.id}/tokens`,
      {
        method: "POST",
        body: JSON.stringify({ role: linkRole, label: `${ROLE_LABEL[linkRole]} link` }),
      },
      info,
    );
    const url = new URL(info.server);
    url.hash = new URLSearchParams({ room: info.id, token: result.token }).toString();
    $("cloud-link-output").value = url.href;
    $("cloud-link-output").hidden = false;
    status(`${ROLE_LABEL[linkRole]} link created`);
    await refreshAccess();
  });
  $("cloud-rotate").onclick = action(async () => {
    if (!connection) throw Error("Create or join a room first");
    if (
      !window.confirm(
        "Rotate links? Every existing invite link stops working, including the ones you shared. Account members keep access.",
      )
    )
      return;
    const epoch = generation,
      info = connection;
    rotating = true;
    try {
      const result = await request(`/api/rooms/${info.id}/tokens/rotate`, { method: "POST" }, info);
      if (epoch !== generation) return;
      connection = { ...info, token: result.token };
      window.cloudInvites.forget(info);
      const lib = library(),
        cloud = info.fileId && lib?.cloudOf?.(info.fileId);
      if (cloud) lib.setCloud(info.fileId, { ...cloud, token: result.token });
      updateInvite();
      const old = socket;
      socket = null;
      if (old) {
        old.onclose = null;
        old.close();
      }
      openSocket(epoch, true);
      $("cloud-link-output").hidden = true;
      status(
        `Rotated links: ${result.revoked} old link${result.revoked === 1 ? "" : "s"} revoked. Share the new invite.`,
      );
      await refreshAccess();
    } finally {
      rotating = false;
    }
  });
  $("cloud-claim").onclick = action(async () => {
    if (!connection) throw Error("Create or join a room first");
    await request(`/api/rooms/${connection.id}/claim`, { method: "POST" });
    status("Room added to your account. You can recover it from Account › Your rooms.");
    await refreshAccess();
    await refreshRooms();
  });

  // ---- comments -------------------------------------------------------------------------------
  function addComment(comment, prepend) {
    const list = $("cloud-comments");
    if (list.querySelector(`[data-comment="${CSS.escape(comment.id)}"]`)) return;
    const li = listItem(`${comment.author}: ${comment.text}`);
    li.dataset.comment = comment.id;
    if (prepend) list.prepend(li);
    else list.append(li);
  }
  async function loadComments() {
    if (!connection) return;
    const epoch = generation;
    const data = await request(`/api/rooms/${connection.id}/comments`);
    if (epoch !== generation) return;
    $("cloud-comments").replaceChildren();
    for (const comment of data.comments) addComment(comment, false);
  }
  $("cloud-comments-section").addEventListener("toggle", () => {
    if ($("cloud-comments-section").open) loadComments().catch((e) => status(e.message));
  });
  $("cloud-comment-send").onclick = action(async () => {
    if (!connection) throw Error("Join a room first");
    const text = $("cloud-comment-text").value.trim();
    if (!text) throw Error("Write a comment first");
    const selected = window.design.getSelection?.()[0] || null;
    const result = await request(`/api/rooms/${connection.id}/comments`, {
      method: "POST",
      body: JSON.stringify({
        text,
        author: $("cloud-name").value.trim(),
        nodeId: selected,
        pageId: window.design.getDocument().activePage,
      }),
    });
    addComment(result.comment, true);
    $("cloud-comment-text").value = "";
  });

  // ---- account --------------------------------------------------------------------------------
  function saveAccount(next) {
    if (account && (account.account.id !== next?.account.id || account.server !== next?.server))
      disconnect("Account changed");
    account = next;
    if (next) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(next));
    else localStorage.removeItem(ACCOUNT_KEY);
    renderAccount();
    window.dispatchEvent(
      new CustomEvent("cloud-account-changed", { detail: next ? { ...next.account } : null }),
    );
  }
  function renderAccount() {
    const signedIn = !!account;
    $("cloud-signed-out").hidden = signedIn;
    $("cloud-signed-in").hidden = !signedIn;
    if (signedIn) {
      $("cloud-account").textContent =
        `Signed in as ${account.account.email} on ${new URL(account.server).host}`;
      $("cloud-handle").value = account.account.handle;
      $("cloud-display-name").value = account.account.displayName;
      $("cloud-avatar").value = account.account.avatarUrl || "";
    }
    if (connection) setRole(role);
  }
  const accountRequest = (path, options = {}) => {
    if (!account) throw Error("Sign in first");
    return request(path, options, { server: account.server });
  };
  // Email + password accounts (Better Auth on the server). Emailed verification and reset links
  // open the server's /account/* pages in a browser; the app only signs in with the password.
  const credentials = () => {
    const email = $("cloud-email").value.trim();
    if (!email) throw Error("Enter your email address");
    return { email, password: $("cloud-password").value };
  };
  async function signInWith(server, email, password) {
    if (account) {
      if (window.agentWorkspace?.getState().busyChats?.length)
        throw Error("Stop running chats before changing accounts.");
      await window.cloudWorkspace.storeFile?.(library()?.currentId);
      await flushBeforeSwitch();
      await window.accountStore?.flush();
    }
    if (!email) throw Error("Enter your email address");
    if (!password) throw Error("Enter your password");
    const response = await fetch(server + "/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, callbackURL: "/account/verified" }),
    });
    const data = await response.json().catch(() => null);
    if (response.status === 403 && data?.code === "EMAIL_NOT_VERIFIED") {
      const e = Error(`Verify your email first. A new link was sent to ${email}.`);
      e.code = "EMAIL_NOT_VERIFIED";
      throw e;
    }
    if (response.status === 401) throw Error("Email or password is incorrect");
    if (!response.ok)
      throw Error(data?.message || data?.error || `Server returned ${response.status}`);
    const session = response.headers.get("set-auth-token") || "";
    if (!SESSION_TOKEN.test(session)) throw Error("The server did not return a session");
    const me = await request(
      "/api/me",
      { headers: { "X-Verynize-Session": session } },
      { server, session: false },
    );
    saveAccount({
      server,
      session,
      account: me.account,
      personalOrganizationId: me.personalOrganizationId || null,
    });
    $("cloud-server").value = server;
    refreshRooms().catch(() => {});
    return { ...me.account };
  }
  async function signUpWith(server, email, password, name) {
    if (!email) throw Error("Enter your email address");
    if (password.length < 10) throw Error("Choose a password of at least 10 characters");
    await request(
      "/api/auth/sign-up/email",
      {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          name: name || email.split("@")[0],
          callbackURL: "/account/verified",
        }),
      },
      { server, session: false },
    );
  }
  async function forgotPasswordWith(server, email) {
    if (!email) throw Error("Enter your email address");
    await request(
      "/api/auth/request-password-reset",
      { method: "POST", body: JSON.stringify({ email, redirectTo: "/account/reset-password" }) },
      { server, session: false },
    );
  }
  $("cloud-signin").onclick = action(async () => {
    const { email, password } = credentials();
    const signedIn = await signInWith(base(), email, password);
    $("cloud-password").value = "";
    status(`Signed in as ${signedIn.email}`);
  });
  $("cloud-signup").onclick = action(async () => {
    const { email, password } = credentials();
    await signUpWith(base(), email, password, $("cloud-signup-name").value.trim());
    $("cloud-password").value = "";
    status(`Check ${email} for a verification link, then sign in here with your password.`);
  });
  $("cloud-forgot").onclick = action(async () => {
    const { email } = credentials();
    await forgotPasswordWith(base(), email);
    status(`If ${email} has an account, a password reset link is on its way.`);
  });
  $("cloud-profile-save").onclick = action(async () => {
    const result = await accountRequest("/api/me", {
      method: "PATCH",
      body: JSON.stringify({
        handle: $("cloud-handle").value,
        displayName: $("cloud-display-name").value,
        avatarUrl: $("cloud-avatar").value,
      }),
    });
    saveAccount({ ...account, account: result.account });
    status(`Profile saved · ${account.server}${result.profilePath}`);
  });
  $("cloud-profile-open").onclick = action(async () => {
    const href = `${account.server}/u/${account.account.handle}`;
    if (window.verynizePlatform.can("externalLinks")) await window.desktop.openExternal(href);
    else window.open(href, "_blank", "noopener");
  });
  async function signOut(everywhere) {
    if (!account) return;
    if (window.agentWorkspace?.getState().busyChats?.length)
      throw Error("Stop running chats before signing out.");
    await window.cloudWorkspace.storeFile?.(library()?.currentId);
    await flushBeforeSwitch();
    await window.accountStore?.flush();
    passkeyRun++;
    $("cloud-passkeys").replaceChildren();
    const ended = account;
    try {
      await request(
        everywhere ? "/api/auth/signout-all" : "/api/auth/signout",
        { method: "POST" },
        { server: ended.server },
      );
    } finally {
      saveAccount(null);
      $("cloud-my-rooms").replaceChildren();
      if (connection) disconnect("Signed out.");
    }
    status(everywhere ? "Signed out on every device" : "Signed out");
  }
  // Shared with the islands (onboarding, workspace switcher, Settings › Members): one account,
  // one session store and one change event ("cloud-account-changed").
  const ORG_KEY = "verynize.cloud.organization";
  const DEFAULT_SERVER = "https://verynize.gayaloo.app";
  const activeOrganization = () => {
    if (!account) return null;
    try {
      const stored = JSON.parse(localStorage.getItem(ORG_KEY) || "null");
      if (stored?.server === account.server && stored.email === account.account.email)
        return stored.id;
    } catch {}
    return account.personalOrganizationId || null;
  };
  window.cloudAccount = {
    applyProfile(profile) {
      if (
        account?.account.id === profile?.id &&
        JSON.stringify(account.account) !== JSON.stringify(profile)
      )
        saveAccount({ ...account, account: profile });
    },
    defaultServer: () =>
      account?.server ||
      $("cloud-server").value ||
      (location.protocol.startsWith("http") ? location.origin : DEFAULT_SERVER),
    get: () =>
      account
        ? {
            server: account.server,
            account: { ...account.account },
            emailAccount: !account.session.startsWith("vs_"),
            personalOrganizationId: account.personalOrganizationId || null,
          }
        : null,
    signIn: ({ server, email, password }) => signInWith(server, email, password),
    signUp: ({ server, email, password, name }) => signUpWith(server, email, password, name),
    forgotPassword: ({ server, email }) => forgotPasswordWith(server, email),
    signOut: (everywhere = false) => signOut(everywhere),
    /** Authenticated JSON request to the account's server. */
    request: (path, options = {}) => accountRequest(path, options),
    /** Authenticated request to the account's server, raw Response (streamed model API runs, web/src/lib/agent-transport.ts). */
    fetch: (path, options = {}) => {
      if (!account) return Promise.reject(Error("Sign in first"));
      return fetch(account.server + path, {
        ...options,
        headers: {
          ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
          "X-Verynize-Session": account.session,
          .../** @type {Record<string, string>} */ (options.headers),
        },
      });
    },
    activeOrganization,
    setActiveOrganization(id) {
      if (!account) return;
      localStorage.setItem(
        ORG_KEY,
        JSON.stringify({ server: account.server, email: account.account.email, id }),
      );
      window.dispatchEvent(new CustomEvent("cloud-organization-changed", { detail: { id } }));
    },
  };
  $("cloud-signout").onclick = action(() => signOut(false));
  $("cloud-signout-all").onclick = action(() => signOut(true));
  // ---- passkeys ---------------------------------------------------------------------------------
  // The ceremony runs on the server's /passkey page (the app://verynize renderer cannot be the server's WebAuthn relying
  // party). Sign-in uses a handoff: this window keeps the secret and claims the session afterwards.
  let passkeyRun = 0;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function openPasskeyPage(server, hash) {
    const url = `${server}/passkey#${hash}`;
    if (window.verynizePlatform.can("passkeyWindow"))
      await window.desktop.cloudPasskeyOpen({ url });
    else window.open(url, "verynize-passkey", "popup,width=440,height=520");
  }
  const closePasskeyPage = () => window.desktop?.cloudPasskeyClose?.().catch(() => {});
  async function waitFor(run, check) {
    const until = Date.now() + 5 * 60 * 1000;
    while (Date.now() < until) {
      if (run !== passkeyRun) return null;
      const result = await check();
      if (result) return result;
      await sleep(800);
    }
    throw Error("The passkey request timed out");
  }
  function renderPasskeys(list) {
    const target = $("cloud-passkeys");
    target.replaceChildren();
    for (const item of list)
      target.append(
        listItem(
          `${item.label}${item.lastUsedAt ? " · used " + new Date(item.lastUsedAt).toLocaleDateString() : ""}`,
          [
            [
              "Remove",
              async () => {
                if (!window.confirm("Remove this passkey? It will no longer sign you in.")) return;
                await accountRequest(`/api/me/passkeys/${item.id}`, { method: "DELETE" });
                await refreshPasskeys();
              },
              { removePasskey: item.id },
            ],
          ],
        ),
      );
    if (!list.length) target.append(listItem("No passkeys yet."));
  }
  async function refreshPasskeys() {
    if (!account) return [];
    const data = await accountRequest("/api/me/passkeys");
    renderPasskeys(data.passkeys);
    return data.passkeys;
  }
  $("cloud-passkey-add").onclick = action(async () => {
    const run = ++passkeyRun,
      before = (await refreshPasskeys()).length;
    const { ticket } = await accountRequest("/api/auth/passkeys/ticket", {
      method: "POST",
      body: "{}",
    });
    await openPasskeyPage(account.server, `mode=register&ticket=${ticket}`);
    status("Create the passkey in the new window…");
    const list = await waitFor(run, async () => {
      const items = await refreshPasskeys();
      return items.length > before ? items : null;
    });
    if (!list) return;
    void closePasskeyPage();
    status("Passkey added. You can now sign in with it.");
  });
  $("cloud-passkey-signin").onclick = action(async () => {
    const run = ++passkeyRun,
      server = base();
    const email = $("cloud-email").value.trim();
    // Embedded windows have no passkey chooser, so the desktop names the account by email.
    if (window.verynizePlatform.kind === "desktop" && !email)
      throw Error("Enter your email, then sign in with a passkey");
    const handoff = await request(
      "/api/auth/handoff",
      { method: "POST", body: "{}" },
      { server, session: false },
    );
    await openPasskeyPage(
      server,
      `mode=signin&handoff=${handoff.id}${email ? `&email=${encodeURIComponent(email)}` : ""}`,
    );
    status("Use your passkey in the new window…");
    const result = await waitFor(run, async () => {
      const response = await fetch(server + "/api/auth/handoff/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: handoff.id,
          secret: handoff.secret,
          label:
            window.verynizePlatform.kind === "desktop"
              ? "Verynize desktop (passkey)"
              : "Verynize web (passkey)",
        }),
      });
      const data = await response.json();
      if (response.status === 200) return data;
      if (response.status !== 202) throw Error(data.error || "Passkey sign-in failed");
      return null;
    });
    if (!result) return;
    void closePasskeyPage();
    saveAccount({ server, session: result.session, account: result.account });
    status(`Signed in with a passkey as ${result.account.email}`);
    refreshRooms().catch(() => {});
    refreshPasskeys().catch(() => {});
  });

  async function refreshRooms() {
    if (!account) return;
    const server = account.server;
    const data = await accountRequest("/api/me/rooms");
    const list = $("cloud-my-rooms");
    list.replaceChildren();
    for (const item of data.rooms) {
      const buttons = [
        [
          "Open",
          async () => {
            if (!window.confirm("Open this shared design as a separate file?")) return;
            await connect({ server, id: item.id });
          },
          { openRoom: item.id },
        ],
      ];
      if (item.role === "owner")
        buttons.push([
          "New owner link",
          async () => {
            // Recovery: the owner account replaces every capability link, then opens the room with the new one.
            if (
              !window.confirm(
                "Create a new owner link? Existing invite links for this room stop working.",
              )
            )
              return;
            const result = await request(
              `/api/rooms/${item.id}/tokens/rotate`,
              { method: "POST" },
              { server },
            );
            await connect({ server, id: item.id, token: result.token });
            status("Recovered owner access with a new link. Old links were revoked.");
          },
          { recoverRoom: item.id },
        ]);
      list.append(listItem(`${item.title} · ${ROLE_LABEL[item.role]}`, buttons));
    }
    if (!data.rooms.length)
      list.append(listItem("No rooms yet. Rooms you create while signed in appear here."));
  }
  $("cloud-rooms-refresh").onclick = action(refreshRooms);
  $("cloud-account-section").addEventListener("toggle", () => {
    if ($("cloud-account-section").open && account) {
      refreshRooms().catch((e) => status(e.message));
      refreshPasskeys().catch((e) => status(e.message));
    }
  });
  renderAccount();

  // ---- published apps -------------------------------------------------------------------------
  const appStatus = (text) => {
    $("cloud-app-status").textContent = text;
  };
  async function detectApp() {
    if (!window.verynizePlatform.can("publishApps")) {
      $("cloud-app-project").textContent = "App publishing runs in the Verynize desktop app.";
      return;
    }
    try {
      const info = await window.desktop.cloudAppDetect();
      $("cloud-app-project").textContent = info.command
        ? `Builds with “${info.command}”.`
        : "No build script found; the output folder is published as is.";
      if (!$("cloud-app-name").value) $("cloud-app-name").value = info.name;
      if (!$("cloud-app-output").value && info.outputDir)
        $("cloud-app-output").placeholder = info.outputDir;
    } catch (e) {
      $("cloud-app-project").textContent = e.message;
    }
  }
  function renderVersions(data) {
    const list = $("cloud-app-versions");
    list.replaceChildren();
    for (const version of data.versions) {
      const live = data.app.activeVersion === version.version;
      const buttons = live
        ? []
        : [
            [
              "Make live",
              async () => {
                await accountRequest(`/api/apps/${data.app.id}/activate`, {
                  method: "POST",
                  body: JSON.stringify({ version: version.version }),
                });
                appStatus(`Version ${version.version} is live`);
                await loadVersions(data.app.id);
              },
              { activateVersion: String(version.version) },
            ],
          ];
      list.append(
        listItem(
          `v${version.version}${live ? " · live" : ""} · ${version.files} files · ${Math.max(1, Math.round(version.bytes / 1024))} KB`,
          buttons,
        ),
      );
    }
  }
  async function loadVersions(id) {
    const data = await accountRequest(`/api/apps/${id}`);
    app = data.app;
    renderVersions(data);
    const href = data.app.activeVersion ? `${account.server}${data.app.path}` : "";
    $("cloud-app-url").textContent = href;
    if (href) $("cloud-app-url").href = href;
    else $("cloud-app-url").removeAttribute("href");
  }
  $("cloud-app-section").addEventListener("toggle", () => {
    if ($("cloud-app-section").open) void detectApp();
  });
  $("cloud-app-publish").onclick = action(async () => {
    if (!window.verynizePlatform.can("publishApps"))
      throw Error("App publishing runs in the Verynize desktop app");
    if (!account) throw Error("Sign in (Account) before publishing an app");
    appStatus("Building and uploading…");
    try {
      const result = await window.desktop.cloudAppPublish({
        server: account.server,
        session: account.session,
        name: $("cloud-app-name").value.trim(),
        outputDir: $("cloud-app-output").value.trim() || undefined,
      });
      // Status last, so the URL and version list are already shown when it reports success.
      await loadVersions(result.app.id);
      appStatus(
        `Published version ${result.version} (${result.files} files from ${result.outputDir})`,
      );
    } catch (e) {
      appStatus(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
      throw e;
    }
  });
  $("cloud-app-unpublish").onclick = action(async () => {
    if (!app) throw Error("Publish an app first");
    if (!window.confirm(`Unpublish ${app.name}? Its public URL stops working; versions are kept.`))
      return;
    await accountRequest(`/api/apps/${app.id}/publish`, { method: "DELETE" });
    appStatus("App unpublished");
    await loadVersions(app.id);
  });

  // ---- links opened in a browser ----------------------------------------------------------------
  // `#room=<id>[&token=…]` opens the file directly: web/src/islands/collab/links.ts (no dialog, no confirm).
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has("public")) {
    const epoch = generation;
    fetch(`/api/public/${encodeURIComponent(params.get("public"))}`)
      .then(async (r) => {
        if (!r.ok) throw Error("Published design not found");
        const data = await r.json();
        if (epoch !== generation) return;
        apply(data.document);
        const frame = document.createElement("iframe");
        frame.title = "Published design";
        frame.sandbox = window.design
          .getDocument()
          .pages.some((p) => p.nodes.some((n) => n.type === "shader"))
          ? "allow-scripts"
          : "";
        frame.srcdoc = window.design.exportHTML();
        Object.assign(frame.style, {
          position: "fixed",
          inset: "0",
          width: "100vw",
          height: "100vh",
          border: "0",
          zIndex: 1000,
          background: "white",
        });
        document.body.append(frame);
      })
      .catch((e) => {
        if (epoch !== generation) return;
        status(e.message);
        $("cloud-dialog").showModal();
      });
  }
})();
