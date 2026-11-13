// Read-only view of one app preference (web/settings.js window.appPreferences) for any island.
// Values are primitives, so useSyncExternalStore gets stable snapshots.
import { useSyncExternalStore } from "react";
import type { Preferences } from "./api";

type Primitive = string | number | boolean | undefined;

function subscribe(fn: () => void) {
  window.addEventListener("app-preferences-changed", fn);
  return () => window.removeEventListener("app-preferences-changed", fn);
}

export function getPreference<K extends keyof Preferences>(key: K): Preferences[K] | undefined {
  const all = window.appPreferences?.get() as Partial<Preferences> | undefined;
  return all?.[key];
}

/** Re-renders when the preference changes. */
export function usePreference<K extends keyof Preferences>(key: K): Preferences[K] | undefined {
  return useSyncExternalStore(subscribe, () => getPreference(key) as Primitive) as
    | Preferences[K]
    | undefined;
}
