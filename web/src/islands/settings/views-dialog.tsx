// The Saved views dialog (`#views-dialog`), a shadcn Dialog rendered by this island in place of the markup and
// handlers of web/views-templates.js, which keeps the views themselves (`window.savedViews`: page, zoom and canvas
// position, stored in the document so they travel with it and with shared rooms) and the #saved-views-open command
// (it dispatches `bd:open-views`). Ids are the legacy ones (tests use them; `[data-view-name]` applies a view).
import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useDesign, useWindowEvent } from "@/lib/bridge";

type View = { id: string; name: string; page: string; zoom: number };
type SavedViews = {
  list(): View[];
  save(name: string): void;
  rename(id: string, name: string): void;
  remove(id: string): void;
  apply(view: View): void;
};
const savedViews = () => (window as unknown as { savedViews: SavedViews }).savedViews;
const ask = (title: string, value: string) =>
  window.askText?.(title, value) ?? Promise.resolve(null);

export function ViewsDialog() {
  // Re-render on every document change: the list lives in the document.
  const doc = useDesign();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  useWindowEvent("bd:open-views", () => {
    setStatus("");
    setOpen(true);
  });
  const views = open ? savedViews().list() : [];
  const pageName = (id: string) => doc.pages.find((p) => p.id === id)?.name ?? "";

  const save = async () => {
    const name = await ask("View name", pageName(doc.activePage));
    if (!name?.trim()) return;
    try {
      savedViews().save(name);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        id="views-dialog"
        // Opened from menus: the menu returning focus to its trigger must not dismiss it (a click outside or
        // Escape still does).
        onFocusOutside={(event) => event.preventDefault()}
        showCloseButton={false}
        className="max-w-md sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          window.document.getElementById("view-save")?.focus();
        }}
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <DialogTitle>Saved views</DialogTitle>
          </div>
          <Button
            id="views-close"
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={() => setOpen(false)}
          >
            <XIcon />
          </Button>
        </div>
        <DialogDescription>
          Save a page, zoom and canvas position. Views travel with the document and shared room.
        </DialogDescription>
        <div>
          <Button id="view-save" onClick={() => void save()}>
            <PlusIcon />
            Save current view
          </Button>
        </div>
        <div id="saved-view-list" className="flex flex-col gap-1">
          {views.map((view) => (
            <article
              key={view.id}
              className="flex items-center gap-2 rounded-md px-1 hover:bg-muted"
            >
              <Button
                variant="ghost"
                data-view-name=""
                className="min-w-0 flex-1 justify-start"
                onClick={() => {
                  savedViews().apply(view);
                  setOpen(false);
                }}
              >
                <span className="truncate text-foreground">{view.name}</span>
              </Button>
              <small className="shrink-0 text-xs text-muted-foreground">
                {pageName(view.page)} · {Math.round(view.zoom * 100)}%
              </small>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  const name = await ask("View name", view.name);
                  if (name?.trim()) savedViews().rename(view.id, name);
                }}
              >
                Rename
              </Button>
              <Button variant="ghost" size="sm" onClick={() => savedViews().remove(view.id)}>
                Delete
              </Button>
            </article>
          ))}
          {!views.length && <p className="text-xs text-muted-foreground">No views saved yet.</p>}
        </div>
        <p id="views-status" role="status" className="min-h-4 text-xs text-muted-foreground">
          {status}
        </p>
      </DialogContent>
    </Dialog>
  );
}
