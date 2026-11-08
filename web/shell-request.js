// Shell view requests. The shell router (web/src/lib/router/shell-router.ts) owns the top-level view: home, editor,
// code and the settings overlay. Legacy entry points (fileLibrary.showHome/showEditor, appSettings.open/close/select,
// agentWorkspace.setCodeMode) call window.shellRequest(target, apply); the router navigates and applies the view
// through the legacy appliers. `target` is {view: '/' | '/editor' | '/editor/<fileId>' | '/code'} or {settings: section | null}.
// The router resolves /editor to the active library file; explicit file paths restore through fileLibrary.open.
// In the web app the shell router runs hosted on TanStack Start's router, so requests write Start's history.
// Before the router bundle runs, `apply` runs at once and the request is queued (only if it changed the shell); the
// router folds the queue onto the startup URL, so an early request (settings opened while ui.js loads) is not lost.
(() => {
  // Establish Home before app.js first draws the canvas. Explicit editor/room links
  // retain their editor startup; the router owns subsequent view changes.
  if (
    (location.pathname === "/" || location.pathname === "/index.html") &&
    !/^#(?:room|public)=/.test(location.hash)
  )
    document.body.classList.add("files-view");
  const pending = [];
  const shell = () => {
    const body = document.body.classList;
    return [
      body.contains("files-view"),
      body.contains("code-mode"),
      body.contains("settings-open"),
      window.appSettings?.getState?.().section,
    ].join();
  };
  const shellRequest = (target, apply) => {
    const router = window.shellNavigation?.request;
    if (router) return router(target);
    const before = shell();
    apply?.();
    if (shell() !== before) pending.push(target);
    return false;
  };
  shellRequest.pending = pending;
  window.shellRequest = shellRequest;
})();
