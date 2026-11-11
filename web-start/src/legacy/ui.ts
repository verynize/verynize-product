// The renderer UI (every island of web/dist/ui.js, plus the areas Start's routes render), bundled into this app from
// source (`virtual:verynize/legacy-ui`, web-start/build/legacy-web.mjs). The legacy boot (boot.ts) runs it where
// web/index.html loads ui.js, so it starts after the legacy scripts exactly as on desktop; route components render
// the moved areas once it has run (useLegacyUi).
import * as React from "react";
import { useSyncExternalStore } from "react";

export type LegacyUi = typeof import("virtual:verynize/legacy-ui");

let ui: LegacyUi | null = null;
let loading: Promise<LegacyUi> | undefined;
const listeners = new Set<() => void>();

/**
 * Runs the UI bundle once (island mounts, the hosted shell router) and resolves when it has run, like ui.js loading.
 * Later calls return the same promise.
 */
export function prefetchLegacyUi() {
  return import("virtual:verynize/legacy-ui");
}

export function loadLegacyUi(): Promise<LegacyUi> {
  loading ??= prefetchLegacyUi().then(async (module) => {
    await module.startEditorUi();
    // One React on the page: the islands are bundled with this app, not loaded as a second copy.
    // (Compares an export: dev servers may wrap the same module in different namespace objects.)
    document.documentElement.dataset.sharedReact = String(
      module.React.useState === React.useState && module.React.version === React.version,
    );
    // Route areas render after the islands' first commit, so takeover claims and the UI-ready signal see the same
    // first frame as on desktop, where the router island applies the location after the other islands.
    await module.islandsCommitted();
    ui = module;
    for (const listener of listeners) listener();
    return module;
  });
  return loading;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The UI module once it has run (after the legacy scripts), else null. */
export function useLegacyUi(): LegacyUi | null {
  return useSyncExternalStore(
    subscribe,
    () => ui,
    () => null,
  );
}
