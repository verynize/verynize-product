// 40px file header: app menu trigger (menu rendered by the chrome island), file name, visibility, collapse.
import { useState } from "react";
import { Lock } from "lucide-react";
import { legacy, legacySet } from "@/lib/bridge";
import { openSharePopover, useCloudState } from "../share/api";
import { useDocSummary } from "./hooks";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { IconButton, InlineRename } from "./parts";
import { contract } from "./contract";
import { LogoIcon, PanelLeftIcon } from "@/components/icons";

function openAppMenu(anchor: HTMLElement) {
  window.dispatchEvent(new CustomEvent("bd:open-app-menu", { detail: { anchor } }));
}

/** Rename the document through the legacy `#document-name` field (undoable, persists like a user edit). */
function renameDocument(name: string) {
  legacySet(legacy<HTMLInputElement>("document-name"), name);
}

/** Visibility of the open file (B1: follows the room live through `verynize:cloud-state`). */
function useVisibilityLabel() {
  const cloud = useCloudState();
  if (cloud.connected && cloud.visibility === "public")
    return {
      public: true,
      aria: "Public file · Share settings",
      tip: "Public · Anyone with the link",
    };
  if (cloud.connected)
    return {
      public: false,
      aria: "Shared file · Share settings",
      tip: "Private · Only members can access",
    };
  return { public: false, aria: "Private file · Share", tip: "Private · Share" };
}

export function FileHeader({ onCollapse }: { onCollapse: () => void }) {
  const doc = useDocSummary();
  const [renaming, setRenaming] = useState(false);
  const name = doc.name || "Untitled";
  const visibility = useVisibilityLabel();

  return (
    <div className="flex h-10 shrink-0 items-center border-b border-divider pr-3 pl-1.5">
      <button
        type="button"
        aria-label="Main menu"
        aria-haspopup="menu"
        className={cn(
          contract("app-menu-trigger"),
          "inline-flex size-6.5 shrink-0 items-center justify-center rounded-md bg-transparent text-foreground hover:bg-muted",
        )}
        onClick={(e) => {
          e.stopPropagation();
          openAppMenu(e.currentTarget);
        }}
      >
        <LogoIcon className="size-4" />
      </button>
      <div className="ml-1.75 flex min-w-0 flex-1 items-center">
        {renaming ? (
          <InlineRename
            value={name}
            label="File name"
            onCommit={renameDocument}
            onDone={() => setRenaming(false)}
            className="-ml-1.5"
          />
        ) : (
          <span
            id="bd-sidebar-file-name"
            title="Double-click to rename"
            className="truncate text-xs text-foreground select-none"
            onDoubleClick={() => setRenaming(true)}
          >
            {name}
          </span>
        )}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          {visibility.public ? (
            // Wonder SV2: a public file shows a green "Public" badge where the lock was.
            <button
              type="button"
              id="file-visibility"
              data-visibility="public"
              aria-label={visibility.aria}
              className="ml-2 inline-flex h-5 shrink-0 items-center rounded-md border border-share-public-edge bg-share-public-tint px-1.5 text-xs text-share-public hover:brightness-125"
              onClick={openSharePopover}
            >
              Public
            </button>
          ) : (
            <button
              type="button"
              id="file-visibility"
              data-visibility="private"
              aria-label={visibility.aria}
              className="ml-2 inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-input text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={openSharePopover}
            >
              <Lock className="size-3" />
            </button>
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom">{visibility.tip}</TooltipContent>
      </Tooltip>
      <IconButton
        label="Hide sidebar"
        className="ml-2.75 text-muted-foreground"
        onClick={onCollapse}
      >
        <PanelLeftIcon className="size-4" />
      </IconButton>
    </div>
  );
}
