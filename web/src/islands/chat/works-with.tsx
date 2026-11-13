// Composer "Works with" indicator (file icon + count beside Send): the Verynize design files this chat works with —
// the canvas sent as context with a message, @mentioned elements, the agent's design-tool calls and verynize:// links
// in its replies. Clicking a file opens it on the canvas.
import { useEffect, useMemo, useState } from "react";
import { FileIcon } from "lucide-react";
import type { DesignDocument } from "@/lib/bridge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ChatMessage, ChatState } from "./store";
import { workspace } from "./store";

type LibraryFile = { id: string; name: string; document?: DesignDocument; archived?: boolean };
type Library = {
  list(): LibraryFile[];
  readonly currentId: string | null;
  open(id: string): Promise<unknown>;
  showEditor?(): void;
  subscribe?(fn: () => void): () => void;
};
const library = () => window.fileLibrary as unknown as Library | undefined;

/** References a chat makes to design files: document names, library file ids and page ids. */
export type FileRefs = { names: string[]; ids: string[]; pages: string[] };

const LINK = /verynize:\/\/node\/([^/\s)]*)\/([^/\s)]+)\//g;
const DESIGN_TOOL = /^mcp__verynize__|^verynize\b/i;
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : "");

export function fileRefs(messages: ChatMessage[]): FileRefs {
  const names = new Set<string>(),
    ids = new Set<string>(),
    pages = new Set<string>();
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  for (const message of messages) {
    if (message.role === "user") {
      if (message.canvas && message.canvas !== "Canvas") names.add(message.canvas);
      for (const mention of message.mentions ?? []) if (mention.pageId) pages.add(mention.pageId);
      continue;
    }
    for (const match of (message.text || "").matchAll(LINK)) {
      const name = decode(match[1]);
      if (name && name !== "editor") names.add(name);
      pages.add(decode(match[2]));
    }
    for (const part of message.parts ?? []) {
      if (part.kind !== "tool" || !DESIGN_TOOL.test(part.name || "")) continue;
      const input =
        part.input && typeof part.input === "object" ? (part.input as Record<string, unknown>) : {};
      for (const key of ["document", "name"] as const)
        if (str(input[key])) names.add(str(input[key]));
      if (str(input.fileId)) ids.add(str(input.fileId));
      if (str(input.pageId)) pages.add(str(input.pageId));
    }
  }
  return { names: [...names], ids: [...ids], pages: [...pages] };
}

type Match = { id: string; name: string; pageId?: string };
/** Library files (not archived) matching the refs, in library order. */
export function resolveFiles(refs: FileRefs, files: LibraryFile[]): Match[] {
  const names = new Set(refs.names.map((n) => n.toLowerCase()));
  const ids = new Set(refs.ids);
  const pages = new Set(refs.pages);
  const out: Match[] = [];
  for (const file of files) {
    if (file.archived) continue;
    const page = file.document?.pages?.find((p) => pages.has(p.id));
    if (
      ids.has(file.id) ||
      names.has(String(file.name || file.document?.name || "").toLowerCase()) ||
      page
    )
      out.push({
        id: file.id,
        name: file.name || file.document?.name || "Untitled",
        ...(page ? { pageId: page.id } : {}),
      });
  }
  return out;
}

function useLibraryVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => library()?.subscribe?.(() => setVersion((v) => v + 1)), []);
  return version;
}

async function openFile(match: Match) {
  const lib = library();
  if (!lib) return;
  if (document.body.classList.contains("code-mode")) workspace()?.setCodeMode?.(false);
  if (lib.currentId !== match.id) await lib.open(match.id);
  lib.showEditor?.();
  if (match.pageId && window.design?.getDocument?.().activePage !== match.pageId)
    window.design?.setActivePage?.(match.pageId);
}

export function WorksWith({ state }: { state: ChatState }) {
  const [open, setOpen] = useState(false);
  // Refs change only when a message is added or a turn ends, not on every streamed delta.
  const settled = state.messages.length + (state.busy ? ":busy" : "");
  const refs = useMemo(() => fileRefs(state.messages), [state.conversationId, settled]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = JSON.stringify(refs);
  const version = useLibraryVersion();
  const files = useMemo(() => {
    if (!refs.names.length && !refs.ids.length && !refs.pages.length) return [];
    return resolveFiles(refs, library()?.list() ?? []);
  }, [key, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!files.length) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Works with ${files.length} ${files.length === 1 ? "file" : "files"}`}
          title="Works with"
          data-chat-indicator="works-with"
          className="relative"
        >
          <FileIcon className="size-4" />
          <Badge variant="count" aria-hidden="true" className="absolute -top-1 -right-1">
            {files.length}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={8}
        data-chat-popover="works-with"
        className="w-64"
      >
        <div className="-m-1.5">
          <div className="px-1.5 pt-0.5 pb-1 text-sm text-muted-foreground">Works with</div>
          <ul className="flex flex-col">
            {files.map((file) => (
              <li key={file.id}>
                <button
                  type="button"
                  data-works-with-file={file.id}
                  className="flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left text-sm text-foreground outline-hidden hover:bg-muted focus-visible:bg-muted"
                  onClick={() => {
                    setOpen(false);
                    void openFile(file);
                  }}
                >
                  <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{file.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
