(() => {
  let switching = Promise.resolve();
  window.documentLifecycle = {
    prepareSwitch(options = {}) {
      const perform = async () => {
        if (options.isCurrent && !options.isCurrent()) throw Error("Document switch canceled");
        if (options.cloudJoinEpoch === undefined) {
          if (window.cloudAccount?.get())
            await window.cloudWorkspace?.storeFile?.(window.fileLibrary?.currentId);
          await window.cloudWorkspace?.flush?.();
        }
        // Room listeners must be disconnected before any replacement document renders.
        window.dispatchEvent(new CustomEvent("document-will-change", { detail: options }));
        if (!options.preserveNative && window.verynizePlatform.can("designFiles"))
          await window.desktop.designDetach();
      };
      switching = switching.then(perform, perform);
      return switching;
    },
  };
})();
