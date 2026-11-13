// The file library lives in IndexedDB (web/library-storage.js: a "meta" record with the file ids, and one
// "file:<id>" record per file); localStorage's verynize-library-v1 is only read before that store exists.
const LIBRARY_DB = "verynize-library";

/** The stored file library ({...meta, files}) of the page's origin, after pending writes are flushed: the persisted
 * library, not the shell's in-memory view. */
exports.readLibrary = (page) =>
  page.evaluate(async (name) => {
    await window.fileLibrary.flush();
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
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
  }, LIBRARY_DB);

/** Replace the stored file library; the page shows it once it reloads. */
exports.writeLibrary = (page, library) =>
  page.evaluate(
    async ({ name, library }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction("records", "readwrite");
          const store = tx.objectStore("records");
          const { files, ...meta } = library;
          for (const file of files) store.put(file, "file:" + file.id);
          store.put({ ...meta, ids: files.map((file) => file.id) }, "meta");
          tx.oncomplete = resolve;
          tx.onerror = tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { name: LIBRARY_DB, library },
  );
