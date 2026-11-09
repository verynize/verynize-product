// Read the persisted library, not the shell's in-memory view.
exports.readLibrary = (page) =>
  page.evaluate(async () => {
    await window.fileLibrary.flush();
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("verynize-library", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const get = (key) =>
        new Promise((resolve, reject) => {
          const request = db.transaction("records").objectStore("records").get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const { ids, ...meta } = await get("meta");
      return { ...meta, files: await Promise.all(ids.map((id) => get("file:" + id))) };
    } finally {
      db.close();
    }
  });
