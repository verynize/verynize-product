// Per-file IndexedDB persistence. The legacy localStorage value remains an untouched recovery copy.
// A single transaction migrates metadata and every original record before the migration is visible.
(() => {
  const DATABASE = "verynize-library",
    STORE = "records";
  function create(onError, databaseName = DATABASE) {
    let database,
      queued,
      idle = 0,
      writing = Promise.resolve();
    const saved = new Map();
    const opened = /** @type {Promise<void>} */ (
      new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          database = request.result;
          database.onversionchange = () => {
            database.close();
            database = null;
          };
          resolve();
        };
      })
    );
    function transaction(mode, fn) {
      return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE, mode);
        const result = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(result?.result);
        tx.onabort = tx.onerror = () => reject(tx.error || Error("Library transaction failed"));
      });
    }
    const signature = ({ document: _document, ...meta }) => JSON.stringify(meta);
    async function write(value) {
      await opened;
      const changed = value.files.filter((file) => {
        const old = saved.get(file.id);
        return (
          !old ||
          (!file.remoteOnly && old.document !== file.document) ||
          old.meta !== signature(file)
        );
      });
      const ids = new Set(value.files.map((file) => file.id));
      await transaction("readwrite", (store) => {
        for (const id of saved.keys()) if (!ids.has(id)) store.delete("file:" + id);
        for (const file of changed) store.put(file, "file:" + file.id);
        const { files, ...meta } = value;
        store.put({ ...meta, ids: files.map((file) => file.id) }, "meta");
      });
      saved.clear();
      for (const file of value.files)
        saved.set(file.id, { document: file.document, meta: signature(file) });
    }
    async function load(legacy, sourceError = null) {
      try {
        await opened;
        const meta = await transaction("readonly", (store) => store.get("meta"));
        if (!meta) {
          if (sourceError) throw sourceError;
          await write(legacy);
          return legacy;
        }
        const files = await Promise.all(
          meta.ids.map((id) => transaction("readonly", (store) => store.get("file:" + id))),
        );
        if (files.some((file) => !file)) throw Error("A stored library file is missing");
        for (const file of files)
          saved.set(file.id, { document: file.document, meta: signature(file) });
        const { ids: _ids, ...rest } = meta;
        return { ...rest, files };
      } catch (error) {
        onError(error);
        // Do not replace a failed IndexedDB library with a partial/fallback library.
        database = null;
        return legacy;
      }
    }
    function flush() {
      if (idle) cancelIdleCallback(idle);
      idle = 0;
      const value = queued;
      queued = null;
      if (value)
        writing = writing
          .catch(() => {})
          .then(() => {
            if (!database) throw Error("Library storage is unavailable");
            return write(value);
          })
          .catch((error) => {
            onError(error);
            throw error;
          });
      return writing;
    }
    function schedule(value) {
      // Metadata is mutable in the shell; documents are retained immutable commit snapshots.
      queued = {
        ...value,
        folders: structuredClone(value.folders),
        files: value.files.map((file) => ({ ...file })),
      };
      if (!idle)
        idle = requestIdleCallback(
          () => {
            flush().catch(() => {});
          },
          { timeout: 500 },
        );
    }
    addEventListener("pagehide", () => {
      flush().catch(() => {});
    });
    return { load, schedule, flush };
  }
  window.VerynizeLibraryStorage = Object.freeze({ create });
})();
