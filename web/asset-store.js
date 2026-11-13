// Offline blobs keyed by SHA-256. No GC: undo/history can still reference old assets.
(() => {
  const pattern = /^asset:([a-f0-9]{64})$/;
  let opening,
    notifyFrame = 0;
  const notifyReady = () => {
    if (window.verynizePlatform?.kind === "desktop" || notifyFrame) return;
    notifyFrame = requestAnimationFrame(() => {
      notifyFrame = 0;
      window.dispatchEvent(new Event("assets-ready"));
    });
  };
  const urls = new Map(),
    pending = new Map();
  const db = () =>
    (opening ||= new Promise((resolve, reject) => {
      const request = indexedDB.open("verynize-assets", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("blobs");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  async function transaction(mode, fn) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction("blobs", mode);
      const request = fn(tx.objectStore("blobs"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error("Asset transaction aborted"));
    });
  }
  async function put(blob, expectedRef) {
    if (!(blob instanceof Blob) || !blob.size || blob.size > 20971520)
      throw Error("Asset exceeds limit 20971520 bytes");
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
    ]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    const ref = "asset:" + hash;
    if (expectedRef && ref !== expectedRef) throw Error("Asset hash mismatch");
    await transaction("readwrite", (store) => store.put(blob, hash));
    pending.delete(ref);
    notifyReady();
    return ref;
  }
  async function get(ref) {
    const hash = pattern.exec(ref)?.[1];
    if (!hash) throw Error("Invalid asset reference");
    let blob = await transaction("readonly", (store) => store.get(hash));
    if (!blob && window.verynizePlatform?.kind === "desktop") {
      const response = await fetch(ref);
      if (!response.ok) throw Error("Asset unavailable");
      blob = await response.blob();
      await put(blob, ref);
    }
    if (!blob) throw Error("Asset missing from offline storage: " + hash);
    // Verify persisted data too, not only uploads.
    const digest = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
    ]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    if (digest !== hash) throw Error("Asset hash mismatch");
    return blob;
  }
  function resolve(ref) {
    if (!pattern.test(ref) || window.verynizePlatform?.kind === "desktop") return ref;
    if (urls.has(ref)) return urls.get(ref);
    if (!pending.has(ref))
      pending.set(
        ref,
        get(ref)
          .then((blob) => {
            urls.set(ref, URL.createObjectURL(blob));
            notifyReady();
          })
          .catch((error) =>
            window.dispatchEvent(
              new CustomEvent("asset-error", { detail: { ref, message: error.message } }),
            ),
          ),
      );
    return "";
  }
  function css(value) {
    return String(value).replace(/asset:[a-f0-9]{64}/g, resolve);
  }
  async function inlineMarkup(markup) {
    const pattern =
      /(url\(\s*(?:&quot;|&#0*39;|["'])?|\bsrc(?:&quot;|["'])?\s*[:=]\s*(?:&quot;|["']))(asset:[a-f0-9]{64}|blob:[^"'\s)<>&]+)/g;
    const values = new Map([...markup.matchAll(pattern)].map((match) => [match[2], null]));
    for (const ref of values.keys()) {
      const blob = ref.startsWith("asset:") ? await get(ref) : await (await fetch(ref)).blob();
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      values.set(ref, data);
    }
    return markup.replace(pattern, (_match, prefix, ref) => prefix + values.get(ref));
  }
  window.assetStore = {
    put,
    get,
    inlineMarkup,
    resolve,
    css,
    style: (style) => style.map(([key, value]) => [key, css(value)]),
  };
  window.addEventListener("pagehide", () => {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
    pending.clear();
  });
})();
