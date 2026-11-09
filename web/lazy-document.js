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
  // Before `live` (the editor document) is patched in place from `next` (web/remote-apply.js): the pages of `next` that
  // replace prepared pages of `live` are prepared too, so patched and inserted nodes carry the editor defaults and
  // unchanged nodes compare equal.
  function match(next, live) {
    if (!editorDefaults) return;
    const ready = new Set(live.pages.filter((page) => prepared.has(page)).map((page) => page.id));
    for (const page of next.pages)
      if (ready.has(page.id) && !prepared.has(page)) {
        window.VerynizeDocument.normalizeDocument({ ...next, pages: [page] }, editorDefaults);
        prepared.add(page);
      }
  }
  window.VerynizeLazyDocument = Object.freeze({ prepare, activate, match });
})();
