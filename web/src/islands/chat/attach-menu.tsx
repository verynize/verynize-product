/* oxlint-disable shadcn/no-restyle -- Wonder chat density (13px text, 24px rows, chat menu surface) applied to the shared
   shadcn parts in one place per file, like the local wrappers in ./menu.tsx. */
// Composer "+" menu (Wonder 32): "Add to this worktree" (Add file, Add folder, Link a chat or worktree ›) and
// "Attach to this message" (Files and images, Terminal output, Figma design, Design references ›), then Commands.
// Built on the shared shadcn DropdownMenu (incl. DropdownMenuSub) with the chat menu density (13px text, 24px rows).
import { useState, type ComponentProps } from "react";
import {
  CommandIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  GitForkIcon,
  LinkIcon,
  PaletteIcon,
  PaperclipIcon,
  PlusIcon as LucidePlusIcon,
  SquareTerminalIcon,
  XIcon,
} from "lucide-react";
import { FigmaIcon, PlusIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useRepositories } from "../code/controller";
import {
  addToWorktree,
  attachCollection,
  attachFigma,
  attachTerminalOutput,
  chatDesktop,
  linkNewWorktree,
  openCommands,
  saveAttachedCollection,
  type ReferenceCollection,
} from "./composer-actions";
import { hook } from "./hooks";
import { workspace, type ChatState, type ChatSummary } from "./store";

const TRIGGER =
  "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground-2 data-[state=open]:bg-muted data-[state=open]:text-foreground-2";
const SURFACE = "rounded-xl border-card-border bg-background p-1 text-sm text-foreground-2";
const ROW =
  "h-6 gap-2 text-sm text-foreground-2 focus:bg-muted focus:text-foreground-2 data-[state=open]:bg-muted";
const LABEL = "flex h-6 items-center truncate px-2 py-0 text-sm font-normal text-muted-foreground";

function Item({ className, ...props }: ComponentProps<typeof DropdownMenuItem>) {
  return <DropdownMenuItem className={cn(ROW, className)} {...props} />;
}
function SubTrigger({ className, ...props }: ComponentProps<typeof DropdownMenuSubTrigger>) {
  return <DropdownMenuSubTrigger className={cn(ROW, className)} {...props} />;
}
function SubContent({ className, ...props }: ComponentProps<typeof DropdownMenuSubContent>) {
  // The shared SubContent has no portal of its own; DropdownMenuPortal keeps it in portalContainer().
  return (
    <DropdownMenuPortal>
      <DropdownMenuSubContent
        sideOffset={6}
        alignOffset={-5}
        collisionPadding={8}
        className={cn(SURFACE, "min-w-44", className)}
        {...props}
      />
    </DropdownMenuPortal>
  );
}
function GroupLabel({ className, ...props }: ComponentProps<typeof DropdownMenuLabel>) {
  return <DropdownMenuLabel className={cn(LABEL, className)} {...props} />;
}
function MenuContent({ className, ...props }: ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent className={cn(SURFACE, className)} {...props} />;
}
function Separator() {
  return <DropdownMenuSeparator className="my-1" />;
}

type LinkGroup = { key: string; name: string; repoId?: string; chats: ChatSummary[] };

/** Chats of every repository (and quick chats), grouped by repository; the current chat is left out. Only rendered
 * while the + menu is open (menu content mounts on open), so stored chats are read then, not on every chat update. */
function useLinkGroups(state: ChatState): LinkGroup[] {
  const { repositories } = useRepositories();
  const ws = workspace();
  const groups: LinkGroup[] = repositories.map((repo) => ({
    key: repo.root,
    name: repo.name,
    repoId: repo.id,
    chats: (ws?.chatSummaries?.(repo.root) ?? []).filter(
      (chat) => chat.id !== state.conversationId,
    ),
  }));
  if (
    !repositories.some((repo) => repo.root === state.projectKey) &&
    state.projectKey !== "unattached"
  ) {
    groups.push({
      key: state.projectKey,
      name: state.projectName || "This project",
      chats: (ws?.chatSummaries?.(state.projectKey) ?? state.conversations).filter(
        (chat) => chat.id !== state.conversationId,
      ),
    });
  }
  const quick = (ws?.chatSummaries?.("unattached") ?? []).filter(
    (chat) => chat.id !== state.conversationId && chat.count > 0,
  );
  if (quick.length) groups.push({ key: "unattached", name: "Quick chats", chats: quick });
  // Wonder lists other repositories first and the current one (with "New worktree") last.
  return [
    ...groups.filter((g) => g.key !== state.projectKey),
    ...groups.filter((g) => g.key === state.projectKey),
  ].filter((g) => g.chats.length > 0 || (g.key === state.projectKey && !!g.repoId));
}

function LinkMenu({ state }: { state: ChatState }) {
  const groups = useLinkGroups(state);
  const ws = workspace();
  return (
    <DropdownMenuSub>
      <SubTrigger id="chat-link-trigger">
        <LinkIcon />
        Link a chat or worktree
      </SubTrigger>
      <SubContent className="max-h-80 w-56 overflow-y-auto">
        {groups.length === 0 && <GroupLabel>No other chats yet</GroupLabel>}
        {groups.map((group, index) => (
          <DropdownMenuGroup key={group.key}>
            {index > 0 && <Separator />}
            <GroupLabel title={group.name}>{group.name}</GroupLabel>
            {group.chats.map((chat) => (
              <Item
                key={chat.id}
                data-link-chat={chat.id}
                title={chat.branch ? `${chat.title} · ${chat.branch}` : chat.title}
                onSelect={() => ws?.linkChat?.(chat.id, group.key)}
              >
                <GitForkIcon />
                <span className="min-w-0 truncate">{chat.title || "Untitled chat"}</span>
              </Item>
            ))}
            {group.key === state.projectKey && group.repoId && (
              <Item
                id="chat-link-new-worktree"
                onSelect={() => void linkNewWorktree(group.repoId as string)}
              >
                <LucidePlusIcon />
                New worktree
              </Item>
            )}
          </DropdownMenuGroup>
        ))}
      </SubContent>
    </DropdownMenuSub>
  );
}

function ReferencesMenu() {
  const [collections, setCollections] = useState<ReferenceCollection[] | null>(null);
  const load = (open: boolean) => {
    if (!open) return;
    chatDesktop()
      ?.designReferencesList?.()
      .then(setCollections)
      .catch(() => setCollections([]));
  };
  return (
    <DropdownMenuSub onOpenChange={load}>
      <SubTrigger id="chat-references-trigger">
        <PaletteIcon />
        Design references
      </SubTrigger>
      <SubContent className="max-h-80 w-60 overflow-y-auto">
        {(collections ?? []).map((collection) => (
          <Item
            key={collection.id}
            data-reference={collection.id}
            onSelect={() => void attachCollection(collection.id)}
          >
            <FolderIcon />
            <span className="min-w-0 truncate">{collection.name}</span>
            <span className="ml-auto text-subtle-foreground">{collection.count}</span>
          </Item>
        ))}
        {!!collections?.length && <Separator />}
        <Item id="chat-references-save" onSelect={() => void saveAttachedCollection()}>
          <LucidePlusIcon />
          Save attached as a collection
        </Item>
      </SubContent>
    </DropdownMenuSub>
  );
}

export function AttachMenu({ state }: { state: ChatState }) {
  const ws = workspace();
  const attached = state.projectKey !== "unattached" && !!state.chatRoot;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" id="chat-attach-menu" aria-label="Attach" className={TRIGGER}>
          <PlusIcon className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <MenuContent align="start" side="top" sideOffset={6} collisionPadding={8} className="w-56">
        <DropdownMenuGroup>
          <GroupLabel>{attached ? "Add to this worktree" : "Add to this chat"}</GroupLabel>
          {attached && (
            <>
              <Item id="chat-add-file" onSelect={() => void addToWorktree(false)}>
                <FileIcon />
                Add file
              </Item>
              <Item id="chat-add-folder" onSelect={() => void addToWorktree(true)}>
                <FolderPlusIcon />
                Add folder
              </Item>
            </>
          )}
          <LinkMenu state={state} />
        </DropdownMenuGroup>
        <Separator />
        <DropdownMenuGroup>
          <GroupLabel>Attach to this message</GroupLabel>
          <Item id="chat-attach-files" onSelect={() => ws?.attachFiles?.()}>
            <PaperclipIcon />
            Files and images
          </Item>
          <Item id="chat-attach-terminal" onSelect={() => void attachTerminalOutput()}>
            <SquareTerminalIcon />
            Terminal output
          </Item>
          {ws?.attachFigma && (
            <Item id="chat-attach-figma" onSelect={() => void attachFigma()}>
              <FigmaIcon />
              Figma design
            </Item>
          )}
          <ReferencesMenu />
        </DropdownMenuGroup>
        <Separator />
        <Item id="chat-open-commands" onSelect={openCommands}>
          <CommandIcon />
          Commands
        </Item>
      </MenuContent>
    </DropdownMenu>
  );
}

/** Extra working directories of the chat (/add-dir, linked worktrees), shown above the prompt. */
export function WorkingDirectories({ state }: { state: ChatState }) {
  const dirs = state.directories ?? [];
  if (!dirs.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-2 pt-2">
      {dirs.map((dir) => (
        <span
          key={dir}
          title={dir}
          className={cn(
            hook.mention,
            "group/dir flex h-6 max-w-full items-center gap-1.5 rounded-md border border-chat-chip-border bg-chat-chip-bg px-2 text-base leading-5.25 text-foreground-2",
          )}
        >
          <span className="relative flex size-3.5 shrink-0 items-center justify-center">
            <FolderIcon className="size-3.5 text-muted-foreground transition-opacity group-hover/dir:opacity-0 group-focus-within/dir:opacity-0" />
            <button
              type="button"
              aria-label={`Remove working directory ${dir}`}
              onClick={() => workspace()?.removeDirectory?.(dir)}
              className="absolute inset-0 flex items-center justify-center rounded-sm text-muted-foreground opacity-0 group-hover/dir:opacity-100 group-focus-within/dir:opacity-100 hover:text-foreground focus-visible:opacity-100"
            >
              <XIcon className="size-3.5" />
            </button>
          </span>
          <span className="truncate">{dir.split("/").filter(Boolean).pop() || dir}</span>
        </span>
      ))}
    </div>
  );
}
