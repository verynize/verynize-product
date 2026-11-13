// "Pages" section: add page (`#add-page`, taken over from the legacy panel), page rows, rename/delete.
// Rename is inline in the row (double-click, or the legacy `#rename-page` command, which this section intercepts while the
// list is visible); rows reorder by drag (page-drag.ts).
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { File } from "lucide-react";
import { PlusIcon } from "@/components/icons";
import { design, legacy } from "@/lib/bridge";
import { useDocSummary, type PageInfo } from "./hooks";
import { PageRowMenu, RowMenuRoot, RowMenuTrigger } from "../context-menu/RowMenus";
import { cn } from "@/lib/utils";
import { IconButton, InlineRename, SectionHeader } from "./parts";
import { pageDragJustEnded, usePageDrag, type PageDrop } from "./page-drag";
import { runLegacy, useTakeOver } from "./legacy";
import { contract } from "./contract";

/** Legacy delete acts on the active page, so activate the row's page first. */
function deletePage(id: string) {
  design().setActivePage(id);
  runLegacy("delete-page");
}

/** Start an inline rename once open menus have closed (they return focus to their trigger, which would blur the field). */
function afterMenusClose(fn: () => void) {
  let frames = 0;
  const tick = () => {
    if (document.querySelector("[role=menu]") && frames++ < 30) requestAnimationFrame(tick);
    else requestAnimationFrame(fn);
  };
  tick();
}

function PageRow({
  page,
  active,
  canDelete,
  renaming,
  dragging,
  onRename,
  onDragStart,
}: {
  page: PageInfo;
  active: boolean;
  canDelete: boolean;
  renaming: boolean;
  dragging: boolean;
  onRename: (id: string | null) => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>, id: string) => void;
}) {
  const rowClass = cn(
    contract("page-row", active && "active"),
    "flex h-7.5 w-full shrink-0 items-center rounded-md bg-transparent pr-3 pl-5.75 text-left text-xs text-foreground-2 hover:bg-muted",
    active && "bg-row hover:bg-row",
    dragging && "text-muted-foreground",
  );
  if (renaming)
    return (
      <div
        data-page-id={page.id}
        data-page-name={page.name}
        className={cn(rowClass, "hover:bg-transparent", active && "bg-transparent")}
      >
        <File className="size-4 shrink-0 text-foreground" />
        <div className="ml-2.5 flex min-w-0 flex-1">
          <InlineRename
            value={page.name}
            label="Page name"
            className="-ml-1.5 h-5 bg-page-rename selection:bg-selection"
            onCommit={(name) => design().updatePage({ name }, page.id)}
            onDone={() => onRename(null)}
          />
        </div>
      </div>
    );
  return (
    <RowMenuRoot>
      <RowMenuTrigger asChild>
        <button
          type="button"
          data-page-id={page.id}
          data-page-name={page.name}
          aria-current={active ? "page" : undefined}
          className={rowClass}
          onPointerDown={(e) => onDragStart(e, page.id)}
          onClick={() => {
            if (!pageDragJustEnded()) design().setActivePage(page.id);
          }}
          onDoubleClick={() => {
            design().setActivePage(page.id);
            onRename(page.id);
          }}
        >
          <File className={cn("size-4 shrink-0 text-foreground", dragging && "opacity-50")} />
          <span className="ml-2.5 truncate">{page.name}</span>
        </button>
      </RowMenuTrigger>
      <PageRowMenu
        canDelete={canDelete}
        // Wonder L2-rename-field / L2-renamed-confirmed: renaming another page from its menu keeps the current page
        // active, so the row is renamed by id without switching pages.
        onRename={() => afterMenusClose(() => onRename(page.id))}
        onDelete={() => deletePage(page.id)}
      />
    </RowMenuRoot>
  );
}

/** Insertion line between page rows while dragging (Wonder L2: 2px primary line across the whole panel). */
function PageDropLine({ drop }: { drop: PageDrop }) {
  return (
    <div
      id="bd-page-drop-indicator"
      aria-hidden="true"
      data-index={drop.index}
      className="pointer-events-none absolute -right-1.5 -left-1.5 z-10 h-0.5 -translate-y-1/2 bg-primary"
      style={{ "--drop-top": `${drop.top}px` } as CSSProperties}
    />
  );
}

export function PagesSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const doc = useDocSummary();
  const addRef = useRef<HTMLButtonElement>(null);
  useTakeOver("add-page", addRef);
  const listRef = useRef<HTMLDivElement>(null);
  const { drop, dragging, onPointerDown } = usePageDrag(listRef);
  const [renaming, setRenaming] = useState<string | null>(null);

  // The legacy `#rename-page` command (app menu, row context menu) renames the active page inline while the list is
  // on screen; otherwise (sidebar or section collapsed) it keeps the legacy name prompt.
  const listVisible = useRef(false);
  useLayoutEffect(() => {
    listVisible.current = open;
  }, [open]);
  useEffect(() => {
    const el = legacy("rename-page");
    if (!el) return;
    const original = el.onclick;
    el.onclick = function (this: GlobalEventHandlers, event: PointerEvent) {
      const list = listRef.current;
      if (
        listVisible.current &&
        list &&
        list.getClientRects().length &&
        !document.body.classList.contains("left-collapsed")
      ) {
        const id = design().getDocument().activePage;
        afterMenusClose(() => setRenaming(id));
        return;
      }
      return original?.call(this, event);
    };
    return () => {
      el.onclick = original;
    };
  }, []);

  return (
    <section
      aria-label="Pages"
      className={cn(
        "flex flex-col border-b border-divider",
        open ? "min-h-24" : "min-h-9 shrink-0",
      )}
    >
      <SectionHeader title="Pages" open={open} onToggle={onToggle} controls="bd-page-list">
        <IconButton ref={addRef} label="Add page" onClick={() => runLegacy("add-page")}>
          <PlusIcon className="size-4" />
        </IconButton>
      </SectionHeader>
      <div
        ref={listRef}
        id="bd-page-list"
        hidden={!open}
        className="relative flex min-h-0 flex-col gap-0.5 overflow-y-auto px-1.5 pb-1.5"
      >
        {doc.pages.map((page) => (
          <PageRow
            key={page.id}
            page={page}
            active={page.id === doc.activePage}
            canDelete={doc.pages.length > 1}
            renaming={renaming === page.id}
            dragging={dragging === page.id}
            onRename={setRenaming}
            onDragStart={onPointerDown}
          />
        ))}
        {drop && <PageDropLine drop={drop} />}
      </div>
    </section>
  );
}
