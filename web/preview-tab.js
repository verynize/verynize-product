"use strict";
// "Open in a tab" (⌘⌥P) on the canvas command registry (web/canvas-interactions.js, BetterCanvas.extend), so the
// shortcut, the shortcuts drawer and window.design.runCommand all reach it. The tab itself lives in the chrome
// island (web/src/islands/chrome/preview-tab), which installs window.previewTab.open(frameId) / close(frameId).
// The command id is shared: anyone else registering 'preview.openInTab' merges into this entry instead of adding a
// second binding (the registry merges by id).
(() => {
  const PREVIEW_TAB_COMMAND = "preview.openInTab";
  // Selected preview frame, else the active one (last interacted), else the only preview frame on the page.
  function targetFrame() {
    const doc = window.design?.getDocument?.();
    if (!doc) return null;
    const nodes = doc.pages.find((page) => page.id === doc.activePage)?.nodes || [];
    const previews = nodes.filter((node) => node.preview);
    const selection = window.design.getSelection();
    const selected = previews.find((node) => selection.length === 1 && node.id === selection[0]);
    if (selected) return selected.id;
    const active = window.livePreview?.getNodeId?.();
    if (active && previews.some((node) => node.id === active)) return active;
    return previews.length === 1 ? previews[0].id : null;
  }
  window.previewTabTarget = targetFrame;
  window.BetterCanvas?.extend(({ register }) => {
    register({
      id: PREVIEW_TAB_COMMAND,
      label: "Open preview in a tab",
      section: "View",
      keys: ["mod+alt+p"],
      when: () => !!window.previewTab && !!targetFrame(),
      run: () => window.previewTab.open(targetFrame()),
    });
  });
})();
