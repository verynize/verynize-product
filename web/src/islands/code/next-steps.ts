// "Next steps" checklist state (dismissal and completed steps), persisted in localStorage.
import { useSyncExternalStore } from "react";

type Steps = { dismissed: boolean; invited: boolean; published: boolean };
const KEY = "verynize-code-next-steps";
const listeners = new Set<() => void>();

function read(): Steps {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      dismissed: saved.dismissed === true,
      invited: saved.invited === true,
      published: saved.published === true,
    };
  } catch {
    return { dismissed: false, invited: false, published: false };
  }
}
let current = read();

export function markStep(step: keyof Steps) {
  current = { ...current, [step]: true };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage full: the checklist simply resets next launch */
  }
  listeners.forEach((fn) => fn());
}

export function useNextSteps(): Steps & { mark: typeof markStep } {
  const steps = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
  return { ...steps, mark: markStep };
}
