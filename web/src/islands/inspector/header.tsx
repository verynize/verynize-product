// Panel header (design/wonder 22: 40px row): panel toggle, presence avatar + chevron, purple Share (with the Share
// popover, share/share-popover.tsx).
// With the panel hidden (`right-collapsed`) the same controls move into a floating pill at the canvas top-right,
// mirroring Wonder's left-sidebar pill (22: 7px inset, 42px tall, 1px edge, radius 8). The controls render in exactly
// one place at a time, so `#cloud-toggle` stays unique.
import { type ReactElement } from "react";
import { createPortal } from "react-dom";
import { PanelRightIcon } from "@/components/icons";
import { useBodyClass } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { Tip } from "../chrome/tip";
import { ShareButton } from "../share/share-popover";

// Focus follows the toggle: hiding the panel focuses "Show properties" in the pill and vice versa.
let focusToggleOnMount = false;
function toggleRef(node: HTMLButtonElement | null) {
  if (node && focusToggleOnMount) {
    focusToggleOnMount = false;
    node.focus();
  }
}

function setCollapsed(collapsed: boolean, fromKeyboardFocus: boolean) {
  focusToggleOnMount = fromKeyboardFocus;
  document.body.classList.toggle("right-collapsed", collapsed);
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

function Controls({
  collapsed,
  tipSide,
}: {
  collapsed: boolean;
  tipSide: "top" | "bottom" | "left" | "right";
}) {
  const label = collapsed ? "Show properties" : "Hide properties";
  const withTip = (text: string, child: ReactElement) => (
    <Tip label={text} side={tipSide}>
      {child}
    </Tip>
  );
  return (
    <>
      {withTip(
        label,
        <button
          type="button"
          ref={toggleRef}
          aria-label={label}
          aria-pressed={!collapsed}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-3 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          onClick={(event) =>
            setCollapsed(!collapsed, event.currentTarget.matches(":focus-visible"))
          }
        >
          <PanelRightIcon className="size-4" />
        </button>,
      )}
      {/* Presence avatars + Multiplayer tools (collab island, collab/presence.tsx) render into this slot. */}
      <div id="presence-slot" className="flex shrink-0 items-center" />
      <div className={collapsed ? "w-2 shrink-0" : "flex-1"} />
      <ShareButton />
    </>
  );
}

function pillHost() {
  const workspace = document.getElementById("workspace");
  if (!workspace) return null;
  let host = document.getElementById("bd-inspector-canvas");
  if (!host) {
    host = document.createElement("div");
    host.id = "bd-inspector-canvas";
    host.setAttribute("data-bd", "");
    workspace.append(host);
  }
  return host;
}

export function PanelHeader() {
  const collapsed = useBodyClass("right-collapsed");
  const filesView = useBodyClass("files-view");
  const host = collapsed ? pillHost() : null;
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-divider pr-3 pl-1.5">
      {!collapsed && <Controls collapsed={false} tipSide="bottom" />}
      {host &&
        createPortal(
          <div
            id="bd-properties-pill"
            role="group"
            aria-label="Properties panel"
            // Hidden (not unmounted) behind Files so `#cloud-toggle` always exists for legacy `.click()` callers.
            hidden={filesView}
            className={cn(
              "absolute top-1.75 right-1.75 z-30 items-center gap-1 rounded-lg border border-toolbar-edge bg-background p-1.5 pr-2",
              filesView ? "hidden" : "flex h-10.5",
            )}
          >
            <Controls collapsed tipSide="bottom" />
          </div>,
          host,
        )}
    </div>
  );
}
