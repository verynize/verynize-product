// File editor pane (center column, over the chat): path, unsaved marker, Save (⌘S) and Close.
import type { KeyboardEvent } from "react";
import { SaveIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { closeFile, editText, saveFile, type OpenFile } from "./editor-state";

export function FileEditor({ file }: { file: OpenFile }) {
  const dirty = file.text !== file.saved;
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveFile();
    }
    if (event.key === "Tab" && !event.shiftKey && !event.metaKey) {
      event.preventDefault();
      const el = event.currentTarget;
      el.setRangeText("  ", el.selectionStart, el.selectionEnd, "end");
      editText(el.value);
    }
    if (event.key === "Escape") closeFile();
    // Canvas shortcuts must not see typing.
    event.stopPropagation();
  };
  const lines = file.text.split("\n").length;
  return (
    <section
      aria-label={`Editing ${file.path}`}
      id="code-editor-pane"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4">
        <span id="code-editor-path" className="min-w-0 truncate text-sm text-foreground">
          {file.kind === "memory" ? "Project memory · VERYNIZE.md" : file.path}
        </span>
        {dirty && (
          <span
            role="img"
            aria-label="Unsaved changes"
            title="Unsaved changes"
            className="size-1.5 shrink-0 rounded-full bg-foreground-3"
          />
        )}
        <span className="flex-1" />
        <span className="shrink-0 text-xs text-subtle-foreground">{lines} lines</span>
        <button
          type="button"
          id="code-editor-save"
          disabled={!dirty || file.loading}
          onClick={() => void saveFile()}
          className="flex h-6.5 items-center gap-1.5 rounded-md border border-card-border px-2 text-xs text-foreground-2 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          <SaveIcon className="size-3.5 text-muted-foreground" />
          Save
        </button>
        <button
          type="button"
          aria-label="Close file"
          title="Close file"
          onClick={() => closeFile()}
          className="flex size-6.5 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground-2 focus-visible:ring-1 focus-visible:ring-ring"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <textarea
        id="code-editor"
        aria-label={file.kind === "memory" ? "Project memory" : `Contents of ${file.path}`}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        value={file.text}
        readOnly={file.loading}
        onChange={(event) => editText(event.target.value)}
        onKeyDown={onKey}
        placeholder={
          file.kind === "memory"
            ? "Notes for agents working in this repository (VERYNIZE.md)"
            : undefined
        }
        className={cn(
          "min-h-0 flex-1 resize-none bg-code-editor px-4 py-3 font-mono text-xs whitespace-pre text-foreground-2 outline-none",
          file.loading && "opacity-60",
        )}
      />
    </section>
  );
}
