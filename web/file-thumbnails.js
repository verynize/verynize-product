// File covers are derived images, never binary document properties. Use the thumbnail
// endpoint and overwrite one dedicated R2 object per room.
(() => {
  const cache = new Map();
  const loads = new Map();
  const completed = new Map();
  const remoteMarks = new Map();
  const localRequested = new Map();
  let timer,
    running = null,
    again = false,
    lastError = "";
  const roomKey = (room) => `${room.server}|${room.id}`;
  const changed = () => window.dispatchEvent(new Event("file-thumbnail-changed"));
  const fileRoom = (file) =>
    file.cloud && !file.cloud.detached
      ? { server: file.cloud.server, id: file.cloud.roomId }
      : file.room
        ? { server: file.room.server, id: file.room.id }
        : null;
  function target(doc) {
    const chosenPage = doc.pages.find((p) => p.nodes.some((n) => n.id === doc.thumbnailNodeId));
    const node = chosenPage?.nodes.find((n) => n.id === doc.thumbnailNodeId);
    return { page: chosenPage || doc.pages[0], node: node || null };
  }
  function fingerprint(doc) {
    const pick = target(doc);
    return JSON.stringify([pick.node?.id || null, pick.page, doc.tokens, doc.fontFaces, doc.variables]);
  }
  const localCache = new Map();
  const localLoads = new Map();
  function cached(file) {
    const room = fileRoom(file), value = room && cache.get(roomKey(room));
    const pick = target(file.document);
    if (value && (file.room || (remoteMarks.get(roomKey(room)) === fingerprint(file.document) &&
      value.nodeId === (pick.node?.id || null) && (value.nodeId || value.pageId === pick.page?.id)))) return value;
    const local = localCache.get(file.id);
    return local?.mark === fingerprint(file.document) ? local.cover : null;
  }
  async function local(file) {
    if (file.room) return null; // A remote-only card has no document to render yet.
    const mark = fingerprint(file.document), old = localCache.get(file.id);
    if (old?.mark === mark) return old.cover;
    localRequested.set(file.id, mark);
    const key = `${file.id}|${mark}`;
    if (localLoads.has(key)) return localLoads.get(key);
    const doc = structuredClone(file.document), pick = target(doc);
    if (!pick.page) return null;
    const promise = raster(pick.node?.id || null, doc).then((url) => {
      const cover = { url, nodeId: pick.node?.id || null, pageId: pick.page.id };
      if (localRequested.get(file.id) !== mark) return null;
      localCache.set(file.id, { mark, cover });
      if (localCache.size > 64) localCache.delete(localCache.keys().next().value);
      changed();
      return cover;
    }).catch(() => null).finally(() => localLoads.delete(key));
    localLoads.set(key, promise);
    return promise;
  }
  async function load(file) {
    const room = fileRoom(file);
    if (!room) return local(file);
    const key = roomKey(room);
    if (loads.has(key)) return loads.get(key);
    const request = window.cloudWorkspace.requestForRoom(room), previous = cache.get(key);
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
  async function sync() {
    const workspace = window.cloudWorkspace,
      room = workspace?.room?.();
    if (!room || !workspace.isConnected() || !["editor", "owner"].includes(workspace.role()))
      return;
    let doc = window.design.getDocument(), pick = target(doc);
    const unloaded = window.pageLoader?.unloadedIds?.() || [];
    const needed = !pick.node && doc.thumbnailNodeId ? unloaded :
      pick.page && unloaded.includes(pick.page.id) ? [pick.page.id] : [];
    if (needed.length) {
      // Load the cover's page without switching the editor's active page.
      await window.pageLoader.ensure(needed);
      if (workspace.room()?.id !== room.id || workspace.room()?.server !== room.server) return;
      doc = window.design.getDocument(); pick = target(doc);
    }
    if (!pick.page) return;
    const key = roomKey(room), mark = fingerprint(doc);
    if (completed.get(key) === mark) return;
    const request = workspace.requestForRoom(room);
    const current = () => {
      const now = workspace.room();
      return now && roomKey(now) === key && fingerprint(window.design.getDocument()) === mark;
    };
    const src = await raster(pick.node?.id || null, doc);
    if (!current()) { again = true; return; }
    const bytes = await (await fetch(src)).arrayBuffer();
    if (!current()) {
      again = true;
      return;
    }
    const query = new URLSearchParams({ nodeId: pick.node?.id || "", pageId: pick.page.id });
    const result = await request(`/api/rooms/${room.id}/thumbnail?${query}`, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: bytes,
    });
    if (!current()) {
      again = true;
      return;
    }
    completed.set(key, mark);
    cache.set(key, result.thumbnail);
    remoteMarks.set(key, mark);
    lastError = "";
    changed();
  }
  async function refresh() {
    clearTimeout(timer);
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        try {
          await sync();
        } catch (error) {
          lastError = error.message;
          changed();
        }
      } while (again);
    })();
    try {
      await running;
    } finally {
      running = null;
    }
  }
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 800);
  };
  window.design.subscribe(soon);
  window.addEventListener("cloud-room-changed", soon);
  window.addEventListener("verynize:cloud-state", soon);
  window.addEventListener("online", soon);
  window.fileThumbnails = {
    cached,
    load,
    local,
    refresh,
    render: raster,
    status: () => ({ uploading: !!running, lastError }),
  };
  soon();
})();
