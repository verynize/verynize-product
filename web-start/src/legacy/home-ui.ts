import { useSyncExternalStore } from "react";
type HomeUi = typeof import("@/web-home");
let ui: HomeUi | null = null;
let loading: Promise<HomeUi> | undefined;
const listeners = new Set<() => void>();
export function loadHomeUi() {
  loading ??= import("@/web-home").then(async (module) => {
    await module.islandsCommitted();
    ui = module;
    for (const listener of listeners) listener();
    return module;
  });
  return loading;
}
export function useHomeUi() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => ui,
    () => null,
  );
}
