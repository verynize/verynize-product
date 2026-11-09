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
    const unsaved = (value) =>
      value.files.filter((file) => {
        const old = saved.get(file.id);
        return (
          !old ||
          (!file.remoteOnly && old.document !== file.document) ||
          old.meta !== signature(file)
        );
      });
    let inflight = null;
    async function write(value) {
      await opened;
      const changed = unsaved(value);
      const ids = new Set(value.files.map((file) => file.id));
      inflight = value;
      try {
        await transaction("readwrite", (store) => {
          for (const id of saved.keys()) if (!ids.has(id)) store.delete("file:" + id);
          for (const file of changed) store.put(file, "file:" + file.id);
          const { files, ...meta } = value;
          store.put({ ...meta, ids: files.map((file) => file.id), savedAt: Date.now() }, "meta");
        });
      } finally {
        if (inflight === value) inflight = null;
      }
      saved.clear();
      for (const file of value.files)
        saved.set(file.id, { document: file.document, meta: signature(file) });
    }
    // An IndexedDB write the page starts while it unloads may never commit (and one still waiting for the idle callback
    // never starts). pagehide keeps what is not stored yet in a localStorage journal, written synchronously; the next
    // load applies it when it is newer than the stored library, then removes it.
    const journalKey = "verynize-library-journal:" + databaseName;
    function writeJournal() {
      const value = queued || inflight;
      if (!value) return;
      try {
        const { files, ...meta } = value;
        localStorage.setItem(
          journalKey,
          JSON.stringify({
            at: Date.now(),
            meta: { ...meta, ids: files.map((file) => file.id) },
            files: unsaved(value),
          }),
        );
      } catch {
        // Too large for localStorage: the IndexedDB write below is all there is, as before.
      }
    }
    function readJournal(stored, files) {
      let journal = null;
      try {
        journal = JSON.parse(localStorage.getItem(journalKey) || "null");
      } catch {}
      if (!journal?.meta || !Array.isArray(journal.meta.ids) || !Array.isArray(journal.files))
        return null;
      if (stored && !(journal.at > (stored.savedAt || 0))) return null;
      const byId = new Map(files.map((file) => [file.id, file]));
      for (const file of journal.files) byId.set(file.id, file);
      const merged = journal.meta.ids.map((id) => byId.get(id));
      if (merged.some((file) => !file)) return null;
      const { ids: _ids, ...meta } = journal.meta;
      return { ...meta, files: merged };
    }
    const dropJournal = () => {
      try {
        localStorage.removeItem(journalKey);
      } catch {}
    };
    async function load(legacy, sourceError = null) {
      try {
        await opened;
        const meta = await transaction("readonly", (store) => store.get("meta"));
        if (!meta) {
          if (sourceError) throw sourceError;
          const journaled = readJournal(null, legacy.files);
          await write(journaled || legacy);
          dropJournal();
          return journaled || legacy;
        }
        const files = await Promise.all(
          meta.ids.map((id) => transaction("readonly", (store) => store.get("file:" + id))),
        );
        if (files.some((file) => !file)) throw Error("A stored library file is missing");
        for (const file of files)
          saved.set(file.id, { document: file.document, meta: signature(file) });
        const journaled = readJournal(meta, files);
        if (journaled) {
          await write(journaled);
          dropJournal();
          return journaled;
        }
        dropJournal();
        const { ids: _ids, savedAt: _savedAt, ...rest } = meta;
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
      writeJournal();
      flush().catch(() => {});
    });
    return { load, schedule, flush };
  }
  window.VerynizeLibraryStorage = Object.freeze({ create });
})();
