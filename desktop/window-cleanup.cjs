"use strict";
// Per-window cleanup registry. Feature modules each need to tidy up when the editor window closes (stop agent
// runtimes, kill terminals, close watchers, …). Giving each its own `closed` listener crosses Node's 10-listener
// warning as modules are added, and raising that limit would hide real leaks. Instead every window gets a single
// `closed` listener that runs the registered cleanups in order.
const registries = new WeakMap();

/** Run `fn` once when `win` closes. Returns a function that unregisters it (for short-lived work). */
function onWindowClosed(win, fn) {
  if (!win || typeof fn !== "function") return () => {};
  let cleanups = registries.get(win);
  if (!cleanups) {
    cleanups = new Set();
    registries.set(win, cleanups);
    win.once("closed", () => {
      registries.delete(win);
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch (error) {
          console.error("Window cleanup failed:", error);
        }
      }
      cleanups.clear();
    });
  }
  cleanups.add(fn);
  return () => {
    cleanups.delete(fn);
  };
}

module.exports = { onWindowClosed };
