// Title-bar tabs for expanded previews (Wonder PF3): app-window glyph with a status dot, "<worktree> · Preview"
// while the app runs, "<worktree> · Stopped" once its server stops. Sits after the document tab, like a file tab.
import { AppWindow, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { activate, close, usePreviewTabs } from "./store";

export function PreviewTabs({ tabClass, activeClass }: { tabClass: string; activeClass: string }) {
  const { tabs, active } = usePreviewTabs();
  if (!tabs.length) return null;
  return (
    <>
      {tabs.map((tab) => {
        const isActive = active === tab.frameId;
        const label = tab.status === "running" || tab.status === "starting" ? "Preview" : "Stopped";
        return (
          <div
            key={tab.frameId}
            data-preview-tab={tab.frameId}
            data-status={tab.status}
            className={cn(
              tabClass,
              "group/preview-tab relative min-w-0 shrink gap-0 p-0",
              isActive && activeClass,
            )}
          >
            <button
              type="button"
              aria-current={isActive ? "page" : undefined}
              className="flex h-full min-w-0 items-center gap-1.5 rounded-lg pr-2.5 pl-2 outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => activate(tab.frameId)}
            >
              <span data-pt="glyph">
                <AppWindow />
                <span data-pt="dot" data-status={tab.status} aria-hidden="true" />
              </span>
              <span className="min-w-0 truncate">
                <span className={cn(isActive ? "text-foreground" : "text-inherit")}>
                  {tab.name}
                </span>
                <span className="text-muted-foreground">&nbsp;·&nbsp;{label}</span>
              </span>
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.name} preview tab`}
              className="mr-1 hidden size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none group-hover/preview-tab:flex hover:bg-muted hover:text-foreground focus-visible:flex focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-3"
              onClick={() => close(tab.frameId)}
            >
              <X />
            </button>
          </div>
        );
      })}
    </>
  );
}
