// "Line changes in sidebar": uncommitted lines added/removed per worktree (desktop worktreeLineStats, the same
// numstat totals as the Changes panel). Refreshed when a chat turn finishes, on window focus and every minute.
import { useEffect, useState } from "react";
import { appPreferencesApi } from "../settings/preference-runtime";
import { platform } from "@/lib/platform";

export type LineStat = { added: number; removed: number; files: number };

export function useLineStats(roots: string[], enabled: boolean): Record<string, LineStat> {
  const [stats, setStats] = useState<Record<string, LineStat>>({});
  const key = enabled ? [...new Set(roots)].sort().join("\n") : "";
  useEffect(() => {
    const api = appPreferencesApi();
    if (!key || !api) {
      setStats({});
      return;
    }
    const list = key.split("\n");
    let live = true;
    let timer: number | undefined;
    const load = () => {
      api
        .worktreeLineStats(list)
        .then((result) => {
          if (!live) return;
          const next: Record<string, LineStat> = {};
          for (const [root, value] of Object.entries(result))
            if (!("error" in value)) next[root] = value;
          setStats(next);
        })
        .catch(() => {});
    };
    const later = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, delay);
    };
    load();
    const off = platform.desktop?.onAgentEvent((event) => {
      if (event.type === "done") later(300);
    });
    const onFocus = () => later(150);
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(load, 60000);
    return () => {
      live = false;
      off?.();
      window.removeEventListener("focus", onFocus);
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [key]);
  return stats;
}
