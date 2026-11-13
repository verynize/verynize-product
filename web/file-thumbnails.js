// File covers are derived images, never binary document properties. One dedicated R2 object
// per room holds the uploaded cover; Home metadata loading works without booting the editor.
(() => {
  const cache = new Map();
  const loads = new Map();
  const completed = new Map();
  const remoteMarks = new Map();
  const localRequested = new Map();
  let timer,
    deadline,
    lastError = "";
  const jobs = new Map();
  const uploads = new Map();
  let pending = null;
  const roomKey = (room) => `${room.server}|${room.id}`;
  const changed = () => window.dispatchEvent(new Event("file-thumbnail-changed"));
  const fileRoom = (file) =>
    file.cloud && !file.cloud.detached
      ? { server: file.cloud.server, id: file.cloud.roomId }
      : file.room
        ? { server: file.room.server, id: file.room.id }
        : null;
  const targets = new WeakMap();
  function target(doc) {
    if (targets.has(doc)) return targets.get(doc);
    const chosenPage = doc.pages.find((p) => p.nodes.some((n) => n.id === doc.thumbnailNodeId));
    const node = chosenPage?.nodes.find((n) => n.id === doc.thumbnailNodeId);
    const pick = { page: chosenPage || doc.pages[0], node: node || null };
    targets.set(doc, pick);
    return pick;
  }
  // Library documents and editor commit snapshots are immutable. Serialize once per
  // snapshot, never per card paint or selection notification. No marks are persisted.
  const fingerprints = new WeakMap();
  function fingerprint(doc) {
    if (!doc) return "";
    if (fingerprints.has(doc)) return fingerprints.get(doc);
    const pick = target(doc);
    const serialized = JSON.stringify([
      pick.node?.id || null,
      pick.page,
      doc.tokens,
      doc.fontFaces,
      doc.variables,
    ]);
    // Two independent 32-bit accumulators keep cache keys compact and deterministic.
    let a = 2166136261,
      b = 5381;
    for (let i = 0; i < serialized.length; i++) {
      const code = serialized.charCodeAt(i);
      a = Math.imul(a ^ code, 16777619);
      b = Math.imul(b, 33) ^ code;
    }
    const mark = `${serialized.length}:${a >>> 0}:${b >>> 0}`;
    fingerprints.set(doc, mark);
    return mark;
  }
  const localCache = new Map();
  const localLoads = new Map();
  function cached(file) {
    const room = fileRoom(file),
      value = room && cache.get(roomKey(room));
    const pick = file.document && target(file.document);
    if (
      value &&
      (file.room ||
        (remoteMarks.get(roomKey(room)) === fingerprint(file.document) &&
          value.nodeId === (pick.node?.id || null) &&
          (value.nodeId || value.pageId === pick.page?.id)))
    )
      return value;
    const local = localCache.get(file.id);
    return local?.mark === fingerprint(file.document) ? local.cover : null;
  }
  async function local(file) {
    if (file.room || !window.design?.thumbnailMarkup) return null; // A remote-only card has no document to render yet.
    const mark = fingerprint(file.document),
      old = localCache.get(file.id);
    if (old?.mark === mark) return old.cover;
    localRequested.set(file.id, mark);
    const key = `${file.id}|${mark}`;
    if (localLoads.has(key)) return localLoads.get(key);
    const doc = structuredClone(file.document),
      pick = target(doc);
    if (!pick.page) return null;
    const promise = raster(pick.node?.id || null, doc)
      .then((url) => {
        const cover = { url, nodeId: pick.node?.id || null, pageId: pick.page.id };
        if (localRequested.get(file.id) !== mark) return null;
        localCache.set(file.id, { mark, cover });
        if (localCache.size > 64) localCache.delete(localCache.keys().next().value);
        changed();
        return cover;
      })
      .catch(() => null)
      .finally(() => localLoads.delete(key));
    localLoads.set(key, promise);
    return promise;
  }
  async function load(file) {
    const room = fileRoom(file);
    if (!room) return local(file);
    const key = roomKey(room);
    if (loads.has(key)) return loads.get(key);
    const request = window.cloudWorkspace.requestForRoom(room),
      previous = cache.get(key);
    const mark = fingerprint(file.document);
    const promise = request(`/api/rooms/${room.id}/thumbnail`)
      .then(({ thumbnail }) => {
        if (cache.get(key) !== previous) return cache.get(key);
        cache.set(key, thumbnail);
        remoteMarks.set(key, mark);
        changed();
        return cached(file);
      })
      .catch(() => null)
      .then((cover) => cover || local(file))
      .finally(() => loads.delete(key));
    loads.set(key, promise);
    return promise;
  }
  let renderQueue = Promise.resolve();
  function raster(id = null, doc = window.design.getDocument()) {
    const snapshot = structuredClone(doc);
    const result = renderQueue.then(() => rasterNow(id, snapshot));
    renderQueue = result.catch(() => {});
    return result;
  }
  async function rasterNow(id, doc) {
    const artwork = window.design.thumbnailMarkup(id, doc);
    // Bounded card-sized raster, independent of the frame's working dimensions.
    const ratio = Math.min(1, 1920 / artwork.width, 1080 / artwork.height);
    const width = Math.max(1, Math.round(artwork.width * ratio));
    const height = Math.max(1, Math.round(artwork.height * ratio));
    const markup = artwork.html.replace(
      "<body>",
      `<body style="transform:scale(${ratio});transform-origin:0 0">`,
    );
    const inlined = await window.cloudAssets.inlineHtml(markup);
    const html = window.assetStore ? await window.assetStore.inlineMarkup(inlined) : inlined;
    if (window.verynizePlatform.can("rasterExport")) {
      const result = await window.verynizePlatform.desktop.renderDesign({
        html,
        width,
        height,
        scale: 1,
      });
      return result.dataURL;
    }
    // Browser fallback uses the same detached layer markup and embeds all its room/hash assets.
    const body = new DOMParser().parseFromString(html, "text/html");
    const content = new XMLSerializer().serializeToString(body.documentElement);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${content}</div></foreignObject></svg>`;
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(Error("Could not render the file cover"));
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return canvas.toDataURL("image/png");
  }
  // The only upload API adapter: PNG data URL -> raw PNG bytes + cover selection.
  async function putCover(request, roomId, png, nodeId, pageId) {
    const response = await fetch(png);
    if (!response.ok) throw Error("Could not read the rendered cover");
    const body = await response.blob();
    const query = new URLSearchParams({ pageId });
    if (nodeId) query.set("nodeId", nodeId);
    return request(`/api/rooms/${roomId}/thumbnail?${query}`, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body,
    });
  }
  function capture() {
    const workspace = window.cloudWorkspace,
      room = workspace?.room?.();
    if (
      !window.design ||
      !room ||
      !workspace.isConnected() ||
      !["editor", "owner"].includes(workspace.role())
    )
      return null;
    const doc = window.design.getSnapshot();
    return { room, doc, mark: fingerprint(doc), request: workspace.requestForRoom(room) };
  }
  async function sync(job) {
    let { doc, mark } = job;
    const { room, request } = job,
      key = roomKey(room);
    if (completed.get(key) === mark) return;
    let pick = target(doc);
    const unloaded = window.pageLoader?.unloadedIds?.() || [];
    const needed =
      !pick.node && doc.thumbnailNodeId
        ? unloaded
        : pick.page && unloaded.includes(pick.page.id)
          ? [pick.page.id]
          : [];
    if (needed.length) {
      // A switched-away lazy page cannot be hydrated against the next room.
      if (roomKey(window.cloudWorkspace.room() || {}) !== key) return;
      await window.pageLoader.ensure(needed);
      if (roomKey(window.cloudWorkspace.room() || {}) !== key) return;
      doc = window.design.getSnapshot();
      mark = fingerprint(doc);
      pick = target(doc);
    }
    if (!pick.page || completed.get(key) === mark) return;
    const src = await raster(pick.node?.id || null, doc);
    // The server digest also deduplicates reopening a file after a reload.
    const response = await fetch(src);
    if (!response.ok) throw Error("Could not read the rendered cover");
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join(
      "",
    );
    const existing = await request(`/api/rooms/${room.id}/thumbnail`);
    const matches =
      existing.thumbnail?.sha256 === sha256 &&
      existing.thumbnail.nodeId === (pick.node?.id || null) &&
      existing.thumbnail.pageId === pick.page.id;
    const result = matches
      ? existing
      : await putCover(request, room.id, src, pick.node?.id || null, pick.page.id);
    completed.set(key, mark);
    uploads.set(key, Date.now());
    cache.set(key, result.thumbnail);
    remoteMarks.set(key, mark);
    lastError = "";
    changed();
  }
  function flush(job = pending || capture()) {
    clearTimeout(timer);
    clearTimeout(deadline);
    deadline = null;
    if (!job) return Promise.resolve();
    const key = roomKey(job.room);
    if (completed.get(key) !== job.mark) uploads.set(key, Date.now());
    const previous = jobs.get(key) || Promise.resolve();
    const work = previous
      .then(() => sync(job))
      .catch((error) => {
        lastError = error.message;
        changed();
      });
    jobs.set(key, work);
    return work.finally(() => {
      if (jobs.get(key) === work) jobs.delete(key);
    });
  }
  function soon() {
    const next = capture();
    if (!next) return;
    if (pending && roomKey(pending.room) !== roomKey(next.room)) void flush(pending);
    if (pending?.mark === next.mark && roomKey(pending.room) === roomKey(next.room)) return;
    pending = next;
    clearTimeout(timer);
    timer = setTimeout(() => flush(), 10000);
    // Continuous editing also gets a cover, no more than once per 45 seconds.
    if (!deadline)
      deadline = setTimeout(
        () => flush(),
        Math.max(0, (uploads.get(roomKey(next.room)) || Date.now()) + 45000 - Date.now()),
      );
  }
  let attached = false;
  function attach() {
    if (attached || !window.design) return;
    attached = true;
    window.design.subscribe(soon);
    soon();
    changed();
  }
  window.addEventListener("verynize:editor-started", attach);
  window.addEventListener("file-thumbnail-selected", () => {
    pending = capture();
    void flush();
  });
  window.addEventListener("document-will-change", () => {
    void flush();
    pending = null;
  });
  window.addEventListener("cloud-room-changed", soon);
  window.addEventListener("verynize:cloud-state", soon);
  window.addEventListener("online", () => {
    pending = null;
    soon();
  });
  window.addEventListener("beforeunload", () => {
    void flush();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void flush();
  });
  let home = document.body.classList.contains("files-view");
  new MutationObserver(() => {
    const next = document.body.classList.contains("files-view");
    if (next && !home) void flush();
    home = next;
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  window.fileThumbnails = {
    cached,
    load,
    local,
    refresh: () => {
      pending = capture();
      return flush();
    },
    render: raster,
    status: () => ({ uploading: jobs.size > 0, lastError }),
  };
  attach();
})();
