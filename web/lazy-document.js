// Valid documents keep inactive pages unprepared until first activation. Invalid/legacy input
// still takes document-safety's complete repair/validation path, so no invalid page can be saved.
(() => {
  const prepared = new WeakSet();
  let editorDefaults;
  function activate(document) {
    const page = document.pages.find((item) => item.id === document.activePage);
    if (!page || !editorDefaults || prepared.has(page)) return;
    window.VerynizeDocument.normalizeDocument({ ...document, pages: [page] }, editorDefaults);
    prepared.add(page);
  }
  function prepare(document, defaults, repairs) {
    const core = window.VerynizeDocument;
    editorDefaults = defaults;
    const eager = () => {
      const result = core.prepareDocument(document, defaults, repairs);
      for (const page of result.pages) prepared.add(page);
      return result;
    };
    try {
      core.validateDocument(document);
    } catch {
      return eager();
    }
    // Component reconciliation can touch inactive instances; prepare those documents eagerly.
    if (window.VerynizeComponents?.hasComponents(document)) return eager();
    if (!document.activePage) document.activePage = document.pages[0].id;
    activate(document);
    return core.resolveAliases(document);
  }
  // A page patched in place from another document's page (web/remote-apply.js) is prepared only if that one was.
  function adopt(page, source) {
    if (page !== source && !prepared.has(source)) prepared.delete(page);
  }
  window.VerynizeLazyDocument = Object.freeze({ prepare, activate, adopt });
})();
