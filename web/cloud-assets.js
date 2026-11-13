// Room assets on the client: binary data never travels inside a shared document. While connected
// to a room with edit access, embedded binaries on the open page (image sources, image fills and
// masks: data URIs) are uploaded once to the room's R2 asset store (cloud/assets.js) and replaced
// by their asset URL through window.design.updateNodes, so collaborators receive a short URL
// operation instead of the bytes. web/cloud-panel.js asks hold() before sending local operations,
// and hold() defers them until the uploads settle. Creating a room (createRoom) uploads every
// large binary of the document (fonts included) before the document is written to the room.
// Which data URIs count, and the size limits: web/storage-limits.js. Exports call inlineHtml() to
// turn asset URLs back into data URIs for the offline renderer. API: cloud/README.md, "Room assets".
(() => {
  const Limits = window.storageLimits;
  // Raster images in layers are uploaded at any size (as before); other binaries above the inline limit.
  const RASTER = /^data:(image\/(?:png|jpeg|webp|gif|avif));base64,/i;
  const TIMEOUT = 60_000;
  const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const ASSET_PATH = new RegExp(`^/api/rooms/(${UUID})/assets/${UUID}$`);
  const ASSET_IN_TEXT = new RegExp(
    `https?://[A-Za-z0-9.:\\[\\]-]+/api/rooms/${UUID}/assets/${UUID}(?:\\?sig=[0-9a-f]{64})?`,
    "g",
  );
  // Node properties that hold binary data: image source, image fills and image masks.
  const CARRIERS = ["src", "fills", "backgroundFills", "masks"];
  const mb = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`;

  /** The same URL check as isRoomAssetUrl in web/document-core.js (the document schema). */
  function isAssetUrl(value) {
    if (typeof value !== "string" || value.length > 512) return false;
    let url;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (
      url.href === value &&
      (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      ASSET_PATH.test(url.pathname) &&
      /^(\?sig=[0-9a-f]{64})?$/.test(url.search)
    );
  }
  /** True for a data URI this module stores as a room asset. */
  const uploadable = (value) =>
    typeof value === "string" &&
    (window.VerynizeDocument?.isAssetRef?.(value) ||
      RASTER.test(value) ||
      Limits.classify(value) === "asset");

  // Uploads per room and source: {status: 'uploading'|'done'|'failed', url?, error?}.
  const entries = new Map();
  // Asset URL → data URI, for exports and offline rendering of files this client has seen.
  const inline = new Map();
  // Callbacks of web/cloud-panel.js waiting for the held uploads (see hold()).
  let waiters = [];
  let settleTimer = null;
  let lastError = "";
  // Progress of a room being created (createRoom): {done, total, error?} or null.
  let creating = null;

  /** The connected room, when this client may edit it. */
  function editableRoom() {
    const workspace = window.cloudWorkspace;
    if (!workspace?.isConnected?.() || !["editor", "owner"].includes(workspace.role?.()))
      return null;
    return workspace.room?.() || null;
  }
  const keyOf = (room, src) => `${room.server}|${room.id}|${src}`;

  /** Uploadable data URIs of a node (a recolourable SVG keeps its source). */
  function sourcesOf(node) {
    const found = [];
    const visit = (value) => {
      if (typeof value === "string") {
        if (uploadable(value)) found.push(value);
      } else if (Array.isArray(value)) value.forEach((item) => visit(item));
      else if (value && typeof value === "object")
        for (const k of Object.keys(value)) if (k !== "css") visit(value[k]);
    };
    for (const key of CARRIERS) {
      if (key === "src" && (node.svgColor !== undefined || node.svgPaints !== undefined)) continue;
      visit(node[key]);
    }
    return found;
  }
  /** Nodes of the open page with uploadable data URIs (updateNodes reaches only that page). */
  function embeddedNodes(doc) {
    const page = doc?.pages?.find?.((p) => p.id === doc.activePage);
    return (page?.nodes || [])
      .map((node) => ({ node, sources: sourcesOf(node) }))
      .filter((item) => item.sources.length);
  }
  /** A copy of `value` with data URIs replaced through `urls` (Map source → URL). */
  function replaced(value, urls) {
    if (typeof value === "string") return urls.get(value) ?? value;
    if (Array.isArray(value)) return value.map((item) => replaced(item, urls));
    if (value && typeof value === "object") {
      const out = {};
      for (const key of Object.keys(value)) out[key] = replaced(value[key], urls);
      return out;
    }
    return value;
  }
  const hex = (buffer) =>
    Array.from(new Uint8Array(buffer), (n) => n.toString(16).padStart(2, "0")).join("");
  const changed = () => window.dispatchEvent(new CustomEvent("cloud-assets-changed"));

  /**
   * Upload one data URI as an asset of `roomId` with `request(path, options)` (an authenticated
   * room request). Returns the asset URL.
   */
  async function uploadTo(request, roomId, src) {
    const response =
      window.VerynizeDocument?.isAssetRef?.(src) && window.assetStore
        ? new Response(await window.assetStore.get(src))
        : await fetch(src);
    if (!response.ok) throw Error("Asset unavailable for upload");
    const contentType = Limits.parseDataUrl(src)?.mime || response.headers.get("content-type");
    if (!contentType || !Limits.ASSET_TYPES.includes(contentType))
      throw Error(`Embedded ${contentType || "data"} cannot be uploaded`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > Limits.ASSET_LIMIT_BYTES)
      throw Object.assign(
        Error(
          `An embedded ${contentType.split("/")[0]} is ${mb(bytes.byteLength)}, larger than the ${mb(Limits.ASSET_LIMIT_BYTES)} upload limit`,
        ),
        { code: "storage_limit" },
      );
    const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const asset = await request(`/api/rooms/${roomId}/assets`, {
        method: "POST",
        body: JSON.stringify({ contentType, size: bytes.byteLength, sha256 }),
        signal: controller.signal,
      });
      if (asset.uploadUrl) {
        const response = await fetch(asset.uploadUrl, {
          method: asset.method || "PUT",
          headers: { "Content-Type": contentType },
          body: bytes,
          signal: controller.signal,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw Object.assign(Error(data.error || `Upload failed (${response.status})`), {
            status: response.status,
          });
        }
      }
      if (!isAssetUrl(asset.url)) throw Error("The server returned an invalid asset URL");
      inline.set(asset.url, src);
      return asset.url;
    } finally {
      clearTimeout(timer);
    }
  }
  const upload = (room, src) =>
    uploadTo((path, options) => window.cloudWorkspace.request(path, options), room.id, src);

  function start(room, src) {
    const key = keyOf(room, src);
    let entry = entries.get(key);
    if (entry) return entry;
    entry = { status: "uploading" };
    entries.set(key, entry);
    changed();
    upload(room, src).then(
      (url) => {
        entry.status = "done";
        entry.url = url;
        changed();
        settleSoon();
      },
      (error) => {
        entry.status = "failed";
        entry.error = error.message;
        lastError = error.message;
        console.warn("Room asset upload failed; the data stays embedded:", error.message);
        if (error.code === "storage_limit")
          window.storageLimits?.reportError(error.message, "sync");
        changed();
        settleSoon();
      },
    );
    return entry;
  }
  const uploading = () => [...entries.values()].some((entry) => entry.status === "uploading");
  function settleSoon() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 0);
  }

  /** Once nothing uploads: swap uploaded sources for their URLs, then release held changes. */
  function settle() {
    if (uploading()) return;
    const resume = waiters;
    waiters = [];
    const room = editableRoom();
    if (room && window.design?.getDocument) {
      const urls = new Map();
      const ids = [];
      for (const { node, sources } of embeddedNodes(window.design.getDocument())) {
        let hit = false;
        for (const src of sources) {
          const entry = entries.get(keyOf(room, src));
          if (entry?.status !== "done") continue;
          urls.set(src, entry.url);
          hit = true;
        }
        if (hit) ids.push(node.id);
      }
      if (ids.length)
        try {
          window.design.updateNodes(ids, (node) => {
            const patch = {};
            for (const key of CARRIERS) {
              if (node[key] === undefined) continue;
              if (key === "src" && (node.svgColor !== undefined || node.svgPaints !== undefined))
                continue;
              const next = replaced(node[key], urls);
              if (JSON.stringify(next) !== JSON.stringify(node[key])) patch[key] = next;
            }
            return patch;
          });
        } catch (error) {
          lastError = error.message;
        }
    }
    for (const fn of resume)
      try {
        fn();
      } catch (error) {
        console.warn(error);
      }
  }

  /**
   * Called by web/cloud-panel.js before it sends local operations. Returns true (and calls
   * `resume` later) when the document has embedded binaries that are uploading or ready to swap.
   */
  function hold(doc, resume) {
    const room = editableRoom();
    if (!room) return false;
    const pending = embeddedNodes(doc)
      .flatMap((item) => item.sources)
      .map((src) => start(room, src))
      .filter((entry) => entry.status !== "failed");
    if (!pending.length) return false;
    if (resume) waiters.push(resume);
    if (!uploading()) settleSoon();
    return true;
  }
  /** True while web/cloud-panel.js waits for uploads (it then defers applying remote state). */
  const holding = () => waiters.length > 0;

  /** Upload embedded binaries already in the document (on connect, page switch or remote edits). */
  function sweep() {
    const room = editableRoom();
    if (!room || !window.design?.getDocument) return;
    const sources = embeddedNodes(window.design.getDocument()).flatMap((item) => item.sources);
    for (const src of sources) start(room, src);
    if (sources.length && !uploading()) settleSoon();
  }

  // Stand-ins for binaries while a new room is created (nobody else knows the room yet).
  const PNG_1X1 =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const placeholder = (value) => {
    const mime = Limits.parseDataUrl(value)?.mime || "";
    if (mime === "image/svg+xml")
      return "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
    if (mime.startsWith("image/")) return PNG_1X1;
    return `data:${mime};base64,AAAA`;
  };
  // A room whose creation stopped while uploading: retried with the same document, it is reused.
  let unfinished = null;

  /**
   * Create a room for `doc` with its large binaries stored as room assets first. `create(document)`
   * POSTs /api/rooms and returns {id, token}; `request(path, options, {id, token})` is an
   * authenticated request to `server`; `progress(text)` shows progress. Blocking size problems
   * (web/storage-limits.js) throw before anything is sent. Returns create()'s result.
   */
  async function createRoom(doc, { server, create, request, progress = () => {} }) {
    Limits.assertShareable(doc);
    const sources = [
      ...new Set(
        Limits.inlineBinaries(doc)
          .filter((item) => item.kind === "asset")
          .map((item) => item.value),
      ),
    ];
    if (!sources.length) return create(doc);
    const docKey = `${server}|${sources.length}|${Limits.sharedSize(doc)}`;
    let room = unfinished?.key === docKey ? unfinished.room : null;
    const report = () => {
      changed();
      progress(
        creating.error
          ? creating.error
          : `Uploading ${creating.total} file${creating.total === 1 ? "" : "s"} to the new room · ${creating.done} of ${creating.total}`,
      );
    };
    creating = { done: 0, total: sources.length, error: null };
    report();
    try {
      room ||= await create(Limits.mapBinaries(doc, (value) => placeholder(value)));
      unfinished = { key: docKey, room };
      const auth = { id: room.id, token: room.token };
      const urls = new Map();
      for (const src of sources) {
        let url;
        try {
          url = await uploadTo((path, options) => request(path, options, auth), room.id, src);
        } catch (error) {
          // A server without room assets keeps binaries embedded, as before.
          if (error.status === 503 && !urls.size) {
            await request(
              `/api/rooms/${room.id}`,
              { method: "PUT", body: JSON.stringify({ document: doc, baseRevision: 0 }) },
              auth,
            );
            unfinished = null;
            return room;
          }
          throw error;
        }
        urls.set(src, url);
        creating.done++;
        report();
      }
      const current = await request(`/api/rooms/${room.id}`, {}, auth);
      await request(
        `/api/rooms/${room.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            document: Limits.mapBinaries(doc, (value) => urls.get(value) ?? value),
            baseRevision: current.revision,
          }),
        },
        auth,
      );
      unfinished = null;
      creating = null;
      changed();
      return room;
    } catch (error) {
      creating.error = `Uploading files to the new room failed: ${error.message}. Create room again to retry.`;
      report();
      if (error.code === "storage_limit" || window.storageLimits.isSizeError(error))
        window.storageLimits.reportError(error.message, "share");
      throw Object.assign(Error(creating.error), { code: error.code, status: error.status });
    }
  }

  async function dataUri(url) {
    if (inline.has(url)) return inline.get(url);
    const response = await fetch(url);
    if (!response.ok) throw Error(`Asset request failed (${response.status})`);
    const blob = await response.blob();
    const value = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    inline.set(url, value);
    return value;
  }
  /** Replace room asset URLs in exported HTML with data URIs (left unchanged when unreachable). */
  async function inlineHtml(html) {
    if (typeof html !== "string") return html;
    const urls = [...new Set(html.match(ASSET_IN_TEXT) || [])].filter(isAssetUrl);
    let result = html;
    for (const url of urls)
      try {
        result = result.split(url).join(await dataUri(url));
      } catch (error) {
        console.warn("Room asset could not be inlined:", error.message);
      }
    return result;
  }

  // Sweep when the document changes and when the connection or role changes.
  let sweepTimer = null;
  const sweepSoon = () => {
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(sweep, 50);
  };
  window.design?.subscribe?.(sweepSoon);
  let lastState = "";
  setInterval(() => {
    const room = editableRoom();
    const state = room ? `${room.server}|${room.id}` : "";
    if (state !== lastState) {
      lastState = state;
      if (room) sweepSoon();
    }
  }, 1000);

  const count = (status) => [...entries.values()].filter((entry) => entry.status === status).length;
  window.cloudAssets = {
    isAssetUrl,
    hold,
    holding,
    sweep,
    createRoom,
    inlineHtml,
    uploadTo,
    status: () => ({
      uploading: count("uploading"),
      uploaded: count("done"),
      failed: count("failed"),
      lastError,
      creating: creating ? { ...creating } : null,
    }),
  };
})();
